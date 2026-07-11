/**
 * Retained paint-cache layer — Phase C of the damage-region system. Design:
 * docs/superpowers/specs/2026-07-11-paint-cache-layer-design.md §1/§3.
 *
 * `planLayer` is the PURE geometry decision (no DOM, no `Date`, no canvas
 * access) that decides — given the layer's current coverage and the new
 * scroll position — whether the retained offscreen layer can stay put
 * (`keep`), needs to slide by a delta (`shift`, re-raster only the newly
 * exposed band), or must be fully re-anchored (`reset`: first paint, or a
 * scroll jump bigger than the layer's own coverage).
 *
 * `PaintCacheLayer` owns the retained offscreen canvas + lifecycle around
 * that decision: sizing (`ensureSize`, mirrors `CGridCanvas.resize`'s dpr
 * discipline — `core/canvas.ts:196-214`), self-blit (`shift`), content↔
 * layer/screen coordinate mapping, and disposal. All canvas-API access is
 * behind an injected canvas factory so tests (this module's own, and later
 * integration tests) can run under happy-dom without a real GPU backend —
 * construction never throws; a failed/unavailable canvas just sets
 * `available = false` and every other method becomes a safe no-op.
 */

import { attachGcCache, type CachedContext2D, type GcCanvasLike } from '../renderer/gc';
import { isOffscreenCanvasSupported } from '../renderer/offscreenSupport';

/** Layer coverage in CONTENT px (scroll space) — `layerTop` is the content
 *  y the canvas's device row 0 currently represents; `layerHeight` is the
 *  layer's vertical extent (`bodyHeight + 2 * overscanPx` while steady). */
export interface LayerGeometry { layerTop: number; layerHeight: number }

export type LayerPlan =
  | { kind: 'keep' }
  | { kind: 'shift'; dy: number; newTop: number; rasterBands: Array<{ top: number; bottom: number }> }
  | { kind: 'reset'; newTop: number };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Pure decision function — spec §1 "Layer maintenance". `overscanPx` is the
 * coverage margin banked on EACH side of the visible body
 * (`paintCacheOverscan × bodyHeight` per the design), so the layer's target
 * height is `bodyHeight + 2*overscanPx`. `current === null` (no layer yet)
 * always resets. Otherwise: the layer is kept as long as BOTH margins
 * (visible-range edge to layer-coverage edge) stay at least 25% of
 * `overscanPx`; once either margin erodes below that, the layer re-centers
 * via a `shift` (self-blit + raster only the newly exposed band) UNLESS the
 * new visible range has fallen (mostly or entirely) outside the old
 * coverage, or the layer's target height changed (a resize/option change
 * invalidates the self-blit math), in which case it's a full `reset`.
 * `newTop` is always clamped to `[0, contentHeight]` — the top of data
 * space; content coordinates never go negative and the layer never anchors
 * past the end of the data.
 */
export function planLayer(args: {
  current: LayerGeometry | null;
  scrollTop: number;
  bodyHeight: number;
  overscanPx: number;
  contentHeight: number;
}): LayerPlan {
  const { current, scrollTop, bodyHeight, overscanPx, contentHeight } = args;
  const layerHeight = bodyHeight + 2 * overscanPx;
  // Anchor that re-centers the overscan margin symmetrically around the
  // visible range.
  const idealTop = clamp(scrollTop - overscanPx, 0, contentHeight);

  if (current === null) return { kind: 'reset', newTop: idealTop };

  // A resize / overscan-option change since the last plan invalidates the
  // self-blit math below (it assumes the layer's own height is unchanged)
  // — reset rather than guess at reusable pixels.
  if (current.layerHeight !== layerHeight) return { kind: 'reset', newTop: idealTop };

  const covTop = current.layerTop;
  const covBottom = covTop + current.layerHeight;
  const visTop = scrollTop;
  const visBottom = scrollTop + bodyHeight;
  const threshold = 0.25 * overscanPx;
  const topMargin = visTop - covTop;
  const bottomMargin = covBottom - visBottom;

  if (topMargin >= threshold && bottomMargin >= threshold) return { kind: 'keep' };

  const dy = idealTop - covTop;
  // Already pinned at the clamped edge (e.g. top of data) with nothing left
  // to slide toward — margin violation is unavoidable, not actionable.
  if (dy === 0) return { kind: 'keep' };

  // No usable overlap left between the old coverage and the new visible
  // range, or the shift distance would consume the whole layer height
  // (nothing worth reusing via self-blit) → full reset.
  const noOverlap = visBottom <= covTop || visTop >= covBottom;
  if (noOverlap || Math.abs(dy) >= current.layerHeight) {
    return { kind: 'reset', newTop: idealTop };
  }

  const newTop = idealTop;
  const newBottom = newTop + layerHeight;
  let bandTop: number;
  let bandBottom: number;
  if (dy > 0) {
    // Scrolling down: the newly covered band lands at the BOTTOM of the layer.
    bandTop = covBottom;
    bandBottom = newBottom;
  } else {
    // Scrolling up: the newly covered band lands at the TOP of the layer.
    bandTop = newTop;
    bandBottom = covTop;
  }
  // Clamp the exposed band to the data space so a shift near either content
  // edge never produces a negative-height (or out-of-range) band.
  bandTop = clamp(bandTop, 0, contentHeight);
  bandBottom = clamp(bandBottom, 0, contentHeight);
  const rasterBands = bandBottom > bandTop ? [{ top: bandTop, bottom: bandBottom }] : [];

  return { kind: 'shift', dy, newTop, rasterBands };
}

