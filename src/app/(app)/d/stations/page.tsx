import { requirePageActor } from "@/server/http/context";
import { listStations } from "@/server/services/shipments";
import { PageHeader } from "@/components/ui";
import { StationsManager } from "./manager";

export const metadata = { title: "محطات التعبئة" };

export default async function StationsPage() {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const rows = await listStations(actor);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="محطات التعبئة" description="المحطات التي تستلم منها الشحنات. حساباتها المالية تُضاف في المرحلة 4." />
      <StationsManager rows={rows.map((s) => ({ id: s.id, name: s.name, phone: s.phone, notes: s.notes, active: s.active, shipments: s._count.shipments }))} />
    </div>
  );
}
