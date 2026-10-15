import ExcelJS from "exceljs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withSystem, withTenant } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, assertAdmin } from "../actor";
import { audit } from "../audit";
import { plainDateTime, plainDate } from "@/lib/format";
import { getSettings } from "../services/settings";
import { DISTRIBUTOR_REPORTS, findDistributorReport } from "./distributor";
import type { Col, ReportResult } from "./types";

const paramsSchema = z.record(z.string().max(100)).default({});

/** الموزّع الذي يُنفذ التقرير في سياقه: الموزّع نفسه، أو موزّع يختاره مدير بصلاحية التقارير. */
async function resolveTarget(actor: Actor, distributorId?: string) {
  if (actor.role === "DISTRIBUTOR") {
    if (!actor.distributorId) throw new AppError("FORBIDDEN", "لا تملك صلاحية");
    if (distributorId && distributorId !== actor.distributorId) throw new AppError("FORBIDDEN", "لا تملك صلاحية الوصول لهذا الموزّع");
    return actor.distributorId;
  }
  assertAdmin(actor, "reports.view");
  if (!distributorId) throw new AppError("VALIDATION", "اختر الموزّع");
  const d = await withSystem((tx) => tx.distributor.findUnique({ where: { id: distributorId }, select: { id: true } }));
  if (!d) throw notFound("الموزّع");
  return d.id;
}

export async function runReport(actor: Actor, key: string, rawParams: unknown, opts: { distributorId?: string } = {}): Promise<ReportResult & { distributorName: string }> {
  const def = findDistributorReport(key);
  if (!def) throw notFound("التقرير");
  const params = paramsSchema.parse(rawParams ?? {});
  const distributorId = await resolveTarget(actor, opts.distributorId);
  const settings = await withSystem(getSettings);
  return withTenant(distributorId, async (tx) => {
    const d = await tx.distributor.findUniqueOrThrow({ where: { id: distributorId }, select: { name: true } });
    const res = await def.run(tx, params, { distributorId, currencySymbol: settings.currencySymbol });
    return { ...res, distributorName: d.name };
  }, { timeout: 60_000 });
}

/** دورات الموزّع المستهدف لقائمة فلاتر التقارير. */
export async function reportCycles(actor: Actor, distributorId?: string) {
  const id = await resolveTarget(actor, distributorId);
  return withTenant(id, (tx) => tx.cycle.findMany({ orderBy: { number: "desc" }, select: { id: true, name: true, status: true } }));
}

export function listReports() {
  return DISTRIBUTOR_REPORTS.map(({ key, title, description, filters }) => ({ key, title, description, filters }));
}

