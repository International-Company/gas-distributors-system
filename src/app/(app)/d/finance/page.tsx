import { requirePageActor } from "@/server/http/context";
import { PageHeader } from "@/components/ui";
import { Tabs } from "@/components/tabs";
import { SummarySection } from "./summary";
import { CollectionsSection } from "./collections";
import { ExpensesSection } from "./expenses";

export const metadata = { title: "الفلوس" };

const TABS = [
  { key: "summary", label: "الملخص" },
  { key: "collections", label: "المقبوض" },
  { key: "expenses", label: "المصاريف" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** صفحة الفلوس: الملخص (الغلّة) والمقبوض والمصاريف في تبويبات. */
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "summary";
  return (
    <div className="space-y-5">
      <PageHeader title="الفلوس" />
      <Tabs items={TABS.map((t) => ({ href: t.key === "summary" ? "/d/finance" : `/d/finance?tab=${t.key}`, label: t.label, active: t.key === tab }))} />
      {tab === "summary" && <SummarySection actor={actor} sp={sp} />}
      {tab === "collections" && <CollectionsSection actor={actor} sp={sp} />}
      {tab === "expenses" && <ExpensesSection actor={actor} sp={sp} />}
    </div>
  );
}
