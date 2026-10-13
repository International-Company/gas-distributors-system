import { Badge } from "./ui";

export function DistributorStatusBadge({ d }: { d: { status: string; suspensionReason: string | null } }) {
  if (d.status === "ACTIVE") return <Badge tone="success">نشط</Badge>;
  if (d.status === "ARCHIVED") return <Badge>مؤرشف</Badge>;
  if (d.suspensionReason === "EXPIRED") return <Badge tone="danger">منتهي الصلاحية</Badge>;
  return <Badge tone="warning">معلّق</Badge>;
}