/** Minimal surface `PaintCacheLayer` needs from a canvas — satisfied by
 *  both `OffscreenCanvas` and `HTMLCanvasElement` (real or detached), and
 *  trivially fake-able in tests. */
export interface PaintCacheCanvasLike extends GcCanvasLike {
  width: number;
  height: number;
}

export type PaintCacheCanvasFactory = () => PaintCacheCanvasLike | null;

/** Default factory: `OffscreenCanvas` when the platform supports it
 *  (`renderer/offscreenSupport.ts`), else a detached `HTMLCanvasElement`.
 *  Never throws — any construction failure just returns `null`, which
 *  `PaintCacheLayer` turns into `available = false`. */
function defaultCanvasFactory(): PaintCacheCanvasLike | null {
  if (isOffscreenCanvasSupported()) {
    try {
      const OffscreenCanvasCtor = (globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => PaintCacheCanvasLike }).OffscreenCanvas;
      return new OffscreenCanvasCtor(1, 1);
    } catch {
      // Fall through to the detached HTMLCanvasElement path below.
    }
  }
  try {
    return document.createElement('canvas') as unknown as PaintCacheCanvasLike;
  } catch {
    return null;
  }
}

export class PaintCacheLayer {
  /** `true` when the offscreen canvas + 2D context were obtained
   *  successfully. Every other method is a safe no-op when `false` —
   *  construction NEVER throws, so a headless/unsupported environment
   *  degrades to "no cache" rather than crashing the grid. */
  readonly available: boolean;

  private canvas: PaintCacheCanvasLike | null = null;
  private ctx: CachedContext2D | null = null;
  private dpr = 1;
  private _layerTop = 0;
  private _layerHeight = 0;

  constructor(canvasFactory: PaintCacheCanvasFactory = defaultCanvasFactory) {
    let canvas: PaintCacheCanvasLike | null = null;
    try {
      canvas = canvasFactory();
    } catch {
      canvas = null;
    }
    let ctx: CachedContext2D | null = null;
    if (canvas) {
      try {
        ctx = attachGcCache(canvas, { alpha: false });
      } catch {
        ctx = null;
      }
    }
    this.canvas = ctx ? canvas : null;
    this.ctx = ctx;
    this.available = this.canvas !== null && this.ctx !== null;
  }

  geometry(): LayerGeometry {
    return { layerTop: this._layerTop, layerHeight: this._layerHeight };
  }

  /** Raw context for the raster/present passes (later tasks). `null` when
   *  `available` is `false`. */
  context(): CachedContext2D | null {
    return this.ctx;
  }

  /** Raw canvas for the present blit (later tasks). `null` when
   *  `available` is `false`. */
  canvasElement(): PaintCacheCanvasLike | null {
    return this.canvas;
  }

