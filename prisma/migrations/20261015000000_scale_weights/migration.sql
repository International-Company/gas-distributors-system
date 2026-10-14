-- رقم الميزان للكشف
ALTER TABLE "statements" ADD COLUMN "scaleNumber" TEXT;

-- وزن الجرة في عمليتي الاستلام (فارغة) والتسليم (ممتلئة)
ALTER TABLE "cylinder_operations" ADD COLUMN "weightKg" DECIMAL(5,2);
ALTER TABLE "cylinder_operations" ADD CONSTRAINT cylinder_operations_weight_valid
  CHECK ("weightKg" IS NULL OR ("weightKg" > 0 AND "weightKg" < 100 AND "type" IN ('RECEIVE_EMPTY', 'DELIVER')));
