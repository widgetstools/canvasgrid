// @cgrid/renderers — category 7: Composite (multi-value). Catalog §3.7.

import type { CellPaintConfig, CellPainter } from '@cgrid/kernel';
import { fragText, miniBar, withAlpha } from './paintUtils';
import { DEFAULT_VENUE_PALETTE, SEMANTIC_COLORS } from './palette';
import type {
  BenchmarkSpreadCellParams,
  NBBOCellParams,
  PriceChangeCompositeParams,
  PriceQuoteCellParams,
  StackedValueCellParams,
} from './types';

type Gc = Parameters<CellPainter['paint']>[0];

const PAD = 6;
const TRACK = withAlpha(SEMANTIC_COLORS.muted, 0.18);

function padLeft(p: CellPaintConfig): number {
  return p.padding?.left ?? PAD;
}

function padRight(p: CellPaintConfig): number {
  return p.padding?.right ?? PAD;
}

function textYTop(p: CellPaintConfig): number {
  return p.bounds.y + 11;
}

function textYBottom(p: CellPaintConfig): number {
  return p.bounds.y + p.bounds.h - 5;
}

function textYMiddle(gc: Gc, p: CellPaintConfig): number {
  const m = gc.measureText('Mg');
  return p.bounds.y + p.bounds.h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
}

function monoFont(baseFont: string): string {
  return baseFont.replace(/(\d+(?:\.\d+)?px)\s+.+$/, '$1 ui-monospace, SFMono-Regular, Menlo, monospace');
}

function rowString(row: Record<string, unknown> | undefined, field?: string): string {
  if (!field || !row) return '';
  const v = row[field];
  return v == null ? '' : String(v);
}

function rowNumber(row: Record<string, unknown> | undefined, field?: string): number | null {
  if (!field || !row) return null;
  const v = row[field];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function signedText(n: number, decimals = 2): string {
  const body = Math.abs(n).toFixed(decimals);
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

function paintDirectionGlyph(gc: Gc, p: CellPaintConfig, dir: 'up' | 'down' | 'flat', color: string, iconX: number): number {
  const cy = textYMiddle(gc, p);
  const size = 8;
  gc.cache.save();
  gc.cache.strokeStyle = color;
  gc.cache.fillStyle = color;
  gc.cache.lineWidth = 1.5;
  gc.beginPath();
  if (dir === 'up') {
    gc.moveTo(iconX, cy + size * 0.35);
    gc.lineTo(iconX - size * 0.45, cy - size * 0.35);
    gc.lineTo(iconX + size * 0.45, cy - size * 0.35);
    gc.closePath();
    gc.fill();
  } else if (dir === 'down') {
    gc.moveTo(iconX, cy - size * 0.35);
    gc.lineTo(iconX - size * 0.45, cy + size * 0.35);
    gc.lineTo(iconX + size * 0.45, cy + size * 0.35);
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

/** Catalog §3.7 StackedValueCell — primary right-aligned, muted secondary below. */
export const stackedValueCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as StackedValueCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const primary = params.primaryField
      ? rowString(row, params.primaryField)
      : (p.valueFormatted || String(p.value ?? ''));
    const secondary = rowString(row, params.secondaryField);
    const right = p.bounds.x + p.bounds.w - padRight(p);
    gc.cache.textAlign = 'right';
    gc.cache.textBaseline = 'alphabetic';
    gc.cache.font = p.font;
    gc.cache.fillStyle = p.fg;
    if (primary) gc.fillText(primary, right, textYTop(p));
    if (secondary) {
      gc.cache.fillStyle = withAlpha(p.fg, params.secondaryOpacity ?? 0.85);
      gc.fillText(secondary, right, textYBottom(p));
    }
  },
};

/** Catalog §3.7 PriceQuoteCell — bid left / ask right / mid centred; spread bar behind mid. */
export const priceQuoteCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as PriceQuoteCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const bid = rowNumber(row, params.bidField);
    const ask = rowNumber(row, params.askField);
    const mid = rowNumber(row, params.midField) ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
    const left = p.bounds.x + padLeft(p);
    const right = p.bounds.x + p.bounds.w - padRight(p);
    gc.cache.textBaseline = 'alphabetic';
    gc.cache.font = monoFont(p.font);
    if (bid !== null) {
      gc.cache.textAlign = 'left';
      gc.cache.fillStyle = p.fg;
      gc.fillText(bid.toFixed(2), left, textYTop(p));
    }
    if (ask !== null) {
      gc.cache.textAlign = 'right';
      gc.fillText(ask.toFixed(2), right, textYTop(p));
    }
    if (mid !== null) {
      const spread = bid !== null && ask !== null ? ask - bid : 0;
      const barW = Math.min(80, p.bounds.w * 0.4);
      const barX = p.bounds.x + (p.bounds.w - barW) / 2;
      const barY = p.bounds.y + p.bounds.h - 10;
      const frac = Math.max(0, Math.min(1, spread / (params.spreadWarnThreshold ?? 0.05)));
      miniBar(gc, barX, barY, barW, 4, frac, withAlpha(SEMANTIC_COLORS.warning, 0.45), TRACK);
      gc.cache.textAlign = 'center';
      gc.cache.fillStyle = withAlpha(p.fg, 0.7);
      gc.fillText(mid.toFixed(2), p.bounds.x + p.bounds.w / 2, textYBottom(p));
      if (params.spreadWarnThreshold !== undefined && spread > params.spreadWarnThreshold) {
        fragText(gc, 'WIDE', right - 28, textYTop(p), {
          font: `600 9px ${p.font.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif'}`,
          color: SEMANTIC_COLORS.warning,
          align: 'right',
        });
      }
    }
  },
};

