import { describe, it, expect, vi } from 'vitest';
import {
  RangeSelection,
  computeAutoScrollDelta,
  EDGE_PX,
  MAX_SCROLL_PX_PER_FRAME,
} from '../src/interaction/features/rangeSelection';
import { HeaderClick } from '../src/interaction/features/headerClick';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { VelocityGridEventCtx } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';

interface MockGrid {
  selection: SelectionModel;
  allColIds: () => string[];
  /** Task 4 — header-click + selectColumn. The mock plumbs the real
   *  SelectionModel.selectColumnBand so tests assert end-to-end state
   *  rather than args-only spying. */
  totalRowCount?: () => number;
  selectColumn?: (colId: string, opts?: { extend?: boolean }) => void;
  cycleSort?: (colId: string, opts?: { append?: boolean }) => void;
  getMultiSortKey?: () => 'Shift' | 'Ctrl' | 'Alt' | null;
  toggleColumnGroup?: (groupId: string) => void;
  /** Task 6 — `cellSelection` suppression. Features read this at event
   *  time; mocks default to `undefined` (gestures behave with Cycle 9
   *  defaults). */
  getCellSelectionOptions?: () => {
    suppressHeader?: boolean;
    suppressRow?: boolean;
    suppressDrag?: boolean;
  } | undefined;
  /** Task 7 — features emit `rangeSelectionChanged` through this hook.
   *  Mocks default to a no-op (event semantics tested in
   *  rangeSelectionEvents.test.ts). */
  emitRangeSelectionChanged?: (started: boolean, finished: boolean) => void;
  /** Cycle 9 patch / Task 2 — body rectangle used by the auto-scroll
   *  loop's edge-zone math. Default rect is generous (1000×1000) so the
   *  existing drag tests' canvas-local points fall comfortably inside the
   *  body and the auto-scroll loop never kicks in. Specs that exercise
   *  the edge-zone path override it. */
  getBodyRect?: () => { left: number; right: number; top: number; bottom: number };
  /** Cycle 9 patch / Task 2 — `scrollBy` hook for the auto-scroll loop.
   *  Default no-op so the existing drag tests don't need to thread one. */
  scrollBy?: (dx: number, dy: number) => void;
  /** Cycle 9 patch / Task 2 — `hitTester` surface used by the rAF tick
   *  to re-hit-test at the captured pointer after a scroll. Default is
   *  a stub that returns `{ kind: 'empty' }` so non-auto-scroll specs
   *  don't need a real viewport. */
  hitTester?: { locate: (x: number, y: number) => Hit };
}

function ctx(
  hit: Hit,
  point: { x: number; y: number },
  grid: MockGrid,
  raw: MouseEvent = new MouseEvent('mousedown'),
): VelocityGridEventCtx {
  return {
    hit,
    point,
    grid: grid as unknown as VelocityGridEventCtx['grid'],
    raw,
  };
}

function makeGrid(overrides: Partial<MockGrid> = {}): MockGrid {
  return {
    selection: new SelectionModel('multiple'),
    allColIds: () => ['cusip', 'ticker', 'price', 'qty'],
    getCellSelectionOptions: () => undefined,
    emitRangeSelectionChanged: () => {},
    getBodyRect: () => ({ left: 0, right: 1000, top: 0, bottom: 1000 }),
    scrollBy: () => {},
    hitTester: { locate: () => ({ kind: 'empty' }) },
    ...overrides,
  };
}

/** Task 4 — richer mock that wires `selectColumn` to the real
 *  `SelectionModel.selectColumnBand` so header-click tests assert
 *  the final selection state rather than spying on call args. */
