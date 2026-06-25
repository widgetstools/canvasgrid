import { describe, it, expect, vi } from 'vitest';
import { measureColumnWidths, type AutosizeColumnSpec } from '../src/worker/autosize';

/**
 * Cycle 6 / Task 4 — worker autosize pass.
 *
 * The pass is exercised against a pure measurer (`text.length * 8`) so the
 * test does not depend on `OffscreenCanvas`. Behavior covered:
 * - 5,000-row sample cap (head 2,500 + tail 2,500) so a 1M-row autosize is
 *   bounded
 * - `skipHeader: false` includes the header label in the max
 * - empty / zero-row column falls back to the column's `minWidth`
 * - per-column font is forwarded to the measurer
 * - per-cell horizontal padding is added to the measured width
 */

const PER_CHAR = 8;

const spec = (
  over: Partial<AutosizeColumnSpec> = {},
): AutosizeColumnSpec => ({
  colId: over.colId ?? 'c',
  headerName: over.headerName ?? '',
  font: over.font ?? '13px system-ui',
  padding: over.padding ?? 16,
  minWidth: over.minWidth ?? 30,
  maxWidth: over.maxWidth ?? Number.POSITIVE_INFINITY,
  textOf: over.textOf ?? (() => ''),
});

describe('measureColumnWidths', () => {
  it('returns the column minWidth for an empty row set', () => {
    const widths = measureColumnWidths({
      cols: [spec({ colId: 'a', minWidth: 42 })],
      rowCount: 0,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    expect(widths.get('a')).toBe(42);
  });

  it('includes the header label when skipHeader is false', () => {
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'a', headerName: 'Header That Is Wide', padding: 10, minWidth: 0,
        textOf: () => 'x',
      })],
      rowCount: 1,
      skipHeader: false,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // Header is the widest text: 'Header That Is Wide' = 19 chars * 8 = 152.
    // + padding 10 = 162.
    expect(widths.get('a')).toBe(19 * PER_CHAR + 10);
  });

  it('excludes the header label when skipHeader is true', () => {
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'a', headerName: 'Header That Is Wide', padding: 0, minWidth: 0,
        textOf: () => 'short',
      })],
      rowCount: 1,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // Only 'short' = 5 * 8 = 40 considered.
    expect(widths.get('a')).toBe(40);
  });

  it('caps the row scan at 5000 rows (head 2500 + tail 2500)', () => {
    const seen = new Set<number>();
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'a', padding: 0, minWidth: 0,
        textOf: (rowIndex) => {
          seen.add(rowIndex);
          return rowIndex === 1_000_000 - 1 ? 'longest-in-the-whole-set' : 'x';
        },
      })],
      rowCount: 1_000_000,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // Exactly 5,000 rows scanned: indices [0..2499] ∪ [997500..999999].
    expect(seen.size).toBe(5000);
    // The tail must include the last row's longer string — so the widest
    // measurement actually wins.
    expect(seen.has(999_999)).toBe(true);
    expect(seen.has(2_500)).toBe(false);
    expect(widths.get('a')).toBe('longest-in-the-whole-set'.length * PER_CHAR);
  });

  it('honors a custom maxSampleSize override', () => {
    const seen: number[] = [];
    measureColumnWidths({
      cols: [spec({
        colId: 'a',
        textOf: (rowIndex) => { seen.push(rowIndex); return String(rowIndex); },
      })],
      rowCount: 10,
      skipHeader: true,
      maxSampleSize: 4,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // head 2 + tail 2 → indices [0, 1, 8, 9].
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 8, 9]);
  });

  it('forwards the per-column font into the measurer factory', () => {
    const factory = vi.fn((font: string) => (s: string) => s.length * PER_CHAR + (font === 'big' ? 100 : 0));
    const widths = measureColumnWidths({
      cols: [
        spec({ colId: 'a', font: 'small', padding: 0, minWidth: 0, textOf: () => 'x' }),
        spec({ colId: 'b', font: 'big', padding: 0, minWidth: 0, textOf: () => 'x' }),
      ],
      rowCount: 1,
      skipHeader: true,
      measureFor: factory,
    });
    expect(factory).toHaveBeenCalledWith('small');
    expect(factory).toHaveBeenCalledWith('big');
    expect(widths.get('a')).toBe(PER_CHAR);
    expect(widths.get('b')).toBe(PER_CHAR + 100);
  });

  it('adds per-cell horizontal padding to the measured width', () => {
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'a', padding: 16, minWidth: 0,
        textOf: () => 'hello',
      })],
      rowCount: 1,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // 'hello' = 5 * 8 = 40, + 16 padding = 56.
    expect(widths.get('a')).toBe(40 + 16);
  });

  it('clamps results below minWidth up to minWidth', () => {
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'a', padding: 0, minWidth: 100,
        textOf: () => 'hi',
      })],
      rowCount: 1,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    expect(widths.get('a')).toBe(100);
  });
});
