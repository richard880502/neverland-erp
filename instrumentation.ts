export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startGoogleSheetSyncScheduler } = await import("@/lib/google-sheet-sync-scheduler");
    startGoogleSheetSyncScheduler();
  }
}
