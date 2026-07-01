import { describe, it, expect, vi } from 'vitest';
import {
  ColumnStateManager,
  type ColumnStateManagerDeps,
  type ColumnStateValueColumn,
} from '../src/core/columnStateManager';
import { TypedEventEmitter } from '../src/core/eventEmitter';
import { resolveColumnTree, type ColumnTree } from '../src/core/columnTree';
import type { CGridEvent, SortModel } from '../src/types';
import type { CColumnState } from '../src/types';
import type { CColDef, CColGroupDef } from '../src/types';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ColumnLayout } from '../src/core/layout';

/**
 * Cycle 19 / Task 5-ColState — focused unit coverage of the extracted
 * ColumnStateManager.
 *
 * Coverage:
 *   • `getColumnState` — pivot-primary snapshot invariant (Cycle 18 /
 *     Task 9); runtime-role source (Cycle 18 / Task 8b).
 *   • `captureInitialSnapshot` — the reset target is captured.
 *   • `applyColumnState({ state })` — mutates hide/pinned/width slots
 *     through `applyStateToTree`, emits deterministic
 *     `columnVisible` / `columnPinned` / `columnResized` events in the
 *     documented order.
 *   • Sort restore — sortModel is re-shipped in `sortIndex` precedence
 *     order, dropping null-direction entries.
 *   • Role fan-out — `rowGroup` / `pivot` / `aggFunc` entries reach the
 *     GroupingState + PivotState primitives via the batch verbs even on
 *     an empty list.
 *   • `applyOrder: true` — leaf order change triggers `rebuildColumns`,
 *     re-runs `applyStateToTree` on the fresh tree, and fires
 *     `columnMoved` events.
 *   • `resetColumnState` — fires `columnsReset` BEFORE per-slot events.
 *   • Worker round-trip lands `visibleCount` + fires
 *     `displayedColumnsChanged` with the right source.
 *   • Destroyed guard.
 */

// ── Column-def helpers ──────────────────────────────────────────────────────

