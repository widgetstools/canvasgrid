// Cycle 15 / Task 11 — group-aware sort perf gate.
//
// Budget: sorting 100 K post-filter rows partitioned by 2 group cols
// (≈ 50 leaf buckets after partitioning) under a 2-entry sort model
// must finish in ≤ 100 ms on the worker. The pass slot runs inside
// `buildVisibleAsync`'s synchronous chain — exceed the budget and
// every scroll, every filter change, every column sort toggle stalls
// a frame budget per pipeline re-run. This test guards against
// accidentally regressing the within-bucket sort to a global
// `sorted.sort` over the whole flat array (the pre-Task-11 path).

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import { SortPass } from '../src/worker/passes/sortPass';
import type { WorkerColumn } from '../src/worker/protocol';
import type { GroupNode } from '../src/worker/passes/groupPass';

const ROW_COUNT = 100_000;
const BUDGET_MS = 100;

// Deterministic synthetic data — a tiny xorshift PRNG keeps the row
// distribution stable across runs so the perf number is comparable
// from one CI run to the next (mirrors `groupPass.perf.test.ts`).
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
  { colId: 'sector', field: 'sector', type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'price',  field: 'price',  type: 'number' },
  { colId: 'qty',    field: 'qty',    type: 'number' },
];

describe('SortPass.applyGrouped — perf gate (100 K × 2 group cols ≤ 100 ms)', () => {
  // Tolerate slow CI machines: budget applies on a primary dev box
  // (Apple Silicon, recent V8). CI hosts pin slower — double the
  // budget there but never below 100 ms locally so a real regression
  // can't slide through.
  const budgetMs = process.env.CI === 'true' ? BUDGET_MS * 2 : BUDGET_MS;

  it(`sorts 100 K-row × 2-group-col tree in ≤ ${budgetMs} ms`, () => {
    const rng = makeRng(0x1234ABCD);
    const sectorBuckets = ['Tech', 'Finance', 'Healthcare', 'Energy', 'Industrial'];
    const regionBuckets = ['APAC', 'EMEA', 'LATAM', 'NA', 'MEA'];

    // Build a row dataset whose price + qty are sufficiently spread
    // (the comparator hot loop runs full pairwise compares; near-equal
    // values short-circuit faster, masking regressions).
    const rows: Array<{
      id: string; sector: string; region: string; price: number; qty: number;
    }> = new Array(ROW_COUNT);
    for (let i = 0; i < ROW_COUNT; i++) {
      rows[i] = {
        id: `r${i}`,
        sector: sectorBuckets[rng() % sectorBuckets.length]!,
        region: regionBuckets[rng() % regionBuckets.length]!,
        price: rng() % 100_000,
        qty:   rng() % 1_000,
      };
    }

    const store = new RowStore('id');
    store.setAll(rows);
    const postFilterIds: string[] = new Array(ROW_COUNT);
    for (let i = 0; i < ROW_COUNT; i++) postFilterIds[i] = `r${i}`;

    // GroupPass setup is NOT in the budget — only the sort matters.
    // sector × region produces 5 × 5 = 25 leaf buckets ≈ 4 K rows
    // each, exercising both within-bucket sort + flatOrder rebuild
    // across non-trivial sub-trees.
    const group = new GroupPass(store, cols);
    group.setModel({ rowGroupCols: ['sector', 'region'] });
    const groupOutput = group.apply(postFilterIds);

    const sort = new SortPass(store, cols);
    // Two-entry model: primary price desc, secondary qty asc. The
    // secondary fires only when prices tie — covers both the
    // common-case fast exit and the multi-entry traversal.
    sort.setModel([
      { colId: 'price', direction: 'desc' },
      { colId: 'qty',   direction: 'asc'  },
    ]);

    // Warm-up — first call lets V8 promote hot functions to optimised
    // code. The measured run is the second call (mirrors how the
    // pipeline re-runs on every viewport refresh in a long session).
    sort.applyGrouped(groupOutput, postFilterIds);

    const t0 = performance.now();
    const out = sort.applyGrouped(groupOutput, postFilterIds);
    const elapsed = performance.now() - t0;

    // Correctness sanity: every leaf bucket's childIndices count must
    // sum back to ROW_COUNT (a "completes fast" regression that
    // dropped rows must still fail loudly here).
    expect(out.bypassed).toBe(false);
    let totalLeafRows = 0;
    const walk = (nodes: readonly GroupNode[]): void => {
      for (const n of nodes) {
        if (n.childGroups.length === 0) totalLeafRows += n.childIndices.length;
        else walk(n.childGroups);
      }
    };
    walk(out.roots);
    expect(totalLeafRows).toBe(ROW_COUNT);

    expect(elapsed, `applyGrouped took ${elapsed.toFixed(1)} ms (budget ${budgetMs} ms)`).toBeLessThanOrEqual(budgetMs);
  }, /* test-timeout */ 30_000);
});
