"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi, useFormSubmit } from "@/components/api-client";
import { CancelRecordButton, PaymentDialog } from "@/components/payment-dialog";

export function CitizenActions({ citizenId, archived }: { citizenId: string; archived: boolean }) {
  const api = useApi();
  const router = useRouter();
  const run = useFormSubmit(() => api("POST", `/api/v1/citizens/${citizenId}/archive`, { archived: !archived }), () => router.refresh());
  return (
    <Card title="الأرشفة">
      {run.error && <Alert tone="danger" className="mb-3">{run.error}</Alert>}
      <p className="mb-3 text-sm text-muted">الأرشفة تخفي المواطن من البحث الافتراضي فقط، ولا تحذف بياناته أو عملياته.</p>
      <Button variant="secondary" loading={run.busy} onClick={() => run.submit()}>{archived ? "استعادة من الأرشيف" : "أرشفة"}</Button>
    </Card>
  );
}

type E = { id: string; citizenNumber: string; quantity: number; amountDue: string; nameInStatement: string };

export function EditEntitlement({ entitlement }: { entitlement: E }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ citizenNumber: entitlement.citizenNumber, quantity: String(entitlement.quantity), amountDue: entitlement.amountDue, nameInStatement: entitlement.nameInStatement, reason: "" });
  const run = useFormSubmit(
    () => {
      const body: Record<string, unknown> = { reason: v.reason };
      if (v.citizenNumber !== entitlement.citizenNumber) body.citizenNumber = v.citizenNumber;
      if (v.quantity !== String(entitlement.quantity)) body.quantity = Number(v.quantity);
      if (v.amountDue !== entitlement.amountDue) body.amountDue = v.amountDue;
      if (v.nameInStatement !== entitlement.nameInStatement) body.nameInStatement = v.nameInStatement;
      return api("PATCH", `/api/v1/entitlements/${entitlement.id}`, body);
    },
    () => {
      setOpen(false);
      router.refresh();
    },
  );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="تعديل الاستحقاق"><Pencil className="size-4" /></Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="تعديل استحقاق معتمد">
          <form onSubmit={run.submit} className="space-y-3">
            {run.error && <Alert tone="danger">{run.error}</Alert>}
            <Alert tone="warning">التعديل يُسجل بقيمه القديمة والجديدة وسببه. استخدمه لتصحيح خطأ ثابت فقط؛ التحديثات الرسمية تتم باستيراد إصدار جديد من الكشف.</Alert>
            <Field label="رقم المواطن" htmlFor="e-num" error={run.fields.citizenNumber}><Input id="e-num" dir="ltr" value={v.citizenNumber} onChange={set("citizenNumber")} /></Field>
            <Field label="عدد الجرار" htmlFor="e-qty" error={run.fields.quantity}><Input id="e-qty" dir="ltr" inputMode="numeric" value={v.quantity} onChange={set("quantity")} /></Field>
            <Field label="المبلغ المطلوب" htmlFor="e-amt" error={run.fields.amountDue}><Input id="e-amt" dir="ltr" inputMode="decimal" value={v.amountDue} onChange={set("amountDue")} /></Field>
            <Field label="الاسم كما في الكشف" htmlFor="e-name"><Input id="e-name" value={v.nameInStatement} onChange={set("nameInStatement")} /></Field>
            <Field label="سبب التعديل" htmlFor="e-reason" error={run.fields.reason}><Textarea id="e-reason" value={v.reason} onChange={set("reason")} required /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button type="submit" loading={run.busy}>حفظ</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function PayButton({ entitlementId, title, remaining }: { entitlementId: string; title: string; remaining: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>تحصيل</Button>
      {msg && <span className="ms-2 text-xs text-success">{msg}</span>}
      {open && (
        <PaymentDialog
          entitlementId={entitlementId}
          title={title}
          remaining={remaining}
          onClose={() => setOpen(false)}
          onDone={(m) => {
            setOpen(false);
            setMsg(m);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

export function CancelPayment({ id }: { id: string }) {
  const router = useRouter();
  return <CancelRecordButton url={`/api/v1/payments/${id}/cancel`} onDone={() => router.refresh()} />;
}
