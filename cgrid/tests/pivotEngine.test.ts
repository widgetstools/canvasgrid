import { describe, it, expect, vi } from 'vitest';
import {
  PivotEngine,
  type PivotEngineDeps,
  type PivotEngineOptions,
  type PivotPanelHostSurface,
} from '../src/core/pivotEngine';
import { TypedEventEmitter } from '../src/core/eventEmitter';
import { ColumnGroupState } from '../src/core/columnGroupState';
import { resolveColumnTree, type ColumnTree } from '../src/core/columnTree';
import type { CGridEvent } from '../src/types';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ColumnLayout } from '../src/core/layout';
import type { ViewportChunk } from '../src/worker/protocol';
import type { PivotKeyNode } from '../src/worker/passes/pivotPass';

/**
 * Cycle 19 / Task 5a — focused unit coverage of the extracted PivotEngine.
 *
 * Coverage:
 *   • Delegating pivot API (setPivotMode / setPivotColumns / setValueColumns
 *     / add / remove / move / setValueColumnAggFunc / setValueColumns) all
 *     route through PivotState + emit `pivotStateChanged` on the events
 *     emitter with fresh snapshots.
 *   • Pivot activation path: setting mode + columns + values with a chunk
 *     carrying `pivotColumnTree` swaps the column tree, marks active, and
 *     builds `cellSpecById`. Signature-compare skips a second swap when
 *     nothing changed.
 *   • Deactivation path: dropping value columns while active reverts the
 *     tree via the state-change handler; a chunk without `pivotColumnTree`
 *     also reverts.
 *   • Pivot panel host bridge: setPivotColumns + setPivotActive fire on
 *     every state change when a panel is mounted.
 *   • Runtime option flips: updateMaxGeneratedColumns / updateStrictColumnOrder
 *     / updateTotalsOption route through the worker deps + request a
 *     viewport.
 *   • Destroyed guard: no mutation lands + no worker calls fire once
 *     `isDestroyed` returns true.
 *   • Lifecycle: `destroy()` unsubscribes so a late PivotState event can't
 *     re-emit.
 */

// ── Column-def helpers ──────────────────────────────────────────────────────

function leaf(
  colId: string,
  overrides: Partial<ResolvedColDef> = {},
): ResolvedColDef {
  return {
    colId,
    field: colId,
    headerName: colId,
    minWidth: 0,
    maxWidth: 9999,
    cellDataType: 'text',
    cellRenderer: 'text',
    sortable: false,
    resizable: false,
    editable: false,
    suppressFloatingFilterButton: false,
    columnGroupShow: null,
    suppressMovable: false,
    lockPosition: null,
    ...overrides,
  } as unknown as ResolvedColDef;
}

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
  engine: PivotEngine;
  events: TypedEventEmitter<CGridEvent>;
  seen: CGridEvent[];
  destroyed: { value: boolean };
  options: PivotEngineOptions;
  panel: {
    surface: PivotPanelHostSurface | null;
    setPivotColumns: ReturnType<typeof vi.fn>;
    setPivotActive: ReturnType<typeof vi.fn>;
  };
  workerColumnsFn: ReturnType<typeof vi.fn>;
  updateWorkerColumns: ReturnType<typeof vi.fn>;
  setWorkerPivotModel: ReturnType<typeof vi.fn>;
  setWorkerPivotMaxGeneratedColumns: ReturnType<typeof vi.fn>;
  setWorkerStrictPivotColumnOrder: ReturnType<typeof vi.fn>;
  requestViewport: ReturnType<typeof vi.fn>;
  columnTree: { value: ColumnTree };
  columnGroupState: { value: ColumnGroupState };
  columnDefsMap: { value: Map<string, ResolvedColDef> };
  columnOrder: { value: ResolvedColDef[] };
  columnLayout: { value: ColumnLayout[] };
  autoGroupColumns: ResolvedColDef[];
  subscribeColumnGroupState: ReturnType<typeof vi.fn>;
  computeVisibleColumnOrder: ReturnType<typeof vi.fn>;
  rebuildSubgridStack: ReturnType<typeof vi.fn>;
  recomputeViewport: ReturnType<typeof vi.fn>;
  requestRepaint: ReturnType<typeof vi.fn>;
  applyVerticalInsets: ReturnType<typeof vi.fn>;
}

