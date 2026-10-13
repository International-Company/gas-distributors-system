import { redirect } from "next/navigation";
import { currentSession, getDeviceToken } from "@/server/http/context";
import { getPublicSettings } from "@/server/services/settings";
import { LoginForm } from "./login-form";
import { ThemeToggle } from "@/components/theme";

export const metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  const s = await currentSession();
  if (s) redirect(s.mustChangePassword ? "/change-password" : "/");
  const [settings, device] = await Promise.all([getPublicSettings(), getDeviceToken()]);
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex justify-end p-3">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-primary">{settings.systemName}</h1>
            <p className="mt-2 text-sm text-muted">سجّل الدخول للمتابعة</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <LoginForm hasDevicePin={Boolean(device)} />
          </div>
          {(settings.contactPhone || settings.contactEmail) && (
            <p className="mt-6 text-center text-xs text-muted">
              للمساعدة أو نسيان كلمة المرور تواصل مع الإدارة:{" "}
              <span className="ltr-nums">{settings.contactPhone ?? settings.contactEmail}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
