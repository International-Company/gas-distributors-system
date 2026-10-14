import { requirePageActor } from "@/server/http/context";
import { listErrorLogs } from "@/server/services/logs";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "الأعطال" };

export default async function ErrorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "ADMIN", permission: "errors.view" });
  const sp = await searchParams;
  const data = await listErrorLogs(actor, { page: sp.page });
  return (
    <div>
      <PageHeader title="الأعطال" />
      <Card>
        {data.rows.length === 0 ? (
          <EmptyState>لا توجد أخطاء مسجلة.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {data.rows.map((r) => (
              <li key={String(r.id)} className="py-3">
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span className="ltr-nums">{r.route ?? "—"}</span>
                  <span className="ltr-nums">{formatDateTime(r.at)}</span>
                </div>
                <p className="mt-1 text-sm ltr-nums">{r.message}</p>
                {r.stack && (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-primary">التفاصيل التقنية</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 text-left" dir="ltr">{r.stack}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base="/admin/errors" params={{}} />
      </Card>
    </div>
  );
}
