import { z } from "zod";
import type { Tx } from "../db";
import { withSystem } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, assertRecentPassword, assertSuperAdmin } from "../actor";
import { audit } from "../audit";
import { hashSecret } from "../auth/crypto";
import { passwordSchema, usernameSchema } from "../auth/validation";
import { revokeAllDevicePins, revokeAllSessions } from "../auth/session";
import { isAdminPermission } from "../permissions";

// إدارة حسابات المديرين حصرية للمدير الرئيسي، وتعديلاتها عمليات حساسة (تحقق حديث بكلمة المرور).

const permissionsSchema = z
  .array(z.string())
  .refine((ps) => ps.every(isAdminPermission), "صلاحية غير معروفة")
  .transform((ps) => [...new Set(ps)]);

const optionalPhone = z.string().trim().max(20).optional().nullable().transform((v) => v || null);
const reasonSchema = z.string().trim().min(3, "يرجى كتابة السبب").max(500);

const createSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(2, "الاسم مطلوب").max(100),
  phone: optionalPhone,
  password: passwordSchema,
  isSuperAdmin: z.boolean().default(false),
  permissions: permissionsSchema.default([]),
});

const updateSchema = z.object({
  displayName: z.string().trim().min(2, "الاسم مطلوب").max(100).optional(),
  phone: optionalPhone,
  isSuperAdmin: z.boolean().optional(),
  permissions: permissionsSchema.optional(),
});

const adminSelect = {
  id: true, username: true, displayName: true, phone: true, status: true, isSuperAdmin: true,
  permissions: true, lastLoginAt: true, lockedUntil: true, createdAt: true,
} as const;

export async function listAdmins(actor: Actor) {
  assertSuperAdmin(actor);
  return withSystem((tx) => tx.user.findMany({ where: { role: "ADMIN" }, select: adminSelect, orderBy: { createdAt: "asc" } }));
}

export async function getAdmin(actor: Actor, id: string) {
  assertSuperAdmin(actor);
  return withSystem(async (tx) => {
    const a = await tx.user.findFirst({ where: { id, role: "ADMIN" }, select: adminSelect });
    if (!a) throw notFound("المدير");
    return a;
  });
}

export async function createAdmin(actor: Actor, input: unknown) {
  assertSuperAdmin(actor);
  assertRecentPassword(actor);
  const v = createSchema.parse(input);
  const passwordHash = await hashSecret(v.password);
  return withSystem(async (tx) => {
    if (await tx.user.findUnique({ where: { username: v.username } })) {
      throw new AppError("CONFLICT", "اسم المستخدم مستخدم مسبقًا", { username: "اسم المستخدم مستخدم مسبقًا" });
    }
    const u = await tx.user.create({
      data: {
        username: v.username, displayName: v.displayName, phone: v.phone, passwordHash, role: "ADMIN",
        isSuperAdmin: v.isSuperAdmin, permissions: v.isSuperAdmin ? [] : v.permissions, mustChangePassword: true,
      },
      select: adminSelect,
    });
    await audit(tx, actor, { action: "admin.create", entityType: "user", entityId: u.id, after: u });
    return u;
  });
}

function activeSuperAdminCount(tx: Tx) {
  return tx.user.count({ where: { role: "ADMIN", isSuperAdmin: true, status: "ACTIVE" } });
}

export async function updateAdmin(actor: Actor, id: string, input: unknown) {
  assertSuperAdmin(actor);
  assertRecentPassword(actor);
  const v = updateSchema.parse(input);
  return withSystem(async (tx) => {
    const before = await tx.user.findFirst({ where: { id, role: "ADMIN" }, select: adminSelect });
    if (!before) throw notFound("المدير");
    if (before.isSuperAdmin && v.isSuperAdmin === false) {
      if (id === actor.userId) throw new AppError("INVALID_STATE", "لا يمكنك إزالة صفة المدير الرئيسي عن نفسك");
      if ((await activeSuperAdminCount(tx)) <= 1) throw new AppError("INVALID_STATE", "يجب أن يبقى مدير رئيسي نشط واحد على الأقل");
    }
    const isSuper = v.isSuperAdmin ?? before.isSuperAdmin;
    const after = await tx.user.update({
      where: { id },
      data: {
        displayName: v.displayName,
        phone: v.phone,
        isSuperAdmin: v.isSuperAdmin,
        permissions: isSuper ? [] : (v.permissions ?? before.permissions),
      },
      select: adminSelect,
    });
    await audit(tx, actor, { action: "admin.update", entityType: "user", entityId: id, before, after });
    return after;
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: reasonSchema }),
  z.object({ action: z.literal("activate") }),
  z.object({ action: z.literal("reset-password"), newPassword: passwordSchema, reason: reasonSchema }),
  z.object({ action: z.literal("logout-all"), reason: reasonSchema }),
  z.object({ action: z.literal("unlock") }),
]);

export async function adminAction(actor: Actor, id: string, input: unknown) {
  assertSuperAdmin(actor);
  assertRecentPassword(actor);
  const a = actionSchema.parse(input);
  const newHash = a.action === "reset-password" ? await hashSecret(a.newPassword) : null;
  return withSystem(async (tx) => {
    const u = await tx.user.findFirst({ where: { id, role: "ADMIN" } });
    if (!u) throw notFound("المدير");
    const keepOwnSession = id === actor.userId ? actor.sessionId : null;
    const log = (action: string, after: unknown, reason?: string) =>
      audit(tx, actor, { action: `admin.${action}`, entityType: "user", entityId: id, after, reason });
    switch (a.action) {
      case "suspend":
        if (id === actor.userId) throw new AppError("INVALID_STATE", "لا يمكنك تعليق حسابك");
        if (u.status !== "ACTIVE") throw new AppError("INVALID_STATE", "الحساب معلّق بالفعل");
        if (u.isSuperAdmin && (await activeSuperAdminCount(tx)) <= 1) {
          throw new AppError("INVALID_STATE", "يجب أن يبقى مدير رئيسي نشط واحد على الأقل");
        }
        await tx.user.update({ where: { id }, data: { status: "SUSPENDED" } });
        await revokeAllSessions(tx, id, "تعليق حساب المدير");
        await revokeAllDevicePins(tx, id);
        await log("suspend", { status: "SUSPENDED" }, a.reason);
        break;
      case "activate":
        if (u.status === "ACTIVE") throw new AppError("INVALID_STATE", "الحساب نشط بالفعل");
        await tx.user.update({ where: { id }, data: { status: "ACTIVE" } });
        await log("activate", { status: "ACTIVE" });
        break;
      case "reset-password":
        await tx.user.update({
          where: { id },
          data: { passwordHash: newHash!, mustChangePassword: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        });
        await revokeAllSessions(tx, id, "إعادة تعيين كلمة المرور", keepOwnSession);
        await revokeAllDevicePins(tx, id);
        await log("reset_password", null, a.reason);
        break;
      case "logout-all":
        await revokeAllSessions(tx, id, "تسجيل خروج إجباري", keepOwnSession);
        await revokeAllDevicePins(tx, id);
        await log("logout_all", null, a.reason);
        break;
      case "unlock":
        await tx.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
        await log("unlock", null);
        break;
    }
  });
}
