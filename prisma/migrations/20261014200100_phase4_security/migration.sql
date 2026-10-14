-- ============================================================
-- حماية المالية (المرحلة 4)
-- ============================================================

-- ---------- عزل الصفوف ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments', 'expenses', 'station_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_bypass_rls() OR "distributorId" = app_current_distributor()) '
      'WITH CHECK (app_bypass_rls() OR "distributorId" = app_current_distributor())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- ---------- مفاتيح مركّبة ----------
ALTER TABLE "payments" ADD CONSTRAINT payments_entitlement_dist
  FOREIGN KEY ("entitlementId", "distributorId") REFERENCES "entitlements"("id", "distributorId");
ALTER TABLE "payments" ADD CONSTRAINT payments_entitlement_cycle
  FOREIGN KEY ("entitlementId", "cycleId") REFERENCES "entitlements"("id", "cycleId");
ALTER TABLE "station_payments" ADD CONSTRAINT station_payments_station_dist
  FOREIGN KEY ("stationId", "distributorId") REFERENCES "stations"("id", "distributorId");
ALTER TABLE "expenses" ADD CONSTRAINT expenses_distributor
  FOREIGN KEY ("distributorId") REFERENCES "distributors"("id");

-- ---------- قيود القيم ----------
ALTER TABLE "payments" ADD CONSTRAINT payments_amount_positive CHECK ("amount" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT expenses_amount_positive CHECK ("amount" > 0);
ALTER TABLE "station_payments" ADD CONSTRAINT station_payments_amount_positive CHECK ("amount" > 0);
ALTER TABLE "shipments" ADD CONSTRAINT shipments_unit_price_non_negative CHECK ("unitPrice" >= 0);
ALTER TABLE "stations" ADD CONSTRAINT stations_default_price_non_negative CHECK ("defaultUnitPrice" IS NULL OR "defaultUnitPrice" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT payments_cancel_consistent CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
ALTER TABLE "expenses" ADD CONSTRAINT expenses_cancel_consistent CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
ALTER TABLE "station_payments" ADD CONSTRAINT station_payments_cancel_consistent CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

-- ---------- سجلات لا تُعدّل: التغيير الوحيد المسموح هو الإلغاء مرة واحدة ----------
-- يُطبّق على السجلات المالية، وعلى عمليات الجرار والشحنات التي تتبع النمط نفسه.
CREATE OR REPLACE FUNCTION app_cancel_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cancel_cols text[] := ARRAY['status', 'cancelledAt', 'cancelledById', 'cancelReason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'السجل % لا يُحذف؛ استخدم الإلغاء', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - cancel_cols) IS DISTINCT FROM (to_jsonb(OLD) - cancel_cols) THEN
    RAISE EXCEPTION 'السجل % لا يُعدّل؛ صحّحه بالإلغاء ثم سجل جديد', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (OLD."status"::text = 'ACTIVE' AND NEW."status"::text = 'CANCELLED') THEN
    RAISE EXCEPTION 'السجل % أُلغي سابقًا أو التغيير غير مسموح', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_cancel_only BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION app_cancel_only();
CREATE TRIGGER expenses_cancel_only BEFORE UPDATE OR DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION app_cancel_only();
CREATE TRIGGER station_payments_cancel_only BEFORE UPDATE OR DELETE ON "station_payments" FOR EACH ROW EXECUTE FUNCTION app_cancel_only();
CREATE TRIGGER shipments_cancel_only BEFORE UPDATE OR DELETE ON "shipments" FOR EACH ROW EXECUTE FUNCTION app_cancel_only();
CREATE TRIGGER cylinder_operations_cancel_only BEFORE UPDATE OR DELETE ON "cylinder_operations" FOR EACH ROW EXECUTE FUNCTION app_cancel_only();

-- ---------- منع الدفع الزائد ----------
-- مجموع التحصيلات النافذة على استحقاق لا يتجاوز المبلغ المطلوب. يقفل صف الاستحقاق فيتسلسل الدفع المتزامن.
CREATE OR REPLACE FUNCTION app_guard_overpayment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE due numeric; paid numeric;
BEGIN
  IF NEW."status" <> 'ACTIVE' THEN RETURN NEW; END IF;
  SELECT "amountDue" INTO due FROM "entitlements" WHERE "id" = NEW."entitlementId" FOR UPDATE;
  SELECT COALESCE(SUM("amount"), 0) INTO paid FROM "payments"
    WHERE "entitlementId" = NEW."entitlementId" AND "status" = 'ACTIVE' AND "id" <> NEW."id";
  IF paid + NEW."amount" > due THEN
    RAISE EXCEPTION 'دفع زائد: المدفوع سيتجاوز المبلغ المطلوب' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payments_no_overpayment BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION app_guard_overpayment();

-- المبلغ المطلوب لا يُخفض تحت المدفوع فعلًا (بتحديث كشف أو تعديل يدوي).
CREATE OR REPLACE FUNCTION app_guard_due_below_paid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE paid numeric;
BEGIN
  IF NEW."amountDue" >= OLD."amountDue" THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM("amount"), 0) INTO paid FROM "payments" WHERE "entitlementId" = NEW."id" AND "status" = 'ACTIVE';
  IF NEW."amountDue" < paid THEN
    RAISE EXCEPTION 'لا يمكن خفض المبلغ المطلوب تحت المدفوع فعلًا' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER entitlements_due_not_below_paid BEFORE UPDATE OF "amountDue" ON "entitlements" FOR EACH ROW EXECUTE FUNCTION app_guard_due_below_paid();
