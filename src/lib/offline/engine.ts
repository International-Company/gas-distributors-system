"use client";

// محرك العمل دون اتصال على الجهاز: تخزين مشفّر في IndexedDB، وقائمة انتظار العمليات، والمزامنة.
import {
  applySyncedToSnapshot, classifyFailure, isUnsynced, snapshotAgeHours,
  type OpKind, type QueuedOp, type Snapshot,
} from "./logic";

const DB_NAME = "gas-offline";
export const ENDPOINTS: Record<OpKind, string> = {
  receive: "/api/v1/operations/receive-empty",
  deliver: "/api/v1/operations/deliver",
  payment: "/api/v1/payments",
};
/** العمليات المؤكدة تبقى في القائمة للاطلاع ثم تُحذف. */
const KEEP_SYNCED_MS = 3 * 24 * 3_600_000;

export class SendError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("kv");
      req.result.createObjectStore("ops", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}
const kvGet = <T>(k: string) => tx<T | undefined>("kv", "readonly", (s) => s.get(k));
const kvSet = (k: string, v: unknown) => tx("kv", "readwrite", (s) => s.put(v, k));
const kvDel = (k: string) => tx("kv", "readwrite", (s) => s.delete(k));

// ---------------------------------------------------------------------------
// التشفير: مفتاح AES-GCM يُولد على الجهاز ولا يمكن تصديره
// ---------------------------------------------------------------------------

type Sealed = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };

async function key(): Promise<CryptoKey> {
  const k = await kvGet<CryptoKey>("key");
  if (k) return k;
  const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await kvSet("key", fresh);
  return fresh;
}
async function seal(v: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(v)));
  return { iv, data };
}
async function open<T>(s: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: s.iv }, await key(), s.data);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ---------------------------------------------------------------------------
// اللقطة
// ---------------------------------------------------------------------------

type SnapshotRecord = { userId: string; fetchedAt: string; generatedAt: string; maxAgeHours: number; sealed: Sealed };
export type SnapshotInfo = { snapshot: Snapshot; fetchedAt: string; ageHours: number; fresh: boolean };

/** لقطة المستخدم الحالي إن وُجدت. اللقطة الأقدم من الحد المسموح تُحذف (تقليل بقاء البيانات على الجهاز). */
export async function loadSnapshot(userId: string): Promise<SnapshotInfo | null> {
  const rec = await kvGet<SnapshotRecord>("snapshot");
  if (!rec) return null;
  if (rec.userId !== userId) {
    await kvDel("snapshot");
    return null;
  }
  const ageHours = snapshotAgeHours(rec.fetchedAt);
  if (ageHours > rec.maxAgeHours || ageHours < -1) {
    await kvDel("snapshot");
    return null;
  }
  try {
    return { snapshot: await open<Snapshot>(rec.sealed), fetchedAt: rec.fetchedAt, ageHours, fresh: true };
  } catch {
    await kvDel("snapshot");
    return null;
  }
}

async function saveSnapshot(s: Snapshot, fetchedAt = new Date().toISOString()) {
  const rec: SnapshotRecord = { userId: s.userId, fetchedAt, generatedAt: s.generatedAt, maxAgeHours: s.policy.maxAgeHours, sealed: await seal(s) };
  await kvSet("snapshot", rec);
}

/** تنزيل لقطة جديدة من الخادم. ترجع null إن كان العمل دون اتصال معطلًا في الإعدادات. */
export async function refreshSnapshot(): Promise<Snapshot | null> {
  const s = await send<Snapshot | { disabled: true }>("GET", "/api/v1/offline/snapshot");
  if ("disabled" in s) {
    await kvDel("snapshot");
    return null;
  }
  await saveSnapshot(s);
  return s;
}

export async function clearSnapshot() {
  await kvDel("snapshot");
}

// ---------------------------------------------------------------------------
// قائمة الانتظار (مشفّرة؛ الحقول الظاهرة للفرز فقط)
// ---------------------------------------------------------------------------