function makeFullGrid(
  overrides: Partial<MockGrid> & { rowCount?: number } = {},
): MockGrid & {
  cycleSort: ReturnType<typeof vi.fn>;
  selectColumnSpy: ReturnType<typeof vi.fn>;
} {
  const selection = overrides.selection ?? new SelectionModel('multiple');
  const allCols = overrides.allColIds ?? (() => ['cusip', 'ticker', 'price', 'qty']);
  const rowCount = overrides.rowCount ?? 100;
  const selectColumnSpy = vi.fn();
  const cycleSort = vi.fn();
  const grid: MockGrid = {
    selection,
    allColIds: allCols,
    totalRowCount: () => rowCount,
    selectColumn: (colId, opts) => {
      selectColumnSpy(colId, opts);
      selection.selectColumnBand(colId, allCols(), rowCount, opts?.extend === true);
    },
    cycleSort,
    getMultiSortKey: () => 'Shift',
    toggleColumnGroup: () => {},
    getCellSelectionOptions: () => undefined,
    emitRangeSelectionChanged: () => {},
    getBodyRect: () => ({ left: 0, right: 1000, top: 0, bottom: 1000 }),
    scrollBy: () => {},
    hitTester: { locate: () => ({ kind: 'empty' }) },
    ...overrides,
  };
  return Object.assign(grid, { cycleSort, selectColumnSpy });
}

describe('RangeSelection (Cycle 9 / Task 2)', () => {
  it('mousedown on a cell anchors a 1x1 range', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    const hit: Hit = { kind: 'cell', rowIndex: 2, colId: 'cusip' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 50 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 2, rowEnd: 2, colIds: ['cusip'] },
    ]);
  });

  it('drag from (r=2, cusip) to (r=5, ticker) expands the range across rows + the columns between in render order', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, { x: 110, y: 110 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 2, rowEnd: 5, colIds: ['cusip', 'ticker'] },
    ]);
  });

  it('drag across more than two adjacent columns includes every intermediate column in render order', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 0, colId: 'qty' }, { x: 320, y: 30 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 0, colIds: ['cusip', 'ticker', 'price', 'qty'] },
    ]);
  });

  it('drag upward (anchor below target) yields rowStart=min, rowEnd=max', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 7, colId: 'price' }, { x: 220, y: 200 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 3, colId: 'ticker' }, { x: 110, y: 80 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 3, rowEnd: 7, colIds: ['ticker', 'price'] },
    ]);
  });

  it('drag leftward (anchor right-of target) preserves render-order colIds', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 1, colId: 'qty' }, { x: 320, y: 60 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 1, colId: 'cusip' }, { x: 10, y: 60 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 1, rowEnd: 1, colIds: ['cusip', 'ticker', 'price', 'qty'] },
    ]);
  });

  it('mouseup commits the range; mousemove without a mousedown does NOT modify ranges', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, { x: 110, y: 110 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, { x: 110, y: 110 }, grid));
    const committed = grid.selection.getRanges();
    expect(committed).toEqual([
      { rowStart: 2, rowEnd: 5, colIds: ['cusip', 'ticker'] },
    ]);
    // Idle: a drag tick with no preceding mousedown must be ignored.
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 9, colId: 'qty' }, { x: 320, y: 220 }, grid));
    expect(grid.selection.getRanges()).toEqual(committed);
  });

  it('a fresh mousedown REPLACES the existing range (Task 4 layers shift/ctrl semantics on top)', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, { x: 110, y: 80 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, { x: 110, y: 80 }, grid));
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 6, colId: 'price' }, { x: 220, y: 180 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 6, rowEnd: 6, colIds: ['price'] },
    ]);
  });

  it('mousedown on a header is forwarded to the next feature (does NOT start a range)', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    const hit: Hit = { kind: 'header', colId: 'cusip' };
    let forwarded = false;
    f.next = {
      handleMouseDown: () => { forwarded = true; },
      handleMouseDrag: () => {},
      handleMouseUp: () => {},
      handleMouseMove: () => {},
      handleClick: () => {},
      handleDoubleClick: () => {},
      handleKeyDown: () => {},
      handleWheel: () => {},
      setCursor: () => {},
    } as never;
    f.handleMouseDown(ctx(hit, { x: 10, y: 10 }, grid));
    expect(forwarded).toBe(true);
    expect(grid.selection.getRanges()).toEqual([]);
  });

  it('mousedown forwards to the next feature so CellSelection can still set focus', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
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
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    expect(downstreamSawMouseDown).toBe(true);
  });

  it('drag with non-cell hit (pointer drifts into header / empty zone) keeps the last committed range', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 4, colId: 'ticker' }, { x: 110, y: 90 }, grid));
    const before = grid.selection.getRanges();
    f.handleMouseDrag(ctx({ kind: 'empty' }, { x: 999, y: 999 }, grid));
    expect(grid.selection.getRanges()).toEqual(before);
  });
});

