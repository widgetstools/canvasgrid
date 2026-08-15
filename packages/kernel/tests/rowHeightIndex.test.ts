import { describe, it, expect } from 'vitest';
import { RowHeightIndex } from '../src/core/rowHeightIndex';

/** Brute-force reference: sum of heights[0..i-1]. */
function bruteForceTopOf(heights: number[], i: number): number {
  let sum = 0;
  for (let k = 0; k < i; k++) sum += heights[k]!;
  return sum;
}

/** Brute-force reference: first row k such that topOf(k) <= y < topOf(k+1). */
function bruteForceRowAt(heights: number[], y: number): number {
  if (heights.length === 0) return 0;
  if (y < 0) return 0;
  let acc = 0;
  for (let k = 0; k < heights.length; k++) {
    const next = acc + heights[k]!;
    if (y < next) return k;
    acc = next;
  }
  return heights.length - 1;
}

describe('RowHeightIndex — correctness vs brute force', () => {
  it('length 0 reports zero total, topOf(0)=0, length()=0', () => {
    const idx = new RowHeightIndex(0, () => 30);
    expect(idx.length()).toBe(0);
    expect(idx.totalHeight()).toBe(0);
    expect(idx.topOf(0)).toBe(0);
  });

  it('length 1 — topOf, rowAt, totalHeight, update round-trip', () => {
    const idx = new RowHeightIndex(1, () => 30);
    expect(idx.length()).toBe(1);
    expect(idx.totalHeight()).toBe(30);
    expect(idx.topOf(0)).toBe(0);
    expect(idx.topOf(1)).toBe(30);
    expect(idx.rowAt(0)).toBe(0);
    expect(idx.rowAt(15)).toBe(0);
    expect(idx.rowAt(29)).toBe(0);

    idx.update(0, 50);
    expect(idx.totalHeight()).toBe(50);
    expect(idx.topOf(1)).toBe(50);
    expect(idx.heightAt(0)).toBe(50);
  });

  it('length 10 — exhaustive parity for topOf, rowAt across all pixels', () => {
    const heights = [30, 60, 30, 45, 30, 30, 80, 30, 100, 30];
    const idx = new RowHeightIndex(heights.length, (i) => heights[i]!);

    const expectedTotal = heights.reduce((s, h) => s + h, 0);
    expect(idx.totalHeight()).toBe(expectedTotal);

    for (let i = 0; i <= heights.length; i++) {
      expect(idx.topOf(i)).toBe(bruteForceTopOf(heights, i));
    }
    for (let y = 0; y < expectedTotal; y++) {
      expect(idx.rowAt(y)).toBe(bruteForceRowAt(heights, y));
    }
  });

  it('length 1000 — sampled parity for topOf, rowAt; totalHeight matches', () => {
    const heights = Array.from({ length: 1000 }, (_, i) => 30 + (i % 7) * 10);
    const idx = new RowHeightIndex(heights.length, (i) => heights[i]!);

    const expectedTotal = heights.reduce((s, h) => s + h, 0);
    expect(idx.totalHeight()).toBe(expectedTotal);

    for (const i of [0, 1, 7, 100, 500, 999, 1000]) {
      expect(idx.topOf(i)).toBe(bruteForceTopOf(heights, i));
    }
    for (const y of [0, 1, 31, 500, 10_000, expectedTotal - 1]) {
      expect(idx.rowAt(y)).toBe(bruteForceRowAt(heights, y));
    }
  });

  it('update is reflected in totalHeight, topOf, and heightAt', () => {
    const heights = [30, 30, 30, 30];
    const idx = new RowHeightIndex(heights.length, (i) => heights[i]!);
    idx.update(1, 100);
    heights[1] = 100;
    expect(idx.totalHeight()).toBe(190);
    for (let i = 0; i <= heights.length; i++) {
      expect(idx.topOf(i)).toBe(bruteForceTopOf(heights, i));
    }
    expect(idx.heightAt(1)).toBe(100);
  });

  it('rowAt clamps y > totalHeight to the last row', () => {
    const heights = [30, 30, 30];
    const idx = new RowHeightIndex(heights.length, (i) => heights[i]!);
    expect(idx.rowAt(10_000)).toBe(2);
  });

  it('rowAt(0) returns 0', () => {
    const heights = [30, 30, 30];
    const idx = new RowHeightIndex(heights.length, (i) => heights[i]!);
    expect(idx.rowAt(0)).toBe(0);
  });

  it('insert shifts subsequent rows and grows totalHeight', () => {
    const heights = [30, 30, 30, 30];
    const idx = new RowHeightIndex(heights.length, (i) => heights[i]!);
    idx.insert(2, 100);
    expect(idx.length()).toBe(5);
    expect(idx.topOf(2)).toBe(60);
    expect(idx.topOf(3)).toBe(160);
    expect(idx.totalHeight()).toBe(220);
    expect(idx.heightAt(2)).toBe(100);
  });

  it('remove shrinks the index and shifts subsequent rows back', () => {
    const heights = [30, 30, 100, 30];
    const idx = new RowHeightIndex(heights.length, (i) => heights[i]!);
    expect(idx.totalHeight()).toBe(190);
    idx.remove(2);
    expect(idx.length()).toBe(3);
    expect(idx.totalHeight()).toBe(90);
    expect(idx.topOf(0)).toBe(0);
    expect(idx.topOf(1)).toBe(30);
    expect(idx.topOf(2)).toBe(60);
  });
});

