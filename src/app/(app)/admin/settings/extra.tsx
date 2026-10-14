"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Input } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

/** رفع الشعار أو إزالته (PNG أو JPEG أو WebP حتى 512 كيلوبايت). */
export function LogoForm({ logoUrl }: { logoUrl: string | null }) {
  const api = useApi();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upload = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return setError("اختر صورة");
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("file", f);
    const res = await fetch("/api/v1/admin/settings/logo", { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(json?.error?.message ?? "تعذر رفع الشعار");
    router.refresh();
  };
  const remove = useFormSubmit(() => api("DELETE", "/api/v1/admin/settings/logo"), () => router.refresh());
  return (
    <Card title="الشعار">
      <div className="flex flex-wrap items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="الشعار الحالي" className="size-16 rounded-lg border border-border object-contain" />
        ) : (
          <span className="text-sm text-muted">لا يوجد شعار؛ تُستخدم الأيقونة الافتراضية.</span>
        )}
        <Input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="w-64 py-1.5" aria-label="ملف الشعار" />
        <Button type="button" loading={busy} onClick={upload}>رفع</Button>
        {logoUrl && <Button type="button" variant="ghost" loading={remove.busy} onClick={() => remove.submit()}>إزالة</Button>}
      </div>
      {(error || remove.error) && <Alert tone="danger" className="mt-3">{error || remove.error}</Alert>}
      <p className="mt-2 text-xs text-muted">PNG أو JPEG أو WebP حتى 512 كيلوبايت. يظهر في القائمة الجانبية والتقارير المطبوعة.</p>
    </Card>
  );
}

type NavRow = { href: string; label: string; menu: "admin" | "distributor"; locked: boolean };
type Override = { label?: string; order?: number; hidden?: boolean };

/** تعديل أسماء أقسام القائمة الجانبية وترتيبها وإخفاء غير الأساسي منها. */
export function NavEditor({ rows, overrides }: { rows: NavRow[]; overrides: Record<string, Override> }) {
  const api = useApi();
  const router = useRouter();
  const [v, setV] = useState<Record<string, Override>>(overrides);
  const [saved, setSaved] = useState(false);
  const set = (href: string, patch: Override) => {
    setSaved(false);
    setV({ ...v, [href]: { ...v[href], ...patch } });
  };
  const run = useFormSubmit(
    () => {
      const clean = Object.fromEntries(
        Object.entries(v)
          .map(([k, o]) => [k, { ...(o.label ? { label: o.label } : {}), ...(o.order !== undefined && !Number.isNaN(o.order) ? { order: o.order } : {}), ...(o.hidden ? { hidden: true } : {}) }])
          .filter(([, o]) => Object.keys(o as object).length),
      );
      return api("PUT", "/api/v1/admin/settings/nav", clean);
    },
    () => {
      setSaved(true);
      router.refresh();
    },
  );
  const section = (menu: "admin" | "distributor", title: string) => (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <thead className="text-right text-xs text-muted">
          <tr><th className="py-1 font-medium">القسم الأصلي</th><th className="py-1 font-medium">الاسم المعروض</th><th className="py-1 font-medium">الترتيب</th><th className="py-1 font-medium">إخفاء</th></tr>
        </thead>
        <tbody>
          {rows.filter((r) => r.menu === menu).map((r) => (
            <tr key={r.href} className="border-t border-border">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5"><Input className="h-8" placeholder={r.label} value={v[r.href]?.label ?? ""} onChange={(e) => set(r.href, { label: e.target.value })} aria-label={`اسم ${r.label}`} /></td>
              <td className="py-1.5"><Input className="h-8 w-20" type="number" min={0} value={v[r.href]?.order ?? ""} onChange={(e) => set(r.href, { order: e.target.value === "" ? undefined : Number(e.target.value) })} aria-label={`ترتيب ${r.label}`} /></td>
              <td className="py-1.5">{r.locked ? <span className="text-xs text-muted">أساسي</span> : <input type="checkbox" className="size-4" checked={!!v[r.href]?.hidden} onChange={(e) => set(r.href, { hidden: e.target.checked })} aria-label={`إخفاء ${r.label}`} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <Card title="القائمة الجانبية">
      <p className="mb-3 text-xs text-muted">الإخفاء للتنظيم فقط؛ الوصول الفعلي تحكمه الصلاحيات على الخادم. الأقسام مجمّعة في القائمة حسب طبيعتها، والترتيب رقم يطبق داخل مجموعة القسم (الأصغر أولًا)؛ يُترك فارغًا للترتيب الافتراضي.</p>
      {run.error && <Alert tone="danger" className="mb-3">{run.error}</Alert>}
      {saved && <Alert tone="success" className="mb-3">حُفظت القائمة.</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        {section("distributor", "قائمة الموزّع")}
        {section("admin", "قائمة الإدارة")}
      </div>
      <Button className="mt-4" loading={run.busy} onClick={() => run.submit()}>حفظ القائمة</Button>
    </Card>
  );
}
