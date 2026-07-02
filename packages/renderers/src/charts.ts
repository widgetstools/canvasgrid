// @cgrid/renderers — category 6: In-cell charts. Catalog §3.6.
// Four new painters + five thin adapters re-exporting kernel sparkline variants.

import type { CellPaintConfig, CellPainter } from '@cgrid/kernel';
import { coerceToNumberArray } from '@kernel-src/renderer/cellRenderers/sparkline/coerceToNumberArray';
import { paintLineSparkline } from '@kernel-src/renderer/cellRenderers/sparkline/lineSparkline';
import { paintColumnSparkline } from '@kernel-src/renderer/cellRenderers/sparkline/columnSparkline';
import { paintAreaSparkline } from '@kernel-src/renderer/cellRenderers/sparkline/areaSparkline';
import { paintBarSparkline } from '@kernel-src/renderer/cellRenderers/sparkline/barSparkline';
import { paintPieSparkline } from '@kernel-src/renderer/cellRenderers/sparkline/pieSparkline';
import type { SparklineType } from '@kernel-src/renderer/cellRenderers/sparkline/types';
import { dot, fragText, withAlpha } from './paintUtils';
import { SEMANTIC_COLORS } from './palette';
import type {
  DepthLadderCellParams,
  KRDBarChartParams,
  SemanticColorMap,
  WinLossSparklineParams,
  YieldCurveSparklineParams,
} from './types';

type Gc = Parameters<CellPainter['paint']>[0];

const colorScratch: Required<SemanticColorMap> = {
  positive: SEMANTIC_COLORS.positive,
  negative: SEMANTIC_COLORS.negative,
  warning: SEMANTIC_COLORS.warning,
  info: SEMANTIC_COLORS.info,
  muted: SEMANTIC_COLORS.muted,
};

const sparklineParamsScratch: { sparkline?: { type: SparklineType; options?: unknown } } = {};

function colorsFromParams(overrides?: SemanticColorMap): Required<SemanticColorMap> {
  colorScratch.positive = overrides?.positive ?? SEMANTIC_COLORS.positive;
  colorScratch.negative = overrides?.negative ?? SEMANTIC_COLORS.negative;
  colorScratch.warning = overrides?.warning ?? SEMANTIC_COLORS.warning;
  colorScratch.info = overrides?.info ?? SEMANTIC_COLORS.info;
  colorScratch.muted = overrides?.muted ?? SEMANTIC_COLORS.muted;
  return colorScratch;
}

function toNumberArray(value: unknown): readonly number[] | null {
  if (Array.isArray(value)) return value as readonly number[];
  return coerceToNumberArray(value);
}

function rowArray(row: Record<string, unknown> | undefined, field: string): readonly number[] | null {
  if (!row) return null;
  return toNumberArray(row[field]);
}

function innerBounds(p: CellPaintConfig): { x0: number; y0: number; w: number; h: number } {
  return {
    x0: p.bounds.x + 2,
    y0: p.bounds.y + 2,
    w: p.bounds.w - 4,
    h: p.bounds.h - 4,
  };
}

function makeSparklineAdapter(
  type: SparklineType,
  paint: (gc: Gc, p: CellPaintConfig) => void,
): CellPainter {
  return {
    paint(gc, p) {
      const data = coerceToNumberArray(p.value);
      if (!data) return;
      const originalValue = p.value;
      const originalParams = p.params;
      p.value = data;
      const base = (typeof originalParams === 'object' && originalParams ? originalParams : {}) as Record<string, unknown>;
      const prior = (base.sparkline as { options?: unknown } | undefined) ?? {};
      sparklineParamsScratch.sparkline = { ...prior, type };
      p.params = { ...base, sparkline: sparklineParamsScratch.sparkline };
      try {
        paint(gc, p);
      } finally {
        p.value = originalValue;
        p.params = originalParams;
      }
    },
  };
}

/** Catalog §3.6 WinLossSparkline — 1px-wide binary up/down bars. */
export const winLossSparkline: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as WinLossSparklineParams;
    const colors = colorsFromParams(params.colors);
    const row = p.rowData as Record<string, unknown> | undefined;
    const data = rowArray(row, params.valuesField) ?? toNumberArray(p.value);
    if (!data || data.length === 0) return;
    const { x0, y0, w, h } = innerBounds(p);
    const midY = y0 + h / 2;
    const slotW = Math.max(1, w / data.length);
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      const color = v >= 0 ? colors.positive : colors.negative;
      const x = x0 + i * slotW;
      const y = v >= 0 ? midY - h * 0.35 : midY;
      const barH = h * 0.35;
      gc.cache.fillStyle = color;
      gc.fillRect(x, y, Math.max(1, slotW - 0.5), barH);
    }
    gc.cache.strokeStyle = withAlpha(colors.muted, 0.5);
    gc.cache.lineWidth = 1;
    gc.beginPath();
    gc.moveTo(x0, midY);
    gc.lineTo(x0 + w, midY);
    gc.stroke();
  },
};

