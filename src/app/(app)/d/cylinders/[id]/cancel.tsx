"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Textarea } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

export function CancelOperation({ operationId, label }: { operationId: string; label: string }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const run = useFormSubmit(() => api("POST", `/api/v1/operations/${operationId}/cancel`, { reason }), () => {
    setOpen(false);
    router.refresh();
  });
  return (
    <Card title="تصحيح">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>إلغاء آخر عملية ({label})</Button>
      ) : (
        <form onSubmit={run.submit} className="space-y-3">
          {run.error && <Alert tone="danger">{run.error}</Alert>}
          <Alert tone="warning">الإلغاء يعكس أثر العملية على المخزون مرة واحدة ويبقى في السجل. استخدمه لتصحيح عملية سُجلت بالخطأ فقط.</Alert>
          <Field label="سبب الإلغاء" htmlFor="op-reason" error={run.fields.reason}>
            <Textarea id="op-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={run.busy}>تأكيد الإلغاء</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>رجوع</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
