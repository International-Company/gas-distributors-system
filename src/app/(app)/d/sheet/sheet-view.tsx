"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Banknote, CheckCircle2, CloudOff, PackageCheck, Search, Undo2, Upload } from "lucide-react";
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Textarea, buttonClass, cn } from "@/components/ui";
import { Modal } from "@/components/modal";
import { IdCamera } from "@/components/id-camera";
import { ApiError, useApi } from "@/components/api-client";
import { PaymentDialog } from "@/components/payment-dialog";
import { useOffline } from "@/components/offline-provider";
import { formatDateTime, formatMoney } from "@/lib/format";
import { normalizeDigits, normalizeName } from "@/lib/arabic";
import { ENDPOINTS, listOps, loadSnapshot, SendError, submit, type SubmitResult } from "@/lib/offline/engine";
import { applySheetOverlay, sheetFromSnapshot, toCents, fromCents, type OpKind, type Policy, type QueuedOp, type SheetRow } from "@/lib/offline/logic";

type Statement = { id: string; title: string; version?: number; cycleName?: string | null; cycleId?: string | null };
type Data = { statements: Statement[]; statement: Statement | null; rows: SheetRow[]; pending: number };
type Source = { kind: "server" } | { kind: "local"; fetchedAt: string; generatedAt: string; policy: Policy };
type Notice = { tone: "success" | "warning"; text: string };
type Filter = "all" | "notDelivered" | "owes" | "done";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "notDelivered", label: "ما استلم" },
  { key: "owes", label: "عليه فلوس" },
  { key: "done", label: "خالص" },
];
const PAGE = 100;

/**
 * «الكشف»: ناس الكشف المختار، وبجانب كل شخص «سلّم» و«دفع».
 * يعمل دون اتصال من بيانات الجهاز، والعمليات تُحفظ وتُرسل عند عودة الاتصال (لا نجاح قبل تأكيد الخادم).
 */
