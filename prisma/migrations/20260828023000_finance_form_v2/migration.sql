ALTER TABLE "FinanceTransaction"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "salesChannel" TEXT,
  ADD COLUMN "relatedParty" TEXT;

CREATE INDEX "FinanceTransaction_salesChannel_occurredAt_idx"
  ON "FinanceTransaction"("salesChannel", "occurredAt");

INSERT INTO "FinanceCategory" ("id", "code", "name", "direction", "parentId") VALUES
  ('fin_group_product_cost', 'expense_product_cost', '商品成本', 'EXPENSE', NULL),
  ('fin_group_logistics', 'expense_logistics', '物流', 'EXPENSE', NULL),
  ('fin_group_marketing', 'expense_marketing', '行銷', 'EXPENSE', NULL),
  ('fin_group_operations', 'expense_operations', '營運', 'EXPENSE', NULL)
ON CONFLICT ("code") DO NOTHING;

UPDATE "FinanceCategory"
SET "name" = '製作費', "parentId" = 'fin_group_product_cost'
WHERE "code" = 'production';

UPDATE "FinanceCategory"
SET "name" = '行銷 / 宣傳（舊分類）', "parentId" = 'fin_group_marketing'
WHERE "code" = 'marketing';

UPDATE "FinanceCategory"
SET "name" = '出貨運費', "parentId" = 'fin_group_logistics'
WHERE "code" = 'shipping';

UPDATE "FinanceCategory"
SET "name" = '其他', "parentId" = 'fin_group_operations'
WHERE "code" = 'admin';

INSERT INTO "FinanceCategory" ("id", "code", "name", "direction", "parentId") VALUES
  ('fin_cat_rework', 'rework', '再製費', 'EXPENSE', 'fin_group_product_cost'),
  ('fin_cat_inbound_shipping', 'inbound_shipping', '進貨運費', 'EXPENSE', 'fin_group_product_cost'),
  ('fin_cat_pr', 'pr', '公關品', 'EXPENSE', 'fin_group_marketing'),
  ('fin_cat_photography', 'photography', '拍攝', 'EXPENSE', 'fin_group_marketing'),
  ('fin_cat_studio', 'studio', '租棚費用', 'EXPENSE', 'fin_group_marketing'),
  ('fin_cat_ads', 'ads', '廣告費', 'EXPENSE', 'fin_group_marketing'),
  ('fin_cat_packaging', 'packaging', '包裝 / 文具', 'EXPENSE', 'fin_group_operations'),
  ('fin_cat_accounting', 'accounting', '會計', 'EXPENSE', 'fin_group_operations'),
  ('fin_cat_software', 'software', '網站 / 軟體', 'EXPENSE', 'fin_group_operations'),
  ('fin_cat_membership', 'membership', '會費', 'EXPENSE', 'fin_group_operations')
ON CONFLICT ("code") DO NOTHING;
