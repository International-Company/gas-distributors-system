"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { ApiError, useApi, useFormSubmit } from "@/components/api-client";

export function StationPaymentForm({ stationId }: { stationId: string }) {
  const api = useApi();
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [v, setV] = useState({ amount: "", reference: "", notes: "", paidAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDone("");
    key.current ??= crypto.randomUUID();
    try {
      await api("POST", "/api/v1/station-payments", { clientOpId: key.current, stationId, ...v, paidAt: v.paidAt ? new Date(v.paidAt).toISOString() : undefined });
      key.current = null;
      setV({ amount: "", reference: "", notes: "", paidAt: "" });
      setDone("سُجلت الدفعة.");
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "NETWORK")) key.current = null;
      setError(err instanceof Error ? err.message : "تعذر تسجيل الدفعة");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="تسجيل دفعة للمحطة">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        {done && <Alert tone="success" className="sm:col-span-2">{done}</Alert>}
        <Field label="المبلغ" htmlFor="sp-amount"><Input id="sp-amount" dir="ltr" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} required /></Field>
        <Field label="التاريخ" htmlFor="sp-at" hint="الآن إن تُرك فارغًا"><Input id="sp-at" type="datetime-local" value={v.paidAt} onChange={(e) => setV({ ...v, paidAt: e.target.value })} /></Field>
        <Field label="المرجع (اختياري)" htmlFor="sp-ref"><Input id="sp-ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
        <Field label="ملاحظات (اختياري)" htmlFor="sp-notes"><Input id="sp-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Button type="submit" loading={busy}>تسجيل الدفعة</Button></div>
      </form>
    </Card>
  );
}

export function StationPriceForm({ stationId, price }: { stationId: string; price: string }) {
  const api = useApi();
  const router = useRouter();
  const [v, setV] = useState(price);
  const [saved, setSaved] = useState(false);
  const run = useFormSubmit(() => api("PATCH", `/api/v1/stations/${stationId}`, { defaultUnitPrice: v || null }), () => {
    setSaved(true);
    router.refresh();
  });
  return (
    <Card title="سعر شراء الجرة الافتراضي">
      <form onSubmit={run.submit} className="space-y-3">
        {run.error && <Alert tone="danger">{run.error}</Alert>}
        {saved && <Alert tone="success">حُفظ السعر.</Alert>}
        <Alert>يُقترح هذا السعر عند تسجيل شحنة جديدة. تغييره لا يغيّر قيمة الشحنات المسجلة سابقًا.</Alert>
        <Field label="السعر" htmlFor="sp-price" error={run.fields.defaultUnitPrice}><Input id="sp-price" dir="ltr" inputMode="decimal" value={v} onChange={(e) => { setSaved(false); setV(e.target.value); }} /></Field>
        <Button type="submit" variant="secondary" loading={run.busy}>حفظ</Button>
      </form>
    </Card>
  );
}
