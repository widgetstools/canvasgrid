import { describe, it, expect, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideGetRowsParams } from '../src/types/ssrm';

/**
 * B-L3 — `destroy()` cleared `ssrmResortTimer` but never
 * `ssrmColumnRefillTimer` (the H-scroll column-window refill debounce,
 * `scheduleSsrmColumnRefill`). A destroy mid-debounce left the timer armed,
 * firing after teardown against a torn-down controller.
 */

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
  }
  HTMLCanvasElement.prototype.getContext = (() => ({
    scale() {}, save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, rect() {}, fill() {}, stroke() {},
    fillRect() {}, clearRect() {}, fillText() {}, drawImage() {},
    measureText: () => ({ width: 0 }),
    setTransform() {}, translate() {}, clip() {}, arc() {},
    canvas: { width: 1, height: 1 },
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

function waitFor(pred: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (pred()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out: ${label}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

interface Row {
  id: string;
}

describe('ssrmColumnRefillTimer — cleared on destroy', () => {
  it('a pending column-window refill debounce is cleared by destroy(), not left armed', async () => {
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker: unknown }).Worker = class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      private listeners = new Set<(e: MessageEvent) => void>();
      private host = createWorkerHost((msg) => {
        queueMicrotask(() => {
          const ev = { data: msg } as MessageEvent;
          this.onmessage?.(ev);
          for (const l of this.listeners) l(ev);
        });
      });
      postMessage(msg: unknown): void {
        this.host.handle(msg as WorkerRequest);
      }
      terminate(): void {}
      addEventListener(type: string, cb: (e: MessageEvent) => void): void {
        if (type === 'message') this.listeners.add(cb);
      }
      removeEventListener(_type: string, cb: (e: MessageEvent) => void): void {
        this.listeners.delete(cb);
      }
    };

    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const book: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}` }));

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'id' }],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      serverSideDatasource: {
        getRows: ({ request, success }: IServerSideGetRowsParams<Row>) => {
          const rowData = book.slice(request.startRow, request.endRow);
          success({ rowData, rowCount: book.length });
        },
      },
    } as never);

    await waitFor(() => grid.getDisplayedRowCount() === book.length, 'row count settled');

    // `setSsrmClientWatchedColumns` both flips `isSsrmColumnWindowingActive()`
    // on and calls `scheduleSsrmColumnRefill()` — arming the debounce timer
    // under test, through the same public entry point rules/format watchers
    // use, no private-method reflection needed to TRIGGER it.
    grid.setSsrmClientWatchedColumns(['id']);

    const internals = grid as unknown as {
      ssrmColumnRefillTimer: ReturnType<typeof setTimeout> | null;
    };
    expect(internals.ssrmColumnRefillTimer).not.toBeNull();

    grid.destroy();
    expect(internals.ssrmColumnRefillTimer).toBeNull();

    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
  }, 15000);
});
