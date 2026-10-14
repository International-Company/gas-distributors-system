import { z } from "zod";
import { withSystem } from "../db";
import { AppError, notFound } from "../errors";
import { type Actor, assertAdmin } from "../actor";
import { audit } from "../audit";

const nameSchema = z.object({ name: z.string().trim().min(2, "اسم المجموعة قصير").max(60, "اسم المجموعة طويل") });

export async function listCategories(actor: Actor) {
  assertAdmin(actor, "distributors.view");
  return withSystem((tx) =>
    tx.distributorCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { distributors: true } } } }),
  );
}

export async function createCategory(actor: Actor, input: unknown) {
  assertAdmin(actor, "categories.manage");
  const { name } = nameSchema.parse(input);
  return withSystem(async (tx) => {
    if (await tx.distributorCategory.findUnique({ where: { name } })) {
      throw new AppError("CONFLICT", "المجموعة موجودة مسبقًا", { name: "المجموعة موجودة مسبقًا" });
    }
    const c = await tx.distributorCategory.create({ data: { name } });
    await audit(tx, actor, { action: "category.create", entityType: "category", entityId: c.id, after: c });
    return c;
  });
}

export async function renameCategory(actor: Actor, id: string, input: unknown) {
  assertAdmin(actor, "categories.manage");
  const { name } = nameSchema.parse(input);
  return withSystem(async (tx) => {
    const before = await tx.distributorCategory.findUnique({ where: { id } });
    if (!before) throw notFound("المجموعة");
    const dup = await tx.distributorCategory.findUnique({ where: { name } });
    if (dup && dup.id !== id) throw new AppError("CONFLICT", "المجموعة موجودة مسبقًا", { name: "المجموعة موجودة مسبقًا" });
    const after = await tx.distributorCategory.update({ where: { id }, data: { name } });
    await audit(tx, actor, { action: "category.rename", entityType: "category", entityId: id, before, after });
    return after;
  });
}

/** الحذف مسموح فقط لتصنيف غير مستخدم، حتى لا تفقد الحسابات تصنيفها بصمت. */
export async function deleteCategory(actor: Actor, id: string) {
  assertAdmin(actor, "categories.manage");
  return withSystem(async (tx) => {
    const c = await tx.distributorCategory.findUnique({ where: { id }, include: { _count: { select: { distributors: true } } } });
    if (!c) throw notFound("المجموعة");
    if (c._count.distributors > 0) throw new AppError("INVALID_STATE", "لا يمكن حذف مجموعة مرتبطة بحسابات موزّعين");
    await tx.distributorCategory.delete({ where: { id } });
    await audit(tx, actor, { action: "category.delete", entityType: "category", entityId: id, before: c });
  });
}
