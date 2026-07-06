/**
 * Task 1 (Columns tool panel hierarchy) — integration gate: `CGridApi`'s
 * `moveColumnToGroup` / `moveColumnGroup` route through the pure
 * `columnGroupMutation` core AND preserve runtime column state (width /
 * hide) across the `columnDefs` rebuild the re-parent triggers. Mounts a
 * real `CGrid` against the fake Worker + canvas harness (mirrors
 * `tests/rulesApiKernel.integration.test.ts`'s `beforeAll` stub + `mount()`
 * shape).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';

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
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<{ a: string; b: string; c: string }>(container, {
    columnDefs: [
      { field: 'a' },
      { groupId: 'G', headerName: 'G', children: [{ field: 'b' }, { field: 'c' }] },
    ],
    getRowId: (r) => r.a,
    theme: 'cg-theme-quartz',
  });
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  return grid;
}

describe('CGridApi.moveColumnToGroup — state preservation + events', () => {
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

describe('CGridApi.moveColumnGroup', () => {
  it('moves a whole group to top level', async () => {
    const grid = await mount();
    grid.moveColumnGroup('G', null, 'a');
    const defs = grid.getColumnGroupDefs();
    expect(defs.findIndex((d: any) => d.groupId === 'G')).toBe(0);
    grid.destroy();
  });
});
