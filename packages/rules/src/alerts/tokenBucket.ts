// Continuous-refill token bucket. Ships in Task 6.
export class TokenBucket {
  constructor(_opts: { capacityPerSecond: number; now: () => number }) {
    throw new Error('not-yet-implemented: TokenBucket ships in Task 6');
  }
  tryTake(): boolean { throw new Error('not-yet-implemented'); }
  setCapacity(_capacityPerSecond: number): void { throw new Error('not-yet-implemented'); }
}
