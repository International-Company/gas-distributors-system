import ExcelJS from "exceljs";
import { withSystem } from "../db";
import { type Actor, assertAdmin } from "../actor";
import { audit } from "../audit";
import { plainDate, plainDateTime } from "@/lib/format";
import { distributorStatusLabel, listDistributors } from "./distributors";

/** تصدير قائمة الموزّعين إلى Excel مع تطبيق الفلاتر نفسها المعروضة في الشاشة. */
export async function exportDistributorsXlsx(actor: Actor, filters: unknown): Promise<Buffer> {
  assertAdmin(actor, "distributors.export");
  const rows = await listDistributors(actor, filters);

  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة موزّعي الغاز";
  const ws = wb.addWorksheet("الموزّعون", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "الاسم", key: "name", width: 28 },
    { header: "اسم المستخدم", key: "username", width: 18 },
    { header: "الهاتف", key: "phone", width: 16 },
    { header: "المنطقة", key: "region", width: 22 },
    { header: "التصنيف", key: "category", width: 16 },
    { header: "الحالة", key: "status", width: 14 },
    { header: "نوع الحساب", key: "type", width: 12 },
    { header: "تاريخ الانتهاء", key: "expiresAt", width: 14 },
    { header: "مثبّت", key: "pinned", width: 8 },
    { header: "آخر دخول", key: "lastLogin", width: 18 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 14 },
  ];
  for (const d of rows) {
    ws.addRow({
      name: d.name,
      username: d.user?.username ?? "",
      phone: d.phone,
      region: d.region,
      category: d.category?.name ?? "",
      status: distributorStatusLabel(d),
      type: d.isTrial ? "تجريبي" : "فعلي",
      expiresAt: d.expiresAt ? plainDate(d.expiresAt) : "بلا مدة",
      pinned: d.isPinned ? "نعم" : "",
      lastLogin: plainDateTime(d.user?.lastLoginAt),
      createdAt: plainDate(d.createdAt),
    });
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E4E8C" } };
  header.alignment = { horizontal: "center", vertical: "middle" };
  ws.eachRow((row) => (row.alignment = { ...row.alignment, readingOrder: "rtl" }));

  await withSystem((tx) =>
    audit(tx, actor, { action: "distributor.export", entityType: "distributor", after: { count: rows.length, filters } }),
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}