describe('RangeSelection — shift-click extend (Cycle 9 / Task 4)', () => {
  it('shift-click on a cell EXTENDS the last range to cover the clicked cell (downward + rightward)', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    // Anchor a 1x1 range at (1, cusip).
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 1, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 1, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    // Shift-click on (4, price): range expands to cover both corners.
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, { x: 220, y: 90 }, grid,
        new MouseEvent('mousedown', { shiftKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 1, rowEnd: 4, colIds: ['cusip', 'ticker', 'price'] },
    ]);
  });

  it('shift-click upward + leftward extends rowStart down and colIds left in render order', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    // Anchor at (5, ticker).
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, { x: 110, y: 90 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, { x: 110, y: 90 }, grid));
    // Shift-click on (2, cusip): rowStart shrinks to 2, colIds picks up cusip.
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 10, y: 50 }, grid,
        new MouseEvent('mousedown', { shiftKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 2, rowEnd: 5, colIds: ['cusip', 'ticker'] },
    ]);
  });

  it('shift-click with NO existing range anchors a new 1x1 range (matches plain click)', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 3, colId: 'cusip' }, { x: 10, y: 70 }, grid,
        new MouseEvent('mousedown', { shiftKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 3, rowEnd: 3, colIds: ['cusip'] },
    ]);
  });

  it('shift-click forwards to downstream feature so CellSelection still gets the modifier press', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 1, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 1, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    let downstreamSawShift = false;
    f.next = {
      handleMouseDown: (c) => { if ((c.raw as MouseEvent).shiftKey) downstreamSawShift = true; },
      handleMouseDrag: () => {},
      handleMouseUp: () => {},
      handleMouseMove: () => {},
      handleClick: () => {},
      handleDoubleClick: () => {},
      handleKeyDown: () => {},
      handleWheel: () => {},
      setCursor: () => {},
    } as never;
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, { x: 220, y: 90 }, grid,
        new MouseEvent('mousedown', { shiftKey: true })),
    );
    expect(downstreamSawShift).toBe(true);
  });
});

describe('RangeSelection — ctrl/cmd-click disjoint (Cycle 9 / Task 4)', () => {
  it('ctrl-click on a cell in rowSelection="multiple" REPLACES the prior range (single-focus invariant)', () => {
    // Cardinal-rule fix — blotter mode (multiple row selection) must
    // never visually accumulate disjoint cell ranges: each one paints
    // a tinted overlay the user reads as a focus ring, producing the
    // "multiple focused cells" perceptual bug. In multiple mode the
    // range REPLACES instead of accumulates; the row-toggle still
    // fires on the matching CellSelection feature path.
    const f = new RangeSelection();
    const grid = makeGrid();  // selection mode defaults to 'multiple'
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 5, colId: 'qty' }, { x: 320, y: 90 }, grid,
        new MouseEvent('mousedown', { ctrlKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 5, rowEnd: 5, colIds: ['qty'] },
    ]);
  });

  it('cmd-click (metaKey) in rowSelection="multiple" also REPLACES — mac parity with ctrl-click', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 5, colId: 'qty' }, { x: 320, y: 90 }, grid,
        new MouseEvent('mousedown', { metaKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 5, rowEnd: 5, colIds: ['qty'] },
    ]);
  });

  it('ctrl-click in rowSelection="single" preserves Excel-style disjoint accumulation', () => {
    // Single / none modes mean the app selected the spreadsheet
    // pattern — cell ranges are the primary selection vocabulary, and
    // Excel-style disjoint range accumulation is the convention. The
    // "multiple focused cells" pitfall doesn't apply because there's
    // no row-selection chrome competing for the same visual.
    const sel = new SelectionModel('single');
    const f = new RangeSelection();
    const grid = makeGrid({ selection: sel });
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 5, colId: 'qty' }, { x: 320, y: 90 }, grid,
        new MouseEvent('mousedown', { ctrlKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 0, colIds: ['cusip'] },
      { rowStart: 5, rowEnd: 5, colIds: ['qty'] },
    ]);
  });

  it('ctrl-click without an existing range anchors a 1x1 range (treated as the first disjoint entry)', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 2, colId: 'price' }, { x: 220, y: 60 }, grid,
        new MouseEvent('mousedown', { ctrlKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 2, rowEnd: 2, colIds: ['price'] },
    ]);
  });

  it('shift+ctrl-click prioritizes SHIFT (extend), matching ag-grid behavior', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 1, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 1, colId: 'cusip' }, { x: 10, y: 50 }, grid));
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 4, colId: 'price' }, { x: 220, y: 90 }, grid,
        new MouseEvent('mousedown', { shiftKey: true, ctrlKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 1, rowEnd: 4, colIds: ['cusip', 'ticker', 'price'] },
    ]);
  });
});

