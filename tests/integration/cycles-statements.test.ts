import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db";
import { changeCyclePrice, closeCycle, createCycle, reopenCycle } from "@/server/services/cycles";
import {
  approveStatement, discardStatement, getStatement, updateMapping, updateRow, updateStatementMeta, uploadStatement,
} from "@/server/services/statements";
import { readOwnFile } from "@/server/services/files";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

async function setup(price = "25") {
  const d = await makeDistributor();
  const cycle = await createCycle(d.actor, { unitPrice: price });
  return { ...d, cycle };
}

const rowsOf = (n: number, startNumber = 1): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: newId(), name: `مواطن رقم ${i + 1} اختبار`, number: startNumber + i }));

async function importAndApprove(actor: Parameters<typeof uploadStatement>[0], rows: Row[], meta: Record<string, unknown> = {}, opts = {}) {
  const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows, opts)), meta);
  await approveStatement(actor, up.id, { confirm: true });
  return up.id;
}

describe("الدورات", () => {
  it("دورة نشطة واحدة فقط لكل موزّع", async () => {
    const { actor } = await setup();
    await expect(createCycle(actor, { unitPrice: "20" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("القيد في قاعدة البيانات يمنع دورتين نشطتين حتى لو تجاوز الكود الفحص", async () => {
    const { actor, cycle } = await setup();
    await expect(
      ownerDb.cycle.create({ data: { distributorId: actor.distributorId!, number: 99, name: "x", unitPrice: 1, currencyCode: "ILS", openedById: actor.userId } }),
    ).rejects.toThrow();
    expect(cycle.status).toBe("OPEN");
  });

  it("الإغلاق يتطلب التأكيد، ويُمنع بوجود كشف قيد المراجعة، ويسجل المستخدم والوقت", async () => {
    const { actor, cycle } = await setup();
    await expect(closeCycle(actor, cycle.id, {})).rejects.toThrow();
    await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(2))), {});
    await expect(closeCycle(actor, cycle.id, { confirm: true })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const d2 = await setup();
    const closed = await closeCycle(d2.actor, d2.cycle.id, { confirm: true });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedById).toBe(d2.actor.userId);
    expect(closed.closedAt).not.toBeNull();
  });

  it("إعادة الفتح تتطلب سببًا، وتُمنع بوجود دورة نشطة أخرى", async () => {
    const { actor, cycle } = await setup();
    await closeCycle(actor, cycle.id, { confirm: true });
    const c2 = await createCycle(actor, { unitPrice: "30" });
    expect(c2.number).toBe(cycle.number + 1);
    await expect(reopenCycle(actor, cycle.id, { reason: "تصحيح" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await closeCycle(actor, c2.id, { confirm: true });
    await expect(reopenCycle(actor, cycle.id, {})).rejects.toThrow();
    const re = await reopenCycle(actor, cycle.id, { reason: "تصحيح كشف متأخر" });
    expect(re.status).toBe("OPEN");
    const ev = await ownerDb.cycleEvent.findFirstOrThrow({ where: { cycleId: cycle.id, type: "REOPENED" } });
    expect(ev.reason).toBe("تصحيح كشف متأخر");
  });

  it("تغيير السعر لا يغيّر مبالغ الاستحقاقات المعتمدة سابقًا", async () => {
    const { actor, cycle } = await setup("25");
    await importAndApprove(actor, rowsOf(2));
    await changeCyclePrice(actor, cycle.id, { unitPrice: "40", reason: "قرار الهيئة" });
    const ents = await ownerDb.entitlement.findMany({ where: { cycleId: cycle.id } });
    expect(ents.every((e) => e.amountDue.toFixed(2) === "25.00" && e.unitPrice.toFixed(2) === "25.00")).toBe(true);
  });
});

describe("استيراد الكشوف ومراجعتها", () => {
  it("يستخرج الصفوف من Excel ويحدد الأعمدة ويقترح الدورة، دون إنشاء أي استحقاق", async () => {
    const { actor } = await setup();
    const rows = rowsOf(5);
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), { title: "كشف اختبار" });
    const st = await getStatement(actor, up.id);
    expect(st.statement.status).toBe("PENDING_REVIEW");
    expect(st.statement.suggestedCycle).toBe("7");
    expect(st.total).toBe(5);
    expect(st.summary.ok).toBe(5);
    expect(st.rows[0].nationalId).toBe(rows[0].id);
    expect(st.rows[0].citizenNumber).toBe("1");
    expect(await ownerDb.entitlement.count({ where: { distributorId: actor.distributorId! } })).toBe(0);
    expect(await ownerDb.citizen.count({ where: { distributorId: actor.distributorId! } })).toBe(0);
  });

  it("يحفظ الملف الأصلي ويقرؤه صاحبه فقط", async () => {
    const a = await setup();
    const b = await setup();
    const buf = await makeStatementXlsx(rowsOf(1));
    const up = await uploadStatement(a.actor, xlsxFile(buf), {});
    const st = await getStatement(a.actor, up.id);
    const f = await readOwnFile(a.actor, st.statement.file.id);
    expect(Buffer.compare(f.data, buf)).toBe(0);
    await expect(readOwnFile(b.actor, st.statement.file.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getStatement(b.actor, up.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ينبه إلى الملف المكرر", async () => {
    const { actor } = await setup();
    const buf = await makeStatementXlsx(rowsOf(2));
    const first = await uploadStatement(actor, xlsxFile(buf), {});
    const second = await uploadStatement(actor, xlsxFile(buf), {});
    expect(second.duplicateOf.map((d) => d.id)).toContain(first.id);
  });

  it("يعلّم الأخطاء: هوية غير صالحة، تكرار في الملف، اسم مفقود", async () => {
    const { actor } = await setup();
    const dup = newId();
    const rows: Row[] = [
      { id: "123456789", name: "رقم خاطئ", number: 1 },
      { id: dup, name: "مكرر أول", number: 2 },
      { id: dup, name: "مكرر ثان", number: 3 },
      { id: newId(), name: "", number: 4 },
      { id: newId(), name: "سليم تماما", number: 5 },
    ];
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), {});
    const st = await getStatement(actor, up.id);
    const codes = (i: number) => (st.rows[i].issues as { code: string }[]).map((x) => x.code);
    expect(codes(0)).toContain("ID_INVALID");
    expect(codes(1)).toContain("ID_DUPLICATE_IN_FILE");
    expect(codes(3)).toContain("NAME_MISSING");
    expect(st.summary.ok).toBe(1);
    await expect(approveStatement(actor, up.id, { confirm: true })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("تصحيح الصف واستبعاده يرفع الأخطاء ويسمح بالاعتماد", async () => {
    const { actor } = await setup();
    const fixId = newId();
    const rows: Row[] = [{ id: "123456789", name: "رقم خاطئ", number: 1 }, { id: newId(), name: "", number: 2 }, { id: newId(), name: "سليم", number: 3 }];
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), {});
    let st = await getStatement(actor, up.id);
    await updateRow(actor, up.id, st.rows[0].id, { nationalId: fixId });
    await updateRow(actor, up.id, st.rows[1].id, { excluded: true });
    st = await getStatement(actor, up.id);
    expect(st.summary.error).toBe(0);
    const stats = await approveStatement(actor, up.id, { confirm: true });
    expect(stats.created).toBe(2);
    expect(await ownerDb.citizen.findFirst({ where: { nationalId: fixId, distributorId: actor.distributorId! } })).not.toBeNull();
    expect(await ownerDb.auditLog.count({ where: { action: "statement.row_edit", entityId: up.id } })).toBe(2);
  });

  it("ربط الأعمدة اليدوي يعيد استخراج الصفوف", async () => {
    const { actor } = await setup();
    const rows = rowsOf(3);
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows)), {});
    // نربط رقم المواطن بعمود «م» (الأول) بدل عمود «رقم المواطن».
    const st0 = await getStatement(actor, up.id);
    const mapping = { ...(st0.statement.columnMapping as Record<string, number>), citizenNumber: 0 };
    await updateMapping(actor, up.id, { headerRow: st0.statement.headerRow, mapping });
    const st = await getStatement(actor, up.id);
    expect(st.rows.map((r) => r.citizenNumber)).toEqual(["1", "2", "3"]);
    await expect(updateMapping(actor, up.id, { headerRow: 2, mapping: { nationalId: 3, fullName: 3 } })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("الاعتماد يتطلب تأكيدًا صريحًا ولا يتكرر", async () => {
    const { actor } = await setup();
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(2))), {});
    await expect(approveStatement(actor, up.id, {})).rejects.toThrow();
    await approveStatement(actor, up.id, { confirm: true });
    await expect(approveStatement(actor, up.id, { confirm: true })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await ownerDb.entitlement.count({ where: { statementId: up.id } })).toBe(2);
  });

  it("الاعتماد المتزامن لنفس الكشف ينفذ مرة واحدة فقط", async () => {
    const { actor } = await setup();
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(3))), {});
    const results = await Promise.allSettled([1, 2, 3].map(() => approveStatement(actor, up.id, { confirm: true })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await ownerDb.entitlement.count({ where: { statementId: up.id } })).toBe(3);
  });

  it("المبلغ: من الكشف إن وُجد، وإلا عدد الجرار × سعر الدورة، مع تنبيه عند الاختلاف", async () => {
    const { actor } = await setup("25");
    const rows: Row[] = [
      { id: newId(), name: "بمبلغ مطابق", number: 1, qty: 2, amount: 50 },
      { id: newId(), name: "بمبلغ مختلف", number: 2, qty: 1, amount: 30 },
      { id: newId(), name: "دون مبلغ", number: 3, qty: 3, amount: "" },
    ];
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows, { withAmount: true })), {});
    const st = await getStatement(actor, up.id);
    expect((st.rows[1].issues as { code: string }[]).map((i) => i.code)).toContain("AMOUNT_MISMATCH");
    await approveStatement(actor, up.id, { confirm: true });
    const ents = await ownerDb.entitlement.findMany({ where: { statementId: up.id }, orderBy: { citizenNumber: "asc" } });
    expect(ents.map((e) => [e.amountDue.toFixed(2), e.amountSource])).toEqual([
      ["50.00", "AUTHORITY"],
      ["30.00", "AUTHORITY"],
      ["75.00", "COMPUTED"],
    ]);
  });

  it("لا اعتماد في دورة مغلقة، ولا اعتماد دون دورة", async () => {
    const { actor, cycle } = await setup();
    await closeCycle(actor, cycle.id, { confirm: true });
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(1))), {});
    await expect(approveStatement(actor, up.id, { confirm: true })).rejects.toMatchObject({ code: "VALIDATION" });
    await updateStatementMeta(actor, up.id, { cycleId: cycle.id });
    await expect(approveStatement(actor, up.id, { confirm: true })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("المواطن له استحقاق واحد في الدورة: كشف ثانٍ يحتويه يُرفض حتى يُستبعد الصف", async () => {
    const { actor } = await setup();
    const shared = { id: newId(), name: "مشترك", number: 1 };
    await importAndApprove(actor, [shared]);
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([{ ...shared, number: 50 }, { id: newId(), name: "جديد", number: 51 }])), {});
    const st = await getStatement(actor, up.id);
    expect((st.rows[0].issues as { code: string }[]).map((i) => i.code)).toContain("DUPLICATE_IN_CYCLE");
    await expect(approveStatement(actor, up.id, { confirm: true })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("رقم المواطن فريد في الدورة بين الكشوف المعتمدة", async () => {
    const { actor } = await setup();
    await importAndApprove(actor, [{ id: newId(), name: "الأول", number: 7 }]);
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([{ id: newId(), name: "الثاني", number: 7 }])), {});
    const st = await getStatement(actor, up.id);
    expect((st.rows[0].issues as { code: string }[]).map((i) => i.code)).toContain("NUMBER_TAKEN");
  });

  it("إلغاء الكشف قبل الاعتماد يحتفظ به وبملفه ويمنع اعتماده", async () => {
    const { actor } = await setup();
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rowsOf(1))), {});
    await discardStatement(actor, up.id, { reason: "ملف خاطئ" });
    await expect(approveStatement(actor, up.id, { confirm: true })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await ownerDb.statement.findUniqueOrThrow({ where: { id: up.id } })).status).toBe("DISCARDED");
  });

  it("صفوف الكشف المعتمد محمية من التعديل والحذف في قاعدة البيانات", async () => {
    const { actor } = await setup();
    const id = await importAndApprove(actor, rowsOf(1));
    await expect(withTenant(actor.distributorId!, (tx) => tx.statementRow.deleteMany({ where: { statementId: id } }))).rejects.toThrow();
    await expect(withTenant(actor.distributorId!, (tx) => tx.statementRow.updateMany({ where: { statementId: id }, data: { fullName: "x" } }))).rejects.toThrow();
  });
});

