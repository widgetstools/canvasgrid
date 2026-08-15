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

// Task 2 (production-hardening / A-C1) — grouped-index endpoints must
// speak the GROUP-VISIBLE index vocabulary (group-header rows occupy a
// slot; leaves inside a collapsed group are excluded), not the flat leaf
// array. Fixture: 2 desks, APAC (3 rows) collapsed, EMEA (2 rows)
// expanded. Group-visible order is:
//   [0] group header "APAC" (collapsed)
//   [1] group header "EMEA"
//   [2] id4 (EMEA row 1)
//   [3] id5 (EMEA row 2)
// The flat leaf array is [id1, id2, id3, id4, id5] — id4's flat index
// (3) differs from its group-visible index (2), which is exactly the
// offset a still-flat-indexing endpoint gets wrong.
async function buildGroupedClient() {
  const w = new FakeWorker();
  const client = new WorkerClient(w as any, {
    onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
  });
  await client.init({
    rowIdField: 'id',
    columns: [
      { colId: 'id', field: 'id', type: 'text' },
      { colId: 'desk', field: 'desk', type: 'text' },
      { colId: 'note', field: 'note', type: 'text' },
    ],
  });
  await client.setRowData([
    { id: 'id1', desk: 'APAC', note: 'a' },
    { id: 'id2', desk: 'APAC', note: 'bb' },
    { id: 'id3', desk: 'APAC', note: 'LONGLONGLONGLONGLONGLONGLONG' },
    { id: 'id4', desk: 'EMEA', note: 'cc' },
    { id: 'id5', desk: 'EMEA', note: 'ddd' },
  ]);
  await client.setGroupModel({ rowGroupCols: ['desk'] });
  await client.setExpandedKeys(['desk:EMEA']); // APAC collapsed, EMEA expanded.
  return client;
}

describe('WorkerClient — grouped index resolution (A-C1)', () => {
  it('getRowIndexForId returns the group-visible index, not the flat leaf index', async () => {
    const client = await buildGroupedClient();
    // id4's flat leaf index is 3; its group-visible index (behind 2
    // group headers, with the 3 collapsed APAC leaves excluded) is 2.
    expect(await client.getRowIndexForId('id4')).toBe(2);
    expect(await client.getRowIndexForId('id5')).toBe(3);
  });

  it('getRowIndexForId returns -1 for a row hidden inside a collapsed group', async () => {
    const client = await buildGroupedClient();
    expect(await client.getRowIndexForId('id1')).toBe(-1);
    expect(await client.getRowIndexForId('id2')).toBe(-1);
    expect(await client.getRowIndexForId('id3')).toBe(-1);
  });

  it('getRowByIndex on a visible index after a group header returns that row, not the flat-offset row', async () => {
    const client = await buildGroupedClient();
    // Group-visible index 2 is id4. The flat-array bug would have
    // returned id3 (ids[2] in the unfiltered leaf array) instead.
    const row2 = await client.getRowByIndex(2);
    expect(row2.rowId).toBe('id4');
    expect((row2.data as any)?.note).toBe('cc');

    const row3 = await client.getRowByIndex(3);
    expect(row3.rowId).toBe('id5');
    expect((row3.data as any)?.note).toBe('ddd');
  });

  it('getRowByIndex on a group-header index returns the not-found shape', async () => {
    const client = await buildGroupedClient();
    expect(await client.getRowByIndex(0)).toEqual({ rowId: null, data: null });
    expect(await client.getRowByIndex(1)).toEqual({ rowId: null, data: null });
  });

  it('getRowIndicesForIds keeps resolving group-visible indices after the resolver refactor', async () => {
    const client = await buildGroupedClient();
    const out = await client.getRowIndicesForIds(['id4', 'id5', 'id1', 'unknown']);
    expect(Array.from(out)).toEqual([2, 3, -1, -1]);
  });

  it('autosize measures only group-visible rows — a value hidden inside a collapsed group must not win the max width', async () => {
    const client = await buildGroupedClient();
    // Fallback measurer (no OffscreenCanvas in the test env) is
    // `text.length * 7`. With the flat-array bug, `textOf` walks the
    // full 5-row flat leaf array (including the collapsed APAC rows)
    // and id3's 29-char note wins: width = 29*7 = 203. Fixed, only the
    // 4 group-visible slots are sampled (2 empty group headers + id4
    // "cc" + id5 "ddd") — the widest is id5's 3 chars: width = 3*7 = 21.
    const widths = await client.autosizeColumns(
      [{ colId: 'note', headerName: 'Note', font: '10px sans', padding: 0, minWidth: 0, maxWidth: 1000 }],
      /* skipHeader */ true,
    );
    expect(widths.note).toBe(21);
  });
});
