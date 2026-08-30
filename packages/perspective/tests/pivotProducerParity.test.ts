import { describe, it, expect } from 'vitest';
import {
  GroupPass, PivotPass, RowStore,
} from '../../kernel/src/worker/dataPipeline';
import { AggFuncRegistry } from '../../kernel/src/worker/aggFuncRegistry';
import type { WorkerColumn } from '../../kernel/src/worker/protocol';
import { mapPerspectivePivot, type PerspectivePivotViewResult } from '../src/pivotMapper';

/**
 * Producer parity: the worker's `PivotPass` and the Perspective mapper must
 * produce the SAME cross-tab for the same data.
 *
 * Every other test here proves the mapper renders *something*. This is the
 * one that proves it renders the *right* thing — a pivot served by Perspective
 * on the sparse path must be indistinguishable from one computed by the
 * kernel over a hydrated book, or the two row models silently disagree about
 * the numbers.
 *
 * The kernel is imported by relative source path on purpose: PivotPass is
 * worker-internal and not part of the public entry, and this comparison is
 * only meaningful against the real implementation, not a copy of it.
 */

const COLS: WorkerColumn[] = [
  { colId: 'desk', field: 'desk', type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'sector', field: 'sector', type: 'text' },
  { colId: 'pnl', field: 'pnl', type: 'number' },
];

const ROWS = [
  { id: '1', desk: 'Rates', region: 'EMEA', sector: 'Govt', pnl: 10 },
  { id: '2', desk: 'Rates', region: 'EMEA', sector: 'Corp', pnl: 20 },
  { id: '3', desk: 'Rates', region: 'AMER', sector: 'Govt', pnl: 30 },
  { id: '4', desk: 'Credit', region: 'EMEA', sector: 'Corp', pnl: 40 },
  { id: '5', desk: 'Credit', region: 'AMER', sector: 'Govt', pnl: 50 },
];

