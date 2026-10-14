import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCycle } from "@/server/services/cycles";
import { approveStatement, getStatement, updateRow, updateStatementMeta, uploadStatement } from "@/server/services/statements";
import { deliverCylinder, fillCylinders, receiveEmpty } from "@/server/services/operations";
import { runReport } from "@/server/reports/service";
import { rescale, withScale } from "@/server/statements/mapping";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();
const header = (scale: string) => `تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : ${scale}`;
const rowsOf = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: newId(), name: `مواطن ${i + 1} للميزان`, number: i + 1 }));

async function setup() {
  const d = await makeDistributor();
  const cycle = await createCycle(d.actor, { unitPrice: "20" });
  return { ...d, cycle };
}

describe("رقم الميزان: عدة كشوف في الدورة", () => {
  it("دمج الميزان والمتسلسل", () => {
    expect(withScale("295", "17")).toBe("295-17");
    expect(withScale(null, "17")).toBe("17");
    expect(withScale("295", "A-3")).toBe("A-3");
    expect(rescale("295", "300", "295-17")).toBe("300-17");
    expect(rescale("295", null, "295-17")).toBe("17");
    expect(rescale(null, "12", "5")).toBe("12-5");
  });

  it("كشفان يبدأ تسلسلهما من 1 في الدورة نفسها يُعتمدان دون تعارض", async () => {
    const { actor } = await setup();
    const a = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(3), { title: header("295") })), {});
    const b = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(3), { title: header("301") })), {});
    for (const id of [a.id, b.id]) {
      const st = await getStatement(actor, id);
      expect(st.statement.scaleNumber).toBeTruthy();
      await approveStatement(actor, id, { confirm: true });
    }
    const numbers = (await ownerDb.entitlement.findMany({ where: { distributorId: actor.distributorId! }, select: { citizenNumber: true } })).map((e) => e.citizenNumber).sort();
    expect(numbers).toEqual(["295-1", "295-2", "295-3", "301-1", "301-2", "301-3"]);
  });

  it("بلا رقم ميزان: يتعارض الرقم ويُطلب التصحيح؛ إدخال الميزان يدويًا يحل التعارض", async () => {
    const { actor } = await setup();
    await approveStatement(actor, (await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(2), { title: header("10") })), {})).id, { confirm: true });
    const b = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(2), { title: "كشف بلا رأس" })), {});
    let st = await getStatement(actor, b.id);
    expect(st.statement.scaleNumber).toBeNull();
    await updateStatementMeta(actor, b.id, { scaleNumber: "10" });
    st = await getStatement(actor, b.id);
    expect(st.rows.map((r) => r.citizenNumber)).toEqual(["10-1", "10-2"]);
    expect(st.rows.every((r) => (r.issues as { code: string }[]).some((i) => i.code === "NUMBER_TAKEN"))).toBe(true);
    await updateStatementMeta(actor, b.id, { scaleNumber: "11" });
    st = await getStatement(actor, b.id);
    expect(st.rows.map((r) => r.citizenNumber)).toEqual(["11-1", "11-2"]);
    expect(st.rows.every((r) => r.severity === "OK")).toBe(true);
    // تعديل صف برقم عددي يُسبق بالميزان تلقائيًا
    await updateRow(actor, b.id, st.rows[1].id, { citizenNumber: "7" });
    expect((await getStatement(actor, b.id)).rows[1].citizenNumber).toBe("11-7");
    await expect(updateStatementMeta(actor, b.id, { scaleNumber: "1a" })).rejects.toThrow();
  });

  it("تحديث كشف يُبقي رقم ميزان الإصدار السابق فلا تتغير الأرقام المكتوبة على الجرار", async () => {
    const { actor } = await setup();
    const rows = rowsOf(2);
    const a = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows, { title: header("50") })), {});
    await approveStatement(actor, a.id, { confirm: true });
    const b = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows, { title: header("99") })), { supersedesId: a.id });
    const st = await getStatement(actor, b.id);
    expect(st.statement.scaleNumber).toBe("50");
    expect(st.rows.map((r) => r.citizenNumber)).toEqual(["50-1", "50-2"]);
    await expect(updateStatementMeta(actor, b.id, { scaleNumber: "99" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("رقم الجرة يحمل الميزان، ومع تعدد الجرار لاحقة", async () => {
    const { actor } = await setup();
    const r = { id: newId(), name: "مواطن بجرتين", number: 4, qty: 2 };
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([r], { title: header("77") })), {});
    await approveStatement(actor, up.id, { confirm: true });
    const e = await ownerDb.entitlement.findFirstOrThrow({ where: { statementId: up.id } });
    const res = await receiveEmpty(actor, { clientOpId: key(), entitlementId: e.id, nationalId: r.id });
    expect(res.cylinder.label).toBe("77-4-1");
  });
});

