import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { listReports } from "@/server/reports/service";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "التقارير" };

export default async function ReportsPage() {
  await requirePageActor({ role: "DISTRIBUTOR" });
  return (
    <div className="space-y-6">
      <PageHeader title="التقارير" />
      <ul className="grid gap-3 md:grid-cols-2">
        {listReports().map((r) => (
          <li key={r.key}>
            <Link href={`/d/reports/${r.key}`} className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-primary">
              <div className="font-semibold">{r.title}</div>
              <div className="mt-1 text-sm text-muted">{r.description}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
