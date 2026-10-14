import { Prisma } from "@prisma/client";
import type { Tx } from "../db";
import { AppError } from "../errors";
import { plainDate, plainDateTime } from "@/lib/format";
import { MAX_REPORT_ROWS, type FilterSpec, type ReportDef, type ReportRow } from "./types";

// كل الاستعلامات تُنفذ داخل withTenant، فـ RLS يقصرها على بيانات الموزّع حتى في SQL الخام.

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const money = (v: unknown) => (v === null || v === undefined ? "0.00" : new Prisma.Decimal(v as Prisma.Decimal.Value).toFixed(2));
const sumMoney = (rows: ReportRow[], key: string) => rows.reduce((a, r) => a.add(new Prisma.Decimal((r[key] as string) ?? 0)), new Prisma.Decimal(0)).toFixed(2);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** بداية اليوم ونهايته بتوقيت غزة محولة إلى UTC (الأعمدة مخزنة UTC دون منطقة). */
const fromUtc = (d: string) => Prisma.sql`(((${d}::date)::timestamp AT TIME ZONE 'Asia/Gaza') AT TIME ZONE 'UTC')`;
const toUtcExclusive = (d: string) => Prisma.sql`((((${d}::date) + 1)::timestamp AT TIME ZONE 'Asia/Gaza') AT TIME ZONE 'UTC')`;

