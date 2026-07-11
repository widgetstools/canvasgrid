/**
 * Damage-region ledger — accumulates SEMANTIC damage between paints and
 * resolves it to merged clip rects against the live viewport at paint time.
 * Semantic entries (row indices, rowId+colId cells) survive scroll because
 * geometry is computed at paint, not at enqueue. Design:
 * docs/superpowers/specs/2026-07-11-damage-region-rendering-design.md §3a/§4.
 *
 * Correctness defaults: an EMPTY ledger resolves to FULL (legacy
 * requestRepaint() callers recorded nothing); unknown/unresolvable entries
 * degrade toward full, never toward under-painting.
 */

export type Damage =
  | { kind: 'full' }
  | { kind: 'rows'; rowIndices: number[] }
  | { kind: 'cells'; cells: Array<{ rowId: number; colId: string }> }
  | { kind: 'band'; top: number; bottom: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'scroll'; dy: number };

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Two-domain damage resolution (paint-cache layer spec §2). `chromeRects`
 * are SCREEN-space (CSS px against the live canvas) — header, floating-
 * filter, totals, pinned-row, and sticky-band damage, plus any portion of
 * ambiguous `band`/`rect` damage that falls outside the data-body region.
 * `dataRects` are CONTENT-space (scroll space, CSS px) — row/cell damage
 * (always data-domain, resolved through `rowBand`/`rowIndexForRowId`) plus
 * whatever portion of `band`/`rect` damage falls INSIDE the data-body
 * region. See `screenYToContentY`/`dataRectToScreen` for the ONE transform
 * used everywhere a screen y needs to become (or come back from) a content
 * y. Until the retained layer lands (Task 4), `renderer.ts` maps
 * `dataRects` straight back to screen space and paints the union of both
 * arrays exactly like the pre-two-domain single `rects` array — byte-
 * identical behavior.
 */
export interface ResolvedDamage {
  full: boolean;
  chromeRects: Rect[];
  dataRects: Rect[];
  blit: { dy: number } | null;
}

