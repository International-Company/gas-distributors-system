import { requirePageActor } from "@/server/http/context";
import { PageHeader } from "@/components/ui";
import { Counter } from "./counter";

export const metadata = { title: "التوزيع" };

export default async function CounterPage() {
  await requirePageActor({ role: "DISTRIBUTOR" });
  return (
    <div className="space-y-6">
      <PageHeader title="التوزيع" />
      <Counter />
    </div>
  );
}
