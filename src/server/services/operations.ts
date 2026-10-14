import { z } from "zod";
import { Prisma, type Cylinder, type CylinderOperation, type OperationType } from "@prisma/client";
import type { Tx } from "../db";
import { withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, type DistributorActor, assertDistributor } from "../actor";
import { audit } from "../audit";
import { cleanText, digitsOnly, normalizeDigits } from "@/lib/arabic";
import { isValidNationalId } from "@/lib/national-id";
import { recordMovement, reverseMovement } from "./inventory";
import { isolate } from "@/lib/format";
import { billableWhere, paidByEntitlement } from "./finance";

// ---------------------------------------------------------------------------
// أدوات
// ---------------------------------------------------------------------------

/** رقم الجرة: رقم المواطن، مع لاحقة إذا كان للاستحقاق أكثر من جرة («100-2»). */
export function cylinderLabel(citizenNumber: string, quantity: number, seq: number) {
  return quantity === 1 && seq === 1 ? citizenNumber : `${citizenNumber}-${seq}`;
}

/** توحيد الرقم المكتوب على الجرة كما يدخله المستخدم: أرقام لاتينية، دون مسافات، وشرطة موحدة. */
const normalizeLabel = (s: string) => normalizeDigits(cleanText(s)).replace(/\s/g, "").replace(/[\u2010-\u2015_]/g, "-");

const opKey = z.string().trim().min(8, "معرّف العملية مطلوب").max(100);
const identity = {
  nationalId: z.string().trim().min(1, "أدخل رقم الهوية من البطاقة"),
  identityMethod: z.enum(["MANUAL_ENTRY", "ID_SCAN"]).default("MANUAL_ENTRY"),
};

