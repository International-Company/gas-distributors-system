// أدوات توحيد النص العربي للمطابقة والبحث.

/** يحوّل الأرقام العربية الهندية والفارسية إلى لاتينية. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * توحيد الاسم للمطابقة: أشكال العرض (من ملفات PDF) إلى الحروف الأساسية، حذف التشكيل والتطويل،
 * توحيد الألف والياء والتاء المربوطة، ومسافات مفردة.
 * لا يُستخدم للعرض؛ الاسم الأصلي يُحفظ كما ورد.
 */
export function normalizeName(s: string): string {
  return normalizeDigits(s.normalize("NFKC"))
    .replace(/[ً-ٰٟۖ-ۭ]/g, "") // التشكيل
    .replace(/ـ/g, "") // التطويل
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ ← ا
    .replace(/ى/g, "ي") // ى ← ي
    .replace(/ة/g, "ه") // ة ← ه
    .replace(/[​-‏‪-‮⁦-⁩]/g, "") // علامات الاتجاه
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * تشابه اسمين موحّدين (معامل Dice على ثنائيات الحروف): 1 = متطابقان.
 * يُحسب في الكود لا في قاعدة البيانات، لأن pg_trgm يتجاهل الحروف العربية في بعض إعدادات اللغة.
 */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const grams = (s: string) => {
    const t = ` ${s} `;
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of ga) {
    inter += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

/** نص عام منظف للعرض والحفظ (دون تغيير الحروف). */
export function cleanText(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** توحيد رقم الهاتف: أرقام فقط مع إبقاء + في البداية. */
export function normalizePhone(s: unknown): string | null {
  const t = normalizeDigits(cleanText(s)).replace(/[^\d+]/g, "");
  if (!t) return null;
  return t.startsWith("+") ? "+" + t.slice(1).replace(/\+/g, "") : t.replace(/\+/g, "");
}

/** يستخرج الأرقام من نص (مع تحويل الأرقام العربية). */
export function digitsOnly(s: unknown): string {
  return normalizeDigits(cleanText(s)).replace(/\D/g, "");
}
