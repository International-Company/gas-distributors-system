import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCycle } from "@/server/services/cycles";
import { approveStatement, discardStatement, statementActivity, uploadStatement, withdrawStatement } from "@/server/services/statements";
import { recordPayment } from "@/server/services/finance";
import { handOver } from "@/server/services/handovers";
import { sheet } from "@/server/services/sheet";
import { moneyOverview } from "@/server/services/money";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();
const people = (n: number, tag = "س"): Row[] => Array.from({ length: n }, (_, i) => ({ id: newId(), name: `شخص ${tag} ${i + 1}`, number: i + 1 }));

async function approved(rows: Row[]) {
  const d = await makeDistributor();
  await createCycle(d.actor, { unitPrice: "20" });
  const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(rows)), {});
  await approveStatement(d.actor, up.id, { confirm: true });
  return { ...d, statementId: up.id };
}

describe("حذف الكشف المعتمد", () => {
  it("كشف بلا تسليم ولا قبض: يُحذف (ملغى بسبب)، ويُزال ناسه من «الكشف» والمستحقات، ويبقى سجلهم", async () => {
    const { actor, statementId } = await approved(people(3));
    expect((await statementActivity(actor, [statementId])).get(statementId)).toBeUndefined();
    await expect(withdrawStatement(actor, statementId, { reason: "" })).rejects.toThrow();
    expect(await withdrawStatement(actor, statementId, { reason: "اعتُمد بالخطأ" })).toEqual({ removed: 3 });
    const st = await ownerDb.statement.findUniqueOrThrow({ where: { id: statementId } });
    expect(st).toMatchObject({ status: "DISCARDED", discardReason: "اعتُمد بالخطأ" });
    expect(await ownerDb.entitlement.count({ where: { statementId, status: "ACTIVE" } })).toBe(0);
    expect(await ownerDb.entitlementChange.count({ where: { statementId, source: "STATEMENT_WITHDRAWN" } })).toBe(3);
    expect(await sheet(actor, {})).toMatchObject({ statement: null, rows: [] });
    expect((await moneyOverview(actor, { period: "all" })).dues.remaining).toBe("0.00");
    await expect(withdrawStatement(actor, statementId, { reason: "مرة ثانية" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("يُرفض الحذف إن استلم أو دفع أحد من الكشف", async () => {
    const rows = people(2);
    const { actor, statementId } = await approved(rows);
    const ents = await ownerDb.entitlement.findMany({ where: { statementId }, include: { citizen: true } });
    const e0 = ents.find((e) => e.citizen.nationalId === rows[0].id)!;
    await recordPayment(actor, { clientOpId: key(), entitlementId: e0.id, amount: "5" });
    expect((await statementActivity(actor, [statementId])).get(statementId)).toBe(1);
    await expect(withdrawStatement(actor, statementId, { reason: "غلط" })).rejects.toMatchObject({ code: "INVALID_STATE", message: expect.stringContaining("1 شخص") });
    const e1 = ents.find((e) => e.citizen.nationalId === rows[1].id)!;
    await handOver(actor, { clientOpId: key(), entitlementId: e1.id, nationalId: rows[1].id });
    expect((await statementActivity(actor, [statementId])).get(statementId)).toBe(2);
    expect((await ownerDb.statement.findUniqueOrThrow({ where: { id: statementId } })).status).toBe("APPROVED");
  });

  it("التحديث لا يُحذف، وكشف له تحديث بانتظار الاعتماد لا يُحذف قبل حذف التحديث", async () => {
    const rows = people(2);
    const { actor, statementId } = await approved(rows);
    const v2 = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), { supersedesId: statementId });
    await expect(withdrawStatement(actor, statementId, { reason: "غلط" })).rejects.toMatchObject({ message: expect.stringContaining("بانتظار الاعتماد") });
    await approveStatement(actor, v2.id, { confirm: true });
    await expect(withdrawStatement(actor, v2.id, { reason: "غلط" })).rejects.toMatchObject({ message: expect.stringContaining("تبديل") });
  });

  it("حذف كشف بانتظار الاعتماد (إلغاء) يبقى كما هو", async () => {
    const d = await makeDistributor();
    await createCycle(d.actor, { unitPrice: "20" });
    const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(people(1))), {});
    await expect(withdrawStatement(d.actor, up.id, { reason: "غلط" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await discardStatement(d.actor, up.id, { reason: "رُفع بالخطأ" });
    expect((await ownerDb.statement.findUniqueOrThrow({ where: { id: up.id } })).status).toBe("DISCARDED");
  });
});

describe("تبديل الكشف", () => {
  it("كشف جديد مكان القديم: من استلم أو دفع يبقى سجله، والجدد يُضافون، ومن غاب يُزال", async () => {
    const rows = people(3, "قديم");
    const { actor, statementId } = await approved(rows);
    const ents = await ownerDb.entitlement.findMany({ where: { statementId }, include: { citizen: true } });
    const e0 = ents.find((e) => e.citizen.nationalId === rows[0].id)!;
    await handOver(actor, { clientOpId: key(), entitlementId: e0.id, nationalId: rows[0].id });
    await recordPayment(actor, { clientOpId: key(), entitlementId: e0.id, amount: "20" });
    const fresh = people(1, "جديد").map((r) => ({ ...r, number: 9 }));
    const v2 = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([rows[0], rows[1], ...fresh])), { supersedesId: statementId });
    await approveStatement(actor, v2.id, { confirm: true });
    const s = await sheet(actor, {});
    expect(s.statement?.id).toBe(v2.id);
    expect(s.rows.map((r) => r.nationalId).sort()).toEqual([rows[0].id, rows[1].id, fresh[0].id].sort());
    expect(s.rows.find((r) => r.nationalId === rows[0].id)).toMatchObject({ delivered: true, paid: "20.00" });
    expect((await ownerDb.statement.findUniqueOrThrow({ where: { id: statementId } })).status).toBe("SUPERSEDED");
  });
});
