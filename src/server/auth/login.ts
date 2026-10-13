import { z } from "zod";
import type { AuthMethod, Distributor, User } from "@prisma/client";
import type { Tx } from "../db";
import { withSystem } from "../db";
import { AppError } from "../errors";
import { type Actor, assertRecentPassword } from "../actor";
import { audit } from "../audit";
import { getSettings } from "../services/settings";
import { enforceExpiry } from "../services/expiry";
import { createSession, revokeAllDevicePins, revokeAllSessions } from "./session";
import { hashSecret, newToken, sha256, verifyDummy, verifySecret } from "./crypto";
import { passwordSchema, pinSchema } from "./validation";

type ClientInfo = { ip: string | null; userAgent: string | null };

/** حد محاولات الدخول الفاشلة من عنوان IP واحد خلال نافذة زمنية، إضافة إلى قفل الحساب. */
export const IP_FAILURE_LIMIT = 50;
const IP_WINDOW_MS = 15 * 60 * 1000;
/** بعد هذا العدد من محاولات PIN الخاطئة يُلغى PIN الجهاز ويلزم الدخول بكلمة المرور. */
export const PIN_MAX_FAILURES = 5;

const GENERIC_FAIL = "اسم المستخدم أو كلمة المرور غير صحيحة";

async function recordAttempt(
  tx: Tx,
  p: { username: string; userId?: string | null; success: boolean; reason?: string; method: AuthMethod } & ClientInfo,
) {
  await tx.loginAttempt.create({
    data: {
      username: p.username.slice(0, 64),
      userId: p.userId ?? null,
      success: p.success,
      reason: p.reason ?? null,
      method: p.method,
      ip: p.ip,
      userAgent: p.userAgent?.slice(0, 300) ?? null,
    },
  });
}

async function assertIpNotThrottled(tx: Tx, ip: string | null) {
  if (!ip) return;
  const since = new Date(Date.now() - IP_WINDOW_MS);
  const n = await tx.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } });
  if (n >= IP_FAILURE_LIMIT) {
    throw new AppError("RATE_LIMITED", "محاولات كثيرة من هذا الجهاز، يرجى المحاولة لاحقًا");
  }
}

/** يرجع سبب منع الدخول إن وُجد، بعد التحقق الصحيح من بيانات الاعتماد فقط. */
async function blockReason(tx: Tx, user: User & { distributor: Distributor | null }): Promise<string | null> {
  if (user.status !== "ACTIVE") return "حسابك معلّق، يرجى التواصل مع إدارة النظام";
  if (user.role === "DISTRIBUTOR") {
    if (!user.distributor) return "حساب غير مكتمل";
    const d = await enforceExpiry(tx, user.distributor);
    if (d.status === "ARCHIVED") return "هذا الحساب مؤرشف، يرجى التواصل مع إدارة النظام";
    if (d.status === "SUSPENDED") {
      return d.suspensionReason === "EXPIRED"
        ? "انتهت صلاحية حسابك، يرجى التواصل مع إدارة النظام لتجديده"
        : "حسابك معلّق، يرجى التواصل مع إدارة النظام";
    }
  }
  return null;
}

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "اسم المستخدم مطلوب").max(64),
  password: z.string().min(1, "كلمة المرور مطلوبة").max(200),
});

/**
 * تسجيل الدخول بكلمة المرور. ملاحظة: نتائج الفشل تُسجَّل في معاملة مستقلة
 * حتى لا يمحوها رمي الخطأ (rollback).
 */
