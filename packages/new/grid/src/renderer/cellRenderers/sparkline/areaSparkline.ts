import type { CachedContext2D } from '../../gc';
import type { CellPaintConfig } from '../registry';
import type { SparklineAreaOptions } from './types';

/**
 * Cycle 21 / Task 2 — area sparkline.
 *
 * Same polyline as the line variant, plus a translucent fill closing
 * down to the cell's baseline. Two-pass paint: fill the closed shape
 * first (so the stroke lands cleanly on top), then stroke the open
 * polyline. Allocation-free — each pass reads the data twice but
 * builds nothing on the heap.
 */
export function paintAreaSparkline(gc: CachedContext2D, p: CellPaintConfig): void {
  const data = p.value as readonly number[] | null | undefined;
  if (!data || data.length < 2) return;

  const opts = ((p.params as { sparkline?: { options?: SparklineAreaOptions } } | undefined)
    ?.sparkline?.options) ?? undefined;

  const x0 = p.bounds.x + 2;
  const y0 = p.bounds.y + 2;
  const w = p.bounds.w - 4;
  const h = p.bounds.h - 4;

  let min = data[0]!;
  let max = data[0]!;
  for (let i = 1; i < data.length; i++) {
    const v = data[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const stepDenom = data.length - 1;

  const lineColor = opts?.lineColor ?? p.fg;
  const fillColor = opts?.fill ?? withAlpha(lineColor, 0.15);

  // Pass 1 — closed shape, filled.
  gc.cache.fillStyle = fillColor;
  gc.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = x0 + (i / stepDenom) * w;
    const y = y0 + (1 - (data[i]! - min) / range) * h;
    if (i === 0) gc.moveTo(x, y);
    else gc.lineTo(x, y);
  }
  // Close down to the baseline so the fill always sits below the polyline.
  gc.lineTo(x0 + w, y0 + h);
  gc.lineTo(x0, y0 + h);
  gc.fill();

  // Pass 2 — open polyline, stroked.
  gc.cache.strokeStyle = lineColor;
  gc.cache.lineWidth = opts?.lineWidth ?? 1;
  gc.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = x0 + (i / stepDenom) * w;
    const y = y0 + (1 - (data[i]! - min) / range) * h;
    if (i === 0) gc.moveTo(x, y);
    else gc.lineTo(x, y);
  }
  gc.stroke();
}

/** Cheap CSS color → translucent variant. Only handles `#rrggbb` /
 *  `#rrggbbaa` literals; everything else (rgba(), named colors, vars)
 *  falls back to the original string so apps can supply their own
 *  translucent fill explicitly when needed. */
function withAlpha(color: string, alpha: number): string {
  if (color.length === 7 && color[0] === '#') {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
      .toString(16).padStart(2, '0');
    return color + a;
  }
  return color;
}