describe('HeaderClick — column-band selection (Cycle 9 / Task 4)', () => {
  const headerBand = { getCellSelectionOptions: () => ({ suppressHeader: false as const }) };

  it('plain header click does NOT select a column band by default (CSRM/SSRM)', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100 });
    f.handleClick(
      ctx({ kind: 'header', colId: 'ticker' }, { x: 100, y: 10 }, grid, new MouseEvent('click')),
    );
    expect(grid.selection.getRanges()).toEqual([]);
    expect(grid.cycleSort).toHaveBeenCalledWith('ticker', { append: false });
  });

  it('plain click on a column header selects the WHOLE column when suppressHeader is false', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100, ...headerBand });
    f.handleClick(
      ctx({ kind: 'header', colId: 'ticker' }, { x: 100, y: 10 }, grid, new MouseEvent('click')),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 99, colIds: ['ticker'] },
    ]);
  });

  it('shift-click on a header EXTENDS the column band to include every column between anchor and clicked (render order)', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100, ...headerBand });
    // Anchor on cusip (plain click) → single-column band.
    f.handleClick(
      ctx({ kind: 'header', colId: 'cusip' }, { x: 10, y: 10 }, grid, new MouseEvent('click')),
    );
    // Shift-click on qty → band expands to span cusip → qty.
    f.handleClick(
      ctx({ kind: 'header', colId: 'qty' }, { x: 320, y: 10 }, grid,
        new MouseEvent('click', { shiftKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 99, colIds: ['cusip', 'ticker', 'price', 'qty'] },
    ]);
  });

  it('shift-click on a header where the LAST range is NOT a full column band falls back to plain single-column select', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100, ...headerBand });
    // Seed a partial range (rows 0..2 only — not a full column band).
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    f.handleClick(
      ctx({ kind: 'header', colId: 'price' }, { x: 220, y: 10 }, grid,
        new MouseEvent('click', { shiftKey: true })),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 99, colIds: ['price'] },
    ]);
  });

  it('header click still cycles sort (column selection is additive; existing sort behavior is preserved)', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100 });
    f.handleClick(
      ctx({ kind: 'header', colId: 'ticker' }, { x: 100, y: 10 }, grid, new MouseEvent('click')),
    );
    expect(grid.cycleSort).toHaveBeenCalledWith('ticker', { append: false });
  });

  it('click on headerResizer hot-zone still cycles sort (sort affordance shares the right edge)', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100, ...headerBand });
    f.handleClick(
      ctx(
        { kind: 'headerResizer', colId: 'ticker', edge: 'right' },
        { x: 196, y: 10 },
        grid,
        new MouseEvent('click'),
      ),
    );
    expect(grid.cycleSort).toHaveBeenCalledWith('ticker', { append: false });
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 99, colIds: ['ticker'] },
    ]);
  });

  it('shift-click on header passes append=true to cycleSort (when multiSortKey === Shift) AND extends column band', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100, ...headerBand });
    f.handleClick(
      ctx({ kind: 'header', colId: 'cusip' }, { x: 10, y: 10 }, grid, new MouseEvent('click')),
    );
    f.handleClick(
      ctx({ kind: 'header', colId: 'qty' }, { x: 320, y: 10 }, grid,
        new MouseEvent('click', { shiftKey: true })),
    );
    expect(grid.cycleSort).toHaveBeenNthCalledWith(2, 'qty', { append: true });
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 99, colIds: ['cusip', 'ticker', 'price', 'qty'] },
    ]);
  });
});

