"use client";

import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2"
      aria-label={dark ? "الوضع الفاتح" : "الوضع الداكن"}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      <span className="hidden sm:inline">{dark ? "الوضع الفاتح" : "الوضع الداكن"}</span>
    </button>
  );
}
