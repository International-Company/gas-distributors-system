-- التسليم المبسّط: «سلّم» واحد لكل استحقاق (قرار المالك)

CREATE TABLE "handovers" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "identityMethod" "IdentityMethod",
    "userId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offlineAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "handovers_entitlementId_idx" ON "handovers"("entitlementId");
CREATE INDEX "handovers_distributorId_at_idx" ON "handovers"("distributorId", "at");
CREATE UNIQUE INDEX "handovers_distributorId_idempotencyKey_key" ON "handovers"("distributorId", "idempotencyKey");
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- عزل الصفوف لكل موزّع
ALTER TABLE "handovers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY handovers_isolation ON "handovers"
  USING (app_bypass_rls() OR "distributorId" = app_current_distributor())
  WITH CHECK (app_bypass_rls() OR "distributorId" = app_current_distributor());

-- الاستحقاق من الموزّع نفسه
ALTER TABLE "handovers" ADD CONSTRAINT handovers_entitlement_dist
  FOREIGN KEY ("entitlementId", "distributorId") REFERENCES "entitlements"("id", "distributorId");

-- منع التسليم المكرر: تسليم نافذ واحد فقط لكل استحقاق
CREATE UNIQUE INDEX handovers_one_active_per_entitlement ON "handovers"("entitlementId") WHERE "status" = 'ACTIVE';

-- قيود القيم
ALTER TABLE "handovers" ADD CONSTRAINT handovers_quantity_positive CHECK ("quantity" > 0);
ALTER TABLE "handovers" ADD CONSTRAINT handovers_cancel_consistent CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

-- لا يُعدّل ولا يُحذف؛ التغيير الوحيد المسموح هو الإلغاء مرة واحدة
CREATE TRIGGER handovers_cancel_only BEFORE UPDATE OR DELETE ON "handovers" FOR EACH ROW EXECUTE FUNCTION app_cancel_only();
