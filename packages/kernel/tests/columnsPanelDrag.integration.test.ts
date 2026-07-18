/**
 * Cycle: columns tool panel hierarchy — Task 3.
 *
 * T2 rendered the columns tool panel's column list hierarchically (group
 * rows + indented leaves) but left the row-drag orchestrator flat: any
 * drag ended in a plain `api.moveColumns` reorder, with no way to
 * re-parent a leaf into/out of a group or to move a whole group. T3 makes
 * the drag group-aware: `resolveDrop()` hit-tests the pointer against the
 * rendered row list to a `{ kind, movingId, targetGroupId, beforeId }`
 * target, and `commitDrop()` routes it through the T1 group-membership
 * mutation API (`moveColumnToGroup` / `moveColumnGroup`).
 *
 * Mounted on a REAL CGrid (mirrors `columnsPanelHierarchy.integration.test.ts`)
 * so `getColumnGroupDefs()` / the T1 API are the exact production surface,
 * not a hand-rolled mock.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import type { CColDef, CColGroupDef } from '../src/types';
import type { ColumnVisibilityPanel } from '../src/interaction/toolPanels/columns/visibilityPanel';

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

/** Mount a real CGrid with the Columns tool panel opened — verbatim
 *  harness from T2's `columnsPanelHierarchy.integration.test.ts`. */
async function mountWithPanel(
  columnDefs: (CColDef | CColGroupDef)[],
): Promise<CGrid<{ id: string }>> {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);

  const grid = new CGrid<{ id: string }>(container, {
    columnDefs,
    getRowId: (r) => r.id,
    theme: 'cg-theme-quartz',
    sideBar: { toolPanels: ['columns'] },
  });

  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));

  const bar = container.querySelector('.cg-side-bar') as HTMLElement;
  const colsTab = bar.querySelector('.cg-side-bar-tab[data-id="agColumnsToolPanel"]') as HTMLButtonElement;
  colsTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  const destroy = grid.destroy.bind(grid);
  grid.destroy = () => {
    destroy();
    container.remove();
  };

  return grid;
}

/** Columns panel root for this grid (avoids stale panels left on `document.body`). */
function panelRoot(grid: CGrid<{ id: string }>): HTMLElement {
  return (grid as any).root.querySelector('.cg-columns-panel') as HTMLElement;
}

/** Reach into the mounted sidebar for the live `ColumnVisibilityPanel`
 *  instance — private fields on `CGrid`/`ColumnsToolPanel`, accessed via
 *  `as any` exactly like `(grid as any).workerClient.worker` above; this
 *  is a test-only escape hatch, not a public surface. */
function getPanelInstance(grid: CGrid<{ id: string }>): ColumnVisibilityPanel {
  const shell = (grid as any).sideBar.getInstance('agColumnsToolPanel');
  return shell.visibilityPanel as ColumnVisibilityPanel;
}

/** Stub `getBoundingClientRect` on every rendered `.cg-columns-panel-row`
 *  (in DOM/render order) to stacked 30px-tall rows starting at `top0`, so
 *  `resolveDrop`'s Y-hit-testing has real geometry to work against.
 *  Returns a lookup of each row's `{top, bottom}` by its `data-col-id` /
 *  `grp:<data-group-id>` key, handy for computing test click points. */
function pinRowRects(
  root: HTMLElement,
  rowHeight = 30,
  top0 = 0,
): Map<string, { top: number; bottom: number }> {
  const rectFor = (top: number, bottom: number): DOMRect => ({
    left: 0, right: 300, top, bottom, width: 300, height: bottom - top,
    x: 0, y: top, toJSON() { return {}; },
  }) as DOMRect;

  const listEl = root.querySelector('.cg-columns-panel-list') as HTMLElement;
  listEl.getBoundingClientRect = () => rectFor(top0, top0 + 1000);

  const rows = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-row'));
  const positions = new Map<string, { top: number; bottom: number }>();
  rows.forEach((row, i) => {
    const top = top0 + i * rowHeight;
    const bottom = top + rowHeight;
    row.getBoundingClientRect = () => rectFor(top, bottom);
    const key = row.dataset.colId ?? (row.dataset.groupId ? `grp:${row.dataset.groupId}` : undefined);
    if (key) positions.set(key, { top, bottom });
  });
  return positions;
}