export interface DamageResolveCtx {
  canvasWidth: number; canvasHeight: number; dpr: number;
  bodyTop: number; bodyBottom: number; bodyLeft: number; bodyRight: number;
  /** Current vertical scroll position (CONTENT px) — the pivot of the
   *  screen↔content transform (see `screenYToContentY`/`dataRectToScreen`).
   *  A screen y of `bodyTop` always corresponds to content y `scrollTop`. */
  scrollTop: number;
  /** Retained paint-cache layer's current anchor, CONTENT px (Task 4 wires
   *  the real geometry; until then callers pass `layerTop = scrollTop`, so
   *  the layer's own coordinate space coincides with the live scroll
   *  position — no extra indirection). Not used by the transform itself
   *  (that only needs `scrollTop`); reserved for widened-range row
   *  resolution wired in later tasks. */
  layerTop: number;
  /** Retained paint-cache layer's vertical extent, CSS px (Task 4 wires
   *  the real `bodyHeight + 2*overscanPx`; until then callers pass
   *  `layerHeight = bodyBottom - bodyTop`, so the data-domain area cap
   *  below degrades to today's body-height bound). */
  layerHeight: number;
  stickyBandBottom: number | null;
  pinnedBandRects: Rect[];
  /** Task 4 (paint-cache layer) — `true` when the retained layer is
   *  actively serving this frame (paintCache enabled AND the layer's
   *  `available`). The scroll-exposed "assume a screen self-blit"
   *  band (below) exists ONLY for the pre-layer renderer's own scroll
   *  self-blit (`Renderer.paint`'s `damage.blit` branch) — under the
   *  retained layer, `PaintCacheLayer`'s own `planLayer` decision
   *  (shift/reset) independently determines exactly which band needs a
   *  fresh raster, so re-pushing the SAME band into `dataRects` here
   *  would force a redundant per-scroll-tick raster and defeat the
   *  layer's entire purpose (scroll frames should cost one `drawImage`,
   *  not a raster). Sticky-band + pinned/totals chrome redamage stays
   *  unconditional either way (see below) — those are genuinely
   *  screen-anchored chrome the layer never covers, and the shipped
   *  cache-off pipeline already redamages them every scroll tick.
   *  Defaults to falsy so every existing/cache-off resolution is
   *  byte-identical to pre-Task-4 behavior. */
  paintCacheLayerActive?: boolean;
  rowBand(localRowIndex: number): { top: number; bottom: number } | null;
  rowIndexForRowId(rowId: number): number | null;
  colBounds(colId: string): { x: number; w: number } | null;
  /** Task 6 (pixel-invariance harness) — reverse lookup: the visible row
   *  (any kind — data/header/totals/pinned) whose band STRICTLY contains
   *  pixel `y` (`top < y < bottom`; a `y` exactly ON a boundary matches
   *  neither side, so an already row-aligned edge is left alone). Used by
   *  `expand()` to snap a bleed-expanded edge that lands mid-row out to
   *  that row's full bounds — see the row-atomic bleed comment there.
   *  Optional so existing `DamageResolveCtx` test fixtures (which don't
   *  exercise this path) don't need updating. */
  rowBoundsAtY?(y: number): { top: number; bottom: number } | null;
  /** I1 fix — mirror of `rowBoundsAtY` for the horizontal axis: the visible
   *  column whose bounds STRICTLY contain pixel `x` (`left < x < right`; a
   *  boundary-aligned `x` matches neither side and is left alone). Cell-
   *  scoped damage (flash cells) has vertical clip edges at `colX ±
   *  DAMAGE_BLEED_PX`, and cell renderers do not clip per cell, so the
   *  same T6-discovered Skia AA divergence class (a clip edge landing
   *  mid-glyph paints differently than an unclipped full-surface paint of
   *  the same glyph) applies on this axis too — `expand()` snaps a bled
   *  x-edge out to the full bounds of whichever column it lands inside.
   *  Optional so existing `DamageResolveCtx` test fixtures that don't
   *  exercise this path don't need updating. */
  colBoundsAtX?(x: number): { left: number; right: number } | null;
}

export const DAMAGE_BLEED_PX = 2;
export const DAMAGE_MAX_RECTS = 12;
export const DAMAGE_MAX_AREA_FRACTION = 0.6;
export const STICKY_SHADOW_BLEED_PX = 8;
/** I6 fix — raw (post-expand, pre-merge) rect count above which
 *  `takeResolved` bails to FULL rather than paying for `mergeRects`' O(n²)
 *  (worst-case O(n³) — it restarts the scan after every single merge). */
export const DAMAGE_PRE_MERGE_CAP = 64;

const FULL: ResolvedDamage = { full: true, chromeRects: [], dataRects: [], blit: null };

/**
 * The ONE screen→content transform used throughout two-domain damage
 * resolution (spec §2): a data-body pixel at screen y `bodyTop` sits at
 * content (scroll-space) y `scrollTop` — i.e. `contentY = screenY -
 * bodyTop + scrollTop`. Vertical only: horizontal scroll always resets the
 * paint-cache layer (spec §1), so x is never remapped between the two
 * spaces.
 */
export function screenYToContentY(y: number, ctx: { scrollTop: number; bodyTop: number }): number {
  return y - ctx.bodyTop + ctx.scrollTop;
}

/**
 * Inverse of `screenYToContentY`. Task 2's renderer bridge uses this to map
 * a `dataRects` entry (CONTENT space) back to screen space so painting
 * stays byte-identical to the pre-two-domain pipeline until the real
 * retained layer (Task 4) consumes `dataRects` directly.
 */
export function dataRectToScreen(rect: Rect, ctx: { scrollTop: number; bodyTop: number }): Rect {
  return { x: rect.x, y: rect.y + ctx.bodyTop - ctx.scrollTop, w: rect.w, h: rect.h };
}

