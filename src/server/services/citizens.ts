import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Tx } from "../db";
import { withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, type DistributorActor, assertDistributor } from "../actor";
import { audit } from "../audit";
import { cleanText, digitsOnly, nameSimilarity, normalizeName } from "@/lib/arabic";

/** حد التشابه لاقتراح الدمج (من 0 إلى 1). */
const MERGE_SIMILARITY = 0.85;
import { isValidNationalId } from "@/lib/national-id";
import { lockCycle } from "./cycles";

function log(tx: Tx, actor: DistributorActor, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown, reason?: string) {
  return audit(tx, actor, { action, entityType, entityId, distributorId: actor.distributorId, after, before, reason });
}

// ---------------------------------------------------------------------------
// البحث
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  q: z.string().trim().min(1, "أدخل كلمة البحث").max(100),
  by: z.enum(["auto", "name", "nationalId", "phone", "citizenNumber"]).default("auto"),
  includeArchived: z.coerce.boolean().default(false),
});

export type SearchBy = "name" | "nationalId" | "phone" | "citizenNumber";

/** يحدد نوع البحث تلقائيًا من شكل النص. */
export function detectSearchType(q: string): SearchBy {
  const d = digitsOnly(q);
  const onlyDigits = d.length > 0 && digitsOnly(q).length === cleanText(q).replace(/[\s+-]/g, "").length;
  if (!onlyDigits) return "name";
  if (d.length === 9) return "nationalId";
  if (d.length >= 10 || d.startsWith("05") || d.startsWith("9705")) return "phone";
  return "citizenNumber";
}

/**
 * البحث بالاسم أو الهوية أو الهاتف أو رقم المواطن. ضمن بيانات الموزّع فقط (RLS).
 * رقم المواطن يُبحث في الدورة النشطة أولًا لأنه قد يتكرر بين الدورات.
 */
