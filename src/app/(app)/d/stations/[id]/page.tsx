import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { stationAccount } from "@/server/services/finance";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Stat } from "@/components/ui";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { CancelRecord } from "../../finance/cancel-record";
import { StationPaymentForm, StationPriceForm } from "./forms";

export const metadata = { title: "حساب محطة" };

export default async function StationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const { id } = await params;
  const sp = await searchParams;
  const acc = await stationAccount(actor, id, { from: sp.from || undefined, to: sp.to || undefined });
  const s = acc.station;
  const remaining = acc.totals.remaining;
  return (
    <div className="space-y-6">
      <PageHeader title={`حساب ${s.name}`} actions={!s.active ? <Badge>غير نشطة</Badge> : undefined} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="قيمة الشحنات المستلمة" value={formatMoney(acc.totals.value)} />
        <Stat label="المدفوع" value={formatMoney(acc.totals.paid)} tone="success" />
        <Stat label={remaining.isNeg() ? "دفع مقدم للمحطة" : "المتبقي للمحطة"} value={formatMoney(remaining.abs())} tone={remaining.gt(0) ? "warning" : "primary"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <StationPaymentForm stationId={s.id} />
        <StationPriceForm stationId={s.id} price={s.defaultUnitPrice?.toString() ?? ""} />
      </div>
      <Card title="كشف الحساب">
        <form method="get" className="mb-3 flex flex-wrap gap-2">
          <Input type="date" name="from" defaultValue={sp.from} className="w-40" aria-label="من" />
          <Input type="date" name="to" defaultValue={sp.to} className="w-40" aria-label="إلى" />
          <Button type="submit" variant="secondary">عرض الفترة</Button>
          {(sp.from || sp.to) && <Link href={`/d/stations/${s.id}`} className="self-center text-sm text-primary hover:underline">كل الفترات</Link>}
        </form>
        {acc.period.from && <p className="mb-2 text-sm">الرصيد الافتتاحي في {formatDate(acc.period.from)}: <strong>{formatMoney(acc.period.opening)}</strong></p>}
        {acc.entries.length === 0 ? (
          <EmptyState>لا توجد حركات في الفترة.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-right text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 font-medium">التاريخ</th>
                  <th className="py-2 font-medium">البيان</th>
                  <th className="py-2 font-medium">مدين (شحنة)</th>
                  <th className="py-2 font-medium">دائن (دفعة)</th>
                  <th className="py-2 font-medium">الرصيد</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {acc.entries.map((e) => (
                  <tr key={`${e.kind}-${e.id}`} className={e.cancelled ? "text-muted" : ""}>
                    <td className="py-2">{formatDateTime(e.at)}</td>
                    <td className="py-2">
                      {e.kind === "SHIPMENT" ? <Link className="text-primary hover:underline" href={`/d/shipments/${e.id}`}>{e.description}</Link> : e.description}
                      {e.cancelled && <div className="text-xs text-danger">ملغى{e.cancelReason ? `: ${e.cancelReason}` : ""} (لا يدخل الرصيد)</div>}
                    </td>
                    <td className={`py-2 ${e.cancelled ? "line-through" : ""}`}>{e.debit.gt(0) ? formatMoney(e.debit) : ""}</td>
                    <td className={`py-2 ${e.cancelled ? "line-through" : ""}`}>{e.credit.gt(0) ? formatMoney(e.credit) : ""}</td>
                    <td className="py-2 font-medium">{formatMoney(e.balance)}</td>
                    <td className="py-2">{e.kind === "PAYMENT" && !e.cancelled && <CancelRecord url={`/api/v1/station-payments/${e.id}/cancel`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-sm">الرصيد في نهاية الفترة: <strong>{formatMoney(acc.period.closing)}</strong> <span className="text-xs text-muted">(موجب = مستحق للمحطة، سالب = دفع مقدم)</span></p>
      </Card>
    </div>
  );
}
