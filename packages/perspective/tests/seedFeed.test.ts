import { describe, it, expect } from 'vitest';
import { seedNotional } from '../src/book';

/**
 * Seed-feed data realism: notional is a position's SIZE, not a price.
 *
 * The live tick rebuilds rows through `makeSeedRow`, which used to draw
 * notional from the rolling feed RNG. An existing position therefore got a
 * brand-new size on every tick: the Notional column churned, and so did every
 * group / pivot total summing it — on a feed that is only meant to move
 * prices. Measured in the browser before the fix, 7 of 25 visible positions
 * changed notional within 6 seconds; after, 0 of 25 (while pnl and
 * marketValue kept ticking).
 *
 * The invariant that prevents regression is that notional depends on the
 * position index ALONE. A generator that consumes the shared feed RNG cannot
 * satisfy these.
 */

describe('seedNotional — stable position size', () => {
  it('is deterministic for a given position index', () => {
    for (const i of [0, 1, 7, 42, 999, 4999]) {
      expect(seedNotional(i)).toBe(seedNotional(i));
    }
  });

  it('does not depend on how much RNG the feed has consumed', () => {
    // This is the actual bug: the tick called the generator again, later in
    // the RNG stream, and got a different size for the same position.
    const before = seedNotional(1234);
    for (let i = 0; i < 5_000; i++) seedNotional(i);
    expect(seedNotional(1234)).toBe(before);
  });

  it('still varies across positions (not pinned to a constant)', () => {
    // Killing the churn by making every notional identical would "fix" the
    // symptom and make the column meaningless.
    const values = Array.from({ length: 200 }, (_, i) => seedNotional(i));
    expect(new Set(values).size).toBeGreaterThan(150);
  });

  it('stays in the intended magnitude range', () => {
    for (let i = 0; i < 500; i++) {
      const v = seedNotional(i);
      expect(v).toBeGreaterThanOrEqual(50_000);
      expect(v).toBeLessThanOrEqual(5_050_000);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
