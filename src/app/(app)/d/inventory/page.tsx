import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { getInventory, listMovements } from "@/server/services/inventory";
import { Alert, Button, Card, EmptyState, Input, PageHeader, Select, Stat } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { MOVEMENT_LABELS } from "@/components/cylinder-status";
import { formatDateTime } from "@/lib/format";
import { DateInput } from "@/components/date-input";

export const metadata = { title: "المخزن" };

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "");

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries({ type: sp.type, from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>;
  const [inv, moves] = await Promise.all([getInventory(actor), listMovements(actor, { ...params, page: sp.page })]);
  return (
    <div className="space-y-6">
      <PageHeader title="المخزن" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/d/cylinders?status=EMPTY"><Stat label="فارغة (جرار مواطنين)" value={inv.balance.empty} tone="warning" /></Link>
        <Link href="/d/cylinders?status=FILLED"><Stat label="معبأة جاهزة (جرار مواطنين)" value={inv.balance.filled} tone="primary" /></Link>
        <Stat label="معبأة إضافية من النقلات" value={inv.balance.extra} />
        <Link href="/d/cylinders?status=DELIVERED"><Stat label="مسلّمة (إجمالي)" value={inv.delivered} tone="success" /></Link>
      </div>
      {inv.reconciled ? (
        <Alert tone="success">الرصيد مطابق لحالات الجرار الفعلية.</Alert>
      ) : (
        <Alert tone="danger">
          الرصيد لا يطابق حالات الجرار (المتوقع: فارغة {inv.expected.empty}، معبأة {inv.expected.filled}، إضافية {inv.expected.extra}). هذا خلل يحتاج مراجعة؛ لم يُصحح تلقائيًا.
        </Alert>
      )}
      <Card title="سجل حركة المخزن">
        <form method="get" className="mb-3 flex flex-wrap gap-2">
          <Select name="type" defaultValue={sp.type ?? ""} className="w-48" aria-label="نوع الحركة">
            <option value="">كل الحركات</option>
            {Object.entries(MOVEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <DateInput name="from" defaultValue={sp.from} className="w-40" aria-label="من" />
          <DateInput name="to" defaultValue={sp.to} className="w-40" aria-label="إلى" />
          <Button type="submit" variant="secondary">تطبيق</Button>
        </form>
        {moves.rows.length === 0 ? (
          <EmptyState>لا توجد حركات.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-right text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 font-medium">الوقت</th>
                  <th className="py-2 font-medium">الحركة</th>
                  <th className="py-2 font-medium">المرجع</th>
                  <th className="py-2 font-medium">فارغ</th>
                  <th className="py-2 font-medium">معبأ</th>
                  <th className="py-2 font-medium">إضافي</th>
                  <th className="py-2 font-medium">الرصيد بعدها (فارغ/معبأ/إضافي)</th>
                  <th className="py-2 font-medium">المستخدم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {moves.rows.map((m) => (
                  <tr key={String(m.id)}>
                    <td className="py-2">{formatDateTime(m.at)}</td>
                    <td className="py-2">{MOVEMENT_LABELS[m.type]}{m.note && <div className="text-xs text-muted">{m.note}</div>}</td>
                    <td className="py-2">
                      {m.cylinder && <Link className="text-primary hover:underline" href={`/d/cylinders/${m.cylinder.id}`}><bdi dir="ltr">{m.cylinder.label}</bdi></Link>}
                      {!m.cylinder && m.shipmentId && <Link className="text-primary hover:underline" href={`/d/shipments/${m.shipmentId}`}>نقلة</Link>}
                    </td>
                    <td className="py-2 ltr-nums">{signed(m.emptyDelta)}</td>
                    <td className="py-2 ltr-nums">{signed(m.filledDelta)}</td>
                    <td className="py-2 ltr-nums">{signed(m.extraDelta)}</td>
                    <td className="py-2 ltr-nums">{m.emptyAfter} / {m.filledAfter} / {m.extraAfter}</td>
                    <td className="py-2">{m.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={moves.page} total={moves.total} pageSize={moves.pageSize} base="/d/inventory" params={params} />
      </Card>
    </div>
  );
}
