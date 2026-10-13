-- ============================================================
-- طبقة الحماية في قاعدة البيانات
-- 1) عزل الصفوف (RLS) لبيانات الموزّعين.
-- 2) سجلات للإضافة فقط (التدقيق، محاولات الدخول، الأخطاء).
-- 3) صف إعدادات واحد.
--
-- يعمل التطبيق بدور gas_app (ليس مالك الجداول)، لذلك تُطبّق عليه سياسات RLS.
-- كل معاملة تحدد سياقها عبر:
--   app.distributor_id  : معرف الموزّع الحالي (سياق موزّع)
--   app.bypass_rls = on : سياق إداري/نظامي مركزي
-- إن لم يُحدد أي منهما لا تُرجع الجداول المعزولة أي صف (فشل مغلق).
-- ============================================================

CREATE OR REPLACE FUNCTION app_current_distributor() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.distributor_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on'
$$;

-- الموزّعون: يرى سياق الموزّع صفه فقط.
ALTER TABLE "distributors" ENABLE ROW LEVEL SECURITY;
CREATE POLICY distributors_isolation ON "distributors"
  USING (app_bypass_rls() OR "id" = app_current_distributor())
  WITH CHECK (app_bypass_rls() OR "id" = app_current_distributor());

-- المستخدمون: سياق الموزّع يرى مستخدمي موزّعه فقط، ولا يرى حسابات المديرين.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON "users"
  USING (app_bypass_rls() OR "distributorId" = app_current_distributor())
  WITH CHECK (app_bypass_rls() OR "distributorId" = app_current_distributor());

-- سجل التدقيق: سياق الموزّع يرى سجلات موزّعه فقط ويضيف إليها فقط.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_isolation ON "audit_logs"
  USING (app_bypass_rls() OR "distributorId" = app_current_distributor())
  WITH CHECK (app_bypass_rls() OR "distributorId" = app_current_distributor());

-- ---------- سجلات الإضافة فقط ----------
CREATE OR REPLACE FUNCTION app_forbid_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'السجل % محمي: لا يسمح بالتعديل أو الحذف', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION app_forbid_modification();
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION app_forbid_modification();

CREATE TRIGGER login_attempts_append_only
  BEFORE UPDATE OR DELETE ON "login_attempts"
  FOR EACH ROW EXECUTE FUNCTION app_forbid_modification();

CREATE TRIGGER error_logs_append_only
  BEFORE UPDATE OR DELETE ON "error_logs"
  FOR EACH ROW EXECUTE FUNCTION app_forbid_modification();

-- ---------- الإعدادات: صف واحد ----------
ALTER TABLE "system_settings" ADD CONSTRAINT system_settings_singleton CHECK ("id" = 1);
INSERT INTO "system_settings" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT DO NOTHING;

-- ---------- قيود سلامة إضافية ----------
-- الموزّع يجب أن يملك مستخدمًا بدور DISTRIBUTOR، والمدير لا يرتبط بموزّع.
ALTER TABLE "users" ADD CONSTRAINT users_role_distributor CHECK (
  ("role" = 'DISTRIBUTOR' AND "distributorId" IS NOT NULL)
  OR ("role" = 'ADMIN' AND "distributorId" IS NULL)
);
ALTER TABLE "users" ADD CONSTRAINT users_username_lower CHECK ("username" = lower("username"));
ALTER TABLE "distributors" ADD CONSTRAINT distributors_archived_consistent CHECK (
  ("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL)
);
ALTER TABLE "system_settings" ADD CONSTRAINT system_settings_ranges CHECK (
  "sessionIdleMinutes" BETWEEN 5 AND 1440
  AND "maxFailedLogins" BETWEEN 3 AND 20
  AND "lockoutMinutes" BETWEEN 1 AND 1440
);
