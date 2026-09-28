interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window failure counter. In-memory is fine for a single server
 * process; move to Redis if the backend is ever scaled to several instances.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly maxFailures: number, private readonly windowMs: number) {
    setInterval(() => this.sweep(), windowMs).unref();
  }

  /** Milliseconds until `key` may try again, or 0 if it isn't blocked. */
  blockedFor(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= Date.now()) return 0;
    return bucket.count >= this.maxFailures ? bucket.resetAt - Date.now() : 0;
  }

  fail(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      bucket.count += 1;
    }
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}
