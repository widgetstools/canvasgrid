/**
 * Task 13 (VelocityGrid production hardening) — A-P1 + A-P2, asserted
 * black-box through the worker host on the REAL `getViewport` path.
 *
 * The companion unit tests (`perfGenerationCaches.test.ts`) pin the memo
 * primitives. These pin that the `getViewport` handler actually routes
 * through them: two consecutive fetches with no data change must not
 * re-run the aggregation or re-materialise the grouped walks, and any
 * real change must still force the recompute.
 *
 * Method is recompute COUNTS (spies / result identity), never timings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';
import { AggPass } from '../src/worker/dataPipeline';
import * as slicer from '../src/worker/viewportSlicer';
import type { WorkerRequest, WorkerResponse, WorkerPush } from '../src/worker/protocol';

function makeHost() {
  const outbox: (WorkerResponse | WorkerPush)[] = [];
  const host = createWorkerHost((msg) => outbox.push(msg));
  return { host, outbox };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

const ROWS = [
  { id: 'a', desk: 'EQ', notional: 10 },
  { id: 'b', desk: 'EQ', notional: 20 },
  { id: 'c', desk: 'FI', notional: 30 },
  { id: 'd', desk: 'FI', notional: 40 },
];

function initReq(id: number): WorkerRequest {
  return {
    id, type: 'init',
    payload: {
      rowIdField: 'id',
      columns: [
        { colId: 'desk', field: 'desk', type: 'text' },
        { colId: 'notional', field: 'notional', type: 'number', aggFunc: 'sum' },
      ],
    },
  } as unknown as WorkerRequest;
}

function viewportReq(id: number): WorkerRequest {
  return {
    id, type: 'getViewport',
    payload: { rowStart: 0, rowEnd: 4, columns: ['desk', 'notional'] },
  } as unknown as WorkerRequest;
}

describe('A-P1 — getViewport does not re-aggregate when nothing changed', () => {
  let applySpy: ReturnType<typeof vi.spyOn>;
  let groupsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    applySpy = vi.spyOn(AggPass.prototype, 'apply');
    groupsSpy = vi.spyOn(AggPass.prototype, 'applyGroups');
  });
  afterEach(() => {
    applySpy.mockRestore();
    groupsSpy.mockRestore();
  });

  it('two consecutive getViewports serve the SAME grand-total object (one recompute)', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({ id: 2, type: 'setRowData', payload: { rows: ROWS } } as unknown as WorkerRequest);
    await flush();

    host.handle(viewportReq(3));
    await flush();
    host.handle(viewportReq(4));
    await flush();

    const first = outbox.find((m) => 'id' in m && m.id === 3) as any;
    const second = outbox.find((m) => 'id' in m && m.id === 4) as any;
    expect(first.chunk.totals).toEqual({ notional: 100 });
    expect(second.chunk.totals).toEqual({ notional: 100 });

    // Both fetches CALLED apply (unchanged call surface) but the second
    // returned the memoized object — i.e. it did no per-row work.
    const results = applySpy.mock.results.filter((r) => r.type === 'return');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const last = results[results.length - 1]!.value;
    const prev = results[results.length - 2]!.value;
    expect(last).toBe(prev);
  });

  it('a transaction between two getViewports forces a fresh aggregation', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({ id: 2, type: 'setRowData', payload: { rows: ROWS } } as unknown as WorkerRequest);
    await flush();

    host.handle(viewportReq(3));
    await flush();
    host.handle({
      id: 4, type: 'applyTransaction',
      payload: { update: [{ id: 'a', desk: 'EQ', notional: 1000 }], async: false },
    } as unknown as WorkerRequest);
    await flush();
    host.handle(viewportReq(5));
    await flush();

    const before = outbox.find((m) => 'id' in m && m.id === 3) as any;
    const after = outbox.find((m) => 'id' in m && m.id === 5) as any;
    expect(before.chunk.totals).toEqual({ notional: 100 });
    expect(after.chunk.totals).toEqual({ notional: 1090 });

    const results = applySpy.mock.results.filter((r) => r.type === 'return');
    const last = results[results.length - 1]!.value;
    const prev = results[results.length - 2]!.value;
    expect(last).not.toBe(prev);
  });

  it('under grouping, two consecutive getViewports serve the SAME group-totals object', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({ id: 2, type: 'setRowData', payload: { rows: ROWS } } as unknown as WorkerRequest);
    await flush();
    host.handle({
      id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle(viewportReq(4));
    await flush();
    host.handle(viewportReq(5));
    await flush();

    const first = outbox.find((m) => 'id' in m && m.id === 4) as any;
    const second = outbox.find((m) => 'id' in m && m.id === 5) as any;
    expect(first.chunk.groupTotals).toBeDefined();
    expect(second.chunk.groupTotals).toEqual(first.chunk.groupTotals);

    const results = groupsSpy.mock.results.filter((r) => r.type === 'return');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const last = results[results.length - 1]!.value;
    const prev = results[results.length - 2]!.value;
    expect(last).toBe(prev);
  });

  it('an expand/collapse between two getViewports still re-derives group totals', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({ id: 2, type: 'setRowData', payload: { rows: ROWS } } as unknown as WorkerRequest);
    await flush();
    host.handle({
      id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] },
    } as unknown as WorkerRequest);
    await flush();
    host.handle(viewportReq(4));
    await flush();
    host.handle({
      id: 5, type: 'setExpandedKeys', payload: { keys: [] },
    } as unknown as WorkerRequest);
    await flush();
    host.handle(viewportReq(6));
    await flush();

    const collapsed = outbox.find((m) => 'id' in m && m.id === 6) as any;
    // Both groups collapsed ⇒ only the two group rows remain visible, and
    // their aggregates are still correct.
    expect(collapsed.chunk.rowCount).toBe(2);
    expect(collapsed.chunk.groupTotals).toBeDefined();
    const totals = collapsed.chunk.groupTotals as Record<string, Record<string, unknown>>;
    const values = Object.values(totals).map((t) => t['notional']).sort();
    expect(values).toEqual([30, 70]);
  });
});

describe('A-P2 — getViewport does not re-walk the grouped order when nothing changed', () => {
  it('two consecutive grouped getViewports materialise the visible order once', async () => {
    const orderSpy = vi.spyOn(slicer, 'computeGroupVisibleOrder');
    try {
      const { host, outbox } = makeHost();
      host.handle(initReq(1));
      await flush();
      host.handle({ id: 2, type: 'setRowData', payload: { rows: ROWS } } as unknown as WorkerRequest);
      await flush();
      host.handle({
        id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] },
      } as unknown as WorkerRequest);
      await flush();

      orderSpy.mockClear();
      host.handle(viewportReq(4));
      await flush();
      const afterFirst = orderSpy.mock.calls.length;
      host.handle(viewportReq(5));
      await flush();
      const afterSecond = orderSpy.mock.calls.length;

      expect(afterFirst).toBe(1);
      // Second fetch changed nothing ⇒ zero additional walks.
      expect(afterSecond).toBe(afterFirst);

      // …and both fetches still ship the same, correct window.
      const first = outbox.find((m) => 'id' in m && m.id === 4) as any;
      const second = outbox.find((m) => 'id' in m && m.id === 5) as any;
      expect(second.chunk.rowCount).toBe(first.chunk.rowCount);
      expect(Array.from(second.chunk.rowKinds)).toEqual(Array.from(first.chunk.rowKinds));
    } finally {
      orderSpy.mockRestore();
    }
  });

  it('an expandedKeys change between fetches DOES re-walk (and repaints correctly)', async () => {
    const orderSpy = vi.spyOn(slicer, 'computeGroupVisibleOrder');
    try {
      const { host, outbox } = makeHost();
      host.handle(initReq(1));
      await flush();
      host.handle({ id: 2, type: 'setRowData', payload: { rows: ROWS } } as unknown as WorkerRequest);
      await flush();
      host.handle({
        id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] },
      } as unknown as WorkerRequest);
      await flush();
      host.handle(viewportReq(4));
      await flush();
      const expanded = outbox.find((m) => 'id' in m && m.id === 4) as any;
      expect(expanded.chunk.rowCount).toBe(4); // 2 groups + 2 leaves in window

      orderSpy.mockClear();
      host.handle({
        id: 5, type: 'setExpandedKeys', payload: { keys: [] },
      } as unknown as WorkerRequest);
      await flush();
      host.handle(viewportReq(6));
      await flush();
      expect(orderSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const collapsed = outbox.find((m) => 'id' in m && m.id === 6) as any;
      expect(collapsed.chunk.rowCount).toBe(2);
    } finally {
      orderSpy.mockRestore();
    }
  });

  it('a transaction between fetches DOES re-walk the grouped order', async () => {
    const orderSpy = vi.spyOn(slicer, 'computeGroupVisibleOrder');
    try {
      const { host, outbox } = makeHost();
      host.handle(initReq(1));
      await flush();
      host.handle({ id: 2, type: 'setRowData', payload: { rows: ROWS } } as unknown as WorkerRequest);
      await flush();
      host.handle({
        id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] },
      } as unknown as WorkerRequest);
      await flush();
      host.handle(viewportReq(4));
      await flush();

      orderSpy.mockClear();
      host.handle({
        id: 5, type: 'applyTransaction',
        payload: { add: [{ id: 'e', desk: 'CR', notional: 5 }], async: false },
      } as unknown as WorkerRequest);
      await flush();
      host.handle({
        id: 6, type: 'getViewport',
        payload: { rowStart: 0, rowEnd: 8, columns: ['desk', 'notional'] },
      } as unknown as WorkerRequest);
      await flush();
      expect(orderSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const after = outbox.find((m) => 'id' in m && m.id === 6) as any;
      // 3 groups + 5 leaves now visible.
      expect(after.chunk.rowCount).toBe(8);
    } finally {
      orderSpy.mockRestore();
    }
  });
});
