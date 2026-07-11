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

export interface ResolvedDamage {
  full: boolean;
  rects: Rect[];
  blit: { dy: number } | null;
}

export interface DamageResolveCtx {
  canvasWidth: number; canvasHeight: number; dpr: number;
  bodyTop: number; bodyBottom: number; bodyLeft: number; bodyRight: number;
  stickyBandBottom: number | null;
  pinnedBandRects: Rect[];
  rowBand(localRowIndex: number): { top: number; bottom: number } | null;
  rowIndexForRowId(rowId: number): number | null;
  colBounds(colId: string): { x: number; w: number } | null;
}

export const DAMAGE_BLEED_PX = 2;
export const DAMAGE_MAX_RECTS = 12;
export const DAMAGE_MAX_AREA_FRACTION = 0.6;
export const STICKY_SHADOW_BLEED_PX = 8;

const FULL: ResolvedDamage = { full: true, rects: [], blit: null };

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

    const rects: Rect[] = [];
    const pushBand = (top: number, bottom: number): void => {
      rects.push({ x: 0, y: top, w: ctx.canvasWidth, h: bottom - top });
    };

    for (const d of entries) {
      switch (d.kind) {
        case 'rows':
          for (const i of d.rowIndices) {
            const b = ctx.rowBand(i);
            if (b) pushBand(b.top, b.bottom);
          }
          break;
        case 'cells':
          for (const c of d.cells) {
            const idx = ctx.rowIndexForRowId(c.rowId);
            if (idx === null) continue;
            const b = ctx.rowBand(idx);
            if (!b) continue;
            const col = ctx.colBounds(c.colId);
            if (col) rects.push({ x: col.x, y: b.top, w: col.w, h: b.bottom - b.top });
            else pushBand(b.top, b.bottom); // unknown column → row-atomic
          }
          break;
        case 'band': pushBand(d.top, d.bottom); break;
        case 'rect': rects.push({ x: d.x, y: d.y, w: d.w, h: d.h }); break;
        // 'full'/'scroll' never stored in entries
      }
    }

    // Scroll: only usable as a blit when no full; exposed band becomes damage.
    let blit: { dy: number } | null = null;
    if (dy !== 0) {
      blit = { dy };
      const exposed = Math.min(Math.abs(dy), ctx.bodyBottom - ctx.bodyTop);
      if (dy > 0) pushBand(ctx.bodyBottom - exposed, ctx.bodyBottom);
      else pushBand(ctx.bodyTop, ctx.bodyTop + exposed);
      // Sticky band + shadow never scrolls with content — always redamage it.
      if (ctx.stickyBandBottom !== null) pushBand(ctx.bodyTop, ctx.stickyBandBottom + STICKY_SHADOW_BLEED_PX);
    }

    // Bleed + sticky extension + clamp + snap.
    const snapped = rects.map((r) => this.expand(r, ctx)).filter((r) => r.w > 0 && r.h > 0);
    const merged = mergeRects(snapped);

    const area = merged.reduce((a, r) => a + r.w * r.h, 0);
    const canvasArea = ctx.canvasWidth * ctx.canvasHeight;
    if (merged.length > DAMAGE_MAX_RECTS || area > canvasArea * DAMAGE_MAX_AREA_FRACTION) return FULL;

    return { full: false, rects: merged, blit };
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

/** Merge overlapping/touching rects until fixpoint. O(n²) on ≤ ~20 rects. */
export function mergeRects(rects: Rect[]): Rect[] {
  const out = rects.map((r) => ({ ...r }));
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
