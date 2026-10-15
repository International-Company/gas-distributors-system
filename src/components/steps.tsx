import { Check } from "lucide-react";
import { cn } from "./ui";

/** شريط خطوات: يوضح للمستخدم أين وصل في عملية متعددة المراحل (مثل رفع الكشف واعتماده). */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3" aria-label="الخطوات">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                done && "bg-success text-white",
                active && "bg-primary text-primary-contrast ring-4 ring-primary/20",
                !done && !active && "bg-surface-2 text-muted",
              )}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn("truncate text-sm", active ? "font-semibold text-text" : done ? "text-success" : "text-muted")}>{label}</span>
            {i < steps.length - 1 && <span className={cn("hidden h-px flex-1 sm:block", done ? "bg-success" : "bg-border")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export const STATEMENT_STEPS = ["ارفع الكشف", "راجع البيانات", "اعتمد الكشف"];
