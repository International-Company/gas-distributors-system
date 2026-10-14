"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Textarea } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

export function CancelShipment({ id }: { id: string }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const run = useFormSubmit(() => api("POST", `/api/v1/shipments/${id}/cancel`, { reason }), () => router.refresh());
  return (
    <Card title="تصحيح">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>إلغاء النقلة</Button>
      ) : (
        <form onSubmit={run.submit} className="space-y-3">
          {run.error && <Alert tone="danger">{run.error}</Alert>}
          <Alert tone="warning">تُلغى تعبئة كل جرار النقلة (تعود فارغة) وتُعكس الكمية الإضافية مرة واحدة. يُرفض الإلغاء إن سُلّمت أي جرة منها.</Alert>
          <Field label="سبب الإلغاء" htmlFor="sh-reason" error={run.fields.reason}>
            <Textarea id="sh-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
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
