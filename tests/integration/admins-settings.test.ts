import { describe, expect, it } from "vitest";
import { adminAction, createAdmin, listAdmins, updateAdmin } from "@/server/services/admins";
import { updateSettings } from "@/server/services/settings";
import { loginWithPassword } from "@/server/auth/login";
import { actorFor, client, makeAdmin, ownerDb, PASSWORD, uid } from "../helpers/factories";

describe("إدارة مديري النظام", () => {
  it("مقصورة على المدير الرئيسي", async () => {
    const { actor } = await makeAdmin({ permissions: ["distributors.view", "settings.manage", "audit.view"] });
    await expect(listAdmins(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createAdmin(actor, { username: `x_${uid()}`, displayName: "س", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ينشئ مديرًا بصلاحيات محددة ويرفض صلاحيات غير معروفة", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const a = await createAdmin(actor, { username: `m_${uid()}`, displayName: "مدير فرعي", password: PASSWORD, permissions: ["distributors.view"] });
    expect(a.permissions).toEqual(["distributors.view"]);
    await expect(
      createAdmin(actor, { username: `m_${uid()}`, displayName: "مدير", password: PASSWORD, permissions: ["root.all"] }),
    ).rejects.toThrow();
  });

  it("إدارة المديرين تتطلب تحققًا حديثًا بكلمة المرور", async () => {
    const { user } = await makeAdmin({ superAdmin: true });
    const stale = actorFor(user, { passwordVerifiedAt: new Date(Date.now() - 60 * 60_000) });
    await expect(listAdmins(stale)).resolves.toBeTruthy();
    await expect(
      createAdmin(stale, { username: `m_${uid()}`, displayName: "مدير", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  });

  it("لا يمكن للمدير الرئيسي تعليق نفسه أو إزالة صفته عن نفسه", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    await expect(adminAction(actor, actor.userId, { action: "suspend", reason: "اختبار" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(updateAdmin(actor, actor.userId, { isSuperAdmin: false })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("تعليق مدير يمنع دخوله", async () => {
    const { actor } = await makeAdmin({ superAdmin: true });
    const { user } = await makeAdmin({ permissions: ["audit.view"] });
    await adminAction(actor, user.id, { action: "suspend", reason: "انتهاء التكليف" });
    await expect(loginWithPassword({ username: user.username, password: PASSWORD }, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("إعدادات النظام", () => {
  it("تتطلب صلاحية الإعدادات وتتحقق من الحدود وتسجل التغيير", async () => {
    const { actor: noPerm } = await makeAdmin({ permissions: ["distributors.view"] });
    const { actor } = await makeAdmin({ permissions: ["settings.manage"] });
    const base = {
      systemName: "نظام الغاز", currencyCode: "ILS", currencySymbol: "₪", sessionIdleMinutes: 30, maxFailedLogins: 5, lockoutMinutes: 15,
    };
    await expect(updateSettings(noPerm, base)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateSettings(actor, { ...base, sessionIdleMinutes: 1 })).rejects.toThrow();
    const s = await updateSettings(actor, { ...base, systemName: "نظام غاز تجريبي", contactPhone: "0599111222" });
    expect(s.systemName).toBe("نظام غاز تجريبي");
    expect(await ownerDb.auditLog.count({ where: { action: "settings.update", actorUserId: actor.userId } })).toBe(1);
    await updateSettings(actor, base);
  });
});
