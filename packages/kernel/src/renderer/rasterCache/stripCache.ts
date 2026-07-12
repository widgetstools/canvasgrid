/**
 * RasterCache Tier 2 — row-strip store (Cycle 22 / Task 1).
 *
 * Pure store consumed later by the retained paint-cache layer's band
 * raster: a full row raster is captured out of the just-painted layer
 * (`capture` — a device-px copy, no repaint), and re-presented on a hit
 * (`get`) instead of re-running every cell painter in the row. A ticking
 * cell repaints ONE span in place (`patch`) and advances the stored row
 * version so the next `get(rowId, newVersion, …)` hits.
 *
 * Keying: one strip per `rowId`; a strip is valid only for its exact
 * `rowVersion` + `layoutEpoch`. `layoutEpochBump` drops everything —
 * column geometry/order/width, theme, dpr, or canvas width changed, so
 * every strip's pixels are stale by definition.
 *
 * Shares the ONE `RasterBudget` with Tier 1 (`CellBitmapCache`): charges,
 * touches, and evictions all flow through the same global LRU ledger, so
 * a strip capture can evict cold cell bitmaps and vice versa. Same
 * degradation contract as Tier 1: construction never throws, a
 * null/failing factory → `available = false` + safe no-ops. Evicted
 * strips' canvases are pooled (Task 0 GC-churn lesson), bounded — see
 * `surfacePool.ts`.
 */

import type { CachedContext2D } from '../gc';
import type { PaintCacheCanvasFactory, PaintCacheCanvasLike } from '../../core/paintCache';
import { RasterBudget, type RasterLedgerToken } from './budget';
import { SurfacePool } from './surfacePool';

export interface StripKey {
  rowId: string;
  rowVersion: number;
  layoutEpoch: number;
}

interface StripEntry {
  version: number;
  layoutEpoch: number;
  canvas: PaintCacheCanvasLike;
  gc: CachedContext2D;
  bytes: number;
  token: RasterLedgerToken;
}

export class RowStripCache {
  /** `false` when constructed with a null/failing factory — every method
   *  is then a safe no-op. Construction NEVER throws. */
  readonly available: boolean;

  private readonly budget: RasterBudget;
  private readonly pool: SurfacePool;
  private entries = new Map<string, StripEntry>();
  private bytesTotal = 0;
  private disposed = false;

  constructor(budget: RasterBudget, factory: PaintCacheCanvasFactory) {
    this.budget = budget;
    const f: PaintCacheCanvasFactory | null = factory ?? null;
    this.pool = new SurfacePool(f, Math.floor(budget.maxBytes() / 2));
    let ok = false;
    if (f !== null) {
      const probe = this.pool.acquire(0, 0);
      if (probe !== null) {
        this.pool.recycle(probe.canvas, probe.gc);
        ok = true;
      }
    }
    this.available = ok;
  }

  /** Exact-key hit (`rowId` + `rowVersion` + `layoutEpoch` all match) →
   *  the strip canvas, LRU-touched. Anything else → null. */
  get(rowId: string, rowVersion: number, layoutEpoch: number): PaintCacheCanvasLike | null {
    if (!this.available || this.disposed) return null;
    const entry = this.entries.get(rowId);
    if (entry === undefined) return null;
    if (entry.version !== rowVersion || entry.layoutEpoch !== layoutEpoch) return null;
    this.budget.touch(entry.token);
    return entry.canvas;
  }

  /**
   * Copy a just-rastered layer row out into a retained strip. All
   * geometry is DEVICE px (the layer's backing store space): the copy is
   * `drawImage(source, 0, srcYDevicePx, w, h, 0, 0, w, h)` on an identity
   * transform. Replaces any previous strip for the row. Charges
   * `w*h*4` against the shared budget (global LRU eviction until it
   * fits); silently a no-op when unavailable, when the strip can't fit,
   * or when allocation fails — never throws.
   */
  capture(
    key: StripKey,
    source: CanvasImageSource,
    srcYDevicePx: number,
    widthDevicePx: number,
    heightDevicePx: number,
  ): void {
    if (!this.available || this.disposed) return;
    if (widthDevicePx <= 0 || heightDevicePx <= 0) return;

    const existing = this.entries.get(key.rowId);
    if (existing !== undefined) this.dropEntry(key.rowId, existing);

    const bytes = widthDevicePx * heightDevicePx * 4;
    if (!this.budget.charge(bytes, () => this.budget.evictLru())) return;

    const surf = this.pool.acquire(widthDevicePx, heightDevicePx);
    if (surf === null) {
      this.budget.credit(bytes); // refund the successful charge
      return;
    }

    const gc = surf.gc;
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.clearRect(0, 0, widthDevicePx, heightDevicePx);
    gc.drawImage(source, 0, srcYDevicePx, widthDevicePx, heightDevicePx, 0, 0, widthDevicePx, heightDevicePx);

    const entry: StripEntry = {
      version: key.rowVersion,
      layoutEpoch: key.layoutEpoch,
      canvas: surf.canvas,
      gc,
      bytes,
      token: 0,
    };
    entry.token = this.budget.track({
      bytes,
      // Ledger-eviction path: store-side cleanup ONLY — the in-flight
      // `charge` credits the bytes (budget.ts invariant).
      free: () => {
        if (this.entries.get(key.rowId) === entry) {
          this.entries.delete(key.rowId);
          this.bytesTotal -= entry.bytes;
          this.pool.recycle(entry.canvas, entry.gc);
        }
      },
    });
    this.entries.set(key.rowId, entry);
    this.bytesTotal += bytes;
  }

