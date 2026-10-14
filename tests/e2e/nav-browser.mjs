// اختبار متصفح للقائمة الجانبية القابلة للطي — للتطوير فقط؛ ينشئ موزّعًا تجريبيًا.
// الاستخدام: E2E_ADMIN_USER=... E2E_ADMIN_PASSWORD=... CHROME_PATH=... node tests/e2e/nav-browser.mjs http://localhost:3000 ./test-results/nav
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/nav";
const { E2E_ADMIN_USER: U, E2E_ADMIN_PASSWORD: P, CHROME_PATH } = process.env;
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ✓" : "  ✗", name, ok ? "" : extra); if (!ok) fails++; };

const jar = new Map();
const call = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { Origin: BASE, "Content-Type": "application/json", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: b ? JSON.stringify(b) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
  return r.json().catch(() => null);
};
await call("POST", "/api/v1/auth/login", { username: U, password: P });
const tag = Math.random().toString(36).slice(2, 6);
await call("POST", "/api/v1/admin/distributors", { name: "وليد الشياح", username: `navd_${tag}`, password: "Start-1234", phone: "0599000888", region: "غزة" });

const b = await chromium.launch({ executablePath: CHROME_PATH });
const login = async (ctx, u, p, change) => {
  const pg = await ctx.newPage();
  await pg.goto(BASE + "/login"); await pg.fill("#username", u); await pg.fill("#password", p); await pg.click("button[type=submit]");
  if (change) { await pg.waitForURL("**/change-password"); await pg.fill("#cp-current", p); await pg.fill("#cp-new", "Mine-5678"); await pg.fill("#cp-confirm", "Mine-5678"); await pg.click("button[type=submit]"); }
  await pg.waitForLoadState("networkidle"); return pg;
};
const d = await b.newContext({ viewport: { width: 1280, height: 760 } });
const dp = await login(d, `navd_${tag}`, "Start-1234", true);
const aside = dp.locator("aside").first();
const grp = (name) => aside.getByRole("button", { name });

await dp.goto(BASE + "/d/cylinders"); await dp.waitForLoadState("networkidle");
check("مجموعة الصفحة الحالية مفتوحة تلقائيًا", (await grp("الجرار والمخزون").getAttribute("aria-expanded")) === "true");
check("المجموعات الأخرى مطوية افتراضيًا", (await grp("المالية").getAttribute("aria-expanded")) === "false" && (await grp("الكشوف والمواطنون").getAttribute("aria-expanded")) === "false");
check("أقسام المجموعة المطوية خارج التنقل بلوحة المفاتيح (inert)", (await aside.locator("#nav-group-money").getAttribute("inert")) !== null);
check("التقارير قسم مباشر دون عنوان مكرر", (await aside.getByText("التقارير", { exact: true }).count()) === 1);
check("القسم الحالي مميز (aria-current)", (await aside.locator("[aria-current=page]").textContent()).includes("الجرار"));
await aside.screenshot({ path: `${OUT}/n-01-default.png` });

await grp("المالية").click();
await dp.waitForTimeout(300);
check("فتح مجموعة بالنقر", (await grp("المالية").getAttribute("aria-expanded")) === "true" && await aside.getByRole("link", { name: "الصندوق" }).isVisible());
await aside.screenshot({ path: `${OUT}/n-02-opened.png` });
await grp("الجرار والمخزون").click();
await dp.waitForTimeout(300);
check("طي مجموعة الصفحة الحالية يُظهر نقطة تدل عليها", (await grp("الجرار والمخزون").getAttribute("aria-expanded")) === "false");
await dp.reload(); await dp.waitForLoadState("networkidle");
check("حالة الطي محفوظة بعد إعادة التحميل", (await grp("المالية").getAttribute("aria-expanded")) === "true");
await aside.getByRole("link", { name: "الصندوق" }).click();
await dp.waitForURL("**/d/finance");
await dp.goto(BASE + "/d/cylinders"); await dp.waitForLoadState("networkidle");
check("الانتقال لصفحة في مجموعة مطوية يفتحها", (await grp("الجرار والمخزون").getAttribute("aria-expanded")) === "true");

const dd = await b.newContext({ viewport: { width: 1280, height: 760 }, colorScheme: "dark", storageState: await d.storageState() });
const ddp = await dd.newPage(); await ddp.goto(BASE + "/d/collections"); await ddp.waitForLoadState("networkidle");
await ddp.evaluate(() => { document.documentElement.classList.remove("light"); document.documentElement.classList.add("dark"); });
await ddp.locator("aside").first().screenshot({ path: `${OUT}/n-03-dark.png` });

const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await d.storageState() });
const mp = await m.newPage(); await mp.goto(BASE + "/d/counter"); await mp.getByLabel("فتح القائمة").tap(); await mp.waitForTimeout(400);
await mp.screenshot({ path: `${OUT}/n-04-mobile.png` });
check("الهاتف: لا تمرير أفقي", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

const a = await b.newContext({ viewport: { width: 1280, height: 760 } });
const ap = await login(a, U, P, false); await ap.goto(BASE + "/admin/audit"); await ap.waitForLoadState("networkidle");
check("قائمة الإدارة: «إدارة الموزّعين» عنوان لا يكرر اسم القسم", (await ap.locator("aside").first().getByRole("button", { name: "إدارة الموزّعين" }).count()) === 1);
await ap.locator("aside").first().screenshot({ path: `${OUT}/n-05-admin.png` });
await b.close();
console.log(`\nفشل: ${fails}`);
process.exit(fails ? 1 : 0);
