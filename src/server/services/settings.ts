import { z } from "zod";
import type { Tx } from "../db";
import { withSystem } from "../db";
import { type Actor, assertAdmin } from "../actor";
import { audit } from "../audit";

export async function getSettings(tx: Tx) {
  const s = await tx.systemSettings.findUnique({ where: { id: 1 } });
  if (!s) throw new Error("صف الإعدادات غير موجود؛ شغّل الترحيلات");
  return s;
}

/** الإعدادات العامة التي تظهر لكل الزوار (اسم النظام وبيانات التواصل). */
export function getPublicSettings() {
  return withSystem(async (tx) => {
    const s = await getSettings(tx);
    return {
      systemName: s.systemName,
      contactPhone: s.contactPhone,
      contactEmail: s.contactEmail,
      contactAddress: s.contactAddress,
      currencyCode: s.currencyCode,
      currencySymbol: s.currencySymbol,
    };
  });
}

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const settingsSchema = z.object({
  systemName: z.string().trim().min(2, "اسم النظام قصير").max(100),
  contactPhone: optionalText(30),
  contactEmail: z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "بريد إلكتروني غير صالح"),
  contactAddress: optionalText(200),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "رمز العملة من 3 أحرف لاتينية"),
  currencySymbol: z.string().trim().min(1).max(5),
  sessionIdleMinutes: z.coerce.number().int().min(5, "الحد الأدنى 5 دقائق").max(1440, "الحد الأقصى 1440 دقيقة"),
  maxFailedLogins: z.coerce.number().int().min(3, "الحد الأدنى 3").max(20, "الحد الأقصى 20"),
  lockoutMinutes: z.coerce.number().int().min(1).max(1440),
});

export async function updateSettings(actor: Actor, input: unknown) {
  assertAdmin(actor, "settings.manage");
  const data = settingsSchema.parse(input);
  return withSystem(async (tx) => {
    const before = await getSettings(tx);
    const after = await tx.systemSettings.update({ where: { id: 1 }, data: { ...data, updatedById: actor.userId } });
    // تغيير العملة لا يغيّر قيم العمليات التاريخية: كل عملية مالية ستخزن عملتها وقت تنفيذها.
    await audit(tx, actor, { action: "settings.update", entityType: "settings", entityId: "1", before, after });
    return after;
  });
}
