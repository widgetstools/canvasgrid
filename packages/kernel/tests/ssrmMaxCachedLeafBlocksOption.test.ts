import { describe, it, expect, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import type { ServerSideRowModelV2Controller } from '../src/core/serverSideRowModelV2';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideGetRowsParams } from '../src/types/ssrm';

/**
 * fix-wave-4 Q8 — `serverSideMaxCachedLeafBlocks` (GridOptions) → controller
 * wiring had no test: the eviction mechanics (`ssrmUnknownRowCount.test.ts`)
 * are proven against a `ServerSideRowModelV2Controller` constructed
 * directly, bypassing `VelocityGrid`'s `this.options.serverSideMaxCachedLeafBlocks`
 * → constructor-opts plumbing (`velocityGrid.ts` `mountSsrmController`)
 * entirely. This drives a real `VelocityGrid` end to end so the option
 * actually has to cross that wire to make the assertion pass.
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

const BLOCK = 10;

describe('serverSideMaxCachedLeafBlocks — GridOptions reaches the mounted controller', () => {
  it('a below-500 cap configured on the grid bounds the mounted controller\'s cache', async () => {
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

    const book: Row[] = Array.from({ length: 130 }, (_, i) => ({ id: `r${i}` }));
    const requests: number[] = [];

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'id' }],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      cacheBlockSize: BLOCK,
      // Below the controller's floor of 8 on purpose — GridOptions' own
      // clamp-and-warn (Q8) is covered separately in
      // ssrmUnknownRowCount.test.ts; this test only cares that the grid
      // actually forwards SOME below-500-default cap to the controller.
      serverSideMaxCachedLeafBlocks: 8,
      serverSideDatasource: {
        getRows: ({ request, success }: IServerSideGetRowsParams<Row>) => {
          requests.push(request.startRow);
          const rowData = book.slice(request.startRow, request.endRow);
          success({ rowData, rowCount: book.length });
        },
      },
    } as never);

    await waitFor(() => grid.getDisplayedRowCount() === book.length, 'row count settled');

    const ctrl = (grid as unknown as {
      ssrm: ServerSideRowModelV2Controller<Row> | null;
    }).ssrm;
    expect(ctrl).not.toBeNull();

    // Touch all 13 blocks so the cache exceeds an 8-block cap.
    for (let b = 0; b < 13; b++) {
      await ctrl!.ensureRange(b * BLOCK, (b + 1) * BLOCK);
    }

    // Had the default (500) landed instead of the configured 8, nothing
    // would have been evicted and this would refetch nothing.
    requests.length = 0;
    await ctrl!.ensureRange(0, BLOCK);
    expect(requests).toEqual([0]);

    grid.destroy();
    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
  }, 15000);
});
