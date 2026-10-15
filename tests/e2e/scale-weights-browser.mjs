// اختبار متصفح حقيقي لرقم الميزان والأوزان — للتطوير فقط؛ ينشئ بيانات تجريبية.
// الاستخدام:
//   E2E_ADMIN_USER=superadmin E2E_ADMIN_PASSWORD=... CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   node tests/e2e/scale-weights-browser.mjs http://localhost:3000 ./test-results/scale-weights
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/scale-weights";
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
const person = { id: luhnId(rnd()), name: "مواطن الوزن الأول", number: 11 };

const jar = new Map();
const call = async (method, path, body) => {
  const headers = { Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}), ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) };
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
  return { status: r.status, json: await r.json().catch(() => null) };
};
await call("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
const username = `e2esw_${tag}`;
const created = await call("POST", "/api/v1/admin/distributors", { name: `موزع الميزان ${tag}`, username, password: "Start-1234", phone: "0599000555", region: "رفح" });
check("إنشاء موزّع", created.status === 200);

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("كشف");
ws.addRow(["تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : 295"]);
ws.addRow(["المتسلسل", "رقم الهوية", "الاسم", "رقم الجوال"]);
ws.addRow([person.number, person.id, person.name, "0599000000"]);
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
await page.fill("#c-price", "25");
await page.click("text=بدء الدورة");
await page.waitForURL(/\/d\/cycles\/[0-9a-f-]+$/);

await page.goto(BASE + "/d/statements");
await page.setInputFiles("#u-file", xlsx);
await page.click("text=رفع واستخراج البيانات");
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
check("رقم الميزان قُرئ من رأس الكشف", (await page.inputValue("#m-scale")) === "295");
check("رقم المواطن «الميزان-المتسلسل» في الصفوف", (await body()).includes("295-11"));
await page.screenshot({ path: `${OUT}/sw-01-review.png`, fullPage: true });
await page.getByText("راجعت بيانات الكشف").click();
await page.getByRole("button", { name: "اعتماد الكشف" }).click();
await page.getByText("معتمد", { exact: true }).first().waitFor({ timeout: 30000 });

// الشباك: استلام بوزن الفارغة
await page.goto(BASE + "/d/counter");
await page.fill("input[aria-label='رقم الهوية']", person.id);
await page.getByRole("button", { name: "بحث" }).click();
await page.getByText(person.name).first().waitFor();
await page.fill("input[aria-label='وزن الجرة فارغة بالكيلوغرام (اختياري)']", "14.5");
await page.getByRole("button", { name: /استلام جرة فارغة/ }).click();
await page.getByText("سُجل استلام الجرة الفارغة").waitFor();
check("رقم الجرة 295-11", (await body()).includes("295-11"));

// التعبئة عبر الواجهة البرمجية، ثم التسليم بوزن الممتلئة
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const look = await (await fetch(`${BASE}/api/v1/counter/lookup?nationalId=${person.id}`, { headers: { Cookie: cookie } })).json();
const cyl = look.data.entitlements[0].cylinders[0];
await fetch(`${BASE}/api/v1/operations/fill`, { method: "POST", headers: { Origin: BASE, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ clientOpId: crypto.randomUUID(), cylinderId: cyl.id }] }) });
await page.getByRole("button", { name: "بحث" }).click();
await page.getByRole("button", { name: "تسليم" }).click();
await page.fill("#dl-label", "295-11");
await page.fill("#dl-weight", "13");
await page.getByRole("button", { name: "تأكيد التسليم" }).click();
await page.getByText(/يجب أن يزيد على وزنها فارغة/).waitFor();
check("رفض وزن ممتلئ أقل من الفارغ", true);
await page.getByRole("button", { name: "تسليم" }).click();
await page.fill("#dl-label", "295-11");
await page.fill("#dl-weight", "26.5");
await page.screenshot({ path: `${OUT}/sw-02-deliver.png` });
await page.getByRole("button", { name: "تأكيد التسليم" }).click();
await page.getByText(/سُلّمت الجرة/).waitFor();
check("التسليم بالوزن", true);

await page.goto(`${BASE}/d/cylinders/${cyl.id}`);
const cp = await body();
check("صفحة الجرة: الوزنان ووزن الغاز", cp.includes("14.50 كغ") && cp.includes("26.50 كغ") && cp.includes("12.00 كغ"));
await page.screenshot({ path: `${OUT}/sw-03-cylinder.png`, fullPage: true });

await page.goto(BASE + "/d/reports/citizens-sheet");
const rp = await body();
check("كشف المواطنين: أعمدة الأوزان", rp.includes("وزن فارغ") && rp.includes("الغاز") && rp.includes("12.00"));
await page.screenshot({ path: `${OUT}/sw-04-sheet.png`, fullPage: true });

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/d/counter");
await mp.fill("input[aria-label='رقم الهوية']", person.id);
await mp.getByRole("button", { name: "بحث" }).click();
await mp.getByText(person.name).first().waitFor();
await mp.screenshot({ path: `${OUT}/sw-05-mobile-counter.png`, fullPage: true });
check("رقم المواطن في عنوان البطاقة يُقرأ من اليسار (295 قبل 11)", await mp.$eval("h2 bdi", (el) => { const t = el.firstChild; const r = (i) => { const g = document.createRange(); g.setStart(t, i); g.setEnd(t, i + 1); return g.getBoundingClientRect().x; }; return r(0) < r(t.length - 1); }));
check("لا تمرير أفقي على الهاتف", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

console.log("أخطاء المتصفح:", errors);
console.log(`\nفشل: ${fails}`);
await browser.close();
process.exit(fails ? 1 : 0);
