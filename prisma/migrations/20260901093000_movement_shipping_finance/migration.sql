ALTER TABLE "Channel"
  ADD COLUMN "defaultShippingMethod" TEXT,
  ADD COLUMN "defaultShippingFee" DECIMAL(12,2),
  ADD COLUMN "defaultShippingPayer" TEXT;

ALTER TABLE "StockMovement"
  ADD COLUMN "shippingMethod" TEXT,
  ADD COLUMN "shippingFee" DECIMAL(12,2),
  ADD COLUMN "shippingPayer" TEXT,
  ADD COLUMN "shippingGroupKey" TEXT;

CREATE INDEX "StockMovement_shippingGroupKey_idx"
  ON "StockMovement"("shippingGroupKey");
