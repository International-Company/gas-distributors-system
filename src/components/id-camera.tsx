"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Alert, Button, Input } from "./ui";
import { Modal } from "./modal";
import { isValidNationalId } from "@/lib/national-id";

/** تصوير الهوية: قراءة الرقم على الجهاز، ثم عرضه للتأكيد قبل البحث. لا تُرسل الصورة ولا تُحفظ. */
export function IdCamera({ onConfirm }: { onConfirm: (id: string, method: "ID_SCAN" | "MANUAL_ENTRY") => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setOpen(true);
    setBusy(true);
    setError("");
    setCandidates([]);
    try {
      const { readIdNumbersFromImage } = await import("@/lib/ocr-client");
      const r = await readIdNumbersFromImage(file, (_s, p) => setProgress(p));
      setCandidates(r.ids);
      if (!r.ids.length) setError("لم يُقرأ رقم هوية صالح من الصورة. أعد التصوير بإضاءة أوضح أو أدخل الرقم يدويًا.");
    } catch {
      setError("تعذرت القراءة الضوئية. أدخل الرقم يدويًا أو أعد المحاولة.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const choose = (id: string, method: "ID_SCAN" | "MANUAL_ENTRY") => {
    onConfirm(id, method);
    setOpen(false);
    setManual("");
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
        <Camera className="size-4" /> تصوير الهوية
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="رقم الهوية من الصورة">
        <div className="space-y-4">
          {busy && (
            <div>
              <div className="mb-1 text-xs text-muted">جارٍ القراءة على هذا الجهاز…</div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            </div>
          )}
          {error && <Alert tone="warning">{error}</Alert>}
          {candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm">طابق الرقم مع البطاقة ثم أكّده:</p>
              {candidates.map((id) => (
                <Button key={id} type="button" variant="secondary" className="w-full text-lg tracking-widest" onClick={() => choose(id, "ID_SCAN")}>
                  <bdi>{id}</bdi> — تأكيد
                </Button>
              ))}
            </div>
          )}
          {!busy && (
            <div className="flex gap-2">
              <Input dir="ltr" inputMode="numeric" placeholder="إدخال يدوي" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, "").slice(0, 9))} />
              <Button type="button" disabled={!isValidNationalId(manual)} onClick={() => choose(manual, "MANUAL_ENTRY")}>تأكيد</Button>
            </div>
          )}
          {manual.length === 9 && !isValidNationalId(manual) && <p className="text-xs text-danger">رقم الهوية غير صالح (رقم التحقق لا يطابق)</p>}
        </div>
      </Modal>
    </>
  );
}
