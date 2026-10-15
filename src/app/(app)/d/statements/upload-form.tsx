"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileUp, Loader2, RefreshCw, Tag } from "lucide-react";
import { Alert, cn } from "@/components/ui";
import { ApiError } from "@/components/api-client";
import { normalizeDigits } from "@/lib/arabic";

type Props = {
  /** الدورة النشطة إن وُجدت (وإلا تُنشأ تلقائيًا بسعر الكشف الأول). */
  activeCycleName: string | null;
  currencySymbol: string;
  /** السعر المقترح: سعر الكشف المُبدَّل، وإلا آخر سعر استُخدم. */
  defaultPrice: string | null;
  replace?: { id: string; title: string } | null;
};

const cleanPrice = (v: string) => normalizeDigits(v).trim().replace(/[٫,]/g, ".");
const validPrice = (v: string) => /^\d{1,7}(\.\d{1,2})?$/.test(cleanPrice(v)) && Number(cleanPrice(v)) > 0;

/**
 * رفع كشف الهيئة: سعر الجرة في هذا الكشف (مقترح من آخر سعر)، ثم اسحب الملف أو اختره فيُرفع فورًا.
 * العنوان ورقم الميزان يُقرآن من رأس الكشف، والتحديث لكشف سابق يُكتشف تلقائيًا من رقم الميزان.
 */
export function UploadForm({ activeCycleName, currencySymbol, defaultPrice, replace }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [price, setPrice] = useState(defaultPrice ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const ready = validPrice(price);

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!/\.(pdf|xlsx)$/i.test(file.name)) return setError("الملف لازم يكون PDF أو Excel (.xlsx)");
    if (!ready) return setError("اكتب سعر الجرة في هذا الكشف أولًا");
    setError("");
    const unitPrice = cleanPrice(price);
    try {
      if (!activeCycleName && !replace) {
        setBusy("تجهيز الدورة…");
        const c = await fetch("/api/v1/cycles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unitPrice }) });
        const cj = await c.json().catch(() => null);
        if (!c.ok) throw new ApiError(cj?.error?.code ?? "INTERNAL", cj?.error?.fields?.unitPrice ?? cj?.error?.message ?? "تعذر تجهيز الدورة");
      }
      setBusy("جاري رفع الكشف وقراءته…");
      const form = new FormData();
      form.set("file", file);
      form.set("unitPrice", unitPrice);
      if (replace) form.set("supersedesId", replace.id);
      const res = await fetch("/api/v1/statements", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(json?.error?.code ?? "INTERNAL", json?.error?.message ?? "تعذر رفع الملف");
      router.push(`/d/statements/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر رفع الملف");
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {replace && (
        <Alert className="flex flex-wrap items-center justify-between gap-2">
          <span><RefreshCw className="me-1 inline size-4" />تبديل «{replace.title}»: ارفع الكشف الجديد، وراح تشوف الفروق قبل ما تعتمده.</span>
          <Link href="/d/statements" className="text-sm underline">إلغاء التبديل</Link>
        </Alert>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {/* سعر الجرة في هذا الكشف */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Tag className="size-4" /></span>
          <label htmlFor="u-price" className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">سعر الجرة في هذا الكشف</span>
            <span className="block text-xs text-muted">يُحسب منه المطلوب من كل شخص (إلا إذا ذكر الكشف المبلغ)</span>
          </label>
          <div className={cn("flex h-11 items-center overflow-hidden rounded-xl border bg-surface transition-colors focus-within:ring-2 focus-within:ring-ring", price && !ready ? "border-danger" : "border-border")}>
            <input
              id="u-price"
              dir="ltr"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="h-full w-28 bg-transparent px-3 text-center text-lg font-bold tabular-nums outline-none"
              aria-invalid={Boolean(price) && !ready}
            />
            <span className="flex h-full items-center border-s border-border bg-surface-2 px-3 text-sm text-muted">{currencySymbol}</span>
          </div>
        </div>

        {/* الملف */}
        <label
          htmlFor="u-file"
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files[0]); }}
          className={cn(
            "m-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-9 text-center transition-colors",
            drag ? "border-primary bg-primary-soft" : "border-border hover:border-primary/60 hover:bg-surface-2",
            (!ready || busy) && "pointer-events-none opacity-50",
          )}
        >
          {busy ? <Loader2 className="size-10 animate-spin text-primary" /> : <FileUp className="size-10 text-primary" />}
          <span className="text-base font-semibold">
            {busy || (!ready ? "اكتب سعر الجرة أولًا" : replace ? "اسحب الكشف الجديد هون، أو اضغط لاختياره" : "اسحب ملف كشف الهيئة هون، أو اضغط لاختياره")}
          </span>
          {!busy && <span className="text-xs text-muted">PDF أو Excel{activeCycleName ? ` · يُضاف إلى ${activeCycleName}` : ""}</span>}
        </label>
      </div>
      <input
        id="u-file"
        ref={fileRef}
        type="file"
        accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => void upload(e.target.files?.[0])}
        disabled={!ready || Boolean(busy)}
      />
    </div>
  );
}
