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
 * Cycle 10 / Task 5 — per-cell transform applied BEFORE RFC-4180 quoting.
 * Mirrors `CGridOptions.processCellForClipboard` exactly so cgrid can
 * pass the user callback through without an adapter. Runs ONCE per cell
 * resolved during `serializeRanges` (range-row-major, then column order
 * within each row). The returned value flows through `formatCell` like
 * any raw value would.
 */
export type SerializeCellTransform = (params: {
  value: unknown;
  node: { rowIndex: number; data: unknown };
  column: { colId: string };
}) => unknown;

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
  /** Cycle 10 / Task 5 — optional per-cell transform. When set, runs
   *  AFTER the raw value lookup and BEFORE RFC-4180 quoting. The
   *  returned value flows through `formatCell` the same way a raw
   *  value would. Mirrors ag-grid's `processCellForClipboard`. */
  transformCell?: SerializeCellTransform,
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
      const rowIndex = rowStart + r;
      const row = rows[rowIndex];
      for (let c = 0; c < colIds.length; c++) {
        const field = fields[c];
        const raw = (row !== undefined && field !== undefined)
          ? (row as Record<string, unknown>)[field]
          : undefined;
        const value = transformCell
          ? transformCell({
              value: raw,
              node: { rowIndex, data: row ?? {} },
              column: { colId: colIds[c]! },
            })
          : raw;
        cellBuf[c] = formatCell(value, delimiter);
      }
      rowBuf[r] = cellBuf.join(delimiter);
    }
    rangeBlocks[ri] = rowBuf.join('\n');
  }

  return rangeBlocks.join('\n\n');
}

/**
 * Cycle 10 / Task 4 — inverse of `serializeRanges`. Parses a TSV / CSV
 * string into a 2D `string[][]` array. RFC 4180–style quoting:
 *
 *   - cells wrapped in `"…"` may embed the delimiter, `\n`, or `"` (doubled
 *     as `""`); the surrounding quotes are stripped on output
 *   - the parser handles both `\n` and `\r\n` row terminators identically
 *     (mixed line endings inside one payload also collapse)
 *   - a single trailing newline does NOT produce an extra empty row, but
 *     a fully-empty row mid-input (e.g. `a\n\nb`) does — it represents
 *     a real empty row in the source
 *
 * State machine (no regex — see the per-cycle perf budget):
 *
 *   normal   — reading an unquoted cell; delimiter or newline ends it;
 *              a leading `"` flips to `quoted` (only if at cell start).
 *   quoted   — reading a quoted cell; `""` is an embedded literal `"`;
 *              a single `"` followed by delimiter / newline / EOF closes
 *              the cell.
 *
 * `delimiter` defaults to `\t`. Multi-char delimiters are not supported
 * here (the serialize path is also one-character in practice) — this
 * keeps the inner loop a simple charCode compare.
 *
 * Empty input → `[]`. A 1×1 unquoted cell → `[[cell]]`.
 */
export function deserializeTsv(
  text: string,
  delimiter: string = DEFAULT_DELIMITER,
): string[][] {
  if (text === '') return [];
  const delim = delimiter.charCodeAt(0);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuoted = false;
  let cellStarted = false; // true once any char (including the opening `"`) has been consumed for the current cell
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text.charCodeAt(i);
    if (inQuoted) {
      if (ch === 0x22 /* `"` */) {
        // Doubled `""` inside a quoted cell → emit a single `"`.
        if (i + 1 < len && text.charCodeAt(i + 1) === 0x22) {
          cell += '"';
          i++;
          continue;
        }
        // Closing quote — fall back to normal state. The next char must
        // be a delimiter, newline, or EOF (we don't enforce — anything
        // else is appended to the cell as a tolerant fallback).
        inQuoted = false;
        continue;
      }
      cell += text[i];
      continue;
    }
    // Unquoted state.
    if (ch === delim) {
      row.push(cell);
      cell = '';
      cellStarted = false;
      continue;
    }
    if (ch === 0x0A /* \n */) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      cellStarted = false;
      continue;
    }
    if (ch === 0x0D /* \r */) {
      // Treat \r\n and bare \r the same — the next iter's \n branch
      // (if any) emits the row; here we just skip the \r so the cell
      // text doesn't pick it up.
      // If the next char isn't \n, we still need to emit the row (bare
      // \r from classic-Mac payloads). Emit eagerly + don't double-emit
      // on the following \n.
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      cellStarted = false;
      // Peek: a following \n is the CRLF pair — skip it.
      if (i + 1 < len && text.charCodeAt(i + 1) === 0x0A) i++;
      continue;
    }
    if (ch === 0x22 /* `"` */ && !cellStarted) {
      inQuoted = true;
      cellStarted = true;
      continue;
    }
    cell += text[i];
    cellStarted = true;
  }
  // Final cell — only emit a row when something is in the row OR the
  // final cell holds content. A trailing-newline payload (`a\tb\n`)
  // hits the \n branch above, leaves `row` empty + `cell` empty, and
  // we don't add an empty row here.
  if (cell.length > 0 || row.length > 0 || cellStarted || inQuoted) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Cycle 10 / Task 5 — per-cell paste transform. Mirrors
 * `CGridOptions.processCellFromClipboard` exactly. Runs ONCE per
 * (parsed-cell × resolved-target-cell) tuple, in row-major order over
 * the parsed grid, mapped onto the anchor band (focused cell, walking
 * the visible column order rightward).
 */
export type PasteCellTransform = (params: {
  value: string;
  node: { rowIndex: number; data: unknown };
  column: { colId: string };
}) => unknown;

/**
 * Map the parsed `string[][]` (output of `deserializeTsv`) through
 * `transform` for every cell that has a resolved target row + column.
 *
 * The shape mirrors what `pasteFromClipboard` needs: the parsed grid is
 * anchored at `anchorRowIndex` × `anchorColIndex` and walks the visible
 * column order to the right. `rowDataByIndex` is the snapshot of each
 * row's PRE-paste data; cells off the bottom (`rowDataByIndex` lacks
 * the index) or off the right edge of `visibleColIds` are dropped from
 * the output — paste never inserts rows / columns.
 *
 * Returns the same shape as the input but with each cell value replaced
 * by `transform`'s return value. Cells without a resolvable target row
 * survive as `undefined`; the cgrid glue skips those when building the
 * `applyTransaction({ update })` set.
 *
 * Pure function: tests pass plain Maps + arrays.
 */
export function mapPasteCells(
  parsed: ReadonlyArray<ReadonlyArray<string>>,
  anchorRowIndex: number,
  anchorColIndex: number,
  visibleColIds: ReadonlyArray<string>,
  rowDataByIndex: ReadonlyMap<number, unknown>,
  transform: PasteCellTransform,
): Array<Array<unknown>> {
  const out: Array<Array<unknown>> = new Array(parsed.length);
  for (let r = 0; r < parsed.length; r++) {
    const parsedRow = parsed[r]!;
    const cells: unknown[] = new Array(parsedRow.length);
    const targetRowIndex = anchorRowIndex + r;
    const data = rowDataByIndex.get(targetRowIndex);
    for (let c = 0; c < parsedRow.length; c++) {
      const targetColIdx = anchorColIndex + c;
      const colId = visibleColIds[targetColIdx];
      if (colId === undefined || data === undefined) {
        cells[c] = undefined;
        continue;
      }
      cells[c] = transform({
        value: parsedRow[c]!,
        node: { rowIndex: targetRowIndex, data },
        column: { colId },
      });
    }
    out[r] = cells;
  }
  return out;
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