function makeHarness(opts: {
  pivotMode?: boolean;
  panelMounted?: boolean;
  options?: PivotEngineOptions;
  computeVisibleOrder?: () => ResolvedColDef[];
} = {}): Harness {
  const events = new TypedEventEmitter<CGridEvent>();
  const seen: CGridEvent[] = [];
  events.on('pivotStateChanged', (e) => seen.push(e));
  const destroyed = { value: false };
  const options: PivotEngineOptions = opts.options ?? {};

  const initialTree = makePrimaryTree();
  const columnTree = { value: initialTree };
  const columnGroupState = { value: new ColumnGroupState(initialTree) };
  const columnDefsMap = { value: initialTree.leafById as Map<string, ResolvedColDef> };
  const columnOrder = { value: initialTree.leaves.slice() };
  const columnLayout = {
    value: initialTree.leaves.map((c, i) => ({ colId: c.colId, left: i * 100, width: 100 })),
  };
  const autoGroupColumns: ResolvedColDef[] = [];

  const panelSetCols = vi.fn();
  const panelSetActive = vi.fn();
  const panelSurface: PivotPanelHostSurface | null = opts.panelMounted
    ? { setPivotColumns: panelSetCols, setPivotActive: panelSetActive }
    : null;

  const workerColumnsFn = vi.fn(() => [
    { colId: 'sector', field: 'sector' },
    { colId: 'region', field: 'region' },
    { colId: 'pnl', field: 'pnl' },
    { colId: 'notional', field: 'notional' },
  ]);
  const updateWorkerColumns = vi.fn(() => Promise.resolve({ visibleCount: 100 }));
  const setWorkerPivotModel = vi.fn(() => Promise.resolve(undefined));
  const setWorkerPivotMaxGeneratedColumns = vi.fn(() => Promise.resolve(undefined));
  const setWorkerStrictPivotColumnOrder = vi.fn(() => Promise.resolve(undefined));
  const requestViewport = vi.fn();
  const subscribeColumnGroupState = vi.fn();
  const rebuildSubgridStack = vi.fn();
  const recomputeViewport = vi.fn();
  const requestRepaint = vi.fn();
  const applyVerticalInsets = vi.fn();
  const computeVisibleColumnOrder = vi.fn(
    opts.computeVisibleOrder ?? (() => columnTree.value.leaves.slice()),
  );

  const deps: PivotEngineDeps<unknown> = {
    events,
    isDestroyed: () => destroyed.value,
    getOptions: () => options,
    workerColumns: () => workerColumnsFn(),
    updateWorkerColumns: (cols) => updateWorkerColumns(cols),
    setWorkerPivotModel: (m) => setWorkerPivotModel(m),
    setWorkerPivotMaxGeneratedColumns: (cap) => setWorkerPivotMaxGeneratedColumns(cap),
    setWorkerStrictPivotColumnOrder: (s) => setWorkerStrictPivotColumnOrder(s),
    requestViewport: () => requestViewport(),
    getPivotPanel: () => panelSurface,
    getColumnTree: () => columnTree.value,
    setColumnTree: (t) => { columnTree.value = t; },
    getColumnGroupState: () => columnGroupState.value,
    setColumnGroupState: (s) => { columnGroupState.value = s; },
    getColumnDefsMap: () => columnDefsMap.value,
    setColumnDefsMap: (m) => { columnDefsMap.value = m; },
    getAutoGroupColumns: () => autoGroupColumns,
    subscribeColumnGroupState: () => subscribeColumnGroupState(),
    computeVisibleColumnOrder: () => computeVisibleColumnOrder(),
    setColumnOrder: (o) => { columnOrder.value = o; },
    getLayoutWidth: () => 800,
    setColumnLayout: (l) => { columnLayout.value = l; },
    rebuildSubgridStack: () => rebuildSubgridStack(),
    recomputeViewport: () => recomputeViewport(),
    requestRepaint: () => requestRepaint(),
    applyVerticalInsets: () => applyVerticalInsets(),
  };

  const engine = new PivotEngine(deps, { pivotMode: opts.pivotMode ?? false });

  return {
    engine, events, seen, destroyed, options,
    panel: { surface: panelSurface, setPivotColumns: panelSetCols, setPivotActive: panelSetActive },
    workerColumnsFn, updateWorkerColumns, setWorkerPivotModel,
    setWorkerPivotMaxGeneratedColumns, setWorkerStrictPivotColumnOrder,
    requestViewport, columnTree, columnGroupState, columnDefsMap,
    columnOrder, columnLayout, autoGroupColumns, subscribeColumnGroupState,
    computeVisibleColumnOrder, rebuildSubgridStack, recomputeViewport,
    requestRepaint, applyVerticalInsets,
  };
}

