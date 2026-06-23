import { describe, it, expect, vi } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';

describe('worker host', () => {
  it('init + setRowData + getViewport returns a viewport response', () => {
    const sent: any[] = [];
    const host = createWorkerHost((msg, _xfer) => sent.push(msg));
    host.handle({ id: 1, type: 'init', payload: {
      rowIdField: 'id',
      columns: [
        { colId: 'name', field: 'name', type: 'text' },
        { colId: 'pri',  field: 'pri',  type: 'number' },
      ],
    }});
    host.handle({ id: 2, type: 'setRowData', payload: { rows: [
      { id: 'a', name: 'apple',  pri: 1 },
      { id: 'b', name: 'banana', pri: 2 },
    ] } });
    host.handle({ id: 3, type: 'getViewport', payload: {
      rowStart: 0, rowEnd: 2, columns: ['name', 'pri'],
    }});
    const viewport = sent.find((m) => m.type === 'viewport');
    expect(viewport).toBeDefined();
    expect(viewport.id).toBe(3);
    expect(viewport.chunk.rowCount).toBe(2);
  });

  it('applyTransaction async triggers asyncTransactionsFlushed push', async () => {
    vi.useFakeTimers();
    const sent: any[] = [];
    const host = createWorkerHost((msg) => sent.push(msg));
    host.handle({ id: 1, type: 'init', payload: {
      rowIdField: 'id',
      columns: [{ colId: 'name', field: 'name', type: 'text' }],
    } });
    host.handle({ id: 2, type: 'setRowData', payload: { rows: [{ id: 'a', name: 'x' }] } });
    host.handle({ id: 3, type: 'applyTransaction', payload: {
      update: [{ id: 'a', name: 'y' }],
      async: true,
    }});
    vi.advanceTimersByTime(60);
    const push = sent.find((m) => m.type === 'asyncTransactionsFlushed');
    expect(push).toBeDefined();
    vi.useRealTimers();
  });
});
