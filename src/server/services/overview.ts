import { withSystem, withTenant } from "../db";
import { type Actor, assertAdmin, assertDistributor, hasPermission } from "../actor";
import { sweepExpired } from "./expiry";

/** لوحة الموزّع: الدورة النشطة وحالة الكشوف. أعداد الجرار تُضاف مع المرحلة 3. */
export async function distributorOverview(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const cycle = await tx.cycle.findFirst({ where: { status: "OPEN" } });
    const [agg, statements, openCases] = await Promise.all([
      cycle ? tx.entitlement.aggregate({ where: { cycleId: cycle.id, status: "ACTIVE" }, _count: { _all: true }, _sum: { quantity: true } }) : null,
      tx.statement.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.reviewCase.count({ where: { status: "OPEN" } }),
    ]);
    const st = (s: string) => statements.find((x) => x.status === s)?._count._all ?? 0;
    return {
      cycle,
      citizens: agg?._count._all ?? 0,
      cylinders: agg?._sum.quantity ?? 0,
      pendingStatements: st("PENDING_REVIEW"),
      approvedStatements: st("APPROVED"),
      openCases,
    };
  });
}

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
