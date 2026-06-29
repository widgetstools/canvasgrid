import type { CellPainter, CellPaintConfig } from '../registry';
import type { CachedContext2D } from '../../gc';
import type { SparklineParams } from './types';
import { paintLineSparkline } from './lineSparkline';
import { paintColumnSparkline } from './columnSparkline';
import { paintAreaSparkline } from './areaSparkline';
import { paintBarSparkline } from './barSparkline';
import { paintPieSparkline } from './pieSparkline';
import { coerceToNumberArray } from './coerceToNumberArray';

/**
 * Cycle 21 — sparkline cell renderer (single registered name, variant
 * dispatched per cell). Reads `cellRendererParams.sparkline.type` to
 * pick a painter; Task 1 wired `line`, Task 2 plugs in `column` /
 * `area` / `bar` / `pie` sibling painters through the same dispatch.
 *
 * Hot path: every variant is a single-pass, allocation-free painter
 * that writes directly into the shared `CachedContext2D`. An
 * unrecognized `type` is a no-op so apps that ship an unknown variant
 * see an empty cell instead of a hard throw.
 */
export const sparklineCell: CellPainter = {
  paint(gc: CachedContext2D, p: CellPaintConfig): void {
    const params = p.params as { sparkline?: SparklineParams } | undefined;
    const type = params?.sparkline?.type ?? 'line';
    // Normalize the cell value to a `readonly number[]` once at the
    // dispatch site so every variant works against the same shape.
    // The worker's chunkFormat ships array-typed columns as
    // comma-separated text; the parsed result is cached by string
    // reference so each chunk only pays the parse cost once.
    const data = coerceToNumberArray(p.value);
    if (!data) return;
    // Mutate p.value so the variant painters read the parsed array.
    // Restoring afterwards keeps `applyCellProps`'s reusable config
    // object pristine for the next cell.
    const original = p.value;
    p.value = data;
    try {
      switch (type) {
        case 'line': paintLineSparkline(gc, p); break;
        case 'column': paintColumnSparkline(gc, p); break;
        case 'area': paintAreaSparkline(gc, p); break;
        case 'bar': paintBarSparkline(gc, p); break;
        case 'pie': paintPieSparkline(gc, p); break;
      }
    } finally {
      p.value = original;
    }
  },
};

export { paintLineSparkline } from './lineSparkline';
export { paintColumnSparkline } from './columnSparkline';
export { paintAreaSparkline } from './areaSparkline';
export { paintBarSparkline } from './barSparkline';
export { paintPieSparkline } from './pieSparkline';
export type {
  SparklineType,
  SparklineParams,
  SparklineLineOptions,
  SparklineColumnOptions,
  SparklineAreaOptions,
  SparklineBarOptions,
  SparklinePieOptions,
} from './types';
