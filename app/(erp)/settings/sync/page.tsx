import { redirect } from "next/navigation";
import { GoogleSheetSyncManager } from "@/components/GoogleSheetSyncManager";
import { getCurrentUser } from "@/lib/auth";
import { getGoogleSheetConnectionSetting, getGoogleSheetSyncConfig } from "@/lib/google-sheet-source";
import { prisma } from "@/lib/prisma";
import { getGoogleSheetMovementQueueSummary } from "@/lib/google-sheet-movement-queue";

export default async function GoogleSheetSyncPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/");

  const connection = await getGoogleSheetConnectionSetting();
  const [runs, stateCount, movementQueue] = await Promise.all([
    prisma.googleSheetSyncRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        mode: true,
        status: true,
        source: true,
        spreadsheetTitle: true,
        sourceFetchedAt: true,
        summary: true,
        error: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    prisma.googleSheetEntityState.count({ where: { spreadsheetId: connection.spreadsheetId } }),
    getGoogleSheetMovementQueueSummary(),
  ]);
  const config = getGoogleSheetSyncConfig();

  return <GoogleSheetSyncManager
    config={{
      ...config,
      spreadsheetId: connection.spreadsheetId,
      enabled: connection.automaticSyncEnabled,
      timeZone: connection.syncTimeZone,
      hour: connection.syncHour,
      minute: connection.syncMinute,
      scheduleLabel: `${String(connection.syncHour).padStart(2, "0")}:${String(connection.syncMinute).padStart(2, "0")}`,
      stateCount,
    }}
    connection={{
      ...connection,
      lastTestedAt: connection.lastTestedAt?.toISOString() ?? null,
    }}
    movementQueue={{
      counts: movementQueue.counts,
      recent: movementQueue.recent.map((item) => ({
        id: item.id,
        status: item.status,
        attempts: item.attempts,
        lastError: item.lastError,
        sheetRow: item.sheetRow,
        syncedAt: item.syncedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        movement: {
          id: item.movement.id,
          occurredAt: item.movement.occurredAt.toISOString(),
          type: item.movement.type,
          quantity: item.movement.quantity,
          unitPrice: item.movement.unitPrice == null ? null : Number(item.movement.unitPrice),
          product: item.movement.product,
          channel: item.movement.channel,
        },
      })),
    }}
    history={runs.map((run) => ({
      ...run,
      sourceFetchedAt: run.sourceFetchedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    }))}
  />;
}
