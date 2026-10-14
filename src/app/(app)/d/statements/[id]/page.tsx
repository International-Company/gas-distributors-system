import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { getStatement } from "@/server/services/statements";
import { FIELD_LABELS } from "@/server/statements/mapping";
import { Alert, Badge, Card, DetailList, EmptyState, PageHeader, buttonClass, cn } from "@/components/ui";
import { StatementStatusBadge } from "@/components/statement-status";
import { Pagination } from "@/components/pagination";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ApprovePanel, MappingPanel, MetaPanel, RowActions } from "./review";
import { OcrPanel } from "./ocr-panel";

export const metadata = { title: "مراجعة كشف" };

type Issue = { code: string; message: string; severity: "WARNING" | "ERROR" };
type Extraction = { needsOcr?: boolean; notes?: string[]; duplicateOf?: { id: string; title: string; status: string }[]; ocrConfidence?: number | null };

const CHANGE_LABELS: Record<string, string> = {
  citizenNumber: "رقم المواطن", quantity: "عدد الجرار", amountDue: "المبلغ", nameInStatement: "الاسم", phoneInStatement: "الهاتف",
};

export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const { id } = await params;
  const sp = await searchParams;
  const data = await getStatement(actor, id, { severity: sp.severity, q: sp.q, page: sp.page });
  const st = data.statement;
  const pending = st.status === "PENDING_REVIEW";
  const ex = (st.extraction ?? {}) as Extraction;
  const filterParams = Object.fromEntries(Object.entries({ severity: sp.severity, q: sp.q }).filter(([, v]) => v)) as Record<string, string>;
  const tab = (key: string, label: string, count: number) => (
    <Link
      key={key}
      href={`/d/statements/${id}?${new URLSearchParams(key ? { severity: key } : {})}`}
      className={cn(buttonClass((sp.severity ?? "") === key ? "primary" : "secondary", "sm"))}
    >
      {label} ({count})
    </Link>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={st.title}
        description={st.supersedes ? `إصدار ${st.version} — يحل محل «${st.supersedes.title}» (الإصدار ${st.supersedes.version})` : undefined}
        actions={<StatementStatusBadge status={st.status} />}
      />

      <Card title="الملف">
        <DetailList
          items={[
            ["الملف الأصلي", <a key="f" className="text-primary hover:underline" href={`/api/v1/statements/${id}/file`} target="_blank" rel="noreferrer">{st.file.originalName}</a>],
            ["طريقة الاستخراج", st.parseMethod === "EXCEL" ? "Excel" : st.parseMethod === "PDF_TEXT" ? "PDF نصي" : st.parseMethod === "PDF_OCR" ? "قراءة ضوئية" : "لم يُستخرج بعد"],
            ["الدورة", st.cycle?.name ?? "لم تُحدد"],
            ["الدورة المقترحة من الملف", st.suggestedCycle ? `الدورة ${st.suggestedCycle}` : "—"],
            ["تاريخ الاستيراد", formatDateTime(st.importedAt)],
            ...(st.approvedAt ? ([["تاريخ الاعتماد", formatDateTime(st.approvedAt)]] as [string, string][]) : []),
            ...(st.discardReason ? ([["سبب الإلغاء", st.discardReason]] as [string, string][]) : []),
          ]}
        />
      </Card>

      {ex.duplicateOf && ex.duplicateOf.length > 0 && (
        <Alert tone="warning">
          هذا الملف نفسه مستورد سابقًا:{" "}
          {ex.duplicateOf.map((d, i) => (
            <span key={d.id}>
              {i > 0 && "، "}
              <Link className="underline" href={`/d/statements/${d.id}`}>{d.title}</Link>
            </span>
          ))}
          . تأكد أنك لا تستورد الكشف مرتين.
        </Alert>
      )}
      {ex.notes?.map((n) => <Alert key={n}>{n}</Alert>)}
      {st.parseMethod === "PDF_OCR" && <Alert tone="warning">البيانات مقروءة ضوئيًا. راجع كل صف مقابل الملف الأصلي قبل الاعتماد.</Alert>}

      {pending && ex.needsOcr && <OcrPanel statementId={id} />}

      {pending && <MetaPanel statement={{ id, title: st.title, cycleId: st.cycleId, supersedesId: st.supersedesId }} cycles={data.cycles.map((c) => ({ id: c.id, name: c.name, status: c.status }))} approved={data.approvedStatements} />}

      {pending && data.preview.length > 0 && (
        <MappingPanel
          statementId={id}
          preview={data.preview}
          columns={data.columns}
          headerRow={st.headerRow}
          mapping={(st.columnMapping ?? {}) as Record<string, number | null>}
          labels={FIELD_LABELS}
        />
      )}

      {data.diff && (
        <Card title="الفروق مع الإصدار السابق (لا تُطبق قبل الاعتماد)">
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="success">جدد: {data.diff.added.length}</Badge>
            <Badge tone="warning">تغيّرت بياناتهم: {data.diff.changed.length}</Badge>
            <Badge tone="danger">اختفوا: {data.diff.removed.length}</Badge>
            <Badge>دون تغيير: {data.diff.unchanged}</Badge>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <DiffList title="مواطنون جدد" items={data.diff.added.map((a) => `${a.fullName} — ${a.nationalId} — رقم ${a.citizenNumber}`)} />
            <DiffList
              title="تغيّرت بياناتهم"
              items={data.diff.changed.map((c) => `${c.fullName} (${c.nationalId}): ${c.changes.map((x) => `${CHANGE_LABELS[x.field] ?? x.field} ${x.before ?? "—"} ← ${x.after ?? "—"}`).join("، ")}`)}
            />
            <DiffList title="اختفوا من الكشف الجديد (يبقى سجلهم ويُعلَّم استحقاقهم «أُزيل»)" items={data.diff.removed.map((r) => `${r.fullName} — ${r.nationalId} — رقم ${r.citizenNumber}`)} />
          </div>
        </Card>
      )}

      <Card title="صفوف الكشف">
        <div className="mb-3 flex flex-wrap gap-2">
          {tab("", "الكل", data.summary.ok + data.summary.warning + data.summary.error + data.summary.excluded)}
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
          <EmptyState>لا توجد صفوف.</EmptyState>
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
      </Card>

      {pending && (
        <ApprovePanel
          statementId={id}
          canApprove={data.summary.error === 0 && !!st.cycleId && st.cycle?.status === "OPEN" && data.summary.ok + data.summary.warning > 0}
          summary={data.summary}
          cycleName={st.cycle?.name ?? null}
          cycleOpen={st.cycle?.status === "OPEN"}
        />
      )}
    </div>
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
          {items.map((t) => <li key={t} className="rounded bg-surface-2 px-2 py-1">{t}</li>)}
        </ul>
      )}
    </div>
  );
}
