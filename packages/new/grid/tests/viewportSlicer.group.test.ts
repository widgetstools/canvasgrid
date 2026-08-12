// Cycle 15 / Task 2 — group-aware viewport slicer.
//
// `GroupPass.apply` (Task 1) produces a depth-first `flatOrder` listing
// every group followed by its descendant rows. When the user collapses
// a group, its descendants drop out of the visible row set — but
// `flatOrder` stays fixed. The collapse-skip walk here turns the
// (flatOrder, expandedKeys) pair into the materialised visible order,
// and `sliceGroupedViewport` packs a windowed chunk from that.
//
// These 14 cases pin the walk semantics + the chunk window — Task 3
// will extend the chunk format with `groupValue / groupChildCount /
// isExpanded` parallel arrays the renderer reads; the chunk slots
// produced here already carry the right `rowKinds / groupDepth /
// rowIds / heights` to be extended additively.

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import {
  computeGroupVisibleOrder,
  computeGroupVisibleRowCount,
  findVisibleIndexForGroup,
  sliceGroupedViewport,
} from '../src/worker/viewportSlicer';
import type { FlatOrderEntry } from '../src/worker/passes/groupPass';
import type { WorkerColumn } from '../src/worker/protocol';
import { decodeText } from '../src/worker/chunkFormat';

const cols: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'type',   field: 'type',   type: 'text' },
  { colId: 'price',  field: 'price',  type: 'number' },
];

function fixtureStore() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', desk: 'APAC', region: 'Rates',  type: 'IRS',  price: 100 },
    { id: '2', desk: 'APAC', region: 'Rates',  type: 'IRS',  price: 101 },
    { id: '3', desk: 'APAC', region: 'Rates',  type: 'Swap', price: 102 },
    { id: '4', desk: 'APAC', region: 'Credit', type: 'CDS',  price: 200 },
    { id: '5', desk: 'EMEA', region: 'Rates',  type: 'IRS',  price: 300 },
    { id: '6', desk: 'EMEA', region: 'Credit', type: 'CDS',  price: 301 },
  ]);
  return s;
}

const allIds = ['1', '2', '3', '4', '5', '6'];

function buildOneLevel(): { flatOrder: FlatOrderEntry[]; ids: string[]; store: RowStore } {
  const store = fixtureStore();
  const p = new GroupPass(store, cols);
  p.setModel({ rowGroupCols: ['desk'] });
  const out = p.apply(allIds);
  return { flatOrder: out.flatOrder, ids: allIds, store };
}

function buildThreeLevel(): { flatOrder: FlatOrderEntry[]; ids: string[]; store: RowStore } {
  const store = fixtureStore();
  const p = new GroupPass(store, cols);
  p.setModel({ rowGroupCols: ['desk', 'region', 'type'] });
  const out = p.apply(allIds);
  return { flatOrder: out.flatOrder, ids: allIds, store };
}

function buildColIndex(): Map<string, WorkerColumn> {
  const m = new Map<string, WorkerColumn>();
  for (const c of cols) m.set(c.colId, c);
  return m;
}

// 1 — Bypass: `GroupPass.apply` with an empty model returns
// `flatOrder: []`; the walk over an empty flat order yields nothing,
// regardless of how many `expandedKeys` the caller passes in. Lets the
// worker's getViewport handler fall through to the existing flat
// `ViewportSlicer.slice` without a special-case branch.
describe('computeGroupVisibleOrder — bypass', () => {
  it('bypassed (empty flatOrder) yields empty visible order regardless of expandedKeys', () => {
    const order = computeGroupVisibleOrder([], new Set(['some:key']));
    expect(order).toEqual([]);
  });

  // 2 — Defensive twin: even with a populated expandedKeys, an empty
  // flatOrder is the only ground-truth signal for "no groups active".
  it('empty flatOrder + non-empty expandedKeys still yields empty', () => {
    const expanded = new Set<string>(['desk:APAC', 'desk:EMEA']);
    expect(computeGroupVisibleOrder([], expanded)).toEqual([]);
  });
});

