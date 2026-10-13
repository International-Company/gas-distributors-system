import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { hasPermission } from "@/server/actor";
import { getDistributor } from "@/server/services/distributors";
import { listCategories } from "@/server/services/categories";
import { listAuditLogs } from "@/server/services/logs";
import { Badge, Card, DetailList, PageHeader } from "@/components/ui";
import { DistributorStatusBadge } from "@/components/distributor-status";
import { AuditTable } from "@/components/audit-table";
import { formatDate, formatDateTime } from "@/lib/format";
import { DistributorForm } from "../distributor-form";
import { DistributorActions } from "./actions";

export const metadata = { title: "حساب موزّع" };

export default async function DistributorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor({ role: "ADMIN", permission: "distributors.view" });
  const { id } = await params;
  const d = await getDistributor(actor, id);
  const canManage = hasPermission(actor, "distributors.manage");
  const categories = canManage ? await listCategories(actor) : [];
  const audit = hasPermission(actor, "audit.view") ? await listAuditLogs(actor, { distributorId: id }) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={d.name}
        description={d.region}
        actions={
          <div className="flex items-center gap-2">
            <DistributorStatusBadge d={d} />
            {d.isTrial && <Badge tone="primary">تجريبي</Badge>}
            {d.isPinned && <Badge tone="primary">مثبّت</Badge>}
          </div>
        }
      />

      <Card title="ملخص الحساب">
        <DetailList
          items={[
            ["اسم المستخدم", <span key="u" className="ltr-nums">{d.user?.username}</span>],
            ["الهاتف", <span key="p" className="ltr-nums">{d.phone}</span>],
            ["التصنيف", d.category?.name ?? "—"],
            ["نوع الحساب", d.isTrial ? "تجريبي" : "فعلي"],
            ["تاريخ الانتهاء", d.expiresAt ? formatDate(d.expiresAt) : "بلا مدة محددة"],
            ["آخر تغيير للحالة", formatDateTime(d.statusChangedAt)],
            ["آخر دخول", formatDateTime(d.user?.lastLoginAt, "لم يسجل الدخول بعد")],
            ["الجلسات النشطة", d.activeSessions],
            ["قفل مؤقت", d.user?.lockedUntil && d.user.lockedUntil > new Date() ? `حتى ${formatDateTime(d.user.lockedUntil)}` : "لا"],
            ["تاريخ الإنشاء", formatDate(d.createdAt)],
          ]}
        />
      </Card>

      <DistributorActions
        distributor={{
          id: d.id, status: d.status, suspensionReason: d.suspensionReason, isTrial: d.isTrial,
          expiresAt: d.expiresAt?.toISOString() ?? null, isPinned: d.isPinned,
          locked: Boolean(d.user?.lockedUntil && d.user.lockedUntil > new Date()),
        }}
        can={{
          status: hasPermission(actor, "distributors.status"),
          credentials: hasPermission(actor, "distributors.credentials"),
          manage: canManage,
        }}
      />

      {canManage && d.user && d.status !== "ARCHIVED" && (
        <DistributorForm
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          existing={{ id: d.id, name: d.name, phone: d.phone, region: d.region, categoryId: d.categoryId, username: d.user.username }}
        />
      )}

      {audit && (
        <Card title="سجل عمليات الحساب" actions={<Link className="text-sm text-primary hover:underline" href={`/admin/audit?distributorId=${d.id}`}>عرض الكل</Link>}>
          <AuditTable rows={audit.rows.slice(0, 15)} />
        </Card>
      )}
    </div>
  );
}