/** Catalog §3.6 YieldCurveSparkline — multi-tenor line with labels and marker. */
export const yieldCurveSparkline: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as YieldCurveSparklineParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const data = rowArray(row, params.valuesField);
    if (!data || data.length < 2 || params.tenors.length < 2) return;
    const { x0, y0, w, h } = innerBounds(p);
    const labelH = 10;
    const chartH = h - labelH;
    let min = data[0]!;
    let max = data[0]!;
    for (let i = 1; i < data.length; i++) {
      if (data[i]! < min) min = data[i]!;
      if (data[i]! > max) max = data[i]!;
    }
    const range = max - min || 1;
    const step = (data.length - 1) || 1;
    gc.cache.strokeStyle = SEMANTIC_COLORS.info;
    gc.cache.lineWidth = 1.25;
    gc.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = x0 + (i / step) * w;
      const y = y0 + (1 - (data[i]! - min) / range) * chartH;
      if (i === 0) gc.moveTo(x, y);
      else gc.lineTo(x, y);
    }
    gc.stroke();
    const markerTenor = params.markerTenor
      ?? (params.markerTenorField && row ? String(row[params.markerTenorField] ?? '') : '');
    const markerIdx = markerTenor ? params.tenors.indexOf(markerTenor) : -1;
    if (markerIdx >= 0 && markerIdx < data.length) {
      const mx = x0 + (markerIdx / step) * w;
      const my = y0 + (1 - (data[markerIdx]! - min) / range) * chartH;
      dot(gc, mx, my, 2.5, SEMANTIC_COLORS.warning);
    }
    gc.cache.font = `400 9px ${p.font.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif'}`;
    for (let i = 0; i < params.tenors.length && i < data.length; i++) {
      const x = x0 + (i / step) * w;
      fragText(gc, params.tenors[i]!, x, y0 + chartH + 8, {
        color: withAlpha(p.fg, 0.65),
        align: 'center',
      });
    }
  },
};

/** Catalog §3.6 KRDBarChart — micro histogram per tenor bucket. */
export const krdBarChart: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as KRDBarChartParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const data = rowArray(row, params.valuesField);
    if (!data || data.length === 0) return;
    const { x0, y0, w, h } = innerBounds(p);
    let maxAbs = 0;
    for (let i = 0; i < data.length; i++) maxAbs = Math.max(maxAbs, Math.abs(data[i]!));
    if (maxAbs === 0) maxAbs = 1;
    const midY = y0 + h / 2;
    const slotW = w / data.length;
    const barW = Math.max(1, slotW - 2);
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      const barH = (Math.abs(v) / maxAbs) * (h * 0.45);
      const color = v >= 0 ? SEMANTIC_COLORS.positive : SEMANTIC_COLORS.negative;
      gc.cache.fillStyle = color;
      if (v >= 0) gc.fillRect(x0 + i * slotW + 1, midY - barH, barW, barH);
      else gc.fillRect(x0 + i * slotW + 1, midY, barW, barH);
    }
    gc.cache.strokeStyle = withAlpha(SEMANTIC_COLORS.muted, 0.4);
    gc.beginPath();
    gc.moveTo(x0, midY);
    gc.lineTo(x0 + w, midY);
    gc.stroke();
  },
};

/** Catalog §3.6 DepthLadderCell — mini order book ladder. */
export const depthLadderCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as DepthLadderCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    if (!row) return;
    const levels = Math.max(1, Math.min(5, params.levels ?? 3));
    const bidPx = rowArray(row, params.bidPricesField);
    const bidSz = rowArray(row, params.bidSizesField);
    const askPx = rowArray(row, params.askPricesField);
    const askSz = rowArray(row, params.askSizesField);
    if (!bidPx || !bidSz || !askPx || !askSz) return;
    const { x0, y0, w, h } = innerBounds(p);
    const mid = x0 + w / 2;
    const rowH = h / levels;
    let maxSz = 1;
    for (let i = 0; i < levels; i++) {
      maxSz = Math.max(maxSz, Math.abs(bidSz[i] ?? 0), Math.abs(askSz[i] ?? 0));
    }
    for (let i = 0; i < levels; i++) {
      const y = y0 + i * rowH + 1;
      const bSz = bidSz[i] ?? 0;
      const aSz = askSz[i] ?? 0;
      const bBar = (Math.abs(bSz) / maxSz) * (w * 0.38);
      const aBar = (Math.abs(aSz) / maxSz) * (w * 0.38);
      gc.cache.fillStyle = withAlpha(SEMANTIC_COLORS.negative, 0.35);
      gc.fillRect(mid - bBar, y, bBar, rowH - 2);
      gc.cache.fillStyle = withAlpha(SEMANTIC_COLORS.positive, 0.35);
      gc.fillRect(mid, y, aBar, rowH - 2);
      const price = bidPx[i] !== undefined && askPx[i] !== undefined
        ? String(((bidPx[i]! + askPx[i]!) / 2).toFixed(2))
        : '';
      if (price) {
        fragText(gc, price, mid, y + rowH * 0.7, {
          font: `400 9px ${p.font.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif'}`,
          color: p.fg,
          align: 'center',
        });
      }
    }
  },
};

/** Catalog §3.6 LineSparkline — kernel re-export (line variant). */
export const lineSparkline = makeSparklineAdapter('line', paintLineSparkline);

/** Catalog §3.6 ColumnSparkline — kernel re-export (column variant). */
export const columnSparkline = makeSparklineAdapter('column', paintColumnSparkline);

/** Catalog §3.6 AreaSparkline — kernel re-export (area variant). */
export const areaSparkline = makeSparklineAdapter('area', paintAreaSparkline);

/** Catalog §3.6 BarSparkline — kernel re-export (bar variant). */
export const barSparkline = makeSparklineAdapter('bar', paintBarSparkline);

/** Catalog §3.6 PieSparkline — kernel re-export (pie variant). */
export const pieSparkline = makeSparklineAdapter('pie', paintPieSparkline);
