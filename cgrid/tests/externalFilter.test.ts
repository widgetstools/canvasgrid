/**
 * Cycle 7 / Task 8 — external filter round-trip protocol.
 *
 * `isExternalFilterPresent` activates the path; `doesExternalFilterPass`
 * is an app-provided per-row predicate run on main. The worker pushes
 * `externalFilterCandidates` (the post-quick-filter, post-column-filter
 * survivors) to main; main runs the predicate and posts back
 * `externalFilterResult { surviving }` for the same callId. Worker
 * resumes the pipeline with `surviving ∪ alwaysPass` as the visible set.
 *
 * `alwaysPassFilter(row): boolean` lets specific rows bypass every
 * filter — column, quick, AND external — per the catalog ("Allows
 * specific rows to bypass all filters unconditionally").
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

async function setupClient(handlers: Partial<Parameters<typeof WorkerClient.prototype['constructor']>[1]> = {}) {
  const w = new FakeWorker();
  const client = new WorkerClient(w as never, {
    onModelUpdated: vi.fn(),
    onAsyncTransactionsFlushed: vi.fn(),
    onError: vi.fn(),
    ...handlers,
  } as never);
  await client.init({ rowIdField: 'id', columns: COLUMNS });
  await client.setRowData(ROWS);
  return client;
}

describe('External filter — Cycle 7 / Task 8', () => {
  it('isExternalFilterPresent=false: candidates push never fires', async () => {
    const onCandidates = vi.fn();
    const client = await setupClient({ onExternalFilterCandidates: onCandidates });
    // Trigger a filter change — without registering external filter the
    // worker must NOT push candidates.
    await client.setFilterModel({});
    expect(onCandidates).not.toHaveBeenCalled();
  });

  it('isExternalFilterPresent=true: candidates push fires with all rowIds', async () => {
    const calls: string[][] = [];
    const w = new FakeWorker();
    const client: WorkerClient = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      onExternalFilterCandidates: (rowIds: string[], callId: number) => {
        calls.push(rowIds.slice());
        // Resolve immediately with everything to keep the pipeline moving.
        client.externalFilterResult(callId, rowIds);
      },
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);
    await client.setExternalFilterPresent(true);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(new Set(calls[calls.length - 1])).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('surviving rowIds returned by main become the visible set', async () => {
    const w = new FakeWorker();
    const client: WorkerClient = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      // Predicate keeps only 'a' and 'c'.
      onExternalFilterCandidates: (rowIds: string[], callId: number) => {
        const keep = rowIds.filter((id) => id === 'a' || id === 'c');
        client.externalFilterResult(callId, keep);
      },
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);
    const { visibleCount } = await client.setExternalFilterPresent(true);
    expect(visibleCount).toBe(2);
    expect(await client.getRowIndexForId('a')).toBe(0);
    expect(await client.getRowIndexForId('c')).toBe(1);
    expect(await client.getRowIndexForId('b')).toBe(-1);
    expect(await client.getRowIndexForId('d')).toBe(-1);
  });

  it('predicate runs once per candidate row per onFilterChanged trigger', async () => {
    let perRowCalls = 0;
    const w = new FakeWorker();
    const client: WorkerClient = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      onExternalFilterCandidates: (rowIds: string[], callId: number) => {
        perRowCalls += rowIds.length;
        client.externalFilterResult(callId, rowIds);
      },
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);
    await client.setExternalFilterPresent(true);
    const baseline = perRowCalls;
    await client.refilter();
    // One refilter triggers exactly one pass over the candidates.
    expect(perRowCalls).toBe(baseline + ROWS.length);
  });

  it('alwaysPassFilter row bypasses a non-matching column filter', async () => {
    const w = new FakeWorker();
    const client: WorkerClient = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);
    // Mark 'd' as always-pass.
    await client.setAlwaysPassRowIds(['d']);
    // Column filter excludes everything (name = 'never').
    await client.setFilterModel({
      name: { filterType: 'text', type: 'equals', filter: 'never' },
    });
    // Without external filter, alwaysPass row should still appear.
    expect(await client.getRowIndexForId('d')).toBe(0);
    // Others remain excluded.
    expect(await client.getRowIndexForId('a')).toBe(-1);
    expect(await client.getRowIndexForId('b')).toBe(-1);
  });

  it('alwaysPassFilter row also bypasses the external filter', async () => {
    const w = new FakeWorker();
    const client: WorkerClient = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      // Predicate rejects everything; alwaysPass should still surface.
      onExternalFilterCandidates: (_rowIds: string[], callId: number) => {
        client.externalFilterResult(callId, []);
      },
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);
    await client.setAlwaysPassRowIds(['b']);
    const { visibleCount } = await client.setExternalFilterPresent(true);
    expect(visibleCount).toBe(1);
    expect(await client.getRowIndexForId('b')).toBe(0);
  });

  it('candidates push excludes alwaysPass rows (they are added back unconditionally)', async () => {
    const seen: string[][] = [];
    const w = new FakeWorker();
    const client: WorkerClient = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      onExternalFilterCandidates: (rowIds: string[], callId: number) => {
        seen.push(rowIds.slice());
        client.externalFilterResult(callId, rowIds);
      },
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);
    await client.setAlwaysPassRowIds(['a', 'b']);
    await client.setExternalFilterPresent(true);
    const last = seen[seen.length - 1] ?? [];
    expect(last).not.toContain('a');
    expect(last).not.toContain('b');
    // The remaining candidates are the non-alwaysPass rows that survived
    // column + quick filter — i.e. c and d.
    expect(new Set(last)).toEqual(new Set(['c', 'd']));
  });

  it('refilter is a no-op for the candidates push when external filter is absent', async () => {
    const onCandidates = vi.fn();
    const client = await setupClient({ onExternalFilterCandidates: onCandidates });
    await client.refilter();
    expect(onCandidates).not.toHaveBeenCalled();
  });

  it('setExternalFilterPresent(false) tears down the round-trip', async () => {
    const seen: string[][] = [];
    const w = new FakeWorker();
    const client: WorkerClient = new WorkerClient(w as never, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      onExternalFilterCandidates: (rowIds: string[], callId: number) => {
        seen.push(rowIds.slice());
        client.externalFilterResult(callId, rowIds);
      },
    } as never);
    await client.init({ rowIdField: 'id', columns: COLUMNS });
    await client.setRowData(ROWS);
    await client.setExternalFilterPresent(true);
    const sawWhileOn = seen.length;
    expect(sawWhileOn).toBeGreaterThanOrEqual(1);
    await client.setExternalFilterPresent(false);
    await client.refilter();
    // No additional candidates pushes after turning external filter off.
    expect(seen.length).toBe(sawWhileOn);
  });
});
