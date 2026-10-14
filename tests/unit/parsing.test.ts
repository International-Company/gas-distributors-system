import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { nameSimilarity, normalizeDigits, normalizeName, normalizePhone } from "@/lib/arabic";
import { extractNationalIds, isValidNationalId, normalizeNationalId } from "@/lib/national-id";
import { itemsToTable } from "@/lib/table-from-items";
import { applyMapping, detectMapping, extractStatementMeta, suggestCycleFromText } from "@/server/statements/mapping";
import { detectKind, extractPdf } from "@/server/statements/extract";
import { newId } from "../helpers/statements";

describe("النص العربي", () => {
  it("يوحّد الأرقام والأسماء", () => {
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(normalizeName("أَحْمَد  إبراهيم الـــعلي")).toBe(normalizeName("احمد ابراهيم العلي"));
    expect(normalizeName("فاطمة مصطفى")).toBe("فاطمه مصطفي");
    expect(normalizeName("ﻣﺤﻤﺪ")).toBe("محمد"); // أشكال العرض من ملفات PDF
    expect(normalizePhone("٠٥٩٩-١٢٣ ٤٥٦")).toBe("0599123456");
  });

  it("تشابه الأسماء", () => {
    expect(nameSimilarity("محمد احمد", "محمد احمد")).toBe(1);
    expect(nameSimilarity("خالد محمود سالم", "خالد محمود سلم")).toBeGreaterThan(0.8);
    expect(nameSimilarity("خالد محمود", "سمير عادل")).toBeLessThan(0.3);
  });
});

describe("رقم الهوية", () => {
  it("يتحقق من رقم التحقق ويكشف خطأ رقم واحد", () => {
    const id = newId();
    expect(isValidNationalId(id)).toBe(true);
    const wrong = id.slice(0, 8) + ((Number(id[8]) + 1) % 10);
    expect(isValidNationalId(wrong)).toBe(false);
    expect(isValidNationalId("12345678")).toBe(false);
  });

  it("يستخرج أرقامًا صالحة من نص مقروء ضوئيًا", () => {
    const id = newId();
    const spaced = `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}`;
    expect(extractNationalIds(`رقم الهوية: ${spaced} تاريخ 2020`)).toEqual([id]);
    expect(extractNationalIds("123456789")).toEqual([]);
  });

  it("يكمل الأصفار البادئة التي يحذفها Excel", () => {
    expect(normalizeNationalId(12345678)).toBe("012345678");
  });
});

describe("ربط الأعمدة", () => {
  it("يجد صف العناوين ويفضّل «رقم المواطن» على عمود التسلسل «م»", () => {
    const id = newId();
    const table = [["كشف الغاز الدورة رقم 15"], ["م", "رقم المواطن", "الاسم", "رقم الهوية", "الجوال"], ["1", "77", "محمد علي", id, "0599111222"]];
    const { headerRow, mapping } = detectMapping(table);
    expect(headerRow).toBe(1);
    expect(mapping).toMatchObject({ citizenNumber: 1, fullName: 2, nationalId: 3, phone: 4 });
    const rows = applyMapping(table, headerRow, mapping);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ nationalId: id, citizenNumber: "77", fullName: "محمد علي", quantity: 1, issues: [] });
    expect(suggestCycleFromText(table[0][0])).toBe("15");
  });

  it("يتعرف على عناوين قرأتها القراءة الضوئية بخطأ (ركم بدل رقم) وينظف أطراف الاسم", () => {
    const id = newId();
    const table = [["ركم المواطن", "الاسم", "ركم الهوية"], ["201", "| حسن علي —", id]];
    const { headerRow, mapping } = detectMapping(table);
    expect(mapping).toMatchObject({ citizenNumber: 0, fullName: 1, nationalId: 2 });
    expect(applyMapping(table, headerRow, mapping)[0]).toMatchObject({ citizenNumber: "201", fullName: "حسن علي" });
  });

  it("يتجاهل العناوين المكررة في الصفحات وصفوف المجاميع", () => {
    const id = newId();
    const header = ["رقم المواطن", "الاسم", "رقم الهوية"];
    const table = [header, ["1", "أحمد", id], header, ["", "المجموع", ""], ["2", "سعيد", newId()]];
    const { headerRow, mapping } = detectMapping(table);
    expect(applyMapping(table, headerRow, mapping).map((r) => r.citizenNumber)).toEqual(["1", "2"]);
  });

  it("دون صف عناوين: يستنتج عمودي الهوية والاسم من المحتوى", () => {
    const table = Array.from({ length: 5 }, (_, i) => [String(i + 1), `اسم ${i} العائلة`, newId()]);
    const { headerRow, mapping } = detectMapping(table);
    expect(headerRow).toBeNull();
    expect(mapping).toMatchObject({ nationalId: 2, fullName: 1 });
  });
});

