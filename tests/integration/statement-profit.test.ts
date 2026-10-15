import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCycle } from "@/server/services/cycles";
import { approveStatement, lastStatementCost, setStatementCost, uploadStatement, withdrawStatement } from "@/server/services/statements";
import { recordPayment } from "@/server/services/finance";
import { handOver } from "@/server/services/handovers";
import { statementProfits } from "@/server/services/money";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();
const header = (scale: string) => `تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : ${scale}`;

async function setup() {
  const d = await makeDistributor();
  await createCycle(d.actor, { unitPrice: "20" });
  return d;
}

describe("ربح الموزّع من كل كشف", () => {
  it("الربح = البيع − (سعر الموزّع × الجرار)، والصافي حتى الآن = المقبوض − التكلفة، ويخلص بعد التسليم والقبض", async () => {
    const { actor } = await setup();
    const rows: Row[] = [
      { id: newId(), name: "شخص الربح 1", number: 1, qty: 1 },
      { id: newId(), name: "شخص الربح 2", number: 2, qty: 2 },
    ];
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), { unitPrice: "25", costPrice: "18" });
    await approveStatement(actor, up.id, { confirm: true });
    const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, orderBy: { citizenNumber: "asc" } });

    let p = (await statementProfits(actor)).items[0];
    expect(p).toMatchObject({ salePrice: "25.00", costPrice: "18.00", margin: "7.00", cylinders: 3, sale: "75.00", cost: "54.00", profit: "21.00", collected: "0.00", netSoFar: "-54.00", handedCylinders: 0, done: false });

    await recordPayment(actor, { clientOpId: key(), entitlementId: ents[0].id, amount: "25" });
    await recordPayment(actor, { clientOpId: key(), entitlementId: ents[1].id, amount: "50" });
    await handOver(actor, { clientOpId: key(), entitlementId: ents[0].id, nationalId: rows[0].id });
    p = (await statementProfits(actor)).items[0];
    expect(p).toMatchObject({ collected: "75.00", remaining: "0.00", netSoFar: "21.00", handedCylinders: 1, done: false });

    await handOver(actor, { clientOpId: key(), entitlementId: ents[1].id, nationalId: rows[1].id });
    const all = await statementProfits(actor);
    expect(all.items[0]).toMatchObject({ handedCylinders: 3, done: true, profit: "21.00" });
    expect(all.totals).toEqual({ profit: "21.00", realized: "21.00", missingCost: 0 });
  });

  it("بلا سعر موزّع: لا ربح محسوب حتى يُكتب، ويُعدَّل بعد الاعتماد دون تغيير المطلوب من الناس", async () => {
    const { actor } = await setup();
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([{ id: newId(), name: "شخص بلا تكلفة", number: 1, qty: 2 }])), { unitPrice: "30" });
    await approveStatement(actor, up.id, { confirm: true });
    let r = await statementProfits(actor);
    expect(r.items[0]).toMatchObject({ costPrice: null, profit: null, margin: null, sale: "60.00" });
    expect(r.totals.missingCost).toBe(1);

    await expect(setStatementCost(actor, up.id, { costPrice: "-1" })).rejects.toThrow();
    await setStatementCost(actor, up.id, { costPrice: "32" });
    r = await statementProfits(actor);
    expect(r.items[0]).toMatchObject({ margin: "-2.00", profit: "-4.00" }); // خسارة تظهر كما هي
    expect((await ownerDb.entitlement.findFirstOrThrow({ where: { statementId: up.id } })).amountDue.toFixed(2)).toBe("60.00");
    expect(await lastStatementCost(actor)).toBe("32.00");
    const logs = await ownerDb.auditLog.findMany({ where: { entityId: up.id, action: "statement.cost" } });
    expect(logs).toHaveLength(1);
  });

  it("كل كشف بأسعاره، والتبديل يرث سعر الموزّع، والمحذوف لا يُحسب", async () => {
    const { actor } = await setup();
    const a = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([{ id: newId(), name: "شخص أ", number: 1 }], { title: header("1") })), { unitPrice: "20", costPrice: "15" });
    const b = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([{ id: newId(), name: "شخص ب", number: 1 }], { title: header("2") })), { unitPrice: "28", costPrice: "20" });
    await approveStatement(actor, a.id, { confirm: true });
    await approveStatement(actor, b.id, { confirm: true });
    const r = await statementProfits(actor);
    expect(Object.fromEntries(r.items.map((i) => [i.id, i.profit]))).toEqual({ [a.id]: "5.00", [b.id]: "8.00" });
    expect(r.totals.profit).toBe("13.00");

    const rowsB = [{ id: newId(), name: "شخص ب", number: 1 }];
    const v2 = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsB, { title: header("2") })), { supersedesId: b.id });
    expect((await ownerDb.statement.findUniqueOrThrow({ where: { id: v2.id } })).costPrice?.toFixed(2)).toBe("20.00");

    await withdrawStatement(actor, a.id, { reason: "رُفع بالخطأ" });
    expect((await statementProfits(actor)).items.map((i) => i.id)).toEqual([b.id]);
  });
});
