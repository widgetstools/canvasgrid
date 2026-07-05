// Cycle 25 / MarketsCgrid M3 — displayed-row-id mirror + getRowById.
//
// `mirrorDisplayedRowIds: true` makes the worker push its post-filter/
// post-sort visible-row-id order to main on every `visibleCache` rebuild
// (the `invalidateAndCount` choke-point), where `getDisplayedRowIds()`
// reads it synchronously. `getRowById` reads the main-thread
// `rowDataById` mirror. Both back the AG-parity adapter surface
// (forEachNodeAfterFilter, getDisplayedRowAtIndex, getRowNode).
//
// Runs the REAL worker logic inline via `createWorkerHost` (same harness
// as aggFuncRegistry.test.ts) so sort/filter round-trips are genuine.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';

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

type Row = { id: string; price: number };

function mkGrid(opts?: Record<string, unknown>) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<Row>(container, {
    columnDefs: [{ field: 'id' }, { field: 'price', cellDataType: 'number' }],
    getRowId: (r) => r.id,
    rowData: [
      { id: 'r1', price: 30 },
      { id: 'r2', price: 10 },
      { id: 'r3', price: 20 },
    ],
    theme: 'cg-theme-quartz',
    ...(opts ?? {}),
  });
  return { grid, cleanup: () => { grid.destroy(); container.remove(); } };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('getRowById', () => {
  // 1 — Main-thread lookup by id: no worker round-trip, populated by the
  // construction rowData, maintained by transactions.
  it('returns the row for a known id, undefined for unknown', async () => {
    const t = mkGrid();
    await tick();
    expect(t.grid.getRowById('r2')).toEqual({ id: 'r2', price: 10 });
    expect(t.grid.getRowById('nope')).toBeUndefined();
    t.cleanup();
  });

  // 2 — Transactions keep the lookup fresh: update replaces, remove deletes.
  it('tracks applyTransaction update/remove', async () => {
    const t = mkGrid();
    await tick();
    t.grid.applyTransaction({ update: [{ id: 'r2', price: 99 }], remove: [{ id: 'r3', price: 20 }] });
    await tick();
    expect(t.grid.getRowById('r2')).toEqual({ id: 'r2', price: 99 });
    expect(t.grid.getRowById('r3')).toBeUndefined();
    t.cleanup();
  });
});

describe('getDisplayedRowIds mirror', () => {
  // 3 — Off by default: without the option the mirror stays empty (the
  // worker never ships id arrays — ticking grids don't pay for it).
  it('empty when mirrorDisplayedRowIds is not set', async () => {
    const t = mkGrid();
    await tick();
    expect(t.grid.getDisplayedRowIds()).toEqual([]);
    t.cleanup();
  });

  // 4 — Opt-in: primed by the first pipeline pass, in row order.
  it('primes with the initial row order when enabled', async () => {
    const t = mkGrid({ mirrorDisplayedRowIds: true });
    await tick();
    expect([...t.grid.getDisplayedRowIds()]).toEqual(['r1', 'r2', 'r3']);
    t.cleanup();
  });

  // 5 — Sort rebuilds the mirror in the sorted order.
  it('reorders on setSortModel', async () => {
    const t = mkGrid({ mirrorDisplayedRowIds: true });
    await tick();
    t.grid.setSortModel([{ colId: 'price', direction: 'asc' }]);
    await tick();
    expect([...t.grid.getDisplayedRowIds()]).toEqual(['r2', 'r3', 'r1']);
    t.cleanup();
  });

  // 6 — Filter shrinks the mirror to the surviving set.
  it('shrinks on setFilterModel', async () => {
    const t = mkGrid({ mirrorDisplayedRowIds: true });
    await tick();
    t.grid.setFilterModel({ price: { filterType: 'number', type: 'greaterThan', filter: 15 } });
    await tick();
    expect([...t.grid.getDisplayedRowIds()].sort()).toEqual(['r1', 'r3']);
    t.cleanup();
  });

  // 7 — Transactions keep it in lockstep: an added row appears.
  it('tracks applyTransaction add', async () => {
    const t = mkGrid({ mirrorDisplayedRowIds: true });
    await tick();
    t.grid.applyTransaction({ add: [{ id: 'r4', price: 40 }] });
    await tick();
    expect(t.grid.getDisplayedRowIds()).toContain('r4');
    t.cleanup();
  });
});