/** Catalog §3.7 NBBOCell — consolidated top-of-book quote with inline venue chips. */
export const nbboCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as NBBOCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    if (!row) return;
    const bid = rowNumber(row, params.bidField);
    const bidSize = rowString(row, params.bidSizeField);
    const bidVenue = rowString(row, params.bidVenueField).toUpperCase();
    const ask = rowNumber(row, params.askField);
    const askSize = rowString(row, params.askSizeField);
    const askVenue = rowString(row, params.askVenueField).toUpperCase();
    const y = textYMiddle(gc, p);
    const font = monoFont(p.font);
    gc.cache.font = font;
    gc.cache.textBaseline = 'alphabetic';
    let x = p.bounds.x + padLeft(p);
    const bidPart = bid !== null ? `${bid.toFixed(2)} x ${bidSize}` : '';
    const askPart = ask !== null ? `${ask.toFixed(2)} x ${askSize}` : '';
    if (bidPart) {
      gc.cache.textAlign = 'left';
      gc.cache.fillStyle = p.fg;
      gc.fillText(bidPart, x, y);
      x += gc.measureText(bidPart).width + 4;
      if (bidVenue) {
        gc.cache.fillStyle = DEFAULT_VENUE_PALETTE[bidVenue] ?? SEMANTIC_COLORS.info;
        gc.fillText(`@${bidVenue}`, x, y);
        x += gc.measureText(`@${bidVenue}`).width + 8;
      }
    }
    gc.cache.fillStyle = withAlpha(p.fg, 0.45);
    gc.fillText('|', x, y);
    x += gc.measureText('|').width + 8;
    if (askPart) {
      gc.cache.fillStyle = p.fg;
      gc.fillText(askPart, x, y);
      x += gc.measureText(askPart).width + 4;
      if (askVenue) {
        gc.cache.fillStyle = DEFAULT_VENUE_PALETTE[askVenue] ?? SEMANTIC_COLORS.info;
        gc.fillText(`@${askVenue}`, x, y);
      }
    }
  },
};

/** Catalog §3.7 BenchmarkSpreadCell — signed bps + muted benchmark label. */
export const benchmarkSpreadCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as BenchmarkSpreadCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const bps = rowNumber(row, params.bpsField);
    const benchmark = rowString(row, params.benchmarkLabelField);
    const y = textYMiddle(gc, p);
    gc.cache.textBaseline = 'alphabetic';
    gc.cache.textAlign = 'left';
    gc.cache.font = p.font;
    if (bps !== null) {
      const fg = bps > 0 ? SEMANTIC_COLORS.positive : bps < 0 ? SEMANTIC_COLORS.negative : p.fg;
      const bpsText = `${signedText(bps, 0)} bps`;
      gc.cache.fillStyle = fg;
      gc.fillText(bpsText, p.bounds.x + padLeft(p), y);
      if (benchmark) {
        const prefix = ' vs ';
        const x = p.bounds.x + padLeft(p) + gc.measureText(bpsText).width;
        gc.cache.fillStyle = withAlpha(p.fg, 0.65);
        gc.fillText(`${prefix}${benchmark}`, x, y);
      }
    }
  },
};

/** Catalog §3.7 PriceChangeComposite — price + arrow + abs delta + pct delta. */
export const priceChangeComposite: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as PriceChangeCompositeParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const priceFromValue = typeof p.value === 'number' && Number.isFinite(p.value)
      ? p.value
      : (p.value != null && p.value !== '' ? Number(p.value) : NaN);
    const price = params.priceField
      ? rowNumber(row, params.priceField)
      : rowNumber(row, 'price') ?? (Number.isFinite(priceFromValue) ? priceFromValue : null);
    const change = rowNumber(row, params.changeField);
    const prevClose = rowNumber(row, params.prevCloseField);
    const priceText = price !== null && Number.isFinite(price) ? price.toFixed(2) : (p.valueFormatted || '');
    const dir = change === null ? 'flat' as const : change > 0 ? 'up' as const : change < 0 ? 'down' as const : 'flat' as const;
    const fg = dir === 'up' ? SEMANTIC_COLORS.positive : dir === 'down' ? SEMANTIC_COLORS.negative : p.fg;
    let x = p.bounds.x + padLeft(p);
    gc.cache.font = p.font;
    gc.cache.textAlign = 'left';
    gc.cache.textBaseline = 'alphabetic';
    gc.cache.fillStyle = fg;
    if (priceText) {
      gc.fillText(priceText, x, textYMiddle(gc, p));
      x += gc.measureText(priceText).width + 6;
    }
    x = paintDirectionGlyph(gc, p, dir, fg, x);
    if (change !== null) {
      const pct = prevClose && prevClose !== 0 ? (change / prevClose) * 100 : null;
      const deltaText = signedText(change, 2);
      const pctText = pct === null ? '' : ` (${signedText(pct, 2)}%)`;
      gc.cache.fillStyle = fg;
      gc.fillText(`${deltaText}${pctText}`, x, textYMiddle(gc, p));
    }
  },
};
