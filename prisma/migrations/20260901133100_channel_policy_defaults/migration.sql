UPDATE "Channel"
SET "settlementCycle" = 'MONTHLY',
    "billingTrigger" = 'EXTERNAL_STATEMENT'
WHERE "type" = 'CONSIGNMENT'
  AND "settlementCycle" IS NULL
  AND "billingTrigger" IS NULL;

UPDATE "Channel"
SET "settlementCycle" = 'PER_SHIPMENT',
    "billingTrigger" = 'DELIVERED',
    "billingWithinDays" = COALESCE("billingWithinDays", 7)
WHERE "type" = 'BUYOUT'
  AND "settlementCycle" IS NULL
  AND "billingTrigger" IS NULL;
