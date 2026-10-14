"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

export function NewCase({ initialOpen, initial }: { initialOpen: boolean; initial: { nationalId: string; fullName: string } }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [v, setV] = useState({ nationalId: initial.nationalId, fullName: initial.fullName, phone: "", details: "" });
  const run = useFormSubmit(
    () => api("POST", "/api/v1/review-cases", v),
    () => {
      setOpen(false);
      setV({ nationalId: "", fullName: "", phone: "", details: "" });
      router.replace("/d/review-cases");
      router.refresh();
    },
  );
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className="size-4" /> تسجيل حالة</Button>;
  return (
    <Card title="تسجيل حالة للمراجعة">
      <form onSubmit={run.submit} className="grid gap-3 sm:grid-cols-3">
        {run.error && <Alert tone="danger" className="sm:col-span-3">{run.error}</Alert>}
        <Field label="رقم الهوية" htmlFor="rc-nid" error={run.fields.nationalId}><Input id="rc-nid" dir="ltr" inputMode="numeric" value={v.nationalId} onChange={set("nationalId")} /></Field>
        <Field label="الاسم" htmlFor="rc-name"><Input id="rc-name" value={v.fullName} onChange={set("fullName")} /></Field>
        <Field label="الهاتف" htmlFor="rc-phone"><Input id="rc-phone" dir="ltr" value={v.phone} onChange={set("phone")} /></Field>
        <Field label="وصف الحالة" htmlFor="rc-details" error={run.fields.details} className="sm:col-span-3"><Textarea id="rc-details" value={v.details} onChange={set("details")} required /></Field>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" loading={run.busy}>تسجيل</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
        </div>
      </form>
    </Card>
  );
}

export function ResolveCase({ id }: { id: string }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const run = useFormSubmit(() => api("POST", `/api/v1/review-cases/${id}/resolve`, { resolution }), () => router.refresh());
  if (!open) return <Button size="sm" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>إغلاق الحالة</Button>;
  return (
    <form onSubmit={run.submit} className="mt-3 space-y-2">
      {run.error && <Alert tone="danger">{run.error}</Alert>}
      <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="نتيجة المراجعة" required aria-label="نتيجة المراجعة" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={run.busy}>حفظ وإغلاق</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
      </div>
    </form>
  );
}
