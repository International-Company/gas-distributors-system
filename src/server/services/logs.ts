import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { appDb, withSystem } from "../db";
import { type Actor, assertAdmin } from "../actor";

const PAGE_SIZE = 50;

const dateRange = {
  from: z.string().optional().transform((v) => (v ? new Date(v) : undefined)),
  to: z.string().optional().transform((v) => (v ? new Date(`${v}T23:59:59.999`) : undefined)),
  page: z.coerce.number().int().min(1).default(1),
};

const auditFilters = z.object({
  ...dateRange,
  action: z.string().trim().max(100).optional(),
  distributorId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
});

export async function listAuditLogs(actor: Actor, filters: unknown) {
  assertAdmin(actor, "audit.view");
  const f = auditFilters.parse(filters ?? {});
  const where: Prisma.AuditLogWhereInput = {
    action: f.action ? { contains: f.action } : undefined,
    distributorId: f.distributorId,
    actorUserId: f.actorUserId,
    at: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
  };
  return withSystem(async (tx) => {
    const [rows, total] = await Promise.all([
      tx.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      tx.auditLog.count({ where }),
    ]);
    const userIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, displayName: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { rows: rows.map((r) => ({ ...r, actor: r.actorUserId ? byId.get(r.actorUserId) ?? null : null })), total, page: f.page, pageSize: PAGE_SIZE };
  });
}

const attemptFilters = z.object({
  ...dateRange,
  username: z.string().trim().toLowerCase().max(64).optional(),
  success: z.enum(["yes", "no"]).optional(),
});

export async function listLoginAttempts(actor: Actor, filters: unknown) {
  assertAdmin(actor, "audit.view");
  const f = attemptFilters.parse(filters ?? {});
  const where: Prisma.LoginAttemptWhereInput = {
    username: f.username ? { contains: f.username } : undefined,
    success: f.success ? f.success === "yes" : undefined,
    createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
  };
  return withSystem(async (tx) => {
    const [rows, total] = await Promise.all([
      tx.loginAttempt.findMany({ where, orderBy: { id: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      tx.loginAttempt.count({ where }),
    ]);
    return { rows, total, page: f.page, pageSize: PAGE_SIZE };
  });
}

export async function listErrorLogs(actor: Actor, filters: unknown) {
  assertAdmin(actor, "errors.view");
  const f = z.object(dateRange).parse(filters ?? {});
  const where: Prisma.ErrorLogWhereInput = { at: f.from || f.to ? { gte: f.from, lte: f.to } : undefined };
  return withSystem(async (tx) => {
    const [rows, total] = await Promise.all([
      tx.errorLog.findMany({ where, orderBy: { id: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      tx.errorLog.count({ where }),
    ]);
    return { rows, total, page: f.page, pageSize: PAGE_SIZE };
  });
}

/** يسجل الأخطاء التقنية غير المتوقعة. لا يرمي أبدًا حتى لا يحجب الخطأ الأصلي. */
export async function logError(err: unknown, context: { route?: string; userId?: string | null; extra?: Record<string, unknown> } = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error("[error]", context.route ?? "", e);
  try {
    await appDb.errorLog.create({
      data: {
        level: "error",
        message: e.message.slice(0, 2000),
        stack: e.stack?.slice(0, 8000) ?? null,
        route: context.route ?? null,
        userId: context.userId ?? null,
        context: (context.extra as Prisma.InputJsonValue) ?? undefined,
      },
    });
  } catch (inner) {
    console.error("[error] تعذر حفظ الخطأ في السجل", inner);
  }
}
