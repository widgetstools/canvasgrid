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

/** Cycle 21i Phase 2 / T2 — the column-group slice moved behind the
 *  module-state registry: freshly-built snapshots carry it under
 *  `modules.columnGroups.data.{defs,open}` (legacy v3 snapshots with
 *  top-level fields migrate on setState — the v3 fixtures below pin
 *  that compat path). */
const groupDefsOf = (s: any) => s.modules?.columnGroups?.data?.defs;
const groupOpenOf = (s: any) => s.modules?.columnGroups?.data?.open;

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
    expect(groupDefsOf(snapshot)?.some((n: any) => n.kind === 'group')).toBe(true);
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

  it('Task 9 — headerStyle.fontStyle/border survive getState -> setState onto a fresh grid', () => {
    const g1 = mount(base);
    const api1 = (g1 as any).makeApi();
    api1.updateGridOptions({ columnDefs: [
      { colId: 'a', field: 'a' },
      {
        groupId: 'G', headerName: 'Grp',
        headerStyle: { fontStyle: 'italic', border: { all: { width: 2, style: 'dashed', color: 'rgb(255, 0, 0)' } } },
        children: [{ colId: 'b', field: 'b' }, { colId: 'c', field: 'c' }],
      },
    ] });
    const snapshot = g1.getState();
    g1.destroy();

    const g2 = mount(base);
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    const grp = api2.getColumnGroupDefs().find((d: any) => d.groupId === 'G');
    expect(grp.headerStyle.fontStyle).toBe('italic');
    expect(grp.headerStyle.border).toEqual({ all: { width: 2, style: 'dashed', color: 'rgb(255, 0, 0)' } });
    g2.destroy();
  });

  it('Task 12 — a per-side headerStyle.border.top survives getState -> setState onto a fresh grid', () => {
    const g1 = mount(base);
    const api1 = (g1 as any).makeApi();
    api1.updateGridOptions({ columnDefs: [
      { colId: 'a', field: 'a' },
      {
        groupId: 'G', headerName: 'Grp',
        headerStyle: { border: { top: { width: 3, style: 'dotted', color: 'rgb(10, 20, 30)' } } },
        children: [{ colId: 'b', field: 'b' }, { colId: 'c', field: 'c' }],
      },
    ] });
    const snapshot = g1.getState();
    g1.destroy();

    const g2 = mount(base);
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    const grp = api2.getColumnGroupDefs().find((d: any) => d.groupId === 'G');
    expect(grp.headerStyle.border).toEqual({ top: { width: 3, style: 'dotted', color: 'rgb(10, 20, 30)' } });
    g2.destroy();
  });

  it('does not persist a columnGroupDefs overlay when the grid stays flat (no groups)', () => {
    const g = mount(base);
    const snapshot = g.getState();
    expect(groupDefsOf(snapshot)).toBeUndefined();
    g.destroy();
  });

  it('removing EVERY group from a grid AUTHORED with groups persists the flat overlay — the authored groups do not resurrect on restore (2026-07-04 user report)', () => {
    const grouped: (CColDef | CColGroupDef)[] = [
      { groupId: 'G', headerName: 'Grp', children: [
        { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
      { colId: 'a', field: 'a' },
    ];
    const g1 = mount(grouped);
    const api1 = (g1 as any).makeApi();
    // User deletes every group (panel Apply projects a flat def list).
    api1.updateGridOptions({ columnDefs: [
      { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' }, { colId: 'a', field: 'a' },
    ] });
    const snapshot = g1.getState();
    // The FLAT overlay must persist (constructed-with-groups grid), so
    // restore can override the authored grouped defs.
    const defs = groupDefsOf(snapshot);
    expect(defs).toBeDefined();
    expect(defs.some((n: any) => n.kind === 'group')).toBe(false);
    g1.destroy();

    // Fresh grid with the SAME authored grouped defs (a reload).
    const g2 = mount(grouped);
    const api2 = (g2 as any).makeApi();
    expect(api2.getColumnGroupDefs().some((d: any) => d.children)).toBe(true);
    g2.setState(snapshot);
    expect(api2.getColumnGroupDefs().some((d: any) => d.children)).toBe(false);
    expect(api2.getColumnGroupDefs().map((d: any) => d.colId)).toEqual(['b', 'c', 'a']);
    g2.destroy();
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

  it('columnGroupShow survives getState -> setState onto a fresh grid', () => {
    const g1 = mount(base);
    const api1 = (g1 as any).makeApi();
    api1.updateGridOptions({ columnDefs: [
      { groupId: 'G', headerName: 'Grp', children: [
        { colId: 'a', field: 'a', columnGroupShow: 'open' },
        { colId: 'b', field: 'b', columnGroupShow: 'closed' },
        { colId: 'c', field: 'c' }, // always visible
      ] },
    ] });
    const snapshot = g1.getState();
    g1.destroy();

    const g2 = mount(base);
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    const defs = api2.getColumnGroupDefs();
    const grp = defs.find((d: any) => d.groupId === 'G');
    const a = grp.children.find((c: any) => c.colId === 'a');
    const b = grp.children.find((c: any) => c.colId === 'b');
    const c = grp.children.find((c: any) => c.colId === 'c');
    expect(a.columnGroupShow).toBe('open');
    expect(b.columnGroupShow).toBe('closed');
    expect(c.columnGroupShow).toBeUndefined();
    g2.destroy();
  });

  it('strips a function-valued group headerStyle/headerClass from the persisted overlay, but keeps plain-object styling', () => {
    const g = mount(base);
    const api = (g as any).makeApi();
    api.updateGridOptions({ columnDefs: [
      { groupId: 'Fn', headerName: 'FnGroup', headerStyle: () => ({ bg: '#111' }), headerClass: () => 'live-cls', children: [
        { colId: 'a', field: 'a' },
      ] },
      { groupId: 'Plain', headerName: 'PlainGroup', headerStyle: { bg: '#222' }, headerClass: 'static-cls', children: [
        { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
    ] });
    const snapshot = g.getState();
    expect(() => JSON.stringify(snapshot)).not.toThrow();

    const nodes = groupDefsOf(snapshot) as any[];
    const fnGroup = nodes.find((n) => n.kind === 'group' && n.headerName === 'FnGroup');
    const plainGroup = nodes.find((n) => n.kind === 'group' && n.headerName === 'PlainGroup');
    expect(fnGroup).toBeDefined();
    expect(fnGroup.headerStyle).toBeUndefined();
    expect(fnGroup.headerClass).toBeUndefined();
    expect(plainGroup).toBeDefined();
    expect(plainGroup.headerStyle).toEqual({ bg: '#222' });
    expect(plainGroup.headerClass).toBe('static-cls');
    g.destroy();
  });
});

describe('column-group RUNTIME open/collapse state persists through getState/setState (Task 8)', () => {
  const base: (CColDef | CColGroupDef)[] = [
    { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
  ];
  const withGroup: (CColDef | CColGroupDef)[] = [
    { groupId: 'G', headerName: 'Grp', children: [
      { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
    ] },
    { colId: 'a', field: 'a' },
  ];

  it('round-trips a collapsed group onto a fresh grid with the same group overlay', () => {
    const g1 = mount(withGroup);
    const api1 = (g1 as any).makeApi();
    api1.setColumnGroupState([{ groupId: 'G', open: false }]);
    const snapshot = g1.getState();
    expect(groupOpenOf(snapshot)).toContainEqual({ groupId: 'G', open: false });
    g1.destroy();

    const g2 = mount(withGroup);       // fresh grid, SAME group overlay already present
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    const state2 = api2.getColumnGroupState();
    expect(state2).toContainEqual({ groupId: 'G', open: false });
    g2.destroy();
  });

  it('does not persist columnGroupOpen when the grid has no groups', () => {
    const g = mount(base);
    const snapshot = g.getState();
    expect(groupOpenOf(snapshot)).toBeUndefined();
    g.destroy();
  });

  it('persisted open:false wins over a group authored with openByDefault:true (ordering proof)', () => {
    const defaultOpen: (CColDef | CColGroupDef)[] = [
      { groupId: 'G', headerName: 'Grp', openByDefault: true, children: [
        { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
      { colId: 'a', field: 'a' },
    ];
    const snapshot = {
      version: 3,
      columnGroupOpen: [{ groupId: 'G', open: false }],
    } as any;

    const g = mount(defaultOpen);
    const api = (g as any).makeApi();
    // Sanity: freshly-constructed grid honors openByDefault: true.
    expect(api.getColumnGroupState()).toContainEqual({ groupId: 'G', open: true });

    g.setState(snapshot);
    expect(api.getColumnGroupState()).toContainEqual({ groupId: 'G', open: false });
    g.destroy();
  });

  it('columnGroupOpen restore survives a columnGroupDefs structural restore in the same setState call', () => {
    const g1 = mount(withGroup);
    const api1 = (g1 as any).makeApi();
    // Rename the group's header via updateGridOptions (like the panel's Apply), then collapse it.
    api1.updateGridOptions({ columnDefs: [
      { groupId: 'G', headerName: 'Renamed', children: [
        { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
      { colId: 'a', field: 'a' },
    ] });
    api1.setColumnGroupState([{ groupId: 'G', open: false }]);
    const snapshot = g1.getState();
    expect(groupDefsOf(snapshot)?.some((n: any) => n.kind === 'group' && n.headerName === 'Renamed')).toBe(true);
    expect(groupOpenOf(snapshot)).toContainEqual({ groupId: 'G', open: false });
    g1.destroy();

    // Fresh grid seeded with the ORIGINAL (non-renamed) overlay + openByDefault true.
    const g2 = mount(withGroup);
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    const defs2 = api2.getColumnGroupDefs();
    expect(defs2.find((d: any) => d.groupId === 'G')?.headerName).toBe('Renamed');
    expect(api2.getColumnGroupState()).toContainEqual({ groupId: 'G', open: false });
    g2.destroy();
  });

  it('restore ordering: an overlay-only group (absent from the target base) reseeds from openByDefault via the columnGroupDefs restore, then columnGroupOpen overrides it — closed wins', () => {
    // Grid A: FLAT base (no groups at all). Group G is authored purely
    // through updateGridOptions, so it only ever exists via the
    // `columnGroupDefs` overlay, never via base columnDefs.
    const g1 = mount(base);
    const api1 = (g1 as any).makeApi();
    api1.updateGridOptions({ columnDefs: [
      { groupId: 'G', headerName: 'Grp', openByDefault: true, children: [
        { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
      { colId: 'a', field: 'a' },
    ] });
    api1.setColumnGroupState([{ groupId: 'G', open: false }]);
    const snapshot = g1.getState();
    expect(groupDefsOf(snapshot)?.some((n: any) =>
      n.kind === 'group' && n.id === 'G' && n.openByDefault === true,
    )).toBe(true);
    expect(groupOpenOf(snapshot)).toContainEqual({ groupId: 'G', open: false });
    g1.destroy();

    // Grid B: mounted with the SAME FLAT base defs — group G does NOT
    // exist in B's live tree until the columnGroupDefs restore rebuilds it
    // (reseeding open state from openByDefault: true). The columnGroupOpen
    // restore must then run AFTER and override that reseed to `false`. If
    // the two restore blocks in setState were ever swapped, columnGroupOpen
    // would apply first against a tree that doesn't have G yet (a no-op),
    // and the later columnGroupDefs restore would leave G open — this
    // assertion is what catches that regression.
    const g2 = mount(base);
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    expect(api2.getColumnGroupState()).toContainEqual({ groupId: 'G', open: false });
    g2.destroy();
  });

  it('restore ordering (inverse guard): persisted open:true overrides an overlay-only group authored with openByDefault:false', () => {
    const g1 = mount(base);
    const api1 = (g1 as any).makeApi();
    api1.updateGridOptions({ columnDefs: [
      { groupId: 'H', headerName: 'Grp2', openByDefault: false, children: [
        { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
      { colId: 'a', field: 'a' },
    ] });
    api1.setColumnGroupState([{ groupId: 'H', open: true }]);
    const snapshot = g1.getState();
    expect(groupOpenOf(snapshot)).toContainEqual({ groupId: 'H', open: true });
    g1.destroy();

    const g2 = mount(base);
    const api2 = (g2 as any).makeApi();
    g2.setState(snapshot);
    expect(api2.getColumnGroupState()).toContainEqual({ groupId: 'H', open: true });
    g2.destroy();
  });
});
