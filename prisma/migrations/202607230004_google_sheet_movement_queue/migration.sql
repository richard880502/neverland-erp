ALTER TABLE "GoogleSheetConnection"
ADD COLUMN "automaticSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "syncTimeZone" TEXT NOT NULL DEFAULT 'Asia/Taipei',
ADD COLUMN "syncHour" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "syncMinute" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "GoogleSheetMovementQueue" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
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

    CONSTRAINT "GoogleSheetMovementQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleSheetMovementQueue_movementId_key" ON "GoogleSheetMovementQueue"("movementId");
CREATE INDEX "GoogleSheetMovementQueue_status_nextAttemptAt_idx" ON "GoogleSheetMovementQueue"("status", "nextAttemptAt");
CREATE INDEX "GoogleSheetMovementQueue_processingToken_idx" ON "GoogleSheetMovementQueue"("processingToken");
CREATE INDEX "GoogleSheetMovementQueue_createdAt_idx" ON "GoogleSheetMovementQueue"("createdAt");

ALTER TABLE "GoogleSheetMovementQueue"
ADD CONSTRAINT "GoogleSheetMovementQueue_movementId_fkey"
FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
