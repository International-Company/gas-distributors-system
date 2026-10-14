-- المرحلة 6: العمل دون اتصال والمزامنة

ALTER TYPE "ReviewCaseType" ADD VALUE 'OFFLINE_CONFLICT';

-- وقت التنفيذ على الجهاز للعمليات المنفذة دون اتصال
ALTER TABLE "cylinder_operations" ADD COLUMN "offlineAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "offlineAt" TIMESTAMP(3);

-- حالة مراجعة واحدة لكل عملية محلية رفضها الخادم
ALTER TABLE "review_cases" ADD COLUMN "sourceOpId" TEXT;
CREATE UNIQUE INDEX "review_cases_distributorId_sourceOpId_key" ON "review_cases"("distributorId", "sourceOpId");

-- سياسة العمل دون اتصال
ALTER TABLE "system_settings"
  ADD COLUMN "offlineReceive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "offlineDeliver" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "offlinePayments" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "offlineMaxAgeHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "system_settings" ADD CONSTRAINT system_settings_offline_age_range CHECK ("offlineMaxAgeHours" BETWEEN 1 AND 72);
