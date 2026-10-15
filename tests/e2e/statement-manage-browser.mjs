// اختبار متصفح لتبديل الكشف وحذفه — للتطوير فقط؛ ينشئ بيانات تجريبية.
// الاستخدام: E2E_ADMIN_USER=... E2E_ADMIN_PASSWORD=... CHROME_PATH=... node tests/e2e/statement-manage-browser.mjs http://localhost:3000 ./test-results/manage
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "test-results/manage";
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
await call("POST", "/api/v1/admin/distributors", { name: `موزع التبديل ${tag}`, username: `mg_${tag}`, password: "Start-1234", phone: "0599000111", region: "غزة" });

const b = await chromium.launch({ executablePath: CHROME_PATH });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const body = async () => strip(await page.textContent("body"));
await page.goto(BASE + "/login");
await page.fill("#username", `mg_${tag}`); await page.fill("#password", "Start-1234"); await page.click("button[type=submit]");
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

// 1) كشف اعتُمد بالخطأ ولم يستلم أحد منه: يُحذف
const wrong = [person(1, "شخص الكشف الغلط")];
await upload(await xlsx(`${OUT}/wrong.xlsx`, 70, wrong), "20");
await approve();
await page.goto(BASE + "/d/statements");
check("الكشف المعتمد فيه «تبديل» و«حذف»", (await page.getByTitle("تبديل بكشف جديد").count()) === 1 && (await page.getByTitle("حذف الكشف").count()) === 1);
await page.screenshot({ path: `${OUT}/m-01-list.png`, fullPage: true });
await page.getByTitle("حذف الكشف").click();
check("نافذة الحذف تشرح الأثر (1 شخص، ما حدا استلم أو دفع)", (await body()).includes("ينشال 1 شخص"));
await page.getByRole("button", { name: "رُفع بالخطأ" }).click();
await page.screenshot({ path: `${OUT}/m-02-delete.png` });
await page.getByRole("button", { name: "احذف الكشف" }).click();
await page.getByText("القديمة والملغاة (1)").waitFor();
check("حُذف: خرج من المعتمدة إلى القديمة والملغاة", (await page.getByRole("link", { name: "افتح الكشف" }).count()) === 0);
await page.goto(BASE + "/d/sheet");
await page.getByText("ما في كشف معتمد بعد").waitFor();
check("ناس الكشف المحذوف خرجوا من «الكشف»", true);

// 2) كشف فيه تسليم: الحذف ممنوع ويقترح التبديل
const A = person(1, "أبو سامي المستلم"), B = person(2, "أم علي الباقية"), C = person(3, "أبو فادي الغائب");
await upload(await xlsx(`${OUT}/v1.xlsx`, 71, [A, B, C]));
await approve();
const s = await (await page.request.get(BASE + "/api/v1/sheet")).json();
const rowA = s.data.rows.find((r) => r.nationalId === A.id);
const ho = await page.request.post(BASE + "/api/v1/handovers", { headers: { Origin: BASE }, data: { clientOpId: crypto.randomUUID(), entitlementId: rowA.id, nationalId: A.id } });
check("تسليم شخص من الكشف", ho.ok());
await page.goto(BASE + "/d/statements");
await page.getByTitle("حذف الكشف").click();
check("الحذف ممنوع لأن فيه من استلم، مع اقتراح التبديل", (await body()).includes("ما بنقدر نحذف هذا الكشف") && (await page.getByRole("button", { name: "احذف الكشف" }).count()) === 0);
await page.screenshot({ path: `${OUT}/m-03-blocked.png` });
await page.getByRole("dialog").getByRole("link", { name: "تبديل بكشف جديد" }).click();
await page.waitForURL(/replace=/);
check("وضع التبديل ظاهر فوق مربع الرفع", (await body()).includes("تبديل «") && (await body()).includes("اسحب الكشف الجديد"));
await page.screenshot({ path: `${OUT}/m-04-replace.png` });

// 3) التبديل: A باقي (مستلم)، B باقي، C غاب، D جديد
const D = person(4, "أبو رامي الجديد");
await page.setInputFiles("#u-file", await xlsx(`${OUT}/v2.xlsx`, 72, [A, B, D]));
await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
const rev = await body();
check("التبديل يعرض الفروق: 1 جديد و1 اختفى", rev.includes("تحديث لكشف") && rev.includes("+1 جدد") && rev.includes("1 اختفوا"));
await page.screenshot({ path: `${OUT}/m-05-diff.png`, fullPage: true });
await approve();
const after = await body();
check("بعد التبديل: الجديد ظاهر، والغائب خرج، والمستلم محفوظ", after.includes(D.name) && !after.includes(C.name) && after.includes(A.name) && after.includes("سُلّم ✓"));

// 4) حذف كشف بانتظار الاعتماد
await upload(await xlsx(`${OUT}/pending.xlsx`, 99, [person(1, "شخص معلّق")]));
await page.goto(BASE + "/d/statements");
await page.locator("li", { hasText: "بانتظار" }).first().waitFor().catch(() => {});
const before = await page.getByTitle("حذف الكشف").count();
await page.getByTitle("حذف الكشف").first().click();
await page.getByRole("button", { name: "كشف غلط" }).click();
await page.getByRole("button", { name: "احذف الكشف" }).click();
await page.waitForFunction((n) => document.querySelectorAll("[title='حذف الكشف']").length < n, before, { timeout: 10000 }).catch(() => {});
check("حذف الكشف بانتظار الاعتماد", !(await body()).includes("بانتظار الاعتماد") || (await page.getByText("راجع واعتمد").count()) === 0);

const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/d/statements");
await mp.screenshot({ path: `${OUT}/m-06-mobile.png`, fullPage: true });
check("الهاتف: لا تمرير أفقي", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

console.log("أخطاء المتصفح:", errors);
await b.close();
console.log(`\nفشل: ${fails}`);
process.exit(fails ? 1 : 0);
