// @wellsfargo-starui/velocity-grid-ext/renderers — category 1: Numeric (tick-aware). Catalog §3.1.
//
// A note on tabular figures. These renderers used to append `"tnum"` to the
// font before assigning it, reaching for tabular numerals the way CSS would
// with `font-variant-numeric`. Canvas 2D has no such property, and `"tnum"` is
// not legal in the `font` shorthand — so the assignment was REJECTED WHOLESALE
// and silently: per spec an unparseable `ctx.font` leaves the previous value
// in place. Every numeric cell therefore painted in whatever font happened to
// be set last, and any font the column asked for — a size from the formatting
// toolbar, a weight from a style rule — was discarded on numeric columns only.
//
// Digits line up here because the kernel already gives numeric columns the
// theme's MONOSPACE cell font (`cellFontForColumn`), where every glyph is the
// same width. That is where tabular alignment comes from; there is nothing to
// add to the font string, and adding anything breaks it.

import type { CellPaintConfig, CellPainter } from '@wellsfargo-starui/velocity-grid';
import { fragText, paintValueText, withAlpha } from './paintUtils';
import { SEMANTIC_COLORS } from './palette';
import type {
  AbbreviatedNumberCellParams,
  BpsCellParams,
  DeltaCellParams,
  NumberCellParams,
  PnlCellParams,
  PctChangeCellParams,
  PriceCellParams,
  PriceDirectionCellParams,
  FractionalPriceCellParams,
  SemanticColorMap,
} from './types';

type Gc = Parameters<CellPainter['paint']>[0];

const PAD = 6;