  /**
   * Repaint ONE cell span of the retained strip in place (a ticking cell)
   * and advance the stored version, so the NEXT `get(rowId, newVersion,
   * …)` hits without a full re-raster. Returns `false` when there is no
   * strip for `rowId` (caller falls back to a full capture).
   *
   * `xCss`/`wCss` are CSS px; `dpr` (default 1) maps them onto the
   * strip's device-px backing store — a dpr change bumps the layout
   * epoch upstream, so every live strip is at the CURRENT dpr and the
   * caller passes that. Discipline: the span `[round(xCss*dpr),
   * round((xCss+wCss)*dpr))` is clipped + cleared on the identity
   * transform, then the CTM is set to `(dpr,0,0,dpr, xDev, 0)` so
   * `paint` draws the cell at (0,0,wCss,rowHcss) exactly like a Tier 1
   * `render` closure. Wrapped in `gc.cache.save()`/`.restore()` so the
   * clip AND the gc state cache unwind together.
   */
  patch(
    rowId: string,
    newVersion: number,
    xCss: number,
    wCss: number,
    paint: (gc: CachedContext2D) => void,
    dpr = 1,
  ): boolean {
    if (!this.available || this.disposed) return false;
    const entry = this.entries.get(rowId);
    if (entry === undefined) return false;

    const x0 = Math.round(xCss * dpr);
    const x1 = Math.round((xCss + wCss) * dpr);
    const wDev = Math.max(0, x1 - x0);
    const hDev = entry.canvas.height;
    const gc = entry.gc;

    gc.cache.save();
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.beginPath();
    gc.rect(x0, 0, wDev, hDev);
    gc.clip();
    gc.clearRect(x0, 0, wDev, hDev);
    gc.setTransform(dpr, 0, 0, dpr, x0, 0);
    paint(gc);
    gc.cache.restore();

    entry.version = newVersion;
    this.budget.touch(entry.token);
    return true;
  }

  /** Cycle 22 / Task 3 — cheap presence probe (any version/epoch), so the
   *  patch-on-tick path can skip its config-build work for rows that have
   *  no retained strip at all. Never touches the LRU. */
  has(rowId: string): boolean {
    if (!this.available || this.disposed) return false;
    return this.entries.has(rowId);
  }

  /** Drop one row's strip (row data changed shape / row removed). */
  invalidateRow(rowId: string): void {
    if (!this.available || this.disposed) return;
    const entry = this.entries.get(rowId);
    if (entry !== undefined) this.dropEntry(rowId, entry);
  }

  /** Column geometry/order/width, theme, dpr, or canvas width changed —
   *  every strip's pixels are stale, drop them all (bytes back to the
   *  shared budget, canvases into the reuse pool). */
  layoutEpochBump(): void {
    for (const [rowId, entry] of this.entries) {
      void rowId;
      this.bytesTotal -= entry.bytes;
      this.budget.release(entry.token);
      this.pool.recycle(entry.canvas, entry.gc);
    }
    this.entries.clear();
    this.bytesTotal = 0;
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytesTotal };
  }

  /** Release every strip + the pool's backing stores. Idempotent; the
   *  store stays permanently inert afterwards. */
  dispose(): void {
    this.layoutEpochBump();
    this.pool.clear();
    this.disposed = true;
  }

  /** Non-charge release path — credits the budget via `release(token)`. */
  private dropEntry(rowId: string, entry: StripEntry): void {
    this.entries.delete(rowId);
    this.bytesTotal -= entry.bytes;
    this.budget.release(entry.token);
    this.pool.recycle(entry.canvas, entry.gc);
  }
}