function makePrimaryTree(): ColumnTree {
  return resolveColumnTree([
    { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text', width: 100 },
    { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', width: 100 },
    { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 100 },
    { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', width: 100 },
  ]);
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  mgr: ColumnStateManager;
  events: TypedEventEmitter<CGridEvent>;
  seen: CGridEvent[];
  destroyed: { value: boolean };
  columnTree: { value: ColumnTree };
  columnOrder: { value: ResolvedColDef[] };
  columnLayout: { value: ColumnLayout[] };
  columnDefs: { value: (CColDef | CColGroupDef)[] };
  sortModel: { value: SortModel };
  rowCount: { value: number };
  isPivotActive: { value: boolean };
  primaryTree: { value: ColumnTree | null };
  pivotColumns: { value: string[] };
  valueColumns: { value: ColumnStateValueColumn[] };
  rowGroupColumns: { value: string[] };
  rebuildColumns: ReturnType<typeof vi.fn>;
  computeVisibleColumnOrder: ReturnType<typeof vi.fn>;
  recomputeViewport: ReturnType<typeof vi.fn>;
  requestRepaint: ReturnType<typeof vi.fn>;
  updateWorkerColumns: ReturnType<typeof vi.fn>;
  requestViewport: ReturnType<typeof vi.fn>;
  setPivotColumns: ReturnType<typeof vi.fn>;
  setValueColumns: ReturnType<typeof vi.fn>;
  setGroupingRowGroupColumns: ReturnType<typeof vi.fn>;
  setSortModel: ReturnType<typeof vi.fn>;
  rebuildColumnDefsByLeafOrder: ReturnType<typeof vi.fn>;
  collectMovedColIds: ReturnType<typeof vi.fn>;
  buildColumnOrderConstraints: ReturnType<typeof vi.fn>;
}

function makeHarness(opts: {
  isPivotActive?: boolean;
  rowGroupColumns?: string[];
  pivotColumns?: string[];
  valueColumns?: ColumnStateValueColumn[];
} = {}): Harness {
  const events = new TypedEventEmitter<CGridEvent>();
  const seen: CGridEvent[] = [];
  events.on('columnsReset', (e) => seen.push(e));
  events.on('columnMoved', (e) => seen.push(e));
  events.on('columnVisible', (e) => seen.push(e));
  events.on('columnPinned', (e) => seen.push(e));
  events.on('columnResized', (e) => seen.push(e));
  events.on('displayedColumnsChanged', (e) => seen.push(e));
  const destroyed = { value: false };

  const initialTree = makePrimaryTree();
  const columnTree = { value: initialTree };
  const columnOrder = { value: initialTree.leaves.slice() };
  const columnLayout = {
    value: initialTree.leaves.map((c, i) => ({ colId: c.colId, left: i * 100, width: 100 })),
  };
  const columnDefs = {
    value: [
      { colId: 'sector', field: 'sector', headerName: 'Sector' },
      { colId: 'region', field: 'region', headerName: 'Region' },
      { colId: 'pnl', field: 'pnl', headerName: 'P&L' },
      { colId: 'notional', field: 'notional', headerName: 'Notional' },
    ] as (CColDef | CColGroupDef)[],
  };
  const sortModel = { value: [] as SortModel };
  const rowCount = { value: 100 };
  const isPivotActive = { value: opts.isPivotActive ?? false };
  const primaryTree = { value: null as ColumnTree | null };
  const pivotColumns = { value: opts.pivotColumns ?? [] };
  const valueColumns = { value: opts.valueColumns ?? [] };
  const rowGroupColumns = { value: opts.rowGroupColumns ?? [] };

  const rebuildColumns = vi.fn(() => {
    // Simulate a rebuild: re-resolve from columnDefs.
    columnTree.value = resolveColumnTree(columnDefs.value as CColDef[]);
    columnOrder.value = columnTree.value.leaves.slice();
  });
  const computeVisibleColumnOrder = vi.fn(() =>
    columnTree.value.leaves.filter((l) => !l.hide),
  );
  const recomputeViewport = vi.fn();
  const requestRepaint = vi.fn();
  const updateWorkerColumns = vi.fn(() => Promise.resolve({ visibleCount: 42 }));
  const requestViewport = vi.fn();
  const setPivotColumns = vi.fn((cols: string[]) => { pivotColumns.value = cols; });
  const setValueColumns = vi.fn((list: ColumnStateValueColumn[]) => { valueColumns.value = list; });
  const setGroupingRowGroupColumns = vi.fn((cols: string[]) => { rowGroupColumns.value = cols; });
  const setSortModel = vi.fn((m: SortModel) => { sortModel.value = m; });
  const rebuildColumnDefsByLeafOrder = vi.fn(
    (defs: (CColDef | CColGroupDef)[], newLeafOrder: string[]) => {
      // Faithful reimpl: sort leaves by newLeafOrder position.
      const posOf = new Map<string, number>();
      newLeafOrder.forEach((id, i) => posOf.set(id, i));
      const next = defs.slice() as CColDef[];
      next.sort((a, b) => (posOf.get(a.colId!) ?? 999) - (posOf.get(b.colId!) ?? 999));
      return next;
    },
  );
  const collectMovedColIds = vi.fn((oldOrder: string[], newOrder: string[]) => {
    const out: string[] = [];
    for (let i = 0; i < newOrder.length; i++) {
      if (oldOrder[i] !== newOrder[i]) out.push(newOrder[i]!);
    }
    return out;
  });
  const buildColumnOrderConstraints = vi.fn(() => ({
    lockOf: () => null,
    marryGroupOf: () => null,
    leafIdsOfGroup: () => [],
  }));

  const deps: ColumnStateManagerDeps<unknown> = {
    events,
    isDestroyed: () => destroyed.value,
    getColumnTree: () => columnTree.value,
    getColumnOrder: () => columnOrder.value,
    setColumnOrder: (o) => { columnOrder.value = o; },
    getColumnLayout: () => columnLayout.value,
    setColumnLayout: (l) => { columnLayout.value = l; },
    computeVisibleColumnOrder: () => computeVisibleColumnOrder(),
    getLayoutWidth: () => 800,
    getColumnDefs: () => columnDefs.value,
    setColumnDefs: (defs) => { columnDefs.value = defs; },
    rebuildColumns: () => rebuildColumns(),
    buildColumnOrderConstraints: () => buildColumnOrderConstraints(),
    rebuildColumnDefsByLeafOrder: (defs, order) => rebuildColumnDefsByLeafOrder(defs, order),
    collectMovedColIds: (o, n) => collectMovedColIds(o, n),
    getSortModel: () => sortModel.value,
    setSortModel: (m) => setSortModel(m),
    recomputeViewport: () => recomputeViewport(),
    requestRepaint: () => requestRepaint(),
    workerColumns: () => columnTree.value.leaves.map((c) => ({ colId: c.colId, field: c.colId })),
    updateWorkerColumns: (cols) => updateWorkerColumns(cols),
    requestViewport: () => requestViewport(),
    setRowCount: (n) => { rowCount.value = n; },
    isPivotActive: () => isPivotActive.value,
    getPrimaryColumnTree: () => primaryTree.value,
    getPivotColumns: () => pivotColumns.value,
    getPivotValueColumns: () => valueColumns.value,
    setPivotColumns: (cols) => setPivotColumns(cols),
    setValueColumns: (list) => setValueColumns(list),
    getGroupingRowGroupColumns: () => rowGroupColumns.value,
    setGroupingRowGroupColumns: (cols) => setGroupingRowGroupColumns(cols),
  };

  const mgr = new ColumnStateManager(deps);
  return {
    mgr, events, seen, destroyed, columnTree, columnOrder, columnLayout,
    columnDefs, sortModel, rowCount, isPivotActive, primaryTree,
    pivotColumns, valueColumns, rowGroupColumns,
    rebuildColumns, computeVisibleColumnOrder, recomputeViewport,
    requestRepaint, updateWorkerColumns, requestViewport,
    setPivotColumns, setValueColumns, setGroupingRowGroupColumns,
    setSortModel, rebuildColumnDefsByLeafOrder, collectMovedColIds,
    buildColumnOrderConstraints,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ColumnStateManager — getColumnState / snapshot', () => {
  it('snapshots every leaf including hidden ones and threads the runtime role providers', () => {
    const h = makeHarness({
      rowGroupColumns: ['sector'],
      pivotColumns: ['region'],
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
    });
    const state = h.mgr.getColumnState();
    // Every leaf shows up (declaration order).
    expect(state.map((e) => e.colId)).toEqual(['sector', 'region', 'pnl', 'notional']);
    // Runtime role slots reflect the harness state.
    expect(state.find((e) => e.colId === 'sector')?.rowGroup).toBe(true);
    expect(state.find((e) => e.colId === 'region')?.pivot).toBe(true);
    expect(state.find((e) => e.colId === 'pnl')?.aggFunc).toBe('sum');
  });

  it('under pivot mode snapshots against the preserved primary tree, not the synthesized tree', () => {
    const h = makeHarness({ isPivotActive: true });
    // Simulate pivot activation: live tree is a synthesized 1-col tree,
    // primary tree carries the 4 original leaves.
    h.primaryTree.value = h.columnTree.value;
    h.columnTree.value = resolveColumnTree([
      { colId: 'pivot_TECH_pnl', field: 'pivot_TECH_pnl', cellDataType: 'number' },
    ]);
    const state = h.mgr.getColumnState();
    // Primary leaves, not synthesized pivot col.
    expect(state.map((e) => e.colId)).toEqual(['sector', 'region', 'pnl', 'notional']);
  });
});

describe('ColumnStateManager — captureInitialSnapshot + resetColumnState', () => {
  it('reset replays the initial snapshot + fires columnsReset BEFORE per-slot events', async () => {
    const h = makeHarness();
    // Snapshot at "as-coded" state — everything visible + widths 100.
    h.mgr.captureInitialSnapshot();

    // Mutate: hide 'pnl' + resize 'sector' via applyColumnState.
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', width: 200 },
        { colId: 'region' },
        { colId: 'pnl', hide: true },
        { colId: 'notional' },
      ],
    });
    // Now reset.
    h.seen.length = 0;
    h.mgr.resetColumnState();
    // First event: columnsReset.
    expect(h.seen[0]?.type).toBe('columnsReset');
    // Then per-slot events: columnVisible restoring 'pnl' + columnResized
    // restoring 'sector' back to 100 (in the fixed deterministic order).
    const kinds = h.seen.map((e) => e.type);
    const columnsResetIdx = kinds.indexOf('columnsReset');
    const visibleIdx = kinds.indexOf('columnVisible');
    const resizedIdx = kinds.indexOf('columnResized');
    expect(columnsResetIdx).toBeLessThan(visibleIdx);
    expect(columnsResetIdx).toBeLessThan(resizedIdx);
  });
});

