import { describe, expect, it } from "vitest";
import { withSystem } from "@/server/db";
import { hashSecret } from "@/server/auth/crypto";
import {
  changeOwnPassword, loginWithPassword, loginWithPin, logout, logoutEverywhere, PIN_MAX_FAILURES, reauthenticate, setDevicePin,
} from "@/server/auth/login";
import { validateSession } from "@/server/auth/session";
import { assertRecentPassword } from "@/server/actor";
import { client, makeAdmin, makeDistributor, ownerDb, PASSWORD, uid } from "../helpers/factories";

async function sessionActor(token: string) {
  const r = await validateSession(token);
  if (!r) throw new Error("no session");
  return r.actor;
}

describe("تجزئة كلمات المرور", () => {
  it("تستخدم Argon2id ولا تخزن النص الأصلي", async () => {
    const h = await hashSecret("Secret-123");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).not.toContain("Secret-123");
  });
});

describe("تسجيل الدخول بكلمة المرور", () => {
  it("ينجح بالبيانات الصحيحة وينشئ جلسة ويسجل المحاولة مع IP", async () => {
    const { user } = await makeDistributor();
    const { token } = await loginWithPassword({ username: user.username.toUpperCase(), password: PASSWORD }, client);
    const actor = await sessionActor(token);
    expect(actor.userId).toBe(user.id);
    expect(actor.authMethod).toBe("PASSWORD");
    const att = await ownerDb.loginAttempt.findFirstOrThrow({ where: { userId: user.id, success: true } });
    expect(att.ip).toBe(client.ip);
  });

  it("رسالة فشل موحدة لكلمة مرور خاطئة ولمستخدم غير موجود، وتُسجّل المحاولتان", async () => {
    const { user } = await makeDistributor();
    const e1 = await loginWithPassword({ username: user.username, password: "wrong-1" }, client).catch((e) => e);
    const ghost = `ghost_${uid()}`;
    const e2 = await loginWithPassword({ username: ghost, password: "wrong-1" }, client).catch((e) => e);
    expect(e1.message).toBe(e2.message);
    expect(await ownerDb.loginAttempt.count({ where: { username: ghost, success: false, reason: "UNKNOWN_USER" } })).toBe(1);
    expect(await ownerDb.loginAttempt.count({ where: { userId: user.id, reason: "BAD_PASSWORD" } })).toBe(1);
  });

  it("يقفل الحساب بعد تجاوز الحد، ويرفض حتى كلمة المرور الصحيحة أثناء القفل", async () => {
    const { user } = await makeDistributor();
    const settings = await ownerDb.systemSettings.findUniqueOrThrow({ where: { id: 1 } });
    for (let i = 0; i < settings.maxFailedLogins; i++) {
      await loginWithPassword({ username: user.username, password: "bad-pass-1" }, client).catch(() => {});
    }
    const locked = await ownerDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    await expect(loginWithPassword({ username: user.username, password: PASSWORD }, client)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await ownerDb.auditLog.count({ where: { action: "auth.account_locked", entityId: user.id } })).toBe(1);
  });

  it("يمنع دخول الموزّع المعلّق ويحتفظ ببياناته", async () => {
    const { user, distributor } = await makeDistributor({ status: "SUSPENDED" });
    await expect(loginWithPassword({ username: user.username, password: PASSWORD }, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await ownerDb.distributor.findUnique({ where: { id: distributor.id } })).not.toBeNull();
  });

  it("يعلّق الحساب المنتهي تلقائيًا عند محاولة الدخول ويسجل ذلك", async () => {
    const { user, distributor } = await makeDistributor({ expiresAt: new Date(Date.now() - 1000), isTrial: true });
    const err = await loginWithPassword({ username: user.username, password: PASSWORD }, client).catch((e) => e);
    expect(err.message).toContain("انتهت صلاحية");
    const d = await ownerDb.distributor.findUniqueOrThrow({ where: { id: distributor.id } });
    expect(d.status).toBe("SUSPENDED");
    expect(d.suspensionReason).toBe("EXPIRED");
    expect(await ownerDb.auditLog.count({ where: { action: "distributor.auto_suspend_expired", entityId: distributor.id } })).toBe(1);
  });

  it("يرجع علامة تغيير كلمة المرور الإلزامي", async () => {
    const { user } = await makeAdmin({ mustChangePassword: true });
    const r = await loginWithPassword({ username: user.username, password: PASSWORD }, client);
    expect(r.mustChangePassword).toBe(true);
  });
});

describe("الجلسات", () => {
  it("تنتهي الجلسة بعد مهلة عدم النشاط المحددة في الإعدادات", async () => {
    const { user } = await makeDistributor();
    const { token } = await loginWithPassword({ username: user.username, password: PASSWORD }, client);
    const s = await ownerDb.session.findFirstOrThrow({ where: { userId: user.id, revokedAt: null } });
    await ownerDb.session.update({ where: { id: s.id }, data: { lastActivityAt: new Date(Date.now() - 31 * 60_000) } });
    expect(await validateSession(token)).toBeNull();
    expect((await ownerDb.session.findUniqueOrThrow({ where: { id: s.id } })).revokeReason).toContain("عدم النشاط");
  });

  it("تسجيل الخروج يبطل الجلسة", async () => {
    const { user } = await makeDistributor();
    const { token } = await loginWithPassword({ username: user.username, password: PASSWORD }, client);
    const actor = await sessionActor(token);
    await logout(actor.sessionId!);
    expect(await validateSession(token)).toBeNull();
  });

  it("تعليق الموزّع يجعل جلسته القائمة غير صالحة فورًا", async () => {
    const { user, distributor } = await makeDistributor();
    const { token } = await loginWithPassword({ username: user.username, password: PASSWORD }, client);
    await ownerDb.distributor.update({ where: { id: distributor.id }, data: { status: "SUSPENDED", suspensionReason: "MANUAL" } });
    expect(await validateSession(token)).toBeNull();
  });

  it("انتهاء الصلاحية أثناء جلسة قائمة يعلّق الحساب ويبطل الجلسة", async () => {
    const { user, distributor } = await makeDistributor({ expiresAt: new Date(Date.now() + 60_000) });
    const { token } = await loginWithPassword({ username: user.username, password: PASSWORD }, client);
    await ownerDb.distributor.update({ where: { id: distributor.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSession(token)).toBeNull();
    expect((await ownerDb.distributor.findUniqueOrThrow({ where: { id: distributor.id } })).status).toBe("SUSPENDED");
  });

  it("الخروج من جميع الأجهزة يبطل كل الجلسات ويلغي PIN", async () => {
    const { user } = await makeDistributor();
    const t1 = (await loginWithPassword({ username: user.username, password: PASSWORD }, client)).token;
    const t2 = (await loginWithPassword({ username: user.username, password: PASSWORD }, client)).token;
    const actor = await sessionActor(t1);
    await setDevicePin(actor, { password: PASSWORD, pin: "2468", confirmPin: "2468" });
    await logoutEverywhere(actor);
    expect(await validateSession(t1)).toBeNull();
    expect(await validateSession(t2)).toBeNull();
    expect(await ownerDb.devicePin.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it("تغيير كلمة المرور يبطل الجلسات الأخرى ويبقي الجلسة الحالية", async () => {
    const { user } = await makeDistributor();
    const t1 = (await loginWithPassword({ username: user.username, password: PASSWORD }, client)).token;
    const t2 = (await loginWithPassword({ username: user.username, password: PASSWORD }, client)).token;
    const actor = await sessionActor(t1);
    await expect(changeOwnPassword(actor, { currentPassword: "wrong", newPassword: "NewPass-999", confirmPassword: "NewPass-999" })).rejects.toMatchObject({ code: "VALIDATION" });
    await changeOwnPassword(actor, { currentPassword: PASSWORD, newPassword: "NewPass-999", confirmPassword: "NewPass-999" });
    expect(await validateSession(t1)).not.toBeNull();
    expect(await validateSession(t2)).toBeNull();
    await expect(loginWithPassword({ username: user.username, password: "NewPass-999" }, client)).resolves.toBeTruthy();
  });
});

describe("PIN على الجهاز", () => {
  it("تفعيل PIN يتطلب كلمة المرور الصحيحة", async () => {
    const { user } = await makeDistributor();
    const { token } = await loginWithPassword({ username: user.username, password: PASSWORD }, client);
    const actor = await sessionActor(token);
    await expect(setDevicePin(actor, { password: "wrong", pin: "1357", confirmPin: "1357" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("الدخول بـ PIN يعمل على الجهاز المرتبط فقط ولا يكفي للعمليات الحساسة حتى إعادة التحقق", async () => {
    const { user } = await makeDistributor();
    const actor = await sessionActor((await loginWithPassword({ username: user.username, password: PASSWORD }, client)).token);
    const device = await setDevicePin(actor, { password: PASSWORD, pin: "1357", confirmPin: "1357" });

    await expect(loginWithPin({ pin: "1357" }, null, client)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(loginWithPin({ pin: "1357" }, "another-device-token", client)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const { token } = await loginWithPin({ pin: "1357" }, device, client);
    const pinActor = await sessionActor(token);
    expect(pinActor.authMethod).toBe("PIN");
    expect(() => assertRecentPassword(pinActor)).toThrow(/كلمة المرور/);
    await expect(logoutEverywhere(pinActor)).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });

    await expect(reauthenticate(pinActor, { password: "wrong" })).rejects.toMatchObject({ code: "VALIDATION" });
    await reauthenticate(pinActor, { password: PASSWORD });
    const refreshed = await sessionActor(token);
    expect(() => assertRecentPassword(refreshed)).not.toThrow();
  });

  it(`يُلغى PIN بعد ${PIN_MAX_FAILURES} محاولات خاطئة`, async () => {
    const { user } = await makeDistributor();
    const actor = await sessionActor((await loginWithPassword({ username: user.username, password: PASSWORD }, client)).token);
    const device = await setDevicePin(actor, { password: PASSWORD, pin: "1357", confirmPin: "1357" });
    for (let i = 0; i < PIN_MAX_FAILURES; i++) await loginWithPin({ pin: "0000" }, device, client).catch(() => {});
    await expect(loginWithPin({ pin: "1357" }, device, client)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("PIN لا يتجاوز تعليق الحساب", async () => {
    const { user, distributor } = await makeDistributor();
    const actor = await sessionActor((await loginWithPassword({ username: user.username, password: PASSWORD }, client)).token);
    const device = await setDevicePin(actor, { password: PASSWORD, pin: "1357", confirmPin: "1357" });
    await ownerDb.distributor.update({ where: { id: distributor.id }, data: { status: "SUSPENDED", suspensionReason: "MANUAL" } });
    await expect(loginWithPin({ pin: "1357" }, device, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("لا يُخزّن PIN أو رمز الجهاز كنص صريح", async () => {
    const { user } = await makeDistributor();
    const actor = await sessionActor((await loginWithPassword({ username: user.username, password: PASSWORD }, client)).token);
    const device = await setDevicePin(actor, { password: PASSWORD, pin: "1357", confirmPin: "1357" });
    const row = await withSystem((tx) => tx.devicePin.findFirstOrThrow({ where: { userId: user.id } }));
    expect(row.pinHash).not.toContain("1357");
    expect(row.deviceTokenHash).not.toBe(device);
  });
});
