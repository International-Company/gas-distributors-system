// ينشئ/يحدّث دور التطبيق gas_app ويمنحه الصلاحيات اللازمة فقط.
// يُشغّل بعد كل ترحيل (idempotent). يستخدم اتصال المالك DATABASE_URL.
// gas_app ليس مالك الجداول، لذلك تخضع استعلاماته لسياسات RLS.
import { PrismaClient } from "@prisma/client";

const ownerUrl = process.argv[2] || process.env.DATABASE_URL;
const appPassword = process.env.APP_DB_PASSWORD;
if (!ownerUrl) throw new Error("DATABASE_URL غير محدد");
if (!appPassword || appPassword.length < 12) {
  throw new Error("APP_DB_PASSWORD غير محدد أو أقصر من 12 حرفًا");
}

// جداول للإضافة فقط: لا تعديل ولا حذف من التطبيق.
const APPEND_ONLY = ["audit_logs", "login_attempts", "error_logs", "cycle_events", "entitlement_changes", "file_blobs", "inventory_movements"];
// لا حذف للبيانات من التطبيق إطلاقًا (الأرشفة بدل الحذف)، باستثناء هذه الجداول.
const DELETE_ALLOWED = ["distributor_categories", "statement_rows"];

const db = new PrismaClient({ datasourceUrl: ownerUrl });
const quoteLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;

try {
  const [{ exists }] = await db.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gas_app') AS exists`;
  const pw = quoteLiteral(appPassword);
  if (!exists) {
    await db.$executeRawUnsafe(`CREATE ROLE gas_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pw}`);
  } else {
    await db.$executeRawUnsafe(`ALTER ROLE gas_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${pw}`);
  }
  const [{ current_database: dbName }] = await db.$queryRaw`SELECT current_database()`;
  const stmts = [
    `GRANT CONNECT ON DATABASE "${dbName}" TO gas_app`,
    `GRANT USAGE ON SCHEMA public TO gas_app`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gas_app`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gas_app`,
    `REVOKE TRUNCATE, DELETE ON ALL TABLES IN SCHEMA public FROM gas_app`,
    ...DELETE_ALLOWED.map((t) => `GRANT DELETE ON TABLE "${t}" TO gas_app`),
    `REVOKE ALL ON TABLE "_prisma_migrations" FROM gas_app`,
    ...APPEND_ONLY.map((t) => `REVOKE UPDATE, DELETE ON TABLE "${t}" FROM gas_app`),
    // الإعدادات: صف واحد يُحدّث فقط.
    `REVOKE INSERT, DELETE ON TABLE "system_settings" FROM gas_app`,
  ];
  for (const s of stmts) await db.$executeRawUnsafe(s);
  console.log("[db-roles] تم تجهيز دور gas_app وصلاحياته.");
} finally {
  await db.$disconnect();
}
