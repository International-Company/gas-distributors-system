import { describe, expect, it } from "vitest";
import { notFound } from "@/server/errors";

describe("رسالة «غير موجود»", () => {
  it("تتبع جنس الاسم", () => {
    expect(notFound("الدورة").message).toBe("الدورة غير موجودة");
    expect(notFound("المجموعة").message).toBe("المجموعة غير موجودة");
    expect(notFound("الكشف").message).toBe("الكشف غير موجود");
    expect(notFound().message).toBe("العنصر غير موجود");
  });
});
