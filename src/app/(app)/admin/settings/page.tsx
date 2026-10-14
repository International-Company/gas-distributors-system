import { requirePageActor } from "@/server/http/context";
import { withSystem } from "@/server/db";
import { getPublicSettings, getSettings, SUPPORTED_FILE_TYPES } from "@/server/services/settings";
import { ALL_NAV, NAV_LOCKED } from "@/lib/nav";
import { LogoForm, NavEditor } from "./extra";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "./form";

export const metadata = { title: "الإعدادات" };

export default async function SettingsPage() {
  await requirePageActor({ role: "ADMIN", permission: "settings.manage" });
  const [s, pub] = await Promise.all([withSystem(getSettings), getPublicSettings()]);
  return (
    <div className="max-w-4xl">
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
          allowedFileTypes: s.allowedFileTypes,
          maxUploadMb: s.maxUploadMb,
          offlineReceive: s.offlineReceive,
          offlineDeliver: s.offlineDeliver,
          offlinePayments: s.offlinePayments,
          offlineMaxAgeHours: s.offlineMaxAgeHours,
        }}
        supportedTypes={[...SUPPORTED_FILE_TYPES]}
      />
      <div className="mt-6 space-y-6">
        <LogoForm logoUrl={pub.logoUrl} />
        <NavEditor rows={ALL_NAV.map((n) => ({ ...n, locked: NAV_LOCKED.has(n.href) }))} overrides={pub.navOverrides} />
      </div>
    </div>
  );
}
