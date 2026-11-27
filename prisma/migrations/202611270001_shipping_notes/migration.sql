CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'DISPATCHED');
CREATE TYPE "ShipmentKind" AS ENUM ('CONSIGNMENT', 'BUYOUT');
ALTER TABLE "Channel" ADD COLUMN "shippingWorkbookId" TEXT, ADD COLUMN "shippingTemplateTab" TEXT;
CREATE TABLE "Shipment" (
  "id" TEXT PRIMARY KEY, "channelId" TEXT NOT NULL REFERENCES "Channel"("id"),
  "kind" "ShipmentKind" NOT NULL DEFAULT 'CONSIGNMENT', "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
  "plannedDate" TIMESTAMP(3), "dispatchedAt" TIMESTAMP(3), "recipient" TEXT, "contactPhone" TEXT, "address" TEXT, "note" TEXT,
  "shippingMethod" TEXT, "freightActual" DECIMAL(12,2), "freightPaid" DECIMAL(12,2), "freightRecoverable" DECIMAL(12,2),
  "sheetSpreadsheetId" TEXT, "sheetTabId" INTEGER, "sheetTabName" TEXT, "sheetUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Shipment_channelId_createdAt_idx" ON "Shipment"("channelId", "createdAt");
CREATE TABLE "ShipmentLine" (
  "id" TEXT PRIMARY KEY, "shipmentId" TEXT NOT NULL REFERENCES "Shipment"("id") ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id"), "sku" TEXT NOT NULL, "name" TEXT NOT NULL, "size" TEXT,
  "quantity" INTEGER NOT NULL, "retailPrice" DECIMAL(12,2) NOT NULL, "tradePrice" DECIMAL(12,2) NOT NULL,
  "movementId" TEXT UNIQUE REFERENCES "StockMovement"("id"), UNIQUE ("shipmentId", "productId")
);

CREATE TABLE "ShippingGroup" (
 "key" TEXT PRIMARY KEY, "channelId" TEXT, "actualAmount" DECIMAL(12,2), "paidAmount" DECIMAL(12,2), "recoverableAmount" DECIMAL(12,2), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "BillingShippingClaim" (
 "id" TEXT PRIMARY KEY, "groupKey" TEXT NOT NULL UNIQUE REFERENCES "ShippingGroup"("key"), "statementId" TEXT NOT NULL REFERENCES "BillingStatement"("id") ON DELETE CASCADE, "amount" DECIMAL(12,2) NOT NULL
);
CREATE INDEX "BillingShippingClaim_statementId_idx" ON "BillingShippingClaim"("statementId");
