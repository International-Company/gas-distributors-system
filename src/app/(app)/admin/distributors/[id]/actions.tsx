"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi, useFormSubmit } from "@/components/api-client";
import { endOfDayIso, toDateInput } from "@/lib/format";

type D = { id: string; status: string; suspensionReason: string | null; isTrial: boolean; expiresAt: string | null; isPinned: boolean; locked: boolean };
type Can = { status: boolean; credentials: boolean; manage: boolean };
type Kind = "suspend" | "activate" | "set-validity" | "archive" | "unarchive" | "reset-password" | "logout-all";

const TITLES: Record<Kind, string> = {
  suspend: "تعليق الحساب",
  activate: "تفعيل الحساب",
  "set-validity": "تعديل الصلاحية والنوع",
  archive: "أرشفة الحساب",
  unarchive: "استعادة الحساب من الأرشيف",
  "reset-password": "إعادة تعيين كلمة المرور",
  "logout-all": "تسجيل الخروج من جميع الأجهزة",
};

export function DistributorActions({ distributor: d, can }: { distributor: D; can: Can }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [notice, setNotice] = useState("");
  const [quickBusy, setQuickBusy] = useState("");
  const [quickError, setQuickError] = useState("");
  const api = useApi();
  const router = useRouter();

  async function runQuick(action: string) {
    setNotice("");
    setQuickError("");
    setQuickBusy(action);
    try {
      await api("POST", `/api/v1/admin/distributors/${d.id}/actions`, { action });
      router.refresh();
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setQuickBusy("");
    }
  }

  const done = (msg: string) => {
    setKind(null);
    setNotice(msg);
    router.refresh();
  };

  const archived = d.status === "ARCHIVED";
  const btns: { show: boolean; label: string; kind?: Kind; quick?: string; variant?: "secondary" | "danger" }[] = [
    { show: can.status && d.status === "ACTIVE", label: "تعليق", kind: "suspend", variant: "danger" },
    { show: can.status && d.status === "SUSPENDED", label: "تفعيل / إعادة تفعيل", kind: "activate" },
    { show: can.status && !archived, label: d.isTrial ? "تمديد أو تحويل لحساب فعلي" : "تعديل تاريخ الانتهاء", kind: "set-validity", variant: "secondary" },
    { show: can.manage && !archived, label: d.isPinned ? "إلغاء التثبيت" : "تثبيت أعلى القائمة", quick: d.isPinned ? "unpin" : "pin", variant: "secondary" },
    { show: can.credentials, label: "إعادة تعيين كلمة المرور", kind: "reset-password", variant: "secondary" },
    { show: can.credentials, label: "خروج من جميع الأجهزة", kind: "logout-all", variant: "secondary" },
    { show: can.credentials && d.locked, label: "فك القفل المؤقت", quick: "unlock", variant: "secondary" },
    { show: can.status && !archived, label: "أرشفة", kind: "archive", variant: "secondary" },
    { show: can.status && archived, label: "استعادة من الأرشيف", kind: "unarchive" },
  ];
  const visible = btns.filter((b) => b.show);
  if (!visible.length) return null;

  return (
    <Card title="إجراءات الحساب">
      {notice && <Alert tone="success" className="mb-3">{notice}</Alert>}
      {quickError && <Alert tone="danger" className="mb-3">{quickError}</Alert>}
      <div className="flex flex-wrap gap-2">
        {visible.map((b) => (
          <Button
            key={b.label}
            variant={b.variant ?? "primary"}
            loading={Boolean(b.quick) && quickBusy === b.quick}
            onClick={() => {
              setNotice("");
              if (b.kind) setKind(b.kind);
              else if (b.quick) runQuick(b.quick);
            }}
          >
            {b.label}
          </Button>
        ))}
      </div>
      {kind && <ActionModal kind={kind} d={d} onClose={() => setKind(null)} onDone={done} />}
    </Card>
  );

}

function ActionModal({ kind, d, onClose, onDone }: { kind: Kind; d: D; onClose: () => void; onDone: (msg: string) => void }) {
  const api = useApi();
  const [reason, setReason] = useState("");
  const [isTrial, setIsTrial] = useState(d.isTrial);
  const [expiresAt, setExpiresAt] = useState(d.expiresAt && new Date(d.expiresAt) > new Date() ? toDateInput(d.expiresAt) : "");
  const [newPassword, setNewPassword] = useState("");
  const [revokeSessions, setRevokeSessions] = useState(true);

  const needsReason = ["suspend", "archive", "unarchive", "reset-password", "logout-all"].includes(kind);
  const needsValidity = kind === "activate" || kind === "set-validity";

  const { busy, error, fields, submit } = useFormSubmit(
    () => {
      const body: Record<string, unknown> = { action: kind };
      if (needsReason || reason) body.reason = reason;
      if (needsValidity) Object.assign(body, { isTrial, expiresAt: expiresAt ? endOfDayIso(expiresAt) : null });
      if (kind === "reset-password") Object.assign(body, { newPassword, revokeSessions });
      return api("POST", `/api/v1/admin/distributors/${d.id}/actions`, body);
    },
    () => onDone(`تم تنفيذ: ${TITLES[kind]}`),
  );

  return (
    <Modal open onClose={onClose} title={TITLES[kind]}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {kind === "suspend" && <Alert tone="warning">سيُمنع الموزّع من الدخول وتُنهى جلساته فورًا، مع الاحتفاظ بكل بياناته وسجلاته.</Alert>}
        {kind === "archive" && <Alert tone="warning">الأرشفة لا تحذف أي بيانات أو عمليات. يُخفى الحساب من القائمة الافتراضية ويُمنع من الدخول.</Alert>}
        {kind === "unarchive" && <Alert>سيعود الحساب بحالة «معلّق»، ثم يمكن تفعيله بقرار منفصل.</Alert>}
        {kind === "reset-password" && <Alert tone="warning">نفّذ هذه العملية فقط بعد التحقق من هوية الموزّع. سيُلزم بتغيير كلمة المرور عند الدخول.</Alert>}

        {needsValidity && (
          <div className="space-y-4 rounded-lg bg-surface-2 p-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={isTrial} onChange={(e) => setIsTrial(e.target.checked)} /> حساب تجريبي
            </label>
            <Field label={isTrial ? "تاريخ انتهاء التجربة" : "تاريخ الانتهاء (اختياري)"} htmlFor="m-exp" error={fields.expiresAt} hint={isTrial ? undefined : "اتركه فارغًا لحساب بلا مدة محددة"}>
              <Input id="m-exp" type="date" min={toDateInput(new Date())} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required={isTrial} />
            </Field>
          </div>
        )}

        {kind === "reset-password" && (
          <>
            <Field label="كلمة المرور المؤقتة الجديدة" htmlFor="m-pw" error={fields.newPassword} hint="8 أحرف على الأقل، أرقام وحروف">
              <Input id="m-pw" dir="ltr" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={revokeSessions} onChange={(e) => setRevokeSessions(e.target.checked)} /> إنهاء جميع الجلسات وإلغاء PIN على الأجهزة
            </label>
          </>
        )}

        {(needsReason || needsValidity) && (
          <Field
            label={kind === "reset-password" ? "طريقة التحقق من الهوية والسبب" : needsReason ? "السبب" : "ملاحظة (اختياري)"}
            htmlFor="m-reason"
            error={fields.reason}
          >
            <Textarea id="m-reason" value={reason} onChange={(e) => setReason(e.target.value)} required={needsReason} />
          </Field>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={busy} variant={kind === "suspend" ? "danger" : "primary"}>تأكيد</Button>
        </div>
      </form>
    </Modal>
  );
}
