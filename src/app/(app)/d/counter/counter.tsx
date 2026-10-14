"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Banknote, CheckCircle2, PackageCheck, PackageOpen, Search } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from "@/components/ui";
import { Modal } from "@/components/modal";
import { IdCamera } from "@/components/id-camera";
import { ApiError, useApi } from "@/components/api-client";
import { CylinderStatusBadge } from "@/components/cylinder-status";
import { PaymentDialog } from "@/components/payment-dialog";
import { formatMoney, isolate } from "@/lib/format";
import { isValidNationalId } from "@/lib/national-id";

type Cyl = { id: string; label: string; status: "EMPTY" | "FILLED" | "DELIVERED" | "VOID" };
type Ent = {
  id: string; cycle: { id: string; name: string; status: string }; status: string; citizenNumber: string; quantity: number;
  amountDue: string; cylinders: Cyl[]; remaining: number; canReceive: boolean;
  paid: string; amountRemaining: string; canPay: boolean;
};
type Lookup = { found: false; nationalId: string } | { found: true; nationalId: string; citizen: { id: string; fullName: string; phone: string | null }; totalRemaining: string; entitlements: Ent[] };
type Method = "MANUAL_ENTRY" | "ID_SCAN";

/**
 * معرّف عملية ثابت لكل محاولة: إن انقطع الاتصال وأعاد المستخدم الضغط، يُرسل المعرّف نفسه
 * فلا تُنفذ العملية مرتين. يتجدد المعرّف بعد النجاح فقط.
 */
function useOpKey() {
  const ref = useRef<Record<string, string>>({});
  return {
    get: (slot: string) => (ref.current[slot] ??= crypto.randomUUID()),
    reset: (slot: string) => delete ref.current[slot],
  };
}

