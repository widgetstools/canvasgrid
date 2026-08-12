/**
 * Grid Layouts / column-group-drag feature — Task 1.
 *
 * Proves the end-to-end wiring on a REAL VelocityGrid: a press-and-drag on a
 * column-GROUP header (a `headerGroup` hit from the production
 * `HitTester`) reorders/re-nests the whole group via `moveColumnGroup` —
 * the SAME primitive the Columns tool panel's hierarchy drag already
 * uses (Cycle: columns tool panel hierarchy, Task 1).
 *
 * Drives the feature chain with REAL DOM `MouseEvent`s dispatched on the
 * grid's canvas (mirrors `featureChain.test.ts`'s harness), so hit-testing
 * (`HitTester.locate` → `{ kind: 'headerGroup', groupId, colId }`) and the
 * `ColumnDrag` feature's group-drag branch both run as production code
 * would run them — not a hand-rolled mock. Coordinates are derived from
 * the grid's own live layout (`columnLeftOf` / `columnWidthOf` /
 * `getLeafHeaderTop`, reached via the internal `featureChain.grid`
 * `VelocityGridLike` surface — the exact object `FeatureChain` dispatches into)
 * rather than hard-coded pixel assumptions, so the test stays correct if
 * default column widths ever change.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import type { CColDef, CColGroupDef } from '../src/types';
import type { VelocityGridLike } from '../src/interaction/feature';

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

async function mount(
  columnDefs: (CColDef<{ id: string }> | CColGroupDef<{ id: string }>)[],
): Promise<VelocityGrid<{ id: string }>> {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<{ id: string }>(container, {
    columnDefs,
    getRowId: (r) => r.id,
    theme: 'vg-theme-quartz',
  });
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  // FeatureChain's `toLocal` computes canvas-local coords from
  // `canvas.getBoundingClientRect()` — stub it to the origin so
  // `clientX/clientY` map 1:1 onto canvas-local `x/y`, matching
  // `featureChain.test.ts`'s harness.
  const canvas: HTMLCanvasElement = (grid as any).cgridCanvas.canvas;
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    configurable: true,
  });
  return grid;
}

/** The `VelocityGridLike` surface `FeatureChain` was constructed with — reached
 *  via the same "test-only escape hatch" pattern other integration tests
 *  use for private fields (e.g. `(grid as any).workerClient.worker`).
 *  Gives the test real `columnLeftOf` / `columnWidthOf` / `getLeafHeaderTop`
 *  so drag coordinates are derived from the grid's actual live layout. */
function gridLike(grid: VelocityGrid<any>): VelocityGridLike {
  return (grid as any).featureChain.grid as VelocityGridLike;
}

function centerOf(grid: VelocityGrid<any>, colId: string): number {
  const gl = gridLike(grid);
  const left = gl.columnLeftOf(colId);
  const width = gl.columnWidthOf(colId);
  if (left === null || width === null) throw new Error(`${colId} not visible`);
  return left + width / 2;
}

/** Drive a full press → drag (past the 4px threshold) → release gesture
 *  on the canvas via real `MouseEvent`s, mirroring how the browser (and
 *  `featureChain.test.ts`) dispatches them: `mousedown` on the canvas,
 *  `mousemove`/`mouseup` on `window` (matching FeatureChain's own
 *  window-level drag-tracking listeners). */
function dragHeader(grid: VelocityGrid<any>, startX: number, y: number, endX: number): void {
  const canvas: HTMLCanvasElement = (grid as any).cgridCanvas.canvas;
  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: y, bubbles: true, button: 0 }));
  // First move past the 4px drag threshold so ColumnDrag promotes
  // pressed → dragging (see `DRAG_THRESHOLD_PX` in `columnDrag.ts`).
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 10, clientY: y, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: endX, clientY: y, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: endX, clientY: y, bubbles: true }));
}

/** Top-level `columnDefs` entry ids in declaration order — groups by
 *  `groupId`, leaves by `colId`/`field` — mirroring the brief's
 *  `d.groupId ?? (d.colId ?? d.field)` mapping. */
function topLevelIds(grid: VelocityGrid<any>): string[] {
  return grid.getColumnGroupDefs().map((d: any) => d.groupId ?? (d.colId ?? d.field));
}

