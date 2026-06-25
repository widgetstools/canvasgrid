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
  filter?: 'text' | 'number' | 'date' | 'set';
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
  /** Cycle 7 / Task 5 — text-filter pre-comparison normaliser. Runs on
   *  BOTH the cell value AND the filter value before the operator
   *  comparison fires. Built-in formatters this cycle ships:
   *  `'lowercase'` / `'uppercase'` / `'trim'`. Arbitrary closures wait
   *  for Cycle 24's worker-module loader. Only meaningful when
   *  `filter === 'text'`. */
  textFormatter?: 'lowercase' | 'uppercase' | 'trim';
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
  /** Cycle 7 / Task 7 — cross-column quick-filter terms. The worker runs
   *  a `QuickFilterPass` BEFORE the per-column `FilterPass`. `terms: null`
   *  (or `[]`) disables the pass. `colIds: null` includes every worker
   *  column with a `field`; a non-null list narrows the aggregate to the
   *  given columns (used to honor `includeHiddenColumnsInQuickFilter:
   *  false`). `cacheQuickFilter` toggles the per-row aggregate cache. */
  | {
      id: ReqId;
      type: 'setQuickFilter';
      payload: {
        terms: string[] | null;
        cacheQuickFilter: boolean;
        colIds: string[] | null;
      };
    }
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
    }
  /** Cycle 7 / Task 8 — toggle the external-filter round-trip on the worker.
   *  When `present: true`, the worker's filter pipeline suspends after
   *  applying column + quick filters and pushes the candidate rowIds to
   *  main via `externalFilterCandidates`; it then awaits an
   *  `externalFilterResult` for the same `callId` before completing.
   *  When `present: false`, the pipeline runs synchronously end-to-end
   *  and no candidates push fires. Resolves with the post-toggle visible
   *  row count. `alwaysPassFilter` rows are subtracted from the candidate
   *  set and added back unconditionally to the final visible set. */
  | { id: ReqId; type: 'setExternalFilterPresent'; payload: { present: boolean } }
  /** Cycle 7 / Task 8 — replace the worker's alwaysPass rowId set. Main
   *  computes the set from `options.alwaysPassFilter` against its own
   *  row-data cache and pushes after every data mutation. The worker
   *  stores it verbatim and consults it on every filter pass. Resolves
   *  with the post-update visible row count. */
  | { id: ReqId; type: 'setAlwaysPassRowIds'; payload: { rowIds: string[] } }
  /** Cycle 7 / Task 8 — main-side reply to an `externalFilterCandidates`
   *  push. The worker matches `callId` to the in-flight pipeline and
   *  resumes with `surviving` as the post-external-filter set.
   *  One-way: no reply envelope; the original pipeline request's reply
   *  fires once the worker resumes and finishes its post-sort emit. */
  | { id: ReqId; type: 'externalFilterResult'; payload: { callId: number; surviving: string[] } }
  /** Cycle 7 / Task 8 — re-run the filter pipeline against the current
   *  model. Used by `api.onFilterChanged(source)` after the app mutates
   *  external-filter state (e.g. flipping a toolbar checkbox) so the
   *  grid re-evaluates without changing the column / quick / sort model.
   *  Resolves with the post-pipeline visible row count. */
  | { id: ReqId; type: 'refilter'; payload: Record<string, never> }
  /** Cycle 7 / Task 9 — request the column's distinct stringified value
   *  set. Used by the set-filter popup to seed its checkbox list.
   *  Cached worker-side per `colId`; the cache invalidates whenever
   *  `applyTransaction` lands on the column (or any column — the cache
   *  is wiped wholesale, matching how `QuickFilterPass` handles
   *  invalidation). */
  | { id: ReqId; type: 'getDistinctValues'; payload: { colId: string } };

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
  /** Cycle 7 / Task 9 — distinct stringified values for a column.
   *  Values are in store-iteration order; null / undefined cells are
   *  dropped. */
  | { id: ReqId; type: 'distinctValuesResult'; values: string[] }
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
  | { type: 'measureTextRequest';        batchId: number; items: MeasureTextItem[] }
  /** Cycle 7 / Task 8 — pushed mid-pipeline when `isExternalFilterPresent`
   *  is active. `rowIds` is the post-column-filter, post-quick-filter
   *  candidate set MINUS any rows in the worker's alwaysPass set (those
   *  bypass every filter and are added back unconditionally to the
   *  final visible set). Main runs `doesExternalFilterPass` for each id
   *  against its row-data cache and replies with `externalFilterResult`
   *  carrying the same `callId` and the surviving subset. */
  | { type: 'externalFilterCandidates';  callId: number; rowIds: string[] };

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
