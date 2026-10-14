import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { getShipment } from "@/server/services/shipments";
import { Badge, Card, DetailList, EmptyState, PageHeader } from "@/components/ui";
import { CylinderStatusBadge } from "@/components/cylinder-status";
import { formatDateTime } from "@/lib/format";
import { CancelShipment } from "./cancel";

export const metadata = { title: "شحنة" };

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const { id } = await params;
  const s = await getShipment(actor, id);
  return (
    <div className="space-y-6">
      <PageHeader title={`شحنة ${s.station.name}`} actions={s.status === "CANCELLED" ? <Badge tone="danger">ملغاة</Badge> : <Badge tone="success">مستلمة</Badge>} />
      <Card title="البيانات">
        <DetailList
          items={[
            ["المحطة", s.station.name],
            ["وقت الاستلام", formatDateTime(s.receivedAt)],
            ["العدد المستلم", s.quantity],
            ["منها جرار مواطنين", s.linkedCount],
            ["منها كمية إضافية", s.extraCount],
            ["المرجع", s.reference ?? "—"],
            ["ملاحظات", s.notes ?? "—"],
            ["تاريخ التسجيل", formatDateTime(s.createdAt)],
            ...(s.cancelReason ? ([["سبب الإلغاء", `${s.cancelReason} (${formatDateTime(s.cancelledAt)})`]] as [string, string][]) : []),
          ]}
        />
        <p className="mt-3 text-xs text-muted">استلام الشحنة لا يعني دفع قيمتها؛ حساب المحطة والمدفوعات في المرحلة 4.</p>
      </Card>
      <Card title="جرار المواطنين المعبأة ضمن الشحنة">
        {s.fills.length === 0 ? (
          <EmptyState>لا توجد.</EmptyState>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {s.fills.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/d/cylinders/${f.cylinder.id}`} className="font-semibold text-primary hover:underline"><bdi>{f.cylinder.label}</bdi></Link> — {f.cylinder.entitlement.nameInStatement}
                  <span className="text-xs text-muted"> · {f.cylinder.entitlement.cycle.name}</span>
                </span>
                <span className="flex gap-1">
                  {f.status === "CANCELLED" && <Badge tone="danger">تعبئة ملغاة</Badge>}
                  <CylinderStatusBadge status={f.cylinder.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {s.status === "ACTIVE" && <CancelShipment id={s.id} />}
    </div>
  );
}
