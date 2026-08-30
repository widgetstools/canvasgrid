import { describe, it, expect } from 'vitest';
import {
  GroupPass, PivotPass, SortPass, AggPass, RowStore,
} from '../src/worker/dataPipeline';
import { AggFuncRegistry } from '../src/worker/aggFuncRegistry';
import type { WorkerColumn } from '../src/worker/protocol';
import { pivotRowTotalColumnId } from '../src/core/pivotColumns';

/**
 * Group ORDERING: by an aggregate, and by a pivot row-total column.
 *
 * Two AG behaviours CSRM was missing:
 *  - Sorting a value column orders the GROUPS by their aggregate. AG documents
 *    `groupMaintainOrder: true` as suppressing exactly that, which only makes
 *    sense if the default does it. CSRM sorted only the leaves inside each
 *    group, so it disagreed with both AG and this grid's own SSRM path (where
 *    Perspective orders the grouped view).
 *  - A pivot ROW-TOTAL column is synthesized `sortable: true` and is meant to
 *    sort "just like any other pivot result column", but its id uses a
 *    different prefix, so the sort entry was dropped and the click did nothing.
 */

const COLS: WorkerColumn[] = [
  { colId: 'desk', field: 'desk', type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'pnl', field: 'pnl', type: 'number', aggFunc: 'sum' },
];

/** Desk totals: B=5, A=30, C=100 — deliberately not the insertion order. */
const ROWS = [
  { id: '1', desk: 'A', region: 'EMEA', pnl: 10 },
  { id: '2', desk: 'A', region: 'AMER', pnl: 20 },
  { id: '3', desk: 'B', region: 'EMEA', pnl: 5 },
  { id: '4', desk: 'C', region: 'AMER', pnl: 100 },
];

function setup(opts: { sort: Array<{ colId: string; direction: 'asc' | 'desc' }>; maintainOrder?: boolean }) {
  const store = new RowStore('id');
  store.setAll(ROWS);
  const ids = ROWS.map((r) => r.id);
  const registry = new AggFuncRegistry();

  const gp = new GroupPass(store, COLS);
  gp.setModel({ rowGroupCols: ['desk'] });
  const groupOutput = gp.apply(ids);

  const pivot = new PivotPass(store, COLS, registry);
  pivot.setModel({ pivotColIds: ['region'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
  const pivotOut = pivot.apply(ids, groupOutput);

  const agg = new AggPass(store, COLS, registry);
  const { groupTotals } = agg.applyGroups(ids, groupOutput);

  const sort = new SortPass(store, COLS);
  sort.setModel(opts.sort as never);
  const sorted = sort.applyGrouped(
    groupOutput, ids,
    {
      includeFooter: false, includeTotalFooter: false,
      removeSingleChildren: false, maintainOrder: opts.maintainOrder === true,
    },
    pivotOut, groupTotals,
  );
  return { sorted, agg, ids, groupOutput, groupTotals };
}

/** Group values in display order. */
function order(sorted: { roots: Array<{ value: unknown }> }): string[] {
  return sorted.roots.map((r) => String(r.value));
}

describe('CSRM — sorting a value column orders GROUPS by aggregate', () => {
  it('ascending by summed pnl', () => {
    const { sorted } = setup({ sort: [{ colId: 'pnl', direction: 'asc' }] });
    expect(order(sorted)).toEqual(['B', 'A', 'C']); // 5, 30, 100
  });

  it('descending by summed pnl', () => {
    const { sorted } = setup({ sort: [{ colId: 'pnl', direction: 'desc' }] });
    expect(order(sorted)).toEqual(['C', 'A', 'B']);
  });

  it('groupMaintainOrder suppresses it (AG semantics)', () => {
    const { sorted } = setup({
      sort: [{ colId: 'pnl', direction: 'desc' }],
      maintainOrder: true,
    });
    expect(order(sorted)).toEqual(['A', 'B', 'C']); // insertion order
  });

  it('sorting the GROUP column still orders by key, not aggregate', () => {
    const { sorted } = setup({ sort: [{ colId: 'desk', direction: 'desc' }] });
    expect(order(sorted)).toEqual(['C', 'B', 'A']);
  });
});

describe('sorting a pivot ROW-TOTAL column orders groups', () => {
  const rowTotalCol = pivotRowTotalColumnId('pnl');

  it('ascending by the across-all-keys total', () => {
    const { sorted } = setup({ sort: [{ colId: rowTotalCol, direction: 'asc' }] });
    expect(order(sorted)).toEqual(['B', 'A', 'C']);
  });

  it('descending', () => {
    const { sorted } = setup({ sort: [{ colId: rowTotalCol, direction: 'desc' }] });
    expect(order(sorted)).toEqual(['C', 'A', 'B']);
  });
});

describe('AggPass group totals are sort-invariant', () => {
  it('are identical before and after a sort — the premise rekeyGroupCache relies on', () => {
    // If a sort could change per-group aggregates, transplanting the memo onto
    // the post-sort tree would serve wrong numbers.
    const { agg, ids, sorted, groupTotals: before } = setup({
      sort: [{ colId: 'pnl', direction: 'desc' }],
    });
    const after = agg.applyGroups(ids, sorted).groupTotals;
    expect(after).toEqual(before);
  });

  it('rekeyGroupCache serves the memo for the post-sort tree', () => {
    const store = new RowStore('id');
    store.setAll(ROWS);
    const ids = ROWS.map((r) => r.id);
    const registry = new AggFuncRegistry();
    const gp = new GroupPass(store, COLS);
    gp.setModel({ rowGroupCols: ['desk'] });
    const groupOutput = gp.apply(ids);

    const agg = new AggPass(store, COLS, registry);
    const first = agg.applyGroups(ids, groupOutput);

    const sort = new SortPass(store, COLS);
    sort.setModel([{ colId: 'pnl', direction: 'desc' }] as never);
    const sorted = sort.applyGrouped(groupOutput, ids, {
      includeFooter: false, includeTotalFooter: false,
      removeSingleChildren: false, maintainOrder: false,
    }, undefined, first.groupTotals);

    agg.rekeyGroupCache(ids, sorted);
    // Same object identity back = memo hit, not a recompute.
    expect(agg.applyGroups(ids, sorted)).toBe(first);
  });

  it('rekeyGroupCache refuses to launder a stale entry onto a new tree', () => {
    const store = new RowStore('id');
    store.setAll(ROWS);
    const registry = new AggFuncRegistry();
    const gp = new GroupPass(store, COLS);
    gp.setModel({ rowGroupCols: ['desk'] });
    const idsA = ROWS.map((r) => r.id);
    const outA = gp.apply(idsA);
    const agg = new AggPass(store, COLS, registry);
    agg.applyGroups(idsA, outA);

    // A DIFFERENT input set must not adopt the cached result.
    const idsB = idsA.slice(0, 2);
    const outB = gp.apply(idsB);
    agg.rekeyGroupCache(idsB, outB);
    const recomputed = agg.applyGroups(idsB, outB);
    expect(Object.keys(recomputed.groupTotals).length).toBeGreaterThan(0);
    expect(recomputed.groupTotals['desk:C']).toBeUndefined();
  });
});
