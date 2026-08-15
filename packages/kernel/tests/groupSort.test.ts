// Cycle 15 / Task 11 — Group-aware SortPass.
//
// `SortPass.applyGrouped(groupOutput, postFilterIds)` sorts:
//   - WITHIN each leaf bucket — the `childIndices` are reordered under
//     the current `SortModel`. Indices reference `postFilterIds`.
//   - ACROSS each level's `childGroups` — when the sort model targets a
//     grouping column, the level honours the direction (asc / desc).
//     Default: composite-key sort (what GroupPass already produced).
//     `sortGroupRowsByKey: true` forces the cheap composite-key compare
//     even when a registered `comparator` is set on the column;
//     `sortGroupRowsByKey: false` (or unset) uses the registered
//     `comparator` over the raw group `.value`.
//
// The fresh `GroupPassOutput` returned carries a re-built `flatOrder`
// that the viewport slicer walks — group entries at their depth, row
// entries at the deepest+1 depth, exactly as `GroupPass.apply`
// produces them.

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import { SortPass } from '../src/worker/passes/sortPass';
import { ComparatorRegistry } from '../src/worker/comparatorRegistry';
import type { WorkerColumn } from '../src/worker/protocol';
import type { FlatOrderEntry, GroupNode, GroupPassOutput } from '../src/worker/passes/groupPass';

const cols: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'type',   field: 'type',   type: 'text' },
  { colId: 'price',  field: 'price',  type: 'number' },
  { colId: 'qty',    field: 'qty',    type: 'number' },
];

function fixtureStore() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', desk: 'APAC', region: 'Rates',  type: 'IRS',  price: 100, qty: 5 },
    { id: '2', desk: 'APAC', region: 'Rates',  type: 'IRS',  price: 101, qty: 3 },
    { id: '3', desk: 'APAC', region: 'Rates',  type: 'Swap', price: 102, qty: 7 },
    { id: '4', desk: 'APAC', region: 'Credit', type: 'CDS',  price: 200, qty: 2 },
    { id: '5', desk: 'EMEA', region: 'Rates',  type: 'IRS',  price: 300, qty: 4 },
    { id: '6', desk: 'EMEA', region: 'Credit', type: 'CDS',  price: 301, qty: 6 },
  ]);
  return s;
}

const allIds = ['1', '2', '3', '4', '5', '6'];

/** Build a fresh `GroupPassOutput` for a model. The returned `postFilterIds`
 *  array is what `SortPass.applyGrouped` consumes alongside the output. */
function buildGroupOutput(rowGroupCols: string[]): {
  out: GroupPassOutput;
  postFilterIds: readonly string[];
} {
  const store = fixtureStore();
  const pass = new GroupPass(store, cols);
  pass.setModel({ rowGroupCols });
  return { out: pass.apply(allIds), postFilterIds: allIds };
}

/** Collect descendant childIndices in the order the (sorted) tree
 *  exposes them. Walks leaves left-to-right. */
function collectIndices(out: GroupPassOutput): number[] {
  const acc: number[] = [];
  const walk = (nodes: readonly GroupNode[]): void => {
    for (const n of nodes) {
      if (n.childGroups.length > 0) walk(n.childGroups);
      else for (const i of n.childIndices) acc.push(i);
    }
  };
  walk(out.roots);
  return acc;
}

// 1 — Bypassed groupOutput is returned unchanged. No allocation, no
// flatOrder rebuild — the same object reference comes back. Critical
// because `buildVisibleAsync` always pipes groupOutput through
// `applyGrouped`; the ungrouped grid must pay zero overhead.
describe('SortPass.applyGrouped — bypass', () => {
  it('returns the bypassed groupOutput unchanged (no allocation)', () => {
    const store = fixtureStore();
    const group = new GroupPass(store, cols);
    const out = group.apply(allIds);
    expect(out.bypassed).toBe(true);
    const sort = new SortPass(store, cols);
    sort.setModel([{ colId: 'price', direction: 'asc' }]);
    const result = sort.applyGrouped(out, allIds);
    expect(result).toBe(out);
  });
});

