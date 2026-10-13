import { requirePageActor } from "@/server/http/context";
import { getAdmin } from "@/server/services/admins";
import { listAuditLogs } from "@/server/services/logs";
import { ADMIN_PERMISSIONS, isAdminPermission } from "@/server/permissions";
import { Badge, Card, DetailList, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { AUDIT_ACTION_LABELS } from "@/components/audit-table";
import { AdminEditor } from "../editor";
import { AdminActions } from "./actions";

export const metadata = { title: "مدير نظام" };

export default async function AdminPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor({ role: "ADMIN", superAdmin: true });
  const { id } = await params;
  const a = await getAdmin(actor, id);
  const logs = await listAuditLogs(actor, { actorUserId: id });
  return (
    <div className="space-y-6">
      <PageHeader
        title={a.displayName}
        actions={
          <div className="flex items-center gap-2">
            {a.isSuperAdmin && <Badge tone="primary">مدير رئيسي</Badge>}
            {a.status === "SUSPENDED" ? <Badge tone="warning">معلّق</Badge> : <Badge tone="success">نشط</Badge>}
            <AdminEditor permissions={ADMIN_PERMISSIONS} existing={{ id: a.id, displayName: a.displayName, phone: a.phone, isSuperAdmin: a.isSuperAdmin, permissions: a.permissions }} />
          </div>
        }
      />
      <Card title="البيانات">
        <DetailList
          items={[
            ["اسم المستخدم", <span key="u" className="ltr-nums">{a.username}</span>],
            ["الهاتف", <span key="p" className="ltr-nums">{a.phone ?? "—"}</span>],
            ["آخر دخول", formatDateTime(a.lastLoginAt)],
            ["تاريخ الإنشاء", formatDateTime(a.createdAt)],
            ["الصلاحيات", a.isSuperAdmin ? "جميع الصلاحيات" : a.permissions.filter(isAdminPermission).map((p) => ADMIN_PERMISSIONS[p]).join("، ") || "لا توجد"],
          ]}
        />
      </Card>
      <AdminActions id={a.id} status={a.status} isSelf={a.id === actor.userId} locked={Boolean(a.lockedUntil && a.lockedUntil > new Date())} />
      <Card title="آخر العمليات التي نفذها">
        <ul className="divide-y divide-border text-sm">
          {logs.rows.slice(0, 15).map((r) => (
            <li key={String(r.id)} className="flex justify-between gap-2 py-2">
              <span>{AUDIT_ACTION_LABELS[r.action] ?? r.action}</span>
              <span className="text-xs text-muted ltr-nums">{formatDateTime(r.at)}</span>
            </li>
          ))}
          {logs.rows.length === 0 && <li className="py-2 text-muted">لا توجد عمليات.</li>}
        </ul>
      </Card>
    </div>
  );
}
