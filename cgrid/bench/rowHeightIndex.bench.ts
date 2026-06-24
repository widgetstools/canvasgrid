import { bench, describe } from 'vitest';
import { RowHeightIndex } from '../src/core/rowHeightIndex';

// Vitest bench harness for the Fenwick tree. Run with `npx vitest bench
// --run bench/rowHeightIndex.bench.ts` from `cgrid/`. The matching wall-clock
// gate lives in `tests/rowHeightIndex.test.ts` so a regression past 50 µs
// fails CI even without the bench command in the default test run.
//
// Cycle 5 / Task 7.

const N = 1_000_000;
const heights = new Float32Array(N);
for (let i = 0; i < N; i++) heights[i] = 30 + (i % 7) * 10;

const idx = new RowHeightIndex(N, (i) => heights[i]!);
const total = idx.totalHeight();

// Pre-compute query points so the bench measures the hot path, not RNG cost.
const QUERIES = 1024;
const tops = new Float32Array(QUERIES);
const ys = new Float32Array(QUERIES);
for (let i = 0; i < QUERIES; i++) {
  tops[i] = (i * 9973) % N;
  ys[i] = ((i * 9973) % QUERIES) * (total / QUERIES);
}

describe(`RowHeightIndex @ n=${N}`, () => {
  let topI = 0;
  let rowI = 0;
  bench('topOf', () => {
    idx.topOf(tops[topI++ & (QUERIES - 1)]!);
  });
  bench('rowAt', () => {
    idx.rowAt(ys[rowI++ & (QUERIES - 1)]!);
  });
});
