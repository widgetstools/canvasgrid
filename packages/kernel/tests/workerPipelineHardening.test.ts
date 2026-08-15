/**
 * VelocityGrid production hardening — CSRM worker correctness.
 *
 * A-C2: a pending async transaction must NOT survive a `setRowData`. The
 *       replacement dataset wipes the main-thread row mirror; replaying a
 *       queued tick onto the new store would permanently diverge the two.
 *       `setRowData` drains-and-discards the async queue (clears its timer).
 *
 * A-C3: the visible-build pipeline is single-flight. When a main-thread hook
 *       (external filter / postSortRows) suspends `buildVisibleAsync` across
 *       an `await`, a concurrent request must JOIN the in-flight build rather
 *       than start a second one that interleaves writes to
 *       groupOutput/pivotOut/groupInputIds/visibleCache.
 */
import { describe, it, expect, vi } from 'vitest';
import { WorkerClient } from '../src/worker/client';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerColumn } from '../src/worker/protocol';

class FakeWorker {
  private listeners: Array<(e: { data: unknown }) => void> = [];
  host = createWorkerHost((msg) => {
    queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
  });
  postMessage(msg: unknown) { this.host.handle(msg as never); }
  addEventListener(_t: string, cb: (e: { data: unknown }) => void) { this.listeners.push(cb); }
  terminate() {}
}

interface Row { id: string; name: string; price: number }
const ROWS: Row[] = [
  { id: 'a', name: 'apple',  price: 10 },
  { id: 'b', name: 'banana', price: 20 },
  { id: 'c', name: 'cherry', price: 30 },
  { id: 'd', name: 'durian', price: 40 },
];
const COLUMNS: WorkerColumn[] = [
  { colId: 'name',  field: 'name',  type: 'text', filter: 'text' },
  { colId: 'price', field: 'price', type: 'number', filter: 'number' },
];

/** Flush every pending microtask (FakeWorker delivers replies via
 *  `queueMicrotask`) by yielding a macrotask. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('CSRM worker — pending async txn does not survive setRowData (A-C2)', () => {
  it('a queued async add is discarded (not replayed) when setRowData replaces the dataset', async () => {
    const w = new FakeWorker();
    const onModelUpdated = vi.fn();
    const client = new WorkerClient(w as never, {
      onModelUpdated,
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    } as never);
    // Pin a 50ms debounce with throttle off so the queued tick would flush
    // on its own timer if it were not discarded.
    await client.init({
      rowIdField: 'id', columns: COLUMNS,
      asyncTransactionWaitMillis: 50, asyncTransactionThrottleMillis: 0,
    });
    await client.setRowData(ROWS);

    // Queue an async add of a row that does NOT exist in the replacement
    // dataset. The async path returns immediately (empty transactionFlushed)
    // and leaves the real apply on the queue's debounce timer.
    await client.applyTransaction({ add: [{ id: 'X', name: 'ghost', price: 99 }], async: true });

    // Replace the dataset before the debounce fires. This must drain-discard
    // the queued add so 'X' never lands in the replacement store.
    const NEW_ROWS: Row[] = [
      { id: 'n1', name: 'nova',  price: 1 },
      { id: 'n2', name: 'nadir', price: 2 },
    ];
    await client.setRowData(NEW_ROWS);

    // Wait well past the 50ms debounce — a surviving queue would have flushed
    // 'X' onto the new store by now.
    await flush();
    await new Promise((r) => setTimeout(r, 150));

    // 'X' must be absent; the store is exactly the replacement rows.
    expect(await client.getRowIndexForId('X')).toBe(-1);
    expect(await client.getRowIndexForId('n1')).toBe(0);
    expect(await client.getRowIndexForId('n2')).toBe(1);
    // No late modelUpdated ever surfaced a visibleCount above the 2
    // replacement rows (a replayed add would push a 3-row model).
    for (const call of onModelUpdated.mock.calls) {
      expect(call[0]).toBeLessThanOrEqual(2);
    }
  });
});

describe('CSRM worker — single-flight visible-build pipeline (A-C3)', () => {
  it('two concurrent getViewports share ONE build while the external-filter reply is held', async () => {
    const held: Array<{ callId: number; rowIds: string[] }> = [];
    const w = new FakeWorker();
    const client: WorkerClient = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      // HOLD the reply — capture the callId but do NOT answer, so
      // `buildVisibleAsync` stays suspended at the external-filter round-trip.
      onExternalFilterCandidates: (rowIds: string[], callId: number) => {
        held.push({ callId, rowIds: rowIds.slice() });
      },
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);

    // Turning the external filter on nulls visibleCache and starts the
    // pipeline; the candidates push is captured but unanswered, so the build
    // hangs mid-flight. Do NOT await it.
    const pFilter = client.setExternalFilterPresent(true);
    await flush();
    // Exactly one build is in flight → exactly one candidates push so far.
    expect(held.length).toBe(1);

    // Fire two concurrent getViewports while visibleCache is still null and
    // the build is suspended. With single-flight they await the SAME build;
    // the buggy check-then-set starts a fresh buildVisibleAsync each (each of
    // which posts its own candidates push).
    const gv1 = client.getViewport({ rowStart: 0, rowEnd: 4, columns: ['name', 'price'] });
    const gv2 = client.getViewport({ rowStart: 0, rowEnd: 4, columns: ['name', 'price'] });
    await flush();

    // Single-flight: buildVisibleAsync body ran ONCE — still one candidates
    // push. (Buggy: 1 + 2 = 3.)
    expect(held.length).toBe(1);

    // Release the held reply; all three awaiters resume off the one build.
    for (const h of held) client.externalFilterResult(h.callId, h.rowIds);
    const [r1, r2] = await Promise.all([gv1, gv2]);
    await pFilter;

    // Both concurrent readers observed the identical visible build.
    expect(Array.from(r1.chunk.rowIds)).toEqual(Array.from(r2.chunk.rowIds));
    expect(r1.chunk.rowCount).toBe(r2.chunk.rowCount);
    expect(r1.chunk.rowCount).toBe(4);
  });
});
