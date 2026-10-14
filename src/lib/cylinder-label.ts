import { cleanText, normalizeDigits } from "./arabic";

/** رقم الجرة: رقم المواطن، مع لاحقة إذا كان للاستحقاق أكثر من جرة («100-2»). مشترك بين الخادم والجهاز. */
export function cylinderLabel(citizenNumber: string, quantity: number, seq: number) {
  return quantity === 1 && seq === 1 ? citizenNumber : `${citizenNumber}-${seq}`;
}

/** توحيد الرقم المكتوب على الجرة كما يدخله المستخدم: أرقام لاتينية، دون مسافات، وشرطة موحدة. */
export const normalizeLabel = (s: string) => normalizeDigits(cleanText(s)).replace(/\s/g, "").replace(/[\u2010-\u2015_]/g, "-");
