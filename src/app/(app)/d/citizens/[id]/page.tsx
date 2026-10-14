import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { getCitizenProfile } from "@/server/services/citizens";
import { Alert, Badge, Card, DetailList, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { CitizenActions, EditEntitlement } from "./actions";

export const metadata = { title: "ملف مواطن" };

const TIMELINE: Record<string, string> = {
  ENTITLEMENT_CREATED: "اعتماد استحقاق من الكشف",
  CHANGE_STATEMENT_UPDATE: "تحديث من إصدار جديد للكشف",
  CHANGE_MANUAL_EDIT: "تعديل يدوي",
  CHANGE_MERGE: "دمج سجل",
  CHANGE_REMOVED: "أُزيل من إصدار جديد للكشف",
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
          هذا السجل مدموج في <Link className="underline" href={`/d/citizens/${p.mergedInto.id}`}>{p.mergedInto.fullName} (<bdi>{p.mergedInto.nationalId}</bdi>)</Link>.
        </Alert>
      )}
      <Card title="البيانات الأساسية">
        <DetailList
          items={[
            ["رقم الهوية", <bdi key="n">{c.nationalId}</bdi>],
            ["الهاتف", <bdi key="p">{c.phone ?? "—"}</bdi>],
            ["عدد الدورات", p.entitlements.length],
            ["إجمالي المطلوب عبر الدورات", formatMoney(p.totalDue)],
            ...(p.mergedFrom.length ? ([["سجلات مدموجة فيه", p.mergedFrom.map((m) => `${m.fullName} (${m.nationalId})`).join("، ")]] as [string, string][]) : []),
          ]}
        />
        <p className="mt-3 text-xs text-muted">المدفوع والمتبقي يظهران مع نظام التحصيل (المرحلة 4)، وحالات الجرار مع المرحلة 3.</p>
      </Card>

      <Card title="الاستحقاقات حسب الدورة">
        {p.entitlements.length === 0 ? (
          <EmptyState>لا توجد استحقاقات.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-right text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 font-medium">الدورة</th>
                  <th className="py-2 font-medium">رقم المواطن</th>
                  <th className="py-2 font-medium">الجرار</th>
                  <th className="py-2 font-medium">المطلوب</th>
                  <th className="py-2 font-medium">الكشف</th>
                  <th className="py-2 font-medium">الحالة</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {p.entitlements.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2">{e.cycle.name} {e.cycle.status === "OPEN" && <Badge tone="success">نشطة</Badge>}</td>
                    <td className="py-2 font-semibold"><bdi>{e.citizenNumber}</bdi></td>
                    <td className="py-2">{e.quantity}</td>
                    <td className="py-2">{formatMoney(e.amountDue)} <span className="text-xs text-muted">{e.amountSource === "AUTHORITY" ? "(من الكشف)" : "(محسوب)"}</span></td>
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
