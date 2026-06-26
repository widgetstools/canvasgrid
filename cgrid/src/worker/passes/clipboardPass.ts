/**
 * Cycle 10 / Task 3 — clipboard worker pass.
 *
 * `serializeRanges(rows, columnsById, ranges, delimiter?)` walks every
 * `SelectionRange` and produces a TSV-style (or CSV with a custom
 * delimiter) string suitable for `navigator.clipboard.writeText`.
 *
 * Quoting follows RFC 4180:
 *   - cells that embed the active delimiter, `"`, or a newline are wrapped in `"…"`
 *   - embedded `"` is doubled (`"` → `""`) inside the wrapped cell
 *
 * Layout:
 *   - cells inside a row are joined with the delimiter
 *   - rows inside a single range are joined with `\n`
 *   - disjoint ranges are joined with a single blank line (`\n\n`) between
 *     blocks (matches ag-grid's "ranges paste as separate blocks" behavior)
 *
 * Pure function: every row + column lookup happens through the supplied
 * `rows` array + `columnsById` map. The worker side wires this with a
 * `visIds`-backed row accessor (see Task 3's `clipboardSerialize`
 * message handler in `worker.ts`); tests pass plain JS objects + a
 * literal `Map`.
 *
 * Performance: pushes per-cell strings into one row buffer, joins once
 * per row; per-range row buffers collapse via `Array.join('\n')`. Single
 * top-level join across ranges. The 10k × 50 perf test in
 * `clipboardSerialize.test.ts` exercises this hot path.
 */
import type { SelectionRange } from '../../types';

/** Active delimiter when the caller omits the parameter. Matches ag-grid's
 *  `clipboardDelimiter` default. */
const DEFAULT_DELIMITER = '\t';

/** Minimal column metadata `serializeRanges` reads. The worker's
 *  `WorkerColumn` already satisfies this — the looser type means tests
 *  can pass plain objects without dragging the full worker shape. */
export interface SerializeColumnRef {
  field?: string;
}

/**
 * Serialize the supplied `ranges` into a single TSV / CSV string.
 *
 * `rows[rowIndex]` is the row at the given visible-order index — the
 * caller resolves the (rowId → row) lookup before invoking. Empty /
 * undefined rows render as a row of empty cells (no crash).
 *
 * `columnsById.get(colId).field` is the dot-free property name the row
 * resolves through. Columns missing from the map render as empty cells.
 *
 * `ranges` may be empty (returns `''`) or contain disjoint rectangles.
 *
 * `delimiter` defaults to `\t`. Apps configure CSV via `,` — any single
 * character is legal; multi-char strings work but are rare in practice.
 */
export function serializeRanges(
  rows: ReadonlyArray<Record<string, unknown> | undefined>,
  columnsById: ReadonlyMap<string, SerializeColumnRef>,
  ranges: ReadonlyArray<SelectionRange>,
  delimiter: string = DEFAULT_DELIMITER,
): string {
  if (ranges.length === 0) return '';

  // Hoisted scratch buffers — re-used across cells / rows / ranges to
  // avoid GC churn on the 10k × 50 hot path.
  const rangeBlocks: string[] = new Array(ranges.length);

  for (let ri = 0; ri < ranges.length; ri++) {
    const range = ranges[ri]!;
    const { rowStart, rowEnd, colIds } = range;
    const rowCount = rowEnd - rowStart + 1;
    const rowBuf: string[] = new Array(Math.max(0, rowCount));
    // Pre-resolve fields for this range so the inner loop is just a
    // property read, not a Map.get per cell.
    const fields: Array<string | undefined> = new Array(colIds.length);
    for (let c = 0; c < colIds.length; c++) {
      fields[c] = columnsById.get(colIds[c]!)?.field;
    }
    const cellBuf: string[] = new Array(colIds.length);
    for (let r = 0; r < rowCount; r++) {
      const row = rows[rowStart + r];
      for (let c = 0; c < colIds.length; c++) {
        const field = fields[c];
        const value = (row !== undefined && field !== undefined)
          ? (row as Record<string, unknown>)[field]
          : undefined;
        cellBuf[c] = formatCell(value, delimiter);
      }
      rowBuf[r] = cellBuf.join(delimiter);
    }
    rangeBlocks[ri] = rowBuf.join('\n');
  }

  return rangeBlocks.join('\n\n');
}

/** Coerce a single cell value to its TSV / CSV representation. `null` /
 *  `undefined` render as the empty string; everything else flows through
 *  `String(...)`. The result is wrapped in `"…"` (with embedded `"` doubled)
 *  iff it contains the delimiter, `"`, `\n`, or `\r`. */
function formatCell(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (s.length === 0) return '';
  // Fast path: no special character → return the raw string.
  let needsQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    // 0x22 = '"', 0x0A = '\n', 0x0D = '\r'.
    if (ch === 0x22 || ch === 0x0A || ch === 0x0D) {
      needsQuote = true;
      break;
    }
  }
  // Delimiter scan: works for multi-char delimiters too. Most callers use
  // a single char (`\t` / `,`) so `indexOf` is constant-ish in practice.
  if (!needsQuote && s.indexOf(delimiter) !== -1) {
    needsQuote = true;
  }
  if (!needsQuote) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}
