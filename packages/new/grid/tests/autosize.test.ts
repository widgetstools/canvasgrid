import { describe, it, expect, vi } from 'vitest';
import {
  measureColumnWidths,
  type AutosizeColumnSpec,
  type AutosizeGroupNode,
} from '../src/worker/autosize';

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
 * - `groupContext` walks the group tree and applies chrome-aware width
 *   for the synthesized auto-group column
 */

const PER_CHAR = 8;

const spec = (
  over: Partial<AutosizeColumnSpec> = {},
): AutosizeColumnSpec => ({
  colId: over.colId ?? 'c',
  headerName: over.headerName ?? '',
  font: over.font ?? '13px system-ui',
  padding: over.padding ?? 16,
  headerPadding: over.headerPadding,
  minWidth: over.minWidth ?? 30,
  maxWidth: over.maxWidth ?? Number.POSITIVE_INFINITY,
  textOf: over.textOf ?? (() => ''),
  groupContext: over.groupContext,
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

/**
 * Auto-group column autosize. `groupContext` shifts the pass from
 * per-row-field sampling to walking the group tree and applying
 * per-node chrome (indent + chevron + optional checkbox + optional
 * `(count)` suffix). Same measurer contract as the regular path so
 * every test here stays independent of `OffscreenCanvas`.
 */
describe('measureColumnWidths — group column (groupContext)', () => {
  const node = (
    over: Partial<AutosizeGroupNode> = {},
  ): AutosizeGroupNode => ({
    valueFormatted: over.valueFormatted ?? '',
    depth: over.depth ?? 0,
    childCount: over.childCount ?? 0,
  });

  it('applies chromeBase + depth × indentUnit + measured value width', () => {
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn',
        padding: 0, minWidth: 0,
        // textOf must be short-circuited: group columns must NEVER
        // read row[field] since they have no field. Fail loud if
        // the impl ever routes through this callback.
        textOf: () => { throw new Error('group autosize must not read textOf'); },
        groupContext: {
          chromeBase: 30,   // 2*PAD(6) + CHEVRON(12) + CHEVRON_GAP(6) = 30
          indentUnit: 14,
          suppressCount: true,
          countGap: 4,
          nodes: [
            node({ valueFormatted: 'Tech', depth: 0, childCount: 5 }),
            node({ valueFormatted: 'Financials', depth: 0, childCount: 3 }),
            node({ valueFormatted: 'AAPL', depth: 1, childCount: 2 }),
          ],
        },
      })],
      rowCount: 0,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // Widest = 'Financials' (10 chars * 8 = 80) at depth 0 (indent 0) →
    // 30 + 0 + 80 = 110.
    // 'AAPL' at depth 1 (indent 14) → 30 + 14 + 32 = 76 → loses.
    expect(widths.get('ag-Grid-AutoColumn')).toBe(110);
  });

  it('adds count suffix width when suppressCount is false', () => {
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn',
        padding: 0, minWidth: 0,
        textOf: () => '',
        groupContext: {
          chromeBase: 30,
          indentUnit: 14,
          suppressCount: false,
          countGap: 4,
          nodes: [
            node({ valueFormatted: 'X', depth: 0, childCount: 1234 }),
          ],
        },
      })],
      rowCount: 0,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // Value 'X' = 8. Count '(1,234)' = 7 chars * 8 = 56. + countGap 4.
    // Total = 30 (chrome) + 0 (indent) + 8 (val) + 4 (gap) + 56 (count) = 98.
    expect(widths.get('ag-Grid-AutoColumn')).toBe(98);
  });

  it('drops count suffix when childCount is 0', () => {
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn',
        padding: 0, minWidth: 0,
        textOf: () => '',
        groupContext: {
          chromeBase: 30,
          indentUnit: 14,
          suppressCount: false,
          countGap: 4,
          nodes: [
            node({ valueFormatted: 'Empty', depth: 0, childCount: 0 }),
          ],
        },
      })],
      rowCount: 0,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // 30 + 0 + 40 (5 * 8) = 70. No count suffix.
    expect(widths.get('ag-Grid-AutoColumn')).toBe(70);
  });

  it('multipleColumns mode: groupColumnDepth filter + indent=0', () => {
    const widths = measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn-1',
        padding: 0, minWidth: 0,
        textOf: () => '',
        groupContext: {
          chromeBase: 30,
          indentUnit: 0,           // multipleColumns → indent zero
          suppressCount: true,
          countGap: 4,
          groupColumnDepth: 1,     // only measure depth-1 nodes
          nodes: [
            node({ valueFormatted: 'wide-at-depth-zero-should-be-ignored', depth: 0 }),
            node({ valueFormatted: 'AAPL', depth: 1 }),
            node({ valueFormatted: 'winner-at-depth-one', depth: 1 }),
            node({ valueFormatted: 'skip-me-too', depth: 2 }),
          ],
        },
      })],
      rowCount: 0,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // Depth 1 winner: 'winner-at-depth-one' = 19 * 8 = 152. + chromeBase 30.
    expect(widths.get('ag-Grid-AutoColumn-1')).toBe(152 + 30);
  });

  it('empty tree falls back to header (or minWidth if skipHeader)', () => {
    const withHeader = measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn',
        headerName: 'Group', padding: 0, headerPadding: 30, minWidth: 40,
        textOf: () => '',
        groupContext: {
          chromeBase: 30,
          indentUnit: 14,
          suppressCount: true,
          countGap: 4,
          nodes: [],
        },
      })],
      rowCount: 0,
      skipHeader: false,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    // Header 'Group' = 5 * 8 = 40 + headerPadding 30 = 70. Beats minWidth 40.
    expect(withHeader.get('ag-Grid-AutoColumn')).toBe(70);

    const noHeader = measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn',
        headerName: 'Group', padding: 0, minWidth: 40,
        textOf: () => '',
        groupContext: {
          chromeBase: 30,
          indentUnit: 14,
          suppressCount: true,
          countGap: 4,
          nodes: [],
        },
      })],
      rowCount: 0,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    expect(noHeader.get('ag-Grid-AutoColumn')).toBe(40);
  });

  it('honors minWidth / maxWidth clamps on the group-tree result', () => {
    const clampedHigh = measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn',
        padding: 0, minWidth: 0, maxWidth: 50,
        textOf: () => '',
        groupContext: {
          chromeBase: 30,
          indentUnit: 14,
          suppressCount: true,
          countGap: 4,
          nodes: [node({ valueFormatted: 'very-long-value', depth: 0 })],
        },
      })],
      rowCount: 0,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    expect(clampedHigh.get('ag-Grid-AutoColumn')).toBe(50);

    const clampedLow = measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn',
        padding: 0, minWidth: 500, maxWidth: 1000,
        textOf: () => '',
        groupContext: {
          chromeBase: 30,
          indentUnit: 14,
          suppressCount: true,
          countGap: 4,
          nodes: [node({ valueFormatted: 'X', depth: 0 })],
        },
      })],
      rowCount: 0,
      skipHeader: true,
      measureFor: () => (s: string) => s.length * PER_CHAR,
    });
    expect(clampedLow.get('ag-Grid-AutoColumn')).toBe(500);
  });

  it('uses per-column font for the group value measurer', () => {
    const factory = vi.fn((font: string) => (s: string) => s.length * PER_CHAR + (font === 'big' ? 100 : 0));
    measureColumnWidths({
      cols: [spec({
        colId: 'ag-Grid-AutoColumn', font: 'big',
        padding: 0, minWidth: 0,
        textOf: () => '',
        groupContext: {
          chromeBase: 0,
          indentUnit: 0,
          suppressCount: true,
          countGap: 4,
          nodes: [node({ valueFormatted: 'x', depth: 0 })],
        },
      })],
      rowCount: 0,
      skipHeader: true,
      measureFor: factory,
    });
    expect(factory).toHaveBeenCalledWith('big');
  });
});
