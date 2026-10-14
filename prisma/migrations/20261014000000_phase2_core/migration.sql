-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CycleEventType" AS ENUM ('OPENED', 'CLOSED', 'REOPENED', 'PRICE_CHANGED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('STATEMENT');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'SUPERSEDED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ParseMethod" AS ENUM ('EXCEL', 'PDF_TEXT', 'PDF_OCR');

-- CreateEnum
CREATE TYPE "RowSeverity" AS ENUM ('OK', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "AmountSource" AS ENUM ('AUTHORITY', 'COMPUTED');

-- CreateEnum
CREATE TYPE "ReviewCaseType" AS ENUM ('NOT_IN_STATEMENT');

-- CreateEnum
CREATE TYPE "ReviewCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "cycles" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'OPEN',
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" UUID NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_events" (
    "id" BIGSERIAL NOT NULL,
    "distributorId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "type" "CycleEventType" NOT NULL,
    "reason" TEXT,
    "details" JSONB,
    "userId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_blobs" (
    "fileId" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "file_blobs_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "statements" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "cycleId" UUID,
    "title" TEXT NOT NULL,
    "status" "StatementStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "supersedesId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fileId" UUID NOT NULL,
    "parseMethod" "ParseMethod",
    "rawTable" JSONB,
    "headerRow" INTEGER,
    "columnMapping" JSONB,
    "extraction" JSONB,
    "suggestedCycle" TEXT,
    "importedById" UUID NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "discardedById" UUID,
    "discardedAt" TIMESTAMP(3),
    "discardReason" TEXT,

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_rows" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "nationalId" TEXT,
    "fullName" TEXT,
    "phone" TEXT,
    "citizenNumber" TEXT,
    "quantity" INTEGER,
    "amount" DECIMAL(12,2),
    "issues" JSONB NOT NULL DEFAULT '[]',
    "severity" "RowSeverity" NOT NULL DEFAULT 'OK',
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "editedById" UUID,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "statement_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citizens" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "nationalId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "phone" TEXT,
    "archivedAt" TIMESTAMP(3),
    "mergedIntoId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citizens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "citizenId" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "citizenNumber" TEXT NOT NULL,
    "nameInStatement" TEXT NOT NULL,
    "phoneInStatement" TEXT,
    "quantity" INTEGER NOT NULL,
    "amountDue" DECIMAL(12,2) NOT NULL,
    "amountSource" "AmountSource" NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_changes" (
    "id" BIGSERIAL NOT NULL,
    "distributorId" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "statementId" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "userId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_dismissals" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "citizenAId" UUID NOT NULL,
    "citizenBId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merge_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cases" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "type" "ReviewCaseType" NOT NULL,
    "status" "ReviewCaseStatus" NOT NULL DEFAULT 'OPEN',
    "nationalId" TEXT,
    "fullName" TEXT,
    "phone" TEXT,
    "details" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "review_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cycles_distributorId_number_key" ON "cycles"("distributorId", "number");

-- CreateIndex
CREATE INDEX "cycle_events_cycleId_at_idx" ON "cycle_events"("cycleId", "at");

-- CreateIndex
CREATE INDEX "stored_files_distributorId_sha256_idx" ON "stored_files"("distributorId", "sha256");

-- CreateIndex
CREATE INDEX "statements_distributorId_status_idx" ON "statements"("distributorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "statement_rows_statementId_rowIndex_key" ON "statement_rows"("statementId", "rowIndex");

-- CreateIndex
CREATE UNIQUE INDEX "citizens_distributorId_nationalId_key" ON "citizens"("distributorId", "nationalId");

-- CreateIndex
CREATE INDEX "entitlements_distributorId_citizenNumber_idx" ON "entitlements"("distributorId", "citizenNumber");

-- CreateIndex
CREATE INDEX "entitlements_citizenId_idx" ON "entitlements"("citizenId");

-- CreateIndex
CREATE INDEX "entitlement_changes_entitlementId_at_idx" ON "entitlement_changes"("entitlementId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "merge_dismissals_citizenAId_citizenBId_key" ON "merge_dismissals"("citizenAId", "citizenBId");

-- CreateIndex
CREATE INDEX "review_cases_distributorId_status_idx" ON "review_cases"("distributorId", "status");

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_events" ADD CONSTRAINT "cycle_events_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_blobs" ADD CONSTRAINT "file_blobs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_rows" ADD CONSTRAINT "statement_rows_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citizens" ADD CONSTRAINT "citizens_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_citizenId_fkey" FOREIGN KEY ("citizenId") REFERENCES "citizens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_changes" ADD CONSTRAINT "entitlement_changes_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cases" ADD CONSTRAINT "review_cases_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

