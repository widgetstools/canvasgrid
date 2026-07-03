// @cgrid/renderers — category 2: Text / identity. Catalog §3.2.

import type { CellPaintConfig, CellPainter } from '@cgrid/kernel';
import { withAlpha } from './paintUtils';
import { SEMANTIC_COLORS } from './palette';
import type {
  AgeCellParams,
  CurrencyPairCellParams,
  RelativeTimeCellParams,
  TickerCellParams,
  TimestampCellParams,
} from './types';

type Gc = Parameters<CellPainter['paint']>[0];

const PAD = 6;

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

function formatTimestamp(ms: number, showMillis: boolean): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  if (!showMillis) return `${hh}:${mm}:${ss}`;
  const mmm = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mmm}`;
}

function isSameUtcDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function formatAge(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatRelative(elapsedMs: number): string {
  const sec = Math.max(0, Math.floor(elapsedMs / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Catalog §3.2 TickerCell */
export const tickerCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as TickerCellParams;
    const primary = p.valueFormatted || String(p.value ?? '');
    const secondary = params.secondaryField && p.rowData
      ? String((p.rowData as Record<string, unknown>)[params.secondaryField] ?? '')
      : '';
    gc.cache.textAlign = 'left';
    gc.cache.textBaseline = 'alphabetic';
    gc.cache.font = `700 13px ${p.font.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif'}`;
    gc.cache.fillStyle = p.fg;
    gc.fillText(primary, p.bounds.x + padLeft(p), textYTop(p));
    if (secondary) {
      gc.cache.font = `400 11px ${p.font.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif'}`;
      gc.cache.fillStyle = withAlpha(p.fg, params.secondaryOpacity ?? 0.65);
      gc.fillText(secondary, p.bounds.x + padLeft(p), textYBottom(p));
    }
  },
};

/** Catalog §3.2 CurrencyPairCell */
export const currencyPairCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as CurrencyPairCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const pair = row ? String(row[params.pairField] ?? '') : '';
    const rate = row ? String(row[params.rateField] ?? '') : '';
    gc.cache.textBaseline = 'alphabetic';
    gc.cache.textAlign = 'left';
    gc.cache.font = `400 11px ${p.font.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif'}`;
    gc.cache.fillStyle = p.fg;
    gc.fillText(pair, p.bounds.x + padLeft(p), textYMiddle(gc, p));
    gc.cache.font = monoFont(p.font);
    gc.cache.textAlign = 'right';
    gc.fillText(rate, p.bounds.x + p.bounds.w - padRight(p), textYMiddle(gc, p));
  },
};

/** Catalog §3.2 TimestampCell */
export const timestampCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as TimestampCellParams;
    const nowMs = params.nowMs ?? 0;
    const ms = typeof p.value === 'number' ? p.value : Number(p.value);
    if (!Number.isFinite(ms)) {
      gc.cache.textAlign = 'right';
      gc.fillText('', p.bounds.x + p.bounds.w - padRight(p), textYMiddle(gc, p));
      return;
    }
    const showMillis = params.showMillis !== false;
    let text = formatTimestamp(ms, showMillis);
    if (nowMs && !isSameUtcDay(ms, nowMs)) {
      const d = new Date(ms);
      const datePrefix = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} `;
      gc.cache.font = monoFont(p.font);
      gc.cache.textAlign = 'right';
      gc.cache.textBaseline = 'alphabetic';
      gc.cache.fillStyle = withAlpha(p.fg, 0.65);
      const timeW = gc.measureText(text).width;
      const right = p.bounds.x + p.bounds.w - padRight(p);
      gc.fillText(text, right, textYMiddle(gc, p));
      gc.fillText(datePrefix, right - timeW - 4, textYMiddle(gc, p));
      return;
    }
    gc.cache.font = monoFont(p.font);
    gc.cache.fillStyle = p.fg;
    gc.cache.textAlign = 'right';
    gc.cache.textBaseline = 'alphabetic';
    gc.fillText(text, p.bounds.x + p.bounds.w - padRight(p), textYMiddle(gc, p));
  },
};

/** Catalog §3.2 AgeCell */
export const ageCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as AgeCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const since = row ? Number(row[params.sinceField]) : NaN;
    const elapsed = Number.isFinite(since) ? params.nowMs - since : 0;
    // F4a — read SEMANTIC_COLORS directly; resolveSemanticColors() returns a
    // fresh `{...SEMANTIC_COLORS}` object per call, which is unnecessary
    // allocation on this per-cell-per-frame hot path.
    const warn = params.warnAfterMs ?? 30_000;
    const danger = params.dangerAfterMs ?? 300_000;
    const fg = elapsed >= danger ? SEMANTIC_COLORS.negative
      : elapsed >= warn ? SEMANTIC_COLORS.warning
      : SEMANTIC_COLORS.muted;
    gc.cache.fillStyle = fg;
    gc.cache.font = monoFont(p.font);
    gc.cache.textAlign = 'left';
    gc.cache.textBaseline = 'alphabetic';
    gc.fillText(formatAge(elapsed), p.bounds.x + padLeft(p), textYMiddle(gc, p));
  },
};

/** Catalog §3.2 RelativeTimeCell */
export const relativeTimeCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as RelativeTimeCellParams;
    const row = p.rowData as Record<string, unknown> | undefined;
    const since = row ? Number(row[params.sinceField]) : NaN;
    const elapsed = Number.isFinite(since) ? params.nowMs - since : 0;
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textAlign = 'left';
    gc.cache.textBaseline = 'alphabetic';
    gc.fillText(formatRelative(elapsed), p.bounds.x + padLeft(p), textYMiddle(gc, p));
  },
};
