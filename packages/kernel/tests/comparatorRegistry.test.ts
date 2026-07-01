// Cycle 8 / Task 3 — `comparator` per column via worker-side
// `ComparatorRegistry`.
//
// Apps register a comparator by NAME (`'naturalOrder'`, `'currency'`, …) via
// `api.registerComparator(name, fn)`. Column defs reference the registered
// comparator via `comparator: 'name'`. The sort runs worker-side; the
// registered function string-serialises across `postMessage` and reconstructs
// on the worker via `new Function(...)`.
//
// Inline closures on a col def (`comparator: (a, b) => …`) throw at
// `setSortModel` time with a message pointing the app at
// `registerComparator` — closures don't cross the worker boundary.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import { ComparatorRegistry } from '../src/worker/comparatorRegistry';
import { SortPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: any) { this.host.handle(msg); }
    addEventListener(_: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
    terminate() {}
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

describe('ComparatorRegistry — unit', () => {
  it('register + get round-trip', () => {
    const r = new ComparatorRegistry();
    const fn = (a: unknown, b: unknown) => (a as number) - (b as number);
    r.register('asc', fn);
    expect(r.get('asc')).toBe(fn);
  });

  it('re-register overwrites the prior entry', () => {
    const r = new ComparatorRegistry();
    r.register('x', () => 1);
    r.register('x', () => -1);
    expect(r.get('x')!('a', 'b')).toBe(-1);
  });

  it('lookup of an unknown name returns undefined', () => {
    const r = new ComparatorRegistry();
    expect(r.get('nope')).toBeUndefined();
  });
});

describe('SortPass dispatches through ComparatorRegistry', () => {
  const cols: WorkerColumn[] = [
    { colId: 'ticker', field: 'ticker', type: 'text', comparator: 'naturalOrder' },
    { colId: 'plain',  field: 'plain',  type: 'text' },
  ];

  function store() {
    const s = new RowStore('id');
    s.setAll([
      { id: '1', ticker: 'TICK10', plain: 'b' },
      { id: '2', ticker: 'TICK2',  plain: 'a' },
      { id: '3', ticker: 'TICK20', plain: 'c' },
    ]);
    return s;
  }

  function naturalOrder(a: unknown, b: unknown): number {
    const as = String(a);
    const bs = String(b);
    const re = /^(\D*)(\d+)?$/;
    const am = re.exec(as);
    const bm = re.exec(bs);
    if (am && bm && am[1] === bm[1] && am[2] != null && bm[2] != null) {
      return Number(am[2]) - Number(bm[2]);
    }
    return as < bs ? -1 : as > bs ? 1 : 0;
  }

  it('named comparator orders TICK2 before TICK10 before TICK20', () => {
    const reg = new ComparatorRegistry();
    reg.register('naturalOrder', naturalOrder);
    const p = new SortPass(store(), cols, reg);
    p.setModel([{ colId: 'ticker', direction: 'asc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['2', '1', '3']);
  });

  it('desc reverses the registered comparator result', () => {
    const reg = new ComparatorRegistry();
    reg.register('naturalOrder', naturalOrder);
    const p = new SortPass(store(), cols, reg);
    p.setModel([{ colId: 'ticker', direction: 'desc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['3', '1', '2']);
  });

  it('unknown comparator name falls back to the default compare()', () => {
    // No registration for the column's `comparator: 'naturalOrder'`. The
    // sort still runs — it just falls through to the default text/number
    // comparator, which orders lexicographically (TICK10 < TICK2 < TICK20).
    const reg = new ComparatorRegistry();
    const p = new SortPass(store(), cols, reg);
    p.setModel([{ colId: 'ticker', direction: 'asc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['1', '2', '3']);
  });

  it('columns without a comparator string use the default compare()', () => {
    const reg = new ComparatorRegistry();
    reg.register('naturalOrder', naturalOrder);
    const p = new SortPass(store(), cols, reg);
    p.setModel([{ colId: 'plain', direction: 'asc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['2', '1', '3']);
  });
});

describe('CGridApi.registerComparator — end-to-end across postMessage', () => {
  function mkGrid() {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'cg-theme-quartz';
    document.body.appendChild(container);
    const grid = new CGrid<{ id: string; ticker: string }>(container, {
      columnDefs: [
        { field: 'id' },
        { field: 'ticker', headerName: 'Ticker', comparator: 'naturalOrder' },
      ],
      getRowId: (r) => r.id,
      rowData: [
        { id: 'r1', ticker: 'TICK10' },
        { id: 'r2', ticker: 'TICK2'  },
        { id: 'r3', ticker: 'TICK20' },
      ],
    });
    return { grid, container, cleanup: () => { grid.destroy(); container.remove(); } };
  }

  it('registered comparator sorts TICK2 before TICK10 before TICK20', async () => {
    const t = mkGrid();
    // Let the worker init + initial setRowData round-trip land.
    await new Promise((r) => setTimeout(r, 30));
    await (t.grid as any).registerComparator('naturalOrder', (a: unknown, b: unknown) => {
      const as = String(a);
      const bs = String(b);
      const re = /^(\D*)(\d+)?$/;
      const am = re.exec(as);
      const bm = re.exec(bs);
      if (am && bm && am[1] === bm[1] && am[2] != null && bm[2] != null) {
        return Number(am[2]) - Number(bm[2]);
      }
      return as < bs ? -1 : as > bs ? 1 : 0;
    });
    (t.grid as any).setSortModel([{ colId: 'ticker', direction: 'asc' }]);
    await new Promise((r) => setTimeout(r, 30));
    const client = (t.grid as any).workerClient;
    const idxR2 = await client.getRowIndexForId('r2');
    const idxR1 = await client.getRowIndexForId('r1');
    const idxR3 = await client.getRowIndexForId('r3');
    expect(idxR2).toBe(0); // TICK2 first
    expect(idxR1).toBe(1); // TICK10 second
    expect(idxR3).toBe(2); // TICK20 third
    t.cleanup();
  });

  it('inline-closure on col def throws at setSortModel time', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'cg-theme-quartz';
    document.body.appendChild(container);
    const grid = new CGrid<{ id: string; a: string }>(container, {
      columnDefs: [
        { field: 'id' },
        { field: 'a', comparator: ((a: string, b: string) => a.localeCompare(b)) as any },
      ],
      getRowId: (r) => r.id,
      rowData: [
        { id: 'r1', a: 'foo' },
        { id: 'r2', a: 'bar' },
      ],
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(() => (grid as any).setSortModel([{ colId: 'a', direction: 'asc' }]))
      .toThrow(/registerComparator/);
    grid.destroy();
    container.remove();
  });
});
