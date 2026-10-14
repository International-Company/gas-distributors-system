import { z } from "zod";
import { Prisma, type DistributorStatus } from "@prisma/client";
import type { Tx } from "../db";
import { withSystem, withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, assertAdmin, assertDistributor, assertRecentPassword } from "../actor";
import { audit } from "../audit";
import { hashSecret } from "../auth/crypto";
import { passwordSchema, usernameSchema } from "../auth/validation";
import { revokeAllDevicePins, revokeAllSessions } from "../auth/session";
import { revokeUserSessionsForDistributor, sweepExpired } from "./expiry";

const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} مطلوب`).max(max, `${label} طويل جدًا`);
const phone = z.string().trim().regex(/^[0-9+\-\s]{7,20}$/, "رقم هاتف غير صالح");

/** تاريخ انتهاء اختياري: null = بلا مدة محددة. */
const expiresAtSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "تاريخ غير صالح" });
      return z.NEVER;
    }
    return d;
  });

const validitySchema = z
  .object({ isTrial: z.boolean().default(false), expiresAt: expiresAtSchema })
  .superRefine((v, ctx) => {
    if (v.isTrial && !v.expiresAt) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "الحساب التجريبي يتطلب تاريخ انتهاء" });
    if (v.expiresAt && v.expiresAt <= new Date()) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "تاريخ الانتهاء يجب أن يكون في المستقبل" });
  });

const profileFields = {
  name: text(2, 120, "اسم الموزّع"),
  phone,
  region: text(2, 120, "المنطقة أو نطاق العمل"),
  categoryId: z.string().uuid().nullable().optional(),
};

export const createDistributorSchema = z
  .object({ ...profileFields, username: usernameSchema, password: passwordSchema, isTrial: z.boolean().default(false), expiresAt: expiresAtSchema })
  .superRefine((v, ctx) => {
    const r = validitySchema.safeParse({ isTrial: v.isTrial, expiresAt: v.expiresAt?.toISOString() ?? null });
    if (!r.success) for (const i of r.error.issues) ctx.addIssue(i);
  });

export const updateDistributorSchema = z.object({ ...profileFields, username: usernameSchema }).partial();

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED", "EXPIRED", "ALL"]).optional(),
  categoryId: z.string().uuid().optional(),
  trial: z.enum(["yes", "no"]).optional(),
  pinned: z.enum(["yes"]).optional(),
  expiringDays: z.coerce.number().int().min(1).max(365).optional(),
});
export type DistributorFilters = z.infer<typeof listSchema>;

const include = { category: true, user: { select: { id: true, username: true, lastLoginAt: true, status: true, lockedUntil: true, mustChangePassword: true } } } as const;

export async function listDistributors(actor: Actor, filters: unknown) {
  assertAdmin(actor, "distributors.view");
  const f = listSchema.parse(filters ?? {});
  return withSystem(async (tx) => {
    await sweepExpired(tx);
    const where: Prisma.DistributorWhereInput = {};
    // الافتراضي: إخفاء المؤرشفين ما لم تُطلب صراحة.
    if (!f.status) where.status = { not: "ARCHIVED" };
    else if (f.status === "EXPIRED") Object.assign(where, { status: "SUSPENDED", suspensionReason: "EXPIRED" });
    else if (f.status !== "ALL") where.status = f.status as DistributorStatus;
    if (f.categoryId) where.categoryId = f.categoryId;
    if (f.trial) where.isTrial = f.trial === "yes";
    if (f.pinned) where.isPinned = true;
    if (f.expiringDays) where.expiresAt = { gt: new Date(), lte: new Date(Date.now() + f.expiringDays * 86_400_000) };
    if (f.q) {
      where.OR = [
        { name: { contains: f.q, mode: "insensitive" } },
        { phone: { contains: f.q } },
        { region: { contains: f.q, mode: "insensitive" } },
        { user: { username: { contains: f.q.toLowerCase() } } },
      ];
    }
    return tx.distributor.findMany({ where, include, orderBy: [{ isPinned: "desc" }, { name: "asc" }], take: 1000 });
  });
}

export async function getDistributor(actor: Actor, id: string) {
  assertAdmin(actor, "distributors.view");
  return withSystem(async (tx) => {
    const d = await tx.distributor.findUnique({ where: { id }, include });
    if (!d) throw notFound("الموزّع");
    const activeSessions = d.user
      ? await tx.session.count({ where: { userId: d.user.id, revokedAt: null, expiresAt: { gt: new Date() } } })
      : 0;
    return { ...d, activeSessions };
  });
}

/** الموزّع يقرأ ملفه فقط، عبر سياق معزول بـ RLS. */
export async function getOwnDistributor(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, (tx) =>
    tx.distributor.findUniqueOrThrow({ where: { id: actor.distributorId }, include: { category: true } }),
  );
}

async function assertUsernameFree(tx: Tx, username: string, exceptUserId?: string) {
  const u = await tx.user.findUnique({ where: { username } });
  if (u && u.id !== exceptUserId) throw new AppError("CONFLICT", "اسم المستخدم مستخدم مسبقًا", { username: "اسم المستخدم مستخدم مسبقًا" });
}

async function assertCategory(tx: Tx, categoryId: string | null | undefined) {
  if (categoryId && !(await tx.distributorCategory.findUnique({ where: { id: categoryId } }))) {
    throw new AppError("VALIDATION", "المجموعة غير موجودة", { categoryId: "المجموعة غير موجودة" });
  }
}

export async function createDistributor(actor: Actor, input: unknown) {
  assertAdmin(actor, "distributors.manage");
  const v = createDistributorSchema.parse(input);
  const passwordHash = await hashSecret(v.password);
  return withSystem(async (tx) => {
    await assertUsernameFree(tx, v.username);
    await assertCategory(tx, v.categoryId);
    const d = await tx.distributor.create({
      data: {
        name: v.name,
        phone: v.phone,
        region: v.region,
        categoryId: v.categoryId ?? null,
        isTrial: v.isTrial,
        expiresAt: v.expiresAt,
        createdById: actor.userId,
      },
    });
    await tx.user.create({
      data: {
        username: v.username,
        passwordHash,
        role: "DISTRIBUTOR",
        displayName: v.name,
        phone: v.phone,
        distributorId: d.id,
        // كلمة المرور الأولى يحددها المدير، فيُلزم الموزّع بتغييرها.
        mustChangePassword: true,
      },
    });
    await audit(tx, actor, { action: "distributor.create", entityType: "distributor", entityId: d.id, distributorId: d.id, after: { ...d, username: v.username } });
    return d;
  });
}

export async function updateDistributor(actor: Actor, id: string, input: unknown) {
  assertAdmin(actor, "distributors.manage");
  const v = updateDistributorSchema.parse(input);
  return withSystem(async (tx) => {
    const before = await tx.distributor.findUnique({ where: { id }, include: { user: true } });
    if (!before || !before.user) throw notFound("الموزّع");
    if (v.username) await assertUsernameFree(tx, v.username, before.user.id);
    await assertCategory(tx, v.categoryId);
    const { username, ...profile } = v;
    const after = await tx.distributor.update({ where: { id }, data: profile });
    const userData: Prisma.UserUpdateInput = {};
    if (username && username !== before.user.username) userData.username = username;
    if (profile.name) userData.displayName = profile.name;
    if (profile.phone) userData.phone = profile.phone;
    if (Object.keys(userData).length) await tx.user.update({ where: { id: before.user.id }, data: userData });
    const { user, ...beforeProfile } = before;
    await audit(tx, actor, {
      action: "distributor.update",
      entityType: "distributor",
      entityId: id,
      distributorId: id,
      before: { ...beforeProfile, username: user.username },
      after: { ...after, username: username ?? user.username },
    });
    return after;
  });
}

const reasonSchema = z.string().trim().min(3, "يرجى كتابة السبب").max(500);

export const distributorActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: reasonSchema }),
  z.object({ action: z.literal("activate"), isTrial: z.boolean().default(false), expiresAt: z.string().nullable().optional(), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("set-validity"), isTrial: z.boolean(), expiresAt: z.string().nullable().optional(), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("archive"), reason: reasonSchema }),
  z.object({ action: z.literal("unarchive"), reason: reasonSchema }),
  z.object({ action: z.literal("pin") }),
  z.object({ action: z.literal("unpin") }),
  z.object({ action: z.literal("reset-password"), newPassword: passwordSchema, reason: reasonSchema, revokeSessions: z.boolean().default(true) }),
  z.object({ action: z.literal("logout-all"), reason: reasonSchema }),
  z.object({ action: z.literal("unlock") }),
]);

/** عمليات دورة حياة حساب الموزّع. كل عملية تتحقق من صلاحيتها وحالتها وتُسجَّل في التدقيق. */
export async function distributorAction(actor: Actor, id: string, input: unknown) {
  const a = distributorActionSchema.parse(input);
  const permission =
    a.action === "reset-password" || a.action === "logout-all" || a.action === "unlock"
      ? "distributors.credentials"
      : a.action === "pin" || a.action === "unpin"
        ? "distributors.manage"
        : "distributors.status";
  assertAdmin(actor, permission);
  if (a.action === "reset-password") assertRecentPassword(actor);
  const newPasswordHash = a.action === "reset-password" ? await hashSecret(a.newPassword) : null;

  return withSystem(async (tx) => {
    const d = await tx.distributor.findUnique({ where: { id }, include: { user: true } });
    if (!d || !d.user) throw notFound("الموزّع");
    const user = d.user;
    const now = new Date();
    const log = (action: string, before: unknown, after: unknown, reason?: string | null) =>
      audit(tx, actor, { action: `distributor.${action}`, entityType: "distributor", entityId: id, distributorId: id, before, after, reason });
    const statusSnapshot = { status: d.status, suspensionReason: d.suspensionReason, isTrial: d.isTrial, expiresAt: d.expiresAt };

    switch (a.action) {
      case "suspend": {
        if (d.status !== "ACTIVE") throw new AppError("INVALID_STATE", "لا يمكن تعليق حساب غير نشط");
        await tx.distributor.update({ where: { id }, data: { status: "SUSPENDED", suspensionReason: "MANUAL", statusChangedAt: now } });
        await revokeUserSessionsForDistributor(tx, id, "تعليق الحساب");
        await log("suspend", statusSnapshot, { status: "SUSPENDED", suspensionReason: "MANUAL" }, a.reason);
        break;
      }
      case "activate": {
        if (d.status === "ARCHIVED") throw new AppError("INVALID_STATE", "أعد الحساب من الأرشيف أولًا");
        if (d.status === "ACTIVE") throw new AppError("INVALID_STATE", "الحساب نشط بالفعل");
        const val = validitySchema.parse({ isTrial: a.isTrial, expiresAt: a.expiresAt });
        await tx.distributor.update({
          where: { id },
          data: { status: "ACTIVE", suspensionReason: null, statusChangedAt: now, isTrial: val.isTrial, expiresAt: val.expiresAt },
        });
        await log("activate", statusSnapshot, { status: "ACTIVE", ...val }, a.reason);
        break;
      }
      case "set-validity": {
        // يشمل: تمديد المدة، وتحويل التجريبي إلى فعلي، وإلغاء المدة.
        if (d.status === "ARCHIVED") throw new AppError("INVALID_STATE", "لا يمكن تعديل صلاحية حساب مؤرشف");
        const val = validitySchema.parse({ isTrial: a.isTrial, expiresAt: a.expiresAt });
        await tx.distributor.update({ where: { id }, data: { isTrial: val.isTrial, expiresAt: val.expiresAt } });
        await log("set_validity", statusSnapshot, val, a.reason);
        break;
      }
      case "archive": {
        if (d.status === "ARCHIVED") throw new AppError("INVALID_STATE", "الحساب مؤرشف بالفعل");
        // الأرشفة لا تحذف أي بيانات أو عمليات.
        await tx.distributor.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: now, isPinned: false, statusChangedAt: now } });
        await revokeUserSessionsForDistributor(tx, id, "أرشفة الحساب");
        await log("archive", statusSnapshot, { status: "ARCHIVED" }, a.reason);
        break;
      }
      case "unarchive": {
        if (d.status !== "ARCHIVED") throw new AppError("INVALID_STATE", "الحساب غير مؤرشف");
        // يعود معلّقًا، ثم يفعّله المدير بقرار منفصل مع تحديد الصلاحية.
        await tx.distributor.update({ where: { id }, data: { status: "SUSPENDED", suspensionReason: "MANUAL", archivedAt: null, statusChangedAt: now } });
        await log("unarchive", statusSnapshot, { status: "SUSPENDED" }, a.reason);
        break;
      }
      case "pin":
      case "unpin": {
        if (a.action === "pin" && d.status === "ARCHIVED") throw new AppError("INVALID_STATE", "لا يمكن تثبيت حساب مؤرشف");
        await tx.distributor.update({ where: { id }, data: { isPinned: a.action === "pin" } });
        await log(a.action, { isPinned: d.isPinned }, { isPinned: a.action === "pin" });
        break;
      }
      case "reset-password": {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: newPasswordHash!, mustChangePassword: true, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
        });
        let revoked = 0;
        if (a.revokeSessions) {
          revoked = await revokeAllSessions(tx, user.id, "إعادة تعيين كلمة المرور من الإدارة");
          await revokeAllDevicePins(tx, user.id);
        }
        await log("reset_password", null, { revokeSessions: a.revokeSessions, revokedSessions: revoked }, a.reason);
        break;
      }
      case "logout-all": {
        const revoked = await revokeAllSessions(tx, user.id, "تسجيل خروج إجباري من الإدارة");
        await revokeAllDevicePins(tx, user.id);
        await log("logout_all", null, { revokedSessions: revoked }, a.reason);
        break;
      }
      case "unlock": {
        await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
        await log("unlock", { lockedUntil: user.lockedUntil }, { lockedUntil: null });
        break;
      }
    }
    return tx.distributor.findUniqueOrThrow({ where: { id }, include });
  });
}

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "نشط",
  SUSPENDED: "معلّق",
  ARCHIVED: "مؤرشف",
  EXPIRED: "منتهي الصلاحية",
};

export function distributorStatusLabel(d: { status: string; suspensionReason: string | null }) {
  return d.status === "SUSPENDED" && d.suspensionReason === "EXPIRED" ? STATUS_LABELS.EXPIRED : STATUS_LABELS[d.status];
}
