import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { Actor } from "@/server/actor";
import { hashSecret } from "@/server/auth/crypto";
import type { AdminPermission } from "@/server/permissions";

/** اتصال المالك: للتجهيز والتحقق في الاختبارات فقط (يتجاوز RLS). */
export const ownerDb = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

export const uid = () => randomBytes(4).toString("hex");
export const PASSWORD = "Passw0rd-123";

let cachedHash: string | null = null;
const pwHash = async () => (cachedHash ??= await hashSecret(PASSWORD));

export async function makeAdmin(opts: { superAdmin?: boolean; permissions?: AdminPermission[]; mustChangePassword?: boolean } = {}) {
  const user = await ownerDb.user.create({
    data: {
      username: `admin_${uid()}`,
      displayName: "مدير اختبار",
      passwordHash: await pwHash(),
      role: "ADMIN",
      isSuperAdmin: opts.superAdmin ?? false,
      permissions: opts.permissions ?? [],
      mustChangePassword: opts.mustChangePassword ?? false,
    },
  });
  return { user, actor: actorFor(user) };
}

export async function makeDistributor(opts: { expiresAt?: Date | null; isTrial?: boolean; status?: "ACTIVE" | "SUSPENDED" } = {}) {
  const d = await ownerDb.distributor.create({
    data: {
      name: `موزّع ${uid()}`,
      phone: "0599000000",
      region: "غزة",
      expiresAt: opts.expiresAt ?? null,
      isTrial: opts.isTrial ?? false,
      status: opts.status ?? "ACTIVE",
    },
  });
  const user = await ownerDb.user.create({
    data: { username: `dist_${uid()}`, displayName: d.name, passwordHash: await pwHash(), role: "DISTRIBUTOR", distributorId: d.id },
  });
  return { distributor: d, user, actor: actorFor(user) };
}

type U = { id: string; username: string; displayName: string; role: "ADMIN" | "DISTRIBUTOR"; isSuperAdmin: boolean; permissions: string[]; distributorId: string | null };

/** هوية منفذ موثّقة حديثًا بكلمة المرور (تكفي للعمليات الحساسة). */
export function actorFor(u: U, overrides: Partial<Actor> = {}): Actor {
  return {
    userId: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    isSuperAdmin: u.isSuperAdmin,
    permissions: u.permissions,
    distributorId: u.distributorId,
    sessionId: null,
    authMethod: "PASSWORD",
    passwordVerifiedAt: new Date(),
    ip: "127.0.0.1",
    ...overrides,
  };
}

export const client = { ip: "10.0.0.1", userAgent: "vitest" };
