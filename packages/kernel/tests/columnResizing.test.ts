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

  it('swallows the trailing click only after a real resize', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    const downstream = vi.fn();
    f.next = { handleClick: downstream } as never;
    const hit: Hit = { kind: 'headerResizer', colId: 'a', edge: 'right' };
    f.handleMouseDown(ctx(hit, { x: 100, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 120, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 120, y: 8 }, grid));
    f.handleClick(ctx(hit, { x: 120, y: 8 }, grid));
    expect(downstream).not.toHaveBeenCalled();
  });

  // Regression: HIGH (critical-review remediation) — a lost mouseup
  // (pointercancel / window blur / tab hidden) used to leave
  // `columnResizeDragActive` stuck `true` forever (only `handleMouseUp`
  // reset it), stranding the grid on the slow paint path. `cancelResize`
  // is the shared safety-net entry point `FeatureChain` calls from those
  // fallback listeners; it must call `finishColumnResize` exactly like a
  // normal mouseup would.
  it('cancelResize mid-drag calls finishColumnResize like a normal mouseup', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    const hit: Hit = { kind: 'headerResizer', colId: 'a', edge: 'right' };
    f.handleMouseDown(ctx(hit, { x: 100, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 120, y: 8 }, grid));
    f.cancelResize(grid as unknown as Parameters<ColumnResizing['cancelResize']>[0]);
    expect(grid.finishColumnResize).toHaveBeenCalledWith('a');
  });

  it('cancelResize when not resizing is a no-op', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    f.cancelResize(grid as unknown as Parameters<ColumnResizing['cancelResize']>[0]);
    expect(grid.finishColumnResize).not.toHaveBeenCalled();
  });

  it('resetDragState clears in-flight resize state without touching the grid', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    const hit: Hit = { kind: 'headerResizer', colId: 'a', edge: 'right' };
    f.handleMouseDown(ctx(hit, { x: 100, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 120, y: 8 }, grid));
    f.resetDragState();
    expect(grid.finishColumnResize).not.toHaveBeenCalled();
    // A subsequent mouseup with no active resize forwards to super instead
    // of re-finishing the already-abandoned gesture.
    const downstream = vi.fn();
    f.next = { handleMouseUp: downstream } as never;
    f.handleMouseUp(ctx(hit, { x: 120, y: 8 }, grid));
    expect(downstream).toHaveBeenCalledTimes(1);
    expect(grid.finishColumnResize).not.toHaveBeenCalled();
  });

  it('forwards the click after a resizer press with no width change', () => {
    const f = new ColumnResizing();
    const grid = makeGrid();
    const downstream = vi.fn();
    f.next = { handleClick: downstream, handleMouseUp: vi.fn() } as never;
    const hit: Hit = { kind: 'headerResizer', colId: 'a', edge: 'right' };
    f.handleMouseDown(ctx(hit, { x: 100, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 100, y: 8 }, grid));
    f.handleClick(ctx(hit, { x: 100, y: 8 }, grid));
    expect(grid.resizeColumn).not.toHaveBeenCalled();
    expect(downstream).toHaveBeenCalledTimes(1);
  });
});
