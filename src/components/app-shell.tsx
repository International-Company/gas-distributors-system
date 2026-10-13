"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Bug, Flame, History, Home, LogIn, LogOut, Menu, Settings, Shield, Tags, User, Users, X } from "lucide-react";
import type { NavIcon, NavItem } from "@/lib/nav";
import { cn } from "./ui";
import { ThemeToggle } from "./theme";
import { ApiProvider } from "./api-client";

const ICONS: Record<NavIcon, typeof Home> = {
  home: Home, users: Users, tags: Tags, shield: Shield, history: History, login: LogIn, bug: Bug, settings: Settings, user: User,
};

type Props = { systemName: string; nav: NavItem[]; userName: string; roleLabel: string; children: ReactNode };

export function AppShell({ systemName, nav, userName, roleLabel, children }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/admin" || href === "/d" ? pathname === href : pathname.startsWith(href));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-contrast">
          <Flame className="size-5" />
        </span>
        <span className="text-sm font-bold leading-tight">{systemName}</span>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-3">
        {nav.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  isActive(item.href) ? "bg-primary-soft font-semibold text-primary" : "text-text hover:bg-surface-2",
                )}
              >
                <Icon className="size-5 shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border p-3">
        <div className="mb-2 px-1">
          <div className="truncate text-sm font-medium">{userName}</div>
          <div className="text-xs text-muted">{roleLabel}</div>
        </div>
        <LogoutButton />
      </div>
    </nav>
  );

  return (
    <ApiProvider>
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
            <ThemeToggle />
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
        </div>
      </div>
    </ApiProvider>
  );
}

function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login";
      }}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-soft"
    >
      <LogOut className="size-5" />
      تسجيل الخروج
    </button>
  );
}
