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
  NOT_RECEIVED: "لسا ما جاب الجرة", EMPTY: "بدها تعبية", FILLED: "جاهزة للتسليم", DELIVERED: "سُلّمت", PARTIAL: "سُلّم جزء",
};

// التسليم المبسّط النافذ يُحسب كأن كل جرار الاستحقاق استُلمت وسُلّمت.
const handoverQty = Prisma.sql`COALESCE((SELECT h."quantity" FROM "handovers" h WHERE h."entitlementId" = e."id" AND h."status" = 'ACTIVE'), 0)`;
const entitlementStats = Prisma.sql`
  count(y.*) FILTER (WHERE y."status" <> 'VOID') + ${handoverQty} AS received,
  count(y.*) FILTER (WHERE y."status" = 'EMPTY') AS empty,
  count(y.*) FILTER (WHERE y."status" = 'FILLED') AS filled,
  count(y.*) FILTER (WHERE y."status" = 'DELIVERED') + ${handoverQty} AS delivered`;

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

const MOVEMENT_LABEL: Record<string, string> = {
  RECEIVE_EMPTY: "استلام فارغة", FILL: "تعبئة", DELIVER: "تسليم", SHIPMENT_EXTRA: "نقلة: جرار إضافية", REVERSAL: "إلغاء (عكس حركة)",
};