describe('Column-GROUP header drag (Grid Layouts / Task 1)', () => {
  it('dragging group A past group B reorders A after B', async () => {
    const grid = await mount([
      { groupId: 'A', headerName: 'Group A', children: [{ field: 'a0', width: 100 }, { field: 'a1', width: 100 }] },
      { groupId: 'B', headerName: 'Group B', children: [{ field: 'b0', width: 100 }, { field: 'b1', width: 100 }] },
      { field: 'c', width: 100 },
    ]);
    const gl = gridLike(grid);
    const groupHeaderY = gl.getLeafHeaderTop() / 2;
    const startX = centerOf(grid, 'a0'); // inside group A's header band
    // Land just past B's last leaf (b1), before the top-level 'c' column —
    // i.e. immediately after group B.
    const endX = (centerOf(grid, 'b1') + centerOf(grid, 'c')) / 2;

    expect(topLevelIds(grid)).toEqual(['A', 'B', 'c']);
    dragHeader(grid, startX, groupHeaderY, endX);

    const order = topLevelIds(grid);
    expect(order.indexOf('A')).toBeGreaterThan(order.indexOf('B'));
    expect(order).toEqual(['B', 'A', 'c']);
    grid.destroy();
  });

  it('a marryChildren group re-nest is a no-op', async () => {
    const grid = await mount([
      { groupId: 'A', headerName: 'Group A', children: [{ field: 'a0', width: 100 }, { field: 'a1', width: 100 }] },
      {
        groupId: 'B', headerName: 'Group B', marryChildren: true,
        children: [{ field: 'b0', width: 100 }, { field: 'b1', width: 100 }],
      },
      { field: 'c', width: 100 },
    ]);
    const gl = gridLike(grid);
    const groupHeaderY = gl.getLeafHeaderTop() / 2;
    const before = grid.getColumnGroupDefs();
    const events: string[] = [];
    grid.on('columnDefsChanged', () => events.push('columnDefsChanged'));

    const startX = centerOf(grid, 'a0'); // inside group A's header band
    // Land inside B's own span (between its two children) — a re-nest
    // attempt `moveColumnGroupPure` rejects because the target group has
    // `marryChildren: true`.
    const endX = (centerOf(grid, 'b0') + centerOf(grid, 'b1')) / 2;

    dragHeader(grid, startX, groupHeaderY, endX);

    expect(events).toEqual([]); // no-op — moveColumnGroup fired nothing
    expect(grid.getColumnGroupDefs()).toEqual(before);
    expect(topLevelIds(grid)).toEqual(['A', 'B', 'c']);
    grid.destroy();
  });

  // Grid Layouts / column-group-drag feature, Task 2 — re-nest regression
  // coverage. T1's `computeGroupDropTarget` already resolves BOTH reorder
  // AND re-nest gaps (into an existing group, or out to the top level);
  // these prove that resolution actually lands end-to-end through a real
  // drag gesture, not just in the pure resolver's own unit tests.
  it('dragging group A into group B nests it (getColumnGroupDefs shows A under B)', async () => {
    const grid = await mount([
      { groupId: 'A', headerName: 'Group A', children: [{ field: 'a0', width: 100 }, { field: 'a1', width: 100 }] },
      { groupId: 'B', headerName: 'Group B', children: [{ field: 'b0', width: 100 }, { field: 'b1', width: 100 }] },
      { field: 'c', width: 100 },
    ]);
    const gl = gridLike(grid);
    const groupHeaderY = gl.getLeafHeaderTop() / 2;
    const startX = centerOf(grid, 'a0'); // inside group A's header band
    // Land in the gap between B's two children — the deepest common
    // ancestor of that gap's flanking leaves is B itself, so A should
    // land nested inside B, between b0 and b1.
    const endX = (centerOf(grid, 'b0') + centerOf(grid, 'b1')) / 2;

    dragHeader(grid, startX, groupHeaderY, endX);

    expect(topLevelIds(grid)).toEqual(['B', 'c']); // A no longer at the top level
    const B = grid.getColumnGroupDefs().find((d: any) => d.groupId === 'B') as any;
    expect(B).toBeTruthy();
    expect(B.children.some((ch: any) => ch.groupId === 'A')).toBe(true);
    grid.destroy();
  });

  it('dragging a nested group out to a top-level gap lifts it', async () => {
    const grid = await mount([
      {
        groupId: 'B', headerName: 'Group B',
        children: [
          { groupId: 'C', headerName: 'Group C', children: [{ field: 'c0', width: 100 }, { field: 'c1', width: 100 }] },
          { field: 'b0', width: 100 },
        ],
      },
      { field: 'd', width: 100 },
    ]);
    const gl = gridLike(grid);
    const groupHeaderY = gl.getLeafHeaderTop() / 2;
    const startX = centerOf(grid, 'c0'); // inside group C's header band (nested under B)
    // Land past 'd' — the top-level gap after the last column, so the
    // deepest common ancestor is the top level (no enclosing group).
    const endX = centerOf(grid, 'd') + 200;

    // Sanity: C starts nested under B.
    const before = grid.getColumnGroupDefs().find((d: any) => d.groupId === 'B') as any;
    expect(before.children.some((ch: any) => ch.groupId === 'C')).toBe(true);

    dragHeader(grid, startX, groupHeaderY, endX);

    expect(topLevelIds(grid)).toEqual(['B', 'd', 'C']); // C lifted to the top level, after 'd'
    const afterB = grid.getColumnGroupDefs().find((d: any) => d.groupId === 'B') as any;
    expect(afterB.children.some((ch: any) => ch.groupId === 'C')).toBe(false);
    grid.destroy();
  });
});