describe("الجدول من مواضع الكلمات", () => {
  it("يجمع الكلمات في صفوف وخلايا من اليمين لليسار ويسند الخلايا للأعمدة", () => {
    const it = (text: string, x: number, y: number, w = 20) => ({ text, x, y, w, h: 10, page: 1 });
    const table = itemsToTable([
      it("رقم", 480, 10), it("الهوية", 440, 10, 35), it("الاسم", 300, 10), it("الرقم", 100, 10),
      it("401234567", 440, 30, 60), it("محمد", 320, 30), it("علي", 290, 30), it("5", 105, 30, 8),
    ]);
    expect(table).toHaveLength(2);
    expect(table[1][0]).toBe("401234567");
    expect(table[1][1]).toBe("محمد علي");
    expect(table[1][2]).toBe("5");
  });
});

describe("استخراج PDF", () => {
  it("يرفض الأنواع غير المدعومة و .xls القديمة", () => {
    expect(() => detectKind("a.xls", "", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(/xlsx/);
    expect(() => detectKind("a.png", "image/png", Buffer.from([0x89, 0x50]))).toThrow();
    expect(detectKind("x.pdf", "", Buffer.from("%PDF-1.7"))).toBe("pdf");
  });

  it("يستخرج جدولًا من PDF نصي، ويكتشف الممسوح ضوئيًا", async () => {
    const ids = [newId(), newId()];
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    const cols = [500, 380, 200];
    const draw = (cells: string[], y: number) => cells.forEach((t, i) => page.drawText(t, { x: cols[i], y, size: 11, font }));
    draw(["Number", "Name Full", "ID"], 780);
    draw(["11", "Ahmad Ali", ids[0]], 760);
    draw(["12", "Sami Omar", ids[1]], 740);
    const ex = await extractPdf(Buffer.from(await doc.save()));
    expect(ex.needsOcr).toBe(false);
    expect(ex.table).toHaveLength(3);
    expect(ex.table[1]).toEqual(["11", "Ahmad Ali", ids[0]]);

    const blank = await PDFDocument.create();
    blank.addPage();
    const ex2 = await extractPdf(Buffer.from(await blank.save()));
    expect(ex2.needsOcr).toBe(true);
  });
});

describe("صيغة كشوف الهيئة الفعلية (نظام توزيع الغاز)", () => {
  it("عمود «المتسلسل» هو رقم المواطن، ورقم الهوية بين قوسين في خانة الاسم يُفصل وينبَّه إليه", () => {
    const [a, b, rel] = [newId(), newId(), newId()];
    const table = [
      ["المتسلسل", "رقم الهوية", "الاسم", "رقم الجوال"],
      ["1", a, `سالم نادر سالم المثال ( ${rel} )`, "0599000098"],
      ["2", b, "سعيد ك*** م*** التجربة", "0599000097"],
    ];
    const { headerRow, mapping } = detectMapping(table);
    expect(mapping).toMatchObject({ citizenNumber: 0, nationalId: 1, fullName: 2, phone: 3 });
    const rows = applyMapping(table, headerRow, mapping);
    expect(rows[0]).toMatchObject({ citizenNumber: "1", nationalId: a, fullName: "سالم نادر سالم المثال" });
    expect(rows[0].issues.map((i) => i.code)).toEqual(["RELATED_ID"]);
    expect(rows[1].fullName).toBe("سعيد ك*** م*** التجربة"); // الأسماء المقنّعة تبقى كما وردت
  });

  it("يقرأ تاريخ الكشف ورقم الميزان من الرأس", () => {
    expect(extractStatementMeta("تاريخ الكشف : ‐ 15-10-2026 رقم الميزان المتسلسل : 295")).toEqual({ date: "15/10/2026", scaleNumber: "295" });
    expect(extractStatementMeta("تاريخ الكشف : 2026-10-15")).toEqual({ date: "15/10/2026", scaleNumber: null });
  });

  it("الاسم الملتف على سطرين في PDF يُدمج في صفه ولا يصبح صفًا مستقلًا", () => {
    const id1 = newId();
    const id2 = newId();
    const w = (text: string, x: number, y: number, ww = 30) => ({ text, x, y, w: ww, h: 10, page: 1 });
    const items = [
      w("المتسلسل", 520, 100), w("رقم الهوية", 420, 100, 50), w("الاسم", 300, 100), w("رقم الجوال", 150, 100, 50),
      // صف عادي
      w("1", 525, 130, 8), w(id1, 420, 130, 60), w("سامي", 300, 130), w("0599000001", 150, 130, 60),
      // صف ملتف: السطر الأول من الاسم والهاتف أعلى، والتسلسل والهوية وبقية الاسم أسفل
      w("أحمد", 310, 155), w("عبد", 280, 155), w("0599000002", 150, 158, 60),
      w("2", 525, 161, 8), w(id2, 420, 161, 60), w("التجريبي", 295, 167, 40),
      // صف ثالث لضبط المسافة المعتادة بين الصفوف
      w("3", 525, 192, 8), w(newId(), 420, 192, 60), w("منى", 300, 192), w("0599000003", 150, 192, 60),
    ];
    const table = itemsToTable(items);
    const { headerRow, mapping } = detectMapping(table);
    const rows = applyMapping(table, headerRow, mapping);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ citizenNumber: "2", nationalId: id2, fullName: "أحمد عبد التجريبي", phone: "0599000002" });
  });
});
