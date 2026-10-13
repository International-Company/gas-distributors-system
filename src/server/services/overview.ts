import { withSystem } from "../db";
import { type Actor, assertAdmin, hasPermission } from "../actor";
import { sweepExpired } from "./expiry";

/** ملخص لوحة مدير النظام في المرحلة الأولى: حالة الحسابات وأمان الدخول. */
export async function adminOverview(actor: Actor) {
  assertAdmin(actor);
  const canSeeDistributors = hasPermission(actor, "distributors.view");
  const canSeeSecurity = hasPermission(actor, "audit.view");
  return withSystem(async (tx) => {
    let accounts = null;
    if (canSeeDistributors) {
      await sweepExpired(tx);
      const now = new Date();
      const [active, suspended, expired, archived, trial, expiringSoon] = await Promise.all([
        tx.distributor.count({ where: { status: "ACTIVE" } }),
        tx.distributor.count({ where: { status: "SUSPENDED", suspensionReason: "MANUAL" } }),
        tx.distributor.count({ where: { status: "SUSPENDED", suspensionReason: "EXPIRED" } }),
        tx.distributor.count({ where: { status: "ARCHIVED" } }),
        tx.distributor.count({ where: { status: "ACTIVE", isTrial: true } }),
        tx.distributor.findMany({
          where: { status: "ACTIVE", expiresAt: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) } },
          orderBy: { expiresAt: "asc" },
          take: 10,
          select: { id: true, name: true, expiresAt: true, isTrial: true },
        }),
      ]);
      accounts = { active, suspended, expired, archived, trial, expiringSoon };
    }
    let security = null;
    if (canSeeSecurity) {
      const since = new Date(Date.now() - 24 * 3600_000);
      const [failed24h, locked] = await Promise.all([
        tx.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
        tx.user.count({ where: { lockedUntil: { gt: new Date() } } }),
      ]);
      security = { failed24h, locked };
    }
    return { accounts, security };
  });
}
