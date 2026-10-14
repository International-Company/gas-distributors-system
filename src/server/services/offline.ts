import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withSystem, withTenant } from "../db";
import { AppError } from "../errors";
import { type Actor, type DistributorActor, assertDistributor } from "../actor";
import { audit } from "../audit";
import { getSettings } from "./settings";

// ---------------------------------------------------------------------------
// العمل دون اتصال (الشباك فقط)
//
// الجهاز يحمل «لقطة» مصغرة لما يلزم الشباك: المواطنون أصحاب استحقاقات قابلة للعمل، وجرارهم،
// والمتبقي عليهم. العمليات المنفذة دون اتصال تُرسل لاحقًا إلى المسارات العادية نفسها بمعرّفها،
// فيعيد الخادم كل التحقق. ما يرفضه الخادم يصبح حالة مراجعة ولا يُحسم تلقائيًا.
// ---------------------------------------------------------------------------

export type OfflinePolicy = { receive: boolean; deliver: boolean; payments: boolean; maxAgeHours: number };

export type SnapshotCylinder = { id: string; label: string; status: "EMPTY" | "FILLED" | "DELIVERED"; seq: number };
export type SnapshotEntitlement = {
  id: string;
  cycle: { id: string; name: string; status: string };
  status: string;
  citizenNumber: string;
  quantity: number;
  amountDue: string;
  paid: string;
  billable: boolean;
  cylinders: SnapshotCylinder[];
};
export type SnapshotCitizen = { citizenId: string; nationalId: string; fullName: string; entitlements: SnapshotEntitlement[] };
export type OfflineSnapshot = {
  generatedAt: string;
  userId: string;
  distributorId: string;
  currencySymbol: string;
  policy: OfflinePolicy;
  citizens: SnapshotCitizen[];
};

export async function offlinePolicy(): Promise<OfflinePolicy & { currencySymbol: string }> {
  const s = await withSystem(getSettings);
  return { receive: s.offlineReceive, deliver: s.offlineDeliver, payments: s.offlinePayments, maxAgeHours: s.offlineMaxAgeHours, currencySymbol: s.currencySymbol };
}

type EntRow = {
  id: string; cycleId: string; cycleName: string; cycleStatus: string; status: string; citizenNumber: string; quantity: number;
  amountDue: Prisma.Decimal; paid: Prisma.Decimal; billable: boolean; citizenId: string; nationalId: string; fullName: string;
};

/**
 * لقطة الشباك للجهاز. تحوي فقط ما يلزم للعمل: الاسم ورقم الهوية (للمطابقة مع البطاقة) والاستحقاقات القابلة للعمل.
 * لا أرقام هواتف ولا سجل تحصيلات ولا بيانات دورات قديمة منتهية.
 */
export async function offlineSnapshot(actor: Actor): Promise<OfflineSnapshot | { disabled: true }> {
  assertDistributor(actor);
  const policy = await offlinePolicy();
  if (!policy.receive && !policy.deliver && !policy.payments) return { disabled: true };
  return withTenant(actor.distributorId, async (tx) => {
    // القابل للعمل: كل استحقاقات الدورة النشطة، وما له جرار لم تُسلّم، وما عليه مبلغ متبقٍ.
    const ents = await tx.$queryRaw<EntRow[]>`
      WITH paid AS (
        SELECT "entitlementId", sum("amount") AS s FROM "payments" WHERE "status" = 'ACTIVE' GROUP BY 1
      ), cyl AS (
        SELECT "entitlementId",
          count(*) FILTER (WHERE "status" IN ('EMPTY', 'FILLED')) AS pending,
          count(*) FILTER (WHERE "status" <> 'VOID') AS live
        FROM "cylinders" GROUP BY 1
      )
      SELECT e."id", e."cycleId", cy."name" AS "cycleName", cy."status"::text AS "cycleStatus", e."status"::text AS "status",
        e."citizenNumber", e."quantity", e."amountDue", COALESCE(p.s, 0) AS paid,
        (e."status" = 'ACTIVE' OR COALESCE(y.live, 0) > 0) AS billable,
        c."id" AS "citizenId", c."nationalId", c."fullName"
      FROM "entitlements" e
      JOIN "cycles" cy ON cy."id" = e."cycleId"
      JOIN "citizens" c ON c."id" = e."citizenId"
      LEFT JOIN paid p ON p."entitlementId" = e."id"
      LEFT JOIN cyl y ON y."entitlementId" = e."id"
      WHERE c."mergedIntoId" IS NULL AND (
        cy."status" = 'OPEN'
        OR COALESCE(y.pending, 0) > 0
        OR ((e."status" = 'ACTIVE' OR COALESCE(y.live, 0) > 0) AND e."amountDue" > COALESCE(p.s, 0))
      )
      ORDER BY cy."number" DESC`;
    const ids = ents.map((e) => e.id);
    const cyls = ids.length
      ? await tx.cylinder.findMany({ where: { entitlementId: { in: ids }, status: { not: "VOID" } }, select: { id: true, entitlementId: true, label: true, status: true, seq: true }, orderBy: { seq: "asc" } })
      : [];
    const byEnt = new Map<string, SnapshotCylinder[]>();
    for (const c of cyls) {
      const list = byEnt.get(c.entitlementId) ?? [];
      list.push({ id: c.id, label: c.label, status: c.status as SnapshotCylinder["status"], seq: c.seq });
      byEnt.set(c.entitlementId, list);
    }
    const citizens = new Map<string, SnapshotCitizen>();
    for (const e of ents) {
      const c = citizens.get(e.citizenId) ?? { citizenId: e.citizenId, nationalId: e.nationalId, fullName: e.fullName, entitlements: [] };
      c.entitlements.push({
        id: e.id,
        cycle: { id: e.cycleId, name: e.cycleName, status: e.cycleStatus },
        status: e.status,
        citizenNumber: e.citizenNumber,
        quantity: e.quantity,
        amountDue: new Prisma.Decimal(e.amountDue).toFixed(2),
        paid: new Prisma.Decimal(e.paid).toFixed(2),
        billable: e.billable,
        cylinders: byEnt.get(e.id) ?? [],
      });
      citizens.set(e.citizenId, c);
    }
    await audit(tx, actor, { action: "offline.snapshot", entityType: "distributor", entityId: actor.distributorId, distributorId: actor.distributorId, after: { citizens: citizens.size, entitlements: ents.length } });
    const { currencySymbol, ...p } = policy;
    return {
      generatedAt: new Date().toISOString(),
      userId: actor.userId,
      distributorId: actor.distributorId,
      currencySymbol,
      policy: p,
      citizens: [...citizens.values()],
    };
  }, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// وقت التنفيذ على الجهاز، وتعارضات المزامنة
// ---------------------------------------------------------------------------

/** وقت تنفيذ العملية على الجهاز (للعمليات المرسلة من قائمة الانتظار). لا يُقبل وقت في المستقبل. */
export const offlineAtSchema = z
  .string()
  .datetime({ offset: true })
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (d.getTime() > Date.now() + 10 * 60_000) {
      ctx.addIssue({ code: "custom", message: "وقت التنفيذ على الجهاز في المستقبل؛ تحقق من ساعة الجهاز" });
      return z.NEVER;
    }
    return d;
  });

