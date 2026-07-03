// Cycle 21g / Task 10 — public `getRowsByIndex` (spec §3.6a).
//
// Coverage:
//   1. basic alignment — output order matches INPUT order, not index order.
//   2. duplicate indexes resolve independently but dedupe the underlying
//      `workerCoord.getRowByIndex` fetch (one call per unique index).
//   3. out-of-range index → null entry, alignment preserved.
//   4. empty input → [] with no worker traffic.
//   5. visible-order proof — result reflects post-sort visible order.
//   6. destroyed guard → all-null aligned array (no throw).
//   7. api-object wiring — `makeApi()` exposes `getRowsByIndex` (the
//      `as CGridApi<TRow>` cast at cgrid.ts:5746 would not catch a
//      forgotten entry at compile time).

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';
import { CGrid } from '../src/cgrid';

beforeAll(() => {
  // Canvas 2D context stub — mirrors tests/distinctValuesLimit.test.ts /
  // tests/calcKernelApi.test.ts so a mounted CGrid can construct.
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

interface Row { id: string; ticker: string; qty: number }

function fixtureRows(): Row[] {
  return [
    { id: '1', ticker: 'AAPL', qty: 10 },
    { id: '2', ticker: 'MSFT', qty: 20 },
    { id: '3', ticker: 'GOOG', qty: 30 },
    { id: '4', ticker: 'AMZN', qty: 40 },
    { id: '5', ticker: 'TSLA', qty: 50 },
    { id: '6', ticker: 'META', qty: 60 },
    { id: '7', ticker: 'NFLX', qty: 70 },
    { id: '8', ticker: 'NVDA', qty: 80 },
    { id: '9', ticker: 'AMD', qty: 90 },
    { id: '10', ticker: 'INTC', qty: 100 },
  ];
}

function buildWiredGrid<T extends { id: string }>(rows: T[], cols: any[]) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const prevWorker = (globalThis as any).Worker;
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
  const grid = new CGrid<T>(container, {
    columnDefs: cols,
    getRowId: (r) => r.id,
    rowData: rows,
  });
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, restore };
}

const COLS = [{ field: 'id' }, { field: 'ticker' }, { field: 'qty', type: 'number' }];

describe('CGrid.getRowsByIndex — mounted grid (Cycle 21g / Task 10)', () => {
  it('1. basic alignment: output order matches INPUT order, not index order', async () => {
    const { grid, restore } = buildWiredGrid<Row>(fixtureRows(), COLS);
    await new Promise((r) => setTimeout(r, 50));
    const result = await grid.getRowsByIndex([2, 0, 4]);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ rowIndex: 2, rowId: '3', data: expect.objectContaining({ ticker: 'GOOG' }) });
    expect(result[1]).toEqual({ rowIndex: 0, rowId: '1', data: expect.objectContaining({ ticker: 'AAPL' }) });
    expect(result[2]).toEqual({ rowIndex: 4, rowId: '5', data: expect.objectContaining({ ticker: 'TSLA' }) });
    grid.destroy();
    restore();
  });

  it('2. duplicate indexes resolve independently but dedupe the worker fetch', async () => {
    const { grid, restore } = buildWiredGrid<Row>(fixtureRows(), COLS);
    await new Promise((r) => setTimeout(r, 50));
    const spy = vi.spyOn((grid as any).workerCoord, 'getRowByIndex');
    const result = await grid.getRowsByIndex([1, 1, 3]);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual(result[1]);
    expect(result[0]).toEqual({ rowIndex: 1, rowId: '2', data: expect.objectContaining({ ticker: 'MSFT' }) });
    expect(result[2]).toEqual({ rowIndex: 3, rowId: '4', data: expect.objectContaining({ ticker: 'AMZN' }) });
    expect(spy).toHaveBeenCalledTimes(2); // unique {1, 3}
    grid.destroy();
    restore();
  });

  it('3. out-of-range index → null entry, alignment preserved', async () => {
    const { grid, restore } = buildWiredGrid<Row>(fixtureRows(), COLS);
    await new Promise((r) => setTimeout(r, 50));
    const result = await grid.getRowsByIndex([0, 9999]);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ rowIndex: 0, rowId: '1', data: expect.objectContaining({ ticker: 'AAPL' }) });
    expect(result[1]).toBeNull();
    grid.destroy();
    restore();
  });

  it('4. empty input → [] with no worker traffic', async () => {
    const { grid, restore } = buildWiredGrid<Row>(fixtureRows(), COLS);
    await new Promise((r) => setTimeout(r, 50));
    const spy = vi.spyOn((grid as any).workerCoord, 'getRowByIndex');
    const result = await grid.getRowsByIndex([]);
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    grid.destroy();
    restore();
  });

  it('5. visible-order proof: reflects post-sort visible order, not insertion order', async () => {
    const { grid, restore } = buildWiredGrid<Row>(fixtureRows(), COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setSortModel([{ colId: 'qty', direction: 'desc' }]);
    await new Promise((r) => setTimeout(r, 50));
    const result = await grid.getRowsByIndex([0]);
    expect(result[0]).toEqual({ rowIndex: 0, rowId: '10', data: expect.objectContaining({ ticker: 'INTC', qty: 100 }) });
    grid.destroy();
    restore();
  });

  it('6. destroyed guard → all-null aligned array, no throw', async () => {
    const { grid, restore } = buildWiredGrid<Row>(fixtureRows(), COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.destroy();
    const result = await grid.getRowsByIndex([0, 1]);
    expect(result).toEqual([null, null]);
    restore();
  });

  it('7. api-object wiring: makeApi() exposes getRowsByIndex (the `as`-cast tripwire)', async () => {
    const { grid, restore } = buildWiredGrid<Row>(fixtureRows(), COLS);
    await new Promise((r) => setTimeout(r, 50));
    const api = (grid as any).makeApi();
    expect(typeof api.getRowsByIndex).toBe('function');
    const result = await api.getRowsByIndex([0]);
    expect(result[0]).toEqual({ rowIndex: 0, rowId: '1', data: expect.objectContaining({ ticker: 'AAPL' }) });
    grid.destroy();
    restore();
  });
});