/** Build a synthetic pivot key tree matching the worker's shape.  */
function keyTree(): PivotKeyNode[] {
  return [
    { value: 'TECH', path: ['TECH'], children: [] },
    { value: 'FIN', path: ['FIN'], children: [] },
  ];
}

/** Build a chunk carrying a pivot tree. Only the pivot fields matter to
 *  the engine — the rest is filler to satisfy the type. */
function chunkWithPivot(
  overrides: Partial<ViewportChunk> = {},
): ViewportChunk {
  return {
    rowStart: 0,
    rowCount: 0,
    rowIds: new Uint32Array(),
    rowKinds: new Uint8Array(),
    groupDepth: new Uint8Array(),
    numericCols: {},
    textCols: {},
    heights: new Float32Array(),
    pivotColumnTree: keyTree(),
    pivotLeafPaths: [['TECH'], ['FIN']],
    pivotValues: new Map(),
    ...overrides,
  } as ViewportChunk;
}

function chunkWithoutPivot(): ViewportChunk {
  return {
    rowStart: 0,
    rowCount: 0,
    rowIds: new Uint32Array(),
    rowKinds: new Uint8Array(),
    groupDepth: new Uint8Array(),
    numericCols: {},
    textCols: {},
    heights: new Float32Array(),
  } as ViewportChunk;
}

