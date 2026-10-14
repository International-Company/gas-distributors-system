import Link from "next/link";
import { Download, Printer } from "lucide-react";
import type { Col, FilterSpec, ReportResult, ReportRow } from "@/server/reports/types";
import { Alert, Button, Card, EmptyState, Input, Select, Stat, buttonClass } from "./ui";
import { formatMoney } from "@/lib/format";
import { DateInput } from "@/components/date-input";

/** يعرض قيمة خلية حسب نوع العمود؛ الأرقام اللاتينية والتواريخ معزولة الاتجاه. */
export function cellText(v: ReportRow[string], col: Col) {
  if (v === null || v === undefined || v === "") return "";
  if (col.type === "money") return formatMoney(String(v));
  if (col.type === "ltr" || col.type === "date" || col.type === "datetime") return `⁦${v}⁩`;
  return String(v);
}

const UI_ROWS = 300;

type Props = {
  result: ReportResult & { distributorName: string };
  filters: FilterSpec[];
  cycles: { id: string; name: string; status: string }[];
  sp: Record<string, string | undefined>;
  /** مسار صفحة التقرير (للفلاتر). */
  base: string;
  /** مسار ملف Excel ومسار الطباعة (دون الاستعلام). */
  xlsxPath: string;
  printPath: string;
  /** حقول مخفية تُحمل مع الفلاتر (مثل distributorId للمدير). */
  hidden?: Record<string, string>;
};

export function ReportView({ result: r, filters, cycles, sp, base, xlsxPath, printPath, hidden = {} }: Props) {
  const applied = Object.fromEntries(Object.entries({ ...hidden, ...Object.fromEntries(filters.map((f) => [f.key, sp[f.key]])) }).filter(([, v]) => v)) as Record<string, string>;
  const qs = new URLSearchParams(applied).toString();
  return (
    <div className="space-y-4">
      {filters.length > 0 && (
        <form method="get" action={base} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {filters.map((f) => (f.kind === "from" || f.kind === "to") ? (
            // حقل التاريخ في حاوية عادية لا <label>: النقر داخل لوحة التقويم لا يجب أن يُعيد تفعيل الحقل.
            <div key={f.key} className="flex flex-col gap-1 text-xs text-muted">
              <span>{f.label}</span>
              <DateInput name={f.key} defaultValue={sp[f.key]} className="w-40" aria-label={f.label} />
            </div>
          ) : (
            <label key={f.key} className="flex flex-col gap-1 text-xs text-muted">
              {f.label}
              {f.kind === "cycle" || f.kind === "cycleOptional" ? (
                <Select name={f.key} defaultValue={sp[f.key] ?? ""} className="w-48">
                  <option value="">{f.kind === "cycle" ? "الدورة النشطة أو الأحدث" : "كل الدورات"}</option>
                  {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === "OPEN" ? " (نشطة)" : ""}</option>)}
                </Select>
              ) : f.kind === "select" ? (
                <Select name={f.key} defaultValue={sp[f.key] ?? ""} className="w-48">
                  {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : null}
            </label>
          ))}
          <Button type="submit" variant="secondary">تطبيق</Button>
          <Link href={hidden.distributorId ? `${base}?distributorId=${hidden.distributorId}` : base} className="self-center text-sm text-primary hover:underline">مسح</Link>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{r.filtersText.join(" — ")}</p>
        <div className="flex gap-2">
          <a href={`${xlsxPath}${qs ? `?${qs}` : ""}`} className={buttonClass("secondary")}><Download className="size-4" /> Excel</a>
          <a href={`${printPath}${qs ? `?${qs}` : ""}`} target="_blank" rel="noreferrer" className={buttonClass("secondary")}><Printer className="size-4" /> طباعة / PDF</a>
        </div>
      </div>

      {r.summary && r.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {r.summary.map((s) => <Stat key={s.label} label={s.label} value={s.type === "money" ? formatMoney(String(s.value)) : s.value} />)}
        </div>
      )}
      {r.note && <Alert tone="warning">{r.note}</Alert>}

      <Card>
        {r.rows.length === 0 ? (
          <EmptyState>لا توجد نتائج.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-xs text-muted">
                <tr className="border-b border-border">
                  {r.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-2 font-medium">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.rows.slice(0, UI_ROWS).map((row, i) => (
                  <tr key={i}>
                    {r.columns.map((c) => <td key={c.key} className="whitespace-nowrap px-2 py-1.5">{cellText(row[c.key], c)}</td>)}
                  </tr>
                ))}
              </tbody>
              {r.totals && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    {r.columns.map((c) => <td key={c.key} className="whitespace-nowrap px-2 py-2">{cellText(r.totals![c.key] ?? null, c)}</td>)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {r.rows.length > UI_ROWS && (
          <p className="mt-2 text-xs text-muted">تُعرض أول {UI_ROWS} صف من {r.rows.length}. التصدير والطباعة يشملان كل الصفوف.</p>
        )}
      </Card>
    </div>
  );
}
