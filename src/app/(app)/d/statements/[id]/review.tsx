"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useApi, useFormSubmit } from "@/components/api-client";

// ---------------------------------------------------------------------------
// الدورة والإصدار
// ---------------------------------------------------------------------------

export function MetaPanel({
  statement,
  cycles,
  approved,
}: {
  statement: { id: string; title: string; cycleId: string | null; supersedesId: string | null };
  cycles: { id: string; name: string; status: string }[];
  approved: { id: string; title: string; version: number; cycleId: string | null }[];
}) {
  const api = useApi();
  const router = useRouter();
  const [v, setV] = useState({ title: statement.title, cycleId: statement.cycleId ?? "", supersedesId: statement.supersedesId ?? "" });
  const [saved, setSaved] = useState(false);
  const { busy, error, submit } = useFormSubmit(
    () =>
      api("PATCH", `/api/v1/statements/${statement.id}`, {
        title: v.title,
        supersedesId: v.supersedesId || null,
        ...(v.supersedesId ? {} : { cycleId: v.cycleId || null }),
      }),
    () => {
      setSaved(true);
      router.refresh();
    },
  );
  return (
    <Card title="الدورة والإصدار">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
        {error && <Alert tone="danger" className="md:col-span-3">{error}</Alert>}
        {saved && <Alert tone="success" className="md:col-span-3">تم الحفظ وأُعيد التحقق من الصفوف.</Alert>}
        <Field label="العنوان" htmlFor="m-title">
          <Input id="m-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label="إصدار جديد لكشف معتمد؟" htmlFor="m-sup">
          <Select id="m-sup" value={v.supersedesId} onChange={(e) => setV({ ...v, supersedesId: e.target.value })}>
            <option value="">لا، كشف مستقل</option>
            {approved.map((s) => (
              <option key={s.id} value={s.id}>{s.title} (الإصدار {s.version})</option>
            ))}
          </Select>
        </Field>
        <Field label="الدورة" htmlFor="m-cycle" hint={v.supersedesId ? "الإصدار الجديد يتبع دورة الإصدار السابق" : "الاعتماد ممكن في الدورة النشطة فقط"}>
          <Select id="m-cycle" value={v.cycleId} onChange={(e) => setV({ ...v, cycleId: e.target.value })} disabled={!!v.supersedesId}>
            <option value="">اختر الدورة</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.status === "OPEN" ? " (نشطة)" : " (مغلقة)"}</option>
            ))}
          </Select>
        </Field>
        <div className="md:col-span-3">
          <Button type="submit" variant="secondary" loading={busy}>حفظ</Button>
          {cycles.every((c) => c.status !== "OPEN") && (
            <a href="/d/cycles" className="ms-3 text-sm text-primary hover:underline">لا توجد دورة نشطة — ابدأ دورة جديدة</a>
          )}
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ربط الأعمدة
// ---------------------------------------------------------------------------

