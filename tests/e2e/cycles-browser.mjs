// اختبار متصفح للتحكم في الدورات — للتطوير فقط؛ ينشئ بيانات تجريبية.
// الاستخدام: E2E_ADMIN_USER=... E2E_ADMIN_PASSWORD=... CHROME_PATH=... node tests/e2e/cycles-browser.mjs http://localhost:3000 ./test-results/cycles
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/cycles";
const { E2E_ADMIN_USER: U, E2E_ADMIN_PASSWORD: P, CHROME_PATH } = process.env;
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ✓" : "  ✗", name, ok ? "" : extra); if (!ok) fails++; };
const strip = (s) => s.replace(/[⁦-⁩]/g, "");

function luhnId(base8) {
  for (let d = 0; d <= 9; d++) {
    const id = base8 + d; let s = 0;
    for (let i = 0; i < 9; i++) { let x = Number(id[i]) * (i % 2 ? 2 : 1); if (x > 9) x -= 9; s += x; }
    if (s % 10 === 0) return id;
  }
}
const rnd = () => String(10000000 + Math.floor(Math.random() * 89999999));
const person = (n, name) => ({ id: luhnId(rnd()), name, number: n });
async function xlsx(file, scale, people) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("كشف");
  ws.addRow([`تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : ${scale}`]);
  ws.addRow(["المتسلسل", "رقم الهوية", "الاسم", "رقم الجوال"]);
  for (const p of people) ws.addRow([p.number, p.id, p.name, "0599000000"]);
  writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
  return file;
}

const jar = new Map();
const call = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { Origin: BASE, "Content-Type": "application/json", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: b ? JSON.stringify(b) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
  return r.json().catch(() => null);
};
await call("POST", "/api/v1/auth/login", { username: U, password: P });
const tag = Math.random().toString(36).slice(2, 6);
await call("POST", "/api/v1/admin/distributors", { name: `موزع الدورات ${tag}`, username: `cy_${tag}`, password: "Start-1234", phone: "0599000111", region: "غزة" });

const b = await chromium.launch({ executablePath: CHROME_PATH });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const body = async () => strip(await page.textContent("body"));
await page.goto(BASE + "/login");
await page.fill("#username", `cy_${tag}`); await page.fill("#password", "Start-1234"); await page.click("button[type=submit]");
await page.waitForURL("**/change-password");
await page.fill("#cp-current", "Start-1234"); await page.fill("#cp-new", "Mine-5678"); await page.fill("#cp-confirm", "Mine-5678"); await page.click("button[type=submit]");
await page.waitForURL(/\/d(\/sheet)?$/);

const upload = async (file, price) => {
  await page.goto(BASE + "/d/statements");
  if (price) await page.fill("#u-price", price);
  await page.setInputFiles("#u-file", file);
  await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
};
const approve = async () => {
  await page.getByRole("button", { name: /اعتمد الكشف/ }).click();
  await page.waitForURL(/\/d\/sheet/, { timeout: 30000 });
  await page.locator("[data-row]").first().waitFor();
};
const current = () => page.locator("section[data-cycle]").first();

// 1) أول كشف: لا دورة بعد، فيبدأ «الدورة 1» تلقائيًا
await page.goto(BASE + "/d/statements");
check("بلا دورة: الخيار الوحيد «دورة جديدة» (الدورة 1)", (await page.getByRole("radio").count()) === 1 && strip(await page.getByRole("radio").textContent()).includes("الدورة 1"));
await upload(await xlsx(`${OUT}/a.xlsx`, 11, [person(1, "شخص أ1"), person(2, "شخص أ2")]), "25");
await approve();

// 2) كشف ثانٍ للدورة نفسها (الافتراضي «الحالية»)
await page.goto(BASE + "/d/statements");
check("الافتراضي: ينضاف إلى الدورة الحالية", (await page.getByRole("radio", { checked: true }).textContent()).includes("الدورة 1"));
await upload(await xlsx(`${OUT}/b.xlsx`, 12, [person(1, "شخص ب1")]));
await approve();
await page.goto(BASE + "/d/statements");
const cur = strip(await current().textContent());
check("الدورة الحالية: كشفان و3 أشخاص بداخلها", cur.includes("الدورة 1") && cur.includes("الحالية") && cur.includes("2 كشف") && cur.includes("3 شخص") && (await current().locator("li").count()) === 2, cur);
await page.screenshot({ path: `${OUT}/c-01-current.png`, fullPage: true });

