import type { CachedContext2D } from '../../gc';
import type { CellPaintConfig } from '../registry';
import type { SparklinePieOptions } from './types';

/**
 * Cycle 21 / Task 2 — donut-style single-segment sparkline.
 *
 * Encodes `data[0] / data[1]` as a filled arc on a thin ring. `[part,
 * whole]` is the canonical shape (e.g. progress toward a target);
 * arrays with more entries treat the first value as `part` and the
 * sum as `whole`. Renders a faint track behind the segment so a
 * `part === 0` ring still reads as a chart rather than a blank cell.
 */
export function paintPieSparkline(gc: CachedContext2D, p: CellPaintConfig): void {
  const data = p.value as readonly number[] | null | undefined;
  if (!data || data.length === 0) return;

  const opts = ((p.params as { sparkline?: { options?: SparklinePieOptions } } | undefined)
    ?.sparkline?.options) ?? undefined;

  const x0 = p.bounds.x + 2;
  const y0 = p.bounds.y + 2;
  const w = p.bounds.w - 4;
  const h = p.bounds.h - 4;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const outerR = Math.min(w, h) / 2;
  if (outerR <= 0) return;
  const innerR = outerR * 0.55;

  // Single-segment ring contract:
  //   length === 1: degenerate (no second magnitude to compare); skip.
  //   length === 2: classic part/whole — `[actual, target]`.
  //   length  >  2: reduce a time series to "latest vs. rolling high"
  //                 so the same `priceHistory` column the line / column
  //                 / area / bar variants consume produces a meaningful
  //                 ring without needing a second pre-computed field.
  let part: number;
  let whole: number;
  if (data.length === 1) return;
  if (data.length === 2) {
    part = data[0]!;
    whole = data[1]!;
  } else {
    part = data[data.length - 1]!;
    let max = data[0]!;
    for (let i = 1; i < data.length; i++) if (data[i]! > max) max = data[i]!;
    whole = max;
  }
  const fraction = whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;

  // Track ring — faint background so the cell always reads as a chart
  // even when the segment is zero.
  const trackColor = opts?.trackColor ?? withAlpha(p.fg, 0.15);
  gc.cache.fillStyle = trackColor;
  drawAnnulus(gc, cx, cy, innerR, outerR, -Math.PI / 2, Math.PI * 1.5);

  // Filled segment.
  if (fraction > 0) {
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * fraction;
    gc.cache.fillStyle = opts?.fill ?? p.fg;
    drawAnnulus(gc, cx, cy, innerR, outerR, start, end);
  } else {
    // Stable trailing fillStyle so callers / tests can introspect a
    // deterministic value when no segment is drawn. The fillStyle was
    // last set to the track color; leave it as-is.
  }
}

function drawAnnulus(
  gc: CachedContext2D,
  cx: number, cy: number,
  innerR: number, outerR: number,
  start: number, end: number,
): void {
  gc.beginPath();
  gc.arc(cx, cy, outerR, start, end, false);
  gc.arc(cx, cy, innerR, end, start, true);
  gc.fill();
}

function withAlpha(color: string, alpha: number): string {
  if (color.length === 7 && color[0] === '#') {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
      .toString(16).padStart(2, '0');
    return color + a;
  }
  return color;
}
