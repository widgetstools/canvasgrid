// Cycle 9 / Task 7 — rangeSelectionChanged + cellSelectionChanged events.
//
// rangeSelectionChanged fires on range start, mid-drag, end, and on
// programmatic mutation. Payload `{ ranges, started, finished }`.
//   - started: true on the initial mousedown that begins a drag, OR on
//     a single-step programmatic / modifier-click mutation that both
//     starts and finishes in the same instant.
//   - finished: true on the mouseup that ends a drag, OR on every
//     programmatic mutation. Always false during drag-in-progress ticks.
//
// cellSelectionChanged is the debounced sibling — fires once per
// `finished: true` ping, and only when the SET of ranges actually
// changed since the last emission. Apps that persist selection state
// listen for this one to avoid the per-tick drag firehose.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { RangeSelection } from '../src/interaction/features/rangeSelection';
import { FillHandle } from '../src/interaction/features/fillHandle';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { VelocityGridEventCtx } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';
import type { SelectionRange } from '../src/types';

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
function build(): { grid: VelocityGrid<Row> } {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const rows: Row[] = [
    { id: '1', a: 1, b: 2 },
    { id: '2', a: 3, b: 4 },
    { id: '3', a: 5, b: 6 },
  ];
  const grid = new VelocityGrid<Row>(container, {
    columnDefs: [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
    getRowId: (r) => r.id,
    rowData: rows,
  } as any);
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  return { grid };
}

// --- API-driven events (VelocityGrid integration) ----------------------------------

describe('rangeSelectionChanged + cellSelectionChanged — API mutations (Cycle 9 / Task 7)', () => {
  it('addCellRange fires rangeSelectionChanged with started + finished, plus cellSelectionChanged', () => {
    const { grid } = build();
    const rangeEvents: any[] = [];
    const cellEvents: any[] = [];
    grid.on('rangeSelectionChanged', (e) => rangeEvents.push(e));
    grid.on('cellSelectionChanged', (e) => cellEvents.push(e));

    const range = { rowStart: 0, rowEnd: 2, colIds: ['a'] };
    grid.addCellRange(range);

    expect(rangeEvents).toHaveLength(1);
    expect(rangeEvents[0]).toMatchObject({
      type: 'rangeSelectionChanged',
      started: true,
      finished: true,
    });
    expect(rangeEvents[0].ranges).toEqual([range]);

    expect(cellEvents).toHaveLength(1);
    expect(cellEvents[0]).toMatchObject({ type: 'cellSelectionChanged' });
    expect(cellEvents[0].ranges).toEqual([range]);
    grid.destroy();
  });

  it('clearCellRanges (with active ranges) fires rangeSelectionChanged finished + cellSelectionChanged', () => {
    const { grid } = build();
    grid.addCellRange({ rowStart: 0, rowEnd: 0, colIds: ['a'] });
    const rangeEvents: any[] = [];
    const cellEvents: any[] = [];
    grid.on('rangeSelectionChanged', (e) => rangeEvents.push(e));
    grid.on('cellSelectionChanged', (e) => cellEvents.push(e));

    grid.clearCellRanges();

    expect(rangeEvents).toHaveLength(1);
    expect(rangeEvents[0]).toMatchObject({
      type: 'rangeSelectionChanged',
      finished: true,
    });
    expect(rangeEvents[0].ranges).toEqual([]);

    expect(cellEvents).toHaveLength(1);
    expect(cellEvents[0].ranges).toEqual([]);
    grid.destroy();
  });

  it('clearCellRanges on an already-empty list emits nothing (idempotent)', () => {
    const { grid } = build();
    const rangeEvents: any[] = [];
    const cellEvents: any[] = [];
    grid.on('rangeSelectionChanged', (e) => rangeEvents.push(e));
    grid.on('cellSelectionChanged', (e) => cellEvents.push(e));

    grid.clearCellRanges();

    expect(rangeEvents).toHaveLength(0);
    expect(cellEvents).toHaveLength(0);
    grid.destroy();
  });

  it('successive addCellRange calls each fire their own pair of events', () => {
    const { grid } = build();
    const rangeEvents: any[] = [];
    const cellEvents: any[] = [];
    grid.on('rangeSelectionChanged', (e) => rangeEvents.push(e));
    grid.on('cellSelectionChanged', (e) => cellEvents.push(e));

    grid.addCellRange({ rowStart: 0, rowEnd: 0, colIds: ['a'] });
    grid.addCellRange({ rowStart: 2, rowEnd: 2, colIds: ['b'] });

    expect(rangeEvents).toHaveLength(2);
    expect(cellEvents).toHaveLength(2);
    expect(cellEvents[1].ranges).toEqual([
      { rowStart: 0, rowEnd: 0, colIds: ['a'] },
      { rowStart: 2, rowEnd: 2, colIds: ['b'] },
    ]);
    grid.destroy();
  });

  it('event ranges payload is a fresh array — pushing onto it does not grow the live range list', () => {
    const { grid } = build();
    let captured: any = null;
    grid.on('rangeSelectionChanged', (e) => { captured = e; });
    grid.addCellRange({ rowStart: 0, rowEnd: 0, colIds: ['a'] });
    captured.ranges.push({ rowStart: 99, rowEnd: 99, colIds: ['z'] });
    expect(grid.getCellRanges()).toEqual([{ rowStart: 0, rowEnd: 0, colIds: ['a'] }]);
    grid.destroy();
  });
});

// --- Feature-driven events via the VelocityGridLike emit hook ----------------------
//
// RangeSelection + FillHandle call into `ctx.grid.emitRangeSelectionChanged`
// at the start, mid, and end of a gesture. The mocks below capture every
// call so we can assert exact start/mid/end semantics without spinning the
// full VelocityGrid harness.

interface EmitCall { started: boolean; finished: boolean }

interface MockGrid {
  selection: SelectionModel;
  allColIds: () => string[];
  emits: EmitCall[];
  emitRangeSelectionChanged: (started: boolean, finished: boolean) => void;
  getCellSelectionOptions?: () => undefined;
  // fill-handle plumbing (unused by RangeSelection tests but harmless to
  // include — keeps a single shared mock factory)
  getEnableFillHandle?: () => boolean;
  getFillHandleDirection?: () => 'x' | 'y' | 'xy';
  getRangeBottomRight?: (range: SelectionRange) => { x: number; y: number } | null;
  commitFill?: (source: SelectionRange, target: SelectionRange) => void;
  // Cycle 9 patch / Task 2 — auto-scroll surface. Default rect is generous
  // so the drag points used in these tests stay comfortably inside the
  // body and the rAF loop never kicks in.
  getBodyRect?: () => { left: number; right: number; top: number; bottom: number };
  scrollBy?: (dx: number, dy: number) => void;
  hitTester?: { locate: (x: number, y: number) => Hit };
}

function makeMock(): MockGrid {
  const selection = new SelectionModel('multiple');
  const emits: EmitCall[] = [];
  return {
    selection,
    allColIds: () => ['cusip', 'ticker', 'price', 'qty'],
    emits,
    emitRangeSelectionChanged: (started, finished) => emits.push({ started, finished }),
    getCellSelectionOptions: () => undefined,
    getEnableFillHandle: () => true,
    getFillHandleDirection: () => 'y',
    getRangeBottomRight: (range) => {
      const cols = ['cusip', 'ticker', 'price', 'qty'];
      const lastColId = range.colIds[range.colIds.length - 1]!;
      const colIdx = cols.indexOf(lastColId);
      if (colIdx < 0) return null;
      return { x: (colIdx + 1) * 100, y: 32 + (range.rowEnd + 1) * 30 };
    },
    commitFill: vi.fn(),
    getBodyRect: () => ({ left: 0, right: 1000, top: 0, bottom: 1000 }),
    scrollBy: () => {},
    hitTester: { locate: () => ({ kind: 'empty' }) },
  };
}

function ctx(
  hit: Hit,
  grid: MockGrid,
  raw: MouseEvent = new MouseEvent('mousedown'),
  point: { x: number; y: number } = { x: 0, y: 0 },
): VelocityGridEventCtx {
  return {
    hit,
    point,
    grid: grid as unknown as VelocityGridEventCtx['grid'],
    raw,
  };
}

describe('RangeSelection — emits start/mid/end (Cycle 9 / Task 7)', () => {
  it('plain drag fires start on mousedown, mid on each mousemove tick, end on mouseup', () => {
    const f = new RangeSelection();
    const grid = makeMock();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 1, colId: 'cusip' }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, grid));
    expect(grid.emits).toEqual([
      { started: true, finished: false },
      { started: false, finished: false },
      { started: false, finished: false },
      { started: false, finished: true },
    ]);
  });

  it('shift-click fires a single started + finished event (no drag state)', () => {
    const f = new RangeSelection();
    const grid = makeMock();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 0, colIds: ['cusip'] }]);
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, grid,
        new MouseEvent('mousedown', { shiftKey: true })),
    );
    expect(grid.emits).toEqual([{ started: true, finished: true }]);
    // A follow-up mouseup with no in-progress drag must NOT fire another
    // end event (shift-click was already finished).
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, grid));
    expect(grid.emits).toEqual([{ started: true, finished: true }]);
  });

  it('ctrl-click fires a single started + finished event (no drag state)', () => {
    const f = new RangeSelection();
    const grid = makeMock();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 0, colIds: ['cusip'] }]);
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, grid,
        new MouseEvent('mousedown', { ctrlKey: true })),
    );
    expect(grid.emits).toEqual([{ started: true, finished: true }]);
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, grid));
    expect(grid.emits).toEqual([{ started: true, finished: true }]);
  });

  it('mousedown on a non-cell hit fires nothing (event forwarded, not claimed)', () => {
    const f = new RangeSelection();
    const grid = makeMock();
    f.handleMouseDown(ctx({ kind: 'header', colId: 'cusip' }, grid));
    expect(grid.emits).toHaveLength(0);
  });

  it('mouseup without a preceding mousedown fires nothing (idle state)', () => {
    const f = new RangeSelection();
    const grid = makeMock();
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, grid));
    expect(grid.emits).toHaveLength(0);
  });
});

