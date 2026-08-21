CREATE TABLE "McpPreparedAction" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpPreparedAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpPreparedAction_tokenHash_key" ON "McpPreparedAction"("tokenHash");
CREATE INDEX "McpPreparedAction_connectionId_consumedAt_idx" ON "McpPreparedAction"("connectionId", "consumedAt");
CREATE INDEX "McpPreparedAction_expiresAt_idx" ON "McpPreparedAction"("expiresAt");
