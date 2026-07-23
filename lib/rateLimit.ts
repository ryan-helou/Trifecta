// Tiny in-memory rate limiter. Trifecta runs friends-scale on one (or a few)
// Railway instances, so a process-local fixed-window counter is enough — it
// matches the existing crude coach/intake limiters. If this ever scales
// horizontally, swap the backing Map for a shared store (Redis/Postgres).

const g = globalThis as unknown as {
  __rl?: Map<string, { count: number; resetAt: number }>;
};

export interface RateResult {
  ok: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSec: number;
}

/** Fixed-window limiter: allow up to `max` hits per `windowMs` for `key`. */
export function rateLimit(key: string, max: number, windowMs: number): RateResult {
  if (!g.__rl) g.__rl = new Map();
  const map = g.__rl;
  const now = Date.now();
  const rec = map.get(key);
  if (!rec || now >= rec.resetAt) {
    // opportunistic prune so the map can't grow without bound (IP/username keys)
    if (map.size > 5000) for (const [k, v] of map) if (now >= v.resetAt) map.delete(k);
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (rec.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)) };
  }
  rec.count++;
  return { ok: true, retryAfterSec: 0 };
}

/** Best-effort client IP from proxy headers (Railway sets x-forwarded-for). */
export function clientIp(req: { headers: Headers }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}
