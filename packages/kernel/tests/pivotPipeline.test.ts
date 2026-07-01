// Cycle 18 / Task 3 — worker pivot pipeline wiring.
//
// Task 2 shipped `PivotPass` as a standalone, fully-tested engine. This
// suite pins it WIRED into the worker pipeline end-to-end through
// `createWorkerHost`:
//   - a `setPivotModel` message installs the pivot model on the worker;
//   - the next `getViewport` reply's chunk carries `pivotColumnTree`,
//     `pivotLeafPaths`, and the cross-tab `pivotValues` map;
//   - the cross-tab values match the (rowGroupKey × pivotKeyPath ×
//     valueColumn) intersections of the data.
//
// Pivot data rides the structured-clone path on the chunk (like
// `groupKey` / `groupTotals` — heterogeneous, not typed arrays), so it
// is asserted directly off the reply, not through the binary chunkFormat.

import { describe, it, expect } from 'vitest';
import { getPivotValue } from '../src/worker/dataPipeline';
import type { PivotPassOutput } from '../src/worker/dataPipeline';
import { createWorkerHost } from '../src/worker/worker';
import type {
  WorkerColumn, WorkerRequest, WorkerResponse, WorkerPush, ViewportChunk,
} from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'sector', field: 'sector', type: 'text' },
  { colId: 'pnl',    field: 'pnl',    type: 'number' },
  { colId: 'qty',    field: 'qty',    type: 'number' },
];

const ROWS = [
  { id: '1', region: 'EMEA', sector: 'TECH', pnl: 100, qty: 10 },
  { id: '2', region: 'EMEA', sector: 'TECH', pnl: 200, qty: 20 },
  { id: '3', region: 'EMEA', sector: 'FIN',  pnl: 300, qty: 30 },
  { id: '4', region: 'APAC', sector: 'TECH', pnl: 400, qty: 40 },
  { id: '5', region: 'APAC', sector: 'FIN',  pnl: 500, qty: 50 },
];

interface Harness {
  send: (req: WorkerRequest) => void;
  take: (id: number) => WorkerResponse | undefined;
  wait: (ms?: number) => Promise<void>;
}

function harness(): Harness {
  const replies: WorkerResponse[] = [];
  const host = createWorkerHost((msg: WorkerResponse | WorkerPush) => {
    if ('id' in msg) replies.push(msg);
  });
  return {
    send: (req) => host.handle(req),
    take: (id) => {
      const idx = replies.findIndex((r) => 'id' in r && r.id === id);
      return idx === -1 ? undefined : replies.splice(idx, 1)[0];
    },
    wait: (ms = 50) => new Promise((r) => setTimeout(r, ms)),
  };
}

/** Adapt a chunk's pivot map into the `PivotPassOutput` shape so we can
 *  reuse the `getPivotValue` helper for assertions. */
function asOutput(chunk: ViewportChunk): PivotPassOutput {
  return {
    bypassed: false,
    keyTree: chunk.pivotColumnTree ?? [],
    leafPaths: chunk.pivotLeafPaths ?? [],
    values: chunk.pivotValues ?? new Map(),
  };
}