export function SheetView() {
  const api = useApi();
  const off = useOffline();
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("s") ?? "";
  const [data, setData] = useState<Data | null>(null);
  const base = useRef<SheetRow[]>([]);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [source, setSource] = useState<Source>({ kind: "server" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [deliverFor, setDeliverFor] = useState<SheetRow | null>(null);
  const [payFor, setPayFor] = useState<SheetRow | null>(null);
  const [cancelFor, setCancelFor] = useState<SheetRow | null>(null);

  const offlineOn = Boolean(off?.enabled);
  const local = source.kind === "local" ? source : null;
  const allowed = (k: "deliver" | "payments") => !local || local.policy[k];
  const currentOps = useCallback(async () => (offlineOn ? await listOps(off!.userId).catch(() => [] as QueuedOp[]) : []), [offlineOn, off]);

  const load = useCallback(async (sid: string) => {
    setLoading(true);
    setError("");
    try {
      const d = await api<Data>("GET", `/api/v1/sheet${sid ? `?statementId=${sid}` : ""}`);
      base.current = d.rows;
      setSource({ kind: "server" });
      setData(d);
      setRows(applySheetOverlay(d.rows, await currentOps()));
    } catch (e) {
      const unreachable = e instanceof ApiError && (e.code === "NETWORK" || e.status >= 500);
      const info = unreachable && offlineOn ? await loadSnapshot(off!.userId).catch(() => null) : null;
      if (info) {
        const statements = info.snapshot.statements ?? [];
        const current = statements.find((s) => s.id === sid) ?? statements[0] ?? null;
        const r = current ? sheetFromSnapshot(info.snapshot, current.id) : [];
        base.current = r;
        setSource({ kind: "local", fetchedAt: info.fetchedAt, generatedAt: info.snapshot.generatedAt, policy: info.snapshot.policy });
        setData({ statements, statement: current, rows: r, pending: 0 });
        setRows(applySheetOverlay(r, await currentOps()));
      } else {
        setData(null);
        setError(
          unreachable && offlineOn
            ? "ما في اتصال بالخادم، ولا في بيانات محفوظة على هذا الجهاز. اتصل بالإنترنت مرة ليُنزّلها النظام تلقائيًا."
            : e instanceof Error ? e.message : "تعذر تحميل الكشف",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [api, offlineOn, off, currentOps]);

  useEffect(() => {
    void load(wanted);
  }, [wanted, load]);

  // فتح الكشف متصلًا يحدّث بيانات الجهاز، لتكون جاهزة إن انقطع الاتصال أثناء العمل.
  const refreshSnapshot = off?.refresh;
  useEffect(() => {
    if (offlineOn && navigator.onLine) void refreshSnapshot?.();
  }, [offlineOn, refreshSnapshot]);

  // أي تغيير في قائمة الجهاز (إرسال، مزامنة من تبويب آخر) يُعاد تطبيقه على العرض.
  useEffect(() => {
    if (off?.ops) setRows(applySheetOverlay(base.current, off.ops));
  }, [off?.ops]);

  const shown = useMemo(() => {
    const needle = normalizeName(normalizeDigits(q.trim()));
    const digits = normalizeDigits(q).replace(/\D/g, "");
    return rows.filter((r) => {
      if (filter === "notDelivered" && r.delivered) return false;
      if (filter === "owes" && toCents(r.remaining) <= 0) return false;
      if (filter === "done" && !(r.delivered && toCents(r.remaining) <= 0)) return false;
      if (!needle) return true;
      return (digits && (r.nationalId.includes(digits) || r.citizenNumber.replace(/\D/g, "").startsWith(digits))) || r.citizenNumber === q.trim() || normalizeName(r.name).includes(needle);
    });
  }, [rows, q, filter]);

  const stats = useMemo(() => ({
    people: rows.length,
    delivered: rows.filter((r) => r.delivered).length,
    paid: fromCents(rows.reduce((a, r) => a + toCents(r.paid), 0)),
    remaining: fromCents(rows.reduce((a, r) => a + toCents(r.remaining), 0)),
  }), [rows]);

  // ---------------------------------------------------------------------------
  // العمليات
  // ---------------------------------------------------------------------------

  const send = async (op: QueuedOp): Promise<SubmitResult> => {
    if (!offlineOn) return { state: "synced", result: await api("POST", ENDPOINTS[op.kind], { ...op.payload, clientOpId: op.id }) };
    try {
      return await submit(op);
    } catch (e) {
      if (e instanceof SendError) throw new ApiError(e.code, e.message, {}, e.status);
      if (local) throw new Error("تعذر الحفظ على هذا الجهاز؛ لا يمكن العمل دون اتصال");
      return { state: "synced", result: await api("POST", ENDPOINTS[op.kind], { ...op.payload, clientOpId: op.id }) };
    }
  };

  const newOp = (kind: OpKind, r: SheetRow, payload: Record<string, unknown>, amount?: string): QueuedOp => ({
    id: crypto.randomUUID(),
    kind,
    userId: off?.userId ?? "",
    createdAt: new Date().toISOString(),
    status: "local",
    offline: Boolean(local),
    snapshotAt: local ? local.generatedAt : null,
    attempts: 0,
    payload,
    meta: { nationalId: r.nationalId, name: r.name, cycleName: data?.statement?.title ?? "", entitlementId: r.id, amount },
  });

  const after = async (n: Notice) => {
    if (source.kind === "server" && n.tone === "success") await load(data?.statement?.id ?? "");
    else setRows(applySheetOverlay(base.current, await currentOps()));
    setNotice(n);
    void off?.reload();
  };

  const deliver = async (r: SheetRow, nationalId: string, method: "MANUAL_ENTRY" | "ID_SCAN") => {
    if (normalizeDigits(nationalId).replace(/\D/g, "") !== r.nationalId) throw new Error("رقم الهوية المكتوب لا يطابق هوية هذا الشخص. تأكد من البطاقة.");
    if (local && !allowed("deliver")) throw new Error("التسليم بدون نت غير مسموح في إعدادات النظام");
    const res = await send(newOp("handover", r, { entitlementId: r.id, nationalId: r.nationalId, identityMethod: method }));
    if (res.state === "review") throw new Error(`رفض الخادم التسليم: ${res.message}`);
    const mayHandOver = local || off?.snapshot?.snapshot.policy.deliver;
    await after(
      res.state === "synced"
        ? { tone: "success", text: `سُلّم ${r.name} (${r.quantity} جرة).` }
        : {
            tone: "warning",
            text: mayHandOver
              ? `حُفظ تسليم ${r.name} على هذا الجهاز (بانتظار الإرسال).`
              : `لم يصل تأكيد الخادم لتسليم ${r.name}. لا تسلّم حتى يظهر «وصلت» في «شغل بدون نت»؛ تُعاد المحاولة تلقائيًا.`,
          },
    );
  };

  const pay = async (r: SheetRow, v: { full: boolean; amount?: string; notes: string }) => {
    const amount = v.full ? r.remaining : normalizeDigits(v.amount ?? "").trim().replace(/[٫,]/g, ".");
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error("مبلغ غير صالح");
    if (toCents(amount) > toCents(r.remaining)) throw new Error(`المبلغ أكبر من المتبقي (${r.remaining})`);
    if (local && !allowed("payments")) throw new Error("القبض بدون نت غير مسموح في إعدادات النظام");
    const res = await send(newOp("payment", r, { entitlementId: r.id, full: false, amount, notes: v.notes }, amount));
    if (res.state === "review") throw new Error(`رفض الخادم الدفعة: ${res.message}`);
    const n: Notice = res.state === "synced"
      ? { tone: "success", text: `انقبض ${formatMoney(amount)} من ${r.name}.` }
      : { tone: "warning", text: `حُفظ قبض ${formatMoney(amount)} من ${r.name} على هذا الجهاز (بانتظار الإرسال).` };
    return n;
  };

  // ---------------------------------------------------------------------------

  if (loading && !data) return <p className="text-sm text-muted">جاري التحميل…</p>;

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {data && data.pending > 0 && (
        <Alert>
          عندك {data.pending} كشف بانتظار الاعتماد. <Link href="/d/statements?status=PENDING_REVIEW" className="font-semibold underline">راجعه واعتمده</Link>
        </Alert>
      )}
      {local && (
        <Alert tone="warning">
          <CloudOff className="me-1 inline size-4" />
          <strong>بدون نت:</strong> تشتغل ببيانات محفوظة على هذا الجهاز (آخر تحديث <bdi dir="ltr">{formatDateTime(local.fetchedAt)}</bdi>). «سلّم» و«دفع» تنحفظ وتنبعت لما يرجع النت.
        </Alert>
      )}

      {data && !data.statement && (
        <EmptyState>
          <span className="block">ما في كشف معتمد بعد. ارفع كشف الهيئة وراجعه واعتمده، وبعدها بتظهر أسماء الناس هون.</span>
          <Link href="/d/statements" className={buttonClass("primary", "sm", "mt-3")}><Upload className="size-4" /> ارفع كشف</Link>
        </EmptyState>
      )}

      {data?.statement && (
        <>
          {data.statements.length > 1 && (
            <Select
              aria-label="الكشف"
              value={data.statement.id}
              onChange={(e) => router.replace(`/d/sheet?s=${e.target.value}`)}
              className="w-full sm:w-96"
            >
              {data.statements.map((s) => (
                <option key={s.id} value={s.id}>{s.title}{s.cycleName ? ` — ${s.cycleName}` : ""}</option>
              ))}
            </Select>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatBox label="الناس" value={String(stats.people)} />
            <StatBox label="استلموا" value={`${stats.delivered} من ${stats.people}`} tone="text-success" />
            <StatBox label="انقبض" value={formatMoney(stats.paid)} tone="text-primary" />
            <StatBox label="باقي على الناس" value={formatMoney(stats.remaining)} tone="text-warning" />
          </div>

          <div className="sticky top-14 z-20 -mx-4 space-y-2 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
                placeholder="ابحث برقم الهوية أو الاسم أو الرقم"
                aria-label="بحث في الكشف"
                className="ps-9 text-base"
                autoFocus
              />
            </div>
            <div className="flex gap-1 overflow-x-auto" role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => { setFilter(f.key); setLimit(PAGE); }}
                  className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-sm", filter === f.key ? "bg-primary font-semibold text-primary-contrast" : "bg-surface text-muted hover:bg-surface-2")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {notice && (
            <Alert tone={notice.tone === "success" ? "success" : "warning"}>
              {notice.tone === "success" && <CheckCircle2 className="me-1 inline size-4" />}
              {notice.text}
            </Alert>
          )}

          {shown.length === 0 ? (
            <EmptyState>{q ? "ما في حدا بهذا البحث بالكشف." : "ما في حدا بهذا الفلتر."}</EmptyState>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {shown.slice(0, limit).map((r) => (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" data-row={r.id}>
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="min-w-12 shrink-0 text-lg font-bold leading-6 text-primary"><bdi dir="ltr">{r.citizenNumber}</bdi></span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-6">
                      {source.kind === "server" ? <Link href={`/d/citizens/${r.citizenId}`} className="hover:underline">{r.name}</Link> : r.name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <bdi dir="ltr">{r.nationalId}</bdi>
                      {r.quantity > 1 && <span>{r.quantity} جرار</span>}
                      <span>المطلوب {formatMoney(r.amountDue)}</span>
                      {toCents(r.paid) > 0 && <span>دفع {formatMoney(r.paid)}</span>}
                      {toCents(r.remaining) > 0 ? <span className="font-semibold text-warning">باقي {formatMoney(r.remaining)}</span> : <span className="text-success">خالص</span>}
                    </div>
                  </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
                    {r.delivered && <Badge tone="success">سُلّم ✓</Badge>}
                    {r.pending?.delivery && <Badge tone="warning">بانتظار الإرسال</Badge>}
                    {r.legacy && !r.delivered && <Badge>بالطريقة السابقة: سُلّم {r.legacy.delivered} من {r.quantity}</Badge>}
                    {!r.delivered && !r.legacy && allowed("deliver") && (
                      <Button size="sm" onClick={() => { setNotice(null); setDeliverFor(r); }}><PackageCheck className="size-4" /> سلّم</Button>
                    )}
                    {toCents(r.remaining) > 0 && allowed("payments") && (
                      <Button size="sm" variant="secondary" onClick={() => { setNotice(null); setPayFor(r); }}><Banknote className="size-4" /> دفع</Button>
                    )}
                    {r.handoverId && source.kind === "server" && (
                      <Button size="sm" variant="ghost" className="flex-none!" onClick={() => setCancelFor(r)} title="تراجع عن التسليم"><Undo2 className="size-4" /></Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {shown.length > limit && (
            <div className="text-center">
              <Button variant="secondary" onClick={() => setLimit(limit + PAGE)}>اعرض المزيد ({shown.length - limit})</Button>
            </div>
          )}
        </>
      )}

      {deliverFor && <DeliverDialog row={deliverFor} onClose={() => setDeliverFor(null)} onConfirm={async (id, m) => { await deliver(deliverFor, id, m); setDeliverFor(null); }} />}
      {payFor && (
        <PaymentDialog
          entitlementId={payFor.id}
          title={payFor.name}
          remaining={payFor.remaining}
          onClose={() => setPayFor(null)}
          submitOverride={async (v) => {
            const n = await pay(payFor, v);
            return { message: n.text, tone: n.tone };
          }}
          onDone={async (msg, tone) => {
            setPayFor(null);
            await after({ tone: tone ?? "success", text: msg });
          }}
        />
      )}
      {cancelFor && (
        <CancelDialog
          row={cancelFor}
          onClose={() => setCancelFor(null)}
          onConfirm={async (reason) => {
            await api("POST", `/api/v1/handovers/${cancelFor.handoverId}/cancel`, { reason });
            setCancelFor(null);
            await load(data?.statement?.id ?? "");
            setNotice({ tone: "success", text: `أُلغي تسليم ${cancelFor.name}.` });
          }}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums md:text-xl", tone)}>{value}</div>
    </div>
  );
}

/** تأكيد التسليم برقم الهوية من البطاقة (لا تسليم دون مطابقة الهوية). */
function DeliverDialog({ row, onClose, onConfirm }: { row: SheetRow; onClose: () => void; onConfirm: (id: string, method: "MANUAL_ENTRY" | "ID_SCAN") => Promise<void> }) {
  const [id, setId] = useState("");
  const [method, setMethod] = useState<"MANUAL_ENTRY" | "ID_SCAN">("MANUAL_ENTRY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async (value = id, m = method) => {
    setBusy(true);
    setError("");
    try {
      await onConfirm(value, m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر التسليم");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`تسليم ${row.name}`}>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          رقم <bdi dir="ltr" className="font-bold">{row.citizenNumber}</bdi> · {row.quantity} {row.quantity > 1 ? "جرار" : "جرة"}
          {toCents(row.remaining) > 0 && <span className="text-warning"> · باقي عليه {formatMoney(row.remaining)}</span>}
        </div>
        <Field label="رقم الهوية من البطاقة" htmlFor="ho-id" hint="اكتبه من بطاقة الشخص الحاضر للتأكد قبل التسليم">
          <Input
            id="ho-id"
            dir="ltr"
            inputMode="numeric"
            className="text-center text-lg tracking-widest"
            value={id}
            onChange={(e) => { setId(e.target.value.replace(/\D/g, "").slice(0, 9)); setMethod("MANUAL_ENTRY"); }}
            autoFocus
            required
          />
        </Field>
        <IdCamera onConfirm={(v, m) => { setId(v); setMethod(m); void go(v, m); }} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>رجوع</Button>
          <Button type="submit" loading={busy} disabled={id.length !== 9}>تأكيد التسليم</Button>
        </div>
      </form>
    </Modal>
  );
}

function CancelDialog({ row, onClose, onConfirm }: { row: SheetRow; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal open onClose={onClose} title={`تراجع عن تسليم ${row.name}`}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onConfirm(reason);
          } catch (err) {
            setError(err instanceof Error ? err.message : "تعذر الإلغاء");
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Alert tone="warning">التسليم لا يُحذف: يُعلَّم «ملغى» مع السبب ويبقى في السجل.</Alert>
        <Field label="السبب" htmlFor="ho-reason"><Textarea id="ho-reason" value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>رجوع</Button>
          <Button type="submit" variant="danger" loading={busy}>تأكيد التراجع</Button>
        </div>
      </form>
    </Modal>
  );
}
