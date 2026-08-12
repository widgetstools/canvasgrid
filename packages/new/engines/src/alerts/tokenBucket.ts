/** Continuous-refill token bucket — maxNotificationsPerSecond limiter. */

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private lastRefillMs: number;
  private readonly now: () => number;

  constructor(opts: { capacityPerSecond: number; now?: () => number }) {
    this.capacity = opts.capacityPerSecond;
    this.tokens = opts.capacityPerSecond;
    this.now = opts.now ?? (() => Date.now());
    this.lastRefillMs = this.now();
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

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
