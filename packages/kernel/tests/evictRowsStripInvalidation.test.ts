import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import type { ServerSideRowModelV2Controller } from '../src/core/serverSideRowModelV2';
import type { RowStripCache } from '../src/renderer/rasterCache';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideGetRowsParams } from '../src/types/ssrm';

/**
 * Fix wave 6 (MEDIUM) — `evictRows` (velocityGrid.ts, the `SsrmHostV2`
 * seam) deleted a row's `rowVersionByRowId` entry on SSRM leaf-block
 * eviction WITHOUT invalidating its retained Tier-2 strip
 * (`RowStripCache`). Every other clear site in `velocityGrid.ts` pairs the
 * two — see the block comment at the `resolveWindowDamage === 'full'`
 * branch ("wipe the store and the version map together … a stale strip is
 * a bug") and `resetRasterCache`. `RowStripCache.get` is an exact
 * `(rowId, version, layoutEpoch)` match keyed only by `rowId`, so an
 * unpaired delete leaves a stale strip that can be hit again if the
 * version-bump sequence (hydrate + repaintRows) replays identically after
 * a refetch — the likely case, not an exotic one.
 *
 * A full pixel-level "does the repainted row actually show old pixels"
 * assertion isn't tractable here: the fake canvas contexts these kernel
 * unit tests use are recorded-call stubs, not real 2D rasterizers, and
 * `RowStripCache`'s `SurfacePool` can recycle the same canvas object
 * across an evict + fresh-capture cycle, so object identity can't
 * distinguish "stale" from "freshly recaptured" either. Per the review
 * finding, a cache-level assertion is the accepted fallback: this test
 * drives the REAL production call path (a real SSRM controller evicting a
 * real leaf block through the real `evictRows` host hook, with a real
 * paint tick capturing the strip beforehand) and asserts the strip is
 * gone immediately after eviction — the pairing invariant itself, not a
 * synthetic call to `invalidateRow`.
 *
 * Fails pre-fix (the strip survives the eviction); passes post-fix.
 */

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
  }
  // Same WeakMap-per-canvas idiom as rasterCacheStrips.test.ts's
  // buildWiredGrid — a real canvas.getContext() returns the SAME context
  // object on repeat calls, and the strip-capture path relies on that
  // (drawImage reads from a layer canvas obtained earlier).
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx = {
      scale() {}, save() {}, restore() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, arcTo() {}, rect() {}, fill() {}, stroke() {},
      fillRect() {}, strokeRect() {}, clearRect() {}, fillText() {}, drawImage() {},
      measureText: () => ({ width: 6 }),
      setTransform() {}, translate() {}, clip() {}, arc() {},
      createLinearGradient: () => ({ addColorStop() { /* noop */ } }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
      lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
      miterLimit: 10, lineDashOffset: 0, shadowOffsetX: 0, shadowOffsetY: 0,
      shadowBlur: 0, shadowColor: '', globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true, direction: 'inherit', filter: 'none',
    };
    const perCanvas = new WeakMap<object, typeof fakeCtx & { canvas: object }>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) {
        ctx = { ...fakeCtx, canvas: this };
        perCanvas.set(this, ctx);
      }
      return ctx;
    };
  })() as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  delete (window as { devicePixelRatio?: number }).devicePixelRatio;
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

async function settle(grid: VelocityGrid<Row>, ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  (grid as unknown as { cgridCanvas: { tickPaint: (now: number) => void } })
    .cgridCanvas.tickPaint(performance.now());
}

interface Row { id: string; v: number }

const BLOCK = 10;
const CAP = 8;
const BOOK = 130;

describe('evictRows must invalidate the evicted row\'s retained Tier-2 strip', () => {
  it('a row evicted from the SSRM leaf-block LRU loses its captured strip, not just its version entry', async () => {
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
      terminate(): void { /* noop */ }
      addEventListener(type: string, cb: (e: MessageEvent) => void): void {
        if (type === 'message') this.listeners.add(cb);
      }
      removeEventListener(_type: string, cb: (e: MessageEvent) => void): void {
        this.listeners.delete(cb);
      }
    };

    const el = document.createElement('div');
    el.className = 'vg-theme-quartz';
    el.style.width = '800px';
    el.style.height = '600px';
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

    const g = grid as unknown as {
      scroller: HTMLElement;
      root: HTMLElement;
      cgridCanvas: { resize: () => void; tickPaint: (now: number) => void };
      rasterStrips: RowStripCache | null;
      rowDataById: Map<string, Row>;
      ssrm: ServerSideRowModelV2Controller<Row> | null;
    };
    Object.defineProperty(g.scroller, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(g.scroller, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(g.root, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(g.root, 'clientHeight', { value: 600, configurable: true });
    g.cgridCanvas.resize();

    await waitFor(() => grid.getDisplayedRowCount() === BOOK, 'row count settled');

    const ctrl = g.ssrm;
    expect(ctrl).not.toBeNull();
    // Make sure block 0 (holding r0) is definitely loaded, independent of
    // whatever the initial mount viewport happened to request.
    await ctrl!.ensureRange(0, BLOCK);

    // Paint the initial viewport so row r0's strip actually gets captured
    // — this is what makes the eviction meaningful; a version-only clear
    // against a never-captured strip proves nothing.
    await settle(grid);

    const strips = g.rasterStrips;
    expect(strips).not.toBeNull();
    expect(strips!.has('r0'), 'sanity: r0 must have a captured strip before eviction').toBe(true);

    // Walk the rest of the book so block 0 becomes the LRU victim under
    // the CAP-block cache — identical mechanic to
    // ssrmEvictionPropagation.test.ts's "keeps … bounded" case.
    for (let b = 1; b * BLOCK < BOOK; b++) {
      await ctrl!.ensureRange(b * BLOCK, (b + 1) * BLOCK);
    }

    // Confirm eviction actually happened (guards against a vacuous pass).
    await waitFor(() => !g.rowDataById.has('r0'), 'r0 evicted from the mirror');

    // THE ASSERTION — pre-fix, `evictRows` deletes only
    // `rowVersionByRowId`, leaving the strip captured above still
    // retained in `RowStripCache`; this fails on the pre-fix source.
    // Post-fix, `evictRows` also calls `rasterStrips.invalidateRow(id)`,
    // so the strip is gone.
    expect(strips!.has('r0'), 'an evicted row must not retain its pre-eviction strip').toBe(false);

    grid.destroy();
    el.remove();
    (globalThis as { Worker?: unknown }).Worker = origWorker;
  }, 20000);
});
