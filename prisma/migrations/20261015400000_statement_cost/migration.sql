-- سعر الجرة على الموزّع (تكلفته) لكل كشف: لحساب ربحه من الكشف. سعر المواطن هو "unitPrice".
ALTER TABLE "statements" ADD COLUMN "costPrice" DECIMAL(12,2);
ALTER TABLE "statements" ADD CONSTRAINT statements_cost_price_non_negative CHECK ("costPrice" IS NULL OR "costPrice" >= 0);
