import { redirect } from "next/navigation";

/** المخزن صار جزءًا من صفحة «الجرار»، وسجل الحركة صار تقرير «حركة الجرار». */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries({ from: sp.from, to: sp.to, type: sp.type }).filter((e): e is [string, string] => Boolean(e[1])));
  redirect(q.size ? `/d/reports/movements?${q}` : "/d/cylinders");
}
