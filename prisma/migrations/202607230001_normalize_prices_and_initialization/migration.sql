UPDATE "Product"
SET "listPrice" = 3080.00
WHERE "sku" IN ('N202509-01', 'N202509-02', 'N202509-03');

UPDATE "StockMovement" AS movement
SET "unitPrice" = 3080.00
FROM "Product" AS product
WHERE movement."productId" = product."id"
  AND product."sku" IN ('N202509-01', 'N202509-02', 'N202509-03')
  AND movement."type" IN ('SHIP', 'CONSIGN_SOLD', 'BUYOUT')
  AND movement."unitPrice" IS NULL;

UPDATE "StockMovement"
SET "channelId" = NULL
WHERE "channelId" IN (
  SELECT "id"
  FROM "Channel"
  WHERE "name" = '初始化'
);

DELETE FROM "Channel"
WHERE "name" = '初始化';
