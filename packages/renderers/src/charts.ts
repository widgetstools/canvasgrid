// @cgrid/renderers — category 6: In-cell charts. Catalog §3.6.
// Skeleton painters (final signatures; Phase B/C tasks fill in `paint`).
// Params types: see types.ts (WinLossSparklineParams, YieldCurveSparklineParams, …).
//
// Kernel re-exports (§2.6.5): line/column/area/bar/pie sparklines already ship in
// `@cgrid/kernel` (single `'sparkline'` registration, variant-dispatched via
// `cellRendererParams.sparkline.type`). This task only reserves the five canonical
// names in the RENDERER_NAMES table; the actual re-export (or a thin per-variant
// adapter, if the bridge ends up registering them as distinct names) is wired in
// a later cycle-21f task — these five consts below are placeholders carrying the
// final `CellPainter` signature so callers importing by name don't break across
// that follow-up task's landing.

import type { CellPainter } from '@cgrid/kernel';

/** Catalog §3.6 WinLossSparkline (new) — params: `WinLossSparklineParams`. */
export const winLossSparkline: CellPainter = {
  paint() {
    throw new Error('not implemented: win-loss-sparkline');
  },
};

/** Catalog §3.6 YieldCurveSparkline (new) — params: `YieldCurveSparklineParams`. */
export const yieldCurveSparkline: CellPainter = {
  paint() {
    throw new Error('not implemented: yield-curve-sparkline');
  },
};

/** Catalog §3.6 KRDBarChart (new) — params: `KRDBarChartParams`. */
export const krdBarChart: CellPainter = {
  paint() {
    throw new Error('not implemented: krd-bar-chart');
  },
};

/** Catalog §3.6 DepthLadderCell (new) — params: `DepthLadderCellParams`. */
export const depthLadderCell: CellPainter = {
  paint() {
    throw new Error('not implemented: depth-ladder');
  },
};

/** Catalog §3.6 LineSparkline — re-export of kernel's existing sparkline (line variant). */
export const lineSparkline: CellPainter = {
  paint() {
    throw new Error('not implemented: line-sparkline');
  },
};

/** Catalog §3.6 (bar family) — re-export of kernel's existing sparkline (column variant). */
export const columnSparkline: CellPainter = {
  paint() {
    throw new Error('not implemented: column-sparkline');
  },
};

/** Catalog §3.6 AreaSparkline — re-export of kernel's existing sparkline (area variant). */
export const areaSparkline: CellPainter = {
  paint() {
    throw new Error('not implemented: area-sparkline');
  },
};

/** Catalog §3.6 BarSparkline — re-export of kernel's existing sparkline (bar variant). */
export const barSparkline: CellPainter = {
  paint() {
    throw new Error('not implemented: bar-sparkline');
  },
};

/** Catalog §3.6 (pie family) — re-export of kernel's existing sparkline (pie variant). */
export const pieSparkline: CellPainter = {
  paint() {
    throw new Error('not implemented: pie-sparkline');
  },
};