// 3-5 — Expansion modes (one-level grouping).
describe('computeGroupVisibleOrder — expansion modes (one level)', () => {
  it('all expanded yields the full flatOrder unchanged', () => {
    const { flatOrder } = buildOneLevel();
    const expanded = new Set<string>(['desk:APAC', 'desk:EMEA']);
    const order = computeGroupVisibleOrder(flatOrder, expanded);
    // 2 groups + 6 data rows
    expect(order.length).toBe(flatOrder.length);
    expect(order.length).toBe(8);
    expect(order).toEqual(flatOrder);
  });

  // 4 — All collapsed leaves only the top-level groups visible.
  // The 6 underlying data rows skip out because their depth (1) is
  // greater than the collapsed group's depth (0).
  it('all collapsed yields only the top-level groups', () => {
    const { flatOrder } = buildOneLevel();
    const order = computeGroupVisibleOrder(flatOrder, new Set());
    expect(order.length).toBe(2);
    expect(order.every((e) => e.kind === 'group' && e.depth === 0)).toBe(true);
    expect((order[0] as { key: string }).key).toBe('desk:APAC');
    expect((order[1] as { key: string }).key).toBe('desk:EMEA');
  });

  // 5 — Mixed: APAC expanded → 4 rows visible underneath; EMEA
  // collapsed → its 2 rows skipped. Total = 1 (APAC) + 4 + 1 (EMEA) = 6.
  it('mixed expansion shows one group expanded and the other collapsed', () => {
    const { flatOrder } = buildOneLevel();
    const order = computeGroupVisibleOrder(flatOrder, new Set(['desk:APAC']));
    expect(order.length).toBe(6);
    expect(order[0]).toMatchObject({ kind: 'group', key: 'desk:APAC' });
    // Rows 1..4 should be data rows.
    for (let i = 1; i <= 4; i++) expect(order[i]!.kind).toBe('row');
    expect(order[5]).toMatchObject({ kind: 'group', key: 'desk:EMEA' });
  });
});

// 6-8 — Deep nesting (three-level grouping: desk → region → type).
describe('computeGroupVisibleOrder — deep nesting (three levels)', () => {
  // 6 — Fully expanded leaves nothing hidden: 2 top + 4 region + 4 type +
  // 6 data rows = 16 entries. Verifies the multi-level walk doesn't
  // accidentally drop a leaf when several `expandedKeys` cascade.
  it('three-level all-expanded yields the full flatOrder', () => {
    const { flatOrder } = buildThreeLevel();
    // Build expandedKeys from every group entry in flatOrder.
    const expanded = new Set<string>();
    for (const e of flatOrder) if (e.kind === 'group') expanded.add(e.key);
    const order = computeGroupVisibleOrder(flatOrder, expanded);
    expect(order).toEqual(flatOrder);
  });

  // 7 — Root expanded, mid-level collapsed: each region group is
  // visible (its parent desk is expanded) but its `type` descendants
  // and their data rows are NOT visible because the region group is
  // not in expandedKeys. This is the "drill down one level at a time"
  // user flow.
  it('root expanded + mid-level collapsed: mid groups visible, deeper levels hidden', () => {
    const { flatOrder } = buildThreeLevel();
    // Expand only the two desk roots.
    const expanded = new Set<string>(['desk:APAC', 'desk:EMEA']);
    const order = computeGroupVisibleOrder(flatOrder, expanded);
    // Walk should emit: 2 desk groups + every immediate region child.
    // APAC has 2 regions (Credit, Rates), EMEA has 2 (Credit, Rates).
    // No type-level groups, no data rows.
    const groupDepths = order.map((e) => (e.kind === 'group' ? e.depth : -1));
    expect(groupDepths).toEqual([0, 1, 1, 0, 1, 1]);
    expect(order.every((e) => e.kind === 'group')).toBe(true);
    expect(order.length).toBe(6);
  });

  // 8 — Walk is a pure function: re-running with a fresh
  // expandedKeys yields the new view without any cross-call leakage.
  // Toggling a single key flips visibility of its subtree only.
  it('toggling one key flips its subtree visibility (pure function)', () => {
    const { flatOrder } = buildThreeLevel();
    const baseline = new Set<string>(['desk:APAC']);
    const collapsedRates = computeGroupVisibleOrder(flatOrder, baseline);
    // Now also expand the Rates region under APAC.
    const expandedRates = new Set<string>(['desk:APAC', 'desk:APAC::region:Rates']);
    const withRates = computeGroupVisibleOrder(flatOrder, expandedRates);
    // Adding the Rates expansion should ADD entries — the Rates child
    // type groups (IRS, Swap) — without removing anything previously
    // visible. EMEA (collapsed) stays at depth 0.
    expect(withRates.length).toBeGreaterThan(collapsedRates.length);
    // Every entry visible at the smaller expansion is still in the bigger one.
    for (const e of collapsedRates) expect(withRates).toContainEqual(e);
  });
});

