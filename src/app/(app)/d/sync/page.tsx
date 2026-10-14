import { requirePageActor } from "@/server/http/context";
import { PageHeader } from "@/components/ui";
import { SyncCenter } from "./sync-center";

export const metadata = { title: "شغل بدون نت" };

export default async function SyncPage() {
  await requirePageActor({ role: "DISTRIBUTOR" });
  return (
    <div className="space-y-6">
      <PageHeader
        title="شغل بدون نت"
      />
      <SyncCenter />
    </div>
  );
}
