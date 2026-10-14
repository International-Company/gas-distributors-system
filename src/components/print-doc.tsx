import type { ReportResult } from "@/server/reports/types";
import { formatDateTime } from "@/lib/format";
import { cellText } from "./report-view";
import { PrintButton } from "./print-button";

/**
 * مستند طباعة عربي: ألوان ثابتة (أبيض وأسود) بغض النظر عن الوضع الداكن،
 * ورأس الجدول يتكرر في كل صفحة. «حفظ PDF» من نافذة الطباعة في المتصفح.
 */
export function PrintDoc({ r, systemName, logoUrl }: { r: ReportResult & { distributorName: string }; systemName: string; logoUrl: string | null }) {
  return (
    <div className="print-doc min-h-dvh bg-white p-6 text-black" style={{ colorScheme: "light" }}>
      <style>{`
        @page { size: A4; margin: 12mm; }
        .print-doc table { border-collapse: collapse; width: 100%; font-size: 11px; }
        .print-doc th, .print-doc td { border: 1px solid #888; padding: 4px 6px; text-align: right; }
        .print-doc thead { display: table-header-group; }
        .print-doc tr { break-inside: avoid; }
        .print-doc th { background: #e8eef7 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>
      <div className="no-print mb-4 flex gap-2">
        <PrintButton />
      </div>
      <header className="mb-4 flex items-start justify-between gap-4 border-b border-black pb-3">
        <div>
          <div className="text-lg font-bold">{systemName}</div>
          <div className="text-sm">{r.distributorName}</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logoUrl && <img src={logoUrl} alt="" className="h-12 w-12 object-contain" />}
      </header>
      <h1 className="mb-1 text-xl font-bold">{r.title}</h1>
      <p className="mb-1 text-sm">{r.filtersText.join(" — ")}</p>
      <p className="mb-3 text-xs">تاريخ الطباعة: {formatDateTime(new Date())}</p>
      {r.summary && r.summary.length > 0 && (
        <p className="mb-3 text-sm">{r.summary.map((s) => `${s.label}: ${s.type === "money" ? cellText(String(s.value), { key: "", label: "", type: "money" }) : s.value}`).join("   |   ")}</p>
      )}
      <table>
        <thead>
          <tr>{r.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i}>{r.columns.map((c) => <td key={c.key}>{cellText(row[c.key], c)}</td>)}</tr>
          ))}
        </tbody>
        {r.totals && (
          <tfoot>
            <tr style={{ fontWeight: 700 }}>{r.columns.map((c) => <td key={c.key}>{cellText(r.totals![c.key] ?? null, c)}</td>)}</tr>
          </tfoot>
        )}
      </table>
      {r.rows.length === 0 && <p className="mt-4 text-sm">لا توجد نتائج.</p>}
      {r.note && <p className="mt-3 text-xs">{r.note}</p>}
    </div>
  );
}
