import { describe, it, expect, vi } from 'vitest';
import {
  GroupingCoordinator,
  type GroupingCoordinatorDeps,
  type GroupingCoordinatorOptions,
  type RowGroupPanelHostSurface,
  type SetGroupModelReply,
} from '../src/core/groupingCoordinator';
import { TypedEventEmitter } from '../src/core/eventEmitter';
import { resolveColumnTree, type ColumnTree } from '../src/core/columnTree';
import type { VelocityGridEvent, SortModel } from '../src/types';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ColumnLayout } from '../src/core/layout';

/**
 * Cycle 19 / Task 5-Grouping — focused unit coverage of the extracted
 * GroupingCoordinator.
 *
 * Coverage:
 *   • Delegating grouping API (setRowGroupColumns / addRowGroupColumn /
 *     removeRowGroupColumn / moveRowGroupColumn / setRowGroupColumnSort)
 *     all route through GroupingState + emit `columnRowGroupChanged` on
 *     the events emitter with fresh snapshots.
 *   • setGroupModel path: builds `autoGroupColumns` for singleColumn +
 *     multipleColumns display types, clears them + stamps `groupRowStripCtx`
 *     for groupRows / custom, ships the worker round-trip, lands the reply
 *     via `setKnownGroupKeys` / `updateGroupDescendantsCache` /
 *     `setExpandedKeys` / `setRowCount` / `invalidateRowHeightIndex`.
 *   • Auto-hide-on-group / restore-on-ungroup: newly-grouped colIds hide,
 *     newly-ungrouped colIds restore. `suppressGroupChangesColumnVisibility`
 *     gates each direction independently.
 *   • Pivot-mode gate: under `isPivotMode() → true`, the show branch is
 *     suppressed so removing a rowGroup role does not fight the pivot
 *     engine's auto-hide of primaries. The hide branch still fires.
 *   • Row group panel bridge: `setRowGroupCols` + `setGroupingState` fire
 *     on every state change when a panel is mounted.
 *   • Sort-source branch: a `setRowGroupColumnSort` on an active group
 *     column merges the per-level sort into the sort model without
 *     re-shipping the group model.
 *   • Destroyed guard: no mutation lands + no worker calls fire once
 *     `isDestroyed` returns true.
 *   • Lifecycle: `destroy()` unsubscribes so a late GroupingState event
 *     can't re-emit.
 */

// ── Column-def helpers ──────────────────────────────────────────────────────

