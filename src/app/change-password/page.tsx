import { requirePageActor, currentSession } from "@/server/http/context";
import { ChangePasswordForm } from "@/components/change-password-form";
import { Alert } from "@/components/ui";

export const metadata = { title: "تغيير كلمة المرور" };

export default async function ChangePasswordPage() {
  await requirePageActor({ allowPasswordChange: true });
  const s = await currentSession();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="mb-4 text-lg font-bold">تغيير كلمة المرور</h1>
        {s?.mustChangePassword && (
          <Alert tone="warning" className="mb-4">
            يجب تعيين كلمة مرور جديدة خاصة بك قبل استخدام النظام.
          </Alert>
        )}
        <ChangePasswordForm redirectTo="/" />
      </div>
    </div>
  );
}
