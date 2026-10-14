import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db";
import { closeCycle, createCycle } from "@/server/services/cycles";
import { approveStatement, getStatement, uploadStatement } from "@/server/services/statements";
import { editEntitlement, getCitizenProfile } from "@/server/services/citizens";
import { counterLookup, deliverCylinder, fillCylinders, receiveEmpty } from "@/server/services/operations";
import { createStation, receiveShipment, cancelShipment } from "@/server/services/shipments";
import {
  cancelExpense, cancelPayment, cancelStationPayment, cashBox, createExpense, createStationPayment, listPayments, recordPayment, stationAccount,
} from "@/server/services/finance";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();
const one = (qty = 1): Row => ({ id: newId(), name: "مواطن مالي", number: Math.floor(Math.random() * 9000) + 100, qty });

async function setup(rows: Row[], price = "20") {
  const d = await makeDistributor();
  const cycle = await createCycle(d.actor, { unitPrice: price });
  const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(rows)), {});
  await approveStatement(d.actor, up.id, { confirm: true });
  const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, include: { citizen: true } });
  const ent = (nid: string) => ents.find((e) => e.citizen.nationalId === nid)!;
  return { ...d, cycle, statementId: up.id, ent };
}

describe("تحصيلات المواطنين", () => {
  it("الدفع الجزئي ينقص المتبقي، والكامل يصفّره", async () => {
    const r = one(2); // مطلوب 40
    const { actor, ent } = await setup([r]);
    const e = ent(r.id);
    const p1 = await recordPayment(actor, { clientOpId: key(), entitlementId: e.id, amount: "15" });
    expect([p1.paid, p1.remaining]).toEqual(["15.00", "25.00"]);
    const p2 = await recordPayment(actor, { clientOpId: key(), entitlementId: e.id, full: true });
    expect([p2.amount, p2.paid, p2.remaining]).toEqual(["25.00", "40.00", "0.00"]);
    await expect(recordPayment(actor, { clientOpId: key(), entitlementId: e.id, amount: "1" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("يمنع الدفع الزائد في الكود وفي قاعدة البيانات", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    await expect(recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "20.01" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      ownerDb.payment.create({ data: { distributorId: actor.distributorId!, entitlementId: ent(r.id).id, cycleId: ent(r.id).cycleId, amount: 25, currencyCode: "ILS", paidAt: new Date(), idempotencyKey: key(), userId: actor.userId } }),
    ).rejects.toThrow(/دفع زائد/);
  });

  it("دفعتان متزامنتان مختلفتان لا تتجاوزان المطلوب", async () => {
    const r = one(); // 20
    const { actor, ent } = await setup([r]);
    const res = await Promise.allSettled([1, 2, 3].map(() => recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "15" })));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const sum = await ownerDb.payment.aggregate({ where: { entitlementId: ent(r.id).id, status: "ACTIVE" }, _sum: { amount: true } });
    expect(sum._sum.amount!.toFixed(2)).toBe("15.00");
  });

  it("إعادة إرسال التحصيل نفسه لا تكرره، حتى بالتزامن", async () => {
    const r = one(3);
    const { actor, ent } = await setup([r]);
    const body = { clientOpId: key(), entitlementId: ent(r.id).id, amount: "10" };
    const res = await Promise.all([recordPayment(actor, body), recordPayment(actor, body), recordPayment(actor, body)]);
    expect(new Set(res.map((x) => x.paymentId)).size).toBe(1);
    expect(res.filter((x) => x.replayed)).toHaveLength(2);
    expect(await ownerDb.payment.count({ where: { entitlementId: ent(r.id).id } })).toBe(1);
  });

  it("الدفع على الدورة المختارة، والمستحقات الإجمالية عبر الدورات", async () => {
    const r = one();
    const { actor, ent, cycle } = await setup([r], "20");
    await closeCycle(actor, cycle.id, { confirm: true });
    const c2 = await createCycle(actor, { unitPrice: "30" });
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([r])), {});
    await approveStatement(actor, up.id, { confirm: true });
    const e2 = await ownerDb.entitlement.findFirstOrThrow({ where: { cycleId: c2.id } });
    // دفع على الدورة القديمة المغلقة.
    await recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "5" });
    const p = await getCitizenProfile(actor, ent(r.id).citizenId);
    expect([p.totals.due.toFixed(2), p.totals.paid.toFixed(2), p.totals.remaining.toFixed(2)]).toEqual(["50.00", "5.00", "45.00"]);
    expect(p.balances[ent(r.id).id].remaining.toFixed(2)).toBe("15.00");
    expect(p.balances[e2.id].remaining.toFixed(2)).toBe("30.00");
    const l = await counterLookup(actor, { nationalId: r.id });
    if (!l.found) throw new Error("not found");
    expect(l.entitlements.map((x) => x.cycle.name).sort()).toEqual([cycle.name, c2.name].sort());
    expect(l.totalRemaining.toFixed(2)).toBe("45.00");
  });

  it("عمليات الجرار لا تغيّر المدفوع، والدفع لا يغيّر حالة الجرار", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const { cylinder } = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cylinder.id }] });
    await deliverCylinder(actor, { clientOpId: key(), cylinderId: cylinder.id, cylinderLabel: cylinder.label, nationalId: r.id });
    expect(await ownerDb.payment.count({ where: { entitlementId: ent(r.id).id } })).toBe(0);
    await recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, full: true });
    expect((await ownerDb.cylinder.findUniqueOrThrow({ where: { id: cylinder.id } })).status).toBe("DELIVERED");
  });

  it("إلغاء التحصيل يعيد المتبقي مرة واحدة، والسجل المالي لا يُعدّل ولا يُحذف", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const p = await recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "12" });
    await expect(cancelPayment(actor, p.paymentId, {})).rejects.toThrow();
    const res = await Promise.allSettled([cancelPayment(actor, p.paymentId, { reason: "سُجل خطأ" }), cancelPayment(actor, p.paymentId, { reason: "سُجل خطأ" })]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const again = await recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, full: true });
    expect(again.amount).toBe("20.00");
    await expect(ownerDb.payment.update({ where: { id: again.paymentId }, data: { amount: 1 } })).rejects.toThrow(/42501/);
    await expect(ownerDb.payment.delete({ where: { id: again.paymentId } })).rejects.toThrow(/42501/);
    await expect(ownerDb.payment.update({ where: { id: p.paymentId }, data: { status: "ACTIVE", cancelledAt: null, cancelledById: null, cancelReason: null } })).rejects.toThrow();
  });

  it("لا يُخفض المبلغ المطلوب تحت المدفوع، لا بالتعديل ولا بإصدار كشف جديد", async () => {
    const r = one(2); // 40
    const { actor, ent, statementId } = await setup([r]);
    await recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "30" });
    await expect(editEntitlement(actor, ent(r.id).id, { amountDue: "25", reason: "تصحيح" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([{ ...r, qty: 1 }])), { supersedesId: statementId });
    const st = await getStatement(actor, up.id);
    expect((st.rows[0].issues as { code: string }[]).map((i) => i.code)).toContain("AMOUNT_BELOW_PAID");
    await expect(withTenant(actor.distributorId!, (tx) => tx.entitlement.update({ where: { id: ent(r.id).id }, data: { amountDue: 10 } }))).rejects.toThrow(/المدفوع/);
  });

  it("قائمة التحصيلات تُصفّى بالدورة وتجمع النافذ فقط", async () => {
    const a = one();
    const b = one();
    const { actor, ent, cycle } = await setup([a, b]);
    await recordPayment(actor, { clientOpId: key(), entitlementId: ent(a.id).id, amount: "10" });
    const p = await recordPayment(actor, { clientOpId: key(), entitlementId: ent(b.id).id, amount: "7" });
    await cancelPayment(actor, p.paymentId, { reason: "خطأ إدخال" });
    const l = await listPayments(actor, { cycleId: cycle.id });
    expect(l.total).toBe(2);
    expect(l.totalAmount.toFixed(2)).toBe("10.00");
  });
});

