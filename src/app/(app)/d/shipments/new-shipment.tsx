"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError, useApi } from "@/components/api-client";
import { DateInput } from "@/components/date-input";

type Empty = { id: string; label: string; name: string; cycleName: string };

export function NewShipment({ stations, empties, emptiesTotal }: { stations: { id: string; name: string; defaultUnitPrice: string }[]; empties: Empty[]; emptiesTotal: number }) {
  const api = useApi();
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ stationId: stations[0]?.id ?? "", receivedAt: "", quantity: "", reference: "", notes: "", unitPrice: stations[0]?.defaultUnitPrice ?? "" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const visible = useMemo(() => empties.filter((e) => !filter || e.label.startsWith(filter) || e.name.includes(filter)), [empties, filter]);
  const qty = Number(v.quantity) || 0;
  const extra = qty - sel.size;

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickFirst = () => setSel(new Set(visible.slice(0, qty).map((e) => e.id)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    key.current ??= crypto.randomUUID();
    try {
      const r = await api<{ id: string }>("POST", "/api/v1/shipments", {
        clientOpId: key.current, stationId: v.stationId, quantity: qty, cylinderIds: [...sel], unitPrice: v.unitPrice,
        receivedAt: v.receivedAt ? new Date(v.receivedAt).toISOString() : undefined, reference: v.reference, notes: v.notes,
      });
      key.current = null;
      router.push(`/d/shipments/${r.id}`);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "NETWORK")) key.current = null;
      if (err instanceof ApiError) setFields(err.fields);
      setError(err instanceof Error ? err.message : "تعذر تسجيل الشحنة");
      setBusy(false);
    }
  };

  if (!stations.length) {
    return <Alert tone="warning">أضف محطة تعبئة أولًا من <Link className="underline" href="/d/stations">صفحة المحطات</Link>.</Alert>;
  }
  if (!open) return <Button onClick={() => setOpen(true)}><Truck className="size-4" /> تسجيل شحنة مستلمة</Button>;

  return (
    <Card title="تسجيل شحنة مستلمة">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="المحطة" htmlFor="sh-st"><Select id="sh-st" value={v.stationId} onChange={(e) => setV({ ...v, stationId: e.target.value, unitPrice: stations.find((s) => s.id === e.target.value)?.defaultUnitPrice ?? "" })}>{stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="عدد الجرار المستلمة" htmlFor="sh-q" error={fields.quantity}><Input id="sh-q" dir="ltr" inputMode="numeric" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value.replace(/\D/g, "") })} required /></Field>
          <Field label="سعر شراء الجرة من المحطة" htmlFor="sh-price" error={fields.unitPrice} hint="مقترح من سعر المحطة، ويمكن تعديله لهذه الشحنة"><Input id="sh-price" dir="ltr" inputMode="decimal" value={v.unitPrice} onChange={(e) => setV({ ...v, unitPrice: e.target.value })} required /></Field>
          <Field label="وقت الاستلام" htmlFor="sh-at" hint="الآن إن تُرك فارغًا"><DateInput id="sh-at" withTime value={v.receivedAt} onChange={(x) => setV({ ...v, receivedAt: x })} placeholder="الآن" /></Field>
          <Field label="المرجع (اختياري)" htmlFor="sh-ref"><Input id="sh-ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
          <Field label="ملاحظات (اختياري)" htmlFor="sh-notes" className="sm:col-span-2"><Textarea id="sh-notes" className="min-h-10" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        </div>

        <div className="rounded-lg border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <span className="text-sm font-medium">جرار المواطنين في الشحنة (الفارغة المستلمة سابقًا)</span>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="تصفية بالرقم أو الاسم" className="h-8 w-48" />
            <Button type="button" size="sm" variant="secondary" disabled={!qty} onClick={pickFirst}>تحديد أول {qty || "N"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSel(new Set())}>مسح</Button>
          </div>
          {empties.length === 0 ? (
            <p className="p-3 text-sm text-muted">لا توجد جرار فارغة مستلمة. ستُسجل كل الكمية إضافية.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {visible.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-surface-2">
                    <input type="checkbox" className="size-4" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                    <bdi dir="ltr" className="min-w-16 font-semibold">{c.label}</bdi>
                    <span className="flex-1">{c.name}</span>
                    <span className="text-xs text-muted">{c.cycleName}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {emptiesTotal > empties.length && <p className="p-2 text-xs text-muted">تُعرض أول {empties.length} من {emptiesTotal} جرة فارغة.</p>}
        </div>

        <div className={`rounded-lg p-3 text-sm ${extra < 0 ? "bg-danger-soft text-danger" : "bg-surface-2"}`}>
          المستلم {qty} = جرار مواطنين {sel.size} + كمية إضافية غير مرتبطة {Math.max(0, extra)}
          {extra < 0 && " — عدد المختار أكبر من المستلم"}
          {qty > 0 && Number(v.unitPrice) >= 0 && v.unitPrice !== "" && <div className="mt-1">قيمة الشحنة على حساب المحطة: {(qty * Number(v.unitPrice)).toFixed(2)} — الاستلام لا يعني الدفع.</div>}
        </div>
        <div className="flex gap-2">
          <Button type="submit" loading={busy} disabled={!qty || extra < 0 || !v.stationId}>تسجيل الشحنة</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
        </div>
      </form>
    </Card>
  );
}
