import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import type { CColDef, CColGroupDef } from '../src/types';

// Stubs Worker + 2D canvas so a VelocityGrid can construct under happy-dom,
// mirroring the pattern used across the kernel test suite.
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

// NOTE: `VelocityGrid` has no public `.api` property — the api surface is built
// fresh by the private `makeApi()` and handed out via the `gridReady`
// event / tool-panel construction (see `runtimeOptions.test.ts` for the
// established `(grid as any).makeApi()` test pattern). We follow that
// same pattern here rather than the `grid.api` shorthand.
function mount(columnDefs: (CColDef | CColGroupDef)[]) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = new VelocityGrid(el, { columnDefs, rowData: [], getRowId: (r: any) => r.id });
  return { grid, api: (grid as any).makeApi() };
}

describe('api.getColumnGroupDefs', () => {
  it('returns the current authored column-def tree, groups included', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { colId: 'a', field: 'a' },
      { groupId: 'g1', headerName: 'Prices', children: [
        { colId: 'bid', field: 'bid' },
        { colId: 'ask', field: 'ask' },
      ] },
    ];
    const { api } = mount(defs);
    const out = api.getColumnGroupDefs();
    expect(out).toHaveLength(2);
    const group = out.find((d): d is CColGroupDef => 'children' in d)!;
    expect(group.groupId).toBe('g1');
    expect(group.children.map((c) => (c as CColDef).colId)).toEqual(['bid', 'ask']);
  });

  it('reflects a tree swapped in via updateGridOptions', () => {
    const { api } = mount([{ colId: 'a', field: 'a' }]);
    api.updateGridOptions({
      columnDefs: [{ groupId: 'g2', headerName: 'X', children: [{ colId: 'a', field: 'a' }] }],
    });
    const out = api.getColumnGroupDefs();
    expect((out[0] as CColGroupDef).groupId).toBe('g2');
  });
});
