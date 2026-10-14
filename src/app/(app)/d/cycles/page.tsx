import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { listCycles } from "@/server/services/cycles";
import { getPublicSettings } from "@/server/services/settings";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { NewCycleForm } from "./new-cycle-form";

export const metadata = { title: "الدورات" };

export default async function CyclesPage() {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const [cycles, settings] = await Promise.all([listCycles(actor), getPublicSettings()]);
  const active = cycles.find((c) => c.status === "OPEN");
  return (
    <div className="space-y-6">
      <PageHeader title="الدورات" description="دورة نشطة واحدة فقط في كل وقت. الإغلاق لا يصفّر الأرصدة ولا يعني سدادها." />
      {!active && (
        <Card title="بدء دورة جديدة">
          <NewCycleForm currencySymbol={settings.currencySymbol} />
        </Card>
      )}
      {cycles.length === 0 ? (
        <EmptyState>لا توجد دورات بعد.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {cycles.map((c) => (
            <li key={c.id}>
              <Link href={`/d/cycles/${c.id}`} className="block rounded-xl border border-border bg-surface p-4 hover:border-primary">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{c.name}</span>
                  {c.status === "OPEN" ? <Badge tone="success">نشطة</Badge> : <Badge>مغلقة</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                  <span>السعر: {formatMoney(c.unitPrice, c.currencyCode === settings.currencyCode ? settings.currencySymbol : c.currencyCode)}</span>
                  <span>المستحقون: {c.citizens}</span>
                  <span>الجرار: {c.cylinders}</span>
                  <span>المطلوب: {formatMoney(c.amountDue)}</span>
                  <span>الفتح: {formatDate(c.openedAt)}</span>
                  {c.closedAt && <span>الإغلاق: {formatDate(c.closedAt)}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
