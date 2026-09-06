CREATE TABLE "GoogleSheetProductQueue" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "sku" TEXT NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'UPSERT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingToken" TEXT,
    "lastError" TEXT,
    "spreadsheetId" TEXT,
    "sheetRow" INTEGER,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleSheetProductQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GoogleSheetProductQueue_productId_idx" ON "GoogleSheetProductQueue"("productId");
CREATE INDEX "GoogleSheetProductQueue_sku_createdAt_idx" ON "GoogleSheetProductQueue"("sku", "createdAt");
CREATE INDEX "GoogleSheetProductQueue_status_nextAttemptAt_idx" ON "GoogleSheetProductQueue"("status", "nextAttemptAt");
CREATE INDEX "GoogleSheetProductQueue_processingToken_idx" ON "GoogleSheetProductQueue"("processingToken");
CREATE INDEX "GoogleSheetProductQueue_createdAt_idx" ON "GoogleSheetProductQueue"("createdAt");

ALTER TABLE "GoogleSheetProductQueue"
ADD CONSTRAINT "GoogleSheetProductQueue_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
