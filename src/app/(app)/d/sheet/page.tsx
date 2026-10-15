import Link from "next/link";
import { Suspense } from "react";
import { Upload } from "lucide-react";
import { requirePageActor } from "@/server/http/context";
import { PageHeader, buttonClass } from "@/components/ui";
import { SheetView } from "./sheet-view";

export const metadata = { title: "الكشف" };

export default async function SheetPage() {
  await requirePageActor({ role: "DISTRIBUTOR" });
  return (
    <div>
      <PageHeader title="الكشف" actions={<Link href="/d/statements" className={buttonClass("secondary", "sm")}><Upload className="size-4" /> الكشوفات</Link>} />
      <Suspense>
        <SheetView />
      </Suspense>
    </div>
  );
}