/** تسجيل التصدير في التدقيق (من صدّر ماذا وبأي فلاتر). */
export async function auditExport(actor: Actor, key: string, format: "xlsx" | "print", params: unknown, distributorId: string | null, rows: number) {
  const write = (tx: Prisma.TransactionClient) =>
    audit(tx, actor, { action: "report.export", entityType: "report", entityId: key, distributorId, after: { format, params, rows } });
  if (actor.role === "DISTRIBUTOR" && actor.distributorId) await withTenant(actor.distributorId, write);
  else await withSystem(write);
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

const cellValue = (v: unknown, col: Col) => {
  if (v === null || v === undefined || v === "") return null;
  if (col.type === "money" || col.type === "number") {
    const num = Number(v);
    return Number.isFinite(num) ? num : String(v);
  }
  return String(v);
};

/** ملف Excel من اليمين لليسار برأس يذكر الموزّع والفلاتر ووقت الإنشاء. */
export async function reportToXlsx(r: ReportResult & { distributorName: string }, systemName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = systemName;
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { views: [{ rightToLeft: true }] });
  const width = r.columns.length;
  const titleRow = ws.addRow([r.title]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, width);
  ws.addRow([`الموزّع: ${r.distributorName} — ${r.filtersText.join(" — ")} — أُنشئ: ${plainDateTime(new Date())}`]);
  ws.mergeCells(2, 1, 2, width);
  if (r.summary?.length) {
    ws.addRow([r.summary.map((s) => `${s.label}: ${s.value}`).join("   |   ")]);
    ws.mergeCells(3, 1, 3, width);
  }
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E4E8C" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: header.number }];
  for (const row of r.rows) ws.addRow(r.columns.map((c) => cellValue(row[c.key], c)));
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c) => cellValue(r.totals![c.key], c)));
    t.font = { bold: true };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3FA" } };
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? (c.type === "datetime" ? 17 : c.type === "money" ? 12 : 14);
    if (c.type === "money") col.numFmt = "#,##0.00";
  });
  if (r.note) {
    ws.addRow([]);
    ws.addRow([r.note]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const xlsxFileName = (r: { title: string }) => `${r.title.replace(/[\\/:*?"<>|]/g, " ").slice(0, 60)} ${plainDate(new Date()).replace(/\//g, "-")}.xlsx`;

// ---------------------------------------------------------------------------
// التقرير المركزي لمدير النظام
// ---------------------------------------------------------------------------

/**
 * ملخص مركزي لكل موزّع (دون ترتيب أو مقارنة أداء): المواطنون، حركة الجرار، المخزون،
 * المحصل، والمستحقات. يتطلب صلاحية التقارير.
 */
export async function centralOverview(actor: Actor, filters: unknown) {
  assertAdmin(actor, "reports.view");
  const f = z.object({ categoryId: z.string().uuid().optional(), includeArchived: z.coerce.boolean().default(false) }).parse(filters ?? {});
  return withSystem(async (tx) => {
    const raw = await tx.$queryRaw<{
      id: string; name: string; region: string; status: string; suspensionReason: string | null; cycle: string | null;
      citizens: bigint; entitled: bigint; received: bigint; filled: bigint; delivered: bigint;
      stockEmpty: number | null; stockFilled: number | null; stockExtra: number | null; collected: Prisma.Decimal; outstanding: Prisma.Decimal;
    }[]>`
      SELECT d."id", d."name", d."region", d."status"::text AS status, d."suspensionReason"::text AS "suspensionReason", y."name" AS cycle,
        (SELECT count(*) FROM "entitlements" e WHERE e."cycleId" = y."id" AND e."status" = 'ACTIVE') AS citizens,
        (SELECT COALESCE(sum(e."quantity"), 0) FROM "entitlements" e WHERE e."cycleId" = y."id" AND e."status" = 'ACTIVE') AS entitled,
        (SELECT count(*) FROM "cylinders" z WHERE z."cycleId" = y."id" AND z."status" <> 'VOID') AS received,
        (SELECT count(*) FROM "cylinders" z WHERE z."cycleId" = y."id" AND z."status" = 'FILLED') AS filled,
        (SELECT count(*) FROM "cylinders" z WHERE z."cycleId" = y."id" AND z."status" = 'DELIVERED') AS delivered,
        b."empty" AS "stockEmpty", b."filled" AS "stockFilled", b."extra" AS "stockExtra",
        (SELECT COALESCE(sum(p."amount"), 0) FROM "payments" p WHERE p."distributorId" = d."id" AND p."status" = 'ACTIVE') AS collected,
        (SELECT COALESCE(sum(e."amountDue"), 0) FROM "entitlements" e WHERE e."distributorId" = d."id"
           AND (e."status" = 'ACTIVE' OR EXISTS (SELECT 1 FROM "cylinders" z WHERE z."entitlementId" = e."id" AND z."status" <> 'VOID')))
          - (SELECT COALESCE(sum(p."amount"), 0) FROM "payments" p WHERE p."distributorId" = d."id" AND p."status" = 'ACTIVE') AS outstanding
      FROM "distributors" d
      LEFT JOIN "cycles" y ON y."distributorId" = d."id" AND y."status" = 'OPEN'
      LEFT JOIN "inventory_balances" b ON b."distributorId" = d."id"
      WHERE ${f.includeArchived ? Prisma.sql`TRUE` : Prisma.sql`d."status" <> 'ARCHIVED'`}
        ${f.categoryId ? Prisma.sql`AND d."categoryId" = ${f.categoryId}::uuid` : Prisma.empty}
      ORDER BY d."name"`;
    const rows = raw.map((r) => ({
      id: r.id, name: r.name, region: r.region,
      status: r.status === "ACTIVE" ? "نشط" : r.status === "ARCHIVED" ? "مؤرشف" : r.suspensionReason === "EXPIRED" ? "منتهي" : "معلّق",
      cycle: r.cycle ?? "—", citizens: Number(r.citizens), entitled: Number(r.entitled), received: Number(r.received), filled: Number(r.filled), delivered: Number(r.delivered),
      stockEmpty: r.stockEmpty ?? 0, stockFilled: r.stockFilled ?? 0, stockExtra: r.stockExtra ?? 0,
      collected: new Prisma.Decimal(r.collected).toFixed(2), outstanding: new Prisma.Decimal(r.outstanding).toFixed(2),
    }));
    const totals = rows.reduce(
      (a, r) => ({
        citizens: a.citizens + r.citizens, entitled: a.entitled + r.entitled, delivered: a.delivered + r.delivered,
        collected: a.collected.add(r.collected), outstanding: a.outstanding.add(r.outstanding),
      }),
      { citizens: 0, entitled: 0, delivered: 0, collected: new Prisma.Decimal(0), outstanding: new Prisma.Decimal(0) },
    );
    return { rows, totals: { ...totals, collected: totals.collected.toFixed(2), outstanding: totals.outstanding.toFixed(2) } };
  });
}

/** التقرير المركزي بصيغة تقرير موحدة (للتصدير والطباعة). */
export async function centralOverviewReport(actor: Actor, filters: unknown): Promise<ReportResult & { distributorName: string }> {
  const { rows, totals } = await centralOverview(actor, filters);
  return {
    title: "التقرير المركزي للموزّعين",
    distributorName: "كل الموزّعين",
    filtersText: ["الدورة النشطة لكل موزّع؛ المحصل والمستحقات عبر كل الدورات"],
    columns: [
      { key: "name", label: "الموزّع", width: 24 }, { key: "region", label: "المنطقة" }, { key: "status", label: "الحالة" }, { key: "cycle", label: "الدورة النشطة" },
      { key: "citizens", label: "المستحقون", type: "number" }, { key: "entitled", label: "الجرار المستحقة", type: "number" },
      { key: "received", label: "استُلمت فارغة", type: "number" }, { key: "filled", label: "جاهزة للتسليم", type: "number" }, { key: "delivered", label: "سُلّمت", type: "number" },
      { key: "stockEmpty", label: "مخزون فارغ", type: "number" }, { key: "stockFilled", label: "مخزون معبأ", type: "number" },
      { key: "collected", label: "المحصل", type: "money" }, { key: "outstanding", label: "المستحقات", type: "money" },
    ],
    rows,
    totals: { name: "الإجمالي", citizens: totals.citizens, entitled: totals.entitled, delivered: totals.delivered, collected: totals.collected, outstanding: totals.outstanding },
  };
}
