import type { SortModel, FilterModel, GroupModel, TransactionResult } from '../types';

export type ReqId = number;

export interface WorkerInitPayload {
  columns: WorkerColumn[];
  rowIdField: string;            // initial cycle: getRowId is the value of this field
  /** Grid-level row-height fallback in CSS px. The worker's autoHeight pass
   *  (Cycle 5 / Task 8) uses this as the floor when aggregating measured
   *  contributions — a single short line should not shrink a row below the
   *  user's grid `rowHeight`. */
  rowHeight?: number;
}

export interface WorkerColumn {
  colId: string;
  field?: string;                // dot-path supported
  type: 'text' | 'number';
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  filter?: 'text' | 'number';
  /** Cycle 5 / Task 8 — column opted into autoHeight measurement. When true,
   *  the worker measures wrapped-text height for every visible row in this
   *  column and contributes the result into the row's resolved height. */
  autoHeight?: boolean;
  /** Resolved CSS font string for autoHeight measurement (e.g. `"13px
   *  system-ui"`). Mirrors the main-thread cell paint font so OffscreenCanvas
   *  measureText produces the same line-break behaviour the renderer would.
   *  Only meaningful when `autoHeight === true`. */
  autoHeightFont?: string;
  /** Available text width inside the cell in CSS px (column width minus
   *  horizontal padding). Used as the wrap boundary. Only meaningful when
   *  `autoHeight === true`. */
  autoHeightWidth?: number;
  /** Per-line vertical advance in CSS px (typically the theme row height).
   *  Final height = lineCount × lineHeight + 2 × padding. Only meaningful
   *  when `autoHeight === true`. */
  autoHeightLineHeight?: number;
  /** Vertical padding to add above + below the wrapped text (so a single
   *  short line still resolves to roughly the grid row height). */
  autoHeightPadding?: number;
}

export interface ViewportRequest {
  rowStart: number;              // inclusive
  rowEnd: number;                // exclusive
  columns: string[];             // colIds, in render order
  includeFlashMask?: boolean;
}

export interface ViewportChunk {
  rowStart: number;
  rowCount: number;
  rowIds: Uint32Array;                       // numeric row IDs (hashed)
  rowKinds: Uint8Array;                      // 0 = leaf, 1 = group, 2 = grandTotal, 3 = footer
  groupDepth: Uint8Array;
  numericCols: Record<string, Float64Array>;
  textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }>;
  flashMask?: Uint8Array;
  totals?: Record<string, number | null>;    // grand-total aggregation results (undefined when no aggFunc columns)
  /**
   * Per-row height in CSS px for each visible row in `rowIds` order. A value
   * of 0 means "row has no per-row height — substitute the global rowHeight
   * fallback main-side". Cycle 5 / Task 6 — variable row heights.
   */
  heights: Float32Array;
}

/** Cycle 5 / Task 8 — items batched into a single `measureTextRequest`
 *  push so the main thread can resolve them all in one canvas-context turn. */
export interface MeasureTextItem {
  text: string;
  width: number;
  font: string;
  lineHeight: number;
  padding: number;
}

/** Cycle 6 / Task 4 — per-column metadata shipped with an `autosize`
 *  request so the worker measures the same font + padding + min/max the
 *  renderer paints. The worker looks up the `field` from its own
 *  `state.columns` (a colId without a field measures only the header). */
export interface AutosizeColumnRequest {
  colId: string;
  headerName: string;
  font: string;
  padding: number;
  minWidth: number;
  maxWidth: number;
}

