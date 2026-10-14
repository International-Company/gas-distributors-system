import { normalizeDigits } from "./arabic";

/**
 * رقم الهوية الفلسطيني: 9 أرقام آخرها رقم تحقق (خوارزمية Luhn).
 * التحقق يكشف معظم أخطاء الإدخال والقراءة الضوئية (رقم خاطئ أو رقمان متبادلان).
 */
export function isValidNationalId(id: string): boolean {
  if (!/^\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * (i % 2 === 0 ? 1 : 2);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

/** يوحّد رقم الهوية: أرقام لاتينية فقط، ويكمل بأصفار بادئة إن كان أقصر (فقدان الأصفار في Excel). */
export function normalizeNationalId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = normalizeDigits(String(raw)).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length < 9 && digits.length >= 7) return digits.padStart(9, "0");
  return digits;
}

/** يستخرج أرقام هوية محتملة صالحة من نص (نتيجة قراءة ضوئية مثلًا). */
export function extractNationalIds(text: string): string[] {
  const t = normalizeDigits(text);
  const found = new Set<string>();
  // تسلسلات من 9 أرقام قد تتخللها مسافات أو شرطات.
  for (const m of t.matchAll(/(?:\d[\s-]?){9}/g)) {
    const id = m[0].replace(/\D/g, "");
    if (isValidNationalId(id)) found.add(id);
  }
  return [...found];
}