export interface ScrollDamageInput {
  /** Horizontal scroll delta (CSS px) since the last paint. */
  dx: number;
  /** Vertical scroll delta (CSS px) since the last paint. */
  dy: number;
  /** Current body height (CSS px) — the blit can only shift within it. */
  bodyHeight: number;
  /** `true` when devicePixelRatio changed since the last paint. */
  dprChanged: boolean;
  /** `true` when canvas CSS bounds changed since the last paint. */
  boundsChanged: boolean;
  /** C1 fix — current devicePixelRatio, used to bail the blit when `dy *
   *  dpr` isn't an integer (a fractional device-px source rect resamples
   *  under `imageSmoothing`, and a same-window scroll ships no follow-up
   *  chunk to correct a blurred blit — it would be the FINAL state, not a
   *  transient one). */
  dpr: number;
}

/**
 * Pure decision function — spec §5.4. The scroll blit is an OPTIMIZATION
 * with a full-paint fallback, never a correctness dependency: every
 * ambiguous or out-of-bounds case below degrades to `{kind:'full'}` rather
 * than guessing. Phase B scope is vertical-only scrolling, so ANY
 * horizontal component (`dx !== 0`) bails to full — a horizontal scroll
 * shifts pinned-left/right columns in ways the single-axis blit doesn't
 * model. A DPR or canvas-bounds change since the last paint means the
 * backing store's pixel content no longer matches what the blit's device-
 * px math assumes, so that also bails to full (the FIRST paint after a
 * resize/DPR change must never blit).
 */
export function decideScrollDamage(input: ScrollDamageInput): Damage {
  const { dx, dy, bodyHeight, dprChanged, boundsChanged, dpr } = input;
  if (dprChanged || boundsChanged) return { kind: 'full' };
  if (dx !== 0) return { kind: 'full' };
  if (Math.abs(dy) >= bodyHeight) return { kind: 'full' };
  // C1 fix — a non-integer device-px delta means the blit's source rect
  // would land on a fractional row of the backing store; bail to full
  // rather than resample (see ScrollDamageInput.dpr doc).
  const devicePx = dy * dpr;
  if (Math.abs(devicePx - Math.round(devicePx)) > 1e-6) return { kind: 'full' };
  return { kind: 'scroll', dy };
}

export class DamageLedger {
  private entries: Damage[] = [];
  private isFull = false;
  private scrollDy = 0;

  add(d: Damage): void {
    if (this.isFull) return;
    if (d.kind === 'full') { this.isFull = true; this.entries.length = 0; this.scrollDy = 0; return; }
    if (d.kind === 'scroll') { this.scrollDy += d.dy; return; }
    this.entries.push(d);
  }

  hasAny(): boolean { return this.isFull || this.scrollDy !== 0 || this.entries.length > 0; }