async function lockRow(tx: Tx, table: "cylinders" | "entitlements", id: string) {
  const q = table === "cylinders"
    ? tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "cylinders" WHERE "id" = ${id}::uuid FOR UPDATE`
    : tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "entitlements" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (!(await q).length) throw notFound(table === "cylinders" ? "الجرة" : "الاستحقاق");
}

class IdentityMismatch extends AppError {
  constructor(readonly entered: string, readonly expected: { citizenName: string; citizenNationalId: string; label?: string }) {
    super("IDENTITY_MISMATCH", "رقم الهوية المدخل لا يطابق صاحب الاستحقاق. أُوقفت العملية وسُجلت حالة للمراجعة");
  }
}

/** التحقق من الهوية: رقم البطاقة المدخل يجب أن يطابق رقم صاحب الاستحقاق. لا يوجد تجاوز يدوي. */
function verifyIdentity(entered: string, citizen: { nationalId: string; fullName: string }, label?: string) {
  const id = digitsOnly(entered);
  if (!isValidNationalId(id)) throw new AppError("VALIDATION", "رقم الهوية المدخل غير صالح", { nationalId: "رقم الهوية غير صالح" });
  if (id !== citizen.nationalId) throw new IdentityMismatch(id, { citizenName: citizen.fullName, citizenNationalId: citizen.nationalId, label });
}

/** تُسجل حالة المراجعة في معاملة مستقلة لأن معاملة العملية تُلغى. */
async function recordIdentityCase(actor: DistributorActor, e: IdentityMismatch, op: string) {
  await withTenant(actor.distributorId, async (tx) => {
    const c = await tx.reviewCase.create({
      data: {
        distributorId: actor.distributorId,
        type: "IDENTITY_MISMATCH",
        nationalId: e.entered,
        fullName: null,
        details: `تعذر التحقق من الهوية عند ${op}: الرقم المدخل لا يطابق صاحب الاستحقاق ${e.expected.citizenName}${e.expected.label ? ` (الجرة ${isolate(e.expected.label)})` : ""}`,
        createdById: actor.userId,
      },
    });
    await audit(tx, actor, { action: "operation.identity_mismatch", entityType: "review_case", entityId: c.id, distributorId: actor.distributorId, after: { op, entered: e.entered } });
  });
}

/**
 * تنفيذ عملية بمعرّف منع التكرار: إن وُجدت عملية بالمعرّف نفسه تُرجع نتيجتها دون تنفيذ جديد،
 * حتى لو وصل الطلبان في اللحظة نفسها (القيد الفريد يحسم السباق).
 */
async function idempotent<T>(
  actor: DistributorActor,
  key: string,
  type: OperationType,
  run: () => Promise<T>,
  replay: (op: CylinderOperation & { cylinder: Cylinder }) => T,
): Promise<T> {
  const find = () => withTenant(actor.distributorId, (tx) => tx.cylinderOperation.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: key } }, include: { cylinder: true } }));
  const check = (op: (CylinderOperation & { cylinder: Cylinder }) | null) => {
    if (!op) return null;
    if (op.type !== type) throw new AppError("CONFLICT", "معرّف العملية مستخدم لعملية أخرى");
    return replay(op);
  };
  const existing = check(await find());
  if (existing !== null) return existing;
  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = check(await find());
      if (again !== null) return again;
      throw new AppError("CONFLICT", "تعارض: نُفذت عملية مماثلة على هذه الجرة للتو. حدّث الصفحة");
    }
    throw e;
  }
}

const result = (op: CylinderOperation & { cylinder: Cylinder }, replayed: boolean) => ({
  replayed,
  operationId: op.id,
  cylinder: { id: op.cylinder.id, label: op.cylinder.label, status: op.cylinder.status },
});

/**
 * إعادة فحص معرّف العملية بعد الحصول على القفل: طلب مكرر وصل متزامنًا ينتظر القفل،
 * ثم يجد العملية الأولى قد نُفذت فيرجع نتيجتها بدل الخطأ.
 */
async function replayAfterLock(tx: Tx, actor: DistributorActor, key: string, type: OperationType) {
  const op = await tx.cylinderOperation.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: key } }, include: { cylinder: true } });
  if (!op) return null;
  if (op.type !== type) throw new AppError("CONFLICT", "معرّف العملية مستخدم لعملية أخرى");
  return result(op, true);
}


// ---------------------------------------------------------------------------
// استلام الجرة الفارغة
// ---------------------------------------------------------------------------

const receiveSchema = z.object({ clientOpId: opKey, entitlementId: z.string().uuid(), ...identity });

/**
 * استلام جرة فارغة: تحقق الهوية، استحقاق قائم في كشف معتمد، الدورة نشطة، وجرة غير مستلمة بعد.
 * لا يتطلب دفعًا. يزيد مخزون الفارغ.
 */
export async function receiveEmpty(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = receiveSchema.parse(input);
  return idempotent(actor, v.clientOpId, "RECEIVE_EMPTY", async () => {
    try {
      return await withTenant(actor.distributorId, async (tx) => {
        await lockRow(tx, "entitlements", v.entitlementId);
        const replay = await replayAfterLock(tx, actor, v.clientOpId, "RECEIVE_EMPTY");
        if (replay) return replay;
        const e = await tx.entitlement.findUniqueOrThrow({
          where: { id: v.entitlementId },
          include: { citizen: true, cycle: true, statement: { select: { status: true } }, cylinders: { where: { status: { not: "VOID" } } } },
        });
        verifyIdentity(v.nationalId, e.citizen);
        if (e.status !== "ACTIVE") throw new AppError("INVALID_STATE", "هذا الاستحقاق أُزيل من الكشف المعتمد");
        if (e.statement.status !== "APPROVED") throw new AppError("INVALID_STATE", "الكشف غير معتمد");
        if (e.cycle.status !== "OPEN") throw new AppError("INVALID_STATE", "الدورة مغلقة؛ لا يمكن استلام جرار جديدة فيها");
        if (e.cylinders.length >= e.quantity) throw new AppError("INVALID_STATE", "استُلمت كل جرار هذا الاستحقاق سابقًا");
        const used = new Set(e.cylinders.map((c) => c.seq));
        let seq = 1;
        while (used.has(seq)) seq++;
        const cylinder = await tx.cylinder.create({
          data: { distributorId: actor.distributorId, cycleId: e.cycleId, entitlementId: e.id, seq, label: cylinderLabel(e.citizenNumber, e.quantity, seq), status: "EMPTY" },
        });
        const op = await tx.cylinderOperation.create({
          data: { distributorId: actor.distributorId, cylinderId: cylinder.id, type: "RECEIVE_EMPTY", idempotencyKey: v.clientOpId, identityMethod: v.identityMethod, userId: actor.userId },
        });
        await recordMovement(tx, actor, { type: "RECEIVE_EMPTY", delta: { empty: 1 }, operationId: op.id });
        return result({ ...op, cylinder }, false);
      });
    } catch (err) {
      if (err instanceof IdentityMismatch) await recordIdentityCase(actor, err, "استلام جرة فارغة");
      throw err;
    }
  }, (op) => result(op, true));
}

// ---------------------------------------------------------------------------
// التعبئة (فردية أو جماعية)
// ---------------------------------------------------------------------------

const fillSchema = z.object({
  items: z.array(z.object({ clientOpId: opKey, cylinderId: z.string().uuid() })).min(1, "اختر جرة واحدة على الأقل").max(1000),
});

/** تعبئة جرة داخل معاملة قائمة (تستخدمها التعبئة الجماعية واستلام الشحنات). */
export async function fillInTx(tx: Tx, actor: DistributorActor, item: { clientOpId: string; cylinderId: string }, shipmentId: string | null) {
  // القفل أولًا ثم فحص المعرّف، حتى يرجع الطلب المكرر المتزامن نتيجة الأول لا خطأ.
  await lockRow(tx, "cylinders", item.cylinderId);
  const prior = await tx.cylinderOperation.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: item.clientOpId } } });
  if (prior) {
    if (prior.type !== "FILL" || prior.cylinderId !== item.cylinderId) throw new AppError("CONFLICT", "معرّف العملية مستخدم لعملية أخرى");
    return { replayed: true, operationId: prior.id };
  }
  const c = await tx.cylinder.findUniqueOrThrow({ where: { id: item.cylinderId } });
  if (c.status === "FILLED") throw new AppError("INVALID_STATE", `الجرة ${isolate(c.label)} معبأة سابقًا`);
  if (c.status === "DELIVERED") throw new AppError("INVALID_STATE", `الجرة ${isolate(c.label)} سُلّمت سابقًا`);
  if (c.status !== "EMPTY") throw new AppError("INVALID_STATE", `الجرة ${isolate(c.label)} لم تُسجل فارغة`);
  const op = await tx.cylinderOperation.create({
    data: { distributorId: actor.distributorId, cylinderId: c.id, type: "FILL", idempotencyKey: item.clientOpId, shipmentId, userId: actor.userId },
  });
  await tx.cylinder.update({ where: { id: c.id }, data: { status: "FILLED" } });
  await recordMovement(tx, actor, { type: "FILL", delta: { empty: -1, filled: 1 }, operationId: op.id, shipmentId });
  return { replayed: false, operationId: op.id };
}

/** تعبئة جماعية: كلها أو لا شيء. العناصر المنفذة سابقًا بالمعرّف نفسه تُتجاوز. */
export async function fillCylinders(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = fillSchema.parse(input);
  if (new Set(v.items.map((i) => i.cylinderId)).size !== v.items.length) throw new AppError("VALIDATION", "جرة مكررة في الطلب");
  try {
    return await withTenant(actor.distributorId, async (tx) => {
      const out = [];
      for (const item of v.items) out.push(await fillInTx(tx, actor, item, null));
      return { filled: out.filter((o) => !o.replayed).length, replayed: out.filter((o) => o.replayed).length };
    }, { timeout: 60_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("CONFLICT", "تعارض: عُبئت إحدى الجرار للتو من جهاز آخر. حدّث الصفحة وأعد المحاولة");
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// التسليم
// ---------------------------------------------------------------------------

const deliverSchema = z.object({
  clientOpId: opKey,
  cylinderId: z.string().uuid(),
  cylinderLabel: z.string().trim().min(1, "أدخل الرقم المكتوب على الجرة"),
  ...identity,
});

/**
 * التسليم: تحقق الهوية، ومطابقة الرقم المكتوب على الجرة، وجاهزيتها، وعدم تسليمها سابقًا.
 * لا يرتبط بالدفع. ينقص مخزون المعبأ.
 */
export async function deliverCylinder(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = deliverSchema.parse(input);
  return idempotent(actor, v.clientOpId, "DELIVER", async () => {
    try {
      return await withTenant(actor.distributorId, async (tx) => {
        await lockRow(tx, "cylinders", v.cylinderId);
        const replay = await replayAfterLock(tx, actor, v.clientOpId, "DELIVER");
        if (replay) return replay;
        const c = await tx.cylinder.findUniqueOrThrow({ where: { id: v.cylinderId }, include: { entitlement: { include: { citizen: true, statement: { select: { status: true } } } } } });
        verifyIdentity(v.nationalId, c.entitlement.citizen, c.label);
        if (normalizeLabel(v.cylinderLabel) !== c.label) {
          throw new AppError("VALIDATION", `الرقم المكتوب على الجرة لا يطابق رقمها في النظام (${isolate(c.label)})`, { cylinderLabel: "الرقم لا يطابق" });
        }
        if (!["APPROVED", "SUPERSEDED"].includes(c.entitlement.statement.status)) throw new AppError("INVALID_STATE", "الكشف غير معتمد");
        if (c.status === "DELIVERED") throw new AppError("INVALID_STATE", "سُلّمت هذه الجرة سابقًا");
        if (c.status !== "FILLED") throw new AppError("INVALID_STATE", "الجرة غير جاهزة للتسليم (لم تُعبأ بعد)");
        const op = await tx.cylinderOperation.create({
          data: { distributorId: actor.distributorId, cylinderId: c.id, type: "DELIVER", idempotencyKey: v.clientOpId, identityMethod: v.identityMethod, userId: actor.userId },
        });
        const updated = await tx.cylinder.update({ where: { id: c.id }, data: { status: "DELIVERED" } });
        await recordMovement(tx, actor, { type: "DELIVER", delta: { filled: -1 }, operationId: op.id });
        return result({ ...op, cylinder: updated }, false);
      });
    } catch (err) {
      if (err instanceof IdentityMismatch) await recordIdentityCase(actor, err, "تسليم جرة");
      throw err;
    }
  }, (op) => result(op, true));
}

// ---------------------------------------------------------------------------
// الإلغاء
// ---------------------------------------------------------------------------

const ORDER: OperationType[] = ["RECEIVE_EMPTY", "FILL", "DELIVER"];
const REVERT: Record<OperationType, "VOID" | "EMPTY" | "FILLED"> = { RECEIVE_EMPTY: "VOID", FILL: "EMPTY", DELIVER: "FILLED" };

/** إلغاء عملية داخل معاملة قائمة (يستخدمه إلغاء الشحنة أيضًا). */
export async function cancelOperationInTx(tx: Tx, actor: DistributorActor, operationId: string, reason: string, opts: { viaShipment?: boolean } = {}) {
  const op0 = await tx.cylinderOperation.findUnique({ where: { id: operationId } });
  if (!op0) throw notFound("العملية");
  await lockRow(tx, "cylinders", op0.cylinderId);
  const op = await tx.cylinderOperation.findUniqueOrThrow({ where: { id: operationId }, include: { cylinder: true } });
  if (op.status !== "ACTIVE") throw new AppError("INVALID_STATE", "أُلغيت هذه العملية سابقًا");
  if (op.shipmentId && !opts.viaShipment) throw new AppError("INVALID_STATE", "هذه التعبئة جزء من شحنة؛ ألغِ الشحنة بدلًا منها");
  // العمليات التابعة: لا يُلغى استلام جرة عُبئت، ولا تعبئة جرة سُلّمت.
  const later = await tx.cylinderOperation.findFirst({ where: { cylinderId: op.cylinderId, status: "ACTIVE", type: { in: ORDER.slice(ORDER.indexOf(op.type) + 1) } } });
  if (later) {
    throw new AppError("INVALID_STATE", later.type === "DELIVER" ? `الجرة ${isolate(op.cylinder.label)} سُلّمت؛ ألغِ التسليم أولًا` : `الجرة ${isolate(op.cylinder.label)} عُبئت؛ ألغِ التعبئة أولًا`);
  }
  const now = new Date();
  const res = await tx.cylinderOperation.updateMany({ where: { id: op.id, status: "ACTIVE" }, data: { status: "CANCELLED", cancelledAt: now, cancelledById: actor.userId, cancelReason: reason } });
  if (res.count !== 1) throw new AppError("INVALID_STATE", "أُلغيت هذه العملية سابقًا");
  await tx.cylinder.update({ where: { id: op.cylinderId }, data: { status: REVERT[op.type] } });
  const mv = await tx.inventoryMovement.findFirst({ where: { operationId: op.id, type: { not: "REVERSAL" } } });
  if (!mv) throw new AppError("INVALID_STATE", "لا توجد حركة مخزون لهذه العملية");
  await reverseMovement(tx, actor, mv.id, `إلغاء: ${reason}`);
  await audit(tx, actor, {
    action: "operation.cancel", entityType: "cylinder_operation", entityId: op.id, distributorId: actor.distributorId,
    before: { type: op.type, status: "ACTIVE", cylinder: op.cylinder.label, cylinderStatus: op.cylinder.status },
    after: { status: "CANCELLED", cylinderStatus: REVERT[op.type] }, reason,
  });
}

export async function cancelOperation(actor: Actor, operationId: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = z.object({ reason: z.string().trim().min(3, "يرجى كتابة سبب الإلغاء").max(500) }).parse(input);
  return withTenant(actor.distributorId, (tx) => cancelOperationInTx(tx, actor, operationId, reason));
}

// ---------------------------------------------------------------------------
// الشباك: البحث برقم الهوية
// ---------------------------------------------------------------------------

/**
 * شاشة الشباك: رقم الهوية من البطاقة → استحقاقات المواطن القابلة للعمل:
 * الدورة النشطة، وأي دورة سابقة لها جرار لم تُسلّم بعد.
 */
export async function counterLookup(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const { nationalId } = z.object({ nationalId: z.string().trim().min(1, "أدخل رقم الهوية") }).parse(input);
  const id = digitsOnly(nationalId);
  if (!isValidNationalId(id)) throw new AppError("VALIDATION", "رقم الهوية غير صالح (رقم التحقق لا يطابق)", { nationalId: "رقم الهوية غير صالح" });
  return withTenant(actor.distributorId, async (tx) => {
    let citizen = await tx.citizen.findUnique({ where: { distributorId_nationalId: { distributorId: actor.distributorId, nationalId: id } } });
    if (citizen?.mergedIntoId) citizen = await tx.citizen.findUnique({ where: { id: citizen.mergedIntoId } });
    if (!citizen) return { found: false as const, nationalId: id };
    const ents = await tx.entitlement.findMany({
      where: { citizenId: citizen.id },
      include: {
        cycle: { select: { id: true, name: true, status: true } },
        statement: { select: { status: true, title: true } },
        cylinders: { where: { status: { not: "VOID" } }, orderBy: { seq: "asc" } },
      },
      orderBy: { cycle: { number: "desc" } },
    });
    const billable = new Set((await tx.entitlement.findMany({ where: { citizenId: citizen.id, ...billableWhere }, select: { id: true } })).map((e) => e.id));
    const paid = await paidByEntitlement(tx, ents.map((e) => e.id));
    const balance = (e: (typeof ents)[number]) => {
      const p = paid.get(e.id) ?? new Prisma.Decimal(0);
      return { paid: p, remaining: billable.has(e.id) ? e.amountDue.sub(p) : new Prisma.Decimal(0) };
    };
    // تُعرض: الدورة النشطة، وأي استحقاق له جرار معلقة، وأي استحقاق عليه مبلغ متبقٍ.
    const relevant = ents.filter((e) => e.cycle.status === "OPEN" || e.cylinders.some((c) => c.status === "EMPTY" || c.status === "FILLED") || balance(e).remaining.gt(0));
    return {
      found: true as const,
      nationalId: id,
      citizen: { id: citizen.id, fullName: citizen.fullName, phone: citizen.phone },
      totalRemaining: relevant.reduce((a, e) => a.add(balance(e).remaining), new Prisma.Decimal(0)),
      entitlements: relevant.map((e) => ({
        id: e.id,
        cycle: e.cycle,
        status: e.status,
        citizenNumber: e.citizenNumber,
        quantity: e.quantity,
        amountDue: e.amountDue,
        cylinders: e.cylinders.map((c) => ({ id: c.id, label: c.label, status: c.status })),
        remaining: Math.max(0, e.quantity - e.cylinders.length),
        canReceive: e.status === "ACTIVE" && e.cycle.status === "OPEN" && e.cylinders.length < e.quantity,
        paid: balance(e).paid,
        amountRemaining: balance(e).remaining,
        canPay: billable.has(e.id) && balance(e).remaining.gt(0),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// قوائم الجرار
// ---------------------------------------------------------------------------

const listSchema = z.object({
  status: z.enum(["EMPTY", "FILLED", "DELIVERED", "VOID"]).optional(),
  cycleId: z.string().uuid().optional(),
  q: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(500).default(100),
});

export async function listCylinders(actor: Actor, filters: unknown) {
  assertDistributor(actor);
  const f = listSchema.parse(filters ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    const where: Prisma.CylinderWhereInput = { status: f.status ?? { not: "VOID" }, cycleId: f.cycleId };
    if (f.q) where.OR = [{ label: { startsWith: f.q } }, { entitlement: { nameInStatement: { contains: f.q, mode: "insensitive" } } }, { entitlement: { citizen: { nationalId: { startsWith: f.q } } } }];
    const [rows, total] = await Promise.all([
      tx.cylinder.findMany({
        where,
        include: {
          entitlement: { select: { citizenNumber: true, nameInStatement: true, status: true, citizen: { select: { id: true, nationalId: true } }, cycle: { select: { name: true, status: true } } } },
          operations: { where: { status: "ACTIVE" }, orderBy: { at: "desc" }, take: 1 },
        },
        orderBy: [{ updatedAt: "desc" }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      tx.cylinder.count({ where }),
    ]);
    return { rows, total, page: f.page, pageSize: f.pageSize };
  });
}

export async function getCylinder(actor: Actor, cylinderId: string) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const c = await tx.cylinder.findUnique({
      where: { id: cylinderId },
      include: {
        entitlement: { include: { citizen: { select: { id: true, fullName: true, nationalId: true } }, cycle: { select: { id: true, name: true, status: true } } } },
        operations: { orderBy: { at: "asc" }, include: { shipment: { select: { id: true, reference: true, station: { select: { name: true } } } } } },
      },
    });
    if (!c) throw notFound("الجرة");
    const ids = [...new Set(c.operations.flatMap((o) => [o.userId, o.cancelledById].filter((x): x is string => !!x)))];
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    const names = Object.fromEntries(users.map((u) => [u.id, u.displayName]));
    return { ...c, userNames: names };
  });
}

/** عدد الجرار الفعلية (غير الملغاة) لكل استحقاق: يُستخدم للتحقق من أثر تعديل الكشف. */
export async function cylinderCounts(tx: Tx, entitlementIds: string[]) {
  if (!entitlementIds.length) return new Map<string, number>();
  const g = await tx.cylinder.groupBy({ by: ["entitlementId"], where: { entitlementId: { in: entitlementIds }, status: { not: "VOID" } }, _count: { _all: true } });
  return new Map(g.map((x) => [x.entitlementId, x._count._all]));
}
