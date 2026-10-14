"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanText } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import { useApi } from "@/components/api-client";

export function OcrPanel({ statementId }: { statementId: string }) {
  const api = useApi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [ratio, setRatio] = useState(0);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setStage("تنزيل الملف");
      const res = await fetch(`/api/v1/statements/${statementId}/file`);
      if (!res.ok) throw new Error("تعذر تنزيل الملف");
      const { ocrPdf } = await import("@/lib/ocr-client");
      const { items, confidence } = await ocrPdf(await res.arrayBuffer(), (s, r) => {
        setStage(s);
        setRatio(r);
      });
      if (!items.length) throw new Error("لم يُقرأ أي نص من الملف. تأكد من وضوح المسح الضوئي");
      setStage("إرسال النتيجة");
      await api("POST", `/api/v1/statements/${statementId}/ocr`, { items, confidence });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشلت القراءة الضوئية");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="قراءة ضوئية مطلوبة">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          الملف ممسوح ضوئيًا ولا يحتوي نصًا. تجري القراءة الضوئية على هذا الجهاز وقد تستغرق عدة دقائق حسب عدد الصفحات.
          النتيجة تحتاج مراجعة دقيقة لكل صف مقابل الملف الأصلي.
        </p>
        {error && <Alert tone="danger">{error} — يمكنك إعادة المحاولة، أو طلب نسخة Excel أو PDF نصية من الهيئة.</Alert>}
        {busy && (
          <div>
            <div className="mb-1 text-xs text-muted">{stage}</div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
          </div>
        )}
        <Button onClick={run} loading={busy}>
          <ScanText className="size-4" /> بدء القراءة الضوئية
        </Button>
      </div>
    </Card>
  );
}
