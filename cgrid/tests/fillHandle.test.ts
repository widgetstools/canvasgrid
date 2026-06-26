import { describe, it, expect, vi } from 'vitest';
import { FillHandle } from '../src/interaction/features/fillHandle';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { CGridEventCtx } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';
import type { SelectionRange } from '../src/types';

interface MockGrid {
  selection: SelectionModel;
  allColIds: () => string[];
  getEnableFillHandle: () => boolean;
  getFillHandleDirection: () => 'x' | 'y' | 'xy';
  getRangeBottomRight: (range: SelectionRange) => { x: number; y: number } | null;
  commitFill: ReturnType<typeof vi.fn>;
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
  const cols = ['cusip', 'ticker', 'price', 'qty'];
  return {
    selection: new SelectionModel('multiple'),
    allColIds: () => cols,
    getEnableFillHandle: () => true,
    getFillHandleDirection: () => 'y',
    // Default bottom-right resolver: each column is 100px wide starting at
    // x=0; each row is 30px tall starting at y=32 (header band). Range
    // bottom-right = right edge of last colId × bottom of rowEnd.
    getRangeBottomRight: (range) => {
      const lastColId = range.colIds[range.colIds.length - 1]!;
      const colIdx = cols.indexOf(lastColId);
      if (colIdx < 0) return null;
      return { x: (colIdx + 1) * 100, y: 32 + (range.rowEnd + 1) * 30 };
    },
    commitFill: vi.fn(),
    ...overrides,
  };
}

/** Forward-link a Feature to a downstream mock so the test can assert
 *  whether the head feature forwarded the event (vs. claimed it). */
function attachDownstream(f: FillHandle, sawIt: { value: boolean }): void {
  f.next = {
    handleMouseDown: () => { sawIt.value = true; },
    handleMouseDrag: () => {},
    handleMouseUp: () => {},
    handleMouseMove: () => {},
    handleClick: () => {},
    handleDoubleClick: () => {},
    handleKeyDown: () => {},
    handleWheel: () => {},
    setCursor: () => {},
  } as never;
}

describe('FillHandle — hit-test (Cycle 9 / Task 5)', () => {
  it('claims mousedown when pointer is inside the 6×6 handle at the bottom-right of the last range', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip', 'ticker'] }]);
    // Bottom-right: x = 200 (ticker col right edge), y = 32 + 3*30 = 122.
    // Handle hit zone: [197..203, 119..125].
    const downstreamSaw = { value: false };
    attachDownstream(f, downstreamSaw);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, { x: 200, y: 122 }, grid));
    expect(downstreamSaw.value).toBe(false); // claimed — not forwarded
  });

  it('forwards mousedown when pointer is outside the 6×6 handle hit zone', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip', 'ticker'] }]);
    // Bottom-right at (200, 122). Click well inside the range body.
    const downstreamSaw = { value: false };
    attachDownstream(f, downstreamSaw);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 50, y: 50 }, grid));
    expect(downstreamSaw.value).toBe(true);
  });

  it('forwards mousedown when no ranges exist', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    const downstreamSaw = { value: false };
    attachDownstream(f, downstreamSaw);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 0, colId: 'cusip' }, { x: 100, y: 32 }, grid));
    expect(downstreamSaw.value).toBe(true);
  });

  it('enableFillHandle=false → mousedown at the would-be handle position is forwarded (no claim)', () => {
    const f = new FillHandle();
    const grid = makeGrid({ getEnableFillHandle: () => false });
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip', 'ticker'] }]);
    const downstreamSaw = { value: false };
    attachDownstream(f, downstreamSaw);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, { x: 200, y: 122 }, grid));
    expect(downstreamSaw.value).toBe(true);
  });

  it('forwards mousedown on non-cell hits even at the handle position', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip', 'ticker'] }]);
    const downstreamSaw = { value: false };
    attachDownstream(f, downstreamSaw);
    f.handleMouseDown(ctx({ kind: 'empty' }, { x: 200, y: 122 }, grid));
    expect(downstreamSaw.value).toBe(true);
  });
});

