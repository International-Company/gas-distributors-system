import { Badge } from "./ui";

export const STATEMENT_STATUS: Record<string, { label: string; tone: "warning" | "success" | "neutral" | "danger" }> = {
  PENDING_REVIEW: { label: "بانتظار الاعتماد", tone: "warning" },
  APPROVED: { label: "معتمد", tone: "success" },
  SUPERSEDED: { label: "نسخة قديمة", tone: "neutral" },
  DISCARDED: { label: "ملغى", tone: "danger" },
};

export function StatementStatusBadge({ status }: { status: string }) {
  const s = STATEMENT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
