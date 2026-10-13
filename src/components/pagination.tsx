import Link from "next/link";
import { buttonClass } from "./ui";

export function Pagination({ page, total, pageSize, base, params }: { page: number; total: number; pageSize: number; base: string; params: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => `${base}?${new URLSearchParams({ ...params, page: String(p) })}`;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted">صفحة {page} من {pages} · {total} سجل</span>
      <div className="flex gap-2">
        {page > 1 && <Link className={buttonClass("secondary", "sm")} href={href(page - 1)}>السابق</Link>}
        {page < pages && <Link className={buttonClass("secondary", "sm")} href={href(page + 1)}>التالي</Link>}
      </div>
    </div>
  );
}
