import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { listStatements } from "@/server/services/statements";
import { Card, EmptyState, PageHeader, buttonClass, cn } from "@/components/ui";
import { STATEMENT_STATUS, StatementStatusBadge } from "@/components/statement-status";
import { formatDateTime } from "@/lib/format";
import { UploadForm } from "./upload-form";

export const metadata = { title: "الكشوف" };

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const status = sp.status && sp.status in STATEMENT_STATUS ? sp.status : undefined;
  const [list, approved] = await Promise.all([listStatements(actor, { status }), listStatements(actor, { status: "APPROVED" })]);
  return (
    <div className="space-y-6">
      <PageHeader title="كشوف هيئة الغاز" description="كل كشف يبدأ «قيد المراجعة» ولا يُستخدم في أي عملية قبل اعتماده صراحةً." />
      <Card title="استيراد كشف">
        <UploadForm approved={approved.map((s) => ({ id: s.id, title: s.title, version: s.version, cycleName: s.cycle?.name ?? "" }))} />
      </Card>
      <div className="flex flex-wrap gap-2">
        {[["", "الكل"], ...Object.entries(STATEMENT_STATUS).map(([k, v]) => [k, v.label])].map(([k, label]) => (
          <Link key={k} href={k ? `/d/statements?status=${k}` : "/d/statements"} className={cn(buttonClass((status ?? "") === k ? "primary" : "secondary", "sm"))}>
            {label}
          </Link>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState>لا توجد كشوف.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.id}>
              <Link href={`/d/statements/${s.id}`} className="block rounded-xl border border-border bg-surface p-4 hover:border-primary">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {s.title} {s.version > 1 && <span className="text-sm font-normal text-muted">(الإصدار {s.version})</span>}
                  </span>
                  <StatementStatusBadge status={s.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                  <span>{s.cycle?.name ?? "دون دورة"}</span>
                  <span>الصفوف: {s.rowsOk + s.rowsWarning + s.rowsError}</span>
                  {s.rowsWarning > 0 && <span className="text-warning">تنبيهات: {s.rowsWarning}</span>}
                  {s.rowsError > 0 && <span className="text-danger">أخطاء: {s.rowsError}</span>}
                  <span>الاستيراد: {formatDateTime(s.importedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
