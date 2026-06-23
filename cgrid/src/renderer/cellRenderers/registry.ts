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
  paint(ctx: CanvasRenderingContext2D, params: CellPaintParams<T>): void;
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

function paintBackground(ctx: CanvasRenderingContext2D, p: CellPaintParams): void {
  const { x, y, w, h } = p.bounds;
  ctx.fillStyle = p.style.bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = p.style.borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);  // crisp 1px line
  if (p.flashAlpha && p.flashAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = p.flashAlpha;
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
}

export const textCell: CellPainter<string> = {
  paint(ctx, p) {
    paintBackground(ctx, p);
    ctx.fillStyle = p.style.fg;
    ctx.font = p.style.font;
    ctx.textBaseline = 'middle';
    const cy = p.bounds.y + p.bounds.h / 2;
    if (p.style.halign === 'right') {
      ctx.textAlign = 'right';
      ctx.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - PADDING, cy);
    } else if (p.style.halign === 'center') {
      ctx.textAlign = 'center';
      ctx.fillText(p.valueFormatted, p.bounds.x + p.bounds.w / 2, cy);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(p.valueFormatted, p.bounds.x + PADDING, cy);
    }
  },
};

export const numberCell: CellPainter<number> = {
  paint(ctx, p) {
    paintBackground(ctx, p);
    ctx.fillStyle = p.style.fg;
    ctx.font = p.style.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = p.style.halign === 'center' ? 'center' : 'right';
    const cy = p.bounds.y + p.bounds.h / 2;
    const x = ctx.textAlign === 'right' ? p.bounds.x + p.bounds.w - PADDING
            : p.bounds.x + p.bounds.w / 2;
    ctx.fillText(p.valueFormatted, x, cy);
  },
};

export const checkboxCell: CellPainter<boolean> = {
  paint(ctx, p) {
    paintBackground(ctx, p);
    const size = 14;
    const cx = p.bounds.x + p.bounds.w / 2 - size / 2;
    const cy = p.bounds.y + p.bounds.h / 2 - size / 2;
    ctx.strokeStyle = p.style.fg;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, size, size);
    if (p.value) {
      ctx.beginPath();
      ctx.moveTo(cx + 3, cy + size / 2);
      ctx.lineTo(cx + size / 2 - 1, cy + size - 3);
      ctx.lineTo(cx + size - 2, cy + 3);
      ctx.stroke();
    }
  },
};
