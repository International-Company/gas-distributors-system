import Link from "next/link";
import { ScanLine } from "lucide-react";
import { requirePageActor } from "@/server/http/context";
import { getOwnDistributor } from "@/server/services/distributors";
import { distributorOverview } from "@/server/services/overview";
import { Alert, Card, PageHeader, Stat, buttonClass } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "الرئيسية" };

export default async function DistributorHome() {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const [d, o] = await Promise.all([getOwnDistributor(actor), distributorOverview(actor)]);
  const daysLeft = d.expiresAt ? Math.ceil((d.expiresAt.getTime() - Date.now()) / 86_400_000) : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title={`مرحبًا، ${d.name}`}
        actions={<Link href="/d/counter" className={buttonClass()}><ScanLine className="size-4" /> التوزيع</Link>}
      />
      {daysLeft !== null && daysLeft <= 7 && (
        <Alert tone="warning">
          تنتهي صلاحية حسابك{d.isTrial ? " التجريبي" : ""} بتاريخ {formatDate(d.expiresAt)}. تواصل مع الإدارة للتجديد.
        </Alert>
      )}

      {o.cycle ? (
        <Card title={<Link href={`/d/cycles/${o.cycle.id}`} className="hover:underline">الدورة النشطة: {o.cycle.name}</Link>}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Link href="/d/cylinders?status=EMPTY"><Stat label="فارغة بانتظار التعبئة" value={o.cycleCylinders.empty} tone="warning" /></Link>
            <Link href="/d/cylinders?status=FILLED"><Stat label="معبأة جاهزة" value={o.cycleCylinders.filled} tone="primary" /></Link>
            <Link href="/d/cylinders?status=DELIVERED"><Stat label="مسلّمة" value={o.cycleCylinders.delivered} tone="success" /></Link>
            <Stat label="منتظرة (لم تُستلم فارغة)" value={o.cycleCylinders.waiting} />
          </div>
          <p className="mt-3 text-sm text-muted">
            المستحقون: {o.citizens} · الجرار المستحقة: {o.cylinders} · سعر الجرة: {formatMoney(o.cycle.unitPrice, o.cycle.currencyCode)}
          </p>
        </Card>
      ) : (
        <Alert tone="warning">
          لا توجد دورة نشطة. <Link className="underline" href="/d/cycles">ابدأ دورة جديدة</Link> لاعتماد الكشوف.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Link href="/d/statements?status=PENDING_REVIEW"><Stat label="كشوف قيد المراجعة" value={o.pendingStatements} tone={o.pendingStatements ? "warning" : "neutral"} /></Link>
        <Link href="/d/statements?status=APPROVED"><Stat label="كشوف معتمدة" value={o.approvedStatements} tone="success" /></Link>
        <Link href="/d/review-cases"><Stat label="حالات مراجعة مفتوحة" value={o.openCases} tone={o.openCases ? "warning" : "neutral"} /></Link>
      </div>
    </div>
  );
}
