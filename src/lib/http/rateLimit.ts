/**
 * Minimal fixed-window, in-memory rate limiter keyed by client + route.
 *
 * Limitation (documented in README): state is per server instance, so on
 * serverless platforms with many instances the effective limit is higher.
 * Put a shared limiter (e.g. at the edge/CDN) in front for production.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
    if (this.buckets.size > 10_000) this.sweep(t);
    const allowed = b.count <= this.limit;
    return { allowed, remaining: Math.max(0, this.limit - b.count), retryAfterSeconds: Math.ceil((b.resetAt - t) / 1000) };
  }

  private sweep(t: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
  }
}

const limiters = new Map<string, RateLimiter>();

/** Shared per-route limiter (created on first use). */
export function limiterFor(route: string, limit: number, windowMs = 60_000): RateLimiter {
  let l = limiters.get(route);
  if (!l) {
    l = new RateLimiter(limit, windowMs);
    limiters.set(route, l);
  }
  return l;
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return ip;
}
