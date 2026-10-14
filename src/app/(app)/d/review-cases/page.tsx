import { requirePageActor } from "@/server/http/context";
import { listReviewCases } from "@/server/services/citizens";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { NewCase, ResolveCase } from "./actions";

export const metadata = { title: "حالات المراجعة" };

export default async function ReviewCasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const cases = await listReviewCases(actor, {});
  return (
    <div className="space-y-6">
      <PageHeader
        title="حالات المراجعة"
        description="مواطنون حضروا ولا يظهرون في كشف معتمد. تسجيل الحالة لا ينشئ مواطنًا ولا استحقاقًا."
      />
      <NewCase initialOpen={sp.new === "1"} initial={{ nationalId: sp.nationalId ?? "", fullName: sp.fullName ?? "" }} />
      {cases.length === 0 ? (
        <EmptyState>لا توجد حالات.</EmptyState>
      ) : (
        <div className="space-y-2">
          {cases.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm">
                  <div className="font-semibold">{c.fullName ?? "دون اسم"} {c.nationalId && <span className="font-normal text-muted">— <bdi dir="ltr">{c.nationalId}</bdi></span>}</div>
                  {c.phone && <div className="text-muted">الهاتف: <bdi dir="ltr">{c.phone}</bdi></div>}
                  <div className="mt-1">{c.details}</div>
                  <div className="mt-1 text-xs text-muted">{formatDateTime(c.createdAt)}</div>
                  {c.resolution && <div className="mt-2 rounded bg-surface-2 p-2">النتيجة: {c.resolution} <span className="text-xs text-muted">({formatDateTime(c.resolvedAt)})</span></div>}
                </div>
                {c.status === "OPEN" ? <Badge tone="warning">مفتوحة</Badge> : <Badge tone="success">مغلقة</Badge>}
              </div>
              {c.status === "OPEN" && <ResolveCase id={c.id} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
