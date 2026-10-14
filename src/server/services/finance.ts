import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Tx } from "../db";
import { withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, type DistributorActor, assertDistributor } from "../actor";
import { audit } from "../audit";
import { formatMoney } from "@/lib/format";
import { getSettings } from "./settings";

// ---------------------------------------------------------------------------
// أدوات مشتركة
// ---------------------------------------------------------------------------

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

/** مبلغ موجب بحد أقصى منزلتين عشريتين، كنص عشري (لا أعداد عائمة في المال). */
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/[٫,]/g, ".").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)))
  .refine((v) => /^\d{1,9}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "مبلغ غير صالح (رقم موجب بحد أقصى منزلتين عشريتين)");

const opKey = z.string().trim().min(8, "معرّف العملية مطلوب").max(100);
const reasonSchema = z.object({ reason: z.string().trim().min(3, "يرجى كتابة سبب الإلغاء").max(500) });

/** تاريخ اختياري للعملية المالية: الآن إن غاب، ولا يُقبل تاريخ مستقبلي. */
const whenSchema = z
  .string()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return new Date();
    const d = new Date(v);
    if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 5 * 60_000) {
      ctx.addIssue({ code: "custom", message: "التاريخ غير صالح أو في المستقبل" });
      return z.NEVER;
    }
    return d;
  });

const rangeSchema = {
  from: z.string().optional().transform((v) => (v ? new Date(v) : undefined)),
  to: z.string().optional().transform((v) => (v ? new Date(`${v}T23:59:59.999`) : undefined)),
};

const isCheckViolation = (e: unknown, text: string) => String(e).includes(text);

/** إن وُجد سجل بالمعرّف نفسه يُرجع، وإلا يُنفذ. سباق المعرّف نفسه يحسمه القيد الفريد. */
async function idempotent<T>(find: () => Promise<T | null>, run: () => Promise<T>): Promise<T & { replayed: boolean }> {
  const prior = await find();
  if (prior) return { ...prior, replayed: true };
  try {
    return { ...(await run()), replayed: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await find();
      if (again) return { ...again, replayed: true };
    }
    throw e;
  }
}

/** المدفوع النافذ لكل استحقاق. */
export async function paidByEntitlement(tx: Tx, entitlementIds: string[]) {
  if (!entitlementIds.length) return new Map<string, Prisma.Decimal>();
  const g = await tx.payment.groupBy({ by: ["entitlementId"], where: { entitlementId: { in: entitlementIds }, status: "ACTIVE" }, _sum: { amount: true } });
  return new Map(g.map((x) => [x.entitlementId, x._sum.amount ?? ZERO]));
}

/**
 * الاستحقاق «قابل للتحصيل» إن كان قائمًا في الكشف، أو أُزيل لكن استُلمت له جرار
 * (الخدمة قُدّمت فعلًا).
 */
export const billableWhere: Prisma.EntitlementWhereInput = {
  OR: [{ status: "ACTIVE" }, { cylinders: { some: { status: { not: "VOID" } } } }],
};

function log(tx: Tx, actor: DistributorActor, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown, reason?: string) {
  return audit(tx, actor, { action, entityType, entityId, distributorId: actor.distributorId, after, before, reason });
}

// ---------------------------------------------------------------------------
// تحصيلات المواطنين
// ---------------------------------------------------------------------------

const paymentSchema = z
  .object({
    clientOpId: opKey,
    entitlementId: z.string().uuid(),
    // full: سداد كامل المتبقي؛ وإلا amount مبلغ جزئي.
    full: z.boolean().default(false),
    amount: moneySchema.optional(),
    paidAt: whenSchema,
    notes: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  })
  .refine((v) => v.full || v.amount, { message: "أدخل المبلغ أو اختر سداد كامل المتبقي", path: ["amount"] });

/**
 * تحصيل جزئي أو كامل على استحقاق دورة يحددها الموزّع. لا يرتبط بعمليات الجرار،
 * ولا يتجاوز المتبقي (يُتحقق في الكود وفي قاعدة البيانات).
 */
