"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus } from "lucide-react";
import { Alert, Button, Field, Input, cn } from "@/components/ui";
import { Modal } from "@/components/modal";
import { ApiError, useApi } from "@/components/api-client";
import { DateInput } from "@/components/date-input";

const QUICK = ["دفعة للمحطة", "أجرة نقل", "عمال", "صيانة"];

/** زر «سجّل مصروف» ونافذته: المبلغ، والوصف باختيار سريع، والتاريخ (الآن إن تُرك فارغًا). */
export function NewExpense({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const api = useApi();
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [v, setV] = useState({ amount: "", description: "", spentAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const close = () => {
    setOpen(false);
    setError("");
    setFields({});
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    key.current ??= crypto.randomUUID();
    try {
      await api("POST", "/api/v1/expenses", { clientOpId: key.current, amount: v.amount, description: v.description, spentAt: v.spentAt ? new Date(v.spentAt).toISOString() : undefined });
      key.current = null;
      setV({ amount: "", description: "", spentAt: "" });
      close();
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "NETWORK")) key.current = null;
      if (err instanceof ApiError) setFields(err.fields);
      setError(err instanceof Error ? err.message : "تعذر تسجيل المصروف");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Minus className="size-4" /> سجّل مصروف</Button>
      {open && (
        <Modal open onClose={close} title="مصروف جديد">
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="المبلغ" htmlFor="ex-amount" error={fields.amount}>
              <Input id="ex-amount" dir="ltr" inputMode="decimal" className="text-center text-lg" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} required autoFocus />
            </Field>
            <Field label="على شو؟" htmlFor="ex-desc" error={fields.description}>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setV({ ...v, description: q })}
                    className={cn("rounded-full border px-3 py-1 text-sm", v.description === q ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <Input id="ex-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="أو اكتب الوصف" required />
            </Field>
            <Field label="التاريخ" htmlFor="ex-at" hint="الآن إن تُرك فارغًا" error={fields.spentAt}>
              <DateInput id="ex-at" withTime value={v.spentAt} onChange={(x) => setV({ ...v, spentAt: x })} placeholder="الآن" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>رجوع</Button>
              <Button type="submit" loading={busy}>تسجيل</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
