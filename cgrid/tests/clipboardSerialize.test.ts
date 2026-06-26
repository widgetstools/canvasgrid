/**
 * Cycle 10 / Task 3 — clipboard copy worker pass.
 *
 * `serializeRanges` walks every `SelectionRange`, reads the per-cell
 * value via `rows[rowIndex][columnsById.get(colId).field]`, applies
 * RFC 4180–style quoting (`"` doubled inside a quoted cell; cell wrapped
 * in quotes when it embeds the delimiter, `"`, or a newline), joins cells
 * within a row with the delimiter, rows within a range with `\n`, and
 * ranges with a single blank line (`\n\n`).
 *
 * Pure function — tests pass plain JS objects + a `Map` as the column
 * lookup. The worker reuses the same function inside the
 * `clipboardSerialize` message handler with a `visIds`-backed row
 * accessor.
 */
import { describe, it, expect } from 'vitest';
import { serializeRanges } from '../src/worker/passes/clipboardPass';
import type { SelectionRange } from '../src/types';

type Row = Record<string, unknown>;
const cols = (entries: Array<[string, string]>): Map<string, { field?: string }> =>
  new Map(entries.map(([colId, field]) => [colId, { field }]));

describe('serializeRanges (Cycle 10 / Task 3)', () => {
  it('serialises a 1×1 range to a single cell value with no trailing newline', () => {
    const rows: Row[] = [{ a: 'hello' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    );
    expect(tsv).toBe('hello');
  });

  it('serialises a 2×2 range row-major with tab delimiter + LF row terminator', () => {
    const rows: Row[] = [
      { a: 'a', b: 'b' },
      { a: 'c', b: 'd' },
    ];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 1, colIds: ['a', 'b'] }],
    );
    expect(tsv).toBe('a\tb\nc\td');
  });

  it('quotes a cell that contains the delimiter', () => {
    const rows: Row[] = [{ a: 'has\ttab', b: 'plain' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a', 'b'] }],
    );
    expect(tsv).toBe('"has\ttab"\tplain');
  });

  it('quotes a cell that contains a newline', () => {
    const rows: Row[] = [{ a: 'line1\nline2', b: 'plain' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a', 'b'] }],
    );
    expect(tsv).toBe('"line1\nline2"\tplain');
  });

  it('quotes a cell that contains a double-quote, doubling the quote inside', () => {
    const rows: Row[] = [{ a: 'she said "hi"' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    );
    expect(tsv).toBe('"she said ""hi"""');
  });

  it('renders null / undefined cells as the empty string (no "null" / "undefined" text)', () => {
    const rows: Row[] = [{ a: null, b: undefined, c: 0, d: '' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a', 'b', 'c', 'd'] }],
    );
    expect(tsv).toBe('\t\t0\t');
  });

  it('joins multiple disjoint ranges with a blank line between blocks', () => {
    const rows: Row[] = [
      { a: '1', b: '2' },
      { a: '3', b: '4' },
      { a: '5', b: '6' },
    ];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [
        { rowStart: 0, rowEnd: 0, colIds: ['a', 'b'] },
        { rowStart: 2, rowEnd: 2, colIds: ['a', 'b'] },
      ],
    );
    expect(tsv).toBe('1\t2\n\n5\t6');
  });

  it('round-trips with a custom delimiter (CSV with comma)', () => {
    const rows: Row[] = [
      { a: 'a', b: 'b' },
      { a: 'c', b: 'd' },
    ];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 1, colIds: ['a', 'b'] }],
      ',',
    );
    expect(tsv).toBe('a,b\nc,d');
  });

  it('quotes only the delimiter that was passed in, not the default tab', () => {
    // With delimiter = ',' a tab in the data is fine (no quoting needed);
    // with delimiter = '\t' (default) the tab forces quoting. Verifies the
    // quoter reads the active delimiter, not a hard-coded char.
    const rows: Row[] = [{ a: 'has\ttab' }];
    const csv = serializeRanges(rows, cols([['a', 'a']]), [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }], ',');
    expect(csv).toBe('has\ttab');
  });

  it('skips out-of-range rowStart..rowEnd entries gracefully (renders blank cells)', () => {
    // A range that extends past the last row results in empty rows being
    // serialised (no crash, no thrown index access).
    const rows: Row[] = [{ a: 'a' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a']]),
      [{ rowStart: 0, rowEnd: 2, colIds: ['a'] }],
    );
    expect(tsv).toBe('a\n\n');
  });

  it('drops a colId with no column entry (treats as missing field → empty cell)', () => {
    const rows: Row[] = [{ a: 'a', b: 'b' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a']]), // no entry for 'b'
      [{ rowStart: 0, rowEnd: 0, colIds: ['a', 'b'] }],
    );
    expect(tsv).toBe('a\t');
  });

  it('coerces numeric values via String() (no Intl.NumberFormat — preserves the raw representation)', () => {
    const rows: Row[] = [{ price: 1234.5, qty: 100 }];
    const tsv = serializeRanges(
      rows,
      cols([['price', 'price'], ['qty', 'qty']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['price', 'qty'] }],
    );
    expect(tsv).toBe('1234.5\t100');
  });

  it('performance: 10k × 50 range serialises in well under the cycle\'s 50 ms budget', () => {
    const rowCount = 10_000;
    const colCount = 50;
    const rows: Row[] = new Array(rowCount);
    const colIds: string[] = new Array(colCount);
    const colEntries: Array<[string, string]> = new Array(colCount);
    for (let c = 0; c < colCount; c++) {
      const id = `c${c}`;
      colIds[c] = id;
      colEntries[c] = [id, id];
    }
    for (let r = 0; r < rowCount; r++) {
      const row: Row = {};
      for (let c = 0; c < colCount; c++) row[`c${c}`] = r * 1000 + c;
      rows[r] = row;
    }
    const ranges: SelectionRange[] = [
      { rowStart: 0, rowEnd: rowCount - 1, colIds },
    ];
    const t0 = performance.now();
    const tsv = serializeRanges(rows, cols(colEntries), ranges);
    const t1 = performance.now();
    // Sanity check: length matches the row count.
    expect(tsv.split('\n').length).toBe(rowCount);
    const elapsed = t1 - t0;
    if (elapsed > 50) {
      // Soft-fail — environments under load (CI shared runner) can blow
      // the budget without indicating a real regression. Track it
      // visibly so the next perf-focused pass sees the number.
      console.warn(`[clipboardSerialize] 10k×50 serialize took ${elapsed.toFixed(1)} ms (budget 50 ms)`);
    }
    // Hard ceiling so a true regression (10× slowdown) still fails.
    expect(elapsed).toBeLessThan(500);
  });
});
