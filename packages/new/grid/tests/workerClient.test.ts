import { describe, it, expect, vi } from 'vitest';
import { WorkerClient } from '../src/worker/client';
import { createWorkerHost } from '../src/worker/worker';

class FakeWorker {
  private listeners: Array<(e: { data: any }) => void> = [];
  host = createWorkerHost((msg) => {
    queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
  });
  postMessage(msg: any) { this.host.handle(msg); }
  addEventListener(_t: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
  terminate() {}
}

describe('WorkerClient', () => {
  it('init -> setRowData -> getViewport round trip', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as any, {
      onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
    });
    await client.init({
      rowIdField: 'id',
      columns: [
        { colId: 'name', field: 'name', type: 'text' },
        { colId: 'pri',  field: 'pri',  type: 'number' },
      ],
    });
    const rc = await client.setRowData([{ id: 'a', name: 'apple', pri: 1 }]);
    expect(rc.visibleCount).toBe(1);
    const { chunk } = await client.getViewport({ rowStart: 0, rowEnd: 1, columns: ['name'] });
    expect(chunk.rowCount).toBe(1);
  });

  it('getRowIndexForId resolves the visible-order index of the given rowId', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as any, {
      onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
    });
    await client.init({
      rowIdField: 'id',
      columns: [
        { colId: 'id',  field: 'id',  type: 'text' },
        { colId: 'pri', field: 'pri', type: 'number' },
      ],
    });
    await client.setRowData([
      { id: 'a', pri: 1 },
      { id: 'b', pri: 2 },
      { id: 'c', pri: 3 },
    ]);
    expect(await client.getRowIndexForId('a')).toBe(0);
    expect(await client.getRowIndexForId('b')).toBe(1);
    expect(await client.getRowIndexForId('c')).toBe(2);
  });

  it('getRowIndexForId returns -1 for unknown rowIds', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as any, {
      onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
    });
    await client.init({
      rowIdField: 'id',
      columns: [{ colId: 'id', field: 'id', type: 'text' }],
    });
    await client.setRowData([{ id: 'a' }]);
    expect(await client.getRowIndexForId('does-not-exist')).toBe(-1);
  });

  it('getRowIndexForId reflects sort order, not insertion order', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as any, {
      onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
    });
    await client.init({
      rowIdField: 'id',
      columns: [
        { colId: 'id',  field: 'id',  type: 'text' },
        { colId: 'pri', field: 'pri', type: 'number' },
      ],
    });
    await client.setRowData([
      { id: 'a', pri: 3 },
      { id: 'b', pri: 1 },
      { id: 'c', pri: 2 },
    ]);
    await client.setSortModel([{ colId: 'pri', direction: 'asc' }]);
    // After asc sort by pri: b (1), c (2), a (3).
    expect(await client.getRowIndexForId('b')).toBe(0);
    expect(await client.getRowIndexForId('c')).toBe(1);
    expect(await client.getRowIndexForId('a')).toBe(2);
  });

  it('getRowIndicesForIds resolves a batch of rowIds in one round trip', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as any, {
      onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
    });
    await client.init({
      rowIdField: 'id',
      columns: [
        { colId: 'id',  field: 'id',  type: 'text' },
        { colId: 'pri', field: 'pri', type: 'number' },
      ],
    });
    await client.setRowData([
      { id: 'a', pri: 1 },
      { id: 'b', pri: 2 },
      { id: 'c', pri: 3 },
    ]);
    const out = await client.getRowIndicesForIds(['c', 'unknown', 'a']);
    expect(Array.from(out)).toEqual([2, -1, 0]);
  });

  it('getRowIndicesForIds returns an empty Int32Array for an empty input', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as any, {
      onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
    });
    await client.init({
      rowIdField: 'id',
      columns: [{ colId: 'id', field: 'id', type: 'text' }],
    });
    await client.setRowData([{ id: 'a' }]);
    const out = await client.getRowIndicesForIds([]);
    expect(out.length).toBe(0);
  });

  it('getRowIndexForId returns -1 for rows filtered out of the visible model', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as any, {
      onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
    });
    await client.init({
      rowIdField: 'id',
      columns: [
        { colId: 'id',  field: 'id',  type: 'text', filter: 'text' },
        { colId: 'pri', field: 'pri', type: 'number' },
      ],
    });
    await client.setRowData([
      { id: 'aaa', pri: 1 },
      { id: 'bbb', pri: 2 },
    ]);
    await client.setFilterModel({ id: { type: 'text', op: 'contains', value: 'aaa' } });
    expect(await client.getRowIndexForId('aaa')).toBe(0);
    expect(await client.getRowIndexForId('bbb')).toBe(-1);
  });
});
