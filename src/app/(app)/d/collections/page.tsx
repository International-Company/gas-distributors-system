import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { listPayments } from "@/server/services/finance";
import { listCycles } from "@/server/services/cycles";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { formatDateTime, formatMoney } from "@/lib/format";
import { CancelRecord } from "../finance/cancel-record";
import { DateInput } from "@/components/date-input";

export const metadata = { title: "التحصيلات" };

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries({ cycleId: sp.cycleId, from: sp.from, to: sp.to, status: sp.status }).filter(([, v]) => v)) as Record<string, string>;
  const [data, cycles] = await Promise.all([listPayments(actor, { ...params, page: sp.page }), listCycles(actor)]);
  return (
    <div className="space-y-6">
      <PageHeader title="التحصيلات" description="تحصيلات المواطنين. لتسجيل تحصيل جديد استخدم الشباك أو ملف المواطن." />
      <form method="get" className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3">
        <Select name="cycleId" defaultValue={sp.cycleId ?? ""} className="w-48" aria-label="الدورة">
          <option value="">كل الدورات</option>
          {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="w-36" aria-label="الحالة">
          <option value="">الكل</option>
          <option value="ACTIVE">نافذ</option>
          <option value="CANCELLED">ملغى</option>
        </Select>
        <DateInput name="from" defaultValue={sp.from} className="w-40" aria-label="من" />
        <DateInput name="to" defaultValue={sp.to} className="w-40" aria-label="إلى" />
        <Button type="submit" variant="secondary">تطبيق</Button>
      </form>
      <Card title={`الإجمالي النافذ: ${formatMoney(data.totalAmount)}`}>
        {data.rows.length === 0 ? (
          <EmptyState>لا توجد تحصيلات.</EmptyState>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {data.rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <Link href={`/d/citizens/${p.entitlement.citizen.id}`} className="font-medium text-primary hover:underline">{p.entitlement.nameInStatement}</Link>
                  <span className="text-xs text-muted"> · رقم <bdi dir="ltr">{p.entitlement.citizenNumber}</bdi> · {p.entitlement.cycle.name} · {formatDateTime(p.paidAt)}</span>
                  {p.notes && <div className="text-xs text-muted">{p.notes}</div>}
                  {p.status === "CANCELLED" && <div className="text-xs text-danger">أُلغي: {p.cancelReason}</div>}
                </div>
                <span className="flex items-center gap-2">
                  <strong className={p.status === "CANCELLED" ? "text-muted line-through" : ""}>{formatMoney(p.amount)}</strong>
                  {p.status === "ACTIVE" ? <CancelRecord url={`/api/v1/payments/${p.id}/cancel`} /> : <Badge tone="danger">ملغى</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base="/d/collections" params={params} />
      </Card>
    </div>
  );
}
