import { describe, it, expect, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import type { ServerSideRowModelV2Controller } from '../src/core/serverSideRowModelV2';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideGetRowsParams } from '../src/types/ssrm';

/**
 * B-L2 (production hardening) — SSRM v2 leaf-block eviction must propagate.
 *
 * Before the `ssrmEvict` message existed, `maxCachedLeafBlocks` trimmed ONLY
 * the controller's own `leafCaches`. The worker `RowStore` kept every
 * hydrated row (its orphan sweep in `ssrmHydrate` only collects rows that no
 * `ssrmOrder` slot references, and the evicted blocks' slots still pointed at
 * their ids), and the main-thread `rowDataById` mirror cleared only on a
 * reset hydrate. Net: a long-lived blotter carried the whole book twice
 * regardless of the cap.
 *
 * The harness drives a real `VelocityGrid` against a real `createWorkerHost`
 * so the assertion has to cross the whole wire — controller → host seam →
 * WorkerClient → protocol → worker handler → RowStore.
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

interface Row { id: string; v: number }

const BLOCK = 10;
const CAP = 8;
const BOOK = 130;

describe('B-L2 — SSRM v2 eviction propagates to the worker store and the main mirror', () => {
  it('scrolling the whole book keeps worker rows + rowDataById bounded by the LRU cap', async () => {
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    /** Last `count` (= worker `RowStore.size()`) any reply reported. */
    let lastWorkerRowCount = -1;
    const evictPosts: string[][] = [];

    (globalThis as { Worker: unknown }).Worker = class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      private listeners = new Set<(e: MessageEvent) => void>();
      private host = createWorkerHost((msg) => {
        const m = msg as { type?: string; count?: number };
        if (m.type === 'rowCount' && typeof m.count === 'number') lastWorkerRowCount = m.count;
        queueMicrotask(() => {
          const ev = { data: msg } as MessageEvent;
          this.onmessage?.(ev);
          for (const l of this.listeners) l(ev);
        });
      });
      postMessage(msg: unknown): void {
        const m = msg as { type?: string; payload?: { rowIds?: string[] } };
        if (m.type === 'ssrmEvict' && m.payload?.rowIds) evictPosts.push(m.payload.rowIds);
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

    const book: Row[] = Array.from({ length: BOOK }, (_, i) => ({ id: `r${i}`, v: i }));

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'id' }, { field: 'v' }],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      cacheBlockSize: BLOCK,
      serverSideMaxCachedLeafBlocks: CAP,
      serverSideDatasource: {
        getRows: ({ request, success }: IServerSideGetRowsParams<Row>) => {
          success({ rowData: book.slice(request.startRow, request.endRow), rowCount: book.length });
        },
      },
    } as never);

    await waitFor(() => grid.getDisplayedRowCount() === BOOK, 'row count settled');

    const ctrl = (grid as unknown as {
      ssrm: ServerSideRowModelV2Controller<Row> | null;
    }).ssrm;
    expect(ctrl).not.toBeNull();

    // Walk the whole book — 13 blocks against an 8-block cap, so 5 blocks
    // (50 rows) must be evicted.
    for (let b = 0; b * BLOCK < BOOK; b++) {
      await ctrl!.ensureRange(b * BLOCK, (b + 1) * BLOCK);
    }

    const mirror = (grid as unknown as { rowDataById: Map<string, Row> }).rowDataById;

    // The controller DID evict (guards against a vacuous pass if the cap
    // stopped being honoured).
    expect(evictPosts.length).toBeGreaterThan(0);
    const evictedIds = new Set(evictPosts.flat());
    expect(evictedIds.size).toBeGreaterThanOrEqual(BOOK - CAP * BLOCK);

    // Main mirror is bounded by the cap, not by the book.
    await waitFor(() => mirror.size <= CAP * BLOCK, `mirror bounded (was ${mirror.size})`);
    expect(mirror.size).toBeLessThan(BOOK);

    // …and so is the worker store. Pre-fix this stayed at 130.
    await waitFor(
      () => lastWorkerRowCount >= 0 && lastWorkerRowCount <= CAP * BLOCK,
      `worker store bounded (was ${lastWorkerRowCount})`,
    );
    expect(lastWorkerRowCount).toBeLessThan(BOOK);

    grid.destroy();
    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
  }, 20000);

  it('scrolling back to an evicted band refetches and re-hydrates it intact', async () => {
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
      postMessage(msg: unknown): void { this.host.handle(msg as WorkerRequest); }
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

    const book: Row[] = Array.from({ length: BOOK }, (_, i) => ({ id: `r${i}`, v: i }));
    const requestedStarts: number[] = [];

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [{ field: 'id' }, { field: 'v' }],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      cacheBlockSize: BLOCK,
      serverSideMaxCachedLeafBlocks: CAP,
      serverSideDatasource: {
        getRows: ({ request, success }: IServerSideGetRowsParams<Row>) => {
          requestedStarts.push(request.startRow);
          success({ rowData: book.slice(request.startRow, request.endRow), rowCount: book.length });
        },
      },
    } as never);

    await waitFor(() => grid.getDisplayedRowCount() === BOOK, 'row count settled');
    const ctrl = (grid as unknown as {
      ssrm: ServerSideRowModelV2Controller<Row> | null;
    }).ssrm;

    for (let b = 0; b * BLOCK < BOOK; b++) {
      await ctrl!.ensureRange(b * BLOCK, (b + 1) * BLOCK);
    }

    const mirror = (grid as unknown as { rowDataById: Map<string, Row> }).rowDataById;
    // Block 0 is the coldest — evicted, so gone from the mirror.
    await waitFor(() => !mirror.has('r0'), 'r0 evicted from the mirror');

    requestedStarts.length = 0;
    await ctrl!.ensureRange(0, BLOCK);
    // Refetched (self-healing) rather than left permanently blank.
    expect(requestedStarts).toContain(0);
    await waitFor(() => mirror.get('r0')?.v === 0, 'r0 re-hydrated with its real data');

    grid.destroy();
    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
  }, 20000);
});