describe('RowHeightIndex — perf gate at n = 1,000,000', () => {
  it('topOf + rowAt mean wall-clock < 50 µs', () => {
    const N = 1_000_000;
    const heights = new Float32Array(N);
    for (let i = 0; i < N; i++) heights[i] = 30 + (i % 7) * 10;

    const idx = new RowHeightIndex(N, (i) => heights[i]!);
    const total = idx.totalHeight();
    // Sanity — guard against accidental zero-init regressions silently
    // making the perf gate trivial.
    expect(total).toBeGreaterThan(N * 30);

    const iters = 5000;

    let startTop = performance.now();
    let acc = 0;
    for (let i = 0; i < iters; i++) acc += idx.topOf((i * 9973) % N);
    const meanTopUs = ((performance.now() - startTop) * 1000) / iters;

    let startRow = performance.now();
    let rowAcc = 0;
    for (let i = 0; i < iters; i++) rowAcc += idx.rowAt(((i * 9973) % iters) * (total / iters));
    const meanRowUs = ((performance.now() - startRow) * 1000) / iters;

    // Logging so Step 5 (record in worklog) is one tail away.
    // eslint-disable-next-line no-console
    console.log(`[rowHeightIndex perf @ n=${N}] topOf mean ${meanTopUs.toFixed(2)} µs, rowAt mean ${meanRowUs.toFixed(2)} µs`);
    expect(meanTopUs).toBeLessThan(50);
    expect(meanRowUs).toBeLessThan(50);
    // Touch accumulators so V8 can't dead-code the loop.
    expect(acc).toBeGreaterThan(0);
    expect(rowAcc).toBeGreaterThanOrEqual(0);
  });
});

// ─── A-P4 (production hardening) — uniform-height fast path ────────────────
//
// `VelocityGrid`'s `modelUpdated` handler rebuilt the whole Fenwick index
// (two fresh Float32Arrays + an O(n) BIT build) on EVERY transaction
// flush, even when the index it replaced was already all-fallback and the
// "rebuild" was therefore bit-identical. `isUniformAt(h)` answers "already
// exactly `new RowHeightIndex(length(), () => h)`" in O(1) so that case
// skips the realloc.
//
// These tests pin the guarantee that actually matters: `isUniformAt` is
// NEVER true unless every row really carries that height — a false
// positive would freeze stale per-row heights into scroll/paint math.

describe('RowHeightIndex.isUniformAt — A-P4 skip guard', () => {
  it('a constant-height index reports uniform at that height only', () => {
    const idx = new RowHeightIndex(100, () => 30);
    expect(idx.isUniformAt(30)).toBe(true);
    expect(idx.isUniformAt(31)).toBe(false);
    expect(idx.isUniformAt(0)).toBe(false);
  });

  it('an index built from mixed heights is never uniform', () => {
    const heights = [30, 30, 45, 30];
    const idx = new RowHeightIndex(heights.length, (i) => heights[i]!);
    expect(idx.isUniformAt(30)).toBe(false);
    expect(idx.isUniformAt(45)).toBe(false);
  });

  it('a single differing update ends uniformity', () => {
    const idx = new RowHeightIndex(50, () => 30);
    expect(idx.isUniformAt(30)).toBe(true);
    idx.update(17, 64);
    expect(idx.isUniformAt(30)).toBe(false);
    expect(idx.isUniformAt(64)).toBe(false);
    // …and the geometry the paint path reads is still exact.
    expect(idx.heightAt(17)).toBe(64);
    expect(idx.topOf(18)).toBe(17 * 30 + 64);
  });

  it('an update to the SAME height preserves uniformity', () => {
    const idx = new RowHeightIndex(10, () => 30);
    idx.update(3, 30);
    expect(idx.isUniformAt(30)).toBe(true);
  });

  it('a zero-length index trivially matches any height (rebuild is a no-op)', () => {
    const idx = new RowHeightIndex(0, () => 30);
    expect(idx.isUniformAt(30)).toBe(true);
    expect(idx.isUniformAt(99)).toBe(true);
  });

  it('never claims uniformity after a mixed build even if a later update equalises', () => {
    // Conservative direction: a false NEGATIVE only costs a rebuild.
    const heights = [30, 40];
    const idx = new RowHeightIndex(2, (i) => heights[i]!);
    idx.update(1, 30);
    expect(idx.isUniformAt(30)).toBe(false);
    // Geometry stays exact regardless.
    expect(idx.totalHeight()).toBe(60);
  });

  it('insert / remove drop the uniformity claim', () => {
    const a = new RowHeightIndex(4, () => 30);
    a.insert(2, 30);
    expect(a.isUniformAt(30)).toBe(false);
    expect(a.length()).toBe(5);
    expect(a.totalHeight()).toBe(150);

    const b = new RowHeightIndex(4, () => 30);
    b.remove(1);
    expect(b.isUniformAt(30)).toBe(false);
    expect(b.length()).toBe(3);
    expect(b.totalHeight()).toBe(90);
  });

  it('the skipped rebuild is observationally identical to an actual rebuild', () => {
    // The exact substitution VelocityGrid makes: when `isUniformAt` is
    // true, keeping the existing index must equal constructing a new one.
    const kept = new RowHeightIndex(1000, () => 24);
    const rebuilt = new RowHeightIndex(1000, () => 24);
    expect(kept.isUniformAt(24)).toBe(true);
    expect(kept.length()).toBe(rebuilt.length());
    expect(kept.totalHeight()).toBe(rebuilt.totalHeight());
    for (const i of [0, 1, 7, 63, 64, 511, 512, 999, 1000]) {
      expect(kept.topOf(i)).toBe(rebuilt.topOf(i));
    }
    for (const y of [0, 1, 23, 24, 25, 5000, 23999, 24000, 99999]) {
      expect(kept.rowAt(y)).toBe(rebuilt.rowAt(y));
    }
  });
});
