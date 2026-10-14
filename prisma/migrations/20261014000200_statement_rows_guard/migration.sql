-- صفوف الكشف مسودة عمل قابلة للتعديل وإعادة الاستخراج فقط ما دام الكشف «قيد المراجعة».
-- بعد الاعتماد (أو الإلغاء) تصبح سجلًا تاريخيًا لا يُعدّل ولا يُحذف.
CREATE OR REPLACE FUNCTION app_guard_statement_rows() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st "StatementStatus";
BEGIN
  SELECT "status" INTO st FROM "statements" WHERE "id" = COALESCE(OLD."statementId", NEW."statementId");
  IF st IS DISTINCT FROM 'PENDING_REVIEW' THEN
    RAISE EXCEPTION 'لا يمكن تعديل صفوف كشف غير قيد المراجعة' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER statement_rows_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "statement_rows"
  FOR EACH ROW EXECUTE FUNCTION app_guard_statement_rows();
