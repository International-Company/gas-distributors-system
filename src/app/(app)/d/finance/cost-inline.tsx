"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { useApi } from "@/components/api-client";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { normalizeDigits } from "@/lib/arabic";

const clean = (v: string) => normalizeDigits(v).trim().replace(/[٫,]/g, ".");
const valid = (v: string) => /^\d{1,7}(\.\d{1,2})?$/.test(clean(v));

/** سعر الجرة على الموزّع في كشف، يُكتب أو يُعدَّل من صفحة الفلوس مباشرة. */
export function CostInline({ statementId, cost, currency }: { statementId: string; cost: string | null; currency: string }) {
  const api = useApi();
  const router = useRouter();
  const [editing, setEditing] = useState(!cost);
  const [v, setV] = useState(cost ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = `cost-${statementId}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid(v)) return setError("اكتب سعرًا صحيحًا");
    setBusy(true);
    setError("");
    try {
      await api("PUT", `/api/v1/statements/${statementId}/cost`, { costPrice: clean(v) });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="group flex items-center gap-1 font-bold tabular-nums" aria-label="تعديل سعر الجرة على الموزّع">
        {formatMoney(cost, currency)}
        <Pencil className="size-3 text-muted group-hover:text-primary" />
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex items-center gap-1">
      <input
        id={id}
        dir="ltr"
        inputMode="decimal"
        value={v}
        onChange={(e) => { setV(e.target.value); setError(""); }}
        placeholder="0.00"
        aria-label="سعر الجرة على الموزّع"
        aria-invalid={Boolean(error)}
        title={error || undefined}
        className={cn("h-8 w-20 rounded-lg border bg-surface px-2 text-center text-sm font-bold tabular-nums", error ? "border-danger" : "border-border")}
        autoFocus={Boolean(cost)}
      />
      <button type="submit" disabled={busy} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-contrast disabled:opacity-50" aria-label="حفظ سعر الموزّع">
        <Check className="size-4" />
      </button>
      {cost && (
        <button type="button" onClick={() => { setEditing(false); setV(cost); setError(""); }} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2" aria-label="رجوع">
          <X className="size-4" />
        </button>
      )}
    </form>
  );
}
