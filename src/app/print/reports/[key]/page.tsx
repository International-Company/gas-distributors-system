import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/http/context";
import { auditExport, runReport } from "@/server/reports/service";
import { findDistributorReport } from "@/server/reports/distributor";
import { getPublicSettings } from "@/server/services/settings";
import { PrintDoc } from "@/components/print-doc";

export const metadata = { title: "طباعة تقرير" };

export default async function PrintReport({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor();
  const { key } = await params;
  const sp = await searchParams;
  const def = findDistributorReport(key);
  if (!def) notFound();
  const filters = Object.fromEntries(def.filters.map((f) => [f.key, sp[f.key] ?? ""]).filter(([, v]) => v)) as Record<string, string>;
  const [r, settings] = await Promise.all([runReport(actor, key, filters, { distributorId: sp.distributorId }), getPublicSettings()]);
  await auditExport(actor, key, "print", filters, actor.distributorId ?? sp.distributorId ?? null, r.rows.length);
  return <PrintDoc r={r} systemName={settings.systemName} logoUrl={settings.logoUrl} />;
}
