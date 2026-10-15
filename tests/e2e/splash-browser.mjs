// اختبار متصفح لشاشة البداية عند فتح التطبيق المثبّت — لا يحتاج حسابًا.
// «?splash=1» يحاكي فتح التطبيق المثبّت (وضع standalone) في متصفح الاختبار.
// الاستخدام: CHROME_PATH=... node tests/e2e/splash-browser.mjs http://localhost:3000 ./test-results/splash
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/splash";
const { CHROME_PATH } = process.env;
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ✓" : "  ✗", name, ok ? "" : extra); if (!ok) fails++; };

const browser = await chromium.launch({ executablePath: CHROME_PATH });
for (const [label, opts] of [["mobile", { viewport: { width: 390, height: 844 }, isMobile: true }], ["dark", { viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark" }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + "/login?splash=1", { waitUntil: "commit" });
  await page.waitForSelector("#app-splash:not([hidden])", { timeout: 5000 }).catch(() => {});
  const shown = await page.locator("#app-splash").isVisible();
  check(`[${label}] شاشة البداية تظهر عند فتح التطبيق المثبّت`, shown);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/splash-${label}.png` });
  const text = await page.locator("#app-splash").textContent();
  check(`[${label}] تعرض اسم النظام`, (text ?? "").includes("نظام إدارة موزّعي الغاز"));
  await page.waitForSelector("#app-splash[hidden]", { state: "attached", timeout: 6000 }).catch(() => {});
  check(`[${label}] تختفي بعد جاهزية الصفحة`, await page.locator("#app-splash").isHidden());
  await page.screenshot({ path: `${OUT}/after-${label}.png` });

  await page.goto(BASE + "/login?splash=1");
  await page.waitForTimeout(300);
  check(`[${label}] لا تتكرر في الجلسة نفسها`, await page.locator("#app-splash").isHidden());
  check(`[${label}] لا أخطاء في الصفحة (ولا عدم تطابق في التحميل)`, errors.length === 0, errors.join(" | ").slice(0, 300));
  await ctx.close();
}

const plain = await browser.newPage();
await plain.goto(BASE + "/login");
await plain.waitForTimeout(300);
check("في المتصفح العادي لا تظهر", await plain.locator("#app-splash").isHidden());
const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
check("بيان التطبيق بخلفية الهوية الزرقاء", manifest.background_color === "#1e5aa8" && manifest.theme_color === "#1e5aa8");
await browser.close();
console.log(`\nفشل: ${fails}`);
process.exit(fails ? 1 : 0);
