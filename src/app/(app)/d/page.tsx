import { requirePageActor } from "@/server/http/context";
import { getOwnDistributor } from "@/server/services/distributors";
import { Alert, Card, DetailList, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata = { title: "الرئيسية" };

export default async function DistributorHome() {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const d = await getOwnDistributor(actor);
  const daysLeft = d.expiresAt ? Math.ceil((d.expiresAt.getTime() - Date.now()) / 86_400_000) : null;
  return (
    <div className="space-y-6">
      <PageHeader title={`مرحبًا، ${d.name}`} description={d.region} />
      {daysLeft !== null && daysLeft <= 7 && (
        <Alert tone="warning">
          تنتهي صلاحية حسابك{d.isTrial ? " التجريبي" : ""} بتاريخ <span className="ltr-nums">{formatDate(d.expiresAt)}</span>. تواصل مع الإدارة للتجديد.
        </Alert>
      )}
      <Card title="بيانات الحساب">
        <DetailList
          items={[
            ["الاسم", d.name],
            ["الهاتف", <span key="p" className="ltr-nums">{d.phone}</span>],
            ["المنطقة أو نطاق العمل", d.region],
            ["نوع الحساب", d.isTrial ? "تجريبي" : "فعلي"],
            ["صلاحية الحساب", d.expiresAt ? `حتى ${formatDate(d.expiresAt)}` : "بلا مدة محددة"],
          ]}
        />
      </Card>
      <Alert>
        أقسام التشغيل (الكشوف، المواطنون، الدورات، الجرار، المخزون، المالية) قيد التنفيذ وستظهر هنا عند اعتماد مراحلها.
      </Alert>
    </div>
  );
}
