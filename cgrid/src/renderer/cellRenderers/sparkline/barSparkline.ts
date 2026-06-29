import type { CachedContext2D } from '../../gc';
import type { CellPaintConfig } from '../registry';
import type { SparklineBarOptions } from './types';

/**
 * Cycle 21 / Task 2 — horizontal-bar sparkline (rotated column).
 *
 * One bar per data point, growing rightward from the left edge of the
 * inner band. Useful for ranking-style sparklines (top-N rows where the
 * bar length is the value). Single-pass, allocation-free: one
 * `fillRect` per row.
 */
export function paintBarSparkline(gc: CachedContext2D, p: CellPaintConfig): void {
  const data = p.value as readonly number[] | null | undefined;
  if (!data || data.length === 0) return;

  const opts = ((p.params as { sparkline?: { options?: SparklineBarOptions } } | undefined)
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
  // Min-baselined (see columnSparkline.ts for the reasoning); the
  // horizontal bar variant inherits the same need to surface relative
  // variation instead of magnitudes.
  const baseline = min;
  const range = max - baseline || 1;

  const gap = opts?.gap ?? 1;
  const bandHeight = h / data.length;
  const barHeight = Math.max(1, bandHeight - gap);

  gc.cache.fillStyle = opts?.fill ?? p.fg;
  for (let i = 0; i < data.length; i++) {
    const norm = (data[i]! - baseline) / range;
    const barW = norm * w;
    const y = y0 + i * bandHeight;
    gc.fillRect(x0, y, barW, barHeight);
  }
}
