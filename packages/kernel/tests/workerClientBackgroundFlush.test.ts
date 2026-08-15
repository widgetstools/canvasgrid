import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerClient } from '../src/worker/client';

/**
 * A-L2 (production hardening) — worker-push coalescing must not stall when
 * `requestAnimationFrame` never fires.
 *
 * rAF is SUSPENDED while a tab is hidden/backgrounded. Scheduling the flush
 * on the frame alone meant `pendingTxnResults` / `pendingHeights` grew for as
 * long as the tab stayed in the background (hours, on a live blotter) and
 * then dispatched as one giant stale batch on refocus.
 *
 * Every test here installs a fake rAF that captures the callback and NEVER
 * invokes it — exactly the suspended-tab condition. If the flush still
 * happens, it can only have come from the wall-clock fallback.
 */

interface CapturedListener { cb: (e: { data: any }) => void }

function makeFakeWorker(captured: CapturedListener) {
  return {
    postMessage: vi.fn(),
    addEventListener: (_: string, cb: (e: { data: any }) => void) => { captured.cb = cb; },
    terminate: vi.fn(),
  } as any;
}

const realRAF = globalThis.requestAnimationFrame;
const realCancelRAF = globalThis.cancelAnimationFrame;
/** Frame callbacks handed to the suspended rAF — never invoked. */
let strandedFrames: Array<() => void> = [];
let cancelledFrames: number[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  strandedFrames = [];
  cancelledFrames = [];
  (globalThis as any).requestAnimationFrame = (cb: () => void) => {
    strandedFrames.push(cb);
    return strandedFrames.length;
  };
  (globalThis as any).cancelAnimationFrame = (h: number) => { cancelledFrames.push(h); };
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.requestAnimationFrame = realRAF;
  globalThis.cancelAnimationFrame = realCancelRAF;
  // Drop any visibilityState override a test installed.
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
}

describe('WorkerClient — background-tab push flush (A-L2)', () => {
  it('flushes modelUpdated on the wall-clock fallback when the frame never fires', () => {
    const listener: CapturedListener = { cb: () => {} };
    const onModelUpdated = vi.fn();
    new WorkerClient(makeFakeWorker(listener), {
      onModelUpdated,
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    });

    listener.cb({ data: { type: 'modelUpdated', visibleCount: 42 } });

    // The frame was requested and is now stranded — pre-fix, this was the
    // ONLY scheduled path and the push sat here indefinitely.
    expect(strandedFrames).toHaveLength(1);
    expect(onModelUpdated).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(onModelUpdated).toHaveBeenCalledTimes(1);
    expect(onModelUpdated).toHaveBeenCalledWith(42, undefined, undefined);
    // The losing frame handle was cancelled rather than left to double-fire.
    expect(cancelledFrames).toHaveLength(1);
  });

  it('flushes queued async transaction results and heights on the fallback too', () => {
    const listener: CapturedListener = { cb: () => {} };
    const onAsyncTransactionsFlushed = vi.fn();
    const onHeightsChanged = vi.fn();
    new WorkerClient(makeFakeWorker(listener), {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed,
      onError: vi.fn(),
      onHeightsChanged,
    });

    listener.cb({ data: { type: 'asyncTransactionsFlushed', results: [{ add: ['a'] } as any] } });
    listener.cb({ data: { type: 'asyncTransactionsFlushed', results: [{ add: ['b'] } as any] } });
    listener.cb({ data: { type: 'heightsChanged', rowStart: 0, heights: new Float32Array([30]) } });

    expect(onAsyncTransactionsFlushed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);

    expect(onAsyncTransactionsFlushed).toHaveBeenCalledTimes(1);
    expect(onAsyncTransactionsFlushed.mock.calls[0]![0]).toHaveLength(2);
    expect(onHeightsChanged).toHaveBeenCalledTimes(1);
  });

  it('does not keep growing the queue across fallback windows', () => {
    const listener: CapturedListener = { cb: () => {} };
    const onAsyncTransactionsFlushed = vi.fn();
    new WorkerClient(makeFakeWorker(listener), {
      onModelUpdated: vi.fn(),
      onAsyncTransactionsFlushed,
      onError: vi.fn(),
    });

    for (let i = 0; i < 3; i++) {
      listener.cb({ data: { type: 'asyncTransactionsFlushed', results: [{ add: [`a${i}`] } as any] } });
      vi.advanceTimersByTime(50);
    }

    // Three separate dispatches of one result each — not one 3-deep batch at
    // the end, and never an unbounded backlog.
    expect(onAsyncTransactionsFlushed).toHaveBeenCalledTimes(3);
    for (const call of onAsyncTransactionsFlushed.mock.calls) {
      expect(call[0]).toHaveLength(1);
    }
  });

  it('skips requestAnimationFrame entirely when the document is already hidden', () => {
    setVisibility('hidden');
    const listener: CapturedListener = { cb: () => {} };
    const onModelUpdated = vi.fn();
    new WorkerClient(makeFakeWorker(listener), {
      onModelUpdated,
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    });

    listener.cb({ data: { type: 'modelUpdated', visibleCount: 7 } });

    // No frame requested at all — parking a callback in a hidden tab is
    // pointless.
    expect(strandedFrames).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(onModelUpdated).toHaveBeenCalledWith(7, undefined, undefined);
    // Nothing to cancel, since no frame was ever registered.
    expect(cancelledFrames).toHaveLength(0);
  });

  it('a visible tab still requests a frame (the fallback is a floor, not a replacement)', () => {
    setVisibility('visible');
    const listener: CapturedListener = { cb: () => {} };
    const onModelUpdated = vi.fn();
    new WorkerClient(makeFakeWorker(listener), {
      onModelUpdated,
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    });

    listener.cb({ data: { type: 'modelUpdated', visibleCount: 5 } });
    expect(strandedFrames).toHaveLength(1);

    // Frame wins the race: dispatch happens without any timer advance…
    strandedFrames[0]!();
    expect(onModelUpdated).toHaveBeenCalledTimes(1);

    // …and the losing fallback timer was cleared, so it cannot double-fire.
    vi.advanceTimersByTime(200);
    expect(onModelUpdated).toHaveBeenCalledTimes(1);
  });

  it('destroy() cancels both the pending frame and the fallback timer', () => {
    const listener: CapturedListener = { cb: () => {} };
    const onModelUpdated = vi.fn();
    const client = new WorkerClient(makeFakeWorker(listener), {
      onModelUpdated,
      onAsyncTransactionsFlushed: vi.fn(),
      onError: vi.fn(),
    });

    listener.cb({ data: { type: 'modelUpdated', visibleCount: 99 } });
    client.destroy();

    vi.advanceTimersByTime(500);
    expect(onModelUpdated).not.toHaveBeenCalled();
    expect(cancelledFrames).toHaveLength(1);
  });
});
