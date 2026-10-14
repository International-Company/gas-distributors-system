import { cleanText, digitsOnly, normalizeDigits, normalizeName, normalizePhone } from "@/lib/arabic";
import { isValidNationalId, normalizeNationalId } from "@/lib/national-id";

/** جدول خام: صفوف × خلايا نصية، كما استُخرج من الملف. */
export type RawTable = string[][];

export const FIELDS = ["nationalId", "fullName", "citizenNumber", "quantity", "amount", "phone"] as const;
export type Field = (typeof FIELDS)[number];
export type ColumnMapping = Partial<Record<Field, number | null>>;

export const FIELD_LABELS: Record<Field, string> = {
  nationalId: "رقم الهوية",
  fullName: "الاسم",
  citizenNumber: "رقم المواطن في الكشف",
  quantity: "عدد الجرار",
  amount: "المبلغ",
  phone: "رقم الهاتف",
};

/** حقول لا يُعتمد كشف دونها. */
export const REQUIRED_FIELDS: Field[] = ["nationalId", "fullName", "citizenNumber"];

// كلمات عناوين الأعمدة المتوقعة (بعد التوحيد). تُضبط عند وصول نماذج كشوف الهيئة الفعلية.
const HEADER_KEYWORDS: Record<Field, string[]> = {
  nationalId: ["رقم الهويه", "الهويه", "رقم الهوية", "هويه", "id", "رقم البطاقه"],
  fullName: ["الاسم", "اسم المواطن", "الاسم رباعي", "الاسم الرباعي", "اسم المستفيد", "name"],
  citizenNumber: ["رقم المواطن", "رقم المستفيد", "رقم الدور", "رقم الكوبون", "رقم الجره", "المواطن", "المستفيد"],
  quantity: ["عدد الجرار", "الكميه", "عدد", "الجرار", "كميه"],
  amount: ["المبلغ", "القيمه", "المبلغ المطلوب", "السعر", "المستحق"],
  phone: ["الجوال", "رقم الجوال", "الهاتف", "رقم الهاتف", "جوال", "phone", "mobile"],
};

// عناوين ضعيفة: عمود «م» غالبًا تسلسل الصف لا رقم المواطن، فلا يُختار إلا عند غياب عنوان أوضح.
const WEAK_KEYWORDS: Partial<Record<Field, string[]>> = {
  // في كشوف الهيئة الفعلية (نظام توزيع الغاز) يرد رقم المواطن في عمود «المتسلسل».
  citizenNumber: ["م", "مسلسل", "التسلسل", "المتسلسل", "متسلسل", "الرقم التسلسلي"],
};

function headerScore(cell: string, field: Field): number {
  const n = normalizeName(cell);
  if (!n) return 0;
  let best = 0;
  if (WEAK_KEYWORDS[field]?.some((k) => normalizeName(k) === n)) best = 1;
  for (const kw of HEADER_KEYWORDS[field]) {
    const k = normalizeName(kw);
    if (n === k) best = Math.max(best, 3);
    else if (k.length > 1 && n.includes(k)) best = Math.max(best, 2);
  }
  return best;
}

/** يبحث عن صف العناوين ضمن أول الصفوف ويقترح ربط الأعمدة. */
export function detectMapping(table: RawTable): { headerRow: number | null; mapping: ColumnMapping } {
  let best: { row: number; score: number; mapping: ColumnMapping } | null = null;
  const limit = Math.min(table.length, 25);
  for (let r = 0; r < limit; r++) {
    const row = table[r];
    const mapping: ColumnMapping = {};
    let score = 0;
    const used = new Set<number>();
    // الحقول الأكثر تحديدًا أولًا حتى لا يلتقط «م» عمود رقم المواطن عن غيره.
    for (const f of ["nationalId", "phone", "fullName", "quantity", "amount", "citizenNumber"] as Field[]) {
      let bestCol = -1;
      let bestScore = 0;
      row.forEach((cell, c) => {
        if (used.has(c)) return;
        const s = headerScore(cell, f);
        if (s > bestScore) [bestScore, bestCol] = [s, c];
      });
      if (bestCol >= 0) {
        mapping[f] = bestCol;
        used.add(bestCol);
        score += bestScore;
      }
    }
    if (mapping.nationalId !== undefined && mapping.fullName !== undefined && (!best || score > best.score)) {
      best = { row: r, score, mapping };
    }
  }
  if (best) return { headerRow: best.row, mapping: best.mapping };
  return { headerRow: null, mapping: detectByContent(table) };
}

