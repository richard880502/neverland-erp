CREATE TYPE "DirectSettlementStatus" AS ENUM ('OPEN', 'RECONCILED', 'VOID');

CREATE TABLE "DirectSettlement" (
  "id" TEXT NOT NULL,
  "settlementNo" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL,
  "grossSales" DECIMAL(14,2) NOT NULL,
  "shippingIncome" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "platformFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "otherFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "expectedPayout" DECIMAL(14,2) NOT NULL,
  "actualPayout" DECIMAL(14,2),
  "discrepancy" DECIMAL(14,2),
  "payoutReference" TEXT,
  "status" "DirectSettlementStatus" NOT NULL DEFAULT 'OPEN',
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DirectSettlement_settlementNo_key" ON "DirectSettlement"("settlementNo");
CREATE INDEX "DirectSettlement_channelId_periodStart_periodEnd_idx" ON "DirectSettlement"("channelId", "periodStart", "periodEnd");
CREATE INDEX "DirectSettlement_status_settledAt_idx" ON "DirectSettlement"("status", "settledAt");

CREATE TABLE "DirectSettlementSource" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectSettlementSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DirectSettlementSource_movementId_key" ON "DirectSettlementSource"("movementId");
CREATE INDEX "DirectSettlementSource_settlementId_idx" ON "DirectSettlementSource"("settlementId");

ALTER TABLE "DirectSettlement" ADD CONSTRAINT "DirectSettlement_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectSettlement" ADD CONSTRAINT "DirectSettlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectSettlementSource" ADD CONSTRAINT "DirectSettlementSource_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DirectSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectSettlementSource" ADD CONSTRAINT "DirectSettlementSource_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "FinanceCategory" ("id", "code", "name", "direction", "parentId") VALUES
  ('fin_cat_platform_fee', 'platform_fee', '平台手續費', 'EXPENSE', 'fin_group_operations'),
  ('fin_cat_payment_fee', 'payment_fee', '金流手續費', 'EXPENSE', 'fin_group_operations')
ON CONFLICT ("code") DO NOTHING;
