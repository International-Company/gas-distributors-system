// اختبار متصفح للقائمة الجانبية — للتطوير فقط؛ ينشئ موزّعًا تجريبيًا.
// الموزّع: ثلاثة أقسام مباشرة (الكشف، الكشوفات، الفلوس). الإدارة: مجموعات قابلة للطي.
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

// ---------- الموزّع ----------
const d = await b.newContext({ viewport: { width: 1280, height: 760 } });
const dp = await login(d, `navd_${tag}`, "Start-1234", true);
const aside = dp.locator("aside").first();
const links = (await aside.getByRole("link").allTextContents()).map((t) => t.trim()).filter(Boolean);
check("قائمة الموزّع: الكشف والكشوفات والفلوس فقط", links.filter((l) => ["الكشف", "الكشوفات", "الفلوس"].includes(l)).length === 3 && links.length === 4, links.join("|"));
check("لا مجموعات منسدلة للموزّع", (await aside.getByRole("button", { expanded: false }).count()) + (await aside.getByRole("button", { expanded: true }).count()) === 0);
check("عنوان اللوحة «لوحة الموزّع»", (await aside.textContent()).includes("لوحة الموزّع"));
check("القسم الحالي «الكشف»", (await aside.locator("[aria-current=page]").textContent()).includes("الكشف"));
await aside.screenshot({ path: `${OUT}/n-01-distributor.png` });

const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await d.storageState() });
const mp = await m.newPage(); await mp.goto(BASE + "/d/sheet"); await mp.getByLabel("فتح القائمة").tap(); await mp.waitForTimeout(400);
await mp.screenshot({ path: `${OUT}/n-02-mobile.png` });
check("الهاتف: لا تمرير أفقي", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

// ---------- الإدارة: مجموعات قابلة للطي ----------
const a = await b.newContext({ viewport: { width: 1280, height: 760 } });
const ap = await login(a, U, P, false);
const aa = ap.locator("aside").first();
const grp = (name) => aa.getByRole("button", { name, exact: true });
await ap.goto(BASE + "/admin/audit"); await ap.waitForLoadState("networkidle");
check("مجموعة الصفحة الحالية مفتوحة تلقائيًا", (await grp("المتابعة والتقارير").getAttribute("aria-expanded")) === "true");
check("المجموعات الأخرى مطوية افتراضيًا", (await grp("الموزّعين").getAttribute("aria-expanded")) === "false");
check("أقسام المجموعة المطوية خارج التنقل بلوحة المفاتيح (inert)", (await aa.locator("#nav-group-people").getAttribute("inert")) !== null);
await grp("الموزّعين").click();
await ap.waitForTimeout(300);
check("فتح مجموعة بالنقر", (await grp("الموزّعين").getAttribute("aria-expanded")) === "true" && await aa.getByRole("link", { name: "المجموعات" }).isVisible());
await ap.reload(); await ap.waitForLoadState("networkidle");
check("حالة الطي محفوظة بعد إعادة التحميل", (await grp("الموزّعين").getAttribute("aria-expanded")) === "true");
await grp("المتابعة والتقارير").click();
await ap.waitForTimeout(300);
await ap.goto(BASE + "/admin/errors"); await ap.waitForLoadState("networkidle");
check("الانتقال لصفحة في مجموعة مطوية يفتحها", (await grp("المتابعة والتقارير").getAttribute("aria-expanded")) === "true");
await aa.screenshot({ path: `${OUT}/n-03-admin.png` });

await b.close();
console.log(`\nفشل: ${fails}`);
process.exit(fails ? 1 : 0);
