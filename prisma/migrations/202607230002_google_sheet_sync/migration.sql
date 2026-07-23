CREATE TABLE "GoogleSheetSyncRun" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetTitle" TEXT,
    "sourceFetchedAt" TIMESTAMP(3),
    "sourceDigest" TEXT,
    "summary" JSONB,
    "items" JSONB,
    "error" TEXT,
    "scheduleKey" TEXT,
    "requestedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleSheetSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleSheetEntityState" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "databaseHash" TEXT NOT NULL,
    "sourceRow" INTEGER,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleSheetEntityState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleSheetSyncRun_scheduleKey_key" ON "GoogleSheetSyncRun"("scheduleKey");
CREATE INDEX "GoogleSheetSyncRun_createdAt_idx" ON "GoogleSheetSyncRun"("createdAt");
CREATE INDEX "GoogleSheetSyncRun_mode_status_createdAt_idx" ON "GoogleSheetSyncRun"("mode", "status", "createdAt");
CREATE UNIQUE INDEX "GoogleSheetEntityState_entityType_entityKey_key" ON "GoogleSheetEntityState"("entityType", "entityKey");
CREATE INDEX "GoogleSheetEntityState_lastSyncedAt_idx" ON "GoogleSheetEntityState"("lastSyncedAt");

ALTER TABLE "GoogleSheetSyncRun"
ADD CONSTRAINT "GoogleSheetSyncRun_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
