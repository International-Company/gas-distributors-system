import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { adminOverview } from "@/server/services/overview";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata = { title: "لوحة التحكم" };

export default async function AdminDashboard() {
  const actor = await requirePageActor({ role: "ADMIN" });
  const { accounts, security } = await adminOverview(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="لوحة التحكم" description={`مرحبًا ${actor.displayName}`} />

      {accounts && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="حسابات نشطة" value={accounts.active} tone="success" />
            <Stat label="منها تجريبية" value={accounts.trial} tone="primary" />
            <Stat label="معلّقة" value={accounts.suspended} tone="warning" />
            <Stat label="منتهية الصلاحية" value={accounts.expired} tone="danger" />
            <Stat label="مؤرشفة" value={accounts.archived} />
          </div>
          <Card title="حسابات تنتهي صلاحيتها خلال 7 أيام">
            {accounts.expiringSoon.length === 0 ? (
              <EmptyState>لا توجد حسابات تقترب من انتهاء صلاحيتها.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {accounts.expiringSoon.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-2.5">
                    <Link href={`/admin/distributors/${d.id}`} className="text-sm font-medium text-primary hover:underline">
                      {d.name}
                    </Link>
                    <span className="flex items-center gap-2 text-sm text-muted">
                      {d.isTrial && <Badge tone="primary">تجريبي</Badge>}
                      <span className="ltr-nums">{formatDate(d.expiresAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {security && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="محاولات دخول فاشلة (24 ساعة)" value={security.failed24h} tone={security.failed24h > 20 ? "warning" : "neutral"} />
          <Stat label="حسابات مقفلة مؤقتًا" value={security.locked} tone={security.locked ? "warning" : "neutral"} />
        </div>
      )}

      {!accounts && !security && <EmptyState>لا توجد أقسام متاحة لصلاحياتك في لوحة التحكم.</EmptyState>}

      <p className="text-xs text-muted">
        ملخصات المواطنين والجرار والمخزون والمبالغ لكل موزّع تُضاف إلى هذه اللوحة عند تنفيذ المراحل التشغيلية والمالية.
      </p>
    </div>
  );
}
