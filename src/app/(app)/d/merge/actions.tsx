"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi, useFormSubmit } from "@/components/api-client";

type C = { id: string; label: string };

export function MergeActions({ a, b }: { a: C; b: C }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [primary, setPrimary] = useState(a.id);
  const [reason, setReason] = useState("");
  const merge = useFormSubmit(
    () => api("POST", "/api/v1/citizens/merge", { primaryId: primary, secondaryId: primary === a.id ? b.id : a.id, reason }),
    () => {
      setOpen(false);
      router.refresh();
    },
  );
  const dismiss = useFormSubmit(() => api("POST", "/api/v1/citizens/merge-suggestions", { citizenAId: a.id, citizenBId: b.id }), () => router.refresh());
  return (
    <div className="mt-4">
      {dismiss.error && <Alert tone="danger" className="mb-2">{dismiss.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)}>دمج السجلين</Button>
        <Button variant="ghost" loading={dismiss.busy} onClick={() => dismiss.submit()}>ليسا الشخص نفسه</Button>
      </div>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="دمج سجلين">
          <form onSubmit={merge.submit} className="space-y-4">
            {merge.error && <Alert tone="danger">{merge.error}</Alert>}
            <Alert tone="warning">تنتقل استحقاقات السجل الثانوي إلى الأساسي دون جمع كميات، ويبقى الثانوي محفوظًا ومربوطًا بالأساسي. لا يمكن التراجع من الواجهة.</Alert>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">السجل الأساسي (رقم الهوية الصحيح)</legend>
              {[a, b].map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="primary" checked={primary === c.id} onChange={() => setPrimary(c.id)} /> {c.label}
                </label>
              ))}
            </fieldset>
            <Field label="سبب الدمج وطريقة التحقق" htmlFor="mg-reason" error={merge.fields.reason}>
              <Textarea id="mg-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button type="submit" loading={merge.busy}>دمج</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
