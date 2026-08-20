import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../../src/rules/alerts/tokenBucket';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('TokenBucket', () => {
  it('allows a burst of exactly `capacityPerSecond` takes, then runs dry', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 3, now: clock.now });
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('refills continuously with elapsed time', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 4, now: clock.now });
    for (let i = 0; i < 4; i++) bucket.tryTake(); // drain
    expect(bucket.tryTake()).toBe(false);
    clock.advance(250); // 0.25 s × 4/s = exactly 1 token
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('a failed take does not lose accumulated fractional tokens', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 4, now: clock.now });
    for (let i = 0; i < 4; i++) bucket.tryTake();
    clock.advance(125); // 0.5 tokens
    expect(bucket.tryTake()).toBe(false); // refills, fails, keeps the 0.5
    clock.advance(125); // +0.5 → 1.0
    expect(bucket.tryTake()).toBe(true);
  });

  it('never accumulates beyond capacity after long idle', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 2, now: clock.now });
    clock.advance(60_000);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('setCapacity lowers the rate and clamps stored tokens', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 4, now: clock.now });
    bucket.setCapacity(2); // stored 4 → clamped to 2
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    clock.advance(500); // 0.5 s × 2/s = 1 token at the NEW rate
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('setCapacity mid-flight refills at the old rate up to the switch point', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 4, now: clock.now });
    for (let i = 0; i < 4; i++) bucket.tryTake(); // drain at t=0
    clock.advance(250);    // 1 token accrues at 4/s
    bucket.setCapacity(1); // refill happens BEFORE the rate swap; 1 ≤ new cap 1 kept
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    clock.advance(1000);   // 1 token at 1/s
    expect(bucket.tryTake()).toBe(true);
  });

  it('raising capacity does not grant instant tokens', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacityPerSecond: 1, now: clock.now });
    bucket.tryTake(); // drain
    bucket.setCapacity(5);
    expect(bucket.tryTake()).toBe(false); // capacity is a cap, not a grant
    clock.advance(200); // 0.2 s × 5/s = 1 token
    expect(bucket.tryTake()).toBe(true);
  });
});