describe('SelectionModel.selectColumnBand (Cycle 9 / Task 4)', () => {
  it('plain call replaces ranges with a single full-column band', () => {
    const sel = new SelectionModel('multiple');
    sel.selectColumnBand('ticker', ['cusip', 'ticker', 'price', 'qty'], 50, false);
    expect(sel.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 49, colIds: ['ticker'] },
    ]);
  });

  it('extend=true on an existing column band widens colIds (render order, contiguous slice)', () => {
    const sel = new SelectionModel('multiple');
    const cols = ['cusip', 'ticker', 'price', 'qty'];
    sel.selectColumnBand('cusip', cols, 50, false);
    sel.selectColumnBand('price', cols, 50, true);
    expect(sel.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 49, colIds: ['cusip', 'ticker', 'price'] },
    ]);
  });

  it('extend=true with no existing range falls back to a plain single-column band', () => {
    const sel = new SelectionModel('multiple');
    sel.selectColumnBand('price', ['cusip', 'ticker', 'price', 'qty'], 50, true);
    expect(sel.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 49, colIds: ['price'] },
    ]);
  });

  it('rowCount=0 is a no-op (no emit, no range added)', () => {
    const sel = new SelectionModel('multiple');
    let emits = 0;
    sel.onChange(() => { emits += 1; });
    sel.selectColumnBand('ticker', ['cusip', 'ticker'], 0, false);
    expect(sel.getRanges()).toEqual([]);
    expect(emits).toBe(0);
  });

  it('unknown colId is a no-op', () => {
    const sel = new SelectionModel('multiple');
    let emits = 0;
    sel.onChange(() => { emits += 1; });
    sel.selectColumnBand('nope', ['cusip', 'ticker'], 10, false);
    expect(sel.getRanges()).toEqual([]);
    expect(emits).toBe(0);
  });

  it('pulls focus into the new band when it was outside (focus ring must not sit beside the shade)', () => {
    const sel = new SelectionModel('multiple');
    const cols = ['cusip', 'ticker', 'price', 'qty'];
    sel.selectColumnBand('cusip', cols, 50, false);
    // Focus sits on qty — immediately right of the shaded band.
    sel.setFocus(3, 'qty');
    sel.selectColumnBand('price', cols, 50, true);
    expect(sel.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 49, colIds: ['cusip', 'ticker', 'price'] },
    ]);
    expect(sel.state.focusedRowIndex).toBe(3);
    expect(sel.state.focusedColId).toBe('price');
    expect(sel.isInsideAnyRange(sel.state.focusedRowIndex!, sel.state.focusedColId!)).toBe(true);
  });

  it('seeds focus into the band when focus was previously unset', () => {
    const sel = new SelectionModel('multiple');
    sel.selectColumnBand('ticker', ['cusip', 'ticker', 'price'], 20, false);
    expect(sel.state.focusedRowIndex).toBe(0);
    expect(sel.state.focusedColId).toBe('ticker');
  });
});

