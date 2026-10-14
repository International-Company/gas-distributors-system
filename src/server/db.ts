import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

// التطبيق يتصل دائمًا بدور gas_app محدود الصلاحيات (APP_DATABASE_URL)،
// فتخضع كل الاستعلامات لسياسات عزل الصفوف (RLS) في PostgreSQL.
// أي استعلام خارج withTenant/withSystem لا يرى بيانات الجداول المعزولة (فشل مغلق).

const globalForDb = globalThis as unknown as { appDb?: PrismaClient };

// يُنشأ الاتصال عند أول استخدام فقط، لا عند تحميل الوحدة، حتى لا يتطلب البناء
// (next build) وجود متغيرات قاعدة البيانات.
function getClient(): PrismaClient {
  if (!globalForDb.appDb) {
    const url = process.env.APP_DATABASE_URL;
    if (!url) throw new Error("APP_DATABASE_URL غير محدد");
    globalForDb.appDb = new PrismaClient({ datasourceUrl: url });
  }
  return globalForDb.appDb;
}

export const appDb: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/** معاملة في سياق موزّع واحد: RLS يقصر الرؤية والكتابة على بياناته. */
export function withTenant<T>(distributorId: string, fn: (tx: Tx) => Promise<T>, opts: { timeout?: number } = {}): Promise<T> {
  if (!distributorId) throw new Error("withTenant: معرف الموزّع مطلوب");
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.distributor_id', ${distributorId}, true), set_config('app.bypass_rls', 'off', true)`;
    return fn(tx);
  }, { ...TX_OPTIONS, ...opts });
}

/** معاملة في السياق المركزي (المديرون والمصادقة والمهام النظامية). */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true), set_config('app.distributor_id', '', true)`;
    return fn(tx);
  }, TX_OPTIONS);
}