  /** Mirrors `CGridCanvas.resize`'s dpr discipline (`core/canvas.ts:196-
   *  214`): backing store = `round(css * dpr)`, `setTransform(dpr, 0, 0,
   *  dpr, 0, 0)` right after a REAL reallocation, and skips the assignment
   *  entirely when the size + dpr already match — assigning
   *  `canvas.width`/`height` clears the backing store even when the value
   *  is unchanged, which would itself blank the layer on a no-op call.
   *  `layerHeightCss` doubles as the CONTENT-space `layerHeight` (1:1 with
   *  CSS px — only the backing store scales by `dpr`).
   *
   *  Returns `true` when this call performed a REAL reallocation (backing
   *  store dims changed) — the caller (Task 4's paint closure) uses this
   *  to force a `planLayer` reset even when the CSS-px `layerHeight` (the
   *  only dimension `planLayer` itself compares) happened to stay the
   *  same but `dpr` alone changed: a dpr-only reallocation silently wipes
   *  every pixel the same way a dimension change does, so a `'keep'` or
   *  `'shift'` decision computed as if nothing happened would `shift()`
   *  (self-blit) from — or `present` — a blank canvas. */
  ensureSize(widthCss: number, layerHeightCss: number, dpr: number): boolean {
    this._layerHeight = layerHeightCss;
    if (!this.available || !this.canvas || !this.ctx) return false;
    this.dpr = dpr;
    const newW = Math.round(widthCss * dpr);
    const newH = Math.round(layerHeightCss * dpr);
    const sameBacking = this.canvas.width === newW && this.canvas.height === newH;
    if (!sameBacking) {
      this.canvas.width = newW;
      this.canvas.height = newH;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return !sameBacking;
  }

  /** Self-blit the layer's own backing store by `dy` (CONTENT/CSS px, same
   *  sign as `LayerPlan.shift.dy`) and advance the anchor to match — after
   *  this call `geometry().layerTop` reflects what the canvas's pixels now
   *  represent, so only `LayerPlan.shift.rasterBands` needs re-rastering.
   *
   *  Both the source AND destination rects are DEVICE px, on an EXPLICITLY
   *  untransformed copy path (`save` / `setTransform(1,0,0,1,0,0)` /
   *  `drawImage` / `restore`): mixing a device-px source with a CTM-scaled
   *  CSS-px destination is the exact Critical-C1 bug class from the
   *  damage-region cycle (the on-screen scroll blit in `renderer.ts`) — a
   *  dpr≠1 backing store would double-scale one side of the copy. Resetting
   *  the transform to identity for the duration of the blit sidesteps that
   *  entirely; `restore()` reinstates the persistent dpr CTM afterward. */
  shift(dy: number): void {
    this._layerTop += dy;
    if (!this.available || !this.canvas || !this.ctx || dy === 0) return;
    const devDy = Math.round(dy * this.dpr);
    if (devDy === 0) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (devDy > 0) {
      // Scrolled down: shift the still-valid pixels UP by devDy, expose a
      // fresh band at the bottom.
      const keepH = Math.min(h, h - devDy);
      if (keepH > 0) {
        ctx.drawImage(this.canvas as unknown as CanvasImageSource, 0, devDy, w, keepH, 0, 0, w, keepH);
      }
      const clearTop = Math.max(0, keepH);
      ctx.clearRect(0, clearTop, w, h - clearTop);
    } else {
      // Scrolled up: shift the still-valid pixels DOWN by |devDy|, expose a
      // fresh band at the top.
      const up = -devDy;
      const keepH = Math.min(h, h - up);
      if (keepH > 0) {
        ctx.drawImage(this.canvas as unknown as CanvasImageSource, 0, 0, w, keepH, 0, up, w, keepH);
      }
      ctx.clearRect(0, 0, w, Math.min(h, up));
    }
    ctx.restore();
  }

  /** Re-anchor to `newTop` (CONTENT px) and drop every cached pixel — the
   *  caller must re-raster the full visible layer content afterward. */
  reset(newTop: number): void {
    this._layerTop = newTop;
    if (!this.available || !this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  /** Maps a CONTENT-space y (scroll space) to the layer-local y a painter
   *  should draw at (before the persistent dpr CTM scales it to device px)
   *  — i.e. `contentY - layerTop`. */
  contentToLayerY(y: number): number {
    return y - this._layerTop;
  }

  /** DEVICE-px source rect for the present blit (`drawImage(layer, sy, sh,
   *  … )`) — `sy` is where the current visible range starts inside the
   *  layer's backing store, `sh` its device-px height. */
  visibleSrcRect(scrollTop: number, bodyH: number, dpr: number): { sy: number; sh: number } {
    return {
      sy: Math.round((scrollTop - this._layerTop) * dpr),
      sh: Math.round(bodyH * dpr),
    };
  }

  /** Release the backing store (setting width/height to 0 frees GPU/CPU
   *  memory in most engines) and drop all references. Safe to call
   *  multiple times and even when `available` is `false`. */
  dispose(): void {
    if (this.canvas) {
      try {
        this.canvas.width = 0;
        this.canvas.height = 0;
      } catch {
        // Best-effort — some fakes/backends may not like a 0×0 resize.
      }
    }
    this.canvas = null;
    this.ctx = null;
  }
}
