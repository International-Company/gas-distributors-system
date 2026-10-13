import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  createDistributor, distributorAction, getDistributor, listDistributors, updateDistributor,
} from "@/server/services/distributors";
import { createCategory, deleteCategory } from "@/server/services/categories";
import { exportDistributorsXlsx } from "@/server/services/export";
import { loginWithPassword } from "@/server/auth/login";
import { validateSession } from "@/server/auth/session";
import { actorFor, client, makeAdmin, makeDistributor, ownerDb, PASSWORD, uid } from "../helpers/factories";

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function newDistributor(actor: Parameters<typeof createDistributor>[0], extra: Record<string, unknown> = {}) {
  return createDistributor(actor, {
    name: `موزّع ${uid()}`, username: `d_${uid()}`, password: PASSWORD, phone: "0599123456", region: "خانيونس", ...extra,
  });
}

describe("إنشاء حسابات الموزّعين وتعديلها", () => {
  it("ينشئ الحساب ومستخدمه مع إلزام تغيير كلمة المرور وتسجيل التدقيق", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const d = await newDistributor(actor);
    const u = await ownerDb.user.findFirstOrThrow({ where: { distributorId: d.id } });
    expect(u.role).toBe("DISTRIBUTOR");
    expect(u.mustChangePassword).toBe(true);
    expect(u.passwordHash).not.toContain(PASSWORD);
    const log = await ownerDb.auditLog.findFirstOrThrow({ where: { action: "distributor.create", entityId: d.id } });
    expect(JSON.stringify(log.after)).not.toContain("passwordHash");
  });

  it("يرفض اسم مستخدم مكرر", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const username = `dup_${uid()}`;
    await newDistributor(actor, { username });
    await expect(newDistributor(actor, { username })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("الحساب التجريبي يتطلب تاريخ انتهاء مستقبلي", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    await expect(newDistributor(actor, { isTrial: true })).rejects.toThrow();
    await expect(newDistributor(actor, { isTrial: true, expiresAt: new Date(Date.now() - 86_400_000).toISOString() })).rejects.toThrow();
    const d = await newDistributor(actor, { isTrial: true, expiresAt: future(14) });
    expect(d.isTrial).toBe(true);
  });

  it("يعدّل البيانات ويحفظ القيم القديمة والجديدة في التدقيق", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const d = await newDistributor(actor);
    await updateDistributor(actor, d.id, { region: "رفح" });
    const log = await ownerDb.auditLog.findFirstOrThrow({ where: { action: "distributor.update", entityId: d.id } });
    expect((log.before as { region: string }).region).toBe("خانيونس");
    expect((log.after as { region: string }).region).toBe("رفح");
  });
});

