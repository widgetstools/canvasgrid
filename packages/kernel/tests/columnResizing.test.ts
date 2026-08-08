import { describe, it, expect, vi } from 'vitest';
import { ColumnResizing } from '../src/interaction/features/columnResizing';
import type { VelocityGridEventCtx } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';

interface MockGrid {
  resizeColumn: ReturnType<typeof vi.fn>;
  finishColumnResize: ReturnType<typeof vi.fn>;
}

function ctx(hit: Hit, point: { x: number; y: number }, grid: MockGrid): VelocityGridEventCtx {
  return {
    hit,
    point,
    grid: grid as unknown as VelocityGridEventCtx['grid'],
    raw: new MouseEvent('mousedown'),
  };
}

function makeGrid(): MockGrid {
  return {
    resizeColumn: vi.fn(),
    finishColumnResize: vi.fn(),
  };
}

describe('ColumnResizing', () => {
  it('right-edge drag forwards positive dx unchanged', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    const hit: Hit = { kind: 'headerResizer', colId: 'a', edge: 'right' };
    f.handleMouseDown(ctx(hit, { x: 100, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 120, y: 8 }, grid));
    expect(grid.resizeColumn).toHaveBeenCalledWith('a', 20);
  });

  it('left-edge drag inverts dx (drag-right = narrower column)', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    // Right-pinned column: dragging the left edge to the RIGHT (x increases by 20)
    // should narrow the column, i.e. resizeColumn called with -20.
    const hit: Hit = { kind: 'headerResizer', colId: 'pnl', edge: 'left' };
    f.handleMouseDown(ctx(hit, { x: 200, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 220, y: 8 }, grid));
    expect(grid.resizeColumn).toHaveBeenCalledWith('pnl', -20);
  });

  it('left-edge drag leftward grows the column', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    // Drag left edge LEFT (x decreases) → column grows.
    const hit: Hit = { kind: 'headerResizer', colId: 'pnl', edge: 'left' };
    f.handleMouseDown(ctx(hit, { x: 200, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 175, y: 8 }, grid));
    expect(grid.resizeColumn).toHaveBeenCalledWith('pnl', 25);
  });

  it('mouseup fires finishColumnResize for both edges', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    const hit: Hit = { kind: 'headerResizer', colId: 'pnl', edge: 'left' };
    f.handleMouseDown(ctx(hit, { x: 200, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 220, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 220, y: 8 }, grid));
    expect(grid.finishColumnResize).toHaveBeenCalledWith('pnl');
  });
});
