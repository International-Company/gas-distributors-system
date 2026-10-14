import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/http/context";
import { listReports, reportCycles, runReport } from "@/server/reports/service";
import { findDistributorReport } from "@/server/reports/distributor";
import { EmptyState, PageHeader, buttonClass, cn } from "@/components/ui";
import { ReportView } from "@/components/report-view";

export const metadata = { title: "تقرير موزّع" };

export default async function AdminReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "ADMIN", permission: "reports.view" });
  const { key } = await params;
  const sp = await searchParams;
  const def = findDistributorReport(key);
  if (!def) notFound();
  if (!sp.distributorId) return <EmptyState>اختر موزّعًا من <Link className="text-primary hover:underline" href="/admin/reports">التقارير المركزية</Link>.</EmptyState>;
  const filters = Object.fromEntries(def.filters.map((f) => [f.key, sp[f.key] ?? ""]).filter(([, v]) => v));
  const [result, cycles] = await Promise.all([runReport(actor, key, filters, { distributorId: sp.distributorId }), reportCycles(actor, sp.distributorId)]);
  return (
    <div className="space-y-4">
      <PageHeader title={def.title} description={`الموزّع: ${result.distributorName}`} />
      <div className="flex flex-wrap gap-1">
        {listReports().map((r) => (
          <Link key={r.key} href={`/admin/reports/${r.key}?distributorId=${sp.distributorId}`} className={cn(buttonClass(r.key === key ? "primary" : "ghost", "sm"))}>{r.title}</Link>
        ))}
      </div>
      <ReportView
        result={result} filters={def.filters} cycles={cycles} sp={sp} base={`/admin/reports/${key}`}
        xlsxPath={`/api/v1/reports/${key}/xlsx`} printPath={`/print/reports/${key}`} hidden={{ distributorId: sp.distributorId }}
      />
    </div>
  );
}
