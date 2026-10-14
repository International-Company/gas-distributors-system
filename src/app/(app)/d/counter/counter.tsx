"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Banknote, CheckCircle2, CloudOff, PackageCheck, PackageOpen, Search } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from "@/components/ui";
import { Modal } from "@/components/modal";
import { IdCamera } from "@/components/id-camera";
import { ApiError, useApi } from "@/components/api-client";
import { CylinderStatusBadge } from "@/components/cylinder-status";
import { PaymentDialog } from "@/components/payment-dialog";
import { useOffline } from "@/components/offline-provider";
import { formatDateTime, formatMoney, isolate } from "@/lib/format";
import { isValidNationalId } from "@/lib/national-id";
import { ENDPOINTS, listOps, loadSnapshot, SendError, submit, type SubmitResult } from "@/lib/offline/engine";
import {
  applyOverlay, checkDeliver, checkPayment, checkReceive, lookupFromSnapshot, nextCylinder,
  type Cyl, type Ent, type Lookup, type OpKind, type Policy, type QueuedOp,
} from "@/lib/offline/logic";

type Method = "MANUAL_ENTRY" | "ID_SCAN";
type Source = { kind: "server" } | { kind: "local"; fetchedAt: string; generatedAt: string; policy: Policy };
type Notice = { tone: "success" | "warning"; text: string };

const KIND_NAMES: Record<OpKind, string> = { receive: "استلام الفارغ", deliver: "التسليم", payment: "التحصيل" };

