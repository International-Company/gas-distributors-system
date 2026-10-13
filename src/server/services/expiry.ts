import type { Distributor } from "@prisma/client";
import type { Tx } from "../db";
import { audit } from "../audit";

/**
 * التعليق التلقائي عند انتهاء الصلاحية.
 * يُنفذ عند كل تحقق من الجلسة وتسجيل دخول وعند عرض قائمة الحسابات،
 * فلا يمكن لحساب منتهي الصلاحية تنفيذ أي عملية حتى دون مهمة مجدولة.
 */
export async function enforceExpiry(tx: Tx, d: Distributor, now = new Date()): Promise<Distributor> {
  if (d.status !== "ACTIVE" || !d.expiresAt || d.expiresAt > now) return d;
  // التحديث الشرطي يمنع تكرار التعليق وسجله إذا تزامن طلبان.
  const res = await tx.distributor.updateMany({
    where: { id: d.id, status: "ACTIVE" },
    data: { status: "SUSPENDED", suspensionReason: "EXPIRED", statusChangedAt: now },
  });
  if (res.count === 1) {
    await audit(tx, null, {
      action: "distributor.auto_suspend_expired",
      entityType: "distributor",
      entityId: d.id,
      distributorId: d.id,
      before: { status: d.status, expiresAt: d.expiresAt },
      after: { status: "SUSPENDED", suspensionReason: "EXPIRED" },
      reason: "انتهاء صلاحية الحساب",
    });
    await revokeUserSessionsForDistributor(tx, d.id, "انتهاء صلاحية الحساب");
  }
  return (await tx.distributor.findUniqueOrThrow({ where: { id: d.id } }));
}

/** يعلّق كل الحسابات المنتهية دفعة واحدة. */
export async function sweepExpired(tx: Tx, now = new Date()) {
  const expired = await tx.distributor.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } } });
  for (const d of expired) await enforceExpiry(tx, d, now);
  return expired.length;
}

export async function revokeUserSessionsForDistributor(tx: Tx, distributorId: string, reason: string) {
  const users = await tx.user.findMany({ where: { distributorId }, select: { id: true } });
  await tx.session.updateMany({
    where: { userId: { in: users.map((u) => u.id) }, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}
