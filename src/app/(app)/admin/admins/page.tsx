import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { listAdmins } from "@/server/services/admins";
import { ADMIN_PERMISSIONS } from "@/server/permissions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { AdminEditor } from "./editor";

export const metadata = { title: "مديرو النظام" };

export default async function AdminsPage() {
  const actor = await requirePageActor({ role: "ADMIN", superAdmin: true });
  const rows = await listAdmins(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="مديرو النظام" description="إنشاء حسابات المديرين وتحديد صلاحياتهم. متاح للمدير الرئيسي فقط." actions={<AdminEditor permissions={ADMIN_PERMISSIONS} />} />
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <Link href={`/admin/admins/${a.id}`} className="font-medium text-primary hover:underline">{a.displayName}</Link>
                <div className="text-xs text-muted">
                  <span className="ltr-nums">{a.username}</span> · آخر دخول: <span className="ltr-nums">{formatDateTime(a.lastLoginAt, "—")}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {a.isSuperAdmin ? <Badge tone="primary">مدير رئيسي</Badge> : <Badge>{a.permissions.length} صلاحية</Badge>}
                {a.status === "SUSPENDED" && <Badge tone="warning">معلّق</Badge>}
                {a.id === actor.userId && <Badge tone="success">أنت</Badge>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
