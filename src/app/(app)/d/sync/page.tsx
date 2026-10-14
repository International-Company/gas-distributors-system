import { requirePageActor } from "@/server/http/context";
import { PageHeader } from "@/components/ui";
import { SyncCenter } from "./sync-center";

export const metadata = { title: "المزامنة" };

export default async function SyncPage() {
  await requirePageActor({ role: "DISTRIBUTOR" });
  return (
    <div className="space-y-6">
      <PageHeader
        title="المزامنة والعمل دون اتصال"
        description="عمليات الشباك المحفوظة على هذا الجهاز وحالتها. لا تُعد العملية منجزة قبل أن يؤكدها الخادم."
      />
      <SyncCenter />
    </div>
  );
}
