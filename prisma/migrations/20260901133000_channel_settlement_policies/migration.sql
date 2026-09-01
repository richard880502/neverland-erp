CREATE TYPE "SettlementCycle" AS ENUM ('MONTHLY', 'PER_SHIPMENT', 'MANUAL');
CREATE TYPE "BillingTrigger" AS ENUM ('EXTERNAL_STATEMENT', 'DELIVERED', 'SHIPPED', 'MANUAL');

ALTER TABLE "Channel"
  ADD COLUMN "settlementCycle" "SettlementCycle",
  ADD COLUMN "billingTrigger" "BillingTrigger",
  ADD COLUMN "billingWithinDays" INTEGER,
  ADD COLUMN "includeShippingInBilling" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requiresSalesInvoice" BOOLEAN NOT NULL DEFAULT false;
