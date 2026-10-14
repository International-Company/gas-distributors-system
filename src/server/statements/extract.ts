import "server-only";
import ExcelJS from "exceljs";
import { cleanText, normalizeName } from "@/lib/arabic";
import { itemsToTable, type TextItem } from "@/lib/table-from-items";
import { AppError } from "../errors";
import type { RawTable } from "./mapping";

export type Extraction = {
  method: "EXCEL" | "PDF_TEXT" | "PDF_OCR";
  table: RawTable;
  text: string;
  /** PDF ممسوح ضوئيًا: نص قليل جدًا، يحتاج قراءة ضوئية في المتصفح. */
  needsOcr: boolean;
  notes: string[];
};

export const ALLOWED_STATEMENT_TYPES: Record<string, "excel" | "pdf"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
};
export const MAX_STATEMENT_BYTES = 20 * 1024 * 1024;

export function detectKind(name: string, mime: string, head: Buffer): "excel" | "pdf" {
  // نعتمد على محتوى الملف لا على اسمه فقط.
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b && /\.xlsx$/i.test(name)) return "excel";
  if (/\.xls$/i.test(name) || (head[0] === 0xd0 && head[1] === 0xcf)) {
    throw new AppError("VALIDATION", "صيغة Excel القديمة (.xls) غير مدعومة. افتح الملف واحفظه بصيغة .xlsx ثم ارفعه");
  }
  throw new AppError("VALIDATION", `نوع الملف غير مدعوم (${mime || name}). الأنواع المسموحة: PDF و Excel (.xlsx)`);
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellToString(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
  }
  return String(v);
}

export async function extractExcel(buf: Buffer): Promise<Extraction> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new AppError("VALIDATION", "تعذر قراءة ملف Excel. تأكد أنه غير تالف وغير محمي بكلمة مرور");
  }
  // نختار الورقة الأكثر صفوفًا (الكشف عادة في ورقة واحدة).
  let best: RawTable = [];
  const notes: string[] = [];
  for (const ws of wb.worksheets) {
    const table: RawTable = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, col) => (values[col - 1] = cleanText(cellToString(c.value))));
      table.push(Array.from(values, (v) => v ?? ""));
    });
    if (table.length > best.length) best = table;
  }
  if (wb.worksheets.length > 1) notes.push(`الملف يحتوي ${wb.worksheets.length} أوراق؛ استُخدمت الورقة الأكثر صفوفًا`);
  return { method: "EXCEL", table: best, text: best.map((r) => r.join(" ")).join("\n"), needsOcr: false, notes };
}

const looksLikeHeader = (cells: string[]) => {
  const n = cells.map((c) => normalizeName(c)).join(" ");
  return /هويه/.test(n) && /اسم/.test(n);
};

export async function extractPdf(buf: Buffer): Promise<Extraction> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch {
    throw new AppError("VALIDATION", "تعذر قراءة ملف PDF. تأكد أنه غير تالف وغير محمي بكلمة مرور");
  }
  const items: TextItem[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (!("str" in it) || !it.str) continue;
      const [, , , , x, y] = it.transform as number[];
      // نقلب y ليزداد للأسفل كما في الصور.
      items.push({ text: it.str.normalize("NFKC"), x, y: viewport.height - y, w: it.width, h: it.height || 8, page: p });
    }
  }
  const text = items.map((i) => i.text).join(" ");
  const meaningful = text.replace(/\s/g, "").length;
  const needsOcr = meaningful < 40 * Math.max(1, pdf.numPages);
  const notes: string[] = [];
  if (needsOcr) notes.push("الملف لا يحتوي نصًا كافيًا (ممسوح ضوئيًا على الأرجح)، ويحتاج قراءة ضوئية");
  const table = needsOcr ? [] : itemsToTable(items, looksLikeHeader);
  return { method: "PDF_TEXT", table, text, needsOcr, notes };
}

export { looksLikeHeader };
