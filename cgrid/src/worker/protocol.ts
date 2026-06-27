import type { SortModel, FilterModel, GroupModel, TransactionResult, SelectionRange } from '../types';

export type ReqId = number;

export interface WorkerInitPayload {
  columns: WorkerColumn[];
  rowIdField: string;            // initial cycle: getRowId is the value of this field
  /** Grid-level row-height fallback in CSS px. The worker's autoHeight pass
   *  (Cycle 5 / Task 8) uses this as the floor when aggregating measured
   *  contributions — a single short line should not shrink a row below the
   *  user's grid `rowHeight`. */
  rowHeight?: number;
  /** Cycle 4 / Task 11 (cell-flash patch) — when true, the worker
   *  diffs `applyTransaction.update` rows against the stored row data
   *  and stages the changed (rowId, field) pairs in `pendingFlashes`.
   *  The next `getViewport` reply packs those into the chunk's
   *  `flashMask`. Defaults to false so apps that don't enable flash
   *  pay zero diff overhead. Runtime-mutable via the
   *  `setEnableCellChangeFlash` message. */
  enableCellChangeFlash?: boolean;
}

export interface WorkerColumn {
  colId: string;
  field?: string;                // dot-path supported
  type: 'text' | 'number';
  /** Cycle 14 / Task 3 — name (or ordered fallback list) of the
   *  aggregation function to run over this column's filtered values.
   *  Built-in names: `'sum' | 'avg' | 'min' | 'max' | 'count' | 'first'
   *  | 'last'`. Unknown names resolve against the worker's
   *  `AggFuncRegistry` (custom funcs shipped via `setAggFuncs`).
   *  Array form picks the first entry that resolves. Unresolved →
   *  the column gets no totals entry. Widened from the original
   *  built-in-only union in Cycle 14 / Task 3. */
  aggFunc?: string | string[];
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
  /** Cycle 8 / Task 3 — name of a comparator registered with the worker
   *  via `registerComparator`. When set, `SortPass.apply` looks the name
   *  up in the worker's `ComparatorRegistry` and dispatches the cell
   *  compare through the registered function. Unknown names fall back
   *  to the built-in compare so a registration race never crashes the
   *  pipeline. */
  comparator?: string;
  /** Cycle 8 / Task 5 — diacritic-aware string compare. When `true` and
   *  the column resolves to `'text'`, `SortPass.compare` routes through
   *  a lazy-cached `Intl.Collator(undefined, { sensitivity: 'variant'
   *  })` instead of the default lexicographic compare. Honored only
   *  when no registered `comparator` is set on the column. */
  accentedSort?: boolean;
}

export interface ViewportRequest {
  rowStart: number;              // inclusive
  rowEnd: number;                // exclusive
  columns: string[];             // colIds, in render order
  includeFlashMask?: boolean;
}

/** Wire-format version tag for `ViewportChunk` payloads.
 *  - `1` = Cycle 4 era (no group fields).
 *  - `2` = Cycle 15 / Task 3 — appends `groupValue / groupChildCount /
 *          isExpanded` parallel arrays for the `'group'` cell renderer.
 *  Append-only: new versions never reorder or resize existing fields.
 *  The binary serializer in `chunkFormat.ts` writes the version in the
 *  header byte; readers fall back to defaults for fields absent in
 *  older versions. */
export type ChunkFormatVersion = 1 | 2;

/** Current chunk format version emitted by the worker post-Task-3.
 *  Bumping this is a coordinated change: serializer, slicer, and the
 *  main-thread `normalizeViewportChunk` decoder all read this constant. */
export const CHUNK_FORMAT_VERSION: ChunkFormatVersion = 2;

