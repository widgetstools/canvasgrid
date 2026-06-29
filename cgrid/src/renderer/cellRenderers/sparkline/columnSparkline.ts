import type { CachedContext2D } from '../../gc';
import type { CellPaintConfig } from '../registry';
import type { SparklineColumnOptions } from './types';

/**
 * Cycle 21 / Task 2 — vertical-bar sparkline.
 *
 * Each data point becomes one column; column width is the inner cell
 * width divided across N data points, minus a 1px gap by default. Bars
 * grow up from the cell's baseline at the bottom of the inner band.
 * Allocation-free hot path — one `fillRect` per data point, no
 * intermediate arrays or path construction.
 */
export function paintColumnSparkline(gc: CachedContext2D, p: CellPaintConfig): void {
  const data = p.value as readonly number[] | null | undefined;
  if (!data || data.length === 0) return;

  const opts = ((p.params as { sparkline?: { options?: SparklineColumnOptions } } | undefined)
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
  // Baseline = min, not zero — sparklines exist to show RELATIVE
  // change, and a $187→$163 price series collapses to a wall of
  // ceiling-high bars when normalized against zero. Min-baselining
  // surfaces the variation that's the entire reason for the cell.
  // Constant series falls back to range = 1 (the painter renders a
  // single row of zero-height bars, which reads correctly as "flat").
  const baseline = min;
  const range = max - baseline || 1;

  const gap = opts?.gap ?? 1;
  const bandWidth = w / data.length;
  const barWidth = Math.max(1, bandWidth - gap);

  gc.cache.fillStyle = opts?.fill ?? p.fg;
  const bottom = y0 + h;
  for (let i = 0; i < data.length; i++) {
    const norm = (data[i]! - baseline) / range;
    const barH = norm * h;
    const x = x0 + i * bandWidth;
    gc.fillRect(x, bottom - barH, barWidth, barH);
  }
}
