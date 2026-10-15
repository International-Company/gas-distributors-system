import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createCycle } from "@/server/services/cycles";
import { approveStatement, uploadStatement } from "@/server/services/statements";
import { receiveEmpty } from "@/server/services/operations";
import { recordPayment } from "@/server/services/finance";
import { cancelHandover, handOver } from "@/server/services/handovers";
import { sheet } from "@/server/services/sheet";
import { offlineSnapshot, type OfflineSnapshot } from "@/server/services/offline";
import { runReport } from "@/server/reports/service";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const people = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: newId(), name: `شخص الكشف ${i + 1}`, number: i + 1 }));

async function setup(rows: Row[], opts: { title?: string } = {}) {
  const d = await makeDistributor();
  await createCycle(d.actor, { unitPrice: "25" });
  const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(rows, opts)), {});
  await approveStatement(d.actor, up.id, { confirm: true });
  const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, include: { citizen: true } });
  const ent = (nid: string) => ents.find((e) => e.citizen.nationalId === nid)!;
  return { ...d, statementId: up.id, ent };
}

afterEach(async () => {
  await ownerDb.systemSettings.update({ where: { id: 1 }, data: { offlineDeliver: true } });
});

describe("صفحة «الكشف»", () => {
  it("تعرض ناس الكشف المعتمد بالترتيب مع المطلوب والمدفوع والمتبقي", async () => {
    const rows = people(3);
    const { actor, statementId, ent } = await setup(rows);
    await recordPayment(actor, { clientOpId: key(), entitlementId: ent(rows[1].id).id, amount: "10" });
    const s = await sheet(actor, {});
    expect(s.statement?.id).toBe(statementId);
    expect(s.rows.map((r) => r.citizenNumber)).toEqual(["1", "2", "3"]);
    expect(s.rows[1]).toMatchObject({ amountDue: "25.00", paid: "10.00", remaining: "15.00", delivered: false, legacy: null });
    expect(s.pending).toBe(0);
  });

  it("دون كشف معتمد: لا صفوف، وكشف موزّع آخر غير موجود", async () => {
    const d = await makeDistributor();
    expect(await sheet(d.actor, {})).toMatchObject({ statement: null, rows: [] });
    const other = await setup(people(1));
    await expect(sheet(d.actor, { statementId: other.statementId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("«سلّم»", () => {
  it("يتطلب مطابقة الهوية؛ الخطأ يُسجل حالة مراجعة ولا يسلّم", async () => {
    const [a] = people(1);
    const { actor, ent } = await setup([a]);
    await expect(handOver(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: newId() })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(await ownerDb.handover.count({ where: { entitlementId: ent(a.id).id } })).toBe(0);
    expect(await ownerDb.reviewCase.count({ where: { distributorId: actor.distributorId!, type: "IDENTITY_MISMATCH" } })).toBe(1);
  });

  it("يسلّم مرة واحدة: إعادة الطلب نفسه تُرجع النتيجة، وطلب جديد يُرفض، وطلبان متزامنان يقبل أحدهما فقط", async () => {
    const [a, b] = people(2);
    const { actor, ent } = await setup([a, b]);
    const k = key();
    const first = await handOver(actor, { clientOpId: k, entitlementId: ent(a.id).id, nationalId: a.id });
    expect(first).toMatchObject({ replayed: false, quantity: 1 });
    expect(await handOver(actor, { clientOpId: k, entitlementId: ent(a.id).id, nationalId: a.id })).toMatchObject({ replayed: true, handoverId: first.handoverId });
    await expect(handOver(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const race = await Promise.allSettled([1, 2, 3].map(() => handOver(actor, { clientOpId: key(), entitlementId: ent(b.id).id, nationalId: b.id })));
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await ownerDb.handover.count({ where: { entitlementId: ent(b.id).id, status: "ACTIVE" } })).toBe(1);
    const s = await sheet(actor, {});
    expect(s.rows.every((r) => r.delivered)).toBe(true);
  });

  it("الإلغاء بسبب يُبقي السجل ويسمح بالتسليم من جديد", async () => {
    const [a] = people(1);
    const { actor, ent } = await setup([a]);
    const h = await handOver(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id });
    await expect(cancelHandover(actor, h.handoverId, { reason: "" })).rejects.toThrow();
    await cancelHandover(actor, h.handoverId, { reason: "سُجل بالخطأ" });
    await expect(cancelHandover(actor, h.handoverId, { reason: "مرة ثانية" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await sheet(actor, {})).rows[0].delivered).toBe(false);
    await handOver(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id });
    expect(await ownerDb.handover.count({ where: { entitlementId: ent(a.id).id } })).toBe(2);
  });

  it("قاعدة البيانات تمنع تسليمين نافذين وتعديل السجل وحذفه", async () => {
    const [a] = people(1);
    const { actor, ent } = await setup([a]);
    const h = await handOver(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id });
    await expect(
      ownerDb.handover.create({ data: { distributorId: actor.distributorId!, entitlementId: ent(a.id).id, quantity: 1, idempotencyKey: key(), userId: actor.userId } }),
    ).rejects.toThrow();
    await expect(ownerDb.$executeRawUnsafe(`UPDATE handovers SET quantity = 5 WHERE id = '${h.handoverId}'`)).rejects.toThrow();
    await expect(ownerDb.$executeRawUnsafe(`DELETE FROM handovers WHERE id = '${h.handoverId}'`)).rejects.toThrow();
  });

  it("لا يخلط بين الطريقتين: من له جرار مسجّلة بالمراحل لا يُسلَّم بـ«سلّم»", async () => {
    const [a] = people(1);
    const { actor, ent } = await setup([a]);
    await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id });
    await expect(handOver(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await sheet(actor, {})).rows[0].legacy).toEqual({ total: 1, delivered: 0 });
  });

  it("بدون نت: السياسة على الخادم، والرفض حالة مراجعة «تعارض مزامنة»", async () => {
    const [a] = people(1);
    const { actor, ent } = await setup([a]);
    await ownerDb.systemSettings.update({ where: { id: 1 }, data: { offlineDeliver: false } });
    await expect(
      handOver(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id, offlineAt: ago(60_000), snapshotAt: ago(600_000) }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await ownerDb.reviewCase.count({ where: { distributorId: actor.distributorId!, type: "OFFLINE_CONFLICT" } })).toBe(1);
  });

  it("يُحسب في التقارير وبيانات الجهاز، ويبقى عليه المتبقي بعد إزالته من إصدار جديد", async () => {
    const [a, b] = people(2);
    const { actor, statementId, ent } = await setup([a, b]);
    await handOver(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id });
    const nd = await runReport(actor, "not-delivered", {});
    expect(nd.rows.map((r) => r.nationalId)).toEqual([b.id]);
    const snap = (await offlineSnapshot(actor)) as OfflineSnapshot;
    expect(snap.statements.map((s) => s.id)).toEqual([statementId]);
    const ea = snap.citizens.find((c) => c.nationalId === a.id)!.entitlements[0];
    expect(ea).toMatchObject({ statementId, handedOver: true });
    // إصدار جديد بلا الشخص المسلَّم: يُزال من الكشف لكنه يبقى قابلًا للتحصيل.
    const v2 = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([b])), { supersedesId: statementId });
    await approveStatement(actor, v2.id, { confirm: true });
    expect((await ownerDb.entitlement.findUniqueOrThrow({ where: { id: ent(a.id).id } })).status).toBe("REMOVED");
    await recordPayment(actor, { clientOpId: key(), entitlementId: ent(a.id).id, amount: "5" });
  });
});