// Wait for the queued microtasks (updateWorkerColumns → setPivotModel →
// requestViewport) to settle so `.toHaveBeenCalled` reads the settled state.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PivotEngine — state delegates', () => {
  it('setPivotMode flips the mode and emits pivotStateChanged with source: "mode"', async () => {
    const h = makeHarness();
    expect(h.engine.isPivotMode()).toBe(false);
    h.engine.setPivotMode(true);
    expect(h.engine.isPivotMode()).toBe(true);
    const modeEvents = h.seen.filter(
      (e): e is Extract<CGridEvent, { type: 'pivotStateChanged' }> => e.type === 'pivotStateChanged',
    );
    expect(modeEvents.at(-1)?.source).toBe('mode');
    expect(modeEvents.at(-1)?.pivotMode).toBe(true);
  });

  it('setPivotColumns / addPivotColumn / removePivotColumn / movePivotColumn all round-trip through state', () => {
    const h = makeHarness();
    h.engine.setPivotColumns(['sector', 'region']);
    expect(h.engine.getPivotColumns()).toEqual(['sector', 'region']);
    h.engine.addPivotColumn('pnl');
    expect(h.engine.getPivotColumns()).toEqual(['sector', 'region', 'pnl']);
    h.engine.removePivotColumn('region');
    expect(h.engine.getPivotColumns()).toEqual(['sector', 'pnl']);
    h.engine.movePivotColumn(1, 0);
    expect(h.engine.getPivotColumns()).toEqual(['pnl', 'sector']);
  });

  it('value column API surface — add / remove / setAggFunc / setValueColumns / getValueColumnsApiShape', () => {
    const h = makeHarness();
    h.engine.addValueColumn('pnl', 'sum');
    h.engine.addValueColumn('notional', 'avg');
    expect(h.engine.getValueColumnsApiShape()).toEqual([
      { colId: 'pnl', aggFunc: 'sum' },
      { colId: 'notional', aggFunc: 'avg' },
    ]);
    h.engine.setValueColumnAggFunc('pnl', 'max');
    expect(h.engine.getValueColumnsApiShape()).toEqual([
      { colId: 'pnl', aggFunc: 'max' },
      { colId: 'notional', aggFunc: 'avg' },
    ]);
    h.engine.moveValueColumn(1, 0);
    expect(h.engine.getValueColumnsApiShape()).toEqual([
      { colId: 'notional', aggFunc: 'avg' },
      { colId: 'pnl', aggFunc: 'max' },
    ]);
    h.engine.removeValueColumn('notional');
    expect(h.engine.getValueColumnsApiShape()).toEqual([
      { colId: 'pnl', aggFunc: 'max' },
    ]);
    h.engine.setValueColumns([
      { colId: 'notional', aggFunc: 'sum' },
      { colId: 'pnl', aggFunc: 'sum' },
    ]);
    expect(h.engine.getValueColumnsApiShape()).toEqual([
      { colId: 'notional', aggFunc: 'sum' },
      { colId: 'pnl', aggFunc: 'sum' },
    ]);
  });

  it('serialize / restore round-trips the full pivot state', () => {
    const h = makeHarness();
    h.engine.setPivotMode(true);
    h.engine.setPivotColumns(['sector']);
    h.engine.addValueColumn('pnl', 'sum');
    const snap = h.engine.serialize();
    const h2 = makeHarness();
    h2.engine.restore(snap);
    expect(h2.engine.isPivotMode()).toBe(true);
    expect(h2.engine.getPivotColumns()).toEqual(['sector']);
    expect(h2.engine.getValueColumnsApiShape()).toEqual([{ colId: 'pnl', aggFunc: 'sum' }]);
  });
});

describe('PivotEngine — state-change side effects', () => {
  it('emits pivotStateChanged BEFORE the worker round-trip and fires updateWorkerColumns + setPivotModel + requestViewport', async () => {
    const h = makeHarness();
    h.engine.setPivotMode(true);
    // The public event fires synchronously before any worker call.
    expect(h.seen.length).toBeGreaterThanOrEqual(1);
    expect(h.updateWorkerColumns).toHaveBeenCalledTimes(1);
    // Model is empty on mode-flip alone (no pivot/value columns yet).
    await flush();
    expect(h.setWorkerPivotModel).toHaveBeenCalledWith({ pivotColIds: [], valueCols: [] });
    expect(h.requestViewport).toHaveBeenCalledTimes(1);
  });

  it('pivotWorkerModel returns non-empty only when pivot is active (mode + ≥1 pivot col + ≥1 value col)', async () => {
    const h = makeHarness();
    h.engine.setPivotMode(true);
    h.engine.setPivotColumns(['sector']);
    // Still no value column → active is false → model is empty.
    expect(h.engine.pivotWorkerModel()).toEqual({ pivotColIds: [], valueCols: [] });
    h.engine.addValueColumn('pnl', 'sum');
    expect(h.engine.pivotWorkerModel()).toEqual({
      pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }],
    });
    // applyVerticalInsets runs on every state change.
    await flush();
    expect(h.applyVerticalInsets).toHaveBeenCalled();
  });

  it('mounted pivot panel receives setPivotColumns + setPivotActive on every state change', async () => {
    const h = makeHarness({ panelMounted: true });
    h.engine.setPivotMode(true);
    expect(h.panel.setPivotColumns).toHaveBeenCalledWith([]);
    expect(h.panel.setPivotActive).toHaveBeenCalledWith(false);
    h.engine.setPivotColumns(['sector']);
    h.engine.addValueColumn('pnl', 'sum');
    // Last call: mode is on + pivot col + value col → active is true.
    expect(h.panel.setPivotColumns).toHaveBeenLastCalledWith(['sector']);
    expect(h.panel.setPivotActive).toHaveBeenLastCalledWith(true);
  });
});

