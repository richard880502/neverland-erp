ALTER TYPE "FinanceInvoiceStatus" ADD VALUE IF NOT EXISTS 'NOT_REQUIRED';

ALTER TABLE "FinanceTransactionItem"
  ADD COLUMN "unitCostSnapshot" DECIMAL(14,2);

UPDATE "FinanceTransactionItem" i
SET "unitCostSnapshot" = p."unitCost"
FROM "Product" p
WHERE i."productId" = p."id"
  AND i."unitCostSnapshot" IS NULL;
