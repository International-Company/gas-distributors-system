import Link from "next/link";
import { ChevronLeft, FolderOpen, History } from "lucide-react";
import { Prisma } from "@prisma/client";
import { requirePageActor } from "@/server/http/context";
import { lastStatementCost, lastStatementPrice, listStatements, statementActivity } from "@/server/services/statements";
import { listCycles } from "@/server/services/cycles";
import { getPublicSettings } from "@/server/services/settings";
import { PageHeader, buttonClass, cn } from "@/components/ui";
import { StatementStatusBadge } from "@/components/statement-status";
import { formatDateTime, formatMoney } from "@/lib/format";
import { UploadForm } from "./upload-form";
import { StatementActions } from "./statement-actions";
import { CycleMenu, NewCycleButton } from "./cycle-controls";

export const metadata = { title: "الكشوفات" };

type Item = Awaited<ReturnType<typeof listStatements>>[number];
type CycleItem = Awaited<ReturnType<typeof listCycles>>[number];

const dayMonth = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Gaza", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

/**
 * الكشوفات مرتبة بالدورات: كل دورة فيها أكثر من كشف.
 * فوق: رفع كشف (للدورة الحالية أو لدورة جديدة). ثم الدورة الحالية بكشوفاتها، ثم الدورات السابقة مطوية.
 */
