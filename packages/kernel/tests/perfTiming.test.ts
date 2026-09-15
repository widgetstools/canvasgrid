// The timing helpers must still be able to FAIL.
//
// Making a flaky perf test stable is easy to get wrong in the one way that
// matters: a helper that always returns a small number, or a ratio that is
// always ~1, turns every assertion built on it into a no-op. The suite would
// go green and stay green through a genuine regression, which is strictly
// worse than the flakiness it replaced.
//
// So these assert the helpers detect a difference that is really there, using
// work sized so the gap is far larger than the noise the helpers exist to
// absorb.
import { describe, it, expect } from 'vitest';
import { fastestOf, timingRatio } from './helpers/perfTiming';

/** Busy work, scaled by `n`. Deliberately not a sleep — these helpers measure
 *  CPU time, and the thing under test in the real suites is CPU-bound. */
function spin(n: number): () => void {
  return () => {
    let sink = 0;
    for (let i = 0; i < n; i++) sink += Math.sqrt(i);
    if (sink < 0) throw new Error('unreachable — keeps the loop from being elided');
  };
}

describe('fastestOf', () => {
  it('reports roughly the cost of the work, not zero', () => {
    expect(fastestOf(spin(2_000_000))).toBeGreaterThan(0);
  });

  it('scales with the work it is given', () => {
    // If it did not, every budget assertion in the perf suites would be
    // measuring nothing.
    const small = fastestOf(spin(200_000));
    const large = fastestOf(spin(20_000_000));
    expect(large).toBeGreaterThan(small * 10);
  });

  it('runs the function the number of times it says', () => {
    let calls = 0;
    fastestOf(() => { calls += 1; }, 5, 2);
    expect(calls, '2 warm-ups + 5 timed').toBe(7);
  });
});

describe('timingRatio', () => {
  it('is near 1 for the same work on both sides', () => {
    // The property that makes it usable as a regression check: identical code
    // must not read as a difference. This is exactly what the pivot
    // strict/non-strict test was failing on before, at a ratio of ~7.
    expect(timingRatio(spin(4_000_000), spin(4_000_000))).toBeLessThan(3);
  });

  it('DETECTS a genuine order-of-magnitude difference', () => {
    // The assertion that keeps every `expect(timingRatio(...)).toBeLessThan(5)`
    // in the perf suites honest. A helper that always answered ~1 would make
    // all of them vacuous.
    expect(timingRatio(spin(200_000), spin(40_000_000))).toBeGreaterThan(5);
  });

  it('is symmetric — it reports the gap, not which side was slower', () => {
    const a = timingRatio(spin(200_000), spin(20_000_000));
    const b = timingRatio(spin(20_000_000), spin(200_000));
    expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.5);
  });

  it('does not divide by a number below the clock resolution', () => {
    // Two operations too small to time would otherwise produce a ratio of two
    // rounding errors — which is a random number, not a measurement.
    const ratio = timingRatio(() => { /* nothing */ }, () => { /* nothing */ });
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeLessThan(3);
  });
});