export async function loginWithPassword(input: unknown, client: ClientInfo): Promise<{ token: string; mustChangePassword: boolean }> {
  const { username, password } = loginSchema.parse(input);
  const outcome = await withSystem(async (tx) => {
    await assertIpNotThrottled(tx, client.ip);
    const settings = await getSettings(tx);
    const user = await tx.user.findUnique({ where: { username }, include: { distributor: true } });
    const now = new Date();

    if (!user) {
      await verifyDummy(password);
      await recordAttempt(tx, { username, success: false, reason: "UNKNOWN_USER", method: "PASSWORD", ...client });
      return { error: new AppError("UNAUTHENTICATED", GENERIC_FAIL) };
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await recordAttempt(tx, { username, userId: user.id, success: false, reason: "LOCKED", method: "PASSWORD", ...client });
      return { error: lockedError(user.lockedUntil, now) };
    }

    const ok = await verifySecret(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= settings.maxFailedLogins;
      await tx.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + settings.lockoutMinutes * 60_000) }
          : { failedLoginCount: failed },
      });
      await recordAttempt(tx, { username, userId: user.id, success: false, reason: lock ? "BAD_PASSWORD_LOCKED" : "BAD_PASSWORD", method: "PASSWORD", ...client });
      if (lock) {
        await audit(tx, null, { action: "auth.account_locked", entityType: "user", entityId: user.id, distributorId: user.distributorId, reason: "تجاوز عدد محاولات الدخول الفاشلة" });
      }
      return { error: new AppError("UNAUTHENTICATED", GENERIC_FAIL) };
    }

    const blocked = await blockReason(tx, user);
    if (blocked) {
      await recordAttempt(tx, { username, userId: user.id, success: false, reason: "ACCOUNT_BLOCKED", method: "PASSWORD", ...client });
      return { error: new AppError("FORBIDDEN", blocked) };
    }

    await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    const token = await createSession(tx, { userId: user.id, method: "PASSWORD", ...client });
    await recordAttempt(tx, { username, userId: user.id, success: true, method: "PASSWORD", ...client });
    return { token, mustChangePassword: user.mustChangePassword };
  });
  if ("error" in outcome) throw outcome.error;
  return outcome;
}

function lockedError(until: Date, now: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return new AppError("RATE_LIMITED", `تم إيقاف الدخول مؤقتًا بسبب محاولات فاشلة متكررة. حاول بعد ${minutes} دقيقة`);
}

const pinLoginSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/, "PIN غير صالح") });

/** الدخول السريع بـ PIN على جهاز سبق ربطه. لا يمنح تحققًا للعمليات الحساسة. */
export async function loginWithPin(input: unknown, deviceToken: string | null | undefined, client: ClientInfo) {
  const { pin } = pinLoginSchema.parse(input);
  if (!deviceToken) throw new AppError("UNAUTHENTICATED", "لا يوجد PIN مفعّل على هذا الجهاز، سجّل الدخول بكلمة المرور");
  const outcome = await withSystem(async (tx) => {
    await assertIpNotThrottled(tx, client.ip);
    const dp = await tx.devicePin.findUnique({
      where: { deviceTokenHash: sha256(deviceToken) },
      include: { user: { include: { distributor: true } } },
    });
    if (!dp || dp.revokedAt) {
      return { error: new AppError("UNAUTHENTICATED", "PIN هذا الجهاز غير مفعّل، سجّل الدخول بكلمة المرور") };
    }
    const user = dp.user;
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await recordAttempt(tx, { username: user.username, userId: user.id, success: false, reason: "LOCKED", method: "PIN", ...client });
      return { error: lockedError(user.lockedUntil, now) };
    }
    if (!(await verifySecret(dp.pinHash, pin))) {
      const failed = dp.failedCount + 1;
      const revoke = failed >= PIN_MAX_FAILURES;
      await tx.devicePin.update({ where: { id: dp.id }, data: { failedCount: failed, revokedAt: revoke ? now : null } });
      await recordAttempt(tx, { username: user.username, userId: user.id, success: false, reason: revoke ? "BAD_PIN_REVOKED" : "BAD_PIN", method: "PIN", ...client });
      return {
        error: new AppError(
          "UNAUTHENTICATED",
          revoke ? "تم إلغاء PIN بعد محاولات خاطئة متكررة، سجّل الدخول بكلمة المرور" : "PIN غير صحيح",
        ),
      };
    }
    const blocked = await blockReason(tx, user);
    if (blocked) {
      await recordAttempt(tx, { username: user.username, userId: user.id, success: false, reason: "ACCOUNT_BLOCKED", method: "PIN", ...client });
      return { error: new AppError("FORBIDDEN", blocked) };
    }
    if (user.mustChangePassword) {
      return { error: new AppError("PASSWORD_CHANGE_REQUIRED", "يجب تغيير كلمة المرور، سجّل الدخول بكلمة المرور") };
    }
    await tx.devicePin.update({ where: { id: dp.id }, data: { failedCount: 0, lastUsedAt: now } });
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    const token = await createSession(tx, { userId: user.id, method: "PIN", ...client });
    await recordAttempt(tx, { username: user.username, userId: user.id, success: true, method: "PIN", ...client });
    return { token };
  });
  if ("error" in outcome) throw outcome.error;
  return outcome;
}

export async function logout(sessionId: string) {
  await withSystem((tx) =>
    tx.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "تسجيل خروج" } }),
  );
}

