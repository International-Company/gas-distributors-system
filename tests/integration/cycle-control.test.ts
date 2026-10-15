import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { listCycles, renameCycle, startNextCycle } from "@/server/services/cycles";
import { approveStatement, uploadStatement } from "@/server/services/statements";
import { recordPayment } from "@/server/services/finance";
import { handOver } from "@/server/services/handovers";
import { sheet } from "@/server/services/sheet";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile } from "../helpers/statements";

const header = (scale: string) => `تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : ${scale}`;
const upload = async (actor: Parameters<typeof uploadStatement>[0], scale: string, people: { id: string; name: string }[]) =>
  uploadStatement(actor, xlsxFile(await makeStatementXlsx(people.map((p, i) => ({ ...p, number: i + 1 })), { title: header(scale) })), { unitPrice: "25" });

describe("تحكم الموزّع في الدورات", () => {
  it("أول دورة تبدأ بلا دورة سابقة، وكل دورة فيها أكثر من كشف، والأرقام لكل دورة", async () => {
    const { actor } = await makeDistributor();
    const r = await startNextCycle(actor, {});
    expect(r.closed).toBeNull();
    expect(r.cycle).toMatchObject({ number: 1, name: "الدورة 1", status: "OPEN" });
    const a = await upload(actor, "1", [{ id: newId(), name: "شخص دورة أ" }]);
    const b = await upload(actor, "2", [{ id: newId(), name: "شخص دورة ب" }, { id: newId(), name: "شخص دورة ج" }]);
    await approveStatement(actor, a.id, { confirm: true });
    await approveStatement(actor, b.id, { confirm: true });
    const [c] = await listCycles(actor);
    expect(c).toMatchObject({ approvedStatements: 2, pendingStatements: 0, citizens: 3, cylinders: 3 });
    expect(c.amountDue.toFixed(2)).toBe("75.00");
  });

  it("دورة جديدة تنهي الحالية بخطوة واحدة، والكشوف السابقة يبقى تسليمها وقبضها شغّالًا", async () => {
    const { actor } = await makeDistributor();
    await startNextCycle(actor, {});
    const p = { id: newId(), name: "شخص الدورة القديمة" };
    const a = await upload(actor, "7", [p]);
    await approveStatement(actor, a.id, { confirm: true });

    const r = await startNextCycle(actor, { name: "دورة تشرين" });
    expect(r.closed?.name).toBe("الدورة 1");
    expect(r.cycle).toMatchObject({ number: 2, name: "دورة تشرين" });
    expect(r.cycle.unitPrice.toFixed(2)).toBe("25.00");
    const cycles = await listCycles(actor);
    expect(cycles.map((c) => [c.name, c.status])).toEqual([["دورة تشرين", "OPEN"], ["الدورة 1", "CLOSED"]]);

    // الكشف القديم ما زال يعمل
    const ent = await ownerDb.entitlement.findFirstOrThrow({ where: { statementId: a.id } });
    await recordPayment(actor, { clientOpId: randomUUID(), entitlementId: ent.id, amount: "25" });
    await handOver(actor, { clientOpId: randomUUID(), entitlementId: ent.id, nationalId: p.id });
    expect((await sheet(actor, { statementId: a.id })).rows[0]).toMatchObject({ delivered: true, remaining: "0.00" });
    expect((await listCycles(actor))[1].collected.toFixed(2)).toBe("25.00");

    // والكشف الجديد ينضاف للدورة الجديدة (والشخص نفسه يرجع في دورة جديدة)
    const b = await upload(actor, "8", [p]);
    expect((await ownerDb.statement.findUniqueOrThrow({ where: { id: b.id } })).cycleId).toBe(r.cycle.id);
    await approveStatement(actor, b.id, { confirm: true });
    expect(await ownerDb.entitlement.count({ where: { citizen: { nationalId: p.id }, status: "ACTIVE" } })).toBe(2);
  });

  it("لا دورة جديدة وفي الحالية كشف بانتظار الاعتماد؛ وتغيير الاسم مسجّل", async () => {
    const { actor } = await makeDistributor();
    const { cycle } = await startNextCycle(actor, {});
    await upload(actor, "3", [{ id: newId(), name: "شخص معلق" }]);
    await expect(startNextCycle(actor, {})).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await listCycles(actor)).length).toBe(1);

    await expect(renameCycle(actor, cycle.id, { name: " " })).rejects.toThrow();
    await renameCycle(actor, cycle.id, { name: "دورة العيد" });
    expect((await listCycles(actor))[0].name).toBe("دورة العيد");
    expect(await ownerDb.auditLog.count({ where: { entityId: cycle.id, action: "cycle.rename" } })).toBe(1);
  });
});