type OpRecord = { id: string; userId: string; status: QueuedOp["status"]; createdAt: string; sealed: Sealed };

async function putOp(op: QueuedOp) {
  const rec: OpRecord = { id: op.id, userId: op.userId, status: op.status, createdAt: op.createdAt, sealed: await seal(op) };
  await tx("ops", "readwrite", (s) => s.put(rec));
  notify();
}
async function deleteOp(id: string) {
  await tx("ops", "readwrite", (s) => s.delete(id));
  notify();
}

export async function listOps(userId: string): Promise<QueuedOp[]> {
  const recs = await tx<OpRecord[]>("ops", "readonly", (s) => s.getAll());
  const out: QueuedOp[] = [];
  for (const r of recs) {
    if (r.userId !== userId) continue;
    try {
      const op = await open<QueuedOp>(r.sealed);
      if (op.status === "synced" && Date.now() - new Date(op.syncedAt ?? op.createdAt).getTime() > KEEP_SYNCED_MS) {
        await deleteOp(op.id);
        continue;
      }
      out.push(op);
    } catch {
      // سجل لا يمكن فك تشفيره (مفتاح محذوف): لا يمكن إرساله ولا عرضه.
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** عدد العمليات غير المتزامنة لمستخدمين آخرين على هذا الجهاز (دون كشف محتواها). */
export async function foreignUnsyncedCount(userId: string) {
  const recs = await tx<OpRecord[]>("ops", "readonly", (s) => s.getAll());
  return recs.filter((r) => r.userId !== userId && (r.status === "local" || r.status === "pending")).length;
}

export async function dismissOp(userId: string, id: string) {
  const op = (await listOps(userId)).find((o) => o.id === id);
  if (!op || op.status !== "review") return;
  await putOp({ ...op, dismissed: true });
}

// ---------------------------------------------------------------------------
// الإرسال والمزامنة
// ---------------------------------------------------------------------------

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new SendError("NETWORK", "لا يوجد اتصال بالخادم", 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new SendError(json?.error?.code ?? "INTERNAL", json?.error?.message ?? "خطأ غير متوقع في الخادم", res.status);
  return json?.data as T;
}

/**
 * إعادة الإرسال تحمل وقت التنفيذ على الجهاز (فيسجل الخادم رفضها حالة مراجعة)،
 * و«وقت اللقطة» فقط لما نُفذ ببيانات الجهاز دون اتصال (فتُطبق عليه سياسة العمل دون اتصال).
 */
function bodyOf(op: QueuedOp) {
  const retried = op.offline || op.attempts > 0;
  return { ...op.payload, clientOpId: op.id, ...(retried ? { offlineAt: op.createdAt } : {}), ...(op.offline ? { snapshotAt: op.snapshotAt } : {}) };
}

export type SubmitResult = { state: "synced"; result: unknown } | { state: "queued"; error?: SendError } | { state: "review"; message: string };

/**
 * تنفيذ عملية من الشباك: تُحفظ في قائمة الجهاز أولًا ثم تُرسل.
 * - أكدها الخادم ← «متزامنة».
 * - لا اتصال أو لم يصل التأكيد ← تبقى «بانتظار المزامنة» وتُعاد بالمعرّف نفسه (لا تتكرر).
 * - رفضها الخادم فورًا (عملية متصلة) ← تُحذف ويظهر الخطأ للمستخدم كالمعتاد.
 * - رفضها الخادم بعد تنفيذها دون اتصال ← «تحتاج مراجعة» (وتُسجل حالة مراجعة على الخادم).
 */
export async function submit(op: QueuedOp, opts: { tryNow?: boolean } = {}): Promise<SubmitResult> {
  await putOp(op);
  if (opts.tryNow === false) return { state: "queued" };
  const r = await attempt(op, { interactive: !op.offline });
  if (r.state === "rejected") {
    await deleteOp(op.id);
    throw r.error;
  }
  return r;
}

async function attempt(op: QueuedOp, { interactive }: { interactive: boolean }): Promise<SubmitResult | { state: "rejected"; error: SendError }> {
  const triedAt = new Date().toISOString();
  try {
    const result = await send("POST", ENDPOINTS[op.kind], bodyOf(op));
    const done: QueuedOp = { ...op, status: "synced", result, syncedAt: new Date().toISOString(), attempts: op.attempts + 1, lastTriedAt: triedAt, lastError: undefined };
    await putOp(done);
    await patchSnapshot(done);
    return { state: "synced", result };
  } catch (e) {
    const err = e instanceof SendError ? e : new SendError("INTERNAL", "خطأ غير متوقع", 0);
    if (classifyFailure(err.code, err.status) === "retry") {
      // لم يُعرف إن وصلت العملية للخادم: تبقى بانتظار المزامنة وتُعاد بالمعرّف نفسه.
      await putOp({ ...op, status: "pending", attempts: op.attempts + 1, lastTriedAt: triedAt, lastError: err.message });
      return { state: "queued", error: err };
    }
    if (interactive && op.attempts === 0) return { state: "rejected", error: err };
    await putOp({ ...op, status: "review", attempts: op.attempts + 1, lastTriedAt: triedAt, lastError: err.message });
    return { state: "review", message: err.message };
  }
}

async function patchSnapshot(op: QueuedOp) {
  const info = await loadSnapshot(op.userId);
  if (info) await saveSnapshot(applySyncedToSnapshot(info.snapshot, op), info.fetchedAt);
}

const AUTH_CODES = new Set(["UNAUTHENTICATED", "PASSWORD_CHANGE_REQUIRED", "REAUTH_REQUIRED"]);

export type SyncReport = { synced: number; review: number; remaining: number; authNeeded: boolean; offline: boolean };

/**
 * مزامنة كل العمليات غير المتزامنة بالترتيب. تبويب واحد فقط يزامن في الوقت نفسه (Web Locks)،
 * والخادم يمنع التكرار بالمعرّف على أي حال.
 */
export async function syncAll(userId: string): Promise<SyncReport> {
  const run = async (): Promise<SyncReport> => {
    const report: SyncReport = { synced: 0, review: 0, remaining: 0, authNeeded: false, offline: false };
    const ops = (await listOps(userId)).filter(isUnsynced);
    for (const [i, op] of ops.entries()) {
      const r = await attempt(op, { interactive: false });
      if (r.state === "synced") report.synced++;
      else if (r.state === "review") report.review++;
      else {
        // عطل مؤقت: لا فائدة من متابعة البقية الآن.
        report.remaining = ops.length - i;
        const code = r.state === "queued" ? r.error?.code : undefined;
        if (code && AUTH_CODES.has(code)) report.authNeeded = true;
        else report.offline = true;
        break;
      }
    }
    if (report.synced) await refreshSnapshot().catch(() => {});
    return report;
  };
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("gas-offline-sync", run);
  return run();
}

/** الخروج: تُحذف اللقطة دائمًا. العمليات غير المتزامنة لا تُحذف (لها أثر فعلي) وتُرسل عند دخول المستخدم نفسه. */
export async function onLogout(userId: string) {
  await clearSnapshot();
  const left = (await listOps(userId)).filter(isUnsynced).length + (await foreignUnsyncedCount(userId));
  if (!left) {
    const recs = await tx<OpRecord[]>("ops", "readonly", (s) => s.getAll());
    for (const r of recs) await tx("ops", "readwrite", (s) => s.delete(r.id));
    await kvDel("key");
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.controller?.postMessage({ type: "clear" });
  notify();
}

// ---------------------------------------------------------------------------
// إشعار الواجهات (والتبويبات الأخرى) بتغير القائمة
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
function notify() {
  for (const l of listeners) l();
  channel?.postMessage("changed");
}
export function subscribe(fn: () => void) {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("gas-offline");
    channel.onmessage = () => listeners.forEach((l) => l());
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
