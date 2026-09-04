import { Prisma } from "@prisma/client";
import { getGoogleSheetConnectionSetting, getGoogleSheetSyncConfig } from "@/lib/google-sheet-source";
import { processGoogleSheetMovementQueue } from "@/lib/google-sheet-movement-queue";
import { runScheduledGoogleSheetSync } from "@/lib/google-sheet-sync";
import { prisma } from "@/lib/prisma";

const globalScheduler = globalThis as unknown as { googleSheetSchedulerStarted?: boolean };

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

async function flushGoogleSheetQueues() {
  // processGoogleSheetMovementQueue flushes the product queue first, then inventory movements.
  // Keeping this independent from the once-per-day workbook sync prevents new ERP writes
  // from being blocked just because today's scheduled import has already run.
  return processGoogleSheetMovementQueue();
}

export async function runGoogleSheetSyncIfDue(now = new Date()) {
  const config = getGoogleSheetSyncConfig();
  const connection = await getGoogleSheetConnectionSetting();
  if (!connection.automaticSyncEnabled) return { ran: false, reason: "disabled" };
  if (!config.hasCredentials && process.env.NODE_ENV === "production") return { ran: false, reason: "credentials_missing" };

  const parts = localParts(now, connection.syncTimeZone);
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const scheduledMinutes = connection.syncHour * 60 + connection.syncMinute;

  // Product/inventory outbox jobs are near-real-time and must not wait for the daily
  // workbook import time. This also means ERP-created products can reach 商品主檔
  // within the scheduler's one-minute polling interval.
  if (currentMinutes < scheduledMinutes) {
    const movementQueue = await flushGoogleSheetQueues();
    return { ran: false, reason: "not_due", movementQueue };
  }

  const scheduleKey = `${parts.year}-${parts.month}-${parts.day}@${connection.syncTimeZone}@${String(connection.syncHour).padStart(2, "0")}:${String(connection.syncMinute).padStart(2, "0")}`;

  // Avoid hitting the unique scheduleKey constraint every minute after today's run.
  // Even when the full workbook sync already ran, continue flushing outbound queues.
  const existing = await prisma.googleSheetSyncRun.findUnique({
    where: { scheduleKey },
    select: { id: true, status: true },
  });
  if (existing) {
    const movementQueue = await flushGoogleSheetQueues();
    return { ran: false, reason: "already_ran", runId: existing.id, status: existing.status, movementQueue };
  }

  try {
    const run = await runScheduledGoogleSheetSync(scheduleKey);
    const movementQueue = await flushGoogleSheetQueues();
    return { ran: true, runId: run.id, status: run.status, movementQueue };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // A second process may have created the same scheduleKey between the pre-check
      // and create(). Treat that as an idempotent race, but never skip the queues.
      const racedRun = await prisma.googleSheetSyncRun.findUnique({
        where: { scheduleKey },
        select: { id: true, status: true },
      });
      const movementQueue = await flushGoogleSheetQueues();
      return {
        ran: false,
        reason: "already_ran",
        runId: racedRun?.id,
        status: racedRun?.status,
        movementQueue,
      };
    }
    throw error;
  }
}

export function startGoogleSheetSyncScheduler() {
  if (globalScheduler.googleSheetSchedulerStarted) return;
  globalScheduler.googleSheetSchedulerStarted = true;

  const check = () => {
    runGoogleSheetSyncIfDue().catch((error) => {
      console.error("[google-sheet-sync] scheduled run failed", error);
    });
  };
  const initial = setTimeout(check, 10_000);
  const timer = setInterval(check, 60_000);
  initial.unref();
  timer.unref();
}
