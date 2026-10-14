// اختبار متصفح حقيقي لتدفق المرحلة 3 (للتطوير فقط؛ ينشئ بيانات تجريبية).
// الاستخدام:
//   E2E_ADMIN_USER=superadmin E2E_ADMIN_PASSWORD=... CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   node tests/e2e/phase3-browser.mjs http://localhost:3000 ./test-results/phase3
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/phase3";
const { E2E_ADMIN_USER: ADMIN_USER, E2E_ADMIN_PASSWORD: ADMIN_PW, CHROME_PATH } = process.env;
if (!ADMIN_USER || !ADMIN_PW || !CHROME_PATH) {
  console.error("E2E_ADMIN_USER و E2E_ADMIN_PASSWORD و CHROME_PATH مطلوبة");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ✓" : "  ✗", name, ok ? "" : extra); if (!ok) fails++; };

function luhnId(base8) {
  for (let d = 0; d <= 9; d++) {
    const id = base8 + d; let s = 0;
    for (let i = 0; i < 9; i++) { let x = Number(id[i]) * (i % 2 ? 2 : 1); if (x > 9) x -= 9; s += x; }
    if (s % 10 === 0) return id;
  }
}
const rnd = () => String(10000000 + Math.floor(Math.random() * 89999999));
const tag = Math.random().toString(36).slice(2, 6);
const people = [
  { id: luhnId(rnd()), name: "أحمد سالم", number: 501, qty: 2 },
  { id: luhnId(rnd()), name: "مريم خليل", number: 502, qty: 1 },
  { id: luhnId(rnd()), name: "يوسف ناصر", number: 503, qty: 1 },
];

// حساب موزّع عبر API المدير
const jar = new Map();
const call = async (method, path, body) => {
  const headers = { Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}), ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) };
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
  return { status: r.status, json: await r.json().catch(() => null) };
};
await call("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
const username = `e2e3_${tag}`;
const created = await call("POST", "/api/v1/admin/distributors", { name: `موزع المرحلة 3 ${tag}`, username, password: "Start-1234", phone: "0599000222", region: "غزة" });
check("إنشاء موزّع", created.status === 200, JSON.stringify(created.json));

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("كشف");
ws.addRow(["رقم المواطن", "الاسم", "رقم الهوية", "عدد الجرار"]);
for (const p of people) ws.addRow([p.number, p.name, p.id, p.qty]);
const xlsx = `${OUT}/statement.xlsx`;
writeFileSync(xlsx, Buffer.from(await wb.xlsx.writeBuffer()));

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/favicon|409|400/.test(m.text()) && errors.push(m.text()));

// دخول، دورة، كشف معتمد
await page.goto(BASE + "/login");
await page.fill("#username", username);
await page.fill("#password", "Start-1234");
await page.click("button[type=submit]");
await page.waitForURL("**/change-password");
await page.fill("#cp-current", "Start-1234");
await page.fill("#cp-new", "Mine-5678");
await page.fill("#cp-confirm", "Mine-5678");
await page.click("button[type=submit]");
await page.waitForURL("**/d");
await page.goto(BASE + "/d/cycles");
await page.fill("#c-price", "20");
await page.click("text=بدء الدورة");
await page.waitForURL(/\/d\/cycles\/[0-9a-f-]+$/);
await page.goto(BASE + "/d/statements");
await page.setInputFiles("#u-file", xlsx);
await page.click("text=رفع واستخراج البيانات");
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
await page.getByText("راجعت بيانات الكشف").click();
await page.getByRole("button", { name: "اعتماد الكشف" }).click();
await page.getByText("معتمد", { exact: true }).first().waitFor({ timeout: 30000 });
check("اعتماد الكشف", true);

// الشباك: هوية خاطئة لا يجدها، ثم استلام الفارغات
const counter = async (nid) => {
  await page.goto(BASE + "/d/counter");
  await page.fill("input[aria-label='رقم الهوية']", nid);
  await page.getByRole("button", { name: "بحث" }).click();
  await page.waitForLoadState("networkidle");
};
await counter(luhnId(rnd()));
check("رقم غير موجود في الكشوف: يعرض تسجيل حالة", await page.getByText("لا يوجد مواطن بهذا الرقم").isVisible());

await counter(people[0].id);
await page.getByRole("button", { name: /استلام جرة فارغة/ }).click();
await page.waitForSelector("text=سُجل استلام الجرة الفارغة");
await page.getByRole("button", { name: /استلام جرة فارغة/ }).click();
await page.waitForSelector("text=501-2");
check("استلام جرتين لمستحق جرتين برقمين 501-1 و 501-2", (await page.textContent("body")).includes("501-1"));
check("لا زر استلام بعد اكتمال المستحق", !(await page.getByRole("button", { name: /استلام جرة فارغة/ }).isVisible()));
await page.screenshot({ path: `${OUT}/p3-01-counter.png`, fullPage: true });
for (const p of people.slice(1)) {
  await counter(p.id);
  await page.getByRole("button", { name: /استلام جرة فارغة/ }).click();
  await page.waitForSelector("text=سُجل استلام الجرة الفارغة");
}

