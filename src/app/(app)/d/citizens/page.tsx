import { requirePageActor } from "@/server/http/context";
import { countArchivable } from "@/server/services/citizens";
import { PageHeader } from "@/components/ui";
import { CitizenSearch } from "./search";
import { ArchiveEnded } from "./archive-ended";

export const metadata = { title: "المواطنون" };

export default async function CitizensPage() {
  const actor = await requirePageActor({ role: "DISTRIBUTOR" });
  const archivable = await countArchivable(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="المواطنون" description="ابحث بالاسم أو رقم الهوية أو الهاتف أو رقم المواطن في الكشف، أو صوّر بطاقة الهوية." />
      <CitizenSearch />
      {archivable > 0 && <ArchiveEnded count={archivable} />}
    </div>
  );
}
