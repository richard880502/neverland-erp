CREATE TYPE "BillingStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');
CREATE TYPE "BillingSourceType" AS ENUM ('CONSIGNMENT', 'BUYOUT');

ALTER TABLE "Channel"
  ADD COLUMN "companyName" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "billingAddress" TEXT,
  ADD COLUMN "settlementRate" DECIMAL(6,4),
  ADD COLUMN "taxRate" DECIMAL(6,4),
  ADD COLUMN "paymentTermsDays" INTEGER DEFAULT 0;

CREATE TABLE "BillingStatement" (
  "id" TEXT NOT NULL,
  "statementNo" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "sourceType" "BillingSourceType" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "companyName" TEXT NOT NULL,
  "taxId" TEXT,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "billingAddress" TEXT,
  "settlementRate" DECIMAL(6,4) NOT NULL,
  "taxRate" DECIMAL(6,4) NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL,
  "shippingFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "status" "BillingStatus" NOT NULL DEFAULT 'ISSUED',
  "paidAt" TIMESTAMP(3),
  "paidAmount" DECIMAL(12,2),
  "paymentMethod" TEXT,
  "paymentReference" TEXT,
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingStatement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingStatementItem" (
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "size" TEXT,
  "listPrice" DECIMAL(12,2) NOT NULL,
  "settlementPrice" DECIMAL(12,2) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "BillingStatementItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingStatementSource" (
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingStatementSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingStatement_statementNo_key" ON "BillingStatement"("statementNo");
CREATE INDEX "BillingStatement_channelId_periodStart_periodEnd_idx" ON "BillingStatement"("channelId", "periodStart", "periodEnd");
CREATE INDEX "BillingStatement_status_issuedAt_idx" ON "BillingStatement"("status", "issuedAt");
CREATE INDEX "BillingStatementItem_statementId_idx" ON "BillingStatementItem"("statementId");
CREATE INDEX "BillingStatementItem_productId_idx" ON "BillingStatementItem"("productId");
CREATE UNIQUE INDEX "BillingStatementSource_movementId_key" ON "BillingStatementSource"("movementId");
CREATE INDEX "BillingStatementSource_statementId_idx" ON "BillingStatementSource"("statementId");

ALTER TABLE "BillingStatement" ADD CONSTRAINT "BillingStatement_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingStatement" ADD CONSTRAINT "BillingStatement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingStatementItem" ADD CONSTRAINT "BillingStatementItem_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BillingStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingStatementItem" ADD CONSTRAINT "BillingStatementItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingStatementSource" ADD CONSTRAINT "BillingStatementSource_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BillingStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingStatementSource" ADD CONSTRAINT "BillingStatementSource_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
