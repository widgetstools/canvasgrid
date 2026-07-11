/**
 * RasterCache core — internal pooled-surface helper (Cycle 22 / Task 1).
 * NOT part of the module's public surface (`index.ts` does not export it).
 *
 * Task 0's grain benchmark found that bitmap ALLOCATION churn — not raster
 * cost — produced 100–250ms GC hitches until evicted canvases were pooled.
 * Both stores therefore recycle their evicted entries' canvases through
 * this free-list instead of allocating fresh ones:
 *
 *  - `acquire(wDev, hDev)` prefers an exact-dims pooled canvas (zero
 *    backing-store realloc — the common case: uniform cell/strip sizes),
 *    falls back to resizing ANY pooled canvas (reuses the canvas object +
 *    attached context, avoiding element/context/gc-cache churn), and only
 *    then asks the injected factory for a new one.
 *  - `recycle(...)` pushes an evicted surface back, bounded: total pooled
 *    bytes are capped at HALF the shared budget's ceiling, evicting the
 *    OLDEST pooled surface (its backing store dropped via 0×0 resize)
 *    while more than one remains. The most recent evictee is always kept
 *    regardless of the cap so evict → immediate same-dims re-render always
 *    reuses (the Task 0 lesson); unbounded pool growth is impossible —
 *    pooled bytes never exceed max(maxBytes/2, one surface).
 *
 * All canvas access flows through the injected factory / previously
 * factory-made canvases — no DOM, no `Date`. Nothing here throws: factory
 * or context failures surface as `null` from `acquire`.
 */

import { attachGcCache, type CachedContext2D } from '../gc';
import type { PaintCacheCanvasFactory, PaintCacheCanvasLike } from '../../core/paintCache';

export interface PooledSurface {
  canvas: PaintCacheCanvasLike;
  gc: CachedContext2D;
  /** Backing-store bytes at recycle time (w*h*4); 0 while checked out. */
  bytes: number;
}

export class SurfacePool {
  private pool: PooledSurface[] = [];
  private pooledBytes = 0;

  constructor(
    private readonly factory: PaintCacheCanvasFactory | null,
    /** Pool byte ceiling — stores pass `budget.maxBytes() / 2`. */
    private readonly capBytes: number,
  ) {}

  /** Hand out a surface with a `wDev`×`hDev` backing store: pooled
   *  exact-dims first, then any pooled surface resized, then a fresh
   *  factory allocation. `null` when the pool is empty and the factory
   *  fails (returns null / throws) — never throws. Cell/strip bitmaps
   *  are composited over existing pixels, so contexts attach with
   *  `alpha: true`. */
  acquire(wDev: number, hDev: number): PooledSurface | null {
    let surf: PooledSurface | null = null;
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const s = this.pool[i]!;
      if (s.canvas.width === wDev && s.canvas.height === hDev) {
        this.pool.splice(i, 1);
        this.pooledBytes -= s.bytes;
        surf = s;
        break;
      }
    }
    if (surf === null && this.pool.length > 0) {
      surf = this.pool.pop()!;
      this.pooledBytes -= surf.bytes;
    }
    if (surf === null) {
      if (this.factory === null) return null;
      let canvas: PaintCacheCanvasLike | null = null;
      try {
        canvas = this.factory();
      } catch {
        canvas = null;
      }
      if (canvas === null) return null;
      let gc: CachedContext2D | null = null;
      try {
        gc = attachGcCache(canvas, { alpha: true });
      } catch {
        gc = null;
      }
      if (gc === null) return null;
      surf = { canvas, gc, bytes: 0 };
    }
    // ensureSize dpr discipline (core/paintCache.ts): assign the backing
    // store ONLY when it actually changes — assignment clears the store
    // even for an unchanged value.
    if (surf.canvas.width !== wDev || surf.canvas.height !== hDev) {
      surf.canvas.width = wDev;
      surf.canvas.height = hDev;
    }
    surf.bytes = 0;
    return surf;
  }

  /** Return an evicted entry's surface to the free-list (bounded — see
   *  the module doc comment). */
  recycle(canvas: PaintCacheCanvasLike, gc: CachedContext2D): void {
    const bytes = canvas.width * canvas.height * 4;
    this.pool.push({ canvas, gc, bytes });
    this.pooledBytes += bytes;
    while (this.pooledBytes > this.capBytes && this.pool.length > 1) {
      const oldest = this.pool.shift()!;
      this.pooledBytes -= oldest.bytes;
      releaseBackingStore(oldest.canvas);
    }
  }

  /** Drop every pooled surface (store dispose). Idempotent. */
  clear(): void {
    for (const s of this.pool) releaseBackingStore(s.canvas);
    this.pool = [];
    this.pooledBytes = 0;
  }
}

function releaseBackingStore(canvas: PaintCacheCanvasLike): void {
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Best-effort — some fakes/backends may not like a 0×0 resize.
  }
}
