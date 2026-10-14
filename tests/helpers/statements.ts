import ExcelJS from "exceljs";
import { isValidNationalId } from "@/lib/national-id";

let seq = 10_000_000 + Math.floor(Math.random() * 80_000_000);

/** رقم هوية صالح (رقم تحقق صحيح) وفريد ضمن تشغيل الاختبارات. */
export function newId(): string {
  const base = String(seq++).padStart(8, "0").slice(-8);
  for (let d = 0; d <= 9; d++) {
    const id = base + d;
    if (isValidNationalId(id)) return id;
  }
  throw new Error("unreachable");
}

export type Row = { id: string; name: string; number: string | number; qty?: number; amount?: number | string; phone?: string };

/** ملف Excel بصيغة قريبة من كشف الهيئة: عنوان، ثم صف عناوين، ثم البيانات. */
export async function makeStatementXlsx(rows: Row[], opts: { title?: string; withAmount?: boolean } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("كشف");
  ws.addRow([opts.title ?? "كشف توزيع الغاز - الدورة 7"]);
  ws.addRow([]);
  const headers = ["م", "رقم المواطن", "الاسم رباعي", "رقم الهوية", "رقم الجوال", "عدد الجرار"];
  if (opts.withAmount) headers.push("المبلغ");
  ws.addRow(headers);
  rows.forEach((r, i) => {
    const values: (string | number)[] = [i + 1, r.number, r.name, r.id, r.phone ?? "0599000000", r.qty ?? 1];
    if (opts.withAmount) values.push(r.amount ?? "");
    ws.addRow(values);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const xlsxFile = (data: Buffer, name = "statement.xlsx") => ({
  name,
  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  data,
});
