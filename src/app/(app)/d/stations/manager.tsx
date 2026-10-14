"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

type S = { id: string; name: string; phone: string | null; notes: string | null; active: boolean; shipments: number };

export function StationsManager({ rows }: { rows: S[] }) {
  const api = useApi();
  const router = useRouter();
  const [v, setV] = useState({ name: "", phone: "", notes: "" });
  const create = useFormSubmit(() => api("POST", "/api/v1/stations", v), () => {
    setV({ name: "", phone: "", notes: "" });
    router.refresh();
  });
  const [rowError, setRowError] = useState("");
  const toggle = async (s: S) => {
    setRowError("");
    try {
      await api("PATCH", `/api/v1/stations/${s.id}`, { active: !s.active });
      router.refresh();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "تعذر التعديل");
    }
  };
  return (
    <>
      <Card title="إضافة محطة">
        <form onSubmit={create.submit} className="grid gap-3 sm:grid-cols-3">
          {create.error && <Alert tone="danger" className="sm:col-span-3">{create.error}</Alert>}
          <Field label="الاسم" htmlFor="st-name" error={create.fields.name}><Input id="st-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
          <Field label="الهاتف" htmlFor="st-phone"><Input id="st-phone" dir="ltr" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
          <Field label="ملاحظات" htmlFor="st-notes"><Input id="st-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
          <div><Button type="submit" loading={create.busy}>إضافة</Button></div>
        </form>
      </Card>
      {rowError && <Alert tone="danger">{rowError}</Alert>}
      {rows.length === 0 ? (
        <EmptyState>لا توجد محطات.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="text-sm">
                <div className="font-semibold">{s.name} {!s.active && <Badge>غير نشطة</Badge>}</div>
                <div className="text-xs text-muted">{s.phone && <bdi>{s.phone}</bdi>} {s.notes && `· ${s.notes}`} · {s.shipments} شحنة</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.active ? "تعطيل" : "تفعيل"}</Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