// 9 — `computeGroupVisibleRowCount` is the no-allocation variant used
// for `modelUpdated` row-count pushes. It must agree with the length of
// the materialised walk for every (flatOrder, expandedKeys) pair.
describe('computeGroupVisibleRowCount', () => {
  it('row count matches materialised visible order length across modes', () => {
    const { flatOrder } = buildThreeLevel();
    const cases: ReadonlySet<string>[] = [
      new Set(),
      new Set(['desk:APAC']),
      new Set(['desk:APAC', 'desk:APAC::region:Rates']),
      new Set([
        'desk:APAC', 'desk:APAC::region:Rates', 'desk:APAC::region:Credit',
        'desk:EMEA', 'desk:EMEA::region:Rates', 'desk:EMEA::region:Credit',
      ]),
    ];
    for (const exp of cases) {
      const order = computeGroupVisibleOrder(flatOrder, exp);
      const count = computeGroupVisibleRowCount(flatOrder, exp);
      expect(count).toBe(order.length);
    }
  });
});

// 10-11 — `findVisibleIndexForGroup` resolves a group key to its
// visible-row index; returns -1 when hidden inside a collapsed ancestor.
describe('findVisibleIndexForGroup', () => {
  it('returns the visible-row index for a key whose ancestors are expanded', () => {
    const { flatOrder } = buildThreeLevel();
    const expanded = new Set<string>(['desk:APAC', 'desk:APAC::region:Rates']);
    const order = computeGroupVisibleOrder(flatOrder, expanded);
    const idx = findVisibleIndexForGroup(order, 'desk:APAC::region:Rates');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(order[idx]).toMatchObject({ kind: 'group', key: 'desk:APAC::region:Rates' });
  });

  // 11 — Querying a key whose ancestor is collapsed must return -1
  // (the group is in `flatOrder` but the walk dropped it). This is the
  // "scroll group into view" guard: callers see -1 → expand the
  // ancestor chain first, then re-resolve.
  it('returns -1 when the group is hidden under a collapsed ancestor', () => {
    const { flatOrder } = buildThreeLevel();
    // Don't expand desk:APAC, so all its descendants are hidden.
    const order = computeGroupVisibleOrder(flatOrder, new Set());
    expect(findVisibleIndexForGroup(order, 'desk:APAC::region:Rates')).toBe(-1);
  });
});

