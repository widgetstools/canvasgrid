import { describe, it, expect, vi } from 'vitest';
import { RangeSelection } from '../src/interaction/features/rangeSelection';
import { HeaderClick } from '../src/interaction/features/headerClick';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { CGridEventCtx } from '../src/interaction/feature';
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
}

function ctx(
  hit: Hit,
  point: { x: number; y: number },
  grid: MockGrid,
  raw: MouseEvent = new MouseEvent('mousedown'),
): CGridEventCtx {
  return {
    hit,
    point,
    grid: grid as unknown as CGridEventCtx['grid'],
    raw,
  };
}

function makeGrid(overrides: Partial<MockGrid> = {}): MockGrid {
  return {
    selection: new SelectionModel('multiple'),
    allColIds: () => ['cusip', 'ticker', 'price', 'qty'],
    getCellSelectionOptions: () => undefined,
    emitRangeSelectionChanged: () => {},
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
  it('ctrl-click on a cell ADDS a new disjoint 1x1 range (preserves existing ranges)', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
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

  it('cmd-click (metaKey) ALSO adds a disjoint range — mac parity with ctrl-click', () => {
    const f = new RangeSelection();
    const grid = makeGrid();
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 10, y: 30 }, grid));
    f.handleMouseDown(
      ctx({ kind: 'cell', rowIndex: 5, colId: 'qty' }, { x: 320, y: 90 }, grid,
        new MouseEvent('mousedown', { metaKey: true })),
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
  it('plain click on a column header selects the WHOLE column (rowStart=0, rowEnd=rowCount-1, colIds=[colId])', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100 });
    f.handleClick(
      ctx({ kind: 'header', colId: 'ticker' }, { x: 100, y: 10 }, grid, new MouseEvent('click')),
    );
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 99, colIds: ['ticker'] },
    ]);
  });

  it('shift-click on a header EXTENDS the column band to include every column between anchor and clicked (render order)', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100 });
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
    const grid = makeFullGrid({ rowCount: 100 });
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

  it('shift-click on header passes append=true to cycleSort (when multiSortKey === Shift) AND extends column band', () => {
    const f = new HeaderClick();
    const grid = makeFullGrid({ rowCount: 100 });
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
});