// 3) تغيير اسم الدورة
await page.getByRole("button", { name: "تغيير اسم الدورة 1" }).click();
await page.fill("#cy-rename", "دورة تشرين");
await page.getByRole("button", { name: "حفظ" }).click();
await page.getByText("دورة تشرين").first().waitFor();
check("تغيير اسم الدورة", strip(await current().textContent()).includes("دورة تشرين"));

// 4) رفع كشف إلى «دورة جديدة» من مربع الرفع
await page.getByRole("radio", { name: /دورة جديدة/ }).click();
check("اختيار «دورة جديدة» يشرح أن الحالية تنتهي", (await body()).includes("راح تنتهي «دورة تشرين» وتبدأ «الدورة 2»"));
await page.screenshot({ path: `${OUT}/c-02-target.png`, fullPage: true });
await page.setInputFiles("#u-file", await xlsx(`${OUT}/c.xlsx`, 21, [person(1, "شخص ج1")]));
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
check("الكشف الجديد في «الدورة 2»", (await body()).includes("الدورة 2"));

// 5) لا دورة جديدة وفي الحالية كشف بانتظار الاعتماد
await page.goto(BASE + "/d/statements");
await page.getByRole("button", { name: "دورة جديدة" }).click();
check("زر «دورة جديدة» يمنع وفي الدورة كشف بانتظار الاعتماد", (await page.locator("dialog[open]").textContent()).includes("بانتظار الاعتماد"));
await page.getByRole("button", { name: "تمام" }).click();
await page.getByRole("link", { name: "راجع واعتمد" }).click();
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/);
await approve();

// 6) الدورات السابقة مطوية مع الباقي على الناس، وكشوفها تشتغل
await page.goto(BASE + "/d/statements");
const prev = page.locator("details[data-cycle]").first();
const pt = strip(await prev.textContent());
check("«دورة تشرين» في الدورات السابقة: انتهت، كشفان، باقي على الناس 75", pt.includes("دورة تشرين") && pt.includes("انتهت") && pt.includes("2 كشف") && pt.includes("باقي على الناس") && pt.includes("75.00"), pt);
await prev.locator("summary").click();
check("فتح الدورة السابقة يعرض كشوفاتها مع «افتح الكشف»", (await prev.getByRole("link", { name: "افتح الكشف" }).count()) === 2);
await page.screenshot({ path: `${OUT}/c-03-previous.png`, fullPage: true });

// 7) «دورة جديدة» من الزر، ثم إنهاء الدورة
await page.getByRole("button", { name: "دورة جديدة" }).click();
await page.fill("#cy-name", "دورة الشتاء");
await page.getByRole("button", { name: "ابدأ دورة الشتاء" }).click();
await page.locator("dialog[open]").waitFor({ state: "detached" });
await page.waitForFunction(() => document.querySelector("section[data-cycle]")?.textContent?.includes("دورة الشتاء"));
check("زر «دورة جديدة» يبدأ «دورة الشتاء» فارغة", strip(await current().textContent()).includes("ما في كشوفات بهذه الدورة بعد"));
await current().getByRole("button", { name: "إنهاء" }).click();
await page.getByRole("button", { name: "أنهِ الدورة" }).click();
await page.getByText("ما في دورة شغّالة").waitFor();
check("إنهاء الدورة: لا دورة شغّالة، وأول كشف يبدأ «الدورة 4»", (await body()).includes("بيبدأ «الدورة 4»"));

const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/d/statements");
await mp.screenshot({ path: `${OUT}/c-04-mobile.png`, fullPage: true });
check("الهاتف: لا تمرير أفقي", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

console.log("أخطاء المتصفح:", errors);
await b.close();
console.log(`\nفشل: ${fails}`);
process.exit(fails ? 1 : 0);