describe('ColumnStateManager — applyColumnState slot mutations', () => {
  it('hide changes drive columnVisible with grouped shown / hidden lists', () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', hide: true },
        { colId: 'region', hide: true },
        { colId: 'pnl' },
        { colId: 'notional' },
      ],
    });
    const visibleEvents = h.seen.filter(
      (e): e is Extract<CGridEvent, { type: 'columnVisible' }> => e.type === 'columnVisible',
    );
    // Two cols hide → ONE event with visible:false + both colIds.
    expect(visibleEvents).toHaveLength(1);
    expect(visibleEvents[0]!.visible).toBe(false);
    expect(new Set(visibleEvents[0]!.colIds)).toEqual(new Set(['sector', 'region']));
  });

  it('pinned changes drive columnPinned bucketed by target pin', () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', pinned: 'left' },
        { colId: 'region', pinned: 'left' },
        { colId: 'pnl', pinned: 'right' },
        { colId: 'notional' },
      ],
    });
    const pinEvents = h.seen.filter(
      (e): e is Extract<CGridEvent, { type: 'columnPinned' }> => e.type === 'columnPinned',
    );
    // One event per pin bucket.
    const buckets = new Map(pinEvents.map((e) => [e.pinned, new Set(e.colIds)]));
    expect(buckets.get('left')).toEqual(new Set(['sector', 'region']));
    expect(buckets.get('right')).toEqual(new Set(['pnl']));
  });

  it('width changes drive one columnResized event per changed leaf', () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', width: 200 },
        { colId: 'region', width: 150 },
        { colId: 'pnl' },
        { colId: 'notional' },
      ],
    });
    const resizeEvents = h.seen.filter(
      (e): e is Extract<CGridEvent, { type: 'columnResized' }> => e.type === 'columnResized',
    );
    const widths = new Map(resizeEvents.map((e) => [e.colId, e.width]));
    expect(widths.get('sector')).toBe(200);
    expect(widths.get('region')).toBe(150);
  });

  it('sort changes route through setSortModel in sortIndex precedence', () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', sort: 'asc', sortIndex: 1 },
        { colId: 'region', sort: 'desc', sortIndex: 0 },
        { colId: 'pnl' },
        { colId: 'notional' },
      ],
    });
    expect(h.setSortModel).toHaveBeenCalledTimes(1);
    // Precedence: region (index 0) before sector (index 1).
    expect(h.setSortModel.mock.calls[0]![0]).toEqual([
      { colId: 'region', direction: 'desc' },
      { colId: 'sector', direction: 'asc' },
    ]);
  });

  it('null sort direction entries are dropped from the resulting sort model', () => {
    const h = makeHarness();
    h.sortModel.value = [{ colId: 'sector', direction: 'asc' }];
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', sort: null },
        { colId: 'region', sort: 'asc', sortIndex: 0 },
        { colId: 'pnl' },
        { colId: 'notional' },
      ],
    });
    expect(h.setSortModel.mock.calls[0]![0]).toEqual([
      { colId: 'region', direction: 'asc' },
    ]);
  });

  it('returns false when a state entry does not match any known leaf', () => {
    const h = makeHarness();
    const ok = h.mgr.applyColumnState({
      state: [{ colId: 'unknownCol' }],
    });
    expect(ok).toBe(false);
  });
});