// 2 — Empty sort model + grouping active. Returns a fresh tree
// (defensive clone — the caller's `groupOutput` stays untouched in
// case it has pending readers) whose leaf `childIndices` preserve the
// GroupPass input order. flatOrder rebuilds identically to GroupPass.
describe('SortPass.applyGrouped — empty model', () => {
  it('preserves leaf order + group order when no sort is active', () => {
    const { out, postFilterIds } = buildGroupOutput(['desk']);
    const sort = new SortPass(fixtureStore(), cols);
    sort.setModel([]);
    const sorted = sort.applyGrouped(out, postFilterIds);
    expect(sorted).not.toBe(out);  // defensive clone
    expect(sorted.bypassed).toBe(false);
    expect(sorted.roots.map((r) => r.value)).toEqual(['APAC', 'EMEA']);
    // APAC leaf indices match GroupPass output exactly (input order).
    expect(Array.from(sorted.roots[0]!.childIndices)).toEqual([0, 1, 2, 3]);
    expect(Array.from(sorted.roots[1]!.childIndices)).toEqual([4, 5]);
  });
});

// 3 — Within-bucket sort on a numeric column, descending. The APAC
// bucket has rows 1,2,3,4 (price 100,101,102,200) — desc-by-price
// yields indices [3,2,1,0] = rowIds [4,3,2,1]. EMEA bucket has rows
// 5,6 (price 300,301) — desc → [5,4].
describe('SortPass.applyGrouped — within-bucket numeric desc', () => {
  it('re-orders leaf childIndices under the sort model (desc number)', () => {
    const { out, postFilterIds } = buildGroupOutput(['desk']);
    const sort = new SortPass(fixtureStore(), cols);
    sort.setModel([{ colId: 'price', direction: 'desc' }]);
    const sorted = sort.applyGrouped(out, postFilterIds);
    expect(Array.from(sorted.roots[0]!.childIndices)).toEqual([3, 2, 1, 0]);
    expect(Array.from(sorted.roots[1]!.childIndices)).toEqual([5, 4]);
  });
});

// 4 — Group-level sort, desc by grouping column. The model targets the
// `desk` column which is the level-0 grouping column. APAC < EMEA
// lexicographically, so desc reverses → [EMEA, APAC]. Within-bucket
// childIndices are untouched because the sort model column matches the
// grouping column, not a leaf-data column.
describe('SortPass.applyGrouped — group-level desc reverses order', () => {
  it('reverses childGroups when sortModel targets the grouping column desc', () => {
    const { out, postFilterIds } = buildGroupOutput(['desk']);
    const sort = new SortPass(fixtureStore(), cols);
    sort.setModel([{ colId: 'desk', direction: 'desc' }]);
    const sorted = sort.applyGrouped(out, postFilterIds);
    expect(sorted.roots.map((r) => r.value)).toEqual(['EMEA', 'APAC']);
  });
});

// 5 — Multi-level grouping with a level-2 sort on a leaf-data column.
// rowGroupCols=['desk','region']. APAC/Rates leaf bucket = rows 1,2,3.
// Sorting by qty desc within Rates → indices [2,0,1] = rowIds [3,1,2]
// (qty=7,5,3). Group-level order stays composite-key default.
describe('SortPass.applyGrouped — multi-level within-bucket sort', () => {
  it('sorts leaves within multi-level groups; group-level order stays default', () => {
    const { out, postFilterIds } = buildGroupOutput(['desk', 'region']);
    const sort = new SortPass(fixtureStore(), cols);
    sort.setModel([{ colId: 'qty', direction: 'desc' }]);
    const sorted = sort.applyGrouped(out, postFilterIds);
    // Group-level: GroupPass output is asc-by-key. With no model match
    // on a grouping column, the level stays asc.
    expect(sorted.roots.map((r) => r.value)).toEqual(['APAC', 'EMEA']);
    const apacRates = sorted.roots[0]!.childGroups.find((g) => g.value === 'Rates')!;
    expect(Array.from(apacRates.childIndices)).toEqual([2, 0, 1]);
  });
});

