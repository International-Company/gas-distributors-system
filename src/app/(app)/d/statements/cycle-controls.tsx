"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Pencil, Plus } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi } from "@/components/api-client";

type Cycle = { id: string; name: string; pending: number };

/** زر «دورة جديدة»: يُنهي الدورة الحالية (إن وُجدت) ويبدأ التالية. */
export function NewCycleButton({ current, nextName, className }: { current: Cycle | null; nextName: string; className?: string }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", "/api/v1/cycles/next", { name: name.trim() });
      setOpen(false);
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر بدء الدورة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" className={className} onClick={() => setOpen(true)}>
        <Plus className="size-4" /> دورة جديدة
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="ابدأ دورة جديدة">
          {current && current.pending > 0 ? (
            <div className="space-y-4">
              <Alert tone="warning">في «{current.name}» {current.pending} كشف بانتظار الاعتماد. اعتمده أو احذفه قبل ما تبدأ دورة جديدة.</Alert>
              <div className="flex justify-end"><Button variant="secondary" onClick={() => setOpen(false)}>تمام</Button></div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <Alert tone="danger">{error}</Alert>}
              {current ? (
                <p className="text-sm">
                  راح تنتهي <strong>«{current.name}»</strong> وتبدأ دورة جديدة، والكشوفات اللي بترفعها بعدها بتنضاف للدورة الجديدة.
                </p>
              ) : (
                <p className="text-sm">الكشوفات اللي بترفعها بعدها بتنضاف لهذه الدورة.</p>
              )}
              <Field label="اسم الدورة" htmlFor="cy-name" hint="اختياري">
                <Input id="cy-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={nextName} maxLength={100} autoFocus />
              </Field>
              {current && (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                  إنهاء الدورة ما بيمسح شي: ناسها وكشوفاتها وفلوسها بيضلوا، وبتقدر تكمل تسليم وقبض الباقي فيها عادي.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>رجوع</Button>
                <Button type="submit" loading={busy}><Plus className="size-4" /> ابدأ {name.trim() || nextName}</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

/** تغيير اسم الدورة، وإنهاؤها (للمفتوحة). */
export function CycleMenu({ cycle, isOpen }: { cycle: Cycle; isOpen: boolean }) {
  const api = useApi();
  const router = useRouter();
  const [mode, setMode] = useState<"" | "rename" | "close">("");
  const [name, setName] = useState(cycle.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", `/api/v1/cycles/${cycle.id}/actions`, mode === "rename" ? { action: "rename", name } : { action: "close", confirm: true });
      setMode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };
  const openMode = (m: "rename" | "close") => { setMode(m); setName(cycle.name); setError(""); };

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" className="px-2" onClick={() => openMode("rename")} title="تغيير اسم الدورة" aria-label={`تغيير اسم ${cycle.name}`}>
        <Pencil className="size-4" />
      </Button>
      {isOpen && (
        <Button size="sm" variant="ghost" onClick={() => openMode("close")} title="إنهاء الدورة">
          <Flag className="size-4" /> إنهاء
        </Button>
      )}
      {mode && (
        <Modal open onClose={() => setMode("")} title={mode === "rename" ? "اسم الدورة" : `إنهاء «${cycle.name}»`}>
          {mode === "close" && cycle.pending > 0 ? (
            <div className="space-y-4">
              <Alert tone="warning">في الدورة {cycle.pending} كشف بانتظار الاعتماد. اعتمده أو احذفه قبل إنهاء الدورة.</Alert>
              <div className="flex justify-end"><Button variant="secondary" onClick={() => setMode("")}>تمام</Button></div>
            </div>
          ) : (
            <form onSubmit={run} className="space-y-4">
              {error && <Alert tone="danger">{error}</Alert>}
              {mode === "rename" ? (
                <Field label="الاسم" htmlFor="cy-rename">
                  <Input id="cy-rename" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
                </Field>
              ) : (
                <div className="space-y-2 text-sm">
                  <p>الدورة راح تنتهي، وما بتنضاف لها كشوفات جديدة.</p>
                  <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">ناسها وكشوفاتها وفلوسها بيضلوا، والتسليم والقبض للباقي شغّال عادي. أول كشف بترفعه بعدها بيبدأ دورة جديدة.</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setMode("")}>رجوع</Button>
                <Button type="submit" loading={busy}>
                  {mode === "rename" ? "حفظ" : <><Flag className="size-4" /> أنهِ الدورة</>}
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
