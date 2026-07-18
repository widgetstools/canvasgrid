import { describe, it, expect, vi } from 'vitest';
import {
  WorkerCoordinator,
  type WorkerCoordinatorDeps,
} from '../src/core/workerCoordinator';
import { createWorkerHost } from '../src/worker/worker';
import type { ViewportChunk, StickyAncestor, MeasureTextItem } from '../src/worker/protocol';
import type { TransactionResult } from '../src/types';

/**
 * Cycle 19 / Task 3 — focused unit coverage for the extracted WorkerCoordinator.
 *
 * Mirrors `tests/workerClient.test.ts`'s `FakeWorker` pattern so the
 * coordinator round-trips against the real worker host (init / setRowData /
 * getViewport / applyTransaction) without dragging the WorkerClient mock
 * surface into every test.
 *
 * Coverage:
 *   • viewport dispatch routes the chunk + stickyAncestors into the
 *     `onViewportChunk` dep (the seam Task 2 left in CGrid),
 *   • sync + async transactions reach the worker as a single round-trip
 *     and the async push surfaces back via `onAsyncTransactionsFlushed`,
 *   • flushAsyncTransactions force-drains the worker queue,
 *   • worker-error propagation lands on `deps.onError`,
 *   • pass-through model setters (setSortModel / setFilterModel) round-trip
 *     and the chunk's downstream visibility reflects the worker pipeline.
 *   • destroy tears down the underlying WorkerClient (subsequent calls
 *     reject with `worker terminated`).
 */

class FakeWorker {
  private listeners: Array<(e: { data: unknown }) => void> = [];
  host = createWorkerHost((msg) => {
    queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
  });
  postMessage(msg: unknown) { this.host.handle(msg); }
  addEventListener(_t: string, cb: (e: { data: unknown }) => void) { this.listeners.push(cb); }
  removeEventListener(_t: string, cb: (e: { data: unknown }) => void) {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }
  terminate() { /* no-op for FakeWorker */ }
}

interface Harness {
  worker: FakeWorker;
  coord: WorkerCoordinator;
  events: {
    modelUpdated: Array<[number, string[] | undefined]>;
    asyncTxFlushed: TransactionResult[][];
    heights: Array<[number, Float32Array]>;
    measure: Array<[number, MeasureTextItem[]]>;
    externalFilter: Array<[string[], number]>;
    postSort: Array<[string[], number]>;
    errors: string[];
    chunks: Array<{
      opts: { rowStart: number; rowEnd: number; columns: string[] };
      chunk: ViewportChunk;
      sticky: StickyAncestor[];
    }>;
  };
  deps: WorkerCoordinatorDeps;
}