export type WorkerRequest =
  | { id: ReqId; type: 'init';             payload: WorkerInitPayload }
  | { id: ReqId; type: 'setRowData';       payload: { rows: unknown[]; heightsByRowId?: Map<string, number> } }
  | { id: ReqId; type: 'applyTransaction'; payload: { add?: unknown[]; update?: unknown[]; remove?: string[]; async: boolean; heightsByRowId?: Map<string, number> } }
  | { id: ReqId; type: 'setSortModel';     payload: SortModel }
  | { id: ReqId; type: 'setFilterModel';   payload: FilterModel }
  | { id: ReqId; type: 'setGroupModel';    payload: GroupModel }
  | { id: ReqId; type: 'getViewport';      payload: ViewportRequest }
  | { id: ReqId; type: 'updateColumns';    payload: { columns: WorkerColumn[] } }
  | { id: ReqId; type: 'getRowIndexForId';    payload: { rowId: string } }
  | { id: ReqId; type: 'getRowIndicesForIds'; payload: { rowIds: string[] } }
  | { id: ReqId; type: 'getRowByIndex';       payload: { rowIndex: number } }
  | { id: ReqId; type: 'measureTextResponse'; payload: { batchId: number; heights: Float32Array } }
  /** Cycle 6 / Task 4 — main asks the worker to autosize the listed
   *  columns. Worker measures via the Cycle 5 `MeasureCache` LRU and
   *  posts back an `autosizeResult` with `widths: Record<colId, number>`.
   *  `skipHeader: false` (default) includes the header label. Worker
   *  samples head 2,500 + tail 2,500 rows by default; main can override
   *  via `maxSampleSize`. */
  | {
      id: ReqId;
      type: 'autosize';
      payload: {
        columns: AutosizeColumnRequest[];
        skipHeader: boolean;
        maxSampleSize?: number;
      };
    };

export type WorkerResponse =
  | { id: ReqId; type: 'ready' }
  | { id: ReqId; type: 'rowCount';            count: number; visibleCount: number }
  | { id: ReqId; type: 'viewport';            chunk: ViewportChunk }
  | { id: ReqId; type: 'transactionFlushed';  results: TransactionResult }
  | { id: ReqId; type: 'rowIndex';            index: number }
  | { id: ReqId; type: 'rowIndices';          indices: Int32Array }
  | { id: ReqId; type: 'row';                 rowId: string | null; data: unknown | null }
  | { id: ReqId; type: 'measureTextAck' }
  /** Cycle 6 / Task 4 — worker response carrying the resolved per-column
   *  autosize widths. Widths are already `text + padding` clamped to the
   *  column's `minWidth` / `maxWidth`. */
  | { id: ReqId; type: 'autosizeResult';      widths: Record<string, number> }
  | { id: ReqId; type: 'error';               error: string };

export type WorkerPush =
  | { type: 'modelUpdated';              visibleCount: number }
  | { type: 'asyncTransactionsFlushed';  results: TransactionResult[] }
  /** Cycle 5 / Task 8 — worker pushes updated row heights after the
   *  autoHeight pass measures a visible chunk. Main applies the deltas to
   *  the Fenwick index and repaints. `rowStart` is the global visible-row
   *  index of `heights[0]`; entries follow in the same order the matching
   *  `ViewportChunk` shipped. */
  | { type: 'heightsChanged';            rowStart: number; heights: Float32Array }
  /** Cycle 5 / Task 8 — fallback path. When the worker has no
   *  `OffscreenCanvas.measureText` (Safari 15.4–16.3, Firefox 100–104), it
   *  batches measurement items here and awaits a `measureTextResponse`
   *  carrying the resolved per-item pixel heights. */
  | { type: 'measureTextRequest';        batchId: number; items: MeasureTextItem[] };

/** Build the transfer list for a viewport response. */
export function collectViewportTransferables(chunk: ViewportChunk): ArrayBufferLike[] {
  const out: ArrayBufferLike[] = [
    chunk.rowIds.buffer, chunk.rowKinds.buffer, chunk.groupDepth.buffer, chunk.heights.buffer,
  ];
  for (const arr of Object.values(chunk.numericCols)) out.push(arr.buffer);
  for (const tc of Object.values(chunk.textCols)) {
    out.push(tc.offsets.buffer, tc.bytes.buffer);
  }
  if (chunk.flashMask) out.push(chunk.flashMask.buffer);
  return out;
}
