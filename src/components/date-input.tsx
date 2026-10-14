"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn, fieldBase } from "./ui";
import { TIME_ZONE } from "@/lib/format";

/**
 * حقل تاريخ عربي موحّد بدل حقل المتصفح (الذي يقلب «يوم/شهر/سنة» في الواجهة العربية ويختلف شكله بين الأجهزة).
 * القيمة بالصيغة نفسها لحقول المتصفح: «YYYY-MM-DD»، أو «YYYY-MM-DDTHH:mm» مع الوقت،
 * فلا يتغير شيء في إرسال النماذج أو في الخادم.
 */

const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
// الأسبوع يبدأ بالسبت.
const WEEKDAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const WEEKDAYS_SHORT = ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"];

type Ymd = { y: number; m: number; d: number }; // m: 1..12

const pad = (n: number) => String(n).padStart(2, "0");
const ymdStr = ({ y, m, d }: Ymd) => `${y}-${pad(m)}-${pad(d)}`;
const parseYmd = (s: string | undefined | null): Ymd | null => {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  return r ? { y: +r[1], m: +r[2], d: +r[3] } : null;
};
const parseTime = (s: string | undefined | null) => {
  const r = /T(\d{2}):(\d{2})/.exec(s ?? "");
  return r ? { h: +r[1], min: +r[2] } : null;
};
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 = السبت … 6 = الجمعة */
const weekdayIdx = (x: Ymd) => (new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay() + 1) % 7;
const addDays = (x: Ymd, n: number): Ymd => {
  const t = new Date(Date.UTC(x.y, x.m - 1, x.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const addMonths = (x: Ymd, n: number): Ymd => {
  const t = new Date(Date.UTC(x.y, x.m - 1 + n, 1));
  const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
  return { y, m, d: Math.min(x.d, daysIn(y, m)) };
};

/** التاريخ والوقت الآن بتوقيت غزة. */
function nowGaza() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((q) => [q.type, q.value]),
  );
  return { date: { y: +p.year, m: +p.month, d: +p.day }, h: +p.hour, min: +p.minute };
}

const POPOVER_WIDTH = 304; // sm:w-[19rem]

const time12 = (h: number, min: number) => `${pad(h % 12 === 0 ? 12 : h % 12)}:${pad(min)} ${h < 12 ? "ص" : "م"}`;
export const displayDate = (v: string | undefined | null) => {
  const x = parseYmd(v);
  return x ? `${pad(x.d)}/${pad(x.m)}/${x.y}` : "";
};

type Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** يضيف اختيار الوقت (القيمة «YYYY-MM-DDTHH:mm»). */
  withTime?: boolean;
  min?: string;
  max?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
};

