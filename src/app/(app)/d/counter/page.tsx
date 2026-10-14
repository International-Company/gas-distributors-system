import { requirePageActor } from "@/server/http/context";
import { PageHeader } from "@/components/ui";
import { Counter } from "./counter";

export const metadata = { title: "الشباك" };

export default async function CounterPage() {
  await requirePageActor({ role: "DISTRIBUTOR" });
  return (
    <div className="space-y-6">
      <PageHeader title="الشباك" />
      <Counter />
    </div>
  );
}
