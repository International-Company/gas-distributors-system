import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { listShipments, listStations } from "@/server/services/shipments";
import { listCylinders } from "@/server/services/operations";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { formatDateTime, formatMoney } from "@/lib/format";
import { NewShipment } from "./new-shipment";

export const metadata = { title: "نقلات المحطة" };

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const [data, stations, empties] = await Promise.all([
    listShipments(actor, { page: sp.page }),
    listStations(actor),
    listCylinders(actor, { status: "EMPTY", pageSize: 500 }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="نقلات المحطة" />
      <NewShipment
        stations={stations.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, defaultUnitPrice: s.defaultUnitPrice?.toString() ?? "" }))}
        empties={empties.rows.map((c) => ({ id: c.id, label: c.label, name: c.entitlement.nameInStatement, cycleName: c.entitlement.cycle.name }))}
        emptiesTotal={empties.total}
      />
      <Card title="النقلات المستلمة">
        {data.rows.length === 0 ? (
          <EmptyState>لا توجد نقلات.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {data.rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="text-sm">
                  <Link href={`/d/shipments/${s.id}`} className="font-semibold text-primary hover:underline">{s.station.name}{s.reference ? ` — ${s.reference}` : ""}</Link>
                  <div className="text-xs text-muted">{formatDateTime(s.receivedAt)} · {s.quantity} جرة ({s.linkedCount} لمواطنين، {s.extraCount} إضافية) · القيمة {formatMoney(s.unitPrice.mul(s.quantity))}</div>
                </div>
                {s.status === "CANCELLED" ? <Badge tone="danger">ملغاة</Badge> : <Badge tone="success">مستلمة</Badge>}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base="/d/shipments" params={{}} />
      </Card>
    </div>
  );
}
