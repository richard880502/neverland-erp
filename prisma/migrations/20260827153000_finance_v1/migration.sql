CREATE TYPE "FinanceDirection" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "FinancePaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'VOID');
CREATE TYPE "FinanceReconciliationStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'RECONCILED');
CREATE TYPE "FinanceInvoiceStatus" AS ENUM ('MISSING', 'RECEIVED', 'VOIDED', 'CREDITED');
CREATE TYPE "FinanceSource" AS ENUM ('MANUAL', 'EXCEL', 'BILLING', 'SHOPEE', 'BANK', 'OTHER');
CREATE TYPE "FinanceImportRowStatus" AS ENUM ('READY', 'REVIEW', 'REJECTED', 'IMPORTED');

CREATE TABLE "FinanceCategory" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "direction" "FinanceDirection" NOT NULL,
  "parentId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FinanceCategory_code_key" ON "FinanceCategory"("code");
CREATE INDEX "FinanceCategory_direction_active_idx" ON "FinanceCategory"("direction", "active");
ALTER TABLE "FinanceCategory" ADD CONSTRAINT "FinanceCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FinanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FinanceImportBatch" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "source" "FinanceSource" NOT NULL DEFAULT 'EXCEL',
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "summary" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "FinanceImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinanceImportBatch_createdAt_idx" ON "FinanceImportBatch"("createdAt");
ALTER TABLE "FinanceImportBatch" ADD CONSTRAINT "FinanceImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinanceTransaction" (
  "id" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "direction" "FinanceDirection" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "categoryId" TEXT,
  "counterparty" TEXT,
  "channelId" TEXT,
  "source" "FinanceSource" NOT NULL DEFAULT 'MANUAL',
  "sourceRef" TEXT,
  "paymentStatus" "FinancePaymentStatus" NOT NULL DEFAULT 'PAID',
  "reconciliationStatus" "FinanceReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
  "invoiceStatus" "FinanceInvoiceStatus" NOT NULL DEFAULT 'MISSING',
  "note" TEXT,
  "legacySheet" TEXT,
  "legacyRow" INTEGER,
  "importBatchId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinanceTransaction_occurredAt_direction_idx" ON "FinanceTransaction"("occurredAt", "direction");
CREATE INDEX "FinanceTransaction_categoryId_occurredAt_idx" ON "FinanceTransaction"("categoryId", "occurredAt");
CREATE INDEX "FinanceTransaction_channelId_occurredAt_idx" ON "FinanceTransaction"("channelId", "occurredAt");
CREATE INDEX "FinanceTransaction_paymentStatus_idx" ON "FinanceTransaction"("paymentStatus");
CREATE INDEX "FinanceTransaction_reconciliationStatus_idx" ON "FinanceTransaction"("reconciliationStatus");
CREATE UNIQUE INDEX "FinanceTransaction_legacySheet_legacyRow_key" ON "FinanceTransaction"("legacySheet", "legacyRow");
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "FinanceImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinanceTransactionItem" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "productId" TEXT,
  "sku" TEXT,
  "productName" TEXT NOT NULL,
  "size" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitAmount" DECIMAL(14,2),
  "lineAmount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceTransactionItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinanceTransactionItem_transactionId_idx" ON "FinanceTransactionItem"("transactionId");
CREATE INDEX "FinanceTransactionItem_productId_idx" ON "FinanceTransactionItem"("productId");
ALTER TABLE "FinanceTransactionItem" ADD CONSTRAINT "FinanceTransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceTransactionItem" ADD CONSTRAINT "FinanceTransactionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FinanceInvoice" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "invoiceNo" TEXT,
  "status" "FinanceInvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
  "grossAmount" DECIMAL(14,2),
  "netAmount" DECIMAL(14,2),
  "taxAmount" DECIMAL(14,2),
  "issuedAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceInvoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinanceInvoice_transactionId_idx" ON "FinanceInvoice"("transactionId");
CREATE INDEX "FinanceInvoice_invoiceNo_idx" ON "FinanceInvoice"("invoiceNo");
ALTER TABLE "FinanceInvoice" ADD CONSTRAINT "FinanceInvoice_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FinanceImportRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sheetName" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "status" "FinanceImportRowStatus" NOT NULL,
  "raw" JSONB NOT NULL,
  "normalized" JSONB,
  "reason" TEXT,
  "transactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceImportRow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FinanceImportRow_batchId_sheetName_rowNumber_key" ON "FinanceImportRow"("batchId", "sheetName", "rowNumber");
CREATE INDEX "FinanceImportRow_batchId_status_idx" ON "FinanceImportRow"("batchId", "status");
ALTER TABLE "FinanceImportRow" ADD CONSTRAINT "FinanceImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FinanceImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceImportRow" ADD CONSTRAINT "FinanceImportRow_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FinanceCategory" ("id", "code", "name", "direction") VALUES
  ('fin_cat_sales', 'sales', '商品銷售', 'INCOME'),
  ('fin_cat_wholesale', 'wholesale', '經銷收入', 'INCOME'),
  ('fin_cat_production', 'production', '商品成本 / 製作費', 'EXPENSE'),
  ('fin_cat_marketing', 'marketing', '行銷 / 宣傳', 'EXPENSE'),
  ('fin_cat_shipping', 'shipping', '物流 / 運費', 'EXPENSE'),
  ('fin_cat_admin', 'admin', '行政 / 雜支', 'EXPENSE')
ON CONFLICT ("code") DO NOTHING;