describe('PivotEngine — column-tree swap', () => {
  it('activates on chunk with pivotColumnTree, swaps tree, populates cellSpecById', () => {
    const h = makeHarness({ pivotMode: true });
    h.engine.setPivotColumns(['sector']);
    h.engine.addValueColumn('pnl', 'sum');
    expect(h.engine.isPivotActive()).toBe(false);
    h.engine.maybeSyncPivotColumns(chunkWithPivot());
    expect(h.engine.isPivotActive()).toBe(true);
    // Cell specs populated for every synthesized leaf (2 leaves × 1 value col).
    const specs = h.engine.getPivotResultColumns();
    expect(specs.length).toBe(2);
    // Primary tree is saved for revert.
    expect(h.engine.getPrimaryColumnTree()?.leafById.has('sector')).toBe(true);
    // Layout + subgrid stack + repaint fired.
    expect(h.rebuildSubgridStack).toHaveBeenCalled();
    expect(h.recomputeViewport).toHaveBeenCalled();
    expect(h.requestRepaint).toHaveBeenCalled();
    // The columnGroupState subscribe hook re-wired for the new tree.
    expect(h.subscribeColumnGroupState).toHaveBeenCalled();
  });

  it('signature-compare skips re-synthesis on a second chunk with identical shape', () => {
    const h = makeHarness({ pivotMode: true });
    h.engine.setPivotColumns(['sector']);
    h.engine.addValueColumn('pnl', 'sum');
    h.engine.maybeSyncPivotColumns(chunkWithPivot());
    const rebuildCallsAfterFirst = h.rebuildSubgridStack.mock.calls.length;
    // Same tree + same value columns + same totals options → no re-synthesis.
    h.engine.maybeSyncPivotColumns(chunkWithPivot());
    expect(h.rebuildSubgridStack.mock.calls.length).toBe(rebuildCallsAfterFirst);
  });

  it('re-synthesizes on a chunk with a different pivot tree', () => {
    const h = makeHarness({ pivotMode: true });
    h.engine.setPivotColumns(['sector']);
    h.engine.addValueColumn('pnl', 'sum');
    h.engine.maybeSyncPivotColumns(chunkWithPivot());
    const rebuildsAfterFirst = h.rebuildSubgridStack.mock.calls.length;
    // Different leaf paths → signature differs → re-synthesis.
    h.engine.maybeSyncPivotColumns(chunkWithPivot({
      pivotColumnTree: [{ value: 'HEALTH', path: ['HEALTH'], children: [] }],
      pivotLeafPaths: [['HEALTH']],
    }));
    expect(h.rebuildSubgridStack.mock.calls.length).toBeGreaterThan(rebuildsAfterFirst);
  });

  it('reverts to primary tree when a chunk arrives WITHOUT pivotColumnTree', () => {
    const h = makeHarness({ pivotMode: true });
    h.engine.setPivotColumns(['sector']);
    h.engine.addValueColumn('pnl', 'sum');
    h.engine.maybeSyncPivotColumns(chunkWithPivot());
    const savedPrimary = h.engine.getPrimaryColumnTree();
    expect(savedPrimary).not.toBeNull();
    // Reset call counts so we can observe the revert clearly.
    h.rebuildSubgridStack.mockClear();
    h.recomputeViewport.mockClear();
    h.requestRepaint.mockClear();
    h.requestViewport.mockClear();
    h.engine.maybeSyncPivotColumns(chunkWithoutPivot());
    expect(h.engine.isPivotActive()).toBe(false);
    expect(h.engine.getPivotResultColumns()).toEqual([]);
    expect(h.engine.getPrimaryColumnTree()).toBeNull();
    // Revert re-fetches a viewport since the current chunk carried no
    // primary data (pivot values only).
    expect(h.requestViewport).toHaveBeenCalled();
    expect(h.rebuildSubgridStack).toHaveBeenCalled();
  });

  it('handleStateChanged reverts synthesized columns when the state transitions from active to inactive', async () => {
    const h = makeHarness({ pivotMode: true });
    h.engine.setPivotColumns(['sector']);
    h.engine.addValueColumn('pnl', 'sum');
    h.engine.maybeSyncPivotColumns(chunkWithPivot());
    expect(h.engine.isPivotActive()).toBe(true);
    // Drop the value column → pivot becomes inactive → handler reverts.
    h.engine.removeValueColumn('pnl');
    expect(h.engine.isPivotActive()).toBe(false);
    expect(h.engine.getPrimaryColumnTree()).toBeNull();
  });
});