/** What the kernel computes today for a hydrated book. */
function kernelPivot(rowGroupCols: string[], pivotColIds: string[]) {
  const store = new RowStore('id');
  store.setAll(ROWS);
  const ids = ROWS.map((r) => r.id);
  const gp = new GroupPass(store, COLS);
  gp.setModel({ rowGroupCols });
  const groupOutput = gp.apply(ids);
  const pivot = new PivotPass(store, COLS, new AggFuncRegistry());
  pivot.setModel({ pivotColIds, valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
  return pivot.apply(ids, groupOutput);
}

/**
 * Simulate Perspective's `split_by` output for the same data, at every depth
 * 1..L — i.e. exactly the views `remountPivotViews` mounts. Aggregation is
 * done here the way Perspective's WASM would (sum per group × pivot prefix),
 * so the test exercises the MAPPER, not a re-implementation of the pivot.
 */
function perspectiveViews(
  rowGroupCols: string[],
  pivotColIds: string[],
): { results: PerspectivePivotViewResult[]; rowTotalRows: Array<Record<string, unknown>> } {
  const results: PerspectivePivotViewResult[] = [];
  for (let depth = 1; depth <= pivotColIds.length; depth++) {
    const cells = new Map<string, Map<string, number>>();
    const columnPaths = new Set<string>();
    for (const row of ROWS) {
      const pivotPath = pivotColIds.slice(0, depth)
        .map((c) => String((row as Record<string, unknown>)[c]));
      const colPath = `${pivotPath.join('|')}|pnl`;
      columnPaths.add(colPath);
      // Perspective emits a row per group node INCLUDING the root ([]).
      for (let g = 0; g <= rowGroupCols.length; g++) {
        const groupPath = rowGroupCols.slice(0, g)
          .map((c) => String((row as Record<string, unknown>)[c]));
        const rk = JSON.stringify(groupPath);
        let bucket = cells.get(rk);
        if (!bucket) { bucket = new Map(); cells.set(rk, bucket); }
        bucket.set(colPath, (bucket.get(colPath) ?? 0) + row.pnl);
      }
    }
    results.push({
      depth,
      columnPaths: [...columnPaths],
      rows: [...cells].map(([rk, bucket]) => ({
        __ROW_PATH__: JSON.parse(rk) as string[],
        ...Object.fromEntries(bucket),
      })),
    });
  }
  // The plain group_by view — row totals across all pivot values.
  const totals = new Map<string, number>();
  for (const row of ROWS) {
    for (let g = 0; g <= rowGroupCols.length; g++) {
      const groupPath = rowGroupCols.slice(0, g)
        .map((c) => String((row as Record<string, unknown>)[c]));
      const rk = JSON.stringify(groupPath);
      totals.set(rk, (totals.get(rk) ?? 0) + row.pnl);
    }
  }
  return {
    results,
    rowTotalRows: [...totals].map(([rk, pnl]) => ({
      __ROW_PATH__: JSON.parse(rk) as string[], pnl,
    })),
  };
}

function compare(rowGroupCols: string[], pivotColIds: string[]): void {
  const kernel = kernelPivot(rowGroupCols, pivotColIds);
  const { results, rowTotalRows } = perspectiveViews(rowGroupCols, pivotColIds);
  const mapped = mapPerspectivePivot({
    results,
    rowGroupCols,
    pivotColIds,
    valueColIds: ['pnl'],
    rowTotalRows,
  })!;

  // Same columns, same order.
  expect(mapped.leafPaths).toEqual(kernel.leafPaths);
  expect(mapped.keyTree).toEqual(kernel.keyTree);

  // Same cells — every key the kernel computes must be present with the same
  // value. (Numbers are compared with a tolerance: both sides sum floats.)
  for (const [key, expected] of kernel.values) {
    const actual = mapped.values.get(key);
    if (typeof expected === 'number' && typeof actual === 'number') {
      expect(actual).toBeCloseTo(expected, 9);
    } else {
      expect(actual).toEqual(expected);
    }
  }
  // …and no key the kernel does NOT compute (no phantom cells).
  for (const key of mapped.values.keys()) {
    expect(kernel.values.has(key)).toBe(true);
  }
  expect(mapped.values.size).toBe(kernel.values.size);
}

describe('PivotPass vs Perspective mapper — producer parity', () => {
  it('agrees for one pivot level', () => {
    compare(['desk'], ['region']);
  });

  it('agrees for two pivot levels, including every collapsed-group prefix', () => {
    // The prefix aggregates are what `split_by` never emits — this is the
    // case the extra shallower view exists for.
    compare(['desk'], ['region', 'sector']);
  });

  it('agrees for two row-group levels (every group depth + grand total)', () => {
    compare(['desk', 'region'], ['sector']);
  });

  it('agrees when there is no row grouping (grand total only)', () => {
    compare([], ['region']);
  });
});

/**
 * Column ORDER parity — the half that used to diverge.
 *
 * PivotPass orders pivot keys numerically-aware and honours
 * `enableStrictPivotColumnOrder`; the mapper used a plain lexicographic sort
 * and ignored the option, so `'10'` sorted before `'2'` and a newly-arrived
 * key reshuffled existing columns on SSRM but not on CSRM. Both now call the
 * kernel's exported `orderPivotKeys`.
 */
describe('PivotPass vs Perspective mapper — column ORDER parity', () => {
  /** Numeric-looking pivot keys, deliberately not in lexicographic order. */
  const NUMERIC_ROWS = [
    { id: '1', desk: 'Rates', region: '2', sector: 'Govt', pnl: 10 },
    { id: '2', desk: 'Rates', region: '10', sector: 'Govt', pnl: 20 },
    { id: '3', desk: 'Rates', region: '9', sector: 'Govt', pnl: 30 },
  ];

  function kernelOrder(strict: boolean): string[][] {
    const store = new RowStore('id');
    store.setAll(NUMERIC_ROWS);
    const ids = NUMERIC_ROWS.map((r) => r.id);
    const gp = new GroupPass(store, COLS);
    gp.setModel({ rowGroupCols: ['desk'] });
    const groupOutput = gp.apply(ids);
    const pivot = new PivotPass(store, COLS, new AggFuncRegistry());
    pivot.setStrictPivotColumnOrder(strict);
    pivot.setModel({ pivotColIds: ['region'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    return pivot.apply(ids, groupOutput).leafPaths;
  }

  function mapperOrder(strict: boolean): string[][] {
    const columnPaths = ['2|pnl', '10|pnl', '9|pnl'];
    const out = mapPerspectivePivot({
      results: [{ depth: 1, columnPaths, rows: [] }],
      rowGroupCols: ['desk'],
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
      strictOrder: strict,
      priorKeyOrder: new Map(),
    })!;
    return out.leafPaths;
  }

  it('orders numeric-looking keys identically (2 before 10, not lexicographic)', () => {
    const kernel = kernelOrder(true);
    expect(mapperOrder(true)).toEqual(kernel);
    // Guard the assertion itself: a lexicographic order would be 10,2,9.
    expect(kernel.map((p) => p[0])).toEqual(['2', '9', '10']);
  });

  it('non-strict ordering appends newly-seen keys instead of reshuffling', () => {
    // Prior memory holds two keys; a third arrives and must land at the end.
    const prior = new Map<string, string[]>([['', ['9', '2']]]);
    const out = mapPerspectivePivot({
      results: [{ depth: 1, columnPaths: ['2|pnl', '10|pnl', '9|pnl'], rows: [] }],
      rowGroupCols: ['desk'],
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
      strictOrder: false,
      priorKeyOrder: prior,
    })!;
    expect(out.leafPaths.map((p) => p[0])).toEqual(['9', '2', '10']);
    // …and the memory is updated for the next call.
    expect(prior.get('')).toEqual(['9', '2', '10']);
  });

  it('first-seen keys order deterministically even with strict OFF, in both', () => {
    // With no prior memory, non-strict still sorts alphanumerically — so a
    // fresh grid opens with identical columns in both row models.
    expect(mapperOrder(false)).toEqual(kernelOrder(false));
    expect(mapperOrder(false).map((p) => p[0])).toEqual(['2', '9', '10']);
  });

  it('keyTree and leafPaths agree on order', () => {
    const out = mapPerspectivePivot({
      results: [{ depth: 1, columnPaths: ['2|pnl', '10|pnl', '9|pnl'], rows: [] }],
      rowGroupCols: ['desk'],
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
      strictOrder: true,
    })!;
    expect(out.keyTree.map((n) => n.value)).toEqual(out.leafPaths.map((p) => p[0]));
  });
});
