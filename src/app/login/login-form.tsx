"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, cn } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

export function LoginForm({ hasDevicePin }: { hasDevicePin: boolean }) {
  const [mode, setMode] = useState<"password" | "pin">(hasDevicePin ? "pin" : "password");
  return (
    <div>
      {hasDevicePin && (
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1 text-sm">
          {(["pin", "password"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("rounded-md py-2", mode === m ? "bg-surface font-semibold text-primary shadow-sm" : "text-muted")}
            >
              {m === "pin" ? "رمز PIN" : "كلمة المرور"}
            </button>
          ))}
        </div>
      )}
      {mode === "password" ? <PasswordForm /> : <PinForm />}
    </div>
  );
}

function PasswordForm() {
  const api = useApi();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useFormSubmit(
    () => api<{ mustChangePassword: boolean }>("POST", "/api/v1/auth/login", { username, password }),
    (r) => (window.location.href = r.mustChangePassword ? "/change-password" : "/"),
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="اسم المستخدم" htmlFor="username">
        <Input id="username" dir="ltr" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
      </Field>
      <Field label="كلمة المرور" htmlFor="password">
        <Input id="password" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>
        دخول
      </Button>
    </form>
  );
}

function PinForm() {
  const api = useApi();
  const [pin, setPin] = useState("");
  const { busy, error, submit } = useFormSubmit(
    () => api("POST", "/api/v1/auth/pin-login", { pin }),
    () => (window.location.href = "/"),
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="رمز PIN لهذا الجهاز" htmlFor="pin" hint="الدخول بـ PIN لا يكفي للعمليات الحساسة؛ سيُطلب منك تأكيد كلمة المرور عند الحاجة.">
        <Input
          id="pin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,8}"
          dir="ltr"
          className="text-center text-lg tracking-[0.5em]"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          required
          autoFocus
        />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>
        دخول
      </Button>
    </form>
  );
}
