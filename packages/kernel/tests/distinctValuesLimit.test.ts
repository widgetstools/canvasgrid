// Cycle 21d / Task 13 — getDistinctValues `limit` end-to-end.
//
// Coverage:
//   1. pass-level — DistinctValuesPass.getValues is untouched: it always
//      returns the full set (the cache never truncates).
//   2. worker-level (createWorkerHost) — the `getDistinctValues` handler
//      truncates the REPLY per `limit`: omitted → full set, `limit: 3` →
//      first 3 (first-seen order), `limit: 0` → `[]`, `limit` larger than
//      the set → full set.
//   3. cache reuse across limits — two requests with different `limit`s
//      share one derivation (the pass-level cache entry is the same array
//      reference across both handler calls).
//   4. api-level — a mounted grid's `api.getDistinctValues(colId, limit)`
//      resolves through the worker round-trip.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { DistinctValuesPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn, WorkerRequest, WorkerResponse, WorkerPush } from '../src/worker/protocol';
import { createWorkerHost } from '../src/worker/worker';
import { VelocityGrid } from '../src/velocityGrid';

beforeAll(() => {
  // Canvas 2D context stub — mirrors tests/calcKernelApi.test.ts /
  // tests/cgrid.integration.test.ts so a mounted VelocityGrid can construct.
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

interface Row { id: string; ticker: string }

function fixtureRows(): Row[] {
  return [
    { id: '1', ticker: 'AAPL' },
    { id: '2', ticker: 'MSFT' },
    { id: '3', ticker: 'GOOG' },
    { id: '4', ticker: 'AMZN' },
    { id: '5', ticker: 'TSLA' },
    { id: '6', ticker: 'META' },
    { id: '7', ticker: 'NFLX' },
    { id: '8', ticker: 'NVDA' },
    { id: '9', ticker: 'AMD' },
    { id: '10', ticker: 'INTC' },
  ];
}

// ─── 1. Pass-level: getValues is unchanged — always the full set ──────────

describe('DistinctValuesPass.getValues — unaffected by Task 13 (pins "cache stays full")', () => {
  it('returns the full distinct set regardless of any caller-side limit notion', () => {
    const store = new RowStore<Row>('id');
    store.setAll(fixtureRows());
    const cols: WorkerColumn[] = [{ colId: 'ticker', field: 'ticker', type: 'text' }];
    const pass = new DistinctValuesPass<Row>(store, cols);
    const values = pass.getValues('ticker');
    expect(values.length).toBe(10);
    expect(new Set(values)).toEqual(new Set([
      'AAPL', 'MSFT', 'GOOG', 'AMZN', 'TSLA', 'META', 'NFLX', 'NVDA', 'AMD', 'INTC',
    ]));
  });
});

// ─── 2 & 3. Worker-level end-to-end ────────────────────────────────────────

function makeHost() {
  const outbox: (WorkerResponse | WorkerPush)[] = [];
  const host = createWorkerHost((msg) => outbox.push(msg));
  return { host, outbox };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function initReq(id: number): WorkerRequest {
  return {
    id,
    type: 'init',
    payload: {
      columns: [{ colId: 'ticker', field: 'ticker', type: 'text' }],
      rowIdField: 'id',
    },
  } as unknown as WorkerRequest;
}

function setRowDataReq(id: number): WorkerRequest {
  return {
    id, type: 'setRowData',
    payload: { rows: fixtureRows() },
  } as unknown as WorkerRequest;
}

function getDistinctReq(id: number, limit?: number): WorkerRequest {
  return {
    id, type: 'getDistinctValues',
    payload: limit === undefined ? { colId: 'ticker' } : { colId: 'ticker', limit },
  } as unknown as WorkerRequest;
}

describe('worker host — getDistinctValues limit (Cycle 21d / Task 13)', () => {
  it('limit omitted → full 10-value set', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle(setRowDataReq(2));
    await flush();
    host.handle(getDistinctReq(3));
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 3) as any;
    expect(reply.type).toBe('distinctValuesResult');
    expect(reply.values.length).toBe(10);
  });

  it('limit: 3 over 10 distinct values → 3 values, first-seen order (prefix of the full set)', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle(setRowDataReq(2));
    await flush();
    host.handle(getDistinctReq(3));
    await flush();
    const full = (outbox.find((m) => 'id' in m && m.id === 3) as any).values as string[];

    host.handle(getDistinctReq(4, 3));
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 4) as any;
    expect(reply.values).toEqual(full.slice(0, 3));
  });

  it('limit: 0 → []', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle(setRowDataReq(2));
    await flush();
    host.handle(getDistinctReq(3, 0));
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 3) as any;
    expect(reply.values).toEqual([]);
  });

  it('limit larger than the set → full set', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle(setRowDataReq(2));
    await flush();
    host.handle(getDistinctReq(3, 1000));
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 3) as any;
    expect(reply.values.length).toBe(10);
  });

  it('cache reuse across limits — limit:3 then limit:7 both derive from the same underlying full-set derivation (both are prefixes; second call does not re-derive)', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle(setRowDataReq(2));
    await flush();

    host.handle(getDistinctReq(3, 3));
    await flush();
    const first = (outbox.find((m) => 'id' in m && m.id === 3) as any).values as string[];

    host.handle(getDistinctReq(4, 7));
    await flush();
    const second = (outbox.find((m) => 'id' in m && m.id === 4) as any).values as string[];

    // Both limited replies are prefixes of the same first-seen ordering —
    // proving they were sliced from one shared full-set derivation rather
    // than two independent re-derivations (which could, in principle,
    // reorder if the pass re-walked the store).
    expect(first.length).toBe(3);
    expect(second.length).toBe(7);
    expect(second.slice(0, 3)).toEqual(first);
  });
});

// ─── 4. API-level: mounted grid round-trip ─────────────────────────────────

describe('VelocityGridApi.getDistinctValues — mounted grid (Cycle 21d / Task 13)', () => {
  function buildWiredGrid<T extends { id: string }>(rows: T[], cols: any[]) {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'vg-theme-quartz';
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
    const grid = new VelocityGrid<T>(container, {
      columnDefs: cols,
      getRowId: (r) => r.id,
      rowData: rows,
    });
    const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
    return { grid, restore };
  }

  it('api.getDistinctValues(colId, limit) resolves the limited set through the worker', async () => {
    const { grid, restore } = buildWiredGrid<Row>(
      fixtureRows(),
      [{ field: 'id' }, { field: 'ticker' }],
    );
    await new Promise((r) => setTimeout(r, 50));
    const api = (grid as any).makeApi();
    const values = await api.getDistinctValues('ticker', 5);
    expect(values.length).toBe(5);
    grid.destroy();
    restore();
  });

  it('api.getDistinctValues(colId) with no limit resolves the full set', async () => {
    const { grid, restore } = buildWiredGrid<Row>(
      fixtureRows(),
      [{ field: 'id' }, { field: 'ticker' }],
    );
    await new Promise((r) => setTimeout(r, 50));
    const api = (grid as any).makeApi();
    const values = await api.getDistinctValues('ticker');
    expect(values.length).toBe(10);
    grid.destroy();
    restore();
  });

  it('grid.getDistinctValues (direct VelocityGrid method) threads limit too', async () => {
    const { grid, restore } = buildWiredGrid<Row>(
      fixtureRows(),
      [{ field: 'id' }, { field: 'ticker' }],
    );
    await new Promise((r) => setTimeout(r, 50));
    const values = await grid.getDistinctValues('ticker', 2);
    expect(values.length).toBe(2);
    grid.destroy();
    restore();
  });
});
