UPDATE "Channel"
SET
  "settlementCycle" = COALESCE("settlementCycle", 'PER_PAYOUT'::"SettlementCycle"),
  "billingTrigger" = COALESCE("billingTrigger", 'PAYOUT_RECEIVED'::"BillingTrigger")
WHERE "type" = 'DIRECT';
