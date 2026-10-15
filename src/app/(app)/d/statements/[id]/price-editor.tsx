"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Tag } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { useApi } from "@/components/api-client";
import { formatMoney } from "@/lib/format";
import { normalizeDigits } from "@/lib/arabic";

type Props = { statementId: string; price: string | null; currency: string; cylinders: number; total: string; editable: boolean };

/** سعر الجرة في الكشف والمجموع المطلوب، مع تعديل السعر قبل الاعتماد (يُعاد حساب المطلوب فورًا). */
export function PriceEditor({ statementId, price, currency, cylinders, total, editable }: Props) {
  const api = useApi();
  const router = useRouter();
  const [editing, setEditing] = useState(editable && !price);
  const [v, setV] = useState(price ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("PATCH", `/api/v1/statements/${statementId}`, { unitPrice: normalizeDigits(v).trim().replace(/[٫,]/g, ".") });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ السعر");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-primary-soft/60 p-3">
      {error && <Alert tone="danger" className="mb-2">{error}</Alert>}
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <Tag className="size-4 text-primary" />
          <label htmlFor="st-price-edit" className="text-sm font-semibold">سعر الجرة في هذا الكشف</label>
          <input
            id="st-price-edit"
            dir="ltr"
            inputMode="decimal"
            value={v}
            onChange={(e) => setV(e.target.value)}
            className="h-9 w-28 rounded-lg border border-border bg-surface px-2 text-center font-bold tabular-nums"
            autoFocus
            required
          />
          <span className="text-sm text-muted">{currency}</span>
          <Button size="sm" type="submit" loading={busy}>حفظ</Button>
          {price && <Button size="sm" type="button" variant="ghost" onClick={() => { setEditing(false); setV(price); }}>رجوع</Button>}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5">
            <Tag className="size-4 text-primary" />
            سعر الجرة <strong className="tabular-nums">{price ? formatMoney(price, currency) : "—"}</strong>
          </span>
          <span className="text-muted">{cylinders} جرة</span>
          <span>المجموع المطلوب <strong className="tabular-nums">{formatMoney(total, currency)}</strong></span>
          {editable && (
            <button type="button" onClick={() => setEditing(true)} className="ms-auto flex items-center gap-1 text-primary hover:underline">
              <Pencil className="size-3.5" /> تعديل السعر
            </button>
          )}
        </div>
      )}
    </div>
  );
}