// 6 — A column with a registered comparator drives BOTH within-bucket
// and group-level sort (when `sortGroupRowsByKey` is unset). Register
// an inverse-lexicographic comparator under `'rev-string'`; assert
// the grouping level uses it.
describe('SortPass.applyGrouped — registered comparator drives group level', () => {
  it('uses the registered comparator for group .value when sortGroupRowsByKey unset', () => {
    const registry = new ComparatorRegistry();
    registry.register('rev-string', (a, b) => {
      const as = String(a ?? ''), bs = String(b ?? '');
      return as < bs ? 1 : as > bs ? -1 : 0;
    });
    const customCols: WorkerColumn[] = [
      { colId: 'desk', field: 'desk', type: 'text', comparator: 'rev-string' },
    ];
    const store = fixtureStore();
    const group = new GroupPass(store, customCols);
    group.setModel({ rowGroupCols: ['desk'] });
    const out = group.apply(allIds);
    const sort = new SortPass(store, customCols, registry);
    sort.setModel([{ colId: 'desk', direction: 'asc' }]);
    const sorted = sort.applyGrouped(out, allIds);
    // `rev-string` orders 'EMEA' before 'APAC' for asc direction
    // because the comparator inverts the comparison.
    expect(sorted.roots.map((r) => r.value)).toEqual(['EMEA', 'APAC']);
  });
});

// 7 — `sortGroupRowsByKey: true` FORCES the cheap composite-key
// compare at the group level even when a `comparator` is registered.
// Same setup as case 6 but with `sortGroupRowsByKey: true` on `desk`:
// the level reverts to alphabetical composite-key order ('APAC'
// before 'EMEA' for asc).
describe('SortPass.applyGrouped — sortGroupRowsByKey forces composite-key compare', () => {
  it('ignores the registered comparator at group level when sortGroupRowsByKey=true', () => {
    const registry = new ComparatorRegistry();
    registry.register('rev-string', (a, b) => {
      const as = String(a ?? ''), bs = String(b ?? '');
      return as < bs ? 1 : as > bs ? -1 : 0;
    });
    const customCols: WorkerColumn[] = [
      { colId: 'desk', field: 'desk', type: 'text', comparator: 'rev-string', sortGroupRowsByKey: true },
    ];
    const store = fixtureStore();
    const group = new GroupPass(store, customCols);
    group.setModel({ rowGroupCols: ['desk'] });
    const out = group.apply(allIds);
    const sort = new SortPass(store, customCols, registry);
    sort.setModel([{ colId: 'desk', direction: 'asc' }]);
    const sorted = sort.applyGrouped(out, allIds);
    expect(sorted.roots.map((r) => r.value)).toEqual(['APAC', 'EMEA']);
  });
});

// 8 — flatOrder rebuilds correctly. The shipped flatOrder must:
//   - emit every group node at its depth
//   - emit every row at depth = (deepest group depth) + 1
//   - track the sorted order so the slicer walks visible rows
//     in the right sequence (no orphan groups or stragglers).
describe('SortPass.applyGrouped — flatOrder shape', () => {
  it('rebuilds flatOrder with sorted DFS order; row depth = max group depth + 1', () => {
    const { out, postFilterIds } = buildGroupOutput(['desk', 'region']);
    const sort = new SortPass(fixtureStore(), cols);
    sort.setModel([{ colId: 'price', direction: 'desc' }]);
    const sorted = sort.applyGrouped(out, postFilterIds);
    const rowDepth = 2; // deepest group at depth 1 → rows at depth 2
    let groupCount = 0, rowCount = 0;
    for (const e of sorted.flatOrder) {
      if (e.kind === 'row') {
        rowCount++;
        expect(e.depth).toBe(rowDepth);
      } else {
        groupCount++;
        expect(e.depth === 0 || e.depth === 1).toBe(true);
      }
    }
    // 2 desk groups + 4 region groups (APAC has 2, EMEA has 2) +
    // 6 data rows = 12 flatOrder entries.
    expect(groupCount).toBe(6);
    expect(rowCount).toBe(6);
    // Critically: every row in flatOrder is in desc-by-price order
    // WITHIN its bucket. Rows in APAC/Rates with prices 102,101,100
    // → indices 2,1,0 in flatOrder iteration order.
    const indicesViaFlat = sorted.flatOrder
      .filter((e): e is Extract<FlatOrderEntry, { kind: 'row' }> => e.kind === 'row')
      .map((e) => e.rowIndex);
    expect(indicesViaFlat).toEqual(collectIndices(sorted));
  });
});

