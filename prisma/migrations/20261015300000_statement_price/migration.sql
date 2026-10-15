-- سعر الجرة لكل كشف (يُدخل عند الرفع)
ALTER TABLE "statements" ADD COLUMN "unitPrice" DECIMAL(12,2);
ALTER TABLE "statements" ADD CONSTRAINT statements_unit_price_non_negative CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0);
