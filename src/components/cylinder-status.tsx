import { Badge } from "./ui";

export const CYLINDER_STATUS: Record<string, { label: string; tone: "warning" | "primary" | "success" | "neutral" }> = {
  EMPTY: { label: "فارغة بانتظار التعبئة", tone: "warning" },
  FILLED: { label: "معبأة جاهزة", tone: "primary" },
  DELIVERED: { label: "سُلّمت", tone: "success" },
  VOID: { label: "ملغاة", tone: "neutral" },
};

export function CylinderStatusBadge({ status }: { status: string }) {
  const s = CYLINDER_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const OPERATION_LABELS: Record<string, string> = { RECEIVE_EMPTY: "استلام فارغة", FILL: "تعبئة", DELIVER: "تسليم" };
export const MOVEMENT_LABELS: Record<string, string> = {
  RECEIVE_EMPTY: "استلام فارغة", FILL: "تعبئة", DELIVER: "تسليم", SHIPMENT_EXTRA: "نقلة: كمية إضافية", REVERSAL: "عكس حركة (إلغاء)",
};
