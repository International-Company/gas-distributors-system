"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Tag, TrendingUp } from "lucide-react";
import { Alert, Button, cn } from "@/components/ui";
import { useApi } from "@/components/api-client";
import { formatMoney } from "@/lib/format";
import { normalizeDigits } from "@/lib/arabic";

type Props = {
  statementId: string;
  /** سعر الجرة على المواطن. */
  price: string | null;
  /** سعر الجرة على الموزّع. */
  cost: string | null;
  currency: string;
  cylinders: number;
  total: string;
  /** سعر المواطن يُعدَّل قبل الاعتماد فقط. */
  editable: boolean;
  /** سعر الموزّع يُعدَّل قبل الاعتماد وبعده (لا يغيّر المطلوب من الناس). */
  costEditable: boolean;
};

const clean = (v: string) => normalizeDigits(v).trim().replace(/[٫,]/g, ".");

/** سعر الجرة على المواطن وعلى الموزّع في الكشف، والمجموع المطلوب، والربح المتوقع. */
export function PriceEditor({ statementId, price, cost, currency, cylinders, total, editable, costEditable }: Props) {
  const api = useApi();
  const router = useRouter();
  const [editing, setEditing] = useState<"" | "price" | "cost">(editable && !price ? "price" : "");
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const open = (which: "price" | "cost") => {
    setEditing(which);
    setV((which === "price" ? price : cost) ?? "");
    setError("");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editing === "price") await api("PATCH", `/api/v1/statements/${statementId}`, { unitPrice: clean(v) });
      else await api("PUT", `/api/v1/statements/${statementId}/cost`, { costPrice: clean(v) || null });
      setEditing("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ السعر");
    } finally {
      setBusy(false);
    }
  };

  const costTotal = cost ? Number(cost) * cylinders : null;
  const profit = costTotal !== null ? Number(total) - costTotal : null;

  return (
    <div className="space-y-2 rounded-xl bg-primary-soft/60 p-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <Tag className="size-4 text-primary" />
          <label htmlFor="st-price-edit" className="text-sm font-semibold">
            {editing === "price" ? "سعر الجرة على المواطن" : "سعر الجرة على الموزّع"}
          </label>
          <input
            id="st-price-edit"
            dir="ltr"
            inputMode="decimal"
            value={v}
            onChange={(e) => setV(e.target.value)}
            className="h-9 w-28 rounded-lg border border-border bg-surface px-2 text-center font-bold tabular-nums"
            autoFocus
            required={editing === "price"}
          />
          <span className="text-sm text-muted">{currency}</span>
          <Button size="sm" type="submit" loading={busy}>حفظ</Button>
          {(editing === "cost" || price) && <Button size="sm" type="button" variant="ghost" onClick={() => setEditing("")}>رجوع</Button>}
        </form>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <PriceBox label="على المواطن" value={price ? formatMoney(price, currency) : "—"} onEdit={editable ? () => open("price") : undefined} editId="st-price-btn" />
          <PriceBox
            label="على الموزّع"
            value={cost ? formatMoney(cost, currency) : "لم يُحدد"}
            muted={!cost}
            onEdit={costEditable ? () => open("cost") : undefined}
            editId="st-cost-btn"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted">{cylinders} جرة</span>
        <span>المجموع المطلوب <strong className="tabular-nums">{formatMoney(total, currency)}</strong></span>
        {profit !== null && (
          <span id="st-profit" className={cn("flex items-center gap-1", profit < 0 ? "text-danger" : "text-success")}>
            <TrendingUp className="size-4" />
            {profit < 0 ? "خسارة متوقعة" : "ربحك المتوقع"} <strong className="tabular-nums">{formatMoney(Math.abs(profit).toFixed(2), currency)}</strong>
          </span>
        )}
      </div>
    </div>
  );
}

function PriceBox({ label, value, muted, onEdit, editId }: { label: string; value: string; muted?: boolean; onEdit?: () => void; editId: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
      <span className="text-sm text-muted">{label}</span>
      <strong className={cn("tabular-nums", muted && "font-normal text-muted")}>{value}</strong>
      {onEdit && (
        <button type="button" id={editId} onClick={onEdit} className="ms-auto flex items-center gap-1 text-sm text-primary hover:underline">
          <Pencil className="size-3.5" /> تعديل
        </button>
      )}
    </div>
  );
}
