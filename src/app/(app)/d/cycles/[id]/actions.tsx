"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi, useFormSubmit } from "@/components/api-client";

type Kind = "close" | "reopen" | "price";
const TITLES: Record<Kind, string> = { close: "إغلاق الدورة", reopen: "إعادة فتح الدورة", price: "تعديل سعر الجرة" };

export function CycleActions({ cycle, pendingStatements }: { cycle: { id: string; status: string; unitPrice: string }; pendingStatements: number }) {
  const api = useApi();
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [unitPrice, setUnitPrice] = useState(cycle.unitPrice);
  const [confirm, setConfirm] = useState(false);
  const run = useFormSubmit(
    () => api("POST", `/api/v1/cycles/${cycle.id}/actions`, kind === "close" ? { action: "close", confirm } : kind === "reopen" ? { action: "reopen", reason } : { action: "price", unitPrice, reason }),
    () => {
      setKind(null);
      setReason("");
      setConfirm(false);
      router.refresh();
    },
  );
  const open = cycle.status === "OPEN";
  return (
    <Card title="إجراءات">
      <div className="flex flex-wrap gap-2">
        {open && <Button variant="secondary" onClick={() => setKind("price")}>تعديل السعر</Button>}
        {open && <Button variant="danger" onClick={() => setKind("close")}>إغلاق الدورة</Button>}
        {!open && <Button onClick={() => setKind("reopen")}>إعادة فتح الدورة</Button>}
      </div>
      {kind && (
        <Modal open onClose={() => setKind(null)} title={TITLES[kind]}>
          <form onSubmit={run.submit} className="space-y-4">
            {run.error && <Alert tone="danger">{run.error}</Alert>}
            {kind === "close" && (
              <>
                {pendingStatements > 0 && <Alert tone="warning">في الدورة {pendingStatements} كشف قيد المراجعة؛ اعتمده أو ألغه أولًا.</Alert>}
                <Alert>الإغلاق يمنع اعتماد كشوف جديدة في هذه الدورة. لا يصفّر الأرصدة ولا يعني سداد المستحقات، ويمكن إعادة الفتح لاحقًا بسبب مكتوب.</Alert>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> راجعت ملخص الدورة وأؤكد الإغلاق
                </label>
              </>
            )}
            {kind === "price" && (
              <>
                <Alert tone="warning">السعر الجديد يسري على الكشوف التي تُعتمد بعده فقط. المبالغ المعتمدة سابقًا لا تتغير.</Alert>
                <Field label="السعر الجديد" htmlFor="cy-price" error={run.fields.unitPrice}>
                  <Input id="cy-price" dir="ltr" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
                </Field>
              </>
            )}
            {(kind === "reopen" || kind === "price") && (
              <Field label="السبب" htmlFor="cy-reason" error={run.fields.reason}>
                <Textarea id="cy-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setKind(null)}>إلغاء</Button>
              <Button type="submit" loading={run.busy} disabled={kind === "close" && !confirm}>تأكيد</Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}
