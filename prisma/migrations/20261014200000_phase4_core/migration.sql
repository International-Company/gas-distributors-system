-- CreateEnum
CREATE TYPE "FinanceStatus" AS ENUM ('ACTIVE', 'CANCELLED');


































-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'ILS',
ADD COLUMN     "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stations" ADD COLUMN     "defaultUnitPrice" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "status" "FinanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "FinanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_payments" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "FinanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "station_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_entitlementId_idx" ON "payments"("entitlementId");

-- CreateIndex
CREATE INDEX "payments_distributorId_paidAt_idx" ON "payments"("distributorId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_distributorId_idempotencyKey_key" ON "payments"("distributorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "expenses_distributorId_spentAt_idx" ON "expenses"("distributorId", "spentAt");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_distributorId_idempotencyKey_key" ON "expenses"("distributorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "station_payments_stationId_paidAt_idx" ON "station_payments"("stationId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "station_payments_distributorId_idempotencyKey_key" ON "station_payments"("distributorId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_payments" ADD CONSTRAINT "station_payments_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

