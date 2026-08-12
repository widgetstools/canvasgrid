import { describe, it, expect } from 'vitest';
import { expandRangeForScrollDelta, expandRangeForVelocity } from '../src/core/prefetchRange';

/**
 * Cycle 25 / Task 8 — pre-emptive viewport fetch on high scroll velocity.
 *
 * When the user is scrolling fast we widen the requested row range in
 * the scroll direction so the chunk that comes back already covers the
 * about-to-be-visible rows. The amount is proportional to velocity and
 * capped — at the default cap we don't ask the worker for more than
 * ~250 extra rows in one direction, otherwise a frantic fling pulls 50k.
 */

describe('expandRangeForVelocity', () => {
  it('returns the input range unchanged when velocity is below the threshold', () => {
    expect(expandRangeForVelocity(100, 150, 0)).toEqual({ rowStart: 100, rowEnd: 150 });
    expect(expandRangeForVelocity(100, 150, 0.4)).toEqual({ rowStart: 100, rowEnd: 150 });
    expect(expandRangeForVelocity(100, 150, -0.4)).toEqual({ rowStart: 100, rowEnd: 150 });
  });

  it('extends rowEnd when scrolling downward at ordinary wheel velocity', () => {
    const r = expandRangeForVelocity(100, 150, 1);
    expect(r.rowStart).toBe(100);
    expect(r.rowEnd).toBeGreaterThan(150);
  });

  it('extends rowEnd when scrolling downward', () => {
    const r = expandRangeForVelocity(100, 150, 10);
    expect(r.rowStart).toBe(100);
    expect(r.rowEnd).toBeGreaterThan(150);
  });

  it('extends rowStart when scrolling upward (and clamps to 0)', () => {
    const r = expandRangeForVelocity(100, 150, -10);
    expect(r.rowStart).toBeLessThan(100);
    expect(r.rowEnd).toBe(150);
    const r2 = expandRangeForVelocity(5, 50, -200);
    expect(r2.rowStart).toBe(0);
  });

  it('caps the prefetch at maxPrefetch even under absurd velocity', () => {
    const r = expandRangeForVelocity(0, 50, 9999, { maxPrefetch: 100 });
    expect(r.rowEnd).toBe(150);
  });

  it('scales the prefetch with the multiplier', () => {
    const slow = expandRangeForVelocity(100, 150, 10, { multiplier: 2 }).rowEnd - 150;
    const fast = expandRangeForVelocity(100, 150, 10, { multiplier: 6 }).rowEnd - 150;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('expandRangeForScrollDelta', () => {
  it('returns the input range unchanged for small (arrow-key) deltas', () => {
    expect(expandRangeForScrollDelta(100, 150, 0)).toEqual({ rowStart: 100, rowEnd: 150 });
    expect(expandRangeForScrollDelta(100, 150, 7)).toEqual({ rowStart: 100, rowEnd: 150 });
    expect(expandRangeForScrollDelta(100, 150, -7)).toEqual({ rowStart: 100, rowEnd: 150 });
  });

  it('extends rowEnd by at least one page on a downward PageDown-sized jump', () => {
    const r = expandRangeForScrollDelta(100, 150, 20);
    expect(r.rowStart).toBe(100);
    // window is 50 rows → page prefetch ≥ 50
    expect(r.rowEnd).toBeGreaterThanOrEqual(200);
  });

  it('extends rowStart on an upward jump and clamps to 0', () => {
    const r = expandRangeForScrollDelta(100, 150, -20);
    expect(r.rowStart).toBeLessThanOrEqual(50);
    expect(r.rowEnd).toBe(150);
    const r2 = expandRangeForScrollDelta(10, 60, -40);
    expect(r2.rowStart).toBe(0);
  });
});
