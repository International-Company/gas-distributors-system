import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createCycle } from "@/server/services/cycles";
import { approveStatement, uploadStatement } from "@/server/services/statements";
import { deliverCylinder, fillCylinders, receiveEmpty } from "@/server/services/operations";
import { createExpense, recordPayment } from "@/server/services/finance";
import { centralOverview, listReports, reportToXlsx, runReport } from "@/server/reports/service";
import { makeAdmin, makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();

/** موزّع بدورة سعرها 20 وثلاثة مستحقين بحالات مختلفة. */
async function scenario() {
  const d = await makeDistributor();
  const cycle = await createCycle(d.actor, { unitPrice: "20" });
  const rows: Row[] = [
    { id: newId(), name: "مستلم بالكامل", number: 1 },
    { id: newId(), name: "جرة معبأة", number: 2, qty: 2 },
    { id: newId(), name: "لم يحضر", number: 3 },
  ];
  const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(rows)), {});
  await approveStatement(d.actor, up.id, { confirm: true });
  const ent = async (nid: string) => ownerDb.entitlement.findFirstOrThrow({ where: { cycleId: cycle.id, citizen: { nationalId: nid } } });
  const e1 = await ent(rows[0].id);
  const e2 = await ent(rows[1].id);
  const c1 = (await receiveEmpty(d.actor, { clientOpId: key(), entitlementId: e1.id, nationalId: rows[0].id })).cylinder;
  const c2 = (await receiveEmpty(d.actor, { clientOpId: key(), entitlementId: e2.id, nationalId: rows[1].id })).cylinder;
  await fillCylinders(d.actor, { items: [{ clientOpId: key(), cylinderId: c1.id }, { clientOpId: key(), cylinderId: c2.id }] });
  await deliverCylinder(d.actor, { clientOpId: key(), cylinderId: c1.id, cylinderLabel: c1.label, nationalId: rows[0].id });
  await recordPayment(d.actor, { clientOpId: key(), entitlementId: e1.id, full: true });
  await recordPayment(d.actor, { clientOpId: key(), entitlementId: e2.id, amount: "10" });
  await createExpense(d.actor, { clientOpId: key(), amount: "5", description: "نقل" });
  return { ...d, cycle, rows };
}

