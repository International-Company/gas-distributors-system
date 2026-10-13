import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/** يعيد بناء قاعدة الاختبار من الصفر عبر الترحيلات الحقيقية نفسها المستخدمة في الإنتاج. */
export default async function setup() {
  await import("./env");
  const owner = process.env.TEST_DATABASE_URL!;
  const db = new PrismaClient({ datasourceUrl: owner });
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.$executeRawUnsafe("CREATE SCHEMA public");
  await db.$disconnect();
  const env = { ...process.env, DATABASE_URL: owner };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync(`node scripts/db-roles.mjs "${owner}"`, { env, stdio: "pipe" });
}
