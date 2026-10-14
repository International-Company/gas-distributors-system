// اختبار متصفح حقيقي للمرحلة 5 (التقارير والتصدير والطباعة والإعدادات) — للتطوير فقط؛ ينشئ بيانات تجريبية.
// الاستخدام:
//   E2E_ADMIN_USER=superadmin E2E_ADMIN_PASSWORD=... CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   node tests/e2e/phase5-browser.mjs http://localhost:3000 ./test-results/phase5
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/phase5";
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
const people = [
  { id: luhnId(rnd()), name: "مواطن أول للتقرير", number: 11 },
  { id: luhnId(rnd()), name: "مواطن ثان للتقرير", number: 12 },
];

const jar = new Map();
const call = async (method, path, body) => {
  const headers = { Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}), ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) };
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
  return { status: r.status, json: await r.json().catch(() => null) };
};
await call("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
const username = `e2e5_${tag}`;
const created = await call("POST", "/api/v1/admin/distributors", { name: `موزع التقارير ${tag}`, username, password: "Start-1234", phone: "0599000444", region: "خانيونس" });
check("إنشاء موزّع", created.status === 200);
const distributorId = created.json?.data?.id;

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("كشف");
ws.addRow(["المتسلسل", "رقم الهوية", "الاسم", "رقم الجوال"]);
for (const p of people) ws.addRow([p.number, p.id, p.name, "0599000000"]);
const xlsx = `${OUT}/statement.xlsx`;
writeFileSync(xlsx, Buffer.from(await wb.xlsx.writeBuffer()));

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const body = async (p = page) => strip(await p.textContent("body"));

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
await page.fill("#c-price", "25");
await page.click("text=بدء الدورة");
await page.waitForURL(/\/d\/cycles\/[0-9a-f-]+$/);
await page.goto(BASE + "/d/statements");
await page.setInputFiles("#u-file", xlsx);
await page.click("text=رفع واستخراج البيانات");
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
check("عمود «المتسلسل» رُبط برقم المواطن", (await body()).includes("رقم المواطن في الكشف"));
await page.getByText("راجعت بيانات الكشف").click();
await page.getByRole("button", { name: "اعتماد الكشف" }).click();
await page.getByText("معتمد", { exact: true }).first().waitFor({ timeout: 30000 });

// تحصيل جزئي لمواطن عبر API الشباك
const dj = new Map();
const dcall = async (method, path, b) => {
  const headers = { Origin: BASE, ...(b ? { "Content-Type": "application/json" } : {}), Cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") };
  const r = await fetch(BASE + path, { method, headers, body: b ? JSON.stringify(b) : undefined });
  return r.json().catch(() => null);
};
void dj;
const look = await dcall("GET", `/api/v1/counter/lookup?nationalId=${people[0].id}`);
const ent = look?.data?.entitlements?.[0];
await dcall("POST", "/api/v1/payments", { clientOpId: crypto.randomUUID(), entitlementId: ent.id, amount: "10" });

// قائمة التقارير
await page.goto(BASE + "/d/reports");
check("قائمة التقارير", (await body()).includes("كشف المواطنين للدورة") && (await body()).includes("مقارنة الدورات"));
await page.goto(BASE + "/d/reports/unpaid");
const unpaid = await body();
check("تقرير غير المسددين: 15 + 25 = 40", unpaid.includes("15.00") && unpaid.includes("40.00"));
await page.screenshot({ path: `${OUT}/p5-01-unpaid.png`, fullPage: true });

// Excel
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Excel" }).click()]);
const file = `${OUT}/unpaid.xlsx`;
await dl.saveAs(file);
const xb = new ExcelJS.Workbook();
await xb.xlsx.load(readFileSync(file));
const xws = xb.worksheets[0];
check("ملف Excel من اليمين لليسار ويحوي الإجمالي", xws.views[0].rightToLeft === true && xws.getSheetValues().flat().includes(40));

// كشف المواطنين وطباعته
await page.goto(BASE + "/d/reports/citizens-sheet?state=NOT_RECEIVED");
check("كشف المواطنين مصفّى (لم تُستلم)", (await body()).includes("مواطن أول للتقرير") && (await body()).includes("مواطن ثان للتقرير"));
const [printPage] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("link", { name: /طباعة/ }).click()]);
await printPage.waitForLoadState("networkidle");
const pb = await body(printPage);
check("صفحة الطباعة: العنوان والجدول بالعربية", pb.includes("كشف المواطنين") && pb.includes("مواطن أول للتقرير") && pb.includes("ملاحظات / توقيع"));
await printPage.pdf?.({ path: `${OUT}/citizens-sheet.pdf`, format: "A4" }).catch(() => {});
await printPage.screenshot({ path: `${OUT}/p5-02-print.png`, fullPage: true });
await printPage.close();

// المدير: التقرير المركزي وتقرير موزّع والإعدادات
const actx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const ap = await actx.newPage();
await ap.goto(BASE + "/login");
await ap.fill("#username", ADMIN_USER);
await ap.fill("#password", ADMIN_PW);
await ap.click("button[type=submit]");
await ap.waitForURL("**/admin");
check("لوحة المدير تعرض الملخص المركزي", (await body(ap)).includes("ملخص التشغيل المركزي"));
await ap.goto(BASE + "/admin/reports");
check("التقرير المركزي يعرض الموزّع بأرقامه", (await body(ap)).includes(`موزع التقارير ${tag}`));
await ap.screenshot({ path: `${OUT}/p5-03-central.png`, fullPage: true });
await ap.goto(`${BASE}/admin/reports/unpaid?distributorId=${distributorId}`);
check("المدير يرى تقرير موزّع محدد", (await body(ap)).includes("40.00"));

await ap.goto(BASE + "/admin/settings");
await ap.fill("input[aria-label='اسم الشباك']", "نقطة التوزيع");
await ap.fill("input[aria-label='ترتيب الشباك']", "0");
await ap.getByRole("button", { name: "حفظ القائمة" }).click();
await ap.waitForSelector("text=حُفظت القائمة");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNk+M+AFzDhlx41YNQAKgMAJ9kBH1Cb3x4AAAAASUVORK5CYII=", "base64");
const logo = `${OUT}/logo.png`;
writeFileSync(logo, png);
await ap.setInputFiles("input[aria-label='ملف الشعار']", logo);
await ap.getByRole("button", { name: "رفع" }).click();
await ap.waitForSelector("img[alt='الشعار الحالي']");
check("رفع الشعار", true);

await page.goto(BASE + "/d");
const menu = await body();
check("القائمة المخصصة تظهر للموزّع وبالشعار", menu.includes("نقطة التوزيع") && (await page.locator("aside img").count()) > 0);
await page.screenshot({ path: `${OUT}/p5-04-custom-nav.png` });

// إعادة الإعدادات
await ap.goto(BASE + "/admin/settings");
await ap.fill("input[aria-label='اسم الشباك']", "");
await ap.fill("input[aria-label='ترتيب الشباك']", "");
await ap.getByRole("button", { name: "حفظ القائمة" }).click();
await ap.waitForSelector("text=حُفظت القائمة");
await ap.getByRole("button", { name: "إزالة" }).click();
await ap.waitForTimeout(800);

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark", storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/d/reports/not-delivered");
await mp.screenshot({ path: `${OUT}/p5-05-mobile-report.png`, fullPage: true });
check("لا تمرير أفقي للصفحة على الهاتف", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

console.log("أخطاء المتصفح:", errors);
console.log(`\nفشل: ${fails}`);
await browser.close();
process.exit(fails ? 1 : 0);
