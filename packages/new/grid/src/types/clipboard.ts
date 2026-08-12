// Clipboard + export callback parameter shapes. Cycle 10 introduced the
// clipboard process callbacks; cycle 20 added the ExportCallback. Leaf
// module — no intra-types dependencies.

/** Cycle 10 / Task 5 — params for `processCellForClipboard`. Mirrors
 *  ag-grid's shape (`value`, `node: { rowIndex, data }`, `column: { colId
 *  }`). The callback fires once per (range cell × visible row), in
 *  range-row-major order across the current `getCellRanges()` snapshot. */
export interface ProcessCellForClipboardParams<TRow = any> {
  /** Raw value read from the row's field. May be `null` / `undefined`
   *  when the row lacks the field; the callback decides how to render. */
  value: unknown;
  /** Row data + visible row index at copy time. `data` is a snapshot of
   *  the row's current values (the same object the `valueGetter` /
   *  `valueFormatter` callbacks see). */
  node: { rowIndex: number; data: TRow };
  /** Target column — only the `colId` is guaranteed, mirroring ag-grid. */
  column: { colId: string };
}

export type ProcessCellForClipboardCallback<TRow = any> =
  (params: ProcessCellForClipboardParams<TRow>) => unknown;

/** Cycle 10 / Task 5 — params for `processCellFromClipboard`. */
export interface ProcessCellFromClipboardParams<TRow = any> {
  /** Parsed cell value from the clipboard payload — always a string
   *  (RFC-4180 unwrapping happens upstream). Apps coerce to the
   *  column's domain type inside the callback. */
  value: string;
  /** Target row + its visible row index. `data` reflects the row's
   *  PRE-paste state so apps can reference current values. */
  node: { rowIndex: number; data: TRow };
  /** Target column — only `colId` is guaranteed, mirroring ag-grid. */
  column: { colId: string };
}

export type ProcessCellFromClipboardCallback<TRow = any> =
  (params: ProcessCellFromClipboardParams<TRow>) => unknown;

/** Cycle 20 / Task 4 — value-transform callback fired during export.
 *  Same shape covers `processCellCallback`, `processHeaderCallback`,
 *  and `processRowGroupCallback` — apps switch on `colId` /
 *  `kind` to decide what to do. */
export type ExportCallback = (params: {
  value: unknown;
  colId: string;
  /** `'cell'` for data cells, `'header'` for column headers,
   *  `'rowGroup'` for group-row labels. */
  kind: 'cell' | 'header' | 'rowGroup';
  /** The row's full data object (cells only). Undefined for header /
   *  rowGroup invocations. */
  node?: Record<string, unknown>;
}) => unknown;
