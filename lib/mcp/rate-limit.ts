const buckets = new Map<string, { count: number; resetAt: number }>();

/** Lightweight per-instance protection. Deployments should additionally rate-limit at the edge. */
export function takeRateLimit(key: string, limit = 120, windowMs = 60_000) {
  const now = Date.now(); const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return { allowed: true, retryAfter: 0 }; }
  existing.count += 1; return { allowed: existing.count <= limit, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
}
