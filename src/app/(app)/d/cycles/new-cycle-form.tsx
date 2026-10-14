"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

export function NewCycleForm({ currencySymbol }: { currencySymbol: string }) {
  const api = useApi();
  const router = useRouter();
  const [name, setName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const { busy, error, fields, submit } = useFormSubmit(
    () => api<{ id: string }>("POST", "/api/v1/cycles", { name: name || undefined, unitPrice }),
    (c) => router.push(`/d/cycles/${c.id}`),
  );
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
      {error && <Alert tone="danger" className="sm:col-span-3">{error}</Alert>}
      <Field label="اسم الدورة (اختياري)" htmlFor="c-name" hint="يُسمى تلقائيًا «الدورة n» إن تُرك فارغًا">
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={`سعر الجرة (${currencySymbol})`} htmlFor="c-price" error={fields.unitPrice} hint="يُحفظ لهذه الدورة؛ تغييره لاحقًا لا يغيّر المبالغ المعتمدة">
        <Input id="c-price" dir="ltr" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
      </Field>
      <div className="flex items-end">
        <Button type="submit" loading={busy}>بدء الدورة</Button>
      </div>
    </form>
  );
}