describe('Columns tool panel — group-aware drag (T3)', () => {
  it('dropping a top-level column onto a group re-parents it via moveColumnToGroup', async () => {
    const grid = await mountWithPanel([
      { field: 'a' },
      { groupId: 'G', headerName: 'Grp', children: [{ field: 'b' }] },
    ]);
    const spy = vi.spyOn(grid, 'moveColumnToGroup');
    const panel = getPanelInstance(grid);
    panel.commitDrop({ kind: 'col', movingId: 'a', targetGroupId: 'G', beforeId: undefined });
    expect(spy).toHaveBeenCalledWith('a', 'G', undefined);
    grid.destroy();
  });

  it('dropping a grouped column into the top-level gap moves it out', async () => {
    const grid = await mountWithPanel([
      { groupId: 'G', headerName: 'Grp', children: [{ field: 'a' }, { field: 'b' }] },
    ]);
    const spy = vi.spyOn(grid, 'moveColumnToGroup');
    const panel = getPanelInstance(grid);
    panel.commitDrop({ kind: 'col', movingId: 'a', targetGroupId: null, beforeId: undefined });
    expect(spy).toHaveBeenCalledWith('a', null, undefined);
    grid.destroy();
  });

  it('dragging a group row moves the whole group via moveColumnGroup', async () => {
    const grid = await mountWithPanel([
      { field: 'a' },
      { groupId: 'G1', headerName: 'G1', children: [{ field: 'b' }] },
      { groupId: 'G2', headerName: 'G2', children: [{ field: 'c' }] },
    ]);
    const spy = vi.spyOn(grid, 'moveColumnGroup');
    const panel = getPanelInstance(grid);
    panel.commitDrop({ kind: 'group', movingId: 'G1', targetGroupId: 'G2', beforeId: 'c' });
    expect(spy).toHaveBeenCalledWith('G1', 'G2', 'c');
    grid.destroy();
  });

  it('commitDrop for an invalid re-parent (unknown target) is absorbed as a no-op by the API', async () => {
    const grid = await mountWithPanel([{ field: 'a' }, { field: 'b' }]);
    const spy = vi.spyOn(grid, 'moveColumnToGroup');
    const panel = getPanelInstance(grid);
    expect(() => panel.commitDrop({ kind: 'col', movingId: 'a', targetGroupId: 'NOPE', beforeId: undefined }))
      .not.toThrow();
    expect(spy).toHaveBeenCalledWith('a', 'NOPE', undefined);
    // No columnDefsChanged rebuild fired — the tree is unchanged.
    expect(grid.getColumnState().map((s) => s.colId)).toEqual(['a', 'b']);
    grid.destroy();
  });

  describe('resolveDrop — pointer-to-target hit testing', () => {
    it('renders a drag handle on group rows (T3 adds this — T2 shipped none)', async () => {
      const grid = await mountWithPanel([
        { groupId: 'G', headerName: 'Grp', children: [{ field: 'a' }] },
      ]);
      const groupRow = document.querySelector('[data-group-id="G"]')!;
      expect(groupRow.querySelector('.cg-columns-panel-row-handle')).toBeTruthy();
      grid.destroy();
    });

    it('hovering the upper half of a top-level leaf resolves to "insert before it" at top level', async () => {
      const grid = await mountWithPanel([{ field: 'a' }, { field: 'b' }, { field: 'c' }]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const panel = getPanelInstance(grid);
      const bTop = pos.get('b')!.top;
      const resolved = panel.__forTests().resolveDrop(bTop + 2, 'c', 'col');
      expect(resolved).toEqual({ kind: 'col', movingId: 'c', targetGroupId: null, beforeId: 'b' });
      grid.destroy();
    });

    it('hovering the lower half of a top-level leaf resolves to "insert after it" (before its next sibling)', async () => {
      const grid = await mountWithPanel([{ field: 'a' }, { field: 'b' }, { field: 'c' }]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const panel = getPanelInstance(grid);
      const bRect = pos.get('b')!;
      const lowerHalfY = bRect.top + (bRect.bottom - bRect.top) * 0.75;
      const resolved = panel.__forTests().resolveDrop(lowerHalfY, 'a', 'col');
      expect(resolved).toEqual({ kind: 'col', movingId: 'a', targetGroupId: null, beforeId: 'c' });
      grid.destroy();
    });

    it('hovering a group row middle third nests into that group', async () => {
      const grid = await mountWithPanel([
        { field: 'a' },
        { groupId: 'G', headerName: 'Grp', children: [{ field: 'b' }, { field: 'c' }] },
      ]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const panel = getPanelInstance(grid);
      const groupRect = pos.get('grp:G')!;
      const midY = groupRect.top + (groupRect.bottom - groupRect.top) * 0.5;
      expect(panel.__forTests().resolveDrop(midY, 'a', 'col'))
        .toEqual({ kind: 'col', movingId: 'a', targetGroupId: 'G', beforeId: 'b' });
      grid.destroy();
    });

    it('hovering a group row upper third places the column before the group as a sibling', async () => {
      const grid = await mountWithPanel([
        { field: 'a' },
        { groupId: 'G', headerName: 'Grp', children: [{ field: 'b' }, { field: 'c' }] },
      ]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const panel = getPanelInstance(grid);
      const groupRect = pos.get('grp:G')!;
      const upperY = groupRect.top + 2;
      expect(panel.__forTests().resolveDrop(upperY, 'a', 'col'))
        .toEqual({ kind: 'col', movingId: 'a', targetGroupId: null, beforeId: 'G' });
      grid.destroy();
    });

    it('hovering a group row lower third places the column after the group as a sibling', async () => {
      const grid = await mountWithPanel([
        { field: 'a' },
        { groupId: 'G', headerName: 'Grp', children: [{ field: 'b' }, { field: 'c' }] },
        { field: 'd' },
      ]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const panel = getPanelInstance(grid);
      const groupRect = pos.get('grp:G')!;
      const lowerY = groupRect.bottom - 2;
      expect(panel.__forTests().resolveDrop(lowerY, 'a', 'col'))
        .toEqual({ kind: 'col', movingId: 'a', targetGroupId: null, beforeId: 'd' });
      grid.destroy();
    });

    it('dragging a nested leaf onto the parent group upper third ungroups it before that group', async () => {
      const grid = await mountWithPanel([
        { groupId: 'G', headerName: 'Grp', children: [{ field: 'b' }, { field: 'c' }] },
        { field: 'a' },
      ]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const panel = getPanelInstance(grid);
      const groupRect = pos.get('grp:G')!;
      const upperY = groupRect.top + 2;
      expect(panel.__forTests().resolveDrop(upperY, 'b', 'col'))
        .toEqual({ kind: 'col', movingId: 'b', targetGroupId: null, beforeId: 'G' });
      grid.destroy();
    });

    it('hovering below every row resolves to a top-level append (targetGroupId: null, no beforeId)', async () => {
      const grid = await mountWithPanel([
        { groupId: 'G', headerName: 'Grp', children: [{ field: 'a' }] },
      ]);
      const root = panelRoot(grid);
      pinRowRects(root);
      const panel = getPanelInstance(grid);
      const resolved = panel.__forTests().resolveDrop(100000, 'a', 'col');
      expect(resolved).toEqual({ kind: 'col', movingId: 'a', targetGroupId: null, beforeId: undefined });
      grid.destroy();
    });

    it('a group drag excludes its own descendants as hit-test targets', async () => {
      const grid = await mountWithPanel([
        { groupId: 'G1', headerName: 'G1', children: [{ field: 'a' }, { field: 'b' }] },
        { groupId: 'G2', headerName: 'G2', children: [{ field: 'c' }] },
      ]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const panel = getPanelInstance(grid);
      // Hover over G1's own child 'a' while dragging G1 — 'a' (and G1)
      // are excluded, so the hit selects G2 from above its box → sibling
      // before G2 (upper-third semantics), never a within-G1 target.
      const aRect = pos.get('a')!;
      const fromChildY = panel.__forTests().resolveDrop(aRect.top + 2, 'G1', 'group');
      expect(fromChildY).toEqual({
        kind: 'group', movingId: 'G1', targetGroupId: null, beforeId: 'G2',
      });
      // Nesting into G2 still works via that group's middle third.
      const g2Rect = pos.get('grp:G2')!;
      const midY = g2Rect.top + (g2Rect.bottom - g2Rect.top) * 0.5;
      expect(panel.__forTests().resolveDrop(midY, 'G1', 'group').targetGroupId).toBe('G2');
      grid.destroy();
    });
  });

  describe('end-to-end mouse drag (mousedown -> mousemove -> mouseup)', () => {
    it('dragging a leaf handle onto a group row commits via moveColumnToGroup', async () => {
      const grid = await mountWithPanel([
        { field: 'a' },
        { groupId: 'G', headerName: 'Grp', children: [{ field: 'b' }] },
      ]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const spy = vi.spyOn(grid, 'moveColumnToGroup');

      const handle = root.querySelector<HTMLElement>('[data-col-id="a"] .cg-columns-panel-row-handle')!;
      const groupRect = pos.get('grp:G')!;
      // Middle third of the group row = nest into the group.
      const nestY = groupRect.top + (groupRect.bottom - groupRect.top) * 0.5;
      handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: pos.get('a')!.top + 2, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: nestY }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: nestY }));

      expect(spy).toHaveBeenCalledWith('a', 'G', 'b');
      grid.destroy();
    });

    it('dragging a group handle onto another group commits via moveColumnGroup', async () => {
      const grid = await mountWithPanel([
        { groupId: 'G1', headerName: 'G1', children: [{ field: 'a' }] },
        { groupId: 'G2', headerName: 'G2', children: [{ field: 'b' }] },
      ]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);
      const spy = vi.spyOn(grid, 'moveColumnGroup');

      const handle = root.querySelector<HTMLElement>('[data-group-id="G1"] .cg-columns-panel-row-handle')!;
      const g2Rect = pos.get('grp:G2')!;
      const nestY = g2Rect.top + (g2Rect.bottom - g2Rect.top) * 0.5;
      handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: pos.get('grp:G1')!.top + 2, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: nestY }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: nestY }));

      expect(spy).toHaveBeenCalledWith('G1', 'G2', 'b');
      grid.destroy();
    });

    it('paints the reject-tinted highlight (not accept) when hovering a marryChildren group with an incompatible leaf', async () => {
      const grid = await mountWithPanel([
        { field: 'a' },
        { groupId: 'G', headerName: 'Grp', marryChildren: true, children: [{ field: 'b' }] },
      ]);
      const root = panelRoot(grid);
      const pos = pinRowRects(root);

      const handle = root.querySelector<HTMLElement>('[data-col-id="a"] .cg-columns-panel-row-handle')!;
      const groupRect = pos.get('grp:G')!;
      const nestY = groupRect.top + (groupRect.bottom - groupRect.top) * 0.5;
      handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: pos.get('a')!.top + 2, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: nestY }));

      const groupRow = root.querySelector('[data-group-id="G"]')!;
      expect(groupRow.classList.contains('cg-columns-panel-row--drop-reject')).toBe(true);
      expect(groupRow.classList.contains('cg-columns-panel-row--drop-target')).toBe(false);

      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: nestY }));
      // marryChildren rejected the re-parent — 'a' stays at top level.
      expect(grid.getColumnState().map((s) => s.colId)).toEqual(['a', 'b']);
      grid.destroy();
    });
  });
});
