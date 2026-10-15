import { describe, expect, it } from "vitest";
import { createCycle } from "@/server/services/cycles";
import { approveStatement, getStatement, lastStatementPrice, statementDue, updateStatementMeta, uploadStatement } from "@/server/services/statements";
import { sheet } from "@/server/services/sheet";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const people = (n: number, qty = 1): Row[] => Array.from({ length: n }, (_, i) => ({ id: newId(), name: `شخص السعر ${i + 1}`, number: i + 1, qty }));
const header = (scale: string) => `تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : ${scale}`;

async function setup() {
  const d = await makeDistributor();
  await createCycle(d.actor, { unitPrice: "20" });
  return d;
}

describe("سعر الجرة لكل كشف", () => {
  it("المطلوب من كل شخص = عدد جراره × سعر الكشف (لا سعر الدورة)", async () => {
    const { actor } = await setup();
    const rows = [...people(1), { id: newId(), name: "شخص بجرتين", number: 2, qty: 2 }];
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), { unitPrice: "35" });
    expect(await statementDue(actor, up.id)).toEqual({ cylinders: 3, total: "105.00", price: "35.00" });
    await approveStatement(actor, up.id, { confirm: true });
    const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, orderBy: { citizenNumber: "asc" } });
    expect(ents.map((e) => [e.amountDue.toFixed(2), e.unitPrice.toFixed(2)])).toEqual([["35.00", "35.00"], ["70.00", "35.00"]]);
    expect((await sheet(actor, {})).rows.map((r) => r.amountDue)).toEqual(["35.00", "70.00"]);
  });

  it("كشفان في الدورة نفسها بسعرين مختلفين", async () => {
    const { actor } = await setup();
    const a = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(people(1), { title: header("1") })), { unitPrice: "20" });
    const b = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(people(1), { title: header("2") })), { unitPrice: "28.5" });
    await approveStatement(actor, a.id, { confirm: true });
    await approveStatement(actor, b.id, { confirm: true });
    expect((await ownerDb.entitlement.findFirstOrThrow({ where: { statementId: a.id } })).amountDue.toFixed(2)).toBe("20.00");
    expect((await ownerDb.entitlement.findFirstOrThrow({ where: { statementId: b.id } })).amountDue.toFixed(2)).toBe("28.50");
    expect(await lastStatementPrice(actor)).toBe("28.50");
  });

  it("تعديل السعر قبل الاعتماد يعيد الحساب، ومبلغ الهيئة في الكشف يبقى مقدّمًا", async () => {
    const { actor } = await setup();
    const rows: Row[] = [{ ...people(1)[0], amount: "50" }, { id: newId(), name: "شخص بلا مبلغ", number: 2 }];
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows, { withAmount: true })), { unitPrice: "25" });
    expect((await statementDue(actor, up.id)).total).toBe("75.00");
    await expect(updateStatementMeta(actor, up.id, { unitPrice: "-3" })).rejects.toThrow();
    await updateStatementMeta(actor, up.id, { unitPrice: "40" });
    expect(await statementDue(actor, up.id)).toMatchObject({ total: "90.00", price: "40.00" });
    const st = await getStatement(actor, up.id, {});
    const warn = st.rows.find((r) => r.amount)!.issues as { code: string; message: string }[];
    expect(warn.find((i) => i.code === "AMOUNT_MISMATCH")?.message).toContain("سعر الجرة (40");
    await approveStatement(actor, up.id, { confirm: true });
    const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, orderBy: { citizenNumber: "asc" } });
    expect(ents.map((e) => [e.amountDue.toFixed(2), e.amountSource])).toEqual([["50.00", "AUTHORITY"], ["40.00", "COMPUTED"]]);
  });

  it("التبديل يرث سعر الكشف السابق، ويمكن تغييره، وأثره يظهر في الفروق", async () => {
    const { actor } = await setup();
    const rows = people(2);
    const v1 = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), { unitPrice: "30" });
    await approveStatement(actor, v1.id, { confirm: true });
    const v2 = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), { supersedesId: v1.id });
    expect((await statementDue(actor, v2.id)).price).toBe("30.00");
    await updateStatementMeta(actor, v2.id, { unitPrice: "32" });
    const st = await getStatement(actor, v2.id, {});
    expect(st.diff?.changed).toHaveLength(2);
    expect(st.diff?.changed[0].changes).toEqual([{ field: "amountDue", before: "30.00", after: "32.00" }]);
    await approveStatement(actor, v2.id, { confirm: true });
    expect((await ownerDb.entitlement.findMany({ where: { statementId: v2.id } })).every((e) => e.amountDue.toFixed(2) === "32.00" && e.unitPrice.toFixed(2) === "32.00")).toBe(true);
  });

  it("بلا سعر عند الرفع: يُستخدم سعر الدورة؛ والسعر غير الصالح مرفوض", async () => {
    const { actor } = await setup();
    await expect(uploadStatement(actor, xlsxFile(await makeStatementXlsx(people(1))), { unitPrice: "abc" })).rejects.toThrow();
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(people(1))), {});
    expect((await statementDue(actor, up.id)).price).toBe("20.00");
  });
});
