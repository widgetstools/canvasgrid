/**
 * RasterCache Tier 1 — content-keyed cell bitmaps (Cycle 22 / Task 1).
 *
 * Pure store consumed later at the byRows cell-paint seam: on a key hit the
 * painter blits the cached bitmap instead of re-running the cell painter.
 * Correctness-by-key house rule: any state a bitmap's pixels depend on is
 * either (a) inside `cellStyleSignature`'s key, (b) scoped to the
 * theme/dpr/option EPOCH (`epochBump` invalidates everything when any of
 * those change — theme-derived fields like `checkboxCheckedBg`, `emptyFg`,
 * `group*`, `palette` only move on a theme swap, so they ride the epoch
 * rather than bloating the per-cell key), or (c) grounds for a bypass
 * (`cellCacheBypass` → the caller paints live).
 *
 * No `Date`, no direct DOM — all canvas access goes through the injected
 * `PaintCacheCanvasFactory` (paintCache.ts type, reused verbatim), so the
 * store is fully unit-testable with fake canvases. Construction never
 * throws; a null/failing factory degrades to `available = false` with
 * every method a safe no-op. Evicted entries' canvases are POOLED
 * (Task 0's binding lesson — allocation churn caused 100–250ms GC
 * hitches): a same-dims render after an eviction reuses the evicted
 * canvas object; the pool is bounded (see `surfacePool.ts`).
 */

import type { CachedContext2D } from '../gc';
import type { CellPaintConfig } from '../cellRenderers/registry';
import type { PaintCacheCanvasFactory, PaintCacheCanvasLike } from '../../core/paintCache';
import { RasterBudget, type RasterLedgerToken } from './budget';
import { SurfacePool } from './surfacePool';

/** Field delimiter — a control char that never appears in real cell text,
 *  keeping every covered field in its own fixed position (no collision
 *  between e.g. value='ab',formatted='c' and value='a',formatted='bc'). */
const SEP = '';

/**
 * Content key for one cell bitmap. Covers EVERY pixel-affecting field a
 * built-in painter reads (see the brief's list — implemented verbatim):
 * `valueFormatted`, `String(value)`, font, fg, bg, borderColor, halign,
 * valign, letterSpacing, lineHeight, padding, border, textDecoration,
 * ruleIndicator, prefillColor, the four state booleans (belt-and-braces —
 * totals/footer lifts already resolve into fg/bg/font upstream),
 * sortDirection/sortIndex/sortTotal/unSortIcon/unSortIconColor/iconColor,
 * wrapHeader, headerCheckboxState — plus the renderer name and the cell's
 * w×h. EXCLUDES `bounds.x`/`bounds.y`: bitmaps are position-independent
 * (painted at (0,0,w,h)), so the same content at any grid position hits.
 * `textTransform` is deliberately absent — it is already baked into
 * `valueFormatted` upstream. Theme-scoped colors not listed here
 * (checkboxCheckedBg/Fg, group*, emptyFg, palette, flashFromColor) are
 * epoch-invalidated instead — see the module doc comment.
 */
export function cellStyleSignature(rendererName: string, config: CellPaintConfig): string {
  const p = config;
  const pad = p.padding;
  const ri = p.ruleIndicator;
  return [
    rendererName,
    p.bounds.w,
    p.bounds.h,
    p.valueFormatted,
    String(p.value),
    p.font,
    p.fg,
    p.bg,
    p.borderColor,
    p.halign,
    p.valign ?? '',
    p.letterSpacing ?? '',
    p.lineHeight ?? '',
    pad ? `${pad.top ?? ''},${pad.right ?? ''},${pad.bottom ?? ''},${pad.left ?? ''}` : '',
    p.border ? JSON.stringify(p.border) : '',
    p.textDecoration ?? '',
    ri ? `${ri.iconName},${ri.color},${ri.target},${ri.position}` : '',
    p.prefillColor,
    p.isFocused ? 1 : 0,
    p.isSelected ? 1 : 0,
    p.isHovered ? 1 : 0,
    p.isHeader ? 1 : 0,
    p.sortDirection ?? '',
    p.sortIndex ?? '',
    p.sortTotal ?? '',
    p.unSortIcon ? 1 : 0,
    p.unSortIconColor ?? '',
    p.iconColor ?? '',
    p.wrapHeader ? 1 : 0,
    p.headerCheckboxState ?? '',
  ].join(SEP);
}

/**
 * Bypass matrix (exact per the brief) — `true` means DON'T cache, paint
 * live: `!cacheable` (custom renderer not opted in — the caller also
 * passes `cacheable=false` when a pending cell icon will draw),
 * `flashAlpha !== undefined` (transient overlay), `content !== undefined`
 * (content slot), non-empty `decorators`, or `params !== undefined`
 * (opaque per-cell params — pixels may depend on state the key can't see).
 */
export function cellCacheBypass(
  rendererName: string,
  config: CellPaintConfig,
  cacheable: boolean,
): boolean {
  void rendererName; // reserved for future per-renderer bypass rules
  if (!cacheable) return true;
  if (config.flashAlpha !== undefined) return true;
  if (config.content !== undefined) return true;
  if (config.decorators !== undefined && config.decorators.length > 0) return true;
  if (config.params !== undefined) return true;
  return false;
}