/** أخطاء تعني أن الخادم رفض العملية نفسها (لا عطلًا مؤقتًا): تصبح حالة مراجعة إن نُفذت دون اتصال. */
const REJECTION_CODES = new Set(["VALIDATION", "CONFLICT", "INVALID_STATE", "NOT_FOUND"]);

const OP_NAMES = { receive: "استلام جرة فارغة", deliver: "تسليم جرة", payment: "تحصيل" } as const;

/**
 * يسجل حالة مراجعة لعملية نُفذت دون اتصال ورفضها الخادم. حالة واحدة لكل عملية مهما تكررت المزامنة.
 * تُسجل في معاملة مستقلة لأن معاملة العملية نفسها أُلغيت.
 */
export async function recordOfflineConflict(
  actor: DistributorActor,
  op: { id: string; kind: keyof typeof OP_NAMES; nationalId?: string | null; offlineAt: Date; summary: string },
  error: AppError,
) {
  await withTenant(actor.distributorId, async (tx) => {
    const existing = await tx.reviewCase.findUnique({ where: { distributorId_sourceOpId: { distributorId: actor.distributorId, sourceOpId: op.id } } });
    if (existing) return;
    const c = await tx.reviewCase.create({
      data: {
        distributorId: actor.distributorId,
        type: "OFFLINE_CONFLICT",
        nationalId: op.nationalId ?? null,
        sourceOpId: op.id,
        details: `${OP_NAMES[op.kind]} نُفذ دون اتصال (${op.summary}) ورفضه الخادم عند المزامنة: ${error.message}`,
        createdById: actor.userId,
      },
    });
    await audit(tx, actor, {
      action: "offline.conflict", entityType: "review_case", entityId: c.id, distributorId: actor.distributorId,
      after: { op: op.kind, opId: op.id, offlineAt: op.offlineAt.toISOString(), code: error.code, message: error.message },
    });
  });
}

/** يغلّف تنفيذ عملية: إن كانت من قائمة انتظار الجهاز ورفضها الخادم، تُسجل حالة مراجعة ثم يُعاد الخطأ. */
export async function withOfflineConflict<T>(
  actor: DistributorActor,
  op: { id: string; kind: keyof typeof OP_NAMES; nationalId?: string | null; offlineAt: Date | null; summary: string },
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (op.offlineAt && e instanceof AppError && REJECTION_CODES.has(e.code)) {
      await recordOfflineConflict(actor, { ...op, offlineAt: op.offlineAt }, e);
    }
    throw e;
  }
}

/**
 * سياسة العمل دون اتصال تُفرض على الخادم أيضًا: عملية من قائمة الانتظار لنوع غير مسموح،
 * أو نُفذت ببيانات جهاز أقدم من الحد، تُرفض فتصبح حالة مراجعة.
 */
export async function assertOfflineAllowed(kind: keyof typeof OP_NAMES, offlineAt: Date | null, snapshotAt: Date | null) {
  // snapshotAt يرافق فقط ما نُفذ ببيانات الجهاز؛ إعادة إرسال عملية متصلة لم يصل تأكيدها لا تخضع لهذه السياسة.
  if (!offlineAt || !snapshotAt) return;
  const p = await offlinePolicy();
  const allowed = kind === "receive" ? p.receive : kind === "deliver" ? p.deliver : p.payments;
  if (!allowed) throw new AppError("INVALID_STATE", `${OP_NAMES[kind]} دون اتصال غير مسموح في إعدادات النظام`);
  if (offlineAt.getTime() - snapshotAt.getTime() > p.maxAgeHours * 3_600_000) {
    throw new AppError("INVALID_STATE", `نُفذت العملية ببيانات جهاز أقدم من الحد المسموح (${p.maxAgeHours} ساعة)`);
  }
}
