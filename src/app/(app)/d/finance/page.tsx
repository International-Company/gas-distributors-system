import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Users, Wallet } from "lucide-react";
import { requirePageActor } from "@/server/http/context";
import { moneyOverview, PERIODS, type MoneyDay, type Period } from "@/server/services/money";
import { Button, Card, EmptyState, PageHeader, buttonClass, cn } from "@/components/ui";
import { DateInput } from "@/components/date-input";
import { formatMoney } from "@/lib/format";
import { CancelRecord } from "./cancel-record";
import { NewExpense } from "./new-expense";

export const metadata = { title: "الفلوس" };

const PERIOD_LABELS: Record<Period, string> = { today: "اليوم", week: "آخر 7 أيام", month: "هالشهر", all: "من البداية", custom: "تاريخ محدد" };
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const CANCEL_URL = { PAYMENT: "payments", EXPENSE: "expenses", STATION_PAYMENT: "station-payments" } as const;

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const weekday = (ymd: string) => WEEKDAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
const timeOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Gaza", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** الفلوس: كم معك الآن، وكم دخل وطلع في الفترة، وكم باقي على الناس، وحركة كل يوم. */
export default async function MoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const period = (PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as Period) : "today";
  const m = await moneyOverview(actor, { period, from: sp.from, to: sp.to });
  const cash = Number(m.cashInHand);
  const duePct = Number(m.dues.due) > 0 ? Math.round((Number(m.dues.paid) / Number(m.dues.due)) * 100) : 0;
  const dayLabel = (d: string) => (d === m.period.today ? "اليوم" : d === yesterday(m.period.today) ? "أمس" : `${weekday(d)} ${dm(d)}`);

  return (
    <div className="space-y-5">
      <PageHeader title="الفلوس" actions={<NewExpense defaultOpen={sp.tab === "expenses"} />} />

      {/* معك الآن */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-l from-primary to-primary-hover p-5 text-primary-contrast shadow-sm">
        <div className="flex items-center gap-2 text-sm opacity-90"><Wallet className="size-4" /> المفروض يكون معك الآن</div>
        <div className="mt-1 text-4xl font-bold tabular-nums md:text-5xl">{formatMoney(m.cashInHand)}</div>
        <div className="mt-2 text-sm opacity-90">
          كل اللي انقبض {formatMoney(m.allTime.collected)} − كل المصاريف {formatMoney(m.allTime.spent)}
        </div>
        {cash < 0 && <div className="mt-2 rounded-lg bg-white/15 px-3 py-1.5 text-sm">المصاريف المسجّلة أكثر من المقبوض؛ تأكد من المبالغ.</div>}
      </section>

      {/* الفترة */}
      <div className="space-y-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1" role="tablist" aria-label="الفترة">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={p === "today" ? "/d/finance" : `/d/finance?period=${p}`}
              role="tab"
              aria-selected={period === p}
              className={cn("shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors", period === p ? "bg-primary font-semibold text-primary-contrast" : "text-muted hover:bg-surface-2")}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </div>
        {period === "custom" && (
          <form method="get" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
            <input type="hidden" name="period" value="custom" />
            <DateInput name="from" defaultValue={sp.from} className="w-40" aria-label="من تاريخ" />
            <span className="text-sm text-muted">إلى</span>
            <DateInput name="to" defaultValue={sp.to} className="w-40" aria-label="إلى تاريخ" />
            <Button type="submit" variant="secondary">عرض</Button>
          </form>
        )}
      </div>

      {/* الفترة بالأرقام */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile icon={<ArrowDownLeft className="size-4" />} label="انقبض" value={formatMoney(m.inPeriod.collected)} hint={`${m.inPeriod.collectedCount} دفعة`} tone="text-success" />
        <Tile icon={<ArrowUpRight className="size-4" />} label="انصرف" value={formatMoney(m.inPeriod.spent)} hint={`${m.inPeriod.spentCount} مصروف`} tone="text-danger" />
        <Tile label="الصافي" value={formatMoney(m.inPeriod.net)} hint={PERIOD_LABELS[period]} tone={Number(m.inPeriod.net) < 0 ? "text-danger" : "text-text"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* على الناس */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted"><Users className="size-4" /> باقي على الناس</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-warning">{formatMoney(m.dues.remaining)}</div>
              <div className="mt-1 text-sm text-muted">{m.dues.owing > 0 ? `على ${m.dues.owing} شخص` : "كل الناس خالصين ✓"}</div>
            </div>
            {m.dues.owing > 0 && <Link href="/d/sheet?f=owes" className={buttonClass("secondary", "sm")}>شوفهم</Link>}
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>انقبض {formatMoney(m.dues.paid)} من {formatMoney(m.dues.due)}</span>
              <span className="tabular-nums">{duePct}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={duePct} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة المقبوض من المطلوب">
              <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, duePct)}%` }} />
            </div>
          </div>
        </Card>

        {/* المقبوض يوميًا */}
        <Card>
          <DailyChart data={m.chart} today={m.period.today} />
        </Card>
      </div>

      {/* الحركات */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">الحركات — {PERIOD_LABELS[period]}</h2>
        {m.days.length === 0 ? (
          <EmptyState>
            ما في حركات {period === "today" ? "اليوم" : "بهذه الفترة"}. القبض من «الكشف» بزر «دفع»، والمصاريف من زر «سجّل مصروف».
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {m.days.map((d) => <DayGroup key={d.date} day={d} label={dayLabel(d.date)} />)}
            {m.truncated && <p className="text-xs text-muted">تُعرض آخر 500 حركة؛ اختر فترة أقصر لعرض الباقي. الأرقام أعلاه تشمل كل الحركات.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function yesterday(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function Tile({ icon, label, value, hint, tone }: { icon?: React.ReactNode; label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted sm:text-sm">{icon}{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums sm:text-2xl", tone)}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted sm:text-xs">{hint}</div>
    </div>
  );
}

/** أعمدة المقبوض لآخر 14 يومًا: سلسلة واحدة بلون واحد، وقيمة كل يوم عند المرور أو التركيز. */
function DailyChart({ data, today }: { data: { date: string; collected: string }[]; today: string }) {
  const max = Math.max(...data.map((d) => Number(d.collected)), 0);
  const total = data.reduce((a, d) => a + Number(d.collected), 0);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm text-muted">المقبوض آخر 14 يوم</h3>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(total.toFixed(2))}</span>
      </div>
      <div className="relative mt-4 flex h-32 items-end gap-0.5" role="img" aria-label={`المقبوض يوميًا لآخر 14 يوم، المجموع ${total.toFixed(2)}`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden />
        {data.map((d) => {
          const v = Number(d.collected);
          const h = max > 0 ? Math.max((v / max) * 100, v > 0 ? 3 : 0) : 0;
          return (
            <div key={d.date} tabIndex={0} className="group relative flex h-full flex-1 items-end outline-none" aria-label={`${d.date === today ? "اليوم" : `${weekday(d.date)} ${dm(d.date)}`}: ${d.collected}`}>
              {v > 0 ? (
                <div className={cn("w-full rounded-t-[4px] bg-primary transition-opacity group-hover:opacity-80 group-focus:opacity-80", d.date !== today && "opacity-75")} style={{ height: `${h}%` }} />
              ) : (
                <div className="h-0.5 w-full rounded-full bg-border" />
              )}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-text px-2 py-1 text-xs text-bg shadow group-hover:block group-focus:block">
                {d.date === today ? "اليوم" : `${weekday(d.date)} ${dm(d.date)}`} · <bdi dir="ltr">{d.collected}</bdi>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-0.5 text-[10px] text-muted" aria-hidden>
        {data.map((d, i) => (
          <span key={d.date} className="flex-1 text-center tabular-nums">{d.date === today ? "اليوم" : i % 2 === 0 ? dm(d.date) : ""}</span>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">أعلى يوم: <bdi dir="ltr">{max.toFixed(2)}</bdi></p>
    </div>
  );
}

function DayGroup({ day, label }: { day: MoneyDay; label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="flex gap-3 text-xs">
          {Number(day.in) > 0 && <span className="text-success">انقبض {formatMoney(day.in)}</span>}
          {Number(day.out) > 0 && <span className="text-danger">انصرف {formatMoney(day.out)}</span>}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {day.items.map((it) => {
          const isIn = Number(it.amount) > 0;
          return (
            <li key={`${it.kind}-${it.id}`} className="flex items-center gap-3 px-4 py-2.5">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", isIn ? "bg-success-soft text-success" : "bg-danger-soft text-danger")} aria-hidden>
                {isIn ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {it.citizenId ? <Link href={`/d/citizens/${it.citizenId}`} className="hover:underline">{it.title}</Link> : it.title}
                </div>
                <div className="text-xs text-muted">
                  {isIn ? "قبض" : "مصروف"} · <bdi dir="ltr">{timeOf(it.at)}</bdi>{it.subtitle && <> · {it.subtitle}</>}
                </div>
              </div>
              <strong className={cn("shrink-0 tabular-nums", isIn ? "text-success" : "text-danger")}>
                <bdi dir="ltr">{isIn ? "+" : "−"}{Math.abs(Number(it.amount)).toFixed(2)}</bdi>
              </strong>
              <CancelRecord url={`/api/v1/${CANCEL_URL[it.kind]}/${it.id}/cancel`} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
