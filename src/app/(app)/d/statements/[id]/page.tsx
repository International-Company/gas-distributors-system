import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePageActor } from "@/server/http/context";
import { getStatement, statementActivity } from "@/server/services/statements";
import { FIELD_LABELS, REQUIRED_FIELDS } from "@/server/statements/mapping";
import { Alert, Badge, Card, DetailList, EmptyState, PageHeader, buttonClass, cn } from "@/components/ui";
import { StatementStatusBadge } from "@/components/statement-status";
import { Pagination } from "@/components/pagination";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ApprovePanel, MappingPanel, MetaPanel, RowActions } from "./review";
import { OcrPanel } from "./ocr-panel";
import { StatementActions } from "../statement-actions";
import { STATEMENT_STEPS, Steps } from "@/components/steps";

export const metadata = { title: "مراجعة كشف" };

type Issue = { code: string; message: string; severity: "WARNING" | "ERROR" };
type Extraction = { needsOcr?: boolean; notes?: string[]; duplicateOf?: { id: string; title: string; status: string }[]; ocrConfidence?: number | null };

const CHANGE_LABELS: Record<string, string> = {
  citizenNumber: "رقم المواطن", quantity: "عدد الجرار", amountDue: "المبلغ", nameInStatement: "الاسم", phoneInStatement: "الهاتف",
};

/**
 * مراجعة الكشف: ملخص النتيجة، ثم الإجراء الوحيد المطلوب (اعتماد إن كان سليمًا، أو تصحيح الأخطاء)،
 * والتفاصيل والإعدادات مطوية.
 */
