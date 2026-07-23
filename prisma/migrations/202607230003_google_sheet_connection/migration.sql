CREATE TABLE "GoogleSheetConnection" (
    "id" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetTitle" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestSource" TEXT,
    "lastTestError" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleSheetConnection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoogleSheetEntityState"
ADD COLUMN "spreadsheetId" TEXT NOT NULL
DEFAULT '121W1NjIfpNk_nDX9TcpjtiaqokXKLwaOoPujQRoKaRE';

ALTER TABLE "GoogleSheetEntityState" ALTER COLUMN "spreadsheetId" DROP DEFAULT;

DROP INDEX "GoogleSheetEntityState_entityType_entityKey_key";

CREATE UNIQUE INDEX "GoogleSheetEntityState_spreadsheetId_entityType_entityKey_key"
ON "GoogleSheetEntityState"("spreadsheetId", "entityType", "entityKey");

ALTER TABLE "GoogleSheetConnection"
ADD CONSTRAINT "GoogleSheetConnection_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
