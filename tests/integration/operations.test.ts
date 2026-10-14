import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db";
import { closeCycle, createCycle } from "@/server/services/cycles";
import { approveStatement, getStatement, uploadStatement } from "@/server/services/statements";
import { editEntitlement } from "@/server/services/citizens";
import {
  cancelOperation, counterLookup, cylinderLabel, deliverCylinder, fillCylinders, getCylinder, receiveEmpty,
} from "@/server/services/operations";
import { cancelShipment, createStation, receiveShipment } from "@/server/services/shipments";
import { getInventory } from "@/server/services/inventory";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

const key = () => randomUUID();

async function setup(rows: Row[]) {
  const d = await makeDistributor();
  const cycle = await createCycle(d.actor, { unitPrice: "20" });
  const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(rows)), {});
  await approveStatement(d.actor, up.id, { confirm: true });
  const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, include: { citizen: true } });
  const ent = (nid: string) => ents.find((e) => e.citizen.nationalId === nid)!;
  return { ...d, cycle, statementId: up.id, ent };
}

const one = () => ({ id: newId(), name: "مواطن اختبار", number: Math.floor(Math.random() * 9000) + 100 });
const inv = async (a: Parameters<typeof getInventory>[0]) => (await getInventory(a)).balance;

describe("استلام الجرة الفارغة", () => {
  it("يتحقق من الهوية ويستلم ويزيد مخزون الفارغ ويحمل رقم المواطن", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const res = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    expect(res.cylinder.label).toBe(String(r.number));
    expect(res.cylinder.status).toBe("EMPTY");
    expect(await inv(actor)).toEqual({ empty: 1, filled: 0, extra: 0 });
  });

  it("هوية لا تطابق: تتوقف العملية وتُسجل حالة مراجعة، ولا تجاوز", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    await expect(receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: newId() })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(await ownerDb.cylinder.count({ where: { entitlementId: ent(r.id).id } })).toBe(0);
    expect(await ownerDb.reviewCase.count({ where: { distributorId: actor.distributorId!, type: "IDENTITY_MISMATCH" } })).toBe(1);
    await expect(receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: "" })).rejects.toThrow();
  });

  it("لا يُستلم أكثر من المستحق، والجرار المتعددة ترقم بلاحقة", async () => {
    const r = { ...one(), qty: 2 };
    const { actor, ent } = await setup([r]);
    const a = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    const b = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    expect([a.cylinder.label, b.cylinder.label]).toEqual([`${r.number}-1`, `${r.number}-2`]);
    await expect(receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(cylinderLabel("7", 1, 1)).toBe("7");
  });

  it("إعادة إرسال الطلب نفسه لا تنفذه مرتين، حتى بالتزامن", async () => {
    const r = { ...one(), qty: 3 };
    const { actor, ent } = await setup([r]);
    const k = key();
    const body = { clientOpId: k, entitlementId: ent(r.id).id, nationalId: r.id };
    const results = await Promise.all([receiveEmpty(actor, body), receiveEmpty(actor, body), receiveEmpty(actor, body)]);
    expect(new Set(results.map((x) => x.operationId)).size).toBe(1);
    expect(results.filter((x) => x.replayed).length).toBe(2);
    expect(await ownerDb.cylinder.count({ where: { entitlementId: ent(r.id).id } })).toBe(1);
    expect((await inv(actor)).empty).toBe(1);
  });

  it("لا استلام في دورة مغلقة", async () => {
    const r = one();
    const { actor, ent, cycle } = await setup([r]);
    await closeCycle(actor, cycle.id, { confirm: true });
    await expect(receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("التعبئة", () => {
  it("لا تعبئة لجرة لم تُسجل فارغة، ولا تعبئة مكررة", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const { cylinder } = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    await expect(fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: randomUUID() }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cylinder.id }] });
    await expect(fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cylinder.id }] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await inv(actor)).toEqual({ empty: 0, filled: 1, extra: 0 });
  });

  it("التعبئة الجماعية كلها أو لا شيء", async () => {
    const rows = [one(), one(), one()];
    const { actor, ent } = await setup(rows);
    const cyl = [];
    for (const r of rows.slice(0, 2)) cyl.push((await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id })).cylinder.id);
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cyl[0] }] });
    // الأولى معبأة بالفعل → يفشل الطلب كله ولا تُعبأ الثانية.
    await expect(fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cyl[1] }, { clientOpId: key(), cylinderId: cyl[0] }] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await ownerDb.cylinder.findUniqueOrThrow({ where: { id: cyl[1] } })).status).toBe("EMPTY");
    const ok = await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cyl[1] }] });
    expect(ok.filled).toBe(1);
  });

  it("طلب التعبئة نفسه مرسلًا مرتين بالتزامن ينفذ مرة واحدة دون خطأ", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const { cylinder } = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    const body = { items: [{ clientOpId: key(), cylinderId: cylinder.id }] };
    const res = await Promise.all([fillCylinders(actor, body), fillCylinders(actor, body)]);
    expect(res.map((x) => x.filled).sort()).toEqual([0, 1]);
    expect((await inv(actor)).filled).toBe(1);
  });

  it("القيد في قاعدة البيانات يمنع تعبئتين نافذتين لجرة واحدة", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const { cylinder } = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cylinder.id }] });
    await expect(
      ownerDb.cylinderOperation.create({ data: { distributorId: actor.distributorId!, cylinderId: cylinder.id, type: "FILL", idempotencyKey: key(), userId: actor.userId } }),
    ).rejects.toThrow();
  });
});

