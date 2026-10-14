import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { getCitizenProfile } from "@/server/services/citizens";
import { Alert, Badge, Card, DetailList, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { CancelPayment, CitizenActions, EditEntitlement, PayButton } from "./actions";
import { CylinderStatusBadge } from "@/components/cylinder-status";

export const metadata = { title: "ملف مواطن" };

const TIMELINE: Record<string, string> = {
  ENTITLEMENT_CREATED: "اعتماد استحقاق من الكشف",
  CHANGE_STATEMENT_UPDATE: "تحديث من إصدار جديد للكشف",
  CHANGE_MANUAL_EDIT: "تعديل يدوي",
  CHANGE_MERGE: "دمج سجل",
  CHANGE_REMOVED: "أُزيل من إصدار جديد للكشف",
  PAYMENT: "تحصيل",
  PAYMENT_CANCELLED: "تحصيل (أُلغي)",
  OP_RECEIVE_EMPTY: "استلام جرة فارغة",
  OP_FILL: "تعبئة",
  OP_DELIVER: "تسليم جرة معبأة",
  OP_RECEIVE_EMPTY_CANCELLED: "استلام فارغة (أُلغي)",
  OP_FILL_CANCELLED: "تعبئة (أُلغيت)",
  OP_DELIVER_CANCELLED: "تسليم (أُلغي)",
};

export default async function CitizenPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const { id } = await params;
  const p = await getCitizenProfile(actor, id);
  const c = p.citizen;
  return (
    <div className="space-y-6">
      <PageHeader title={c.fullName} actions={c.archivedAt ? <Badge>مؤرشف</Badge> : undefined} />
      {p.mergedInto && (
        <Alert tone="warning">
          هذا السجل مدموج في <Link className="underline" href={`/d/citizens/${p.mergedInto.id}`}>{p.mergedInto.fullName} (<bdi dir="ltr">{p.mergedInto.nationalId}</bdi>)</Link>.
        </Alert>
      )}
      <Card title="البيانات الأساسية">
        <DetailList
          items={[
            ["رقم الهوية", <bdi dir="ltr" key="n">{c.nationalId}</bdi>],
            ["الهاتف", <bdi dir="ltr" key="p">{c.phone ?? "—"}</bdi>],
            ["عدد الدورات", p.entitlements.length],
            ["إجمالي المطلوب عبر الدورات", formatMoney(p.totals.due)],
            ["إجمالي المدفوع", formatMoney(p.totals.paid)],
            ["إجمالي المتبقي", <strong key="r" className={p.totals.remaining.gt(0) ? "text-warning" : "text-success"}>{formatMoney(p.totals.remaining)}</strong>],
            ...(p.mergedFrom.length ? ([["سجلات مدموجة فيه", p.mergedFrom.map((m) => `${m.fullName} (${m.nationalId})`).join("، ")]] as [string, string][]) : []),
          ]}
        />
      </Card>

      <Card title="الاستحقاقات حسب الدورة">
        {p.entitlements.length === 0 ? (
          <EmptyState>لا توجد استحقاقات.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="text-right text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 font-medium">الدورة</th>
                  <th className="py-2 font-medium">رقم المواطن</th>
                  <th className="py-2 font-medium">الجرار</th>
                  <th className="py-2 font-medium">المطلوب</th>
                  <th className="py-2 font-medium">المدفوع</th>
                  <th className="py-2 font-medium">المتبقي</th>
                  <th className="py-2 font-medium">الجرار</th>
                  <th className="py-2 font-medium">الكشف</th>
                  <th className="py-2 font-medium">الحالة</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {p.entitlements.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2">{e.cycle.name} {e.cycle.status === "OPEN" && <Badge tone="success">نشطة</Badge>}</td>
                    <td className="py-2 font-semibold"><bdi dir="ltr">{e.citizenNumber}</bdi></td>
                    <td className="py-2">{e.quantity}</td>
                    <td className="py-2">{formatMoney(e.amountDue)} <span className="text-xs text-muted">{e.amountSource === "AUTHORITY" ? "(من الكشف)" : "(محسوب)"}</span></td>
                    <td className="py-2">{p.balances[e.id] ? formatMoney(p.balances[e.id].paid) : "—"}</td>
                    <td className="py-2">
                      {p.balances[e.id] ? formatMoney(p.balances[e.id].remaining) : "—"}
                      {p.balances[e.id]?.remaining.gt(0) && !p.citizen.mergedIntoId && (
                        <div className="mt-1"><PayButton entitlementId={e.id} title={`${p.citizen.fullName} — ${e.cycle.name}`} remaining={p.balances[e.id].remaining.toFixed(2)} /></div>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {e.cylinders.filter((c) => c.status !== "VOID").map((c) => (
                          <Link key={c.id} href={`/d/cylinders/${c.id}`} className="inline-flex items-center gap-1"><bdi dir="ltr" className="text-xs font-semibold">{c.label}</bdi><CylinderStatusBadge status={c.status} /></Link>
                        ))}
                        {e.cylinders.filter((c) => c.status !== "VOID").length === 0 && <span className="text-xs text-muted">لم تُستلم</span>}
                      </div>
                    </td>
                    <td className="py-2"><Link className="text-primary hover:underline" href={`/d/statements/${e.statement.id}`}>{e.statement.title}</Link></td>
                    <td className="py-2">{e.status === "ACTIVE" ? <Badge tone="success">قائم</Badge> : <Badge tone="danger">أُزيل من الكشف</Badge>}</td>
                    <td className="py-2">
                      {e.status === "ACTIVE" && e.cycle.status === "OPEN" && (
                        <EditEntitlement entitlement={{ id: e.id, citizenNumber: e.citizenNumber, quantity: e.quantity, amountDue: e.amountDue.toString(), nameInStatement: e.nameInStatement }} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="المقبوض">
        {p.entitlements.every((e) => e.payments.length === 0) ? (
          <EmptyState>لا توجد تحصيلات.</EmptyState>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {p.entitlements.flatMap((e) => e.payments.map((pay) => ({ pay, cycle: e.cycle.name }))).sort((a, b) => b.pay.paidAt.getTime() - a.pay.paidAt.getTime()).map(({ pay, cycle }) => (
              <li key={pay.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{formatMoney(pay.amount)}</strong> — {cycle} <span className="text-xs text-muted">· {formatDateTime(pay.paidAt)}</span>
                  {pay.notes && <span className="text-xs text-muted"> · {pay.notes}</span>}
                  {pay.status === "CANCELLED" && <div className="text-xs text-danger">أُلغي: {pay.cancelReason}</div>}
                </span>
                {pay.status === "ACTIVE" ? <CancelPayment id={pay.id} /> : <Badge tone="danger">ملغى</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="السجل الزمني">
        {p.timeline.length === 0 ? (
          <EmptyState>لا توجد أحداث.</EmptyState>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {p.timeline.map((t, i) => (
              <li key={i} className="py-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{TIMELINE[t.kind] ?? t.kind} — {t.cycleName}</span>
                  <span className="text-xs text-muted">{formatDateTime(t.at)}{t.by ? ` · ${t.by}` : ""}</span>
                </div>
                {"amount" in t.details && t.details.amount ? <div className="mt-1">المبلغ: {formatMoney(String(t.details.amount))}</div> : null}
                {"reason" in t.details && t.details.reason ? <div className="mt-1 text-muted">السبب: {String(t.details.reason)}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!c.mergedIntoId && <CitizenActions citizenId={c.id} archived={!!c.archivedAt} />}
    </div>
  );
}
