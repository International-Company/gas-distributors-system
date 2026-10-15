import type { Actor } from "@/server/actor";
import { listExpenses } from "@/server/services/finance";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { DateInput } from "@/components/date-input";
import { Pagination } from "@/components/pagination";
import { formatDateTime, formatMoney } from "@/lib/format";
import { CancelRecord } from "./cancel-record";
import { NewExpense } from "./new-expense";

/** المصاريف التشغيلية: تسجيل مصروف جديد وقائمة المصاريف. */
export async function ExpensesSection({ actor, sp }: { actor: Actor; sp: Record<string, string | undefined> }) {
  const params = Object.fromEntries(Object.entries({ from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>;
  const data = await listExpenses(actor, { ...params, page: sp.page });
  return (
    <>
      <NewExpense />
      <form method="get" className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3">
        <input type="hidden" name="tab" value="expenses" />
        <DateInput name="from" defaultValue={sp.from} className="w-40" aria-label="من" />
        <DateInput name="to" defaultValue={sp.to} className="w-40" aria-label="إلى" />
        <Button type="submit" variant="secondary">تطبيق</Button>
      </form>
      <Card title={`المجموع: ${formatMoney(data.totalAmount)}`}>
        {data.rows.length === 0 ? (
          <EmptyState>ما في مصاريف مسجّلة. سجّل أول مصروف من النموذج أعلاه (أجرة نقل، عمال، ...).</EmptyState>
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
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base="/d/finance" params={{ ...params, tab: "expenses" }} />
      </Card>
    </>
  );
}
