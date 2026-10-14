import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { cashBox } from "@/server/services/finance";
import { listCycles } from "@/server/services/cycles";
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Stat } from "@/components/ui";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { DateInput } from "@/components/date-input";

export const metadata = { title: "الصندوق" };

const KIND: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  PAYMENT: { label: "تحصيل", tone: "success" },
  EXPENSE: { label: "مصروف", tone: "warning" },
  STATION_PAYMENT: { label: "دفعة محطة", tone: "neutral" },
};

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const filters = Object.fromEntries(Object.entries({ from: sp.from, to: sp.to, cycleId: sp.cycleId }).filter(([, v]) => v)) as Record<string, string>;
  const [box, cycles] = await Promise.all([cashBox(actor, filters), listCycles(actor)]);
  return (
    <div className="space-y-6">
      <PageHeader title="الصندوق" />
      <form method="get" className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3">
        <Select name="cycleId" defaultValue={sp.cycleId ?? ""} className="w-48" aria-label="الدورة">
          <option value="">كل الدورات</option>
          {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <DateInput name="from" defaultValue={sp.from} className="w-40" aria-label="من تاريخ" />
        <DateInput name="to" defaultValue={sp.to} className="w-40" aria-label="إلى تاريخ" />
        <Button type="submit" variant="secondary">تطبيق</Button>
        {Object.keys(filters).length > 0 && <Link href="/d/finance" className="self-center text-sm text-primary hover:underline">مسح</Link>}
      </form>
      {(box.cycle || box.range.from || box.range.to) && (
        <p className="text-sm text-muted">
          {box.cycle ? `الدورة: ${box.cycle.name} — ` : ""}الفترة: {box.range.from ? formatDate(box.range.from) : "البداية"} إلى {box.range.to ? formatDate(box.range.to) : "الآن"}
          {box.cycle && " (التحصيلات المرتبطة بالدورة، والمصروفات ودفعات المحطات خلال فترتها)"}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/d/collections"><Stat label="المقبوضات (تحصيلات)" value={formatMoney(box.receipts)} tone="success" /></Link>
        <Link href="/d/expenses"><Stat label="المصروفات" value={formatMoney(box.expenses)} tone="warning" /></Link>
        <Link href="/d/stations"><Stat label="دفعات المحطات" value={formatMoney(box.stationPayments)} /></Link>
        <Stat label="الرصيد المحسوب" value={formatMoney(box.balance)} tone={box.balance.isNeg() ? "danger" : "primary"} />
      </div>
      <Alert tone="warning">الرصيد محسوب من السجلات المسجلة في النظام، ولا يثبت مقدار النقد الموجود فعلًا في الصندوق.</Alert>
      <Card title="الحركات">
        {box.entries.length === 0 ? (
          <EmptyState>لا توجد حركات.</EmptyState>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {box.entries.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">
                  <Badge tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge>
                  <span>{e.description}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted">{formatDateTime(e.at)}</span>
                  <strong className={e.amount.isNeg() ? "text-danger" : "text-success"}>{formatMoney(e.amount)}</strong>
                </span>
              </li>
            ))}
          </ul>
        )}
        {box.truncated && <p className="mt-2 text-xs text-muted">تُعرض آخر 500 حركة؛ ضيّق الفترة لعرض الباقي. الإجماليات أعلاه تشمل كل الحركات.</p>}
      </Card>
    </div>
  );
}
