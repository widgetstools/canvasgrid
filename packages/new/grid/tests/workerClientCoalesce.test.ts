import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerClient } from '../src/worker/client';

/**
 * Cycle 25 / Task 9 — worker-push coalescing.
 *
 * Multiple `modelUpdated` / `heightsChanged` pushes within the same
 * animation frame are collapsed before they hit the cgrid handlers, so
 * the grid repaints at most once per RAF instead of once per inbound
 * worker message. Request/response and callback messages that the
 * worker is awaiting (measureTextRequest, externalFilterCandidates,
 * postSortRowsRequest) MUST keep firing synchronously so the worker
 * doesn't stall.
 */

interface CapturedListener {
  cb: (e: { data: any }) => void;
}

function makeFakeWorker(captured: CapturedListener) {
  return {
    postMessage: vi.fn(),
    addEventListener: (_: string, cb: (e: { data: any }) => void) => {
      captured.cb = cb;
    },
    terminate: vi.fn(),
  } as any;
}

let rafQueue: Array<() => void> = [];
const realRAF = globalThis.requestAnimationFrame;

beforeEach(() => {
  rafQueue = [];
  (globalThis as any).requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRAF;
});

function flushFrame() {
  const q = rafQueue;
  rafQueue = [];
  for (const fn of q) fn();
}

describe('WorkerClient — push coalescing', () => {
  it('collapses N modelUpdated pushes in one frame into a single handler call (latest wins)', () => {
    const listener: CapturedListener = { cb: () => {} };
    const worker = makeFakeWorker(listener);
    const onModelUpdated = vi.fn();
    new WorkerClient(worker, {
      onModelUpdated,
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    });

    listener.cb({ data: { type: 'modelUpdated', visibleCount: 100 } });
    listener.cb({ data: { type: 'modelUpdated', visibleCount: 200 } });
    listener.cb({ data: { type: 'modelUpdated', visibleCount: 300, groupKeys: ['k'] } });

    expect(onModelUpdated).not.toHaveBeenCalled();
    flushFrame();
    expect(onModelUpdated).toHaveBeenCalledTimes(1);
    expect(onModelUpdated).toHaveBeenCalledWith(300, ['k'], undefined);
  });

  it('a seed-bearing expandedKeys survives a later seed-less push in the same frame', () => {
    const listener: CapturedListener = { cb: () => {} };
    const worker = makeFakeWorker(listener);
    const onModelUpdated = vi.fn();
    new WorkerClient(worker, {
      onModelUpdated,
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    });

    // First push carries the one-shot groupDefaultExpanded seed; a second
    // seed-less push in the same RAF window must not clobber it.
    listener.cb({ data: { type: 'modelUpdated', visibleCount: 100, expandedKeys: ['g1'] } });
    listener.cb({ data: { type: 'modelUpdated', visibleCount: 200 } });

    flushFrame();
    expect(onModelUpdated).toHaveBeenCalledTimes(1);
    expect(onModelUpdated).toHaveBeenCalledWith(200, undefined, ['g1']);
  });

  it('coalesces heightsChanged into a single dispatch per frame, preserving every range', () => {
    const listener: CapturedListener = { cb: () => {} };
    const worker = makeFakeWorker(listener);
    const onHeightsChanged = vi.fn();
    new WorkerClient(worker, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      onHeightsChanged,
    });

    const h1 = new Float32Array([30, 31, 32]);
    const h2 = new Float32Array([40, 41]);
    listener.cb({ data: { type: 'heightsChanged', rowStart: 0, heights: h1 } });
    listener.cb({ data: { type: 'heightsChanged', rowStart: 3, heights: h2 } });

    expect(onHeightsChanged).not.toHaveBeenCalled();
    flushFrame();
    expect(onHeightsChanged).toHaveBeenCalledTimes(2);
    expect(onHeightsChanged.mock.calls[0]).toEqual([0, h1]);
    expect(onHeightsChanged.mock.calls[1]).toEqual([3, h2]);
  });

  it('does NOT defer measureTextRequest — worker awaits a synchronous reply', () => {
    const listener: CapturedListener = { cb: () => {} };
    const worker = makeFakeWorker(listener);
    const onMeasureTextRequest = vi.fn();
    new WorkerClient(worker, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      onMeasureTextRequest,
    });

    listener.cb({ data: { type: 'measureTextRequest', batchId: 7, items: [] } });
    expect(onMeasureTextRequest).toHaveBeenCalledTimes(1);
    expect(onMeasureTextRequest).toHaveBeenCalledWith(7, []);
  });

  it('does NOT defer externalFilterCandidates / postSortRowsRequest', () => {
    const listener: CapturedListener = { cb: () => {} };
    const worker = makeFakeWorker(listener);
    const onExternalFilterCandidates = vi.fn();
    const onPostSortRowsCandidates = vi.fn();
    new WorkerClient(worker, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
      onExternalFilterCandidates,
      onPostSortRowsCandidates,
    });

    listener.cb({ data: { type: 'externalFilterCandidates', rowIds: ['a'], callId: 1 } });
    listener.cb({ data: { type: 'postSortRowsRequest', rowIds: ['b'], callId: 2 } });

    expect(onExternalFilterCandidates).toHaveBeenCalledWith(['a'], 1);
    expect(onPostSortRowsCandidates).toHaveBeenCalledWith(['b'], 2);
  });

  it('coalesces asyncTransactionsFlushed by concatenating result lists', () => {
    const listener: CapturedListener = { cb: () => {} };
    const worker = makeFakeWorker(listener);
    const onAsyncTransactionsFlushed = vi.fn();
    new WorkerClient(worker, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed,
      onError: vi.fn(),
    });

    listener.cb({ data: { type: 'asyncTransactionsFlushed', results: [{ add: ['a'] } as any] } });
    listener.cb({ data: { type: 'asyncTransactionsFlushed', results: [{ add: ['b'] } as any] } });

    expect(onAsyncTransactionsFlushed).not.toHaveBeenCalled();
    flushFrame();
    expect(onAsyncTransactionsFlushed).toHaveBeenCalledTimes(1);
    const args = onAsyncTransactionsFlushed.mock.calls[0]![0];
    expect(args).toHaveLength(2);
  });

  it('id-bearing responses still resolve synchronously (no RAF defer for requests)', async () => {
    const listener: CapturedListener = { cb: () => {} };
    const worker = makeFakeWorker(listener);
    const client = new WorkerClient(worker, {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    });
    const p = client.init({ rowIdField: 'id', columns: [] } as any);
    const sent = (worker.postMessage as any).mock.calls[0][0];
    listener.cb({ data: { id: sent.id, type: 'ready' } });
    await expect(p).resolves.toBeUndefined();
  });
});
