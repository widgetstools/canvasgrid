import { describe, it, expect } from 'vitest';
import { RangeSelection } from '../src/interaction/features/rangeSelection';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { CGridEventCtx } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';

interface MockGrid {
  selection: SelectionModel;
  allColIds: () => string[];
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
    ...overrides,
  };
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
