// Continuous-refill token bucket — the global maxNotificationsPerSecond
// limiter (spec §4.3). `capacityPerSecond` doubles as burst capacity and
// refill rate (N tokens max, refilling at N/s). Date-free: callers inject
// `now` (ms) — the bridge (Task 15) supplies a performance.now() wrapper.

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private lastRefillMs: number;
  private readonly now: () => number;

  constructor(opts: { capacityPerSecond: number; now: () => number }) {
    this.capacity = opts.capacityPerSecond;
    this.tokens = opts.capacityPerSecond; // starts full — allows an initial burst
    this.now = opts.now;
    this.lastRefillMs = opts.now();
  }

  /** Refill by elapsed time, then take one token if at least one is stored. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Adjust capacity + refill rate. Refills at the OLD rate up to now, then
   *  clamps stored tokens to the new capacity (raising never grants tokens). */
  setCapacity(capacityPerSecond: number): void {
    this.refill();
    this.capacity = capacityPerSecond;
    if (this.tokens > capacityPerSecond) this.tokens = capacityPerSecond;
  }

  private refill(): void {
    const nowMs = this.now();
    const elapsedMs = nowMs - this.lastRefillMs;
    this.lastRefillMs = nowMs;
    if (elapsedMs <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1000) * this.capacity);
  }
}
