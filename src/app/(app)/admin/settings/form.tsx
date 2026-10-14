"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

type S = {
  systemName: string; contactPhone: string; contactEmail: string; contactAddress: string;
  currencyCode: string; currencySymbol: string; sessionIdleMinutes: number; maxFailedLogins: number; lockoutMinutes: number;
  allowedFileTypes: string[]; maxUploadMb: number;
};

export function SettingsForm({ initial, supportedTypes }: { initial: S; supportedTypes: string[] }) {
  const api = useApi();
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setV({ ...v, [k]: e.target.value });
  };
  const { busy, error, fields, submit } = useFormSubmit(
    () => api("PATCH", "/api/v1/admin/settings", v),
    () => {
      setSaved(true);
      router.refresh();
    },
  );
  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {saved && <Alert tone="success">تم حفظ الإعدادات.</Alert>}

      <Card title="الهوية وبيانات التواصل">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم النظام" htmlFor="s-name" error={fields.systemName} className="sm:col-span-2">
            <Input id="s-name" value={v.systemName} onChange={set("systemName")} required />
          </Field>
          <Field label="هاتف التواصل" htmlFor="s-phone" error={fields.contactPhone}>
            <Input id="s-phone" dir="ltr" value={v.contactPhone} onChange={set("contactPhone")} />
          </Field>
          <Field label="البريد الإلكتروني" htmlFor="s-email" error={fields.contactEmail}>
            <Input id="s-email" dir="ltr" type="email" value={v.contactEmail} onChange={set("contactEmail")} />
          </Field>
          <Field label="العنوان" htmlFor="s-addr" error={fields.contactAddress} className="sm:col-span-2">
            <Input id="s-addr" value={v.contactAddress} onChange={set("contactAddress")} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">رفع الشعار يُفعّل بعد اعتماد مزوّد التخزين السحابي للملفات.</p>
      </Card>

      <Card title="العملة">
        <Alert tone="warning" className="mb-4">
          عملة أساسية واحدة دون تحويل. تغييرها لاحقًا لا يغيّر قيم العمليات المسجلة سابقًا، إذ تُحفظ كل عملية مالية بعملتها وقت تنفيذها.
        </Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="رمز العملة (ISO)" htmlFor="s-cc" error={fields.currencyCode} hint="مثال: ILS">
            <Input id="s-cc" dir="ltr" maxLength={3} value={v.currencyCode} onChange={set("currencyCode")} required />
          </Field>
          <Field label="رمز العرض" htmlFor="s-cs" error={fields.currencySymbol} hint="مثال: ₪">
            <Input id="s-cs" value={v.currencySymbol} onChange={set("currencySymbol")} required />
          </Field>
        </div>
      </Card>

      <Card title="الأمان">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="مهلة عدم النشاط (دقيقة)" htmlFor="s-idle" error={fields.sessionIdleMinutes} hint="من 5 إلى 1440">
            <Input id="s-idle" type="number" min={5} max={1440} value={v.sessionIdleMinutes} onChange={set("sessionIdleMinutes")} required />
          </Field>
          <Field label="محاولات الدخول الفاشلة قبل القفل" htmlFor="s-max" error={fields.maxFailedLogins} hint="من 3 إلى 20">
            <Input id="s-max" type="number" min={3} max={20} value={v.maxFailedLogins} onChange={set("maxFailedLogins")} required />
          </Field>
          <Field label="مدة القفل (دقيقة)" htmlFor="s-lock" error={fields.lockoutMinutes}>
            <Input id="s-lock" type="number" min={1} max={1440} value={v.lockoutMinutes} onChange={set("lockoutMinutes")} required />
          </Field>
        </div>
      </Card>

      <Card title="الملفات">
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">أنواع الملفات المسموح رفعها</legend>
            <div className="flex flex-wrap gap-4">
              {supportedTypes.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={v.allowedFileTypes.includes(t)}
                    onChange={(e) => {
                      setSaved(false);
                      setV({ ...v, allowedFileTypes: e.target.checked ? [...v.allowedFileTypes, t] : v.allowedFileTypes.filter((x) => x !== t) });
                    }}
                  />
                  <bdi dir="ltr">.{t}</bdi>
                </label>
              ))}
            </div>
            {fields.allowedFileTypes && <p className="mt-1 text-xs text-danger">{fields.allowedFileTypes}</p>}
            <p className="mt-1 text-xs text-muted">الكشوف تقبل PDF و Excel فقط من بين المسموح. الصور للمرفقات (الإعلانات والدعم لاحقًا).</p>
          </fieldset>
          <Field label="الحد الأقصى لحجم الملف (ميغابايت)" htmlFor="s-maxmb" error={fields.maxUploadMb} hint="من 1 إلى 50">
            <Input id="s-maxmb" type="number" min={1} max={50} className="w-32" value={v.maxUploadMb} onChange={(e) => { setSaved(false); setV({ ...v, maxUploadMb: Number(e.target.value) }); }} required />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={busy}>حفظ الإعدادات</Button>
      </div>
    </form>
  );
}