describe("المحطات والشحنات المالية", () => {
  it("قيمة الشحنة = العدد × سعر الشراء، والاستلام لا يعني الدفع، والدفعات منفصلة", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const { cylinder } = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    const st = await createStation(actor, { name: `محطة ${randomUUID().slice(0, 4)}`, defaultUnitPrice: "15" });
    const s1 = await receiveShipment(actor, { clientOpId: key(), stationId: st.id, quantity: 4, cylinderIds: [cylinder.id] }); // 60
    await receiveShipment(actor, { clientOpId: key(), stationId: st.id, quantity: 2, unitPrice: "16.5", cylinderIds: [] }); // 33
    let acc = await stationAccount(actor, st.id, {});
    expect([acc.totals.value.toFixed(2), acc.totals.paid.toFixed(2), acc.totals.remaining.toFixed(2)]).toEqual(["93.00", "0.00", "93.00"]);
    // تغيير سعر المحطة لاحقًا لا يغير قيمة الشحنات السابقة.
    await ownerDb.station.update({ where: { id: st.id }, data: { defaultUnitPrice: 99 } });
    const pay = await createStationPayment(actor, { clientOpId: key(), stationId: st.id, amount: "50", reference: "R1" });
    acc = await stationAccount(actor, st.id, {});
    expect([acc.totals.value.toFixed(2), acc.totals.paid.toFixed(2), acc.totals.remaining.toFixed(2)]).toEqual(["93.00", "50.00", "43.00"]);
    expect(acc.entries.at(-1)!.balance.toFixed(2)).toBe("43.00");
    // إلغاء الدفعة والشحنة.
    await cancelStationPayment(actor, pay.id, { reason: "دفعة مكررة" });
    await expect(cancelStationPayment(actor, pay.id, { reason: "مرة ثانية" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await cancelShipment(actor, s1.id, { reason: "خطأ" });
    acc = await stationAccount(actor, st.id, {});
    expect(acc.totals.remaining.toFixed(2)).toBe("33.00");
  });

  it("الشحنة دون سعر للمحطة ولا للشحنة تُرفض", async () => {
    const { actor } = await makeDistributor();
    const st = await createStation(actor, { name: `محطة ${randomUUID().slice(0, 4)}` });
    await expect(receiveShipment(actor, { clientOpId: key(), stationId: st.id, quantity: 1 })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("كشف الحساب لفترة: رصيد افتتاحي ورصيد جارٍ", async () => {
    const { actor } = await makeDistributor();
    const st = await createStation(actor, { name: `محطة ${randomUUID().slice(0, 4)}`, defaultUnitPrice: "10" });
    await receiveShipment(actor, { clientOpId: key(), stationId: st.id, quantity: 5, receivedAt: "2026-01-10T10:00:00Z" });
    await createStationPayment(actor, { clientOpId: key(), stationId: st.id, amount: "20", paidAt: "2026-01-12T10:00:00Z" });
    await receiveShipment(actor, { clientOpId: key(), stationId: st.id, quantity: 3, receivedAt: "2026-02-05T10:00:00Z" });
    const acc = await stationAccount(actor, st.id, { from: "2026-02-01", to: "2026-02-28" });
    expect(acc.period.opening.toFixed(2)).toBe("30.00");
    expect(acc.entries).toHaveLength(1);
    expect(acc.period.closing.toFixed(2)).toBe("60.00");
  });
});

describe("المصروفات والصندوق", () => {
  it("الصندوق: المقبوضات − المصروفات − دفعات المحطات، ويتجاهل الملغى", async () => {
    const r = one(2);
    const { actor, ent } = await setup([r]);
    await recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "40" });
    const x = await createExpense(actor, { clientOpId: key(), amount: "7.5", description: "نقل" });
    await createExpense(actor, { clientOpId: key(), amount: "2", description: "أكياس" });
    const st = await createStation(actor, { name: `محطة ${randomUUID().slice(0, 4)}`, defaultUnitPrice: "10" });
    await createStationPayment(actor, { clientOpId: key(), stationId: st.id, amount: "20" });
    let box = await cashBox(actor, {});
    expect([box.receipts, box.expenses, box.stationPayments, box.balance].map((d) => d.toFixed(2))).toEqual(["40.00", "9.50", "20.00", "10.50"]);
    await cancelExpense(actor, x.id, { reason: "سُجل مرتين" });
    box = await cashBox(actor, {});
    expect(box.balance.toFixed(2)).toBe("18.00");
    expect(box.entries.find((e) => e.id === x.id)).toBeUndefined();
  });

  it("الصندوق حسب الدورة: تحصيلات الدورة، ومصروفات خلال فترتها", async () => {
    const r = one();
    const { actor, ent, cycle } = await setup([r]);
    await recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "20" });
    await createExpense(actor, { clientOpId: key(), amount: "3", description: "داخل الفترة" });
    await createExpense(actor, { clientOpId: key(), amount: "100", description: "قبل الدورة", spentAt: "2020-01-01T00:00:00Z" });
    const box = await cashBox(actor, { cycleId: cycle.id });
    expect([box.receipts, box.expenses, box.balance].map((d) => d.toFixed(2))).toEqual(["20.00", "3.00", "17.00"]);
  });

  it("المصروف: وصف ومبلغ موجب، وتاريخ غير مستقبلي، وإعادة الإرسال لا تكرره", async () => {
    const { actor } = await makeDistributor();
    await expect(createExpense(actor, { clientOpId: key(), amount: "0", description: "صفر" })).rejects.toThrow();
    await expect(createExpense(actor, { clientOpId: key(), amount: "5", description: "" })).rejects.toThrow();
    await expect(createExpense(actor, { clientOpId: key(), amount: "5", description: "مستقبل", spentAt: "2099-01-01T00:00:00Z" })).rejects.toThrow();
    const k = key();
    const [a, b] = await Promise.all([createExpense(actor, { clientOpId: k, amount: "5", description: "مكرر" }), createExpense(actor, { clientOpId: k, amount: "5", description: "مكرر" })]);
    expect(a.id).toBe(b.id);
    expect(await ownerDb.expense.count({ where: { distributorId: actor.distributorId! } })).toBe(1);
  });

  it("العزل: موزّع لا يرى ولا يلغي سجلات مالية لغيره", async () => {
    const r = one();
    const a = await setup([r]);
    const p = await recordPayment(a.actor, { clientOpId: key(), entitlementId: a.ent(r.id).id, amount: "5" });
    const b = await makeDistributor();
    await expect(cancelPayment(b.actor, p.paymentId, { reason: "اختراق" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordPayment(b.actor, { clientOpId: key(), entitlementId: a.ent(r.id).id, amount: "1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await cashBox(b.actor, {})).receipts.toFixed(2)).toBe("0.00");
  });
});
