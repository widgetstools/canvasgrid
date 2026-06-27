import type { CachedContext2D } from '../gc';
import { drawIcon } from '../icons';

export interface CellPaintConfig {
  // Cell content
  value: unknown;
  valueFormatted: string;
  // Geometry — reuse the same nested bounds object across cells (mutated in place)
  bounds: { x: number; y: number; w: number; h: number };
  // Layered visual props (theme → colDef.cellStyle → cell-specific)
  font: string;
  fg: string;
  bg: string;
  borderColor: string;
  halign: 'left' | 'right' | 'center';
  // What's already painted under this cell (bundle bg). Skip the bg fill
  // when bg === prefillColor (already done by the bundle pass).
  prefillColor: string;
  // Per-cell state
  isFocused: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isHeader: boolean;
  // Header-only adornments (ignored by data renderers)
  iconColor?: string;
  sortDirection?: 'asc' | 'desc';
  /** Cycle 8 / Task 1 — 1-indexed sort position when the cell's column
   *  participates in a multi-column sort (e.g. `2` means "second sort
   *  key"). `0` / `undefined` for single-column or unsorted columns. */
  sortIndex?: number;
  /** Cycle 8 / Task 1 — total number of columns in the current sort
   *  model. Used by the header painter to decide whether to render the
   *  badge at all (no badge for `sortTotal <= 1`). */
  sortTotal?: number;
  /** Cycle 8 / Task 5 — when `true` and `sortDirection` is unset, the
   *  header painter draws a faint up/down chevron pair so the user can
   *  see at a glance that the column is sortable. The color resolves
   *  from `unSortIconColor` (theme's `--cg-unsort-icon-color`) and the
   *  icon paints at 50% alpha so it never competes with the active
   *  sort chevron on other columns. */
  unSortIcon?: boolean;
  /** Cycle 8 / Task 5 — resolved color for the faint chevron pair.
   *  Threaded from `ResolvedTheme.unsortIconColor` (default: 40% alpha
   *  black/white depending on the active theme). Only meaningful when
   *  `unSortIcon === true`. */
  unSortIconColor?: string;
  // Flash overlay (Cycle 4 / Task 11 — `flashAlpha` is the per-cell
  // alpha drained from FlashRegistry; `flashFromColor` is the theme's
  // current --cg-flash-from-color so light + dark themes both paint
  // their declared color instead of a hard-coded swatch).
  flashAlpha?: number;
  flashFromColor?: string;
  /**
   * Cycle 14 / Task 5 — muted foreground used by the polished `'totals'`
   * renderer when the cell value is empty / null / undefined. Populated by
   * `applyCellProps` from `theme.totalsFgMuted` only when `ctx.isTotals ===
   * true`; left undefined for data and header cells so non-totals renderers
   * never accidentally pick up a muted color. The totals renderer falls
   * back to `fg` when this is unset.
   */
  emptyFg?: string;
  /**
   * Opaque per-cell params forwarded by the painter. Set from either the
   * resolved column's static `cellRendererParams` or — when a column has a
   * `cellRendererSelector` that returned `{ params }` — that per-cell
   * override. Custom painters interpret the shape.
   */
  params?: unknown;
}

export interface CellPainter {
  paint(gc: CachedContext2D, p: CellPaintConfig): void;
}

export class CellRendererRegistry {
  private map = new Map<string, CellPainter>();
  register(name: string, painter: CellPainter): void {
    this.map.set(name, painter);
  }
  get(name: string): CellPainter {
    const p = this.map.get(name);
    if (!p) throw new Error(`[cgrid] unknown cellRenderer '${name}'`);
    return p;
  }
}

const PADDING = 6;
const HEADER_PADDING = 8;
const SORT_ICON_SIZE = 14;
const SORT_ICON_PAD = 8;

function paintBackground(gc: CachedContext2D, p: CellPaintConfig): void {
  // Skip the per-cell bg fill when the bundle already painted this bg.
  if (p.bg !== p.prefillColor) {
    gc.cache.fillStyle = p.bg;
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
  }
  if (p.flashAlpha && p.flashAlpha > 0) {
    gc.cache.save();
    gc.cache.globalAlpha = p.flashAlpha;
    // Cycle 4 / Task 11 — theme-driven flash color. Falls back to the
    // ag-grid yellow so the painter still renders something useful
    // when the theme variable hasn't been resolved (defensive).
    gc.cache.fillStyle = p.flashFromColor ?? '#fef3c7';
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    gc.cache.restore();
  }
}

