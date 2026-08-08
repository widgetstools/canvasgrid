import { describe, it, expect, vi } from 'vitest';
import { ColumnDrag } from '../src/interaction/features/columnDrag';
import type { VelocityGridEventCtx } from '../src/interaction/feature';
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
  // Grid Layouts / column-group-drag feature (Task 1 accessors, Task 2
  // reject-affordance consumer).
  getGroupLeafColIds: (groupId: string) => string[];
  getGroupHeaderName: (groupId: string) => string | undefined;
  getColGroupPath: (colId: string) => string[];
  getGroupDescendantIds: (groupId: string) => string[];
  moveColumnGroup: ReturnType<typeof vi.fn>;
  /** Task 2 — true when `groupId` has `marryChildren: true`. Drives the
   *  group-drag reject affordance (no-drop cursor + hidden insertion
   *  line) when the resolved drop target is a married group. */
  isColumnGroupMarried: (groupId: string) => boolean;
}

function ctx(hit: Hit, point: { x: number; y: number }, grid: MockGrid): VelocityGridEventCtx {
  return {
    hit,
    point,
    grid: grid as unknown as VelocityGridEventCtx['grid'],
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
    getGroupLeafColIds: () => [],
    getGroupHeaderName: (id) => id,
    getColGroupPath: () => [],
    getGroupDescendantIds: (id) => [id],
    moveColumnGroup: vi.fn(),
    isColumnGroupMarried: () => false,
    ...overrides,
  };
}

/** Cycle: Grid Layouts / column-group-drag (Task 2) — a 5-leaf layout with
 *  two groups (`G` = a0/a1, `M` = b0/b1, `marryChildren`) and a top-level
 *  leaf `c`, for the reject-affordance tests. Mirrors the shape of the
 *  real-DOM `columnGroupHeaderDrag.integration.test.ts` fixture but as a
 *  lightweight mock so the reject/no-drop behaviour can be unit-tested
 *  without mounting a full `VelocityGrid`. */
