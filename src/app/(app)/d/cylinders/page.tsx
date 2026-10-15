import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { listCylinders } from "@/server/services/operations";
import { getInventory } from "@/server/services/inventory";
import { listCycles } from "@/server/services/cycles";
import { Alert, Button, EmptyState, Input, PageHeader, Select, buttonClass, cn } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { CYLINDER_STATUS } from "@/components/cylinder-status";
import { CylinderTable } from "./table";

export const metadata = { title: "الجرار" };

/** الجرار والمخزن في صفحة واحدة: أرصدة المخزن في الأعلى (وهي نفسها فلاتر القائمة)، ثم الجرار. */
export default async function CylindersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const status = sp.status && sp.status in CYLINDER_STATUS ? sp.status : undefined;
  const [data, cycles, inv] = await Promise.all([
    listCylinders(actor, { status, cycleId: sp.cycleId || undefined, q: sp.q || undefined, page: sp.page }),
    listCycles(actor),
    getInventory(actor),
  ]);
  const params = Object.fromEntries(Object.entries({ status, cycleId: sp.cycleId, q: sp.q }).filter(([, v]) => v)) as Record<string, string>;
  const hrefFor = (key: string) => {
    const q = new URLSearchParams({ ...params, ...(key ? { status: key } : {}) });
    if (!key) q.delete("status");
    const s = q.toString();
    return `/d/cylinders${s ? `?${s}` : ""}`;
  };

  const cards: { key: string; label: string; value: number; tone: string }[] = [
    { key: "EMPTY", label: "بدها تعبية", value: inv.balance.empty, tone: "text-warning" },
    { key: "FILLED", label: "جاهزة للتسليم", value: inv.balance.filled, tone: "text-primary" },
    { key: "DELIVERED", label: "سُلّمت", value: inv.delivered, tone: "text-success" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="الجرار" actions={<Link href="/d/reports/movements" className={buttonClass("secondary", "sm")}>سجل الحركة</Link>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={hrefFor(status === c.key ? "" : c.key)}
            aria-current={status === c.key ? "true" : undefined}
            className={cn(
              "rounded-xl border bg-surface p-4 transition-colors hover:border-primary/50",
              status === c.key ? "border-primary ring-2 ring-primary/30" : "border-border",
            )}
          >
            <div className="text-sm text-muted">{c.label}</div>
            <div className={cn("mt-2 text-2xl font-bold tabular-nums", c.tone)}>{c.value}</div>
          </Link>
        ))}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-sm text-muted">جرار إضافية من النقلات</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{inv.balance.extra}</div>
        </div>
      </div>

      {!inv.reconciled && (
        <Alert tone="danger">
          رصيد المخزن لا يطابق حالات الجرار (المتوقع: فارغة {inv.expected.empty}، جاهزة {inv.expected.filled}، إضافية {inv.expected.extra}). هذا خلل يحتاج مراجعة؛ لم يُصحح تلقائيًا.
        </Alert>
      )}

      <form method="get" className="flex flex-wrap items-center gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <Select name="cycleId" defaultValue={sp.cycleId ?? ""} className="w-48" aria-label="الدورة">
          <option value="">كل الدورات</option>
          {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input name="q" defaultValue={sp.q} placeholder="رقم الجرة أو الاسم أو الهوية" className="w-64" />
        <Button type="submit" variant="secondary">تطبيق</Button>
        <span className="ms-auto flex gap-3 text-sm">
          {status && <Link href={hrefFor("")} className="text-primary hover:underline">عرض الكل</Link>}
          {status !== "VOID" && <Link href={hrefFor("VOID")} className="text-muted hover:underline">الملغاة</Link>}
        </span>
      </form>

      {data.rows.length === 0 ? (
        <EmptyState>
          {status === "EMPTY" || (!status && !sp.q && !sp.cycleId) ? (
            <>
              <span className="block">ما في جرار هون. الجرار تُسجّل من «التوزيع» لما تستلم جرة فاضية من صاحبها.</span>
              <Link href="/d/counter" className={buttonClass("secondary", "sm", "mt-3")}>اذهب إلى التوزيع</Link>
            </>
          ) : (
            "ما في جرار بهذا البحث."
          )}
        </EmptyState>
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
