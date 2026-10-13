// إنشاء مدير رئيسي (للتجهيز الأول أو للطوارئ).
// الاستخدام: npm run admin:create -- --username admin --name "اسم المدير"
// تُولَّد كلمة مرور مؤقتة قوية وتُطبع مرة واحدة، ويُلزم المدير بتغييرها عند أول دخول.
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const username = arg("username")?.trim().toLowerCase();
  const displayName = arg("name")?.trim();
  if (!username || !/^[a-z0-9._-]{3,32}$/.test(username) || !displayName) {
    console.error('الاستخدام: npm run admin:create -- --username <اسم> --name "<الاسم الظاهر>"');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL غير محدد");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    if (await db.user.findUnique({ where: { username } })) {
      console.error(`اسم المستخدم "${username}" موجود مسبقًا.`);
      process.exit(1);
    }
    const password = randomBytes(12).toString("base64url") + "7";
    const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const user = await db.user.create({
      data: { username, displayName, passwordHash, role: "ADMIN", isSuperAdmin: true, mustChangePassword: true },
    });
    await db.auditLog.create({
      data: { actorRole: "SYSTEM", action: "admin.create_cli", entityType: "user", entityId: user.id, after: { username, displayName, isSuperAdmin: true } },
    });
    console.log("تم إنشاء المدير الرئيسي.");
    console.log(`اسم المستخدم: ${username}`);
    console.log(`كلمة المرور المؤقتة (تظهر مرة واحدة): ${password}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
