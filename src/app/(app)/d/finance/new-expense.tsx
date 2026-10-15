"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { ApiError, useApi } from "@/components/api-client";
import { DateInput } from "@/components/date-input";

export function NewExpense() {
  const api = useApi();
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [v, setV] = useState({ amount: "", description: "", spentAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    key.current ??= crypto.randomUUID();
    try {
      await api("POST", "/api/v1/expenses", { clientOpId: key.current, amount: v.amount, description: v.description, spentAt: v.spentAt ? new Date(v.spentAt).toISOString() : undefined });
      key.current = null;
      setV({ amount: "", description: "", spentAt: "" });
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "NETWORK")) key.current = null;
      if (err instanceof ApiError) setFields(err.fields);
      setError(err instanceof Error ? err.message : "تعذر تسجيل المصروف");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="تسجيل مصروف">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        {error && <Alert tone="danger" className="sm:col-span-4">{error}</Alert>}
        <Field label="المبلغ" htmlFor="ex-amount" error={fields.amount}><Input id="ex-amount" dir="ltr" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} required /></Field>
        <Field label="الوصف" htmlFor="ex-desc" error={fields.description} className="sm:col-span-2"><Input id="ex-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="مثل: دفعة للمحطة، أجرة نقل، عمال" required /></Field>
        <Field label="التاريخ" htmlFor="ex-at" hint="الآن إن تُرك فارغًا" error={fields.spentAt}><DateInput id="ex-at" withTime value={v.spentAt} onChange={(x) => setV({ ...v, spentAt: x })} placeholder="الآن" /></Field>
        <div className="sm:col-span-4"><Button type="submit" loading={busy}>تسجيل</Button></div>
      </form>
    </Card>
  );
}
