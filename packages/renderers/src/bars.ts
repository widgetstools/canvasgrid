// @cgrid/renderers — category 5: Bars / gauges. Catalog §3.5.

import type { CellPaintConfig, CellPainter } from '@cgrid/kernel';
import { dot, fragText, labInterpolate, miniBar, withAlpha } from './paintUtils';
import { SEMANTIC_COLORS, STATUS_PILL_MAP } from './palette';
import type {
  BidirectionalBarCellParams,
  GaugeCellParams,
  HeatCellParams,
  MaturityBucket,
  MaturityLadderBarParams,
  ProgressBarCellParams,
  RangeBarCellParams,
  SemanticColorMap,
  SpreadBarCellParams,
  VolumeBarParams,
} from './types';

type Gc = Parameters<CellPainter['paint']>[0];

const PAD = 6;
const BAR_H = 8;
const TRACK_COLOR = withAlpha(SEMANTIC_COLORS.muted, 0.18);

const MATURITY_ORDER: readonly MaturityBucket[] = [
  '0-1y', '1-3y', '3-5y', '5-10y', '10y+',
];

const MATURITY_COLORS: Readonly<Record<MaturityBucket, string>> = {
  '0-1y': withAlpha(SEMANTIC_COLORS.info, 0.55),
  '1-3y': withAlpha(SEMANTIC_COLORS.info, 0.75),
  '3-5y': withAlpha(SEMANTIC_COLORS.warning, 0.65),
  '5-10y': withAlpha(SEMANTIC_COLORS.warning, 0.85),
  '10y+': withAlpha(SEMANTIC_COLORS.positive, 0.7),
};

const colorScratch: Required<SemanticColorMap> = {
  positive: SEMANTIC_COLORS.positive,
  negative: SEMANTIC_COLORS.negative,
  warning: SEMANTIC_COLORS.warning,
  info: SEMANTIC_COLORS.info,
  muted: SEMANTIC_COLORS.muted,
};

function padLeft(p: CellPaintConfig): number {
  return p.padding?.left ?? PAD;
}

function padRight(p: CellPaintConfig): number {
  return p.padding?.right ?? PAD;
}

function textY(gc: Gc, p: CellPaintConfig): number {
  const m = gc.measureText('Mg');
  return p.bounds.y + p.bounds.h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function rowNumber(row: Record<string, unknown> | undefined, field?: string): number | null {
  if (!field || !row) return null;
  return toNumber(row[field]);
}

function colorsFromParams(overrides?: SemanticColorMap): Required<SemanticColorMap> {
  colorScratch.positive = overrides?.positive ?? SEMANTIC_COLORS.positive;
  colorScratch.negative = overrides?.negative ?? SEMANTIC_COLORS.negative;
  colorScratch.warning = overrides?.warning ?? SEMANTIC_COLORS.warning;
  colorScratch.info = overrides?.info ?? SEMANTIC_COLORS.info;
  colorScratch.muted = overrides?.muted ?? SEMANTIC_COLORS.muted;
  return colorScratch;
}

function innerBarRect(p: CellPaintConfig): { x: number; y: number; w: number; h: number } {
  return {
    x: p.bounds.x + padLeft(p),
    y: p.bounds.y + (p.bounds.h - BAR_H) / 2,
    w: p.bounds.w - padLeft(p) - padRight(p),
    h: BAR_H,
  };
}

function rollingMeanStd(values: readonly number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  const mean = sum / values.length;
  let varSum = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i]! - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / values.length) || 1;
  return { mean, std };
}

/** Fraction past which a right-aligned label sits ON the fill rather than
 *  in the empty track — B6's "never straddles the fill boundary" rule. */
const LABEL_ON_FILL_THRESHOLD = 0.8;

/** Catalog §3.5 ProgressBarCell — horizontal fill bar, text overlaid. */
export const progressBarCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as ProgressBarCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const fracRaw = params.fraction ?? rowNumber(row, params.fractionField) ?? toNumber(p.value);
    const frac = fracRaw === null ? 0 : Math.max(0, Math.min(1, fracRaw));
    const rect = innerBarRect(p);
    const fill = frac >= 1 ? SEMANTIC_COLORS.positive : SEMANTIC_COLORS.info;
    miniBar(gc, rect.x, rect.y, rect.w, rect.h, frac, fill, TRACK_COLOR);
    if (params.showLabel !== false) {
      // B6 — render as a percent (never the raw `0.72` fraction), drawn
      // AFTER the track/fill, right-aligned so it normally sits on the
      // empty side of the bar; once the fill crosses ~80% it would overlap
      // the label zone, so switch to a contrast color drawn ON the fill.
      const label = `${Math.round(frac * 100)}%`;
      const onFill = frac > LABEL_ON_FILL_THRESHOLD;
      fragText(gc, label, rect.x + rect.w, textY(gc, p), {
        font: p.font,
        color: onFill ? reverseOutFg(p) : p.fg,
        align: 'right',
      });
    }
  },
};

