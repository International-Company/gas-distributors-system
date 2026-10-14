import { readFileSync } from "node:fs";
import { join } from "node:path";

// عامل الخدمة (Service Worker): يُخدم من هنا ليحمل رقم البناء، فتُحذف ذاكرة النسخة السابقة عند كل نشر.

function buildId() {
  try {
    return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "dev";
  }
}

/**
 * السياسة:
 * - صفحات الشباك والمزامنة تُحفظ عند فتحها متصلًا، وتُعرض من الذاكرة عند انقطاع الاتصال.
 * - ملفات البناء الثابتة تُحفظ (أسماؤها تتغير مع كل بناء).
 * - طلبات API لا تُحفظ أبدًا: البيانات دون اتصال في IndexedDB المشفرة فقط.
 * - الخروج يحذف كل الذاكرة.
 */
const source = (version: string) => `
const VERSION = ${JSON.stringify(version)};
const CACHE = "gas-" + VERSION;
const OFFLINE_PAGES = ["/d/counter", "/d/sync"];
const FALLBACK = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(FALLBACK, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("gas-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) => url.pathname.startsWith("/_next/static/");

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || new Response("", { status: 504 });
}

async function page(req) {
  const url = new URL(req.url);
  const keep = OFFLINE_PAGES.includes(url.pathname);
  try {
    const res = await fetch(req);
    // صفحة محوّلة (مثل الدخول عند انتهاء الجلسة) لا تُحفظ مكان الصفحة.
    if (keep && res.ok && !res.redirected) (await caches.open(CACHE)).put(url.pathname, res.clone());
    return res;
  } catch {
    return (keep && (await caches.match(url.pathname))) || (await caches.match(FALLBACK)) ||
      new Response("لا يوجد اتصال", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") return event.respondWith(page(req));
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return;
  if (isStatic(url)) return event.respondWith(cacheFirst(req));
  if (/\\.(svg|png|ico|webmanifest)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    return event.respondWith(staleWhileRevalidate(req));
  }
});

/** تجهيز صفحات العمل دون اتصال وملفاتها، دون انتظار أن يفتحها المستخدم. */
async function warm() {
  const cache = await caches.open(CACHE);
  for (const path of OFFLINE_PAGES) {
    try {
      const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok || res.redirected) continue;
      const html = await res.clone().text();
      await cache.put(path, res);
      const assets = [...new Set(html.match(/\\/_next\\/static\\/[^"'\\s)\\\\]+/g) || [])];
      await Promise.all(assets.map(async (a) => { if (!(await cache.match(a))) { const r = await fetch(a); if (r.ok) await cache.put(a, r); } }));
    } catch {}
  }
}

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "warm") event.waitUntil(warm());
  if (type === "clear") event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("gas-")).map((k) => caches.delete(k)))));
});
`;

export function GET() {
  return new Response(source(buildId()), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}

export const dynamic = "force-dynamic";
