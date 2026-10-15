// اختبار متصفح حقيقي لتدفق المرحلة 4 (المالية) — للتطوير فقط؛ ينشئ بيانات تجريبية.
// الاستخدام:
//   E2E_ADMIN_USER=superadmin E2E_ADMIN_PASSWORD=... CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   node tests/e2e/phase4-browser.mjs http://localhost:3000 ./test-results/phase4
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/phase4";
const { E2E_ADMIN_USER: ADMIN_USER, E2E_ADMIN_PASSWORD: ADMIN_PW, CHROME_PATH } = process.env;
if (!ADMIN_USER || !ADMIN_PW || !CHROME_PATH) {
  console.error("E2E_ADMIN_USER و E2E_ADMIN_PASSWORD و CHROME_PATH مطلوبة");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ✓" : "  ✗", name, ok ? "" : extra); if (!ok) fails++; };
const strip = (s) => s.replace(/[\u2066-\u2069]/g, "");

function luhnId(base8) {
  for (let d = 0; d <= 9; d++) {
    const id = base8 + d; let s = 0;
    for (let i = 0; i < 9; i++) { let x = Number(id[i]) * (i % 2 ? 2 : 1); if (x > 9) x -= 9; s += x; }
    if (s % 10 === 0) return id;
  }
}
const rnd = () => String(10000000 + Math.floor(Math.random() * 89999999));
const tag = Math.random().toString(36).slice(2, 6);
const person = { id: luhnId(rnd()), name: "سامي عبد الله", number: 701 };

const jar = new Map();
const call = async (method, path, body) => {
  const headers = { Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}), ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) };
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
  return { status: r.status, json: await r.json().catch(() => null) };
};
await call("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
const username = `e2e4_${tag}`;
const created = await call("POST", "/api/v1/admin/distributors", { name: `موزع المالية ${tag}`, username, password: "Start-1234", phone: "0599000333", region: "رفح" });
check("إنشاء موزّع", created.status === 200);

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("كشف");
ws.addRow(["رقم المواطن", "الاسم", "رقم الهوية", "عدد الجرار"]);
ws.addRow([person.number, person.name, person.id, 2]);
const xlsx = `${OUT}/statement.xlsx`;
writeFileSync(xlsx, Buffer.from(await wb.xlsx.writeBuffer()));

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const body = async () => strip(await page.textContent("body"));

await page.goto(BASE + "/login");
await page.fill("#username", username);
await page.fill("#password", "Start-1234");
await page.click("button[type=submit]");
await page.waitForURL("**/change-password");
await page.fill("#cp-current", "Start-1234");
await page.fill("#cp-new", "Mine-5678");
await page.fill("#cp-confirm", "Mine-5678");
await page.click("button[type=submit]");
await page.waitForURL(/\/d(\/sheet)?$/);
await page.goto(BASE + "/d/cycles");
await page.fill("#c-price", "20");
await page.click("text=بدء الدورة");
await page.waitForURL(/\/d\/cycles\/[0-9a-f-]+$/);
await page.goto(BASE + "/d/statements");
await page.setInputFiles("#u-file", xlsx);
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
await page.getByRole("button", { name: /اعتمد الكشف/ }).click();
await page.waitForURL(/\/d\/sheet/, { timeout: 30000 });

// الشباك: دفعة جزئية ثم سداد كامل
const counter = async () => {
  await page.goto(BASE + "/d/counter");
  await page.fill("input[aria-label='رقم الهوية']", person.id);
  await page.getByRole("button", { name: "بحث" }).click();
  await page.waitForSelector("text=رقم المواطن");
};
await counter();
check("الشباك يعرض المتبقي 40.00", (await body()).includes("المتبقي: 40.00"));
await page.getByRole("button", { name: "تحصيل" }).click();
await page.getByRole("button", { name: "دفعة جزئية" }).click();
await page.fill("#pay-amount", "50");
await page.getByRole("button", { name: "تسجيل التحصيل" }).click();
await page.waitForSelector("text=يتجاوز المتبقي");
check("رفض دفعة أكبر من المتبقي", true);
await page.fill("#pay-amount", "15");
await page.getByRole("button", { name: "تسجيل التحصيل" }).click();
await page.waitForSelector("text=/سُجل تحصيل/");
check("دفعة جزئية 15 والمتبقي 25", (await body()).includes("المتبقي: 25.00"));
await page.getByRole("button", { name: "تحصيل" }).click();
await page.getByRole("button", { name: "تسجيل التحصيل" }).click();
await page.waitForSelector("text=/سُجل تحصيل/");
const after = await body();
check("سداد كامل المتبقي يصفّره ويخفي زر التحصيل", after.includes("المتبقي: 0.00") && !(await page.getByRole("button", { name: "تحصيل" }).isVisible()));
await page.screenshot({ path: `${OUT}/p4-01-counter-paid.png`, fullPage: true });

// محطة بسعر شراء، شحنة، دفعة للمحطة
await page.goto(BASE + "/d/stations");
await page.fill("#st-name", `محطة ${tag}`);
await page.fill("#st-price", "15");
await page.getByRole("button", { name: "إضافة" }).click();
await page.waitForSelector(`text=محطة ${tag}`);
await page.goto(BASE + "/d/shipments");
await page.getByRole("button", { name: /تسجيل نقلة مستلمة/ }).click();
check("سعر الشراء مقترح من المحطة", (await page.inputValue("#sh-price")) === "15");
await page.fill("#sh-q", "3");
check("قيمة الشحنة تظهر قبل الحفظ", (await body()).includes("قيمة النقلة على حساب المحطة: 45.00"));
await page.getByRole("button", { name: "تسجيل النقلة" }).click();
await page.waitForURL(/\/d\/shipments\/[0-9a-f-]+$/);
check("قيمة الشحنة 45.00", (await body()).includes("45.00"));
await page.goto(BASE + "/d/stations");
await page.getByRole("link", { name: `محطة ${tag}` }).click();
await page.waitForURL(/\/d\/stations\/[0-9a-f-]+$/);
check("المتبقي للمحطة 45.00 قبل الدفع", (await body()).includes("45.00"));
await page.fill("#sp-amount", "30");
await page.fill("#sp-ref", "إيصال 9");
await page.getByRole("button", { name: "تسجيل الدفعة" }).click();
await page.waitForSelector("text=سُجلت الدفعة");
await page.waitForTimeout(800);
const acc = await body();
check("المتبقي للمحطة 15.00 بعد الدفعة وكشف الحساب برصيد جارٍ", acc.includes("المتبقي للمحطة") && acc.includes("15.00") && acc.includes("إيصال 9"));
await page.screenshot({ path: `${OUT}/p4-02-station-account.png`, fullPage: true });

// مصروف ثم الصندوق
await page.goto(BASE + "/d/finance?tab=expenses");
await page.fill("#ex-amount", "5");
await page.fill("#ex-desc", "نقل الجرار");
await page.getByRole("button", { name: "تسجيل", exact: true }).click();
await page.waitForSelector("text=نقل الجرار");
await page.goto(BASE + "/d/finance");
const box = await body();
check("الصندوق: 40 مقبوضات، 5 مصروفات، 30 محطات، رصيد 5", box.includes("40.00") && box.includes("5.00") && box.includes("30.00") && box.includes("لا يثبت كم في الغلّة"));
await page.screenshot({ path: `${OUT}/p4-03-cashbox.png`, fullPage: true });

// إلغاء المصروف
await page.goto(BASE + "/d/finance?tab=expenses");
await page.getByRole("button", { name: "إلغاء" }).first().click();
await page.fill("#cr-reason", "سُجل بالخطأ");
await page.getByRole("button", { name: "تأكيد الإلغاء" }).click();
await page.waitForSelector("text=أُلغي: سُجل بالخطأ");
await page.goto(BASE + "/d/finance");
check("بعد إلغاء المصروف: الرصيد 10.00", (await body()).includes("10.00"));

// ملف المواطن
await page.goto(BASE + "/d/finance?tab=collections");
await page.getByRole("link", { name: person.name }).first().click();
await page.waitForURL(/\/d\/citizens\/[0-9a-f-]+$/);
const prof = await body();
check("ملف المواطن: مدفوع 40 ومتبقٍ 0 والمقبوض في السجل", prof.includes("إجمالي المدفوع") && prof.includes("40.00") && prof.includes("المقبوض"));
await page.screenshot({ path: `${OUT}/p4-04-profile.png`, fullPage: true });

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark", storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/d/finance");
await mp.screenshot({ path: `${OUT}/p4-05-mobile-cashbox.png`, fullPage: true });
check("لا تمرير أفقي على الهاتف", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

console.log("أخطاء المتصفح:", errors);
console.log(`\nفشل: ${fails}`);
await browser.close();
process.exit(fails ? 1 : 0);