describe('Worker round-trip — pivot chunk', () => {
  it('ships pivotColumnTree + cross-tab pivotValues after setPivotModel', async () => {
    const h = harness();
    h.send({ id: 1, type: 'init', payload: { columns: cols, rowIdField: 'id' } });
    await h.wait();
    expect(h.take(1)?.type).toBe('ready');

    h.send({ id: 2, type: 'setRowData', payload: { rows: ROWS } });
    await h.wait();
    h.send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['region'] } });
    await h.wait();
    // Install the pivot model: pivot by sector, sum(pnl).
    h.send({
      id: 4, type: 'setPivotModel',
      payload: { pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] },
    });
    await h.wait();
    const pivotReply = h.take(4);
    expect(pivotReply).toBeDefined();

    h.send({
      id: 5, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 20, columns: ['region'] },
    });
    await h.wait();
    const vp = h.take(5);
    expect(vp?.type).toBe('viewport');
    const chunk = (vp as Extract<WorkerResponse, { type: 'viewport' }>).chunk;

    // Distinct pivot keys discovered + sorted: FIN before TECH.
    expect(chunk.pivotColumnTree?.map((n) => n.value)).toEqual(['FIN', 'TECH']);
    expect(chunk.pivotLeafPaths).toEqual([['FIN'], ['TECH']]);

    const out = asOutput(chunk);
    // Per-group cross-tabs.
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'pnl')).toBe(300); // 100 + 200
    expect(getPivotValue(out, 'region:EMEA', ['FIN'], 'pnl')).toBe(300);
    expect(getPivotValue(out, 'region:APAC', ['TECH'], 'pnl')).toBe(400);
    expect(getPivotValue(out, 'region:APAC', ['FIN'], 'pnl')).toBe(500);
    // Grand total (groupKey '').
    expect(getPivotValue(out, '', ['TECH'], 'pnl')).toBe(700); // 100+200+400
    expect(getPivotValue(out, '', ['FIN'], 'pnl')).toBe(800);  // 300+500
  });

  it('omits pivot fields from the chunk when no pivot model is set', async () => {
    const h = harness();
    h.send({ id: 1, type: 'init', payload: { columns: cols, rowIdField: 'id' } });
    await h.wait();
    h.take(1);
    h.send({ id: 2, type: 'setRowData', payload: { rows: ROWS } });
    await h.wait();
    h.send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['region'] } });
    await h.wait();
    h.send({ id: 4, type: 'getViewport', payload: { rowStart: 0, rowEnd: 20, columns: ['region'] } });
    await h.wait();
    const chunk = (h.take(4) as Extract<WorkerResponse, { type: 'viewport' }>).chunk;
    expect(chunk.pivotColumnTree).toBeUndefined();
    expect(chunk.pivotValues).toBeUndefined();
  });

  it('pivotMaxGeneratedColumns breach: chunk omits pivot fields AND carries pivotMaxColumnsReached (Task 8a)', async () => {
    const h = harness();
    h.send({ id: 1, type: 'init', payload: { columns: cols, rowIdField: 'id' } });
    await h.wait();
    h.take(1);
    h.send({ id: 2, type: 'setRowData', payload: { rows: ROWS } });
    await h.wait();
    h.send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['region'] } });
    await h.wait();
    h.send({
      id: 4, type: 'setPivotModel',
      payload: {
        pivotColIds: ['sector'],
        valueCols: [
          { colId: 'pnl', aggFunc: 'sum' },
          { colId: 'qty', aggFunc: 'sum' },
        ],
      },
    });
    await h.wait();
    h.take(4);
    // 2 leaves (FIN + TECH) × 2 value cols = 4 generated columns. Cap at 3.
    h.send({ id: 5, type: 'setPivotMaxGeneratedColumns', payload: 3 });
    await h.wait();
    h.take(5);
    h.send({ id: 6, type: 'getViewport', payload: { rowStart: 0, rowEnd: 20, columns: ['region'] } });
    await h.wait();
    const chunk = (h.take(6) as Extract<WorkerResponse, { type: 'viewport' }>).chunk;
    // Pivot output is fully bypassed when the cap is breached.
    expect(chunk.pivotColumnTree).toBeUndefined();
    expect(chunk.pivotLeafPaths).toBeUndefined();
    expect(chunk.pivotValues).toBeUndefined();
    // The breach is reported.
    expect(chunk.pivotMaxColumnsReached).toEqual({ generatedColumns: 4, cap: 3 });
  });

  it('reverting the cap (undefined) on the next setPivotMaxGeneratedColumns re-enables pivot output', async () => {
    const h = harness();
    h.send({ id: 1, type: 'init', payload: { columns: cols, rowIdField: 'id' } });
    await h.wait();
    h.take(1);
    h.send({ id: 2, type: 'setRowData', payload: { rows: ROWS } });
    await h.wait();
    h.send({
      id: 3, type: 'setPivotModel',
      payload: { pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] },
    });
    await h.wait();
    h.take(3);
    // Tight cap → breach.
    h.send({ id: 4, type: 'setPivotMaxGeneratedColumns', payload: 1 });
    await h.wait();
    h.take(4);
    h.send({ id: 5, type: 'getViewport', payload: { rowStart: 0, rowEnd: 20, columns: ['region'] } });
    await h.wait();
    const tripped = (h.take(5) as Extract<WorkerResponse, { type: 'viewport' }>).chunk;
    expect(tripped.pivotMaxColumnsReached).toEqual({ generatedColumns: 2, cap: 1 });
    // Revert → next viewport has pivot output and NO breach.
    h.send({ id: 6, type: 'setPivotMaxGeneratedColumns', payload: undefined });
    await h.wait();
    h.take(6);
    h.send({ id: 7, type: 'getViewport', payload: { rowStart: 0, rowEnd: 20, columns: ['region'] } });
    await h.wait();
    const restored = (h.take(7) as Extract<WorkerResponse, { type: 'viewport' }>).chunk;
    expect(restored.pivotMaxColumnsReached).toBeUndefined();
    expect(restored.pivotColumnTree?.map((n) => n.value)).toEqual(['FIN', 'TECH']);
  });

  it('clears pivot fields after the pivot model is emptied', async () => {
    const h = harness();
    h.send({ id: 1, type: 'init', payload: { columns: cols, rowIdField: 'id' } });
    await h.wait();
    h.take(1);
    h.send({ id: 2, type: 'setRowData', payload: { rows: ROWS } });
    await h.wait();
    h.send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['region'] } });
    await h.wait();
    h.send({
      id: 4, type: 'setPivotModel',
      payload: { pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] },
    });
    await h.wait();
    h.take(4);
    // Empty the model.
    h.send({ id: 5, type: 'setPivotModel', payload: { pivotColIds: [], valueCols: [] } });
    await h.wait();
    h.take(5);
    h.send({ id: 6, type: 'getViewport', payload: { rowStart: 0, rowEnd: 20, columns: ['region'] } });
    await h.wait();
    const chunk = (h.take(6) as Extract<WorkerResponse, { type: 'viewport' }>).chunk;
    expect(chunk.pivotColumnTree).toBeUndefined();
    expect(chunk.pivotValues).toBeUndefined();
  });
});
