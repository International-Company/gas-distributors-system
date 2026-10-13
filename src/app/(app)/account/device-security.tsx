"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

export function DeviceSecurity({ hasPin }: { hasPin: boolean }) {
  const api = useApi();
  const router = useRouter();
  const [v, setV] = useState({ password: "", pin: "", confirmPin: "" });
  const [msg, setMsg] = useState("");
  const digits = (k: "pin" | "confirmPin") => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value.replace(/\D/g, "").slice(0, 8) });

  const setPin = useFormSubmit(
    () => api("POST", "/api/v1/auth/pin", v),
    () => {
      setV({ password: "", pin: "", confirmPin: "" });
      setMsg("تم تفعيل PIN على هذا الجهاز.");
      router.refresh();
    },
  );
  const removePin = useFormSubmit(
    () => api("DELETE", "/api/v1/auth/pin"),
    () => {
      setMsg("تم إلغاء PIN على هذا الجهاز.");
      router.refresh();
    },
  );
  const logoutAll = useFormSubmit(
    () => api("POST", "/api/v1/auth/logout-all"),
    () => (window.location.href = "/login"),
  );

  return (
    <>
      <Card title="الدخول السريع بـ PIN على هذا الجهاز">
        <p className="mb-4 text-sm text-muted">
          يسهّل PIN الدخول على هذا الجهاز فقط. لا يغني عن كلمة المرور في العمليات الحساسة، ويُلغى تلقائيًا بعد 5 محاولات خاطئة.
        </p>
        {msg && <Alert tone="success" className="mb-3">{msg}</Alert>}
        {(setPin.error || removePin.error) && <Alert tone="danger" className="mb-3">{setPin.error || removePin.error}</Alert>}
        <form onSubmit={setPin.submit} className="grid gap-4 sm:grid-cols-3">
          <Field label="كلمة المرور" htmlFor="p-pw" error={setPin.fields.password}>
            <Input id="p-pw" type="password" dir="ltr" autoComplete="current-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} required />
          </Field>
          <Field label="PIN (4-8 أرقام)" htmlFor="p-pin" error={setPin.fields.pin}>
            <Input id="p-pin" type="password" inputMode="numeric" dir="ltr" autoComplete="off" value={v.pin} onChange={digits("pin")} required />
          </Field>
          <Field label="تأكيد PIN" htmlFor="p-pin2" error={setPin.fields.confirmPin}>
            <Input id="p-pin2" type="password" inputMode="numeric" dir="ltr" autoComplete="off" value={v.confirmPin} onChange={digits("confirmPin")} required />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button type="submit" loading={setPin.busy}>{hasPin ? "تغيير PIN" : "تفعيل PIN"}</Button>
            {hasPin && (
              <Button type="button" variant="secondary" loading={removePin.busy} onClick={() => removePin.submit()}>
                إلغاء PIN على هذا الجهاز
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card title="الأجهزة والجلسات">
        <p className="mb-4 text-sm text-muted">ينهي جميع جلساتك على كل الأجهزة (بما فيها هذا الجهاز) ويلغي PIN في كل مكان.</p>
        {logoutAll.error && <Alert tone="danger" className="mb-3">{logoutAll.error}</Alert>}
        <Button
          variant="danger"
          loading={logoutAll.busy}
          onClick={() => {
            if (confirm("تسجيل الخروج من جميع الأجهزة؟")) logoutAll.submit();
          }}
        >
          تسجيل الخروج من جميع الأجهزة
        </Button>
      </Card>
    </>
  );
}
