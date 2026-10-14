import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = { title: "لا يوجد اتصال" };

/** تُعرض عند فتح صفحة تحتاج اتصالًا أثناء الانقطاع. */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        <WifiOff className="mx-auto mb-3 size-10 text-muted" />
        <h1 className="mb-2 text-lg font-bold">لا يوجد اتصال بالإنترنت</h1>
        <p className="mb-4 text-sm text-muted">
          هذه الصفحة تحتاج اتصالًا. يعمل دون اتصال: الشباك (الاستلام والتسليم والتحصيل حسب إعدادات النظام) وقائمة المزامنة.
        </p>
        <div className="flex justify-center gap-3 text-sm">
          <Link href="/d/counter" className="text-primary hover:underline">الشباك</Link>
          <Link href="/d/sync" className="text-primary hover:underline">المزامنة</Link>
        </div>
      </div>
    </div>
  );
}
