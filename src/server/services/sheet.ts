import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withTenant } from "../db";
import { type Actor, assertDistributor } from "../actor";
import { notFound } from "../errors";

// ---------------------------------------------------------------------------
// «الكشف»: صفحة العمل الرئيسية للموزّع (قرار المالك). قائمة ناس الكشف المختار،
// وحالة كل شخص: سُلّم أم لا، والمطلوب والمدفوع والمتبقي.
// ---------------------------------------------------------------------------

export type SheetRow = {
  id: string; // الاستحقاق
  citizenId: string;
  citizenNumber: string;
  name: string;
  nationalId: string;
  phone: string | null;
  quantity: number;
  amountDue: string;
  paid: string;
  remaining: string;
  delivered: boolean;
  handoverId: string | null;
  deliveredAt: string | null;
  /** جرار مسجّلة بطريقة المراحل السابقة (استلام/تعبئة/تسليم)؛ تُعرض للاطلاع فقط. */
  legacy: { total: number; delivered: number } | null;
};

export type SheetStatement = { id: string; title: string; version: number; cycleName: string | null; cycleId: string | null; approvedAt: string | null };

/** ترتيب أرقام المواطنين عدديًا، بما فيها «الميزان-المتسلسل» (295-2 قبل 295-10). */
const numberOrder = Prisma.sql`CASE WHEN e."citizenNumber" ~ '^[0-9]+(-[0-9]+)*$' THEN string_to_array(e."citizenNumber", '-')::int[] END NULLS LAST, e."citizenNumber"`;

export async function sheet(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const { statementId } = z.object({ statementId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)) }).parse(input ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    const list = await tx.statement.findMany({
      where: { status: "APPROVED" },
      include: { cycle: { select: { id: true, name: true } } },
      orderBy: [{ approvedAt: "desc" }],
    });
    const pending = await tx.statement.count({ where: { status: "PENDING_REVIEW" } });
    const statements: SheetStatement[] = list.map((s) => ({
      id: s.id, title: s.title, version: s.version, cycleName: s.cycle?.name ?? null, cycleId: s.cycle?.id ?? null, approvedAt: s.approvedAt?.toISOString() ?? null,
    }));
    if (statementId && !statements.some((s) => s.id === statementId)) throw notFound("الكشف");
    const current = statements.find((s) => s.id === statementId) ?? statements[0] ?? null;
    if (!current) return { statements, statement: null, rows: [] as SheetRow[], pending };

    const raw = await tx.$queryRaw<{
      id: string; citizenId: string; citizenNumber: string; name: string; nationalId: string; phone: string | null; quantity: number;
      amountDue: Prisma.Decimal; paid: Prisma.Decimal; handoverId: string | null; deliveredAt: Date | null; cylTotal: bigint; cylDelivered: bigint;
    }[]>`
      SELECT e."id", e."citizenId", e."citizenNumber", e."nameInStatement" AS name, c."nationalId", COALESCE(e."phoneInStatement", c."phone") AS phone,
        e."quantity", e."amountDue",
        COALESCE((SELECT sum(p."amount") FROM "payments" p WHERE p."entitlementId" = e."id" AND p."status" = 'ACTIVE'), 0) AS paid,
        h."id" AS "handoverId", h."at" AS "deliveredAt",
        (SELECT count(*) FROM "cylinders" z WHERE z."entitlementId" = e."id" AND z."status" <> 'VOID') AS "cylTotal",
        (SELECT count(*) FROM "cylinders" z WHERE z."entitlementId" = e."id" AND z."status" = 'DELIVERED') AS "cylDelivered"
      FROM "entitlements" e
      JOIN "citizens" c ON c."id" = e."citizenId"
      LEFT JOIN "handovers" h ON h."entitlementId" = e."id" AND h."status" = 'ACTIVE'
      WHERE e."statementId" = ${current.id}::uuid AND e."status" = 'ACTIVE'
      ORDER BY ${numberOrder}`;

    const rows: SheetRow[] = raw.map((r) => {
      const due = new Prisma.Decimal(r.amountDue);
      const paid = new Prisma.Decimal(r.paid);
      const cylTotal = Number(r.cylTotal);
      const cylDelivered = Number(r.cylDelivered);
      return {
        id: r.id, citizenId: r.citizenId, citizenNumber: r.citizenNumber, name: r.name, nationalId: r.nationalId, phone: r.phone, quantity: r.quantity,
        amountDue: due.toFixed(2), paid: paid.toFixed(2), remaining: Prisma.Decimal.max(due.sub(paid), 0).toFixed(2),
        delivered: Boolean(r.handoverId) || (cylTotal > 0 && cylDelivered >= r.quantity),
        handoverId: r.handoverId, deliveredAt: r.deliveredAt?.toISOString() ?? null,
        legacy: cylTotal > 0 ? { total: cylTotal, delivered: cylDelivered } : null,
      };
    });
    return { statements, statement: current, rows, pending };
  }, { timeout: 30_000 });
}
