import type { CachedContext2D } from '../../gc';
import type { CellPaintConfig } from '../registry';
import type { SparklineLineOptions } from './types';

/**
 * Cycle 21 / Task 1 — line variant of the canvas-painted sparkline.
 *
 * Hot path. The cell paints inline alongside thousands of others, so the
 * painter computes min/max + the polyline in a single pass and allocates
 * zero per-frame objects. Values outside the data range collapse to a
 * flat line at the cell's vertical midpoint (range fallback prevents
 * NaN coords on constant series).
 */
export function paintLineSparkline(gc: CachedContext2D, p: CellPaintConfig): void {
  const data = p.value as readonly number[] | null | undefined;
  // < 2 points → no polyline to draw. Guarding here (not at the dispatch
  // site) keeps the line painter self-contained and matches the variant
  // contract for Task 2's sibling painters.
  if (!data || data.length < 2) return;

  const opts = ((p.params as { sparkline?: { options?: SparklineLineOptions } } | undefined)
    ?.sparkline?.options) ?? undefined;

  // Cell bounds shrunk by 2px on every side so the stroke never bleeds
  // into the cell-divider rhythm or the next column.
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
  const stepDenom = data.length - 1; // ≥ 1 because length ≥ 2

  gc.cache.strokeStyle = opts?.lineColor ?? p.fg;
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