export const DISTRIBUTOR_REPORTS: ReportDef[] = [
  {
    key: "citizens-sheet",
    title: "كشف الناس للدورة",
    description: "للطباعة: أرقام الناس وحالة جرارهم، مع ملاحظات وتوقيع.",
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
        title: `كشف الناس — ${cycle.name}`,
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
    title: "ناس ما استلموا جرارهم",
    description: "المستحقون في الدورة اللي لسا ما استلموا كل جرارهم.",
    filters: [cycleFilter],
    async run(tx, p) {
      const cycle = await resolveCycle(tx, p.cycleId);
      const all = await entitlementRows(tx, cycle.id);
      const rows = all.filter((r) => n(r.delivered) < r.quantity).map((r) => ({
        citizenNumber: r.citizenNumber, name: r.name, nationalId: r.nationalId, phone: r.phone, quantity: r.quantity,
        received: n(r.received), filled: n(r.filled), delivered: n(r.delivered), pending: r.quantity - n(r.delivered),
      }));
      return {
        title: `ناس ما استلموا جرارهم — ${cycle.name}`,
        filtersText: [`الدورة: ${cycle.name}`],
        columns: [
          { key: "citizenNumber", label: "رقم المواطن", type: "ltr" }, { key: "name", label: "الاسم", width: 30 },
          { key: "nationalId", label: "رقم الهوية", type: "ltr" }, { key: "phone", label: "الهاتف", type: "ltr" },
          { key: "quantity", label: "المستحق", type: "number" }, { key: "received", label: "استُلمت فارغة", type: "number" },
          { key: "filled", label: "جاهزة للتسليم", type: "number" }, { key: "delivered", label: "سُلّمت", type: "number" },
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
    title: "ناس عليهم فلوس",
    description: "كل استحقاق عليه مبلغ متبقٍ، مع المطلوب والمدفوع.",
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
        title: "ناس عليهم فلوس",
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
  {
    key: "cash-box",
    title: "الفلوس",
    description: "المقبوض والمصاريف ودفعات المحطات والرصيد في الفترة.",
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
        title: "الفلوس",
        filtersText: rp.text.length ? rp.text : ["كل الفترات"],
        columns: [{ key: "at", label: "الوقت", type: "datetime" }, { key: "kind", label: "النوع" }, { key: "description", label: "البيان", width: 40 }, { key: "amount", label: "المبلغ", type: "money" }],
        rows,
        totals: { description: "الرصيد المحسوب", amount: balance.toFixed(2) },
        summary: [
          { label: "المقبوض", value: sum("تحصيل").toFixed(2), type: "money" },
          { label: "المصاريف", value: sum("مصروف").neg().toFixed(2), type: "money" },
          { label: "دفعات المحطات", value: sum("دفعة محطة").neg().toFixed(2), type: "money" },
          { label: "الرصيد", value: balance.toFixed(2), type: "money" },
        ],
        note: "الرصيد محسوب من السجلات ولا يثبت مقدار النقد الموجود فعلًا.",
      };
    },
  },
  {
    key: "stations",
    title: "حسابات المحطات",
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
        title: "حسابات المحطات",
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
    key: "movements",
    title: "حركة الجرار",
    description: "كل حركة على الجرار (استلام، تعبئة، تسليم، نقلات، إلغاء) مع صاحبها والرصيد بعدها.",
    filters: [
      fromFilter,
      toFilter,
      {
        key: "type", label: "الحركة", kind: "select",
        options: [{ value: "", label: "الكل" }, ...Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label }))],
      },
    ],
    async run(tx, p) {
      const r = dateRange(p, Prisma.sql`m."at"`);
      const type = p.type && p.type in MOVEMENT_LABEL ? p.type : null;
      const raw = await tx.$queryRaw<{
        at: Date; type: string; emptyDelta: number; filledDelta: number; extraDelta: number; emptyAfter: number; filledAfter: number; extraAfter: number;
        label: string | null; name: string | null; station: string | null; user: string | null; note: string | null;
      }[]>`
        SELECT m."at", m."type"::text AS type, m."emptyDelta", m."filledDelta", m."extraDelta", m."emptyAfter", m."filledAfter", m."extraAfter", m."note",
          z."label", e."nameInStatement" AS name, u."displayName" AS user,
          (SELECT st."name" FROM "shipments" sh JOIN "stations" st ON st."id" = sh."stationId" WHERE sh."id" = m."shipmentId") AS station
        FROM "inventory_movements" m
        LEFT JOIN "cylinder_operations" o ON o."id" = m."operationId"
        LEFT JOIN "cylinders" z ON z."id" = o."cylinderId"
        LEFT JOIN "entitlements" e ON e."id" = z."entitlementId"
        LEFT JOIN "users" u ON u."id" = m."userId"
        WHERE ${r.sql} ${type ? Prisma.sql`AND m."type" = ${type}::"MovementType"` : Prisma.empty}
        ORDER BY m."id" ASC ${limit}`;
      const sign = (v: number) => (v > 0 ? `+${v}` : v < 0 ? String(v) : "");
      const rows = raw.map((m) => ({
        at: plainDateTime(m.at), type: MOVEMENT_LABEL[m.type] ?? m.type, label: m.label ?? "", name: m.name ?? (m.station ? `نقلة ${m.station}` : ""),
        empty: sign(m.emptyDelta), filled: sign(m.filledDelta), extra: sign(m.extraDelta),
        after: `${m.emptyAfter} / ${m.filledAfter} / ${m.extraAfter}`, user: m.user ?? "", note: m.note ?? "",
      }));
      const count = (t: string) => raw.filter((x) => x.type === t).length;
      return {
        title: "حركة الجرار",
        filtersText: [...(r.text.length ? r.text : ["كل الفترات"]), ...(type ? [`الحركة: ${MOVEMENT_LABEL[type]}`] : [])],
        columns: [
          { key: "at", label: "الوقت", type: "datetime" }, { key: "type", label: "الحركة" }, { key: "label", label: "رقم الجرة", type: "ltr" },
          { key: "name", label: "الاسم / النقلة", width: 28 },
          { key: "empty", label: "فارغ", type: "ltr" }, { key: "filled", label: "جاهز", type: "ltr" }, { key: "extra", label: "إضافي", type: "ltr" },
          { key: "after", label: "الرصيد بعدها (فارغ/جاهز/إضافي)", type: "ltr" }, { key: "user", label: "المستخدم" }, { key: "note", label: "ملاحظة" },
        ],
        rows,
        summary: [{ label: "استلام فارغة", value: count("RECEIVE_EMPTY") }, { label: "تعبئة", value: count("FILL") }, { label: "تسليم", value: count("DELIVER") }],
        note: capNote(raw),
      };
    },
  },
];

export const findDistributorReport = (key: string) => DISTRIBUTOR_REPORTS.find((r) => r.key === key);