describe("الأوزان", () => {
  async function withCylinder() {
    const { actor } = await setup();
    const r = { id: newId(), name: "مواطن للوزن", number: 9 };
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([r], { title: header("5") })), {});
    await approveStatement(actor, up.id, { confirm: true });
    const e = await ownerDb.entitlement.findFirstOrThrow({ where: { statementId: up.id } });
    return { actor, r, e };
  }

  it("وزن الفارغ عند الاستلام والممتلئ عند التسليم، والغاز هو الفرق في كشف المواطنين", async () => {
    const { actor, r, e } = await withCylinder();
    const rec = await receiveEmpty(actor, { clientOpId: key(), entitlementId: e.id, nationalId: r.id, weightKg: "١٤٫٥" });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: rec.cylinder.id }] });
    await deliverCylinder(actor, { clientOpId: key(), cylinderId: rec.cylinder.id, cylinderLabel: "5-9", nationalId: r.id, weightKg: 26.5 });
    const ops = await ownerDb.cylinderOperation.findMany({ where: { cylinderId: rec.cylinder.id }, orderBy: { at: "asc" } });
    expect(ops.map((o) => o.weightKg?.toFixed(2) ?? null)).toEqual(["14.50", null, "26.50"]);
    const rep = await runReport(actor, "citizens-sheet", {});
    expect(rep.rows[0]).toMatchObject({ emptyKg: "14.50", fullKg: "26.50", gasKg: "12.00" });
  });

  it("الوزن اختياري، ويُرفض الوزن غير الصالح، والممتلئ لا يقل عن الفارغ", async () => {
    const { actor, r, e } = await withCylinder();
    await expect(receiveEmpty(actor, { clientOpId: key(), entitlementId: e.id, nationalId: r.id, weightKg: "abc" })).rejects.toThrow();
    await expect(receiveEmpty(actor, { clientOpId: key(), entitlementId: e.id, nationalId: r.id, weightKg: "150" })).rejects.toThrow();
    await expect(receiveEmpty(actor, { clientOpId: key(), entitlementId: e.id, nationalId: r.id, weightKg: "0" })).rejects.toThrow();
    const rec = await receiveEmpty(actor, { clientOpId: key(), entitlementId: e.id, nationalId: r.id, weightKg: "15" });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: rec.cylinder.id }] });
    await expect(deliverCylinder(actor, { clientOpId: key(), cylinderId: rec.cylinder.id, cylinderLabel: "5-9", nationalId: r.id, weightKg: "14" })).rejects.toMatchObject({ code: "VALIDATION" });
    await deliverCylinder(actor, { clientOpId: key(), cylinderId: rec.cylinder.id, cylinderLabel: "5-9", nationalId: r.id });
    const rep = await runReport(actor, "citizens-sheet", {});
    expect(rep.rows[0]).toMatchObject({ emptyKg: "15.00", fullKg: null, gasKg: null });
  });

  it("قاعدة البيانات ترفض وزنًا على التعبئة أو خارج الحدود، ولا يُعدّل الوزن بعد التسجيل", async () => {
    const { actor, r, e } = await withCylinder();
    const rec = await receiveEmpty(actor, { clientOpId: key(), entitlementId: e.id, nationalId: r.id, weightKg: "15" });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: rec.cylinder.id }] });
    const fill = await ownerDb.cylinderOperation.findFirstOrThrow({ where: { cylinderId: rec.cylinder.id, type: "FILL" } });
    const receive = await ownerDb.cylinderOperation.findFirstOrThrow({ where: { cylinderId: rec.cylinder.id, type: "RECEIVE_EMPTY" } });
    await expect(ownerDb.$executeRawUnsafe(`UPDATE cylinder_operations SET "weightKg" = 20 WHERE id = '${receive.id}'`)).rejects.toThrow();
    await expect(
      ownerDb.cylinderOperation.create({ data: { distributorId: actor.distributorId!, cylinderId: rec.cylinder.id, type: "DELIVER", idempotencyKey: key(), userId: actor.userId, weightKg: 250 } }),
    ).rejects.toThrow();
    expect(fill.weightKg).toBeNull();
  });
});
