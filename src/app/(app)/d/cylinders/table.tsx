"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flame } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui";
import { ApiError, useApi } from "@/components/api-client";
import { CylinderStatusBadge } from "@/components/cylinder-status";
import { formatDateTime } from "@/lib/format";

type Row = { id: string; label: string; status: string; name: string; nationalId: string; citizenId: string; cycleName: string; removed: boolean; updatedAt: string };

export function CylinderTable({ rows, selectable }: { rows: Row[]; selectable: boolean }) {
  const api = useApi();
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // معرّفات ثابتة لكل جرة في هذه المحاولة؛ إعادة الإرسال بعد انقطاع لا تكرر التعبئة.
  const keys = useRef(new Map<string, string>());

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const fill = async () => {
    setBusy(true);
    setError("");
    setDone("");
    const items = [...sel].map((cylinderId) => {
      if (!keys.current.has(cylinderId)) keys.current.set(cylinderId, crypto.randomUUID());
      return { clientOpId: keys.current.get(cylinderId)!, cylinderId };
    });
    try {
      const r = await api<{ filled: number; replayed: number }>("POST", "/api/v1/operations/fill", { items });
      keys.current.clear();
      setSel(new Set());
      setDone(`عُبئت ${r.filled} جرة.`);
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "NETWORK")) keys.current.clear();
      setError(e instanceof Error ? e.message : "تعذرت التعبئة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      {selectable && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
          <Button size="sm" variant="secondary" onClick={() => setSel(new Set(rows.map((r) => r.id)))}>تحديد الكل في الصفحة</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>إلغاء التحديد</Button>
          <Button size="sm" disabled={!sel.size} loading={busy} onClick={fill}><Flame className="size-4" /> تعبئة المحدد ({sel.size})</Button>
          <span className="text-xs text-muted">للجرار التي وصلت معبأة ضمن نقلة من محطة، سجّلها من صفحة النقلات.</span>
        </div>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {selectable && <input type="checkbox" className="size-5" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`تحديد ${r.label}`} />}
            <Link href={`/d/cylinders/${r.id}`} className="min-w-20 text-lg font-bold text-primary hover:underline"><bdi dir="ltr">{r.label}</bdi></Link>
            <div className="min-w-0 flex-1 text-sm">
              <Link href={`/d/citizens/${r.citizenId}`} className="font-medium hover:underline">{r.name}</Link>
              <div className="text-xs text-muted"><bdi dir="ltr">{r.nationalId}</bdi> · {r.cycleName} · {formatDateTime(r.updatedAt)}</div>
            </div>
            <span className="flex gap-1">
              {r.removed && <Badge tone="danger">أُزيل من الكشف</Badge>}
              <CylinderStatusBadge status={r.status} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
