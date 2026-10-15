import Link from "next/link";
import { cn } from "./ui";

/** تبويبات صفحة واحدة بروابط (تعمل دون JavaScript وتحفظ التبويب في الرابط). */
export function Tabs({ items }: { items: { href: string; label: string; active: boolean; count?: number }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          role="tab"
          aria-selected={t.active}
          className={cn(
            "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors",
            t.active ? "bg-primary text-primary-contrast font-semibold shadow-sm" : "text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
