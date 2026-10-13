import { requirePageActor } from "@/server/http/context";
import { listCategories } from "@/server/services/categories";
import { PageHeader } from "@/components/ui";
import { DistributorForm } from "../distributor-form";

export const metadata = { title: "حساب موزّع جديد" };

export default async function NewDistributorPage() {
  const actor = await requirePageActor({ role: "ADMIN", permission: "distributors.manage" });
  const categories = await listCategories(actor);
  return (
    <div className="max-w-2xl">
      <PageHeader title="حساب موزّع جديد" description="سيُطلب من الموزّع تغيير كلمة المرور عند أول دخول." />
      <DistributorForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