describe('ColumnStateManager — role fan-out (Cycle 18 / Task 8b)', () => {
  it('rowGroup entries → grouping.setRowGroupColumns; sorted by rowGroupIndex; empty list is still shipped', () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', rowGroup: true, rowGroupIndex: 1 },
        { colId: 'region', rowGroup: true, rowGroupIndex: 0 },
        { colId: 'pnl' },
        { colId: 'notional' },
      ],
    });
    // Region first (index 0), then sector (index 1).
    expect(h.setGroupingRowGroupColumns).toHaveBeenCalledWith(['region', 'sector']);
  });

  it('pivot entries → pivot.setPivotColumns; sorted by pivotIndex', () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', pivot: true, pivotIndex: 1 },
        { colId: 'region', pivot: true, pivotIndex: 0 },
        { colId: 'pnl' },
        { colId: 'notional' },
      ],
    });
    expect(h.setPivotColumns).toHaveBeenCalledWith(['region', 'sector']);
  });

  it('aggFunc entries → pivot.setValueColumns; preserves declaration order', () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector' },
        { colId: 'region' },
        { colId: 'pnl', aggFunc: 'sum' },
        { colId: 'notional', aggFunc: 'avg' },
      ],
    });
    expect(h.setValueColumns).toHaveBeenCalledWith([
      { colId: 'pnl', aggFunc: 'sum' },
      { colId: 'notional', aggFunc: 'avg' },
    ]);
  });

  it('empty role lists are still shipped (clear-on-omit semantic)', () => {
    const h = makeHarness({
      rowGroupColumns: ['sector'],
      pivotColumns: ['region'],
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
    });
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector' },
        { colId: 'region' },
        { colId: 'pnl' },
        { colId: 'notional' },
      ],
    });
    expect(h.setGroupingRowGroupColumns).toHaveBeenCalledWith([]);
    expect(h.setPivotColumns).toHaveBeenCalledWith([]);
    expect(h.setValueColumns).toHaveBeenCalledWith([]);
  });
});