export function Counter() {
  const api = useApi();
  const off = useOffline();
  const [nid, setNid] = useState("");
  const [method, setMethod] = useState<Method>("MANUAL_ENTRY");
  const [data, setData] = useState<Lookup | null>(null);
  const base = useRef<Lookup | null>(null);
  const [source, setSource] = useState<Source>({ kind: "server" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deliverFor, setDeliverFor] = useState<Cyl | null>(null);
  const [payFor, setPayFor] = useState<Ent | null>(null);
  const [emptyWeight, setEmptyWeight] = useState<Record<string, string>>({});

  const offlineOn = Boolean(off?.enabled);
  // فتح الشباك متصلًا يحدّث بيانات الجهاز، لتكون جاهزة إن انقطع الاتصال أثناء العمل.
  const refreshSnapshot = off?.refresh;
  useEffect(() => {
    if (offlineOn && navigator.onLine) void refreshSnapshot?.();
  }, [offlineOn, refreshSnapshot]);
  const local = source.kind === "local" ? source : null;
  const allowed = (k: OpKind) => !local || local.policy[k === "payment" ? "payments" : k];
  const currentOps = async () => (offlineOn ? await listOps(off!.userId).catch(() => [] as QueuedOp[]) : []);
  /** يعيد عرض البيانات الأساسية مع العمليات غير المتزامنة (دون جلبها من جديد). */
  const redraw = async () => {
    if (base.current) setData(applyOverlay(base.current, await currentOps()));
  };

  const lookup = async (id = nid) => {
    setError("");
    setNotice(null);
    setBusy("lookup");
    try {
      const r = await api<Lookup>("GET", `/api/v1/counter/lookup?nationalId=${encodeURIComponent(id)}`);
      base.current = r;
      setSource({ kind: "server" });
      setData(applyOverlay(r, await currentOps()));
    } catch (e) {
      const unreachable = e instanceof ApiError && (e.code === "NETWORK" || e.status >= 500);
      const info = unreachable && offlineOn ? await loadSnapshot(off!.userId).catch(() => null) : null;
      if (info) {
        // لا اتصال: البحث في بيانات الجهاز.
        const r = lookupFromSnapshot(info.snapshot, id);
        base.current = r;
        setSource({ kind: "local", fetchedAt: info.fetchedAt, generatedAt: info.snapshot.generatedAt, policy: info.snapshot.policy });
        setData(applyOverlay(r, await currentOps()));
      } else {
        base.current = null;
        setData(null);
        setError(
          unreachable && offlineOn
            ? "لا يوجد اتصال بالخادم، ولا توجد على هذا الجهاز بيانات صالحة للعمل دون اتصال. اتصل بالإنترنت ليُنزّلها النظام تلقائيًا."
            : e instanceof Error ? e.message : "تعذر البحث",
        );
      }
    } finally {
      setBusy("");
    }
  };

  /** تنفيذ عملية عبر قائمة الجهاز (أو مباشرة إن تعذر التخزين المحلي، كالتصفح الخاص). */
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

  const newOp = (kind: OpKind, e: Ent, payload: Record<string, unknown>, meta: Partial<QueuedOp["meta"]>): QueuedOp => ({
    id: crypto.randomUUID(),
    kind,
    userId: off?.userId ?? "",
    createdAt: new Date().toISOString(),
    status: "local",
    offline: Boolean(local),
    snapshotAt: local ? local.generatedAt : null,
    attempts: 0,
    payload,
    meta: {
      nationalId: data?.nationalId ?? "",
      name: data?.found ? data.citizen.fullName : "",
      cycleName: e.cycle.name,
      entitlementId: e.id,
      ...meta,
    },
  });

  const run = async (slot: string, fn: () => Promise<Notice | null>) => {
    setError("");
    setNotice(null);
    setBusy(slot);
    try {
      const n = await fn();
      // مؤكدة من الخادم وهو متاح: تحديث من الخادم. محفوظة على الجهاز: إعادة العرض من البيانات الحالية.
      if (source.kind === "server" && n?.tone === "success") await lookup(data?.nationalId ?? nid);
      else await redraw();
      if (n) setNotice(n);
      void off?.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تنفيذ العملية");
      if (e instanceof ApiError && e.code === "IDENTITY_MISMATCH") {
        base.current = null;
        setData(null);
      }
    } finally {
      setBusy("");
    }
  };

  const outcome = (r: SubmitResult, synced: (result: unknown) => string, queued: string): Notice => {
    if (r.state === "synced") return { tone: "success", text: synced(r.result) };
    if (r.state === "review") throw new Error(`رفض الخادم العملية: ${r.message}`);
    return { tone: "warning", text: queued };
  };

  const receive = (e: Ent) =>
    run(`receive-${e.id}`, async () => {
      if (local) {
        if (!allowed("receive")) throw new Error("استلام الجرار دون اتصال غير مسموح في إعدادات النظام");
        const err = checkReceive(e);
        if (err) throw new Error(err);
      }
      const { seq, label } = nextCylinder(e);
      const op = newOp(
        "receive", e,
        { entitlementId: e.id, nationalId: data?.nationalId, identityMethod: method, weightKg: emptyWeight[e.id] || null, expectedLabel: label },
        { label, seq },
      );
      const r = await send(op);
      setEmptyWeight((w) => ({ ...w, [e.id]: "" }));
      return outcome(
        r,
        (res) => `سُجل استلام الجرة الفارغة. اكتب الرقم ${isolate((res as { cylinder?: { label: string } })?.cylinder?.label ?? label)} على الجرة.`,
        `حُفظ الاستلام على هذا الجهاز ولم يتأكد من الخادم بعد (بانتظار المزامنة). اكتب الرقم ${isolate(label)} على الجرة.`,
      );
    });

  const deliver = (e: Ent, c: Cyl, label: string, weightKg: string) =>
    run(`deliver-${c.id}`, async () => {
      if (local) {
        if (!allowed("deliver")) throw new Error("تسليم الجرار دون اتصال غير مسموح في إعدادات النظام");
        const err = checkDeliver(c, label);
        if (err) throw new Error(err);
      }
      const op = newOp(
        "deliver", e,
        { cylinderId: c.id, cylinderLabel: label, nationalId: data?.nationalId, identityMethod: method, weightKg: weightKg || null },
        { cylinderId: c.id, label: c.label },
      );
      const r = await send(op);
      const mayHandOver = local || off?.snapshot?.snapshot.policy.deliver;
      return outcome(
        r,
        () => `سُلّمت الجرة ${isolate(c.label)}.`,
        mayHandOver
          ? `حُفظ تسليم الجرة ${isolate(c.label)} على هذا الجهاز (بانتظار المزامنة).`
          : `لم يصل تأكيد الخادم لتسليم الجرة ${isolate(c.label)}. لا تسلّمها حتى يظهر التسليم «متزامنًا» في قائمة المزامنة؛ تُعاد المحاولة تلقائيًا.`,
      );
    });

  const pay = async (e: Ent, v: { full: boolean; amount?: string; notes: string }) => {
    const amount = v.full ? e.amountRemaining : (v.amount ?? "");
    if (local) {
      if (!allowed("payment")) throw new Error("التحصيل دون اتصال غير مسموح في إعدادات النظام");
      const err = checkPayment(e, amount);
      if (err) throw new Error(err);
    }
    const op = newOp("payment", e, { entitlementId: e.id, full: false, amount, notes: v.notes }, { amount });
    let r: SubmitResult;
    try {
      r = await send(op);
    } catch (err) {
      throw err instanceof Error ? err : new Error("تعذر تسجيل التحصيل");
    }
    const n = outcome(
      r,
      (res) => {
        const x = res as { amount: string; remaining: string };
        return `سُجل تحصيل ${formatMoney(x.amount)}. المتبقي: ${formatMoney(x.remaining)}`;
      },
      `حُفظ تحصيل ${formatMoney(amount)} على هذا الجهاز (بانتظار المزامنة).`,
    );
    return { message: n.text, tone: n.tone };
  };

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMethod("MANUAL_ENTRY");
            lookup();
          }}
        >
          <Input
            dir="ltr"
            inputMode="numeric"
            value={nid}
            onChange={(e) => setNid(e.target.value.replace(/\D/g, "").slice(0, 9))}
            placeholder="رقم الهوية من البطاقة"
            className="w-full min-w-0 basis-full text-center text-lg tracking-widest sm:basis-auto sm:flex-1"
            aria-label="رقم الهوية"
            autoFocus
          />
          <Button type="submit" loading={busy === "lookup"} disabled={nid.length !== 9}><Search className="size-4" /> بحث</Button>
          <IdCamera onConfirm={(id, m) => { setNid(id); setMethod(m); lookup(id); }} />
        </form>
        {nid.length === 9 && !isValidNationalId(nid) && <p className="mt-2 text-xs text-danger">رقم الهوية غير صالح (رقم التحقق لا يطابق)</p>}
      </Card>

      {local && (
        <Alert tone="warning">
          <CloudOff className="me-1 inline size-4" />
          <strong>دون اتصال:</strong> تعمل ببيانات محفوظة على هذا الجهاز (آخر تحديث <bdi dir="ltr">{formatDateTime(local.fetchedAt)}</bdi>).
          العمليات تُحفظ على الجهاز وتُرسل عند عودة الاتصال، والخادم يعيد التحقق منها، وأي تعارض يظهر في <Link href="/d/sync" className="underline">قائمة المزامنة</Link>.
          {" "}المسموح دون اتصال: {(["receive", "deliver", "payment"] as OpKind[]).filter(allowed).map((k) => KIND_NAMES[k]).join("، ") || "لا شيء"}.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && (
        <Alert tone={notice.tone === "success" ? "success" : "warning"}>
          {notice.tone === "success" && <CheckCircle2 className="me-1 inline size-4" />}
          {notice.text}
        </Alert>
      )}

      {data && !data.found && (
        <EmptyState>
          {local ? (
            "لا يوجد مواطن بهذا الرقم في بيانات الجهاز. تحقق عند عودة الاتصال."
          ) : (
            <>
              لا يوجد مواطن بهذا الرقم في الكشوف المعتمدة.{" "}
              <Link className="text-primary hover:underline" href={`/d/review-cases?new=1&nationalId=${data.nationalId}`}>تسجيل حالة للمراجعة</Link>
            </>
          )}
        </EmptyState>
      )}

      {data?.found && (
        <>
          <Card title={data.citizen.fullName} actions={!local && <Link href={`/d/citizens/${data.citizen.id}`} className="text-sm text-primary hover:underline">ملف المواطن</Link>}>
            <Alert tone="warning">تأكد أن صورة البطاقة تطابق الشخص الحاضر قبل أي عملية.</Alert>
            <div className="mt-2 text-sm text-muted">الهوية: <bdi dir="ltr">{data.nationalId}</bdi>{data.citizen.phone && <> · الهاتف: <bdi dir="ltr">{data.citizen.phone}</bdi></>}</div>
            <div className="mt-1 text-sm">إجمالي المتبقي عبر الدورات: <strong>{formatMoney(data.totalRemaining)}</strong></div>
          </Card>
          {data.entitlements.length === 0 && <EmptyState>لا يوجد استحقاق في الدورة النشطة ولا جرار معلقة لهذا المواطن.</EmptyState>}
          {data.entitlements.map((e) => (
            <Card
              key={e.id}
              title={<span>{e.cycle.name} — رقم المواطن <bdi dir="ltr" className="text-primary">{e.citizenNumber}</bdi></span>}
              actions={
                <span className="flex gap-1">
                  {e.cycle.status !== "OPEN" && <Badge>دورة مغلقة</Badge>}
                  {e.status !== "ACTIVE" && <Badge tone="danger">أُزيل من الكشف</Badge>}
                </span>
              }
            >
              <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                <span>المستحق: {e.quantity} جرة</span>
                <span>لم تُستلم بعد: {e.remaining}</span>
                <span>المطلوب: {formatMoney(e.amountDue)}</span>
                <span>المدفوع: {formatMoney(e.paid)}</span>
                <span className={Number(e.amountRemaining) > 0 ? "font-semibold text-warning" : "text-success"}>المتبقي: {formatMoney(e.amountRemaining)}</span>
              </div>
              {e.cylinders.length > 0 && (
                <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
                  {e.cylinders.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="text-lg font-bold"><bdi dir="ltr">{c.label}</bdi></span>
                        <CylinderStatusBadge status={c.status} />
                        {c.local && <Badge tone="warning">بانتظار المزامنة</Badge>}
                      </span>
                      {c.status === "FILLED" && allowed("deliver") && (
                        <Button size="sm" onClick={() => setDeliverFor(c)}><PackageCheck className="size-4" /> تسليم</Button>
                      )}
                      {c.status !== "FILLED" && !c.local && !local && <Link href={`/d/cylinders/${c.id}`} className="text-xs text-primary hover:underline">السجل</Link>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {e.canReceive && allowed("receive") && (
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    className="w-36 text-center"
                    placeholder="الوزن فارغة (كغ)"
                    aria-label="وزن الجرة فارغة بالكيلوغرام (اختياري)"
                    value={emptyWeight[e.id] ?? ""}
                    onChange={(ev) => setEmptyWeight((w) => ({ ...w, [e.id]: ev.target.value }))}
                  />
                )}
                {e.canReceive && allowed("receive") && (
                  <Button variant="secondary" loading={busy === `receive-${e.id}`} onClick={() => receive(e)}>
                    <PackageOpen className="size-4" /> استلام جرة فارغة {e.quantity > 1 && `(${e.quantity - e.remaining + 1} من ${e.quantity})`}
                  </Button>
                )}
                {e.canPay && allowed("payment") && (
                  <Button variant="secondary" onClick={() => { setNotice(null); setError(""); setPayFor(e); }}>
                    <Banknote className="size-4" /> تحصيل
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </>
      )}

      {payFor && data?.found && (
        <PaymentDialog
          entitlementId={payFor.id}
          title={`${data.citizen.fullName} — ${payFor.cycle.name}`}
          remaining={payFor.amountRemaining}
          onClose={() => setPayFor(null)}
          submitOverride={(v) => pay(payFor, v)}
          onDone={async (msg, tone) => {
            setPayFor(null);
            if (source.kind === "server" && tone !== "warning") await lookup(data.nationalId);
            else await redraw();
            setNotice({ tone: tone ?? "success", text: msg });
            void off?.reload();
          }}
        />
      )}

      {deliverFor && data?.found && (
        <DeliverDialog
          cylinder={deliverFor}
          busy={busy === `deliver-${deliverFor.id}`}
          onClose={() => setDeliverFor(null)}
          onConfirm={(label, weightKg) => {
            const c = deliverFor;
            const e = data.entitlements.find((x) => x.cylinders.some((y) => y.id === c.id));
            setDeliverFor(null);
            if (e) void deliver(e, c, label, weightKg);
          }}
        />
      )}
    </div>
  );
}

function DeliverDialog({ cylinder, busy, onClose, onConfirm }: { cylinder: Cyl; busy: boolean; onClose: () => void; onConfirm: (label: string, weightKg: string) => void }) {
  const [label, setLabel] = useState("");
  const [weightKg, setWeightKg] = useState("");
  void cylinder;
  return (
    <Modal open onClose={onClose} title="تسليم جرة معبأة">
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(label, weightKg); }} className="space-y-4">
        <Alert>اقرأ الرقم المكتوب على الجرة نفسها واكتبه هنا. يجب أن يطابق رقمها في النظام.</Alert>
        <Field label="الرقم المكتوب على الجرة" htmlFor="dl-label">
          <Input id="dl-label" dir="ltr" inputMode="numeric" className="text-center text-lg" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus required />
        </Field>
        <Field label="وزن الجرة ممتلئة (كغ، اختياري)" htmlFor="dl-weight">
          <Input id="dl-weight" dir="ltr" inputMode="decimal" className="text-center" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">التسليم مستقل عن الدفع.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={busy}>تأكيد التسليم</Button>
        </div>
      </form>
    </Modal>
  );
}
