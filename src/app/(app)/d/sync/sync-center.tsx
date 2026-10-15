"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CloudOff, Download, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Card, DetailList, EmptyState } from "@/components/ui";
import { useOffline } from "@/components/offline-provider";
import { dismissOp, foreignUnsyncedCount } from "@/lib/offline/engine";
import type { OpStatus, QueuedOp } from "@/lib/offline/logic";
import { formatDateTime, formatMoney, isolate } from "@/lib/format";

const STATUS: Record<OpStatus, { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  local: { label: "على الجهاز", tone: "neutral" },
  pending: { label: "بانتظار الإرسال", tone: "warning" },
  synced: { label: "وصلت", tone: "success" },
  review: { label: "بدها مراجعة", tone: "danger" },
};

function describe(op: QueuedOp) {
  if (op.kind === "receive") return <>استلام جرة فارغة <bdi dir="ltr" className="font-semibold">{op.meta.label}</bdi></>;
  if (op.kind === "deliver") return <>تسليم الجرة <bdi dir="ltr" className="font-semibold">{op.meta.label}</bdi></>;
  return <>تحصيل {formatMoney(op.meta.amount ?? "0")}</>;
}

export function SyncCenter() {
  const o = useOffline();
  const [foreign, setForeign] = useState(0);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");

  useEffect(() => {
    if (o?.enabled) foreignUnsyncedCount(o.userId).then(setForeign).catch(() => {});
  }, [o?.enabled, o?.userId, o?.ops]);

  if (!o?.enabled) return <EmptyState>العمل دون اتصال غير متاح على هذا المتصفح (التخزين المحلي غير متاح، مثل التصفح الخاص).</EmptyState>;

  const shown = o.ops
    .filter((op) => filter === "all" || op.status === "local" || op.status === "pending" || (op.status === "review" && !op.dismissed))
    .slice()
    .reverse();
  const snap = o.snapshot;
  const policy = snap?.snapshot.policy;

  return (
    <div className="space-y-4">
      {!o.online && (
        <Alert tone="warning"><CloudOff className="me-1 inline size-4" />لا يوجد اتصال الآن. العمليات محفوظة على الجهاز وتُرسل تلقائيًا عند عودة الاتصال.</Alert>
      )}
      {o.authNeeded && (
        <Alert tone="danger">
          انتهت الجلسة، فتوقفت المزامنة. <Link className="underline" href="/login">سجّل الدخول</Link> بالحساب نفسه لإكمالها؛ العمليات لن تُحذف.
        </Alert>
      )}
      {foreign > 0 && (
        <Alert tone="warning">على هذا الجهاز {foreign} عملية لم تُرسل بعد لحساب آخر. لا تظهر هنا، وتُرسل عند دخول صاحبها من هذا الجهاز.</Alert>
      )}
      {msg && <Alert tone="success">{msg}</Alert>}

      <Card
        title="الحالة"
        actions={
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={o.syncing}
              onClick={async () => {
                setMsg("");
                const r = await o.sync();
                if (r) {
                  setMsg(
                    r.offline ? "لا يوجد اتصال؛ ستُعاد المحاولة تلقائيًا."
                      : r.authNeeded ? ""
                      : r.synced || r.review ? `تم الإرسال: ${r.synced} وصلت${r.review ? `، ${r.review} بدها مراجعة` : ""}.`
                      : "لا توجد عمليات بانتظار الإرسال.",
                  );
                }
              }}
            >
              <RefreshCw className="size-4" /> إرسال الآن
            </Button>
            <Button size="sm" variant="secondary" onClick={async () => { setMsg(""); await o.refresh(); setMsg("حُدّثت بيانات الجهاز."); }}>
              <Download className="size-4" /> تحديث بيانات الجهاز
            </Button>
          </span>
        }
      >
        <DetailList
          items={[
            ["الاتصال", o.online ? "متصل" : "دون اتصال"],
            ["بانتظار الإرسال", String(o.unsynced)],
            ["بدها مراجعة", String(o.review)],
            ["بيانات الجهاز للعمل دون اتصال", snap ? <span key="s">{snap.snapshot.citizens.length} مواطنًا · آخر تحديث <bdi dir="ltr">{formatDateTime(snap.fetchedAt)}</bdi></span> : "غير موجودة (تُنزّل تلقائيًا عند الاتصال)"],
            ["المسموح دون اتصال", policy ? [policy.receive && "استلام الفارغ", policy.deliver && "التسليم", policy.payments && "التحصيل"].filter(Boolean).join("، ") || "لا شيء" : "—"],
            ["صلاحية بيانات الجهاز", policy ? `${policy.maxAgeHours} ساعة من آخر تحديث، ثم تُحذف` : "—"],
          ]}
        />
      </Card>

      <Card
        title="العمليات على هذا الجهاز"
        actions={
          <span className="flex gap-1 text-sm">
            <Button size="sm" variant={filter === "open" ? "primary" : "ghost"} onClick={() => setFilter("open")}>غير المنجزة</Button>
            <Button size="sm" variant={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")}>الكل</Button>
          </span>
        }
      >
        {shown.length === 0 ? (
          <EmptyState>{filter === "open" ? "كل العمليات وصلت للخادم، ما في شي معلّق." : "ما في عمليات على هذا الجهاز."}</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((op) => (
              <li key={op.id} className="py-3 text-sm" data-op-status={op.status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {describe(op)} — {op.meta.name} <span className="text-muted">(<bdi dir="ltr">{op.meta.nationalId}</bdi>، {op.meta.cycleName})</span>
                  </span>
                  <span className="flex items-center gap-1">
                    {op.offline && <Badge>نُفذت دون اتصال</Badge>}
                    <Badge tone={STATUS[op.status].tone}>{STATUS[op.status].label}</Badge>
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  على الجهاز: <bdi dir="ltr">{formatDateTime(op.createdAt)}</bdi>
                  {op.syncedAt && <> · أكدها الخادم: <bdi dir="ltr">{formatDateTime(op.syncedAt)}</bdi></>}
                  {op.attempts > 0 && op.status !== "synced" && <> · محاولات: {op.attempts}</>}
                </div>
                {op.status === "pending" && op.lastError && <div className="mt-1 text-xs text-warning">آخر محاولة: {op.lastError}</div>}
                {op.status === "review" && (
                  <div className="mt-2 rounded-lg bg-danger-soft p-2 text-xs text-danger">
                    رفض الخادم العملية: {op.lastError}
                    <div className="mt-1 text-text">
                      سُجلت حالة في <Link className="text-primary underline" href="/d/review-cases">مشاكل بدها حل</Link>. عالجها يدويًا
                      {op.kind === "receive" && op.meta.label && <> (الجرة التي كُتب عليها {isolate(op.meta.label)} لم تُسجل في النظام)</>}، ثم أخفها من هنا.
                    </div>
                    {!op.dismissed && (
                      <Button size="sm" variant="secondary" className="mt-2" onClick={async () => { await dismissOp(o.userId, op.id); await o.reload(); }}>
                        عولجت — إخفاء
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="ما يعمل دون اتصال">
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
          <li>صفحة «الكشف»: البحث، و«سلّم» و«دفع»، حسب ما يسمح به مدير النظام.</li>
          <li>كل عملية تحمل معرّفًا فريدًا؛ إعادة إرسالها لا تكرر أثرها، والجهاز لا يكرر استلامًا أو تسليمًا أو تحصيلًا ينتظر المزامنة.</li>
          <li>الخادم يعيد التحقق من كل عملية. ما يرفضه (مثل جرة سُلّمت من جهاز آخر) يصبح «بدها مراجعة» ولا يُحسم تلقائيًا.</li>
          <li>تتطلب اتصالًا دائمًا: الكشوفات، والتعبئة ونقلات المحطة، وإلغاء العمليات، والمصاريف، والتقارير، والإعدادات.</li>
          <li>بيانات الجهاز مشفّرة، وتُحذف عند الخروج أو بعد انتهاء صلاحيتها. العمليات اللي ما وصلت تبقى حتى تُرسل.</li>
        </ul>
      </Card>
    </div>
  );
}