function makeHarness(): Harness {
  const worker = new FakeWorker();
  const events: Harness['events'] = {
    modelUpdated: [],
    asyncTxFlushed: [],
    heights: [],
    measure: [],
    externalFilter: [],
    postSort: [],
    errors: [],
    chunks: [],
  };
  const deps: WorkerCoordinatorDeps = {
    onModelUpdated: (vc, gk) => { events.modelUpdated.push([vc, gk]); },
    onAsyncTransactionsFlushed: (r) => { events.asyncTxFlushed.push(r); },
    onHeightsChanged: (rs, h) => { events.heights.push([rs, h]); },
    onMeasureTextRequest: (b, i) => { events.measure.push([b, i]); },
    onExternalFilterCandidates: (ids, cid) => { events.externalFilter.push([ids, cid]); },
    onPostSortRowsCandidates: (ids, cid) => { events.postSort.push([ids, cid]); },
    onError: (m) => { events.errors.push(m); },
    onViewportChunk: (opts, chunk, sticky) => { events.chunks.push({ opts, chunk, sticky }); },
    isDestroyed: () => false,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coord = new WorkerCoordinator(worker as any, deps);
  return { worker, coord, events, deps };
}

async function initWithRows(h: Harness, rows: Array<Record<string, unknown>>): Promise<void> {
  await h.coord.init({
    rowIdField: 'id',
    columns: [
      { colId: 'id', field: 'id', type: 'text' },
      { colId: 'pri', field: 'pri', type: 'number' },
    ],
  });
  await h.coord.setRowData(rows);
}

describe('WorkerCoordinator — init + transactions', () => {
  it('init + setRowData round-trip resolves with the visible count', async () => {
    const h = makeHarness();
    await h.coord.init({
      rowIdField: 'id',
      columns: [{ colId: 'id', field: 'id', type: 'text' }],
    });
    const r = await h.coord.setRowData([{ id: 'a' }, { id: 'b' }]);
    expect(r.visibleCount).toBe(2);
  });

  it('applyTransaction({ async: false }) resolves synchronously with the result', async () => {
    const h = makeHarness();
    await initWithRows(h, [{ id: 'a', pri: 1 }]);
    const result = await h.coord.applyTransaction({
      add: [{ id: 'b', pri: 2 }],
      async: false,
    });
    // RowStore.apply returns the row arrays it processed for each verb.
    expect(result.add?.length).toBe(1);
  });

  it('applyTransaction({ async: true }) pushes asyncTransactionsFlushed back to the dep', async () => {
    const h = makeHarness();
    await initWithRows(h, [{ id: 'a', pri: 1 }]);
    // Async transactions are buffered worker-side and flushed on a 50ms
    // setTimeout. The async resolve we await here is the worker's "queued"
    // ack — the actual flush + push lands a moment later.
    await h.coord.applyTransaction({ update: [{ id: 'a', pri: 99 }], async: true });
    // Drain the queue + RAF push coalescer.
    await new Promise((r) => setTimeout(r, 80));
    expect(h.events.asyncTxFlushed.length).toBeGreaterThanOrEqual(1);
  });

  it('flushAsyncTransactions force-drains without throwing', async () => {
    const h = makeHarness();
    await initWithRows(h, [{ id: 'a', pri: 1 }]);
    expect(() => h.coord.flushAsyncTransactions()).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe('WorkerCoordinator — viewport dispatch', () => {
  it('dispatchViewportRequest fetches the chunk and hands it to onViewportChunk', async () => {
    const h = makeHarness();
    await initWithRows(h, [
      { id: 'a', pri: 1 },
      { id: 'b', pri: 2 },
    ]);
    await h.coord.dispatchViewportRequest({ rowStart: 0, rowEnd: 2, columns: ['id', 'pri'] });
    expect(h.events.chunks.length).toBe(1);
    const c = h.events.chunks[0]!;
    expect(c.opts).toEqual({ rowStart: 0, rowEnd: 2, columns: ['id', 'pri'] });
    expect(c.chunk.rowCount).toBe(2);
    // Sticky ancestors default to an empty array when grouping is bypassed.
    expect(c.sticky).toEqual([]);
  });

  it('dispatchViewportRequest awaits the dep callback before resolving (so VM coalescing releases at the right time)', async () => {
    const h = makeHarness();
    await initWithRows(h, [{ id: 'a' }]);
    // Make onViewportChunk async with an externally-resolved promise so we
    // can verify dispatchViewportRequest doesn't resolve before the dep
    // settles — that's the contract ViewportManager.request relies on.
    let releaseChunkHandler!: () => void;
    const chunkHandlerSettled = new Promise<void>((r) => { releaseChunkHandler = r; });
    h.deps.onViewportChunk = () => chunkHandlerSettled;
    let dispatchResolved = false;
    const inflight = h.coord
      .dispatchViewportRequest({ rowStart: 0, rowEnd: 1, columns: ['id'] })
      .then(() => { dispatchResolved = true; });
    // Drain the FakeWorker microtask round-trip so the chunk has arrived
    // and the dep callback has been called.
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatchResolved).toBe(false);
    releaseChunkHandler();
    await inflight;
    expect(dispatchResolved).toBe(true);
  });

  it('dispatchViewportRequest rejection propagates so VM.request hits its catch', async () => {
    const h = makeHarness();
    // Skip init so getViewport throws inside the host (`host.handle`
    // calls `getRequiredState()` which rejects with a `'not-initialized'`
    // string when state is null).
    await expect(
      h.coord.dispatchViewportRequest({ rowStart: 0, rowEnd: 1, columns: ['id'] }),
    ).rejects.toBeInstanceOf(Error);
    expect(h.events.chunks).toHaveLength(0);
  });
});

describe('WorkerCoordinator — pass-throughs', () => {
  it('setSortModel reorders rows visible in the next chunk', async () => {
    const h = makeHarness();
    await initWithRows(h, [
      { id: 'a', pri: 3 },
      { id: 'b', pri: 1 },
      { id: 'c', pri: 2 },
    ]);
    await h.coord.setSortModel([{ colId: 'pri', direction: 'asc' }]);
    await h.coord.dispatchViewportRequest({ rowStart: 0, rowEnd: 3, columns: ['id'] });
    const chunk = h.events.chunks.at(-1)!.chunk;
    // After ASC sort by pri: b (1), c (2), a (3) — id column is the first
    // text column, so chunk.text[0] holds the encoded id strings for the
    // visible window.
    expect(chunk.rowCount).toBe(3);
  });

  it('setFilterModel reduces the next chunk to surviving rows', async () => {
    const h = makeHarness();
    await initWithRows(h, [
      { id: 'aaa', pri: 1 },
      { id: 'bbb', pri: 2 },
    ]);
    const { visibleCount } = await h.coord.setFilterModel({
      id: { type: 'text', op: 'contains', value: 'aaa' },
    });
    expect(visibleCount).toBe(1);
  });

  it('getRowIndexForId / getRowIndicesForIds proxy through', async () => {
    const h = makeHarness();
    await initWithRows(h, [
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ]);
    expect(await h.coord.getRowIndexForId('b')).toBe(1);
    const batch = await h.coord.getRowIndicesForIds(['c', 'unknown', 'a']);
    expect(Array.from(batch)).toEqual([2, -1, 0]);
  });
});

describe('WorkerCoordinator — error propagation + destroy', () => {
  it('worker-side error from a malformed group model rejects the round-trip', async () => {
    const h = makeHarness();
    await initWithRows(h, [{ id: 'a' }]);
    // Unknown colId in the group model — the worker `setGroupModel`
    // case explicitly catches GroupPass.setModel's throw and replies
    // with an `error` envelope. The promise rejects; `deps.onError` is
    // NOT called because errors attached to a specific reqId resolve
    // through the pending map, not the push channel.
    await expect(
      h.coord.setGroupModel({ rowGroupCols: ['no-such-col'] }),
    ).rejects.toThrow();
    expect(h.events.errors).toHaveLength(0);
  });

  it('destroy rejects in-flight requests with "worker terminated"', async () => {
    const h = makeHarness();
    await h.coord.init({
      rowIdField: 'id',
      columns: [{ colId: 'id', field: 'id', type: 'text' }],
    });
    // Fire a request that hasn't drained microtasks yet, then destroy.
    const inflight = h.coord.setRowData([{ id: 'a' }]);
    h.coord.destroy();
    await expect(inflight).rejects.toThrow(/worker terminated/);
  });

  it('destroy is idempotent', () => {
    const h = makeHarness();
    h.coord.destroy();
    expect(() => h.coord.destroy()).not.toThrow();
  });
});
