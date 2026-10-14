import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createCycle } from "@/server/services/cycles";
import { approveStatement, uploadStatement } from "@/server/services/statements";
import { deliverCylinder, fillCylinders, receiveEmpty } from "@/server/services/operations";
import { recordPayment } from "@/server/services/finance";
import { offlineSnapshot, type OfflineSnapshot } from "@/server/services/offline";
import { makeAdmin, makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function setup(rows: Row[]) {
  const d = await makeDistributor();
  await createCycle(d.actor, { unitPrice: "20" });
  const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(rows)), {});
  await approveStatement(d.actor, up.id, { confirm: true });
  const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, include: { citizen: true } });
  const ent = (nid: string) => ents.find((e) => e.citizen.nationalId === nid)!;
  return { ...d, ent };
}
const person = (n = 1): Row => ({ id: newId(), name: `مواطن دون اتصال ${n}`, number: 300 + n, phone: "0599123456" });
const cases = (distributorId: string) => ownerDb.reviewCase.findMany({ where: { distributorId, type: "OFFLINE_CONFLICT" } });
const setPolicy = (data: Partial<{ offlineReceive: boolean; offlineDeliver: boolean; offlinePayments: boolean; offlineMaxAgeHours: number }>) =>
  ownerDb.systemSettings.update({ where: { id: 1 }, data });

afterEach(async () => {
  await setPolicy({ offlineReceive: true, offlineDeliver: true, offlinePayments: true, offlineMaxAgeHours: 24 });
});

describe("لقطة الشباك للجهاز", () => {
  it("تحوي المستحقين وجرارهم والمتبقي، دون أرقام الهواتف، ولموزّعها فقط", async () => {
    const a = person(1);
    const { actor, ent } = await setup([a, person(2)]);
    const other = await setup([person(3)]);
    await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id });
    const s = (await offlineSnapshot(actor)) as OfflineSnapshot;
    expect(s.citizens).toHaveLength(2);
    const c = s.citizens.find((x) => x.nationalId === a.id)!;
    expect(c.entitlements[0]).toMatchObject({ citizenNumber: "301", quantity: 1, amountDue: "20.00", paid: "0.00", billable: true });
    expect(c.entitlements[0].cylinders).toEqual([expect.objectContaining({ label: "301", status: "EMPTY", seq: 1 })]);
    expect(JSON.stringify(s)).not.toContain("0599123456");
    expect(s.policy).toEqual({ receive: true, deliver: true, payments: true, maxAgeHours: 24 });
    const others = (await offlineSnapshot(other.actor)) as OfflineSnapshot;
    expect(others.citizens.map((x) => x.nationalId)).not.toContain(a.id);
    expect(await ownerDb.auditLog.count({ where: { distributorId: actor.distributorId!, action: "offline.snapshot" } })).toBe(1);
  });

  it("للموزّع فقط، وتعطيل كل العمليات دون اتصال يعطل اللقطة", async () => {
    const { actor: admin } = await makeAdmin();
    await expect(offlineSnapshot(admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { actor } = await setup([person()]);
    await setPolicy({ offlineReceive: false, offlineDeliver: false, offlinePayments: false });
    expect(await offlineSnapshot(actor)).toEqual({ disabled: true });
  });
});

