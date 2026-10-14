-- CreateEnum
CREATE TYPE "CylinderStatus" AS ENUM ('EMPTY', 'FILLED', 'DELIVERED', 'VOID');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('RECEIVE_EMPTY', 'FILL', 'DELIVER');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IdentityMethod" AS ENUM ('MANUAL_ENTRY', 'ID_SCAN');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIVE_EMPTY', 'FILL', 'DELIVER', 'SHIPMENT_EXTRA', 'REVERSAL');

-- AlterEnum
ALTER TYPE "ReviewCaseType" ADD VALUE 'IDENTITY_MISMATCH';



















-- CreateTable
CREATE TABLE "cylinders" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" "CylinderStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cylinders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cylinder_operations" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "cylinderId" UUID NOT NULL,
    "type" "OperationType" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "shipmentId" UUID,
    "identityMethod" "IdentityMethod",
    "userId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "cylinder_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "linkedCount" INTEGER NOT NULL,
    "extraCount" INTEGER NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" BIGSERIAL NOT NULL,
    "distributorId" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "emptyDelta" INTEGER NOT NULL DEFAULT 0,
    "filledDelta" INTEGER NOT NULL DEFAULT 0,
    "extraDelta" INTEGER NOT NULL DEFAULT 0,
    "emptyAfter" INTEGER NOT NULL,
    "filledAfter" INTEGER NOT NULL,
    "extraAfter" INTEGER NOT NULL,
    "operationId" UUID,
    "shipmentId" UUID,
    "reversesId" BIGINT,
    "note" TEXT,
    "userId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "distributorId" UUID NOT NULL,
    "empty" INTEGER NOT NULL DEFAULT 0,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "extra" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("distributorId")
);

-- CreateIndex
CREATE INDEX "cylinders_distributorId_status_idx" ON "cylinders"("distributorId", "status");

-- CreateIndex
CREATE INDEX "cylinders_cycleId_status_idx" ON "cylinders"("cycleId", "status");

-- CreateIndex
CREATE INDEX "cylinder_operations_cylinderId_at_idx" ON "cylinder_operations"("cylinderId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "cylinder_operations_distributorId_idempotencyKey_key" ON "cylinder_operations"("distributorId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "stations_distributorId_name_key" ON "stations"("distributorId", "name");

-- CreateIndex
CREATE INDEX "shipments_distributorId_receivedAt_idx" ON "shipments"("distributorId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_distributorId_idempotencyKey_key" ON "shipments"("distributorId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_reversesId_key" ON "inventory_movements"("reversesId");

-- CreateIndex
CREATE INDEX "inventory_movements_distributorId_at_idx" ON "inventory_movements"("distributorId", "at");

-- AddForeignKey
ALTER TABLE "cylinders" ADD CONSTRAINT "cylinders_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cylinder_operations" ADD CONSTRAINT "cylinder_operations_cylinderId_fkey" FOREIGN KEY ("cylinderId") REFERENCES "cylinders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cylinder_operations" ADD CONSTRAINT "cylinder_operations_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