const MAGNITUDE_UNITS: ReadonlyArray<readonly [number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

const colorScratch: Required<SemanticColorMap> = {
  positive: SEMANTIC_COLORS.positive,
  negative: SEMANTIC_COLORS.negative,
  warning: SEMANTIC_COLORS.warning,
  info: SEMANTIC_COLORS.info,
  muted: SEMANTIC_COLORS.muted,
};

function padRight(p: CellPaintConfig): number {
  return p.padding?.right ?? PAD;
}

function padLeft(p: CellPaintConfig): number {
  return p.padding?.left ?? PAD;
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


/**
 * Paint the cell's value.
 *
 * Right-aligned unless the column says otherwise: figures line up on the
 * decimal by default, but `halign` is column configuration and a renderer that
 * hard-codes it makes the toolbar's align buttons dead on every numeric
 * column — the same silent drop that hid underline and strike-through here.
 */
function paintValue(
  gc: Gc,
  p: CellPaintConfig,
  text: string,
  color: string,
  xRight?: number,
): void {
  if (!text) return;
  gc.cache.fillStyle = color;
  gc.cache.font = p.font;
  gc.cache.textBaseline = 'alphabetic';
  const align: CanvasTextAlign = p.halign === 'left' || p.halign === 'center' ? p.halign : 'right';
  const x = xRight ?? (
    align === 'left' ? p.bounds.x + padLeft(p)
      : align === 'center' ? p.bounds.x + p.bounds.w / 2
        : p.bounds.x + p.bounds.w - padRight(p)
  );
  paintValueText(gc, p, text, x, textY(gc, p), align);
}

function signedNumberText(n: number, decimals?: number): string {
  const abs = Math.abs(n);
  const body = decimals !== undefined ? abs.toFixed(decimals) : String(abs);
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return decimals !== undefined ? (0).toFixed(decimals) : '0';
}

function tickDirection(
  p: CellPaintConfig,
  prevField?: string,
): 'up' | 'down' | 'flat' | null {
  if (!prevField || !p.rowData) return null;
  const cur = toNumber(p.value);
  const prev = toNumber((p.rowData as Record<string, unknown>)[prevField]);
  if (cur === null || prev === null) return null;
  if (cur > prev) return 'up';
  if (cur < prev) return 'down';
  return 'flat';
}

/**
 * Workstream A (2026-07-06 CSS styling model) — resolves each semantic
 * color as `overrides ?? p.palette?.<x> ?? SEMANTIC_COLORS.<x>`. `overrides`
 * (a column's `params.colors`) always wins; `p.palette` (threaded from the
 * resolved theme's `--vg-pos-color` / `--vg-neg-color` / `--vg-warning-
 * color` / `--vg-info-color` / `--vg-muted-color` tokens) is the new
 * theme-driven middle tier; `SEMANTIC_COLORS` is the last-resort literal
 * fallback used only when neither of the above supplies a value (e.g. a
 * hand-built `CellPaintConfig` test fixture with no `palette`).
 */
function colorsFromParams(overrides: SemanticColorMap | undefined, p: CellPaintConfig): Required<SemanticColorMap> {
  const palette = p.palette;
  colorScratch.positive = overrides?.positive ?? palette?.positive ?? SEMANTIC_COLORS.positive;
  colorScratch.negative = overrides?.negative ?? palette?.negative ?? SEMANTIC_COLORS.negative;
  colorScratch.warning = overrides?.warning ?? palette?.warning ?? SEMANTIC_COLORS.warning;
  colorScratch.info = overrides?.info ?? palette?.info ?? SEMANTIC_COLORS.info;
  colorScratch.muted = overrides?.muted ?? palette?.muted ?? SEMANTIC_COLORS.muted;
  return colorScratch;
}

function semanticFg(
  sign: number,
  colors: Required<SemanticColorMap>,
): string {
  if (sign > 0) return colors.positive;
  if (sign < 0) return colors.negative;
  return colors.muted;
}

function paintDirectionGlyph(
  gc: Gc,
  p: CellPaintConfig,
  dir: 'up' | 'down' | 'flat',
  color: string,
  iconX: number,
): number {
  const cy = textY(gc, p);
  const size = 8;
  gc.cache.save();
  gc.cache.strokeStyle = color;
  gc.cache.fillStyle = color;
  gc.cache.lineWidth = 1.5;
  gc.beginPath();
  // B1 fix — canvas Y grows DOWNWARD, so the apex (single point) of an
  // 'up' (▲) triangle must sit at the SMALLEST y (cy - size*0.35, visually
  // top) with its base at the LARGEST y (cy + size*0.35, visually bottom).
  // The previous code had these swapped, so 'up' painted as ▼. 'down' is
  // the exact mirror.
  if (dir === 'up') {
    gc.moveTo(iconX, cy - size * 0.35);
    gc.lineTo(iconX - size * 0.45, cy + size * 0.35);
    gc.lineTo(iconX + size * 0.45, cy + size * 0.35);
    gc.closePath();
    gc.fill();
  } else if (dir === 'down') {
    gc.moveTo(iconX, cy + size * 0.35);
    gc.lineTo(iconX - size * 0.45, cy - size * 0.35);
    gc.lineTo(iconX + size * 0.45, cy - size * 0.35);
    gc.closePath();
    gc.fill();
  } else {
    gc.moveTo(iconX - size * 0.5, cy);
    gc.lineTo(iconX + size * 0.5, cy);
    gc.stroke();
  }
  gc.cache.restore();
  return iconX + size + 4;
}

function primaryNumericText(p: CellPaintConfig): string {
  if (p.valueFormatted) return p.valueFormatted;
  const n = toNumber(p.value);
  return n === null ? '' : String(n);
}

function paintNumberCellCore(gc: Gc, p: CellPaintConfig, params: NumberCellParams): void {
  let text = primaryNumericText(p);
  const n = toNumber(p.value);
  if (params.signPolicy === 'always' && n !== null) {
    if (text && !/^[+-]/.test(text)) {
      text = n > 0 ? `+${text}` : n < 0 && !text.startsWith('-') ? `-${text}` : text;
    }
  } else if (params.signPolicy === 'negative-only' && n !== null && n < 0 && !text.startsWith('-')) {
    text = `-${text.replace(/^\+/, '')}`;
  }
  const fg = p.fg;
  const right = p.bounds.x + p.bounds.w - padRight(p);
  if (!text) return;
  let x = right;
  if (params.currencySuffix) {
    fragText(gc, params.currencySuffix, x, textY(gc, p), {
      font: p.font,
      color: withAlpha(fg, 0.7),
      align: 'right',
    });
    x -= gc.measureText(params.currencySuffix).width + 2;
  }
  paintValue(gc, p, text, fg, x);
  if (params.currencyPrefix) {
    const numW = gc.measureText(text).width;
    fragText(gc, params.currencyPrefix, x - numW - 2, textY(gc, p), {
      font: p.font,
      color: withAlpha(fg, 0.7),
      align: 'right',
    });
  }
}

function formatAbbreviated(n: number, precision: number, prefix: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  for (const [threshold, suffix] of MAGNITUDE_UNITS) {
    if (abs >= threshold) {
      return `${sign}${prefix}${(abs / threshold).toFixed(precision)}${suffix}`;
    }
  }
  return `${sign}${prefix}${abs.toFixed(precision)}`;
}

function formatFractionalPrice(value: unknown, params: FractionalPriceCellParams): string {
  if (typeof value === 'string' && value.includes('-')) return value;
  const n = toNumber(value);
  if (n === null) return pEmpty(value);
  const denom = params.denominator ?? 32;
  const whole = Math.floor(n);
  const frac = n - whole;
  const halfTicks = Math.round(frac * denom * 2) / 2;
  const ticks = Math.floor(halfTicks);
  const isHalf = params.showHalfTick !== false && halfTicks - ticks >= 0.25;
  const base = `${whole}-${String(ticks).padStart(2, '0')}`;
  return isHalf ? `${base}+` : base;
}

function pEmpty(value: unknown): string {
  return value == null ? '' : String(value);
}

function paintNumberLike(gc: Gc, p: CellPaintConfig, params: NumberCellParams): void {
  paintNumberCellCore(gc, p, params);
}

/** Catalog §3.1 NumberCell */
export const numberCell: CellPainter = {
  paint(gc, p) {
    paintNumberLike(gc, p, (p.params ?? {}) as NumberCellParams);
  },
};

/** Catalog §3.1 PriceCell */
export const priceCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as PriceCellParams;
    // The flash tint is painted by the bridge for every renderer, and the
    // kernel already resolves its direction — see `paintCellFlash`.
    paintNumberLike(gc, p, params);
  },
};

