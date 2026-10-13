import { requirePageActor } from "@/server/http/context";
import { hasPermission } from "@/server/actor";
import { listCategories } from "@/server/services/categories";
import { PageHeader } from "@/components/ui";
import { CategoriesManager } from "./manager";

export const metadata = { title: "التصنيفات" };

export default async function CategoriesPage() {
  const actor = await requirePageActor({ role: "ADMIN", permission: "distributors.view" });
  const rows = await listCategories(actor);
  return (
    <div className="max-w-2xl">
      <PageHeader title="تصنيفات الموزّعين" description="تصنيفات مخصصة لتنظيم الحسابات وتصفيتها." />
      <CategoriesManager
        rows={rows.map((c) => ({ id: c.id, name: c.name, count: c._count.distributors }))}
        canManage={hasPermission(actor, "categories.manage")}
      />
    </div>
  );
}