describe("التسليم", () => {
  async function ready() {
    const r = one();
    const s = await setup([r]);
    const { cylinder } = await receiveEmpty(s.actor, { clientOpId: key(), entitlementId: s.ent(r.id).id, nationalId: r.id });
    return { ...s, r, cylinder };
  }

  it("لا تسليم لجرة غير جاهزة", async () => {
    const { actor, r, cylinder } = await ready();
    await expect(deliverCylinder(actor, { clientOpId: key(), cylinderId: cylinder.id, cylinderLabel: cylinder.label, nationalId: r.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("يتطلب مطابقة الهوية ورقم الجرة، ثم ينقص المعبأ مرة واحدة", async () => {
    const { actor, r, cylinder } = await ready();
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cylinder.id }] });
    await expect(deliverCylinder(actor, { clientOpId: key(), cylinderId: cylinder.id, cylinderLabel: "999999", nationalId: r.id })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(deliverCylinder(actor, { clientOpId: key(), cylinderId: cylinder.id, cylinderLabel: cylinder.label, nationalId: newId() })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    const k = key();
    const body = { clientOpId: k, cylinderId: cylinder.id, cylinderLabel: ` ${cylinder.label} `, nationalId: r.id };
    const [a, b] = await Promise.all([deliverCylinder(actor, body), deliverCylinder(actor, body)]);
    expect(a.operationId).toBe(b.operationId);
    await expect(deliverCylinder(actor, { ...body, clientOpId: key() })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await inv(actor)).toEqual({ empty: 0, filled: 0, extra: 0 });
    expect(await ownerDb.cylinderOperation.count({ where: { cylinderId: cylinder.id, type: "DELIVER" } })).toBe(1);
  });

  it("تسليمان متزامنان بمعرّفين مختلفين: ينجح واحد فقط", async () => {
    const { actor, r, cylinder } = await ready();
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cylinder.id }] });
    const body = () => ({ clientOpId: key(), cylinderId: cylinder.id, cylinderLabel: cylinder.label, nationalId: r.id });
    const res = await Promise.allSettled([deliverCylinder(actor, body()), deliverCylinder(actor, body()), deliverCylinder(actor, body())]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await inv(actor)).filled).toBe(0);
  });

  it("العمليات لا تغيّر أي مبلغ مالي", async () => {
    const { actor, r, cylinder, ent } = await ready();
    const before = await ownerDb.entitlement.findUniqueOrThrow({ where: { id: ent(r.id).id } });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cylinder.id }] });
    await deliverCylinder(actor, { clientOpId: key(), cylinderId: cylinder.id, cylinderLabel: cylinder.label, nationalId: r.id });
    const after = await ownerDb.entitlement.findUniqueOrThrow({ where: { id: ent(r.id).id } });
    expect(after.amountDue.equals(before.amountDue)).toBe(true);
  });
});