function dateRange(params: Record<string, string>, column: Prisma.Sql) {
  const from = params.from && DATE_RE.test(params.from) ? params.from : null;
  const to = params.to && DATE_RE.test(params.to) ? params.to : null;
  if (params.from && !from) throw new AppError("VALIDATION", "تاريخ البداية غير صالح");
  if (params.to && !to) throw new AppError("VALIDATION", "تاريخ النهاية غير صالح");
  const parts: Prisma.Sql[] = [];
  if (from) parts.push(Prisma.sql`${column} >= ${fromUtc(from)}`);
  if (to) parts.push(Prisma.sql`${column} < ${toUtcExclusive(to)}`);
  const text = from || to ? [`الفترة: ${from ? plainDate(`${from}T12:00:00Z`) : "البداية"} إلى ${to ? plainDate(`${to}T12:00:00Z`) : "الآن"}`] : [];
  return { sql: parts.length ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`, text };
}

/** الدورة المطلوبة، أو النشطة، أو الأحدث. */
async function resolveCycle(tx: Tx, cycleId: string | undefined) {
  if (cycleId) {
    const c = await tx.cycle.findUnique({ where: { id: cycleId } });
    if (!c) throw new AppError("NOT_FOUND", "الدورة غير موجودة");
    return c;
  }
  const c = (await tx.cycle.findFirst({ where: { status: "OPEN" } })) ?? (await tx.cycle.findFirst({ orderBy: { number: "desc" } }));
  if (!c) throw new AppError("INVALID_STATE", "لا توجد دورات بعد");
  return c;
}

const numberOrder = Prisma.sql`CASE WHEN e."citizenNumber" ~ '^[0-9]+$' THEN e."citizenNumber"::numeric END NULLS LAST, e."citizenNumber"`;
const limit = Prisma.sql`LIMIT ${MAX_REPORT_ROWS}`;
const capNote = (rows: unknown[]) => (rows.length >= MAX_REPORT_ROWS ? `يعرض التقرير أول ${MAX_REPORT_ROWS} صف فقط؛ ضيّق الفلاتر.` : undefined);

const cycleFilter: FilterSpec = { key: "cycleId", label: "الدورة", kind: "cycle" };
const cycleOptional: FilterSpec = { key: "cycleId", label: "الدورة", kind: "cycleOptional" };
const fromFilter: FilterSpec = { key: "from", label: "من تاريخ", kind: "from" };
const toFilter: FilterSpec = { key: "to", label: "إلى تاريخ", kind: "to" };

/** حالة استحقاق من جراره: تُستخدم في كشف المواطنين للطباعة. */
const ENT_STATE_LABELS: Record<string, string> = {
  NOT_RECEIVED: "لم تُستلم فارغة", EMPTY: "فارغة بانتظار التعبئة", FILLED: "معبأة جاهزة", DELIVERED: "سُلّمت", PARTIAL: "سُلّم جزء",
};

const entitlementStats = Prisma.sql`
  count(y.*) FILTER (WHERE y."status" <> 'VOID') AS received,
  count(y.*) FILTER (WHERE y."status" = 'EMPTY') AS empty,
  count(y.*) FILTER (WHERE y."status" = 'FILLED') AS filled,
  count(y.*) FILTER (WHERE y."status" = 'DELIVERED') AS delivered`;

type EntRow = {
  citizenNumber: string; name: string; nationalId: string; phone: string | null; quantity: number;
  received: bigint; empty: bigint; filled: bigint; delivered: bigint; amountDue: Prisma.Decimal; paid: Prisma.Decimal;
  emptyKg: Prisma.Decimal | null; fullKg: Prisma.Decimal | null; gasKg: Prisma.Decimal | null;
};

/** الأوزان من العمليات النافذة: الفارغ عند الاستلام، والممتلئ عند التسليم، والغاز = الفرق للجرة الموزونة مرتين. */
const weightStats = Prisma.sql`
  (SELECT sum(o."weightKg") FROM "cylinder_operations" o JOIN "cylinders" w ON w."id" = o."cylinderId"
    WHERE w."entitlementId" = e."id" AND o."type" = 'RECEIVE_EMPTY' AND o."status" = 'ACTIVE') AS "emptyKg",
  (SELECT sum(o."weightKg") FROM "cylinder_operations" o JOIN "cylinders" w ON w."id" = o."cylinderId"
    WHERE w."entitlementId" = e."id" AND o."type" = 'DELIVER' AND o."status" = 'ACTIVE') AS "fullKg",
  (SELECT sum(d."weightKg" - r."weightKg") FROM "cylinders" w
    JOIN "cylinder_operations" r ON r."cylinderId" = w."id" AND r."type" = 'RECEIVE_EMPTY' AND r."status" = 'ACTIVE'
    JOIN "cylinder_operations" d ON d."cylinderId" = w."id" AND d."type" = 'DELIVER' AND d."status" = 'ACTIVE'
    WHERE w."entitlementId" = e."id" AND r."weightKg" IS NOT NULL AND d."weightKg" IS NOT NULL) AS "gasKg"`;
const kg = (d: Prisma.Decimal | null) => (d === null ? null : new Prisma.Decimal(d).toFixed(2));

async function entitlementRows(tx: Tx, cycleId: string) {
  return tx.$queryRaw<EntRow[]>`
    SELECT e."citizenNumber", e."nameInStatement" AS name, c."nationalId", COALESCE(e."phoneInStatement", c."phone") AS phone, e."quantity",
      ${entitlementStats}, e."amountDue", ${weightStats},
      COALESCE((SELECT sum(p."amount") FROM "payments" p WHERE p."entitlementId" = e."id" AND p."status" = 'ACTIVE'), 0) AS paid
    FROM "entitlements" e
    JOIN "citizens" c ON c."id" = e."citizenId"
    LEFT JOIN "cylinders" y ON y."entitlementId" = e."id"
    WHERE e."cycleId" = ${cycleId}::uuid AND e."status" = 'ACTIVE'
    GROUP BY e."id", c."nationalId", c."phone"
    ORDER BY ${numberOrder} ${limit}`;
}

function entState(r: EntRow) {
  const d = n(r.delivered);
  if (d >= r.quantity) return "DELIVERED";
  if (n(r.filled)) return "FILLED";
  if (n(r.empty)) return "EMPTY";
  if (d > 0) return "PARTIAL";
  return "NOT_RECEIVED";
}

export const DISTRIBUTOR_REPORTS: ReportDef[] = [
  {
    key: "citizens-sheet",
    title: "كشف المواطنين للدورة",
    description: "كشف للطباعة بأرقام المواطنين وحالة جرارهم، مع تصفية حسب حالة الجرة.",
    filters: [
      cycleFilter,
      {
        key: "state", label: "حالة الجرة", kind: "select",
        options: [{ value: "", label: "الكل" }, ...Object.entries(ENT_STATE_LABELS).map(([value, label]) => ({ value, label })), { value: "NOT_DELIVERED", label: "لم تُسلّم بالكامل" }],
      },
    ],
    async run(tx, p) {
      const cycle = await resolveCycle(tx, p.cycleId);
      const all = await entitlementRows(tx, cycle.id);
      const rows = all
        .map((r) => ({ r, state: entState(r) }))
        .filter(({ state }) => !p.state || (p.state === "NOT_DELIVERED" ? state !== "DELIVERED" : state === p.state))
        .map(({ r, state }) => ({
          citizenNumber: r.citizenNumber, name: r.name, nationalId: r.nationalId, phone: r.phone, quantity: r.quantity,
          state: ENT_STATE_LABELS[state], emptyKg: kg(r.emptyKg), fullKg: kg(r.fullKg), gasKg: kg(r.gasKg),
          remaining: new Prisma.Decimal(r.amountDue).sub(r.paid).toFixed(2), notes: "",
        }));
      return {
        title: `كشف المواطنين — ${cycle.name}`,
        filtersText: [`الدورة: ${cycle.name}`, ...(p.state ? [`الحالة: ${p.state === "NOT_DELIVERED" ? "لم تُسلّم بالكامل" : ENT_STATE_LABELS[p.state]}`] : [])],
        columns: [
          { key: "citizenNumber", label: "رقم المواطن", type: "ltr", width: 10 },
          { key: "name", label: "الاسم", width: 30 },
          { key: "nationalId", label: "رقم الهوية", type: "ltr", width: 12 },
          { key: "phone", label: "الهاتف", type: "ltr", width: 13 },
          { key: "quantity", label: "الجرار", type: "number", width: 7 },
          { key: "state", label: "حالة الجرة", width: 18 },
          { key: "emptyKg", label: "وزن فارغ", type: "number", width: 9 },
          { key: "fullKg", label: "وزن ممتلئ", type: "number", width: 9 },
          { key: "gasKg", label: "الغاز", type: "number", width: 8 },
          { key: "remaining", label: "المتبقي", type: "money", width: 10 },
          { key: "notes", label: "ملاحظات / توقيع", width: 18 },
        ],
        rows,
        summary: [{ label: "عدد المواطنين", value: rows.length }, { label: "عدد الجرار", value: rows.reduce((a, r) => a + r.quantity, 0) }],
        note: capNote(all),
      };
    },
  },
  {
    key: "not-delivered",
    title: "مواطنون لم يستلموا جرارهم",
    description: "المستحقون في الدورة الذين لم تُسلّم لهم كل الجرار المستحقة.",
    filters: [cycleFilter],
    async run(tx, p) {
      const cycle = await resolveCycle(tx, p.cycleId);
      const all = await entitlementRows(tx, cycle.id);
      const rows = all.filter((r) => n(r.delivered) < r.quantity).map((r) => ({
        citizenNumber: r.citizenNumber, name: r.name, nationalId: r.nationalId, phone: r.phone, quantity: r.quantity,
        received: n(r.received), filled: n(r.filled), delivered: n(r.delivered), pending: r.quantity - n(r.delivered),
      }));
      return {
        title: `مواطنون لم يستلموا جرارهم — ${cycle.name}`,
        filtersText: [`الدورة: ${cycle.name}`],
        columns: [
          { key: "citizenNumber", label: "رقم المواطن", type: "ltr" }, { key: "name", label: "الاسم", width: 30 },
          { key: "nationalId", label: "رقم الهوية", type: "ltr" }, { key: "phone", label: "الهاتف", type: "ltr" },
          { key: "quantity", label: "المستحق", type: "number" }, { key: "received", label: "استُلمت فارغة", type: "number" },
          { key: "filled", label: "معبأة جاهزة", type: "number" }, { key: "delivered", label: "سُلّمت", type: "number" },
          { key: "pending", label: "لم تُسلّم", type: "number" },
        ],
        rows,
        summary: [{ label: "المواطنون", value: rows.length }, { label: "جرار لم تُسلّم", value: rows.reduce((a, r) => a + r.pending, 0) }],
        note: capNote(all),
      };
    },
  },
  {
    key: "unpaid",
    title: "مواطنون لم يسددوا كامل المستحقات",
    description: "الاستحقاقات القابلة للتحصيل التي عليها مبلغ متبقٍ.",
    filters: [cycleOptional],
    async run(tx, p, ctx) {
      const cycle = p.cycleId ? await resolveCycle(tx, p.cycleId) : null;
      const raw = await tx.$queryRaw<{ cycle: string; citizenNumber: string; name: string; nationalId: string; phone: string | null; amountDue: Prisma.Decimal; paid: Prisma.Decimal }[]>`
        SELECT y."name" AS cycle, e."citizenNumber", e."nameInStatement" AS name, c."nationalId", COALESCE(e."phoneInStatement", c."phone") AS phone, e."amountDue",
          COALESCE((SELECT sum(p."amount") FROM "payments" p WHERE p."entitlementId" = e."id" AND p."status" = 'ACTIVE'), 0) AS paid
        FROM "entitlements" e
        JOIN "cycles" y ON y."id" = e."cycleId"
        JOIN "citizens" c ON c."id" = e."citizenId"
        WHERE (e."status" = 'ACTIVE' OR EXISTS (SELECT 1 FROM "cylinders" z WHERE z."entitlementId" = e."id" AND z."status" <> 'VOID'))
          ${cycle ? Prisma.sql`AND e."cycleId" = ${cycle.id}::uuid` : Prisma.empty}
        ORDER BY y."number" DESC, ${numberOrder} ${limit}`;
      const rows = raw
        .map((r) => ({ cycle: r.cycle, citizenNumber: r.citizenNumber, name: r.name, nationalId: r.nationalId, phone: r.phone, due: money(r.amountDue), paid: money(r.paid), remaining: new Prisma.Decimal(r.amountDue).sub(r.paid).toFixed(2) }))
        .filter((r) => Number(r.remaining) > 0);
      return {
        title: "مواطنون لم يسددوا كامل المستحقات",
        filtersText: [cycle ? `الدورة: ${cycle.name}` : "كل الدورات"],
        columns: [
          { key: "cycle", label: "الدورة" }, { key: "citizenNumber", label: "رقم المواطن", type: "ltr" }, { key: "name", label: "الاسم", width: 30 },
          { key: "nationalId", label: "رقم الهوية", type: "ltr" }, { key: "phone", label: "الهاتف", type: "ltr" },
          { key: "due", label: "المطلوب", type: "money" }, { key: "paid", label: "المدفوع", type: "money" }, { key: "remaining", label: "المتبقي", type: "money" },
        ],
        rows,
        totals: { name: "الإجمالي", due: sumMoney(rows, "due"), paid: sumMoney(rows, "paid"), remaining: sumMoney(rows, "remaining") },
        summary: [{ label: "عدد الاستحقاقات", value: rows.length }, { label: `إجمالي المتبقي (${ctx.currencySymbol})`, value: sumMoney(rows, "remaining"), type: "money" }],
        note: capNote(raw),
      };
    },
  },
  ...(["EMPTY", "FILLED"] as const).map((status): ReportDef => ({
    key: status === "EMPTY" ? "empty-not-filled" : "filled-not-delivered",
    title: status === "EMPTY" ? "جرار فارغة لم تُعبأ" : "جرار معبأة جاهزة لم تُسلّم",
    description: status === "EMPTY" ? "الجرار المستلمة فارغة ولم تُعبأ بعد." : "الجرار المعبأة الجاهزة التي لم تُسلّم لأصحابها.",
    filters: [cycleOptional],
    async run(tx, p) {
      const cycle = p.cycleId ? await resolveCycle(tx, p.cycleId) : null;
      const raw = await tx.$queryRaw<{ label: string; name: string; nationalId: string; phone: string | null; cycle: string; since: Date }[]>`
        SELECT z."label", e."nameInStatement" AS name, c."nationalId", COALESCE(e."phoneInStatement", c."phone") AS phone, y."name" AS cycle, z."updatedAt" AS since
        FROM "cylinders" z
        JOIN "entitlements" e ON e."id" = z."entitlementId"
        JOIN "citizens" c ON c."id" = e."citizenId"
        JOIN "cycles" y ON y."id" = z."cycleId"
        WHERE z."status" = ${status}::"CylinderStatus" ${cycle ? Prisma.sql`AND z."cycleId" = ${cycle.id}::uuid` : Prisma.empty}
        ORDER BY z."updatedAt" ASC ${limit}`;
      const rows = raw.map((r) => ({ label: r.label, name: r.name, nationalId: r.nationalId, phone: r.phone, cycle: r.cycle, since: plainDateTime(r.since) }));
      return {
        title: status === "EMPTY" ? "جرار فارغة لم تُعبأ" : "جرار معبأة جاهزة لم تُسلّم",
        filtersText: [cycle ? `الدورة: ${cycle.name}` : "كل الدورات"],
        columns: [
          { key: "label", label: "رقم الجرة", type: "ltr" }, { key: "name", label: "الاسم", width: 30 }, { key: "nationalId", label: "رقم الهوية", type: "ltr" },
          { key: "phone", label: "الهاتف", type: "ltr" }, { key: "cycle", label: "الدورة" },
          { key: "since", label: status === "EMPTY" ? "استُلمت منذ" : "جاهزة منذ", type: "datetime" },
        ],
        rows,
        summary: [{ label: "عدد الجرار", value: rows.length }],
        note: capNote(raw),
      };
    },
  })),
  {
    key: "operations-period",
    title: "الجرار المستلمة والمعبأة والمسلّمة خلال فترة",
    description: "عمليات الجرار النافذة في الفترة المحددة مع إجمالي كل نوع.",
    filters: [fromFilter, toFilter, { key: "type", label: "العملية", kind: "select", options: [{ value: "", label: "الكل" }, { value: "RECEIVE_EMPTY", label: "استلام فارغة" }, { value: "FILL", label: "تعبئة" }, { value: "DELIVER", label: "تسليم" }] }],
    async run(tx, p) {
      const r = dateRange(p, Prisma.sql`o."at"`);
      const type = ["RECEIVE_EMPTY", "FILL", "DELIVER"].includes(p.type) ? p.type : null;
      const raw = await tx.$queryRaw<{ at: Date; type: string; label: string; name: string; cycle: string; user: string; shipment: string | null }[]>`
        SELECT o."at", o."type"::text AS type, z."label", e."nameInStatement" AS name, y."name" AS cycle, u."displayName" AS user,
          (SELECT st."name" FROM "shipments" sh JOIN "stations" st ON st."id" = sh."stationId" WHERE sh."id" = o."shipmentId") AS shipment
        FROM "cylinder_operations" o
        JOIN "cylinders" z ON z."id" = o."cylinderId"
        JOIN "entitlements" e ON e."id" = z."entitlementId"
        JOIN "cycles" y ON y."id" = z."cycleId"
        LEFT JOIN "users" u ON u."id" = o."userId"
        WHERE o."status" = 'ACTIVE' AND ${r.sql} ${type ? Prisma.sql`AND o."type" = ${type}::"OperationType"` : Prisma.empty}
        ORDER BY o."at" ASC ${limit}`;
      const LABEL: Record<string, string> = { RECEIVE_EMPTY: "استلام فارغة", FILL: "تعبئة", DELIVER: "تسليم" };
      const rows = raw.map((x) => ({ at: plainDateTime(x.at), type: LABEL[x.type], label: x.label, name: x.name, cycle: x.cycle, source: x.shipment ? `نقلة ${x.shipment}` : "", user: x.user ?? "" }));
      const count = (t: string) => raw.filter((x) => x.type === t).length;
      return {
        title: "الجرار المستلمة والمعبأة والمسلّمة",
        filtersText: [...(r.text.length ? r.text : ["كل الفترات"]), ...(type ? [`العملية: ${LABEL[type]}`] : [])],
        columns: [
          { key: "at", label: "الوقت", type: "datetime" }, { key: "type", label: "العملية" }, { key: "label", label: "رقم الجرة", type: "ltr" },
          { key: "name", label: "الاسم", width: 30 }, { key: "cycle", label: "الدورة" }, { key: "source", label: "المصدر" }, { key: "user", label: "المستخدم" },
        ],
        rows,
        summary: [{ label: "استلام فارغة", value: count("RECEIVE_EMPTY") }, { label: "تعبئة", value: count("FILL") }, { label: "تسليم", value: count("DELIVER") }],
        note: capNote(raw),
      };
    },
  },
  {
    key: "cycles-comparison",
    title: "مقارنة الدورات",
    description: "عدد المستحقين والجرار المسلّمة والمبالغ المحصلة لكل دورة.",
    filters: [],
    async run(tx, _p, ctx) {
      const raw = await tx.$queryRaw<{ name: string; status: string; openedAt: Date; closedAt: Date | null; citizens: bigint; cylinders: bigint; delivered: bigint; due: Prisma.Decimal; collected: Prisma.Decimal }[]>`
        SELECT y."name", y."status"::text AS status, y."openedAt", y."closedAt",
          (SELECT count(*) FROM "entitlements" e WHERE e."cycleId" = y."id" AND e."status" = 'ACTIVE') AS citizens,
          (SELECT COALESCE(sum(e."quantity"), 0) FROM "entitlements" e WHERE e."cycleId" = y."id" AND e."status" = 'ACTIVE') AS cylinders,
          (SELECT count(*) FROM "cylinders" z WHERE z."cycleId" = y."id" AND z."status" = 'DELIVERED') AS delivered,
          (SELECT COALESCE(sum(e."amountDue"), 0) FROM "entitlements" e WHERE e."cycleId" = y."id" AND e."status" = 'ACTIVE') AS due,
          (SELECT COALESCE(sum(p."amount"), 0) FROM "payments" p WHERE p."cycleId" = y."id" AND p."status" = 'ACTIVE') AS collected
        FROM "cycles" y ORDER BY y."number" DESC`;
      const rows = raw.map((c) => ({
        name: c.name, status: c.status === "OPEN" ? "نشطة" : "مغلقة", openedAt: plainDate(c.openedAt), closedAt: c.closedAt ? plainDate(c.closedAt) : "",
        citizens: n(c.citizens), cylinders: n(c.cylinders), delivered: n(c.delivered), due: money(c.due), collected: money(c.collected),
      }));
      return {
        title: "مقارنة الدورات",
        filtersText: [`المبالغ بـ ${ctx.currencySymbol}`],
        columns: [
          { key: "name", label: "الدورة" }, { key: "status", label: "الحالة" }, { key: "openedAt", label: "الفتح", type: "date" }, { key: "closedAt", label: "الإغلاق", type: "date" },
          { key: "citizens", label: "المستحقون", type: "number" }, { key: "cylinders", label: "الجرار المستحقة", type: "number" },
          { key: "delivered", label: "الجرار المسلّمة", type: "number" }, { key: "due", label: "المطلوب", type: "money" }, { key: "collected", label: "المحصل", type: "money" },
        ],
        rows,
      };
    },
  },
  {
    key: "collections",
    title: "التحصيلات",
    description: "تحصيلات المواطنين النافذة حسب الفترة أو الدورة.",
    filters: [cycleOptional, fromFilter, toFilter],
    async run(tx, p) {
      const r = dateRange(p, Prisma.sql`p."paidAt"`);
      const cycle = p.cycleId ? await resolveCycle(tx, p.cycleId) : null;
      const raw = await tx.$queryRaw<{ paidAt: Date; cycle: string; citizenNumber: string; name: string; nationalId: string; amount: Prisma.Decimal; user: string | null; notes: string | null }[]>`
        SELECT p."paidAt", y."name" AS cycle, e."citizenNumber", e."nameInStatement" AS name, c."nationalId", p."amount", u."displayName" AS user, p."notes"
        FROM "payments" p
        JOIN "entitlements" e ON e."id" = p."entitlementId"
        JOIN "citizens" c ON c."id" = e."citizenId"
        JOIN "cycles" y ON y."id" = p."cycleId"
        LEFT JOIN "users" u ON u."id" = p."userId"
        WHERE p."status" = 'ACTIVE' AND ${r.sql} ${cycle ? Prisma.sql`AND p."cycleId" = ${cycle.id}::uuid` : Prisma.empty}
        ORDER BY p."paidAt" ASC ${limit}`;
      const rows = raw.map((x) => ({ paidAt: plainDateTime(x.paidAt), cycle: x.cycle, citizenNumber: x.citizenNumber, name: x.name, nationalId: x.nationalId, amount: money(x.amount), user: x.user ?? "", notes: x.notes ?? "" }));
      return {
        title: "التحصيلات",
        filtersText: [cycle ? `الدورة: ${cycle.name}` : "كل الدورات", ...r.text],
        columns: [
          { key: "paidAt", label: "الوقت", type: "datetime" }, { key: "cycle", label: "الدورة" }, { key: "citizenNumber", label: "رقم المواطن", type: "ltr" },
          { key: "name", label: "الاسم", width: 28 }, { key: "nationalId", label: "رقم الهوية", type: "ltr" }, { key: "amount", label: "المبلغ", type: "money" },
          { key: "user", label: "المستخدم" }, { key: "notes", label: "ملاحظات" },
        ],
        rows,
        totals: { name: "الإجمالي", amount: sumMoney(rows, "amount") },
        summary: [{ label: "عدد التحصيلات", value: rows.length }, { label: "الإجمالي", value: sumMoney(rows, "amount"), type: "money" }],
        note: capNote(raw),
      };
    },
  },
  {
    key: "expenses",
    title: "المصروفات",
    description: "المصروفات التشغيلية النافذة في الفترة.",
    filters: [fromFilter, toFilter],
    async run(tx, p) {
      const r = dateRange(p, Prisma.sql`x."spentAt"`);
      const raw = await tx.$queryRaw<{ spentAt: Date; description: string; amount: Prisma.Decimal }[]>`
        SELECT x."spentAt", x."description", x."amount" FROM "expenses" x WHERE x."status" = 'ACTIVE' AND ${r.sql} ORDER BY x."spentAt" ASC ${limit}`;
      const rows = raw.map((x) => ({ spentAt: plainDateTime(x.spentAt), description: x.description, amount: money(x.amount) }));
      return {
        title: "المصروفات",
        filtersText: r.text.length ? r.text : ["كل الفترات"],
        columns: [{ key: "spentAt", label: "التاريخ", type: "datetime" }, { key: "description", label: "الوصف", width: 40 }, { key: "amount", label: "المبلغ", type: "money" }],
        rows,
        totals: { description: "الإجمالي", amount: sumMoney(rows, "amount") },
        note: capNote(raw),
      };
    },
  },
  {
    key: "cash-box",
    title: "الصندوق",
    description: "المقبوضات والمصروفات ودفعات المحطات والرصيد المحسوب في الفترة.",
    filters: [fromFilter, toFilter],
    async run(tx, p) {
      const rp = dateRange(p, Prisma.sql`t."at"`);
      const raw = await tx.$queryRaw<{ at: Date; kind: string; description: string; amount: Prisma.Decimal }[]>`
        SELECT * FROM (
          SELECT p."paidAt" AS at, 'تحصيل' AS kind, ('تحصيل من ' || e."nameInStatement" || ' (رقم ' || e."citizenNumber" || ')') AS description, p."amount" AS amount
            FROM "payments" p JOIN "entitlements" e ON e."id" = p."entitlementId" WHERE p."status" = 'ACTIVE'
          UNION ALL
          SELECT x."spentAt", 'مصروف', x."description", -x."amount" FROM "expenses" x WHERE x."status" = 'ACTIVE'
          UNION ALL
          SELECT s."paidAt", 'دفعة محطة', ('دفعة لمحطة ' || st."name" || COALESCE(' (' || s."reference" || ')', '')), -s."amount"
            FROM "station_payments" s JOIN "stations" st ON st."id" = s."stationId" WHERE s."status" = 'ACTIVE'
        ) t WHERE ${rp.sql} ORDER BY t."at" ASC ${limit}`;
      const rows = raw.map((x) => ({ at: plainDateTime(x.at), kind: x.kind, description: x.description, amount: money(x.amount) }));
      const sum = (k: string) => raw.filter((x) => x.kind === k).reduce((a, x) => a.add(x.amount), new Prisma.Decimal(0));
      const balance = raw.reduce((a, x) => a.add(x.amount), new Prisma.Decimal(0));
      return {
        title: "الصندوق",
        filtersText: rp.text.length ? rp.text : ["كل الفترات"],
        columns: [{ key: "at", label: "الوقت", type: "datetime" }, { key: "kind", label: "النوع" }, { key: "description", label: "البيان", width: 40 }, { key: "amount", label: "المبلغ", type: "money" }],
        rows,
        totals: { description: "الرصيد المحسوب", amount: balance.toFixed(2) },
        summary: [
          { label: "المقبوضات", value: sum("تحصيل").toFixed(2), type: "money" },
          { label: "المصروفات", value: sum("مصروف").neg().toFixed(2), type: "money" },
          { label: "دفعات المحطات", value: sum("دفعة محطة").neg().toFixed(2), type: "money" },
          { label: "الرصيد المحسوب", value: balance.toFixed(2), type: "money" },
        ],
        note: "الرصيد محسوب من السجلات ولا يثبت مقدار النقد الموجود فعلًا.",
      };
    },
  },
  {
    key: "stations",
    title: "حسابات محطات التعبئة",
    description: "قيمة النقلات المستلمة والمدفوع والمتبقي لكل محطة.",
    filters: [],
    async run(tx) {
      const raw = await tx.$queryRaw<{ name: string; shipments: bigint; cylinders: bigint; value: Prisma.Decimal; paid: Prisma.Decimal }[]>`
        SELECT st."name",
          (SELECT count(*) FROM "shipments" s WHERE s."stationId" = st."id" AND s."status" = 'ACTIVE') AS shipments,
          (SELECT COALESCE(sum(s."quantity"), 0) FROM "shipments" s WHERE s."stationId" = st."id" AND s."status" = 'ACTIVE') AS cylinders,
          (SELECT COALESCE(sum(s."quantity" * s."unitPrice"), 0) FROM "shipments" s WHERE s."stationId" = st."id" AND s."status" = 'ACTIVE') AS value,
          (SELECT COALESCE(sum(sp."amount"), 0) FROM "station_payments" sp WHERE sp."stationId" = st."id" AND sp."status" = 'ACTIVE') AS paid
        FROM "stations" st ORDER BY st."name"`;
      const rows = raw.map((s) => ({ name: s.name, shipments: n(s.shipments), cylinders: n(s.cylinders), value: money(s.value), paid: money(s.paid), remaining: new Prisma.Decimal(s.value).sub(s.paid).toFixed(2) }));
      return {
        title: "حسابات محطات التعبئة",
        filtersText: ["الرصيد الموجب مستحق للمحطة، والسالب دفع مقدم"],
        columns: [
          { key: "name", label: "المحطة" }, { key: "shipments", label: "النقلات", type: "number" }, { key: "cylinders", label: "الجرار المستلمة", type: "number" },
          { key: "value", label: "قيمة النقلات", type: "money" }, { key: "paid", label: "المدفوع", type: "money" }, { key: "remaining", label: "المتبقي", type: "money" },
        ],
        rows,
        totals: { name: "الإجمالي", value: sumMoney(rows, "value"), paid: sumMoney(rows, "paid"), remaining: sumMoney(rows, "remaining") },
      };
    },
  },
  {
    key: "inventory",
    title: "حركة المخزون",
    description: "حركات المخزون في الفترة مع الرصيد بعد كل حركة.",
    filters: [fromFilter, toFilter],
    async run(tx, p) {
      const r = dateRange(p, Prisma.sql`m."at"`);
      const raw = await tx.$queryRaw<{ at: Date; type: string; emptyDelta: number; filledDelta: number; extraDelta: number; emptyAfter: number; filledAfter: number; extraAfter: number; label: string | null; note: string | null }[]>`
        SELECT m."at", m."type"::text AS type, m."emptyDelta", m."filledDelta", m."extraDelta", m."emptyAfter", m."filledAfter", m."extraAfter",
          (SELECT z."label" FROM "cylinder_operations" o JOIN "cylinders" z ON z."id" = o."cylinderId" WHERE o."id" = m."operationId") AS label, m."note"
        FROM "inventory_movements" m WHERE ${r.sql} ORDER BY m."id" ASC ${limit}`;
      const LABEL: Record<string, string> = { RECEIVE_EMPTY: "استلام فارغة", FILL: "تعبئة", DELIVER: "تسليم", SHIPMENT_EXTRA: "نقلة: كمية إضافية", REVERSAL: "عكس حركة (إلغاء)" };
      const sign = (v: number) => (v > 0 ? `+${v}` : v < 0 ? String(v) : "");
      const rows = raw.map((m) => ({
        at: plainDateTime(m.at), type: LABEL[m.type], label: m.label ?? "", empty: sign(m.emptyDelta), filled: sign(m.filledDelta), extra: sign(m.extraDelta),
        after: `${m.emptyAfter} / ${m.filledAfter} / ${m.extraAfter}`, note: m.note ?? "",
      }));
      return {
        title: "حركة المخزون",
        filtersText: r.text.length ? r.text : ["كل الفترات"],
        columns: [
          { key: "at", label: "الوقت", type: "datetime" }, { key: "type", label: "الحركة" }, { key: "label", label: "رقم الجرة", type: "ltr" },
          { key: "empty", label: "فارغ", type: "ltr" }, { key: "filled", label: "معبأ", type: "ltr" }, { key: "extra", label: "إضافي", type: "ltr" },
          { key: "after", label: "الرصيد بعدها (فارغ/معبأ/إضافي)", type: "ltr" }, { key: "note", label: "ملاحظة" },
        ],
        rows,
        note: capNote(raw),
      };
    },
  },
  {
    key: "statements",
    title: "الكشوف والدورات",
    description: "كل الكشوف المستوردة وحالاتها ودوراتها وعدد صفوفها.",
    filters: [cycleOptional],
    async run(tx, p) {
      const cycle = p.cycleId ? await resolveCycle(tx, p.cycleId) : null;
      const raw = await tx.$queryRaw<{ title: string; version: number; status: string; cycle: string | null; importedAt: Date; approvedAt: Date | null; rows: bigint; errors: bigint }[]>`
        SELECT s."title", s."version", s."status"::text AS status, y."name" AS cycle, s."importedAt", s."approvedAt",
          (SELECT count(*) FROM "statement_rows" r WHERE r."statementId" = s."id" AND NOT r."excluded") AS rows,
          (SELECT count(*) FROM "statement_rows" r WHERE r."statementId" = s."id" AND NOT r."excluded" AND r."severity" = 'ERROR') AS errors
        FROM "statements" s LEFT JOIN "cycles" y ON y."id" = s."cycleId"
        ${cycle ? Prisma.sql`WHERE s."cycleId" = ${cycle.id}::uuid` : Prisma.empty}
        ORDER BY s."importedAt" DESC ${limit}`;
      const ST: Record<string, string> = { PENDING_REVIEW: "قيد المراجعة", APPROVED: "معتمد", SUPERSEDED: "إصدار سابق", DISCARDED: "ملغى" };
      const rows = raw.map((s) => ({ title: s.title, version: s.version, status: ST[s.status], cycle: s.cycle ?? "", importedAt: plainDateTime(s.importedAt), approvedAt: s.approvedAt ? plainDateTime(s.approvedAt) : "", rows: n(s.rows), errors: n(s.errors) }));
      return {
        title: "الكشوف والدورات",
        filtersText: [cycle ? `الدورة: ${cycle.name}` : "كل الدورات"],
        columns: [
          { key: "title", label: "الكشف", width: 30 }, { key: "version", label: "الإصدار", type: "number" }, { key: "status", label: "الحالة" }, { key: "cycle", label: "الدورة" },
          { key: "importedAt", label: "الاستيراد", type: "datetime" }, { key: "approvedAt", label: "الاعتماد", type: "datetime" },
          { key: "rows", label: "الصفوف", type: "number" }, { key: "errors", label: "أخطاء", type: "number" },
        ],
        rows,
      };
    },
  },
];

export const findDistributorReport = (key: string) => DISTRIBUTOR_REPORTS.find((r) => r.key === key);
