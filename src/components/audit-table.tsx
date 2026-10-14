import { formatDateTime } from "@/lib/format";
import { EmptyState } from "./ui";

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "distributor.create": "إنشاء حساب موزّع",
  "distributor.update": "تعديل بيانات موزّع",
  "distributor.suspend": "تعليق حساب",
  "distributor.activate": "تفعيل حساب",
  "distributor.set_validity": "تعديل الصلاحية",
  "distributor.archive": "أرشفة حساب",
  "distributor.unarchive": "استعادة من الأرشيف",
  "distributor.pin": "تثبيت حساب",
  "distributor.unpin": "إلغاء تثبيت حساب",
  "distributor.reset_password": "إعادة تعيين كلمة مرور",
  "distributor.logout_all": "خروج إجباري من الأجهزة",
  "distributor.unlock": "فك قفل الدخول",
  "distributor.auto_suspend_expired": "تعليق تلقائي لانتهاء الصلاحية",
  "distributor.export": "تصدير قائمة الموزّعين",
  "category.create": "إنشاء تصنيف",
  "category.rename": "تعديل تصنيف",
  "category.delete": "حذف تصنيف",
  "admin.create": "إنشاء مدير",
  "admin.create_cli": "إنشاء مدير من سطر الأوامر",
  "admin.update": "تعديل مدير وصلاحياته",
  "admin.suspend": "تعليق مدير",
  "admin.activate": "تفعيل مدير",
  "admin.reset_password": "إعادة تعيين كلمة مرور مدير",
  "admin.logout_all": "خروج إجباري لمدير",
  "admin.unlock": "فك قفل مدير",
  "settings.update": "تعديل الإعدادات",
  "auth.password_changed": "تغيير كلمة المرور",
  "auth.pin_set": "تفعيل PIN على جهاز",
  "auth.pin_removed": "إلغاء PIN",
  "auth.logout_all": "خروج من جميع الأجهزة",
  "auth.account_locked": "قفل مؤقت لتجاوز المحاولات",
};

type Row = {
  id: bigint | string;
  at: Date;
  action: string;
  actorRole: string | null;
  reason: string | null;
  ip: string | null;
  before: unknown;
  after: unknown;
  actor?: { username: string; displayName: string } | null;
};

function Diff({ before, after }: { before: unknown; after: unknown }) {
  if (!before && !after) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-primary">التفاصيل</summary>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {before != null && (
          <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-left" dir="ltr">{"قبل:\n" + JSON.stringify(before, null, 1)}</pre>
        )}
        {after != null && (
          <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-left" dir="ltr">{"بعد:\n" + JSON.stringify(after, null, 1)}</pre>
        )}
      </div>
    </details>
  );
}

export function AuditTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <EmptyState>لا توجد سجلات.</EmptyState>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={String(r.id)} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{AUDIT_ACTION_LABELS[r.action] ?? r.action}</span>
            <span className="text-xs text-muted ltr-nums">{formatDateTime(r.at)}</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            بواسطة:{" "}
            {r.actor ? (
              <>
                {r.actor.displayName} (<bdi dir="ltr">{r.actor.username}</bdi>)
              </>
            ) : r.actorRole === "SYSTEM" ? "النظام" : "—"}
            {r.ip && <> · <bdi dir="ltr">{r.ip}</bdi></>}
          </div>
          {r.reason && <div className="mt-1 text-sm">السبب: {r.reason}</div>}
          <Diff before={r.before} after={r.after} />
        </li>
      ))}
    </ul>
  );
}