describe("تقارير الموزّع", () => {
  it("كل التقارير المسجلة تعمل دون أخطاء على بيانات حقيقية", async () => {
    const { actor } = await scenario();
    for (const r of listReports()) {
      const res = await runReport(actor, r.key, {});
      expect(res.columns.length, r.key).toBeGreaterThan(0);
    }
  });

  it("لم يستلموا جرارهم: المستحق 2 والمعبأة لم تُسلّم ومن لم يحضر", async () => {
    const { actor } = await scenario();
    const r = await runReport(actor, "not-delivered", {});
    expect(r.rows.map((x) => [x.citizenNumber, x.pending]).sort()).toEqual([["2", 2], ["3", 1]]);
  });

  it("كشف المواطنين للطباعة يصفّي حسب حالة الجرة", async () => {
    const { actor } = await scenario();
    expect((await runReport(actor, "citizens-sheet", {})).rows).toHaveLength(3);
    expect((await runReport(actor, "citizens-sheet", { state: "DELIVERED" })).rows.map((x) => x.citizenNumber)).toEqual(["1"]);
    expect((await runReport(actor, "citizens-sheet", { state: "FILLED" })).rows.map((x) => x.citizenNumber)).toEqual(["2"]);
    expect((await runReport(actor, "citizens-sheet", { state: "NOT_RECEIVED" })).rows.map((x) => x.citizenNumber)).toEqual(["3"]);
    expect((await runReport(actor, "citizens-sheet", { state: "NOT_DELIVERED" })).rows).toHaveLength(2);
  });

  it("غير المسددين والمبالغ صحيحة", async () => {
    const { actor } = await scenario();
    const r = await runReport(actor, "unpaid", {});
    expect(r.rows.map((x) => [x.citizenNumber, x.due, x.paid, x.remaining])).toEqual([
      ["2", "40.00", "10.00", "30.00"],
      ["3", "20.00", "0.00", "20.00"],
    ]);
    expect(r.totals!.remaining).toBe("50.00");
  });

  it("ستة تقارير أساسية فقط", () => {
    expect(listReports().map((r) => r.key)).toEqual(["citizens-sheet", "not-delivered", "unpaid", "cash-box", "stations", "movements"]);
  });

  it("حركة الجرار: الأعداد والأسماء والرصيد بعد كل حركة، وفترة في الماضي فارغة، والتاريخ غير الصالح مرفوض", async () => {
    const { actor, rows } = await scenario();
    const today = new Date().toISOString().slice(0, 10);
    const r = await runReport(actor, "movements", { from: "2020-01-01", to: "2099-12-31" });
    expect(r.summary!.map((s) => s.value)).toEqual([2, 2, 1]);
    expect(r.rows.find((x) => x.type === "تسليم")).toMatchObject({ name: rows[0].name, after: "0 / 1 / 0" });
    expect((await runReport(actor, "movements", { from: "2020-01-01", to: "2020-12-31" })).rows).toHaveLength(0);
    expect((await runReport(actor, "movements", { type: "DELIVER", from: "2020-01-01", to: today.slice(0, 4) + "-12-31" })).rows).toHaveLength(1);
    await expect(runReport(actor, "movements", { from: "أمس" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("الفلوس: المقبوض ناقص المصاريف", async () => {
    const { actor } = await scenario();
    const box = await runReport(actor, "cash-box", {});
    expect(box.totals!.amount).toBe("25.00");
  });

  it("Excel من اليمين لليسار برأس وإجماليات وأرقام مال", async () => {
    const { actor } = await scenario();
    const r = await runReport(actor, "unpaid", {});
    const buf = await reportToXlsx(r, "نظام");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.views[0].rightToLeft).toBe(true);
    const values = ws.getSheetValues().flat().filter((v) => v !== undefined && v !== null);
    expect(values).toContain("المتبقي");
    expect(values).toContain(30);
  });
});

describe("صلاحيات التقارير وعزلها", () => {
  it("الموزّع لا يشغّل تقارير موزّع آخر، والبيانات لا تختلط", async () => {
    const a = await scenario();
    const b = await makeDistributor();
    await expect(runReport(b.actor, "unpaid", {}, { distributorId: a.actor.distributorId! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await createCycle(b.actor, { unitPrice: "20" });
    expect((await runReport(b.actor, "unpaid", {})).rows).toHaveLength(0);
    // معرّف دورة موزّع آخر لا يُرى.
    await expect(runReport(b.actor, "not-delivered", { cycleId: a.cycle.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("المدير يحتاج صلاحية التقارير، ويشغّلها لموزّع يختاره", async () => {
    const a = await scenario();
    const { actor: noPerm } = await makeAdmin({ permissions: ["distributors.view"] });
    const { actor: reporter } = await makeAdmin({ permissions: ["reports.view"] });
    await expect(runReport(noPerm, "unpaid", {}, { distributorId: a.actor.distributorId! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(runReport(reporter, "unpaid", {})).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await runReport(reporter, "unpaid", {}, { distributorId: a.actor.distributorId! });
    expect(r.rows).toHaveLength(2);
    expect(r.distributorName).toBe(a.distributor.name);
  });

  it("التقرير المركزي يعرض كل موزّع بأرقامه دون خلط", async () => {
    const a = await scenario();
    const { actor: reporter } = await makeAdmin({ permissions: ["reports.view"] });
    const { actor: noPerm } = await makeAdmin({ permissions: ["distributors.view"] });
    await expect(centralOverview(noPerm, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    const c = await centralOverview(reporter, {});
    const mine = c.rows.find((r) => r.id === a.actor.distributorId)!;
    expect(mine).toMatchObject({ citizens: 3, entitled: 4, received: 2, filled: 1, delivered: 1, stockFilled: 1, collected: "30.00", outstanding: "50.00" });
  });
});
