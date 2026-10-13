import type { AuthMethod } from "@prisma/client";
import type { Tx } from "../db";
import { withSystem } from "../db";
import type { Actor } from "../actor";
import { getSettings } from "../services/settings";
import { enforceExpiry } from "../services/expiry";
import { newToken, sha256 } from "./crypto";

/** الحد الأقصى المطلق لعمر الجلسة بغض النظر عن النشاط. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** لا نحدّث وقت آخر نشاط أكثر من مرة كل دقيقة لتقليل الكتابة. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export async function createSession(
  tx: Tx,
  p: { userId: string; method: AuthMethod; ip: string | null; userAgent: string | null },
) {
  const token = newToken();
  const now = new Date();
  await tx.session.create({
    data: {
      tokenHash: sha256(token),
      userId: p.userId,
      authMethod: p.method,
      passwordVerifiedAt: p.method === "PASSWORD" ? now : null,
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
      ip: p.ip,
      userAgent: p.userAgent?.slice(0, 300) ?? null,
    },
  });
  return token;
}

export type SessionResult = { actor: Actor; mustChangePassword: boolean };

/**
 * يتحقق من الجلسة على الخادم في كل طلب: الإبطال، مهلة عدم النشاط، العمر الأقصى،
 * حالة المستخدم، وحالة الموزّع وصلاحيته (مع التعليق التلقائي عند الانتهاء).
 */
export async function validateSession(token: string | undefined | null, ip: string | null = null): Promise<SessionResult | null> {
  if (!token) return null;
  const tokenHash = sha256(token);
  return withSystem(async (tx) => {
    const s = await tx.session.findUnique({ where: { tokenHash }, include: { user: { include: { distributor: true } } } });
    if (!s || s.revokedAt) return null;
    const now = new Date();
    const settings = await getSettings(tx);
    const idleMs = settings.sessionIdleMinutes * 60 * 1000;
    if (s.expiresAt <= now) return endSession(tx, s.id, "انتهاء العمر الأقصى للجلسة");
    if (now.getTime() - s.lastActivityAt.getTime() > idleMs) return endSession(tx, s.id, "انتهاء مهلة عدم النشاط");

    const u = s.user;
    if (u.status !== "ACTIVE") return endSession(tx, s.id, "الحساب معلّق");
    if (u.role === "DISTRIBUTOR") {
      if (!u.distributor) return endSession(tx, s.id, "حساب موزّع غير مكتمل");
      const d = await enforceExpiry(tx, u.distributor, now);
      if (d.status !== "ACTIVE") return null; // enforceExpiry يبطل الجلسات عند التعليق
    }

    if (now.getTime() - s.lastActivityAt.getTime() > TOUCH_INTERVAL_MS) {
      await tx.session.update({ where: { id: s.id }, data: { lastActivityAt: now } });
    }

    return {
      mustChangePassword: u.mustChangePassword,
      actor: {
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        isSuperAdmin: u.isSuperAdmin,
        permissions: u.permissions,
        distributorId: u.distributorId,
        sessionId: s.id,
        authMethod: s.authMethod,
        passwordVerifiedAt: s.passwordVerifiedAt,
        ip,
      },
    };
  });
}

async function endSession(tx: Tx, id: string, reason: string) {
  await tx.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  return null;
}

export async function revokeAllSessions(tx: Tx, userId: string, reason: string, exceptSessionId?: string | null) {
  const res = await tx.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  return res.count;
}

export async function revokeAllDevicePins(tx: Tx, userId: string) {
  await tx.devicePin.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
