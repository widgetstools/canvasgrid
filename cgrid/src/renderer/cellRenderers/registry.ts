import type { CachedContext2D } from '../gc';

export interface CellPaintParams<T = unknown> {
  value: T;
  valueFormatted: string;
  bounds: { x: number; y: number; w: number; h: number };
  style: { font: string; fg: string; bg: string; borderColor: string; halign: 'left' | 'right' | 'center' };
  flashAlpha?: number;
  isFocused: boolean;
  isSelected: boolean;
  isHovered: boolean;
}

export interface CellPainter<T = unknown> {
  paint(gc: CachedContext2D, params: CellPaintParams<T>): void;
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

function paintBackground(gc: CachedContext2D, p: CellPaintParams): void {
  const { x, y, w, h } = p.bounds;
  gc.cache.fillStyle = p.style.bg;
  gc.fillRect(x, y, w, h);
  // Bottom-only row divider — no vertical column dividers, matches reference design.
  gc.cache.strokeStyle = p.style.borderColor;
  gc.cache.lineWidth = 1;
  gc.beginPath();
  gc.moveTo(x, y + h - 0.5);
  gc.lineTo(x + w, y + h - 0.5);
  gc.stroke();
  if (p.flashAlpha && p.flashAlpha > 0) {
    gc.cache.save();
    gc.cache.globalAlpha = p.flashAlpha;
    gc.cache.fillStyle = '#fef3c7';
    gc.fillRect(x, y, w, h);
    gc.cache.restore();
  }
}

export const textCell: CellPainter<string> = {
  paint(gc, p) {
    paintBackground(gc, p);
    gc.cache.fillStyle = p.style.fg;
    gc.cache.font = p.style.font;
    gc.cache.textBaseline = 'middle';
    const cy = p.bounds.y + p.bounds.h / 2;
    if (p.style.halign === 'right') {
      gc.cache.textAlign = 'right';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - PADDING, cy);
    } else if (p.style.halign === 'center') {
      gc.cache.textAlign = 'center';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w / 2, cy);
    } else {
      gc.cache.textAlign = 'left';
      gc.fillText(p.valueFormatted, p.bounds.x + PADDING, cy);
    }
  },
};

export const numberCell: CellPainter<number> = {
  paint(gc, p) {
    paintBackground(gc, p);
    gc.cache.fillStyle = p.style.fg;
    gc.cache.font = p.style.font;
    gc.cache.textBaseline = 'middle';
    const align: CanvasTextAlign = p.style.halign === 'left' || p.style.halign === 'center'
      ? p.style.halign
      : 'right';
    gc.cache.textAlign = align;
    const cy = p.bounds.y + p.bounds.h / 2;
    const x = align === 'right' ? p.bounds.x + p.bounds.w - PADDING
            : align === 'center' ? p.bounds.x + p.bounds.w / 2
            : p.bounds.x + PADDING;
    gc.fillText(p.valueFormatted, x, cy);
  },
};

export const checkboxCell: CellPainter<boolean> = {
  paint(gc, p) {
    paintBackground(gc, p);
    const size = 14;
    const cx = p.bounds.x + p.bounds.w / 2 - size / 2;
    const cy = p.bounds.y + p.bounds.h / 2 - size / 2;
    gc.cache.strokeStyle = p.style.fg;
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