/** عند غياب صف العناوين: يستنتج عمودي الهوية والاسم من المحتوى. */
function detectByContent(table: RawTable): ColumnMapping {
  const cols = Math.max(0, ...table.map((r) => r.length));
  const mapping: ColumnMapping = {};
  let bestId = { col: -1, ratio: 0 };
  let bestName = { col: -1, ratio: 0 };
  for (let c = 0; c < cols; c++) {
    const values = table.map((r) => cleanText(r[c])).filter(Boolean);
    if (!values.length) continue;
    const idRatio = values.filter((v) => isValidNationalId(normalizeNationalId(v) ?? "")).length / values.length;
    const nameRatio = values.filter((v) => /[\u0600-\u06FF]{2,}.*\s.*[\u0600-\u06FF]{2,}/.test(v)).length / values.length;
    if (idRatio > bestId.ratio) bestId = { col: c, ratio: idRatio };
    if (nameRatio > bestName.ratio) bestName = { col: c, ratio: nameRatio };
  }
  if (bestId.ratio >= 0.5) mapping.nationalId = bestId.col;
  if (bestName.ratio >= 0.5 && bestName.col !== bestId.col) mapping.fullName = bestName.col;
  return mapping;
}

export type RowIssue = { field?: Field; code: string; message: string; severity: "WARNING" | "ERROR" };

export type ParsedRow = {
  rowIndex: number; // رقم الصف في الملف (يبدأ من 1)
  nationalId: string | null;
  fullName: string | null;
  phone: string | null;
  citizenNumber: string | null;
  quantity: number | null;
  amount: string | null; // نص عشري للحفاظ على الدقة
  issues: RowIssue[];
};

const SUMMARY_WORDS = /(^|\s)(المجموع|مجموع|الاجمالي|اجمالي|المجموع الكلي)(\s|$)/;

const cell = (row: string[], col: number | null | undefined) => (col === null || col === undefined ? "" : cleanText(row[col]));

function isRepeatedHeader(row: string[], mapping: ColumnMapping) {
  return (
    (mapping.nationalId != null && headerScore(cell(row, mapping.nationalId), "nationalId") >= 2) ||
    (mapping.fullName != null && headerScore(cell(row, mapping.fullName), "fullName") >= 3)
  );
}

function parseAmount(raw: string): string | null | "invalid" {
  if (!raw) return null;
  const t = digitsOnlyKeepDot(raw);
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "invalid";
  return t;
}

function digitsOnlyKeepDot(raw: string) {
  return cleanText(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/g, ".")
    .replace(/[^\d.]/g, "");
}

/** يطبق ربط الأعمدة ويتحقق من كل صف ومن التكرار داخل الملف. */
export function applyMapping(table: RawTable, headerRow: number | null, mapping: ColumnMapping): ParsedRow[] {
  const start = headerRow === null ? 0 : headerRow + 1;
  const rows: ParsedRow[] = [];
  for (let r = start; r < table.length; r++) {
    const row = table[r];
    if (!row || row.every((c) => !cleanText(c))) continue;
    if (isRepeatedHeader(row, mapping)) continue;

    const rawId = cell(row, mapping.nationalId);
    const rawName = cell(row, mapping.fullName);
    // صفوف لا تحمل هوية ولا اسمًا (عناوين فرعية)، وصفوف المجاميع، ليست بيانات.
    if (!digitsOnly(rawId) && !/[\u0600-\u06FFa-zA-Z]/.test(rawName)) continue;
    if (!digitsOnly(rawId) && SUMMARY_WORDS.test(normalizeName(row.join(" ")))) continue;

    const issues: RowIssue[] = [];
    const nationalId = normalizeNationalId(rawId);
    if (!nationalId) issues.push({ field: "nationalId", code: "ID_MISSING", message: "رقم الهوية مفقود", severity: "ERROR" });
    else if (!isValidNationalId(nationalId)) {
      issues.push({ field: "nationalId", code: "ID_INVALID", message: "رقم الهوية غير صالح (فشل رقم التحقق)", severity: "ERROR" });
    }

    // في كشوف الهيئة قد يرد بعد الاسم رقم هوية آخر بين قوسين (مرتبط بالمستفيد): يُفصل عن الاسم ويُنبَّه إليه.
    const relatedIds = (normalizeDigits(rawName).match(/\d{9}/g) ?? []).filter((x) => x !== normalizeNationalId(rawId));
    const nameText = normalizeDigits(rawName).replace(/[()]/g, " ").replace(/\d{7,}/g, " ");
    // حذف الرموز الشاردة على أطراف الاسم (حدود جداول مقروءة ضوئيًا مثلًا).
    const fullName = cleanText(nameText).replace(/^[^\p{L}]+|[^\p{L}*]+$/gu, "") || null;
    if (!fullName) issues.push({ field: "fullName", code: "NAME_MISSING", message: "الاسم مفقود", severity: "ERROR" });
    else if (!/[\u0600-\u06FFa-zA-Z]/.test(fullName)) issues.push({ field: "fullName", code: "NAME_UNREADABLE", message: "الاسم غير مقروء", severity: "ERROR" });

    if (relatedIds.length) {
      issues.push({ field: "fullName", code: "RELATED_ID", message: `يرد مع الاسم في الكشف رقم هوية آخر: ${relatedIds.join("، ")}`, severity: "WARNING" });
    }

    const citizenNumber = digitsOnly(cell(row, mapping.citizenNumber)) || cleanText(cell(row, mapping.citizenNumber)) || null;
    if (!citizenNumber) issues.push({ field: "citizenNumber", code: "NUMBER_MISSING", message: "رقم المواطن في الكشف مفقود", severity: "ERROR" });

    let quantity: number | null = 1;
    if (mapping.quantity != null) {
      const q = digitsOnly(cell(row, mapping.quantity));
      quantity = q ? Number(q) : null;
      if (!quantity || quantity < 1 || quantity > 20) {
        issues.push({ field: "quantity", code: "QTY_INVALID", message: "عدد الجرار غير صالح", severity: "ERROR" });
        quantity = quantity && quantity > 0 ? quantity : null;
      }
    }

    let amount: string | null = null;
    if (mapping.amount != null) {
      const a = parseAmount(cell(row, mapping.amount));
      if (a === "invalid") issues.push({ field: "amount", code: "AMOUNT_INVALID", message: "المبلغ غير مقروء", severity: "WARNING" });
      else amount = a;
    }

    const phone = mapping.phone != null ? normalizePhone(cell(row, mapping.phone)) : null;
    if (phone && !/^\+?\d{7,15}$/.test(phone)) issues.push({ field: "phone", code: "PHONE_INVALID", message: "رقم الهاتف غير صالح", severity: "WARNING" });

    rows.push({ rowIndex: r + 1, nationalId, fullName, phone, citizenNumber, quantity, amount, issues });
  }
  markDuplicates(rows);
  return rows;
}

