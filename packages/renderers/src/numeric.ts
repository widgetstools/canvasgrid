// @cgrid/renderers — category 1: Numeric (tick-aware). Catalog §3.1.

import type { CellPaintConfig, CellPainter } from '@cgrid/kernel';
import { fragText, withAlpha } from './paintUtils';
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

function tabularFont(baseFont: string): string {
  if (baseFont.includes('tnum')) return baseFont;
  return `${baseFont} "tnum"`;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function paintFlashOverlay(gc: Gc, p: CellPaintConfig, fallbackColor?: string): void {
  if (!p.flashAlpha || p.flashAlpha <= 0) return;
  gc.cache.save();
  gc.cache.globalAlpha = p.flashAlpha;
  gc.cache.fillStyle = p.flashFromColor ?? fallbackColor ?? withAlpha(SEMANTIC_COLORS.warning, 0.25);
  gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
  gc.cache.restore();
}

function paintRightText(
  gc: Gc,
  p: CellPaintConfig,
  text: string,
  color: string,
  xRight?: number,
): void {
  if (!text) return;
  gc.cache.fillStyle = color;
  gc.cache.font = tabularFont(p.font);
  gc.cache.textAlign = 'right';
  gc.cache.textBaseline = 'alphabetic';
  const x = xRight ?? p.bounds.x + p.bounds.w - padRight(p);
  gc.fillText(text, x, textY(gc, p));
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
 * "look-and-feel" / Task 1 — resolution order: an explicit per-column
 * `overrides` color always wins; failing that, the active theme's
 * `--cg-pos-color`/`--cg-neg-color` (threaded onto `p.posColor`/
 * `.negColor` by kernel `propertyChain.ts`); failing that (un-themed
 * grid), the hard-coded `SEMANTIC_COLORS` swatch.
 */
function colorsFromParams(
  overrides: SemanticColorMap | undefined,
  p?: Pick<CellPaintConfig, 'posColor' | 'negColor'>,
): Required<SemanticColorMap> {
  colorScratch.positive = overrides?.positive ?? p?.posColor ?? SEMANTIC_COLORS.positive;
  colorScratch.negative = overrides?.negative ?? p?.negColor ?? SEMANTIC_COLORS.negative;
  colorScratch.warning = overrides?.warning ?? SEMANTIC_COLORS.warning;
  colorScratch.info = overrides?.info ?? SEMANTIC_COLORS.info;
  colorScratch.muted = overrides?.muted ?? SEMANTIC_COLORS.muted;
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
      font: tabularFont(p.font),
      color: withAlpha(fg, 0.7),
      align: 'right',
    });
    x -= gc.measureText(params.currencySuffix).width + 2;
  }
  paintRightText(gc, p, text, fg, x);
  if (params.currencyPrefix) {
    const numW = gc.measureText(text).width;
    fragText(gc, params.currencyPrefix, x - numW - 2, textY(gc, p), {
      font: tabularFont(p.font),
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
    const dir = tickDirection(p, params.prevField);
    const colors = colorsFromParams(params.colors, p);
    const flashColor = dir === 'up' ? withAlpha(colors.positive, 0.25)
      : dir === 'down' ? withAlpha(colors.negative, 0.25)
      : undefined;
    paintFlashOverlay(gc, p, flashColor);
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
    gc.cache.font = tabularFont(p.font);
    gc.cache.textAlign = 'left';
    gc.fillText(text, textX, textY(gc, p));
  },
};

/** Catalog §3.1 PnlCell */
export const pnlCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as PnlCellParams;
    const colors = colorsFromParams(params.colors, p);
    const n = toNumber(p.value);
    if (n === null) {
      paintRightText(gc, p, p.valueFormatted || '', p.fg);
      return;
    }
    const symbol = params.currencySymbol ?? '$';
    const body = Math.abs(n).toFixed(2);
    const signed = n > 0 ? `+${body}` : n < 0 ? `-${body}` : body;
    const fg = semanticFg(n, colors);
    const right = p.bounds.x + p.bounds.w - padRight(p);
    paintRightText(gc, p, signed, fg, right);
    const numW = gc.measureText(signed).width;
    fragText(gc, symbol, right - numW - 2, textY(gc, p), {
      font: tabularFont(p.font),
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
      paintRightText(gc, p, '— (—)', p.fg);
      return;
    }
    const absText = abs === null ? '—' : signedNumberText(abs, 2);
    const pctText = pct === null ? '—' : `${signedNumberText(pct, 2)}%`;
    const sign = abs ?? pct ?? 0;
    const fg = semanticFg(sign, colors);
    const pctPart = ` (${pctText})`;
    const right = p.bounds.x + p.bounds.w - padRight(p);
    const y = textY(gc, p);
    gc.cache.font = tabularFont(p.font);
    gc.cache.textAlign = 'right';
    gc.cache.textBaseline = 'alphabetic';
    const pctW = gc.measureText(pctPart).width;
    gc.cache.fillStyle = withAlpha(fg, params.percentOpacity ?? 0.85);
    gc.fillText(pctPart, right, y);
    gc.cache.fillStyle = fg;
    gc.fillText(absText, right - pctW, y);
  },
};

/** Catalog §3.1 BpsCell */
export const bpsCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as BpsCellParams;
    const colors = colorsFromParams(params.colors, p);
    const n = toNumber(p.value);
    if (n === null) {
      paintRightText(gc, p, '', p.fg);
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
      font: tabularFont(p.font),
      color: withAlpha(fg, 0.7),
      align: 'right',
    });
    paintRightText(gc, p, body, fg, right - gc.measureText(suffix).width);
  },
};

/** Catalog §3.1 PctChangeCell */
export const pctChangeCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as PctChangeCellParams;
    const colors = colorsFromParams(params.colors, p);
    const n = toNumber(p.value);
    if (n === null) {
      paintRightText(gc, p, p.valueFormatted || '', p.fg);
      return;
    }
    const prec = params.precision ?? 2;
    const text = `${signedNumberText(n, prec)}%`;
    paintRightText(gc, p, text, semanticFg(n, colors));
  },
};

/** Catalog §3.1 FractionalPriceCell */
export const fractionalPriceCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as FractionalPriceCellParams;
    const text = p.valueFormatted || formatFractionalPrice(p.value, params);
    paintRightText(gc, p, text, p.fg);
  },
};

/** Catalog §3.1 AbbreviatedNumberCell */
export const abbreviatedNumberCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as AbbreviatedNumberCellParams;
    const n = toNumber(p.value);
    if (n === null) {
      paintRightText(gc, p, p.valueFormatted || '', p.fg);
      return;
    }
    const text = formatAbbreviated(n, params.precision ?? 1, params.currencyPrefix ?? '');
    paintRightText(gc, p, text, p.fg);
  },
};