export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ replace?: string }> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const [list, cycles, settings, lastPrice, lastCost] = await Promise.all([
    listStatements(actor, {}), listCycles(actor), getPublicSettings(), lastStatementPrice(actor), lastStatementCost(actor),
  ]);
  const open = cycles.find((c) => c.status === "OPEN") ?? null;
  const live = list.filter((s) => s.status === "PENDING_REVIEW" || s.status === "APPROVED");
  const old = list.filter((s) => s.status === "SUPERSEDED" || s.status === "DISCARDED");
  const activity = await statementActivity(actor, live.filter((s) => s.status === "APPROVED").map((s) => s.id));
  const replacing = live.find((s) => s.id === sp.replace && s.status === "APPROVED") ?? null;
  const nextName = `الدورة ${(cycles[0]?.number ?? 0) + 1}`;
  const ofCycle = (id: string | null) => live.filter((s) => s.cycleId === id);
  const previous = cycles.filter((c) => c.id !== open?.id && (c.approvedStatements + c.pendingStatements > 0 || c.citizens > 0));
  const orphan = ofCycle(null);
  const currency = settings.currencySymbol;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الكشوفات"
        actions={<NewCycleButton current={open ? { id: open.id, name: open.name, pending: open.pendingStatements } : null} nextName={nextName} />}
      />
      <UploadForm
        activeCycleName={open?.name ?? null}
        nextCycleName={nextName}
        currencySymbol={currency}
        defaultPrice={(replacing?.unitPrice ?? replacing?.cycle?.unitPrice)?.toFixed(2) ?? lastPrice}
        defaultCost={replacing ? replacing.costPrice?.toFixed(2) ?? lastCost : lastCost}
        replace={replacing ? { id: replacing.id, title: replacing.title } : null}
      />

      {open ? (
        <CycleSection cycle={open} items={ofCycle(open.id)} activity={activity} currency={currency} current />
      ) : (
        cycles.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border bg-surface px-4 py-4 text-sm">
            <FolderOpen className="size-5 text-muted" />
            <span className="flex-1 text-muted">ما في دورة شغّالة. أول كشف بترفعه بيبدأ «{nextName}».</span>
          </div>
        )
      )}

      {orphan.length > 0 && (
        <Section title="بلا دورة">
          {orphan.map((s) => <StatementRow key={s.id} s={s} currency={currency} activity={activity.get(s.id) ?? 0} />)}
        </Section>
      )}

      {previous.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted"><History className="size-4" /> الدورات السابقة</h2>
          {previous.map((c) => <CycleSection key={c.id} cycle={c} items={ofCycle(c.id)} activity={activity} currency={currency} />)}
        </section>
      )}

      {old.length > 0 && (
        <details className="group rounded-xl border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-muted">
            القديمة والملغاة ({old.length})
            <ChevronLeft className="size-4 transition-transform group-open:-rotate-90" />
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {old.map((s) => <StatementRow key={s.id} s={s} currency={currency} activity={0} plain />)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** دورة واحدة: رأس بأرقامها وأدواتها، ثم كشوفاتها (ما ينتظر الاعتماد أولًا). الحالية مفتوحة، والسابقة مطوية. */
function CycleSection({ cycle, items, activity, currency, current }: { cycle: CycleItem; items: Item[]; activity: Map<string, number>; currency: string; current?: boolean }) {
  const due = new Prisma.Decimal(cycle.amountDue);
  const collected = new Prisma.Decimal(cycle.collected);
  const remaining = Prisma.Decimal.max(due.sub(collected), 0);
  const pct = due.gt(0) ? Math.min(100, Math.round(collected.div(due).mul(100).toNumber())) : 0;
  const pending = items.filter((s) => s.status === "PENDING_REVIEW");
  const approved = items.filter((s) => s.status === "APPROVED");
  const count = approved.length + pending.length;

  const head = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", current ? "bg-primary text-primary-contrast" : "bg-surface-2 text-muted")}>
        <FolderOpen className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{cycle.name}</span>
          {current ? (
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">الحالية</span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">انتهت</span>
          )}
        </div>
        <div className="text-xs text-muted">
          من {dayMonth(cycle.openedAt)}{cycle.closedAt && ` إلى ${dayMonth(cycle.closedAt)}`} · {count} كشف · {cycle.citizens} شخص · {cycle.cylinders} جرة
        </div>
      </div>
      {!current && remaining.gt(0) && <span className="text-xs text-warning">باقي على الناس {formatMoney(remaining.toFixed(2), currency)}</span>}
    </div>
  );

  const body = (
    <>
      {cycle.citizens > 0 && (
        <div className="px-4 pb-3">
          <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-muted">
            <span>انقبض {formatMoney(collected.toFixed(2))} من {formatMoney(due.toFixed(2))}{remaining.gt(0) && <> · باقي <strong className="text-warning">{formatMoney(remaining.toFixed(2))}</strong></>}</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`المقبوض في ${cycle.name}`}>
            <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {count === 0 ? (
        <p className="border-t border-border px-4 py-4 text-center text-sm text-muted">ما في كشوفات بهذه الدورة بعد. ارفع كشف الهيئة من فوق.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {pending.map((s) => <StatementRow key={s.id} s={s} currency={currency} activity={0} />)}
          {approved.map((s) => <StatementRow key={s.id} s={s} currency={currency} activity={activity.get(s.id) ?? 0} />)}
        </ul>
      )}
    </>
  );
  const menu = <CycleMenu cycle={{ id: cycle.id, name: cycle.name, pending: pending.length }} isOpen={cycle.status === "OPEN"} />;

  if (current) {
    return (
      <section className="overflow-hidden rounded-2xl border border-primary/30 bg-surface shadow-sm" data-cycle={cycle.id}>
        <div className="flex items-start gap-2 p-4">
          <div className="min-w-0 flex-1">{head}</div>
          {menu}
        </div>
        {body}
      </section>
    );
  }
  return (
    <details className="group overflow-hidden rounded-2xl border border-border bg-surface" data-cycle={cycle.id}>
      <summary className="flex cursor-pointer list-none items-start gap-2 p-4">
        <div className="min-w-0 flex-1">{head}</div>
        <ChevronLeft className="mt-2 size-4 shrink-0 text-muted transition-transform group-open:-rotate-90" />
      </summary>
      <div className="flex justify-end px-3 pb-1">{menu}</div>
      {body}
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted">{title}</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">{children}</ul>
    </section>
  );
}

function StatementRow({ s, currency, activity, plain }: { s: Item; currency: string; activity: number; plain?: boolean }) {
  const people = s.rowsOk + s.rowsWarning + s.rowsError;
  const price = s.unitPrice ?? s.cycle?.unitPrice ?? null;
  const pending = s.status === "PENDING_REVIEW";
  const href = `/d/statements/${s.id}`;
  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-4 py-3", pending && "bg-warning-soft/40")}>
      <Link href={href} className="min-w-0 flex-1 hover:underline">
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          {s.title}
          {s.version > 1 && <span className="text-xs font-normal text-muted">(تحديث {s.version})</span>}
          {(plain || pending) && <StatementStatusBadge status={s.status} />}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{people} شخص</span>
          {price && <span>على المواطن <bdi dir="ltr" className="font-semibold text-text">{price.toFixed(2)} {currency}</bdi></span>}
          {s.costPrice && <span>على الموزّع <bdi dir="ltr" className="font-semibold text-text">{s.costPrice.toFixed(2)} {currency}</bdi></span>}
          {s.rowsError > 0 && <span className="text-danger">{s.rowsError} فيها أخطاء</span>}
          {s.rowsWarning > 0 && <span className="text-warning">{s.rowsWarning} تنبيه</span>}
          <span>{formatDateTime(s.importedAt)}</span>
        </div>
      </Link>
      {!plain && (
        <div className="flex items-center gap-1">
          {pending ? (
            <Link href={href} className={buttonClass("primary", "sm")}>راجع واعتمد</Link>
          ) : (
            <Link href={`/d/sheet?s=${s.id}`} className={buttonClass("secondary", "sm")}>افتح الكشف</Link>
          )}
          <StatementActions id={s.id} title={s.title} status={pending ? "PENDING_REVIEW" : "APPROVED"} people={people} activity={activity} isUpdate={Boolean(s.supersedesId)} compact />
        </div>
      )}
    </li>
  );
}
