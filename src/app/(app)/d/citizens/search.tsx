"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Input, Select } from "@/components/ui";
import { useApi, useFormSubmit } from "@/components/api-client";
import { formatMoney } from "@/lib/format";
import { IdCamera } from "@/components/id-camera";

type Result = {
  id: string; nationalId: string; fullName: string; phone: string | null; archived: boolean; cycles: number;
  current: { citizenNumber: string; quantity: number; amountDue: string; cycleName: string } | null;
};

const BY_LABELS: Record<string, string> = { name: "الاسم", nationalId: "رقم الهوية", phone: "الهاتف", citizenNumber: "رقم المواطن" };

export function CitizenSearch() {
  const api = useApi();
  const [q, setQ] = useState("");
  const [by, setBy] = useState("auto");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [res, setRes] = useState<{ by: string; results: Result[] } | null>(null);
  const search = useFormSubmit(
    () => api<{ by: string; results: Result[] }>("GET", `/api/v1/citizens/search?${new URLSearchParams({ q, by, includeArchived: includeArchived ? "1" : "" })}`),
    setRes,
  );

  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={search.submit} className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم، رقم هوية، هاتف، أو رقم المواطن" className="min-w-0 flex-1 text-base" aria-label="كلمة البحث" autoFocus />
          <Select value={by} onChange={(e) => setBy(e.target.value)} className="w-36" aria-label="نوع البحث">
            <option value="auto">تلقائي</option>
            {Object.entries(BY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Button type="submit" loading={search.busy}><Search className="size-4" /> بحث</Button>
          <IdCamera onConfirm={(id) => { setQ(id); setBy("nationalId"); }} />
          <label className="flex w-full items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="size-4" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> تضمين المؤرشفين
          </label>
        </form>
        {search.error && <Alert tone="danger" className="mt-3">{search.error}</Alert>}
      </Card>

      {res && (
        res.results.length === 0 ? (
          <EmptyState>
            لا نتائج (بحث حسب {BY_LABELS[res.by]}).{" "}
            <Link className="text-primary hover:underline" href={`/d/review-cases?new=1&${res.by === "nationalId" ? `nationalId=${encodeURIComponent(q)}` : `fullName=${encodeURIComponent(q)}`}`}>
              المواطن حاضر وغير موجود في الكشف؟ سجّل حالة للمراجعة
            </Link>
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            <li className="text-xs text-muted">بحث حسب {BY_LABELS[res.by]} — {res.results.length} نتيجة</li>
            {res.results.map((r) => (
              <li key={r.id}>
                <Link href={`/d/citizens/${r.id}`} className="block rounded-xl border border-border bg-surface p-4 hover:border-primary">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{r.fullName}</span>
                    <span className="flex gap-1">
                      {r.archived && <Badge>مؤرشف</Badge>}
                      {r.current ? <Badge tone="success">مستحق في {r.current.cycleName}</Badge> : <Badge tone="warning">لا استحقاق في الدورة النشطة</Badge>}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                    <span>الهوية: <bdi dir="ltr">{r.nationalId}</bdi></span>
                    {r.phone && <span>الهاتف: <bdi dir="ltr">{r.phone}</bdi></span>}
                    {r.current && (
                      <>
                        <span className="font-semibold text-text">رقم المواطن: <bdi dir="ltr">{r.current.citizenNumber}</bdi></span>
                        <span>الجرار: {r.current.quantity}</span>
                        <span>المطلوب: {formatMoney(r.current.amountDue)}</span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
