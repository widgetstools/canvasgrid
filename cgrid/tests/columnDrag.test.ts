import { describe, it, expect, vi } from 'vitest';
import { ColumnDrag } from '../src/interaction/features/columnDrag';
import type { CGridEventCtx } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';

interface MockGrid {
  reorderColumn: ReturnType<typeof vi.fn>;
  getColDef: (id: string) => { suppressMovable: boolean; lockPosition: 'left' | 'right' | null };
  allColIds: () => string[];
  columnLeftOf: (id: string) => number | null;
  columnWidthOf: (id: string) => number | null;
  getOverlayHost: () => HTMLElement;
  getHeaderName: (id: string) => string;
  getLeafHeaderHeight: () => number;
  getLeafHeaderTop: () => number;
}

function ctx(hit: Hit, point: { x: number; y: number }, grid: MockGrid): CGridEventCtx {
  return {
    hit,
    point,
    grid: grid as unknown as CGridEventCtx['grid'],
    raw: new MouseEvent('mousedown'),
  };
}

function makeGrid(overrides: Partial<MockGrid> = {}): MockGrid {
  const colWidths: Record<string, number> = { a: 100, b: 100, c: 100 };
  const colLefts: Record<string, number> = { a: 0, b: 100, c: 200 };
  const host = document.createElement('div');
  document.body.appendChild(host);
  return {
    reorderColumn: vi.fn(),
    getColDef: (id) => ({ suppressMovable: false, lockPosition: null }),
    allColIds: () => ['a', 'b', 'c'],
    columnLeftOf: (id) => colLefts[id] ?? null,
    columnWidthOf: (id) => colWidths[id] ?? null,
    getOverlayHost: () => host,
    getHeaderName: (id) => id.toUpperCase(),
    getLeafHeaderHeight: () => 30,
    getLeafHeaderTop: () => 30,
    ...overrides,
  };
}

describe('ColumnDrag', () => {
  it('refuses to drag a suppressMovable column', () => {
    const f = new ColumnDrag();
    const grid = makeGrid({
      getColDef: (id) => ({ suppressMovable: id === 'a', lockPosition: null }),
    });
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 250, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 250, y: 8 }, grid));
    expect(grid.reorderColumn).not.toHaveBeenCalled();
  });

  it('does not start a drag on a headerResizer hit', () => {
    const f = new ColumnDrag();
    const grid = makeGrid();
    const hit: Hit = { kind: 'headerResizer', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 95, y: 8 }, grid));
    f.handleMouseDrag(ctx({ kind: 'header', colId: 'b' }, { x: 250, y: 8 }, grid));
    f.handleMouseUp(ctx({ kind: 'header', colId: 'b' }, { x: 250, y: 8 }, grid));
    expect(grid.reorderColumn).not.toHaveBeenCalled();
  });

  it('does not commit when movement stays below the 4 px threshold', () => {
    const f = new ColumnDrag();
    const grid = makeGrid();
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 12, y: 9 }, grid));
    f.handleMouseUp(ctx(hit, { x: 12, y: 9 }, grid));
    expect(grid.reorderColumn).not.toHaveBeenCalled();
  });

  it('commits a normal drag past column c through reorderColumn', () => {
    const f = new ColumnDrag();
    const grid = makeGrid();
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 220, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 220, y: 8 }, grid));
    // 220 px landed past 'c' (left=200, width=100, center=250). 220 > 'b' center
    // (150) so candidate is 2 ('a' moves past 'b').
    expect(grid.reorderColumn).toHaveBeenCalledWith('a', 2, 'uiColumnDragged');
  });

  it('commits leftward drag to index 0', () => {
    const f = new ColumnDrag();
    const grid = makeGrid();
    const hit: Hit = { kind: 'header', colId: 'c' };
    f.handleMouseDown(ctx(hit, { x: 250, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 10, y: 8 }, grid));
    expect(grid.reorderColumn).toHaveBeenCalledWith('c', 0, 'uiColumnDragged');
  });

  it('mouseup without a drag (pressed but no movement) does NOT call reorderColumn', () => {
    const f = new ColumnDrag();
    const grid = makeGrid();
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 10, y: 8 }, grid));
    expect(grid.reorderColumn).not.toHaveBeenCalled();
  });

  it('mounts a ghost header + insertion line on drag, then removes them on drop', () => {
    const f = new ColumnDrag();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = makeGrid({ getOverlayHost: () => host, getLeafHeaderTop: () => 30 });
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    expect(host.querySelector('.cg-column-drag-ghost')).toBeNull();
    f.handleMouseDrag(ctx(hit, { x: 220, y: 8 }, grid));
    const ghost = host.querySelector('.cg-column-drag-ghost') as HTMLElement | null;
    expect(ghost).not.toBeNull();
    // Ghost mounts at the leaf-header Y (30 in the mock), NOT at top:0.
    // With column groups present, top:0 would float the ghost above the
    // group header instead of replacing the leaf header.
    expect(ghost!.style.top).toBe('30px');
    expect(host.querySelector('.cg-column-drag-insertion-line')).not.toBeNull();
    f.handleMouseUp(ctx(hit, { x: 220, y: 8 }, grid));
    expect(host.querySelector('.cg-column-drag-ghost')).toBeNull();
    expect(host.querySelector('.cg-column-drag-insertion-line')).toBeNull();
  });

  it('swallows the click event that follows a drag so HeaderClick does not sort the dragged column', () => {
    const f = new ColumnDrag();
    const grid = makeGrid();
    const downstream = vi.fn();
    // Wire a fake downstream feature to detect whether handleClick
    // reached past ColumnDrag.
    f.next = { handleClick: downstream } as never;
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 220, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 220, y: 8 }, grid));
    f.handleClick(ctx(hit, { x: 220, y: 8 }, grid));
    expect(downstream).not.toHaveBeenCalled();
    // The NEXT click (after a fresh gesture or no gesture) is not suppressed.
    f.handleClick(ctx(hit, { x: 220, y: 8 }, grid));
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('does not swallow the click after a press without movement (no drag)', () => {
    const f = new ColumnDrag();
    const grid = makeGrid();
    const downstream = vi.fn();
    // Stub both mouseup + click; the no-drag flow forwards mouseup.
    f.next = { handleClick: downstream, handleMouseUp: vi.fn() } as never;
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleClick(ctx(hit, { x: 10, y: 8 }, grid));
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('does not start a drag on a cell hit', () => {
    const f = new ColumnDrag();
    const grid = makeGrid();
    const hit: Hit = { kind: 'cell', rowIndex: 0, colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 100 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 250, y: 100 }, grid));
    f.handleMouseUp(ctx(hit, { x: 250, y: 100 }, grid));
    expect(grid.reorderColumn).not.toHaveBeenCalled();
  });
});
