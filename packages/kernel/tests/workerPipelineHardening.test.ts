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
 *
 * A-C4: invalidateAndCount coalesces under burst load. A plain serial lock
 *       chained one full pipeline rebuild per async-txn flush; under a live
 *       feed that starved setSortModel (main sortModel updated, rows never
 *       reordered). At most one in-flight rebuild + one trailing coalesced
 *       rebuild may run for N callers.
 *
 * Final review — `ssrmEvict` cache invalidation under the client pipeline:
 *       under sparse SSRM, `visibleCache` IS `state.ssrmOrder` (same array,
 *       mutated in place by `ssrmEvict`), so no separate invalidation is
 *       needed. Once `ssrmSetClientPipeline(true)` is on, `visibleCache` is
 *       a SEPARATELY computed CSRM-derived array that `ssrmEvict` does not
 *       touch — left uninvalidated, it keeps referencing ids the store no
 *       longer holds after an eviction.
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

describe('ssrmEvict invalidates the CSRM-derived visibleCache under the client pipeline', () => {
  it('an evicted row disappears from the NEXT viewport fetch once the client pipeline is on', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });

    // Seed a sparse-SSRM book directly (bypassing the controller — this is
    // a worker-protocol-level test) and turn on the client pipeline, so
    // `visibleCache` becomes the separately-computed CSRM-derived array
    // this fix targets rather than the aliased `ssrmOrder`.
    await client.ssrmHydrate({ rowCount: ROWS.length, startRow: 0, rows: ROWS, reset: true });
    await client.ssrmSetClientPipeline(true);

    // Populate visibleCache with all 4 rows (`getRowIndexForId` resolves
    // through the same `visibleAsync()` cache `getViewport` does —
    // `chunk.rowIds` is a `Uint32Array` of hashed numeric ids, not the
    // original string ids, so this is the string-id-facing way to probe
    // cache membership).
    await client.getViewport({ rowStart: 0, rowEnd: 4, columns: ['name', 'price'] });
    expect(await client.getRowIndexForId('b')).toBe(1);

    // Evict a row the LRU dropped — under the client pipeline this must
    // invalidate visibleCache, not just the store.
    await client.ssrmEvict(['b']);

    // The evicted id must be gone from the NEXT resolve. Pre-fix, the
    // stale cached array (still containing 'b') short-circuits the
    // rebuild and 'b' keeps resolving to an index with no backing row
    // data — a blank row on the next repaint, and AggPass totals silently
    // excluding it while rowCount still counted it.
    expect(await client.getRowIndexForId('b')).toBe(-1);
    const after = await client.getViewport({ rowStart: 0, rowEnd: 3, columns: ['name', 'price'] });
    expect(after.chunk.rowCount).toBe(3);
  });

  it('under the SPARSE path (client pipeline off), ssrmEvict needs no separate invalidation — ssrmOrder IS visibleCache', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.ssrmHydrate({ rowCount: ROWS.length, startRow: 0, rows: ROWS, reset: true });

    await client.getViewport({ rowStart: 0, rowEnd: 4, columns: ['name', 'price'] });
    expect(await client.getRowIndexForId('b')).toBe(1);

    await client.ssrmEvict(['b']);

    // ssrmEvict resets the evicted slot to '' in ssrmOrder directly (the
    // same array visibleCache aliases) — the next resolve reflects it
    // without needing an explicit cache null.
    expect(await client.getRowIndexForId('b')).toBe(-1);
  });
});

describe('invalidateAndCount coalesces under burst load (A-C4)', () => {
  it('rapid setSortModel calls resolve without chaining one rebuild per call', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);

    // Fire a burst of sort-model swaps the way a live feed + header
    // clicks do. Pre-coalesce, each call waited for the previous full
    // pipeline rebuild; under load that starved later sorts. All must
    // resolve, and the final visible order must match the last model.
    const burst = [
      client.setSortModel([{ colId: 'name', direction: 'asc' }]),
      client.setSortModel([{ colId: 'name', direction: 'desc' }]),
      client.setSortModel([{ colId: 'price', direction: 'asc' }]),
      client.setSortModel([{ colId: 'price', direction: 'desc' }]),
      client.setSortModel([{ colId: 'name', direction: 'asc' }]),
    ];
    await Promise.all(burst);
    await flush();

    // Final model is name asc → apple, banana, cherry, durian.
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      const row = await client.getRowByIndex(i);
      names.push((row.data as Row | null)?.name ?? '');
    }
    expect(names).toEqual(['apple', 'banana', 'cherry', 'durian']);
  });
});

describe('setGroupModel / setSortModel / setFilterModel wait for an in-flight build (critical review remediation)', () => {
  it('a setGroupModel call arriving mid-flight does not leak into the build that was already suspended', async () => {
    // Hold only the FIRST external-filter round-trip (the one build A
    // suspends on); auto-answer every later one immediately (unfiltered)
    // so the rebuilds setGroupModel triggers afterward — externalFilter
    // stays on for the rest of the test — don't hang the test itself.
    let heldCallId: number | null = null;
    let heldRowIds: string[] = [];
    let client!: WorkerClient;
    const w = new FakeWorker();
    client = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      onExternalFilterCandidates: (rowIds: string[], callId: number) => {
        if (heldCallId === null) {
          heldCallId = callId;
          heldRowIds = rowIds.slice();
          return;
        }
        client.externalFilterResult(callId, rowIds);
      },
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS); // 4 rows, ungrouped

    // Build A: turn external filter on. This nulls visibleCache and starts
    // buildVisibleAsync, which suspends at the (held) external-filter
    // round-trip BEFORE it ever reads state.group. Do not await yet.
    const pFilter = client.setExternalFilterPresent(true);
    await flush();
    expect(heldCallId).not.toBeNull();

    // While build A is suspended, request grouping by `name` (4 distinct
    // values). Pre-fix, `setGroupModel` mutated `state.group` immediately
    // — build A would then resume and read the NEW group model even
    // though it started (and already fixed its filtered candidate set)
    // before the group model changed. Do not await yet.
    const pGroup = client.setGroupModel({ rowGroupCols: ['name'] });
    await flush();

    // Release build A's held reply — all 4 rows survive the (no-op)
    // external filter.
    client.externalFilterResult(heldCallId!, heldRowIds);

    const filterResult = await pFilter;
    // Build A must reflect state as of when IT started: ungrouped, 4 leaf
    // rows. Pre-fix this leaked the grouped tree that arrived mid-flight,
    // reporting a grouped count (8: 4 groups + 4 leaves) instead.
    expect(filterResult.visibleCount).toBe(4);

    const groupResult = await pGroup;
    // The group model is NOT lost — it applies cleanly once build A
    // (which it correctly waited out) has fully settled.
    expect(groupResult.visibleCount).toBe(8); // 4 groups + 4 leaves, default all-expanded
    expect(groupResult.groupKeys.length).toBe(4);
  });
});