export interface ViewportChunk {
  rowStart: number;
  rowCount: number;
  rowIds: Uint32Array;                       // numeric row IDs (hashed)
  rowKinds: Uint8Array;                      // 0 = leaf, 1 = group, 2 = grandTotal, 3 = footer
  groupDepth: Uint8Array;
  numericCols: Record<string, Float64Array>;
  textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }>;
  flashMask?: Uint8Array;
  /** Grand-total aggregation results (undefined when no aggFunc columns).
   *  Widened from `number | null` in Cycle 14 / Task 3 because custom
   *  aggFuncs may return strings, dates, or other primitives (e.g.
   *  `'first'` returns whatever type the first row's cell is). The
   *  totals cell renderer stringifies via the column's `valueFormatter`. */
  totals?: Record<string, unknown>;
  /**
   * Per-row height in CSS px for each visible row in `rowIds` order. A value
   * of 0 means "row has no per-row height — substitute the global rowHeight
   * fallback main-side". Cycle 5 / Task 6 — variable row heights.
   */
  heights: Float32Array;
  /** Cycle 15 / Task 3 — formatted group value for each visible row, in
   *  the same order as `rowIds`. Empty string for data rows (the
   *  `'group'` cell renderer keys off `rowKinds[i] === 1`); the
   *  group-level label for group rows. Length === `rowCount` when
   *  present. Absent (or empty array) on v1 chunks — the main-thread
   *  decoder substitutes per-row `''`. */
  groupValue?: string[];
  /** Cycle 15 / Task 3 — descendant leaf-row count for each group row,
   *  zero for data rows. Length === `rowCount` when present. Absent on
   *  v1 chunks — main-thread decoder fills zeros. */
  groupChildCount?: Uint32Array;
  /** Cycle 15 / Task 3 — paint-side expansion state for group rows
   *  (1 = expanded, 0 = collapsed). Data rows always 1 (their visibility
   *  is implied by being in the slicer's output). Duplicates the
   *  client's `expandedKeys: Set<string>` so the renderer paints the
   *  chevron without looking up the set per row. Length === `rowCount`
   *  when present. Absent on v1 chunks — main-thread decoder fills 1
   *  (data rows / "expanded" groups; an ungrouped chunk's group cells
   *  never paint, so the value is harmless). */
  isExpanded?: Uint8Array;
  /** Cycle 15 / Task 7 — composite group key for each group row, empty
   *  string for data rows. Length === `rowCount` when present. The
   *  chevron click hit-test on main reads this to translate a row
   *  index back to the composite key the `setExpanded` /
   *  `rowGroupOpened` API + event surface speaks in. Absent on chunks
   *  produced before Task 7 — decoder fills empties as a defensive
   *  default (the hit-test silently no-ops when the key is empty,
   *  matching its behaviour for a data row). Not part of the binary
   *  format — this field rides the structured-clone path only. */
  groupKey?: string[];
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
  /** Cycle 15 / Task 7 — replace the worker's persistent expanded-keys
   *  set. `keys === null` reverts to the "all groups expanded" default
   *  (the same view Task 4 shipped before any explicit toggle); `keys: []`
   *  collapses everything; any other array is the explicit set of
   *  expanded composite group keys.
   *
   *  The chunk a subsequent `getViewport` produces walks the
   *  collapse-aware visible order against this set — collapsed
   *  descendants drop out, `isExpanded[i]` flips per group row's
   *  membership. `visibleCount` in the reply uses the same set.
   *
   *  Also resolves with the FULL list of current composite group keys
   *  so main can materialise its own mirror (needed for the
   *  `getExpandedKeys()` snapshot when the main-side mirror is still
   *  at the "default = all expanded" sentinel). */
  | { id: ReqId; type: 'setExpandedKeys';  payload: { keys: string[] | null } }
  /** Cycle 15 / Task 8 — toggle whether subsequent `groupKeysSnapshot`
   *  replies carry the parallel `groupDescendants: string[][]` array.
   *  Main flips this on when `groupSelectsChildren: true` lands so the
   *  `GroupMembershipResolver` can cascade selection without firing a
   *  per-click round-trip. Resolves with a fresh `groupKeysSnapshot`
   *  so the toggle-on call also primes the descendant cache. */
  | { id: ReqId; type: 'setEmitGroupDescendants'; payload: { enabled: boolean } }
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
  | { id: ReqId; type: 'getDistinctValues'; payload: { colId: string } }
  /** Cycle 4 / Task 11 (cell-flash patch) — flip the cell-flash
   *  diff producer on or off at runtime. When off, `applyTransaction.update`
   *  no longer computes per-row diffs (zero allocation overhead for
   *  apps that don't use flash). When flipped on the next
   *  `applyTransaction` will start staging diffs. */
  | { id: ReqId; type: 'setEnableCellChangeFlash'; payload: { enabled: boolean } }
  /** Cycle 4 / Task 11 (cell-flash patch) — programmatic flash.
   *  `api.flashCells({rowIds, colIds, ...})` routes here so the worker
   *  can resolve the string rowIds via its own `RowStore` lookup and
   *  stage the cells into `pendingFlashes`. Unknown rowIds are
   *  silently dropped. Empty colIds means "every column with a field
   *  in this rowId" — the worker expands. The flash actually
   *  appears in the next `getViewport` reply's `flashMask`. */
  | { id: ReqId; type: 'flashCells'; payload: { rowIds: string[]; colIds: string[] } }
  /** Cycle 14 / Task 3 — replace the worker's custom aggFunc registry
   *  wholesale. Each entry carries `name` (the lookup key column defs
   *  reference via `aggFunc: name`) and `source` (the function's
   *  `Function.prototype.toString()` form). The worker reconstructs the
   *  callable via `new Function('"use strict"; return (' + source + ')')()`.
   *  Built-in names (`sum / avg / min / max / count / first / last`)
   *  are pre-registered before this message arrives; entries here ADD
   *  to or OVERRIDE the built-ins. Functions MUST be pure (no closures
   *  over external scope); main-side serialisation already screened
   *  for closures by re-executing the rebuilt function against a probe
   *  input. After replacing the registry the worker re-runs the
   *  aggregation pass on the next `getViewport`. Resolves with the
   *  current visible row count. */
  | { id: ReqId; type: 'setAggFuncs'; payload: { funcs: Array<{ name: string; source: string }> } }
  /** Cycle 8 / Task 3 — register a custom comparator under `name`.
   *  `source` is the `Function.prototype.toString()` form of the app's
   *  comparator function; the worker reconstructs the callable via
   *  `new Function("return (" + source + ")")()`. The function MUST
   *  be pure and may not close over external scope (the reconstruction
   *  is a fresh function in the worker's global scope). Re-registering
   *  overwrites. */
  | { id: ReqId; type: 'registerComparator'; payload: { name: string; source: string } }
  /** Cycle 8 / Task 4 — toggle the post-sort round-trip on the worker.
   *  When `present: true`, `buildVisibleAsync` pauses after `SortPass.apply`
   *  and before viewport slicing to push the sorted rowIds to main via
   *  `postSortRowsRequest`; it then awaits a `postSortRowsResult` for the
   *  same `callId` before resuming. When `present: false`, the pipeline
   *  runs end-to-end with zero round-trip overhead. Resolves with the
   *  post-toggle visible row count. */
  | { id: ReqId; type: 'setPostSortRowsPresent'; payload: { present: boolean } }
  /** Cycle 8 / Task 4 — main-side reply to a `postSortRowsRequest` push.
   *  The worker matches `callId` to the in-flight pipeline and resumes
   *  with `reordered` as the post-sort row order. The original pipeline
   *  request's reply fires once the worker resumes and finishes. */
  | { id: ReqId; type: 'postSortRowsResult'; payload: { callId: number; reordered: string[] } }
  /** Cycle 10 / Task 3 — serialise the supplied cell ranges to TSV (or
   *  CSV when `delimiter` overrides the default `\t`). The worker
   *  resolves each `range.rowStart..rowEnd` against the visible row
   *  order, reads per-cell values via the worker's `RowStore` +
   *  `WorkerColumn.field`, and replies with the encoded string. Heavy
   *  work (10k × 50 range fits inside the cycle's < 100 ms budget) runs
   *  off the main thread; the main side only forwards the result to
   *  `navigator.clipboard.writeText`. */
  | {
      id: ReqId;
      type: 'clipboardSerialize';
      payload: { ranges: SelectionRange[]; delimiter: string };
    }
  /** Cycle 10 / Task 4 — parse a TSV / CSV payload (`text`) into a
   *  rectangular `string[][]` off the main thread. The main side
   *  reads from `navigator.clipboard.readText`, ships the raw string
   *  here, and uses the result as the source values for the focus-
   *  anchored `applyTransaction({ update: [...] })`. Keeps the parse
   *  state machine off the main thread so a 10k × 50 paste from Excel
   *  doesn't stall the UI thread. */
  | {
      id: ReqId;
      type: 'clipboardDeserialize';
      payload: { text: string; delimiter: string };
    };