describe('FillHandle — emits start/mid/end (Cycle 9 / Task 7)', () => {
  it('drag-extend fires start on first drag tick, mid on subsequent, end on mouseup', () => {
    const f = new FillHandle();
    const grid = makeMock();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    // Claim the handle (no emit yet — range hasn't visibly changed).
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, grid,
      new MouseEvent('mousedown'), { x: 100, y: 122 }));
    expect(grid.emits).toHaveLength(0);

    // First drag tick — emits start.
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 3, colId: 'cusip' }, grid,
      new MouseEvent('mousemove'), { x: 100, y: 152 }));
    // Subsequent drag tick — emits mid.
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 5, colId: 'cusip' }, grid,
      new MouseEvent('mousemove'), { x: 100, y: 212 }));
    // Mouseup — emits end.
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 5, colId: 'cusip' }, grid,
      new MouseEvent('mouseup'), { x: 100, y: 212 }));

    expect(grid.emits).toEqual([
      { started: true, finished: false },
      { started: false, finished: false },
      { started: false, finished: true },
    ]);
  });

  it('claim without drag (mouseup with no movement) fires nothing — no fill happened', () => {
    const f = new FillHandle();
    const grid = makeMock();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, grid,
      new MouseEvent('mousedown'), { x: 100, y: 122 }));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, grid,
      new MouseEvent('mouseup'), { x: 100, y: 122 }));
    expect(grid.emits).toHaveLength(0);
  });

  it('mousedown that does NOT claim the handle (outside hit zone) fires nothing', () => {
    const f = new FillHandle();
    const grid = makeMock();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, grid,
      new MouseEvent('mousedown'), { x: 50, y: 50 }));
    expect(grid.emits).toHaveLength(0);
  });
});

