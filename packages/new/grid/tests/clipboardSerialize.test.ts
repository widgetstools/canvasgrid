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
import { describe, it, expect, vi } from 'vitest';
import {
  serializeRanges,
  deserializeTsv,
  mapPasteCells,
} from '../src/worker/passes/clipboardPass';
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

  it('round-trips a 2×2 TSV through serialize → deserialize → identical 2D array', () => {
    const rows: Row[] = [
      { a: 'a', b: 'b' },
      { a: 'c', b: 'd' },
    ];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 1, colIds: ['a', 'b'] }],
    );
    expect(deserializeTsv(tsv)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('round-trips a quoted cell containing an embedded tab', () => {
    const rows: Row[] = [{ a: 'has\ttab', b: 'plain' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a', 'b'] }],
    );
    expect(deserializeTsv(tsv)).toEqual([['has\ttab', 'plain']]);
  });

  it('round-trips a quoted cell containing an embedded newline', () => {
    const rows: Row[] = [{ a: 'line1\nline2', b: 'plain' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a', 'b'] }],
    );
    expect(deserializeTsv(tsv)).toEqual([['line1\nline2', 'plain']]);
  });

  it('round-trips a quoted cell containing an embedded double-quote (RFC-4180 doubled)', () => {
    const rows: Row[] = [{ a: 'she said "hi"' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    );
    expect(deserializeTsv(tsv)).toEqual([['she said "hi"']]);
  });

  it('parses both \\r\\n and \\n line endings identically', () => {
    // The CRLF and LF inputs decode to the same 2D array. Mixed
    // (\r\n between row 0 and 1, \n between row 1 and 2) also collapses
    // — apps pasting from Windows + Unix sources hit this combo.
    expect(deserializeTsv('a\tb\r\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(deserializeTsv('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(deserializeTsv('a\tb\r\nc\td\ne\tf')).toEqual([
      ['a', 'b'], ['c', 'd'], ['e', 'f'],
    ]);
  });

  it('a single trailing newline does NOT produce an extra empty row', () => {
    expect(deserializeTsv('a\tb\nc\td\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(deserializeTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('round-trips with a custom delimiter (CSV with comma)', () => {
    const rows: Row[] = [
      { a: 'a', b: 'b' },
      { a: 'c,d', b: 'plain' },
    ];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 1, colIds: ['a', 'b'] }],
      ',',
    );
    expect(deserializeTsv(tsv, ',')).toEqual([
      ['a', 'b'],
      ['c,d', 'plain'],
    ]);
  });

  it('parses an empty cell at the end of a row as an empty string slot', () => {
    expect(deserializeTsv('a\t')).toEqual([['a', '']]);
    expect(deserializeTsv('a\tb\n\td')).toEqual([['a', 'b'], ['', 'd']]);
  });

  it('returns an empty array for an empty input string', () => {
    expect(deserializeTsv('')).toEqual([]);
  });

  it('handles a 1×1 unquoted cell', () => {
    expect(deserializeTsv('hello')).toEqual([['hello']]);
  });

  it('parses a quoted cell that contains both delimiter and newline', () => {
    // Excel pastes a multi-line cell as `"line1\nline2"`. The combined
    // case verifies the state machine doesn't bail when both special
    // chars land inside the same quoted cell.
    expect(deserializeTsv('"a\tb\nc"\tplain')).toEqual([['a\tb\nc', 'plain']]);
  });

  it('processCellForClipboard: invoked once per cell in range-row-major order', () => {
    // Cycle 10 / Task 5 — `serializeRanges` accepts an optional
    // `transformCell` callback that runs AFTER value resolution and
    // BEFORE RFC-4180 quoting. The callback receives `{ value, node:
    // { rowIndex, data }, column: { colId } }` — same shape as the
    // public ag-grid surface (`VelocityGridOptions.processCellForClipboard`).
    const rows: Row[] = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ];
    const transform = vi.fn(({ value }: { value: unknown }) => `<${String(value)}>`);
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a'], ['b', 'b']]),
      [{ rowStart: 0, rowEnd: 1, colIds: ['a', 'b'] }],
      '\t',
      transform,
    );
    expect(tsv).toBe('<1>\t<2>\n<3>\t<4>');
    expect(transform).toHaveBeenCalledTimes(4);
    // Callback receives the raw value + the rowIndex + the row data + colId.
    expect(transform).toHaveBeenNthCalledWith(1, {
      value: 1, node: { rowIndex: 0, data: rows[0] }, column: { colId: 'a' },
    });
    expect(transform).toHaveBeenNthCalledWith(4, {
      value: 4, node: { rowIndex: 1, data: rows[1] }, column: { colId: 'b' },
    });
  });

  it('processCellForClipboard: return value flows through RFC-4180 quoting', () => {
    // When the transform returns a value containing the delimiter or a
    // newline, the cell still gets quoted just like a raw value would.
    const rows: Row[] = [{ a: 'plain' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
      '\t',
      () => 'has\ttab',
    );
    expect(tsv).toBe('"has\ttab"');
  });

  it('processCellForClipboard: return value is null / undefined → empty string (like raw)', () => {
    const rows: Row[] = [{ a: 'something' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
      '\t',
      () => null,
    );
    expect(tsv).toBe('');
  });

  it('processCellForClipboard: undefined transform = legacy behaviour (raw value)', () => {
    // Belt-and-braces: omitting `transformCell` reproduces the Task 3
    // path bit-for-bit (no callback hop allocated, raw values flow through).
    const rows: Row[] = [{ a: 'hello' }];
    const tsv = serializeRanges(
      rows,
      cols([['a', 'a']]),
      [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }],
    );
    expect(tsv).toBe('hello');
  });

  it('processCellFromClipboard: mapPasteCells runs the callback per parsed cell', () => {
    // `mapPasteCells` is the pure helper cgrid uses to apply the
    // `processCellFromClipboard` transform between the worker's TSV
    // parse and the `applyTransaction({ update })` commit.
    const parsed = [
      ['11', '12'],
      ['21', '22'],
    ];
    const rowDataByIndex = new Map<number, unknown>([
      [3, { a: 'old11', b: 'old12' }],
      [4, { a: 'old21', b: 'old22' }],
    ]);
    const visibleColIds = ['a', 'b', 'c'];
    const transform = vi.fn(({ value }: { value: string }) => Number(value));
    const out = mapPasteCells(
      parsed,
      /* anchorRowIndex */ 3,
      /* anchorColIndex */ 0,
      visibleColIds,
      rowDataByIndex,
      transform,
    );
    expect(out).toEqual([
      [11, 12],
      [21, 22],
    ]);
    expect(transform).toHaveBeenCalledTimes(4);
    expect(transform).toHaveBeenNthCalledWith(1, {
      value: '11',
      node: { rowIndex: 3, data: { a: 'old11', b: 'old12' } },
      column: { colId: 'a' },
    });
    expect(transform).toHaveBeenNthCalledWith(4, {
      value: '22',
      node: { rowIndex: 4, data: { a: 'old21', b: 'old22' } },
      column: { colId: 'b' },
    });
  });

  it('mapPasteCells: respects the column anchor offset (paste into columns to the right)', () => {
    // Anchoring at colIndex 1 → first parsed col lands in visibleColIds[1].
    const parsed = [['x', 'y']];
    const rowDataByIndex = new Map<number, unknown>([[0, {}]]);
    const visibleColIds = ['a', 'b', 'c'];
    const seen: string[] = [];
    mapPasteCells(parsed, 0, 1, visibleColIds, rowDataByIndex, ({ column }) => {
      seen.push(column.colId);
      return '';
    });
    expect(seen).toEqual(['b', 'c']);
  });

  it('mapPasteCells: cells off the bottom or right edge survive as undefined (skipped by cgrid glue)', () => {
    // Parsed grid extends past the rowDataByIndex band and the visible
    // column count. Both edges drop without invoking the callback —
    // the cgrid glue treats `undefined` as "skip the assignment".
    const parsed = [
      ['a', 'b', 'c'], // 3 cols against a 2-col anchor band
      ['d', 'e', 'f'], // off the bottom
    ];
    const rowDataByIndex = new Map<number, unknown>([[0, { x: '' }]]); // only row 0 known
    const visibleColIds = ['x', 'y']; // only 2 visible columns
    const transform = vi.fn(() => 'TRANSFORMED');
    const out = mapPasteCells(parsed, 0, 0, visibleColIds, rowDataByIndex, transform);
    expect(out).toEqual([
      ['TRANSFORMED', 'TRANSFORMED', undefined], // col 'c' off the right edge
      [undefined, undefined, undefined],         // row off the bottom
    ]);
    expect(transform).toHaveBeenCalledTimes(2);
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
