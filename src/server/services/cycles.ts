import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Tx } from "../db";
import { withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, type DistributorActor, assertDistributor } from "../actor";
import { audit } from "../audit";
import { getSettings } from "./settings";

const priceSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/[٫,]/g, "."))
  .refine((v) => /^\d{1,8}(\.\d{1,2})?$/.test(v), "سعر غير صالح (رقم موجب بحد أقصى منزلتين عشريتين)");

const createSchema = z.object({ name: z.string().trim().max(100).optional(), unitPrice: priceSchema });
const reasonSchema = z.object({ reason: z.string().trim().min(3, "يرجى كتابة السبب").max(500) });

function log(tx: Tx, actor: DistributorActor, action: string, cycleId: string, after?: unknown, before?: unknown, reason?: string) {
  return audit(tx, actor, { action: `cycle.${action}`, entityType: "cycle", entityId: cycleId, distributorId: actor.distributorId, after, before, reason });
}

export async function listCycles(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const cycles = await tx.cycle.findMany({ orderBy: { number: "desc" } });
    const counts = await tx.entitlement.groupBy({
      by: ["cycleId"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
      _sum: { quantity: true, amountDue: true },
    });
    const paid = await tx.payment.groupBy({ by: ["cycleId"], where: { status: "ACTIVE" }, _sum: { amount: true } });
    const sts = await tx.statement.groupBy({ by: ["cycleId", "status"], where: { cycleId: { not: null } }, _count: { _all: true } });
    const byCycle = new Map(counts.map((c) => [c.cycleId, c]));
    const paidBy = new Map(paid.map((p) => [p.cycleId, p._sum.amount]));
    const stCount = (id: string, status: string) => sts.find((x) => x.cycleId === id && x.status === status)?._count._all ?? 0;
    return cycles.map((c) => {
      const s = byCycle.get(c.id);
      return {
        ...c,
        citizens: s?._count._all ?? 0,
        cylinders: s?._sum.quantity ?? 0,
        amountDue: s?._sum.amountDue ?? new Prisma.Decimal(0),
        collected: paidBy.get(c.id) ?? new Prisma.Decimal(0),
        approvedStatements: stCount(c.id, "APPROVED"),
        pendingStatements: stCount(c.id, "PENDING_REVIEW"),
      };
    });
  });
}

export function getActiveCycle(tx: Tx) {
  return tx.cycle.findFirst({ where: { status: "OPEN" } });
}

export async function getCycleSummary(actor: Actor, cycleId: string) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const cycle = await tx.cycle.findUnique({ where: { id: cycleId }, include: { events: { orderBy: { at: "desc" } } } });
    if (!cycle) throw notFound("الدورة");
    const [agg, removed, statements] = await Promise.all([
      tx.entitlement.aggregate({ where: { cycleId, status: "ACTIVE" }, _count: { _all: true }, _sum: { quantity: true, amountDue: true } }),
      tx.entitlement.count({ where: { cycleId, status: "REMOVED" } }),
      tx.statement.findMany({ where: { cycleId }, orderBy: { importedAt: "desc" }, select: { id: true, title: true, status: true, version: true, importedAt: true, approvedAt: true } }),
    ]);
    const states = await tx.cylinder.groupBy({ by: ["status"], where: { cycleId, status: { not: "VOID" } }, _count: { _all: true } });
    const collected = await tx.payment.aggregate({ where: { cycleId, status: "ACTIVE" }, _sum: { amount: true } });
    const n = (s: string) => states.find((x) => x.status === s)?._count._all ?? 0;
    const userIds = [...new Set(cycle.events.map((e) => e.userId))];
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return {
      cycle,
      events: cycle.events.map((e) => ({ ...e, userName: names.get(e.userId) ?? "—" })),
      citizens: agg._count._all,
      cylinders: agg._sum.quantity ?? 0,
      amountDue: agg._sum.amountDue ?? new Prisma.Decimal(0),
      removedEntitlements: removed,
      statements,
      pendingStatements: statements.filter((s) => s.status === "PENDING_REVIEW").length,
      cylinderStates: { empty: n("EMPTY"), filled: n("FILLED"), delivered: n("DELIVERED") },
      collected: collected._sum.amount ?? new Prisma.Decimal(0),
    };
  });
}