// تعبئة جماعية لجرتين
await page.goto(BASE + "/d/cylinders?status=EMPTY");
await page.getByLabel("تحديد 501-1").check();
await page.getByLabel("تحديد 501-2").check();
await page.getByRole("button", { name: /تعبئة المحدد/ }).click();
await page.waitForSelector("text=عُبئت 2 جرة");
check("تعبئة جماعية لجرتين", true);
await page.screenshot({ path: `${OUT}/p3-02-cylinders.png`, fullPage: true });

// محطة وشحنة: جرة 502 من الشحنة + 2 إضافية
await page.goto(BASE + "/d/stations");
await page.fill("#st-name", `محطة ${tag}`);
await page.fill("#st-price", "15");
await page.getByRole("button", { name: "إضافة" }).click();
await page.waitForSelector(`text=محطة ${tag}`);
await page.goto(BASE + "/d/shipments");
await page.getByRole("button", { name: /تسجيل نقلة مستلمة/ }).click();
await page.fill("#sh-q", "3");
await page.fill("#sh-ref", "SH-1");
await page.locator("label", { hasText: "مريم خليل" }).locator("input").check();
check("حساب الكمية الإضافية في النموذج", (await page.textContent("body")).includes("جرار مواطنين 1 + كمية إضافية غير مرتبطة 2"));
await page.getByRole("button", { name: "تسجيل النقلة" }).click();
await page.waitForURL(/\/d\/shipments\/[0-9a-f-]+$/);
check("الشحنة سُجلت وعبأت جرة المواطن", (await page.textContent("body")).includes("مريم خليل"));
await page.screenshot({ path: `${OUT}/p3-03-shipment.png`, fullPage: true });

// التسليم: رقم جرة خاطئ ثم صحيح
await counter(people[0].id);
await page.getByRole("button", { name: "تسليم" }).first().click();
await page.fill("#dl-label", "999");
await page.getByRole("button", { name: "تأكيد التسليم" }).click();
await page.waitForSelector("text=لا يطابق رقمها");
check("رفض التسليم برقم جرة لا يطابق", true);
await page.getByRole("button", { name: "تسليم" }).first().click();
await page.fill("#dl-label", "501-1");
await page.getByRole("button", { name: "تأكيد التسليم" }).click();
await page.waitForSelector("text=/سُلّمت الجرة/");
check("تسليم الجرة بعد مطابقة الرقم", true);
await page.screenshot({ path: `${OUT}/p3-04-delivered.png`, fullPage: true });

// المخزون ومطابقته: فارغ 1 (503)، معبأ 2 (501-2، 502)، إضافي 2
await page.goto(BASE + "/d/inventory");
const inv = await page.textContent("body");
check("الرصيد مطابق لحالات الجرار", inv.includes("الرصيد مطابق لحالات الجرار"));
await page.screenshot({ path: `${OUT}/p3-05-inventory.png`, fullPage: true });

// إلغاء التسليم من صفحة الجرة
await page.goto(BASE + "/d/cylinders?status=DELIVERED");
await page.getByRole("link", { name: "501-1" }).click();
await page.getByRole("button", { name: /إلغاء آخر عملية/ }).click();
await page.fill("#op-reason", "تسليم سُجل بالخطأ");
await page.getByRole("button", { name: "تأكيد الإلغاء" }).click();
await page.waitForSelector("text=ملغاة");
check("إلغاء التسليم وظهوره في السجل", (await page.textContent("body")).includes("تسليم سُجل بالخطأ"));
await page.goto(BASE + "/d/inventory");
check("المخزون مطابق بعد الإلغاء", (await page.textContent("body")).includes("الرصيد مطابق لحالات الجرار"));

// لوحة الموزّع
await page.goto(BASE + "/d");
await page.screenshot({ path: `${OUT}/p3-06-dashboard.png`, fullPage: true });

// الهاتف: الشباك
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark", storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/d/counter");
await mp.fill("input[aria-label='رقم الهوية']", people[0].id);
await mp.getByRole("button", { name: "بحث" }).click();
await mp.waitForSelector("text=501-2");
await mp.screenshot({ path: `${OUT}/p3-07-mobile-counter.png`, fullPage: true });
check("لا تمرير أفقي على الهاتف", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

console.log("أخطاء المتصفح:", errors);
console.log(`\nفشل: ${fails}`);
await browser.close();
process.exit(fails ? 1 : 0);