describe("عمليات قائمة الانتظار", () => {
  it("الاستلام: الرقم المعروض على الجهاز إن اختلف عن المستحق يُرفض ولا يُعاد الترقيم، وتُسجل حالة مراجعة واحدة", async () => {
    const r = { ...person(), qty: 2 };
    const { actor, ent } = await setup([r]);
    // جهاز آخر استلم الجرة الأولى، وهذا الجهاز (دون اتصال) عرض الرقم نفسه.
    await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    const opId = key();
    const offline = { clientOpId: opId, entitlementId: ent(r.id).id, nationalId: r.id, expectedLabel: "301-1", offlineAt: ago(60_000), snapshotAt: ago(3_600_000) };
    await expect(receiveEmpty(actor, offline)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(receiveEmpty(actor, offline)).rejects.toMatchObject({ code: "CONFLICT" });
    const cs = await cases(actor.distributorId!);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ sourceOpId: opId, nationalId: r.id, status: "OPEN" });
    expect(cs[0].details).toContain("نُفذ دون اتصال");
    expect(await ownerDb.cylinder.count({ where: { entitlementId: ent(r.id).id } })).toBe(1);
  });

  it("الاستلام دون اتصال الصحيح يُقبل ويُحفظ وقت تنفيذه على الجهاز، وإعادة الإرسال لا تكرره", async () => {
    const r = person();
    const { actor, ent } = await setup([r]);
    const at = ago(5 * 60_000);
    const body = { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id, expectedLabel: "301", offlineAt: at, snapshotAt: ago(3_600_000) };
    const a = await receiveEmpty(actor, body);
    const b = await receiveEmpty(actor, body);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    const op = await ownerDb.cylinderOperation.findUniqueOrThrow({ where: { id: a.operationId } });
    expect(op.offlineAt?.toISOString()).toBe(at);
    expect(await ownerDb.cylinder.count({ where: { entitlementId: ent(r.id).id } })).toBe(1);
  });

  it("التسليم من جهازين: الثاني (دون اتصال) يُرفض ويصبح حالة مراجعة، ولا تسليم مزدوج", async () => {
    const r = person();
    const { actor, ent } = await setup([r]);
    const rec = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: rec.cylinder.id }] });
    await deliverCylinder(actor, { clientOpId: key(), cylinderId: rec.cylinder.id, cylinderLabel: "301", nationalId: r.id });
    await expect(
      deliverCylinder(actor, { clientOpId: key(), cylinderId: rec.cylinder.id, cylinderLabel: "301", nationalId: r.id, offlineAt: ago(60_000), snapshotAt: ago(600_000) }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await ownerDb.cylinderOperation.count({ where: { cylinderId: rec.cylinder.id, type: "DELIVER" } })).toBe(1);
    expect(await cases(actor.distributorId!)).toHaveLength(1);
  });

  it("التحصيل دون اتصال: تاريخه وقت التنفيذ على الجهاز، وما يتجاوز المتبقي (تحصيل من جهاز آخر) حالة مراجعة", async () => {
    const r = person();
    const { actor, ent } = await setup([r]);
    const at = ago(2 * 3_600_000);
    const p = await recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "15", offlineAt: at, snapshotAt: ago(3 * 3_600_000) });
    const row = await ownerDb.payment.findUniqueOrThrow({ where: { id: p.paymentId } });
    expect(row.paidAt.toISOString()).toBe(at);
    expect(row.offlineAt?.toISOString()).toBe(at);
    await expect(
      recordPayment(actor, { clientOpId: key(), entitlementId: ent(r.id).id, amount: "10", offlineAt: ago(60_000), snapshotAt: ago(3 * 3_600_000) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await cases(actor.distributorId!)).toHaveLength(1);
  });

  it("السياسة على الخادم: نوع غير مسموح أو بيانات جهاز أقدم من الحد تُرفض، أما إعادة إرسال عملية متصلة فلا تخضع لها", async () => {
    const r = person();
    const { actor, ent } = await setup([r]);
    await setPolicy({ offlinePayments: false, offlineMaxAgeHours: 2 });
    const base = { entitlementId: ent(r.id).id, amount: "5" };
    await expect(recordPayment(actor, { ...base, clientOpId: key(), offlineAt: ago(60_000), snapshotAt: ago(600_000) })).rejects.toMatchObject({ code: "INVALID_STATE" });
    // إعادة إرسال عملية متصلة لم يصل تأكيدها: وقت التنفيذ فقط دون وقت لقطة.
    await recordPayment(actor, { ...base, clientOpId: key(), offlineAt: ago(60_000) });
    await setPolicy({ offlinePayments: true });
    await expect(recordPayment(actor, { ...base, clientOpId: key(), offlineAt: ago(60_000), snapshotAt: ago(3 * 3_600_000) })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await cases(actor.distributorId!)).toHaveLength(2);
  });

  it("يُرفض وقت تنفيذ في المستقبل (ساعة جهاز خاطئة)", async () => {
    const r = person();
    const { actor, ent } = await setup([r]);
    await expect(
      receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id, offlineAt: new Date(Date.now() + 3_600_000).toISOString() }),
    ).rejects.toThrow();
  });
});
