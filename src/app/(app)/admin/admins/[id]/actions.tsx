"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi, useFormSubmit } from "@/components/api-client";

type Kind = "suspend" | "reset-password" | "logout-all";
const TITLES: Record<Kind, string> = { suspend: "تعليق المدير", "reset-password": "إعادة تعيين كلمة المرور", "logout-all": "خروج من جميع الأجهزة" };

export function AdminActions({ id, status, isSelf, locked }: { id: string; status: string; isSelf: boolean; locked: boolean }) {
  const api = useApi();
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [quickError, setQuickError] = useState("");

  const run = useFormSubmit(
    () => api("POST", `/api/v1/admin/admins/${id}/actions`, { action: kind, reason, ...(kind === "reset-password" ? { newPassword } : {}) }),
    () => {
      setKind(null);
      setReason("");
      setNewPassword("");
      router.refresh();
    },
  );
  const quick = async (action: string) => {
    setQuickError("");
    try {
      await api("POST", `/api/v1/admin/admins/${id}/actions`, { action });
      router.refresh();
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : "حدث خطأ");
    }
  };

  return (
    <Card title="إجراءات الحساب">
      {quickError && <Alert tone="danger" className="mb-3">{quickError}</Alert>}
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" && !isSelf && <Button variant="danger" onClick={() => setKind("suspend")}>تعليق</Button>}
        {status === "SUSPENDED" && <Button onClick={() => quick("activate")}>تفعيل</Button>}
        <Button variant="secondary" onClick={() => setKind("reset-password")}>إعادة تعيين كلمة المرور</Button>
        <Button variant="secondary" onClick={() => setKind("logout-all")}>خروج من جميع الأجهزة</Button>
        {locked && <Button variant="secondary" onClick={() => quick("unlock")}>فك القفل المؤقت</Button>}
      </div>
      {kind && (
        <Modal open onClose={() => setKind(null)} title={TITLES[kind]}>
          <form onSubmit={run.submit} className="space-y-4">
            {run.error && <Alert tone="danger">{run.error}</Alert>}
            {kind === "reset-password" && (
              <Field label="كلمة المرور المؤقتة" htmlFor="ar-pw" error={run.fields.newPassword}>
                <Input id="ar-pw" dir="ltr" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              </Field>
            )}
            <Field label="السبب" htmlFor="ar-reason" error={run.fields.reason}>
              <Textarea id="ar-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setKind(null)}>إلغاء</Button>
              <Button type="submit" loading={run.busy}>تأكيد</Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}
