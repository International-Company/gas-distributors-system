"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "./ui";
import { useApi, useFormSubmit } from "./api-client";

export function ChangePasswordForm({ redirectTo }: { redirectTo?: string }) {
  const api = useApi();
  const [v, setV] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [done, setDone] = useState(false);
  const { busy, error, fields, submit } = useFormSubmit(
    () => api("POST", "/api/v1/auth/change-password", v),
    () => {
      setV({ currentPassword: "", newPassword: "", confirmPassword: "" });
      if (redirectTo) window.location.href = redirectTo;
      else setDone(true);
    },
  );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success">تم تغيير كلمة المرور، وأُنهيت جلساتك على الأجهزة الأخرى.</Alert>}
      <Field label="كلمة المرور الحالية" htmlFor="cp-current" error={fields.currentPassword}>
        <Input id="cp-current" type="password" dir="ltr" autoComplete="current-password" value={v.currentPassword} onChange={set("currentPassword")} required />
      </Field>
      <Field label="كلمة المرور الجديدة" htmlFor="cp-new" error={fields.newPassword} hint="8 أحرف على الأقل وتحتوي على أرقام وحروف">
        <Input id="cp-new" type="password" dir="ltr" autoComplete="new-password" value={v.newPassword} onChange={set("newPassword")} required />
      </Field>
      <Field label="تأكيد كلمة المرور الجديدة" htmlFor="cp-confirm" error={fields.confirmPassword}>
        <Input id="cp-confirm" type="password" dir="ltr" autoComplete="new-password" value={v.confirmPassword} onChange={set("confirmPassword")} required />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        حفظ كلمة المرور
      </Button>
    </form>
  );
}
