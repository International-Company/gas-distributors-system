// اختبار متصفح حقيقي للمرحلة 6 (العمل دون اتصال والمزامنة) — للتطوير فقط؛ ينشئ بيانات تجريبية.
// يشغّل الخادم بنفسه ثم يوقفه فعليًا لمحاكاة الانقطاع (لا يعتمد على محاكاة المتصفح وحدها).
// الاستخدام (بعد npm run build):
//   E2E_ADMIN_USER=superadmin E2E_ADMIN_PASSWORD=... CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   node tests/e2e/phase6-offline-browser.mjs 3200 ./test-results/phase6
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = Number(process.argv[2] ?? 3200);
const BASE = `http://localhost:${PORT}`;
const OUT = process.argv[3] ?? "test-results/phase6";
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

// ---------- الخادم ----------
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
const A = { id: luhnId(rnd()), name: "مواطن التسليم دون اتصال", number: 1 };
const B = { id: luhnId(rnd()), name: "مواطن التعارض", number: 2 };
const C = { id: luhnId(rnd()), name: "مواطن الاستلام دون اتصال", number: 3 };

await startServer();
try {
  // ---------- التجهيز (متصل) ----------
  const jar = new Map();
  const call = async (method, path, body, cookies = jar) => {
    const headers = { Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}), ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) };
    const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); cookies.set(k, v); }
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  await call("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
  const username = `e2e6_${tag}`;
  const created = await call("POST", "/api/v1/admin/distributors", { name: `موزع دون اتصال ${tag}`, username, password: "Start-1234", phone: "0599000666", region: "دير البلح" });
  check("إنشاء موزّع", created.status === 200);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("كشف");
  ws.addRow(["تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : 77"]);
  ws.addRow(["المتسلسل", "رقم الهوية", "الاسم", "رقم الجوال"]);
  for (const p of [A, B, C]) ws.addRow([p.number, p.id, p.name, "0599000000"]);
  const xlsx = `${OUT}/statement.xlsx`;
  writeFileSync(xlsx, Buffer.from(await wb.xlsx.writeBuffer()));

  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

  // جهاز ثانٍ (جلسة مستقلة للحساب نفسه) يستلم ويعبئ جرتي A و B.
  const dev2 = new Map();
  await call("POST", "/api/v1/auth/login", { username, password: "Mine-5678" }, dev2);
  const cyl = {};
  for (const p of [A, B]) {
    const look = await call("GET", `/api/v1/counter/lookup?nationalId=${p.id}`, null, dev2);
    const rec = await call("POST", "/api/v1/operations/receive-empty", { clientOpId: crypto.randomUUID(), entitlementId: look.json.data.entitlements[0].id, nationalId: p.id }, dev2);
    cyl[p.number] = rec.json.data.cylinder;
    await call("POST", "/api/v1/operations/fill", { items: [{ clientOpId: crypto.randomUUID(), cylinderId: rec.json.data.cylinder.id }] }, dev2);
  }
  check("تجهيز جرتين معبأتين (77-1 و 77-2)", cyl[1]?.label === "77-1" && cyl[2]?.label === "77-2");

  // الشباك متصلًا: تُنزّل بيانات الجهاز ويُجهّز عامل الخدمة الصفحات.
  await page.goto(BASE + "/d/counter");
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
  for (let i = 0; i < 40 && !(await hasSnapshot()); i++) await sleep(250);
  check("نُزّلت بيانات الجهاز (مشفرة في IndexedDB)", await hasSnapshot());
  const plain = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("gas-offline");
    r.onsuccess = () => {
      const g = r.result.transaction("kv").objectStore("kv").get("snapshot");
      g.onsuccess = () => res(JSON.stringify(g.result, (k, v) => (v instanceof ArrayBuffer ? new TextDecoder().decode(v) : v)));
    };
  }));
  check("الأسماء وأرقام الهوية غير مخزنة نصًا صريحًا", !plain.includes(A.id) && !plain.includes(A.name));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.goto(BASE + "/d/sync");
  await page.goto(BASE + "/d/counter");
  await sleep(1500);

  // ---------- الانقطاع: إيقاف الخادم فعليًا + وضع المتصفح دون اتصال ----------
  await stopServer();
  await ctx.setOffline(true);
  await page.reload();
  check("صفحة الشباك تفتح دون اتصال (من ذاكرة عامل الخدمة)", (await body()).includes("رقم الهوية من البطاقة") || (await page.locator("input[aria-label='رقم الهوية']").count()) > 0);
  await page.locator("header").first().getByText("دون اتصال").waitFor({ timeout: 5000 }).catch(() => {});
  check("مؤشر «دون اتصال» في الرأس", (await page.locator("header").first().textContent()).includes("دون اتصال"));

  const search = async (id) => {
    await page.fill("input[aria-label='رقم الهوية']", id);
    await page.getByRole("button", { name: "بحث" }).click();
  };

  // تسليم A دون اتصال
  page.on("console", (m) => { if (process.env.E2E_DEBUG) console.log("console:", m.type(), m.text().slice(0, 300)); });
  await search(A.id);
  await page.getByText(A.name).first().waitFor({ timeout: 8000 }).catch(async () => {
    await page.screenshot({ path: `${OUT}/p6-debug.png`, fullPage: true });
    console.log("DEBUG body:", (await body()).slice(0, 600));
    console.log("DEBUG errors:", errors);
  });
  check("البحث من بيانات الجهاز مع تنبيه واضح", (await body()).includes("تعمل ببيانات محفوظة على هذا الجهاز"));
  await page.getByRole("button", { name: "تسليم" }).click();
  await page.fill("#dl-label", "77-2");
  await page.getByRole("button", { name: "تأكيد التسليم" }).click();
  await page.getByText(/لا يطابق رقمها/).waitFor();
  check("الرقم الخاطئ مرفوض محليًا دون اتصال", true);
  await page.getByRole("button", { name: "تسليم" }).click();
  await page.fill("#dl-label", "77-1");
  await page.getByRole("button", { name: "تأكيد التسليم" }).click();
  await page.getByText(/حُفظ تسليم الجرة/).waitFor();
  const afterA = await body();
  check("التسليم محفوظ على الجهاز «بانتظار الإرسال» (لا نجاح قبل الخادم)", afterA.includes("بانتظار الإرسال") && !afterA.includes("سُلّمت الجرة 77-1."));
  check("لا يمكن تسليم الجرة نفسها مرة ثانية من الجهاز", (await page.getByRole("button", { name: "تسليم" }).count()) === 0);
  await page.screenshot({ path: `${OUT}/p6-01-offline-deliver.png`, fullPage: true });

  // استلام C وتحصيل منه دون اتصال
  await search(C.id);
  await page.getByText(C.name).first().waitFor();
  await page.getByRole("button", { name: /استلام جرة فارغة/ }).click();
  await page.getByText(/حُفظ الاستلام على هذا الجهاز/).waitFor();
  check("الاستلام دون اتصال يعرض الرقم الذي يُكتب على الجرة (77-3)", (await body()).includes("اكتب الرقم 77-3 على الجرة"));
  check("زر الاستلام اختفى (لا استلام مكرر)", (await page.getByRole("button", { name: /استلام جرة فارغة/ }).count()) === 0);
  await page.getByRole("button", { name: "تحصيل" }).click();
  await page.getByRole("button", { name: "دفعة جزئية" }).click();
  await page.fill("#pay-amount", "25");
  await page.getByRole("button", { name: "تسجيل التحصيل" }).click();
  await page.getByText(/يتجاوز المتبقي/).waitFor();
  check("التحصيل الزائد مرفوض محليًا", true);
  await page.fill("#pay-amount", "15");
  await page.getByRole("button", { name: "تسجيل التحصيل" }).click();
  await page.getByText(/حُفظ تحصيل/).waitFor();
  check("التحصيل محفوظ على الجهاز، والمتبقي محدث محليًا (5.00)", (await body()).includes("5.00"));

  // B: سلّمها الجهاز الثاني أثناء الانقطاع (سيُشغل الخادم مؤقتًا لذلك ثم يُوقف)، وهذا الجهاز لا يعلم.
  await search(B.id);
  await page.getByText(B.name).first().waitFor();
  await startServer();
  const d2 = await call("POST", "/api/v1/operations/deliver", { clientOpId: crypto.randomUUID(), cylinderId: cyl[2].id, cylinderLabel: "77-2", nationalId: B.id }, dev2);
  check("الجهاز الثاني سلّم 77-2 متصلًا", d2.status === 200);
  await stopServer();
  await page.getByRole("button", { name: "تسليم" }).click();
  await page.fill("#dl-label", "77-2");
  await page.getByRole("button", { name: "تأكيد التسليم" }).click();
  await page.getByText(/حُفظ تسليم الجرة/).waitFor();

  const pending = await page.locator("header").first().textContent();
  check("المؤشر: 4 عمليات بانتظار الإرسال", strip(pending).includes("4 بانتظار الإرسال"));
  await page.goto(BASE + "/d/sync");
  await page.locator("[data-op-status]").nth(3).waitFor({ timeout: 10000 });
  const sp = await body();
  check("قائمة المزامنة تفتح دون اتصال وتعرض العمليات وحالاتها", sp.includes("نُفذت دون اتصال") && (sp.includes("على الجهاز") || sp.includes("بانتظار الإرسال")) && sp.includes("77-3"), JSON.stringify([sp.includes("نُفذت دون اتصال"), sp.includes("بانتظار المزامنة"), sp.includes("77-3")]));
  await page.screenshot({ path: `${OUT}/p6-02-sync-offline.png`, fullPage: true });

  // ---------- عودة الاتصال ----------
  await startServer();
  await ctx.setOffline(false);
  await page.getByRole("button", { name: "إرسال الآن" }).click();
  await page.waitForFunction(() => !document.querySelector("header")?.textContent?.includes("بانتظار الإرسال"), null, { timeout: 30000 });
  const after = strip(await page.locator("header").first().textContent());
  check("بعد المزامنة: لا عمليات معلقة، وعملية واحدة تحتاج مراجعة", !after.includes("بانتظار الإرسال") && after.includes("1 بدها مراجعة"), after);
  await page.getByRole("button", { name: "الكل" }).click();
  const all = await body();
  check("ثلاث عمليات «وصلت» وواحدة «بدها مراجعة» برسالة الخادم", (all.match(/وصلت/g) ?? []).length >= 3 && all.includes("سُلّمت هذه الجرة سابقًا"));
  await page.screenshot({ path: `${OUT}/p6-03-after-sync.png`, fullPage: true });

  // التحقق من الخادم
  const lookA = await call("GET", `/api/v1/counter/lookup?nationalId=${A.id}`, null, dev2);
  const lookB = await call("GET", `/api/v1/counter/lookup?nationalId=${B.id}`, null, dev2);
  const lookC = await call("GET", `/api/v1/counter/lookup?nationalId=${C.id}`, null, dev2);
  check("الخادم: 77-1 سُلّمت", lookA.json.data.entitlements[0].cylinders[0].status === "DELIVERED");
  check("الخادم: 77-2 سُلّمت مرة واحدة فقط", lookB.json.data.entitlements[0].cylinders.length === 1 && lookB.json.data.entitlements[0].cylinders[0].status === "DELIVERED");
  const ec = lookC.json.data.entitlements[0];
  check("الخادم: 77-3 مستلمة فارغة، وتحصيل 15 والمتبقي 5", ec.cylinders[0]?.label === "77-3" && ec.cylinders[0]?.status === "EMPTY" && Number(ec.paid) === 15 && Number(ec.amountRemaining) === 5, JSON.stringify({ c: ec.cylinders, paid: ec.paid, rem: ec.amountRemaining }));
  await page.goto(BASE + "/d/review-cases");
  const rc = await body();
  check("حالة مراجعة «تعارض مزامنة» على الخادم", rc.includes("تعارض مزامنة") && rc.includes("77-2"));

  // إخفاء بعد المعالجة، ثم الخروج يحذف بيانات الجهاز
  await page.goto(BASE + "/d/sync");
  await page.getByRole("button", { name: "عولجت — إخفاء" }).click();
  await page.waitForFunction(() => !document.querySelector("header")?.textContent?.includes("بدها مراجعة"), null, { timeout: 10000 });
  check("إخفاء العملية المعالجة", true);

  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  await mp.goto(BASE + "/d/sync");
  await mp.screenshot({ path: `${OUT}/p6-04-mobile-sync.png`, fullPage: true });
  check("لا تمرير أفقي على الهاتف", (await mp.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await m.close();

  await page.getByRole("button", { name: "تسجيل الخروج" }).first().click();
  await page.waitForURL("**/login");
  check("الخروج يحذف بيانات الجهاز", !(await hasSnapshot()));

  const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
  check("بيان التطبيق للتثبيت (عربي، من اليمين، أيقونات)", manifest.dir === "rtl" && manifest.lang === "ar" && manifest.icons.length === 3 && manifest.display === "standalone");

  console.log("أخطاء المتصفح:", errors.filter((e) => !/Failed to fetch|NetworkError|ERR_/.test(e)));
  await browser.close();
} finally {
  server?.kill();
}
console.log(`\nفشل: ${fails}`);
process.exit(fails ? 1 : 0);
