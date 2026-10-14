import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/http/context";
import { reportCycles, runReport } from "@/server/reports/service";
import { findDistributorReport } from "@/server/reports/distributor";
import { PageHeader } from "@/components/ui";
import { ReportView } from "@/components/report-view";

export const metadata = { title: "تقرير" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const { key } = await params;
  const sp = await searchParams;
  const def = findDistributorReport(key);
  if (!def) notFound();
  const filters = Object.fromEntries(def.filters.map((f) => [f.key, sp[f.key] ?? ""]).filter(([, v]) => v));
  const [result, cycles] = await Promise.all([runReport(actor, key, filters), reportCycles(actor)]);
  return (
    <div className="space-y-4">
      <PageHeader title={def.title} description={def.description} />
      <ReportView result={result} filters={def.filters} cycles={cycles} sp={sp} base={`/d/reports/${key}`} xlsxPath={`/api/v1/reports/${key}/xlsx`} printPath={`/print/reports/${key}`} />
    </div>
  );
}
