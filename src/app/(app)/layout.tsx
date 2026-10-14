import { AppShell } from "@/components/app-shell";
import { requirePageActor } from "@/server/http/context";
import { getPublicSettings } from "@/server/services/settings";
import { navFor } from "@/lib/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor();
  const settings = await getPublicSettings();
  const roleLabel = actor.role === "ADMIN" ? (actor.isSuperAdmin ? "مدير رئيسي" : "مدير نظام") : "موزّع";
  return (
    <AppShell systemName={settings.systemName} logoUrl={settings.logoUrl} nav={navFor(actor, settings.navOverrides)} userName={actor.displayName} roleLabel={roleLabel}>
      {children}
    </AppShell>
  );
}
