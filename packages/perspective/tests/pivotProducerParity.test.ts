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
