// اختبار دخان HTTP حقيقي ضد خادم يعمل (للتطوير/التجهيز فقط، لا يُشغّل على الإنتاج).
// يتطلب مديرًا رئيسيًا جديدًا مُلزمًا بتغيير كلمة المرور (كما ينشئه admin:create).
// الاستخدام:
//   SMOKE_ADMIN_USER=superadmin SMOKE_ADMIN_PASSWORD=<المؤقتة> SMOKE_ADMIN_NEW_PASSWORD=<جديدة> //   node tests/smoke/http-smoke.mjs http://localhost:3000
const BASE = process.argv[2] ?? "http://localhost:3000";
const ADMIN_USER = process.env.SMOKE_ADMIN_USER;
const ADMIN_PW = process.env.SMOKE_ADMIN_PASSWORD;
const ADMIN_NEW_PW = process.env.SMOKE_ADMIN_NEW_PASSWORD;
if (!ADMIN_USER || !ADMIN_PW || !ADMIN_NEW_PW) {
  console.error("SMOKE_ADMIN_USER و SMOKE_ADMIN_PASSWORD و SMOKE_ADMIN_NEW_PASSWORD مطلوبة");
  process.exit(2);
}
const ORIGIN = BASE;
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra); }
};

function client() {
  const jar = new Map();
  return async (method, path, body, { origin = true, redirect = "manual" } = {}) => {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (origin) headers["Origin"] = ORIGIN;
    if (jar.size) headers["Cookie"] = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), redirect });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      if (!v || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
    res.rawCookies = res.headers.getSetCookie();
    return res;
  };
}
const json = async (r) => r.json().catch(() => null);
const rnd = Math.random().toString(36).slice(2, 7);

const admin = client();
let r = await admin("GET", "/login");
const html = await r.text();
check("صفحة الدخول 200 وبالعربية RTL", r.status === 200 && html.includes('dir="rtl"') && html.includes('lang="ar"'));
check("ترويسات أمان", r.headers.get("x-frame-options") === "DENY" && r.headers.get("x-content-type-options") === "nosniff");

r = await admin("GET", "/admin");
check("صفحة الإدارة دون جلسة تعيد التوجيه للدخول", r.status === 307 && r.headers.get("location")?.includes("/login"), r.status);

r = await admin("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW }, { origin: false });
check("رفض POST دون Origin (CSRF)", r.status === 403);
r = await admin("POST", "/api/v1/auth/login", { username: ADMIN_USER, password: ADMIN_PW });
const lj = await json(r);
check("دخول المدير ناجح ويُلزم بتغيير كلمة المرور", r.status === 200 && lj?.data?.mustChangePassword === true, JSON.stringify(lj));
check("ملف الجلسة HttpOnly و SameSite", r.rawCookies.some((c) => c.startsWith("gas_session=") && /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)));

r = await admin("GET", "/api/v1/admin/distributors");
check("API محجوبة قبل تغيير كلمة المرور", r.status === 403 && (await json(r))?.error?.code === "PASSWORD_CHANGE_REQUIRED");
r = await admin("POST", "/api/v1/auth/change-password", { currentPassword: ADMIN_PW, newPassword: ADMIN_NEW_PW, confirmPassword: ADMIN_NEW_PW });
check("تغيير كلمة المرور", r.status === 200, JSON.stringify(await json(r)));

r = await admin("POST", "/api/v1/admin/distributors", "{bad json");
check("JSON غير صالح يعطي 400", r.status === 400);
r = await admin("POST", "/api/v1/admin/distributors", { name: "x" });
const vj = await json(r);
check("أخطاء التحقق بالعربية مع الحقول", r.status === 400 && vj?.error?.fields && /[؀-ۿ]/.test(vj.error.message));