export function DateInput({ id, name, value, defaultValue, onChange, withTime, min, max, required, placeholder, className, ...rest }: Props) {
  const autoId = useId();
  const triggerId = id ?? `date-${autoId}`;
  const [inner, setInner] = useState(defaultValue ?? "");
  const val = value !== undefined ? value : inner;
  const set = (v: string) => {
    if (value === undefined) setInner(v);
    onChange?.(v);
  };

  const selected = parseYmd(val);
  const time = parseTime(val);
  const minY = parseYmd(min), maxY = parseYmd(max);
  const disabled = (x: Ymd) => (minY && ymdStr(x) < ymdStr(minY)) || (maxY && ymdStr(x) > ymdStr(maxY));

  const [open, setOpen] = useState(false);
  // اتجاه فتح اللوحة على الشاشات الكبيرة: من حافة الحقل اليمنى (الافتراضي)، أو من اليسرى إن لم تتسع الشاشة.
  const [alignLeft, setAlignLeft] = useState(false);
  const [focus, setFocus] = useState<Ymd>(() => selected ?? nowGaza().date);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  // نقل التركيز لليوم فقط عند الفتح والتنقل بلوحة المفاتيح، لا عند استخدام قائمتي الشهر والسنة.
  const moveFocus = useRef(false);

  const today = useMemo(() => nowGaza().date, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // التركيز على اليوم المحدد عند الفتح وعند التنقل بلوحة المفاتيح.
  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${ymdStr(focus)}"]`)?.focus({ preventScroll: true });
  }, [open, focus]);

  const show = () => {
    setFocus(selected ?? (minY && ymdStr(today) < ymdStr(minY) ? minY : today));
    moveFocus.current = true;
    const r = wrap.current?.getBoundingClientRect();
    setAlignLeft(Boolean(r && r.right - POPOVER_WIDTH < 8 && r.left + POPOVER_WIDTH <= window.innerWidth - 8));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const pick = (x: Ymd) => {
    if (disabled(x)) return;
    if (withTime) {
      const t = time ?? (() => { const n = nowGaza(); return { h: n.h, min: n.min }; })();
      set(`${ymdStr(x)}T${pad(t.h)}:${pad(t.min)}`);
      setFocus(x);
    } else {
      set(ymdStr(x));
      close();
    }
  };
  const setTime = (h: number, mi: number) => {
    const base = selected ?? today;
    set(`${ymdStr(base)}T${pad(h)}:${pad(mi)}`);
  };

  const onGridKey = (e: KeyboardEvent) => {
    const moves: Record<string, () => Ymd> = {
      // الواجهة من اليمين لليسار: السهم الأيسر = اليوم التالي.
      ArrowLeft: () => addDays(focus, 1),
      ArrowRight: () => addDays(focus, -1),
      ArrowDown: () => addDays(focus, 7),
      ArrowUp: () => addDays(focus, -7),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      Home: () => addDays(focus, -weekdayIdx(focus)),
      End: () => addDays(focus, 6 - weekdayIdx(focus)),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moveFocus.current = true;
      setFocus(moves[e.key]());
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  // شبكة الشهر: من السبت الذي يسبق أول الشهر، 6 أسابيع.
  const first: Ymd = { y: focus.y, m: focus.m, d: 1 };
  const start = addDays(first, -weekdayIdx(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const years = useMemo(() => {
    const c = today.y;
    const lo = Math.min(minY?.y ?? c - 5, focus.y, c - 5), hi = Math.max(maxY?.y ?? c + 5, focus.y, c + 5);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [today.y, minY?.y, maxY?.y, focus.y]);

  const shown = selected ? `${displayDate(val)}${withTime && time ? `  ${time12(time.h, time.min)}` : ""}` : "";
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  if (time && !minutes.includes(time.min)) minutes.push(time.min), minutes.sort((a, b) => a - b);

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={rest["aria-label"] ? `${rest["aria-label"]}${shown ? `: ${shown}` : ""}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
        className={cn(fieldBase, "flex h-10 w-full items-center gap-2 text-start", !shown && "text-muted", val && !required && "pe-9")}
      >
        <CalendarDays className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate">
          {shown ? <bdi dir="ltr" className="tabular-nums">{shown}</bdi> : (placeholder ?? (withTime ? "اختر التاريخ والوقت" : "اختر التاريخ"))}
        </span>
      </button>
      {val && !required && (
        <button
          type="button"
          onClick={() => set("")}
          className="absolute inset-y-0 end-1 my-auto flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
          aria-label="مسح التاريخ"
        >
          <X className="size-3.5" />
        </button>
      )}
      {/* القيمة المرسلة مع النموذج، والتحقق من الإلزام بأداة المتصفح نفسها */}
      <input
        tabIndex={-1}
        aria-hidden
        name={name}
        value={val}
        required={required}
        onChange={() => {}}
        onFocus={() => trigger.current?.focus()}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
      />

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="false"
            aria-label={withTime ? "اختيار التاريخ والوقت" : "اختيار التاريخ"}
            className={cn(
              "z-50 rounded-xl border border-border bg-surface p-3 shadow-xl",
              "fixed inset-x-0 bottom-0 rounded-b-none pb-5",
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-1 sm:w-[19rem] sm:rounded-b-xl sm:pb-3",
              alignLeft ? "sm:left-0" : "sm:right-0",
            )}
          >
            <div className="mb-2 flex items-center gap-1">
              <button type="button" onClick={() => setFocus(addMonths(focus, -1))} className="flex size-8 items-center justify-center rounded-md hover:bg-surface-2" aria-label="الشهر السابق">
                <ChevronRight className="size-4" />
              </button>
              <select
                aria-label="الشهر"
                value={focus.m}
                onChange={(e) => setFocus({ ...focus, m: +e.target.value, d: Math.min(focus.d, daysIn(focus.y, +e.target.value)) })}
                className="h-8 flex-1 rounded-md border border-border bg-surface px-1 text-sm font-semibold"
              >
                {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n} ({i + 1})</option>)}
              </select>
              <select
                aria-label="السنة"
                value={focus.y}
                onChange={(e) => setFocus({ ...focus, y: +e.target.value, d: Math.min(focus.d, daysIn(+e.target.value, focus.m)) })}
                className="h-8 w-20 rounded-md border border-border bg-surface px-1 text-sm font-semibold tabular-nums"
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button type="button" onClick={() => setFocus(addMonths(focus, 1))} className="flex size-8 items-center justify-center rounded-md hover:bg-surface-2" aria-label="الشهر التالي">
                <ChevronLeft className="size-4" />
              </button>
            </div>

            <div role="grid" ref={grid} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAYS_SHORT.map((w, i) => (
                <div key={w} role="columnheader" aria-label={WEEKDAYS[i]} className={cn("pb-1 text-[11px] font-medium text-muted", i === 6 && "text-danger/80")}>{w}</div>
              ))}
              {cells.map((c) => {
                const k = ymdStr(c);
                const inMonth = c.m === focus.m;
                const isSel = selected && k === ymdStr(selected);
                const isToday = k === ymdStr(today);
                const off = disabled(c);
                return (
                  <button
                    key={k}
                    type="button"
                    role="gridcell"
                    data-day={k}
                    tabIndex={k === ymdStr(focus) ? 0 : -1}
                    disabled={Boolean(off)}
                    aria-selected={Boolean(isSel)}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${WEEKDAYS[weekdayIdx(c)]} ${c.d} ${MONTHS[c.m - 1]} ${c.y}`}
                    onClick={() => pick(c)}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-lg text-sm tabular-nums outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring",
                      inMonth ? "text-text" : "text-muted/60",
                      !isSel && !off && "hover:bg-primary-soft",
                      isToday && !isSel && "font-bold text-primary ring-1 ring-primary/40",
                      isSel && "bg-primary font-semibold text-primary-contrast",
                      off && "cursor-not-allowed opacity-30",
                    )}
                  >
                    {c.d}
                  </button>
                );
              })}
            </div>

            {withTime && (
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm">
                <span className="text-muted">الوقت</span>
                <div dir="ltr" className="flex items-center gap-1">
                  <select
                    aria-label="الساعة"
                    value={time ? (time.h % 12 === 0 ? 12 : time.h % 12) : ""}
                    onChange={(e) => {
                      const h12 = +e.target.value;
                      const pm = time ? time.h >= 12 : nowGaza().h >= 12;
                      setTime((h12 % 12) + (pm ? 12 : 0), time?.min ?? 0);
                    }}
                    className="h-8 rounded-md border border-border bg-surface px-1 tabular-nums"
                  >
                    {!time && <option value="">--</option>}
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                  </select>
                  <span>:</span>
                  <select
                    aria-label="الدقيقة"
                    value={time ? time.min : ""}
                    onChange={(e) => setTime(time?.h ?? nowGaza().h, +e.target.value)}
                    className="h-8 rounded-md border border-border bg-surface px-1 tabular-nums"
                  >
                    {!time && <option value="">--</option>}
                    {minutes.map((mi) => <option key={mi} value={mi}>{pad(mi)}</option>)}
                  </select>
                </div>
                <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="صباحًا أو مساءً">
                  {(["ص", "م"] as const).map((p) => {
                    const pm = p === "م";
                    const active = time ? (time.h >= 12) === pm : false;
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          const t = time ?? { h: nowGaza().h, min: 0 };
                          setTime((t.h % 12) + (pm ? 12 : 0), t.min);
                        }}
                        className={cn("h-8 px-2.5", active ? "bg-primary text-primary-contrast" : "hover:bg-surface-2")}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const n = nowGaza();
                    if (disabled(n.date)) return;
                    if (withTime) {
                      set(`${ymdStr(n.date)}T${pad(n.h)}:${pad(n.min)}`);
                      setFocus(n.date);
                    } else pick(n.date);
                  }}
                  className="rounded-md px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft"
                >
                  {withTime ? "الآن" : "اليوم"}
                </button>
                {!required && (
                  <button type="button" onClick={() => { set(""); close(); }} className="rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2">
                    مسح
                  </button>
                )}
              </div>
              {withTime && (
                <button type="button" onClick={close} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-contrast hover:bg-primary-hover">
                  تم
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
