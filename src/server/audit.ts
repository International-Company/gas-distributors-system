import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";
import type { Actor } from "./actor";

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  distributorId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

// حقول لا تُكتب في سجل التدقيق أبدًا.
const SECRET_KEYS = new Set(["passwordHash", "pinHash", "tokenHash", "deviceTokenHash", "password", "pin"]);

function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SECRET_KEYS.has(k) ? undefined : typeof v === "bigint" ? v.toString() : v)),
  );
}

/** يكتب سجل تدقيق داخل المعاملة نفسها، فلا تُعتمد العملية دون سجلها. */
export async function audit(tx: Tx, actor: Actor | null, e: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorUserId: actor?.userId ?? null,
      actorRole: actor ? actor.role : "SYSTEM",
      distributorId: e.distributorId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: sanitize(e.before),
      after: sanitize(e.after),
      reason: e.reason ?? null,
      ip: actor?.ip ?? null,
    },
  });
}