  takeResolved(ctx: DamageResolveCtx): ResolvedDamage {
    const entries = this.entries; const wasFull = this.isFull; const dy = this.scrollDy;
    this.entries = []; this.isFull = false; this.scrollDy = 0;

    // Empty ledger = legacy requestRepaint() with no recorded damage → full.
    if (wasFull || (entries.length === 0 && dy === 0)) return FULL;

    // Two-domain bucketing (spec §2). `dataRaw` entries are ALWAYS
    // data-domain — rows/cells resolve through `rowBand`/
    // `rowIndexForRowId`, which only ever addresses data-subgrid rows, and
    // (once a widened/layer viewport lands — Task 3/4) may legitimately
    // return bands beyond the visible screen; those are never body-clipped,
    // just converted straight to content space below. `splitRaw` entries
    // are geometry-AMBIGUOUS 'band'/'rect' damage (plus the scroll-exposed
    // band, the sticky band, and pinned/totals band redamage below) —
    // their domain is resolved by intersecting with the live body region
    // once the geometry is final (after `expand()`/merge).
    const dataRaw: Rect[] = [];
    const splitRaw: Rect[] = [];
    const pushData = (top: number, bottom: number): void => {
      dataRaw.push({ x: 0, y: top, w: ctx.canvasWidth, h: bottom - top });
    };
    const pushSplit = (top: number, bottom: number): void => {
      splitRaw.push({ x: 0, y: top, w: ctx.canvasWidth, h: bottom - top });
    };

    // I6 fix — bucket 'cells' damage by row BEFORE creating any rects. A
    // broad tick/flash burst can carry up to visibleRows×flashedCols raw
    // cell entries (~300+); pushing one rect per cell fed `mergeRects`'
    // restart-after-every-merge loop an O(n³)-shaped worst case. Unioning
    // each row's touched column spans caps this at ≤ window-size rects
    // (one per distinct row) and makes the merge below trivial. Rows with
    // an unknown column (or where any cell overlaps an unknown column)
    // fall back to the row-atomic full-width band, same as before.
    const rowCellSpans = new Map<number, {
      top: number; bottom: number; minX: number; maxX: number; fullRow: boolean;
    }>();
    for (const d of entries) {
      switch (d.kind) {
        case 'rows':
          for (const i of d.rowIndices) {
            const b = ctx.rowBand(i);
            if (b) pushData(b.top, b.bottom);
          }
          break;
        case 'cells':
          for (const c of d.cells) {
            const idx = ctx.rowIndexForRowId(c.rowId);
            if (idx === null) continue;
            const b = ctx.rowBand(idx);
            if (!b) continue;
            let span = rowCellSpans.get(idx);
            if (!span) {
              span = { top: b.top, bottom: b.bottom, minX: Infinity, maxX: -Infinity, fullRow: false };
              rowCellSpans.set(idx, span);
            }
            const col = ctx.colBounds(c.colId);
            if (col) {
              if (col.x < span.minX) span.minX = col.x;
              if (col.x + col.w > span.maxX) span.maxX = col.x + col.w;
            } else {
              span.fullRow = true; // unknown column → row-atomic
            }
          }
          break;
        case 'band': pushSplit(d.top, d.bottom); break;
        case 'rect': splitRaw.push({ x: d.x, y: d.y, w: d.w, h: d.h }); break;
        // 'full'/'scroll' never stored in entries
      }
    }
    for (const span of rowCellSpans.values()) {
      if (span.fullRow || span.minX > span.maxX) pushData(span.top, span.bottom);
      else dataRaw.push({ x: span.minX, y: span.top, w: span.maxX - span.minX, h: span.bottom - span.top });
    }

    // Scroll: only usable as a blit when no full; exposed band becomes
    // damage. The exposed band is newly-scrolled-into-view DATA content
    // (always inside [bodyTop, bodyBottom] by construction — `exposed` is
    // clamped to the body height), so it goes straight into `dataRaw`.
    let blit: { dy: number } | null = null;
    if (dy !== 0) {
      blit = { dy };
      // Task 4 — the retained paint-cache layer supersedes this exposed-
      // band push with its OWN shift/reset raster-band decision (see the
      // `paintCacheLayerActive` doc above); skip it so a plain in-layer
      // scroll tick resolves to an EMPTY `dataRects` (present-only frame),
      // not a redundant per-tick raster.
      if (!ctx.paintCacheLayerActive) {
        const exposed = Math.min(Math.abs(dy), ctx.bodyBottom - ctx.bodyTop);
        if (dy > 0) pushData(ctx.bodyBottom - exposed, ctx.bodyBottom);
        else pushData(ctx.bodyTop, ctx.bodyTop + exposed);
      }
      // Sticky band + shadow never scrolls with content — always redamage
      // it. Geometry-ambiguous (screen-anchored chrome that happens to sit
      // inside the body's y-range) — resolved by the body-intersection
      // split below, same as any other `splitRaw` entry.
      if (ctx.stickyBandBottom !== null) pushSplit(ctx.bodyTop, ctx.stickyBandBottom + STICKY_SHADOW_BLEED_PX);
      // Task 5 — pinned/totals bands (top or bottom) always redamage on any
      // scroll frame, unconditionally (not just when they geometrically
      // intersect the exposed strip). The blit shifts the WHOLE body region
      // including any pinned/totals rows that live inside it, so without
      // this they'd show blit-shifted pixels for one frame before their
      // own row-level damage (if any) caught up.
      // I6 fix — push the rect directly instead of cloning: nothing below
      // ever mutates a rect's fields in place (`expand()` and `mergeRects`
      // both produce brand-new rect objects rather than writing through an
      // existing one), so the defensive `{ ...r }` clone was pure garbage.
      for (const r of ctx.pinnedBandRects) splitRaw.push(r);
    }

    // Bleed + sticky extension + clamp + snap — same `expand()` for both
    // buckets (still entirely screen-space geometry; the domain split
    // happens AFTER, once every rect's final bounds are settled).
    const dataSnapped = dataRaw.map((r) => this.expand(r, ctx)).filter((r) => r.w > 0 && r.h > 0);
    const splitSnapped = splitRaw.map((r) => this.expand(r, ctx)).filter((r) => r.w > 0 && r.h > 0);
    // I6 fix — pre-merge cap: bail to FULL before paying for `mergeRects`'
    // O(n²) (restart-after-every-merge, so worst-case O(n³)) scan. A batch
    // this wide is heading toward one of the area-fraction caps below
    // anyway, so this loses nothing but the wasted merge work.
    if (dataSnapped.length + splitSnapped.length > DAMAGE_PRE_MERGE_CAP) return FULL;
    const mergedData = mergeRects(dataSnapped);
    const mergedSplit = mergeRects(splitSnapped);

    // Domain split (spec §2): `mergedData` is already data-domain (rows/
    // cells) and converts to content space directly, with NO body clip —
    // a widened (Task 3/4) `rowBand` result beyond the visible screen
    // still resolves correctly. `mergedSplit` entries are geometry-
    // ambiguous until now: the portion inside the data-body region
    // [bodyTop, bodyBottom] converts to CONTENT space and joins
    // `dataRects`; the remainder stays screen-space `chromeRects`.
    const chromeRects: Rect[] = [];
    const dataRects: Rect[] = [];
    for (const r of mergedData) {
      dataRects.push({ x: r.x, y: screenYToContentY(r.y, ctx), w: r.w, h: r.h });
    }
    for (const r of mergedSplit) {
      if (r.y < ctx.bodyTop) {
        const h = Math.min(r.y + r.h, ctx.bodyTop) - r.y;
        if (h > 0) chromeRects.push({ x: r.x, y: r.y, w: r.w, h });
      }
      if (r.y + r.h > ctx.bodyBottom) {
        const y0 = Math.max(r.y, ctx.bodyBottom);
        const h = (r.y + r.h) - y0;
        if (h > 0) chromeRects.push({ x: r.x, y: y0, w: r.w, h });
      }
      const top = Math.max(r.y, ctx.bodyTop);
      const bottom = Math.min(r.y + r.h, ctx.bodyBottom);
      if (bottom > top) {
        dataRects.push({ x: r.x, y: screenYToContentY(top, ctx), w: r.w, h: bottom - top });
      }
    }

    // Per-domain caps (spec §2): chrome against the canvas, same as
    // today's single unified cap; data against the LAYER area — with no
    // real layer yet, `ctx.layerHeight` is passed as the body height, so
    // this reduces to today's bound scoped to the body's own area (Task 4
    // wires the real, wider layer extent). Either domain overflowing
    // degrades the WHOLE resolution to full — same conservatism as before,
    // never a partial result built from an over-cap domain.
    const chromeArea = chromeRects.reduce((a, r) => a + r.w * r.h, 0);
    const canvasArea = ctx.canvasWidth * ctx.canvasHeight;
    if (chromeRects.length > DAMAGE_MAX_RECTS || chromeArea > canvasArea * DAMAGE_MAX_AREA_FRACTION) return FULL;
    const dataArea = dataRects.reduce((a, r) => a + r.w * r.h, 0);
    const layerArea = ctx.layerHeight * ctx.canvasWidth;
    if (dataRects.length > DAMAGE_MAX_RECTS || dataArea > layerArea * DAMAGE_MAX_AREA_FRACTION) return FULL;

    return { full: false, chromeRects, dataRects, blit };
  }

