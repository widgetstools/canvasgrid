// Cycle 15 / Task 1 — GroupPass perf gate.
//
// Budget: grouping 1 M synthetic rows by 3 columns must finish in
// ≤ 300 ms on the worker. The pass slot sits inside the synchronous
// `buildVisibleAsync` chain — exceed the budget and every scroll, every
// filter change, every transaction stalls one frame budget per pipeline
// re-run. This test guards the tree-build algorithm against accidental
// O(N²) regressions (e.g. swapping the single-pass Map insertion for a
// nested loop, or losing the per-level field pre-resolution).

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const ROW_COUNT = 1_000_000;
const BUDGET_MS = 300;

// Deterministic synthetic data — a tiny xorshift-style PRNG keeps the
// row distribution stable across runs so the perf number is comparable
// from one CI run to the next. Avoids the entropy + GC pressure of
// `Math.random` (which V8 deopts under heavy use anyway).
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % 0x7fffffff;
  };
}

const cols: WorkerColumn[] = [
  { colId: 'sector',    field: 'sector',    type: 'text' },
  { colId: 'region',    field: 'region',    type: 'text' },
  { colId: 'subRegion', field: 'subRegion', type: 'text' },
];

describe('GroupPass — perf gate (1 M × 3 cols ≤ 300 ms)', () => {
  // Tolerate slow CI machines: the budget applies on the primary dev
  // box (Apple Silicon, recent V8). CI hosts pin slower — bump the
  // budget there but never below 300 ms locally so a real regression
  // can't slide through.
  const budgetMs = process.env.CI === 'true' ? BUDGET_MS * 2 : BUDGET_MS;

  it(`builds a 1 M-row × 3-col tree in ≤ ${budgetMs} ms`, () => {
    // Seed + populate ONCE; row construction is not in the budget.
    // GroupPass is the only thing on the clock.
    const rng = makeRng(0xC0FFEE);
    const sectorBuckets = [
      'Tech', 'Finance', 'Healthcare', 'Energy', 'Industrial',
      'Consumer', 'Telecom', 'Utilities', 'Materials', 'RealEstate',
    ];
    const regionBuckets = ['APAC', 'EMEA', 'LATAM', 'NA', 'MEA'];
    const subRegionBuckets = ['N', 'S', 'E', 'W', 'C', 'NE', 'NW', 'SE', 'SW'];

    const rows: Array<{ id: string; sector: string; region: string; subRegion: string }> = [];
    rows.length = ROW_COUNT;
    for (let i = 0; i < ROW_COUNT; i++) {
      rows[i] = {
        id: `r${i}`,
        sector: sectorBuckets[rng() % sectorBuckets.length]!,
        region: regionBuckets[rng() % regionBuckets.length]!,
        subRegion: subRegionBuckets[rng() % subRegionBuckets.length]!,
      };
    }

    const store = new RowStore('id');
    store.setAll(rows);
    const inputIds: string[] = new Array(ROW_COUNT);
    for (let i = 0; i < ROW_COUNT; i++) inputIds[i] = `r${i}`;

    const pass = new GroupPass(store, cols);
    pass.setModel({ rowGroupCols: ['sector', 'region', 'subRegion'] });

    // Warm-up — first call lets V8 promote hot functions to optimised
    // code. The measured run is the second call (typical perf-test
    // pattern, mirrors how the pipeline runs on every viewport refresh
    // in a long session).
    pass.apply(inputIds);

    const t0 = performance.now();
    const out = pass.apply(inputIds);
    const elapsed = performance.now() - t0;

    // Correctness sanity: the tree must span every row. A regression
    // that "completes fast" by dropping rows must still fail loudly.
    expect(out.bypassed).toBe(false);
    expect(out.roots.length).toBeLessThanOrEqual(sectorBuckets.length);
    let totalLeafRows = 0;
    const walk = (nodes: ReadonlyArray<{ childIndices: Uint32Array; childGroups: any[] }>): void => {
      for (const n of nodes) {
        if (n.childGroups.length === 0) totalLeafRows += n.childIndices.length;
        else walk(n.childGroups);
      }
    };
    walk(out.roots);
    expect(totalLeafRows).toBe(ROW_COUNT);

    expect(elapsed, `groupPass took ${elapsed.toFixed(1)} ms (budget ${budgetMs} ms)`).toBeLessThanOrEqual(budgetMs);
  }, /* test-timeout */ 30_000);
});
