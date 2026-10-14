import { requirePageActor } from "@/server/http/context";
import { stationsSummary } from "@/server/services/finance";
import { listStations } from "@/server/services/shipments";
import { PageHeader } from "@/components/ui";
import { StationsManager } from "./manager";

export const metadata = { title: "محطات التعبئة" };

export default async function StationsPage() {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const [rows, counts] = await Promise.all([stationsSummary(actor), listStations(actor)]);
  const shipments = new Map(counts.map((s) => [s.id, s._count.shipments]));
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="محطات التعبئة" description="حساب كل محطة: قيمة الشحنات المستلمة (العدد × سعر الشراء) مقابل الدفعات." />
      <StationsManager
        rows={rows.map((s) => ({
          id: s.id, name: s.name, phone: s.phone, notes: s.notes, active: s.active, shipments: shipments.get(s.id) ?? 0,
          defaultUnitPrice: s.defaultUnitPrice?.toString() ?? null, value: s.value.toString(), paid: s.paid.toString(), remaining: s.remaining.toString(),
        }))}
      />
    </div>
  );
}
