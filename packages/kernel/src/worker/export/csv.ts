/**
 * Cycle 20 / Task 1 — CSV writer (worker-side).
 *
 * Pure function: given (rows, columns, opts) returns the CSV bytes as
 * a `Uint8Array`. Streaming, allocation-bounded:
 *
 *  - Bytes accumulate in a growable scratch buffer (starts 64KB,
 *    doubles on growth). One Uint8Array, one ArrayBuffer — no string
 *    concatenation, no per-cell allocation.
 *  - Each cell is UTF-8 encoded via a shared `TextEncoder`. Numbers /
 *    booleans go through `String()`; null / undefined become empty.
 *  - RFC 4180 quoting: wrap a field in `"..."` when it contains the
 *    column separator, a double-quote, CR, or LF. Embedded quotes
 *    double.
 *  - Line ending: `\r\n` (Excel-friendly).
 *  - Optional 3-byte UTF-8 BOM for Excel auto-detect.
 *
 * The writer is intentionally separate from the worker dispatch:
 * Task 3 wraps it with a `case 'exportData'` handler that resolves the
 * effective row set + column list before calling in. Keeping the
 * writer pure makes unit testing trivial and lets a future XLSX
 * writer share the same row-shape contract.
 */

/** Minimal per-column metadata the writer needs. The worker holds
 *  more (type, agg func, etc.); this is the subset relevant to
 *  serialization. */
export interface CsvWriteColumn {
  /** Identity. Used by `columnKeys` filter + as a fallback header. */
  colId: string;
  /** Dot-free key into the row object. `String(row[field])` is the
   *  raw value. When undefined, the column is skipped on row write
   *  (only its header would emit). */
  field?: string;
  /** Header label. Falls back to `colId` when missing. */
  headerName?: string;
}

/** Inputs the writer respects. Mirrors AG-Grid's CSVExportParams
 *  surface for the bits a pure serializer can honour. Row-set
 *  selection (`onlySelected`, `skipRowGroups`, etc.) is the caller's
 *  responsibility — the writer just serializes whatever `rows` the
 *  caller passed. */
export interface CsvWriteOptions {
  columnSeparator?: string;     // default ','
  columnKeys?: string[];        // export only these columns, in this order
  skipColumnHeaders?: boolean;  // omit the header row entirely
  suppressQuotes?: boolean;     // emit raw values (CSV becomes ambiguous)
  withBOM?: boolean;            // prepend UTF-8 BOM (Excel)
  prependContent?: string;      // emitted before the header row, verbatim
  appendContent?: string;       // emitted after the last data row, verbatim
}

const DEFAULT_SEPARATOR = ',';
const CRLF = '\r\n';
const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
const INITIAL_BUFFER_BYTES = 64 * 1024;

/** UTF-8 encoder reused across calls. `encodeInto` writes directly
 *  into the scratch buffer, avoiding the per-cell `encode()` →
 *  `set()` two-step that allocates a fresh Uint8Array per cell. */
const encoder = new TextEncoder();

/** Resolve which columns participate in this export. When
 *  `columnKeys` is set, honour both the filter and the order. */
function resolveColumns(columns: CsvWriteColumn[], columnKeys?: string[]): CsvWriteColumn[] {
  if (!columnKeys || columnKeys.length === 0) return columns;
  const byId = new Map(columns.map((c) => [c.colId, c]));
  const out: CsvWriteColumn[] = [];
  for (const id of columnKeys) {
    const col = byId.get(id);
    if (col) out.push(col);
  }
  return out;
}

/** True when `value` needs RFC 4180 quoting under the current
 *  separator. Cheap scan — no allocation. */
function needsQuoting(value: string, sep: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    // Quote, CR, LF, or any character of the separator.
    if (c === 0x22 || c === 0x0D || c === 0x0A) return true;
    if (value[i] === sep) return true;
  }
  return false;
}

/** Quote `value` per RFC 4180: wrap in `"..."` + double embedded
 *  quotes. Allocates one string. */
function quoteField(value: string): string {
  if (value.indexOf('"') === -1) return `"${value}"`;
  return `"${value.split('"').join('""')}"`;
}

/** Stringify a cell value. `null` and `undefined` collapse to `''`;
 *  numbers / booleans go through `String()`; strings pass through. */
function cellToString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return typeof raw === 'string' ? raw : String(raw);
}

/** Growable byte buffer. Two ops — `writeText` for arbitrary strings
 *  and `writeBytes` for already-encoded byte runs (BOM). */
class ByteScratch {
  private buf: Uint8Array;
  private len = 0;

  constructor(initial = INITIAL_BUFFER_BYTES) {
    this.buf = new Uint8Array(initial);
  }

  private ensureCapacity(extra: number): void {
    const needed = this.len + extra;
    if (needed <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < needed) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  writeText(text: string): void {
    if (text.length === 0) return;
    // Worst-case UTF-8: 3 bytes per JS code unit (BMP only); 4 for
    // surrogate pairs but those still amortize ≤ 3 per code unit.
    // Reserve the worst case so encodeInto fits in one pass.
    this.ensureCapacity(text.length * 3);
    const { written } = encoder.encodeInto(text, this.buf.subarray(this.len));
    this.len += written ?? 0;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  /** Final result. Returns a view (not a copy) over the populated
   *  range — the caller usually wraps it in a Blob or transfers it. */
  toBytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

/** Write a single cell — formats and quotes per the active options. */
function writeCell(scratch: ByteScratch, raw: unknown, sep: string, suppressQuotes: boolean): void {
  const text = cellToString(raw);
  if (suppressQuotes) {
    scratch.writeText(text);
    return;
  }
  if (text.length > 0 && needsQuoting(text, sep)) {
    scratch.writeText(quoteField(text));
    return;
  }
  scratch.writeText(text);
}

/** Serialize `rows` to CSV bytes. */
export function writeCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: CsvWriteColumn[],
  opts: CsvWriteOptions,
): Uint8Array {
  const sep = opts.columnSeparator ?? DEFAULT_SEPARATOR;
  const suppress = opts.suppressQuotes === true;
  const cols = resolveColumns(columns, opts.columnKeys);
  const scratch = new ByteScratch();

  if (opts.withBOM) scratch.writeBytes(BOM);
  if (opts.prependContent) scratch.writeText(opts.prependContent);

  // Header row.
  if (!opts.skipColumnHeaders) {
    for (let i = 0; i < cols.length; i++) {
      if (i > 0) scratch.writeText(sep);
      const header = cols[i]!.headerName ?? cols[i]!.colId;
      writeCell(scratch, header, sep, suppress);
    }
    scratch.writeText(CRLF);
  }

  // Data rows.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let i = 0; i < cols.length; i++) {
      if (i > 0) scratch.writeText(sep);
      const field = cols[i]!.field;
      const value = field === undefined ? undefined : row[field];
      writeCell(scratch, value, sep, suppress);
    }
    scratch.writeText(CRLF);
  }

  if (opts.appendContent) scratch.writeText(opts.appendContent);

  return scratch.toBytes();
}
