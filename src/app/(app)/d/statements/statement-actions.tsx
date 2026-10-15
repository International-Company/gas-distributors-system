"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2 } from "lucide-react";
import { Alert, Button, Field, Textarea, buttonClass, cn } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi } from "@/components/api-client";

const REASONS = ["رُفع بالخطأ", "كشف غلط", "مكرر"];

type Props = { id: string; title: string; status: "PENDING_REVIEW" | "APPROVED"; people: number; activity: number; isUpdate: boolean; compact?: boolean };

/**
 * «تبديل» و«حذف» الكشف.
 * - التبديل (للمعتمد): رفع كشف جديد مكانه، مع الفروق قبل الاعتماد؛ من استلم أو دفع يبقى سجله.
 * - الحذف: الكشف بانتظار الاعتماد يُلغى، والمعتمد يُحذف فقط إن لم يستلم أو يدفع منه أحد.
 * لا شيء يُمحى من قاعدة البيانات: الكشف يُعلَّم «ملغى» مع السبب.
 */
export function StatementActions({ id, title, status, people, activity, isUpdate, compact }: Props) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const approved = status === "APPROVED";
  const blocked = approved && (activity > 0 || isUpdate);

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", `/api/v1/statements/${id}/${approved ? "withdraw" : "discard"}`, { reason });
      setOpen(false);
      router.push("/d/statements");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر الحذف");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {approved && (
        <Link href={`/d/statements?replace=${id}`} className={buttonClass("ghost", "sm", compact ? "px-2" : undefined)} title="تبديل بكشف جديد">
          <RefreshCw className="size-4" /> {!compact && "تبديل"}
        </Link>
      )}
      <Button size="sm" variant="ghost" className={cn("text-danger hover:bg-danger-soft", compact && "px-2")} onClick={() => setOpen(true)} title="حذف الكشف">
        <Trash2 className="size-4" /> {!compact && "حذف"}
      </Button>

      {open && (
        <Modal open onClose={() => setOpen(false)} title={`حذف «${title}»`}>
          {blocked ? (
            <div className="space-y-4">
              <Alert tone="warning">
                {isUpdate
                  ? "هذا الكشف تحديث لكشف سابق، فلا يُحذف. إذا كان فيه خطأ، بدّله بكشف جديد صحيح."
                  : `ما بنقدر نحذف هذا الكشف: فيه ${activity} شخص استلموا أو دفعوا، وسجلهم لازم يضل محفوظ. إذا الكشف غلط، بدّله بكشف جديد صحيح: من استلم أو دفع يضل سجله، والباقي يتعدّل حسب الكشف الجديد.`}
              </Alert>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>رجوع</Button>
                <Link href={`/d/statements?replace=${id}`} className={buttonClass("primary")}><RefreshCw className="size-4" /> تبديل بكشف جديد</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={remove} className="space-y-4">
              {error && <Alert tone="danger">{error}</Alert>}
              <p className="text-sm">
                {approved
                  ? <>راح ينحذف الكشف وينشال <strong>{people}</strong> شخص منه من «الكشف». ما في حدا منهم استلم أو دفع.</>
                  : "راح ينحذف الكشف وما رح ينضاف حدا منه."}
              </p>
              <Field label="ليش؟" htmlFor="st-reason">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {REASONS.map((r) => (
                    <button key={r} type="button" onClick={() => setReason(r)} className={cn("rounded-full border px-3 py-1 text-sm", reason === r ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}>
                      {r}
                    </button>
                  ))}
                </div>
                <Textarea id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} className="min-h-16" />
              </Field>
              <p className="text-xs text-muted">الكشف لا يُمحى نهائيًا: يُحفظ بحالة «ملغى» مع السبب في القديمة والملغاة.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>رجوع</Button>
                <Button type="submit" variant="danger" loading={busy}><Trash2 className="size-4" /> احذف الكشف</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
