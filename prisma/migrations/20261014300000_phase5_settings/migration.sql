




































-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "allowedFileTypes" TEXT[] DEFAULT ARRAY['pdf', 'xlsx', 'jpg', 'jpeg', 'png', 'webp']::TEXT[],
ADD COLUMN     "logoData" BYTEA,
ADD COLUMN     "logoMime" TEXT,
ADD COLUMN     "maxUploadMb" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "navOverrides" JSONB NOT NULL DEFAULT '{}';


-- حدود إعدادات الملفات
ALTER TABLE "system_settings" ADD CONSTRAINT system_settings_upload_range CHECK ("maxUploadMb" BETWEEN 1 AND 50);
