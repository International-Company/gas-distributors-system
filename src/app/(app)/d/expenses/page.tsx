import { redirect } from "next/navigation";

/** صارت تبويبًا في صفحة «الفلوس»؛ الروابط القديمة تُحوَّل إليه مع فلاترها. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries({ ...sp, tab: "expenses" }).filter((e): e is [string, string] => Boolean(e[1])));
  redirect(`/d/finance?${q}`);
}