/** دورة جديدة: لا تُفتح ما دامت هناك دورة نشطة. */
export async function createCycle(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = createSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    if (await getActiveCycle(tx)) throw new AppError("INVALID_STATE", "توجد دورة نشطة. أغلقها قبل بدء دورة جديدة");
    const last = await tx.cycle.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
    const number = (last?.number ?? 0) + 1;
    const settings = await getSettings(tx);
    const cycle = await tx.cycle.create({
      data: {
        distributorId: actor.distributorId,
        number,
        name: v.name || `الدورة ${number}`,
        unitPrice: new Prisma.Decimal(v.unitPrice),
        currencyCode: settings.currencyCode,
        openedById: actor.userId,
      },
    });
    await tx.cycleEvent.create({ data: { distributorId: actor.distributorId, cycleId: cycle.id, type: "OPENED", userId: actor.userId } });
    await log(tx, actor, "open", cycle.id, cycle);
    return cycle;
  }).catch(uniqueToConflict);
}

/** إغلاق الدورة: لا يصفّر الأرصدة ولا يعني سدادها. يُمنع ما دامت فيها كشوف قيد المراجعة. */
export async function closeCycle(actor: Actor, cycleId: string, input: unknown) {
  assertDistributor(actor);
  const { confirm } = z.object({ confirm: z.literal(true, { errorMap: () => ({ message: "يجب تأكيد مراجعة ملخص الدورة" }) }) }).parse(input);
  void confirm;
  return withTenant(actor.distributorId, async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.status !== "OPEN") throw new AppError("INVALID_STATE", "الدورة مغلقة بالفعل");
    const pending = await tx.statement.count({ where: { cycleId, status: "PENDING_REVIEW" } });
    if (pending) throw new AppError("INVALID_STATE", `في الدورة ${pending} كشف بانتظار الاعتماد. اعتمده أو ألغه قبل الإغلاق`);
    const now = new Date();
    const after = await tx.cycle.update({ where: { id: cycleId }, data: { status: "CLOSED", closedAt: now, closedById: actor.userId } });
    await tx.cycleEvent.create({ data: { distributorId: actor.distributorId, cycleId, type: "CLOSED", userId: actor.userId } });
    await log(tx, actor, "close", cycleId, { status: "CLOSED" }, { status: "OPEN" });
    return after;
  });
}

/** إعادة فتح دورة مغلقة بسبب مكتوب؛ تصبح الدورة النشطة الوحيدة. */
export async function reopenCycle(actor: Actor, cycleId: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = reasonSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.status !== "CLOSED") throw new AppError("INVALID_STATE", "الدورة مفتوحة بالفعل");
    const active = await getActiveCycle(tx);
    if (active) throw new AppError("INVALID_STATE", `الدورة «${active.name}» نشطة. أغلقها قبل إعادة فتح دورة أخرى`);
    const after = await tx.cycle.update({ where: { id: cycleId }, data: { status: "OPEN", closedAt: null, closedById: null } });
    await tx.cycleEvent.create({ data: { distributorId: actor.distributorId, cycleId, type: "REOPENED", reason, userId: actor.userId } });
    await log(tx, actor, "reopen", cycleId, { status: "OPEN" }, { status: "CLOSED", closedAt: cycle.closedAt }, reason);
    return after;
  }).catch(uniqueToConflict);
}

/**
 * تعديل سعر الدورة النشطة. لا يغيّر مبالغ الاستحقاقات المعتمدة سابقًا (محفوظة وقت الاعتماد)،
 * ويسري على الكشوف التي تُعتمد بعده.
 */
export async function changeCyclePrice(actor: Actor, cycleId: string, input: unknown) {
  assertDistributor(actor);
  const v = z.object({ unitPrice: priceSchema }).merge(reasonSchema).parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.status !== "OPEN") throw new AppError("INVALID_STATE", "لا يمكن تعديل سعر دورة مغلقة");
    const after = await tx.cycle.update({ where: { id: cycleId }, data: { unitPrice: new Prisma.Decimal(v.unitPrice) } });
    const details = { from: cycle.unitPrice.toString(), to: v.unitPrice };
    await tx.cycleEvent.create({ data: { distributorId: actor.distributorId, cycleId, type: "PRICE_CHANGED", reason: v.reason, details, userId: actor.userId } });
    await log(tx, actor, "price_change", cycleId, { unitPrice: v.unitPrice }, { unitPrice: cycle.unitPrice }, v.reason);
    return after;
  });
}

