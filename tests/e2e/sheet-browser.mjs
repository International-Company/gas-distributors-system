// اختبار متصفح للواجهة المبسّطة (الكشف والفلوس) — للتطوير فقط؛ ينشئ بيانات تجريبية.
// يشغّل الخادم بنفسه ثم يوقفه فعليًا لاختبار العمل بدون نت.
// الاستخدام (بعد npm run build):
//   E2E_ADMIN_USER=superadmin E2E_ADMIN_PASSWORD=... CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   node tests/e2e/sheet-browser.mjs 3300 ./test-results/sheet
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = Number(process.argv[2] ?? 3300);
const BASE = `http://localhost:${PORT}`;
const OUT = process.argv[3] ?? "test-results/sheet";
const { E2E_ADMIN_USER: ADMIN_USER, E2E_ADMIN_PASSWORD: ADMIN_PW, CHROME_PATH } = process.env;
if (!ADMIN_USER || !ADMIN_PW || !CHROME_PATH) {
  console.error("E2E_ADMIN_USER و E2E_ADMIN_PASSWORD و CHROME_PATH مطلوبة");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => { console.log(ok ? "  ✓" : "  ✗", name, ok ? "" : extra); if (!ok) fails++; };
const strip = (s) => s.replace(/[\u2066-\u2069]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
async function startServer() {
  server = spawn(process.execPath, ["--env-file=.env", "node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + "/login")).ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("الخادم لم يبدأ");
}
async function stopServer() {
  server.kill();
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + "/login"); } catch { return; }
    await sleep(250);
  }
}

function luhnId(base8) {
  for (let d = 0; d <= 9; d++) {
    const id = base8 + d; let s = 0;
    for (let i = 0; i < 9; i++) { let x = Number(id[i]) * (i % 2 ? 2 : 1); if (x > 9) x -= 9; s += x; }
    if (s % 10 === 0) return id;
  }
}
const rnd = () => String(10000000 + Math.floor(Math.random() * 89999999));
const tag = Math.random().toString(36).slice(2, 6);
const A = { id: luhnId(rnd()), name: "أبو أحمد الأول", number: 1 };
const B = { id: luhnId(rnd()), name: "أم محمد الثانية", number: 2 };
const C = { id: luhnId(rnd()), name: "أبو خالد الثالث", number: 10 };

await startServer();
try {
  const jar = new Map();
  const call = async (method, path, body) => {
    const headers = { Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}), ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) };
    const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); jar.set(k, v); }
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  await call("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
  const username = `e2esh_${tag}`;
  const created = await call("POST", "/api/v1/admin/distributors", { name: `موزع الكشف ${tag}`, username, password: "Start-1234", phone: "0599000999", region: "غزة" });
  check("إنشاء موزّع", created.status === 200);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("كشف");
  ws.addRow(["تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : 40"]);
  ws.addRow(["المتسلسل", "رقم الهوية", "الاسم", "رقم الجوال"]);
  for (const p of [A, B, C]) ws.addRow([p.number, p.id, p.name, "0599000000"]);
  const xlsx = `${OUT}/statement.xlsx`;
  writeFileSync(xlsx, Buffer.from(await wb.xlsx.writeBuffer()));

  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const body = async () => strip(await page.textContent("body"));
  const header = () => page.locator("header").first();

  await page.goto(BASE + "/login");
  await page.fill("#username", username);
  await page.fill("#password", "Start-1234");
  await page.click("button[type=submit]");
  await page.waitForURL("**/change-password");
  await page.fill("#cp-current", "Start-1234");
  await page.fill("#cp-new", "Mine-5678");
  await page.fill("#cp-confirm", "Mine-5678");
  await page.click("button[type=submit]");
  await page.waitForURL("**/d/sheet");
  check("الرئيسية تفتح «الكشف» مباشرة", page.url().endsWith("/d/sheet"));

  const navLinks = (await page.locator("aside").first().getByRole("link").allTextContents()).map((t) => t.trim()).filter(Boolean);
  check("القائمة: الكشف والكشوفات والفلوس فقط (مع الحساب)", ["الكشف", "الكشوفات", "الفلوس"].every((x) => navLinks.some((l) => l === x)) && !navLinks.some((l) => /الجرار|النقلات|المحطات|الدورات|التقارير|التوزيع/.test(l)), navLinks.join("|"));
  await page.getByText("ما في كشف معتمد بعد").waitFor();
  check("كشف فارغ يدلك على رفع الكشف", (await page.getByRole("link", { name: /ارفع كشف/ }).count()) === 1);

  // رفع الكشف: الدورة تُنشأ تلقائيًا بسعر الجرة
  await page.getByRole("link", { name: /ارفع كشف/ }).click();
  await page.waitForURL("**/d/statements");
  await page.fill("#u-price", "25");
  await page.setInputFiles("#u-file", xlsx);
  await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
  check("الدورة أُنشئت تلقائيًا وانتقل للمراجعة (الخطوة 2)", (await page.locator("[aria-current=step]").textContent()).includes("راجع البيانات"));
  check("الكشف السليم: زر اعتماد واحد بعدد الناس", (await page.getByRole("button", { name: "اعتمد الكشف (3 شخص)" }).count()) === 1);
  await page.screenshot({ path: `${OUT}/s-00-review.png`, fullPage: true });
  await page.getByRole("button", { name: /اعتمد الكشف/ }).click();
  await page.waitForURL(/\/d\/sheet/, { timeout: 30000 });
  await page.locator("[data-row]").first().waitFor();
  check("بعد الاعتماد: انتقال مباشر إلى «الكشف» مع رسالة", page.url().includes("approved=1") && (await page.getByText("اعتُمد الكشف وصار جاهزًا").count()) === 1);

  const order = await page.locator("[data-row] bdi[dir=ltr]").evaluateAll((els) => els.filter((e) => /^\d+-\d+$/.test(e.textContent ?? "")).map((e) => e.textContent));
  check("ناس الكشف بترتيب عددي (40-1، 40-2، 40-10)", JSON.stringify(order) === JSON.stringify(["40-1", "40-2", "40-10"]), JSON.stringify(order));
  check("الإحصاءات: استلموا 0 من 3", (await body()).includes("0 من 3"));
  await page.screenshot({ path: `${OUT}/s-01-sheet.png`, fullPage: true });

  // البحث برقم الهوية ثم «سلّم» بتأكيد الهوية
  await page.fill("input[aria-label='بحث في الكشف']", B.id);
  check("البحث برقم الهوية يُظهر الشخص وحده", (await page.locator("[data-row]").count()) === 1 && (await body()).includes(B.name));
  await page.getByRole("button", { name: "سلّم" }).click();
  await page.fill("#ho-id", A.id);
  await page.getByRole("button", { name: "تأكيد التسليم" }).click();
  await page.getByText("رقم الهوية المكتوب لا يطابق").waitFor();
  check("هوية خاطئة: لا تسليم", true);
  await page.fill("#ho-id", B.id);
  await page.screenshot({ path: `${OUT}/s-02-deliver.png` });
  await page.getByRole("button", { name: "تأكيد التسليم" }).click();
  await page.getByText(`سُلّم ${B.name}`).waitFor();
  check("«سلّم» نجح وظهرت علامة التسليم", (await body()).includes("سُلّم ✓") && (await page.getByRole("button", { name: "سلّم" }).count()) === 0);

  // «دفع» جزئي
  await page.getByRole("button", { name: "دفع" }).click();
  await page.getByRole("button", { name: "دفعة جزئية" }).click();
  await page.fill("#pay-amount", "10");
  await page.getByRole("button", { name: "تسجيل التحصيل" }).click();
  await page.locator("dialog[open]").waitFor({ state: "detached", timeout: 15000 });
  const paidOk = await page.waitForFunction(() => (document.body.textContent ?? "").replace(/[⁦-⁩]/g, "").includes("باقي 15.00"), null, { timeout: 15000 }).then(() => true, () => false);
  check("الدفع الجزئي: باقي 15.00", paidOk);

  // الفلاتر
  await page.fill("input[aria-label='بحث في الكشف']", "");
  await page.getByRole("tab", { name: "ما استلم" }).click();
  check("فلتر «ما استلم»: 2", (await page.locator("[data-row]").count()) === 2, `count=${await page.locator("[data-row]").count()} q=${await page.inputValue("input[aria-label='بحث في الكشف']")}`);
  await page.getByRole("tab", { name: "عليه فلوس" }).click();
  check("فلتر «عليه فلوس»: 3", (await page.locator("[data-row]").count()) === 3, `count=${await page.locator("[data-row]").count()}`);
  await page.getByRole("tab", { name: "الكل" }).click();

  // التراجع عن التسليم بسبب
  await page.fill("input[aria-label='بحث في الكشف']", B.id);
  await page.getByTitle("تراجع عن التسليم").click();
  await page.fill("#ho-reason", "سُلّم بالخطأ");
  await page.getByRole("button", { name: "تأكيد التراجع" }).click();
  await page.getByText(`أُلغي تسليم ${B.name}`).waitFor();
  check("التراجع عن التسليم يعيد زر «سلّم»", (await page.getByRole("button", { name: "سلّم" }).count()) === 1);
  await page.fill("input[aria-label='بحث في الكشف']", "");

  // ---------- بدون نت: إيقاف الخادم فعليًا ----------
  const hasSnapshot = () => page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("gas-offline");
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) return res(false);
      const g = db.transaction("kv").objectStore("kv").get("snapshot");
      g.onsuccess = () => res(Boolean(g.result));
      g.onerror = () => res(false);
    };
    r.onerror = () => res(false);
  }));
  await page.reload();
  for (let i = 0; i < 40 && !(await hasSnapshot()); i++) await sleep(250);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await sleep(1500);
  await stopServer();
  await ctx.setOffline(true);
  await page.reload();
  await page.locator("[data-row]").first().waitFor({ timeout: 15000 });
  check("الكشف يفتح بدون نت من بيانات الجهاز", (await body()).includes("بدون نت") && (await page.locator("[data-row]").count()) === 3);
  await page.fill("input[aria-label='بحث في الكشف']", A.id);
  await page.getByRole("button", { name: "سلّم" }).click();
  await page.fill("#ho-id", A.id);
  await page.getByRole("button", { name: "تأكيد التسليم" }).click();
  await page.getByText(`حُفظ تسليم ${A.name}`).waitFor();
  check("التسليم بدون نت محفوظ «بانتظار الإرسال» (لا نجاح قبل الخادم)", (await body()).includes("بانتظار الإرسال"));
  await page.getByRole("button", { name: "دفع" }).click();
  await page.getByRole("button", { name: "تسجيل التحصيل" }).click();
  await page.getByText(/حُفظ قبض/).waitFor();
  check("القبض بدون نت محفوظ، والمتبقي محدث محليًا (خالص)", (await body()).includes("خالص"));
  check("لا يمكن تسليم الشخص نفسه مرة ثانية من الجهاز", (await page.getByRole("button", { name: "سلّم" }).count()) === 0);
  check("المؤشر: عمليتان بانتظار الإرسال", strip(await header().textContent()).includes("2 بانتظار الإرسال"));
  await page.screenshot({ path: `${OUT}/s-03-offline.png`, fullPage: true });

  // عودة النت
  await startServer();
  await ctx.setOffline(false);
  await page.goto(BASE + "/d/sync");
  await page.getByRole("button", { name: "إرسال الآن" }).click();
  await page.waitForFunction(() => !document.querySelector("header")?.textContent?.includes("بانتظار الإرسال"), null, { timeout: 30000 });
  await page.goto(BASE + "/d/sheet");
  await page.fill("input[aria-label='بحث في الكشف']", A.id);
  await page.locator("[data-row]").first().waitFor();
  const a = await body();
  check("بعد عودة النت: تسليم A ودفعه وصلا للخادم", a.includes("سُلّم ✓") && a.includes("خالص") && !a.includes("بانتظار الإرسال"));

  // الفلوس: دفعة المحطة مصروف
  await page.goto(BASE + "/d/finance?tab=expenses");
  await page.fill("#ex-amount", "30");
  await page.fill("#ex-desc", "دفعة للمحطة");
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  await page.waitForSelector("text=دفعة للمحطة");
  await page.goto(BASE + "/d/finance");
  const fin = await body();
  check("الفلوس: المقبوض 35 والمصاريف 30 والرصيد 5", fin.includes("35.00") && fin.includes("30.00") && fin.includes("5.00") && !fin.includes("دفعات المحطات"));
  await page.screenshot({ path: `${OUT}/s-04-money.png`, fullPage: true });

  // ذكاء الرفع: الكشف نفسه (نفس رقم الميزان) يُعتبر تحديثًا تلقائيًا ويظهر الفرق
  await page.goto(BASE + "/d/statements");
  check("صفحة الكشوفات: مربع رفع واحد والكشف المعتمد مع «افتح الكشف»", (await page.getByText("اسحب ملف كشف الهيئة").count()) === 1 && (await page.getByRole("link", { name: "افتح الكشف" }).count()) === 1);
  await page.screenshot({ path: `${OUT}/s-06-statements.png`, fullPage: true });
  await page.setInputFiles("#u-file", xlsx);
  await page.waitForURL(/\/d\/statements\/[0-9a-f-]+$/, { timeout: 30000 });
  const upd = await body();
  check("رفع الكشف نفسه يُكتشف تحديثًا (نفس رقم الميزان) مع الفروق", upd.includes("اعتُبر تحديثًا لكشف") && upd.includes("تحديث لكشف") && upd.includes("+0 جدد"));
  await page.screenshot({ path: `${OUT}/s-07-update.png`, fullPage: true });

  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  await mp.goto(BASE + "/d/sheet");
  await mp.locator("[data-row]").first().waitFor();
  await mp.screenshot({ path: `${OUT}/s-05-mobile.png`, fullPage: true });
  check("الهاتف: لا تمرير أفقي", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);

  console.log("أخطاء المتصفح:", errors.filter((e) => !/Failed to fetch|NetworkError|ERR_/.test(e)));
  await browser.close();
} finally {
  server?.kill();
}
console.log(`\nفشل: ${fails}`);
process.exit(fails ? 1 : 0);
