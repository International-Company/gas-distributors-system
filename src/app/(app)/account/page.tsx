import { getDeviceToken, requirePageActor } from "@/server/http/context";
import { Card, DetailList, PageHeader } from "@/components/ui";
import { ChangePasswordForm } from "@/components/change-password-form";
import { ADMIN_PERMISSIONS, isAdminPermission } from "@/server/permissions";
import { DeviceSecurity } from "./device-security";

export const metadata = { title: "حسابي" };

export default async function AccountPage() {
  const actor = await requirePageActor();
  const hasPin = Boolean(await getDeviceToken());
  const perms =
    actor.role === "ADMIN"
      ? actor.isSuperAdmin
        ? "جميع الصلاحيات (مدير رئيسي)"
        : actor.permissions.filter(isAdminPermission).map((p) => ADMIN_PERMISSIONS[p]).join("، ") || "لا توجد"
      : null;
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="حسابي" />
      <Card title="بيانات الحساب">
        <DetailList
          items={[
            ["الاسم", actor.displayName],
            ["اسم المستخدم", <span key="u" className="ltr-nums">{actor.username}</span>],
            ["طريقة الدخول الحالية", actor.authMethod === "PIN" ? "رمز PIN" : "كلمة المرور"],
            ...(perms ? ([["الصلاحيات", perms]] as [string, string][]) : []),
          ]}
        />
      </Card>
      <Card title="تغيير كلمة المرور">
        <ChangePasswordForm />
      </Card>
      <DeviceSecurity hasPin={hasPin} />
    </div>
  );
}