// 12-14 — `sliceGroupedViewport` packs a windowed chunk from the
// visible order. The chunk shape matches the existing flat slicer:
// `rowIds / rowKinds / groupDepth / heights / numericCols / textCols`.
describe('sliceGroupedViewport', () => {
  // 12 — Window into the middle of an expanded group. Verify each
  // slot's `rowKinds` (0/1), `groupDepth`, packed numeric column, and
  // that the `rowIds` Uint32Array round-trips through the store's
  // numeric-id map for the data rows.
  it('windows mid-expanded group with correct rowKinds/groupDepth/data', () => {
    const { flatOrder, ids, store } = buildOneLevel();
    const colIndex = buildColIndex();
    const order = computeGroupVisibleOrder(flatOrder, new Set(['desk:APAC', 'desk:EMEA']));
    // Visible order: [APAC, r0, r1, r2, r3, EMEA, r4, r5] — 8 entries.
    expect(order.length).toBe(8);
    // Window [0, 5) — APAC group + 4 data rows.
    const chunk = sliceGroupedViewport(
      store,
      colIndex,
      ids,
      order,
      { rowStart: 0, rowEnd: 5, columns: ['desk', 'price'] },
    );
    expect(chunk.rowStart).toBe(0);
    expect(chunk.rowCount).toBe(5);
    expect(Array.from(chunk.rowKinds)).toEqual([1, 0, 0, 0, 0]);
    expect(Array.from(chunk.groupDepth)).toEqual([0, 1, 1, 1, 1]);
    // Group row: rowIds slot is 0 (no rowId for a group).
    expect(chunk.rowIds[0]).toBe(0);
    // Data row rowIds round-trip to the original string ids.
    expect(store.getStringId(chunk.rowIds[1]!)).toBe('1');
    expect(store.getStringId(chunk.rowIds[4]!)).toBe('4');
    // price column: group slot is 0; data slots carry the row values.
    expect(Array.from(chunk.numericCols.price!)).toEqual([0, 100, 101, 102, 200]);
    // desk text column: group slot is empty; data slots carry 'APAC'×4.
    const desks = decodeText(chunk.textCols.desk!.offsets, chunk.textCols.desk!.bytes);
    expect(desks).toEqual(['', 'APAC', 'APAC', 'APAC', 'APAC']);
  });

  // 13 — Heights array: data rows pull from the store's effective
  // height aggregator; group rows leave the slot as 0 so main falls
  // back to the grid-level rowHeight. Picks up an explicit per-row
  // height to prove the data-row path reads the store correctly.
  it('packs heights from store for data rows; leaves 0 for group rows', () => {
    const { flatOrder, ids, store } = buildOneLevel();
    // Give rowId '2' a custom height; rowId '1' uses the implicit default (0).
    store.apply({ heightsByRowId: new Map([['2', 42]]) });
    const colIndex = buildColIndex();
    const order = computeGroupVisibleOrder(flatOrder, new Set(['desk:APAC']));
    // Window the first three: [APAC group, row '1', row '2'].
    const chunk = sliceGroupedViewport(
      store,
      colIndex,
      ids,
      order,
      { rowStart: 0, rowEnd: 3, columns: ['price'] },
    );
    expect(chunk.rowCount).toBe(3);
    expect(chunk.heights[0]).toBe(0);   // group row → no per-row height
    expect(chunk.heights[1]).toBe(0);   // data row '1' has no explicit height
    expect(chunk.heights[2]).toBe(42);  // data row '2' carries the height
  });

  // 14 — Window past the end of the visible order clamps gracefully
  // (matches the flat slicer's `Math.min(visibleIds.length, req.rowEnd)`
  // behaviour). A rowStart at or past length produces an empty chunk.
  it('clamps window past visible-order length to a short chunk; rowStart past end yields empty', () => {
    const { flatOrder, ids, store } = buildOneLevel();
    const colIndex = buildColIndex();
    const order = computeGroupVisibleOrder(flatOrder, new Set());
    // All collapsed → only 2 group rows visible.
    expect(order.length).toBe(2);
    // Window [1, 50) clamps to [1, 2) — one short slot.
    const short = sliceGroupedViewport(
      store, colIndex, ids, order,
      { rowStart: 1, rowEnd: 50, columns: ['desk'] },
    );
    expect(short.rowStart).toBe(1);
    expect(short.rowCount).toBe(1);
    expect(short.rowKinds[0]).toBe(1);   // EMEA group row

    // Window [2, 5) is wholly past the end → zero-count chunk, empty arrays.
    const empty = sliceGroupedViewport(
      store, colIndex, ids, order,
      { rowStart: 2, rowEnd: 5, columns: ['desk'] },
    );
    expect(empty.rowStart).toBe(2);
    expect(empty.rowCount).toBe(0);
    expect(empty.rowIds.length).toBe(0);
  });
});

