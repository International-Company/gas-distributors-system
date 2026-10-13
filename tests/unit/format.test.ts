import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, plainDate, plainDateTime, toDateInput } from "@/lib/format";

describe("تنسيق التواريخ بتوقيت غزة", () => {
  it("يحوّل من UTC إلى توقيت غزة الشتوي (UTC+2) عبر حدود اليوم", () => {
    const d = new Date("2026-01-15T22:30:00Z");
    expect(plainDate(d)).toBe("16/01/2026");
    expect(plainDateTime(d)).toBe("16/01/2026 00:30");
    expect(toDateInput(d)).toBe("2026-01-16");
  });

  it("يحترم التوقيت الصيفي (UTC+3)", () => {
    expect(plainDateTime(new Date("2026-07-01T09:05:00Z"))).toBe("01/07/2026 12:05");
  });

  it("نسخ العرض معزولة الاتجاه حتى لا يضطرب ترتيبها داخل نص عربي", () => {
    const s = formatDateTime(new Date("2026-07-01T09:05:00Z"));
    expect(s.startsWith("⁦")).toBe(true);
    expect(s.endsWith("⁩")).toBe(true);
  });

  it("القيم الفارغة ترجع البديل", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined, "لم يحدث")).toBe("لم يحدث");
    expect(plainDate(null)).toBe("");
  });
});