/** Catalog §3.5 RangeBarCell — range bar with endpoint labels and marker dot. */
export const rangeBarCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as RangeBarCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const min = rowNumber(row, params.minField);
    const max = rowNumber(row, params.maxField);
    const val = rowNumber(row, params.valueField) ?? toNumber(p.value);
    const rect = innerBarRect(p);
    miniBar(gc, rect.x, rect.y, rect.w, rect.h, 1, TRACK_COLOR);
    if (min !== null && max !== null && val !== null && max > min) {
      const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
      const cx = rect.x + t * rect.w;
      dot(gc, cx, rect.y + rect.h / 2, 3, SEMANTIC_COLORS.info);
      fragText(gc, String(min), rect.x, textY(gc, p), { font: p.font, color: withAlpha(p.fg, 0.7), align: 'left' });
      fragText(gc, String(max), rect.x + rect.w, textY(gc, p), { font: p.font, color: withAlpha(p.fg, 0.7), align: 'right' });
    }
  },
};

/** Catalog §3.5 BidirectionalBarCell — centre-zero left-red / right-green bar. */
export const bidirectionalBarCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as BidirectionalBarCellParams;
    const colors = colorsFromParams(params.colors);
    const row = p.rowData as Record<string, unknown> | undefined;
    const value = rowNumber(row, params.valueField) ?? toNumber(p.value);
    if (value === null) return;
    // F6 — params.stats is now the canonical nullable ColumnStatSnapshot;
    // degrade to the per-value fallback when maxAbs is null/0 (no data seen).
    const statsMaxAbs = params.stats?.maxAbs;
    const maxAbs = statsMaxAbs !== null && statsMaxAbs !== undefined && statsMaxAbs > 0
      ? statsMaxAbs
      : Math.abs(value) || 1;
    const rect = innerBarRect(p);
    const mid = rect.x + rect.w / 2;
    miniBar(gc, rect.x, rect.y, rect.w, rect.h, 1, TRACK_COLOR);
    const halfW = (Math.abs(value) / maxAbs) * (rect.w / 2);
    if (value < 0) {
      miniBar(gc, mid - halfW, rect.y, halfW, rect.h, 1, colors.negative);
    } else if (value > 0) {
      miniBar(gc, mid, rect.y, halfW, rect.h, 1, colors.positive);
    }
    if (p.valueFormatted) {
      fragText(gc, p.valueFormatted, p.bounds.x + p.bounds.w - padRight(p), textY(gc, p), {
        font: p.font,
        color: p.fg,
        align: 'right',
      });
    }
  },
};

/** Catalog §3.5 HeatCell — column-wide LAB gradient background tint. */
export const heatCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as HeatCellParams;
    const colors = colorsFromParams(params.colors);
    const value = toNumber(p.value);
    const stats = params.stats;
    let t = 0.5;
    // F6 — stats.min/max are nullable (ColumnStatSnapshot); count > 0
    // implies they're populated, but the type doesn't let TS infer that,
    // so check explicitly rather than degrading silently on a bad cast.
    if (
      value !== null && stats && stats.count > 0
      && stats.max !== null && stats.min !== null && stats.max > stats.min
    ) {
      t = Math.max(0, Math.min(1, (value - stats.min) / (stats.max - stats.min)));
    }
    const curve = params.curve ?? 'lab';
    const bg = labInterpolate(colors.negative, colors.positive, t, curve);
    gc.cache.fillStyle = withAlpha(bg, 0.22);
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    const text = p.valueFormatted || (value === null ? '' : String(value));
    if (text) {
      fragText(gc, text, p.bounds.x + p.bounds.w - padRight(p), textY(gc, p), {
        font: p.font,
        color: p.fg,
        align: 'right',
      });
    }
  },
};

/** Catalog §3.5 GaugeCell — segmented horizontal gauge with tick marker. */
export const gaugeCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as GaugeCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const value = params.value ?? rowNumber(row, params.valueField) ?? toNumber(p.value);
    const rect = innerBarRect(p);
    const zones = params.zones ?? [params.min, 0, params.max];
    const span = params.max - params.min || 1;
    for (let i = 0; i < zones.length - 1; i++) {
      const z0 = zones[i]!;
      const z1 = zones[i + 1]!;
      const x0 = rect.x + ((z0 - params.min) / span) * rect.w;
      const x1 = rect.x + ((z1 - params.min) / span) * rect.w;
      const zoneColor = z1 <= 0 ? SEMANTIC_COLORS.negative
        : z0 >= 0 ? SEMANTIC_COLORS.positive
        : withAlpha(SEMANTIC_COLORS.muted, 0.25);
      gc.cache.fillStyle = zoneColor;
      gc.fillRect(x0, rect.y, Math.max(0, x1 - x0), rect.h);
    }
    if (value !== null) {
      const tx = rect.x + ((value - params.min) / span) * rect.w;
      gc.cache.strokeStyle = p.fg;
      gc.cache.lineWidth = 2;
      gc.beginPath();
      gc.moveTo(tx, rect.y - 2);
      gc.lineTo(tx, rect.y + rect.h + 2);
      gc.stroke();
    }
  },
};

