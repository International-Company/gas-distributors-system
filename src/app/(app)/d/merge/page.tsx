import Link from "next/link";
import { requirePageActor } from "@/server/http/context";
import { mergeSuggestions } from "@/server/services/citizens";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { MergeActions } from "./actions";

export const metadata = { title: "أسماء مكررة" };

export default async function MergePage() {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const pairs = await mergeSuggestions(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        title="أسماء مكررة"
      />
      {pairs.length === 0 ? (
        <EmptyState>ما في أسماء مكررة. النظام بيعرض هون الأسماء المتشابهة جدًا بأرقام هوية مختلفة لتقرر إن كانوا نفس الشخص.</EmptyState>
      ) : (
        pairs.map(({ a, b, score }) => (
          <Card key={`${a.id}-${b.id}`} title={`تشابه ${Math.round(score * 100)}%`}>
            <div className="grid gap-4 md:grid-cols-2">
              {[a, b].map((c) => (
                <div key={c.id} className="rounded-lg bg-surface-2 p-3 text-sm">
                  <Link href={`/d/citizens/${c.id}`} className="font-semibold text-primary hover:underline">{c.fullName}</Link>
                  <div className="mt-1 text-muted">الهوية: <bdi dir="ltr">{c.nationalId}</bdi></div>
                  <div className="text-muted">استحقاقات قائمة: {c.entitlements.map((e) => e.cycle.name).join("، ") || "لا يوجد"}</div>
                </div>
              ))}
            </div>
            <MergeActions a={{ id: a.id, label: `${a.fullName} (${a.nationalId})` }} b={{ id: b.id, label: `${b.fullName} (${b.nationalId})` }} />
          </Card>
        ))
      )}
    </div>
  );
}
