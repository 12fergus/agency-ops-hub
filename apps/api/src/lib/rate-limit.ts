/**
 * In-memory fixed-window limiter. Adequate for ONE API process on one office host
 * (state resets on restart, which only ever relaxes limits). No dependency needed.
 * Memory is hard-capped: when full, expired entries are dropped, then the oldest.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Seconds until the key may try again, or 0 if it is currently allowed. */
  retryAfter(key: string): number {
    const e = this.hits.get(key);
    if (!e || e.resetAt <= this.now()) return 0;
    return e.count >= this.max ? Math.ceil((e.resetAt - this.now()) / 1000) : 0;
  }

  hit(key: string): void {
    const t = this.now();
    const e = this.hits.get(key);
    if (e && e.resetAt > t) {
      e.count += 1;
      return;
    }
    if (!e && this.hits.size >= this.maxKeys) this.makeRoom(t);
    this.hits.delete(key); // re-insert so Map order stays oldest-first
    this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  get size(): number {
    return this.hits.size;
  }

  /** Amortised: frees ~10% so this O(n) pass runs at most once per ~maxKeys/10 new keys. */
  private makeRoom(t: number): void {
    for (const [k, e] of this.hits) if (e.resetAt <= t) this.hits.delete(k);
    const target = Math.floor(this.maxKeys * 0.9);
    for (const k of this.hits.keys()) {
      if (this.hits.size <= target) break;
      this.hits.delete(k);
    }
  }
}
