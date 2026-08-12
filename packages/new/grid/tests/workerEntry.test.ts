import { describe, it, expect, vi } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';

/** Cycle 7 / Task 8 — the worker dispatcher is async-fire-and-forget so
 *  the request handler can await the external-filter round-trip. The
 *  synchronous request types here still resolve in a microtask, so each
 *  test awaits a single `Promise.resolve()` per `host.handle` call to
 *  drain pending microtasks before reading `sent`. */
const flushMicrotasks = () => Promise.resolve();

describe('worker host', () => {
  it('init + setRowData + getViewport returns a viewport response', async () => {
    const sent: any[] = [];
    const host = createWorkerHost((msg, _xfer) => sent.push(msg));
    host.handle({ id: 1, type: 'init', payload: {
      rowIdField: 'id',
      columns: [
        { colId: 'name', field: 'name', type: 'text' },
        { colId: 'pri',  field: 'pri',  type: 'number' },
      ],
    }});
    await flushMicrotasks();
    host.handle({ id: 2, type: 'setRowData', payload: { rows: [
      { id: 'a', name: 'apple',  pri: 1 },
      { id: 'b', name: 'banana', pri: 2 },
    ] } });
    await flushMicrotasks();
    host.handle({ id: 3, type: 'getViewport', payload: {
      rowStart: 0, rowEnd: 2, columns: ['name', 'pri'],
    }});
    await flushMicrotasks();
    const viewport = sent.find((m) => m.type === 'viewport');
    expect(viewport).toBeDefined();
    expect(viewport.id).toBe(3);
    expect(viewport.chunk.rowCount).toBe(2);
  });

  it('getViewport includes totals when aggFunc columns are defined', async () => {
    const sent: any[] = [];
    const host = createWorkerHost((msg, _xfer) => sent.push(msg));
    host.handle({ id: 1, type: 'init', payload: {
      rowIdField: 'id',
      columns: [
        { colId: 'name', field: 'name', type: 'text' },
        { colId: 'val',  field: 'val',  type: 'number', aggFunc: 'sum' },
      ],
    }});
    await flushMicrotasks();
    host.handle({ id: 2, type: 'setRowData', payload: { rows: [
      { id: 'a', name: 'alpha', val: 10 },
      { id: 'b', name: 'beta',  val: 20 },
      { id: 'c', name: 'gamma', val: 30 },
    ] } });
    await flushMicrotasks();
    host.handle({ id: 3, type: 'getViewport', payload: {
      rowStart: 0, rowEnd: 3, columns: ['name', 'val'],
    }});
    await flushMicrotasks();
    const viewport = sent.find((m) => m.type === 'viewport');
    expect(viewport).toBeDefined();
    expect(viewport.chunk.totals).toBeDefined();
    expect(viewport.chunk.totals.val).toBe(60); // sum of 10+20+30
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
