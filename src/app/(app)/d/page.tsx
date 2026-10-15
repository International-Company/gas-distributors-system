import { redirect } from "next/navigation";
import { requirePageActor } from "@/server/http/context";

/** رئيسية الموزّع هي «الكشف» (الواجهة المبسّطة). */
export default async function DistributorHome() {
  await requirePageActor({ role: "DISTRIBUTOR" });
  redirect("/d/sheet");
}
