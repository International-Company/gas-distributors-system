// اختبار متصفح حقيقي لتدفق المرحلة 2 (للتطوير فقط؛ ينشئ بيانات تجريبية).
// الاستخدام:
//   E2E_ADMIN_USER=superadmin E2E_ADMIN_PASSWORD=... CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" //   node tests/e2e/phase2-browser.mjs http://localhost:3000 ./test-results/phase2
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/phase2";
const ADMIN_USER = process.env.E2E_ADMIN_USER;
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD;
if (!ADMIN_USER || !ADMIN_PW || !process.env.CHROME_PATH) {
  console.error("E2E_ADMIN_USER و E2E_ADMIN_PASSWORD و CHROME_PATH مطلوبة");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);
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
const ids = Array.from({ length: 5 }, () => luhnId(rnd()));
const tag = Math.random().toString(36).slice(2, 6);

// ---- إعداد: حساب موزّع عبر API المدير ----
async function apiClient() {
  const jar = new Map();
  return async (method, path, body) => {
    const headers = { Origin: BASE };
    if (body) headers["Content-Type"] = "application/json";
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}
const admin = await apiClient();
let r = await admin("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
if (r.status !== 200) throw new Error("admin login failed " + JSON.stringify(r.json));
const username = `e2e_${tag}`;
r = await admin("POST", "/api/v1/admin/distributors", { name: `موزع تجربة ${tag}`, username, password: "Start-1234", phone: "0599000111", region: "غزة" });
check("إنشاء موزّع", r.status === 200, JSON.stringify(r.json));

// ---- ملف Excel ----
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("كشف");
ws.addRow(["كشف توزيع الغاز - الدورة رقم 3"]);
ws.addRow(["م", "رقم المواطن", "الاسم رباعي", "رقم الهوية", "رقم الجوال", "عدد الجرار"]);
const names = ["محمد أحمد سالم العلي", "فاطمة يوسف حسن النجار", "خالد محمود عبد الله", "سعاد إبراهيم موسى", "عمر سعيد خليل"];
names.forEach((n, i) => ws.addRow([i + 1, 100 + i, n, i === 3 ? "123456789" : ids[i], "059912345" + i, i === 1 ? 2 : 1]));
const xlsxPath = `${OUT}/statement.xlsx`;
writeFileSync(xlsxPath, Buffer.from(await wb.xlsx.writeBuffer()));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

// دخول الموزّع وتغيير كلمة المرور
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
await page.getByText("ما في كشف معتمد بعد").waitFor();
check("دخول الموزّع إلى «الكشف» الفارغ مع إرشاد", await page.getByText("ما في كشف معتمد بعد").isVisible());

// دورة جديدة
await page.goto(BASE + "/d/cycles");
await page.fill("#c-price", "25");
await page.click("text=بدء الدورة");
await page.waitForURL(/\/d\/cycles\/[0-9a-f-]+$/);
check("بدء دورة", await page.getByText("نشطة").first().isVisible());

// رفع الكشف
await page.goto(BASE + "/d/statements");
await page.setInputFiles("#u-file", xlsxPath);
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
const stmtUrl = page.url();
await page.waitForSelector("text=الناس في الكشف");
check("الكشف بانتظار الاعتماد", await page.getByText("بانتظار الاعتماد").first().isVisible());
check("صف الهوية الخاطئة معلّم", await page.getByText("رقم الهوية غير صالح").first().isVisible());
await page.screenshot({ path: `${OUT}/p2-01-review.png`, fullPage: true });
check("مع وجود أخطاء: تظهر الصفوف الخاطئة للتصحيح ولا زر اعتماد", (await page.getByRole("button", { name: /اعتمد الكشف/ }).count()) === 0 && (await page.getByText(/صحّح 1 صف/).count()) === 1);

// استبعاد الصف الخاطئ ثم الاعتماد
await page.getByRole("button", { name: "استبعاد" }).first().click();
await page.waitForTimeout(1500);
await page.goto(stmtUrl);
await page.getByRole("button", { name: /اعتمد الكشف/ }).click();
await page.waitForURL(/\/d\/sheet/, { timeout: 30000 });
await page.goto(stmtUrl);
check("الكشف معتمد", await page.getByText("معتمد", { exact: true }).first().isVisible());
await page.screenshot({ path: `${OUT}/p2-02-approved.png`, fullPage: true });

// البحث بالاسم بدون همزات
await page.goto(BASE + "/d/citizens");
await page.fill("input[aria-label='كلمة البحث']", "فاطمه يوسف");
await page.getByRole("button", { name: "بحث" }).click();
await page.waitForSelector("text=فاطمة يوسف حسن النجار");
check("البحث بالاسم يجد المواطن مع رقمه", await page.getByText("رقم المواطن: 101").isVisible());
await page.screenshot({ path: `${OUT}/p2-03-search.png` });
await page.getByText("فاطمة يوسف حسن النجار").click();
await page.waitForURL(/\/d\/citizens\/[0-9a-f-]+$/);
check("ملف المواطن: جرتان و50", (await page.textContent("body")).includes("50.00"));
await page.screenshot({ path: `${OUT}/p2-04-profile.png`, fullPage: true });

// قراءة رقم الهوية من صورة (على الجهاز)
const idImg = await browser.newPage({ viewport: { width: 700, height: 260 } });
await idImg.setContent(`<body style="margin:0;background:#f3efe4;font-family:Arial"><div style="padding:40px"><div style="font-size:22px">STATE OF PALESTINE</div><div style="font-size:52px;letter-spacing:6px;margin-top:30px">${ids[0]}</div></div></body>`);
const idPng = `${OUT}/id.png`;
await idImg.screenshot({ path: idPng });
await idImg.close();
await page.goto(BASE + "/d/citizens");
await page.setInputFiles("input[type=file][accept='image/*']", idPng);
await page.waitForSelector(`text=${ids[0]}`, { timeout: 120000 }).catch(() => {});
const sawId = await page.getByRole("button", { name: new RegExp(ids[0]) }).isVisible().catch(() => false);
check("قراءة رقم الهوية من الصورة وعرضه للتأكيد", sawId);
await page.screenshot({ path: `${OUT}/p2-05-id-ocr.png` });
if (sawId) {
  await page.getByRole("button", { name: new RegExp(ids[0]) }).click();
  await page.getByRole("button", { name: "بحث" }).click();
  await page.waitForSelector("text=محمد أحمد سالم العلي", { timeout: 15000 }).catch(() => {});
  check("البحث بالرقم المؤكد", await page.getByText("محمد أحمد سالم العلي").isVisible());
}

// PDF ممسوح ضوئيًا: صورة جدول داخل PDF
const sid = [luhnId(rnd()), luhnId(rnd())];
const tbl = await browser.newPage({ viewport: { width: 1000, height: 400 } });
await tbl.setContent(`<html dir="rtl"><body style="margin:30px;font-family:Arial;font-size:26px;background:#fff">
<table style="border-collapse:collapse" cellpadding="14">
<tr><td>رقم المواطن</td><td>الاسم</td><td>رقم الهوية</td></tr>
<tr><td>201</td><td>حسن علي</td><td>${sid[0]}</td></tr>
<tr><td>202</td><td>منى سمير</td><td>${sid[1]}</td></tr></table></body></html>`);
const tablePng = await tbl.screenshot();
await tbl.close();
const pdf = await PDFDocument.create();
const img = await pdf.embedPng(tablePng);
const pg = pdf.addPage([img.width, img.height]);
pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
const pdfPath = `${OUT}/scanned.pdf`;
writeFileSync(pdfPath, await pdf.save());
await page.goto(BASE + "/d/statements");
await page.setInputFiles("#u-file", pdfPath);
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
check("اكتشاف الملف الممسوح ضوئيًا", await page.getByText("قراءة ضوئية مطلوبة").isVisible());
// القراءة الضوئية تبدأ تلقائيًا
await page.waitForFunction(() => (document.body.textContent ?? "").includes("مقروء ضوئيًا: تحقق من القيم"), null, { timeout: 240000 }).catch(() => {});
const body = await page.textContent("body");
check("القراءة الضوئية أنتجت صفوفًا", body.includes("مقروء ضوئيًا: تحقق من القيم"));
check("الهوية الأولى مقروءة", body.includes(sid[0]), "");
check("الهوية الثانية مقروءة", body.includes(sid[1]), "");
await page.screenshot({ path: `${OUT}/p2-06-ocr-statement.png`, fullPage: true });

// الهاتف: صفحة المراجعة
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark", storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(stmtUrl);
await mp.screenshot({ path: `${OUT}/p2-07-mobile-review.png` });
const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
check("لا تمرير أفقي للصفحة على الهاتف", sw <= 390, String(sw));

console.log("أخطاء المتصفح:", consoleErrors.filter((e) => !/favicon/.test(e)));
console.log(`\nفشل: ${fails}`);
await browser.close();
process.exit(fails ? 1 : 0);
