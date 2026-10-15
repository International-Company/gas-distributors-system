import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCycle } from "@/server/services/cycles";
import { approveStatement, uploadStatement } from "@/server/services/statements";
import { cancelPayment, createExpense, createStationPayment, recordPayment } from "@/server/services/finance";
import { createStation } from "@/server/services/shipments";
import { moneyOverview } from "@/server/services/money";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function setup() {
  const d = await makeDistributor();
  await createCycle(d.actor, { unitPrice: "20" });
  const rows: Row[] = [1, 2, 3].map((i) => ({ id: newId(), name: `شخص الفلوس ${i}`, number: i }));
  const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(rows)), {});
  await approveStatement(d.actor, up.id, { confirm: true });
  const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, include: { citizen: true }, orderBy: { citizenNumber: "asc" } });
  return { ...d, ents };
}

describe("صفحة «الفلوس»", () => {
  it("معك الآن = كل المقبوض − كل المصاريف (ومنها دفعات المحطات)، والفترة «اليوم» تعرض حركات اليوم فقط", async () => {
    const { actor, ents } = await setup();
    await recordPayment(actor, { clientOpId: key(), entitlementId: ents[0].id, amount: "20" });
    await recordPayment(actor, { clientOpId: key(), entitlementId: ents[1].id, amount: "15", paidAt: daysAgo(3) });
    await createExpense(actor, { clientOpId: key(), amount: "5", description: "أجرة نقل" });
    const st = await createStation(actor, { name: "محطة الاختبار" });
    await createStationPayment(actor, { clientOpId: key(), stationId: st.id, amount: "10", paidAt: daysAgo(3) });

    const today = await moneyOverview(actor, {});
    expect(today.cashInHand).toBe("20.00"); // 35 − 5 − 10
    expect(today.allTime).toEqual({ collected: "35.00", spent: "15.00" });
    expect(today.inPeriod).toMatchObject({ collected: "20.00", collectedCount: 1, spent: "5.00", spentCount: 1, net: "15.00" });
    expect(today.days).toHaveLength(1);
    expect(today.days[0].items.map((i) => i.kind).sort()).toEqual(["EXPENSE", "PAYMENT"]);

    const week = await moneyOverview(actor, { period: "week" });
    expect(week.inPeriod).toMatchObject({ collected: "35.00", spent: "15.00", net: "20.00" });
    expect(week.days).toHaveLength(2);
    expect(week.days[1].items.find((i) => i.kind === "STATION_PAYMENT")).toMatchObject({ amount: "-10.00", title: "دفعة لمحطة محطة الاختبار" });

    expect((await moneyOverview(actor, { period: "custom", from: "2020-01-01", to: "2020-12-31" })).inPeriod.collected).toBe("0.00");
    await expect(moneyOverview(actor, { period: "custom", from: "2026-02-01", to: "2026-01-01" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("باقي على الناس ونسبة المقبوض، والملغى لا يُحسب", async () => {
    const { actor, ents } = await setup();
    const p = await recordPayment(actor, { clientOpId: key(), entitlementId: ents[0].id, amount: "20" });
    await recordPayment(actor, { clientOpId: key(), entitlementId: ents[1].id, amount: "5" });
    let m = await moneyOverview(actor, { period: "all" });
    expect(m.dues).toEqual({ due: "60.00", paid: "25.00", remaining: "35.00", owing: 2 });
    await cancelPayment(actor, p.paymentId, { reason: "سُجل بالخطأ" });
    m = await moneyOverview(actor, { period: "all" });
    expect(m.dues).toMatchObject({ paid: "5.00", remaining: "55.00", owing: 3 });
    expect(m.cashInHand).toBe("5.00");
  });

  it("عزل الموزّعين", async () => {
    const a = await setup();
    await recordPayment(a.actor, { clientOpId: key(), entitlementId: a.ents[0].id, amount: "20" });
    const b = await makeDistributor();
    const m = await moneyOverview(b.actor, { period: "all" });
    expect(m.cashInHand).toBe("0.00");
    expect(m.days).toHaveLength(0);
  });
});
