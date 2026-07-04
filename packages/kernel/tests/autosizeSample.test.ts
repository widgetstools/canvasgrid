import { describe, it, expect } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest, WorkerResponse, WorkerPush } from '../src/worker/protocol';

/**
 * Autosize formatted-measurement support — the `autosizeSample` worker
 * request ships the RAW cell values of the autosize sample window back
 * to main, which formats them through the column's `valueFormatter`
 * (functions can't cross the worker boundary) and measures with the
 * document's fonts.
 *
 * Coverage:
 *   • per-column raw values for field columns, in visible order
 *   • null / undefined cells dropped
 *   • fieldless columns answer an empty array (header-only autosize)
 *   • head/tail sampling honours `maxSampleSize`
 *   • `rowCount` reports the total visible count (not the sample size)
 */

function makeHost() {
  const outbox: (WorkerResponse | WorkerPush)[] = [];
  const host = createWorkerHost((msg) => outbox.push(msg));
  return { host, outbox };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function initHost(rows: Array<Record<string, unknown>>) {
  const { host, outbox } = makeHost();
  host.handle({
    id: 0, type: 'init',
    payload: {
      rowIdField: 'id',
      columns: [
        { colId: 'ticker', field: 'ticker', type: 'text' },
        { colId: 'qty', field: 'qty', type: 'number' },
        { colId: 'synthetic', type: 'number' }, // fieldless
      ],
    },
  } as WorkerRequest);
  await flush();
  host.handle({ id: 1, type: 'setRowData', payload: { rows } } as WorkerRequest);
  await flush();
  outbox.length = 0;
  return { host, outbox };
}

function lastSampleResult(outbox: (WorkerResponse | WorkerPush)[]) {
  const reply = outbox.find((m) => (m as WorkerResponse).type === 'autosizeSampleResult');
  expect(reply, 'expected an autosizeSampleResult reply').toBeDefined();
  return reply as Extract<WorkerResponse, { type: 'autosizeSampleResult' }>;
}

describe('worker autosizeSample', () => {
  it('returns raw per-column values in visible order and the total rowCount', async () => {
    const { host, outbox } = await initHost([
      { id: 'a', ticker: 'AAPL', qty: 1 },
      { id: 'b', ticker: 'MSFT', qty: -2230893 },
      { id: 'c', ticker: 'GOOG', qty: 3 },
    ]);
    host.handle({
      id: 2, type: 'autosizeSample',
      payload: { colIds: ['ticker', 'qty', 'synthetic'] },
    } as WorkerRequest);
    await flush();
    const r = lastSampleResult(outbox);
    expect(r.rowCount).toBe(3);
    expect(r.values['ticker']).toEqual(['AAPL', 'MSFT', 'GOOG']);
    expect(r.values['qty']).toEqual([1, -2230893, 3]);
    // Fieldless column: no cell values — main resolves it to
    // header-or-minWidth, same as the legacy pass.
    expect(r.values['synthetic']).toEqual([]);
  });

  it('drops null / undefined cells', async () => {
    const { host, outbox } = await initHost([
      { id: 'a', ticker: 'AAPL', qty: null },
      { id: 'b', ticker: null, qty: 2 },
      { id: 'c', ticker: 'GOOG' }, // qty undefined
    ]);
    host.handle({
      id: 2, type: 'autosizeSample',
      payload: { colIds: ['ticker', 'qty'] },
    } as WorkerRequest);
    await flush();
    const r = lastSampleResult(outbox);
    expect(r.values['ticker']).toEqual(['AAPL', 'GOOG']);
    expect(r.values['qty']).toEqual([2]);
  });

  it('samples head + tail when rowCount exceeds maxSampleSize', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`, ticker: `T${i}`, qty: i,
    }));
    const { host, outbox } = await initHost(rows);
    host.handle({
      id: 2, type: 'autosizeSample',
      payload: { colIds: ['qty'], maxSampleSize: 4 },
    } as WorkerRequest);
    await flush();
    const r = lastSampleResult(outbox);
    // head 2 + tail 2 → row indices [0, 1, 8, 9].
    expect(r.values['qty']).toEqual([0, 1, 8, 9]);
    // rowCount is the TOTAL visible count, not the sample size.
    expect(r.rowCount).toBe(10);
  });

  it('answers unknown colIds with empty arrays instead of erroring', async () => {
    const { host, outbox } = await initHost([{ id: 'a', ticker: 'AAPL', qty: 1 }]);
    host.handle({
      id: 2, type: 'autosizeSample',
      payload: { colIds: ['nope'] },
    } as WorkerRequest);
    await flush();
    const r = lastSampleResult(outbox);
    expect(r.values['nope']).toEqual([]);
  });
});
