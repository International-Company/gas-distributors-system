import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { getCycleSummary } from "@/server/services/cycles";
import { Badge, Card, DetailList, EmptyState, PageHeader, Stat } from "@/components/ui";
import { StatementStatusBadge } from "@/components/statement-status";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { CycleActions } from "./actions";

export const metadata = { title: "دورة" };

const EVENT_LABELS: Record<string, string> = { OPENED: "فتح الدورة", CLOSED: "إغلاق الدورة", REOPENED: "إعادة فتح", PRICE_CHANGED: "تعديل السعر" };

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const { id } = await params;
  const s = await getCycleSummary(actor, id);
  const c = s.cycle;
  return (
    <div className="space-y-6">
      <PageHeader title={c.name} actions={c.status === "OPEN" ? <Badge tone="success">نشطة</Badge> : <Badge>مغلقة</Badge>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="المستحقون" value={s.citizens} tone="primary" />
        <Stat label="الجرار المستحقة" value={s.cylinders} />
        <Stat label="المبلغ المطلوب" value={formatMoney(s.amountDue)} />
        <Stat label="كشوف قيد المراجعة" value={s.pendingStatements} tone={s.pendingStatements ? "warning" : "neutral"} />
      </div>
      <Card title="بيانات الدورة">
        <DetailList
          items={[
            ["سعر الجرة", formatMoney(c.unitPrice, c.currencyCode)],
            ["تاريخ الفتح", formatDateTime(c.openedAt)],
            ["تاريخ الإغلاق", formatDateTime(c.closedAt, "—")],
            ["استحقاقات أُزيلت بتحديث الكشف", s.removedEntitlements],
          ]}
        />
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="فارغة لم تُعبأ" value={s.cylinderStates.empty} tone={s.cylinderStates.empty ? "warning" : "neutral"} />
          <Stat label="معبأة لم تُسلّم" value={s.cylinderStates.filled} tone={s.cylinderStates.filled ? "primary" : "neutral"} />
          <Stat label="مسلّمة" value={s.cylinderStates.delivered} tone="success" />
        </div>
        <p className="mt-3 text-xs text-muted">إغلاق الدورة لا يلغي الجرار المعلقة: يمكن تعبئتها وتسليمها بعد الإغلاق، ولا تُستلم جرار جديدة فيها. ملخص التحصيل يُضاف مع المرحلة 4.</p>
      </Card>
      <CycleActions cycle={{ id: c.id, status: c.status, unitPrice: c.unitPrice.toString() }} pendingStatements={s.pendingStatements} />
      <Card title="كشوف الدورة">
        {s.statements.length === 0 ? (
          <EmptyState>لا توجد كشوف. <Link className="text-primary hover:underline" href="/d/statements">استيراد كشف</Link></EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {s.statements.map((st) => (
              <li key={st.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link href={`/d/statements/${st.id}`} className="text-sm font-medium text-primary hover:underline">
                  {st.title} {st.version > 1 && <span className="text-muted">(الإصدار {st.version})</span>}
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <StatementStatusBadge status={st.status} />
                  {formatDate(st.importedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="سجل الدورة">
        <ul className="divide-y divide-border text-sm">
          {s.events.map((e) => (
            <li key={String(e.id)} className="py-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{EVENT_LABELS[e.type]}</span>
                <span className="text-xs text-muted">{formatDateTime(e.at)} · {e.userName}</span>
              </div>
              {e.reason && <div className="mt-1 text-muted">السبب: {e.reason}</div>}
              {e.type === "PRICE_CHANGED" && e.details && (
                <div className="mt-1 text-muted">
                  من {formatMoney((e.details as { from: string }).from)} إلى {formatMoney((e.details as { to: string }).to)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