// 9 — Defensive clone: the input `groupOutput` MUST stay byte-identical
// after the sort. Critical for callers that hold a pending reference
// (e.g. an in-flight `collectGroupDescendantRowIds` request that
// captured `state.groupOutput` before the re-sort fires).
describe('SortPass.applyGrouped — input is not mutated', () => {
  it('does not mutate the input groupOutput', () => {
    const { out, postFilterIds } = buildGroupOutput(['desk']);
    const inputApacBefore = Array.from(out.roots[0]!.childIndices);
    const inputRootsBefore = out.roots.map((r) => r.value);
    const sort = new SortPass(fixtureStore(), cols);
    sort.setModel([{ colId: 'price', direction: 'desc' }]);
    sort.applyGrouped(out, postFilterIds);
    expect(Array.from(out.roots[0]!.childIndices)).toEqual(inputApacBefore);
    expect(out.roots.map((r) => r.value)).toEqual(inputRootsBefore);
  });
});

// 10 — Re-sorting the SAME groupOutput under a different model
// produces a different result (the previous run can't leak state into
// the next). Sort desc-by-price then asc-by-price; assert the two
// outputs invert.
describe('SortPass.applyGrouped — re-sortable under new model', () => {
  it('produces independent results across direction flips', () => {
    const { out, postFilterIds } = buildGroupOutput(['desk']);
    const sort = new SortPass(fixtureStore(), cols);
    sort.setModel([{ colId: 'price', direction: 'desc' }]);
    const desc = sort.applyGrouped(out, postFilterIds);
    sort.setModel([{ colId: 'price', direction: 'asc' }]);
    const asc = sort.applyGrouped(out, postFilterIds);
    // APAC bucket: asc-by-price 100,101,102,200 → [0,1,2,3];
    // desc-by-price 200,102,101,100 → [3,2,1,0].
    expect(Array.from(asc.roots[0]!.childIndices)).toEqual([0, 1, 2, 3]);
    expect(Array.from(desc.roots[0]!.childIndices)).toEqual([3, 2, 1, 0]);
  });
});

// 11 (A-C6) — Grouped within-bucket sort on a FIELDLESS text calc column.
// The flat `apply` path already reads calc values through the calcSource
// seam; the grouped `sortLeafIndices` comparator guarded on `r.col.field`
// and so silently skipped the fieldless calc column, leaving leaf order
// unsorted. A text calc column's values must reorder the leaf childIndices
// exactly like a real text field would.
describe('SortPass.applyGrouped — grouped sort honors a fieldless text calc column (A-C6)', () => {
  it('sorts leaf childIndices by a text calc column value', () => {
    // `label` is a fieldless calc column; its per-row value comes from the
    // calcSource, not `row[field]`.
    const calcCols: WorkerColumn[] = [...cols, { colId: 'label', type: 'text' }];
    const labelByRowId: Record<string, string> = {
      '1': 'delta', '2': 'alpha', '3': 'charlie', '4': 'bravo',
      '5': 'echo', '6': 'foxtrot',
    };
    const calcSource = {
      isCalcCol: (colId: string) => colId === 'label',
      valueAt: (rowId: string, colId: string) =>
        colId === 'label' ? labelByRowId[rowId] : undefined,
    };

    const group = new GroupPass(fixtureStore(), calcCols);
    group.setModel({ rowGroupCols: ['desk'] });
    const out = group.apply(allIds);

    const sort = new SortPass(fixtureStore(), calcCols);
    sort.setCalcSource(calcSource);
    sort.setModel([{ colId: 'label', direction: 'asc' }]);
    const sorted = sort.applyGrouped(out, allIds);

    // APAC bucket = input indices [0,1,2,3] = rowIds 1,2,3,4 with labels
    // delta/alpha/charlie/bravo. asc → alpha(2)/bravo(4)/charlie(3)/delta(1)
    // → childIndices [1,3,2,0].
    expect(Array.from(sorted.roots[0]!.childIndices)).toEqual([1, 3, 2, 0]);
    // EMEA bucket = indices [4,5] = rowIds 5,6 (echo/foxtrot) — already asc.
    expect(Array.from(sorted.roots[1]!.childIndices)).toEqual([4, 5]);
  });
});
