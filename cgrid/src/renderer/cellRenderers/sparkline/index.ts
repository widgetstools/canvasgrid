import type { CellPainter, CellPaintConfig } from '../registry';
import type { CachedContext2D } from '../../gc';
import type { SparklineParams } from './types';
import { paintLineSparkline } from './lineSparkline';

/**
 * Cycle 21 — sparkline cell renderer (single registered name, variant
 * dispatched per cell). Reads `cellRendererParams.sparkline.type` to
 * pick a painter; Task 1 wires the line variant — Task 2 plugs the
 * column / area / bar / pie sibling painters in alongside.
 *
 * Hot path: every variant is a single-pass, allocation-free painter
 * that writes directly into the shared `CachedContext2D`.
 */
export const sparklineCell: CellPainter = {
  paint(gc: CachedContext2D, p: CellPaintConfig): void {
    const params = p.params as { sparkline?: SparklineParams } | undefined;
    const type = params?.sparkline?.type ?? 'line';
    switch (type) {
      case 'line':
        paintLineSparkline(gc, p);
        break;
    }
  },
};

export { paintLineSparkline } from './lineSparkline';
export type {
  SparklineType,
  SparklineParams,
  SparklineLineOptions,
  SparklineColumnOptions,
  SparklineAreaOptions,
  SparklineBarOptions,
  SparklinePieOptions,
} from './types';
