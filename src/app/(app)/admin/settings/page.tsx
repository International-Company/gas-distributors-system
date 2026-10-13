import { requirePageActor } from "@/server/http/context";
import { withSystem } from "@/server/db";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "./form";

export const metadata = { title: "الإعدادات" };

export default async function SettingsPage() {
  await requirePageActor({ role: "ADMIN", permission: "settings.manage" });
  const s = await withSystem(getSettings);
  return (
    <div className="max-w-2xl">
      <PageHeader title="إعدادات النظام" />
      <SettingsForm
        initial={{
          systemName: s.systemName,
          contactPhone: s.contactPhone ?? "",
          contactEmail: s.contactEmail ?? "",
          contactAddress: s.contactAddress ?? "",
          currencyCode: s.currencyCode,
          currencySymbol: s.currencySymbol,
          sessionIdleMinutes: s.sessionIdleMinutes,
          maxFailedLogins: s.maxFailedLogins,
          lockoutMinutes: s.lockoutMinutes,
        }}
      />
    </div>
  );
}