describe("إصدارات الكشوف", () => {
  it("الإصدار الجديد: يعرض الجدد والتغييرات والمختفين، ويحفظ السابق، ولا يحذف شيئًا", async () => {
    const { actor, cycle } = await setup("20");
    const a = { id: newId(), name: "باق كما هو", number: 1 };
    const b = { id: newId(), name: "تتغير كميته", number: 2, qty: 1 };
    const c = { id: newId(), name: "سيختفي", number: 3 };
    const v1 = await importAndApprove(actor, [a, b, c]);
    const d = { id: newId(), name: "جديد", number: 4 };
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([a, { ...b, qty: 2 }, d], { title: "كشف الدورة 7 محدث" })), { supersedesId: v1 });
    const st = await getStatement(actor, up.id);
    expect(st.statement.version).toBe(2);
    expect(st.statement.cycleId).toBe(cycle.id);
    expect(st.diff!.added.map((x) => x.nationalId)).toEqual([d.id]);
    expect(st.diff!.removed.map((x) => x.nationalId)).toEqual([c.id]);
    expect(st.diff!.changed.map((x) => x.nationalId)).toEqual([b.id]);
    expect(st.diff!.unchanged).toBe(1);

    // قبل الاعتماد لا يتغير شيء.
    expect(await ownerDb.entitlement.count({ where: { cycleId: cycle.id, status: "ACTIVE" } })).toBe(3);
    const stats = await approveStatement(actor, up.id, { confirm: true });
    expect(stats).toMatchObject({ created: 1, updated: 1, unchanged: 1, removed: 1 });

    expect((await ownerDb.statement.findUniqueOrThrow({ where: { id: v1 } })).status).toBe("SUPERSEDED");
    const removed = await ownerDb.entitlement.findFirstOrThrow({ where: { cycleId: cycle.id, citizen: { nationalId: c.id } } });
    expect(removed.status).toBe("REMOVED");
    const changed = await ownerDb.entitlement.findFirstOrThrow({ where: { cycleId: cycle.id, citizen: { nationalId: b.id } }, include: { changes: true } });
    expect(changed.quantity).toBe(2);
    expect(changed.amountDue.toFixed(2)).toBe("40.00");
    expect(changed.changes).toHaveLength(1);
    expect((changed.changes[0].before as { quantity: number }).quantity).toBe(1);
    // صفوف الإصدار الأول والملف الأصلي باقية.
    expect(await ownerDb.statementRow.count({ where: { statementId: v1 } })).toBe(3);
  });

  it("تبادل رقمي مواطنين بين الإصدارات لا يكسر قيد الرقم الفريد", async () => {
    const { actor, cycle } = await setup();
    const a = { id: newId(), name: "أ", number: 1 };
    const b = { id: newId(), name: "ب", number: 2 };
    const v1 = await importAndApprove(actor, [a, b]);
    await importAndApprove(actor, [{ ...a, number: 2 }, { ...b, number: 1 }], { supersedesId: v1 });
    const ents = await ownerDb.entitlement.findMany({ where: { cycleId: cycle.id, status: "ACTIVE" }, include: { citizen: true } });
    expect(ents.find((e) => e.citizen.nationalId === a.id)!.citizenNumber).toBe("2");
    expect(ents.find((e) => e.citizen.nationalId === b.id)!.citizenNumber).toBe("1");
  });

  it("لا يمكن اعتماد إصدارين جديدين للكشف نفسه", async () => {
    const { actor } = await setup();
    const rows = rowsOf(2);
    const v1 = await importAndApprove(actor, rows);
    const x = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows, { title: "x" })), { supersedesId: v1 });
    const y = await uploadStatement(actor, xlsxFile(await makeStatementXlsx(rows, { title: "y" })), { supersedesId: v1 });
    await approveStatement(actor, x.id, { confirm: true });
    await expect(approveStatement(actor, y.id, { confirm: true })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
