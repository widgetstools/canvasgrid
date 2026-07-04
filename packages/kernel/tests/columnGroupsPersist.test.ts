import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import type { CColDef, CColGroupDef } from '../src/types';

/**
 * Cycle 21i / Task 6 — column-group structure persistence round-trip.
 *
 * Mirrors the Worker/canvas stub setup in `runtimeOptions.test.ts` so a
 * `CGrid` can construct under happy-dom without a real worker thread.
 */
beforeAll(() => {
  if (!(globalThis as any).__cgridFakeWorkerInstalled) {
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      postedMessages: any[] = [];
      constructor(public url: URL) {}
      postMessage(msg: any): void { this.postedMessages.push(msg); }
      addEventListener = (_: string, cb: (e: { data: any }) => void) => {
        this.listeners.push(cb);
      };
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
    (globalThis as any).__cgridFakeWorkerInstalled = true;
  }
});

function mount(columnDefs: (CColDef | CColGroupDef)[]) {
  const el = document.createElement('div');
  el.style.cssText = 'width:800px; height:600px;';
  document.body.appendChild(el);
  return new CGrid(el, { columnDefs, rowData: [], getRowId: (r: any) => r.id });
}

describe('column-group structure persists through getState/setState', () => {
  const base: (CColDef | CColGroupDef)[] = [
    { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
  ];

  it('restores an edited group tree onto a fresh grid with the same base defs', () => {
    const g1 = mount(base);
    const api1 = (g1 as any).makeApi();
    // simulate a panel Apply: wrap b+c into group G with a header style
    api1.updateGridOptions({ columnDefs: [
      { colId: 'a', field: 'a' },
      { groupId: 'G', headerName: 'Grp', headerStyle: { bg: '#123456' }, children: [
        { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
    ] });
    const snapshot = g1.getState();
    expect(snapshot.columnGroupDefs?.some((n: any) => n.kind === 'group')).toBe(true);
    g1.destroy();

    const g2 = mount(base);            // fresh grid, SAME base defs (functions intact)
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    const defs = api2.getColumnGroupDefs();
    const grp = defs.find((d: any) => d.groupId === 'G');
    expect(grp).toBeDefined();
    expect(grp.children.map((c: any) => c.colId)).toEqual(['b', 'c']);
    expect(grp.headerStyle.bg).toBe('#123456');
    g2.destroy();
  });

  it('does not persist a columnGroupDefs overlay when the grid stays flat (no groups)', () => {
    const g = mount(base);
    const snapshot = g.getState();
    expect(snapshot.columnGroupDefs).toBeUndefined();
    g.destroy();
  });

  it('drops a group whose leaves are gone from a NEW base and still surfaces new base columns', () => {
    const g1 = mount(base);
    const api1 = (g1 as any).makeApi();
    api1.updateGridOptions({ columnDefs: [
      { groupId: 'G', headerName: 'Grp', children: [
        { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' },
      ] },
      { colId: 'c', field: 'c' },
    ] });
    const snapshot = g1.getState();
    g1.destroy();

    // Fresh grid whose base defs dropped 'b' and added 'd'.
    const newBase: (CColDef | CColGroupDef)[] = [
      { colId: 'a', field: 'a' }, { colId: 'c', field: 'c' }, { colId: 'd', field: 'd' },
    ];
    const g2 = mount(newBase);
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    const defs = api2.getColumnGroupDefs();
    // 'b' is gone, so group G has only 'a' left — still a valid non-empty group.
    const grp = defs.find((d: any) => d.groupId === 'G');
    expect(grp).toBeDefined();
    expect(grp.children.map((c: any) => c.colId)).toEqual(['a']);
    // 'd' (new in base, absent from the saved overlay) still surfaces.
    expect(defs.some((d: any) => d.colId === 'd')).toBe(true);
    g2.destroy();
  });
});
