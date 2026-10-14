import type { Tx } from "../db";

/** نوع العمود يحدد طريقة العرض والتصدير (المال بمنزلتين، الأرقام اللاتينية معزولة الاتجاه...). */
export type ColType = "text" | "number" | "money" | "date" | "datetime" | "ltr";
export type Col = { key: string; label: string; type?: ColType; width?: number };

export type ReportRow = Record<string, string | number | null>;

export type ReportResult = {
  title: string;
  /** وصف الفلاتر المطبقة: يظهر في الشاشة وفي رأس Excel والطباعة. */
  filtersText: string[];
  columns: Col[];
  rows: ReportRow[];
  /** صف إجماليات اختياري بالمفاتيح نفسها. */
  totals?: ReportRow;
  /** أرقام ملخصة تظهر فوق الجدول. */
  summary?: { label: string; value: string | number; type?: ColType }[];
  note?: string;
};

export type FilterKind = "cycle" | "cycleOptional" | "from" | "to" | "select";
export type FilterSpec = { key: string; label: string; kind: FilterKind; options?: { value: string; label: string }[] };

export type ReportContext = {
  /** الموزّع الذي يُنفذ التقرير في سياقه (RLS مفعّل بالفعل على المعاملة). */
  distributorId: string;
  currencySymbol: string;
};

export type ReportDef = {
  key: string;
  title: string;
  description: string;
  filters: FilterSpec[];
  run: (tx: Tx, params: Record<string, string>, ctx: ReportContext) => Promise<ReportResult>;
};

/** حد أقصى للصفوف في التقرير الواحد؛ التصدير والطباعة يحترمانه ويُنبَّه عند بلوغه. */
export const MAX_REPORT_ROWS = 20_000;
