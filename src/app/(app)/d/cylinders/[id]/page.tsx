import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { getCylinder } from "@/server/services/operations";
import { Badge, Card, DetailList, PageHeader } from "@/components/ui";
import { CylinderStatusBadge, OPERATION_LABELS } from "@/components/cylinder-status";
import { formatDateTime } from "@/lib/format";
import { CancelOperation } from "./cancel";

export const metadata = { title: "جرة" };

export default async function CylinderPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const { id } = await params;
  const c = await getCylinder(actor, id);
  const active = c.operations.filter((o) => o.status === "ACTIVE");
  const last = active[active.length - 1];
  return (
    <div className="space-y-6">
      <PageHeader title={`الجرة ${c.label}`} actions={<CylinderStatusBadge status={c.status} />} />
      <Card title="البيانات">
        <DetailList
          items={[
            ["المواطن", <Link key="c" className="text-primary hover:underline" href={`/d/citizens/${c.entitlement.citizen.id}`}>{c.entitlement.citizen.fullName}</Link>],
            ["رقم الهوية", <bdi key="n">{c.entitlement.citizen.nationalId}</bdi>],
            ["الدورة", c.entitlement.cycle.name],
            ["رقم المواطن في الكشف", <bdi key="cn">{c.entitlement.citizenNumber}</bdi>],
            ["جرة رقم", `${c.seq} من ${c.entitlement.quantity}`],
          ]}
        />
      </Card>
      <Card title="سجل العمليات">
        <ul className="divide-y divide-border text-sm">
          {c.operations.map((o) => (
            <li key={o.id} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {OPERATION_LABELS[o.type]}
                  {o.shipment && <span className="text-muted"> — ضمن شحنة <Link className="text-primary hover:underline" href={`/d/shipments/${o.shipment.id}`}>{o.shipment.station.name}{o.shipment.reference ? ` (${o.shipment.reference})` : ""}</Link></span>}
                  {o.identityMethod && <span className="text-xs text-muted"> · الهوية: {o.identityMethod === "ID_SCAN" ? "من صورة البطاقة" : "إدخال يدوي من البطاقة"}</span>}
                </span>
                {o.status === "CANCELLED" ? <Badge tone="danger">ملغاة</Badge> : <Badge tone="success">نافذة</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted">{formatDateTime(o.at)} · {c.userNames[o.userId] ?? "—"}</div>
              {o.status === "CANCELLED" && (
                <div className="mt-1 text-xs text-danger">أُلغيت {formatDateTime(o.cancelledAt)} بواسطة {c.userNames[o.cancelledById ?? ""] ?? "—"}: {o.cancelReason}</div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {last && !last.shipmentId && <CancelOperation operationId={last.id} label={OPERATION_LABELS[last.type]} />}
      {last?.shipmentId && <p className="text-sm text-muted">آخر عملية تعبئة ضمن شحنة؛ تُلغى من صفحة الشحنة.</p>}
    </div>
  );
}
