-- ============================================================
-- حماية جداول المرحلة 2
-- 1) عزل الصفوف (RLS) لكل جدول بيانات موزّع.
-- 2) مفاتيح خارجية مركّبة (المعرّف + الموزّع) تمنع ربط سجل موزّع بسجل موزّع آخر
--    حتى لو أخطأ الكود، لأن فحص المفاتيح الخارجية لا يخضع لـ RLS.
-- 3) قيود فريدة جزئية تحمي قواعد العمل: دورة نشطة واحدة، استحقاق نشط واحد لكل مواطن ولكل رقم مواطن في الدورة.
-- 4) سجلات للإضافة فقط.
-- 5) فهرس البحث بالتشابه في الأسماء.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- عزل الصفوف ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cycles', 'cycle_events', 'stored_files', 'file_blobs', 'statements', 'statement_rows',
    'citizens', 'entitlements', 'entitlement_changes', 'merge_dismissals', 'review_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_bypass_rls() OR "distributorId" = app_current_distributor()) '
      'WITH CHECK (app_bypass_rls() OR "distributorId" = app_current_distributor())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- ---------- مفاتيح مركّبة لمنع الربط بين الموزّعين ----------
ALTER TABLE "cycles" ADD CONSTRAINT cycles_id_dist UNIQUE ("id", "distributorId");
ALTER TABLE "stored_files" ADD CONSTRAINT stored_files_id_dist UNIQUE ("id", "distributorId");
ALTER TABLE "statements" ADD CONSTRAINT statements_id_dist UNIQUE ("id", "distributorId");
ALTER TABLE "citizens" ADD CONSTRAINT citizens_id_dist UNIQUE ("id", "distributorId");
ALTER TABLE "entitlements" ADD CONSTRAINT entitlements_id_dist UNIQUE ("id", "distributorId");

ALTER TABLE "cycle_events" ADD CONSTRAINT cycle_events_cycle_dist
  FOREIGN KEY ("cycleId", "distributorId") REFERENCES "cycles"("id", "distributorId");
ALTER TABLE "file_blobs" ADD CONSTRAINT file_blobs_file_dist
  FOREIGN KEY ("fileId", "distributorId") REFERENCES "stored_files"("id", "distributorId");
ALTER TABLE "statements" ADD CONSTRAINT statements_file_dist
  FOREIGN KEY ("fileId", "distributorId") REFERENCES "stored_files"("id", "distributorId");
ALTER TABLE "statements" ADD CONSTRAINT statements_cycle_dist
  FOREIGN KEY ("cycleId", "distributorId") REFERENCES "cycles"("id", "distributorId");
ALTER TABLE "statements" ADD CONSTRAINT statements_supersedes_dist
  FOREIGN KEY ("supersedesId", "distributorId") REFERENCES "statements"("id", "distributorId");
ALTER TABLE "statement_rows" ADD CONSTRAINT statement_rows_statement_dist
  FOREIGN KEY ("statementId", "distributorId") REFERENCES "statements"("id", "distributorId");
ALTER TABLE "entitlements" ADD CONSTRAINT entitlements_cycle_dist
  FOREIGN KEY ("cycleId", "distributorId") REFERENCES "cycles"("id", "distributorId");
ALTER TABLE "entitlements" ADD CONSTRAINT entitlements_citizen_dist
  FOREIGN KEY ("citizenId", "distributorId") REFERENCES "citizens"("id", "distributorId");
ALTER TABLE "entitlements" ADD CONSTRAINT entitlements_statement_dist
  FOREIGN KEY ("statementId", "distributorId") REFERENCES "statements"("id", "distributorId");
ALTER TABLE "entitlement_changes" ADD CONSTRAINT entitlement_changes_entitlement_dist
  FOREIGN KEY ("entitlementId", "distributorId") REFERENCES "entitlements"("id", "distributorId");
ALTER TABLE "citizens" ADD CONSTRAINT citizens_merged_dist
  FOREIGN KEY ("mergedIntoId", "distributorId") REFERENCES "citizens"("id", "distributorId");

-- ---------- قواعد العمل ----------
-- دورة نشطة واحدة فقط لكل موزّع.
CREATE UNIQUE INDEX cycles_one_open_per_distributor ON "cycles" ("distributorId") WHERE "status" = 'OPEN';
-- استحقاق نشط واحد لكل مواطن في الدورة.
CREATE UNIQUE INDEX entitlements_active_citizen_per_cycle ON "entitlements" ("cycleId", "citizenId") WHERE "status" = 'ACTIVE';
-- رقم المواطن (معرّف الجرة) فريد بين الاستحقاقات النشطة في الدورة.
CREATE UNIQUE INDEX entitlements_active_number_per_cycle ON "entitlements" ("cycleId", "citizenNumber") WHERE "status" = 'ACTIVE';

ALTER TABLE "cycles" ADD CONSTRAINT cycles_price_non_negative CHECK ("unitPrice" >= 0);
ALTER TABLE "cycles" ADD CONSTRAINT cycles_closed_consistent CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));
ALTER TABLE "entitlements" ADD CONSTRAINT entitlements_quantity_positive CHECK ("quantity" > 0);
ALTER TABLE "entitlements" ADD CONSTRAINT entitlements_amount_non_negative CHECK ("amountDue" >= 0);
ALTER TABLE "citizens" ADD CONSTRAINT citizens_national_id_digits CHECK ("nationalId" ~ '^[0-9]{9}$');
ALTER TABLE "citizens" ADD CONSTRAINT citizens_not_self_merged CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");
ALTER TABLE "statements" ADD CONSTRAINT statements_approved_has_cycle CHECK ("status" NOT IN ('APPROVED', 'SUPERSEDED') OR ("cycleId" IS NOT NULL AND "approvedAt" IS NOT NULL));

-- ---------- سجلات للإضافة فقط ----------
CREATE TRIGGER cycle_events_append_only BEFORE UPDATE OR DELETE ON "cycle_events"
  FOR EACH ROW EXECUTE FUNCTION app_forbid_modification();
CREATE TRIGGER entitlement_changes_append_only BEFORE UPDATE OR DELETE ON "entitlement_changes"
  FOR EACH ROW EXECUTE FUNCTION app_forbid_modification();
-- محتوى الملفات الأصلية لا يُعدّل ولا يُحذف.
CREATE TRIGGER file_blobs_immutable BEFORE UPDATE OR DELETE ON "file_blobs"
  FOR EACH ROW EXECUTE FUNCTION app_forbid_modification();

-- ---------- البحث ----------
CREATE INDEX citizens_name_trgm ON "citizens" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX citizens_phone ON "citizens" ("distributorId", "phone");
