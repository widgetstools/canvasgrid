/**
 * Task 1 (Columns tool panel hierarchy) — integration gate: `VelocityGridApi`'s
 * `moveColumnToGroup` / `moveColumnGroup` route through the pure
 * `columnGroupMutation` core AND preserve runtime column state (width /
 * hide) across the `columnDefs` rebuild the re-parent triggers. Mounts a
 * real `VelocityGrid` against the fake Worker + canvas harness (mirrors
 * `tests/rulesApiKernel.integration.test.ts`'s `beforeAll` stub + `mount()`
 * shape).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { resolveColumnTree } from '../src/core/columnTree';

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

async function mount() {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<{ a: string; b: string; c: string }>(container, {
    columnDefs: [
      { field: 'a' },
      { groupId: 'G', headerName: 'G', children: [{ field: 'b' }, { field: 'c' }] },
    ],
    getRowId: (r) => r.a,
    theme: 'vg-theme-quartz',
  });
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  return grid;
}

describe('VelocityGridApi.moveColumnToGroup — state preservation + events', () => {
  it('re-parents a leaf INTO a group and preserves its runtime width + hidden state', async () => {
    const grid = await mount();
    grid.setColumnWidths([{ key: 'a', newWidth: 222 }]);
    grid.setColumnsVisible(['a'], false);
    grid.moveColumnToGroup('a', 'G');

    const defs = grid.getColumnGroupDefs();
    const G = defs.find((d: any) => d.groupId === 'G') as any;
    expect(G.children.map((c: any) => c.colId ?? c.field)).toContain('a');

    const st = grid.getColumnState().find((s) => s.colId === 'a')!;
    expect(st.hide).toBe(true);
    expect(st.width).toBe(222);
    grid.destroy();
  });

  it('fires columnDefsChanged; an invalid move fires nothing', async () => {
    const grid = await mount();
    const evs: string[] = [];
    grid.addEventListener('columnDefsChanged', () => evs.push('c'));
    grid.moveColumnToGroup('a', 'NOPE'); // invalid → no-op
    expect(evs).toEqual([]);
    grid.moveColumnToGroup('a', 'G'); // valid
    expect(evs.length).toBeGreaterThan(0);
    grid.destroy();
  });
});

describe('VelocityGridApi.moveColumnGroup', () => {
  it('moves a whole group to top level', async () => {
    const grid = await mount();
    grid.moveColumnGroup('G', null, 'a');
    const defs = grid.getColumnGroupDefs();
    expect(defs.findIndex((d: any) => d.groupId === 'G')).toBe(0);
    grid.destroy();
  });
});

/**
 * Fix 2 (review, closeout for grid-header-group-drag) — `colGroupPathCache`
 * must be invalidated on EVERY `this.columnTree = …` reassignment, not just
 * the two the cache's doc comment used to cite (constructor +
 * `rebuildColumns`). The pivot engine's `setColumnTree` callback (wired via
 * `makePivotEngineDeps`, ~velocityGrid.ts:3496) is a THIRD site that was missing
 * the invalidation — reproduced here by driving that exact callback
 * directly (bypassing the full async worker/pivot activation round-trip,
 * which this callback doesn't depend on) and asserting `getColGroupPath`
 * resolves fresh ancestor paths for a colId that only exists in the NEW
 * tree, rather than returning a stale `[]` from a cache built against the
 * OLD tree's `leafById`.
 */
describe('colGroupPathCache invalidation on pivot column-tree swap', () => {
  it('rebuilds ancestor paths after `setColumnTree` swaps in a new tree (regression: stale cache after pivot enter/exit)', async () => {
    const grid = await mount();
    // Warm the lazily-built cache against the ORIGINAL tree.
    expect((grid as any).getColGroupPath('b')).toEqual(['G']);

    // Drive the pivot engine's `setColumnTree` dep directly — the exact
    // callback FIX 2 patches — with a brand-new tree whose leaf 'd' didn't
    // exist in the original tree at all, nested under a new group 'Z'.
    const newTree = resolveColumnTree([
      { field: 'a' },
      { groupId: 'Z', headerName: 'Z', children: [{ field: 'd' }] },
    ] as any);
    const deps = (grid as any).makePivotEngineDeps();
    deps.setColumnTree(newTree);

    // Pre-fix: the stale cache (keyed by the OLD tree's colIds) has no
    // entry for 'd' → `?? []` fallback silently returns the WRONG empty
    // path. Post-fix: the cache was cleared, so this rebuilds against the
    // NEW tree and correctly resolves 'd' → ['Z'].
    expect((grid as any).getColGroupPath('d')).toEqual(['Z']);
    grid.destroy();
  });
});
