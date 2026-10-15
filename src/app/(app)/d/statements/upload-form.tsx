"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { ApiError } from "@/components/api-client";

type Approved = { id: string; title: string; version: number; cycleName: string };
type ActiveCycle = { name: string; unitPrice: string; currencySymbol: string } | null;

/**
 * رفع ملف الكشف (multipart). لا يستخدم useApi لأنه يرسل FormData لا JSON.
 * الدورة تُدار تلقائيًا: إن لم توجد دورة نشطة يُطلب سعر الجرة وتُنشأ الدورة قبل الرفع.
 */
export function UploadForm({ approved, activeCycle }: { approved: Approved[]; activeCycle: ActiveCycle }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [supersedesId, setSupersedesId] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("اختر ملف الكشف");
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    if (title) form.set("title", title);
    if (supersedesId) form.set("supersedesId", supersedesId);
    try {
      if (!activeCycle && !supersedesId) {
        const c = await fetch("/api/v1/cycles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unitPrice: price }) });
        const cj = await c.json().catch(() => null);
        if (!c.ok) throw new ApiError(cj?.error?.code ?? "INTERNAL", cj?.error?.fields?.unitPrice ?? cj?.error?.message ?? "تعذر تجهيز الدورة");
      }
      const res = await fetch("/api/v1/statements", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(json?.error?.code ?? "INTERNAL", json?.error?.message ?? "تعذر رفع الملف");
      router.push(`/d/statements/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر رفع الملف");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      {error && <Alert tone="danger" className="md:col-span-2">{error}</Alert>}
      <Field label="ملف الكشف" htmlFor="u-file" hint="PDF (نصي أو ممسوح ضوئيًا) أو Excel بصيغة .xlsx، حتى 20 ميغابايت" className="md:col-span-2">
        <Input
          id="u-file"
          ref={fileRef}
          type="file"
          accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="py-1.5"
          required
        />
      </Field>
      {activeCycle ? (
        <p className="text-sm text-muted md:col-span-2">
          الكشف سينضاف إلى {activeCycle.name} · سعر الجرة <bdi dir="ltr" className="font-semibold text-text">{activeCycle.unitPrice} {activeCycle.currencySymbol}</bdi>
        </p>
      ) : (
        !supersedesId && (
          <Field label="سعر الجرة على المواطن (حسب الهيئة)" htmlFor="u-price" hint="مرة واحدة فقط؛ يُستخدم لحساب المطلوب من كل شخص إن لم يذكره الكشف">
            <Input id="u-price" dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required className="w-40" />
          </Field>
        )
      )}
      <Field label="عنوان الكشف (اختياري)" htmlFor="u-title" hint="يُستخدم اسم الملف إن تُرك فارغًا">
        <Input id="u-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="هل هو إصدار جديد لكشف معتمد؟" htmlFor="u-sup" hint="اختر الكشف السابق لعرض الفروق قبل الاعتماد">
        <Select id="u-sup" value={supersedesId} onChange={(e) => setSupersedesId(e.target.value)}>
          <option value="">لا، كشف جديد</option>
          {approved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} (الإصدار {s.version}) — {s.cycleName}
            </option>
          ))}
        </Select>
      </Field>
      <div className="md:col-span-2">
        <Button type="submit" loading={busy}>
          <Upload className="size-4" /> رفع واستخراج البيانات
        </Button>
      </div>
    </form>
  );
}
