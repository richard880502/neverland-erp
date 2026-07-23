import { Prisma } from "@prisma/client";
import { getGoogleSheetConnectionSetting, getGoogleSheetSyncConfig } from "@/lib/google-sheet-source";
import { processGoogleSheetMovementQueue } from "@/lib/google-sheet-movement-queue";
import { runScheduledGoogleSheetSync } from "@/lib/google-sheet-sync";

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

export async function runGoogleSheetSyncIfDue(now = new Date()) {
  const config = getGoogleSheetSyncConfig();
  const connection = await getGoogleSheetConnectionSetting();
  if (!connection.automaticSyncEnabled) return { ran: false, reason: "disabled" };
  if (!config.hasCredentials && process.env.NODE_ENV === "production") return { ran: false, reason: "credentials_missing" };

  const parts = localParts(now, connection.syncTimeZone);
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const scheduledMinutes = connection.syncHour * 60 + connection.syncMinute;
  if (currentMinutes < scheduledMinutes) return { ran: false, reason: "not_due" };

  const scheduleKey = `${parts.year}-${parts.month}-${parts.day}@${connection.syncTimeZone}@${String(connection.syncHour).padStart(2, "0")}:${String(connection.syncMinute).padStart(2, "0")}`;
  try {
    const run = await runScheduledGoogleSheetSync(scheduleKey);
    const movementQueue = await processGoogleSheetMovementQueue();
    return { ran: true, runId: run.id, status: run.status, movementQueue };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ran: false, reason: "already_ran" };
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
