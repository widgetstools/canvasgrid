import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerClient, type WorkerLike } from '../src/worker/client';

/**
 * A-L1 — worker errors were completely silent: `WorkerClientHandlers.onError`
 * was dead wiring (never invoked) and no `error`/`messageerror` listener was
 * ever registered on the underlying Worker. This file locks down the fix:
 *
 *  - construction wires up loud-failure hooks,
 *  - a genuine 'error'/'messageerror' event funnels into `handlers.onError`
 *    AND rejects every in-flight request,
 *  - `destroy()`'s bulk-reject of in-flight requests never surfaces as a
 *    Node `unhandledRejection` even when the caller hasn't (yet) attached
 *    its own `.catch`,
 *  - an `init()` call that never gets a `ready` reply back trips a 10s
 *    watchdog that reports through the same `onError` channel.
 *
 * Deliberately does NOT use `worker.addEventListener('error' | 'messageerror',
 * ...)` — the ~90 existing kernel test files' `FakeWorker` doubles all route
 * every `addEventListener` registration through ONE shared 'message'-shaped
 * dispatch array (`this.listeners.forEach((cb) => cb({ data: msg }))`),
 * because they only ever emulate the 'message' channel. Registering the new
 * hooks that way would make WorkerClient's error handler fire on every
 * ordinary worker reply across the whole suite, spuriously rejecting
 * in-flight requests. `WorkerClient` therefore wires `onerror` /
 * `onmessageerror` as PROPERTY assignments — the same `AbstractWorker` /
 * `Worker` IDL attributes real Web Workers support natively — which the
 * legacy mocks simply never read, so they stay inert there while still
 * firing correctly on a real (or, here, a purpose-built) Worker double.
 */

class StubWorker implements WorkerLike {
  messageListeners: Array<(e: { data: unknown }) => void> = [];
  removedMessageListeners: Array<(e: { data: unknown }) => void> = [];
  posted: unknown[] = [];
  terminated = false;
  onerror: ((e: { message?: string; error?: unknown }) => void) | null = null;
  onmessageerror: ((e: { data?: unknown }) => void) | null = null;

  addEventListener(_type: 'message', cb: (e: { data: unknown }) => void): void {
    this.messageListeners.push(cb);
  }
  removeEventListener(_type: 'message', cb: (e: { data: unknown }) => void): void {
    this.removedMessageListeners.push(cb);
    this.messageListeners = this.messageListeners.filter((l) => l !== cb);
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function makeHandlers() {
  return {
    onModelUpdated: vi.fn(),
    onAsyncTransactionsFlushed: vi.fn(),
    onError: vi.fn(),
  };
}

describe('WorkerClient — loud failures (A-L1)', () => {
  it('registers onerror/onmessageerror hooks on construction', () => {
    const worker = new StubWorker();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const client = new WorkerClient(worker, makeHandlers());
    expect(typeof worker.onerror).toBe('function');
    expect(typeof worker.onmessageerror).toBe('function');
    // The pre-existing message channel is untouched.
    expect(worker.messageListeners).toHaveLength(1);
  });

  it('a genuine "error" event funnels into handlers.onError and rejects every pending request', async () => {
    const worker = new StubWorker();
    const handlers = makeHandlers();
    const client = new WorkerClient(worker, handlers);

    const p1 = client.setSortModel([{ colId: 'x', direction: 'asc' }]);
    const p2 = client.setFilterModel({});
    // Attach rejection handlers up front so this test's own assertions are
    // the thing observing the rejection (kept separate from the
    // unhandledRejection guard in the next test).
    const p1Result = expect(p1).rejects.toThrow(/VelocityGrid worker/);
    const p2Result = expect(p2).rejects.toThrow(/VelocityGrid worker/);

    expect(worker.onerror).not.toBeNull();
    worker.onerror!({ message: 'boom: worker script threw during startup' });

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    const [err, context] = handlers.onError.mock.calls[0]!;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('boom');
    expect(context).toBe('error');

    await p1Result;
    await p2Result;
  });

  it('a genuine "messageerror" event funnels into handlers.onError and rejects every pending request', async () => {
    const worker = new StubWorker();
    const handlers = makeHandlers();
    const client = new WorkerClient(worker, handlers);

    const p = client.setSortModel([]);
    const pResult = expect(p).rejects.toThrow();

    expect(worker.onmessageerror).not.toBeNull();
    worker.onmessageerror!({ data: null });

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    const [err, context] = handlers.onError.mock.calls[0]!;
    expect(err).toBeInstanceOf(Error);
    expect(context).toBe('messageerror');

    await pResult;
  });

  it('destroy() rejects in-flight requests without an unhandledRejection, even when the caller has not yet attached a handler', async () => {
    const worker = new StubWorker();
    const client = new WorkerClient(worker, makeHandlers());

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Fire a request but do NOT attach .then/.catch before destroy() runs
      // synchronously right after — this is the exact shape of the
      // production bug (VelocityGridExt.destroy() -> workerCoord.destroy()
      // -> client.destroy() rejecting a request nobody was still awaiting).
      const inflight = client.setSortModel([{ colId: 'x', direction: 'asc' }]);
      client.destroy();
      // Give the microtask queue (and Node's unhandledRejection check,
      // which runs on a subsequent microtask checkpoint) a full turn.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toHaveLength(0);
      // The promise still genuinely rejects for a caller who DOES attach
      // a handler later — the fix must not swallow the rejection.
      await expect(inflight).rejects.toThrow(/worker terminated/);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('destroy() is idempotent and tears down the onerror/onmessageerror hooks', () => {
    const worker = new StubWorker();
    const client = new WorkerClient(worker, makeHandlers());
    client.destroy();
    expect(worker.terminated).toBe(true);
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(worker.messageListeners).toHaveLength(0);
    expect(() => client.destroy()).not.toThrow();
  });
});

describe('WorkerClient — init() watchdog (A-L1, init-timeout)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a loud init-timeout error via handlers.onError if init never replies within 10s', async () => {
    const worker = new StubWorker(); // never replies — simulates a wedged / CSP-blocked worker
    const handlers = makeHandlers();
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const client = new WorkerClient(worker, handlers);

    void client.init({ rowIdField: 'id', columns: [{ colId: 'id', field: 'id', type: 'text' }] });
    expect(handlers.onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    const [err, context] = handlers.onError.mock.calls[0]!;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/initialize/i);
    expect(context).toBe('init-timeout');
    expect(consoleErr).toHaveBeenCalled();

    consoleErr.mockRestore();
  });

  it('does not fire the watchdog when init resolves before 10s', async () => {
    const worker = new StubWorker();
    const handlers = makeHandlers();
    const client = new WorkerClient(worker, handlers);

    const initPromise = client.init({ rowIdField: 'id', columns: [{ colId: 'id', field: 'id', type: 'text' }] });
    // Reply as the worker would: echo back the posted `init` request's id.
    const req = worker.posted[0] as { id: number };
    worker.messageListeners.forEach((cb) => cb({ data: { id: req.id, type: 'ready' } }));
    await initPromise;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(handlers.onError).not.toHaveBeenCalled();
  });
});
