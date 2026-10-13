// يُشغَّل قبل تشغيل الخادم في الإنتاج (npm start):
// 1) تطبيق الترحيلات المعتمدة فقط (prisma migrate deploy) — لا يحذف بيانات ولا يعيد ضبط القاعدة.
// 2) تجهيز دور التطبيق gas_app وصلاحياته.
// أي فشل يوقف التشغيل، لأن تشغيل التطبيق على مخطط غير مطابق أخطر من توقفه.
import { execSync } from "node:child_process";

for (const v of ["DATABASE_URL", "APP_DATABASE_URL", "APP_DB_PASSWORD"]) {
  if (!process.env[v]) {
    console.error(`[predeploy] متغير البيئة ${v} غير محدد`);
    process.exit(1);
  }
}

const run = (cmd) => execSync(cmd, { stdio: "inherit", env: process.env });

console.log("[predeploy] تطبيق ترحيلات قاعدة البيانات...");
run("npx prisma migrate deploy");
console.log("[predeploy] تجهيز دور التطبيق...");
run("node scripts/db-roles.mjs");
console.log("[predeploy] اكتمل.");