describe('PivotEngine — runtime option flips', () => {
  it('updateMaxGeneratedColumns forwards to the worker + requests a viewport', async () => {
    const h = makeHarness();
    h.engine.updateMaxGeneratedColumns(500);
    await flush();
    expect(h.setWorkerPivotMaxGeneratedColumns).toHaveBeenCalledWith(500);
    expect(h.requestViewport).toHaveBeenCalled();
  });

  it('updateStrictColumnOrder forwards to the worker + requests a viewport', async () => {
    const h = makeHarness();
    h.engine.updateStrictColumnOrder(true);
    await flush();
    expect(h.setWorkerStrictPivotColumnOrder).toHaveBeenCalledWith(true);
    expect(h.requestViewport).toHaveBeenCalled();
  });

  it('updateTotalsOption rebuilds the subgrid stack + recomputes + requests a viewport', () => {
    const h = makeHarness();
    h.engine.updateTotalsOption();
    expect(h.rebuildSubgridStack).toHaveBeenCalled();
    expect(h.recomputeViewport).toHaveBeenCalled();
    expect(h.requestViewport).toHaveBeenCalled();
  });
});

describe('PivotEngine — lifecycle + destroyed guard', () => {
  it('isDestroyed short-circuits every mutation + option flip', async () => {
    const h = makeHarness();
    h.destroyed.value = true;
    h.engine.setPivotMode(true);
    h.engine.setPivotColumns(['sector']);
    h.engine.addValueColumn('pnl', 'sum');
    h.engine.updateMaxGeneratedColumns(500);
    h.engine.updateStrictColumnOrder(true);
    h.engine.updateTotalsOption();
    await flush();
    expect(h.seen.length).toBe(0);
    expect(h.updateWorkerColumns).not.toHaveBeenCalled();
    expect(h.setWorkerPivotMaxGeneratedColumns).not.toHaveBeenCalled();
    expect(h.setWorkerStrictPivotColumnOrder).not.toHaveBeenCalled();
    // updateTotalsOption bails out early before touching CGrid.
    expect(h.rebuildSubgridStack).not.toHaveBeenCalled();
  });

  it('destroy unsubscribes so a late state event cannot re-emit', () => {
    const h = makeHarness();
    h.engine.destroy();
    // Attempting to mutate after destroy is silently swallowed by
    // PivotState.destroyed guard — the emitter is torn down anyway.
    h.engine.setPivotMode(true);
    expect(h.seen.length).toBe(0);
  });
});