/** تكرار الهوية أو رقم المواطن داخل الكشف نفسه خطأ يمنع الاعتماد حتى يُصحح أو يُستبعد. */
export function markDuplicates(rows: Pick<ParsedRow, "nationalId" | "citizenNumber" | "issues">[]) {
  const byId = new Map<string, number>();
  const byNumber = new Map<string, number>();
  for (const r of rows) {
    if (r.nationalId) byId.set(r.nationalId, (byId.get(r.nationalId) ?? 0) + 1);
    if (r.citizenNumber) byNumber.set(r.citizenNumber, (byNumber.get(r.citizenNumber) ?? 0) + 1);
  }
  for (const r of rows) {
    if (r.nationalId && byId.get(r.nationalId)! > 1) {
      r.issues.push({ field: "nationalId", code: "ID_DUPLICATE_IN_FILE", message: "رقم الهوية مكرر في الكشف", severity: "ERROR" });
    }
    if (r.citizenNumber && byNumber.get(r.citizenNumber)! > 1) {
      r.issues.push({ field: "citizenNumber", code: "NUMBER_DUPLICATE_IN_FILE", message: "رقم المواطن مكرر في الكشف", severity: "ERROR" });
    }
  }
}

export function severityOf(issues: RowIssue[]): "OK" | "WARNING" | "ERROR" {
  if (issues.some((i) => i.severity === "ERROR")) return "ERROR";
  return issues.length ? "WARNING" : "OK";
}

/**
 * بيانات رأس كشف الهيئة: «تاريخ الكشف : 15-10-2026 ـ رقم الميزان المتسلسل : 295».
 * تُستخدم عنوانًا مقترحًا للكشف ولا تؤثر في أي حساب.
 */
export function extractStatementMeta(text: string): { date: string | null; scaleNumber: string | null } {
  const t = normalizeDigits(text);
  const d = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})-(\d{1,2})-(\d{4})/);
  const date = d ? (d[1] ? `${d[3].padStart(2, "0")}/${d[2].padStart(2, "0")}/${d[1]}` : `${d[4].padStart(2, "0")}/${d[5].padStart(2, "0")}/${d[6]}`) : null;
  // «رقم الميزان» تحديدًا، لا أي كلمة «ميزان» (قد ترد في اسم مواطن يليه رقم هويته).
  const s = normalizeName(t).match(/رقم\s*الميزان\s*(?:المتسلسل)?[^\p{L}\d]{0,5}(\d{1,6})(?!\d)/u);
  return { date, scaleNumber: s ? s[1] : null };
}

/** يقترح الدورة من نص الملف (مثل «الدورة 12» أو «دورة رقم 12»). */
export function suggestCycleFromText(text: string): string | null {
  const t = normalizeName(text);
  const m = t.match(/دوره\s*(?:رقم\s*)?(\d{1,4})/);
  return m ? m[1] : null;
}

/**
 * رقم المواطن داخل الدورة: الدورة تضم عدة كشوف (موازين) يبدأ تسلسل كل منها من 1،
 * فيُسبق المتسلسل برقم الميزان («295-17»). الرقم غير العددي يبقى كما هو.
 */
export function withScale(scale: string | null | undefined, n: string | null): string | null {
  if (!n || !scale) return n;
  return /^\d+$/.test(n) ? `${scale}-${n}` : n;
}

/** تغيير رقم الميزان: يُزال السابق ثم يُضاف الجديد. */
export function rescale(prev: string | null | undefined, next: string | null | undefined, n: string | null): string | null {
  if (!n) return n;
  const raw = prev && n.startsWith(`${prev}-`) ? n.slice(prev.length + 1) : n;
  return withScale(next, raw);
}
