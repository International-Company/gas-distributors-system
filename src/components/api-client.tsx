"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button, Field, Input, Alert } from "./ui";
import { Modal } from "./modal";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly status = 0,
  ) {
    super(message);
  }
}

async function rawFetch<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("NETWORK", "تعذر الاتصال بالخادم، تحقق من الاتصال بالإنترنت");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(e?.code ?? "INTERNAL", e?.message ?? "حدث خطأ غير متوقع", e?.fields ?? {}, res.status);
  }
  return json?.data as T;
}

type ApiFn = <T = unknown>(method: string, url: string, body?: unknown) => Promise<T>;
const ApiContext = createContext<ApiFn | null>(null);

/**
 * مزوّد استدعاءات API: عند طلب الخادم إعادة التحقق (REAUTH_REQUIRED) يعرض نافذة كلمة المرور
 * ثم يعيد المحاولة تلقائيًا. عند انتهاء الجلسة يعيد التوجيه لصفحة الدخول.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const askPassword = () =>
    new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject };
      setOpen(true);
    });

  const call: ApiFn = useCallback(async (method, url, body) => {
    try {
      return await rawFetch(method, url, body);
    } catch (e) {
      if (e instanceof ApiError && e.code === "REAUTH_REQUIRED") {
        await askPassword();
        return rawFetch(method, url, body);
      }
      if (e instanceof ApiError && e.code === "UNAUTHENTICATED" && !url.includes("/auth/")) {
        window.location.href = "/login";
      }
      if (e instanceof ApiError && e.code === "PASSWORD_CHANGE_REQUIRED") {
        window.location.href = "/change-password";
      }
      throw e;
    }
  }, []);

  return (
    <ApiContext.Provider value={call}>
      {children}
      <ReauthDialog
        open={open}
        onDone={() => {
          setOpen(false);
          pending.current?.resolve();
        }}
        onCancel={() => {
          setOpen(false);
          pending.current?.reject(new ApiError("CANCELLED", "أُلغيت العملية"));
        }}
      />
    </ApiContext.Provider>
  );
}

export function useApi(): ApiFn {
  const ctx = useContext(ApiContext);
  return ctx ?? rawFetch;
}

function ReauthDialog({ open, onDone, onCancel }: { open: boolean; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await rawFetch("POST", "/api/v1/auth/reauth", { password });
      setPassword("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر التحقق");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onCancel} title="تأكيد كلمة المرور">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">هذه عملية حساسة. أدخل كلمة المرور للمتابعة.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="كلمة المرور" htmlFor="reauth-pw">
          <Input id="reauth-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>إلغاء</Button>
          <Button type="submit" loading={busy}>تأكيد</Button>
        </div>
      </form>
    </Modal>
  );
}

/** حالة نموذج بسيطة مع أخطاء الحقول القادمة من الخادم. */
export function useFormSubmit<T>(fn: () => Promise<T>, onSuccess?: (r: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    try {
      const r = await fn();
      onSuccess?.(r);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "CANCELLED") return;
        setFields(err.fields);
      }
      setError(err instanceof Error ? err.message : "حدث خطأ");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, fields, submit, setError };
}
