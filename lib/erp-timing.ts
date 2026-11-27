const slowThresholdMs = 250;

export async function measureErpLoad<T>(stage: string, load: () => PromiseLike<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await load();
    const durationMs = Math.round(performance.now() - started);
    if (durationMs >= slowThresholdMs || process.env.ERP_TIMING_LOG_ALL === "true") {
      console.info("[erp-timing]", { stage, durationMs });
    }
    return result;
  } catch (error) {
    console.info("[erp-timing]", { stage, durationMs: Math.round(performance.now() - started), failed: true });
    throw error;
  }
}