/** إعادة التحقق بكلمة المرور قبل العمليات الحساسة (خاصة بعد الدخول بـ PIN). */
export async function reauthenticate(actor: Actor, input: unknown) {
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(input);
  if (!actor.sessionId) throw new AppError("UNAUTHENTICATED", "الجلسة غير صالحة");
  const sessionId = actor.sessionId;
  const ok = await withSystem(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!(await verifySecret(user.passwordHash, password))) {
      await recordAttempt(tx, { username: user.username, userId: user.id, success: false, reason: "REAUTH_BAD_PASSWORD", method: "PASSWORD", ip: actor.ip, userAgent: null });
      return false;
    }
    await tx.session.update({ where: { id: sessionId }, data: { passwordVerifiedAt: new Date() } });
    return true;
  });
  if (!ok) throw new AppError("VALIDATION", "كلمة المرور غير صحيحة", { password: "كلمة المرور غير صحيحة" });
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "تأكيد كلمة المرور غير مطابق", path: ["confirmPassword"] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: "كلمة المرور الجديدة يجب أن تختلف عن الحالية", path: ["newPassword"] });

/** يغيّر المستخدم كلمة مروره بنفسه، وتُنهى جلساته الأخرى. */
export async function changeOwnPassword(actor: Actor, input: unknown) {
  const v = changePasswordSchema.parse(input);
  const ok = await withSystem(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!(await verifySecret(user.passwordHash, v.currentPassword))) return false;
    const now = new Date();
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashSecret(v.newPassword), passwordChangedAt: now, mustChangePassword: false },
    });
    await revokeAllSessions(tx, user.id, "تغيير كلمة المرور", actor.sessionId);
    if (actor.sessionId) await tx.session.update({ where: { id: actor.sessionId }, data: { passwordVerifiedAt: now } });
    await audit(tx, actor, { action: "auth.password_changed", entityType: "user", entityId: user.id, distributorId: user.distributorId });
    return true;
  });
  if (!ok) throw new AppError("VALIDATION", "كلمة المرور الحالية غير صحيحة", { currentPassword: "كلمة المرور الحالية غير صحيحة" });
}

/** يفعّل PIN على الجهاز الحالي. يتطلب كلمة المرور. يرجع رمز الجهاز لتخزينه في ملف تعريف ارتباط محمي. */
export async function setDevicePin(actor: Actor, input: unknown, existingDeviceToken?: string | null) {
  const v = z
    .object({ password: z.string().min(1, "كلمة المرور مطلوبة"), pin: pinSchema, confirmPin: z.string() })
    .refine((x) => x.pin === x.confirmPin, { message: "تأكيد PIN غير مطابق", path: ["confirmPin"] })
    .parse(input);
  const deviceToken = newToken();
  const ok = await withSystem(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!(await verifySecret(user.passwordHash, v.password))) return false;
    if (existingDeviceToken) {
      await tx.devicePin.updateMany({ where: { deviceTokenHash: sha256(existingDeviceToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await tx.devicePin.create({ data: { userId: user.id, deviceTokenHash: sha256(deviceToken), pinHash: await hashSecret(v.pin) } });
    await audit(tx, actor, { action: "auth.pin_set", entityType: "user", entityId: user.id, distributorId: user.distributorId });
    return true;
  });
  if (!ok) throw new AppError("VALIDATION", "كلمة المرور غير صحيحة", { password: "كلمة المرور غير صحيحة" });
  return deviceToken;
}

export async function removeDevicePin(actor: Actor, deviceToken: string | null | undefined) {
  if (!deviceToken) return;
  await withSystem(async (tx) => {
    const res = await tx.devicePin.updateMany({
      where: { deviceTokenHash: sha256(deviceToken), userId: actor.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count) await audit(tx, actor, { action: "auth.pin_removed", entityType: "user", entityId: actor.userId, distributorId: actor.distributorId });
  });
}

/** تسجيل الخروج من جميع الأجهزة للمستخدم نفسه (يشمل إلغاء PIN). */
export async function logoutEverywhere(actor: Actor) {
  assertRecentPassword(actor);
  await withSystem(async (tx) => {
    const n = await revokeAllSessions(tx, actor.userId, "تسجيل خروج من جميع الأجهزة");
    await revokeAllDevicePins(tx, actor.userId);
    await audit(tx, actor, { action: "auth.logout_all", entityType: "user", entityId: actor.userId, distributorId: actor.distributorId, after: { revokedSessions: n } });
  });
}
