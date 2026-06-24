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
  // Flash overlay (already supported; carries through)
  flashAlpha?: number;
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
    gc.cache.fillStyle = '#fef3c7';
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
    }
  },
};
