"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";
import { formatMoney } from "@/lib/format";

type S = {
  id: string; name: string; phone: string | null; notes: string | null; active: boolean; shipments: number;
  defaultUnitPrice: string | null; value: string; paid: string; remaining: string;
};

export function StationsManager({ rows }: { rows: S[] }) {
  const api = useApi();
  const router = useRouter();
  const [v, setV] = useState({ name: "", phone: "", notes: "", defaultUnitPrice: "" });
  const create = useFormSubmit(() => api("POST", "/api/v1/stations", v), () => {
    setV({ name: "", phone: "", notes: "", defaultUnitPrice: "" });
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
        <form onSubmit={create.submit} className="grid gap-3 sm:grid-cols-4">
          {create.error && <Alert tone="danger" className="sm:col-span-4">{create.error}</Alert>}
          <Field label="الاسم" htmlFor="st-name" error={create.fields.name}><Input id="st-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
          <Field label="سعر شراء الجرة الافتراضي" htmlFor="st-price" error={create.fields.defaultUnitPrice} hint="يُقترح عند تسجيل الشحنة"><Input id="st-price" dir="ltr" inputMode="decimal" value={v.defaultUnitPrice} onChange={(e) => setV({ ...v, defaultUnitPrice: e.target.value })} /></Field>
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
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="text-sm">
                <Link href={`/d/stations/${s.id}`} className="font-semibold text-primary hover:underline">{s.name}</Link> {!s.active && <Badge>غير نشطة</Badge>}
                <div className="text-xs text-muted">
                  {s.defaultUnitPrice ? <>سعر الجرة: {formatMoney(s.defaultUnitPrice)}</> : "دون سعر افتراضي"} · {s.shipments} شحنة {s.phone && <>· <bdi>{s.phone}</bdi></>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span>القيمة: {formatMoney(s.value)}</span>
                <span>المدفوع: {formatMoney(s.paid)}</span>
                <strong className={Number(s.remaining) > 0 ? "text-warning" : Number(s.remaining) < 0 ? "text-primary" : "text-success"}>
                  {Number(s.remaining) < 0 ? <>دفع مقدم: {formatMoney(String(-Number(s.remaining)))}</> : <>المتبقي: {formatMoney(s.remaining)}</>}
                </strong>
                <Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.active ? "تعطيل" : "تفعيل"}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
