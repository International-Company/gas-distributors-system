"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, Banknote, RefreshCw, Receipt, Wallet, Bug, CalendarDays, Cylinder, Factory, ScanLine, Truck, Warehouse, FileSpreadsheet, Flame, GitMerge, History, Home, LogIn, LogOut, Menu, Search, Settings, Shield, ShieldAlert, Tags, User, Users, X } from "lucide-react";
import { NAV_GROUPS, type NavIcon, type NavItem } from "@/lib/nav";
import { cn } from "./ui";
import { ThemeToggle } from "./theme";
import { ApiProvider } from "./api-client";
import { OfflineIndicator, OfflineProvider, useOffline } from "./offline-provider";
import { onLogout } from "@/lib/offline/engine";

const ICONS: Record<NavIcon, typeof Home> = {
  home: Home, users: Users, tags: Tags, shield: Shield, history: History, login: LogIn, bug: Bug, settings: Settings, user: User,
  calendar: CalendarDays, file: FileSpreadsheet, search: Search, merge: GitMerge, alert: ShieldAlert,
  counter: ScanLine, cylinder: Cylinder, truck: Truck, warehouse: Warehouse, factory: Factory,
  wallet: Wallet, banknote: Banknote, receipt: Receipt, chart: BarChart3, sync: RefreshCw,
};

type Props = { systemName: string; logoUrl?: string | null; nav: NavItem[]; userName: string; roleLabel: string; userId: string; offline: boolean; children: ReactNode };

export function AppShell({ systemName, logoUrl, nav, userName, roleLabel, userId, offline, children }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/admin" || href === "/d" ? pathname === href : pathname.startsWith(href));

  const groups = NAV_GROUPS.filter((g) => g.key !== "account")
    .map((g) => ({ ...g, items: nav.filter((n) => n.group === g.key) }))
    .filter((g) => g.items.length);
  const account = nav.find((n) => n.group === "account");

  const sidebar = (
    <nav className="flex h-full flex-col" aria-label="القائمة الرئيسية">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-10 shrink-0 rounded-xl object-contain" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-contrast shadow-sm">
            <Flame className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-bold leading-tight">{systemName}</div>
          <div className="mt-0.5 text-xs text-muted">{offline ? "لوحة الموزّع" : "لوحة الإدارة"}</div>
        </div>
      </div>

      <div className="nav-scroll flex-1 overflow-y-auto px-3 pb-3">
        {groups.map((g) => (
          <div key={g.key} className={g.label ? "mt-3" : "mt-2.5"}>
            {g.label && <div className="mb-0.5 px-3 text-[11px] font-semibold tracking-wide text-muted">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(item.href)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        {/* تلاشٍ خفيف أسفل القائمة يدل على وجود المزيد عند التمرير */}
        <div className="pointer-events-none sticky bottom-0 -mx-3 h-5 bg-gradient-to-t from-surface to-transparent" aria-hidden />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2">
          <Link
            href={account?.href ?? "/account"}
            className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 hover:bg-surface", isActive("/account") && "ring-1 ring-primary/40")}
            title="حسابي"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><User className="size-[18px]" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{userName}</span>
              <span className="block text-xs text-muted">{roleLabel} · {account?.label ?? "حسابي"}</span>
            </span>
          </Link>
          <LogoutButton />
        </div>
      </div>
    </nav>
  );

  return (
    <ApiProvider>
     <OfflineProvider userId={userId} enabled={offline}>
      <div className="min-h-dvh md:flex">
        <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 border-l border-border bg-surface md:block">{sidebar}</aside>

        {open && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal>
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 right-0 w-72 max-w-[85%] bg-surface shadow-xl">
              <button className="absolute left-3 top-4 rounded-md p-1 text-muted" onClick={() => setOpen(false)} aria-label="إغلاق القائمة">
                <X className="size-5" />
              </button>
              {sidebar}
            </aside>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur">
            <div className="flex items-center gap-2">
              <button className="rounded-md p-2 hover:bg-surface-2 md:hidden" onClick={() => setOpen(true)} aria-label="فتح القائمة">
                <Menu className="size-5" />
              </button>
              <span className="text-sm font-semibold md:hidden">{systemName}</span>
            </div>
            <div className="flex items-center gap-2">
              <OfflineIndicator />
              <ThemeToggle />
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
        </div>
      </div>
     </OfflineProvider>
    </ApiProvider>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = ICONS[item.icon];
  const offline = useOffline();
  // عدّاد المزامنة: العمليات المعلقة وما يحتاج مراجعة.
  const badge = item.href === "/d/sync" && offline?.enabled ? { n: offline.unsynced + offline.review, danger: offline.review > 0 } : null;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-[34px] items-center gap-3 rounded-lg px-3 text-sm transition-colors",
        active ? "bg-primary-soft font-semibold text-primary" : "text-text/85 hover:bg-surface-2 hover:text-text",
      )}
    >
      {active && <span className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-primary" aria-hidden />}
      <Icon className={cn("size-[18px] shrink-0", active ? "text-primary" : "text-muted")} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge && badge.n > 0 && (
        <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 tabular-nums", badge.danger ? "bg-danger text-white" : "bg-warning-soft text-warning")}>
          {badge.n}
        </span>
      )}
    </Link>
  );
}

function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const offline = useOffline();
  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (offline?.enabled && offline.unsynced > 0) {
          const ok = window.confirm(
            `على هذا الجهاز ${offline.unsynced} عملية لم تُرسل للخادم بعد. لن تُحذف، وستُرسل عند دخولك مرة أخرى من هذا الجهاز. هل تريد الخروج؟`,
          );
          if (!ok) return;
        }
        setBusy(true);
        // بيانات الجهاز (اللقطة وذاكرة الصفحات) تُحذف عند الخروج.
        if (offline?.enabled) await onLogout(offline.userId).catch(() => {});
        await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login";
      }}
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
      aria-label="تسجيل الخروج"
      title="تسجيل الخروج"
    >
      <LogOut className="size-[18px]" />
    </button>
  );
}