describe("صلاحيات مديري النظام", () => {
  it("مدير بصلاحية العرض فقط لا يستطيع الإنشاء أو التعليق أو التصدير", async () => {
    const { actor: viewer } = await makeAdmin({ permissions: ["distributors.view"] });
    const { actor: superA } = await makeAdmin({ superAdmin: true });
    const d = await newDistributor(superA);
    await expect(listDistributors(viewer, {})).resolves.toBeTruthy();
    await expect(newDistributor(viewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(distributorAction(viewer, d.id, { action: "suspend", reason: "اختبار" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportDistributorsXlsx(viewer, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("مدير بلا صلاحيات لا يرى قائمة الموزّعين", async () => {
    const { actor } = await makeAdmin({ permissions: [] });
    await expect(listDistributors(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("إعادة تعيين كلمة المرور تتطلب تحققًا حديثًا بكلمة المرور", async () => {
    const { user } = await makeAdmin({ permissions: ["distributors.credentials"] });
    const { distributor } = await makeDistributor();
    const pinActor = actorFor(user, { authMethod: "PIN", passwordVerifiedAt: null });
    await expect(
      distributorAction(pinActor, distributor.id, { action: "reset-password", newPassword: "Reset-1234", reason: "تحقق هاتفي" }),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });
});

describe("دورة حياة الحساب", () => {
  it("التعليق يمنع الدخول ويبطل الجلسات، وإعادة التفعيل تسمح به بمدة جديدة", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const { distributor, user } = await makeDistributor();
    const { token } = await loginWithPassword({ username: user.username, password: PASSWORD }, client);

    await distributorAction(actor, distributor.id, { action: "suspend", reason: "مخالفة" });
    expect(await validateSession(token)).toBeNull();
    await expect(loginWithPassword({ username: user.username, password: PASSWORD }, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(distributorAction(actor, distributor.id, { action: "suspend", reason: "مكرر" })).rejects.toMatchObject({ code: "INVALID_STATE" });

    const d = await distributorAction(actor, distributor.id, { action: "activate", expiresAt: future(30) });
    expect(d.status).toBe("ACTIVE");
    expect(d.expiresAt).not.toBeNull();
    await expect(loginWithPassword({ username: user.username, password: PASSWORD }, client)).resolves.toBeTruthy();
  });

  it("إعادة تفعيل حساب منتهي الصلاحية بلا مدة محددة", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const { distributor } = await makeDistributor({ isTrial: true, expiresAt: new Date(Date.now() - 1000) });
    const list = await listDistributors(actor, { status: "EXPIRED" });
    expect(list.map((x) => x.id)).toContain(distributor.id);
    const d = await distributorAction(actor, distributor.id, { action: "activate", isTrial: false, expiresAt: null });
    expect(d.status).toBe("ACTIVE");
    expect(d.expiresAt).toBeNull();
    expect(d.isTrial).toBe(false);
  });

  it("تحويل التجريبي إلى فعلي وتمديد المدة", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const { distributor } = await makeDistributor({ isTrial: true, expiresAt: new Date(Date.now() + 86_400_000) });
    const ext = await distributorAction(actor, distributor.id, { action: "set-validity", isTrial: true, expiresAt: future(60) });
    expect(ext.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    const conv = await distributorAction(actor, distributor.id, { action: "set-validity", isTrial: false, expiresAt: null });
    expect(conv.isTrial).toBe(false);
    expect(conv.expiresAt).toBeNull();
  });

  it("الأرشفة لا تحذف البيانات، والمؤرشف مخفي افتراضيًا، والاستعادة تعيده معلّقًا", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const { distributor, user } = await makeDistributor();
    await distributorAction(actor, distributor.id, { action: "archive", reason: "توقف عن العمل" });
    expect(await ownerDb.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect((await listDistributors(actor, {})).map((x) => x.id)).not.toContain(distributor.id);
    expect((await listDistributors(actor, { status: "ARCHIVED" })).map((x) => x.id)).toContain(distributor.id);
    await expect(loginWithPassword({ username: user.username, password: PASSWORD }, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const d = await distributorAction(actor, distributor.id, { action: "unarchive", reason: "عودة" });
    expect(d.status).toBe("SUSPENDED");
    expect(d.archivedAt).toBeNull();
  });

  it("الحسابات المثبتة تظهر أولًا", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const { distributor } = await makeDistributor();
    await distributorAction(actor, distributor.id, { action: "pin" });
    const list = await listDistributors(actor, {});
    expect(list[0].isPinned).toBe(true);
    expect((await listDistributors(actor, { pinned: "yes" })).every((x) => x.isPinned)).toBe(true);
  });

  it("إعادة تعيين كلمة المرور: تبطل الجلسات وتلزم بالتغيير وتسجل السبب", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const { distributor, user } = await makeDistributor();
    const { token } = await loginWithPassword({ username: user.username, password: PASSWORD }, client);
    await distributorAction(actor, distributor.id, { action: "reset-password", newPassword: "Reset-1234", reason: "تحقق من الهوية حضوريًا" });
    expect(await validateSession(token)).toBeNull();
    const r = await loginWithPassword({ username: user.username, password: "Reset-1234" }, client);
    expect(r.mustChangePassword).toBe(true);
    const log = await ownerDb.auditLog.findFirstOrThrow({ where: { action: "distributor.reset_password", entityId: distributor.id } });
    expect(log.reason).toContain("الهوية");
  });

  it("الخروج الإجباري من جميع الأجهزة", async () => {
    const { actor } = await makeAdmin({ permissions: ["distributors.credentials"] });
    const { distributor, user } = await makeDistributor();
    const { token } = await loginWithPassword({ username: user.username, password: PASSWORD }, client);
    await distributorAction(actor, distributor.id, { action: "logout-all", reason: "فقدان الهاتف" });
    expect(await validateSession(token)).toBeNull();
    expect((await getDistributor((await makeAdmin({ superAdmin: true })).actor, distributor.id)).activeSessions).toBe(0);
  });
});

describe("التصنيفات والتصفية والتصدير", () => {
  it("التصفية حسب التصنيف والنوع والبحث", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const cat = await createCategory(actor, { name: `تصنيف ${uid()}` });
    const d1 = await newDistributor(actor, { categoryId: cat.id, isTrial: true, expiresAt: future(10) });
    await newDistributor(actor);
    expect((await listDistributors(actor, { categoryId: cat.id })).map((x) => x.id)).toEqual([d1.id]);
    expect((await listDistributors(actor, { trial: "yes", categoryId: cat.id })).map((x) => x.id)).toEqual([d1.id]);
    expect((await listDistributors(actor, { q: d1.name })).map((x) => x.id)).toEqual([d1.id]);
    expect((await listDistributors(actor, { expiringDays: 15, categoryId: cat.id })).map((x) => x.id)).toEqual([d1.id]);
  });

  it("لا يمكن حذف تصنيف مرتبط بحسابات", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const cat = await createCategory(actor, { name: `تصنيف ${uid()}` });
    await newDistributor(actor, { categoryId: cat.id });
    await expect(deleteCategory(actor, cat.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("التصدير إلى Excel يحترم الفلاتر ويكون من اليمين لليسار", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const cat = await createCategory(actor, { name: `تصدير ${uid()}` });
    const d = await newDistributor(actor, { categoryId: cat.id });
    await newDistributor(actor);
    const buf = await exportDistributorsXlsx(actor, { categoryId: cat.id });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("الموزّعون")!;
    expect(ws.views[0].rightToLeft).toBe(true);
    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).getCell(1).value).toBe(d.name);
    expect(await ownerDb.auditLog.count({ where: { action: "distributor.export", actorUserId: actor.userId } })).toBe(1);
  });
});
