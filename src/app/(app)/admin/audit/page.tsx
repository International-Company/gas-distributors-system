import { requirePageActor } from "@/server/http/context";
import { listAuditLogs } from "@/server/services/logs";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { AUDIT_ACTION_LABELS, AuditTable } from "@/components/audit-table";
import { Pagination } from "@/components/pagination";

export const metadata = { title: "سجل التدقيق" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "ADMIN", permission: "audit.view" });
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page")) as Record<string, string>;
  const data = await listAuditLogs(actor, { ...params, page: sp.page });
  return (
    <div>
      <PageHeader title="سجل التدقيق" description="سجل محمي للإضافة فقط؛ لا يمكن تعديله أو حذفه." />
      <form method="get" className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 md:grid-cols-5">
        <Select name="action" defaultValue={sp.action ?? ""} className="col-span-2 md:col-span-2" aria-label="نوع العملية">
          <option value="">كل العمليات</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={sp.from} aria-label="من تاريخ" />
        <Input type="date" name="to" defaultValue={sp.to} aria-label="إلى تاريخ" />
        {sp.distributorId && <input type="hidden" name="distributorId" value={sp.distributorId} />}
        <Button type="submit" className="col-span-2 md:col-span-1">تطبيق</Button>
      </form>
      <Card>
        <AuditTable rows={data.rows} />
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base="/admin/audit" params={params} />
      </Card>
    </div>
  );
}
