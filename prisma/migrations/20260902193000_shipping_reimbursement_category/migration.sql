INSERT INTO "FinanceCategory" ("id", "code", "name", "direction", "parentId", "active") VALUES
  ('fin_cat_shipping_reimbursement', 'shipping_reimbursement', '運費代墊回收', 'INCOME', NULL, true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "direction" = EXCLUDED."direction",
  "active" = true;
