import { z } from "zod";
import { Prisma, type MovementType } from "@prisma/client";
import type { Tx } from "../db";
import { withTenant } from "../db";
import { AppError } from "../errors";
import { type Actor, type DistributorActor, assertDistributor } from "../actor";

type Delta = { empty?: number; filled?: number; extra?: number };

/**
 * كل حركة مخزون تمر من هنا: تحديث الرصيد ذريًا (UPDATE … RETURNING يقفل الصف)،
 * ثم تسجيل الحركة مع الرصيد بعدها. القيد في قاعدة البيانات يرفض أي رصيد سالب.
 */
export async function recordMovement(
  tx: Tx,
  actor: DistributorActor,
  m: { type: MovementType; delta: Delta; operationId?: string | null; shipmentId?: string | null; reversesId?: bigint | null; note?: string | null },
) {
  const d = { empty: m.delta.empty ?? 0, filled: m.delta.filled ?? 0, extra: m.delta.extra ?? 0 };
  await tx.$executeRaw`INSERT INTO "inventory_balances" ("distributorId") VALUES (${actor.distributorId}::uuid) ON CONFLICT DO NOTHING`;
  let after: { empty: number; filled: number; extra: number }[];
  try {
    after = await tx.$queryRaw`
      UPDATE "inventory_balances"
      SET "empty" = "empty" + ${d.empty}, "filled" = "filled" + ${d.filled}, "extra" = "extra" + ${d.extra}, "updatedAt" = now()
      WHERE "distributorId" = ${actor.distributorId}::uuid
      RETURNING "empty", "filled", "extra"`;
  } catch (e) {
    if (String(e).includes("inventory_balances_non_negative")) {
      throw new AppError("INVALID_STATE", "حركة غير منطقية: المخزون سيصبح سالبًا. راجع العمليات السابقة");
    }
    throw e;
  }
  const a = after[0];
  return tx.inventoryMovement.create({
    data: {
      distributorId: actor.distributorId,
      type: m.type,
      emptyDelta: d.empty,
      filledDelta: d.filled,
      extraDelta: d.extra,
      emptyAfter: a.empty,
      filledAfter: a.filled,
      extraAfter: a.extra,
      operationId: m.operationId ?? null,
      shipmentId: m.shipmentId ?? null,
      reversesId: m.reversesId ?? null,
      note: m.note ?? null,
      userId: actor.userId,
    },
  });
}

/** يعكس حركة سابقة مرة واحدة فقط (reversesId فريد في قاعدة البيانات). */
export async function reverseMovement(tx: Tx, actor: DistributorActor, movementId: bigint, note: string) {
  const orig = await tx.inventoryMovement.findUnique({ where: { id: movementId } });
  if (!orig) throw new AppError("NOT_FOUND", "الحركة غير موجودة");
  if (orig.type === "REVERSAL") throw new AppError("INVALID_STATE", "لا يمكن عكس حركة عكسية");
  if (await tx.inventoryMovement.findUnique({ where: { reversesId: orig.id } })) {
    throw new AppError("INVALID_STATE", "عُكست هذه الحركة سابقًا");
  }
  return recordMovement(tx, actor, {
    type: "REVERSAL",
    delta: { empty: -orig.emptyDelta, filled: -orig.filledDelta, extra: -orig.extraDelta },
    operationId: orig.operationId,
    shipmentId: orig.shipmentId,
    reversesId: orig.id,
    note,
  });
}

/**
 * الرصيد الحالي مع مطابقته بحالات الجرار الفعلية. أي اختلاف يعني خللًا يجب مراجعته
 * (لا يُصحح تلقائيًا).
 */
export async function getInventory(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const bal = (await tx.inventoryBalance.findUnique({ where: { distributorId: actor.distributorId } })) ?? { empty: 0, filled: 0, extra: 0 };
    const [states, extraFromShipments] = await Promise.all([
      tx.cylinder.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.shipment.aggregate({ where: { status: "ACTIVE" }, _sum: { extraCount: true } }),
    ]);
    const n = (s: string) => states.find((x) => x.status === s)?._count._all ?? 0;
    const expected = { empty: n("EMPTY"), filled: n("FILLED"), extra: extraFromShipments._sum.extraCount ?? 0 };
    return {
      balance: { empty: bal.empty, filled: bal.filled, extra: bal.extra },
      expected,
      delivered: n("DELIVERED"),
      reconciled: bal.empty === expected.empty && bal.filled === expected.filled && bal.extra === expected.extra,
    };
  });
}

const movementFilters = z.object({
  type: z.enum(["RECEIVE_EMPTY", "FILL", "DELIVER", "SHIPMENT_EXTRA", "REVERSAL"]).optional(),
  from: z.string().optional().transform((v) => (v ? new Date(v) : undefined)),
  to: z.string().optional().transform((v) => (v ? new Date(`${v}T23:59:59.999`) : undefined)),
  page: z.coerce.number().int().min(1).default(1),
});
const MOVES_PAGE = 50;

export async function listMovements(actor: Actor, filters: unknown) {
  assertDistributor(actor);
  const f = movementFilters.parse(filters ?? {});
  const where: Prisma.InventoryMovementWhereInput = { type: f.type, at: f.from || f.to ? { gte: f.from, lte: f.to } : undefined };
  return withTenant(actor.distributorId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.inventoryMovement.findMany({ where, orderBy: { id: "desc" }, skip: (f.page - 1) * MOVES_PAGE, take: MOVES_PAGE }),
      tx.inventoryMovement.count({ where }),
    ]);
    const opIds = rows.map((r) => r.operationId).filter((x): x is string => !!x);
    const ops = await tx.cylinderOperation.findMany({ where: { id: { in: opIds } }, select: { id: true, cylinder: { select: { label: true, id: true } } } });
    const labelOf = new Map(ops.map((o) => [o.id, o.cylinder]));
    const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, displayName: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.displayName]));
    return {
      rows: rows.map((r) => ({ ...r, cylinder: r.operationId ? labelOf.get(r.operationId) ?? null : null, userName: nameOf.get(r.userId) ?? "—" })),
      total,
      page: f.page,
      pageSize: MOVES_PAGE,
    };
  });
}
