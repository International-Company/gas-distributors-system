import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { listCylinders } from "@/server/services/operations";
import { listCycles } from "@/server/services/cycles";
import { Button, EmptyState, Input, PageHeader, Select, buttonClass, cn } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { CYLINDER_STATUS } from "@/components/cylinder-status";
import { CylinderTable } from "./table";

export const metadata = { title: "الجرار" };

export default async function CylindersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const status = sp.status && sp.status in CYLINDER_STATUS ? sp.status : undefined;
  const [data, cycles] = await Promise.all([listCylinders(actor, { status, cycleId: sp.cycleId || undefined, q: sp.q || undefined, page: sp.page }), listCycles(actor)]);
  const params = Object.fromEntries(Object.entries({ status, cycleId: sp.cycleId, q: sp.q }).filter(([, v]) => v)) as Record<string, string>;
  const tab = (key: string, label: string) => (
    <Link key={key} href={`/d/cylinders?${new URLSearchParams({ ...params, status: key })}`.replace(/status=&?/, "")} className={cn(buttonClass((status ?? "") === key ? "primary" : "secondary", "sm"))}>{label}</Link>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="الجرار" description="الجرار المستلمة وحالاتها. حدد الجرار الفارغة لتعبئتها دفعة واحدة." />
      <div className="flex flex-wrap gap-2">
        {tab("", "الكل")}
        {tab("EMPTY", "فارغة لم تُعبأ")}
        {tab("FILLED", "معبأة لم تُسلّم")}
        {tab("DELIVERED", "مسلّمة")}
        {tab("VOID", "ملغاة")}
      </div>
      <form method="get" className="flex flex-wrap gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <Select name="cycleId" defaultValue={sp.cycleId ?? ""} className="w-48" aria-label="الدورة">
          <option value="">كل الدورات</option>
          {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input name="q" defaultValue={sp.q} placeholder="رقم الجرة أو الاسم أو الهوية" className="w-64" />
        <Button type="submit" variant="secondary">تطبيق</Button>
      </form>
      {data.rows.length === 0 ? (
        <EmptyState>لا توجد جرار.</EmptyState>
      ) : (
        <CylinderTable
          rows={data.rows.map((c) => ({
            id: c.id, label: c.label, status: c.status, name: c.entitlement.nameInStatement, nationalId: c.entitlement.citizen.nationalId,
            citizenId: c.entitlement.citizen.id, cycleName: c.entitlement.cycle.name, removed: c.entitlement.status !== "ACTIVE", updatedAt: c.updatedAt.toISOString(),
          }))}
          selectable={status === "EMPTY"}
        />
      )}
      <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base="/d/cylinders" params={params} />
    </div>
  );
}