describe('ColumnStateManager — applyOrder leaf-order change', () => {
  it('reorders columnDefs + rebuilds tree + re-applies state + emits columnMoved events', () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      applyOrder: true,
      state: [
        { colId: 'notional', width: 100 },
        { colId: 'pnl' },
        { colId: 'region' },
        { colId: 'sector' },
      ],
    });
    // rebuildColumns fired.
    expect(h.rebuildColumns).toHaveBeenCalled();
    // columnMoved events cover the reordered leaves.
    const movedEvents = h.seen.filter(
      (e): e is Extract<CGridEvent, { type: 'columnMoved' }> => e.type === 'columnMoved',
    );
    expect(movedEvents.length).toBeGreaterThan(0);
    // Every moved event carries `source: 'columnState'`.
    for (const e of movedEvents) expect(e.source).toBe('columnState');
  });
});

describe('ColumnStateManager — worker round-trip', () => {
  it('applyColumnState pushes updated workerColumns + lands visibleCount + fires displayedColumnsChanged with columnDefsChanged', async () => {
    const h = makeHarness();
    h.mgr.applyColumnState({
      state: [
        { colId: 'sector', hide: true },
        { colId: 'region' },
        { colId: 'pnl' },
        { colId: 'notional' },
      ],
    });
    expect(h.updateWorkerColumns).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.rowCount.value).toBe(42);
    const displayedEvt = h.seen.find(
      (e): e is Extract<CGridEvent, { type: 'displayedColumnsChanged' }> =>
        e.type === 'displayedColumnsChanged',
    );
    expect(displayedEvt?.source).toBe('columnDefsChanged');
  });

  it('resetColumnState fires displayedColumnsChanged with source: columnsReset', async () => {
    const h = makeHarness();
    h.mgr.captureInitialSnapshot();
    h.mgr.applyColumnState({
      state: [{ colId: 'sector', hide: true }, { colId: 'region' }, { colId: 'pnl' }, { colId: 'notional' }],
    });
    await flush();
    h.seen.length = 0;
    h.mgr.resetColumnState();
    await flush();
    const displayedEvt = h.seen.find(
      (e): e is Extract<CGridEvent, { type: 'displayedColumnsChanged' }> =>
        e.type === 'displayedColumnsChanged',
    );
    expect(displayedEvt?.source).toBe('columnsReset');
  });
});

describe('ColumnStateManager — destroyed guard', () => {
  it('isDestroyed short-circuits applyColumnState + resetColumnState + suppresses reply-landing', async () => {
    const h = makeHarness();
    h.mgr.captureInitialSnapshot();
    h.destroyed.value = true;
    const ok = h.mgr.applyColumnState({
      state: [{ colId: 'sector', hide: true }, { colId: 'region' }, { colId: 'pnl' }, { colId: 'notional' }],
    });
    expect(ok).toBe(true); // returns true (allFound default) on the guard path
    h.mgr.resetColumnState();
    await flush();
    expect(h.updateWorkerColumns).not.toHaveBeenCalled();
    // No mutation events fired.
    expect(h.seen.length).toBe(0);
  });
});

describe('ColumnStateManager — Cycle 18 / Task 9 pivot-active branch', () => {
  it('applyColumnState validates + mutates against the primary tree under pivot mode', () => {
    const h = makeHarness({ isPivotActive: true });
    // Simulate pivot: live tree is 1-col synthesized, primary carries the 4 original.
    const primary = h.columnTree.value;
    h.primaryTree.value = primary;
    h.columnTree.value = resolveColumnTree([
      { colId: 'pivot_TECH_pnl', field: 'pivot_TECH_pnl', cellDataType: 'number' },
    ]);
    const state: CColumnState[] = [
      { colId: 'sector', hide: true },
      { colId: 'region' },
      { colId: 'pnl' },
      { colId: 'notional' },
    ];
    // colIds are primary — apply must validate against the primary tree.
    const ok = h.mgr.applyColumnState({ state });
    expect(ok).toBe(true);
    // Primary sector leaf is hidden.
    expect(primary.leafById.get('sector')?.hide).toBe(true);
  });
});