/** Catalog §3.5 SpreadBarCell — spread-width bar; amber 1σ / red 2σ vs rolling average. */
export const spreadBarCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as SpreadBarCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const bid = rowNumber(row, params.bidField);
    const ask = rowNumber(row, params.askField);
    if (bid === null || ask === null) return;
    const spread = ask - bid;
    const mid = (bid + ask) / 2;
    const history = params.history?.values ?? [];
    const { mean, std } = rollingMeanStd(history.length > 0 ? history : [spread]);
    const z = (spread - mean) / std;
    let barColor = withAlpha(SEMANTIC_COLORS.muted, 0.35);
    if (Math.abs(z) >= 2) barColor = withAlpha(SEMANTIC_COLORS.negative, 0.45);
    else if (Math.abs(z) >= 1) barColor = withAlpha(SEMANTIC_COLORS.warning, 0.45);
    const rect = innerBarRect(p);
    const frac = Math.max(0, Math.min(1, spread / (mean + std * 2 || spread || 1)));
    miniBar(gc, rect.x, rect.y, rect.w, rect.h, frac, barColor, TRACK_COLOR);
    // B6 — right-align outside the fill (same rule as progressBar/volumeBar)
    // instead of centering, so the mid-price label never straddles the
    // fill boundary; switch to a contrast color once the fill crosses it.
    const onFill = frac > LABEL_ON_FILL_THRESHOLD;
    fragText(gc, p.valueFormatted || String(mid.toFixed(2)), rect.x + rect.w, textY(gc, p), {
      font: p.font,
      color: onFill ? reverseOutFg(p) : p.fg,
      align: 'right',
    });
  },
};

/** Catalog §3.5 VolumeBar — bar sized to scope max volume, text overlay. */
export const volumeBar: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as VolumeBarParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const value = rowNumber(row, params.valueField) ?? toNumber(p.value);
    if (value === null) return;
    // F6 — degrade to the cell's own value when stats.max is null/0.
    const statsMax = params.stats?.max;
    const max = statsMax !== null && statsMax !== undefined && statsMax > 0 ? statsMax : value;
    const frac = Math.max(0, Math.min(1, value / max));
    const rect = innerBarRect(p);
    miniBar(gc, rect.x, rect.y, rect.w, rect.h, frac, withAlpha(SEMANTIC_COLORS.info, 0.45), TRACK_COLOR);
    const text = p.valueFormatted || String(value);
    // B6 — the label never straddles the fill boundary by default (not
    // opt-in): once the bar crosses ~80%, the right-aligned label sits ON
    // the fill and needs the contrast color. `reverseOutText: false`
    // explicitly opts back out of the auto-contrast.
    const onFill = params.reverseOutText !== false && frac > LABEL_ON_FILL_THRESHOLD;
    fragText(gc, text, p.bounds.x + p.bounds.w - padRight(p), textY(gc, p), {
      font: p.font,
      color: onFill ? reverseOutFg(p) : p.fg,
      align: 'right',
    });
  },
};

function reverseOutFg(p: CellPaintConfig): string {
  return p.themeKind === 'dark' ? p.fg : STATUS_PILL_MAP.REJECTED!.bg;
}

/** Catalog §3.5 MaturityLadderBar — segmented bar by tenor bucket. */
export const maturityLadderBar: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as MaturityLadderBarParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const fields = params.bucketFields ?? {};
    let total = 0;
    for (const bucket of MATURITY_ORDER) {
      const v = rowNumber(row, fields[bucket]);
      if (v !== null && v > 0) total += v;
    }
    const rect = innerBarRect(p);
    if (total <= 0) {
      miniBar(gc, rect.x, rect.y, rect.w, rect.h, 0, TRACK_COLOR, TRACK_COLOR);
      return;
    }
    let x = rect.x;
    for (const bucket of MATURITY_ORDER) {
      const v = rowNumber(row, fields[bucket]) ?? 0;
      if (v <= 0) continue;
      const segW = (v / total) * rect.w;
      gc.cache.fillStyle = MATURITY_COLORS[bucket];
      gc.fillRect(x, rect.y, segW, rect.h);
      x += segW;
    }
  },
};