export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const { id } = await params;
  const sp = await searchParams;
  let data = await getStatement(actor, id, { severity: sp.severity, q: sp.q, page: sp.page });
  const st = data.statement;
  const pending = st.status === "PENDING_REVIEW";
  // فيه أخطاء ولم يختر المستخدم فلترًا: تُعرض الصفوف الخاطئة فقط لتصحيحها.
  const errorsMode = pending && data.summary.error > 0;
  const defaultErrors = errorsMode && !sp.severity && !sp.q && !sp.rows;
  if (defaultErrors) data = await getStatement(actor, id, { severity: "ERROR", page: sp.page });
  const severity = sp.severity ?? (defaultErrors ? "ERROR" : "");
  const ex = (st.extraction ?? {}) as Extraction;
  const activity = st.status === "APPROVED" ? (await statementActivity(actor, [st.id])).get(st.id) ?? 0 : 0;
  const mapping = (st.columnMapping ?? {}) as Record<string, number | null>;
  const mappingBroken = pending && data.preview.length > 0 && REQUIRED_FIELDS.some((f) => mapping[f] == null);
  const people = data.summary.ok + data.summary.warning + data.summary.error;
  const filterParams = Object.fromEntries(Object.entries({ severity: sp.severity, q: sp.q }).filter(([, v]) => v)) as Record<string, string>;
  const rowsOpen = errorsMode || Boolean(sp.severity || sp.q || sp.page || sp.rows);

  const tab = (key: string, label: string, count: number) => (
    <Link
      key={key}
      href={`/d/statements/${id}?${new URLSearchParams(key ? { severity: key } : { severity: "ALL" })}`.replace("severity=ALL", "rows=1")}
      className={cn(buttonClass(severity === key ? "primary" : "secondary", "sm"))}
    >
      {label} ({count})
    </Link>
  );

  const rowsTable = (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {tab("", "الكل", people + data.summary.excluded)}
        {tab("ERROR", "أخطاء", data.summary.error)}
        {tab("WARNING", "تنبيهات", data.summary.warning)}
        {tab("OK", "سليمة", data.summary.ok)}
        {tab("EXCLUDED", "مستبعدة", data.summary.excluded)}
      </div>
      <form method="get" className="mb-3 flex gap-2">
        {sp.severity && <input type="hidden" name="severity" value={sp.severity} />}
        <input name="q" defaultValue={sp.q} placeholder="بحث بالاسم أو الهوية أو الرقم" className="h-9 w-full max-w-xs rounded-lg border border-border bg-surface px-3 text-sm" />
        <button className={buttonClass("secondary", "sm", "h-9")}>بحث</button>
      </form>
      {data.rows.length === 0 ? (
        <EmptyState>ما في صفوف بهذا الفلتر.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-right text-xs text-muted">
              <tr className="border-b border-border">
                <th className="py-2 font-medium">الصف</th>
                <th className="py-2 font-medium">رقم المواطن</th>
                <th className="py-2 font-medium">الاسم</th>
                <th className="py-2 font-medium">رقم الهوية</th>
                <th className="py-2 font-medium">الهاتف</th>
                <th className="py-2 font-medium">الجرار</th>
                <th className="py-2 font-medium">المبلغ</th>
                <th className="py-2 font-medium">الملاحظات</th>
                {pending && <th className="py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => {
                const issues = (r.issues as unknown as Issue[]) ?? [];
                return (
                  <tr key={r.id} className={cn(r.excluded && "opacity-50", !r.excluded && r.severity === "ERROR" && "bg-danger-soft/40")}>
                    <td className="py-2 ltr-nums">{r.rowIndex}</td>
                    <td className="py-2 ltr-nums">{r.citizenNumber ?? "—"}</td>
                    <td className="py-2">{r.fullName ?? "—"}</td>
                    <td className="py-2 ltr-nums">{r.nationalId ?? "—"}</td>
                    <td className="py-2 ltr-nums">{r.phone ?? "—"}</td>
                    <td className="py-2">{r.quantity ?? "—"}</td>
                    <td className="py-2">{r.amount ? formatMoney(r.amount) : "—"}</td>
                    <td className="py-2">
                      {r.excluded && <Badge>مستبعد</Badge>}
                      <ul className="space-y-0.5">
                        {issues.map((i) => (
                          <li key={i.code} className={cn("text-xs", i.severity === "ERROR" ? "text-danger" : "text-warning")}>{i.message}</li>
                        ))}
                      </ul>
                    </td>
                    {pending && (
                      <td className="py-2">
                        <RowActions
                          statementId={id}
                          row={{ id: r.id, nationalId: r.nationalId, fullName: r.fullName, phone: r.phone, citizenNumber: r.citizenNumber, quantity: r.quantity, amount: r.amount?.toString() ?? null, excluded: r.excluded }}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} total={data.total} pageSize={data.pageSize} base={`/d/statements/${id}`} params={filterParams} />
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={st.title}
        actions={
          <span className="flex gap-1">
            {st.version > 1 && <Badge tone="primary">تحديث {st.version}</Badge>}
            <StatementStatusBadge status={st.status} />
          </span>
        }
      />
      {(pending || st.status === "APPROVED") && <Steps steps={STATEMENT_STEPS} current={pending ? 1 : 3} />}
      {st.status === "APPROVED" && (
        <Alert tone="success" className="flex flex-wrap items-center justify-between gap-2">
          <span>الكشف معتمد. افتحه لتسليم الناس والقبض منهم.</span>
          <span className="flex items-center gap-1">
            <StatementActions id={st.id} title={st.title} status="APPROVED" people={data.summary.ok + data.summary.warning + data.summary.error} activity={activity} isUpdate={Boolean(st.supersedesId)} />
            <Link href={`/d/sheet?s=${st.id}`} className={buttonClass("primary", "sm")}>افتح الكشف</Link>
          </span>
        </Alert>
      )}

      {ex.duplicateOf && ex.duplicateOf.length > 0 && (
        <Alert tone="warning">
          هذا الملف نفسه مرفوع سابقًا:{" "}
          {ex.duplicateOf.map((d, i) => (
            <span key={d.id}>
              {i > 0 && "، "}
              <Link className="underline" href={`/d/statements/${d.id}`}>{d.title}</Link>
            </span>
          ))}
          . تأكد أنك لا ترفع الكشف مرتين.
        </Alert>
      )}
      {ex.notes?.map((n) => <Alert key={n}>{n}</Alert>)}
      {st.parseMethod === "PDF_OCR" && <Alert tone="warning">البيانات مقروءة ضوئيًا. راجع الصفوف مقابل الملف الأصلي قبل الاعتماد.</Alert>}

      {pending && ex.needsOcr && <OcrPanel statementId={id} autoStart />}

      {mappingBroken && (
        <MappingPanel statementId={id} preview={data.preview} columns={data.columns} headerRow={st.headerRow} mapping={mapping} labels={FIELD_LABELS} needsAttention />
      )}

      {/* ملخص النتيجة */}
      {!ex.needsOcr && people + data.summary.excluded > 0 && (
        <Card>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Num label="الناس في الكشف" value={people} />
            <Num label="سليم" value={data.summary.ok} tone="text-success" />
            <Num label="تنبيه" value={data.summary.warning} tone={data.summary.warning ? "text-warning" : undefined} />
            <Num label="خطأ" value={data.summary.error} tone={data.summary.error ? "text-danger" : undefined} />
          </div>
          <p className="mt-3 text-sm text-muted">
            {st.cycle ? st.cycle.name : "لم تُحدد الدورة"}
            {st.scaleNumber && <> · ميزان <bdi dir="ltr">{st.scaleNumber}</bdi></>}
            {data.summary.excluded > 0 && <> · {data.summary.excluded} مستبعد</>}
          </p>
          {data.diff && (
            <details className="group mt-3 rounded-lg bg-surface-2 p-3">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">تحديث لكشف «{st.supersedes?.title}»:</span>
                <Badge tone="success">+{data.diff.added.length} جدد</Badge>
                <Badge tone="warning">{data.diff.changed.length} تغيّروا</Badge>
                <Badge tone="danger">{data.diff.removed.length} اختفوا</Badge>
                <span className="text-xs text-primary group-open:hidden">عرض الفروق</span>
              </summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-3">
                <DiffList title="جدد" items={data.diff.added.map((a) => `${a.fullName} — ${a.nationalId} — رقم ${a.citizenNumber}`)} />
                <DiffList
                  title="تغيّرت بياناتهم"
                  items={data.diff.changed.map((c) => `${c.fullName} (${c.nationalId}): ${c.changes.map((x) => `${CHANGE_LABELS[x.field] ?? x.field} ${x.before ?? "—"} ← ${x.after ?? "—"}`).join("، ")}`)}
                />
                <DiffList title="اختفوا (يبقى سجلهم ويُعلَّم «أُزيل»)" items={data.diff.removed.map((r) => `${r.fullName} — ${r.nationalId} — رقم ${r.citizenNumber}${r.received ? ` — استلم ${r.received} جرة` : ""}${Number(r.paid) > 0 ? ` — دفع ${r.paid}` : ""}`)} />
              </div>
            </details>
          )}
        </Card>
      )}

      {/* الإجراء المطلوب */}
      {errorsMode ? (
        <Card title={`صحّح ${data.summary.error} صف فيه أخطاء`}>
          <Alert tone="danger" className="mb-3">صحّح كل صف (✎) أو استبعده، وبعدها بيظهر زر الاعتماد.</Alert>
          {rowsTable}
        </Card>
      ) : (
        pending && !ex.needsOcr && (
          <ApprovePanel
            statementId={id}
            canApprove={!!st.cycleId && st.cycle?.status === "OPEN" && people > 0}
            count={people}
            warnings={data.summary.warning}
            cycleName={st.cycle?.name ?? null}
            cycleOpen={st.cycle?.status === "OPEN"}
          />
        )
      )}

      {!errorsMode && people + data.summary.excluded > 0 && (
        <Fold title={`صفوف الكشف (${people + data.summary.excluded})`} open={rowsOpen}>{rowsTable}</Fold>
      )}

      <Fold title="تفاصيل وإعدادات">
        <div className="space-y-4">
          <DetailList
            items={[
              ["الملف الأصلي", <a key="f" className="text-primary hover:underline" href={`/api/v1/statements/${id}/file`} target="_blank" rel="noreferrer">{st.file.originalName}</a>],
              ["طريقة القراءة", st.parseMethod === "EXCEL" ? "Excel" : st.parseMethod === "PDF_TEXT" ? "PDF نصي" : st.parseMethod === "PDF_OCR" ? "قراءة ضوئية" : "لم يُقرأ بعد"],
              ...(st.supersedes ? ([["يحل محل", `«${st.supersedes.title}» (الإصدار ${st.supersedes.version})`]] as [string, string][]) : []),
              ["تاريخ الرفع", formatDateTime(st.importedAt)],
              ...(st.approvedAt ? ([["تاريخ الاعتماد", formatDateTime(st.approvedAt)]] as [string, string][]) : []),
              ...(st.discardReason ? ([["سبب الإلغاء", st.discardReason]] as [string, string][]) : []),
            ]}
          />
          {pending && <MetaPanel statement={{ id, title: st.title, cycleId: st.cycleId, supersedesId: st.supersedesId, scaleNumber: st.scaleNumber }} cycles={data.cycles.map((c) => ({ id: c.id, name: c.name, status: c.status }))} approved={data.approvedStatements} />}
          {pending && !mappingBroken && data.preview.length > 0 && (
            <MappingPanel statementId={id} preview={data.preview} columns={data.columns} headerRow={st.headerRow} mapping={mapping} labels={FIELD_LABELS} needsAttention={false} />
          )}
        </div>
      </Fold>
    </div>
  );
}

function Num({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3 text-center">
      <div className={cn("text-2xl font-bold tabular-nums", tone)}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Fold({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
        {title}
        <ChevronLeft className="size-4 text-muted transition-transform group-open:-rotate-90" />
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted">لا يوجد</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
          {items.map((t) => <li key={t} className="rounded bg-surface px-2 py-1">{t}</li>)}
        </ul>
      )}
    </div>
  );
}
