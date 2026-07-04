/**
 * Cycle 21i Phase 2 / T3 — API widening + enumerations.
 *
 * The recon's Tier B gaps: `getFilterModel` / `getState` / `setState` /
 * `getSortModel` existed class-only while customizer panels code against
 * `CGridApi` (the two-tier contract). Plus the Tier A enumerations:
 * `listIcons()` (resolveIcon was lookup-only), instance-truth
 * `listCellRenderers()`, and the `forEachColumnGroup` live group-tree
 * walk (structure + depth + runtime open state in one visit).
 *
 * Worker/canvas stub setup mirrors `runtimeOptions.test.ts` so a CGrid
 * constructs under happy-dom without a real worker thread.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { CGrid } from '../src/cgrid';
import type { CColDef, CColGroupDef, ColumnGroupWalkNode } from '../src/types';
import { listIcons, registerIconSet, _resetIconRegistry_forTests } from '../src/icons/registry';

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

afterEach(() => {
  _resetIconRegistry_forTests();
});

function mount(columnDefs: (CColDef | CColGroupDef)[]) {
  const el = document.createElement('div');
  el.style.cssText = 'width:800px; height:600px;';
  document.body.appendChild(el);
  const grid = new CGrid(el, { columnDefs, rowData: [], getRowId: (r: any) => r.id });
  return { grid, api: (grid as any).makeApi() };
}

describe('Tier B widening — class-only methods now on CGridApi', () => {
  it('getSortModel / getFilterModel / getState / setState round-trip through the api tier', () => {
    const { grid, api } = mount([
      { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' },
    ]);
    api.setSortModel([{ colId: 'a', sort: 'desc' }]);
    expect(api.getSortModel()).toEqual([{ colId: 'a', sort: 'desc' }]);

    api.setFilterModel({ b: { filterType: 'text', type: 'contains', filter: 'x' } });
    expect(api.getFilterModel()).toEqual({ b: { filterType: 'text', type: 'contains', filter: 'x' } });

    const snapshot = api.getState();
    expect(snapshot.sortModel).toEqual([{ colId: 'a', sort: 'desc' }]);
    expect(snapshot.filterModel).toEqual({ b: { filterType: 'text', type: 'contains', filter: 'x' } });

    api.setFilterModel({});
    api.setSortModel([]);
    expect(api.getSortModel()).toEqual([]);
    api.setState(snapshot);
    expect(api.getSortModel()).toEqual([{ colId: 'a', sort: 'desc' }]);
    expect(api.getFilterModel()).toEqual({ b: { filterType: 'text', type: 'contains', filter: 'x' } });
    grid.destroy();
  });
});

describe('listCellRenderers — instance-truth enumeration', () => {
  it('lists built-ins and picks up per-grid registrations', () => {
    const { grid, api } = mount([{ colId: 'a', field: 'a' }]);
    const before = api.listCellRenderers();
    expect(before).toContain('text');
    expect(before).toContain('number');
    expect(before).not.toContain('pnlPill');
    api.registerCellRenderer('pnlPill', { paint: () => {} });
    expect(api.listCellRenderers()).toContain('pnlPill');
    grid.destroy();
  });
});

describe('listIcons — icon-name enumeration', () => {
  it('unions across sets in resolution order; per-set listing; unknown set → []', () => {
    registerIconSet('lucide', { save: 'M1 1', calendar: 'M2 2' });
    registerIconSet('phosphor', { save: 'M3 3', funnel: 'M4 4' });
    expect(listIcons()).toEqual(['save', 'calendar', 'funnel']);
    expect(listIcons('phosphor')).toEqual(['save', 'funnel']);
    expect(listIcons('ghost')).toEqual([]);
  });

  it('is exposed on the grid instance + api tier', () => {
    registerIconSet('lucide', { save: 'M1 1' });
    const { grid, api } = mount([{ colId: 'a', field: 'a' }]);
    expect(grid.listIcons()).toContain('save');
    expect(api.listIcons('lucide')).toEqual(['save']);
    grid.destroy();
  });
});

describe('forEachColumnGroup — live group-tree walk', () => {
  const defs: (CColDef | CColGroupDef)[] = [
    { groupId: 'trade', headerName: 'Trade', openByDefault: true, children: [
      { groupId: 'valuation', headerName: 'Valuation', openByDefault: false, children: [
        { colId: 'notional', field: 'notional' },
        { colId: 'mkt', field: 'mkt', columnGroupShow: 'open' },
      ] },
      { colId: 'pnl', field: 'pnl' },
    ] },
    { colId: 'ticker', field: 'ticker' },
    { groupId: 'risk', headerName: 'Risk', children: [
      { colId: 'dv01', field: 'dv01' },
    ] },
  ];

  it('visits groups pre-order with depth, structure, and live open state', () => {
    const { grid } = mount(defs);
    const visits: ColumnGroupWalkNode[] = [];
    grid.forEachColumnGroup((n) => visits.push(n));
    expect(visits.map((v) => v.groupId)).toEqual(['trade', 'valuation', 'risk']);
    const trade = visits[0];
    expect(trade.depth).toBe(0);
    expect(trade.headerName).toBe('Trade');
    expect(trade.childGroupIds).toEqual(['valuation']);
    expect(trade.leafColIds).toEqual(['notional', 'mkt', 'pnl']);
    expect(trade.open).toBe(true); // openByDefault: true
    const valuation = visits[1];
    expect(valuation.depth).toBe(1);
    expect(valuation.open).toBe(false); // openByDefault: false
    expect(valuation.leafColIds).toEqual(['notional', 'mkt']);
    expect(visits[2].leafColIds).toEqual(['dv01']);
    grid.destroy();
  });

  it('reflects RUNTIME open flips (not just authored openByDefault)', () => {
    const { grid, api } = mount(defs);
    api.setColumnGroupState([{ groupId: 'trade', open: false }, { groupId: 'valuation', open: true }]);
    const open: Record<string, boolean> = {};
    api.forEachColumnGroup((n: ColumnGroupWalkNode) => { open[n.groupId] = n.open; });
    // risk has no openByDefault -> seeds closed (open only gates
    // columnGroupShow children; a closed group still renders leaves).
    expect(open).toEqual({ trade: false, valuation: true, risk: false });
    grid.destroy();
  });

  it('carries columnGroupShow through and visits nothing on a flat grid', () => {
    const withShow: (CColDef | CColGroupDef)[] = [
      { groupId: 'g', headerName: 'G', children: [
        { groupId: 'sub', headerName: 'Sub', columnGroupShow: 'closed', children: [
          { colId: 'x', field: 'x' },
        ] },
        { colId: 'y', field: 'y' },
      ] },
    ];
    const { grid } = mount(withShow);
    const shows: Array<string | null> = [];
    grid.forEachColumnGroup((n) => shows.push(n.columnGroupShow));
    expect(shows).toEqual([null, 'closed']);
    grid.destroy();

    const { grid: flat } = mount([{ colId: 'a', field: 'a' }]);
    const visits: unknown[] = [];
    flat.forEachColumnGroup((n) => visits.push(n));
    expect(visits).toEqual([]);
    flat.destroy();
  });
});
