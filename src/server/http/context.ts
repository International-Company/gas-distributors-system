import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, SESSION_MAX_AGE_MS } from "../auth/session";
import { AppError } from "../errors";
import type { Actor } from "../actor";
import { hasPermission } from "../actor";
import type { AdminPermission } from "../permissions";

export const SESSION_COOKIE = "gas_session";
export const DEVICE_COOKIE = "gas_device";
const DEVICE_MAX_AGE_S = 365 * 24 * 60 * 60;

const secure = process.env.NODE_ENV === "production";

export function clientIp(h: Headers): string | null {
  // Railway يمرر عنوان العميل في x-forwarded-for (أول عنوان).
  const fwd = h.get("x-forwarded-for");
  return (fwd?.split(",")[0].trim() || h.get("x-real-ip") || null)?.slice(0, 64) ?? null;
}

export async function clientInfo() {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get("user-agent") };
}

/** الجلسة الحالية (مرة واحدة لكل طلب). */
export const currentSession = cache(async () => {
  const c = await cookies();
  const h = await headers();
  return validateSession(c.get(SESSION_COOKIE)?.value, clientIp(h));
});

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function setDeviceCookie(token: string) {
  (await cookies()).set(DEVICE_COOKIE, token, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: DEVICE_MAX_AGE_S });
}

export async function getDeviceToken() {
  return (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
}

export async function clearDeviceCookie() {
  (await cookies()).delete(DEVICE_COOKIE);
}

type Guard = { role?: "ADMIN" | "DISTRIBUTOR"; permission?: AdminPermission; superAdmin?: boolean; allowPasswordChange?: boolean };

function check(actor: Actor, mustChange: boolean, g: Guard) {
  if (mustChange && !g.allowPasswordChange) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED", "يجب تغيير كلمة المرور قبل المتابعة");
  }
  if (g.role && actor.role !== g.role) throw new AppError("FORBIDDEN", "لا تملك صلاحية الوصول");
  if (g.superAdmin && !(actor.role === "ADMIN" && actor.isSuperAdmin)) throw new AppError("FORBIDDEN", "لا تملك صلاحية الوصول");
  if (g.permission && !hasPermission(actor, g.permission)) throw new AppError("FORBIDDEN", "لا تملك صلاحية الوصول");
}

/** حارس واجهات API: يرمي AppError عند الفشل. */
export async function requireApiActor(g: Guard = {}): Promise<Actor> {
  const s = await currentSession();
  if (!s) throw new AppError("UNAUTHENTICATED", "انتهت الجلسة، يرجى تسجيل الدخول");
  check(s.actor, s.mustChangePassword, g);
  return s.actor;
}

/** حارس الصفحات: يعيد التوجيه بدل رمي الخطأ. */
export async function requirePageActor(g: Guard = {}): Promise<Actor> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.mustChangePassword && !g.allowPasswordChange) redirect("/change-password");
  try {
    check(s.actor, false, g);
  } catch {
    redirect("/forbidden");
  }
  return s.actor;
}
