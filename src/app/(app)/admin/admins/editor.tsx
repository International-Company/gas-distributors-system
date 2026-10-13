"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi, useFormSubmit } from "@/components/api-client";

type PermMap = Record<string, string>;
type Existing = { id: string; displayName: string; phone: string | null; isSuperAdmin: boolean; permissions: string[] };

export function PermissionsPicker({ permissions, value, onChange, disabled }: { permissions: PermMap; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">الصلاحيات</legend>
      {Object.entries(permissions).map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={value.includes(key)}
            onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((p) => p !== key))}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

/** إنشاء مدير جديد (بدون existing) أو تعديل بياناته وصلاحياته. */
export function AdminEditor({ permissions, existing }: { permissions: PermMap; existing?: Existing }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    username: "",
    password: "",
    displayName: existing?.displayName ?? "",
    phone: existing?.phone ?? "",
    isSuperAdmin: existing?.isSuperAdmin ?? false,
    permissions: existing?.permissions ?? [],
  });
  const { busy, error, fields, submit } = useFormSubmit(
    () =>
      existing
        ? api("PATCH", `/api/v1/admin/admins/${existing.id}`, { displayName: v.displayName, phone: v.phone, isSuperAdmin: v.isSuperAdmin, permissions: v.permissions })
        : api("POST", "/api/v1/admin/admins", v),
    () => {
      setOpen(false);
      router.refresh();
    },
  );
  return (
    <>
      <Button onClick={() => setOpen(true)} variant={existing ? "secondary" : "primary"}>
        {existing ? "تعديل البيانات والصلاحيات" : (<><Plus className="size-4" /> مدير جديد</>)}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={existing ? "تعديل المدير" : "مدير جديد"} wide>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم" htmlFor="a-name" error={fields.displayName}>
              <Input id="a-name" value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} required />
            </Field>
            <Field label="الهاتف" htmlFor="a-phone" error={fields.phone}>
              <Input id="a-phone" dir="ltr" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
            </Field>
            {!existing && (
              <>
                <Field label="اسم المستخدم" htmlFor="a-user" error={fields.username}>
                  <Input id="a-user" dir="ltr" autoCapitalize="none" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} required />
                </Field>
                <Field label="كلمة المرور الأولية" htmlFor="a-pw" error={fields.password} hint="سيُلزم بتغييرها عند أول دخول">
                  <Input id="a-pw" dir="ltr" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} required />
                </Field>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-4" checked={v.isSuperAdmin} onChange={(e) => setV({ ...v, isSuperAdmin: e.target.checked })} />
            مدير رئيسي (كل الصلاحيات وإدارة المديرين)
          </label>
          {!v.isSuperAdmin && <PermissionsPicker permissions={permissions} value={v.permissions} onChange={(p) => setV({ ...v, permissions: p })} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" loading={busy}>حفظ</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
