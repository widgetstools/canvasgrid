// Cycle 21i / Phase 1 — header wrap + auto header height unit tests.
//
// The wrap algorithm is shared verbatim by the header painter and the
// layout-side height computation, so these tests pin both: greedy word
// wrap (with mid-word breaking for oversized tokens) and the height
// formula (maxLines × lineHeight + vertical pad, floored at base).

import { describe, it, expect } from 'vitest';
import {
  wrapHeaderLines,
  computeAutoHeaderHeight,
  headerTextWidth,
  fontPxSize,
  HEADER_LINE_HEIGHT_FACTOR,
  HEADER_WRAP_VERTICAL_PAD,
} from '../src/renderer/cellRenderers/headerWrap';

/** 8px per character measure — deterministic, no canvas needed. */
const measure = (s: string) => s.length * 8;

describe('wrapHeaderLines', () => {
  it('returns a single line when the text fits', () => {
    expect(wrapHeaderLines(measure, 'P&L', 100)).toEqual(['P&L']);
  });

  it('wraps on word boundaries', () => {
    // 'Unrealized' = 80px, 'P&L' = 24px; maxWidth 80 forces two lines.
    expect(wrapHeaderLines(measure, 'Unrealized P&L', 80)).toEqual(['Unrealized', 'P&L']);
  });

  it('packs as many words per line as fit', () => {
    expect(wrapHeaderLines(measure, 'Net Mkt Val USD', 88)).toEqual(['Net Mkt Val', 'USD']);
  });

  it('breaks oversized single tokens mid-word', () => {
    const lines = wrapHeaderLines(measure, 'ABCDEFGHIJ', 40); // 5 chars per line
    expect(lines).toEqual(['ABCDE', 'FGHIJ']);
  });

  it('handles empty text', () => {
    expect(wrapHeaderLines(measure, '', 100)).toEqual(['']);
  });
});

describe('computeAutoHeaderHeight', () => {
  const font = '12px Inter';
  const lineH = Math.round(fontPxSize(font) * HEADER_LINE_HEIGHT_FACTOR);

  it('returns base height when nothing wraps', () => {
    const h = computeAutoHeaderHeight({
      columns: [{ colId: 'a', width: 300 }],
      wrapText: () => 'Short',
      measure,
      font,
      baseHeight: 32,
    });
    expect(h).toBe(32);
  });

  it('grows to the tallest wrapped header', () => {
    const width = 100; // headerTextWidth → 100-16-22 = 62 → ~7 chars/line
    const h = computeAutoHeaderHeight({
      columns: [
        { colId: 'a', width: 300 },
        { colId: 'b', width },
      ],
      wrapText: (id) => (id === 'b' ? 'Unrealized Daily P&L' : 'Short'),
      measure,
      font,
      baseHeight: 32,
    });
    const expectedLines = wrapHeaderLines(measure, 'Unrealized Daily P&L', headerTextWidth(width)).length;
    expect(expectedLines).toBeGreaterThan(1);
    expect(h).toBe(Math.max(32, expectedLines * lineH + HEADER_WRAP_VERTICAL_PAD));
  });

  it('never returns less than base height', () => {
    const h = computeAutoHeaderHeight({
      columns: [{ colId: 'a', width: 100 }],
      wrapText: () => 'Two Words',
      measure,
      font,
      baseHeight: 200,
    });
    expect(h).toBe(200);
  });

  it('skips columns whose wrapText returns null', () => {
    const h = computeAutoHeaderHeight({
      columns: [{ colId: 'a', width: 60 }],
      wrapText: () => null,
      measure,
      font,
      baseHeight: 32,
    });
    expect(h).toBe(32);
  });
});

describe('agg-decorated header wrapping', () => {
  it('breaks after the opening paren, no space re-inserted', () => {
    // 'sum(Notional)' = 13 chars = 104px; maxWidth 72 → 9 chars/line,
    // so 'Notional)' (9 chars) fits once broken after the paren.
    expect(wrapHeaderLines(measure, 'sum(Notional)', 72)).toEqual(['sum(', 'Notional)']);
  });
});
