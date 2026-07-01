// Cycle 9 / Task 6 — programmatic cell-range API + `cellSelection`
// option bundle.
//
// `CGridApi.getCellRanges() / addCellRange() / clearCellRanges()` surface
// the SelectionModel.ranges list to applications. `CGridOptions.cellSelection`
// bundles three runtime-mutable suppression flags:
//   - `suppressHeader` → header click no longer selects a column band
//     (sort cycling unaffected).
//   - `suppressDrag`   → mouse drag / plain click no longer creates a
//     cell range.
//   - `suppressRow`    → row-header click (Cycle 14) won't select a row
//     band. Plumbed but unused in Cycle 9.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { RangeSelection } from '../src/interaction/features/rangeSelection';
import { HeaderClick } from '../src/interaction/features/headerClick';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { CGridEventCtx } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as any;
  })() as any;
});

interface Row { id: string; a: number; b: number }
function build(
  options: Partial<Parameters<typeof CGrid>[1]> = {},
): { grid: CGrid<Row>; container: HTMLDivElement } {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const rows: Row[] = [
    { id: '1', a: 1, b: 2 },
    { id: '2', a: 3, b: 4 },
    { id: '3', a: 5, b: 6 },
  ];
  const grid = new CGrid<Row>(container, {
    columnDefs: [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
    getRowId: (r) => r.id,
    rowData: rows,
    ...options,
  } as any);
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  return { grid, container };
}

describe('CGridApi cell-range methods (Cycle 9 / Task 6)', () => {
  it('getCellRanges() returns an empty array when no ranges are set', () => {
    const { grid } = build();
    expect(grid.getCellRanges()).toEqual([]);
    grid.destroy();
  });

  it('addCellRange appends to the ranges list; getCellRanges reflects the addition', () => {
    const { grid } = build();
    const range = { rowStart: 0, rowEnd: 2, colIds: ['a'] };
    grid.addCellRange(range);
    expect(grid.getCellRanges()).toEqual([range]);
    grid.destroy();
  });

  it('multiple addCellRange calls accumulate (disjoint ranges supported)', () => {
    const { grid } = build();
    grid.addCellRange({ rowStart: 0, rowEnd: 0, colIds: ['a'] });
    grid.addCellRange({ rowStart: 2, rowEnd: 2, colIds: ['b'] });
    expect(grid.getCellRanges()).toEqual([
      { rowStart: 0, rowEnd: 0, colIds: ['a'] },
      { rowStart: 2, rowEnd: 2, colIds: ['b'] },
    ]);
    grid.destroy();
  });

  it('clearCellRanges drops every range', () => {
    const { grid } = build();
    grid.addCellRange({ rowStart: 0, rowEnd: 2, colIds: ['a'] });
    grid.addCellRange({ rowStart: 2, rowEnd: 2, colIds: ['b'] });
    grid.clearCellRanges();
    expect(grid.getCellRanges()).toEqual([]);
    grid.destroy();
  });

  it('getCellRanges returns a fresh array — mutating the result does NOT modify selection state', () => {
    const { grid } = build();
    grid.addCellRange({ rowStart: 0, rowEnd: 2, colIds: ['a'] });
    const snapshot = grid.getCellRanges();
    snapshot.pop();
    snapshot.push({ rowStart: 99, rowEnd: 99, colIds: ['z'] });
    expect(grid.getCellRanges()).toEqual([
      { rowStart: 0, rowEnd: 2, colIds: ['a'] },
    ]);
    grid.destroy();
  });

  it('clearCellRanges does not affect row selection or focused cell', () => {
    const { grid } = build({ rowSelection: 'multiple' } as any);
    // Touch the selection model directly so we don't depend on the worker
    // round-trip that `setSelectedRowIds` / `setFocusedCell` need to resolve
    // rowIds → indices in the test harness.
    const sel = (grid as any).selection;
    sel.selectSingle(0);
    sel.setFocus(0, 'a');
    const focusBefore = sel.state.focusedRowIndex;
    const rowsBefore = new Set(sel.state.selectedRowIndices);
    grid.addCellRange({ rowStart: 0, rowEnd: 0, colIds: ['a'] });
    grid.clearCellRanges();
    expect(grid.getCellRanges()).toEqual([]);
    expect(sel.state.focusedRowIndex).toBe(focusBefore);
    expect(sel.state.selectedRowIndices).toEqual(rowsBefore);
    grid.destroy();
  });

  it('addCellRange after clearCellRanges starts a fresh list', () => {
    const { grid } = build();
    grid.addCellRange({ rowStart: 0, rowEnd: 0, colIds: ['a'] });
    grid.clearCellRanges();
    grid.addCellRange({ rowStart: 1, rowEnd: 1, colIds: ['b'] });
    expect(grid.getCellRanges()).toEqual([
      { rowStart: 1, rowEnd: 1, colIds: ['b'] },
    ]);
    grid.destroy();
  });

  it('exposes the same methods on the gridReady api payload', () => {
    const { grid } = build();
    let api: any;
    grid.on('gridReady', (e) => { api = (e as any).api; });
    // gridReady fires synchronously on construction — it already fired before
    // we subscribed. Re-emit via a no-op refresh path: open a fresh grid in
    // the same vein so we capture the event.
    grid.destroy();
    const { grid: grid2 } = build();
    grid2.on('gridReady', (e) => { api = (e as any).api; });
    // The CGridApi factory must wire the three methods.
    const proxy = (grid2 as any).makeApi();
    proxy.addCellRange({ rowStart: 0, rowEnd: 0, colIds: ['a'] });
    expect(grid2.getCellRanges()).toEqual([{ rowStart: 0, rowEnd: 0, colIds: ['a'] }]);
    expect(proxy.getCellRanges()).toEqual([{ rowStart: 0, rowEnd: 0, colIds: ['a'] }]);
    proxy.clearCellRanges();
    expect(grid2.getCellRanges()).toEqual([]);
    grid2.destroy();
  });
});

// --- cellSelection suppression flags (feature-level wiring) ---
//
// Driven directly against `RangeSelection` / `HeaderClick` so the test
// doesn't need to plumb pointer events through the canvas. The flag is
// read at event time via `ctx.grid.getCellSelectionOptions()`, so the
// mock just returns whatever the test sets.

interface MockGrid {
  selection: SelectionModel;
  allColIds: () => string[];
  totalRowCount?: () => number;
  selectColumn?: (colId: string, opts?: { extend?: boolean }) => void;
  cycleSort?: (colId: string, opts?: { append?: boolean }) => void;
  getMultiSortKey?: () => 'Shift' | 'Ctrl' | 'Alt' | null;
  toggleColumnGroup?: (groupId: string) => void;
  getCellSelectionOptions?: () => {
    suppressHeader?: boolean;
    suppressRow?: boolean;
    suppressDrag?: boolean;
  } | undefined;
  /** Task 7 — features emit `rangeSelectionChanged` through this hook.
   *  Mocks default to a no-op (event semantics tested in
   *  rangeSelectionEvents.test.ts). */
  emitRangeSelectionChanged?: (started: boolean, finished: boolean) => void;
}

function ctx(
  hit: Hit,
  grid: MockGrid,
  raw: MouseEvent = new MouseEvent('mousedown'),
): CGridEventCtx {
  return {
    hit,
    point: { x: 0, y: 0 },
    grid: grid as unknown as CGridEventCtx['grid'],
    raw,
  };
}

function makeGrid(
  cellSelection: MockGrid['getCellSelectionOptions'] extends infer F
    ? F extends () => infer R ? R : never
    : never,
): MockGrid {
  const selection = new SelectionModel('multiple');
  const allColIds = () => ['cusip', 'ticker', 'price', 'qty'];
  const rowCount = 100;
  return {
    selection,
    allColIds,
    totalRowCount: () => rowCount,
    selectColumn: (colId, opts) =>
      selection.selectColumnBand(colId, allColIds(), rowCount, opts?.extend === true),
    cycleSort: vi.fn(),
    getMultiSortKey: () => 'Shift',
    toggleColumnGroup: () => {},
    getCellSelectionOptions: () => cellSelection,
    emitRangeSelectionChanged: () => {},
  };
}

describe('cellSelection.suppressDrag — RangeSelection no-ops on cell mousedown (Cycle 9 / Task 6)', () => {
  it('plain mousedown on a data cell does NOT create a range', () => {
    const f = new RangeSelection();
    const grid = makeGrid({ suppressDrag: true });
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, grid));
    expect(grid.selection.getRanges()).toEqual([]);
  });

  it('drag with suppressDrag does NOT widen any range', () => {
    const f = new RangeSelection();
    const grid = makeGrid({ suppressDrag: true });
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, grid));
    expect(grid.selection.getRanges()).toEqual([]);
  });

  it('shift-click with suppressDrag does NOT extend (range pathway is fully suppressed)', () => {
    const f = new RangeSelection();
    const grid = makeGrid({ suppressDrag: true });
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 0, colIds: ['cusip'] }]);
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, grid,
        new MouseEvent('mousedown', { shiftKey: true })),
    );
    // Existing range untouched; shift-extend is part of the range pathway
    // and is suppressed wholesale.
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 0, colIds: ['cusip'] },
    ]);
  });

  it('ctrl-click with suppressDrag does NOT add a disjoint range', () => {
    const f = new RangeSelection();
    const grid = makeGrid({ suppressDrag: true });
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 0, colIds: ['cusip'] }]);
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, grid,
        new MouseEvent('mousedown', { ctrlKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 0, colIds: ['cusip'] },
    ]);
  });

  it('suppressDrag still FORWARDS the mousedown so CellSelection sets focus + row selection', () => {
    const f = new RangeSelection();
    const grid = makeGrid({ suppressDrag: true });
    let downstreamSawMouseDown = false;
    f.next = {
      handleMouseDown: () => { downstreamSawMouseDown = true; },
      handleMouseDrag: () => {},
      handleMouseUp: () => {},
      handleMouseMove: () => {},
      handleClick: () => {},
      handleDoubleClick: () => {},
      handleKeyDown: () => {},
      handleWheel: () => {},
      setCursor: () => {},
    } as never;
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, grid));
    expect(downstreamSawMouseDown).toBe(true);
  });

  it('omitting cellSelection (undefined) leaves drag behavior unchanged', () => {
    const f = new RangeSelection();
    const grid = makeGrid(undefined);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 2, rowEnd: 2, colIds: ['cusip'] },
    ]);
  });

  it('suppressDrag is read at event time — flipping the mock between events takes effect on the next mousedown', () => {
    const f = new RangeSelection();
    let suppress = false;
    const grid = makeGrid(undefined);
    grid.getCellSelectionOptions = () => ({ suppressDrag: suppress });
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, grid));
    expect(grid.selection.getRanges().length).toBe(1);
    grid.selection.clearRanges();
    suppress = true;
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 1, colId: 'ticker' }, grid));
    expect(grid.selection.getRanges()).toEqual([]);
  });
});

