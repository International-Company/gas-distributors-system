// اختبار متصفح حقيقي لحقل التاريخ العربي الموحّد — للتطوير فقط؛ ينشئ بيانات تجريبية.
// الاستخدام:
//   E2E_ADMIN_USER=superadmin E2E_ADMIN_PASSWORD=... CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   node tests/e2e/date-input-browser.mjs http://localhost:3000 ./test-results/date-input
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/date-input";
const { E2E_ADMIN_USER: ADMIN_USER, E2E_ADMIN_PASSWORD: ADMIN_PW, CHROME_PATH } = process.env;
if (!ADMIN_USER || !ADMIN_PW || !CHROME_PATH) {
  console.error("E2E_ADMIN_USER و E2E_ADMIN_PASSWORD و CHROME_PATH مطلوبة");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ✓" : "  ✗", name, ok ? "" : extra); if (!ok) fails++; };
const strip = (s) => s.replace(/[\u2066-\u2069]/g, "");
const pad = (n) => String(n).padStart(2, "0");

// اليوم بتوقيت غزة
const g = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Gaza", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const today = { y: +g.year, m: +g.month, d: +g.day };
const ymd = (x) => `${x.y}-${pad(x.m)}-${pad(x.d)}`;
const shift = (x, n) => { const t = new Date(Date.UTC(x.y, x.m - 1, x.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE + "/login");
await page.fill("#username", ADMIN_USER);
await page.fill("#password", ADMIN_PW);
await page.click("button[type=submit]");
await page.waitForURL("**/admin");

// ---------- سجل التدقيق: حقلا «من» و«إلى» في نموذج GET ----------
await page.goto(BASE + "/admin/audit");
const from = page.getByRole("button", { name: /^من تاريخ/ });
check("الحقل يعرض نصًا عربيًا سليمًا قبل الاختيار", (await from.textContent()).includes("اختر التاريخ"));
await from.click();
const dialog = page.getByRole("dialog", { name: "اختيار التاريخ" });
await dialog.waitFor();
const heads = await dialog.getByRole("columnheader").allTextContents();
check("الأسبوع يبدأ بالسبت", heads[0] === "سبت" && heads[6] === "جمعة", heads.join(","));
const satX = (await dialog.getByRole("columnheader").first().boundingBox()).x;
const friX = (await dialog.getByRole("columnheader").last().boundingBox()).x;
check("التقويم من اليمين لليسار (السبت يمينًا)", satX > friX);
check("الشهر الحالي محدد في القائمة", (await dialog.getByLabel("الشهر", { exact: true }).inputValue()) === String(today.m));
check("اليوم مميز (aria-current)", (await dialog.locator("[aria-current=date]").getAttribute("data-day")) === ymd(today));
await page.screenshot({ path: `${OUT}/d-01-open.png` });
await dialog.locator(`[data-day="${ymd({ ...today, d: 1 })}"]`).click();
check("اختيار يوم يغلق التقويم", (await page.getByRole("dialog").count()) === 0);
const shown = strip(await from.textContent());
check("العرض يوم/شهر/سنة بأرقام سليمة الاتجاه", shown.includes(`01/${pad(today.m)}/${today.y}`), shown);
const bdi = page.locator("button:has-text('/') bdi").first();
check("التاريخ معزول من اليسار لليمين", (await bdi.getAttribute("dir")) === "ltr");

// لوحة المفاتيح على «إلى»: فتح بالسهم السفلي، اليوم التالي بالسهم الأيسر (واجهة من اليمين)، ثم Enter.
const to = page.getByRole("button", { name: /^إلى تاريخ/ });
await to.focus();
await page.keyboard.press("ArrowDown");
await page.getByRole("dialog").waitFor();
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("Enter");
const tomorrow = shift(today, 1);
check("لوحة المفاتيح: السهم الأيسر = اليوم التالي، و Enter يختار", strip(await to.textContent()).includes(`${pad(tomorrow.d)}/${pad(tomorrow.m)}/${tomorrow.y}`), strip(await to.textContent()));
await to.focus();
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Escape");
check("Escape يغلق التقويم", (await page.getByRole("dialog").count()) === 0);

await page.getByRole("button", { name: "تطبيق" }).click();
await page.waitForURL(/from=/);
const url = new URL(page.url());
check("النموذج يرسل القيمة بصيغة YYYY-MM-DD", url.searchParams.get("from") === ymd({ ...today, d: 1 }) && url.searchParams.get("to") === ymd(tomorrow), page.url());
check("القيمة تبقى معروضة بعد التطبيق", strip(await page.getByRole("button", { name: /^من تاريخ/ }).textContent()).includes(`01/${pad(today.m)}/${today.y}`));
await page.getByRole("button", { name: "مسح التاريخ" }).first().click();
check("زر المسح يفرغ الحقل", (await page.getByRole("button", { name: /^من تاريخ/ }).textContent()).includes("اختر التاريخ"));

// التنقل بين الأشهر
await page.getByRole("button", { name: /^من تاريخ/ }).click();
await page.getByRole("button", { name: "الشهر التالي" }).click();
const nm = today.m === 12 ? 1 : today.m + 1;
check("زر الشهر التالي", (await page.getByLabel("الشهر", { exact: true }).inputValue()) === String(nm));
await page.getByLabel("السنة", { exact: true }).selectOption(String(today.y + 1));
check("قائمة السنة", (await page.getByLabel("السنة", { exact: true }).inputValue()) === String(today.y + 1));
await page.mouse.click(5, 5);
check("النقر خارج التقويم يغلقه", (await page.getByRole("dialog").count()) === 0);

// ---------- حد أدنى: انتهاء حساب موزّع لا يكون في الماضي ----------
await page.goto(BASE + "/admin/distributors/new");
await page.locator("#f-exp").click();
const yest = shift(today, -1);
const dlg = page.getByRole("dialog");
if ((await dlg.locator(`[data-day="${ymd(yest)}"]`).count()) === 0) await dlg.getByRole("button", { name: "الشهر السابق" }).click();
check("الأيام الماضية معطلة (الحد الأدنى)", await dlg.locator(`[data-day="${ymd(yest)}"]`).isDisabled());
check("اليوم مسموح", !(await page.getByRole("dialog").locator(`[data-day="${ymd(today)}"]`).isDisabled()));
await page.keyboard.press("Escape");

// ---------- التاريخ والوقت: مصروف لموزّع ----------
const jar = new Map();
const call = async (method, path, body) => {
  const headers = { Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}), ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) };
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
  return { status: r.status, json: await r.json().catch(() => null) };
};
await call("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
const tag = Math.random().toString(36).slice(2, 6);
const username = `e2edate_${tag}`;
await call("POST", "/api/v1/admin/distributors", { name: `موزع التاريخ ${tag}`, username, password: "Start-1234", phone: "0599000777", region: "غزة" });

const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const dp = await dctx.newPage();
dp.on("pageerror", (e) => errors.push(String(e)));
await dp.goto(BASE + "/login");
await dp.fill("#username", username);
await dp.fill("#password", "Start-1234");
await dp.click("button[type=submit]");
await dp.waitForURL("**/change-password");
await dp.fill("#cp-current", "Start-1234");
await dp.fill("#cp-new", "Mine-5678");
await dp.fill("#cp-confirm", "Mine-5678");
await dp.click("button[type=submit]");
await dp.waitForURL("**/d");
await dp.goto(BASE + "/d/finance?tab=expenses");
await dp.fill("#ex-amount", "12");
await dp.fill("#ex-desc", "مصروف اختبار التاريخ");
await dp.locator("#ex-at").click();
const td = dp.getByRole("dialog", { name: "اختيار التاريخ والوقت" });
await td.waitFor();
const tb = await td.boundingBox();
check("على الكمبيوتر: اللوحة داخل الشاشة حتى لحقل عند حافتها", tb.x >= 0 && tb.x + tb.width <= 1280, JSON.stringify(tb));
check("لا تمرير أفقي عند فتح اللوحة", (await dp.evaluate(() => document.documentElement.scrollWidth)) <= 1280);
const day = shift(today, -2);
if ((await td.locator(`[data-day="${ymd(day)}"]`).count()) === 0) await td.getByRole("button", { name: "الشهر السابق" }).click();
await td.locator(`[data-day="${ymd(day)}"]`).click();
check("مع الوقت: اختيار اليوم لا يغلق اللوحة", (await dp.getByRole("dialog").count()) === 1);
await td.getByLabel("الساعة", { exact: true }).selectOption("3");
await td.getByLabel("الدقيقة", { exact: true }).selectOption("30");
await td.getByRole("button", { name: "م", exact: true }).click();
await dp.screenshot({ path: `${OUT}/d-02-time.png` });
await td.getByRole("button", { name: "تم" }).click();
const at = strip(await dp.locator("#ex-at").textContent());
check("العرض بنظام 12 ساعة: 03:30 م", at.includes(`${pad(day.d)}/${pad(day.m)}/${day.y}`) && at.includes("03:30 م"), at);
await dp.getByRole("button", { name: "تسجيل", exact: true }).click();
await dp.getByText("مصروف اختبار التاريخ").first().waitFor();
const list = strip(await dp.textContent("body"));
check("المصروف محفوظ بالوقت الصحيح (15:30)", list.includes(`${pad(day.d)}/${pad(day.m)}/${day.y} 15:30`));

// ---------- الهاتف والوضع الداكن ----------
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", storageState: await dctx.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/d/finance?tab=expenses");
await mp.locator("#ex-at").scrollIntoViewIfNeeded();
await mp.locator("#ex-at").tap();
const sheet = mp.getByRole("dialog");
await sheet.waitFor();
const box = await sheet.boundingBox();
check("على الهاتف: لوحة سفلية داخل الشاشة", box.x >= 0 && box.x + box.width <= 390 + 1 && box.y + box.height <= 844 + 1, JSON.stringify(box));
check("لا تمرير أفقي", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);
await mp.screenshot({ path: `${OUT}/d-03-mobile-dark.png` });

console.log("أخطاء المتصفح:", errors);
await browser.close();
console.log(`\nفشل: ${fails}`);
process.exit(fails ? 1 : 0);
