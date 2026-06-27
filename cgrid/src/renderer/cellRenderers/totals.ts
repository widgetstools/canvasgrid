import type { CachedContext2D } from '../gc';
import type { CellPainter, CellPaintConfig } from './registry';

/**
 * Polished `'totals'` cell renderer. Built-in renderer for cells in the
 * `TotalsSubgrid` (grand-totals row). Designed per
 * `docs/superpowers/plans/notes/cycle-14-aggregation-design.md` § Task 5.
 *
 * Responsibilities (LEAF only):
 *   - Paint the cell background (delegates to the standard bg + flash
 *     pass — the row's tint is already laid down by the row-bg bundle,
 *     so this typically no-ops when `bg === prefillColor`).
 *   - Paint the value text using the upstream `font` / `fg` / `halign`
 *     resolved by `applyCellProps` (which already substituted the
 *     totals weight 500 and `theme.totalsFg`).
 *   - When the cell is "empty" (column has no aggFunc → `chunk.totals`
 *     returned null; OR an aggFunc produced no value), paint a single
 *     em-dash `—` in `emptyFg` (the muted totals fg threaded through
 *     `CellPaintConfig` by `applyCellProps`).
 *
 * Explicitly NOT this renderer's job:
 *   - The row's top border (painted by `gridLinesPainter`).
 *   - The row's tint (painted by the row-bg bundle).
 *   - The font-weight bump (substituted by `applyCellProps` on `font`).
 *   - Truncation / ellipsis (cell-clip in `byRows.ts` handles overflow,
 *     matching body cells).
 *
 * Cycle 14 / Task 5.
 */

const PADDING = 6;
const EMPTY_GLYPH = '—';

/** Treats null / undefined / empty-string values OR an empty/undefined
 *  formatted string as "no totals to display for this column." Catches
 *  both columns without `aggFunc` (worker returns null) AND aggFuncs that
 *  yielded no usable value (e.g. an empty filter set). */
function isEmpty(value: unknown, formatted: string | undefined): boolean {
  if (formatted === undefined || formatted === '') return true;
  if (value === null || value === undefined || value === '') return true;
  return false;
}

function resolveAlign(halign: 'left' | 'right' | 'center'): CanvasTextAlign {
  return halign;
}

function paintBackground(gc: CachedContext2D, p: CellPaintConfig): void {
  // Skip the per-cell bg fill when the row-bg bundle already painted this bg.
  if (p.bg !== p.prefillColor) {
    gc.cache.fillStyle = p.bg;
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
  }
  if (p.flashAlpha && p.flashAlpha > 0) {
    gc.cache.save();
    gc.cache.globalAlpha = p.flashAlpha;
    gc.cache.fillStyle = p.flashFromColor ?? '#fef3c7';
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    gc.cache.restore();
  }
}

export const totalsCell: CellPainter = {
  paint(gc, p) {
    paintBackground(gc, p);

    const empty = isEmpty(p.value, p.valueFormatted);
    const text = empty ? EMPTY_GLYPH : p.valueFormatted;
    const fill = empty ? (p.emptyFg ?? p.fg) : p.fg;

    gc.cache.fillStyle = fill;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';

    const align = resolveAlign(p.halign);
    gc.cache.textAlign = align;

    const cy = p.bounds.y + p.bounds.h / 2;
    const x = align === 'right'
      ? p.bounds.x + p.bounds.w - PADDING
      : align === 'center'
        ? p.bounds.x + p.bounds.w / 2
        : p.bounds.x + PADDING;

    gc.fillText(text, x, cy);
  },
};