const nextSchema = z.object({
  name: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  unitPrice: priceSchema.optional().or(z.literal("").transform(() => undefined)),
});

/**
 * «ابدأ دورة جديدة» بخطوة واحدة: تُغلق الدورة الحالية (إن وُجدت) وتُفتح التالية.
 * إغلاق الدورة لا يمسّ ناسها ولا فلوسها: يبقى التسليم والقبض لكشوفها كما هو.
 * يُمنع ما دام في الدورة الحالية كشف بانتظار الاعتماد.
 */
export async function startNextCycle(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = nextSchema.parse(input ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    const active = await getActiveCycle(tx);
    let closed: { id: string; name: string } | null = null;
    if (active) {
      const cycle = await lockCycle(tx, active.id);
      const pending = await tx.statement.count({ where: { cycleId: cycle.id, status: "PENDING_REVIEW" } });
      if (pending) throw new AppError("INVALID_STATE", `في «${cycle.name}» ${pending} كشف بانتظار الاعتماد. اعتمده أو احذفه أولًا`);
      await tx.cycle.update({ where: { id: cycle.id }, data: { status: "CLOSED", closedAt: new Date(), closedById: actor.userId } });
      await tx.cycleEvent.create({ data: { distributorId: actor.distributorId, cycleId: cycle.id, type: "CLOSED", userId: actor.userId } });
      await log(tx, actor, "close", cycle.id, { status: "CLOSED" }, { status: "OPEN" });
      closed = { id: cycle.id, name: cycle.name };
    }
    const last = await tx.cycle.findFirst({ orderBy: { number: "desc" }, select: { number: true, unitPrice: true } });
    // سعر الدورة احتياطي فقط (لكل كشف سعره): المُرسل، وإلا آخر سعر كشف، وإلا سعر الدورة السابقة.
    const lastSt = v.unitPrice ? null : await tx.statement.findFirst({ where: { unitPrice: { not: null } }, orderBy: { importedAt: "desc" }, select: { unitPrice: true } });
    const number = (last?.number ?? 0) + 1;
    const settings = await getSettings(tx);
    const cycle = await tx.cycle.create({
      data: {
        distributorId: actor.distributorId,
        number,
        name: v.name || `الدورة ${number}`,
        unitPrice: v.unitPrice ? new Prisma.Decimal(v.unitPrice) : lastSt?.unitPrice ?? last?.unitPrice ?? new Prisma.Decimal(0),
        currencyCode: settings.currencyCode,
        openedById: actor.userId,
      },
    });
    await tx.cycleEvent.create({ data: { distributorId: actor.distributorId, cycleId: cycle.id, type: "OPENED", userId: actor.userId } });
    await log(tx, actor, "open", cycle.id, cycle);
    return { cycle, closed };
  }).catch(uniqueToConflict);
}

/** تغيير اسم الدورة (مفتوحة أو مغلقة). */
export async function renameCycle(actor: Actor, cycleId: string, input: unknown) {
  assertDistributor(actor);
  const { name } = z.object({ name: z.string().trim().min(1, "اكتب اسم الدورة").max(100) }).parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.name === name) return cycle;
    const after = await tx.cycle.update({ where: { id: cycleId }, data: { name } });
    await log(tx, actor, "rename", cycleId, { name }, { name: cycle.name });
    return after;
  });
}

/** قفل صف الدورة داخل المعاملة لمنع تزامن الإغلاق/إعادة الفتح/الاعتماد. */
export async function lockCycle(tx: Tx, cycleId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "cycles" WHERE "id" = ${cycleId}::uuid FOR UPDATE`;
  if (!rows.length) throw notFound("الدورة");
  return tx.cycle.findUniqueOrThrow({ where: { id: cycleId } });
}

/** تعارض القيد الفريد للدورة النشطة (طلبان متزامنان) يتحول إلى رسالة واضحة. */
function uniqueToConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new AppError("CONFLICT", "توجد دورة نشطة بالفعل");
  }
  throw e;
}