describe('FillHandle — drag-extend (Cycle 9 / Task 5)', () => {
  it('vertical drag extends the LAST range downward by the number of rows traversed', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    const sourceRange: SelectionRange = { rowStart: 0, rowEnd: 2, colIds: ['cusip', 'ticker'] };
    grid.selection.setRanges([sourceRange]);
    // Claim handle.
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, { x: 200, y: 122 }, grid));
    // Drag down to a cell at (rowIndex=5, ticker) — 3 rows below source.
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, { x: 200, y: 212 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 5, colIds: ['cusip', 'ticker'] },
    ]);
  });

  it('horizontal drag with direction=x extends the LAST range rightward', () => {
    const f = new FillHandle();
    const grid = makeGrid({ getFillHandleDirection: () => 'x' });
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    // Bottom-right of single cusip range = (100, 32 + 3*30 = 122). Claim it.
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 100, y: 122 }, grid));
    // Drag right to price column (col index 2).
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 2, colId: 'price' }, { x: 300, y: 122 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 2, colIds: ['cusip', 'ticker', 'price'] },
    ]);
  });

  it('direction=y ignores horizontal drag movement (only rowEnd grows)', () => {
    const f = new FillHandle();
    const grid = makeGrid({ getFillHandleDirection: () => 'y' });
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 100, y: 122 }, grid));
    // Drag right + down — should only extend down with direction=y.
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 5, colId: 'price' }, { x: 300, y: 212 }, grid));
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 5, colIds: ['cusip'] },
    ]);
  });

  it('drag tick to a non-cell hit (pointer off the grid) keeps the previous extended range', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip', 'ticker'] }]);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, { x: 200, y: 122 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 4, colId: 'ticker' }, { x: 200, y: 182 }, grid));
    const intermediate = grid.selection.getRanges();
    f.handleMouseDrag(ctx({ kind: 'empty' }, { x: 999, y: 999 }, grid));
    expect(grid.selection.getRanges()).toEqual(intermediate);
  });

  it('drag tick without a preceding mousedown is forwarded (no state mutation)', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    let downstreamSawDrag = false;
    f.next = {
      handleMouseDown: () => {},
      handleMouseDrag: () => { downstreamSawDrag = true; },
      handleMouseUp: () => {},
      handleMouseMove: () => {},
      handleClick: () => {},
      handleDoubleClick: () => {},
      handleKeyDown: () => {},
      handleWheel: () => {},
      setCursor: () => {},
    } as never;
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 5, colId: 'cusip' }, { x: 100, y: 200 }, grid));
    expect(downstreamSawDrag).toBe(true);
    expect(grid.selection.getRanges()).toEqual([
      { rowStart: 0, rowEnd: 2, colIds: ['cusip'] },
    ]);
  });
});

describe('FillHandle — commit-on-release (Cycle 9 / Task 5)', () => {
  it('mouseup calls grid.commitFill(source, target) with the original + extended ranges', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    const source: SelectionRange = { rowStart: 0, rowEnd: 2, colIds: ['cusip', 'ticker'] };
    grid.selection.setRanges([{ ...source, colIds: [...source.colIds] }]);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'ticker' }, { x: 200, y: 122 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, { x: 200, y: 212 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 5, colId: 'ticker' }, { x: 200, y: 212 }, grid));
    expect(grid.commitFill).toHaveBeenCalledTimes(1);
    const [committedSource, committedTarget] = grid.commitFill.mock.calls[0]!;
    expect(committedSource).toEqual(source);
    expect(committedTarget).toEqual({ rowStart: 0, rowEnd: 5, colIds: ['cusip', 'ticker'] });
  });

  it('mouseup with no drag (source == target) does NOT call commitFill', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 100, y: 122 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 100, y: 122 }, grid));
    expect(grid.commitFill).not.toHaveBeenCalled();
  });

  it('after commit, a fresh mousedown without the handle goes through normally (state cleared)', () => {
    const f = new FillHandle();
    const grid = makeGrid();
    grid.selection.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['cusip'] }]);
    f.handleMouseDown(ctx({ kind: 'cell', rowIndex: 2, colId: 'cusip' }, { x: 100, y: 122 }, grid));
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 4, colId: 'cusip' }, { x: 100, y: 182 }, grid));
    f.handleMouseUp(ctx({ kind: 'cell', rowIndex: 4, colId: 'cusip' }, { x: 100, y: 182 }, grid));
    // Range is now 0..4. A fresh drag tick without a mousedown must NOT
    // mutate (state is idle).
    const before = grid.selection.getRanges();
    f.handleMouseDrag(ctx({ kind: 'cell', rowIndex: 6, colId: 'cusip' }, { x: 100, y: 242 }, grid));
    expect(grid.selection.getRanges()).toEqual(before);
  });
});