  private expand(r: Rect, ctx: DamageResolveCtx): Rect {
    let x0 = r.x - DAMAGE_BLEED_PX, y0 = r.y - DAMAGE_BLEED_PX;
    let x1 = r.x + r.w + DAMAGE_BLEED_PX, y1 = r.y + r.h + DAMAGE_BLEED_PX;
    // Sticky band: anything touching it repaints the whole band + shadow.
    if (ctx.stickyBandBottom !== null && y0 < ctx.stickyBandBottom + STICKY_SHADOW_BLEED_PX && y1 > ctx.bodyTop) {
      y0 = Math.min(y0, ctx.bodyTop);
      y1 = Math.max(y1, ctx.stickyBandBottom + STICKY_SHADOW_BLEED_PX);
    }
    // Pinned/totals bands are band-atomic (spec §4.4): intersecting one
    // extends the rect to cover that whole band.
    for (const b of ctx.pinnedBandRects) {
      if (x0 <= b.x + b.w && b.x <= x1 && y0 <= b.y + b.h && b.y <= y1) {
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      }
    }
    // Row-atomic bleed (Task 6 pixel-invariance harness fix): the flat
    // ±bleed expansion above can land partway into a NEIGHBORING row's
    // band instead of exactly on its boundary — e.g. a hovered row whose
    // bled bottom edge creeps 2px into the row below. That's a clip
    // boundary through the MIDDLE of the neighbor's content, and canvas
    // text/decorator anti-aliasing genuinely differs at a mid-glyph clip
    // edge vs. an unclipped (full-surface) paint of the same glyph — Skia
    // resolves glyph coverage against the active clip, so a partial-row
    // slice can leave a stray edge scanline that a full paint never
    // produces. Rows are the atomic unit for row-based damage (hover,
    // selection, focus, ticks): snap the bled edge OUT to the full bounds
    // of whichever row it lands inside, so a repaint always includes a
    // neighboring row completely or not at all.
    if (ctx.rowBoundsAtY) {
      const topRow = ctx.rowBoundsAtY(y0);
      if (topRow && topRow.top < y0) y0 = topRow.top;
      const bottomRow = ctx.rowBoundsAtY(y1);
      if (bottomRow && bottomRow.bottom > y1) y1 = bottomRow.bottom;
    }
    // I1 fix — same column-atomic snap on the horizontal axis. Cell-scoped
    // damage (flash cells) bleeds `x0`/`x1` by `DAMAGE_BLEED_PX`, which can
    // land partway into a NEIGHBORING column's band instead of exactly on
    // its boundary; snap out to that column's full bounds so a clip edge
    // never cuts through the middle of a neighboring cell's glyphs.
    if (ctx.colBoundsAtX) {
      const leftCol = ctx.colBoundsAtX(x0);
      if (leftCol && leftCol.left < x0) x0 = leftCol.left;
      const rightCol = ctx.colBoundsAtX(x1);
      if (rightCol && rightCol.right > x1) x1 = rightCol.right;
    }
    // Clamp to canvas.
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(ctx.canvasWidth, x1); y1 = Math.min(ctx.canvasHeight, y1);
    // Snap OUT to device pixels.
    const d = ctx.dpr || 1;
    x0 = Math.floor(x0 * d) / d; y0 = Math.floor(y0 * d) / d;
    x1 = Math.ceil(x1 * d) / d; y1 = Math.ceil(y1 * d) / d;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

/** Merge overlapping/touching rects until fixpoint. O(n²) on ≤ ~20 rects
 *  (bounded by `DAMAGE_PRE_MERGE_CAP` upstream). I6 fix — `.slice()`
 *  instead of `rects.map((r) => ({...r}))`: the loop below only ever
 *  REASSIGNS `out[i]` to a brand-new merged rect object or `splice`s an
 *  entry out — it never mutates an individual rect's fields in place — so
 *  a shallow array copy (no per-rect object clone) is sufficient to avoid
 *  mutating the caller's input array. */
export function mergeRects(rects: Rect[]): Rect[] {
  const out = rects.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!, b = out[j]!;
        if (a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h) {
          const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
          const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
          out[i] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          out.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return out;
}
