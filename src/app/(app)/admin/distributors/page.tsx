import Link from "next/link";
import { Download, Pin, Plus } from "lucide-react";
import { requirePageActor } from "@/server/http/context";
import { hasPermission } from "@/server/actor";
import { listDistributors } from "@/server/services/distributors";
import { listCategories } from "@/server/services/categories";
import { Badge, Button, buttonClass, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { DistributorStatusBadge } from "@/components/distributor-status";
import { formatDate } from "@/lib/format";

export const metadata = { title: "الموزّعون" };

type SP = Promise<Record<string, string | undefined>>;

export default async function DistributorsPage({ searchParams }: { searchParams: SP }) {
  const actor = await requirePageActor({ role: "ADMIN", permission: "distributors.view" });
  const sp = await searchParams;
  const filters = Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>;
  const [rows, categories] = await Promise.all([listDistributors(actor, filters), listCategories(actor)]);
  const qs = new URLSearchParams(filters).toString();

  return (
    <div>
      <PageHeader
        title="الموزّعون"
        actions={
          <>
            {hasPermission(actor, "distributors.export") && (
              <a href={`/api/v1/admin/distributors/export${qs ? `?${qs}` : ""}`} className={buttonClass("secondary")}>
                <Download className="size-4" /> تصدير Excel
              </a>
            )}
            {hasPermission(actor, "distributors.manage") && (
              <Link href="/admin/distributors/new" className={buttonClass()}>
                <Plus className="size-4" /> حساب جديد
              </Link>
            )}
          </>
        }
      />

      <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 md:grid-cols-6" method="get">
        <Input name="q" defaultValue={sp.q} placeholder="بحث بالاسم أو الهاتف أو المنطقة أو اسم المستخدم" className="col-span-2" />
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="الحالة">
          <option value="">كل الحالات (دون المؤرشف)</option>
          <option value="ACTIVE">نشط</option>
          <option value="SUSPENDED">معلّق</option>
          <option value="EXPIRED">منتهي الصلاحية</option>
          <option value="ARCHIVED">مؤرشف</option>
          <option value="ALL">الكل</option>
        </Select>
        <Select name="categoryId" defaultValue={sp.categoryId ?? ""} aria-label="التصنيف">
          <option value="">كل التصنيفات</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select name="trial" defaultValue={sp.trial ?? ""} aria-label="نوع الحساب">
          <option value="">كل الأنواع</option>
          <option value="yes">تجريبي</option>
          <option value="no">فعلي</option>
        </Select>
        <Select name="expiringDays" defaultValue={sp.expiringDays ?? ""} aria-label="قرب الانتهاء">
          <option value="">أي تاريخ انتهاء</option>
          <option value="7">ينتهي خلال 7 أيام</option>
          <option value="30">ينتهي خلال 30 يومًا</option>
        </Select>
        <label className="col-span-2 flex items-center gap-2 text-sm md:col-span-1">
          <input type="checkbox" name="pinned" value="yes" defaultChecked={sp.pinned === "yes"} className="size-4" /> المثبتة فقط
        </label>
        <div className="col-span-2 flex gap-2 md:col-span-5 md:justify-end">
          <Button type="submit">تطبيق</Button>
          <Link href="/admin/distributors" className={buttonClass("ghost")}>مسح الفلاتر</Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState>لا توجد حسابات مطابقة.</EmptyState>
      ) : (
        <>
          {/* جدول على الشاشات الكبيرة */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-right text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">الموزّع</th>
                  <th className="px-4 py-3 font-medium">اسم المستخدم</th>
                  <th className="px-4 py-3 font-medium">الهاتف</th>
                  <th className="px-4 py-3 font-medium">المنطقة</th>
                  <th className="px-4 py-3 font-medium">التصنيف</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">الانتهاء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/distributors/${d.id}`} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                        {d.isPinned && <Pin className="size-3.5" aria-label="مثبّت" />}
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 ltr-nums">{d.user?.username}</td>
                    <td className="px-4 py-3 ltr-nums">{d.phone}</td>
                    <td className="px-4 py-3">{d.region}</td>
                    <td className="px-4 py-3">{d.category?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <DistributorStatusBadge d={d} />
                        {d.isTrial && <Badge tone="primary">تجريبي</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 ltr-nums">{d.expiresAt ? formatDate(d.expiresAt) : "بلا مدة"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* بطاقات على الهاتف */}
          <ul className="space-y-2 md:hidden">
            {rows.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/distributors/${d.id}`} className="block rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      {d.isPinned && <Pin className="size-3.5 text-primary" />}
                      {d.name}
                    </span>
                    <DistributorStatusBadge d={d} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="ltr-nums">{d.phone}</span>
                    <span>{d.region}</span>
                    {d.category && <span>{d.category.name}</span>}
                    <span>{d.isTrial ? "تجريبي" : "فعلي"} · {d.expiresAt ? `ينتهي ${formatDate(d.expiresAt)}` : "بلا مدة"}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
