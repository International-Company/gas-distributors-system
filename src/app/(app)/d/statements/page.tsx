import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePageActor } from "@/server/http/context";
import { listStatements } from "@/server/services/statements";
import { listCycles } from "@/server/services/cycles";
import { getPublicSettings } from "@/server/services/settings";
import { PageHeader, buttonClass } from "@/components/ui";
import { StatementStatusBadge } from "@/components/statement-status";
import { formatDateTime } from "@/lib/format";
import { UploadForm } from "./upload-form";

export const metadata = { title: "الكشوفات" };

type Item = Awaited<ReturnType<typeof listStatements>>[number];

/** الكشوفات: رفع بخطوة واحدة، ثم ما ينتظر الاعتماد، ثم المعتمدة. القديمة والملغاة مطوية. */
export default async function StatementsPage() {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const [list, cycles, settings] = await Promise.all([listStatements(actor, {}), listCycles(actor), getPublicSettings()]);
  const open = cycles.find((c) => c.status === "OPEN");
  const pending = list.filter((s) => s.status === "PENDING_REVIEW");
  const approved = list.filter((s) => s.status === "APPROVED");
  const old = list.filter((s) => s.status === "SUPERSEDED" || s.status === "DISCARDED");

  return (
    <div className="space-y-6">
      <PageHeader title="الكشوفات" />
      <UploadForm activeCycle={open ? { name: open.name, unitPrice: open.unitPrice.toFixed(2), currencySymbol: settings.currencySymbol } : null} />

      {pending.length > 0 && (
        <Section title="بانتظار الاعتماد">
          {pending.map((s) => (
            <Row key={s.id} s={s} href={`/d/statements/${s.id}`} cta={<span className={buttonClass("primary", "sm")}>راجع واعتمد</span>} />
          ))}
        </Section>
      )}

      {approved.length > 0 && (
        <Section title="المعتمدة">
          {approved.map((s) => (
            <Row key={s.id} s={s} href={`/d/statements/${s.id}`} cta={<Link href={`/d/sheet?s=${s.id}`} className={buttonClass("secondary", "sm")}>افتح الكشف</Link>} />
          ))}
        </Section>
      )}

      {old.length > 0 && (
        <details className="group rounded-xl border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-muted">
            القديمة والملغاة ({old.length})
            <ChevronLeft className="size-4 transition-transform group-open:-rotate-90" />
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {old.map((s) => <Row key={s.id} s={s} href={`/d/statements/${s.id}`} plain />)}
          </ul>
        </details>
      )}
    </div>
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

function Row({ s, href, cta, plain }: { s: Item; href: string; cta?: React.ReactNode; plain?: boolean }) {
  const people = s.rowsOk + s.rowsWarning + s.rowsError;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Link href={href} className="min-w-0 flex-1 hover:underline">
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          {s.title}
          {s.version > 1 && <span className="text-xs font-normal text-muted">(تحديث {s.version})</span>}
          {plain && <StatementStatusBadge status={s.status} />}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{people} شخص</span>
          {s.rowsError > 0 && <span className="text-danger">{s.rowsError} فيها أخطاء</span>}
          {s.rowsWarning > 0 && <span className="text-warning">{s.rowsWarning} تنبيه</span>}
          <span>{formatDateTime(s.importedAt)}</span>
        </div>
      </Link>
      {cta}
    </li>
  );
}