function makePrimaryTree(): ColumnTree {
  return resolveColumnTree([
    { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text' },
    { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text' },
    { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number' },
    { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number' },
  ]);
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  coord: GroupingCoordinator;
  events: TypedEventEmitter<VelocityGridEvent>;
  seen: VelocityGridEvent[];
  destroyed: { value: boolean };
  options: GroupingCoordinatorOptions;
  isPivotMode: { value: boolean };
  panel: {
    surface: RowGroupPanelHostSurface | null;
    setRowGroupCols: ReturnType<typeof vi.fn>;
    setGroupingState: ReturnType<typeof vi.fn>;
  };
  columnTree: { value: ColumnTree };
  columnDefsMap: { value: Map<string, ResolvedColDef> };
  columnOrder: { value: ResolvedColDef[] };
  columnLayout: { value: ColumnLayout[] };
  workerColumnsFn: ReturnType<typeof vi.fn>;
  updateWorkerColumns: ReturnType<typeof vi.fn>;
  setWorkerGroupModel: ReturnType<typeof vi.fn>;
  computeVisibleColumnOrder: ReturnType<typeof vi.fn>;
  recomputeViewport: ReturnType<typeof vi.fn>;
  requestRepaint: ReturnType<typeof vi.fn>;
  requestViewport: ReturnType<typeof vi.fn>;
  setExpandedKeys: ReturnType<typeof vi.fn>;
  getExpandedKeysMirror: ReturnType<typeof vi.fn>;
  flushPendingExpandedRoutes: ReturnType<typeof vi.fn>;
  hasPendingExpandedRoutes: ReturnType<typeof vi.fn>;
  shipExpandedKeys: ReturnType<typeof vi.fn>;
  setKnownGroupKeys: ReturnType<typeof vi.fn>;
  updateGroupDescendantsCache: ReturnType<typeof vi.fn>;
  setRowCount: ReturnType<typeof vi.fn>;
  invalidateRowHeightIndex: ReturnType<typeof vi.fn>;
  groupCellContextAt: ReturnType<typeof vi.fn>;
  setColumnsVisible: ReturnType<typeof vi.fn>;
  sortModel: { value: SortModel };
  setSortModel: ReturnType<typeof vi.fn>;
  reply: { value: SetGroupModelReply };
}

function makeHarness(opts: {
  rowGroupCols?: string[];
  panelMounted?: boolean;
  options?: GroupingCoordinatorOptions;
  reply?: Partial<SetGroupModelReply>;
  isPivotMode?: boolean;
} = {}): Harness {
  const events = new TypedEventEmitter<VelocityGridEvent>();
  const seen: VelocityGridEvent[] = [];
  events.on('columnRowGroupChanged', (e) => seen.push(e));
  const destroyed = { value: false };
  const isPivotMode = { value: opts.isPivotMode ?? false };
  const options: GroupingCoordinatorOptions = opts.options ?? {
    groupDisplayType: 'singleColumn',
  };

  const initialTree = makePrimaryTree();
  const columnTree = { value: initialTree };
  const columnDefsMap = { value: initialTree.leafById as Map<string, ResolvedColDef> };
  const columnOrder = { value: initialTree.leaves.slice() };
  const columnLayout = {
    value: initialTree.leaves.map((c, i) => ({ colId: c.colId, left: i * 100, width: 100 })),
  };

  const panelSetCols = vi.fn();
  const panelSetGroupingState = vi.fn();
  const panelSurface: RowGroupPanelHostSurface | null = opts.panelMounted
    ? { setRowGroupCols: panelSetCols, setGroupingState: panelSetGroupingState }
    : null;

  const reply = {
    value: {
      visibleCount: 42,
      groupKeys: ['k1', 'k2'],
      groupDescendants: [['r1'], ['r2']],
      expandedKeys: null,
      ...(opts.reply ?? {}),
    } as SetGroupModelReply,
  };

  const workerColumnsFn = vi.fn(() => [
    { colId: 'sector', field: 'sector' },
    { colId: 'region', field: 'region' },
    { colId: 'pnl', field: 'pnl' },
    { colId: 'notional', field: 'notional' },
  ]);
  const updateWorkerColumns = vi.fn(() => Promise.resolve({ visibleCount: 100 }));
  const setWorkerGroupModel = vi.fn(() => Promise.resolve(reply.value));
  const computeVisibleColumnOrder = vi.fn(() =>
    columnTree.value.leaves.filter((l) => !l.hide),
  );
  const recomputeViewport = vi.fn();
  const requestRepaint = vi.fn();
  const requestViewport = vi.fn();
  const setExpandedKeys = vi.fn();
  const getExpandedKeysMirror = vi.fn(() => null);
  const flushPendingExpandedRoutes = vi.fn(() => false);
  const hasPendingExpandedRoutes = vi.fn(() => false);
  const shipExpandedKeys = vi.fn();
  const setKnownGroupKeys = vi.fn();
  const updateGroupDescendantsCache = vi.fn();
  const setRowCount = vi.fn();
  const invalidateRowHeightIndex = vi.fn();
  const groupCellContextAt = vi.fn(() => null);
  const setColumnsVisible = vi.fn((colIds: string[], visible: boolean) => {
    for (const id of colIds) {
      const def = columnTree.value.leafById.get(id);
      if (def) (def as unknown as { hide: boolean }).hide = !visible;
    }
  });
  const sortModel = { value: [] as SortModel };
  const setSortModel = vi.fn((m: SortModel) => { sortModel.value = m; });

  const deps: GroupingCoordinatorDeps<unknown> = {
    events,
    isDestroyed: () => destroyed.value,
    getOptions: () => options,
    workerColumns: () => workerColumnsFn(),
    updateWorkerColumns: (cols) => updateWorkerColumns(cols),
    setWorkerGroupModel: (g) => setWorkerGroupModel(g),
    getRowGroupPanel: () => panelSurface,
    getColumnTree: () => columnTree.value,
    getColumnDefsMap: () => columnDefsMap.value,
    computeVisibleColumnOrder: () => computeVisibleColumnOrder(),
    setColumnOrder: (o) => { columnOrder.value = o; },
    getLayoutWidth: () => 800,
    setColumnLayout: (l) => { columnLayout.value = l; },
    recomputeViewport: () => recomputeViewport(),
    requestRepaint: () => requestRepaint(),
    requestViewport: () => requestViewport(),
    setExpandedKeys: (k) => setExpandedKeys(k),
    getExpandedKeysMirror: () => getExpandedKeysMirror(),
    flushPendingExpandedRoutes: () => flushPendingExpandedRoutes(),
    hasPendingExpandedRoutes: () => hasPendingExpandedRoutes(),
    shipExpandedKeys: (k) => shipExpandedKeys(k),
    setKnownGroupKeys: (k) => setKnownGroupKeys(k),
    updateGroupDescendantsCache: (k, d) => updateGroupDescendantsCache(k, d),
    setRowCount: (n) => setRowCount(n),
    invalidateRowHeightIndex: () => invalidateRowHeightIndex(),
    groupCellContextAt: (i) => groupCellContextAt(i),
    setColumnsVisible: (ids, v) => setColumnsVisible(ids, v),
    isPivotMode: () => isPivotMode.value,
    getSortModel: () => sortModel.value,
    setSortModel: (m) => setSortModel(m),
  };

  const coord = new GroupingCoordinator(deps, {
    rowGroupCols: opts.rowGroupCols ?? [],
  });

  return {
    coord, events, seen, destroyed, options, isPivotMode,
    panel: {
      surface: panelSurface,
      setRowGroupCols: panelSetCols,
      setGroupingState: panelSetGroupingState,
    },
    columnTree, columnDefsMap, columnOrder, columnLayout,
    workerColumnsFn, updateWorkerColumns, setWorkerGroupModel,
    computeVisibleColumnOrder, recomputeViewport, requestRepaint,
    requestViewport, setExpandedKeys, getExpandedKeysMirror,
    flushPendingExpandedRoutes, hasPendingExpandedRoutes, shipExpandedKeys, setKnownGroupKeys,
    updateGroupDescendantsCache, setRowCount, invalidateRowHeightIndex,
    groupCellContextAt, setColumnsVisible, sortModel, setSortModel, reply,
  };
}

// Wait for the queued microtasks (updateWorkerColumns → setWorkerGroupModel →
// reply landing) to settle so `.toHaveBeenCalled` reads the settled state.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GroupingCoordinator — state delegates', () => {
  it('addRowGroupColumn / removeRowGroupColumn / moveRowGroupColumn round-trip through the state primitive', () => {
    const h = makeHarness();
    h.coord.addRowGroupColumn('sector');
    expect(h.coord.getRowGroupColumns()).toEqual(['sector']);
    h.coord.addRowGroupColumn('region');
    expect(h.coord.getRowGroupColumns()).toEqual(['sector', 'region']);
    h.coord.moveRowGroupColumn(1, 0);
    expect(h.coord.getRowGroupColumns()).toEqual(['region', 'sector']);
    h.coord.removeRowGroupColumn('region');
    expect(h.coord.getRowGroupColumns()).toEqual(['sector']);
  });

  it('setRowGroupColumns replaces the whole ordered list', () => {
    const h = makeHarness();
    h.coord.setRowGroupColumns(['sector', 'region']);
    expect(h.coord.getRowGroupColumns()).toEqual(['sector', 'region']);
    h.coord.setRowGroupColumns(['pnl']);
    expect(h.coord.getRowGroupColumns()).toEqual(['pnl']);
  });

  it('every state mutation emits columnRowGroupChanged with source verb + fresh snapshot', () => {
    const h = makeHarness();
    h.coord.addRowGroupColumn('sector');
    h.coord.setRowGroupColumnSort('sector', 'asc');
    const evts = h.seen.filter(
      (e): e is Extract<VelocityGridEvent, { type: 'columnRowGroupChanged' }> =>
        e.type === 'columnRowGroupChanged',
    );
    expect(evts.map((e) => e.source)).toEqual(['add', 'sort']);
    expect(evts[0]!.columns).toEqual(['sector']);
    // Callers get a fresh array — mutation on the caller's copy doesn't
    // leak into state.
    evts[0]!.columns.push('MUTATED');
    expect(h.coord.getRowGroupColumns()).toEqual(['sector']);
  });
});

describe('GroupingCoordinator — setGroupModel worker round-trip', () => {
  it('mode: singleColumn — builds ONE auto-group column when grouping is active', async () => {
    const h = makeHarness();
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    const autos = h.coord.getAutoGroupColumns();
    expect(autos.length).toBe(1);
    // Auto-group column is registered in the columnDefsMap so the painter
    // can resolve it identically to any other leaf.
    expect(h.columnDefsMap.value.has(autos[0]!.colId)).toBe(true);
    // Group model persisted.
    expect(h.coord.getGroupModel().rowGroupCols).toEqual(['sector']);
    // Expansion mirror reset to default-all sentinel BEFORE the worker
    // round-trip (in-flight state is "every group open by default").
    expect(h.setExpandedKeys).toHaveBeenCalledWith(null);
  });

  it('mode: multipleColumns — builds ONE auto-group column per rowGroupCols entry', () => {
    const h = makeHarness({ options: { groupDisplayType: 'multipleColumns' } });
    h.coord.setGroupModel({ rowGroupCols: ['sector', 'region'] });
    expect(h.coord.getAutoGroupColumns().length).toBe(2);
    expect(h.coord.getGroupRowStripCtx()).toBeNull();
  });

  it('mode: groupRows — synthesizes NO columns and stamps groupRowStripCtx', () => {
    const h = makeHarness({ options: { groupDisplayType: 'groupRows' } });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    expect(h.coord.getAutoGroupColumns().length).toBe(0);
    const ctx = h.coord.getGroupRowStripCtx();
    expect(ctx).not.toBeNull();
    expect(ctx!.renderer).toBe('group');
    // The lookup closes over deps.groupCellContextAt.
    ctx!.lookup(0);
    expect(h.groupCellContextAt).toHaveBeenCalledWith(0);
  });

  it('mode: custom — respects options.groupRowRenderer override', () => {
    const h = makeHarness({
      options: { groupDisplayType: 'custom', groupRowRenderer: 'myCustomRenderer' },
    });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    expect(h.coord.getGroupRowStripCtx()?.renderer).toBe('myCustomRenderer');
  });

  it('ships updateWorkerColumns → setWorkerGroupModel and lands every reply field', async () => {
    const h = makeHarness();
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    // updateWorkerColumns fires synchronously; setWorkerGroupModel chains.
    expect(h.updateWorkerColumns).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.setWorkerGroupModel).toHaveBeenCalledWith({ rowGroupCols: ['sector'] });
    // Reply-landing callbacks all fired.
    expect(h.setKnownGroupKeys).toHaveBeenCalledWith(['k1', 'k2']);
    expect(h.updateGroupDescendantsCache).toHaveBeenCalledWith(['k1', 'k2'], [['r1'], ['r2']]);
    expect(h.setRowCount).toHaveBeenCalledWith(42);
    expect(h.invalidateRowHeightIndex).toHaveBeenCalled();
    expect(h.recomputeViewport).toHaveBeenCalled();
    expect(h.requestRepaint).toHaveBeenCalled();
    expect(h.requestViewport).toHaveBeenCalled();
  });

  it('installs a materialised expandedKeys set when the worker reply carries one', async () => {
    const h = makeHarness({ reply: { expandedKeys: ['a', 'b'] } });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    await flush();
    // setExpandedKeys fires twice: once with null (pre-round-trip), then
    // with the materialised set (post-round-trip).
    const calls = h.setExpandedKeys.mock.calls;
    expect(calls[0]![0]).toBeNull();
    expect(calls[1]![0]).toBeInstanceOf(Set);
    expect(Array.from(calls[1]![0] as Set<string>)).toEqual(['a', 'b']);
  });

  it('keeps the default-all sentinel when the worker reply has expandedKeys: null', async () => {
    const h = makeHarness({ reply: { expandedKeys: null } });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    await flush();
    const calls = h.setExpandedKeys.mock.calls;
    expect(calls[1]![0]).toBeNull();
  });

  it('cleans up prior auto-group columns from columnDefsMap when the display type flips', () => {
    const h = makeHarness({ options: { groupDisplayType: 'singleColumn' } });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    const priorId = h.coord.getAutoGroupColumns()[0]!.colId;
    expect(h.columnDefsMap.value.has(priorId)).toBe(true);
    // Flip to multipleColumns — the old singleColumn synthesized colId is
    // dropped from columnDefsMap; the new depth-tagged ids appear.
    h.options.groupDisplayType = 'multipleColumns';
    h.coord.setGroupModel({ rowGroupCols: ['sector', 'region'] });
    expect(h.columnDefsMap.value.has(priorId)).toBe(false);
    for (const c of h.coord.getAutoGroupColumns()) {
      expect(h.columnDefsMap.value.has(c.colId)).toBe(true);
    }
  });
});

describe('GroupingCoordinator — auto-hide-on-group / restore-on-ungroup', () => {
  it('hides newly-grouped colIds and restores newly-ungrouped ones by default', () => {
    const h = makeHarness();
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    // First call hides 'sector'.
    expect(h.setColumnsVisible).toHaveBeenCalledTimes(1);
    const [ids1, visible1] = h.setColumnsVisible.mock.calls[0]!;
    expect(ids1).toEqual(['sector']);
    expect(visible1).toBe(false);

    h.coord.setGroupModel({ rowGroupCols: ['region'] });
    // Second call: 'region' newly-grouped → hidden; 'sector' newly-ungrouped
    // → restored. Order is toHide first then toShow inside the setGroupModel.
    const later = h.setColumnsVisible.mock.calls.slice(1);
    const hideCall = later.find((c) => c[1] === false);
    const showCall = later.find((c) => c[1] === true);
    expect(hideCall?.[0]).toEqual(['region']);
    expect(showCall?.[0]).toEqual(['sector']);
  });

  it('suppressHideOnGroup skips the hide branch but not the show branch', () => {
    const h = makeHarness({
      options: {
        groupDisplayType: 'singleColumn',
        suppressGroupChangesColumnVisibility: 'suppressHideOnGroup',
      },
    });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    // Hide skipped → no calls yet.
    expect(h.setColumnsVisible).not.toHaveBeenCalled();
    h.coord.setGroupModel({ rowGroupCols: [] });
    // Show fires — 'sector' newly-ungrouped.
    expect(h.setColumnsVisible).toHaveBeenCalledWith(['sector'], true);
  });

  it('suppressShowOnUngroup skips the show branch but not the hide branch', () => {
    const h = makeHarness({
      options: {
        groupDisplayType: 'singleColumn',
        suppressGroupChangesColumnVisibility: 'suppressShowOnUngroup',
      },
    });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    // Hide fires.
    expect(h.setColumnsVisible).toHaveBeenCalledWith(['sector'], false);
    h.setColumnsVisible.mockClear();
    h.coord.setGroupModel({ rowGroupCols: [] });
    // Show suppressed → no restore call.
    expect(h.setColumnsVisible).not.toHaveBeenCalled();
  });

  it('suppressGroupChangesColumnVisibility: true skips both branches', () => {
    const h = makeHarness({
      options: {
        groupDisplayType: 'singleColumn',
        suppressGroupChangesColumnVisibility: true,
      },
    });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    h.coord.setGroupModel({ rowGroupCols: [] });
    expect(h.setColumnsVisible).not.toHaveBeenCalled();
  });

  it('under pivot mode the show branch is suppressed but the hide branch still fires', () => {
    const h = makeHarness({ isPivotMode: true });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    // Hide fires (an entry-path setGroupModel before pivot ever flipped
    // ON still lands the grouped-col hide).
    expect(h.setColumnsVisible).toHaveBeenCalledWith(['sector'], false);
    h.setColumnsVisible.mockClear();
    // Ungroup under pivot mode — show branch is suppressed so the pivot
    // engine's primary auto-hide isn't fought.
    h.coord.setGroupModel({ rowGroupCols: [] });
    expect(h.setColumnsVisible).not.toHaveBeenCalled();
  });
});

describe('GroupingCoordinator — row group panel bridge', () => {
  it('mounted panel receives setGroupingState on every mutation', () => {
    const h = makeHarness({ panelMounted: true });
    h.coord.addRowGroupColumn('sector');
    expect(h.panel.setGroupingState).toHaveBeenCalled();
    const [cols, sort] = h.panel.setGroupingState.mock.calls.at(-1)!;
    expect(cols).toEqual(['sector']);
    expect(sort).toEqual([null]);
    h.coord.setRowGroupColumnSort('sector', 'desc');
    const [cols2, sort2] = h.panel.setGroupingState.mock.calls.at(-1)!;
    expect(cols2).toEqual(['sector']);
    expect(sort2).toEqual([{ direction: 'desc' }]);
  });

  it('setGroupModel also syncs the panel chip strip via setRowGroupCols', () => {
    const h = makeHarness({ panelMounted: true });
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    expect(h.panel.setRowGroupCols).toHaveBeenCalledWith(['sector']);
  });
});

describe('GroupingCoordinator — sort-source branch', () => {
  it('merges per-level group sort into the sort model on source: sort without re-shipping the group model', async () => {
    const h = makeHarness();
    h.coord.setGroupModel({ rowGroupCols: ['sector', 'region'] });
    await flush();
    h.setWorkerGroupModel.mockClear();
    h.updateWorkerColumns.mockClear();
    h.setSortModel.mockClear();

    h.coord.setRowGroupColumnSort('sector', 'asc');
    // Sort-source did NOT re-ship the group model.
    expect(h.setWorkerGroupModel).not.toHaveBeenCalled();
    // Sort model got the merged per-level group sort.
    expect(h.setSortModel).toHaveBeenCalledTimes(1);
    expect(h.setSortModel.mock.calls[0]![0]).toEqual([
      { colId: 'sector', direction: 'asc' },
    ]);
  });

  it('sort merge preserves leaf-column sort entries not present in the row-group set', () => {
    const h = makeHarness();
    h.sortModel.value = [{ colId: 'pnl', direction: 'desc' }];
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    h.coord.setRowGroupColumnSort('sector', 'asc');
    // Group-col sort prepends; leaf sort survives.
    expect(h.setSortModel.mock.calls.at(-1)![0]).toEqual([
      { colId: 'sector', direction: 'asc' },
      { colId: 'pnl', direction: 'desc' },
    ]);
  });
});

describe('GroupingCoordinator — same-order guard', () => {
  it('a state change that lands the SAME ordered list does not re-ship setGroupModel', async () => {
    const h = makeHarness();
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    await flush();
    h.setWorkerGroupModel.mockClear();
    // A no-op mutation (adding a col already present) fires no event —
    // GroupingState is idempotent. Setting the SAME list also fires
    // no event.
    h.coord.setRowGroupColumns(['sector']);
    await flush();
    expect(h.setWorkerGroupModel).not.toHaveBeenCalled();
  });
});

describe('GroupingCoordinator — lifecycle + destroyed guard', () => {
  it('isDestroyed short-circuits every mutation', async () => {
    const h = makeHarness();
    h.destroyed.value = true;
    h.coord.setGroupModel({ rowGroupCols: ['sector'] });
    h.coord.setRowGroupColumns(['sector']);
    h.coord.addRowGroupColumn('sector');
    h.coord.removeRowGroupColumn('sector');
    h.coord.moveRowGroupColumn(0, 1);
    h.coord.setRowGroupColumnSort('sector', 'asc');
    await flush();
    expect(h.updateWorkerColumns).not.toHaveBeenCalled();
    expect(h.setWorkerGroupModel).not.toHaveBeenCalled();
    expect(h.setColumnsVisible).not.toHaveBeenCalled();
    expect(h.seen.length).toBe(0);
  });

  it('destroy unsubscribes so a late GroupingState event cannot re-emit', () => {
    const h = makeHarness();
    h.coord.destroy();
    // Attempting to mutate after destroy is silently swallowed by
    // GroupingState.destroyed guard — the emitter is torn down anyway.
    h.coord.addRowGroupColumn('sector');
    expect(h.seen.length).toBe(0);
  });

  it('constructor seeds the state + model from init.rowGroupCols', () => {
    const h = makeHarness({ rowGroupCols: ['sector', 'region'] });
    expect(h.coord.getRowGroupColumns()).toEqual(['sector', 'region']);
    expect(h.coord.getGroupModel().rowGroupCols).toEqual(['sector', 'region']);
    // The ctor is inert — no state-change side effects fired.
    expect(h.updateWorkerColumns).not.toHaveBeenCalled();
    expect(h.setColumnsVisible).not.toHaveBeenCalled();
    expect(h.seen.length).toBe(0);
  });
});