interface CellEntry {
  canvas: PaintCacheCanvasLike;
  gc: CachedContext2D;
  bytes: number;
  token: RasterLedgerToken;
}

export class CellBitmapCache {
  /** `false` when constructed with a null factory (or one that failed the
   *  construction probe) — every method is then a safe no-op / null.
   *  Construction NEVER throws. */
  readonly available: boolean;

  private readonly budget: RasterBudget;
  private readonly pool: SurfacePool;
  /** Keyed by `${epoch}${SEP}${key}` — the epoch prefix makes every
   *  pre-bump key structurally a miss even before the eager sweep. */
  private entries = new Map<string, CellEntry>();
  private epoch = 0;
  private bytesTotal = 0;
  private disposed = false;

  constructor(budget: RasterBudget, factory: PaintCacheCanvasFactory) {
    this.budget = budget;
    const f: PaintCacheCanvasFactory | null = factory ?? null;
    this.pool = new SurfacePool(f, Math.floor(budget.maxBytes() / 2));
    // Probe: one surface proves the factory + context path works (the
    // paintCache.ts availability discipline); the probe canvas is not
    // wasted — it seeds the pool for the first render.
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

  /** Theme / dpr / grid-option epoch — invalidates ALL entries (key
   *  prefix + eager release so the bytes return to the shared budget
   *  immediately and the canvases land in the reuse pool). */
  epochBump(): void {
    this.releaseAll();
    this.epoch++;
  }

  /** Key hit → the cached bitmap (LRU-touched); miss / unavailable → null. */
  get(key: string): PaintCacheCanvasLike | null {
    if (!this.available || this.disposed) return null;
    const entry = this.entries.get(this.epoch + SEP + key);
    if (entry === undefined) return null;
    this.budget.touch(entry.token);
    return entry.canvas;
  }

  /**
   * Rasterize a cell bitmap for `key`. Scratch discipline: backing store
   * `round(css*dpr)` (min 1), cleared on the identity transform, then
   * `setTransform(dpr,0,0,dpr,0,0)` so `paint` draws the cell at
   * (0,0,wCss,hCss). Charges `wDev*hDev*4` against the SHARED budget,
   * evicting globally-LRU entries (either tier) until it fits. Returns
   * `null` — never throws — when unavailable, when the entry can't fit
   * even after eviction (caller paints live), or when allocation fails.
   * An existing entry for `key` is returned as-is WITHOUT repainting:
   * keys are content-addressed, so same key ⇒ same pixels.
   */
  render(
    key: string,
    wCss: number,
    hCss: number,
    dpr: number,
    paint: (gc: CachedContext2D) => void,
  ): PaintCacheCanvasLike | null {
    if (!this.available || this.disposed) return null;
    const fullKey = this.epoch + SEP + key;
    const wDev = Math.max(1, Math.round(wCss * dpr));
    const hDev = Math.max(1, Math.round(hCss * dpr));

    const existing = this.entries.get(fullKey);
    if (existing !== undefined) {
      if (existing.canvas.width === wDev && existing.canvas.height === hDev) {
        this.budget.touch(existing.token);
        return existing.canvas;
      }
      // Defensive: same key at different dims (caller misuse — dims are in
      // the signature) → replace.
      this.dropEntry(fullKey, existing);
    }

    const bytes = wDev * hDev * 4;
    if (!this.budget.charge(bytes, () => this.budget.evictLru())) return null;

    const surf = this.pool.acquire(wDev, hDev);
    if (surf === null) {
      this.budget.credit(bytes); // refund the successful charge
      return null;
    }

    const gc = surf.gc;
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.clearRect(0, 0, wDev, hDev);
    gc.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(gc);

    const entry: CellEntry = { canvas: surf.canvas, gc, bytes, token: 0 };
    entry.token = this.budget.track({
      bytes,
      // Ledger-eviction path: store-side cleanup ONLY — the in-flight
      // `charge` credits the bytes (budget.ts invariant).
      free: () => {
        if (this.entries.get(fullKey) === entry) {
          this.entries.delete(fullKey);
          this.bytesTotal -= entry.bytes;
          this.pool.recycle(entry.canvas, entry.gc);
        }
      },
    });
    this.entries.set(fullKey, entry);
    this.bytesTotal += bytes;
    return surf.canvas;
  }

  /** Closeout M-1 — off-ledger free-list bytes (see SurfacePool.bytes). */
  pooledBytes(): number {
    return this.pool.bytes();
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytesTotal };
  }

  /** Release every entry (bytes credited, canvases pooled) and drop the
   *  pool's backing stores. Idempotent; the store stays permanently inert
   *  afterwards. */
  dispose(): void {
    this.releaseAll();
    this.pool.clear();
    this.disposed = true;
  }

  /** Non-charge release path — credits the budget via `release(token)`. */
  private dropEntry(fullKey: string, entry: CellEntry): void {
    this.entries.delete(fullKey);
    this.bytesTotal -= entry.bytes;
    this.budget.release(entry.token);
    this.pool.recycle(entry.canvas, entry.gc);
  }

  private releaseAll(): void {
    for (const [fullKey, entry] of this.entries) {
      void fullKey;
      this.bytesTotal -= entry.bytes;
      this.budget.release(entry.token);
      this.pool.recycle(entry.canvas, entry.gc);
    }
    this.entries.clear();
    this.bytesTotal = 0;
  }
}
