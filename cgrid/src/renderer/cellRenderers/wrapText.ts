import type { CachedContext2D } from '../gc';
import type { CellPainter, CellPaintConfig } from './registry';

/**
 * Multi-line text painter for columns flagged `wrapText: true`. Performs
 * greedy word-wrap against the cell's inner width using the live canvas
 * `measureText`, then paints one `fillText` per visible line. When the row
 * height cannot fit all wrapped lines, the last visible line is right-
 * truncated with an ellipsis.
 *
 * Allocation discipline: a single `lineBuffer: string[]` lives on the
 * painter instance and is reset in place (`length = 0`) per cell. The
 * painter is constructed once and registered as `'text-wrap'`, so all wrap
 * cells across the grid share the same buffer.
 *
 * Cycle 5 / Task 9.
 */

const PADDING_X = 6;
const PADDING_Y = 4;
const ELLIPSIS = '…';

/** Parse the px size out of a CSS shorthand `font` string (e.g. '13px Inter',
 *  'bold 14px / 18 Helvetica'). Falls back to 16 for unparseable input —
 *  matches the browser default. */
function fontSizePx(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]!) : 16;
}

/**
 * Greedy word-wrap. Pushes one entry per line into `out`; resets `out` first
 * so the caller's buffer is reusable. Never splits a single word — a word
 * wider than `maxWidth` occupies its own line and overflows the cell (clip
 * mask handles that case, same as `wrapTextToHeight` in the worker).
 */
export function wrapIntoLines(
  out: string[],
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): void {
  out.length = 0;
  if (!text || maxWidth <= 0) return;
  const words = text.split(/\s+/);
  let current = '';
  for (const word of words) {
    if (!word) continue;
    if (!current) {
      current = word;
      continue;
    }
    const candidate = current + ' ' + word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
}

/**
 * Right-truncate `line` and append `…` so the result fits `maxWidth`.
 * Binary-searches the largest prefix that, with the ellipsis suffix,
 * measures within budget. Returns just the ellipsis when no character fits.
 */
export function ellipsize(
  line: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (measure(line + ELLIPSIS) <= maxWidth) return line + ELLIPSIS;
  let lo = 0;
  let hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (measure(line.slice(0, mid) + ELLIPSIS) <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return line.slice(0, lo) + ELLIPSIS;
}

class WrapTextPainter implements CellPainter {
  private lineBuffer: string[] = [];

  paint(gc: CachedContext2D, p: CellPaintConfig): void {
    if (p.bg !== p.prefillColor) {
      gc.cache.fillStyle = p.bg;
      gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    }
    if (p.flashAlpha && p.flashAlpha > 0) {
      gc.cache.save();
      gc.cache.globalAlpha = p.flashAlpha;
      // Cycle 4 / Task 11 — theme-driven flash color (same as
      // registry.ts paintBackground).
      gc.cache.fillStyle = p.flashFromColor ?? '#fef3c7';
      gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
      gc.cache.restore();
    }

    const innerW = p.bounds.w - 2 * PADDING_X;
    const text = p.valueFormatted ?? '';
    if (innerW <= 0 || !text) return;

    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';

    const measure = (s: string) => gc.measureText(s).width;
    wrapIntoLines(this.lineBuffer, text, innerW, measure);
    if (this.lineBuffer.length === 0) return;

    // Line height ~ 1.2 × font size — matches the default CSS `line-height`
    // for body text in most browsers. Keeps wrap visually aligned with
    // single-line `textCell` (which uses middle-baseline + cell center).
    const lineHeight = Math.round(fontSizePx(p.font) * 1.2);
    const innerH = p.bounds.h - 2 * PADDING_Y;
    const maxLines = Math.max(1, Math.floor(innerH / lineHeight));

    let visibleLines = this.lineBuffer.length;
    let truncatedLastLine: string | null = null;
    if (this.lineBuffer.length > maxLines) {
      visibleLines = maxLines;
      truncatedLastLine = ellipsize(this.lineBuffer[maxLines - 1] ?? '', innerW, measure);
    }

    let textX: number;
    if (p.halign === 'right') {
      gc.cache.textAlign = 'right';
      textX = p.bounds.x + p.bounds.w - PADDING_X;
    } else if (p.halign === 'center') {
      gc.cache.textAlign = 'center';
      textX = p.bounds.x + p.bounds.w / 2;
    } else {
      gc.cache.textAlign = 'left';
      textX = p.bounds.x + PADDING_X;
    }

    const startY = p.bounds.y + PADDING_Y + lineHeight / 2;
    for (let i = 0; i < visibleLines; i++) {
      const line = i === visibleLines - 1 && truncatedLastLine !== null
        ? truncatedLastLine
        : (this.lineBuffer[i] ?? '');
      gc.fillText(line, textX, startY + i * lineHeight);
    }
  }
}

export const wrapTextCell: CellPainter = new WrapTextPainter();