describe("الإلغاء", () => {
  it("يعكس الأثر مرة واحدة، ويحترم العمليات التابعة، ويتطلب سببًا", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const rec = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: rec.cylinder.id }] });
    const fillOp = await ownerDb.cylinderOperation.findFirstOrThrow({ where: { cylinderId: rec.cylinder.id, type: "FILL" } });
    await expect(cancelOperation(actor, rec.operationId, { reason: "خطأ" })).rejects.toMatchObject({ code: "INVALID_STATE" }); // التعبئة تابعة
    await expect(cancelOperation(actor, fillOp.id, {})).rejects.toThrow();
    await cancelOperation(actor, fillOp.id, { reason: "سجلت بالخطأ" });
    expect(await inv(actor)).toEqual({ empty: 1, filled: 0, extra: 0 });
    await expect(cancelOperation(actor, fillOp.id, { reason: "مرة ثانية" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const results = await Promise.allSettled([cancelOperation(actor, rec.operationId, { reason: "إلغاء" }), cancelOperation(actor, rec.operationId, { reason: "إلغاء" })]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await inv(actor)).toEqual({ empty: 0, filled: 0, extra: 0 });
    expect((await ownerDb.cylinder.findUniqueOrThrow({ where: { id: rec.cylinder.id } })).status).toBe("VOID");
    expect(await ownerDb.inventoryMovement.count({ where: { distributorId: actor.distributorId!, type: "REVERSAL" } })).toBe(2);
    // بعد الإلغاء يمكن الاستلام من جديد بالرقم نفسه.
    const again = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    expect(again.cylinder.label).toBe(rec.cylinder.label);
    const detail = await getCylinder(actor, rec.cylinder.id);
    expect(detail.operations.map((o) => o.status)).toEqual(["CANCELLED", "CANCELLED"]);
  });

  it("سجل حركة المخزون للإضافة فقط، والرصيد لا يصبح سالبًا", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    const mv = await ownerDb.inventoryMovement.findFirstOrThrow({ where: { distributorId: actor.distributorId! } });
    await expect(ownerDb.inventoryMovement.update({ where: { id: mv.id }, data: { emptyDelta: 5 } })).rejects.toThrow();
    await expect(withTenant(actor.distributorId!, (tx) => tx.inventoryBalance.update({ where: { distributorId: actor.distributorId! }, data: { filled: -1 } }))).rejects.toThrow();
  });
});

