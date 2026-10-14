import { Badge } from "./ui";

export const STATEMENT_STATUS: Record<string, { label: string; tone: "warning" | "success" | "neutral" | "danger" }> = {
  PENDING_REVIEW: { label: "قيد المراجعة", tone: "warning" },
  APPROVED: { label: "معتمد", tone: "success" },
  SUPERSEDED: { label: "إصدار سابق", tone: "neutral" },
  DISCARDED: { label: "ملغى", tone: "danger" },
};

export function StatementStatusBadge({ status }: { status: string }) {
  const s = STATEMENT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
