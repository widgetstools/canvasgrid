import type { SortModel, FilterModel, GroupModel, TransactionResult, SelectionRange } from '../types';
import type { PivotModel, PivotKeyNode } from './passes/pivotPass';

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
  /** Cycle 15 / Task 9 — default-expansion rule applied the first
   *  time `setGroupModel` produces a tree (and on every subsequent
   *  swap). `'all'` (or absent) keeps the pre-Task-9 "every group
   *  starts expanded" behaviour. A non-negative `N` expands groups
   *  whose `depth <= N`; a negative `N` collapses everything. Stored
   *  on `GroupPass` via `setDefaultExpansion` so the option re-seeds
   *  expansion on every `setGroupModel` reply without main shipping
   *  it again. */
  groupDefaultExpanded?: number | 'all';
  /** Cycle 15 / Task 9 — explicit composite-key list. When present
   *  (including the empty array), overrides `groupDefaultExpanded`
   *  on every model swap: the worker stores this list verbatim as
   *  the starting `expandedKeys` set. Keys that don't match any
   *  group in the current tree silently fall out. */
  groupDefaultExpandedKeys?: string[];
  /** Cycle 15 / Task 10 — when `true`, the worker's `GroupPass`
   *  elides any group whose recursive `childCount === 1` from the
   *  flatOrder traversal. The tree shape is unchanged; only the
   *  depth-first flat walk skips the group entry, so the lone leaf
   *  row emits at its natural position with no preceding group
   *  entries. Chains that funnel down to a single row collapse
   *  entirely. Off by default. */
  groupRemoveSingleChildren?: boolean;
  /** Cycle 15 / Task 10 — when `true`, the worker's grouped slicer
   *  populates every data row's `chunk.groupValue[i]` slot with its
   *  leaf-parent group's formatted value. The `'group'` renderer
   *  reads the slot and paints a muted echo of the parent's label
   *  on the data row's auto-group cell so the user keeps the parent
   *  group in view while scrolling inside an expanded group. Off
   *  by default. Only affects `'singleColumn'` mode — the renderer's
   *  multipleColumns own-depth filter returns early for data rows in
   *  other display modes. */
  showOpenedGroup?: boolean;
  /** Cycle 15 / Task 12 — when `true`, the worker's `GroupPass`
   *  appends a `kind: 'footer'` flatOrder entry at the end of each
   *  non-elided group's traversal, AND `AggPass.applyGroups` computes
   *  the per-group totals shipped via `chunk.groupTotals`. Off by
   *  default; init-only mutation surface (matches Task 9 / 10). */
  groupIncludeFooter?: boolean;
  /** Cycle 15 / Task 12 — when `true` AND `groupIncludeFooter` is on,
   *  the worker appends a single grand-total footer entry at the very
   *  end of `flatOrder` (empty key, depth 0) so the row reads as
   *  "Total" with the rest of the data columns carrying the
   *  grand-total values from `chunk.totals`. Off by default. Companion
   *  to `groupIncludeFooter`; a `groupIncludeTotalFooter: true` with
   *  `groupIncludeFooter: false` is silently ignored (no footer
   *  emission path is active). */
  groupIncludeTotalFooter?: boolean;
  /** Cycle 15.5 / Task 4 — when `true`, expanded parent group rows are
   *  skipped in `computeGroupVisibleOrder`; children appear in the
   *  parent's slot. The sticky band suppresses automatically. Init-only. */
  groupHideOpenParents?: boolean;
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
  /** Cycle 15 / Task 11 — group-level sort override. When `true`, the
   *  group-aware `SortPass.applyGrouped` keeps the composite-key
   *  string compare at this column's level even if a `comparator` or
   *  `accentedSort` is configured. Within-bucket (leaf-row) sort is
   *  unaffected. Mirrors `CColDef.sortGroupRowsByKey`. */
  sortGroupRowsByKey?: boolean;
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
  /** Cycle 15 / Task 12 — per-group totals indexed by composite group
   *  key (the same vocabulary `chunk.groupKey[i]` ships per row).
   *  Populated by `AggPass.applyGroups` when grouping is active AND
   *  `groupIncludeFooter: true` on the options. Each entry mirrors the
   *  grand-total `totals` shape — one record per group whose
   *  `chunk.rowKinds[i] === 3` footer row reads the column values.
   *  Absent (undefined) when no group footers are enabled OR no
   *  resolved agg columns exist; main treats undefined the same as
   *  an empty record. Rides the structured-clone path (not the
   *  transfer-buffer list) since the values may include strings /
   *  custom shapes from non-numeric agg funcs. */
  groupTotals?: Record<string, Record<string, unknown>>;
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
  /** Cycle 18 / Task 3 — pivot result. Present only when a pivot model is
   *  active (`pivotColIds.length > 0 && valueCols.length > 0`). Three
   *  companion fields, all riding the structured-clone path (like
   *  `groupKey` / `groupTotals` — heterogeneous, no typed-array form):
   *
   *  `pivotColumnTree` — the distinct pivot-key tree (sorted at every
   *  level). The main thread synthesizes the secondary columns from it
   *  (`core/pivotColumns.ts`), nesting pivot levels as column groups.
   *
   *  `pivotLeafPaths` — every leaf pivot-key path in column-render order
   *  (each × value column = one secondary column).
   *
   *  `pivotValues` — the cross-tab cell map keyed by
   *  `encodePivotValueKey(groupKey, joinedPivotPath, valueColId)`. The
   *  body cell lookup reads a group row's pivot cell from here. Carries
   *  every row-group level + every pivot-path prefix (collapsed column
   *  groups) + the grand total (groupKey `''`). Absent when no pivot
   *  model is active. */
  pivotColumnTree?: PivotKeyNode[];
  pivotLeafPaths?: string[][];
  pivotValues?: Map<string, unknown>;
  /** Cycle 18 / Task 8a — populated when the pivot pass would have
   *  produced more synthetic columns than `pivotMaxGeneratedColumns`.
   *  The pivot output is empty (bypassed) — primary columns render
   *  normally — and the main thread fires a `pivotMaxColumnsReached`
   *  event the app can listen to (raise the cap, narrow the filter, …).
   *  Absent on every other chunk. Rides the structured-clone path. */
  pivotMaxColumnsReached?: { generatedColumns: number; cap: number };
}

