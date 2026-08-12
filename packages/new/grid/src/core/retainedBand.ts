/**
 * Retained pixels — the SINGLE owner of "a scroll of `dy` moved a surface's
 * still-valid pixels; which band did that leave stale, and whose job is it to
 * repaint?"
 *
 * Collapse target #2 (SPEC.md §2). Legacy had two retained-pixel paths that
 * each answered this independently:
 *
 *   1. The renderer's on-screen scroll self-blit, whose exposed band was
 *      derived inline inside `DamageLedger.takeResolved` (SCREEN space, clamped
 *      to the body region) behind an `if (!paintCacheLayerActive)` gate.
 *   2. `PaintCacheLayer.shift`, whose exposed band was derived inline inside
 *      `planLayer` (CONTENT space, clamped to the data extent).
 *
 * Two spellings of one formula, plus a gate that forced the ledger to know
 * which of its two peers was live. Here they are strategies of one owner
 * instead: `exposedBand` is the single derivation (the coordinate space is a
 * parameter, which is all the two ever really differed by), and
 * `resolveRetainedStrategy` is the single place that decides which strategy
 * holds a given frame's retained pixels. `layerExposedBand` and
 * `ledgerExposedBand` are the two strategies' views of that one answer;
 * `paintCache.ts` and `damageLedger.ts` call them instead of re-deriving.
 *
 * Deliberately dependency-free so both call sites can import it without a
 * cycle (`damageLedger` must not depend on `paintCache`, which is exactly the
 * coupling the legacy gate implied).
 */

export interface RetainedBand {
  top: number;
  bottom: number;
}

/** Which strategy holds the still-valid pixels for this frame: the retained
 *  offscreen paint-cache layer, or the renderer's on-screen scroll self-blit.
 *  Strategies of one owner, never peers. */
export type RetainedPixelStrategy = 'layer' | 'scroll-blit';

function clampTo(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Shifting a retained surface by `dy` leaves a band of `|dy|` at the LEADING
 * edge whose pixels no longer describe the content behind them: scrolling down
 * (`dy > 0`) exposes the bottom of the surface's new span, scrolling up exposes
 * the top. The exposed height can never exceed the surface itself, and the
 * result is clamped to the coordinate space's valid range (`[clampLo,
 * clampHi]`) so a shift near either extreme yields an empty band rather than a
 * negative-height one.
 *
 * `surfaceTop` is the surface's anchor AFTER the shift, in whichever space the
 * caller works in — CONTENT px for the retained layer, SCREEN px for the
 * on-screen blit. Returns `null` when nothing was exposed.
 */
export function exposedBand(args: {
  dy: number;
  surfaceTop: number;
  surfaceHeight: number;
  clampLo: number;
  clampHi: number;
}): RetainedBand | null {
  const { dy, surfaceTop, surfaceHeight, clampLo, clampHi } = args;
  if (dy === 0 || surfaceHeight <= 0) return null;
  const exposed = Math.min(Math.abs(dy), surfaceHeight);
  const rawTop = dy > 0 ? surfaceTop + surfaceHeight - exposed : surfaceTop;
  const rawBottom = dy > 0 ? surfaceTop + surfaceHeight : surfaceTop + exposed;
  const top = clampTo(rawTop, clampLo, clampHi);
  const bottom = clampTo(rawBottom, clampLo, clampHi);
  return bottom > top ? { top, bottom } : null;
}

/**
 * The one place that decides which strategy owns a frame's retained pixels.
 * `paintCacheLayerActive` means the retained offscreen layer is serving the
 * frame (paintCache enabled AND the layer `available`), so `planLayer`'s
 * shift/reset decision is authoritative; otherwise the on-screen self-blit is.
 */
export function resolveRetainedStrategy(
  input: { paintCacheLayerActive?: boolean },
): RetainedPixelStrategy {
  return input.paintCacheLayerActive === true ? 'layer' : 'scroll-blit';
}

/**
 * `'layer'` strategy: the CONTENT-space band a `planLayer` shift exposed on the
 * retained offscreen layer, clamped to the data extent. The layer is taller
 * than the viewport, and `planLayer` only reaches here once `|dy| <
 * layerHeight`, so this is the band that becomes the shift's raster band.
 */
export function layerExposedBand(args: {
  dy: number;
  layerTop: number;
  layerHeight: number;
  contentHeight: number;
}): RetainedBand | null {
  return exposedBand({
    dy: args.dy,
    surfaceTop: args.layerTop,
    surfaceHeight: args.layerHeight,
    clampLo: 0,
    clampHi: args.contentHeight,
  });
}

/**
 * `'scroll-blit'` strategy: the exposed SCREEN-space band the damage ledger
 * must repaint itself — or `null` when it must not.
 *
 * Under `'layer'` the answer is always `null`. The layer's own `planLayer`
 * shift/reset already schedules a raster for exactly the band it invalidated,
 * so re-damaging that band here would force a redundant raster on every scroll
 * tick and defeat the layer's purpose: a scroll frame should cost one
 * `drawImage`, not a raster. Under `'scroll-blit'` the ledger IS the frame's
 * retained-pixel owner, so it damages the band the blit exposed.
 */
export function ledgerExposedBand(
  ctx: { bodyTop: number; bodyBottom: number; paintCacheLayerActive?: boolean },
  dy: number,
): RetainedBand | null {
  if (resolveRetainedStrategy(ctx) === 'layer') return null;
  return exposedBand({
    dy,
    surfaceTop: ctx.bodyTop,
    surfaceHeight: ctx.bodyBottom - ctx.bodyTop,
    clampLo: ctx.bodyTop,
    clampHi: ctx.bodyBottom,
  });
}
