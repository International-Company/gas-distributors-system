import Link from "next/link";

export const metadata = { title: "غير مسموح" };

export default function Forbidden() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-bold">لا تملك صلاحية الوصول إلى هذه الصفحة</h1>
      <p className="text-sm text-muted">إن كنت تحتاج هذه الصلاحية، تواصل مع مدير النظام.</p>
      <Link href="/" className="text-sm font-medium text-primary hover:underline">
        العودة للصفحة الرئيسية
      </Link>
    </div>
  );
}