/** Cycle 15 / Task 16 — one sticky ancestor entry per depth level
 *  above the current `firstRow`. Sent from the worker alongside each
 *  `viewport` response so the main-thread painter can pin the ancestor
 *  group rows at the top of the body area without round-tripping.
 *
 *  Sorted by depth ascending (depth 0 = top-level group first). */
export interface StickyAncestor {
  depth: number;
  /** Composite group key — same vocabulary as `chunk.groupKey`. Used for
   *  the chevron click toggle and for push-off identity comparison. */
  key: string;
  /** Source grouping column — used by the painter to choose indent and
   *  by the hit-tester to resolve the auto-group column. */
  colId: string;
  /** Formatted display value (same as `groupValue` in the chunk for the
   *  group row that produced this entry). */
  value: string;
  /** Total descendant LEAF row count — paints as `(N)` badge. */
  childCount: number;
  /** Current expansion state — determines chevron direction. */
  isExpanded: boolean;
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
  /** Extra padding reserved for the sort/unsort caret in the header.
   *  When set, the header label is sized with this value instead of
   *  `padding`. Defaults to `padding` in the worker when absent. */
  headerPadding?: number;
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
  /** Cycle 18 / Task 3 — install / replace the worker's pivot model
   *  (the Column Labels + Values roles). The next `getViewport` runs
   *  `PivotPass` against the post-filter rows + group tree and ships the
   *  pivot result on the chunk. An empty model (`pivotColIds: []` OR
   *  `valueCols: []`) deactivates pivot — the chunk drops its pivot
   *  fields. Unknown / fieldless colIds are rejected at set-time as an
   *  `error` envelope (mirrors `setGroupModel`). Resolves with the
   *  current visible row count (pivot does not change which rows are
   *  visible). */
  | { id: ReqId; type: 'setPivotModel';    payload: PivotModel }
  /** Cycle 18 / Task 8a — set the cap on the synthesized pivot column
   *  count. `undefined` reverts to the default (5000). Negative /
   *  non-finite values also revert to default (a misconfigured option
   *  must not accidentally disable pivot). The next `getViewport`
   *  honors the new cap; the cgrid main thread fires
   *  `pivotMaxColumnsReached` when the chunk carries the breach payload. */
  | { id: ReqId; type: 'setPivotMaxGeneratedColumns'; payload: number | undefined }
  /** Cycle 18 / Task 8c — flip `enableStrictPivotColumnOrder`. `true` =
   *  always re-sort discovered pivot keys alphanumerically. `false`
   *  (AG default) = preserve prior order + append new keys at end.
   *  The next `getViewport` honors the new flag. */
  | { id: ReqId; type: 'setStrictPivotColumnOrder'; payload: boolean }
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
    }
  /** Cycle 20 / Task 3 — full-data export. The worker walks all
   *  visible (filtered + sorted + grouped) rows, materialises them
   *  with the per-row data from `RowStore`, and runs the matching
   *  writer (`writeCsv` / `writeXlsx`). Returns the serialised
   *  bytes via the `exportDataResult` response. */
  | {
      id: ReqId;
      type: 'exportData';
      payload: {
        format: 'csv' | 'xlsx';
        /** Per-column header overrides keyed by colId. Main side
         *  passes the resolved headerNames so the worker doesn't
         *  need to know about column-tree state. */
        headerNames: Record<string, string>;
        /** Per-column type hint keyed by colId. `'number'` writes
         *  inline numeric cells in XLSX. */
        types: Record<string, 'text' | 'number'>;
        /** Serializer options — superset across both formats. The
         *  worker passes only the relevant subset to each writer. */
        options: Record<string, unknown>;
      };
    }
  /** Cycle 20 / Task 4 — ship the materialised visible rows + the
   *  column list back to main so callbacks (which can't postMessage
   *  to a worker) can run main-side. Used by the export path when
   *  any `process*Callback` is referenced. */
  | {
      id: ReqId;
      type: 'getExportRows';
      payload: Record<string, never>;
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
      /** Cycle 15 / Task 9 — present on `setGroupModel` replies that
       *  re-seed the default expansion (when `groupDefaultExpanded` /
       *  `groupDefaultExpandedKeys` resolves to anything other than
       *  the all-expanded sentinel). The materialised explicit set
       *  the worker just installed in `state.expandedKeys`; main
       *  mirrors verbatim so `getExpandedKeys()` reads the same view
       *  as the next viewport paint. `null` means "the worker is at
       *  the default-all sentinel" (option absent or `'all'` AND no
       *  explicit keys override). Absent on `setExpandedKeys` replies
       *  (those carry the explicit set the caller just shipped). */
      expandedKeys?: string[] | null;
    }
  /** Cycle 15 / Task 16 — sticky group row ancestors for the current
   *  viewport. Computed on the worker side from `visibleOrder[0..rowStart-1]`
   *  — the last group seen at each depth above the first visible row.
   *  Empty / absent when grouping is inactive or the first visible row
   *  is at position 0 (nothing scrolled past). Rides structured-clone
   *  alongside `chunk` (no ArrayBuffer transfer needed). */
  | { id: ReqId; type: 'viewport'; chunk: ViewportChunk; stickyAncestors?: StickyAncestor[] }
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
  /** Cycle 20 / Task 3 — bytes from a full-data export. Transferred
   *  (zero-copy) so a 100k-row XLSX doesn't pay a copy on its way
   *  to main. */
  | { id: ReqId; type: 'exportDataResult'; format: 'csv' | 'xlsx'; buffer: ArrayBuffer }
  | { id: ReqId; type: 'getExportRowsResult'; rows: Array<Record<string, unknown>> }
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