describe('cellSelection.suppressHeader — HeaderClick skips column-band selection (Cycle 9 / Task 6)', () => {
  it('plain header click does NOT select a column band when suppressHeader is true', () => {
    const f = new HeaderClick();
    const grid = makeGrid({ suppressHeader: true });
    f.handleClick(ctx({ kind: 'header', colId: 'ticker' }, grid, new MouseEvent('click')));
    expect(grid.selection.getRanges()).toEqual([]);
  });

  it('plain header click STILL cycles sort even when suppressHeader is true', () => {
    const f = new HeaderClick();
    const grid = makeGrid({ suppressHeader: true });
    f.handleClick(ctx({ kind: 'header', colId: 'ticker' }, grid, new MouseEvent('click')));
    expect(grid.cycleSort).toHaveBeenCalledWith('ticker', { append: false });
  });

  it('shift-click header still cycles sort with append=true; column band is suppressed', () => {
    const f = new HeaderClick();
    const grid = makeGrid({ suppressHeader: true });
    f.handleClick(
      ctx({ kind: 'header', colId: 'qty' }, grid, new MouseEvent('click', { shiftKey: true })),
    );
    expect(grid.cycleSort).toHaveBeenCalledWith('qty', { append: true });
    expect(grid.selection.getRanges()).toEqual([]);
  });

  it('suppressHeader is read at event time — flipping the mock takes effect on the next click', () => {
    const f = new HeaderClick();
    let suppress = false;
    const grid = makeGrid(undefined);
    grid.getCellSelectionOptions = () => ({ suppressHeader: suppress });
    f.handleClick(ctx({ kind: 'header', colId: 'cusip' }, grid, new MouseEvent('click')));
    expect(grid.selection.getRanges().length).toBe(1);
    grid.selection.clearRanges();
    suppress = true;
    f.handleClick(ctx({ kind: 'header', colId: 'ticker' }, grid, new MouseEvent('click')));
    expect(grid.selection.getRanges()).toEqual([]);
  });
});

describe('CGridOptions.cellSelection round-trips via setGridOption (Cycle 9 / Task 6)', () => {
  it('initial cellSelection option is honored by getGridOption', () => {
    const { grid } = build({
      cellSelection: { suppressDrag: true, suppressHeader: false },
    } as any);
    expect(grid.getGridOption('cellSelection' as any)).toEqual({
      suppressDrag: true,
      suppressHeader: false,
    });
    grid.destroy();
  });

  it('setGridOption(cellSelection, …) updates the resolved options bundle', () => {
    const { grid } = build();
    grid.setGridOption('cellSelection' as any, { suppressDrag: true } as any);
    expect(grid.getGridOption('cellSelection' as any)).toEqual({ suppressDrag: true });
    grid.destroy();
  });
});