describe('computeAutoScrollDelta (Cycle 9 patch / Task 2) — edge-zone math', () => {
  const body = { left: 100, right: 500, top: 50, bottom: 400 };

  it('returns {0, 0} when the pointer is comfortably inside the body (away from any edge zone)', () => {
    const center = { x: 300, y: 225 };
    expect(computeAutoScrollDelta(center, body)).toEqual({ dx: 0, dy: 0 });
  });

  it('returns {0, 0} at the inside boundary of the edge zone (depth == 0 → no scroll yet)', () => {
    // bodyRight - EDGE_PX = 480, so x=480 sits exactly at the inside edge.
    expect(computeAutoScrollDelta({ x: body.right - EDGE_PX, y: 200 }, body)).toEqual({ dx: 0, dy: 0 });
    expect(computeAutoScrollDelta({ x: body.left + EDGE_PX, y: 200 }, body)).toEqual({ dx: 0, dy: 0 });
    expect(computeAutoScrollDelta({ x: 300, y: body.top + EDGE_PX }, body)).toEqual({ dx: 0, dy: 0 });
    expect(computeAutoScrollDelta({ x: 300, y: body.bottom - EDGE_PX }, body)).toEqual({ dx: 0, dy: 0 });
  });

  it('scrolls right with depth = (point.x - (bodyRight - edgePx)) when the pointer enters the right edge zone', () => {
    // x = bodyRight - 19 → depth = 1 → 1 px/frame.
    expect(computeAutoScrollDelta({ x: body.right - 19, y: 200 }, body)).toEqual({ dx: 1, dy: 0 });
    // x = bodyRight → depth = EDGE_PX = 20 → 20 px/frame.
    expect(computeAutoScrollDelta({ x: body.right, y: 200 }, body)).toEqual({ dx: 20, dy: 0 });
  });

  it('scrolls left (negative dx) when the pointer enters the left edge zone', () => {
    expect(computeAutoScrollDelta({ x: body.left + 19, y: 200 }, body)).toEqual({ dx: -1, dy: 0 });
    expect(computeAutoScrollDelta({ x: body.left, y: 200 }, body)).toEqual({ dx: -20, dy: 0 });
  });

  it('scrolls up (negative dy) when the pointer enters the top edge zone', () => {
    expect(computeAutoScrollDelta({ x: 300, y: body.top + 19 }, body)).toEqual({ dx: 0, dy: -1 });
    expect(computeAutoScrollDelta({ x: 300, y: body.top }, body)).toEqual({ dx: 0, dy: -20 });
  });

  it('scrolls down (positive dy) when the pointer enters the bottom edge zone', () => {
    expect(computeAutoScrollDelta({ x: 300, y: body.bottom - 19 }, body)).toEqual({ dx: 0, dy: 1 });
    expect(computeAutoScrollDelta({ x: 300, y: body.bottom }, body)).toEqual({ dx: 0, dy: 20 });
  });

  it('caps the per-frame speed at MAX_SCROLL_PX_PER_FRAME regardless of how far past the body the pointer is', () => {
    // 30 px past bodyRight → raw depth = 20 + 30 = 50 → capped at MAX_SCROLL_PX_PER_FRAME.
    const cap = MAX_SCROLL_PX_PER_FRAME;
    expect(computeAutoScrollDelta({ x: body.right + 30, y: 200 }, body)).toEqual({ dx: cap, dy: 0 });
    // Mirror for the left side.
    expect(computeAutoScrollDelta({ x: body.left - 30, y: 200 }, body)).toEqual({ dx: -cap, dy: 0 });
    // And vertical.
    expect(computeAutoScrollDelta({ x: 300, y: body.bottom + 50 }, body)).toEqual({ dx: 0, dy: cap });
    expect(computeAutoScrollDelta({ x: 300, y: body.top - 50 }, body)).toEqual({ dx: 0, dy: -cap });
  });

  it('produces a diagonal delta when the pointer is in two perpendicular edge zones (corner drag)', () => {
    // Bottom-right corner: x past bodyRight, y past bodyBottom.
    const result = computeAutoScrollDelta(
      { x: body.right + 5, y: body.bottom + 5 },
      body,
    );
    // depth = 20 + 5 = 25 on each axis (within the 30 cap).
    expect(result).toEqual({ dx: 25, dy: 25 });
  });

  it('honours the explicit edgePx / capPx overrides', () => {
    // Wider edge zone (40 px), lower cap (10).
    const r = computeAutoScrollDelta({ x: body.right + 5, y: 200 }, body, 40, 10);
    // depth = 40 + 5 = 45 → capped at 10.
    expect(r).toEqual({ dx: 10, dy: 0 });
  });
});
