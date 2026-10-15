"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileUp, Loader2, RefreshCw } from "lucide-react";
import { Alert, Field, Input, cn } from "@/components/ui";
import { ApiError } from "@/components/api-client";

type ActiveCycle = { name: string; unitPrice: string; currencySymbol: string } | null;

/**
 * رفع كشف الهيئة بخطوة واحدة: اسحب الملف أو اختره فيُرفع فورًا ويُقرأ.
 * العنوان ورقم الميزان يُقرآن من رأس الكشف، والتحديث لكشف سابق يُكتشف تلقائيًا من رقم الميزان.
 * الدورة تُدار تلقائيًا: إن لم توجد دورة نشطة يُطلب سعر الجرة مرة واحدة.
 */
export function UploadForm({ activeCycle, replace }: { activeCycle: ActiveCycle; replace?: { id: string; title: string } | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const needPrice = !activeCycle && !replace;
  const ready = !needPrice || /^\d+([.,٫]\d{1,2})?$/.test(price.trim());

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!/\.(pdf|xlsx)$/i.test(file.name)) return setError("الملف لازم يكون PDF أو Excel (.xlsx)");
    if (!ready) return setError("اكتب سعر الجرة أولًا");
    setError("");
    try {
      if (needPrice) {
        setBusy("تجهيز الدورة…");
        const c = await fetch("/api/v1/cycles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unitPrice: price.trim().replace(/[٫,]/g, ".") }) });
        const cj = await c.json().catch(() => null);
        if (!c.ok) throw new ApiError(cj?.error?.code ?? "INTERNAL", cj?.error?.fields?.unitPrice ?? cj?.error?.message ?? "تعذر تجهيز الدورة");
      }
      setBusy("جاري رفع الكشف وقراءته…");
      const form = new FormData();
      form.set("file", file);
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
      {needPrice && (
        <Field label="سعر الجرة على المواطن (حسب الهيئة)" htmlFor="u-price" hint="مرة واحدة فقط؛ يُحسب منه المطلوب من كل شخص إن لم يذكره الكشف">
          <Input id="u-price" dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-40 text-center" />
        </Field>
      )}
      <label
        htmlFor="u-file"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files[0]); }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors",
          drag ? "border-primary bg-primary-soft" : "border-border bg-surface hover:border-primary/60 hover:bg-surface-2",
          (!ready || busy) && "pointer-events-none opacity-60",
        )}
      >
        {busy ? <Loader2 className="size-10 animate-spin text-primary" /> : <FileUp className="size-10 text-primary" />}
        <span className="text-base font-semibold">{busy || (replace ? "اسحب الكشف الجديد هون، أو اضغط لاختياره" : "اسحب ملف كشف الهيئة هون، أو اضغط لاختياره")}</span>
        {!busy && (
          <span className="text-xs text-muted">
            PDF أو Excel · {activeCycle ? <>يُضاف إلى {activeCycle.name} بسعر <bdi dir="ltr">{activeCycle.unitPrice} {activeCycle.currencySymbol}</bdi></> : "اكتب سعر الجرة أولًا"}
          </span>
        )}
      </label>
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
