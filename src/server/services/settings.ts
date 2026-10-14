import { z } from "zod";
import type { Tx } from "../db";
import { withSystem } from "../db";
import { type Actor, assertAdmin } from "../actor";
import { audit } from "../audit";
import { AppError } from "../errors";
import { ALL_NAV, NAV_LOCKED, type NavOverrides } from "@/lib/nav";

/** أنواع الملفات التي يدعمها النظام؛ يختار المدير منها المسموح. */
export const SUPPORTED_FILE_TYPES = ["pdf", "xlsx", "jpg", "jpeg", "png", "webp"] as const;
/** حد صارم لحجم الملف بغض النظر عن الإعداد. */
export const HARD_MAX_UPLOAD_MB = 50;

export async function getSettings(tx: Tx) {
  // الشعار لا يُحمّل هنا (يُقرأ في كل تحقق من جلسة)؛ يُخدم من مساره الخاص.
  const s = await tx.systemSettings.findUnique({ where: { id: 1 }, omit: { logoData: true } });
  if (!s) throw new Error("صف الإعدادات غير موجود؛ شغّل الترحيلات");
  return s;
}

/** الإعدادات العامة التي تظهر لكل الزوار (اسم النظام وبيانات التواصل). */
export function getPublicSettings() {
  return withSystem(async (tx) => {
    const s = await getSettings(tx);
    return {
      logoUrl: s.logoMime ? `/api/v1/settings/logo?v=${s.updatedAt.getTime()}` : null,
      navOverrides: (s.navOverrides ?? {}) as NavOverrides,
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
  allowedFileTypes: z
    .array(z.enum(SUPPORTED_FILE_TYPES))
    .min(1, "اختر نوع ملف واحدًا على الأقل")
    .transform((xs) => [...new Set(xs)])
    .optional(),
  maxUploadMb: z.coerce.number().int().min(1, "الحد الأدنى 1 ميغابايت").max(HARD_MAX_UPLOAD_MB, `الحد الأقصى ${HARD_MAX_UPLOAD_MB} ميغابايت`).optional(),
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

// ---------------------------------------------------------------------------
// القائمة الجانبية
// ---------------------------------------------------------------------------

const navSchema = z.record(
  z.string(),
  z.object({
    label: z.string().trim().max(40, "الاسم طويل").optional(),
    order: z.coerce.number().int().min(0).max(999).optional(),
    hidden: z.boolean().optional(),
  }),
);

/** تعديل أسماء أقسام القائمة وترتيبها. لا يمكن إخفاء الأقسام الأساسية. */
export async function updateNavOverrides(actor: Actor, input: unknown) {
  assertAdmin(actor, "settings.manage");
  const v = navSchema.parse(input);
  const known = new Set(ALL_NAV.map((n) => n.href));
  for (const [href, o] of Object.entries(v)) {
    if (!known.has(href)) throw new AppError("VALIDATION", `قسم غير معروف: ${href}`);
    if (o.hidden && NAV_LOCKED.has(href)) throw new AppError("VALIDATION", "لا يمكن إخفاء هذا القسم الأساسي");
    if (o.label !== undefined && o.label !== "" && o.label.length < 2) throw new AppError("VALIDATION", "اسم القسم قصير");
  }
  return withSystem(async (tx) => {
    const before = await getSettings(tx);
    await tx.systemSettings.update({ where: { id: 1 }, data: { navOverrides: v as object, updatedById: actor.userId } });
    await audit(tx, actor, { action: "settings.nav", entityType: "settings", entityId: "1", before: before.navOverrides, after: v });
  });
}

// ---------------------------------------------------------------------------
// الشعار
// ---------------------------------------------------------------------------

const LOGO_MAX_BYTES = 512 * 1024;

/** يتحقق من نوع الصورة من محتواها (لا من اسمها). SVG غير مسموح لأنه قد يحمل شيفرة. */
function sniffImage(buf: Buffer): string | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function setLogo(actor: Actor, data: Buffer | null) {
  assertAdmin(actor, "settings.manage");
  let mime: string | null = null;
  if (data) {
    if (data.length > LOGO_MAX_BYTES) throw new AppError("VALIDATION", "حجم الشعار يتجاوز 512 كيلوبايت");
    mime = sniffImage(data);
    if (!mime) throw new AppError("VALIDATION", "الشعار يجب أن يكون صورة PNG أو JPEG أو WebP");
  }
  return withSystem(async (tx) => {
    await tx.systemSettings.update({ where: { id: 1 }, data: { logoData: data ? new Uint8Array(data) : null, logoMime: mime, updatedById: actor.userId } });
    await audit(tx, actor, { action: data ? "settings.logo_set" : "settings.logo_removed", entityType: "settings", entityId: "1", after: data ? { mime, size: data.length } : null });
  });
}

export function getLogo() {
  return withSystem((tx) => tx.systemSettings.findUnique({ where: { id: 1 }, select: { logoData: true, logoMime: true } }));
}

/** فحص ملف مرفوع وفق إعدادات الملفات (النوع من الامتداد، والحجم). */
export async function assertUploadAllowed(name: string, size: number, allowedHere: readonly string[]) {
  const s = await withSystem(getSettings);
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const allowed = s.allowedFileTypes.filter((t) => allowedHere.includes(t));
  if (!allowed.includes(ext)) {
    throw new AppError("VALIDATION", `نوع الملف غير مسموح. المسموح هنا: ${allowed.join("، ") || "لا شيء (راجع إعدادات الملفات)"}`);
  }
  const max = Math.min(s.maxUploadMb, HARD_MAX_UPLOAD_MB);
  if (size > max * 1024 * 1024) throw new AppError("VALIDATION", `حجم الملف يتجاوز الحد المسموح (${max} ميغابايت)`);
}
