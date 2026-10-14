import { describe, expect, it } from "vitest";
import { ownerDb } from "../helpers/factories";

// القيود والفهارس المكتوبة يدويًا بـ SQL لا يعرفها Prisma، و«prisma migrate diff» يقترح حذفها.
// هذا الاختبار يفشل إن حذفها ترحيل لاحق بالخطأ.

const CONSTRAINTS = [
  "cylinder_operations_weight_valid",
  "users_role_distributor", "distributors_archived_consistent", "system_settings_singleton",
  "cycles_id_dist", "citizens_id_dist", "entitlements_id_dist", "statements_id_dist", "stored_files_id_dist",
  "entitlements_cycle_dist", "entitlements_citizen_dist", "entitlements_statement_dist", "statement_rows_statement_dist",
  "statements_file_dist", "statements_cycle_dist", "file_blobs_file_dist", "cycle_events_cycle_dist", "entitlement_changes_entitlement_dist",
  "citizens_merged_dist", "cylinders_entitlement_dist", "cylinders_entitlement_cycle", "cylinder_operations_cylinder_dist",
  "shipments_station_dist", "inventory_balances_non_negative", "shipments_counts", "inventory_movements_reversal_ref",
  "payments_entitlement_dist", "payments_entitlement_cycle", "station_payments_station_dist", "payments_amount_positive",
  "expenses_amount_positive", "station_payments_amount_positive", "shipments_unit_price_non_negative",
];
const INDEXES = [
  "cycles_one_open_per_distributor", "entitlements_active_citizen_per_cycle", "entitlements_active_number_per_cycle",
  "cylinders_unit_once", "cylinders_label_per_cycle", "cylinder_operations_once", "citizens_name_trgm",
];
const TRIGGERS = [
  "audit_logs_append_only", "login_attempts_append_only", "cycle_events_append_only", "entitlement_changes_append_only",
  "file_blobs_immutable", "statement_rows_guard", "inventory_movements_append_only",
  "payments_cancel_only", "expenses_cancel_only", "station_payments_cancel_only", "shipments_cancel_only", "cylinder_operations_cancel_only",
  "payments_no_overpayment", "entitlements_due_not_below_paid",
];
const RLS_TABLES = [
  "distributors", "users", "audit_logs", "cycles", "statements", "statement_rows", "citizens", "entitlements", "stored_files",
  "file_blobs", "cylinders", "cylinder_operations", "stations", "shipments", "inventory_movements", "inventory_balances",
  "payments", "expenses", "station_payments",
];

describe("حراس المخطط", () => {
  it("كل القيود اليدوية موجودة", async () => {
    const rows = await ownerDb.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint`;
    const have = new Set(rows.map((r) => r.conname));
    expect(CONSTRAINTS.filter((c) => !have.has(c))).toEqual([]);
  });

  it("كل الفهارس الجزئية والخاصة موجودة", async () => {
    const rows = await ownerDb.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const have = new Set(rows.map((r) => r.indexname));
    expect(INDEXES.filter((i) => !have.has(i))).toEqual([]);
  });

  it("كل triggers الحماية موجودة", async () => {
    const rows = await ownerDb.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`;
    const have = new Set(rows.map((r) => r.tgname));
    expect(TRIGGERS.filter((t) => !have.has(t))).toEqual([]);
  });

  it("عزل الصفوف مفعّل على كل جداول بيانات الموزّعين", async () => {
    const rows = await ownerDb.$queryRaw<{ relname: string }[]>`SELECT relname FROM pg_class WHERE relrowsecurity AND relkind = 'r'`;
    const have = new Set(rows.map((r) => r.relname));
    expect(RLS_TABLES.filter((t) => !have.has(t))).toEqual([]);
  });
});