function makeGroupGrid(overrides: Partial<MockGrid> = {}): MockGrid {
  const lefts: Record<string, number> = { a0: 0, a1: 100, b0: 200, b1: 300, c: 400 };
  return makeGrid({
    allColIds: () => ['a0', 'a1', 'b0', 'b1', 'c'],
    columnLeftOf: (id) => lefts[id] ?? null,
    columnWidthOf: (id) => (lefts[id] !== undefined ? 100 : null),
    getGroupLeafColIds: (groupId) => (groupId === 'G' ? ['a0', 'a1'] : groupId === 'M' ? ['b0', 'b1'] : []),
    getGroupHeaderName: (groupId) => groupId,
    getColGroupPath: (colId) => (colId === 'a0' || colId === 'a1' ? ['G'] : colId === 'b0' || colId === 'b1' ? ['M'] : []),
    getGroupDescendantIds: (groupId) => [groupId],
    isColumnGroupMarried: (groupId) => groupId === 'M',
    ...overrides,
  });
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
    // Pill ghost mounts on document.body (no vg-theme ancestor in test DOM).
    expect(document.body.querySelector('.vg-col-drag-ghost')).toBeNull();
    f.handleMouseDrag(ctx(hit, { x: 220, y: 8 }, grid));
    expect(document.body.querySelector('.vg-col-drag-ghost')).not.toBeNull();
    // Insertion line still mounts in the overlay host.
    expect(host.querySelector('.vg-column-drag-insertion-line')).not.toBeNull();
    f.handleMouseUp(ctx(hit, { x: 220, y: 8 }, grid));
    expect(document.body.querySelector('.vg-col-drag-ghost')).toBeNull();
    expect(host.querySelector('.vg-column-drag-insertion-line')).toBeNull();
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

  // Grid Layouts / column-group-drag feature, Task 2 — drop affordance
  // during a group drag: the insertion line at a LEGAL gap, and the
  // no-drop cursor + hidden line at an ILLEGAL/rejected gap.
  describe('group-drag drop affordance (Task 2)', () => {
    it('a legal gap shows the grabbing cursor and a visible insertion line', () => {
      const f = new ColumnDrag();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const grid = makeGroupGrid({ getOverlayHost: () => host });
      const hit: Hit = { kind: 'headerGroup', groupId: 'G', colId: 'a0' };
      f.handleMouseDown(ctx(hit, { x: 50, y: 8 }, grid));
      // Drag toward the top-level gap after 'c' — a legal re-nest-out target.
      f.handleMouseDrag(ctx(hit, { x: 480, y: 8 }, grid));
      expect(f.cursor).toBe('grabbing');
      const line = host.querySelector<HTMLElement>('.vg-column-drag-insertion-line');
      expect(line).not.toBeNull();
      expect(line!.style.display).not.toBe('none');
    });

    it('a married-group target shows the no-drop cursor and hides the insertion line', () => {
      const f = new ColumnDrag();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const grid = makeGroupGrid({ getOverlayHost: () => host });
      const hit: Hit = { kind: 'headerGroup', groupId: 'G', colId: 'a0' };
      f.handleMouseDown(ctx(hit, { x: 50, y: 8 }, grid));
      // Land inside M's own span (between b0 and b1, left=200..400) — the
      // resolved target's parent is the married group 'M'.
      f.handleMouseDrag(ctx(hit, { x: 300, y: 8 }, grid));
      expect(f.cursor).toBe('no-drop');
      const line = host.querySelector<HTMLElement>('.vg-column-drag-insertion-line');
      expect(line).not.toBeNull();
      expect(line!.style.display).toBe('none');
    });

    it('an illegal gap (inside the moving group itself) shows the no-drop cursor and hides the line', () => {
      const f = new ColumnDrag();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const grid = makeGroupGrid({ getOverlayHost: () => host });
      const hit: Hit = { kind: 'headerGroup', groupId: 'G', colId: 'a0' };
      f.handleMouseDown(ctx(hit, { x: 50, y: 8 }, grid));
      // Land between a0 and a1 (left=0..200) — strictly inside G's own
      // span, with nothing shallower to fall back to (top-level group).
      f.handleMouseDrag(ctx(hit, { x: 100, y: 8 }, grid));
      expect(f.cursor).toBe('no-drop');
      const line = host.querySelector<HTMLElement>('.vg-column-drag-insertion-line');
      expect(line).not.toBeNull();
      expect(line!.style.display).toBe('none');
    });

    // Regression: FIX 3 (review) — `moveColumnGroupPure` rejects a reparent
    // when EITHER the target OR the SOURCE parent is married. The dry-run
    // used to check only the target's marriage, so re-nesting a group OUT
    // of a married parent (to an unmarried/top-level target) showed a
    // legal (grabbing) affordance that the commit would then silently
    // reject. Fixture: married group `M` contains sub-group `N` (leaf
    // `n0`); dragging `N` to the top-level gap past `c` is a reparent out
    // of the married `M` and must now be rejected too.
    it('rejects re-nesting a group OUT of a married source parent, even when the target is unmarried', () => {
      const f = new ColumnDrag();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const lefts: Record<string, number> = { a0: 0, a1: 100, n0: 200, b1: 300, c: 400 };
      const grid = makeGrid({
        getOverlayHost: () => host,
        allColIds: () => ['a0', 'a1', 'n0', 'b1', 'c'],
        columnLeftOf: (id) => lefts[id] ?? null,
        columnWidthOf: (id) => (lefts[id] !== undefined ? 100 : null),
        getGroupLeafColIds: (groupId) =>
          groupId === 'G' ? ['a0', 'a1'] : groupId === 'M' ? ['n0', 'b1'] : groupId === 'N' ? ['n0'] : [],
        getGroupHeaderName: (groupId) => groupId,
        getColGroupPath: (colId) =>
          colId === 'a0' || colId === 'a1' ? ['G'] : colId === 'n0' ? ['M', 'N'] : colId === 'b1' ? ['M'] : [],
        getGroupDescendantIds: (groupId) => [groupId],
        isColumnGroupMarried: (groupId) => groupId === 'M',
      });
      const hit: Hit = { kind: 'headerGroup', groupId: 'N', colId: 'n0' };
      f.handleMouseDown(ctx(hit, { x: 250, y: 8 }, grid));
      // Drag past the last leaf (c) — a legal-looking top-level append; the
      // resolved target's parent is `null` (unmarried), but the moving
      // group's CURRENT parent `M` is married, so the reparent-out must
      // still be rejected.
      f.handleMouseDrag(ctx(hit, { x: 480, y: 8 }, grid));
      expect(f.cursor).toBe('no-drop');
      const line = host.querySelector<HTMLElement>('.vg-column-drag-insertion-line');
      expect(line).not.toBeNull();
      expect(line!.style.display).toBe('none');
    });
  });
});