export type WorkerResponse =
  | { id: ReqId; type: 'ready' }
  | {
      id: ReqId;
      type: 'rowCount';
      count: number;
      visibleCount: number;
      /** Cycle 15 / Task 7 — present when grouping is active. Lets
       *  main keep `knownGroupKeys` in lockstep with the worker's
       *  tree without a follow-up round-trip. Absent for ungrouped
       *  grids so the reply stays small on the cheap path. */
      groupKeys?: string[];
    }
  /** Cycle 15 / Task 7 — reply to `setGroupModel` AND `setExpandedKeys`
   *  that piggybacks on the existing rowCount channel but adds the list
   *  of CURRENT composite group keys so the main-thread mirror can
   *  materialise its `expandedKeys` snapshot for `getExpandedKeys()`.
   *  Empty when grouping is bypassed (`rowGroupCols.length === 0`).
   *
   *  Cycle 15 / Task 8 — also carries an OPTIONAL `groupDescendants`
   *  array (parallel to `groupKeys` — entry `i` is the descendant
   *  string-rowId list for `groupKeys[i]`). Present only when the
   *  worker has been asked to ship descendants (the `'tri-state' is
   *  active' flag set via init or via a runtime `setEmitGroupDescendants`
   *  message — currently always populated when grouping is active, the
   *  payload size scales with `Σ descendantCount × groupCount`).
   *  Apps that don't enable `groupSelectsChildren` see no extra
   *  payload — main ignores the field. */
  | {
      id: ReqId;
      type: 'groupKeysSnapshot';
      count: number;
      visibleCount: number;
      groupKeys: string[];
      groupDescendants?: string[][];
    }
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
  /** Cycle 10 / Task 3 — encoded TSV / CSV for the supplied ranges. The
   *  main thread forwards `tsv` to `navigator.clipboard.writeText`. */
  | { id: ReqId; type: 'clipboardSerializeResult'; tsv: string }
  /** Cycle 10 / Task 4 — parsed `string[][]` for the supplied payload.
   *  Rows are in source order; cells are raw strings (RFC-4180 quoting
   *  already unwrapped). The main thread anchors the grid at the focused
   *  cell + builds `applyTransaction({ update })` from this. */
  | { id: ReqId; type: 'clipboardDeserializeResult'; rows: string[][] }
  | { id: ReqId; type: 'error';               error: string };