export function MappingPanel({
  statementId, preview, columns, headerRow, mapping, labels,
}: {
  statementId: string;
  preview: string[][];
  columns: number;
  headerRow: number | null;
  mapping: Record<string, number | null>;
  labels: Record<string, string>;
}) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hr, setHr] = useState<number | null>(headerRow);
  const [m, setM] = useState<Record<string, number | null>>(mapping);
  const { busy, error, submit } = useFormSubmit(
    () => api("PUT", `/api/v1/statements/${statementId}/mapping`, { headerRow: hr, mapping: m }),
    () => {
      setOpen(false);
      router.refresh();
    },
  );
  const colLabel = (c: number) => `العمود ${c + 1}`;
  const fieldOf = (c: number) => Object.entries(m).find(([, v]) => v === c)?.[0];
  return (
    <Card
      title="ربط أعمدة الملف بالحقول"
      actions={<Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>{open ? "إخفاء" : "تعديل الربط"}</Button>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-xs">
          <thead>
            <tr>
              {Array.from({ length: columns }, (_, c) => (
                <th key={c} className="border border-border bg-surface-2 px-2 py-1 text-right font-medium">
                  {colLabel(c)}
                  {fieldOf(c) && <div className="text-primary">← {labels[fieldOf(c)!]}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, r) => (
              <tr key={r} className={r === hr ? "bg-primary-soft font-semibold" : ""}>
                {Array.from({ length: columns }, (_, c) => (
                  <td key={c} className="max-w-48 truncate border border-border px-2 py-1">{row[c] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">الصف المظلل هو صف العناوين. تغيير الربط يعيد استخراج كل الصفوف ويلغي التعديلات اليدوية عليها.</p>
      {open && (
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {error && <Alert tone="danger" className="sm:col-span-2 lg:col-span-4">{error}</Alert>}
          <Field label="صف العناوين" htmlFor="map-hr">
            <Select id="map-hr" value={hr === null ? "" : String(hr)} onChange={(e) => setHr(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">لا يوجد صف عناوين</option>
              {preview.map((_, r) => <option key={r} value={r}>الصف {r + 1}</option>)}
            </Select>
          </Field>
          {Object.entries(labels).map(([f, label]) => (
            <Field key={f} label={label} htmlFor={`map-${f}`}>
              <Select id={`map-${f}`} value={m[f] === null || m[f] === undefined ? "" : String(m[f])} onChange={(e) => setM({ ...m, [f]: e.target.value === "" ? null : Number(e.target.value) })}>
                <option value="">غير موجود</option>
                {Array.from({ length: columns }, (_, c) => <option key={c} value={c}>{colLabel(c)}</option>)}
              </Select>
            </Field>
          ))}
          <div className="flex items-end">
            <Button type="submit" loading={busy}>تطبيق وإعادة الاستخراج</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// تعديل صف
// ---------------------------------------------------------------------------

type RowData = { id: string; nationalId: string | null; fullName: string | null; phone: string | null; citizenNumber: string | null; quantity: number | null; amount: string | null; excluded: boolean };

export function RowActions({ statementId, row }: { statementId: string; row: RowData }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    nationalId: row.nationalId ?? "", fullName: row.fullName ?? "", phone: row.phone ?? "",
    citizenNumber: row.citizenNumber ?? "", quantity: row.quantity === null ? "" : String(row.quantity), amount: row.amount ?? "",
  });
  const url = `/api/v1/statements/${statementId}/rows/${row.id}`;
  const save = useFormSubmit(
    () => api("PATCH", url, { ...v, quantity: v.quantity === "" ? null : Number(v.quantity), amount: v.amount || null }),
    () => {
      setOpen(false);
      router.refresh();
    },
  );
  const toggle = useFormSubmit(() => api("PATCH", url, { excluded: !row.excluded }), () => router.refresh());
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="تصحيح الصف"><Pencil className="size-4" /></Button>
      <Button size="sm" variant="ghost" loading={toggle.busy} onClick={() => toggle.submit()}>{row.excluded ? "إرجاع" : "استبعاد"}</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="تصحيح صف" wide>
          <form onSubmit={save.submit} className="grid gap-3 sm:grid-cols-2">
            {save.error && <Alert tone="danger" className="sm:col-span-2">{save.error}</Alert>}
            <Alert className="sm:col-span-2">صحّح القيم مطابقةً للملف الأصلي فقط. التعديل يُسجل في سجل التدقيق.</Alert>
            <Field label="رقم الهوية" htmlFor="r-nid" error={save.fields.nationalId}><Input id="r-nid" dir="ltr" value={v.nationalId} onChange={set("nationalId")} /></Field>
            <Field label="الاسم" htmlFor="r-name"><Input id="r-name" value={v.fullName} onChange={set("fullName")} /></Field>
            <Field label="رقم المواطن في الكشف" htmlFor="r-num"><Input id="r-num" dir="ltr" value={v.citizenNumber} onChange={set("citizenNumber")} /></Field>
            <Field label="الهاتف" htmlFor="r-phone"><Input id="r-phone" dir="ltr" value={v.phone} onChange={set("phone")} /></Field>
            <Field label="عدد الجرار" htmlFor="r-qty"><Input id="r-qty" dir="ltr" inputMode="numeric" value={v.quantity} onChange={set("quantity")} /></Field>
            <Field label="المبلغ (فارغ = الكمية × سعر الدورة)" htmlFor="r-amt" error={save.fields.amount}><Input id="r-amt" dir="ltr" inputMode="decimal" value={v.amount} onChange={set("amount")} /></Field>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button type="submit" loading={save.busy}>حفظ</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// الاعتماد والإلغاء
// ---------------------------------------------------------------------------

export function ApprovePanel({
  statementId, canApprove, summary, cycleName, cycleOpen,
}: {
  statementId: string;
  canApprove: boolean;
  summary: { ok: number; warning: number; error: number; excluded: number };
  cycleName: string | null;
  cycleOpen: boolean;
}) {
  const api = useApi();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const approve = useFormSubmit(
    () => api<Record<string, number>>("POST", `/api/v1/statements/${statementId}/approve`, { confirm: true }),
    (r) => {
      setResult(r);
      router.refresh();
    },
  );
  const discard = useFormSubmit(
    () => api("POST", `/api/v1/statements/${statementId}/discard`, { reason }),
    () => router.push("/d/statements"),
  );
  return (
    <Card title="الاعتماد">
      <div className="space-y-3">
        {approve.error && <Alert tone="danger">{approve.error}</Alert>}
        {result && <Alert tone="success">تم الاعتماد: {result.created} استحقاق جديد، {result.updated} محدّث، {result.removed} أُزيل، {result.newCitizens} مواطن جديد.</Alert>}
        <ul className="text-sm text-muted">
          <li>سيُعتمد {summary.ok + summary.warning} صف في {cycleName ? `«${cycleName}»` : "— لم تُحدد الدورة"}.</li>
          {summary.warning > 0 && <li className="text-warning">{summary.warning} صف به تنبيهات؛ راجعها قبل الاعتماد.</li>}
          {summary.error > 0 && <li className="text-danger">{summary.error} صف به أخطاء: صححها أو استبعدها أولًا.</li>}
          {summary.excluded > 0 && <li>{summary.excluded} صف مستبعد لن يُعتمد.</li>}
          {cycleName && !cycleOpen && <li className="text-danger">الدورة مغلقة؛ لا يمكن الاعتماد فيها.</li>}
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={!canApprove} />
          راجعت بيانات الكشف وأؤكد اعتماده. بعد الاعتماد يُستخدم في عمليات الاستحقاق.
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canApprove || !confirm} loading={approve.busy} onClick={() => approve.submit()}>اعتماد الكشف</Button>
          <Button variant="secondary" onClick={() => setDiscardOpen(true)}>إلغاء الكشف</Button>
        </div>
      </div>
      {discardOpen && (
        <Modal open onClose={() => setDiscardOpen(false)} title="إلغاء الكشف">
          <form onSubmit={discard.submit} className="space-y-4">
            {discard.error && <Alert tone="danger">{discard.error}</Alert>}
            <Alert>يبقى الكشف وملفه محفوظين بحالة «ملغى» ولا يمكن اعتماده لاحقًا.</Alert>
            <Field label="السبب" htmlFor="d-reason"><Textarea id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDiscardOpen(false)}>رجوع</Button>
              <Button type="submit" variant="danger" loading={discard.busy}>إلغاء الكشف</Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}
