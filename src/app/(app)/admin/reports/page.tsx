import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { requirePageActor } from "@/server/http/context";
import { centralOverview, listReports } from "@/server/reports/service";
import { listCategories } from "@/server/services/categories";
import { hasPermission } from "@/server/actor";
import { Button, Card, EmptyState, PageHeader, Select, buttonClass } from "@/components/ui";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "التقارير المركزية" };

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "ADMIN", permission: "reports.view" });
  const sp = await searchParams;
  const filters = Object.fromEntries(Object.entries({ categoryId: sp.categoryId, includeArchived: sp.includeArchived }).filter(([, v]) => v)) as Record<string, string>;
  const qs = new URLSearchParams(filters).toString();
  const [data, categories] = await Promise.all([centralOverview(actor, filters), hasPermission(actor, "distributors.view") ? listCategories(actor) : Promise.resolve([])]);
  const reports = listReports();
  return (
    <div className="space-y-6">
      <PageHeader
        title="التقارير المركزية"
        description="ملخص عام لكل موزّع (الدورة النشطة، المخزون، المحصل، المستحقات) دون ترتيب أو مقارنة أداء."
        actions={
          <>
            <a href={`/api/v1/admin/central/xlsx${qs ? `?${qs}` : ""}`} className={buttonClass("secondary")}><Download className="size-4" /> Excel</a>
            <a href={`/print/central${qs ? `?${qs}` : ""}`} target="_blank" rel="noreferrer" className={buttonClass("secondary")}><Printer className="size-4" /> طباعة / PDF</a>
          </>
        }
      />
      <form method="get" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
        {categories.length > 0 && (
          <Select name="categoryId" defaultValue={sp.categoryId ?? ""} className="w-48" aria-label="التصنيف">
            <option value="">كل التصنيفات</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeArchived" value="1" defaultChecked={!!sp.includeArchived} className="size-4" /> تضمين المؤرشفين</label>
        <Button type="submit" variant="secondary">تطبيق</Button>
      </form>
      <Card title={`الإجمالي: ${data.totals.citizens} مستحق · ${data.totals.delivered} جرة مسلّمة · محصل ${formatMoney(data.totals.collected)} · مستحقات ${formatMoney(data.totals.outstanding)}`}>
        {data.rows.length === 0 ? (
          <EmptyState>لا يوجد موزّعون.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="text-right text-xs text-muted">
                <tr className="border-b border-border">
                  {["الموزّع", "الحالة", "الدورة النشطة", "المستحقون", "الجرار المستحقة", "استُلمت", "معبأة", "سُلّمت", "مخزون فارغ/معبأ", "المحصل", "المستحقات", "التقارير"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.region}</div></td>
                    <td className="px-2 py-2">{r.status}</td>
                    <td className="px-2 py-2">{r.cycle}</td>
                    <td className="px-2 py-2">{r.citizens}</td>
                    <td className="px-2 py-2">{r.entitled}</td>
                    <td className="px-2 py-2">{r.received}</td>
                    <td className="px-2 py-2">{r.filled}</td>
                    <td className="px-2 py-2">{r.delivered}</td>
                    <td className="px-2 py-2 ltr-nums">{r.stockEmpty} / {r.stockFilled}</td>
                    <td className="px-2 py-2">{formatMoney(r.collected)}</td>
                    <td className="px-2 py-2">{formatMoney(r.outstanding)}</td>
                    <td className="px-2 py-2"><Link className="text-primary hover:underline" href={`/admin/reports/citizens-sheet?distributorId=${r.id}`}>عرض</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="تقارير موزّع محدد">
        <p className="mb-2 text-sm text-muted">اختر «عرض» بجانب الموزّع ثم انتقل بين تقاريره:</p>
        <ul className="flex flex-wrap gap-2 text-sm">{reports.map((r) => <li key={r.key} className="rounded bg-surface-2 px-2 py-1">{r.title}</li>)}</ul>
      </Card>
    </div>
  );
}