export function Counter() {
  const api = useApi();
  const keys = useOpKey();
  const [nid, setNid] = useState("");
  const [method, setMethod] = useState<Method>("MANUAL_ENTRY");
  const [data, setData] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [deliverFor, setDeliverFor] = useState<Cyl | null>(null);
  const [payFor, setPayFor] = useState<Ent | null>(null);

  const lookup = async (id = nid) => {
    setError("");
    setDone("");
    setBusy("lookup");
    try {
      setData(await api<Lookup>("GET", `/api/v1/counter/lookup?nationalId=${encodeURIComponent(id)}`));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "تعذر البحث");
    } finally {
      setBusy("");
    }
  };

  const run = async (slot: string, fn: (key: string) => Promise<unknown>, success: string) => {
    setError("");
    setDone("");
    setBusy(slot);
    try {
      await fn(keys.get(slot));
      keys.reset(slot);
      setDone(success);
      await lookup(data?.nationalId ?? nid);
      setDone(success);
    } catch (e) {
      // خطأ نهائي من الخادم: معرّف جديد للمحاولة التالية. خطأ شبكة: يبقى المعرّف لإعادة آمنة.
      if (!(e instanceof ApiError && e.code === "NETWORK")) keys.reset(slot);
      setError(e instanceof Error ? e.message : "تعذر تنفيذ العملية");
      if (e instanceof ApiError && e.code === "IDENTITY_MISMATCH") setData(null);
    } finally {
      setBusy("");
    }
  };

  const receive = (e: Ent) =>
    run(`receive-${e.id}`, (k) => api("POST", "/api/v1/operations/receive-empty", { clientOpId: k, entitlementId: e.id, nationalId: data?.nationalId, identityMethod: method }), "سُجل استلام الجرة الفارغة. اكتب رقمها على الجرة.");

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMethod("MANUAL_ENTRY");
            lookup();
          }}
        >
          <Input
            dir="ltr"
            inputMode="numeric"
            value={nid}
            onChange={(e) => setNid(e.target.value.replace(/\D/g, "").slice(0, 9))}
            placeholder="رقم الهوية من البطاقة"
            className="w-full min-w-0 basis-full text-center text-lg tracking-widest sm:basis-auto sm:flex-1"
            aria-label="رقم الهوية"
            autoFocus
          />
          <Button type="submit" loading={busy === "lookup"} disabled={nid.length !== 9}><Search className="size-4" /> بحث</Button>
          <IdCamera onConfirm={(id, m) => { setNid(id); setMethod(m); lookup(id); }} />
        </form>
        {nid.length === 9 && !isValidNationalId(nid) && <p className="mt-2 text-xs text-danger">رقم الهوية غير صالح (رقم التحقق لا يطابق)</p>}
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success"><CheckCircle2 className="me-1 inline size-4" />{done}</Alert>}

      {data && !data.found && (
        <EmptyState>
          لا يوجد مواطن بهذا الرقم في الكشوف المعتمدة.{" "}
          <Link className="text-primary hover:underline" href={`/d/review-cases?new=1&nationalId=${data.nationalId}`}>تسجيل حالة للمراجعة</Link>
        </EmptyState>
      )}

      {data?.found && (
        <>
          <Card title={data.citizen.fullName} actions={<Link href={`/d/citizens/${data.citizen.id}`} className="text-sm text-primary hover:underline">ملف المواطن</Link>}>
            <Alert tone="warning">تأكد أن صورة البطاقة تطابق الشخص الحاضر قبل أي عملية.</Alert>
            <div className="mt-2 text-sm text-muted">الهوية: <bdi>{data.nationalId}</bdi>{data.citizen.phone && <> · الهاتف: <bdi>{data.citizen.phone}</bdi></>}</div>
            <div className="mt-1 text-sm">إجمالي المتبقي عبر الدورات: <strong>{formatMoney(data.totalRemaining)}</strong></div>
          </Card>
          {data.entitlements.length === 0 && <EmptyState>لا يوجد استحقاق في الدورة النشطة ولا جرار معلقة لهذا المواطن.</EmptyState>}
          {data.entitlements.map((e) => (
            <Card
              key={e.id}
              title={<span>{e.cycle.name} — رقم المواطن <bdi className="text-primary">{e.citizenNumber}</bdi></span>}
              actions={
                <span className="flex gap-1">
                  {e.cycle.status !== "OPEN" && <Badge>دورة مغلقة</Badge>}
                  {e.status !== "ACTIVE" && <Badge tone="danger">أُزيل من الكشف</Badge>}
                </span>
              }
            >
              <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                <span>المستحق: {e.quantity} جرة</span>
                <span>لم تُستلم بعد: {e.remaining}</span>
                <span>المطلوب: {formatMoney(e.amountDue)}</span>
                <span>المدفوع: {formatMoney(e.paid)}</span>
                <span className={Number(e.amountRemaining) > 0 ? "font-semibold text-warning" : "text-success"}>المتبقي: {formatMoney(e.amountRemaining)}</span>
              </div>
              {e.cylinders.length > 0 && (
                <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
                  {e.cylinders.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="text-lg font-bold"><bdi>{c.label}</bdi></span>
                        <CylinderStatusBadge status={c.status} />
                      </span>
                      {c.status === "FILLED" && (
                        <Button size="sm" onClick={() => setDeliverFor(c)}><PackageCheck className="size-4" /> تسليم</Button>
                      )}
                      {c.status !== "FILLED" && <Link href={`/d/cylinders/${c.id}`} className="text-xs text-primary hover:underline">السجل</Link>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {e.canReceive && (
                  <Button variant="secondary" loading={busy === `receive-${e.id}`} onClick={() => receive(e)}>
                    <PackageOpen className="size-4" /> استلام جرة فارغة {e.quantity > 1 && `(${e.quantity - e.remaining + 1} من ${e.quantity})`}
                  </Button>
                )}
                {e.canPay && (
                  <Button variant="secondary" onClick={() => { setDone(""); setError(""); setPayFor(e); }}>
                    <Banknote className="size-4" /> تحصيل
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </>
      )}

      {payFor && data?.found && (
        <PaymentDialog
          entitlementId={payFor.id}
          title={`${data.citizen.fullName} — ${payFor.cycle.name}`}
          remaining={payFor.amountRemaining}
          onClose={() => setPayFor(null)}
          onDone={async (msg) => {
            setPayFor(null);
            await lookup(data.nationalId);
            setDone(msg);
          }}
        />
      )}

      {deliverFor && data?.found && (
        <DeliverDialog
          cylinder={deliverFor}
          busy={busy === `deliver-${deliverFor.id}`}
          onClose={() => setDeliverFor(null)}
          onConfirm={(label) => {
            const c = deliverFor;
            setDeliverFor(null);
            run(`deliver-${c.id}`, (k) => api("POST", "/api/v1/operations/deliver", { clientOpId: k, cylinderId: c.id, cylinderLabel: label, nationalId: data.nationalId, identityMethod: method }), `سُلّمت الجرة ${isolate(c.label)}.`);
          }}
        />
      )}
    </div>
  );
}

function DeliverDialog({ cylinder, busy, onClose, onConfirm }: { cylinder: Cyl; busy: boolean; onClose: () => void; onConfirm: (label: string) => void }) {
  const [label, setLabel] = useState("");
  return (
    <Modal open onClose={onClose} title="تسليم جرة معبأة">
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(label); }} className="space-y-4">
        <Alert>اقرأ الرقم المكتوب على الجرة نفسها واكتبه هنا. يجب أن يطابق رقمها في النظام.</Alert>
        <Field label="الرقم المكتوب على الجرة" htmlFor="dl-label">
          <Input id="dl-label" dir="ltr" inputMode="numeric" className="text-center text-lg" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus required />
        </Field>
        <p className="text-xs text-muted">التسليم مستقل عن الدفع.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={busy}>تأكيد التسليم</Button>
        </div>
      </form>
    </Modal>
  );
}
