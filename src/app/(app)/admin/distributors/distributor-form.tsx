"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";
import { endOfDayIso, toDateInput } from "@/lib/format";
import { DateInput } from "@/components/date-input";

type Category = { id: string; name: string };
type Existing = { id: string; name: string; phone: string; region: string; categoryId: string | null; username: string };

/** نموذج إنشاء حساب موزّع، أو تعديل بياناته الأساسية عند تمرير existing. */
export function DistributorForm({ categories, existing }: { categories: Category[]; existing?: Existing }) {
  const api = useApi();
  const router = useRouter();
  const [v, setV] = useState({
    name: existing?.name ?? "",
    username: existing?.username ?? "",
    password: "",
    phone: existing?.phone ?? "",
    region: existing?.region ?? "",
    categoryId: existing?.categoryId ?? "",
    isTrial: false,
    expiresAt: "",
  });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setV({ ...v, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  };

  const { busy, error, fields, submit } = useFormSubmit(
    () => {
      const common = { name: v.name, username: v.username, phone: v.phone, region: v.region, categoryId: v.categoryId || null };
      return existing
        ? api<{ id: string }>("PATCH", `/api/v1/admin/distributors/${existing.id}`, common)
        : api<{ id: string }>("POST", "/api/v1/admin/distributors", {
            ...common, password: v.password, isTrial: v.isTrial, expiresAt: v.expiresAt ? endOfDayIso(v.expiresAt) : null,
          });
    },
    (d) => {
      if (existing) {
        setSaved(true);
        router.refresh();
      } else router.push(`/admin/distributors/${d.id}`);
    },
  );

  return (
    <Card title={existing ? "البيانات الأساسية" : undefined}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && <Alert tone="success">تم حفظ التعديلات.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم الموزّع" htmlFor="f-name" error={fields.name}>
            <Input id="f-name" value={v.name} onChange={set("name")} required />
          </Field>
          <Field label="اسم المستخدم" htmlFor="f-username" error={fields.username} hint="حروف لاتينية صغيرة وأرقام">
            <Input id="f-username" dir="ltr" autoCapitalize="none" value={v.username} onChange={set("username")} required />
          </Field>
          {!existing && (
            <Field label="كلمة المرور الأولية" htmlFor="f-password" error={fields.password} hint="8 أحرف على الأقل، أرقام وحروف">
              <Input id="f-password" type="text" dir="ltr" autoComplete="new-password" value={v.password} onChange={set("password")} required />
            </Field>
          )}
          <Field label="رقم الهاتف" htmlFor="f-phone" error={fields.phone}>
            <Input id="f-phone" dir="ltr" inputMode="tel" value={v.phone} onChange={set("phone")} required />
          </Field>
          <Field label="المنطقة أو نطاق العمل" htmlFor="f-region" error={fields.region}>
            <Input id="f-region" value={v.region} onChange={set("region")} required />
          </Field>
          <Field label="التصنيف" htmlFor="f-cat" error={fields.categoryId}>
            <Select id="f-cat" value={v.categoryId} onChange={set("categoryId")}>
              <option value="">بلا تصنيف</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        {!existing && (
          <div className="grid gap-4 rounded-lg bg-surface-2 p-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4" checked={v.isTrial} onChange={set("isTrial")} /> حساب تجريبي
            </label>
            <Field label={v.isTrial ? "تاريخ انتهاء التجربة" : "تاريخ انتهاء الحساب (اختياري)"} htmlFor="f-exp" error={fields.expiresAt} hint={v.isTrial ? undefined : "اتركه فارغًا لحساب بلا مدة محددة"}>
              <DateInput id="f-exp" min={toDateInput(new Date())} value={v.expiresAt} onChange={(x) => setV({ ...v, expiresAt: x })} required={v.isTrial} />
            </Field>
          </div>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>{existing ? "حفظ التعديلات" : "إنشاء الحساب"}</Button>
        </div>
      </form>
    </Card>
  );
}
