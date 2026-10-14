import { requirePageActor } from "@/server/http/context";
import { auditExport, centralOverviewReport } from "@/server/reports/service";
import { getPublicSettings } from "@/server/services/settings";
import { PrintDoc } from "@/components/print-doc";

export const metadata = { title: "طباعة التقرير المركزي" };

export default async function PrintCentral({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "ADMIN", permission: "reports.view" });
  const sp = await searchParams;
  const filters = Object.fromEntries(Object.entries({ categoryId: sp.categoryId, includeArchived: sp.includeArchived }).filter(([, v]) => v)) as Record<string, string>;
  const [r, settings] = await Promise.all([centralOverviewReport(actor, filters), getPublicSettings()]);
  await auditExport(actor, "central", "print", filters, null, r.rows.length);
  return <PrintDoc r={r} systemName={settings.systemName} logoUrl={settings.logoUrl} />;
}