// --- cellSelectionChanged dedupe semantics ---------------------------------
//
// Drives the VelocityGrid integration directly: simulate a programmatic mutation
// path that ends with no net change in the range set and assert the
// cellSelectionChanged event is suppressed even though rangeSelectionChanged
// still fires with finished:true.

describe('cellSelectionChanged — only on finished + actual change (Cycle 9 / Task 7)', () => {
  it('mid-drag rangeSelectionChanged pings do NOT trigger cellSelectionChanged', () => {
    const { grid } = build();
    const rangeEvents: any[] = [];
    const cellEvents: any[] = [];
    grid.on('rangeSelectionChanged', (e) => rangeEvents.push(e));
    grid.on('cellSelectionChanged', (e) => cellEvents.push(e));

    // Drive the integration directly via the VelocityGridLike emit hook on the
    // grid surface so we don't need to plumb pointer events through the
    // canvas. emitRangeSelectionChanged is plumbed through to features
    // via featureChain; calling it directly on the grid here exercises
    // the same code path the features use.
    const featureGrid = (grid as any).featureChain as any;
    // featureChain stores the grid surface as `grid` on the chain object.
    const surface = featureGrid.grid as { emitRangeSelectionChanged: (s: boolean, f: boolean) => void };
    // Place a range so mid-drag emits have something to report.
    (grid as any).selection.setRanges([{ rowStart: 0, rowEnd: 1, colIds: ['a'] }]);
    surface.emitRangeSelectionChanged(true, false);
    (grid as any).selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['a'] }]);
    surface.emitRangeSelectionChanged(false, false);
    (grid as any).selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['a', 'b'] }]);
    surface.emitRangeSelectionChanged(false, false);

    expect(rangeEvents).toHaveLength(3);
    expect(cellEvents).toHaveLength(0); // none yet — all mid-drag ticks

    surface.emitRangeSelectionChanged(false, true);
    expect(rangeEvents).toHaveLength(4);
    expect(cellEvents).toHaveLength(1);
    expect(cellEvents[0].ranges).toEqual([{ rowStart: 0, rowEnd: 2, colIds: ['a', 'b'] }]);
    grid.destroy();
  });

  it('two successive finished pings with NO net change between them fire cellSelectionChanged only once', () => {
    const { grid } = build();
    const cellEvents: any[] = [];
    grid.on('cellSelectionChanged', (e) => cellEvents.push(e));

    grid.addCellRange({ rowStart: 0, rowEnd: 0, colIds: ['a'] });
    expect(cellEvents).toHaveLength(1);

    // A redundant emit — same ranges, finished: true. Must NOT double-fire.
    const featureGrid = (grid as any).featureChain as any;
    const surface = featureGrid.grid as { emitRangeSelectionChanged: (s: boolean, f: boolean) => void };
    surface.emitRangeSelectionChanged(false, true);
    expect(cellEvents).toHaveLength(1);

    grid.clearCellRanges();
    expect(cellEvents).toHaveLength(2);
    grid.destroy();
  });
});
