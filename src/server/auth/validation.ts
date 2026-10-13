import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "اسم المستخدم من 3 إلى 32 حرفًا لاتينيًا أو أرقامًا أو . _ -");

export const passwordSchema = z
  .string()
  .min(8, "كلمة المرور 8 أحرف على الأقل")
  .max(128, "كلمة المرور طويلة جدًا")
  .refine((p) => /\d/.test(p) && /[^\d]/.test(p), "يجب أن تحتوي كلمة المرور على أرقام وحروف");

export const pinSchema = z.string().regex(/^\d{4,8}$/, "PIN من 4 إلى 8 أرقام");