describe("الشحنات", () => {
  it("تعبئ الجرار المختارة وتسجل الباقي كمية إضافية: لا تضاعف للمخزون", async () => {
    const rows = [one(), one(), one()];
    const { actor, ent } = await setup(rows);
    const cyl = [];
    for (const r of rows) cyl.push((await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id })).cylinder.id);
    const station = await createStation(actor, { name: `محطة ${randomUUID().slice(0, 4)}`, defaultUnitPrice: "18" });
    const k = key();
    const body = { clientOpId: k, stationId: station.id, quantity: 5, cylinderIds: cyl.slice(0, 2), reference: "INV-1" };
    const sh = await receiveShipment(actor, body);
    expect((await receiveShipment(actor, body)).replayed).toBe(true);
    expect(await inv(actor)).toEqual({ empty: 1, filled: 2, extra: 3 });
    const s = await ownerDb.shipment.findUniqueOrThrow({ where: { id: sh.id } });
    expect([s.quantity, s.linkedCount, s.extraCount]).toEqual([5, 2, 3]);
    expect(await ownerDb.cylinderOperation.count({ where: { shipmentId: sh.id, type: "FILL" } })).toBe(2);
    // جرة عُبئت ضمن الشحنة لا تُعبأ مرة أخرى.
    await expect(fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: cyl[0] }] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const rec = await getInventory(actor);
    expect(rec.reconciled).toBe(true);
  });

  it("إلغاء الشحنة يعكس تعبئاتها وكميتها مرة واحدة، ويُمنع إن سُلّمت إحدى جرارها", async () => {
    const rows = [one(), one()];
    const { actor, ent } = await setup(rows);
    const cyl = [];
    for (const r of rows) cyl.push((await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id })).cylinder);
    const station = await createStation(actor, { name: `محطة ${randomUUID().slice(0, 4)}`, defaultUnitPrice: "18" });
    const sh = await receiveShipment(actor, { clientOpId: key(), stationId: station.id, quantity: 3, cylinderIds: cyl.map((c) => c.id) });
    await deliverCylinder(actor, { clientOpId: key(), cylinderId: cyl[0].id, cylinderLabel: cyl[0].label, nationalId: rows[0].id });
    await expect(cancelShipment(actor, sh.id, { reason: "خطأ في التسجيل" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const deliverOp = await ownerDb.cylinderOperation.findFirstOrThrow({ where: { cylinderId: cyl[0].id, type: "DELIVER" } });
    await cancelOperation(actor, deliverOp.id, { reason: "تسليم سجل بالخطأ" });
    // تعبئة الشحنة لا تُلغى منفردة.
    const fillOp = await ownerDb.cylinderOperation.findFirstOrThrow({ where: { cylinderId: cyl[0].id, type: "FILL" } });
    await expect(cancelOperation(actor, fillOp.id, { reason: "منفردة" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await cancelShipment(actor, sh.id, { reason: "خطأ في التسجيل" });
    expect(await inv(actor)).toEqual({ empty: 2, filled: 0, extra: 0 });
    await expect(cancelShipment(actor, sh.id, { reason: "مرة ثانية" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await getInventory(actor)).reconciled).toBe(true);
  });

  it("لا يُقبل عدد جرار مواطنين أكبر من الكمية المستلمة", async () => {
    const r = one();
    const { actor, ent } = await setup([r]);
    const c = await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    const station = await createStation(actor, { name: `محطة ${randomUUID().slice(0, 4)}`, defaultUnitPrice: "18" });
    await expect(receiveShipment(actor, { clientOpId: key(), stationId: station.id, quantity: 0, cylinderIds: [c.cylinder.id] })).rejects.toThrow();
  });
});

describe("أثر تعديل الكشف على الجرار", () => {
  it("يمنع تغيير رقم المواطن أو إنقاص العدد تحت المستلم، ويُبقي جرار المُزال قابلة للتسليم", async () => {
    const a = { ...one(), qty: 2 };
    const b = one();
    const { actor, ent, statementId } = await setup([a, b]);
    await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id });
    await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(a.id).id, nationalId: a.id });
    const bCyl = (await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(b.id).id, nationalId: b.id })).cylinder;

    await expect(editEntitlement(actor, ent(a.id).id, { quantity: 1, reason: "تصحيح" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(editEntitlement(actor, ent(a.id).id, { citizenNumber: "77777", reason: "تصحيح" })).rejects.toMatchObject({ code: "INVALID_STATE" });

    // إصدار جديد: أ بعدد أقل، ب غير موجود.
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([{ ...a, qty: 1 }])), { supersedesId: statementId });
    const st = await getStatement(actor, up.id);
    expect((st.rows[0].issues as { code: string }[]).map((i) => i.code)).toContain("QTY_BELOW_RECEIVED");
    expect(st.diff!.removed[0]).toMatchObject({ nationalId: b.id, received: 1 });

    // الإصدار بالعدد الصحيح يُعتمد، ويُزال ب مع بقاء جرته.
    const up2 = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([a], { title: "v3" })), { supersedesId: statementId });
    await approveStatement(actor, up2.id, { confirm: true });
    expect((await ownerDb.entitlement.findUniqueOrThrow({ where: { id: ent(b.id).id } })).status).toBe("REMOVED");
    await fillCylinders(actor, { items: [{ clientOpId: key(), cylinderId: bCyl.id }] });
    await deliverCylinder(actor, { clientOpId: key(), cylinderId: bCyl.id, cylinderLabel: bCyl.label, nationalId: b.id });
    await expect(receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(b.id).id, nationalId: b.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("الشباك والعزل", () => {
  it("البحث برقم الهوية يعرض الاستحقاق وجراره، ولا يجد مواطني موزّع آخر", async () => {
    const r = { ...one(), qty: 2 };
    const { actor, ent } = await setup([r]);
    await receiveEmpty(actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id });
    const l = await counterLookup(actor, { nationalId: r.id });
    expect(l.found).toBe(true);
    if (l.found) {
      expect(l.entitlements[0]).toMatchObject({ remaining: 1, canReceive: true });
      expect(l.entitlements[0].cylinders).toHaveLength(1);
    }
    const other = await makeDistributor();
    expect((await counterLookup(other.actor, { nationalId: r.id })).found).toBe(false);
    await expect(receiveEmpty(other.actor, { clientOpId: key(), entitlementId: ent(r.id).id, nationalId: r.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("الشباك يرفض رقم هوية غير صالح", async () => {
    const { actor } = await makeDistributor();
    await expect(counterLookup(actor, { nationalId: "123456789" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