/** Catalog §3.1 PriceDirectionCell */
export const priceDirectionCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as PriceDirectionCellParams;
    const colors = colorsFromParams(params.colors, p);
    const dir = tickDirection(p, params.prevField) ?? 'flat';
    const fg = dir === 'up' ? colors.positive : dir === 'down' ? colors.negative : colors.muted;
    const iconX = p.bounds.x + padLeft(p) + 4;
    const textX = paintDirectionGlyph(gc, p, dir, fg, iconX);
    const text = primaryNumericText(p);
    gc.cache.fillStyle = fg;
    gc.cache.font = p.font;
    paintValueText(gc, p, text, textX, textY(gc, p), 'left');
  },
};

/** Catalog §3.1 PnlCell */
export const pnlCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as PnlCellParams;
    const colors = colorsFromParams(params.colors, p);
    const n = toNumber(p.value);
    if (n === null) {
      paintValue(gc, p, p.valueFormatted || '', p.fg);
      return;
    }
    const symbol = params.currencySymbol ?? '$';
    const body = Math.abs(n).toFixed(2);
    const signed = n > 0 ? `+${body}` : n < 0 ? `-${body}` : body;
    const fg = semanticFg(n, colors);
    const right = p.bounds.x + p.bounds.w - padRight(p);
    paintValue(gc, p, signed, fg, right);
    const numW = gc.measureText(signed).width;
    fragText(gc, symbol, right - numW - 2, textY(gc, p), {
      font: p.font,
      color: withAlpha(fg, 0.7),
      align: 'right',
    });
  },
};

/** Catalog §3.1 DeltaCell */
export const deltaCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as DeltaCellParams;
    const colors = colorsFromParams(params.colors, p);
    const row = p.rowData as Record<string, unknown> | undefined;
    const abs = toNumber(row?.[params.absoluteField]);
    const pct = toNumber(row?.[params.percentField]);
    if (abs === null && pct === null) {
      paintValue(gc, p, '— (—)', p.fg);
      return;
    }
    const absText = abs === null ? '—' : signedNumberText(abs, 2);
    const pctText = pct === null ? '—' : `${signedNumberText(pct, 2)}%`;
    const sign = abs ?? pct ?? 0;
    const fg = semanticFg(sign, colors);
    const pctPart = ` (${pctText})`;
    const right = p.bounds.x + p.bounds.w - padRight(p);
    const y = textY(gc, p);
    gc.cache.font = p.font;
    gc.cache.textAlign = 'right';
    gc.cache.textBaseline = 'alphabetic';
    const pctW = gc.measureText(pctPart).width;
    gc.cache.fillStyle = withAlpha(fg, params.percentOpacity ?? 0.85);
    gc.cache.textAlign = 'right';
    gc.fillText(pctPart, right, y);
    gc.cache.fillStyle = fg;
    // Decoration rides the VALUE, not the parenthesised percentage beside it.
    paintValueText(gc, p, absText, right - pctW, y, 'right');
  },
};

/** Catalog §3.1 BpsCell */
export const bpsCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as BpsCellParams;
    const colors = colorsFromParams(params.colors, p);
    const n = toNumber(p.value);
    if (n === null) {
      paintValue(gc, p, '', p.fg);
      return;
    }
    let ref = 0;
    if (params.benchmarkField && p.rowData) {
      ref = toNumber((p.rowData as Record<string, unknown>)[params.benchmarkField]) ?? 0;
    }
    const bps = Math.round(n - ref);
    const fg = semanticFg(bps, colors);
    const suffix = params.suffix ?? ' bps';
    const body = signedNumberText(bps, 0);
    const right = p.bounds.x + p.bounds.w - padRight(p);
    fragText(gc, suffix, right, textY(gc, p), {
      font: p.font,
      color: withAlpha(fg, 0.7),
      align: 'right',
    });
    paintValue(gc, p, body, fg, right - gc.measureText(suffix).width);
  },
};

/** Catalog §3.1 PctChangeCell */
export const pctChangeCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as PctChangeCellParams;
    const colors = colorsFromParams(params.colors, p);
    const n = toNumber(p.value);
    if (n === null) {
      paintValue(gc, p, p.valueFormatted || '', p.fg);
      return;
    }
    const prec = params.precision ?? 2;
    const text = `${signedNumberText(n, prec)}%`;
    paintValue(gc, p, text, semanticFg(n, colors));
  },
};

/** Catalog §3.1 FractionalPriceCell */
export const fractionalPriceCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as FractionalPriceCellParams;
    const text = p.valueFormatted || formatFractionalPrice(p.value, params);
    paintValue(gc, p, text, p.fg);
  },
};

/** Catalog §3.1 AbbreviatedNumberCell */
export const abbreviatedNumberCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as AbbreviatedNumberCellParams;
    const n = toNumber(p.value);
    if (n === null) {
      paintValue(gc, p, p.valueFormatted || '', p.fg);
      return;
    }
    const text = formatAbbreviated(n, params.precision ?? 1, params.currencyPrefix ?? '');
    paintValue(gc, p, text, p.fg);
  },
};
