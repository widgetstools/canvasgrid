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
  /** Cycle 15 / Task 6 — drag dispatches into the row group panel
   *  host via these. The default mock returns `false` from
   *  `isPointInRowGroupPanel` so existing tests behave identically;
   *  Task 6's dedicated drop-target tests override the trio. */
  isPointInRowGroupPanel: (x: number, y: number) => boolean;
  setRowGroupPanelDragHover: ReturnType<typeof vi.fn>;
  commitRowGroupPanelDrop: ReturnType<typeof vi.fn>;
  /** Cycle 18 / Task 6 — pivot panel drop target. Default mock
   *  returns `false` from `isPointInPivotPanel` so existing tests
   *  behave identically; Task 6's dedicated tests override the trio. */
  isPointInPivotPanel: (x: number, y: number) => boolean;
  setPivotPanelDragHover: ReturnType<typeof vi.fn>;
  commitPivotPanelDrop: ReturnType<typeof vi.fn>;
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
    isPointInRowGroupPanel: () => false,
    setRowGroupPanelDragHover: vi.fn(),
    commitRowGroupPanelDrop: vi.fn(),
    isPointInPivotPanel: () => false,
    setPivotPanelDragHover: vi.fn(),
    commitPivotPanelDrop: vi.fn(),
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
    const hit: Hit = { kind: 'headerResizer', colId: 'a', edge: 'right' };
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

  it('mounts a pill ghost + insertion line on drag, then removes them on drop', () => {
    const f = new ColumnDrag();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = makeGrid({ getOverlayHost: () => host });
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    // Pill ghost mounts on document.body (no cg-theme ancestor in test DOM).
    expect(document.body.querySelector('.cg-col-drag-ghost')).toBeNull();
    f.handleMouseDrag(ctx(hit, { x: 220, y: 8 }, grid));
    expect(document.body.querySelector('.cg-col-drag-ghost')).not.toBeNull();
    // Insertion line still mounts in the overlay host.
    expect(host.querySelector('.cg-column-drag-insertion-line')).not.toBeNull();
    f.handleMouseUp(ctx(hit, { x: 220, y: 8 }, grid));
    expect(document.body.querySelector('.cg-col-drag-ghost')).toBeNull();
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

  // Cycle 15 / Task 6 — drag-into-row-group-panel dispatch tests.
  it('drag dispatches hover into the row group panel each tick while pointer is over it', () => {
    // Regression: while a drag is in flight AND the pointer is INSIDE
    // the panel, `setRowGroupPanelDragHover` fires with the dragging
    // colId and viewport coords on every drag tick. The host uses this
    // to paint the dashed outline + insertion line.
    const f = new ColumnDrag();
    let panelHits = 0;
    const grid = makeGrid({
      isPointInRowGroupPanel: () => { panelHits += 1; return true; },
    });
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    // Past 4 px threshold — promotes to dragging + fires first hover.
    f.handleMouseDrag(ctx(hit, { x: 80, y: 8 }, grid));
    // Subsequent drag ticks fire more hovers.
    f.handleMouseDrag(ctx(hit, { x: 100, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 140, y: 8 }, grid));
    expect(grid.setRowGroupPanelDragHover).toHaveBeenCalledTimes(3);
    // Each call carried the dragging colId.
    const lastCall = grid.setRowGroupPanelDragHover.mock.calls.at(-1) as unknown[];
    expect(lastCall[0]).toBe('a');
    expect(panelHits).toBeGreaterThanOrEqual(3);
  });

  it('drop INSIDE the row group panel commits via commitRowGroupPanelDrop and skips column reorder', () => {
    // Regression: when the mouseup lands inside the panel AND the
    // panel accepts the drop (`commitRowGroupPanelDrop` returns
    // `true`), the column-reorder pathway must be skipped — the
    // column stays where it was in the header band. `reorderColumn`
    // is NOT called.
    const f = new ColumnDrag();
    const grid = makeGrid({
      isPointInRowGroupPanel: () => true,
      commitRowGroupPanelDrop: vi.fn(() => true),
    });
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 250, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 250, y: 8 }, grid));
    expect(grid.commitRowGroupPanelDrop).toHaveBeenCalledWith('a');
    expect(grid.reorderColumn).not.toHaveBeenCalled();
  });

  it('drop INSIDE the panel but REJECTED falls back to column reorder', () => {
    // Regression: when `commitRowGroupPanelDrop` returns `false`
    // (panel rejected because the column lacks `enableRowGroup`),
    // the column-reorder pathway runs as usual so the column doesn't
    // disappear into a refused drop.
    const f = new ColumnDrag();
    const grid = makeGrid({
      isPointInRowGroupPanel: () => true,
      commitRowGroupPanelDrop: vi.fn(() => false),
    });
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 250, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 250, y: 8 }, grid));
    expect(grid.commitRowGroupPanelDrop).toHaveBeenCalledWith('a');
    expect(grid.reorderColumn).toHaveBeenCalled();
  });

  it('drop OUTSIDE the panel never asks the host to commit', () => {
    // Regression: when the pointer is NOT in the panel at mouseup,
    // the drag must not call `commitRowGroupPanelDrop` at all. The
    // column-reorder pathway runs (the default behaviour).
    const f = new ColumnDrag();
    const grid = makeGrid({ isPointInRowGroupPanel: () => false });
    const hit: Hit = { kind: 'header', colId: 'a' };
    f.handleMouseDown(ctx(hit, { x: 10, y: 8 }, grid));
    f.handleMouseDrag(ctx(hit, { x: 250, y: 8 }, grid));
    f.handleMouseUp(ctx(hit, { x: 250, y: 8 }, grid));
    expect(grid.commitRowGroupPanelDrop).not.toHaveBeenCalled();
    expect(grid.reorderColumn).toHaveBeenCalled();
  });
});