// Cycle 18 / Task 3 follow-up — leaf-row suppression under pivot mode.
//
// The Cycle 18 worker now passes `suppressLeafRows = isPivotActive()`
// into `computeGroupVisibleOrder` so leaf data rows disappear from the
// visible viewport while a pivot model produces output. The user sees
// only the group + footer rows that make up the cross-tab matrix — AG-
// Grid parity. The flatOrder itself is unchanged (so selection, sort,
// agg pipelines reading the flat post-sort row order keep working);
// only the slicer-visible projection drops the row entries.
describe('computeGroupVisibleOrder — suppressLeafRows (pivot mode)', () => {
  it('drops every kind="row" entry while keeping every kind="group" entry', () => {
    const { flatOrder } = buildOneLevel();
    const allExpanded = new Set(flatOrder.filter((e) => e.kind === 'group').map((e) => (e as { key: string }).key));
    // Sanity: without suppression every leaf row rides through.
    const withLeaves = computeGroupVisibleOrder(flatOrder, allExpanded);
    expect(withLeaves.some((e) => e.kind === 'row')).toBe(true);
    // With suppression: zero leaf row entries; every group entry survives.
    const noLeaves = computeGroupVisibleOrder(flatOrder, allExpanded, false, true);
    expect(noLeaves.every((e) => e.kind !== 'row')).toBe(true);
    const groupCount = flatOrder.filter((e) => e.kind === 'group').length;
    expect(noLeaves.length).toBe(groupCount);
  });

  it('interacts cleanly with collapsed groups — a collapsed group still emits its group entry but its descendants are skipped', () => {
    const { flatOrder } = buildOneLevel();
    // Only APAC expanded; EMEA collapsed.
    const expanded = new Set(['desk:APAC']);
    const noLeaves = computeGroupVisibleOrder(flatOrder, expanded, false, true);
    // Both desk groups still appear (collapsed groups always emit their
    // own entry); their descendant leaf rows do not.
    const groupKeys = noLeaves
      .filter((e) => e.kind === 'group')
      .map((e) => (e as { key: string }).key)
      .sort();
    expect(groupKeys).toEqual(['desk:APAC', 'desk:EMEA']);
    expect(noLeaves.every((e) => e.kind !== 'row')).toBe(true);
  });

  it('drops only leaf rows — kind="footer" entries (when emitted) survive', () => {
    // Re-run GroupPass with includeFooter so footer entries appear.
    const store = fixtureStore();
    const gp = new GroupPass(store, cols);
    gp.setModel({ rowGroupCols: ['desk'] });
    gp.setIncludeFooter(true);
    const out = gp.apply(allIds);
    const expanded = new Set(out.flatOrder.filter((e) => e.kind === 'group').map((e) => (e as { key: string }).key));
    const noLeaves = computeGroupVisibleOrder(out.flatOrder, expanded, false, true);
    // No leaf rows; footer entries survive.
    expect(noLeaves.some((e) => e.kind === 'row')).toBe(false);
    expect(noLeaves.some((e) => e.kind === 'footer')).toBe(true);
  });

  it('row-count helper matches the visible-order length under suppression', () => {
    const { flatOrder } = buildOneLevel();
    const expanded = new Set(flatOrder.filter((e) => e.kind === 'group').map((e) => (e as { key: string }).key));
    const order = computeGroupVisibleOrder(flatOrder, expanded, false, true);
    const count = computeGroupVisibleRowCount(flatOrder, expanded, false, true);
    expect(count).toBe(order.length);
  });
});
