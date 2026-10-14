import { describe, expect, it } from "vitest";
import { appDb, withTenant } from "@/server/db";
import { closeCycle, createCycle } from "@/server/services/cycles";
import { approveStatement, uploadStatement } from "@/server/services/statements";
import {
  archiveEndedCycleCitizens, createReviewCase, detectSearchType, dismissMergeSuggestion, editEntitlement, getCitizenProfile,
  mergeCitizens, mergeSuggestions, resolveReviewCase, searchCitizens, setCitizenArchived,
} from "@/server/services/citizens";
import { makeDistributor, ownerDb } from "../helpers/factories";
import { makeStatementXlsx, newId, xlsxFile, type Row } from "../helpers/statements";

async function withStatement(rows: Row[], price = "25") {
  const d = await makeDistributor();
  const cycle = await createCycle(d.actor, { unitPrice: price });
  const up = await uploadStatement(d.actor, xlsxFile(await makeStatementXlsx(rows)), {});
  await approveStatement(d.actor, up.id, { confirm: true });
  return { ...d, cycle, statementId: up.id };
}

const citizenId = async (distributorId: string, nid: string) =>
  (await ownerDb.citizen.findFirstOrThrow({ where: { distributorId, nationalId: nid } })).id;

describe("البحث", () => {
  it("يحدد نوع البحث من شكل النص", () => {
    expect(detectSearchType("محمد أحمد")).toBe("name");
    expect(detectSearchType("401234567")).toBe("nationalId");
    expect(detectSearchType("٤٠١٢٣٤٥٦٧")).toBe("nationalId");
    expect(detectSearchType("0599123456")).toBe("phone");
    expect(detectSearchType("125")).toBe("citizenNumber");
  });

  it("بالهوية والاسم (مع اختلاف الهمزات والتاء المربوطة) والهاتف ورقم المواطن", async () => {
    const r: Row = { id: newId(), name: "أسامة إبراهيم عبد الله", number: 314, phone: "0597654321" };
    const { actor } = await withStatement([r, { id: newId(), name: "شخص آخر", number: 2 }]);
    const ids = async (q: string) => (await searchCitizens(actor, { q })).results.map((x) => x.nationalId);
    expect(await ids(r.id)).toEqual([r.id]);
    expect(await ids("اسامه ابراهيم")).toContain(r.id);
    expect(await ids("0597654321")).toEqual([r.id]);
    expect(await ids("314")).toEqual([r.id]);
    const res = await searchCitizens(actor, { q: r.id });
    expect(res.results[0].current?.citizenNumber).toBe("314");
  });

  it("لا يجد بيانات موزّع آخر", async () => {
    const r: Row = { id: newId(), name: "مواطن خاص بالموزع الأول", number: 1 };
    await withStatement([r]);
    const other = await withStatement([{ id: newId(), name: "غيره", number: 1 }]);
    expect((await searchCitizens(other.actor, { q: r.id })).results).toHaveLength(0);
    expect((await searchCitizens(other.actor, { q: "الموزع الأول" })).results).toHaveLength(0);
  });
});

