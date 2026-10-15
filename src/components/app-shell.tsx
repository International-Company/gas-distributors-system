"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3, Banknote, Boxes, Bug, CalendarDays, ChevronDown, Cylinder, Factory, FileSpreadsheet, Flame, FolderOpen, GitMerge, History, Home,
  LogIn, LogOut, Menu, Receipt, RefreshCw, ScanLine, Search, Settings, Shield, ShieldAlert, ShieldCheck, Tags, Truck, User, Users, Wallet, Warehouse, X, Zap,
} from "lucide-react";
import { NAV_GROUPS, type NavGroup, type NavIcon, type NavItem } from "@/lib/nav-groups";
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

const GROUP_ICONS: Partial<Record<NavGroup, typeof Home>> = {
  work: Zap, records: FolderOpen, stock: Boxes, money: Wallet, insight: BarChart3, people: Users, oversight: ShieldCheck, system: Settings,
};

/** مفتاح حفظ حالة طي المجموعات على الجهاز. */
const OPEN_KEY = "gas-nav-open";

const isActiveHref = (pathname: string, href: string) => (href === "/admin" || href === "/d" ? pathname === href : pathname.startsWith(href));

type Props = { systemName: string; logoUrl?: string | null; nav: NavItem[]; userName: string; roleLabel: string; userId: string; offline: boolean; children: ReactNode };

export function AppShell({ systemName, logoUrl, nav, userName, roleLabel, userId, offline, children }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  const sidebar = <Sidebar systemName={systemName} logoUrl={logoUrl} nav={nav} userName={userName} roleLabel={roleLabel} pathname={pathname} />;

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

type SidebarProps = { systemName: string; logoUrl?: string | null; nav: NavItem[]; userName: string; roleLabel: string; pathname: string };

/**
 * القائمة الجانبية: مجموعات قابلة للطي. تُفتح تلقائيًا مجموعة الصفحة الحالية، وتُحفظ حالة الطي على الجهاز.
 * المجموعة ذات القسم الواحد تُعرض قسمًا مباشرًا دون عنوان مكرر.
 */
function Sidebar({ systemName, logoUrl, nav, userName, roleLabel, pathname }: SidebarProps) {
  const isActive = (href: string) => isActiveHref(pathname, href);
  const panel = nav.some((n) => n.href.startsWith("/d")) ? "لوحة الموزّع" : "لوحة الإدارة";

  const groups = NAV_GROUPS.filter((g) => g.key !== "account")
    .map((g) => ({ ...g, items: nav.filter((n) => n.group === g.key) }))
    .filter((g) => g.items.length);
  const account = nav.find((n) => n.group === "account");
  const activeGroup = groups.find((g) => g.items.some((i) => isActive(i.href)))?.key;

  const [saved, setSaved] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
      // فتح صفحة مباشرة داخل مجموعة طواها المستخدم سابقًا يفتحها.
      if (activeGroup && s[activeGroup] === false) {
        s[activeGroup] = true;
        localStorage.setItem(OPEN_KEY, JSON.stringify(s));
      }
      setSaved(s);
    } catch {
      // التخزين المحلي غير متاح: تبقى الحالة الافتراضية.
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const persist = (next: Record<string, boolean>) => {
    setSaved(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // لا يُحفظ على هذا الجهاز؛ لا يؤثر على العمل.
    }
  };
  // الانتقال إلى صفحة في مجموعة مطوية يفتحها.
  useEffect(() => {
    if (activeGroup && saved[activeGroup] === false) persist({ ...saved, [activeGroup]: true });
  }, [activeGroup]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOpen = (k: string) => saved[k] ?? k === activeGroup;

  return (
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
          <div className="mt-0.5 text-xs text-muted">{panel}</div>
        </div>
      </div>

      <div className="nav-scroll flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {groups.map((g) => {
          if (!g.label || g.items.length === 1) {
            return g.items.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} />);
          }
          const open = isOpen(g.key);
          const Icon = GROUP_ICONS[g.key] ?? Home;
          const hasActive = g.key === activeGroup;
          const panelId = `nav-group-${g.key}`;
          return (
            <div key={g.key}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => persist({ ...saved, [g.key]: !open })}
                className={cn(
                  "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-surface-2",
                  hasActive && !open ? "font-semibold text-primary" : "font-medium text-text",
                )}
              >
                <Icon className={cn("size-[18px] shrink-0", hasActive ? "text-primary" : "text-muted")} />
                <span className="min-w-0 flex-1 truncate text-start">{g.label}</span>
                {!open && hasActive && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
                <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
              </button>
              <div
                id={panelId}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
                  open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
                inert={!open}
              >
                <ul className="ms-[1.3rem] min-h-0 space-y-0.5 overflow-hidden border-s border-border ps-2">
                  {g.items.map((item) => (
                    <li key={item.href} className="first:mt-0.5 last:mb-1">
                      <NavLink item={item} active={isActive(item.href)} nested />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2">
          <Link
            href={account?.href ?? "/account"}
            className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 hover:bg-surface", account && isActive(account.href) && "ring-1 ring-primary/40")}
            title={account?.label ?? "حسابي"}
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
}

function NavLink({ item, active, nested }: { item: NavItem; active: boolean; nested?: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 transition-colors",
        nested ? "h-9 text-[13.5px]" : "h-10 text-sm",
        active ? "bg-primary-soft font-semibold text-primary" : "text-text/85 hover:bg-surface-2 hover:text-text",
      )}
    >
      {active && <span className="absolute inset-y-2 start-0 w-1 rounded-full bg-primary" aria-hidden />}
      <Icon className={cn("shrink-0", nested ? "size-4" : "size-[18px]", active ? "text-primary" : "text-muted")} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
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
