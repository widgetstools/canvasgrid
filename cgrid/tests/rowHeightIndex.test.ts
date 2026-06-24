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