export async function searchCitizens(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = searchSchema.parse(input);
  const by: SearchBy = v.by === "auto" ? detectSearchType(v.q) : v.by;
  return withTenant(actor.distributorId, async (tx) => {
    const archived: Prisma.CitizenWhereInput = v.includeArchived ? {} : { archivedAt: null };
    const base: Prisma.CitizenWhereInput = { mergedIntoId: null, ...archived };
    let ids: string[] = [];
    if (by === "nationalId") {
      const d = digitsOnly(v.q);
      const found = await tx.citizen.findMany({ where: { ...base, nationalId: d.length === 9 ? d : { startsWith: d } }, select: { id: true }, take: 50 });
      ids = found.map((c) => c.id);
      // المواطن المدموج: البحث برقمه القديم يوصل إلى السجل الأساسي.
      if (!ids.length && d.length === 9) {
        const merged = await tx.citizen.findFirst({ where: { nationalId: d, mergedIntoId: { not: null } } });
        if (merged?.mergedIntoId) ids = [merged.mergedIntoId];
      }
    } else if (by === "phone") {
      const d = digitsOnly(v.q);
      const tail = d.slice(-9);
      const [c, e] = await Promise.all([
        tx.citizen.findMany({ where: { ...base, phone: { contains: tail } }, select: { id: true }, take: 50 }),
        tx.entitlement.findMany({ where: { phoneInStatement: { contains: tail }, citizen: base }, select: { citizenId: true }, take: 50 }),
      ]);
      ids = [...new Set([...c.map((x) => x.id), ...e.map((x) => x.citizenId)])];
    } else if (by === "citizenNumber") {
      const n = cleanText(v.q);
      const ents = await tx.entitlement.findMany({
        where: { citizenNumber: n, citizen: base },
        orderBy: [{ cycle: { status: "asc" } }, { cycle: { number: "desc" } }], // OPEN قبل CLOSED حسب ترتيب التعداد
        select: { citizenId: true },
        take: 50,
      });
      ids = [...new Set(ents.map((e) => e.citizenId))];
    } else {
      const n = normalizeName(v.q);
      if (n.length < 2) throw new AppError("VALIDATION", "أدخل حرفين على الأقل للبحث بالاسم");
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "citizens"
        WHERE "mergedIntoId" IS NULL ${v.includeArchived ? Prisma.empty : Prisma.sql`AND "archivedAt" IS NULL`}
          AND ("nameNormalized" LIKE ${"%" + n + "%"} OR similarity("nameNormalized", ${n}) > 0.35)
        ORDER BY ("nameNormalized" LIKE ${n + "%"}) DESC, similarity("nameNormalized", ${n}) DESC
        LIMIT 50`;
      ids = rows.map((r) => r.id);
    }
    if (!ids.length) return { by, results: [] };
    const citizens = await tx.citizen.findMany({
      where: { id: { in: ids } },
      include: { entitlements: { include: { cycle: { select: { id: true, name: true, status: true, number: true } } }, orderBy: { cycle: { number: "desc" } } } },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    citizens.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return {
      by,
      results: citizens.map((c) => {
        const current = c.entitlements.find((e) => e.cycle.status === "OPEN" && e.status === "ACTIVE");
        return {
          id: c.id,
          nationalId: c.nationalId,
          fullName: c.fullName,
          phone: c.phone,
          archived: !!c.archivedAt,
          current: current ? { citizenNumber: current.citizenNumber, quantity: current.quantity, amountDue: current.amountDue, cycleName: current.cycle.name } : null,
          cycles: c.entitlements.length,
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// ملف المواطن
// ---------------------------------------------------------------------------

export async function getCitizenProfile(actor: Actor, citizenId: string) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const c = await tx.citizen.findUnique({ where: { id: citizenId } });
    if (!c) throw notFound("المواطن");
    const [entitlements, mergedFrom, mergedInto] = await Promise.all([
      tx.entitlement.findMany({
        where: { citizenId },
        include: {
          cycle: { select: { id: true, name: true, number: true, status: true } },
          statement: { select: { id: true, title: true, version: true } },
          changes: { orderBy: { at: "desc" } },
        },
        orderBy: { cycle: { number: "desc" } },
      }),
      tx.citizen.findMany({ where: { mergedIntoId: citizenId }, select: { id: true, nationalId: true, fullName: true } }),
      c.mergedIntoId ? tx.citizen.findUnique({ where: { id: c.mergedIntoId }, select: { id: true, nationalId: true, fullName: true } }) : null,
    ]);
    const totalDue = entitlements.filter((e) => e.status === "ACTIVE").reduce((s, e) => s.add(e.amountDue), new Prisma.Decimal(0));
    const userIds = [...new Set(entitlements.flatMap((e) => e.changes.map((x) => x.userId)))];
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } });
    const names = Object.fromEntries(users.map((u) => [u.id, u.displayName]));
    // السجل الزمني: من تغييرات الاستحقاق حاليًا، وتضاف عمليات الجرار والتحصيل في المراحل التالية.
    const timeline = entitlements
      .flatMap((e) => [
        { at: e.createdAt, kind: "ENTITLEMENT_CREATED", cycleName: e.cycle.name, details: { citizenNumber: e.citizenNumber, quantity: e.quantity }, by: null as string | null },
        ...e.changes.map((ch) => ({ at: ch.at, kind: `CHANGE_${ch.source}`, cycleName: e.cycle.name, details: { before: ch.before, after: ch.after, reason: ch.reason }, by: names[ch.userId] ?? null })),
      ])
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    return { citizen: c, entitlements, totalDue, mergedFrom, mergedInto, timeline };
  });
}

// ---------------------------------------------------------------------------
// تعديل استحقاق معتمد
// ---------------------------------------------------------------------------

const editSchema = z.object({
  citizenNumber: z.string().trim().min(1).max(30).optional(),
  quantity: z.coerce.number().int().min(1).max(20).optional(),
  amountDue: z.union([z.string(), z.number()]).transform((v) => String(v).replace(/[٫,]/g, ".")).refine((v) => /^\d{1,8}(\.\d{1,2})?$/.test(v), "مبلغ غير صالح").optional(),
  nameInStatement: z.string().trim().min(2).max(200).optional(),
  reason: z.string().trim().min(3, "يرجى كتابة سبب التعديل").max(500),
});

/**
 * تعديل استحقاق في كشف معتمد: يُسجل القديم والجديد والسبب. مسموح في الدورة النشطة فقط.
 * التحقق من أثر التعديل على عمليات الجرار والتحصيل يضاف مع تلك العمليات (المرحلتان 3 و4).
 */
export async function editEntitlement(actor: Actor, entitlementId: string, input: unknown) {
  assertDistributor(actor);
  const v = editSchema.parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const e = await tx.entitlement.findUnique({ where: { id: entitlementId } });
    if (!e) throw notFound("الاستحقاق");
    const cycle = await lockCycle(tx, e.cycleId);
    if (cycle.status !== "OPEN") throw new AppError("INVALID_STATE", "لا يمكن تعديل استحقاق في دورة مغلقة. أعد فتح الدورة أولًا");
    if (e.status !== "ACTIVE") throw new AppError("INVALID_STATE", "لا يمكن تعديل استحقاق أُزيل من الكشف");
    const data: Prisma.EntitlementUpdateInput = {};
    if (v.citizenNumber !== undefined) data.citizenNumber = v.citizenNumber;
    if (v.quantity !== undefined) data.quantity = v.quantity;
    if (v.amountDue !== undefined) data.amountDue = new Prisma.Decimal(v.amountDue);
    if (v.nameInStatement !== undefined) data.nameInStatement = v.nameInStatement;
    if (!Object.keys(data).length) throw new AppError("VALIDATION", "لا توجد تغييرات");
    const before = { citizenNumber: e.citizenNumber, quantity: e.quantity, amountDue: e.amountDue.toFixed(2), nameInStatement: e.nameInStatement };
    const updated = await tx.entitlement.update({ where: { id: e.id }, data });
    const after = { citizenNumber: updated.citizenNumber, quantity: updated.quantity, amountDue: updated.amountDue.toFixed(2), nameInStatement: updated.nameInStatement };
    await tx.entitlementChange.create({ data: { distributorId: actor.distributorId, entitlementId: e.id, source: "MANUAL_EDIT", before, after, reason: v.reason, userId: actor.userId } });
    await log(tx, actor, "entitlement.edit", "entitlement", e.id, after, before, v.reason);
    return updated;
  }).catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("CONFLICT", "رقم المواطن مستخدم لمواطن آخر في هذه الدورة", { citizenNumber: "الرقم مستخدم" });
    }
    throw err;
  });
}

// ---------------------------------------------------------------------------
// الأرشفة
// ---------------------------------------------------------------------------

/** المواطن قابل للأرشفة إن كانت كل استحقاقاته في دورات مغلقة. */
const ARCHIVABLE = Prisma.sql`
  c."archivedAt" IS NULL AND c."mergedIntoId" IS NULL
  AND EXISTS (SELECT 1 FROM "entitlements" e WHERE e."citizenId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "entitlements" e JOIN "cycles" y ON y."id" = e."cycleId" WHERE e."citizenId" = c."id" AND y."status" = 'OPEN')`;

export async function countArchivable(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const [r] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "citizens" c WHERE ${ARCHIVABLE}`;
    return Number(r.n);
  });
}

/** أرشفة مواطني الدورات المنتهية دفعة واحدة. لا تحذف أي بيانات أو عمليات. */
export async function archiveEndedCycleCitizens(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const n = await tx.$executeRaw`UPDATE "citizens" c SET "archivedAt" = now(), "updatedAt" = now() WHERE ${ARCHIVABLE}`;
    await log(tx, actor, "citizen.archive_bulk", "citizen", "*", { count: n });
    return n;
  });
}

export async function setCitizenArchived(actor: Actor, citizenId: string, archived: boolean) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const c = await tx.citizen.findUnique({ where: { id: citizenId } });
    if (!c) throw notFound("المواطن");
    if (c.mergedIntoId) throw new AppError("INVALID_STATE", "هذا السجل مدموج في سجل آخر");
    if (archived) {
      if (c.archivedAt) throw new AppError("INVALID_STATE", "المواطن مؤرشف بالفعل");
      const open = await tx.entitlement.count({ where: { citizenId, cycle: { status: "OPEN" } } });
      if (open) throw new AppError("INVALID_STATE", "لا يمكن أرشفة مواطن له استحقاق في الدورة النشطة");
    } else if (!c.archivedAt) throw new AppError("INVALID_STATE", "المواطن غير مؤرشف");
    const updated = await tx.citizen.update({ where: { id: citizenId }, data: { archivedAt: archived ? new Date() : null } });
    await log(tx, actor, archived ? "citizen.archive" : "citizen.restore", "citizen", citizenId, { archived }, { archived: !archived });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// اقتراحات الدمج (مراجعة بشرية فقط)
// ---------------------------------------------------------------------------

/**
 * سجلات بأسماء متشابهة جدًا وأرقام هوية مختلفة (قد يكون أحدها خطأ إدخال في الكشف).
 * اقتراح فقط: لا دمج تلقائي.
 */
export async function mergeSuggestions(actor: Actor) {
  assertDistributor(actor);
  return withTenant(actor.distributorId, async (tx) => {
    const all = await tx.citizen.findMany({ where: { mergedIntoId: null }, select: { id: true, nameNormalized: true } });
    const dismissed = new Set((await tx.mergeDismissal.findMany({ select: { citizenAId: true, citizenBId: true } })).map((d) => `${d.citizenAId}|${d.citizenBId}`));
    // تجميع حسب الاسم الأول لتقليل المقارنات، ثم مقارنة داخل كل مجموعة.
    const buckets = new Map<string, typeof all>();
    for (const c of all) {
      const key = c.nameNormalized.split(" ")[0] ?? "";
      buckets.set(key, [...(buckets.get(key) ?? []), c]);
    }
    const pairs: { a: string; b: string; score: number }[] = [];
    for (const group of buckets.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [a, b] = [group[i].id, group[j].id].sort();
          if (dismissed.has(`${a}|${b}`)) continue;
          const score = nameSimilarity(group[i].nameNormalized, group[j].nameNormalized);
          if (score >= MERGE_SIMILARITY) pairs.push({ a, b, score });
        }
      }
    }
    pairs.sort((x, y) => y.score - x.score);
    pairs.splice(50);
    if (!pairs.length) return [];
    const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
    const citizens = await tx.citizen.findMany({ where: { id: { in: ids } }, include: { entitlements: { where: { status: "ACTIVE" }, include: { cycle: { select: { name: true } } } } } });
    const byId = new Map(citizens.map((c) => [c.id, c]));
    return pairs.map((p) => ({ score: Number(p.score), a: byId.get(p.a)!, b: byId.get(p.b)! }));
  });
}

export async function dismissMergeSuggestion(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = z.object({ citizenAId: z.string().uuid(), citizenBId: z.string().uuid() }).parse(input);
  const [a, b] = [v.citizenAId, v.citizenBId].sort();
  return withTenant(actor.distributorId, async (tx) => {
    await tx.mergeDismissal.upsert({
      where: { citizenAId_citizenBId: { citizenAId: a, citizenBId: b } },
      create: { distributorId: actor.distributorId, citizenAId: a, citizenBId: b, userId: actor.userId },
      update: {},
    });
    await log(tx, actor, "citizen.merge_dismiss", "citizen", a, { other: b });
  });
}

const mergeSchema = z.object({
  primaryId: z.string().uuid(),
  secondaryId: z.string().uuid(),
  reason: z.string().trim().min(3, "يرجى كتابة سبب الدمج").max(500),
});

/**
 * دمج سجلين بقرار بشري. يُرفض إن كان للسجلين استحقاق نشط في الدورة نفسها
 * (حتى لا ينتج استحقاق مزدوج أو تسليم مكرر). الكميات لا تُجمع.
 */
export async function mergeCitizens(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = mergeSchema.parse(input);
  if (v.primaryId === v.secondaryId) throw new AppError("VALIDATION", "اختر سجلين مختلفين");
  return withTenant(actor.distributorId, async (tx) => {
    const both = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "citizens" WHERE "id" IN (${v.primaryId}::uuid, ${v.secondaryId}::uuid) FOR UPDATE`;
    if (both.length !== 2) throw notFound("المواطن");
    const [p, s] = await Promise.all([tx.citizen.findUniqueOrThrow({ where: { id: v.primaryId } }), tx.citizen.findUniqueOrThrow({ where: { id: v.secondaryId } })]);
    if (p.mergedIntoId || s.mergedIntoId) throw new AppError("INVALID_STATE", "أحد السجلين مدموج مسبقًا");
    const [pe, se] = await Promise.all([
      tx.entitlement.findMany({ where: { citizenId: p.id, status: "ACTIVE" } }),
      tx.entitlement.findMany({ where: { citizenId: s.id } }),
    ]);
    const conflict = se.find((e) => e.status === "ACTIVE" && pe.some((x) => x.cycleId === e.cycleId));
    if (conflict) throw new AppError("INVALID_STATE", "لا يمكن الدمج: للسجلين استحقاق نشط في الدورة نفسها، والدمج قد يؤدي إلى تسليم مكرر");
    for (const e of se) {
      await tx.entitlement.update({ where: { id: e.id }, data: { citizenId: p.id } });
      await tx.entitlementChange.create({
        data: { distributorId: actor.distributorId, entitlementId: e.id, source: "MERGE", before: { citizenId: s.id, nationalId: s.nationalId }, after: { citizenId: p.id, nationalId: p.nationalId }, reason: v.reason, userId: actor.userId },
      });
    }
    await tx.citizen.update({ where: { id: s.id }, data: { mergedIntoId: p.id, archivedAt: new Date() } });
    await log(tx, actor, "citizen.merge", "citizen", p.id, { merged: { id: s.id, nationalId: s.nationalId, fullName: s.fullName }, movedEntitlements: se.length }, undefined, v.reason);
    return { movedEntitlements: se.length };
  });
}

// ---------------------------------------------------------------------------
// حالات المراجعة
// ---------------------------------------------------------------------------

const caseSchema = z.object({
  nationalId: z.string().trim().max(20).optional().nullable(),
  fullName: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  details: z.string().trim().min(3, "اكتب وصفًا مختصرًا للحالة").max(1000),
});

/**
 * مواطن حضر وليس في كشف معتمد: تُسجل حالة للمراجعة فقط، ولا يُنشأ مواطن أو استحقاق.
 */
export async function createReviewCase(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const v = caseSchema.parse(input);
  const nid = v.nationalId ? digitsOnly(v.nationalId) : null;
  if (nid && !isValidNationalId(nid)) throw new AppError("VALIDATION", "رقم الهوية غير صالح", { nationalId: "رقم الهوية غير صالح" });
  return withTenant(actor.distributorId, async (tx) => {
    if (nid) {
      const has = await tx.entitlement.findFirst({ where: { status: "ACTIVE", cycle: { status: "OPEN" }, citizen: { nationalId: nid } } });
      if (has) throw new AppError("INVALID_STATE", "لهذا المواطن استحقاق في كشف معتمد بالدورة النشطة؛ ابحث عنه بدل تسجيل حالة");
    }
    const c = await tx.reviewCase.create({
      data: { distributorId: actor.distributorId, type: "NOT_IN_STATEMENT", nationalId: nid, fullName: v.fullName || null, phone: v.phone || null, details: v.details, createdById: actor.userId },
    });
    await log(tx, actor, "review_case.create", "review_case", c.id, c);
    return c;
  });
}

export async function listReviewCases(actor: Actor, input: unknown) {
  assertDistributor(actor);
  const { status } = z.object({ status: z.enum(["OPEN", "RESOLVED"]).optional() }).parse(input ?? {});
  return withTenant(actor.distributorId, (tx) => tx.reviewCase.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 200 }));
}

export async function resolveReviewCase(actor: Actor, caseId: string, input: unknown) {
  assertDistributor(actor);
  const { resolution } = z.object({ resolution: z.string().trim().min(3, "اكتب نتيجة المراجعة").max(1000) }).parse(input);
  return withTenant(actor.distributorId, async (tx) => {
    const res = await tx.reviewCase.updateMany({ where: { id: caseId, status: "OPEN" }, data: { status: "RESOLVED", resolution, resolvedAt: new Date(), resolvedById: actor.userId } });
    if (!res.count) throw new AppError("INVALID_STATE", "الحالة غير موجودة أو مغلقة مسبقًا");
    await log(tx, actor, "review_case.resolve", "review_case", caseId, { resolution });
  });
}
