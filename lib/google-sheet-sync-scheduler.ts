import { getGoogleSheetConnectionSetting, getGoogleSheetSyncConfig } from "@/lib/google-sheet-source";
import { processGoogleSheetMovementQueue } from "@/lib/google-sheet-movement-queue";
import { enqueueGoogleSheetProductBackfill } from "@/lib/google-sheet-product-queue";

const globalScheduler = globalThis as unknown as { googleSheetSchedulerStarted?: boolean };

async function flushGoogleSheetQueues() {
  const backfilledProducts = await enqueueGoogleSheetProductBackfill();
  const movementQueue = await processGoogleSheetMovementQueue();
  return { backfilledProducts, movementQueue };
}

export async function runGoogleSheetSyncIfDue() {
  const config = getGoogleSheetSyncConfig();
  const connection = await getGoogleSheetConnectionSetting();
  if (!connection.automaticSyncEnabled) return { ran: false, reason: "disabled" };
  if (!config.hasCredentials && process.env.NODE_ENV === "production") return { ran: false, reason: "credentials_missing" };

  // ERP is the product source of truth. The scheduler only flushes ERP outbound
  // queues; it never imports Sheet rows into product master data.
  const result = await flushGoogleSheetQueues();
  return { ran: true, reason: "erp_outbound", ...result };
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