export const textCell: CellPainter = {
  paint(gc, p) {
    paintBackground(gc, p);
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';
    const cy = p.bounds.y + p.bounds.h / 2;
    if (p.halign === 'right') {
      gc.cache.textAlign = 'right';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - PADDING, cy);
    } else if (p.halign === 'center') {
      gc.cache.textAlign = 'center';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w / 2, cy);
    } else {
      gc.cache.textAlign = 'left';
      gc.fillText(p.valueFormatted, p.bounds.x + PADDING, cy);
    }
  },
};

export const numberCell: CellPainter = {
  paint(gc, p) {
    paintBackground(gc, p);
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';
    const align: CanvasTextAlign = p.halign === 'left' || p.halign === 'center'
      ? p.halign
      : 'right';
    gc.cache.textAlign = align;
    const cy = p.bounds.y + p.bounds.h / 2;
    const x = align === 'right' ? p.bounds.x + p.bounds.w - PADDING
            : align === 'center' ? p.bounds.x + p.bounds.w / 2
            : p.bounds.x + PADDING;
    gc.fillText(p.valueFormatted, x, cy);
  },
};

export const checkboxCell: CellPainter = {
  paint(gc, p) {
    paintBackground(gc, p);
    const size = 14;
    const cx = p.bounds.x + p.bounds.w / 2 - size / 2;
    const cy = p.bounds.y + p.bounds.h / 2 - size / 2;
    gc.cache.strokeStyle = p.fg;
    gc.cache.lineWidth = 1;
    gc.strokeRect(cx + 0.5, cy + 0.5, size, size);
    if (p.value) {
      gc.beginPath();
      gc.moveTo(cx + 3, cy + size / 2);
      gc.lineTo(cx + size / 2 - 1, cy + size - 3);
      gc.lineTo(cx + size - 2, cy + 3);
      gc.stroke();
    }
  },
};

export const headerCell: CellPainter = {
  paint(gc, p) {
    // Bundle already painted headerBg for the entire header row; skip per-cell bg
    // unless the cell bg differs (e.g., a column override).
    paintBackground(gc, p);
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';
    gc.cache.textAlign = 'left';
    const cy = p.bounds.y + p.bounds.h / 2;
    gc.fillText(p.valueFormatted, p.bounds.x + HEADER_PADDING, cy);
    if (p.sortDirection) {
      const iconCx = p.bounds.x + p.bounds.w - SORT_ICON_PAD - SORT_ICON_SIZE / 2;
      drawIcon(
        gc,
        p.sortDirection === 'asc' ? 'chevron-up' : 'chevron-down',
        iconCx, cy, SORT_ICON_SIZE,
        { color: p.iconColor ?? p.fg, strokeWidth: 2 },
      );
      // Cycle 8 / Task 1 — sort-order badge. Paints a tiny 1-indexed
      // number to the LEFT of the chevron when the cell participates
      // in a multi-column sort (sortTotal > 1). Drawn at 80% font size,
      // 75% alpha so the chevron stays the primary marker.
      if (p.sortTotal !== undefined && p.sortTotal > 1
          && p.sortIndex !== undefined && p.sortIndex > 0) {
        const badgeFont = scaleFontSize(p.font, 0.8);
        const baseColor = p.iconColor ?? p.fg;
        gc.cache.save();
        gc.cache.globalAlpha = 0.75;
        gc.cache.fillStyle = baseColor;
        gc.cache.font = badgeFont;
        gc.cache.textAlign = 'right';
        gc.cache.textBaseline = 'middle';
        const badgeX = p.bounds.x + p.bounds.w - SORT_ICON_PAD - SORT_ICON_SIZE - 2;
        gc.fillText(String(p.sortIndex), badgeX, cy);
        gc.cache.restore();
      }
    } else if (p.unSortIcon) {
      // Cycle 8 / Task 5 — faint up/down chevron pair on sortable
      // columns that aren't currently sorted. Slotted in the same slot
      // the active chevron would take so the icon never reflows when
      // a sort lands on the column. Paints at 50% alpha so it stays a
      // hint, not a focal point.
      const iconCx = p.bounds.x + p.bounds.w - SORT_ICON_PAD - SORT_ICON_SIZE / 2;
      gc.cache.save();
      gc.cache.globalAlpha = 0.5;
      drawIcon(
        gc,
        'chevrons-up-down',
        iconCx, cy, SORT_ICON_SIZE,
        { color: p.unSortIconColor ?? p.fg, strokeWidth: 2 },
      );
      gc.cache.restore();
    }
  },
};

/** Scale the numeric `px` size of a CSS font string by `factor`.
 *  Falls back to the original font when no `Npx` token is found —
 *  defensive against custom theme fonts that already use shorthand. */
function scaleFontSize(font: string, factor: number): string {
  return font.replace(/(\d+(?:\.\d+)?)px/, (_, n) => {
    const next = Math.max(8, Math.round(Number(n) * factor));
    return `${next}px`;
  });
}