const dUser = `dist_${rnd}`;
r = await admin("POST", "/api/v1/admin/distributors", { name: `موزّع ${rnd}`, username: dUser, password: "Start-1234", phone: "0599111222", region: "دير البلح" });
const created = (await json(r))?.data;
check("إنشاء موزّع عبر API", r.status === 200 && created?.id);

for (const p of ["/admin", "/admin/distributors", `/admin/distributors/${created?.id}`, "/admin/distributors/new", "/admin/categories", "/admin/admins", "/admin/audit", "/admin/login-attempts", "/admin/errors", "/admin/settings", "/account"]) {
  r = await admin("GET", p);
  check(`صفحة ${p} تعمل`, r.status === 200, r.status);
}

r = await admin("GET", "/api/v1/admin/distributors/export?q=" + encodeURIComponent(rnd));
const buf = Buffer.from(await r.arrayBuffer());
check("تصدير Excel", r.status === 200 && r.headers.get("content-type")?.includes("spreadsheetml") && buf.subarray(0, 2).toString() === "PK");

// الموزّع
const dist = client();
r = await dist("POST", "/api/v1/auth/login", { username: dUser, password: "Start-1234" });
check("دخول الموزّع", r.status === 200);
await dist("POST", "/api/v1/auth/change-password", { currentPassword: "Start-1234", newPassword: "Mine-5678", confirmPassword: "Mine-5678" });
r = await dist("GET", "/api/v1/distributor/profile");
const prof = (await json(r))?.data;
check("الموزّع يقرأ ملفه", r.status === 200 && prof?.id === created?.id);
r = await dist("GET", "/api/v1/admin/distributors");
check("الموزّع ممنوع من API الإدارة", r.status === 403);
r = await dist("GET", `/api/v1/admin/distributors/${created?.id}`);
check("الموزّع ممنوع من قراءة حسابات عبر API الإدارة", r.status === 403);
r = await dist("GET", "/admin");
check("الموزّع يُعاد توجيهه عن صفحات الإدارة", r.status === 307 && r.headers.get("location")?.includes("/forbidden"));
r = await dist("GET", "/d");
check("صفحة الموزّع الرئيسية", r.status === 200);

// PIN: تفعيل ثم دخول ثم عملية حساسة تتطلب إعادة تحقق
r = await dist("POST", "/api/v1/auth/pin", { password: "Mine-5678", pin: "4826", confirmPin: "4826" });
check("تفعيل PIN وضبط ملف الجهاز", r.status === 200 && r.rawCookies.some((c) => c.startsWith("gas_device=") && /HttpOnly/i.test(c)));
await dist("POST", "/api/v1/auth/logout");
r = await dist("GET", "/api/v1/auth/me");
check("تسجيل الخروج ينهي الجلسة", r.status === 401);
r = await dist("POST", "/api/v1/auth/pin-login", { pin: "4826" });
check("الدخول بـ PIN", r.status === 200);
r = await dist("POST", "/api/v1/auth/logout-all");
check("جلسة PIN تحتاج تأكيد كلمة المرور للعمليات الحساسة", r.status === 403 && (await json(r))?.error?.code === "REAUTH_REQUIRED");

// تعليق الموزّع يقطع جلسته
r = await admin("POST", `/api/v1/admin/distributors/${created?.id}/actions`, { action: "suspend", reason: "اختبار دخان" });
check("تعليق الموزّع", r.status === 200);
r = await dist("GET", "/api/v1/auth/me");
check("جلسة الموزّع المعلّق تنتهي فورًا", r.status === 401);
r = await dist("POST", "/api/v1/auth/login", { username: dUser, password: "Mine-5678" });
check("الموزّع المعلّق لا يستطيع الدخول", r.status === 403);

r = await admin("GET", `/api/v1/admin/audit?distributorId=${created?.id}`);
const aj = (await json(r))?.data;
check("سجل التدقيق يحتوي العمليات", r.status === 200 && aj?.rows?.some((x) => x.action === "distributor.suspend") && aj.rows.some((x) => x.action === "distributor.create"));

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