export type WorkerPush =
  | {
      type: 'modelUpdated';
      visibleCount: number;
      /** Cycle 15 / Task 7 — current composite group keys when
       *  grouping is active. Absent when grouping bypasses
       *  (`rowGroupCols.length === 0`) so the push stays
       *  zero-allocation for the common ungrouped grid. Main uses it
       *  to keep `knownGroupKeys` in lockstep after a transaction
       *  adds / removes groups — critical so `getExpandedKeys()`
       *  doesn't drift from the worker's tree. */
      groupKeys?: string[];
    }
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
  | { type: 'externalFilterCandidates';  callId: number; rowIds: string[] }
  /** Cycle 8 / Task 4 — pushed mid-pipeline when `postSortRowsPresent` is
   *  active. `rowIds` is the post-SortPass row order. Main runs
   *  `options.postSortRows({ rowIds, getData })` against its row-data cache
   *  and replies with `postSortRowsResult` carrying the same `callId` and
   *  the (possibly re-ordered) array. */
  | { type: 'postSortRowsRequest';       callId: number; rowIds: string[] };

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
  // Cycle 15 / Task 3 — group-field buffers ride along when present.
  // `groupValue` is a string[] (not a buffer), so it transfers via the
  // structured clone path; only the typed-array companions are listed
  // here. Absent fields (v1 chunks) are simply skipped.
  if (chunk.groupChildCount) out.push(chunk.groupChildCount.buffer);
  if (chunk.isExpanded) out.push(chunk.isExpanded.buffer);
  return out;
}

/** Cycle 15 / Task 3 — normalize an incoming `ViewportChunk` so the main
 *  thread can read the new group fields uniformly regardless of which
 *  worker version produced it. Returns the original object reference when
 *  every field is already present (zero-allocation v2 fast path);
 *  otherwise returns a shallow copy with default fields filled in
 *  (v1 → v2 upgrade path):
 *    - `groupValue` → `Array(rowCount).fill('')`
 *    - `groupChildCount` → `new Uint32Array(rowCount)` (all zeros)
 *    - `isExpanded` → `Uint8Array(rowCount)` filled with `1`
 *
 *  Callers downstream of `WorkerClient.getViewport` are guaranteed all
 *  three fields are present after normalization, so the `'group'`
 *  renderer never has to check `?? defaults`. */
export function normalizeViewportChunk(chunk: ViewportChunk): ViewportChunk {
  if (chunk.groupValue && chunk.groupChildCount && chunk.isExpanded && chunk.groupKey) {
    return chunk;
  }
  const rowCount = chunk.rowCount;
  const groupValue = chunk.groupValue ?? new Array<string>(rowCount).fill('');
  const groupChildCount = chunk.groupChildCount ?? new Uint32Array(rowCount);
  let isExpanded = chunk.isExpanded;
  if (!isExpanded) {
    isExpanded = new Uint8Array(rowCount);
    isExpanded.fill(1);
  }
  const groupKey = chunk.groupKey ?? new Array<string>(rowCount).fill('');
  return { ...chunk, groupValue, groupChildCount, isExpanded, groupKey };
}
