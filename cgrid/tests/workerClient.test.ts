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
    const chunk = await client.getViewport({ rowStart: 0, rowEnd: 1, columns: ['name'] });
    expect(chunk.rowCount).toBe(1);
  });
});
