import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

// التطبيق يتصل دائمًا بدور gas_app محدود الصلاحيات (APP_DATABASE_URL)،
// فتخضع كل الاستعلامات لسياسات عزل الصفوف (RLS) في PostgreSQL.
// أي استعلام خارج withTenant/withSystem لا يرى بيانات الجداول المعزولة (فشل مغلق).

const globalForDb = globalThis as unknown as { appDb?: PrismaClient };

function createClient() {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL غير محدد");
  return new PrismaClient({ datasourceUrl: url });
}

export const appDb: PrismaClient = globalForDb.appDb ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.appDb = appDb;

export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/** معاملة في سياق موزّع واحد: RLS يقصر الرؤية والكتابة على بياناته. */
export function withTenant<T>(distributorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!distributorId) throw new Error("withTenant: معرف الموزّع مطلوب");
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.distributor_id', ${distributorId}, true), set_config('app.bypass_rls', 'off', true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/** معاملة في السياق المركزي (المديرون والمصادقة والمهام النظامية). */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true), set_config('app.distributor_id', '', true)`;
    return fn(tx);
  }, TX_OPTIONS);
}
