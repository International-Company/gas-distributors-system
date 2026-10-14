"use client";

import { useRef, useState } from "react";
import { Alert, Button, Field, Input, Textarea } from "./ui";
import { Modal } from "./modal";
import { ApiError, useApi } from "./api-client";
import { formatMoney } from "@/lib/format";

type Props = {
  entitlementId: string;
  title: string;
  remaining: string;
  onClose: () => void;
  onDone: (msg: string, tone?: "success" | "warning") => void;
  /** تنفيذ بديل (الشباك: عبر قائمة الجهاز ليعمل دون اتصال). يرجع رسالة النتيجة. */
  submitOverride?: (v: { full: boolean; amount?: string; notes: string }) => Promise<{ message: string; tone: "success" | "warning" }>;
};

/**
 * تسجيل تحصيل على استحقاق دورة: كامل المتبقي أو مبلغ جزئي.
 * معرّف العملية ثابت للمحاولة نفسها، فإعادة الإرسال بعد انقطاع لا تكرر التحصيل.
 */
export function PaymentDialog({ entitlementId, title, remaining, onClose, onDone, submitOverride }: Props) {
  const api = useApi();
  const key = useRef<string | null>(null);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    if (submitOverride) {
      try {
        const r = await submitOverride({ full: mode === "full", amount: mode === "partial" ? amount : undefined, notes });
        onDone(r.message, r.tone);
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر تسجيل التحصيل");
      } finally {
        setBusy(false);
      }
      return;
    }
    key.current ??= crypto.randomUUID();
    try {
      const r = await api<{ amount: string; remaining: string }>("POST", "/api/v1/payments", {
        clientOpId: key.current, entitlementId, full: mode === "full", amount: mode === "partial" ? amount : undefined, notes,
      });
      key.current = null;
      onDone(`سُجل تحصيل ${formatMoney(r.amount)}. المتبقي: ${formatMoney(r.remaining)}`);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "NETWORK")) key.current = null;
      setError(err instanceof Error ? err.message : "تعذر تسجيل التحصيل");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`تحصيل — ${title}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="rounded-lg bg-surface-2 p-3 text-sm">المتبقي على هذا الاستحقاق: <strong>{formatMoney(remaining)}</strong></div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1 text-sm">
          {(["full", "partial"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md py-2 ${mode === m ? "bg-surface font-semibold text-primary shadow-sm" : "text-muted"}`}>
              {m === "full" ? "سداد كامل المتبقي" : "دفعة جزئية"}
            </button>
          ))}
        </div>
        {mode === "partial" && (
          <Field label="المبلغ" htmlFor="pay-amount">
            <Input id="pay-amount" dir="ltr" inputMode="decimal" className="text-center text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
          </Field>
        )}
        <Field label="ملاحظة (اختياري)" htmlFor="pay-notes">
          <Textarea id="pay-notes" className="min-h-10" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">التحصيل مستقل عن عمليات الجرار ولا يغيّر حالتها.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={busy}>تسجيل التحصيل</Button>
        </div>
      </form>
    </Modal>
  );
}

/** إلغاء سجل مالي بسبب مكتوب (تحصيل، مصروف، دفعة محطة). */
export function CancelRecordButton({ url, label = "إلغاء", onDone }: { url: string; label?: string; onDone: () => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", url, { reason });
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر الإلغاء");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{label}</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="إلغاء سجل مالي">
          <form onSubmit={submit} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <Alert tone="warning">السجل لا يُحذف ولا يُعدّل: يُعلَّم «ملغى» مع السبب، ويُستبعد من الأرصدة مرة واحدة. للتصحيح سجّل قيدًا جديدًا صحيحًا.</Alert>
            <Field label="سبب الإلغاء" htmlFor="cr-reason"><Textarea id="cr-reason" value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>رجوع</Button>
              <Button type="submit" variant="danger" loading={busy}>تأكيد الإلغاء</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
