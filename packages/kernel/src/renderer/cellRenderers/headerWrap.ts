/**
 * Cycle 21i / Phase 1 (G1 follow-up) — header text wrapping.
 *
 * Pure helpers shared by the header cell painter (multi-line draw when a
 * column declares `wrapHeaderText: true`) and the layout-side auto header
 * height computation (`autoHeaderHeight: true` grows the leaf header row
 * to fit the tallest wrapped header). One wrap implementation keeps the
 * painted lines and the measured height in exact agreement.
 */

/** Horizontal padding inside a header cell (mirrors the painter). */
export const HEADER_WRAP_PADDING = 8;
/** Right-side reserve so wrapped lines never collide with the sort icon. */
export const HEADER_SORT_RESERVE = 22; // SORT_ICON_SIZE + SORT_ICON_PAD
/** Line height as a multiple of the font pixel size. */
export const HEADER_LINE_HEIGHT_FACTOR = 1.35;
/** Vertical padding (top + bottom combined) for auto header height. */
export const HEADER_WRAP_VERTICAL_PAD = 10;

/** Pixel font size out of a canvas font string ('12px Inter…' → 12). */
export function fontPxSize(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 12;
}

/**
 * Greedy word wrap against a measure function. Words that alone exceed
 * `maxWidth` break mid-word so a long unbroken token can't overflow the
 * column. Returns at least one line (possibly empty for empty text).
 */
export function wrapHeaderLines(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  if (!text || maxWidth <= 0) return [text ?? ''];
  if (measure(text) <= maxWidth) return [text];

  const lines: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.length > 0) lines.push(current);
    current = '';
  };
  const joiner = (prev: string) => (prev.endsWith('(') ? '' : ' ');

  // Whitespace splits first; unbroken tokens also break AFTER an opening
  // paren so agg-decorated headers wrap as `sum(` / `Notional)` rather
  // than mid-word.
  const tokens = text.split(/\s+/).flatMap((w) => w.split(/(?<=\()/));
  for (const word of tokens) {
    const candidate = current.length > 0 ? `${current}${joiner(current)}${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (measure(word) <= maxWidth) {
      current = word;
      continue;
    }
    // Mid-word break for oversized tokens.
    let piece = '';
    for (const ch of word) {
      if (measure(piece + ch) > maxWidth && piece.length > 0) {
        lines.push(piece);
        piece = ch;
      } else {
        piece += ch;
      }
    }
    current = piece;
  }
  pushCurrent();
  return lines.length > 0 ? lines : [''];
}

/** Usable text width inside a header cell of the given column width. */
export function headerTextWidth(columnWidth: number): number {
  return Math.max(8, columnWidth - HEADER_WRAP_PADDING * 2 - HEADER_SORT_RESERVE);
}

export interface AutoHeaderHeightInput {
  /** Visible leaf columns: id + current width. */
  columns: Array<{ colId: string; width: number }>;
  /** Resolved header text per colId (null → skip: no wrap flag). */
  wrapText(colId: string): string | null;
  measure(s: string): number;
  font: string;
  /** Height when nothing wraps (options.headerHeight ?? theme). */
  baseHeight: number;
}

/** The leaf header row height: tallest wrapped header among wrap-enabled
 *  visible columns, floored at `baseHeight`. */
export function computeAutoHeaderHeight(input: AutoHeaderHeightInput): number {
  const lineHeight = Math.round(fontPxSize(input.font) * HEADER_LINE_HEIGHT_FACTOR);
  let maxLines = 1;
  for (const col of input.columns) {
    const text = input.wrapText(col.colId);
    if (text === null) continue;
    const lines = wrapHeaderLines(input.measure, text, headerTextWidth(col.width));
    if (lines.length > maxLines) maxLines = lines.length;
  }
  if (maxLines === 1) return input.baseHeight;
  return Math.max(input.baseHeight, maxLines * lineHeight + HEADER_WRAP_VERTICAL_PAD);
}
