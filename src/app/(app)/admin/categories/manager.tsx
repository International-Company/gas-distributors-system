"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Alert, Button, Card, EmptyState, Input } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";

type Row = { id: string; name: string; count: number };

export function CategoriesManager({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const api = useApi();
  const router = useRouter();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [rowError, setRowError] = useState("");

  const create = useFormSubmit(
    () => api("POST", "/api/v1/admin/categories", { name }),
    () => {
      setName("");
      router.refresh();
    },
  );
  const rename = useFormSubmit(
    () => api("PATCH", `/api/v1/admin/categories/${editing!.id}`, { name: editing!.name }),
    () => {
      setEditing(null);
      router.refresh();
    },
  );

  const remove = async (r: Row) => {
    setRowError("");
    if (!confirm(`حذف التصنيف «${r.name}»؟`)) return;
    try {
      await api("DELETE", `/api/v1/admin/categories/${r.id}`);
      router.refresh();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "تعذر الحذف");
    }
  };

  return (
    <Card>
      {canManage && (
        <form onSubmit={create.submit} className="mb-4 flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم تصنيف جديد" required aria-label="اسم التصنيف" />
          <Button type="submit" loading={create.busy}>إضافة</Button>
        </form>
      )}
      {(create.error || rename.error || rowError) && <Alert tone="danger" className="mb-3">{create.error || rename.error || rowError}</Alert>}
      {rows.length === 0 ? (
        <EmptyState>لا توجد تصنيفات بعد.</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2.5">
              {editing?.id === r.id ? (
                <form onSubmit={rename.submit} className="flex flex-1 gap-2">
                  <Input value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} autoFocus required aria-label="الاسم الجديد" />
                  <Button type="submit" size="sm" loading={rename.busy}>حفظ</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
                </form>
              ) : (
                <>
                  <span className="text-sm">
                    {r.name} <span className="text-xs text-muted">({r.count} حساب)</span>
                  </span>
                  {canManage && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: r.id, name: r.name })} aria-label="تعديل">
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(r)} disabled={r.count > 0} title={r.count > 0 ? "لا يمكن حذف تصنيف مستخدم" : undefined} aria-label="حذف">
                        <Trash2 className="size-4" />
                      </Button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
