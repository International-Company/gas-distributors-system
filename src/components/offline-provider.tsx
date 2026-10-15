"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloudOff, Download, RefreshCw, TriangleAlert } from "lucide-react";
import { listOps, loadSnapshot, refreshSnapshot, subscribe, syncAll, type SnapshotInfo, type SyncReport } from "@/lib/offline/engine";
import { isUnsynced, type QueuedOp } from "@/lib/offline/logic";

type Ctx = {
  enabled: boolean;
  userId: string;
  online: boolean;
  ops: QueuedOp[];
  unsynced: number;
  review: number;
  snapshot: SnapshotInfo | null;
  syncing: boolean;
  lastReport: SyncReport | null;
  authNeeded: boolean;
  sync: () => Promise<SyncReport | null>;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
  installPrompt: (() => Promise<void>) | null;
};

const OfflineContext = createContext<Ctx | null>(null);
export const useOffline = () => useContext(OfflineContext);

const SNAPSHOT_EVERY_MS = 5 * 60_000;
const SYNC_EVERY_MS = 30_000;

type InstallEvent = Event & { prompt: () => Promise<void> };

/**
 * حالة العمل دون اتصال للموزّع: تسجيل عامل الخدمة، والمزامنة التلقائية عند عودة الاتصال،
 * وتحديث بيانات الجهاز دوريًا. لا يُعلن نجاح أي عملية قبل تأكيد الخادم.
 */
export function OfflineProvider({ userId, enabled, children }: { userId: string; enabled: boolean; children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const [o, s] = await Promise.all([listOps(userId), loadSnapshot(userId)]);
      setOps(o);
      setSnapshot(s);
    } catch {
      // IndexedDB غير متاح (تصفح خاص مثلًا): يعمل النظام متصلًا فقط.
    }
  }, [enabled, userId]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      await refreshSnapshot();
      setOnline(true);
    } catch {
      // يبقى على اللقطة الحالية
    }
    await reload();
  }, [enabled, reload]);

  const sync = useCallback(async () => {
    if (!enabled || busy.current) return null;
    busy.current = true;
    setSyncing(true);
    try {
      const r = await syncAll(userId);
      setLastReport(r);
      setOnline(!r.offline);
      return r;
    } catch {
      return null;
    } finally {
      busy.current = false;
      setSyncing(false);
      await reload();
    }
  }, [enabled, userId, reload]);

  // عامل الخدمة: يُسجل للجميع (صفحة «لا يوجد اتصال»)، وتجهيز صفحات الشباك للموزّع فقط.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (enabled) reg.active?.postMessage({ type: "warm" });
    }).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setOnline(navigator.onLine);
    reload().then(async () => {
      if (!navigator.onLine) return;
      const s = await loadSnapshot(userId).catch(() => null);
      if (!s || Date.now() - new Date(s.fetchedAt).getTime() > SNAPSHOT_EVERY_MS) await refresh();
      await sync();
    });
    const up = () => {
      setOnline(true);
      sync().then(() => refresh());
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const unsub = subscribe(() => void reload());
    const t1 = setInterval(() => {
      if (navigator.onLine) void sync();
    }, SYNC_EVERY_MS);
    const t2 = setInterval(() => {
      if (navigator.onLine) void refresh();
    }, SNAPSHOT_EVERY_MS);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      unsub();
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [enabled, userId, reload, refresh, sync]);

  const value = useMemo<Ctx>(() => ({
    enabled,
    userId,
    online,
    ops,
    unsynced: ops.filter(isUnsynced).length,
    review: ops.filter((o) => o.status === "review" && !o.dismissed).length,
    snapshot,
    syncing,
    lastReport,
    authNeeded: Boolean(lastReport?.authNeeded),
    sync,
    refresh,
    reload,
    installPrompt: install
      ? async () => {
          await install.prompt();
          setInstall(null);
        }
      : null,
  }), [enabled, userId, online, ops, snapshot, syncing, lastReport, sync, refresh, reload, install]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

/** مؤشر في رأس الصفحة: الاتصال، والعمليات بانتظار المزامنة، وما يحتاج مراجعة. */
export function OfflineIndicator() {
  const o = useOffline();
  if (!o?.enabled) return null;
  const chip = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium";
  return (
    <div className="flex items-center gap-1.5">
      {!o.online && (
        <Link href="/d/sync" className={`${chip} bg-danger-soft text-danger`} role="status">
          <CloudOff className="size-3.5" /> دون اتصال
        </Link>
      )}
      {o.unsynced > 0 && (
        <Link href="/d/sync" className={`${chip} bg-warning-soft text-warning`}>
          <RefreshCw className={`size-3.5 ${o.syncing ? "animate-spin" : ""}`} /> {o.unsynced} بانتظار الإرسال
        </Link>
      )}
      {o.review > 0 && (
        <Link href="/d/sync" className={`${chip} bg-danger-soft text-danger`}>
          <TriangleAlert className="size-3.5" /> {o.review} بدها مراجعة
        </Link>
      )}
      {o.installPrompt && (
        <button onClick={o.installPrompt} className={`${chip} bg-primary-soft text-primary`}>
          <Download className="size-3.5" /> تثبيت التطبيق
        </button>
      )}
    </div>
  );
}