export async function recordPayment(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = paymentSchema.parse(input);
  const find = () =>
    withTenant(actor.distributorId, async (tx) => {
      const p = await tx.payment.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: v.clientOpId } } });
      if (!p) return null;
      if (p.entitlementId !== v.entitlementId) throw new AppError("CONFLICT", "معرّف العملية مستخدم لعملية أخرى");
      const paid = (await paidByEntitlement(tx, [p.entitlementId])).get(p.entitlementId) ?? ZERO;
      const e = await tx.entitlement.findUniqueOrThrow({ where: { id: p.entitlementId } });
      return { paymentId: p.id, amount: p.amount.toFixed(2), paid: paid.toFixed(2), remaining: e.amountDue.sub(paid).toFixed(2) };
    });
  return idempotent(find, async () => {
    try {
      return await withTenant(actor.distributorId, async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "entitlements" WHERE "id" = ${v.entitlementId}::uuid FOR UPDATE`;
        if (!locked.length) throw notFound("الاستحقاق");
        // طلب مكرر متزامن ينتظر القفل ثم يجد الأول قد نُفذ.
        const dup = await tx.payment.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: v.clientOpId } } });
        if (dup) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "x" });
        const e = await tx.entitlement.findFirst({ where: { id: v.entitlementId, ...billableWhere } });
        if (!e) throw new AppError("INVALID_STATE", "هذا الاستحقاق أُزيل من الكشف ولا يقبل التحصيل");
        const paid = (await paidByEntitlement(tx, [e.id])).get(e.id) ?? ZERO;
        const remaining = e.amountDue.sub(paid);
        if (remaining.lte(0)) throw new AppError("INVALID_STATE", "هذا الاستحقاق مسدد بالكامل");
        const amount = v.full ? remaining : D(v.amount!);
        if (amount.gt(remaining)) {
          throw new AppError("VALIDATION", `المبلغ يتجاوز المتبقي (${formatMoney(remaining)})`, { amount: "يتجاوز المتبقي" });
        }
        const p = await tx.payment.create({
          data: {
            distributorId: actor.distributorId, entitlementId: e.id, cycleId: e.cycleId, amount, currencyCode: e.currencyCode,
            paidAt: v.paidAt, notes: v.notes, idempotencyKey: v.clientOpId, userId: actor.userId,
          },
        });
        const newPaid = paid.add(amount);
        await log(tx, actor, "payment.create", "payment", p.id, { entitlementId: e.id, amount: amount.toFixed(2), paidBefore: paid.toFixed(2), remainingAfter: e.amountDue.sub(newPaid).toFixed(2) });
        return { paymentId: p.id, amount: amount.toFixed(2), paid: newPaid.toFixed(2), remaining: e.amountDue.sub(newPaid).toFixed(2) };
      });
    } catch (e) {
      if (isCheckViolation(e, "دفع زائد")) throw new AppError("VALIDATION", "المبلغ يتجاوز المتبقي", { amount: "يتجاوز المتبقي" });
      throw e;
    }
  });
}

export async function cancelPayment(actor: Actor, paymentId: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = reasonSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw notFound("التحصيل");
    const res = await tx.payment.updateMany({ where: { id: p.id, status: "ACTIVE" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
    if (res.count !== 1) throw new AppError("INVALID_STATE", "أُلغي هذا التحصيل سابقًا");
    await log(tx, actor, "payment.cancel", "payment", p.id, { status: "CANCELLED" }, { status: "ACTIVE", amount: p.amount.toFixed(2), entitlementId: p.entitlementId }, reason);
  });
}

const paymentFilters = z.object({
  ...rangeSchema,
  cycleId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listPayments(actor: Actor, filters: unknown) {
  assertDistributor(actor);
  const f = paymentFilters.parse(filters ?? {});
  const where: Prisma.PaymentWhereInput = { cycleId: f.cycleId, status: f.status, paidAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined };
  return withTenant(actor.distributorId, async (tx) => {
    const [rows, total, sum] = await Promise.all([
      tx.payment.findMany({
        where,
        include: { entitlement: { select: { citizenNumber: true, nameInStatement: true, citizen: { select: { id: true, nationalId: true } }, cycle: { select: { name: true } } } } },
        orderBy: { paidAt: "desc" },
        skip: (f.page - 1) * 50,
        take: 50,
      }),
      tx.payment.count({ where }),
      tx.payment.aggregate({ where: { ...where, status: "ACTIVE" }, _sum: { amount: true } }),
    ]);
    return { rows, total, page: f.page, pageSize: 50, totalAmount: sum._sum.amount ?? ZERO };
  });
}

// ---------------------------------------------------------------------------
// المصروفات
// ---------------------------------------------------------------------------

const expenseSchema = z.object({
  clientOpId: opKey,
  amount: moneySchema,
  spentAt: whenSchema,
  description: z.string().trim().min(2, "اكتب وصف المصروف").max(500),
});

export async function createExpense(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = expenseSchema.parse(input);
  const find = () =>
    withTenant(actor.distributorId, async (tx) => {
      const x = await tx.expense.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: v.clientOpId } } });
      return x ? { id: x.id } : null;
    });
  return idempotent(find, () =>
    withTenant(actor.distributorId, async (tx) => {
      const settings = await getSettings(tx);
      const x = await tx.expense.create({
        data: { distributorId: actor.distributorId, amount: D(v.amount), currencyCode: settings.currencyCode, spentAt: v.spentAt, description: v.description, idempotencyKey: v.clientOpId, userId: actor.userId },
      });
      await log(tx, actor, "expense.create", "expense", x.id, { amount: v.amount, description: v.description, spentAt: v.spentAt });
      return { id: x.id };
    }),
  );
}

export async function cancelExpense(actor: Actor, id: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = reasonSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const x = await tx.expense.findUnique({ where: { id } });
    if (!x) throw notFound("المصروف");
    const res = await tx.expense.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
    if (res.count !== 1) throw new AppError("INVALID_STATE", "أُلغي هذا المصروف سابقًا");
    await log(tx, actor, "expense.cancel", "expense", id, { status: "CANCELLED" }, { status: "ACTIVE", amount: x.amount.toFixed(2), description: x.description }, reason);
  });
}

export async function listExpenses(actor: Actor, filters: unknown) {
  assertDistributor(actor);
  const f = z.object({ ...rangeSchema, page: z.coerce.number().int().min(1).default(1) }).parse(filters ?? {});
  const where: Prisma.ExpenseWhereInput = { spentAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined };
  return withTenant(actor.distributorId, async (tx) => {
    const [rows, total, sum] = await Promise.all([
      tx.expense.findMany({ where, orderBy: { spentAt: "desc" }, skip: (f.page - 1) * 50, take: 50 }),
      tx.expense.count({ where }),
      tx.expense.aggregate({ where: { ...where, status: "ACTIVE" }, _sum: { amount: true } }),
    ]);
    return { rows, total, page: f.page, pageSize: 50, totalAmount: sum._sum.amount ?? ZERO };
  });
}

// ---------------------------------------------------------------------------
// حسابات المحطات
// ---------------------------------------------------------------------------

const stationPaymentSchema = z.object({
  clientOpId: opKey,
  stationId: z.string().uuid(),
  amount: moneySchema,
  paidAt: whenSchema,
  reference: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  notes: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
});

/** دفعة للمحطة: سجل مستقل عن استلام الشحنات. يجوز الدفع المقدم (رصيد دائن للموزّع). */
export async function createStationPayment(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = stationPaymentSchema.parse(input);
  const find = () =>
    withTenant(actor.distributorId, async (tx) => {
      const x = await tx.stationPayment.findUnique({ where: { distributorId_idempotencyKey: { distributorId: actor.distributorId, idempotencyKey: v.clientOpId } } });
      if (x && x.stationId !== v.stationId) throw new AppError("CONFLICT", "معرّف العملية مستخدم لعملية أخرى");
      return x ? { id: x.id } : null;
    });
  return idempotent(find, () =>
    withTenant(actor.distributorId, async (tx) => {
      const station = await tx.station.findUnique({ where: { id: v.stationId } });
      if (!station) throw notFound("المحطة");
      const settings = await getSettings(tx);
      const x = await tx.stationPayment.create({
        data: {
          distributorId: actor.distributorId, stationId: station.id, amount: D(v.amount), currencyCode: settings.currencyCode,
          paidAt: v.paidAt, reference: v.reference, notes: v.notes, idempotencyKey: v.clientOpId, userId: actor.userId,
        },
      });
      await log(tx, actor, "station_payment.create", "station_payment", x.id, { station: station.name, amount: v.amount, reference: v.reference });
      return { id: x.id };
    }),
  );
}

export async function cancelStationPayment(actor: Actor, id: string, input: unknown) {
  assertDistributor(actor);
  const { reason } = reasonSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const x = await tx.stationPayment.findUnique({ where: { id } });
    if (!x) throw notFound("الدفعة");
    const res = await tx.stationPayment.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
    if (res.count !== 1) throw new AppError("INVALID_STATE", "أُلغيت هذه الدفعة سابقًا");
    await log(tx, actor, "station_payment.cancel", "station_payment", id, { status: "CANCELLED" }, { status: "ACTIVE", amount: x.amount.toFixed(2) }, reason);
  });
}

const shipmentValue = (s: { quantity: number; unitPrice: Prisma.Decimal }) => s.unitPrice.mul(s.quantity);

/**
 * كشف حساب محطة: قيمة الشحنات المستلمة (العدد × سعر الشراء) مقابل الدفعات.
 * الرصيد الموجب = مستحق للمحطة على الموزّع؛ السالب = دفع مقدم.
 */
export async function stationAccount(actor: Actor, stationId: string, filters: unknown) {
  assertDistributor(actor);
  const f = z.object(rangeSchema).parse(filters ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    const station = await tx.station.findUnique({ where: { id: stationId } });
    if (!station) throw notFound("المحطة");
    const [shipments, payments] = await Promise.all([
      tx.shipment.findMany({ where: { stationId }, orderBy: { receivedAt: "asc" } }),
      tx.stationPayment.findMany({ where: { stationId }, orderBy: { paidAt: "asc" } }),
    ]);
    const activeShip = shipments.filter((s) => s.status === "ACTIVE");
    const activePay = payments.filter((p) => p.status === "ACTIVE");
    const totalValue = activeShip.reduce((a, s) => a.add(shipmentValue(s)), ZERO);
    const totalPaid = activePay.reduce((a, p) => a.add(p.amount), ZERO);
    const before = (d: Date) => (f.from ? d < f.from : false);
    const inRange = (d: Date) => (!f.from || d >= f.from) && (!f.to || d <= f.to);
    const opening = activeShip.filter((s) => before(s.receivedAt)).reduce((a, s) => a.add(shipmentValue(s)), ZERO)
      .sub(activePay.filter((p) => before(p.paidAt)).reduce((a, p) => a.add(p.amount), ZERO));
    type Entry = { at: Date; kind: "SHIPMENT" | "PAYMENT"; id: string; debit: Prisma.Decimal; credit: Prisma.Decimal; description: string; cancelled: boolean; cancelReason: string | null };
    const entries: Entry[] = [
      ...shipments.filter((s) => inRange(s.receivedAt)).map((s) => ({
        at: s.receivedAt, kind: "SHIPMENT" as const, id: s.id, debit: shipmentValue(s), credit: ZERO,
        description: `شحنة ${s.quantity} جرة × ${s.unitPrice.toFixed(2)}${s.reference ? ` (${s.reference})` : ""}`, cancelled: s.status !== "ACTIVE", cancelReason: s.cancelReason,
      })),
      ...payments.filter((p) => inRange(p.paidAt)).map((p) => ({
        at: p.paidAt, kind: "PAYMENT" as const, id: p.id, debit: ZERO, credit: p.amount,
        description: `دفعة${p.reference ? ` (${p.reference})` : ""}${p.notes ? ` — ${p.notes}` : ""}`, cancelled: p.status !== "ACTIVE", cancelReason: p.cancelReason,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    let running = opening;
    const withBalance = entries.map((e) => {
      if (!e.cancelled) running = running.add(e.debit).sub(e.credit);
      return { ...e, balance: running };
    });
    return {
      station,
      totals: { value: totalValue, paid: totalPaid, remaining: totalValue.sub(totalPaid) },
      period: { from: f.from ?? null, to: f.to ?? null, opening, closing: running },
      entries: withBalance,
    };
  });
}

/** ملخص كل المحطات: القيمة والمدفوع والمتبقي. */
export async function stationsSummary(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const [stations, ships, pays] = await Promise.all([
      tx.station.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
      tx.shipment.findMany({ where: { status: "ACTIVE" }, select: { stationId: true, quantity: true, unitPrice: true } }),
      tx.stationPayment.groupBy({ by: ["stationId"], where: { status: "ACTIVE" }, _sum: { amount: true } }),
    ]);
    return stations.map((s) => {
      const value = ships.filter((x) => x.stationId === s.id).reduce((a, x) => a.add(shipmentValue(x)), ZERO);
      const paid = pays.find((p) => p.stationId === s.id)?._sum.amount ?? ZERO;
      return { ...s, value, paid, remaining: value.sub(paid) };
    });
  });
}

// ---------------------------------------------------------------------------
// الصندوق
// ---------------------------------------------------------------------------

const boxFilters = z.object({ ...rangeSchema, cycleId: z.string().uuid().optional() });

/**
 * الصندوق: المقبوضات (تحصيلات المواطنين) والمدفوعات (المصروفات ودفعات المحطات) والرصيد المحسوب.
 * عند التصفية بدورة: التحصيلات المرتبطة بالدورة، والمصروفات ودفعات المحطات خلال فترة الدورة.
 * الرصيد محسوب من السجلات ولا يثبت مقدار النقد الموجود فعلًا.
 */
export async function cashBox(actor: Actor, filters: unknown) {
  assertDistributor(actor);
  const f = boxFilters.parse(filters ?? {});
  return withTenant(actor.distributorId, async (tx) => {
    let from = f.from;
    let to = f.to;
    let cycle = null;
    if (f.cycleId) {
      cycle = await tx.cycle.findUnique({ where: { id: f.cycleId } });
      if (!cycle) throw notFound("الدورة");
      from = from && from > cycle.openedAt ? from : cycle.openedAt;
      const end = cycle.closedAt ?? new Date();
      to = to && to < end ? to : end;
    }
    const range = from || to ? { gte: from, lte: to } : undefined;
    const [pay, exp, sp] = await Promise.all([
      tx.payment.findMany({
        where: { status: "ACTIVE", paidAt: f.cycleId ? undefined : range, cycleId: f.cycleId },
        include: { entitlement: { select: { nameInStatement: true, citizenNumber: true, cycle: { select: { name: true } } } } },
        orderBy: { paidAt: "desc" },
      }),
      tx.expense.findMany({ where: { status: "ACTIVE", spentAt: range }, orderBy: { spentAt: "desc" } }),
      tx.stationPayment.findMany({ where: { status: "ACTIVE", paidAt: range }, include: { station: { select: { name: true } } }, orderBy: { paidAt: "desc" } }),
    ]);
    const sum = (xs: { amount: Prisma.Decimal }[]) => xs.reduce((a, x) => a.add(x.amount), ZERO);
    const receipts = sum(pay);
    const expenses = sum(exp);
    const stationPayments = sum(sp);
    const entries = [
      ...pay.map((p) => ({ at: p.paidAt, kind: "PAYMENT" as const, id: p.id, amount: p.amount, description: `تحصيل من ${p.entitlement.nameInStatement} (رقم ${p.entitlement.citizenNumber}) — ${p.entitlement.cycle.name}` })),
      ...exp.map((x) => ({ at: x.spentAt, kind: "EXPENSE" as const, id: x.id, amount: x.amount.neg(), description: x.description })),
      ...sp.map((x) => ({ at: x.paidAt, kind: "STATION_PAYMENT" as const, id: x.id, amount: x.amount.neg(), description: `دفعة لمحطة ${x.station.name}${x.reference ? ` (${x.reference})` : ""}` })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      cycle: cycle ? { id: cycle.id, name: cycle.name } : null,
      range: { from: from ?? null, to: to ?? null },
      receipts, expenses, stationPayments,
      balance: receipts.sub(expenses).sub(stationPayments),
      entries: entries.slice(0, 500),
      truncated: entries.length > 500,
    };
  });
}

// ---------------------------------------------------------------------------
// مستحقات المواطن
// ---------------------------------------------------------------------------

/** المطلوب والمدفوع والمتبقي لكل استحقاق قابل للتحصيل، والإجمالي عبر الدورات. */
export async function citizenDues(tx: Tx, citizenId: string) {
  const ents = await tx.entitlement.findMany({ where: { citizenId, ...billableWhere }, select: { id: true, amountDue: true } });
  const paid = await paidByEntitlement(tx, ents.map((e) => e.id));
  const per = new Map(ents.map((e) => {
    const p = paid.get(e.id) ?? ZERO;
    return [e.id, { due: e.amountDue, paid: p, remaining: e.amountDue.sub(p) }];
  }));
  const total = [...per.values()].reduce((a, x) => ({ due: a.due.add(x.due), paid: a.paid.add(x.paid), remaining: a.remaining.add(x.remaining) }), { due: ZERO, paid: ZERO, remaining: ZERO });
  return { per, total };
}
