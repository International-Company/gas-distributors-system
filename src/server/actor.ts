import type { AuthMethod } from "@prisma/client";
import { AppError, forbidden } from "./errors";
import type { AdminPermission } from "./permissions";

/** هوية منفذ العملية كما يتحقق منها الخادم. لا تُبنى أبدًا من بيانات يرسلها العميل. */
export type Actor = {
  userId: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "DISTRIBUTOR";
  isSuperAdmin: boolean;
  permissions: string[];
  distributorId: string | null;
  sessionId: string | null;
  authMethod: AuthMethod | null;
  passwordVerifiedAt: Date | null;
  ip: string | null;
};

export type AdminActor = Actor & { role: "ADMIN" };
export type DistributorActor = Actor & { role: "DISTRIBUTOR"; distributorId: string };

export function hasPermission(actor: Actor, p: AdminPermission): boolean {
  return actor.role === "ADMIN" && (actor.isSuperAdmin || actor.permissions.includes(p));
}

export function assertAdmin(actor: Actor, p?: AdminPermission): asserts actor is AdminActor {
  if (actor.role !== "ADMIN") throw forbidden();
  if (p && !hasPermission(actor, p)) throw forbidden();
}

export function assertSuperAdmin(actor: Actor): asserts actor is AdminActor {
  if (actor.role !== "ADMIN" || !actor.isSuperAdmin) throw forbidden();
}

export function assertDistributor(actor: Actor): asserts actor is DistributorActor {
  if (actor.role !== "DISTRIBUTOR" || !actor.distributorId) throw forbidden();
}

/** مدة صلاحية التحقق بكلمة المرور للعمليات الحساسة. */
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

/** العمليات الحساسة تتطلب تحققًا حديثًا بكلمة المرور؛ الدخول بـ PIN لا يكفي. */
export function assertRecentPassword(actor: Actor, now = new Date()) {
  const t = actor.passwordVerifiedAt;
  if (!t || now.getTime() - t.getTime() > REAUTH_WINDOW_MS) {
    throw new AppError("REAUTH_REQUIRED", "هذه العملية حساسة، يرجى تأكيد كلمة المرور");
  }
}
