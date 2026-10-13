import { existsSync } from "node:fs";

// الاختبارات تعمل دائمًا على قاعدة الاختبار المنفصلة، لا على قاعدة التطوير أو الإنتاج.
if (existsSync(".env")) process.loadEnvFile(".env");
const owner = process.env.TEST_DATABASE_URL;
const app = process.env.TEST_APP_DATABASE_URL;
if (!owner || !app) throw new Error("TEST_DATABASE_URL و TEST_APP_DATABASE_URL مطلوبان لتشغيل الاختبارات");
for (const u of [owner, app]) {
  if (!new URL(u).pathname.endsWith("_test")) throw new Error(`رفض التشغيل: قاعدة الاختبار يجب أن ينتهي اسمها بـ _test (${new URL(u).pathname})`);
}
process.env.DATABASE_URL = owner;
process.env.APP_DATABASE_URL = app;
