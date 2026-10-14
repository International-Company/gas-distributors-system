import { requirePageActor } from "@/server/http/context";
import { listExpenses } from "@/server/services/finance";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { formatDateTime, formatMoney } from "@/lib/format";
import { CancelRecord } from "../finance/cancel-record";
import { NewExpense } from "./new-expense";
import { DateInput } from "@/components/date-input";

export const metadata = { title: "المصاريف" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries({ from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>;
  const data = await listExpenses(actor, { ...params, page: sp.page });
  return (
    <div className="space-y-6">
      <PageHeader title="المصاريف" />
      <NewExpense />
      <form method="get" className="flex flex-wrap gap-2">
        <DateInput name="from" defaultValue={sp.from} className="w-40" aria-label="من" />
        <DateInput name="to" defaultValue={sp.to} className="w-40" aria-label="إلى" />
        <Button type="submit" variant="secondary">تطبيق</Button>
      </form>
      <Card title={`الإجمالي النافذ: ${formatMoney(data.totalAmount)}`}>
        {data.rows.length === 0 ? (
          <EmptyState>لا توجد مصروفات.</EmptyState>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {data.rows.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <span className="font-medium">{x.description}</span>
                  <span className="text-xs text-muted"> · {formatDateTime(x.spentAt)}</span>
                  {x.status === "CANCELLED" && <div className="text-xs text-danger">أُلغي: {x.cancelReason}</div>}
                </div>
                <span className="flex items-center gap-2">
                  <strong className={x.status === "CANCELLED" ? "text-muted line-through" : ""}>{formatMoney(x.amount)}</strong>
                  {x.status === "ACTIVE" ? <CancelRecord url={`/api/v1/expenses/${x.id}/cancel`} /> : <Badge tone="danger">ملغى</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base="/d/expenses" params={params} />
      </Card>
    </div>
  );
}