describe("عزل جداول المرحلة الثانية", () => {
  it("سياق الموزّع لا يرى دورات أو كشوف أو مواطني أو استحقاقات أو ملفات موزّع آخر", async () => {
    const a = await withStatement([{ id: newId(), name: "أ", number: 1 }]);
    const b = await withStatement([{ id: newId(), name: "ب", number: 1 }]);
    const seen = await withTenant(b.actor.distributorId!, async (tx) => ({
      cycles: await tx.cycle.count({ where: { distributorId: a.actor.distributorId! } }),
      statements: await tx.statement.count({ where: { distributorId: a.actor.distributorId! } }),
      rows: await tx.statementRow.count({ where: { distributorId: a.actor.distributorId! } }),
      citizens: await tx.citizen.count({ where: { distributorId: a.actor.distributorId! } }),
      ents: await tx.entitlement.count({ where: { distributorId: a.actor.distributorId! } }),
      files: await tx.storedFile.count({ where: { distributorId: a.actor.distributorId! } }),
      blobs: await tx.fileBlob.count({ where: { distributorId: a.actor.distributorId! } }),
    }));
    expect(seen).toEqual({ cycles: 0, statements: 0, rows: 0, citizens: 0, ents: 0, files: 0, blobs: 0 });
    await expect(getCitizenProfile(b.actor, await citizenId(a.actor.distributorId!, (await ownerDb.citizen.findFirstOrThrow({ where: { distributorId: a.actor.distributorId! } })).nationalId))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("المفاتيح المركّبة تمنع ربط استحقاق موزّع بدورة موزّع آخر حتى من مالك القاعدة", async () => {
    const a = await withStatement([{ id: newId(), name: "أ", number: 1 }]);
    const b = await withStatement([{ id: newId(), name: "ب", number: 1 }]);
    const ent = await ownerDb.entitlement.findFirstOrThrow({ where: { distributorId: a.actor.distributorId! } });
    await expect(ownerDb.entitlement.update({ where: { id: ent.id }, data: { cycleId: b.cycle.id } })).rejects.toThrow();
  });

  it("دور التطبيق لا يستطيع حذف المواطنين أو الاستحقاقات أو الكشوف", async () => {
    const a = await withStatement([{ id: newId(), name: "أ", number: 1 }]);
    const t = (fn: Parameters<typeof withTenant>[1]) => withTenant(a.actor.distributorId!, fn);
    await expect(t((tx) => tx.entitlement.deleteMany({}))).rejects.toThrow();
    await expect(t((tx) => tx.citizen.deleteMany({}))).rejects.toThrow();
    await expect(t((tx) => tx.statement.deleteMany({}))).rejects.toThrow();
    await expect(t((tx) => tx.entitlementChange.deleteMany({}))).rejects.toThrow();
    expect(await appDb.citizen.count()).toBe(0); // فشل مغلق خارج السياق
  });
});

describe("ملف المواطن والاستحقاقات", () => {
  it("يعرض الاستحقاقات حسب الدورة وإجمالي المستحق", async () => {
    const r: Row = { id: newId(), name: "صاحب ملف", number: 9, qty: 2 };
    const { actor } = await withStatement([r], "30");
    const p = await getCitizenProfile(actor, await citizenId(actor.distributorId!, r.id));
    expect(p.entitlements).toHaveLength(1);
    expect(p.entitlements[0].quantity).toBe(2);
    expect(p.totalDue.toFixed(2)).toBe("60.00");
    expect(p.timeline.length).toBeGreaterThan(0);
  });

  it("تعديل الاستحقاق المعتمد يتطلب سببًا ويحفظ القديم والجديد، ويمنع رقمًا مستخدمًا", async () => {
    const a: Row = { id: newId(), name: "أ", number: 1 };
    const b: Row = { id: newId(), name: "ب", number: 2 };
    const { actor } = await withStatement([a, b]);
    const ent = await ownerDb.entitlement.findFirstOrThrow({ where: { distributorId: actor.distributorId!, citizenNumber: "1" } });
    await expect(editEntitlement(actor, ent.id, { quantity: 2 })).rejects.toThrow();
    await editEntitlement(actor, ent.id, { quantity: 2, reason: "تصحيح من الهيئة" });
    const ch = await ownerDb.entitlementChange.findFirstOrThrow({ where: { entitlementId: ent.id, source: "MANUAL_EDIT" } });
    expect((ch.before as { quantity: number }).quantity).toBe(1);
    expect((ch.after as { quantity: number }).quantity).toBe(2);
    await expect(editEntitlement(actor, ent.id, { citizenNumber: "2", reason: "خطأ" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("لا تعديل للاستحقاق في دورة مغلقة", async () => {
    const { actor, cycle } = await withStatement([{ id: newId(), name: "أ", number: 1 }]);
    await closeCycle(actor, cycle.id, { confirm: true });
    const ent = await ownerDb.entitlement.findFirstOrThrow({ where: { cycleId: cycle.id } });
    await expect(editEntitlement(actor, ent.id, { quantity: 3, reason: "x x x" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("الأرشفة", () => {
  it("تؤرشف مواطني الدورات المنتهية فقط، ويُستعادون، والبحث يستثنيهم افتراضيًا", async () => {
    const r: Row = { id: newId(), name: "منته", number: 1 };
    const { actor, cycle } = await withStatement([r]);
    const id = await citizenId(actor.distributorId!, r.id);
    await expect(setCitizenArchived(actor, id, true)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await closeCycle(actor, cycle.id, { confirm: true });
    expect(await archiveEndedCycleCitizens(actor)).toBe(1);
    expect((await searchCitizens(actor, { q: r.id })).results).toHaveLength(0);
    expect((await searchCitizens(actor, { q: r.id, includeArchived: true })).results).toHaveLength(1);
    expect(await ownerDb.entitlement.count({ where: { citizenId: id } })).toBe(1);
    await setCitizenArchived(actor, id, false);
    expect((await searchCitizens(actor, { q: r.id })).results).toHaveLength(1);
  });

  it("ظهور المواطن المؤرشف في كشف جديد معتمد يعيده من الأرشيف", async () => {
    const r: Row = { id: newId(), name: "عائد", number: 1 };
    const { actor, cycle } = await withStatement([r]);
    await closeCycle(actor, cycle.id, { confirm: true });
    await archiveEndedCycleCitizens(actor);
    await createCycle(actor, { unitPrice: "25" });
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([r])), {});
    const stats = await approveStatement(actor, up.id, { confirm: true });
    expect(stats.restoredCitizens).toBe(1);
  });
});

describe("الدمج", () => {
  it("يقترح أسماء متشابهة بأرقام مختلفة، ولا يدمج تلقائيًا", async () => {
    const a: Row = { id: newId(), name: "خالد محمود سالم النجار", number: 1 };
    const b: Row = { id: newId(), name: "خالد محمود سالم النجار", number: 2 };
    const { actor } = await withStatement([a, b]);
    const s = await mergeSuggestions(actor);
    expect(s.some((x) => [x.a.nationalId, x.b.nationalId].sort().join() === [a.id, b.id].sort().join())).toBe(true);
    expect(await ownerDb.citizen.count({ where: { distributorId: actor.distributorId!, mergedIntoId: { not: null } } })).toBe(0);
  });

  it("يُرفض الدمج إن كان للسجلين استحقاق في الدورة نفسها (منع التسليم المكرر)", async () => {
    const a: Row = { id: newId(), name: "خالد", number: 1 };
    const b: Row = { id: newId(), name: "خالد", number: 2 };
    const { actor } = await withStatement([a, b]);
    await expect(
      mergeCitizens(actor, { primaryId: await citizenId(actor.distributorId!, a.id), secondaryId: await citizenId(actor.distributorId!, b.id), reason: "خطأ في الهوية" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("الدمج المسموح ينقل الاستحقاقات دون جمع الكميات، ويحفظ السجل، والبحث بالرقم القديم يصل للأساسي", async () => {
    const a: Row = { id: newId(), name: "سمير عادل", number: 1 };
    const { actor, cycle } = await withStatement([a]);
    await closeCycle(actor, cycle.id, { confirm: true });
    await createCycle(actor, { unitPrice: "25" });
    const b: Row = { id: newId(), name: "سمير عادل", number: 1 };
    const up = await uploadStatement(actor, xlsxFile(await makeStatementXlsx([b])), {});
    await approveStatement(actor, up.id, { confirm: true });
    const pa = await citizenId(actor.distributorId!, a.id);
    const pb = await citizenId(actor.distributorId!, b.id);
    const res = await mergeCitizens(actor, { primaryId: pa, secondaryId: pb, reason: "رقم الهوية في الكشف الثاني خاطئ" });
    expect(res.movedEntitlements).toBe(1);
    const p = await getCitizenProfile(actor, pa);
    expect(p.entitlements).toHaveLength(2);
    expect(p.entitlements.every((e) => e.quantity === 1)).toBe(true);
    expect((await searchCitizens(actor, { q: b.id })).results[0].id).toBe(pa);
    await expect(mergeCitizens(actor, { primaryId: pa, secondaryId: pb, reason: "مكرر" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("رفض الاقتراح يخفيه", async () => {
    const a: Row = { id: newId(), name: "نادر يوسف حسن", number: 1 };
    const b: Row = { id: newId(), name: "نادر يوسف حسن", number: 2 };
    const { actor } = await withStatement([a, b]);
    const ia = await citizenId(actor.distributorId!, a.id);
    const ib = await citizenId(actor.distributorId!, b.id);
    await dismissMergeSuggestion(actor, { citizenAId: ib, citizenBId: ia });
    const s = await mergeSuggestions(actor);
    expect(s.some((x) => [x.a.id, x.b.id].includes(ia) && [x.a.id, x.b.id].includes(ib))).toBe(false);
  });
});

describe("حالات المراجعة", () => {
  it("مواطن غير موجود في كشف معتمد: تُسجل حالة دون إنشاء مواطن أو استحقاق", async () => {
    const { actor } = await withStatement([{ id: newId(), name: "موجود", number: 1 }]);
    const nid = newId();
    const before = await ownerDb.citizen.count({ where: { distributorId: actor.distributorId! } });
    const c = await createReviewCase(actor, { nationalId: nid, fullName: "غير مدرج", details: "حضر ولا يظهر في الكشف" });
    expect(c.status).toBe("OPEN");
    expect(await ownerDb.citizen.count({ where: { distributorId: actor.distributorId! } })).toBe(before);
    await resolveReviewCase(actor, c.id, { resolution: "أُبلغ بمراجعة الهيئة" });
    await expect(resolveReviewCase(actor, c.id, { resolution: "مرة أخرى" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("يرفض تسجيل حالة لمواطن له استحقاق في الدورة النشطة", async () => {
    const r: Row = { id: newId(), name: "موجود", number: 1 };
    const { actor } = await withStatement([r]);
    await expect(createReviewCase(actor, { nationalId: r.id, details: "تجربة" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
