// cgrid — vanilla TS canvas grid library
// Public surface lives here. Internals live under core/, renderer/, interaction/,
// worker/, theming/. See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md.
import './theming/tokens.css';
// Cycle 22 / Task 5 — load the same tokens.css as a plain string so the
// shadow-root path can inject a self-contained `<style>` element inside
// the encapsulated DOM. The `?inline` suffix is a Vite primitive; the
// import resolves to the compiled CSS text at build time.
import tokensCssInline from './theming/tokens.css?inline';
import type {
  CGridOptions, CGridEvent, CGridApi, Tx, TransactionResult, SortModel, FilterModel,
  CFilterModelEntry, GroupModel, FlashCellsParams, SelectionRange,
  AggregationChangedSource,
} from './types';
import type { ToolPanel, SideBarDef } from './interaction/toolPanels/types';
import { TypedEventEmitter } from './core/eventEmitter';
import { type ResolvedColDef, applyCellProps } from './core/propertyChain';
import { resolveColumnTree, isColGroupDef, type ColumnTree } from './core/columnTree';
import { resolveSelection } from './core/selectionConfig';
import { expandRangeForVelocity } from './core/prefetchRange';
import { ChunkLRU, estimateChunkBytes } from './core/memoryBudget';
import { ColumnGroupState, resolveVisibleLeaves } from './core/columnGroupState';
import {
  applyReorder, resolveLegalDropIndex, reorderLeavesByList,
  type ColumnOrderConstraints,
} from './core/columnOrder';
import {
  snapshotState, applyStateToTree, cloneStateForReset,
  type SnapshotLocks, type ChangeRecord,
} from './core/columnState';
import {
  buildSnapshot, migrateSnapshot, STATE_SCHEMA_VERSION, type GridState,
} from './core/stateSnapshot';
import { StateUpdatedBus } from './core/stateUpdatedBus';
import type { CColumnState, CApplyColumnStateParams, ISizeColumnsToFitParams } from './types';
import type { CColDef, CColGroupDef } from './types';
import {
  INITIAL_ONLY_OPTIONS, applyRuntimeOption, isRuntimeOption,
  type RuntimeOptionTarget,
} from './core/runtimeOptions';
import {
  resolveColumnWidths, sizeColumnsToFit as computeSizeColumnsToFit,
  type ColumnLayout,
} from './core/layout';
import {
  computeViewport,
  type ViewportColumn,
  type ViewportRow,
  type ViewportState,
} from './core/viewport';
import { RowHeightIndex } from './core/rowHeightIndex';
import { HeaderSubgrid, HeaderGroupSubgrid, DataSubgrid, TotalsSubgrid, PinnedRowsSubgrid, type Subgrid, type SubgridCell } from './core/subgrid';
import { FloatingFilterSubgrid } from './core/floatingFilterSubgrid';
import { FloatingFilterOverlay } from './interaction/floatingFilterOverlay';
import { PopupHost } from './interaction/editors/popupHost';
import { FilterPopupHost } from './interaction/filters/filterPopupHost';
import { ContextMenuHost } from './interaction/contextMenu/host';
import { ToolPanelRegistry } from './interaction/toolPanels/registry';
import { ColumnsToolPanel } from './interaction/toolPanels/columnsPanel';
import { FiltersToolPanel } from './interaction/toolPanels/filtersPanel';
import { SideBarHost, normalizeSideBarOption, type SideBarGridContext } from './interaction/sideBar/host';
import { StatusBarHost, normalizeStatusBarOption, type StatusBarGridContext } from './interaction/statusBar/host';
import { StatusPanelRegistry } from './interaction/statusBar/registry';
import type { StatusBarDef, StatusBarPosition, IStatusPanelComp, StatusPanelComponent } from './interaction/statusBar/types';
import {
  RowGroupPanelHost,
  normalizeRowGroupPanelShow,
  type RowGroupPanelGridContext,
} from './interaction/rowGroupPanel/host';
import {
  PivotPanelHost,
  normalizePivotPanelShow,
  type PivotPanelGridContext,
} from './interaction/pivotPanel/host';
import { GroupingState, type GroupingStateChangedEvent } from './core/groupingState';
import { PivotState, type PivotStateChangedEvent, type PivotValueColumn } from './core/pivotState';
import {
  synthesizePivotColumns, isPivotResultColumnId, isPivotRowTotalColumnId,
  isPivotResultGroupId,
  type PivotCellSpec, type PivotValueColumnSpec,
} from './core/pivotColumns';
import { encodePivotValueKey, PIVOT_PATH_SEP, type PivotModel, type PivotKeyNode } from './worker/passes/pivotPass';
import type { MenuItem, GetContextMenuItemsParams, GetMainMenuItemsParams } from './interaction/contextMenu/types';
import { buildDefaultMenuItems } from './interaction/contextMenu/defaults';
import { buildDefaultMainMenuItems } from './interaction/contextMenu/mainMenuDefaults';
import { NumberFilterPopup } from './interaction/filters/numberFilter';
import { DateFilterPopup } from './interaction/filters/dateFilter';
import { TextFilterPopup, applyTrimInputToModel } from './interaction/filters/textFilter';
import { SetFilterPopup } from './interaction/filters/setFilter';
import { FlashRegistry } from './core/flashRegistry';
import { CGridCanvas } from './core/canvas';
import { CssReader, type ResolvedTheme } from './theming/cssReader';
import {
  setThemeParams as themeParamsSet,
  getThemeParams as themeParamsGet,
  clearThemeParams as themeParamsClear,
} from './theming/themeParams';
import { CellRendererRegistry, textCell, numberCell, checkboxCell, headerCell, type CellPainter } from './renderer/cellRenderers/registry';
import { wrapTextCell } from './renderer/cellRenderers/wrapText';
import { totalsCell } from './renderer/cellRenderers/totals';
import { groupCell, type GroupCellValue } from './renderer/cellRenderers/group';
import { groupFooterCell } from './renderer/cellRenderers/groupFooter';
import { sparklineCell } from './renderer/cellRenderers/sparkline';
import { rowSelectCheckboxCell } from './renderer/cellRenderers/rowSelectCheckbox';
import { coerceToNumberArray } from './renderer/cellRenderers/sparkline/coerceToNumberArray';
import { decorateHeader } from './renderer/painters/byRows';
import {
  autoGroupColumnDepthFromId,
  isAutoGroupColumnId, resolveGroupDisplayType, synthesizeAutoGroupColumns,
} from './core/autoGroupColumn';
import { Renderer } from './renderer/renderer';
import { HitTester } from './interaction/hitTester';
import { SelectionModel } from './interaction/selectionModel';
import { FeatureChain } from './interaction/featureChain';
import { EditorOverlay } from './interaction/editorOverlay';
import { CellEditorRegistry } from './interaction/editors/registry';
import { RowEditCoordinator, type RowEditCellSpec } from './interaction/editors/rowEditCoordinator';
import type { CellEditorCtor, ICellEditor } from './interaction/editors/iCellEditor';
import { A11yOverlay } from './interaction/a11yOverlay';
import { WorkerClient } from './worker/client';
import { wrapTextToHeight } from './worker/measureText';
import type { WorkerColumn, ViewportChunk, AutosizeColumnRequest, StickyAncestor } from './worker/protocol';
import type { IAggFunc, IAggFuncParams } from './types';
import { decodeText } from './worker/chunkFormat';
// Cycle 10 / Task 5 — main-side serialise + paste-cell map helpers used when
// the app configures `processCellForClipboard` / `processCellFromClipboard`.
import {
  serializeRanges as serializeRangesPure,
  mapPasteCells,
} from './worker/passes/clipboardPass';

export const CGRID_VERSION = '0.0.0';

export type {
  CGridOptions, CColDef, CColGroupDef, CGridEvent, CGridApi, Tx, TransactionResult,
  SortModel, SortModelEntry, FilterModel, FilterModelEntry, FilterModelEntryLegacy,
  CFilterModelEntry, CTextFilterModel, CNumberFilterModel, CDateFilterModel,
  CMultiConditionFilterModel, CSetFilterModel,
  CFilterParams, CTextFilterParams, CSetFilterParams,
  CTextFilterOp, CNumberFilterOp, CDateFilterOp,
  FlashCellsParams,
  GroupModel,
  CValueGetterParams, CValueFormatterParams,
  CCellRendererSelector, CCellRendererSelectorParams, CCellRendererSelectorResult,
  ColCellOverrides,
  CellClass, CellClassRules, CellStyleFunc, HeaderClass,
  // Cycle 10 / Task 1 — context-menu public types.
  MenuItem, GetContextMenuItemsParams, GetContextMenuItemsCallback,
  // Cycle 11 / Task 1 — tool-panel + side-bar public types.
  ToolPanel, ToolPanelComponent, ToolPanelParams, ToolPanelDef, SideBarDef,
  IToolPanelColumnCompParams, IToolPanelFiltersCompParams,
  // Cycle 13 / Task 1+3+4 — status-bar + status-panel public types.
  IStatusPanel, IStatusPanelComp, StatusPanelComponent, StatusPanelParams,
  StatusPanelDef, StatusPanelAlign, StatusBarDef, StatusBarPosition,
  IAggregationStatusPanelParams, AggFunc,
  // Cycle 14 / Task 3 — custom column-aggregation registry.
  IAggFunc, IAggFuncParams,
  // Cycle 14 / Task 6 — `aggregationChanged` event polish.
  AggregationChangedSource, AggregationChangedEvent,
} from './types';
export type { CellPainter, CellPaintConfig } from './renderer/cellRenderers/registry';
// Cycle 23 / Tasks 5-6 — state-snapshot public types.
export type { GridState } from './core/stateSnapshot';
export { STATE_SCHEMA_VERSION } from './core/stateSnapshot';
export type {
  SelectionConfig,
  SingleRowSelectionConfig,
  MultiRowSelectionConfig,
  CellSelectionConfig,
  RowCheckboxCallback,
} from './core/selectionConfig';
export type { ICellEditor, ICellEditorParams, CellEditorCtor } from './interaction/editors/iCellEditor';

// Cycle 27 / Task 1 + 2 + 3 — cell styling expansion types.
export type {
  VAlign, FontWeight, FontStyle, TextTransform, Padding,
  BorderSide, BorderSpec, BorderStyle,
  CellContent, CellDecorator, DecoratorPosition,
  HeaderStyleFunc,
} from './types';

// Cycle 27 / Task 3 — user-extensible icon registry. Apps register icon
// SVG paths once at init; subsequent `cellStyle.content` /
// `cellStyle.decorators` entries can reference custom icon names.
export { registerIcon, registerIcons, hasIcon } from './renderer/icons';

/**
 * Infer the row-ID field name from a `(row) => row.<field>` style accessor.
 * Exported as a top-level function so it can be unit-tested independently of CGrid.
 *
 * Foundation cycle: only top-level single-property accessors are supported.
 * Nested paths like `row.meta.id` are rejected with a clear error — the RowStore
 * does a flat `row[rowIdField]` lookup so nested paths would silently corrupt IDs.
 */
export function inferRowIdField<T>(getRowId: (row: T) => string): string {
  const src = getRowId.toString();
  const matches = Array.from(src.matchAll(/\.(\w+)/g));
  if (matches.length === 0) {
    throw new Error('[cgrid] could not infer rowIdField from getRowId — Foundation cycle only supports `row => row.<field>` style');
  }
  if (matches.length > 1) {
    throw new Error('[cgrid] Foundation cycle only supports top-level `row => row.<field>` getRowId — nested accessors like `row.meta.id` are deferred to a follow-up cycle');
  }
  return matches[0]![1]!;
}

/** Cycle 7 / Task 7 — default `quickFilterParser`. Splits on runs of
 *  whitespace and drops empty terms so leading / trailing / interior
 *  whitespace never produces a phantom `''` term that matches every row.
 *  Apps override via `CGridOptions.quickFilterParser`. */
function defaultQuickFilterParser(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Cycle 14 / Task 3 — round-trip a custom aggFunc through
 * `Function.toString()` + `new Function(...)` BEFORE it ships to the
 * worker, and detect closures over outer scope as part of the trip.
 *
 * The worker reconstructs the function via the same `new Function(...)`
 * call inside `setAggFuncs`. Doing the round-trip here first means:
 *
 * 1. **Closure capture surfaces synchronously**. The thrown error rides
 *    out the `setGridOption` call (or the constructor) — apps see the
 *    failure where they wrote the broken function, not on a delayed
 *    worker `error` reply that they may or may not be listening for.
 * 2. **The worker never sees a half-broken func**. If a closure-over-
 *    outer-scope reference would throw inside the worker, this
 *    detector throws first; the worker's `setAggFuncs` payload only
 *    ever carries functions that round-trip cleanly.
 *
 * The detector probes with `{ values: [1, 2], colId: '__probe__' }` —
 * arbitrary numeric input, just enough to evaluate the function body
 * once. If the rebuilt copy throws on the probe AND the original DOES
 * NOT, the source referenced something only available in the original's
 * closure. If both versions return the same value (NaN-safe via
 * `Object.is`), the function is pure and safe to ship. Returns the
 * serialised `source` string the worker should rebuild from.
 */
function serializeAggFunc(name: string, fn: IAggFunc): string {
  const source = fn.toString();
  let rebuilt: IAggFunc;
  try {
    rebuilt = new Function(`"use strict"; return (${source});`)() as IAggFunc;
  } catch (e) {
    throw new Error(
      `[cgrid] aggFunc '${name}' failed to serialise (syntax error in toString output): ${
        String((e as Error).message ?? e)
      }. Custom aggFuncs MUST be plain function expressions or arrows — no class methods.`,
    );
  }
  if (typeof rebuilt !== 'function') {
    throw new Error(
      `[cgrid] aggFunc '${name}' did not deserialise to a function — check the function shape`,
    );
  }
  const probe: IAggFuncParams = { values: [1, 2], colId: '__cgrid_probe__' };
  let originalRes: unknown;
  let originalThrew = false;
  try { originalRes = fn(probe); } catch { originalThrew = true; }
  let rebuiltRes: unknown;
  let rebuiltErr: Error | null = null;
  try { rebuiltRes = rebuilt(probe); } catch (e) { rebuiltErr = e as Error; }
  if (rebuiltErr && !originalThrew) {
    // Closure over outer scope — the rebuilt copy can't see the
    // identifier the source referenced, so it throws ReferenceError
    // (or TypeError on a closed-over object access). Point the app
    // straight at the constraint.
    throw new Error(
      `[cgrid] aggFunc '${name}' closes over outer scope ` +
      `(rebuilt copy threw '${rebuiltErr.message}' when invoked). ` +
      `Custom aggFuncs MUST be pure — no references to variables, ` +
      `imports, or this-bound state from the surrounding closure. ` +
      `Pre-bake any external data into the values via a column ` +
      `valueGetter instead.`,
    );
  }
  if (!rebuiltErr && !originalThrew && !Object.is(originalRes, rebuiltRes)) {
    // Both ran without throwing but produced different results — the
    // source must reference an outer-scope value that the rebuilt copy
    // resolved to a different binding (e.g. a global with the same
    // name but different value). Same root cause: not pure.
    throw new Error(
      `[cgrid] aggFunc '${name}' produced different results pre- and post-serialisation ` +
      `(probably closes over outer scope). Custom aggFuncs MUST be pure.`,
    );
  }
  return source;
}

/** Cycle 8 / Task 2 — find the next stage in `sortingOrder` given the
 *  column's current sort state. `null` means "not in the sort model"
 *  (unsorted). When the current state isn't in the cycle (e.g. cycle is
 *  `['asc', 'desc']` and the column was previously unsorted), the next
 *  stage is the first entry — so an unsorted column always starts the
 *  cycle at index 0. Wraps at the end so an `['asc', 'desc']` cycle
 *  bounces between the two directions forever. */
function nextSortStage(
  current: 'asc' | 'desc' | null,
  order: Array<'asc' | 'desc' | null>,
): 'asc' | 'desc' | null {
  if (order.length === 0) return null;
  const idx = order.indexOf(current);
  const pick = idx === -1 ? order[0] : order[(idx + 1) % order.length];
  return pick ?? null;
}

/** Cycle 7 / Task 9 — shallow equality for v2 filter entries. Used by
 *  `setColumnFilterModel` to decide whether the change is actually a
 *  mutation. JSON.stringify is the cheapest correct comparison for the
 *  small entry shapes we ship (max ~10 fields) and avoids hand-writing
 *  a discriminator-aware deep-equal per filterType. Both sides null is
 *  also equal. */
function entriesEqual(
  a: CFilterModelEntry | null,
  b: CFilterModelEntry | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Cycle 7 / Task 9 — colIds whose per-column entry differs between the
 *  current map and the incoming `next` model. Used by `setFilterModel`
 *  to label the `filterChanged.columns` array so apps can correlate
 *  bulk restores with per-column UI state. */
function computeChangedColIds(
  prev: Map<string, CFilterModelEntry>,
  next: FilterModel,
): string[] {
  const out = new Set<string>();
  const incomingV2 = new Map<string, CFilterModelEntry>();
  for (const [id, entry] of Object.entries(next)) {
    if ((entry as CFilterModelEntry & { filterType?: string }).filterType !== undefined) {
      incomingV2.set(id, entry as CFilterModelEntry);
    }
  }
  for (const id of prev.keys()) {
    if (!entriesEqual(prev.get(id) ?? null, incomingV2.get(id) ?? null)) out.add(id);
  }
  for (const id of incomingV2.keys()) {
    if (!prev.has(id)) out.add(id);
  }
  return Array.from(out);
}

/** Rewrite a `columnDefs` tree so its flat leaf order matches `newLeafOrder`,
 *  preserving group structure. Leaves only reorder within their enclosing
 *  scope (top-level for ungrouped, group-local for grouped). At each level,
 *  siblings re-sort by the position of their earliest contained leaf in
 *  `newLeafOrder` so a leaf moving to a different index pulls its enclosing
 *  group with it. Leaves not mentioned in `newLeafOrder` are pushed to the
 *  tail (defensive — the caller passes a permutation in practice). Cycle 6 /
 *  Task 1. */
function rebuildColumnDefsByLeafOrder<TRow>(
  defs: (CColDef<TRow> | CColGroupDef<TRow>)[],
  newLeafOrder: string[],
): (CColDef<TRow> | CColGroupDef<TRow>)[] {
  const posOf = new Map<string, number>();
  newLeafOrder.forEach((id, i) => posOf.set(id, i));
  return reorderDefs(defs, posOf);
}

function reorderDefs<TRow>(
  defs: (CColDef<TRow> | CColGroupDef<TRow>)[],
  posOf: Map<string, number>,
): (CColDef<TRow> | CColGroupDef<TRow>)[] {
  const next = defs.map((d) => {
    if (isColGroupDef(d)) {
      return { ...d, children: reorderDefs(d.children, posOf) } as CColGroupDef<TRow>;
    }
    return d;
  });
  next.sort((a, b) => minLeafPos(a, posOf) - minLeafPos(b, posOf));
  return next;
}

/** Diff two flat-leaf orders and return the colIds whose index changed.
 *  Used by Cycle 6 / Task 2 to fan out `columnMoved` events from a
 *  `applyColumnState({ applyOrder: true })` call. */
function collectMovedColIds(oldOrder: string[], newOrder: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < newOrder.length; i++) {
    const id = newOrder[i]!;
    if (oldOrder[i] !== id) out.push(id);
  }
  return out;
}

function minLeafPos<TRow>(
  node: CColDef<TRow> | CColGroupDef<TRow>,
  posOf: Map<string, number>,
): number {
  if (isColGroupDef(node)) {
    let m = Number.POSITIVE_INFINITY;
    for (const child of node.children) {
      const p = minLeafPos(child, posOf);
      if (p < m) m = p;
    }
    return m;
  }
  const id = (node.colId ?? (node.field as string | undefined)) ?? '';
  const p = posOf.get(id);
  return p === undefined ? Number.POSITIVE_INFINITY : p;
}

/** Cycle 7 / Task 3 — pick the popup filter type for a column. `filter:`
 *  wins (explicit popup name); else fall back to `cellDataType`. Returns
 *  `null` when the column has no filterable type (e.g. a checkbox column
 *  with no `filter:` and `cellDataType: 'text'` still gets text). */
function resolveFilterType(
  def: ResolvedColDef<any> | undefined,
): 'text' | 'number' | 'date' | 'set' | null {
  if (!def) return null;
  if (def.filter === 'text' || def.filter === 'number'
      || def.filter === 'date' || def.filter === 'set') {
    return def.filter;
  }
  if (def.cellDataType === 'number') return 'number';
  if (def.cellDataType === 'text') return 'text';
  return null;
}

/** Cycle 9 / Task 5 — default fill-handle extrapolation. Linear progression
 *  for numeric source values (next-step = last + average step), repeat for
 *  everything else. Empty source returns `undefined` so the caller leaves
 *  the cell alone. `targetIndex` is 0-based into the EXTENDED rows (the
 *  ones beyond the source rect). */
/** Structural compare for two range lists. Used by Cycle 9 / Task 7 to
 *  debounce `cellSelectionChanged` — a finished `rangeSelectionChanged`
 *  that lands on the same set as before skips the cell event. */
function rangesEqual(a: SelectionRange[], b: SelectionRange[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.rowStart !== y.rowStart || x.rowEnd !== y.rowEnd) return false;
    if (x.colIds.length !== y.colIds.length) return false;
    for (let j = 0; j < x.colIds.length; j++) {
      if (x.colIds[j] !== y.colIds[j]) return false;
    }
  }
  return true;
}

export function defaultFillExtrapolate(sourceValues: unknown[], targetIndex: number): unknown {
  if (sourceValues.length === 0) return undefined;
  const allNumeric = sourceValues.every((v) => typeof v === 'number' && Number.isFinite(v));
  if (allNumeric && sourceValues.length >= 2) {
    const nums = sourceValues as number[];
    let stepSum = 0;
    for (let i = 1; i < nums.length; i++) stepSum += nums[i]! - nums[i - 1]!;
    const step = stepSum / (nums.length - 1);
    return nums[nums.length - 1]! + step * (targetIndex + 1);
  }
  if (allNumeric && sourceValues.length === 1) {
    // Single numeric source — increment by 1 per step (matches ag-grid's
    // default for a 1-cell source on a numeric column).
    return (sourceValues[0] as number) + (targetIndex + 1);
  }
  // Repeat cycle for text / mixed: source[targetIndex % source.length].
  return sourceValues[targetIndex % sourceValues.length];
}

export class CGrid<TRow = any> {
  private events = new TypedEventEmitter<CGridEvent>();
  /** Cycle 23 / Task 7 — coalesced `stateUpdated` emitter. Subscribes
   *  to every state-affecting event on `this.events` and emits one
   *  `stateUpdated` per rAF tick carrying the full snapshot + the
   *  merged changedKeys. Lazily constructed in the constructor body
   *  so `this.getState()` is bound by the time it subscribes. */
  private stateUpdatedBus!: StateUpdatedBus;
  private columnTree!: ColumnTree;
  private columnGroupState!: ColumnGroupState;
  private columnDefsMap: Map<string, ResolvedColDef<TRow>> = new Map();
  private columnOrder: ResolvedColDef<TRow>[] = [];
  private columnLayout: ColumnLayout[] = [];
  private theme: ResolvedTheme;
  private scrollLeft = 0;
  private scrollTop = 0;
  /** Cycle 23 / Task 3 — debounce handle for `bodyScrollEnd`. Cleared
   *  on every scroll tick and re-armed for 200ms; null when no scroll
   *  has happened in the last window. */
  private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cycle 25 / Task 8 — scroll velocity in rows per ms (positive =
   *  scrolling down). Updated by `onScrollerScroll` from the delta
   *  between consecutive ticks; consumed by `requestViewport` to
   *  widen the requested range pre-emptively on a fast fling. */
  private scrollVelocityRows = 0;
  private lastScrollSampleTop = 0;
  private lastScrollSampleTime = 0;
  /** Cycle 25 / Task 10 — LRU of recently-fetched chunks keyed by
   *  `${rowStart}:${rowEnd}:${cols}`. Holds entries via WeakRef so
   *  GC can reclaim before our eviction runs. `null` when the
   *  `memoryBudgetMB` option is unset / 0 (caching disabled). */
  private chunkLRU: ChunkLRU<ViewportChunk> | null = null;
  private rowCount = 0;
  private chunk: ViewportChunk | null = null;
  /** Cycle 15 / Task 16 — latest sticky ancestor band from the worker.
   *  Refreshed on every `getViewport` reply. Empty when grouping is
   *  inactive or the first visible row is at position 0. */
  private stickyAncestors: StickyAncestor[] = [];
  /** Cumulative row-height index over the current visible-row order. Built
   *  on first chunk arrival (filled with the global `rowHeight` fallback for
   *  every row), then updated incrementally as chunks layer their per-row
   *  heights on top. Rebuilt from scratch when `rowCount` changes (sort /
   *  filter / transaction). `null` until the first chunk lands — the
   *  viewport falls back to uniform-height math in that window.
   *  Cycle 5 / Task 7. */
  private rowHeightIndex: RowHeightIndex | null = null;
  private decodedTextCols = new Map<string, string[]>();
  private viewportRequestPending = false;
  private viewportRequestQueued = false;

  private root: HTMLDivElement;
  /** Cycle 22 / Task 5 — non-null when the grid was constructed with
   *  `shadowRoot: true`. The constructor attaches the shadow root to
   *  the supplied container and mounts the grid's entire DOM inside
   *  it; the destroy path detaches the same root. */
  private shadowRoot: ShadowRoot | null = null;
  private scroller: HTMLDivElement;
  private sizer: HTMLDivElement;
  private cgridCanvas!: CGridCanvas;
  private canvasBounds = { width: 0, height: 0 };
  private editorContainer: HTMLDivElement;
  private cssReader: CssReader;
  private cellRenderers: CellRendererRegistry;
  private renderer: Renderer;
  private subgrids: Subgrid[] = [];
  private viewport!: ViewportState;
  private selection: SelectionModel;
  private hitTester: HitTester;
  private featureChain: FeatureChain;
  private cellEditorRegistry: CellEditorRegistry;
  private editor: EditorOverlay;
  /** Cycle 7 / Task 1 — DOM overlay that pools `<input>` elements for the
   *  floating-filter row. Mounts onto the same `editorContainer` host so
   *  it stacks above the canvas; positions per `transform: translate`. */
  private floatingFilterOverlay: FloatingFilterOverlay;
  /** Cycle 7 / Task 3 — orchestrates per-column filter popups (number /
   *  date / text / multi / set). Owns its own PopupHost instance so it
   *  can mount + unmount independently of the editor's popup. */
  private filterPopupHost: FilterPopupHost;
  /** Cycle 10 / Task 1 — right-click context menu portal. Mounts onto the
   *  same editor-overlay host as the filter popup so menus stack above
   *  the canvas. The host is intentionally minimal — it owns DOM lifecycle
   *  + dismissal; item resolution lives in `resolveContextMenuItems`. */
  private contextMenuHost: ContextMenuHost;
  /** Cycle 11 / Task 1 — tool-panel registry. Seeded with built-in IDs
   *  (`agColumnsToolPanel`, `agFiltersToolPanel`) and then merged with
   *  any `CGridOptions.components` overrides so apps can replace the
   *  built-ins or add new IDs that custom `SideBarDef.toolPanels`
   *  entries reference via `toolPanel`. The side-bar host (Task 2)
   *  reads this registry to instantiate panels on demand. */
  private toolPanelRegistry: ToolPanelRegistry;
  /** Cycle 11 / Task 2 — side-bar host (the DOM panel on the right or
   *  left edge that houses tool panels). `null` when `options.sideBar`
   *  resolves to off. Reserves a left/right gutter on the canvas
   *  region via `reserveSideBarSpace` so the canvas reflows when the
   *  side bar opens / closes / position changes / resize-handle drag
   *  finishes. */
  private sideBar: SideBarHost | null = null;
  /** Cycle 11 / Task 2 — currently reserved insets (CSS px) on the
   *  canvas region's left + right edges, set by the side bar. The
   *  scroller, editor overlay, and canvas position consume these so
   *  the side bar visually replaces the matching gutter. */
  private sideBarInsets = { left: 0, right: 0 };
  /** Cycle 13 / Task 1 — status-bar registry. Seeded with the canonical
   *  built-in keys (`agTotalRowCountComponent`, …) and then merged with
   *  any `CGridOptions.components` overrides so apps can replace the
   *  built-ins or add custom keys that `StatusBarDef.statusPanels`
   *  entries reference via `statusPanel`. The status bar host reads
   *  this registry to instantiate panels on demand. */
  private statusPanelRegistry: StatusPanelRegistry;
  /** Cycle 13 / Task 1 — status-bar host (DOM strip on the bottom or
   *  top edge that houses status panels). `null` when `options.statusBar`
   *  resolves to off. Reserves a top/bottom inset on the canvas region
   *  via `reserveStatusBarSpace` so the canvas reflows when the bar
   *  mounts / hides / position toggles / def changes. */
  private statusBar: StatusBarHost | null = null;
  /** Cycle 13 / Task 1 — currently reserved insets (CSS px) on the
   *  canvas region's top + bottom edges, set by the status bar. */
  private statusBarInsets: Record<StatusBarPosition, number> = { top: 0, bottom: 0 };
  /** Cycle 15 / Task 6 — row group panel host (DOM strip ABOVE the
   *  column header row that hosts one chip per `rowGroupCols[i]`).
   *  `null` when `options.rowGroupPanelShow` resolves to off. Reserves
   *  an additional top inset on the canvas region via
   *  `reserveRowGroupPanelSpace`; sits BELOW any status bar pinned to
   *  the top, ABOVE the column headers. */
  private rowGroupPanel: RowGroupPanelHost | null = null;
  /** Cycle 15 / Task 6 — reserved top inset (CSS px) contributed by
   *  the row group panel. Combined with `statusBarInsets.top` when
   *  applying the scroller's `top` style so a top status bar + row
   *  group panel stack cleanly. */
  private rowGroupPanelTopInset = 0;
  /** Cycle 18 / Task 6 — pivot panel host (DOM strip ABOVE the row
   *  group panel and column header row that hosts one pill per
   *  `pivotColumns[i]`). `null` when `options.pivotPanelShow` resolves
   *  to off. Reserves an additional top inset on the canvas region via
   *  `reservePivotPanelSpace`; stacks ABOVE the row group panel so the
   *  vertical order is: status bar → pivot panel → row group panel →
   *  column headers → body. */
  private pivotPanel: PivotPanelHost | null = null;
  /** Cycle 18 / Task 6 — reserved top inset (CSS px) contributed by
   *  the pivot panel. Combined with `statusBarInsets.top` +
   *  `rowGroupPanelTopInset` when applying the scroller's `top`
   *  style. */
  private pivotPanelTopInset = 0;
  /** Insertion line element for external column-header drops (e.g. from
   *  the Columns tool panel). Lazily created, lives in editorContainer.
   *  Reused across drags; hidden when no drag is active. */
  private colDropInsertionLine: HTMLDivElement | null = null;
  /** Cycle 4 / Task 11 (cell-flash patch) — per-cell flash tracker.
   *  Drained from each `getViewport` chunk's `flashMask` and queried
   *  by the painter's `cellData` callback to produce `flashAlpha`. */
  private flashRegistry: FlashRegistry;
  /** Flash tracker for group-row and footer-row aggregate cells.
   *  Keyed by `"${groupKey}\0${colId}"` → flash start time (ms from
   *  performance.now()). Populated when groupTotals values change
   *  between consecutive viewport chunks. Parallel to flashRegistry
   *  but group rows carry no rowId so they can't use the rowId-keyed
   *  registry. */
  private groupFlashMap = new Map<string, number>();
  /** Cycle 4 / Task 11 — `prefers-reduced-motion: reduce` listener.
   *  Live-read by `FlashRegistry.getReducedMotion`. */
  private reducedMotionQuery: MediaQueryList | null = null;
  private reducedMotion = false;
  /** Cycle 7 / Task 1 — canonical per-column v2 filter model state. Drives
   *  `getColumnFilterModel`; `setColumnFilterModel` updates this map and
   *  fans the resulting full model out to the worker via `setFilterModel`
   *  (which still ships the Cycle-4/5 legacy shape until Task 2 widens
   *  the worker matcher). Stored separately from the legacy `FilterModel`
   *  so a user calling `setFilterModel({legacy})` doesn't drop entries
   *  set via `setColumnFilterModel`. */
  private columnFilterModels: Map<string, CFilterModelEntry> = new Map();
  /** Full-row edit coordinator (Cycle 5 / Task 10). Mutually exclusive with
   *  `this.editor` at runtime — `openEditor` dispatches to one or the other
   *  based on `options.editType`. Surface for `api.getCellEditorInstances`
   *  (later cycle); for now `getEditorInstances()` is consumed by debug
   *  flows only. */
  private rowEdit: RowEditCoordinator;
  /** Tracks the cell currently being edited (single-cell mode). Cleared on
   *  close. Used to compose `cellEditingStarted/Stopped` payloads. The
   *  `mode` field implements Excel's Enter / Edit dichotomy — see
   *  `CGridOptions.enableExcelEditing` for the dispatch rules. */
  private activeEdit: {
    rowIndex: number;
    rowId: string;
    colId: string;
    oldValue: unknown;
    data: unknown;
    mode: 'enter' | 'edit';
  } | null = null;
  private a11y: A11yOverlay;
  private workerClient: WorkerClient;
  private destroyed = false;
  /** Cycle 10 / Task 6 — methods that have already emitted a one-time
   *  warn after being gated by `suppressClipboardApi`. Keeps the
   *  console quiet for apps that repeatedly hit a suppressed entry
   *  point (e.g. a Ctrl+C polling loop) while still surfacing the
   *  first invocation so developers notice the gate. */
  private clipboardSuppressedWarned = new Set<string>();
  private selectionUnsubscribe: () => void = () => {};
  private sortModel: SortModel = [];
  /** Snapshot of every leaf's mutable state taken after the column tree
   *  resolves at construction. `resetColumnState` replays it to restore
   *  the "as-coded" layout. Cycle 6 / Task 2. */
  private initialColumnStateSnapshot: CColumnState[] = [];
  /** Last bounds we emitted `gridSizeChanged` for. `null` until the initial
   *  setBounds lands — that first call records but does not emit, so external
   *  listeners only see real post-mount size changes. */
  private lastEmittedBounds: { width: number; height: number } | null = null;
  /** Latches `firstDataRendered` to exactly once per grid instance. */
  private firstDataFired = false;
  /** Cycle 14 / Task 6 — what triggered the in-flight aggregation
   *  recompute. Set by `requestViewport(source)` at the call site that
   *  caused the totals to need refreshing (data mutation, filter pass,
   *  custom-aggFunc swap, column aggFunc change, explicit API). Read +
   *  cleared by the viewport-response handler when emitting
   *  `aggregationChanged`. Cosmetic re-renders — scroll, sort, theme,
   *  column move / visible / pin / resize — call `requestViewport()`
   *  with no source so this stays `null` and no event fires for those
   *  paths. Most-recent-source wins when multiple data-affecting calls
   *  coalesce on a single viewport fetch. */
  private pendingAggSource: AggregationChangedSource | null = null;
  /** First / last colId of the materialised center-column slice — the
   *  identity of the virtualisation window. `null` for "no center columns
   *  visible". The outer ref is `null` until the first `recomputeViewport`
   *  captures the baseline, so the construction-time recompute does NOT
   *  emit `virtualColumnsChanged` and external listeners only see real
   *  post-mount shifts. Cycle 6 / Task 8. */
  private prevVirtualColRange: { first: string | null; last: string | null } | null = null;
  /** Cycle 9 / Task 7 — snapshot of the range set as it stood at the last
   *  `cellSelectionChanged` emission. Used to debounce: a finished
   *  rangeSelectionChanged that lands on the same set as before skips
   *  the cellSelectionChanged fan-out. Deep-cloned on store so a later
   *  in-place mutation can't false-equal. */
  private lastEmittedCellSelectionRanges: SelectionRange[] = [];
  /** Cycle 15 / Task 4 — current row-group model. Drives auto-group
   *  column insertion (this task) + worker `setGroupModel` dispatch
   *  (Task 1). The empty model bypasses every group-aware pass cleanly. */
  private groupModel: GroupModel = { rowGroupCols: [] };
  /** Cycle 15.5 / Task 1 — the canonical mutable grouping state shared
   *  by the three grouping UIs (row group panel, columns tool panel
   *  Row Groups drop zone, header context menu Group/Un-Group items).
   *  All three views call the same primitive verbs
   *  (`addRowGroupColumn`, `removeRowGroupColumn`,
   *  `moveRowGroupColumn`, `setRowGroupColumnSort`) and subscribe to
   *  `groupingStateChanged` to re-render. Constructed at init with
   *  the initial `rowGroupCols`; mutations route through
   *  `applyGroupingStateChange` so the worker stays in sync. */
  private groupingState: GroupingState = new GroupingState();
  private groupingStateUnsubscribe: () => void = () => {};
  /** Cycle 18 / Task 3 — canonical pivot state (pivotMode + ordered
   *  pivotColumns + valueColumns). Mirrors `groupingState`: every pivot
   *  UI surface mutates it; subscribers re-render. The imperative pivot
   *  API routes through it. */
  private pivotState: PivotState = new PivotState();
  private pivotStateUnsubscribe: () => void = () => {};
  /** Cycle 18 / Task 3 — true while synthesized pivot result columns are
   *  installed (the column tree has been swapped to the pivot tree). */
  private pivotActive = false;
  /** Cycle 18 / Task 3 — saved primary column structures, restored when
   *  pivot deactivates. `null` while pivot is inactive. */
  private primaryColumnTree: ColumnTree | null = null;
  private primaryColumnGroupState: ColumnGroupState | null = null;
  /** Cycle 18 / Task 3 — reverse index: synthetic pivot colId →
   *  (pivotPath, valueColId), for the body cell lookup against
   *  `chunk.pivotValues`. */
  private pivotCellSpecById: Map<string, PivotCellSpec> = new Map();
  /** Cycle 18 / Task 3 — signature of the last-synthesized pivot tree
   *  (leaf paths + value columns) so columns re-synthesize only when the
   *  distinct-key set or measures actually change. */
  private pivotTreeSignature = '';
  /** Cycle 15 / Task 4 + Task 5 — synthesized auto-group column(s).
   *  Length depends on `groupDisplayType`:
   *    - `'singleColumn'` + grouping active → one column.
   *    - `'multipleColumns'` + grouping active → one per `rowGroupCols`.
   *    - `'groupRows'` / `'custom'` / no grouping → empty.
   *  Inserted at the start of the visible-leaf order by
   *  `computeVisibleColumnOrder`; rebuilt on every `setGroupModel` /
   *  `setGridOption('groupDisplayType', …)` /
   *  `setGridOption('autoGroupColumnDef', …)` call. */
  private autoGroupColumns: ResolvedColDef<TRow>[] = [];
  /** Cycle 15 / Task 5 — non-null when `groupDisplayType` resolves to
   *  `'groupRows'` or `'custom'`. The body painter reads this every
   *  frame to detect group rows + paint full-row strips spanning the
   *  visible width. The `lookup` takes a DATA row index (matches
   *  `cellAt(rowIndex, …)`'s row argument) and returns the
   *  `GroupCellValue` payload on a group row, `null` on a data row. */
  private groupRowStripCtx: {
    renderer: string;
    lookup: (rowIndex: number) => GroupCellValue | null;
  } | null = null;
  /** Cycle 15 / Task 7 — main-thread mirror of the worker's persistent
   *  expanded-keys set.
   *    - `null` is the "every group expanded by default" sentinel:
   *      `expandAll()` resets to it; `setGroupModel` lands in it; a
   *      freshly mounted grouped grid starts in it.
   *    - Non-null is the explicit set (`collapseAll()` => empty;
   *      `setExpanded(key, false)` materialises against
   *      `knownGroupKeys` before mutating).
   *  Drives the `getExpandedKeys()` snapshot. */
  private expandedKeys: Set<string> | null = null;
  /** Cycle 15 / Task 7 — list of every composite group key currently
   *  alive in the worker's tree. Refreshed off each `setGroupModel` /
   *  `setExpandedKeys` reply. Used to materialise `expandedKeys`
   *  from `null` when the API needs an explicit set (e.g.
   *  `setExpanded(key, false)` while the mirror is still at the
   *  default-all sentinel) and as the source of truth for
   *  `getExpandedKeys()`'s "everything's expanded" snapshot. */
  private knownGroupKeys: string[] = [];
  /** Cycle 15 / Task 8 — `groupKey → descendant leaf rowIds` map
   *  populated from every `groupKeysSnapshot` reply when the worker's
   *  descendant emission is on. Backs the `GroupMembershipResolver`
   *  the SelectionModel calls to cascade selection + recompute
   *  tri-state. Empty when grouping bypasses OR when
   *  `groupSelectsChildren` is off. */
  private groupDescendantsByKey: Map<string, readonly string[]> = new Map();

  constructor(container: HTMLElement, private options: CGridOptions<TRow>) {
    if (!options.getRowId) throw new Error('[cgrid] options.getRowId is required');

    // Cycle 25 / Task 10 — memory-pressure release. Holds recent
    // chunks via WeakRef so V8/JSC can collect them ahead of our
    // explicit eviction. `memoryBudgetMB` 0/undefined disables the
    // cache entirely.
    if (options.memoryBudgetMB && options.memoryBudgetMB > 0) {
      this.chunkLRU = new ChunkLRU<ViewportChunk>(options.memoryBudgetMB * 1024 * 1024);
    }

    // 1. DOM scaffold — scroller (with sized sizer child) provides native scrollbars;
    // the canvas (created later by CGridCanvas) overlays the scroller's content area
    // but is sized to scroller.clientWidth/Height so the scrollbar strips remain
    // interactive.
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
    // Cycle 22 / Task 2 — `cg-grid` is the stable marker class for the
    // grid root. Density modes, print mode, and any future host-level
    // chrome layer their own class alongside it; the theme class then
    // contributes the token bundle.
    this.root.classList.add('cg-grid');
    this.root.classList.add(options.theme ?? 'cg-theme-quartz');
    // Cycle 22 / Task 2 — density class on the root. Applied here so
    // `--cg-row-height` / `--cg-header-height` / `--cg-cell-padding-x`
    // resolve to the density-bundle's overrides before the first
    // `cssReader.read()`.
    if (options.density) {
      this.root.classList.add(`cg-density-${options.density}`);
    }
    // Cycle 22 / Task 5 — optional shadow-root encapsulation. The grid
    // attaches an open shadow root to `container` and mounts every
    // descendant (root + its scroller + canvas + editor overlay) inside
    // it. The package's tokens.css is inlined as a `<style>` so the
    // shadow tree gets the full token bundle without an external sheet.
    // The mount target later in the constructor uses `this.shadowRoot
    // ?? container`, so the rest of the construction path doesn't need
    // to know whether shadow mode is active.
    if (options.shadowRoot) {
      this.shadowRoot = container.attachShadow({ mode: 'open' });
      const styleEl = document.createElement('style');
      styleEl.className = 'cg-shadow-tokens';
      // Vite's `?inline` resolves to the compiled CSS at build time
      // (production); the test runtime returns an empty string, which
      // is fine — the test environment doesn't exercise visual paint,
      // and apps in shadow-root mode that need additional rules layer
      // them via `setThemeParams` or a sibling `<style>` element.
      styleEl.textContent = tokensCssInline;
      this.shadowRoot.appendChild(styleEl);
    }

    this.scroller = document.createElement('div');
    this.scroller.className = 'cg-scroller';
    // overflow:scroll (not auto) so scrollbar gutters are reserved unconditionally —
    // macOS overlay scrollbars otherwise disappear when idle and the user can't
    // see they're scrollable. The webkit-scrollbar styles in tokens.css then
    // theme the persistent track + thumb.
    this.scroller.style.cssText = 'position:absolute; inset:0; overflow:auto;';
    this.sizer = document.createElement('div');
    this.sizer.className = 'cg-sizer';
    this.sizer.style.cssText = 'width:1px; height:1px; pointer-events:none;';
    this.scroller.appendChild(this.sizer);

    this.editorContainer = document.createElement('div');
    this.editorContainer.style.cssText = 'position:absolute; left:0; top:0; right:0; bottom:0; pointer-events:none;';
    // Children of editorContainer set pointer-events:auto themselves
    this.root.appendChild(this.scroller);
    // Cycle 22 / Task 5 — when shadow mode is active, mount the entire
    // grid DOM inside the shadow root. Otherwise the grid lives in the
    // light DOM (the default + lowest-friction path).
    (this.shadowRoot ?? container).appendChild(this.root);

    // 2. Theme + cell renderers
    this.cssReader = new CssReader(this.root);
    this.theme = this.cssReader.read();
    this.cellRenderers = new CellRendererRegistry();
    // Cycle 23 / Task 7 — wire the state-update bus. Subscribes to
    // every state-affecting event on `this.events` so a single
    // `stateUpdated` fires per rAF frame regardless of how many
    // discrete mutations landed. Built BEFORE the rest of construction
    // so any setup-time events (initial column resolution, etc.) get
    // captured.
    this.stateUpdatedBus = new StateUpdatedBus(this.events, () => this.getState());
    this.cellRenderers.register('text', textCell);
    this.cellRenderers.register('number', numberCell);
    this.cellRenderers.register('checkbox', checkboxCell);
    this.cellRenderers.register('header', headerCell);
    this.cellRenderers.register('text-wrap', wrapTextCell);
    this.cellRenderers.register('totals', totalsCell);
    this.cellRenderers.register('group', groupCell);
    this.cellRenderers.register('groupFooter', groupFooterCell);
    // Cycle 21 / Task 1 — canvas-painted sparkline (line variant; Task 2
    // plugs the column / area / bar / pie sibling painters through the
    // same registered name via `cellRendererParams.sparkline.type`).
    this.cellRenderers.register('sparkline', sparklineCell);
    // Per-row checkbox renderer — forced as the cellRenderer for any
    // column declaring `checkboxSelection: true`. Reads `p.isSelected`
    // for state (NOT row data); a chain feature claims the click.
    this.cellRenderers.register('rowSelectCheckbox', rowSelectCheckboxCell);

    // 2b. Tool-panel registry (Cycle 11 / Task 1). Seed the built-in
    // IDs first, then overwrite the Columns stub with the real
    // ColumnsToolPanel implementation (Cycle 11 / Task 3 — Task 4
    // replaces the Filters stub the same way). App-supplied
    // `components` entries are merged last so apps can still override
    // the built-in panels by registering against the same key.
    this.toolPanelRegistry = new ToolPanelRegistry();
    this.toolPanelRegistry.seedBuiltIns();
    this.toolPanelRegistry.register('agColumnsToolPanel', ColumnsToolPanel);
    this.toolPanelRegistry.register('agFiltersToolPanel', FiltersToolPanel);
    if (options.components) {
      for (const [id, ctor] of Object.entries(options.components)) {
        this.toolPanelRegistry.register(id, ctor);
      }
    }

    // 2c. Status-panel registry (Cycle 13 / Task 1 + Task 4). Seed the
    // canonical built-in keys with their real implementations (Tasks 2 +
    // 3 wired count + aggregation ctors through the registry's
    // BUILT_IN_STATUS_PANEL_CTORS map). Cycle 13 / Task 4 — every entry
    // in `options.components` is also registered here so the same
    // channel feeds custom tool panels AND custom status panels. The
    // two registries share the channel because `ToolPanel` and
    // `IStatusPanelComp` lifecycles are structurally identical
    // (`init / getGui / refresh / destroy`); whichever surface's def
    // (`SideBarDef` vs `StatusBarDef`) references a given key wins at
    // mount. An entry registered against a built-in status key (e.g.
    // `agAggregationComponent`) overrides the built-in implementation —
    // identical to how the tool-panel registry handles overrides.
    this.statusPanelRegistry = new StatusPanelRegistry();
    this.statusPanelRegistry.seedBuiltIns();
    if (options.components) {
      for (const [id, ctor] of Object.entries(options.components)) {
        this.statusPanelRegistry.register(id, ctor as StatusPanelComponent);
      }
    }

    // 3. Column model — resolve into a tree (groups + leaves), then derive
    // the visible-leaf ordering from the group open/closed state. Task 3
    // makes group headers clickable and honors `columnGroupShow` on leaves
    // so collapsing a group hides its 'open'-only children (and vice-versa).
    // `columnDefsMap` keeps every leaf (including currently-hidden ones) so
    // toggling a group back open can rehydrate without re-resolving defs.
    // Unified `selection` config resolution. When set, it overrides
    // legacy `rowSelection` / `suppressRowClickSelection` /
    // `rowMultiSelectWithClick` and may auto-inject a pinned-left
    // checkbox column at index 0 (pre-tree-build so the column shows
    // up alongside the rest with no special-case painting path).
    const resolvedSelection = resolveSelection<TRow>(options.selection);
    if (resolvedSelection) {
      options.rowSelection = resolvedSelection.rowSelectionMode;
      if (resolvedSelection.suppressRowClickSelection) options.suppressRowClickSelection = true;
      if (resolvedSelection.rowMultiSelectWithClick) options.rowMultiSelectWithClick = true;
      if (resolvedSelection.syntheticCheckboxColumn) {
        // Skip if the app already added a column with the same colId
        // (idempotent if `selection` is set via setGridOption +
        // updateGridOptions cycle later).
        const hasIt = options.columnDefs.some(
          (d) => (d as any).colId === resolvedSelection.syntheticCheckboxColumn!.colId,
        );
        if (!hasIt) {
          options.columnDefs = [resolvedSelection.syntheticCheckboxColumn, ...options.columnDefs];
        }
      }
    }
    this.columnTree = resolveColumnTree(options.columnDefs, options.defaultColDef, options.columnTypes);
    this.columnDefsMap = this.columnTree.leafById as Map<string, ResolvedColDef<TRow>>;
    this.columnGroupState = new ColumnGroupState(this.columnTree);
    this.columnOrder = this.computeVisibleColumnOrder();

    // Cycle 8 / Task 2 — seed the sort model from per-column `initialSort` +
    // `initialSortIndex`. Honored exactly once, at construction; subsequent
    // `applyColumnState` reads `sort` instead. Worker setSortModel is fanned
    // out below from the init().then() chain so the very first setRowData
    // paints already sorted.
    this.sortModel = this.computeInitialSortModel();

    // 4. Subgrid stack — group-header rows (one per tree depth) on top, then
    // the leaf header, then data. Rebuilt in place by `rebuildSubgridStack`
    // when `updateGridOptions({ columnDefs })` lands a tree with a different
    // depth.
    this.rebuildSubgridStack();

    // 5. Initial layout + viewport. The first measurement happens inside the
    // CGridCanvas constructor below (via the setBounds callback), but
    // recomputeViewport needs an initial layout so it doesn't crash on undefined.
    this.columnLayout = resolveColumnWidths(this.columnOrder, this.scroller.clientWidth || 800);
    this.recomputeViewport();

    // 5. Selection
    this.selection = new SelectionModel(options.rowSelection ?? 'none');

    // 6. Renderer — no canvas, no paint loop; just the per-frame paint logic.
    this.renderer = new Renderer({
      getViewport: () => this.viewport,
      getTheme: () => this.theme,
      getColumnDefs: () => this.columnDefsMap as Map<string, ResolvedColDef>,
      cellRenderers: this.cellRenderers,
      cellData: (rowIndex, colId) => this.cellAt(rowIndex, colId),
      getSelection: () => this.selection.state,
      getSortModel: () => this.sortModel,
      getTotalRowCount: () => this.rowCount,
      getCanvasWidth: () => this.canvasBounds.width,
      getCanvasHeight: () => this.canvasBounds.height,
      rowDataSnapshotAt: (rowIndex) => this.rowDataSnapshotAt(rowIndex),
      getQuickFilterLowerTerms: () => this.quickFilterLowerTerms,
      // Cycle 9 / Task 5 — paint a 6×6 fill handle on the last range when
      // enabled. Read per paint so a runtime setGridOption flip lights up
      // on the next frame without re-wiring the renderer.
      getShowFillHandle: () => this.options.enableFillHandle === true
        && this.selection.state.ranges.length > 0,
      // Cycle 14 / Task 4 — header decoration toggle. Read per paint so a
      // runtime `setGridOption('suppressAggFuncInHeader', …)` flip lights
      // up on the next frame. Per-column overrides live on each
      // `ResolvedColDef` and win when set — `byRows.ts` resolves the pair
      // at the header-text path.
      getSuppressAggFuncInHeader: () => this.options.suppressAggFuncInHeader === true,
      getVisibleCellBounds: (rowIndex, colId) => this.getVisibleCellBounds(rowIndex, colId),
      // Cycle 15 / Task 5 — full-row group-strip lookup for `groupRows` /
      // `custom` display types. Returns `null` for singleColumn /
      // multipleColumns / no-grouping so the byRows painter skips the
      // strip code path with zero overhead. The renderer key defaults to
      // `'group'`; apps override via `CGridOptions.groupRowRenderer` for
      // `'custom'` mode.
      getGroupRowStrip: () => this.groupRowStripCtx,
      // Cycle 15 / Task 12 — per-row kind probe. Lets the byRows
      // painter detect per-group footer rows (`rowKind === 3`) without
      // peeking inside cgrid's chunk. Returns 0 (data) outside the
      // current chunk window so the painter defaults gracefully when
      // a paint frame outruns the chunk arrival.
      getRowKindAt: (rowIndex) => {
        const chunk = this.chunk;
        if (!chunk) return 0;
        const localIndex = rowIndex - chunk.rowStart;
        if (localIndex < 0 || localIndex >= chunk.rowCount) return 0;
        return chunk.rowKinds[localIndex] ?? 0;
      },
      // Cycle 15.5 / Task 4 — groupHideOpenParents suppresses sticky band.
      getGroupHideOpenParents: () => this.options.groupHideOpenParents === true,
      // Cycle 15 / Task 16 — sticky group band.
      getStickyAncestors: () => this.stickyAncestors,
      getGroupDepthAt: (rowIndex) => this.groupDepthAt(rowIndex),
      getGroupKeyAt: (rowIndex) => this.groupKeyAt(rowIndex),
      getStickyGroupTotals: (groupKey, colId) => this.totalsCellLookup(colId, groupKey),
      // Cycle 18 / Task 4 — column group open/closed lookup for the
      // pivot column-group chevron paint path. byRows reads this on
      // every header-group paint to flip the chevron direction; the
      // painter restricts use to BRANCH pivot groups, so non-pivot
      // group headers (Cycle 4) never call into this lookup.
      getColumnGroupOpen: (groupId) => this.columnGroupState.isOpen(groupId),
    });

    // 7. Canvas wrapper — owns the <canvas>, gc cache, RAF + resize polling.
    // The setBounds callback fires synchronously inside the constructor's first
    // resize() — BEFORE this.cgridCanvas is assigned — so the renderer must
    // read canvas dimensions from `canvasBounds` (which setBounds sets first),
    // not from this.cgridCanvas.bounds.
    this.cgridCanvas = new CGridCanvas(this.root, {
      setBounds: (b) => {
        this.canvasBounds.width = b.width;
        this.canvasBounds.height = b.height;
        this.columnLayout = resolveColumnWidths(this.columnOrder, b.width);
        this.recomputeViewport();
        // Only request viewport once the worker is connected; before that, the
        // worker client throws on send. After init the gridReady handler does
        // the first fetch and any later resize re-fetches normally.
        if (this.workerClient) this.requestViewport();
        // gridSizeChanged: skip the initial measurement (lastEmittedBounds is
        // null on first call — we record the size silently). Emit only when
        // dimensions actually change so a repaint-poll tick that re-measures
        // to the same size never spams listeners.
        if (this.lastEmittedBounds === null) {
          this.lastEmittedBounds = { width: b.width, height: b.height };
        } else if (
          b.width !== this.lastEmittedBounds.width ||
          b.height !== this.lastEmittedBounds.height
        ) {
          this.lastEmittedBounds.width = b.width;
          this.lastEmittedBounds.height = b.height;
          this.events.emit({ type: 'gridSizeChanged', width: b.width, height: b.height });
        }
      },
      paint: (gc) => this.renderer.paint(gc),
    }, {
      // Drawable size = scroller's inner area MINUS the scrollbar thickness.
      // macOS overlay scrollbars don't reserve a gutter (clientWidth ===
      // offsetWidth), so without an explicit subtraction the canvas paints
      // over where the scrollbar would render and the user sees nothing.
      // Always reserving the gutter is the right trade-off for a data grid
      // where scrolling is expected.
      measureSize: () => {
        const sbT = this.theme.scrollbarThickness;
        const baseW = this.scroller.clientWidth || this.root.clientWidth || 0;
        const baseH = this.scroller.clientHeight || this.root.clientHeight || 0;
        // If clientWidth already excludes the gutter (classic scrollbars), the
        // root.clientWidth is wider than scroller.clientWidth — no further
        // subtraction needed. Otherwise (overlay), reserve sbT pixels.
        const rootW = this.root.clientWidth || baseW;
        const rootH = this.root.clientHeight || baseH;
        const reserveW = rootW - baseW >= sbT - 1 ? 0 : sbT;
        const reserveH = rootH - baseH >= sbT - 1 ? 0 : sbT;
        return {
          width: Math.max(0, baseW - reserveW),
          height: Math.max(0, baseH - reserveH),
        };
      },
    });
    // Stack editorContainer above the canvas (canvas was appended to root
    // by CGridCanvas, so editor goes on top).
    this.root.appendChild(this.editorContainer);

    // Cycle 11 / Task 2 — side bar (DOM panel on the right or left edge
    // hosting tool panels). Mounts when `options.sideBar` resolves to a
    // non-null def via `normalizeSideBarOption`. Wires the geometry
    // callback so the canvas reflows when the side bar opens / closes /
    // changes position / finishes a resize-handle drag. The host attaches
    // to `this.root` AFTER the canvas + editor overlay so its z-order
    // sits above them naturally without explicit z-index plumbing.
    const sideBarDef = normalizeSideBarOption(options.sideBar);
    if (sideBarDef) {
      const ctx: SideBarGridContext = {
        registry: this.toolPanelRegistry,
        // The API surface tool panels consume. Construction-time `makeApi`
        // returns the same shape as the post-gridReady event's `api`, so
        // panels can read column / filter state immediately — no need to
        // wait for the worker init.
        api: this.makeApi(),
        setReservedSpace: (side, width) => this.reserveSideBarSpace(side, width),
        // Cycle 11 / Task 7 — fan side-bar lifecycle events into the
        // grid's typed event emitter. The host's payload shape is the
        // same as the CGridEvent union members for `toolPanelVisibleChanged`
        // and `sideBarVisibleChanged`, so this is a straight pass-through.
        emit: (event) => this.events.emit(event),
      };
      this.sideBar = new SideBarHost(this.root, ctx, sideBarDef);
    }

    // Cycle 13 / Task 1 — status bar (DOM strip on the bottom or top
    // edge hosting status panels). Mounts when `options.statusBar`
    // resolves to a non-null def via `normalizeStatusBarOption`. Wires
    // the geometry callback so the canvas reflows when the bar
    // mounts / hides / changes position. Attaches to `this.root` AFTER
    // the canvas + editor overlay so its z-order sits above them
    // naturally without explicit z-index plumbing.
    const statusBarDef = normalizeStatusBarOption(options.statusBar);
    if (statusBarDef) {
      const ctx: StatusBarGridContext = {
        registry: this.statusPanelRegistry,
        api: this.makeApi(),
        setReservedSpace: (side, height) => this.reserveStatusBarSpace(side, height),
      };
      this.statusBar = new StatusBarHost(this.root, ctx, statusBarDef);
    }

    // Cycle 15 / Task 6 — row group panel (DOM strip ABOVE the
    // column header row, hosting one chip per `rowGroupCols[i]` and
    // accepting column-header drops). Mounts when `options.rowGroupPanelShow`
    // resolves to `'always'` or `'onlyWhenGrouping'` (the latter only
    // produces a visible reservation when grouping is active). Attaches
    // to `this.root` AFTER the status bar so its z-order sits above
    // the canvas + side bar + status bar without explicit z-index
    // plumbing.
    // Cycle 15.5 / Task 1 — initialise the grouping state primitive
    // from the current rowGroupCols (empty at construction time; apps
    // call `setGroupModel` afterwards). All three grouping UIs read
    // from / mutate via this object.
    this.groupingState = new GroupingState({
      rowGroupColumns: this.groupModel.rowGroupCols,
    });
    this.groupingStateUnsubscribe = this.groupingState.on(
      'groupingStateChanged',
      (e) => this.handleGroupingStateChanged(e),
    );

    // Cycle 18 / Task 3 — pivot state primitive. Seeded from the
    // `pivotMode` option (pivot/value columns are configured afterwards
    // via the imperative API / tool panels). Every pivot UI mutates this
    // object; `handlePivotStateChanged` syncs the worker + repaints.
    this.pivotState = new PivotState({ pivotMode: options.pivotMode === true });
    this.pivotStateUnsubscribe = this.pivotState.on(
      'pivotStateChanged',
      (e) => this.handlePivotStateChanged(e),
    );

    const rgShow = normalizeRowGroupPanelShow(options.rowGroupPanelShow);
    if (rgShow !== null) {
      const ctx: RowGroupPanelGridContext = this.makeRowGroupPanelContext();
      this.rowGroupPanel = new RowGroupPanelHost(
        this.root,
        ctx,
        rgShow,
        this.groupingState.getRowGroupColumns(),
        this.groupingState.getPerLevelSort(),
        { suppressSort: options.rowGroupPanelSuppressSort === true },
      );
      // Initial top offset = status bar's top inset (zero when no top
      // status bar). The panel's own `style.top` is updated whenever
      // the top status bar's inset changes.
      this.setRowGroupPanelTop(this.statusBarInsets.top);
    }

    // Cycle 18 / Task 6 — pivot panel host (top-of-grid drop strip
    // ABOVE the row group panel + column headers; pivot wraps the row
    // dimension). Constructed AFTER the row group panel so visibility
    // reservations land in the right order: row group panel reserves
    // first, pivot panel reserves on top of that.
    const ppShow = normalizePivotPanelShow(options.pivotPanelShow);
    if (ppShow !== null) {
      const ctx: PivotPanelGridContext = this.makePivotPanelContext();
      this.pivotPanel = new PivotPanelHost(
        this.root,
        ctx,
        ppShow,
        this.pivotState.getPivotColumns(),
      );
      this.setPivotPanelTop(this.statusBarInsets.top);
    }

    // 8. Hit-test + input
    this.hitTester = new HitTester(
      () => this.viewport,
      () => this.theme.headerHeight,
      () => this.theme.resizerHotZone,
    );
    this.featureChain = new FeatureChain({
      canvas: this.cgridCanvas,
      selection: this.selection,
      hitTester: this.hitTester,
      visibleRowIndices: () => this.viewport.visibleRows
        .filter((r) => r.subgrid.isData)
        .map((r) => r.localRowIndex),
      allColIds: () => this.allColIdsInRenderOrder(),
      totalRowCount: () => this.rowCount,
      resizeColumn: (colId, dx) => this.resizeColumn(colId, dx),
      finishColumnResize: (colId) => this.finishColumnResize(colId),
      reorderColumn: (colId, toIndex, source) => this.reorderColumn(colId, toIndex, source),
      getColDef: (colId) => {
        const def = this.columnDefsMap.get(colId);
        return def
          ? { suppressMovable: def.suppressMovable, lockPosition: def.lockPosition }
          : undefined;
      },
      columnLeftOf: (colId) => {
        const col = this.viewport.visibleColumns.find((c) => c.colId === colId);
        return col ? col.left : null;
      },
      columnWidthOf: (colId) => {
        const col = this.viewport.visibleColumns.find((c) => c.colId === colId);
        return col ? col.width : null;
      },
      getOverlayHost: () => this.editorContainer,
      getHeaderName: (colId) => this.columnDefsMap.get(colId)?.headerName,
      getLeafHeaderHeight: () => this.options.headerHeight ?? this.theme.headerHeight,
      getLeafHeaderTop: () => {
        const leaf = this.viewport.visibleRows.find(
          (r) => !r.subgrid.isData && !('getGroupIdAt' in r.subgrid),
        );
        return leaf ? leaf.top : 0;
      },
      cycleSort: (colId, opts) => this.cycleSort(colId, opts),
      selectColumn: (colId, opts) => this.selectColumn(colId, opts),
      // Cycle 9 / Task 6 — read at event time so runtime
      // `setGridOption('cellSelection', …)` takes effect on the next
      // mousedown without re-wiring the feature chain.
      getCellSelectionOptions: () => this.options.cellSelection,
      // Cycle 9 / Task 5 — fill-handle plumbing. Read the option at event
      // time (not constructor time) so runtime setGridOption flips work
      // without re-wiring the feature chain.
      getEnableFillHandle: () => this.options.enableFillHandle === true,
      getFillHandleDirection: () => this.options.fillHandleDirection ?? 'y',
      getRangeBottomRight: (range) => this.getRangeBottomRight(range),
      commitFill: (source, target) => this.commitFill(source, target),
      emitRangeSelectionChanged: (started, finished) =>
        this.emitRangeSelectionChanged(started, finished),
      getMultiSortKey: () => this.options.multiSortKey === null
        ? null
        : (this.options.multiSortKey ?? 'Shift'),
      toggleColumnGroup: (groupId) => this.toggleColumnGroup(groupId),
      canToggleColumnGroup: (groupId) => this.canToggleColumnGroup(groupId),
      scrollBy: (dx, dy) => this.scroller.scrollBy({ left: dx, top: dy, behavior: 'auto' }),
      // Cycle 9 patch / Task 2 — body rectangle for RangeSelection's edge-zone
      // auto-scroll math. Read at event time so a container resize between
      // drag ticks lands on the next compute.
      getBodyRect: () => ({
        left: this.viewport.bodyLeft,
        right: this.viewport.bodyRight,
        top: this.viewport.bodyTop,
        bottom: this.viewport.bodyBottom,
      }),
      emitCellClicked: (rowIndex, colId, mouse) => {
        const rowId = this.rowIdAt(rowIndex);
        if (rowId) this.events.emit({ type: 'cellClicked', rowId, colId, value: this.cellAt(rowIndex, colId)?.value, mouse });
      },
      // Task 4: the editor-open dispatch moved to the new EditTrigger
      // feature. emitCellDoubleClicked now only emits the lifecycle event
      // so single-vs-double-click + suppressClickEdit gates can live in
      // one place.
      emitCellDoubleClicked: (rowIndex, colId, mouse) => {
        const rowId = this.rowIdAt(rowIndex);
        if (rowId) this.events.emit({ type: 'cellDoubleClicked', rowId, colId, value: this.cellAt(rowIndex, colId)?.value, mouse });
      },
      // Cycle 23 / Task 2 — hover-transition event hooks. Each fires
      // only when the OnHover feature detects a true boundary
      // crossing. The grid resolves rowIndex → rowId + reads the cell
      // value before dispatching so subscribers receive the same
      // (rowId, colId, value) shape as cellClicked.
      emitCellMouseOver: (rowIndex, colId, mouse) =>
        this.emitCellMouseOverFromHover(rowIndex, colId, mouse),
      emitCellMouseOut: (rowIndex, colId, mouse) =>
        this.emitCellMouseOutFromHover(rowIndex, colId, mouse),
      emitRowMouseOver: (rowIndex, mouse) =>
        this.emitRowMouseOverFromHover(rowIndex, mouse),
      emitRowMouseOut: (rowIndex, mouse) =>
        this.emitRowMouseOutFromHover(rowIndex, mouse),
      // Cycle 23 / Task 4 — cell keyboard events. The CellKeyboardEvents
      // feature sits at the HEAD of the chain; it returns the
      // `event.defaultPrevented` flag back upstream so the chain can
      // short-circuit when an app listener consumed the key.
      emitCellKeyDown: (rowIndex, colId, event) => {
        const rowId = this.rowIdAt(rowIndex);
        if (!rowId) return false;
        this.events.emit({
          type: 'cellKeyDown', rowId, colId,
          value: this.cellAt(rowIndex, colId)?.value, event,
        });
        return event.defaultPrevented;
      },
      emitCellKeyPress: (rowIndex, colId, event) => {
        const rowId = this.rowIdAt(rowIndex);
        if (!rowId) return false;
        this.events.emit({
          type: 'cellKeyPress', rowId, colId,
          value: this.cellAt(rowIndex, colId)?.value, event,
        });
        return event.defaultPrevented;
      },
      // Cycle 24 / Task 1 — Ctrl+A select-all entry point.
      selectAllRows: () => this.selectAll(),
      // Conventional / ag-grid parity — Delete + Ctrl+D entry points.
      clearSelectedCells: () => this.clearSelectedCells(),
      fillDown: () => this.fillDown(),
      // Row-select checkbox column hooks. Read at event time so a
      // runtime `updateGridOptions({ columnDefs })` swap lights up
      // on the next click without re-wiring the feature chain.
      isCheckboxSelectionColumn: (colId) =>
        this.columnDefsMap.get(colId)?.checkboxSelection === true,
      isHeaderCheckboxSelectionColumn: (colId) =>
        this.columnDefsMap.get(colId)?.headerCheckboxSelection === true,
      toggleHeaderCheckbox: (colId) => this.toggleHeaderCheckbox(colId),
      isRowClickSelectionSuppressed: () => this.options.suppressRowClickSelection === true,
      isRowMultiSelectWithClick: () => this.options.rowMultiSelectWithClick === true,
      // Cycle 24 / Task 6 — focus exit callbacks. Read at event time
      // so a runtime `setGridOption('tabToNextHeader', …)` flip
      // lights up on the next Tab press.
      getTabToNextHeader: () => this.options.tabToNextHeader,
      getTabToPreviousHeader: () => this.options.tabToPreviousHeader,
      getEditingFlags: () => ({
        singleClickEdit: this.options.singleClickEdit ?? false,
        suppressClickEdit: this.options.suppressClickEdit ?? false,
        enterNavigatesVertically: this.options.enterNavigatesVertically ?? false,
        enterNavigatesVerticallyAfterEdit: this.options.enterNavigatesVerticallyAfterEdit ?? false,
        suppressStartEditOnTab: this.options.suppressStartEditOnTab ?? false,
        enableCellEditingOnBackspace: this.options.enableCellEditingOnBackspace ?? false,
        enableExcelEditing: this.options.enableExcelEditing ?? false,
      }),
      isCellEditable: (rowIndex, colId) => this.isCellEditable(rowIndex, colId),
      isColSingleClickEdit: (colId) => this.columnDefsMap.get(colId)?.singleClickEdit,
      getColSuppressKeyboardEvent: (colId) => {
        const def = this.columnDefsMap.get(colId);
        return def?.suppressKeyboardEvent as ((p: {
          event: KeyboardEvent; editing: boolean; data: unknown; colId: string;
        }) => boolean) | undefined;
      },
      getRowDataAt: (rowIndex) => this.rowDataSnapshotAt(rowIndex),
      isEditing: () => this.isAnyEditOpen(),
      openEditor: (rowIndex, colId, charPress, mode) => this.openEditor(rowIndex, colId, charPress ?? null, mode ?? 'edit'),
      stopEditing: (cancel) => this.stopEditing(cancel),
      nextEditableCell: (rowIndex, colId, dir) => this.nextEditableCell(rowIndex, colId, dir),
      // Cycle 10 / Task 1 — context-menu surface. RightClick resolves items
      // here at event time (so a runtime setGridOption flip takes effect on
      // the next right-click) and routes mount/close through the host.
      resolveContextMenuItems: (hit) => this.resolveContextMenuItems(hit),
      openContextMenu: (items, x, y, hit) => this.openContextMenu(items, x, y, hit),
      closeContextMenu: () => this.closeContextMenu(),
      // Cycle 10 / Task 3 — clipboard copy. The KeyboardShortcuts feature
      // routes Ctrl+C through this method so the worker round-trip + the
      // `navigator.clipboard.writeText` both run inside the keydown's
      // user-gesture stack.
      copySelectedRangesToClipboard: () => this.copySelectedRangesToClipboard(),
      // Cycle 10 / Task 4 — clipboard paste. Ctrl+V calls into this
      // method inside the keydown so `navigator.clipboard.readText`
      // sees the active gesture; the worker parse + the
      // `applyTransaction` commit happen after but are still rooted
      // in the same gesture.
      pasteFromClipboard: () => this.pasteFromClipboard(),
      // Cycle 10 / Task 5 — clipboard cut. Same gesture-stack reasoning
      // as copy: the writeText fires inside the keydown handler before
      // the clear `applyTransaction` follows.
      cutSelectedRanges: () => this.cutSelectedRanges(),
      // Cycle 10 / Task 6 — suppression gates. Each is read at event /
      // call time so a runtime `setGridOption` flip lights up on the
      // next right-click / Ctrl+C / clipboard call without re-wiring.
      isContextMenuSuppressed: () => this.options.suppressContextMenu === true,
      isClipboardApiSuppressed: () => this.options.suppressClipboardApi === true,
      isClipboardPasteSuppressed: () => this.options.suppressClipboardPaste === true,
      // Cycle 15 / Task 6 — row group panel drop target. The drag
      // feature dispatches hover + drop through these so the panel
      // can paint its own outline + insertion line.
      isPointInRowGroupPanel: (x, y) => this.rowGroupPanel?.isPointInPanel(x, y) === true,
      setRowGroupPanelDragHover: (colId, x, y) => {
        this.rowGroupPanel?.setDragHover(colId, x, y);
      },
      commitRowGroupPanelDrop: (colId) => this.rowGroupPanel?.handleColumnDrop(colId) ?? false,
      // Cycle 18 / Task 6 — pivot panel drop target. The column drag
      // feature dispatches hover + drop through these so the pivot
      // panel can paint its outline + insertion line.
      isPointInPivotPanel: (x, y) => this.pivotPanel?.isPointInPanel(x, y) === true,
      setPivotPanelDragHover: (colId, x, y) => {
        this.pivotPanel?.setDragHover(colId, x, y);
      },
      commitPivotPanelDrop: (colId) => this.pivotPanel?.handleColumnDrop(colId) ?? false,
      // Cycle 15 / Task 7 — chevron hit-test + toggle. The grid owns
      // both because (a) hit geometry requires column bounds + chunk
      // group fields the feature shouldn't reach into, and (b) the
      // toggle path needs to fire the `rowGroupOpened` event with
      // `source: 'ui'` distinct from imperative API toggles.
      hitTestGroupChevron: (x, y) => this.hitTestGroupChevron(x, y),
      hitTestStickyChevron: (x, y) => this.hitTestStickyChevron(x, y),
      toggleGroupExpanded: (key) => this.toggleGroupExpandedFromUi(key),
      // Cycle 15 / Task 8 — tri-state checkbox hit-test + cascade
      // toggle. Same geometry-on-grid / feature-stays-thin split as
      // the chevron path above.
      hitTestGroupCheckbox: (x, y) => this.computeCheckboxHit(x, y),
      toggleGroupChildrenSelected: (key, selected) =>
        this.cascadeGroupSelectionFromUi(key, selected),
      autoSizeColumn: (colId) => this.autoSizeColumns([colId]),
      getGroupKeyAtRow: (rowIndex) => this.getGroupKeyAtRow(rowIndex),
      isGroupRow: (rowIndex) => this.isGroupRow(rowIndex),
      isGroupExpanded: (groupKey) => this.isGroupExpanded(groupKey),
      // Cycle 21 / Task 3 — sparkline-tooltip lookup. Returns the cell
      // data array only when the column's resolved cellRenderer is
      // `'sparkline'`; null otherwise (non-sparkline column, off-screen
      // row, or value not an array). The SparklineTooltip feature uses
      // null as the "hide" signal so this stays the one consolidated
      // gate for whether the overlay is active at all.
      getSparklineData: (rowIndex, colId) => {
        const def = this.columnDefsMap.get(colId);
        if (!def || def.cellRenderer !== 'sparkline') return null;
        const cell = this.cellAt(rowIndex, colId);
        // Reuse the painter's coercion so the tooltip + the canvas
        // paint agree on what counts as a usable sparkline value
        // (covers both raw arrays and CSV-stringified arrays shipped
        // through the worker's text-column path).
        return coerceToNumberArray(cell?.value);
      },
    });
    this.cellEditorRegistry = new CellEditorRegistry();
    CellEditorRegistry.seed(this.cellEditorRegistry);
    this.editor = new EditorOverlay(this.editorContainer, this.cellEditorRegistry);
    this.rowEdit = new RowEditCoordinator(this.editorContainer, this.cellEditorRegistry);
    // Cycle 7 / Task 1 — floating-filter overlay shares the editorContainer
    // host so its pooled `<input>` elements stack above the canvas and pick
    // up the same pointer-events:auto/none gating the editor uses. The
    // overlay's per-column `setColumnFilterModel` callback routes through
    // `this.setColumnFilterModel`, which updates `columnFilterModels` and
    // fans the full model out to the worker.
    this.floatingFilterOverlay = new FloatingFilterOverlay(this.editorContainer, {
      getColumnFilterModel: (colId) => this.getColumnFilterModel(colId),
      setColumnFilterModel: (colId, model) => this.setColumnFilterModel(colId, model),
      getColDef: (colId) => {
        const def = this.columnDefsMap.get(colId);
        return def ? {
          floatingFilter: def.floatingFilter,
          filter: def.filter,
          cellDataType: def.cellDataType,
          suppressFloatingFilterButton: def.suppressFloatingFilterButton,
        } : undefined;
      },
      openColumnFilter: (colId) => this.showColumnFilter(colId),
      getRowTop: () => this.viewport.floatingFilterRowTop ?? 0,
      getRowHeight: () => this.viewport.floatingFilterRowHeight ?? (this.options.floatingFilterHeight ?? 28),
    });
    // Cycle 7 / Task 3 — per-column filter popup orchestration. Mounts
    // into the editor overlay container (same stacking context as the
    // editor and the floating-filter overlay). Owns its own PopupHost so
    // the editor's popup-editor mode and the filter popup can coexist
    // without fighting over a shared host slot.
    this.filterPopupHost = new FilterPopupHost(
      this.editorContainer,
      new PopupHost(this.editorContainer),
    );
    // Cycle 10 / Task 1 — context menu portal. Mounts onto the editor
    // overlay container so menus stack above the canvas + share the
    // same DOM host as the editor and filter popup.
    this.contextMenuHost = new ContextMenuHost(this.editorContainer);

    // Cycle 4 / Task 11 (cell-flash patch) — FlashRegistry tracks
    // active cell-flash animations. Deps are live-read closures so
    // `setGridOption('enableCellChangeFlash', N)` / `cellFlashDuration` /
    // `cellFadeDuration` flow through immediately. `requestRepaint` is
    // wired so the rAF tick keeps re-painting while flashes are
    // active. `prefers-reduced-motion: reduce` is watched via
    // matchMedia so the opt-out flips live.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.reducedMotionQuery.matches;
      this.reducedMotionQuery.addEventListener('change', (e) => {
        this.reducedMotion = e.matches;
      });
    }
    this.flashRegistry = new FlashRegistry({
      getEnabled: () => this.options.enableCellChangeFlash === true,
      getFlashDuration: () => this.options.cellFlashDuration ?? 500,
      getFadeDuration: () => this.options.cellFadeDuration ?? 1000,
      getReducedMotion: () => this.reducedMotion,
      requestRepaint: () => this.cgridCanvas?.requestRepaint(),
    });

    this.a11y = new A11yOverlay(this.root);
    // Cycle 24 / Task 3 — push the initial aria-label + aria-busy
    // immediately so screen readers see the correct grid name and
    // load state before the first focus-driven `updateA11y` runs.
    this.a11y.update({
      visibleRowCount: 0,
      columnCount: 0,
      focusedRowIndex: null,
      focusedColId: null,
      focusedRowData: [],
      groupExpanded: null,
      ariaLabel: options.ariaLabel,
      ariaBusy: options.loading === true,
    });
    // Cycle 24 / Task 4 — wire screen-reader announcements. The a11y
    // overlay holds the role="status" aria-live region; we subscribe
    // here to state-affecting events and turn each into human-
    // readable text. Debounced 250ms inside the overlay so a cascade
    // (e.g. setState restoring 5 keys) lands as ONE announcement.
    this.wireA11yAnnouncements();

    // 9. Worker
    // Foundation: use options.worker.url for test injection; otherwise resolve the co-emitted worker.js
    // via new URL() so bundlers (Vite library mode) emit a proper static asset reference rather than
    // inlining raw TypeScript as a data: URL (which browsers reject).
    const workerUrl = options.worker?.url ?? new URL('./worker.js', import.meta.url).toString();
    const worker = new Worker(workerUrl as unknown as URL, { type: 'module' });
    this.workerClient = new WorkerClient(worker as unknown as import('./worker/client').WorkerLike, {
      onModelUpdated: (visibleCount, groupKeys) => {
        this.rowCount = visibleCount;
        // Cycle 15 / Task 7 — keep the main-side mirror in lockstep
        // with the worker's tree across transactions that add or
        // remove group keys (e.g. a new ticker entered the dataset).
        // The worker only ships this when grouping is active.
        if (groupKeys !== undefined) this.knownGroupKeys = groupKeys;
        // Cycle 15 / Task 8 — descendants may have shifted (new rows
        // in a group, removed rows, new groups). The push doesn't
        // ship them; refresh the cache via a follow-up
        // `setEmitGroupDescendants(true)` round-trip when the feature
        // is active. Cheap when the descendants haven't actually
        // changed — the worker just re-serialises the same arrays.
        if (
          groupKeys !== undefined
          && groupKeys.length > 0
          && this.selection.isGroupSelectsChildren()
        ) {
          this.refreshGroupDescendantsCache();
        }
        // Row order may have shifted (sort, filter, transaction add/remove) —
        // per-row heights live with row identity, not slot. Drop the index
        // and let the next chunk rebuild it (Cycle 5 / Task 7). The viewport
        // falls back to uniform-height math for the single frame before the
        // chunk lands.
        this.rowHeightIndex = null;
        this.recomputeViewport();
        // Re-resolve persistent selection ids against the freshly-sorted /
        // filtered visible order. Without this, indices set by
        // `setSelectedRowIds` and `setFocusedCell` would point at the wrong
        // rows the moment the user sorts.
        this.rebuildSelectionFromPersistentIds();
        this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
        // Cycle 14 / Task 6 — the worker pushes `modelUpdated` only after
        // a transaction flush (sync or async). The visible set + totals
        // both reflect the underlying data mutation, so tag the resulting
        // aggregation event as `rowDataChanged`.
        this.requestViewport('rowDataChanged');
      },
      onAsyncTransactionsFlushed: (results) => {
        this.events.emit({ type: 'asyncTransactionsFlushed', results });
      },
      onHeightsChanged: (rowIds, heights) => this.onHeightsChanged(rowIds, heights),
      onMeasureTextRequest: (batchId, items) => this.onMeasureTextRequest(batchId, items),
      // Cycle 7 / Task 8 — worker pushed the candidate rowIds (post
      // column + quick filters, minus alwaysPass rows) up for main-side
      // `doesExternalFilterPass` evaluation. Run the predicate against
      // the cached row data and reply with the surviving subset.
      onExternalFilterCandidates: (rowIds, callId) => this.runExternalFilterCandidates(rowIds, callId),
      // Cycle 8 / Task 4 — worker pushed the post-SortPass rowId order
      // up for main-side `postSortRows` evaluation. Run the hook against
      // the cached row data and reply with the (possibly re-ordered)
      // array.
      onPostSortRowsCandidates: (rowIds, callId) => this.runPostSortRowsCandidates(rowIds, callId),
      onError: (msg) => console.error('[cgrid] worker error:', msg),
    });

    this.workerClient.init({
      rowIdField: inferRowIdField(options.getRowId),
      columns: this.workerColumns(),
      rowHeight: this.options.rowHeight ?? this.theme.rowHeight,
      // Cycle 4 / Task 11 — forward the cell-flash flag at init time so
      // the very first setRowData → applyTransaction sequence ships
      // diffs to main. Runtime mutation via `setGridOption('enableCellChangeFlash', N)`
      // flows through `setEnableCellChangeFlash` later.
      enableCellChangeFlash: this.options.enableCellChangeFlash === true,
      // Cycle 15 / Task 9 — forward the default-expansion rule so the
      // first `setGroupModel` reply re-seeds `state.expandedKeys` from
      // the option (and ships back the materialised set). Initial-only
      // options — runtime mutation is rejected by `runtimeOptions.ts`;
      // app code uses `setExpanded` / `expandAll` / `collapseAll` after
      // construction.
      groupDefaultExpanded: this.options.groupDefaultExpanded,
      groupDefaultExpandedKeys: this.options.groupDefaultExpandedKeys,
      // Cycle 15 / Task 10 — forward the elision + opened-group flags
      // so the very first `setGroupModel` reply / `getViewport` honor
      // them. Init-only — `runtimeOptions.ts` rejects post-construction
      // mutation; apps reset by rebuilding the grid.
      groupRemoveSingleChildren: this.options.groupRemoveSingleChildren,
      showOpenedGroup: this.options.showOpenedGroup,
      // Cycle 15 / Task 12 — forward the group-footer flags so the
      // first `setGroupModel` produces flatOrder entries with footers
      // AND the first `getViewport` reply ships `chunk.groupTotals`.
      // Init-only this cycle.
      // Cycle 15.5 / Task 8 — `groupTotalRow`/`grandTotalRow` are the
      // AG Grid 35 aliases. Either form activates footer rows in the worker;
      // the position ('top' vs 'bottom') is a renderer concern and is
      // preserved in the options for the paint path to read.
      groupIncludeFooter:
        this.options.groupIncludeFooter
        ?? (this.options.groupTotalRow != null ? true : undefined),
      groupIncludeTotalFooter:
        this.options.groupIncludeTotalFooter
        ?? (this.options.grandTotalRow != null ? true : undefined),
      groupHideOpenParents: this.options.groupHideOpenParents,
    }).then(async () => {
      // Cycle 7 / Task 8 — register the external-filter round-trip BEFORE
      // gridReady fires so the first setRowData runs against a worker
      // whose flag matches the app's current intent. Only push when the
      // predicate currently returns true — flagging it on for a
      // toggle-style filter that's off would force every pipeline pass
      // through a no-op round-trip. The setting flips later via
      // `onFilterChanged('externalFilter')` once the app toggles state.
      const initialPresent = this.options.isExternalFilterPresent?.() === true;
      if (initialPresent) {
        await this.workerClient.setExternalFilterPresent(true).catch(() => {});
      }
      // Cycle 8 / Task 2 — push the construction-time sort model to the
      // worker BEFORE the first setRowData so the very first paint is
      // already sorted. When the model is empty (no `initialSort` on any
      // column) the round-trip is skipped entirely.
      if (this.sortModel.length > 0) {
        await this.workerClient.setSortModel(this.sortModel).catch(() => {});
      }
      // Cycle 8 / Task 4 — when `postSortRows` is configured, register
      // the round-trip BEFORE the first setRowData so the very first
      // visible-build runs the hook. Skipped when the option is absent;
      // the worker's pipeline then runs end-to-end with zero overhead.
      if (typeof this.options.postSortRows === 'function') {
        await this.workerClient.setPostSortRowsPresent(true).catch(() => {});
      }
      // Cycle 14 / Task 3 — push the construction-time aggFuncs map to
      // the worker BEFORE the first setRowData so the very first
      // viewport reply carries totals computed against the custom
      // registry. Closure detection runs inside `forwardAggFuncs` so a
      // broken function rejects at constructor time. Skipped when the
      // option is absent / empty — the built-in registry is enough for
      // standard sum / avg / min / max / count / first / last columns.
      if (this.options.aggFuncs && Object.keys(this.options.aggFuncs).length > 0) {
        this.forwardAggFuncs(this.options.aggFuncs);
      }
      // Cycle 18 / Task 8a — push the construction-time pivot cap to the
      // worker BEFORE the first getViewport so the very first pivot run
      // honors the cap. Absent option leaves the worker on its default
      // (5000). Fire-and-forget — the reply rides the existing rowCount
      // channel and the cap doesn't move rows.
      if (this.options.pivotMaxGeneratedColumns !== undefined) {
        this.workerClient
          .setPivotMaxGeneratedColumns(this.options.pivotMaxGeneratedColumns)
          .catch((err) => {
            if (!this.destroyed) console.error('[cgrid] setPivotMaxGeneratedColumns:', err);
          });
      }
      // Cycle 18 / Task 8c — flip the worker's PivotPass to the
      // AG-parity "append new keys at the end" default UNLESS the app
      // opts back into strict alphanumeric ordering. The PivotPass
      // constructor still defaults to `strict=true` to preserve the
      // legacy single-test behaviour for the standalone engine; cgrid
      // ALWAYS forwards the resolved flag so the boundary is
      // unambiguous.
      this.workerClient
        .setStrictPivotColumnOrder(this.options.enableStrictPivotColumnOrder === true)
        .catch((err) => {
          if (!this.destroyed) console.error('[cgrid] setStrictPivotColumnOrder:', err);
        });
      // Cycle 15 / Task 8 — when `groupSelectsChildren: true` is set
      // at construction, register the SelectionModel's membership
      // resolver AND flip the worker's per-snapshot descendant
      // emission BEFORE the first setRowData so the first paint after
      // grouping is applied has the cascade machinery in place.
      // Runtime swaps route through `applyGroupSelectsChildren`.
      if (this.options.groupSelectsChildren === true) {
        await this.applyGroupSelectsChildren(true);
      }
      // Cycle 15.5 / Task 5 — `groupSelects` option wires the new 3-mode
      // API on top of the Task 8 descendants machinery. 'self' requires no
      // membership resolver; 'descendants' / 'filteredDescendants' forward
      // to the existing applyGroupSelectsChildren path for the worker side.
      const groupSelectsOpt = this.options.groupSelects;
      if (groupSelectsOpt && groupSelectsOpt !== 'descendants') {
        // 'self' or 'filteredDescendants' — only selectionModel side; no
        // worker-side membership emission needed for 'self'.
        this.selection.setGroupSelects(groupSelectsOpt, null);
      } else if (groupSelectsOpt === 'descendants' && this.options.groupSelectsChildren !== true) {
        // Explicit 'descendants' without the legacy bool — forward to the
        // same path as groupSelectsChildren: true.
        await this.applyGroupSelectsChildren(true);
        this.selection.setGroupSelects('descendants', null);
      }
      this.events.emit({ type: 'gridReady', api: this.makeApi() });
      if (options.rowData) this.setRowData(options.rowData);
      // Cycle 23 / Task 6 — apply an initial-state snapshot AFTER the
      // grid is ready (so column tree, pivot state, selection model
      // are all live) but BEFORE the first user interaction. Bundles
      // the same plumbing as `setState` so columnState → filter →
      // sort → groups → pivot → expanded → selection → scroll
      // applies in dependency order.
      if (options.initialState) {
        // Cycle 23 / Task 7 — tag the cascade so the resulting
        // stateUpdated event reads source: 'init', not 'ui'.
        this.stateUpdatedBus?.setNextSource('init');
        this.setState(options.initialState);
      }
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });

    // 10. Native scroll listener
    this.scroller.addEventListener('scroll', () => {
      this.onScrollerScroll(this.scroller.scrollLeft, this.scroller.scrollTop);
    });

    // stopEditingWhenCellsLoseFocus — commit the open editor when focus
    // leaves the grid root. Uses focusout (which bubbles, unlike blur) so a
    // shift from the canvas to e.g. the document body still fires. The
    // relatedTarget check keeps the editor open while focus moves between
    // the canvas and the editor's own DOM (or between popup DOM and canvas).
    if (this.options.stopEditingWhenCellsLoseFocus) {
      this.root.addEventListener('focusout', (ev) => {
        if (!this.isAnyEditOpen()) return;
        const next = (ev as FocusEvent).relatedTarget as Node | null;
        if (next && this.root.contains(next)) return;
        this.stopEditing(false);
      });
    }

    // Edit-mode keyboard matrix (Task 4 + Task 5). Root capture-phase
    // listener because the editor's <input>/<select>/<textarea> has focus
    // while editing — KeyPaging fires on the canvas and never sees these
    // keys.
    // - Escape: cancel
    // - Enter: commit (+ optional descend per enterNavigatesVerticallyAfterEdit)
    // - Tab: commit + advance to next editable cell (unless suppressStartEditOnTab)
    // - Excel mode + activeEdit.mode === 'enter' + Arrow*: commit + move focus
    //   to the adjacent cell. Otherwise arrow keys fall through to the input's
    //   native caret-move handler.
    // We capture-and-stopPropagation so the per-editor Enter/Esc handlers
    // can't double-fire on the same keypress.
    this.root.addEventListener('keydown', (raw) => {
      const ev = raw as KeyboardEvent;
      // Full-row edit (Cycle 5 / Task 10) — keys are scoped to the row's
      // editor bundle: Tab cycles within the row, Enter commits all, Esc
      // cancels all. Single-cell key flow below is intentionally bypassed.
      if (this.rowEdit.isOpen()) {
        if (ev.key === 'Escape') {
          ev.preventDefault(); ev.stopPropagation();
          this.rowEdit.cancel();
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault(); ev.stopPropagation();
          this.rowEdit.commit();
          return;
        }
        if (ev.key === 'Tab') {
          ev.preventDefault(); ev.stopPropagation();
          this.rowEdit.focusNext(ev.shiftKey ? -1 : 1);
          const newCol = this.rowEdit.getActiveColId();
          const newRow = this.rowEdit.getRowIndex();
          if (newCol != null && newRow != null) this.selection.setFocus(newRow, newCol);
          return;
        }
        return;
      }
      if (!this.editor.isOpen()) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.stopEditing(true);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        const fr = this.selection.state.focusedRowIndex;
        const fc = this.selection.state.focusedColId;
        this.stopEditing(false);
        if (this.options.enterNavigatesVerticallyAfterEdit && fr != null && fc != null) {
          const dir = ev.shiftKey ? -1 : 1;
          this.selection.setFocus(
            Math.max(0, Math.min(Math.max(0, this.rowCount - 1), fr + dir)),
            fc,
          );
        }
        return;
      }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        ev.stopPropagation();
        const fr = this.selection.state.focusedRowIndex;
        const fc = this.selection.state.focusedColId;
        this.stopEditing(false);
        if (fr != null && fc != null) {
          const dir = ev.shiftKey ? 'backward' : 'forward';
          const next = this.nextEditableCell(fr, fc, dir);
          if (next) {
            this.selection.setFocus(next.rowIndex, next.colId);
            if (!this.options.suppressStartEditOnTab) {
              this.openEditor(next.rowIndex, next.colId, null, 'edit');
            }
          }
        }
        return;
      }
      // Excel-mode arrow commits — only fire when both the grid flag and the
      // active edit's mode opt in. The default 'edit' mode (F2 / dblclick /
      // single-click / API) keeps arrow keys for caret-move inside the input.
      if (
        this.options.enableExcelEditing
        && this.activeEdit?.mode === 'enter'
        && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp'
            || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        const fr = this.selection.state.focusedRowIndex;
        const fc = this.selection.state.focusedColId;
        this.stopEditing(false);
        if (fr == null || fc == null) return;
        const cols = this.columnOrder.map((c) => c.colId);
        const ci = cols.indexOf(fc);
        if (ev.key === 'ArrowDown') {
          this.selection.setFocus(Math.min(this.rowCount - 1, fr + 1), fc);
        } else if (ev.key === 'ArrowUp') {
          this.selection.setFocus(Math.max(0, fr - 1), fc);
        } else if (ev.key === 'ArrowRight' && ci >= 0) {
          this.selection.setFocus(fr, cols[Math.min(cols.length - 1, ci + 1)]!);
        } else if (ev.key === 'ArrowLeft' && ci >= 0) {
          this.selection.setFocus(fr, cols[Math.max(0, ci - 1)]!);
        }
      }
    }, true);

    // Excel-mode mousedown flip: a click inside the open editor switches
    // a type-started 'enter' edit into 'edit' mode so the user can move the
    // caret with the arrow keys instead of accidentally committing.
    this.editorContainer.addEventListener('mousedown', () => {
      if (this.activeEdit?.mode === 'enter') {
        this.activeEdit.mode = 'edit';
      }
    });

    // Subscribe to group state changes — recompute visible columns, repaint,
    // and surface both the per-group event and the broader displayed-columns
    // signal. Done before selection wiring so the first paint sees the right
    // column set even if openByDefault flipped any leaves below.
    //
    // Cycle 18 / Task 4 — scrollLeft is intentionally PRESERVED across
    // pivot column-group toggles (and any other column-group toggle).
    // This mirrors the row-group scrollTop-preservation invariant: the
    // user's view anchor in the surviving columns stays put. The native
    // scroller may auto-clamp scrollLeft when the new column set is
    // narrower than the cursor's current position (`maxScrollLeft`
    // shrinks), but that's a one-sided clamp — never an unsolicited
    // reset to 0.
    //
    // The subscription is wrapped in a helper so `applyPivotColumns` /
    // `revertPivotColumns` can re-subscribe whenever the
    // `ColumnGroupState` instance is swapped — otherwise the new state
    // would have no listener and pivot column-group toggles would be
    // silent no-ops (Cycle 18 / Task 4 regression caught by the
    // pivotIntegration E2E).
    this.subscribeColumnGroupState();

    // 11. Selection feedback. `ensureRowIndexVisible` / `ensureColIdVisible`
    // run only when the focused cell ACTUALLY changed since the last emit —
    // not on every selection.onChange. Otherwise a range mutation that
    // leaves focus untouched (e.g. a drag tick that extends rowEnd while
    // the focused cell stays at the anchor) would re-scroll the viewport
    // back to keep the unchanged focused cell visible, fighting the
    // RangeSelection auto-scroll loop and freezing the viewport in place.
    // Keyboard nav (Arrow / Tab / Home / End / Page*) goes through
    // `setFocusAndCollapseRanges` which moves focus, so the visibility
    // ensure still fires for those paths.
    let lastFocusRow: number | null = null;
    let lastFocusCol: string | null = null;
    this.selectionUnsubscribe = this.selection.onChange((state) => {
      const focusChanged =
        state.focusedRowIndex !== lastFocusRow || state.focusedColId !== lastFocusCol;
      if (focusChanged) {
        if (state.focusedRowIndex !== null) this.ensureRowIndexVisible(state.focusedRowIndex);
        if (state.focusedColId !== null) this.ensureColIdVisible(state.focusedColId);
        lastFocusRow = state.focusedRowIndex;
        lastFocusCol = state.focusedColId;
      }
      this.cgridCanvas.requestRepaint();
      this.events.emit({ type: 'selectionChanged', selectedRowIds: this.getSelectedRowIds() });
      this.updateA11y();
    });

    // Cycle 6 / Task 2 — capture the construction-time column state so
    // `resetColumnState` can replay the as-coded layout. Snapshotted now
    // (after the initial `columnLayout` resolves) so hidden / pinned /
    // width / sort all round-trip on reset, including `initial*` field
    // defaults that propertyChain already folded into the resolved slots.
    this.initialColumnStateSnapshot = snapshotState(
      this.columnTree,
      this.columnLayout,
      this.sortModel,
    );
  }

  // --- Public API -----------------------------------------------------------
  // `on` / `off` / `addEventListener` / `removeEventListener` live further
  // down with the rest of the editor-cycle additions (Cycle 5 / Task 1).

  setRowData(rows: TRow[]): void {
    const heightsByRowId = this.resolveHeightsForRows(rows);
    // Cycle 7 / Task 8 — refresh the main-side row cache so the external
    // filter + alwaysPass predicates evaluate against current data.
    // setRowData is a full replace, so wipe the cache first.
    this.rowDataById.clear();
    for (const row of rows) {
      try { this.rowDataById.set(this.options.getRowId(row), row); } catch { /* skip bad rowId */ }
    }
    this.workerClient.setRowData(rows, heightsByRowId).then(({ visibleCount, groupKeys }) => {
      this.rowCount = visibleCount;
      // Cycle 15 / Task 7 — setRowData may have grown the set of
      // group keys (data flowing into a grouped grid for the first
      // time). The worker rides them back on the reply so the mirror
      // for `getExpandedKeys()` populates before the next UI tick.
      if (groupKeys !== undefined) this.knownGroupKeys = groupKeys;
      this.recomputeViewport();
      this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
      // Cycle 14 / Task 6 — full row-set replace re-aggregates totals;
      // tag so the `aggregationChanged` listener can correlate.
      this.requestViewport('rowDataChanged');
      // alwaysPass is computed AFTER setRowData so the worker's data
      // store and the alwaysPass set land in the same logical step. The
      // refresh triggers a second worker round-trip; that's the cost of
      // the alwaysPass feature being opt-in (it's a no-op when no
      // predicate is set).
      this.recomputeAlwaysPass();
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  applyTransaction(t: Tx<TRow>): TransactionResult {
    // Foundation: async only. For sync semantics, callers use the worker's sync path via separate cycle.
    const heightsByRowId = this.resolveHeightsForRows([...(t.add ?? []), ...(t.update ?? [])]);
    this.updateRowDataCache(t);
    this.workerClient.applyTransaction({
      add: t.add as unknown[],
      update: t.update as unknown[],
      remove: (t.remove as TRow[] | undefined)?.map((r) => this.options.getRowId(r)),
      async: false,
      heightsByRowId,
    }).then(() => this.recomputeAlwaysPass())
      .catch((err) => { if (!this.destroyed) console.error('[cgrid] applyTransaction:', err); });
    return { add: [], update: [], remove: [] };
  }

  applyTransactionAsync(t: Tx<TRow>): void {
    const heightsByRowId = this.resolveHeightsForRows([...(t.add ?? []), ...(t.update ?? [])]);
    this.updateRowDataCache(t);
    this.workerClient.applyTransaction({
      add: t.add as unknown[],
      update: t.update as unknown[],
      remove: (t.remove as TRow[] | undefined)?.map((r) => this.options.getRowId(r)),
      async: true,
      heightsByRowId,
    }).then(() => this.recomputeAlwaysPass())
      .catch((err) => { if (!this.destroyed) console.error('[cgrid] applyTransaction:', err); });
  }

  /** Cycle 7 / Task 8 — keep `rowDataById` in sync with a transaction.
   *  add / update both write the row in place; remove drops the entry.
   *  Same `getRowId` derivation the worker uses so the keys line up
   *  across the two caches. Errors in `getRowId` skip the row silently. */
  private updateRowDataCache(t: Tx<TRow>): void {
    if (t.add) {
      for (const row of t.add) {
        try { this.rowDataById.set(this.options.getRowId(row), row); } catch { /* skip */ }
      }
    }
    if (t.update) {
      for (const row of t.update) {
        try { this.rowDataById.set(this.options.getRowId(row), row); } catch { /* skip */ }
      }
    }
    if (t.remove) {
      for (const row of t.remove) {
        try { this.rowDataById.delete(this.options.getRowId(row)); } catch { /* skip */ }
      }
    }
  }

  /** Cycle 7 / Task 8 — run `options.alwaysPassFilter` against the cached
   *  row set and ship the resolved rowId list to the worker. No-op when
   *  the predicate isn't configured; the worker treats an empty set as
   *  "no alwaysPass rows" so the round-trip is essentially free in the
   *  common case. */
  private recomputeAlwaysPass(): void {
    if (this.destroyed) return;
    const predicate = this.options.alwaysPassFilter;
    if (typeof predicate !== 'function') return;
    const ids: string[] = [];
    for (const [rowId, data] of this.rowDataById) {
      try {
        if (predicate({ data, rowId })) ids.push(rowId);
      } catch { /* predicate threw — drop the row from alwaysPass */ }
    }
    this.workerClient.setAlwaysPassRowIds(ids).then(({ visibleCount }) => {
      if (this.destroyed) return;
      this.rowCount = visibleCount;
      this.recomputeViewport();
      // Cycle 14 / Task 6 — alwaysPass evaluation is part of the filter
      // pipeline; tagging as `filterChanged` so listeners can correlate.
      this.requestViewport('filterChanged');
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid] alwaysPass:', err); });
  }

  /** Cycle 7 / Task 8 — main-side reply to the worker's
   *  `externalFilterCandidates` push. Runs `options.doesExternalFilterPass`
   *  for each rowId against `rowDataById` and ships the surviving subset
   *  back. Rows missing from the cache (added via the worker only — not
   *  the supported path) drop silently. */
  private runExternalFilterCandidates(rowIds: string[], callId: number): void {
    const predicate = this.options.doesExternalFilterPass;
    if (typeof predicate !== 'function') {
      // Misconfigured: external filter was activated but no predicate
      // supplied. Pass everything through so the grid doesn't silently
      // hide every row.
      this.workerClient.externalFilterResult(callId, rowIds).catch(() => {});
      return;
    }
    const surviving: string[] = [];
    for (const rowId of rowIds) {
      const data = this.rowDataById.get(rowId);
      if (data === undefined) continue;
      try {
        if (predicate({ data, rowId })) surviving.push(rowId);
      } catch { /* predicate threw — drop the row */ }
    }
    this.workerClient.externalFilterResult(callId, surviving).catch((err) => {
      if (!this.destroyed) console.error('[cgrid] externalFilterResult:', err);
    });
  }

  /** Cycle 8 / Task 4 — main-side reply to the worker's
   *  `postSortRowsRequest` push. Runs `options.postSortRows` against the
   *  cached row map and ships the (possibly re-ordered) array back. When
   *  the hook isn't configured or throws, the original sorted order is
   *  echoed back so the worker resumes with no change. The
   *  `getData(rowId)` accessor reads from `rowDataById` so the hook can
   *  resolve full row records without ferrying the map across the
   *  worker boundary. */
  private runPostSortRowsCandidates(rowIds: string[], callId: number): void {
    const hook = this.options.postSortRows as
      | ((p: { rowIds: string[]; getData: (id: string) => TRow | undefined }) => string[])
      | undefined;
    if (typeof hook !== 'function') {
      this.workerClient.postSortRowsResult(callId, rowIds).catch(() => {});
      return;
    }
    let reordered: string[];
    try {
      const result = hook({ rowIds, getData: (id) => this.rowDataById.get(id) });
      // Guard against bad hook returns. A non-array (or one with mismatched
      // length / unknown ids) would silently corrupt the visible set —
      // fall back to the input order instead.
      if (Array.isArray(result) && result.length === rowIds.length) {
        reordered = result;
      } else {
        reordered = rowIds;
      }
    } catch (err) {
      if (!this.destroyed) console.error('[cgrid] postSortRows hook threw:', err);
      reordered = rowIds;
    }
    this.workerClient.postSortRowsResult(callId, reordered).catch((err) => {
      if (!this.destroyed) console.error('[cgrid] postSortRowsResult:', err);
    });
  }

  /** Cycle 7 / Task 8 — re-run the filter pipeline. Used after mutating
   *  any state the external-filter predicate closes over (e.g. a toolbar
   *  checkbox). Resolves the current value of
   *  `options.isExternalFilterPresent` and forwards via
   *  `setExternalFilterPresent` — that one call atomically updates the
   *  worker's flag AND triggers a refilter, with the post-pipeline
   *  visible count riding back on the reply. Stale-reply guard mirrors
   *  `applyQuickFilter` — a second `onFilterChanged` call before the
   *  first round-trip lands bumps `externalFilterReqId` and the first
   *  reply drops on arrival. */
  onFilterChanged(source: 'api' | 'quickFilter' | 'columnFilter' | 'externalFilter' = 'api'): void {
    if (!this.workerClient) return;
    // alwaysPass may close over the same state the external predicate
    // does (e.g. a toggle that flips both at once); refresh it before
    // the refilter so the worker sees a consistent set on the next pass.
    this.recomputeAlwaysPass();
    const present = this.options.isExternalFilterPresent?.() === true;
    const reqId = ++this.externalFilterReqId;
    this.workerClient.setExternalFilterPresent(present).then(({ visibleCount }) => {
      if (this.destroyed) return;
      // Drop stale survivors when a newer onFilterChanged superseded
      // this round-trip mid-flight.
      if (reqId !== this.externalFilterReqId) return;
      this.rowCount = visibleCount;
      this.rowHeightIndex = null;
      this.recomputeViewport();
      this.rebuildSelectionFromPersistentIds();
      const combined: FilterModel = {};
      for (const [id, entry] of this.columnFilterModels) combined[id] = entry;
      this.events.emit({ type: 'filterChanged', filterModel: combined, source });
      // Cycle 14 / Task 6 — filter pipeline change → totals recompute.
      this.requestViewport('filterChanged');
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid] onFilterChanged:', err); });
  }

  /** Run the user-provided `getRowHeight` callback over `rows` and collect
   *  the non-null results into a Map keyed by rowId. Returns `undefined` when
   *  no callback is configured OR the result is empty — main thread avoids
   *  shipping a noop map across the worker boundary. Errors in the callback
   *  fall back silently to the grid-level `rowHeight`. */
  private resolveHeightsForRows(rows: TRow[]): Map<string, number> | undefined {
    const cb = this.options.getRowHeight;
    if (!cb || rows.length === 0) return undefined;
    const out = new Map<string, number>();
    for (const row of rows) {
      let rowId: string;
      try { rowId = this.options.getRowId(row); } catch { continue; }
      try {
        const h = cb({ data: row, rowId, rowIndex: -1 });
        if (typeof h === 'number' && Number.isFinite(h) && h > 0) {
          out.set(rowId, h);
        }
      } catch {
        // Callback threw — leave this row without a per-row entry.
      }
    }
    return out.size === 0 ? undefined : out;
  }

  flushAsyncTransactions(): void { /* Foundation: deferred — relies on worker's setTimeout */ }

  /** Cycle 8 / Task 4 — read the active sort model. Mirrors the api
   *  object's `getSortModel` so callers that hold a CGrid reference (e.g.
   *  app-side helpers driving a toolbar button) don't need to stash the
   *  api separately. Returns a copy so callers can mutate freely. */
  getSortModel(): SortModel {
    return this.sortModel.slice();
  }

  setSortModel(s: SortModel): void {
    // Cycle 8 / Task 3 — reject inline-closure comparators at the
    // setSortModel boundary. Closures can't ride `postMessage` to the
    // worker (functions aren't structured-cloneable), so a column with
    // `comparator: (a, b) => …` would silently fall back to the default
    // text/number compare on the worker — surprising and hard to debug.
    // Throwing here points the app at `registerComparator`, which round-
    // trips a serialised function through `new Function` on the worker.
    for (const entry of s) {
      const col = this.columnDefsMap.get(entry.colId);
      if (col && typeof col.comparator === 'function') {
        throw new Error(
          `[cgrid] column '${entry.colId}' has an inline-closure comparator; ` +
          `sort runs worker-side and closures don't cross postMessage. ` +
          `Use api.registerComparator(name, fn) and set comparator: name on the col def.`,
        );
      }
    }
    this.sortModel = s;
    this.workerClient.setSortModel(s).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      // Sort reorders rows — invalidate the Fenwick index so stale per-row
      // heights aren't read at their pre-sort positions (Cycle 5 / Task 7).
      this.rowHeightIndex = null;
      this.recomputeViewport();
      // The worker doesn't push `modelUpdated` for sort changes — it only
      // replies with the new rowCount — so persistent selections need an
      // explicit rebuild here. Without this `setSelectedRowIds` /
      // `setFocusedCell` would silently paint the wrong rows after a sort.
      this.rebuildSelectionFromPersistentIds();
      this.events.emit({ type: 'sortChanged', sortModel: s });
      this.cgridCanvas.requestRepaint();
      this.requestViewport();
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  /** Cycle the sort state for a column. The cycle order is taken from
   *  `CGridOptions.sortingOrder` (default `['asc', 'desc', null]`):
   *  setting `['asc', 'desc']` skips the unsorted stage so the column is
   *  always sorted.
   *
   *  Cycle 8 / Task 1 — `opts.append` lets the caller APPEND to the
   *  existing sort model instead of replacing it. With append:
   *  - column not in the model → append `{colId, direction: nextStage}` to the tail
   *  - column already in the model → cycle its direction IN PLACE.
   *    Never reorders other entries. When the next stage is `null`, the
   *    column is dropped from the model.
   *
   *  Without append (plain click), the model is replaced wholesale — the
   *  clicked column either becomes the sole entry or the model clears,
   *  according to the next stage in `sortingOrder`. Cycle 8 / Task 2. */
  private cycleSort(colId: string, opts?: { append?: boolean }): void {
    const append = opts?.append === true;
    const order = this.options.sortingOrder ?? ['asc', 'desc', null];
    const existing = this.sortModel.find((e) => e.colId === colId);
    const currentStage: 'asc' | 'desc' | null = existing?.direction ?? null;
    const nextStage = nextSortStage(currentStage, order);
    let next: SortModel;
    if (append) {
      if (nextStage === null) {
        next = this.sortModel.filter((e) => e.colId !== colId);
      } else if (!existing) {
        next = [...this.sortModel, { colId, direction: nextStage }];
      } else {
        next = this.sortModel.map((e) =>
          e.colId === colId ? { colId, direction: nextStage } : e,
        );
      }
    } else {
      next = nextStage === null ? [] : [{ colId, direction: nextStage }];
    }
    this.setSortModel(next);
  }

  /** Cycle 9 / Task 4 — header-click column-band selection. Routes the
   *  click to `SelectionModel.selectColumnBand`, which writes a full-
   *  height rect into the ranges list. With `extend: true` (header
   *  shift-click), widens the last column band to cover every column
   *  between its current span and `colId` in render order; otherwise
   *  replaces the ranges with a single-column band. */
  private selectColumn(colId: string, opts?: { extend?: boolean }): void {
    const extend = opts?.extend === true;
    const allCols = this.columnOrder.map((c) => c.colId);
    this.selection.selectColumnBand(colId, allCols, this.rowCount, extend);
    // Cycle 9 / Task 7 — header-click column-band is an instantaneous
    // gesture, so the event pair fires with started + finished both
    // true. Skip when selectColumnBand short-circuited (rowCount 0 /
    // unknown colId) — the ranges-equal check inside the emit drops
    // the cellSelectionChanged ping in that case.
    this.emitRangeSelectionChanged(true, true);
  }

  /** Cycle 9 / Task 5 — pixel position of the bottom-right corner of
   *  `range` in canvas-local CSS px. The FillHandle feature hit-tests
   *  pointer presses against this point; the rangeOverlayPainter paints
   *  the 6×6 handle centered on it. Returns `null` when the range has
   *  no on-screen footprint (no visible data row in the row span, or no
   *  visible column whose colId is in the range). */
  private getRangeBottomRight(range: SelectionRange): { x: number; y: number } | null {
    let maxBottom = Number.NEGATIVE_INFINITY;
    for (const row of this.viewport.visibleRows) {
      if (!row.subgrid.isData) continue;
      if (row.localRowIndex < range.rowStart || row.localRowIndex > range.rowEnd) continue;
      if (row.bottom > maxBottom) maxBottom = row.bottom;
    }
    if (maxBottom === Number.NEGATIVE_INFINITY) return null;
    let maxRight = Number.NEGATIVE_INFINITY;
    for (const col of this.viewport.visibleColumns) {
      if (range.colIds.indexOf(col.colId) === -1) continue;
      if (col.right > maxRight) maxRight = col.right;
    }
    if (maxRight === Number.NEGATIVE_INFINITY) return null;
    return { x: maxRight, y: maxBottom };
  }

  /** Cycle 9 / Task 5 — fill-handle commit. Project source values onto
   *  the rows in `target` that are NOT in `source` and fire a single
   *  `applyTransaction({ update })`. The worker `RowStore.apply` REPLACES
   *  rows by id (no field-level merge), so each update row must be a full
   *  TRow object — we fetch via `getRowByIndex` (worker round-trip), mutate
   *  only the filled fields via valueSetter or direct field assignment,
   *  then commit. Linear extrapolation for numeric source values; repeat
   *  for text. Per-cell override via `options.fillOperation` — when the
   *  callback returns `false`, the default extrapolation runs for that
   *  cell. Fire-and-forget: the round-trip is awaited in the background,
   *  so the calling mouseup returns immediately. */
  private commitFill(source: SelectionRange, target: SelectionRange): void {
    if (this.destroyed) return;
    // Drop the source rect from the target rect — those rows already
    // hold the source values; we only WRITE the newly-extended cells.
    const sourceRows: number[] = [];
    for (let r = source.rowStart; r <= source.rowEnd; r++) sourceRows.push(r);
    const targetRows: number[] = [];
    for (let r = target.rowStart; r <= target.rowEnd; r++) {
      if (r < source.rowStart || r > source.rowEnd) targetRows.push(r);
    }
    if (targetRows.length === 0) return;
    // Direction picked from the geometric delta. A pure column-extend
    // (rows unchanged) commits `'right'`; otherwise `'down'`. Cycle 9
    // only ships down/right paths; up/left land alongside fillHandleDirection
    // negative deltas in a later cycle.
    const direction: 'down' | 'right' =
      target.rowEnd > source.rowEnd || target.rowStart < source.rowStart ? 'down' : 'right';
    // For each filled column, snapshot the source values once. cellAt reads
    // the visible chunk; source rows are guaranteed visible (the user just
    // dragged from them), so this is a synchronous read.
    const sourceValuesByCol = new Map<string, unknown[]>();
    for (const colId of target.colIds) {
      const values: unknown[] = [];
      for (const r of sourceRows) {
        const cell = this.cellAt(r, colId);
        values.push(cell ? cell.value : null);
      }
      sourceValuesByCol.set(colId, values);
    }
    const fillOp = this.options.fillOperation;
    // Fetch full row data for every target row in parallel. getRowByIndex
    // hits the worker, which preserves every field — the update set we
    // send back includes the unchanged fields so `RowStore.apply` doesn't
    // drop anything.
    const fetches = targetRows.map((rowIndex) =>
      this.workerClient.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
    );
    Promise.all(fetches).then((results) => {
      if (this.destroyed) return;
      const updates: TRow[] = [];
      for (let i = 0; i < results.length; i++) {
        const { rowIndex, fetched } = results[i]!;
        if (!fetched.rowId || fetched.data == null) continue;
        const rowData = fetched.data as Record<string, unknown>;
        for (const colId of target.colIds) {
          const def = this.columnDefsMap.get(colId);
          if (!def) continue;
          const sourceValues = sourceValuesByCol.get(colId) ?? [];
          const customValue = fillOp
            ? fillOp({
                values: sourceValues,
                initialValues: sourceValues,
                currentIndex: i,
                rowNode: { data: rowData as Partial<TRow>, rowIndex },
                colDef: { colId, field: def.field as string | undefined },
                direction,
              })
            : false;
          const newValue = customValue !== false
            ? customValue
            : defaultFillExtrapolate(sourceValues, i);
          // Skip undefined results — apps return `undefined` from
          // fillOperation when the cell shouldn't change.
          if (newValue === undefined) continue;
          if (def.valueSetter) {
            const field = def.field as string | undefined;
            const oldValue = field !== undefined ? rowData[field] : undefined;
            def.valueSetter({
              data: rowData as TRow, newValue, oldValue, colDef: def as any,
            });
          } else if (def.field) {
            rowData[def.field as string] = newValue;
          }
        }
        updates.push(rowData as TRow);
      }
      if (updates.length === 0) return;
      this.applyTransaction({ update: updates });
    }).catch((err) => {
      if (!this.destroyed) console.error('[cgrid] commitFill:', err);
    });
  }

  /** Cycle 8 / Task 2 — collect the construction-time sort model from
   *  every leaf's `initialSort` / `initialSortIndex`. Columns with an
   *  explicit `initialSortIndex` come first (sorted ascending by index);
   *  columns with an `initialSort` but no index trail behind in
   *  declaration order. */
  private computeInitialSortModel(): SortModel {
    const indexed: Array<{ colId: string; direction: 'asc' | 'desc'; index: number }> = [];
    const trailing: SortModel = [];
    for (const [colId, leaf] of this.columnTree.leafById) {
      const seed = leaf.initialSort;
      if (seed !== 'asc' && seed !== 'desc') continue;
      if (typeof leaf.initialSortIndex === 'number') {
        indexed.push({ colId, direction: seed, index: leaf.initialSortIndex });
      } else {
        trailing.push({ colId, direction: seed });
      }
    }
    indexed.sort((a, b) => a.index - b.index);
    return [
      ...indexed.map(({ colId, direction }) => ({ colId, direction })),
      ...trailing,
    ];
  }

  setFilterModel(f: FilterModel): void {
    // Cycle 7 / Task 1 — replacing the full filter model also resets the
    // v2 per-column map so a `setFilterModel({})` wipes any entries the
    // floating-filter overlay had set via `setColumnFilterModel`. Apps
    // calling `setFilterModel` should be passing the authoritative state.
    // Cycle 7 / Task 9 — capture the colIds that actually changed so the
    // `filterChanged` event can report them. Anything in the old map OR
    // in the incoming model that isn't byte-equal counts.
    const changedColIds = computeChangedColIds(this.columnFilterModels, f);
    this.columnFilterModels.clear();
    for (const [id, entry] of Object.entries(f)) {
      if ((entry as CFilterModelEntry & { filterType?: string }).filterType !== undefined) {
        this.columnFilterModels.set(id, entry as CFilterModelEntry);
      }
    }
    this.workerClient.setFilterModel(f).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      // Filter changes the visible row set — invalidate the Fenwick index so
      // stale per-row heights aren't read at the wrong slots (Cycle 5 /
      // Task 7).
      this.rowHeightIndex = null;
      this.recomputeViewport();
      // Same rationale as setSortModel — filter changes don't trigger a
      // `modelUpdated` push, so persistent selection indices need to be
      // rebuilt here against the freshly-filtered visible order.
      this.rebuildSelectionFromPersistentIds();
      this.events.emit({
        type: 'filterChanged',
        filterModel: f,
        source: 'api',
        columns: changedColIds,
      });
      // Cycle 14 / Task 6 — filter set replaced → totals recompute.
      this.requestViewport('filterChanged');
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  /** Cycle 7 / Task 1 — return the v2 filter model entry for `colId`, or
   *  `null` when the column is unfiltered. Backs the floating-filter
   *  overlay's `getColumnFilterModel` dep. Tasks 3-6 + 9 surface this on
   *  `CGridApi`. */
  getColumnFilterModel(colId: string): CFilterModelEntry | null {
    return this.columnFilterModels.get(colId) ?? null;
  }

  /** Cycle 23 / Task 5 — full filter model as a plain object,
   *  keyed by colId. Mirrors the shape `setFilterModel` accepts so
   *  a `setFilterModel(getFilterModel())` round-trip is idempotent.
   *  Returns `{}` (not `null`) when no columns are filtered. */
  getFilterModel(): FilterModel {
    const out: FilterModel = {};
    for (const [colId, entry] of this.columnFilterModels) out[colId] = entry;
    return out;
  }

  /** Cycle 7 / Task 1 — apply a per-column filter mutation. Updates the
   *  canonical v2 map and ships the composed `FilterModel` to the
   *  worker for re-evaluation. The worker accepts both legacy and v2
   *  shapes (v2 entries flow through unchanged), so the parser's
   *  full operator surface — comparison / range / CSV / AND / OR —
   *  reaches the matcher without lossy conversion. Passing `model: null`
   *  clears the column.
   *
   *  Note: this does NOT round-trip the model back into the floating
   *  filter input. The user's typed expression often doesn't round-trip
   *  losslessly (`>100` parses to `{type:'greaterThan', filter:100}`
   *  whose canonical string form is `100`), so writing that back would
   *  clobber the visible operator. The floating input is the source of
   *  truth for what the user typed; the v2 model is the source of truth
   *  for evaluation. Tasks 3-6 + 9 (popup UIs) will sync inputs
   *  explicitly when they need to. */
  setColumnFilterModel(colId: string, model: CFilterModelEntry | null): Promise<void> {
    // Cycle 7 / Task 5 — main-side `trimInput` honored before storage.
    // Strips leading/trailing whitespace from the text filter value so a
    // user typing "  POS  " hits the worker as "POS". Distinct from the
    // column-level `textFormatter: 'trim'`, which trims on every row
    // comparison; trimInput trims once at setModel time.
    let effective = model;
    if (effective && effective.filterType === 'text') {
      const def = this.columnDefsMap.get(colId);
      const params = def?.filterParams as import('./types').CTextFilterParams | undefined;
      if (params?.trimInput === true) {
        effective = applyTrimInputToModel(effective, true) as CFilterModelEntry | null;
      }
    }
    // Cycle 7 / Task 9 — track whether the per-column entry actually
    // changed so the resulting `filterChanged.columns` array is
    // truthful. A no-op set (same shape, same op, same value) suppresses
    // the column from the emitted list.
    const prev = this.columnFilterModels.get(colId) ?? null;
    const changed = !entriesEqual(prev, effective);
    if (effective) this.columnFilterModels.set(colId, effective);
    else this.columnFilterModels.delete(colId);
    const combined: FilterModel = {};
    for (const [id, entry] of this.columnFilterModels) {
      combined[id] = entry;
    }
    return this.workerClient.setFilterModel(combined).then(({ visibleCount }) => {
      if (this.destroyed) return;
      this.rowCount = visibleCount;
      this.rowHeightIndex = null;
      this.recomputeViewport();
      this.rebuildSelectionFromPersistentIds();
      this.events.emit({
        type: 'filterChanged',
        filterModel: combined,
        source: 'columnFilter',
        columns: changed ? [colId] : [],
      });
      // Cycle 14 / Task 6 — per-column filter changed → totals recompute.
      this.requestViewport('filterChanged');
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  /** Cycle 7 / Task 9 — `true` when any filter source is active:
   *  per-column, quick, external, or alwaysPass. Backs `CGridApi.isAnyFilterPresent`. */
  isAnyFilterPresent(): boolean {
    if (this.columnFilterModels.size > 0) return true;
    if ((this.options.quickFilterText ?? '') !== '') return true;
    if (this.options.isExternalFilterPresent?.() === true) return true;
    if (this.options.alwaysPassFilter !== undefined) return true;
    return false;
  }

  /** Cycle 7 / Task 9 — `true` when at least one per-column filter
   *  entry is set. Independent of quick / external state. Backs
   *  `CGridApi.isColumnFilterPresent`. */
  isColumnFilterPresent(): boolean {
    return this.columnFilterModels.size > 0;
  }

  /** Cycle 7 / Task 9 — clear the column's filter AND close the popup
   *  if it's currently open for `colId`. Equivalent to
   *  `setColumnFilterModel(colId, null)` plus a `hideColumnFilter()`
   *  guard. The Promise from `setColumnFilterModel` is intentionally
   *  not surfaced — `destroyFilter` is fire-and-forget per the
   *  catalog. */
  destroyFilter(colId: string): void {
    if (this.destroyed) return;
    if (this.filterPopupHost.openColId() === colId) {
      this.filterPopupHost.close();
    }
    if (!this.columnFilterModels.has(colId)) return;
    void this.setColumnFilterModel(colId, null);
  }

  /** Cycle 7 / Task 1 — debug accessor for E2E tests that need the
   *  scrollable host directly (e.g. to drive `scrollLeft = N` and verify
   *  the floating-filter overlay re-pins on scroll). Stable across cycles
   *  but not part of the public API surface. */
  getScroller(): HTMLElement { return this.scroller; }

  /**
   * Cycle 7 / Task 7 — re-evaluate the cross-column quick filter. Reads
   * `options.quickFilterText` / `cacheQuickFilter` /
   * `includeHiddenColumnsInQuickFilter`, parses the text via
   * `options.quickFilterParser` (default whitespace split), ships the
   * resulting terms to the worker via `setQuickFilter`, then refreshes
   * the visible row count and fires `filterChanged` with
   * `source: 'quickFilter'`.
   *
   * The custom `quickFilterMatcher` is intentionally ignored in Cycle 7
   * because the worker currently can only run the built-in
   * case-insensitive every-term-includes matcher; an arbitrary closure
   * cannot cross the structured-clone boundary. A `console.warn` flags
   * the limitation so apps know to wait for Cycle 24's worker-module
   * loader. The custom `getQuickFilterText` is similarly deferred —
   * Cycle 7 always uses `String(value)` per column.
   *
   * `includeHiddenColumnsInQuickFilter` is honored against the worker's
   * current column set; in Cycle 7 the worker only knows visible
   * columns (per `workerColumns()`), so toggling the flag is a no-op
   * until a later cycle ships hidden-column metadata to the worker.
   */
  private applyQuickFilter(): void {
    if (!this.workerClient) return;
    const rawText = this.options.quickFilterText ?? '';
    const parser = this.options.quickFilterParser ?? defaultQuickFilterParser;
    let terms: string[] | null;
    if (rawText === '') {
      terms = null;
    } else {
      const parsed = parser(rawText);
      terms = parsed.length === 0 ? null : parsed;
    }
    if (this.options.quickFilterMatcher !== undefined && !this.warnedQuickFilterMatcher) {
      this.warnedQuickFilterMatcher = true;
      console.warn(
        '[cgrid] quickFilterMatcher is shipped in Cycle 7 as API surface only; ' +
        'the worker uses the built-in case-insensitive matcher until Cycle 24 ' +
        'ships the worker-module loader.',
      );
    }
    const includeHidden = this.options.includeHiddenColumnsInQuickFilter === true;
    // colIds: null = use every worker column. In Cycle 7 the worker only
    // carries visible columns so this is equivalent to listing them; the
    // explicit list documents intent and stays valid once hidden columns
    // join the worker payload.
    const colIds = includeHidden ? null : this.columnOrder.map((c) => c.colId);
    const cacheQuickFilter = this.options.cacheQuickFilter === true;
    // Cache the lowercased terms on the grid so the renderer can tint
    // matching cells without re-lowering per cell per frame. Empty array
    // = no highlight (renderer's `quickFilterActive` short-circuits the
    // per-cell `includes` check). Updated SYNCHRONOUSLY so a fast typer
    // typing "6672" → "66721" sees the next paint use the new terms
    // immediately, never the previous-substring matches.
    this.quickFilterLowerTerms = terms === null
      ? []
      : terms.map((t) => t.toLowerCase());
    // Trigger a repaint right away so the highlight reflects the new
    // terms even before the worker round-trip lands. The visible row set
    // may still be stale for one frame — that's fine; cells that no
    // longer match are simply un-tinted in the next paint, while the
    // chunk catches up.
    this.cgridCanvas?.requestRepaint();
    // Bump the request id so any in-flight reply for an earlier term set
    // (the user's previous keystroke) is dropped on arrival — see the
    // `reqId` check inside the `.then` below.
    const reqId = ++this.quickFilterReqId;
    this.workerClient.setQuickFilter({ terms, cacheQuickFilter, colIds })
      .then(({ visibleCount }) => {
        // Stale reply — a later applyQuickFilter has superseded this one.
        // Dropping prevents rowCount + viewport from flickering back to a
        // previous keystroke's visible set.
        if (reqId !== this.quickFilterReqId) return;
        this.rowCount = visibleCount;
        // Visible row set changed; invalidate the Fenwick index so the next
        // viewport request reads heights against the new visible order.
        this.rowHeightIndex = null;
        this.recomputeViewport();
        this.rebuildSelectionFromPersistentIds();
        // The filterChanged event carries the COMPOSED per-column model
        // (not the quick-filter text), matching the existing setFilterModel
        // payload. The new `source: 'quickFilter'` discriminator labels the
        // trigger so apps can correlate.
        const combined: FilterModel = {};
        for (const [id, entry] of this.columnFilterModels) combined[id] = entry;
        this.events.emit({ type: 'filterChanged', filterModel: combined, source: 'quickFilter' });
        // Cycle 14 / Task 6 — quick-filter changed → totals recompute.
        this.requestViewport('filterChanged');
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  /** One-shot warning latch for `quickFilterMatcher`. Cycle 7 / Task 7. */
  private warnedQuickFilterMatcher = false;

  /** Cycle 7 / Task 7 — pre-lowercased active quick-filter terms. Empty
   *  when no filter is active. Read by the renderer on every paint to
   *  tint matching cells with `theme.quickFilterMatchBg`. Kept in sync
   *  with `applyQuickFilter` so the highlight set always matches the
   *  worker's visible row set. */
  private quickFilterLowerTerms: readonly string[] = [];

  /** Cycle 7 / Task 8 — main-side cache of every row that's been shipped
   *  to the worker. Keyed by rowId. Kept in sync by `setRowData` and
   *  `applyTransaction(Async)` so the external-filter and alwaysPass
   *  predicates have data to evaluate against. Without this cache the
   *  worker would have to ship every candidate row's data up alongside
   *  its rowId, doubling the protocol traffic for an external filter
   *  pass. The cache lives as long as the grid; entries drop on
   *  `applyTransaction.remove` and are wiped on every `setRowData`. */
  private rowDataById: Map<string, TRow> = new Map();
  /** Cycle 7 / Task 8 — monotonic request id for in-flight `refilter`
   *  round-trips. Bumped at the head of every `onFilterChanged` /
   *  external-filter trigger; stale replies (id mismatch) are dropped
   *  on arrival so a rapid sequence of toggles doesn't flicker the
   *  visible set back to an earlier survivor list. Same shape as
   *  `quickFilterReqId`. */
  private externalFilterReqId = 0;
  /** Cycle 7 / Task 7 — monotonic request id for in-flight `setQuickFilter`
   *  worker round-trips. Each `applyQuickFilter` bumps it and captures the
   *  value; the worker `.then` callback bails when the captured id no
   *  longer matches `this.quickFilterReqId`. Drops stale replies during
   *  fast typing so the visible row count + repaint always reflect the
   *  most recent search text, never an out-of-order earlier one. */
  private quickFilterReqId = 0;

  /** Cycle 7 / Task 3 — open the per-column filter popup for `colId`.
   *  Resolves the column's filter type, instantiates the matching popup,
   *  and mounts it via FilterPopupHost anchored under the column's
   *  leaf-header rect. No-op when:
   *  - the column id is unknown
   *  - the column has no resolved filter / cellDataType
   *  - the column is not currently in the viewport
   *  - the popup is already open for the same column
   *
   *  Cycle 11 / Task 4 — the popup-factory construction is factored into
   *  `buildFilterPopupFactory` so the FiltersToolPanel can reuse the
   *  exact same per-type editor for its inline expand-row UI. The popup
   *  path adds anchoring + host-mounting on top.
   */
  showColumnFilter(colId: string): void {
    if (this.destroyed) return;
    if (this.filterPopupHost.openColId() === colId) return;
    const def = this.columnDefsMap.get(colId);
    if (!def) return;
    const filterType = resolveFilterType(def);
    if (!filterType) return;
    const headerBounds = this.getHeaderBoundsAt(colId);
    if (!headerBounds) return;
    // Anchor sits BELOW the floating-filter row when one is visible —
    // that's where the user just clicked. Falls back to the leaf header
    // when no floating row is active (column-API-only filter UI).
    const floatingTop = this.viewport.floatingFilterRowTop;
    const floatingH = this.viewport.floatingFilterRowHeight;
    const anchorCell = floatingTop != null && floatingH != null
      ? { x: headerBounds.x, y: floatingTop, w: headerBounds.w, h: floatingH }
      : headerBounds;
    const viewportBounds = {
      width: this.canvasBounds.width || this.scroller.clientWidth || 0,
      height: this.canvasBounds.height || this.scroller.clientHeight || 0,
    };
    void this.buildFilterPopupFactory(colId, {
      onApply: (model) => void this.setColumnFilterModel(colId, model),
      onClose: () => this.hideColumnFilter(),
      onModified: () => this.events.emit({ type: 'filterModified', colId }),
    }).then((popup) => {
      if (!popup || this.destroyed) return;
      // Guard against a second `showColumnFilter` racing in before the
      // (potentially async, for set filter) factory resolves.
      const openCol = this.filterPopupHost.openColId();
      if (openCol !== null && openCol !== colId) return;
      this.filterPopupHost.open(colId, { cellBounds: anchorCell, viewportBounds }, popup);
      this.events.emit({ type: 'filterOpened', colId });
    }).catch((err) => {
      if (!this.destroyed) console.error('[cgrid] showColumnFilter:', err);
    });
  }

  /** Cycle 11 / Task 4 — build the popup factory for `colId`. Returns a
   *  Promise so the set-filter's distinct-values worker round-trip can
   *  resolve before the factory is instantiated (all other filter types
   *  resolve synchronously). Returns `null` when the column is unknown
   *  or has no resolved filter type.
   *
   *  Both `showColumnFilter` (popup mode) and the FiltersToolPanel
   *  (inline mode) call this, so per-type popup wiring lives in exactly
   *  one place — a bug fixed in one path is fixed in both. */
  private buildFilterPopupFactory(
    colId: string,
    callbacks: {
      onApply: (model: CFilterModelEntry | null) => void;
      onClose: () => void;
      onModified?: () => void;
    },
  ): Promise<import('./interaction/filters/filterPopupHost').FilterPopupFactory | null> {
    const def = this.columnDefsMap.get(colId);
    if (!def) return Promise.resolve(null);
    const filterType = resolveFilterType(def);
    if (!filterType) return Promise.resolve(null);
    const initial = this.getColumnFilterModel(colId);

    if (filterType === 'number') {
      const params = (def.filterParams ?? {}) as import('./types').CFilterParams;
      // Cycle 7 / Task 6 — both number and multi-shaped entries seed the
      // popup. Single popups normalise a multi-shape to its first
      // condition; multi popups hydrate the full conditions array.
      const initialEntry = initial && (initial.filterType === 'number' || initial.filterType === 'multi')
        ? initial as import('./types').CNumberFilterModel | import('./types').CMultiConditionFilterModel
        : null;
      return Promise.resolve(new NumberFilterPopup({
        initialModel: initialEntry,
        onApply: (model) => callbacks.onApply(model as CFilterModelEntry | null),
        onClose: callbacks.onClose,
        onModified: callbacks.onModified,
        buttons: params.buttons,
        closeOnApply: params.closeOnApply ?? true,
        maxNumConditions: params.maxNumConditions,
        numAlwaysVisibleConditions: params.numAlwaysVisibleConditions,
        defaultJoinOperator: params.defaultJoinOperator,
      }));
    }

    if (filterType === 'date') {
      const params = (def.filterParams ?? {}) as import('./types').CFilterParams;
      const initialEntry = initial && (initial.filterType === 'date' || initial.filterType === 'multi')
        ? initial as import('./types').CDateFilterModel | import('./types').CMultiConditionFilterModel
        : null;
      return Promise.resolve(new DateFilterPopup({
        initialModel: initialEntry,
        onApply: (model) => callbacks.onApply(model as CFilterModelEntry | null),
        onClose: callbacks.onClose,
        onModified: callbacks.onModified,
        buttons: params.buttons,
        closeOnApply: params.closeOnApply ?? true,
        maxNumConditions: params.maxNumConditions,
        numAlwaysVisibleConditions: params.numAlwaysVisibleConditions,
        defaultJoinOperator: params.defaultJoinOperator,
      }));
    }

    if (filterType === 'text') {
      // Cycle 7 / Task 5 — text-filter popup. Reads `caseSensitive` /
      // `showCaseSensitiveToggle` from filterParams; the
      // `textFormatter` / `trimInput` knobs land on the worker
      // (textFormatter) or main-side setColumnFilterModel (trimInput).
      const params = (def.filterParams ?? {}) as import('./types').CTextFilterParams;
      const initialEntry = initial && (initial.filterType === 'text' || initial.filterType === 'multi')
        ? initial as import('./types').CTextFilterModel | import('./types').CMultiConditionFilterModel
        : null;
      return Promise.resolve(new TextFilterPopup({
        initialModel: initialEntry,
        onApply: (model) => callbacks.onApply(model as CFilterModelEntry | null),
        onClose: callbacks.onClose,
        onModified: callbacks.onModified,
        buttons: params.buttons,
        closeOnApply: params.closeOnApply ?? true,
        showCaseSensitiveToggle: params.showCaseSensitiveToggle,
        maxNumConditions: params.maxNumConditions,
        numAlwaysVisibleConditions: params.numAlwaysVisibleConditions,
        defaultJoinOperator: params.defaultJoinOperator,
      }));
    }

    // filterType === 'set'
    // Cycle 7 / Task 9 — set filter. Distinct values arrive via a
    // worker round-trip first; the popup mounts after the values
    // resolve so the checkbox list is rendered against real data
    // (not flashed empty). Static-array `filterParams.values`
    // overrides the data-derived path — useful for Cycle 18's SSRM
    // where the server supplies values.
    const params = (def.filterParams ?? {}) as import('./types').CSetFilterParams;
    const initialEntry = initial && initial.filterType === 'set'
      ? initial as import('./types').CSetFilterModel
      : null;
    const valuesPromise: Promise<string[]> = params.values !== undefined
      ? Promise.resolve(params.values)
      : this.workerClient.getDistinctValues(colId);
    return valuesPromise.then((values) => {
      if (this.destroyed) return null;
      return new SetFilterPopup({
        values,
        initialModel: initialEntry,
        onApply: (model) => callbacks.onApply(model as CFilterModelEntry | null),
        onClose: callbacks.onClose,
        onModified: callbacks.onModified,
        buttons: params.buttons,
        closeOnApply: params.closeOnApply ?? true,
        suppressMiniFilter: params.suppressMiniFilter,
        suppressSelectAll: params.suppressSelectAll,
        caseSensitive: params.caseSensitive,
      });
    }).catch((err) => {
      if (!this.destroyed) console.error('[cgrid] getDistinctValues:', err);
      return null;
    });
  }

  /** Cycle 11 / Task 4 — the resolved popup-filter type for `colId`, or
   *  `null` when the column is unknown or has no filter. Used by the
   *  FiltersToolPanel to decide which columns get a collapsible row +
   *  by apps that want to introspect filter wiring. Resolves through the
   *  same `resolveFilterType` switch `showColumnFilter` uses, so the
   *  panel's row list matches the popup's "is this filterable" check. */
  getColumnFilterType(colId: string): 'text' | 'number' | 'date' | 'set' | null {
    const def = this.columnDefsMap.get(colId);
    return resolveFilterType(def);
  }

  /** Cycle 11 / Task 4 — build the filter editor for `colId` for inline
   *  hosting (FiltersToolPanel). Returns a handle that owns the editor's
   *  GUI element + a `destroy` callback for teardown. The returned GUI
   *  must be appended to a DOM container by the caller.
   *
   *  Resolves `null` when the column has no filter, is unknown, or the
   *  grid is destroyed before the async distinct-values fetch (set
   *  filter) completes. Filter mutations propagate via the same
   *  `setColumnFilterModel` path the popup uses, so the worker pipeline
   *  is identical between popup and inline modes. */
  buildColumnFilterEditor(colId: string): Promise<{
    gui: HTMLElement;
    destroy(): void;
  } | null> {
    return this.buildFilterPopupFactory(colId, {
      onApply: (model) => void this.setColumnFilterModel(colId, model),
      // No-op for inline mode — the editor stays mounted until the
      // panel user explicitly collapses the row. The popup mode wires
      // this to `hideColumnFilter` so Apply closes the popup; inline
      // mode keeps the editor visible after a commit.
      onClose: () => {},
      onModified: () => this.events.emit({ type: 'filterModified', colId }),
    }).then((factory) => {
      if (!factory) return null;
      const gui = factory.buildGui();
      return {
        gui,
        destroy: () => factory.destroy(),
      };
    });
  }

  /** Cycle 7 / Task 3 — close the active filter popup. Idempotent. */
  hideColumnFilter(): void {
    if (this.destroyed) return;
    this.filterPopupHost.close();
  }

  /** Cycle 10 / Task 1+2 — resolve the right-click menu items for `hit`.
   *  Routes by hit kind, matching ag-grid's split:
   *
   *  - `cell`         → cell context menu via `getContextMenuItems` +
   *                     `buildDefaultMenuItems` (clipboard-heavy:
   *                     Cut / Copy / Paste / Export / …).
   *  - `header`       → main menu via `getMainMenuItems` +
   *  - `headerGroup`    `buildDefaultMainMenuItems` (column-ops-heavy:
   *                     Pin Column / Autosize / Reset). Header right-
   *                     clicks have no cell-range context, so the
   *                     clipboard items are deliberately omitted.
   *  - other (empty / scrollbar) → no menu (returns []).
   *
   *  Read at event time so a runtime `setGridOption('getContextMenuItems'
   *  / 'getMainMenuItems', …)` takes effect on the next right-click
   *  without re-wiring the feature chain. The `defaultItems` array is
   *  also rebuilt per right-click so the column the user actually
   *  clicked flows into per-column actions (Pin Column, Autosize This
   *  Column) at the latest hit. */
  resolveContextMenuItems(hit: import('./interaction/hitTester').Hit): MenuItem[] {
    if (this.destroyed) return [];

    // Header / group-header right-click → main menu.
    if (hit.kind === 'header' || hit.kind === 'headerGroup') {
      const params: GetMainMenuItemsParams = { colId: hit.colId, defaultItems: [] };
      const defaultItems = buildDefaultMainMenuItems(this, params);
      params.defaultItems = defaultItems;
      const callback = this.options.getMainMenuItems;
      if (callback) return callback(params);
      return defaultItems;
    }

    // Body-cell right-click → cell context menu. Other hit kinds
    // (scrollbar, empty viewport) fall through this branch too with a
    // null colId / rowIndex; the cell defaults handle that gracefully
    // (Pin Column disables when colId is null).
    const rowIndex = hit.kind === 'cell' ? hit.rowIndex : null;
    const colId = hit.kind === 'cell' ? hit.colId : null;
    const params: GetContextMenuItemsParams = {
      rowIndex,
      colId,
      ranges: this.getCellRanges(),
      defaultItems: [],
    };
    const defaultItems = buildDefaultMenuItems(this, params);
    params.defaultItems = defaultItems;
    const callback = this.options.getContextMenuItems;
    if (callback) return callback(params);
    return defaultItems;
  }

  /** Cycle 10 / Task 1+2 — mount the right-click menu at viewport coords
   *  `(x, y)` rendering `items`. Empty `items` is a no-op so callers can
   *  always invoke this without the empty-list guard. The params handed
   *  to item actions matches the registry the menu was resolved from —
   *  cell hits feed `GetContextMenuItemsParams`, header hits feed
   *  `GetMainMenuItemsParams` — so custom action authors can rely on the
   *  shape they registered against. */
  openContextMenu(items: MenuItem[], x: number, y: number, hit: import('./interaction/hitTester').Hit): void {
    if (this.destroyed) return;
    if (items.length === 0) return;

    let params: GetContextMenuItemsParams | GetMainMenuItemsParams;
    if (hit.kind === 'header' || hit.kind === 'headerGroup') {
      const p: GetMainMenuItemsParams = { colId: hit.colId, defaultItems: [] };
      p.defaultItems = buildDefaultMainMenuItems(this, p);
      params = p;
    } else {
      const rowIndex = hit.kind === 'cell' ? hit.rowIndex : null;
      const colId = hit.kind === 'cell' ? hit.colId : null;
      const p: GetContextMenuItemsParams = {
        rowIndex,
        colId,
        ranges: this.getCellRanges(),
        defaultItems: [],
      };
      p.defaultItems = buildDefaultMenuItems(this, p);
      params = p;
    }
    this.contextMenuHost.open(items, x, y, params);
  }

  /** Cycle 10 / Task 1 — close any open context menu. Idempotent. */
  closeContextMenu(): void {
    if (this.destroyed) return;
    this.contextMenuHost.close();
  }

  /** Cycle 7 / Task 1 — current displayed (post-filter) row count. Backs
   *  the floating-filter E2E that asserts typing reduces the visible
   *  rows. Identical to the value last shipped via `modelUpdated`. */
  getDisplayedRowCount(): number { return this.rowCount; }

  /** Cycle 13 / Task 2 — total pre-filter row count. Reads off the
   *  main-thread `rowDataById` cache (populated by `setRowData` +
   *  maintained by `applyTransaction.add` / `.remove`), so it stays
   *  cheap under a per-frame status-bar refresh — no worker round-trip,
   *  no chunk walk. */
  getTotalRowCount(): number { return this.rowDataById.size; }

  /** Cycle 15 — set the row-group model. Stored on the main thread,
   *  forwarded to the worker (Task 1 wired the dispatch), and used by
   *  Task 4's column-order resolution to insert the auto-group column
   *  when grouping is active. An empty `rowGroupCols` array clears
   *  the auto-group column and bypasses the worker's group passes.
   *
   *  Cycle 15 / Task 6 — also syncs the row group panel's chip
   *  strip so a programmatic `setGroupModel` call from app code
   *  flows into the visible chips. */
  setGroupModel(g: GroupModel): void {
    if (this.destroyed) return;
    // Compute visibility diff BEFORE mutating groupModel so we know which
    // columns were newly added to groups (should be hidden from the grid)
    // and which were removed (should be restored to visible).
    const prevSet = new Set(this.groupModel.rowGroupCols);
    const nextSet = new Set(g.rowGroupCols);
    const toHide = g.rowGroupCols.filter((id) => !prevSet.has(id));
    const toShow = this.groupModel.rowGroupCols.filter((id) => !nextSet.has(id));
    this.groupModel = { rowGroupCols: [...g.rowGroupCols] };
    this.rebuildAutoGroupColumn();
    // Cycle 15.5 / Task 1 — sync the GroupingState primitive so any
    // subscribed view (panel, tool-panel zone, context menu)
    // re-renders. The handler short-circuits the round-trip back
    // through `setGroupModel` (sameOrder === true) so the call is
    // free of recursive worker dispatch.
    this.groupingState.setRowGroupColumns(this.groupModel.rowGroupCols);
    this.rowGroupPanel?.setRowGroupCols(this.groupModel.rowGroupCols);
    // Cycle 15 / Task 7 — fresh model resets expansion to the
    // default-all sentinel; the worker does the same on its side. The
    // reply ships back the full key list so the mirror can serve
    // `getExpandedKeys()` snapshots without a follow-up round-trip.
    //
    // Cycle 15 / Task 9 — the reply ALSO carries the materialised
    // `expandedKeys` set when `groupDefaultExpanded` /
    // `groupDefaultExpandedKeys` is configured. Until the reply
    // lands the mirror sits at the default-all sentinel (consistent
    // with the worker's intermediate state before defaults are
    // applied); the reply handler below overrides it with the
    // explicit set when present.
    this.expandedKeys = null;
    this.workerClient.setGroupModel(this.groupModel).then(({ visibleCount, groupKeys, groupDescendants, expandedKeys }) => {
      if (this.destroyed) return;
      this.knownGroupKeys = groupKeys;
      this.updateGroupDescendantsCache(groupKeys, groupDescendants);
      // Cycle 15 / Task 9 — re-seed the mirror from the worker's
      // materialised default. `null` keeps the all-expanded sentinel
      // (`getExpandedKeys()` derives from `knownGroupKeys`); a
      // non-null array installs the explicit starting set.
      this.expandedKeys = expandedKeys === null ? null : new Set(expandedKeys);
      this.rowCount = visibleCount;
      this.rowHeightIndex = null;
      this.recomputeViewport();
      this.cgridCanvas.requestRepaint();
      this.requestViewport();
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
    // Hide columns that are now acting as group levels; restore visibility
    // for columns removed from grouping. Mirrors ag-grid's default behaviour
    // so grouped fields don't appear redundantly as standalone grid columns.
    // Cycle 15.5 / Task 7 — `suppressGroupChangesColumnVisibility` gates this:
    //   true / 'suppressHideOnGroup'+'suppressShowOnUngroup' → skip both.
    //   'suppressHideOnGroup' → skip hide only; allow show on ungroup.
    //   'suppressShowOnUngroup' → skip show only; allow hide on group.
    const suppressVis = this.options.suppressGroupChangesColumnVisibility;
    const suppressHide = suppressVis === true || suppressVis === 'suppressHideOnGroup';
    const suppressShow = suppressVis === true || suppressVis === 'suppressShowOnUngroup';
    if (toHide.length > 0 && !suppressHide) this.setColumnsVisible(toHide, false);
    if (toShow.length > 0 && !suppressShow) this.setColumnsVisible(toShow, true);
  }

  // ─── Cycle 18 / Task 3 — pivot API + render wiring ─────────────────────

  isPivotMode(): boolean { return this.pivotState.isPivotMode(); }
  setPivotMode(pivotMode: boolean): void {
    if (!this.destroyed) this.pivotState.setPivotMode(pivotMode);
  }
  getPivotColumns(): string[] { return this.pivotState.getPivotColumns(); }
  setPivotColumns(colIds: string[]): void {
    if (!this.destroyed) this.pivotState.setPivotColumns(colIds);
  }
  addPivotColumn(colId: string): void {
    if (!this.destroyed) this.pivotState.addPivotColumn(colId);
  }
  removePivotColumn(colId: string): void {
    if (!this.destroyed) this.pivotState.removePivotColumn(colId);
  }
  movePivotColumn(from: number, to: number): void {
    if (!this.destroyed) this.pivotState.movePivotColumn(from, to);
  }
  getValueColumns(): Array<{ colId: string; aggFunc: string }> {
    return this.pivotState.getValueColumns().map((v) => ({ colId: v.colId, aggFunc: v.aggFunc }));
  }
  addValueColumn(colId: string, aggFunc: string): void {
    if (!this.destroyed) this.pivotState.addValueColumn(colId, aggFunc);
  }
  removeValueColumn(colId: string): void {
    if (!this.destroyed) this.pivotState.removeValueColumn(colId);
  }
  setValueColumnAggFunc(colId: string, aggFunc: string): void {
    if (!this.destroyed) this.pivotState.setValueColumnAggFunc(colId, aggFunc);
  }
  setValueColumns(list: Array<{ colId: string; aggFunc: string }>): void {
    if (!this.destroyed) this.pivotState.setValueColumns(list);
  }
  /** Synthesized pivot result column IDs — the cross-tabbed
   *  `pivot_<pivotKey>_<valueColId>` colIds the worker emits when pivot is
   *  active. Returns `[]` when pivot is inactive. Mirrors AG-Grid's
   *  `gridApi.getPivotResultColumns()` (we return colIds, the AG getter
   *  returns Column instances; the colId is the only useful piece for
   *  driving sort / state). */
  getPivotResultColumns(): string[] {
    if (!this.pivotActive) return [];
    return Array.from(this.pivotCellSpecById.keys());
  }

  /** Build the worker pivot model from the current pivot state. Returns an
   *  EMPTY model unless the pivot is active (mode on AND ≥1 pivot column
   *  AND ≥1 value column) — `pivotMode` itself is not part of the worker
   *  model, so an inactive pivot must surface as an empty model or the
   *  worker would keep cross-tabbing. */
  private pivotWorkerModel(): PivotModel {
    if (!this.pivotState.isPivotActive()) return { pivotColIds: [], valueCols: [] };
    return {
      pivotColIds: this.pivotState.getPivotColumns(),
      valueCols: this.pivotState.getValueColumns().map((v) => ({ colId: v.colId, aggFunc: v.aggFunc })),
    };
  }

  /** Cycle 18 / Task 3 — react to any pivot state mutation. Refresh the
   *  worker's column metadata (so pivot/value fields survive the primaries
   *  being hidden), install the model, then request a viewport — the chunk
   *  reply carries the pivot tree + values and `maybeSyncPivotColumns`
   *  (re)synthesizes the secondary columns. Cite:
   *  docs/superpowers/plans/notes/cycle-18-pivoting-design.md (Task 3). */
  private handlePivotStateChanged(e: PivotStateChangedEvent): void {
    if (this.destroyed) return;
    // Cycle 18 / Task 5 — fan the change out as a public event so the
    // columns tool panel + pivot panel + context menu keep their views
    // over PivotState in sync. Fire BEFORE the worker round-trip so
    // subscribers can repaint optimistically — the chunk reply that
    // lands a tick later only matters for body cell values, not the
    // pill / toggle chrome these surfaces render from state.
    this.events.emit({
      type: 'pivotStateChanged',
      pivotMode: e.pivotMode,
      pivotColumns: [...e.pivotColumns],
      valueColumns: e.valueColumns.map((v) => ({ ...v })),
      source: e.source,
    });
    // Cycle 18 / Task 6 — fan the change out to the pivot panel host
    // (when mounted) so its pill strip + onlyWhenPivoting paint state
    // stay in sync with PivotState. Pills mirror `pivotColumns`; the
    // active flag toggles whether 'onlyWhenPivoting' paints content.
    if (this.pivotPanel) {
      this.pivotPanel.setPivotColumns(e.pivotColumns);
      this.pivotPanel.setPivotActive(this.pivotState.isPivotActive());
    }
    this.workerClient.updateColumns(this.workerColumns())
      .then(() => this.workerClient.setPivotModel(this.pivotWorkerModel()))
      .then(() => {
        if (this.destroyed) return;
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  /** Cycle 18 / Task 3 — install / drop the synthesized pivot result
   *  columns based on the freshly-arrived chunk. Re-synthesizes only when
   *  the distinct-key set or value columns changed (cheap signature
   *  compare) so steady-state scrolls don't churn the column tree. */
  private maybeSyncPivotColumns(chunk: ViewportChunk): void {
    const active = this.pivotState.isPivotActive() && chunk.pivotColumnTree !== undefined;
    if (active) {
      const signature = JSON.stringify({
        // Cycle 18 / Task 8e — pivotRowTotals + pivotColumnGroupTotals
        // are inputs to synthesis; folding them into the signature so a
        // runtime swap re-synthesizes (without this, the cached pivot
        // tree would paint without the totals column).
        rowTotals: this.options.pivotRowTotals ?? null,
        colGroupTotals: this.options.pivotColumnGroupTotals ?? null,
        defaultExpanded: this.options.pivotDefaultExpanded ?? null,
        grandTotals: this.options.pivotGrandTotals === true,
        leaves: chunk.pivotLeafPaths ?? [],
        vals: this.pivotState.getValueColumns(),
      });
      if (!this.pivotActive || signature !== this.pivotTreeSignature) {
        this.pivotTreeSignature = signature;
        this.applyPivotColumns(chunk.pivotColumnTree!, chunk.pivotLeafPaths ?? []);
      }
    } else if (this.pivotActive) {
      this.revertPivotColumns();
    }
  }

  /** Swap the column tree to the synthesized pivot tree: pivot levels
   *  become column groups (`HeaderGroupSubgrid` renders them verbatim),
   *  the primary data columns drop out, and the auto-group column is kept
   *  as the row-dim axis. */
  private applyPivotColumns(keyTree: PivotKeyNode[], _leafPaths: string[][]): void {
    const valueColumns: PivotValueColumnSpec[] = this.pivotState.getValueColumns().map((v) => {
      const primary = (this.primaryColumnTree ?? this.columnTree).leafById.get(v.colId);
      return {
        colId: v.colId,
        aggFunc: v.aggFunc,
        headerName: primary?.headerName ?? v.colId,
        cellDataType: primary?.cellDataType ?? 'number',
        width: primary?.width,
      };
    });
    const { defs, cellSpecById } = synthesizePivotColumns<TRow>({
      keyTree,
      valueColumns,
      pivotDefaultExpanded: this.options.pivotDefaultExpanded,
      pivotGrandTotals: this.options.pivotGrandTotals === true,
      // Cycle 18 / Task 8e — pivot totals (row totals + column-group totals).
      pivotRowTotals: this.options.pivotRowTotals ?? null,
      pivotColumnGroupTotals: this.options.pivotColumnGroupTotals ?? null,
      // Cycle 18 / Task 8f — app callbacks for customising the synthesized
      // colDef / groupDef before the resolver sees them.
      processPivotResultColDef: this.options.processPivotResultColDef,
      processPivotResultColGroupDef: this.options.processPivotResultColGroupDef,
    });

    // Save the primary structures on first activation so revert restores
    // the exact pre-pivot tree (with its column-group open/closed state).
    if (!this.pivotActive) {
      this.primaryColumnTree = this.columnTree;
      this.primaryColumnGroupState = this.columnGroupState;
    }

    const pivotTree = resolveColumnTree<TRow>(defs);
    this.columnTree = pivotTree;
    this.columnGroupState = new ColumnGroupState(pivotTree);
    this.subscribeColumnGroupState();
    this.columnDefsMap = pivotTree.leafById as Map<string, ResolvedColDef<TRow>>;
    // Keep the auto-group column(s) resolvable for the painter / leaf header.
    for (const col of this.autoGroupColumns) this.columnDefsMap.set(col.colId, col);
    this.pivotCellSpecById = cellSpecById;
    this.pivotActive = true;

    this.columnOrder = this.computeVisibleColumnOrder();
    this.columnLayout = resolveColumnWidths(
      this.columnOrder,
      this.canvasBounds.width || this.scroller.clientWidth || 800,
    );
    this.rebuildSubgridStack();
    this.recomputeViewport();
    this.cgridCanvas?.requestRepaint();
  }

  /** Restore the primary columns when pivot deactivates. Drops the
   *  synthetic columns en masse and re-fetches a viewport for the primary
   *  column data (the current chunk only carries pivot values). */
  private revertPivotColumns(): void {
    if (!this.pivotActive) return;
    if (this.primaryColumnTree) this.columnTree = this.primaryColumnTree;
    if (this.primaryColumnGroupState) {
      this.columnGroupState = this.primaryColumnGroupState;
      this.subscribeColumnGroupState();
    }
    this.columnDefsMap = this.columnTree.leafById as Map<string, ResolvedColDef<TRow>>;
    for (const col of this.autoGroupColumns) this.columnDefsMap.set(col.colId, col);
    this.pivotCellSpecById = new Map();
    this.pivotTreeSignature = '';
    this.pivotActive = false;
    this.primaryColumnTree = null;
    this.primaryColumnGroupState = null;

    this.columnOrder = this.computeVisibleColumnOrder();
    this.columnLayout = resolveColumnWidths(
      this.columnOrder,
      this.canvasBounds.width || this.scroller.clientWidth || 800,
    );
    this.rebuildSubgridStack();
    this.recomputeViewport();
    this.cgridCanvas?.requestRepaint();
    // The chunk that drove the revert carried no primary column data
    // (it was requested with the synthetic colIds) — fetch fresh data.
    this.requestViewport();
  }

  /** Cycle 15 / Task 7 — flip every group to expanded. Ships the
   *  "default = all" sentinel to the worker so the slicer derives
   *  the all-keys set itself; fires `expandOrCollapseAll` once with
   *  `expanded: true`. No-op when grouping bypasses
   *  (`rowGroupCols.length === 0`) — the event still fires so apps
   *  with a "toggle grouping" UX don't have to special-case the
   *  ungrouped grid. */
  /** Cycle 15.5 / Task 6 — scroll a row by zero-based display index into
   *  view. Wraps the private `ensureRowIndexVisible` so callers that know
   *  the index (e.g. keyboard nav code that already has the row index in
   *  front of it) don't need to round-trip to the worker for the ID. */
  ensureIndexVisible(
    index: number,
    position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto',
  ): void {
    if (this.destroyed) return;
    this.ensureRowIndexVisible(index, position);
  }

  /** Cycle 15.5 / Task 6 — reset all row group expansion state back to
   *  the initial defaults (`groupDefaultExpanded` / `groupDefaultExpandedKeys`
   *  / `isGroupOpenByDefault`). Discards every user-driven expand / collapse
   *  toggle and re-runs `setGroupModel` with the current model so the worker
   *  re-seeds `expandedKeys` from defaults. */
  resetRowGroupExpansion(): void {
    if (this.destroyed) return;
    this.expandedKeys = null;
    // Re-submit the current group model; the worker will re-apply the
    // groupDefaultExpanded / groupDefaultExpandedKeys defaults it was
    // initialised with, producing a fresh expandedKeys set.
    this.setGroupModel(this.groupModel);
  }

  expandAll(): void {
    if (this.destroyed) return;
    this.expandedKeys = null;
    this.shipExpandedKeys(null);
    this.events.emit({ type: 'expandOrCollapseAll', expanded: true });
  }

  /** Cycle 15 / Task 7 — flip every group to collapsed. The mirror
   *  holds an empty Set (the canonical "explicit, with no expanded
   *  keys" state); the worker mirrors. Fires `expandOrCollapseAll`
   *  with `expanded: false`. */
  collapseAll(): void {
    if (this.destroyed) return;
    this.expandedKeys = new Set();
    this.shipExpandedKeys([]);
    this.events.emit({ type: 'expandOrCollapseAll', expanded: false });
  }

  /** Cycle 15 / Task 7 — toggle a specific group's expanded state.
   *  When the mirror is at the default-all sentinel AND the call
   *  collapses a single group, we materialise against
   *  `knownGroupKeys` first so the worker receives an explicit set
   *  (otherwise the worker would interpret the null sentinel as
   *  "expand everything" and clobber the toggle). Idempotent — no
   *  event fires when the state didn't change. Unknown keys (a
   *  stale key from a prior model) no-op AFTER the materialisation
   *  attempt; this preserves the lossless mirror in either
   *  direction. */
  setExpanded(groupKey: string, expanded: boolean): void {
    if (this.destroyed) return;
    // Materialise the mirror if we're entering explicit mode from
    // the default-all sentinel. The materialised set holds every
    // currently-known group key so the next ship-to-worker is a
    // complete picture.
    let next: Set<string>;
    if (this.expandedKeys === null) {
      if (expanded) return; // already expanded under the default
      next = new Set(this.knownGroupKeys);
    } else {
      next = new Set(this.expandedKeys);
    }
    const wasExpanded = next.has(groupKey);
    if (wasExpanded === expanded) return;
    if (expanded) next.add(groupKey);
    else next.delete(groupKey);
    this.expandedKeys = next;
    this.shipExpandedKeys(Array.from(next));
    this.events.emit({
      type: 'rowGroupOpened',
      key: groupKey,
      expanded,
      source: 'api',
    });
  }

  /** Cycle 15 / Task 7 — snapshot of the currently-expanded composite
   *  group key set. Returns a fresh `Set` each call (mutations don't
   *  affect grid state). When the mirror is at the default-all
   *  sentinel we materialise via `knownGroupKeys` so the snapshot is
   *  honest about which keys are open. */
  getExpandedKeys(): Set<string> {
    if (this.expandedKeys === null) return new Set(this.knownGroupKeys);
    return new Set(this.expandedKeys);
  }

  /** Cycle 15 / Task 7 — internal ship-to-worker for the expanded-keys
   *  set. Refreshes `knownGroupKeys` from the reply (a transaction
   *  that landed mid-flight could have added / removed groups) and
   *  drives the next viewport request so the chunk reflects the
   *  collapsed / expanded set.
   *
   *  Cycle 15 / Task 8 — also refreshes the descendant cache from
   *  `groupDescendants` when the worker is emitting them. The
   *  selection model's membership resolver reads from this cache. */
  private shipExpandedKeys(keys: string[] | null): void {
    this.workerClient
      .setExpandedKeys(keys)
      .then(({ visibleCount, groupKeys, groupDescendants }) => {
        if (this.destroyed) return;
        this.knownGroupKeys = groupKeys;
        this.updateGroupDescendantsCache(groupKeys, groupDescendants);
        this.rowCount = visibleCount;
        this.rowHeightIndex = null;
        this.recomputeViewport();
        this.cgridCanvas.requestRepaint();
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  /** Cycle 15 / Task 8 — re-fetch the worker's descendant snapshot
   *  without flipping the emission flag. Used after `modelUpdated`
   *  pushes (data transactions / sort / filter) when
   *  `groupSelectsChildren` is on, so the membership cache stays in
   *  lockstep with the worker's tree. Fire-and-forget; a stale paint
   *  for one frame is acceptable while the round-trip resolves. */
  private refreshGroupDescendantsCache(): void {
    this.workerClient
      .setEmitGroupDescendants(true)
      .then(({ groupKeys, groupDescendants }) => {
        if (this.destroyed) return;
        this.knownGroupKeys = groupKeys;
        this.updateGroupDescendantsCache(groupKeys, groupDescendants);
        this.cgridCanvas?.requestRepaint();
      })
      .catch((err) => {
        if (!this.destroyed) console.error('[cgrid] refreshGroupDescendantsCache:', err);
      });
  }

  /** Cycle 15 / Task 8 — apply a `groupKeysSnapshot` reply's parallel
   *  `groupKeys` + `groupDescendants` arrays to the main-side cache the
   *  `GroupMembershipResolver` reads from. An empty `groupDescendants`
   *  array clears the cache (the worker isn't emitting descendants
   *  right now — the resolver collapses to `'none'` for every key,
   *  which is the correct paint default for "I don't know"). */
  private updateGroupDescendantsCache(
    groupKeys: readonly string[],
    groupDescendants: readonly (readonly string[])[] | undefined,
  ): void {
    if (!groupDescendants || groupDescendants.length === 0) {
      // Either grouping bypasses OR the worker isn't emitting
      // descendants (Tasks 1-7 path); clear so the resolver returns
      // empty arrays and the renderer defaults to 'none'.
      if (this.groupDescendantsByKey.size > 0) this.groupDescendantsByKey.clear();
      return;
    }
    const next = new Map<string, readonly string[]>();
    for (let i = 0; i < groupKeys.length; i++) {
      const key = groupKeys[i]!;
      next.set(key, groupDescendants[i] ?? []);
    }
    this.groupDescendantsByKey = next;
  }

  /** Cycle 15 / Task 8 — toggle the tri-state cascading machinery.
   *
   *  Wiring:
   *    1. Toggles the worker's per-snapshot descendant emission so
   *       subsequent `setGroupModel` / `setExpandedKeys` replies carry
   *       (or omit) the `groupDescendants` array.
   *    2. The current snapshot reply primes the main-side cache.
   *    3. Wires (or detaches) the SelectionModel's membership resolver
   *       so its `setGroupSelected` / `getGroupSelectionState` paths
   *       light up with cascade semantics.
   *    4. Triggers a paint so auto-group cells re-render with the
   *       new checkbox slot wide / hidden.
   *
   *  Resolves once the worker has acked the toggle so callers awaiting
   *  the runtime swap know the first paint after the resolve carries
   *  the new behaviour. */
  private async applyGroupSelectsChildren(enabled: boolean): Promise<void> {
    if (this.destroyed) return;
    try {
      const { groupKeys, groupDescendants } = await this.workerClient
        .setEmitGroupDescendants(enabled);
      if (this.destroyed) return;
      this.knownGroupKeys = groupKeys;
      this.updateGroupDescendantsCache(groupKeys, enabled ? groupDescendants : undefined);
    } catch (err) {
      if (!this.destroyed) console.error('[cgrid] setEmitGroupDescendants:', err);
      return;
    }
    if (enabled) {
      this.selection.setGroupSelectsChildren(true, {
        getDescendantRowIds: (key) => this.groupDescendantsByKey.get(key) ?? [],
      });
    } else {
      this.selection.setGroupSelectsChildren(false, null);
    }
    this.cgridCanvas?.requestRepaint();
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: replace the
   *  entire ordered row-group column list. Routes through the
   *  GroupingState primitive; the `groupingStateChanged` handler
   *  ships the new model to the worker. */
  setRowGroupColumns(columns: string[]): void {
    if (this.destroyed) return;
    this.groupingState.setRowGroupColumns(columns);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: append
   *  `colId` to the row-group column list. */
  addRowGroupColumn(colId: string): void {
    if (this.destroyed) return;
    this.groupingState.addRowGroupColumn(colId);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: remove
   *  `colId` from the row-group column list. */
  removeRowGroupColumn(colId: string): void {
    if (this.destroyed) return;
    this.groupingState.removeRowGroupColumn(colId);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: move the
   *  column at index `from` to index `to`. */
  moveRowGroupColumn(from: number, to: number): void {
    if (this.destroyed) return;
    this.groupingState.moveRowGroupColumn(from, to);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: set the
   *  per-level sort for the row-group level holding `colId`. */
  setRowGroupColumnSort(colId: string, direction: 'asc' | 'desc' | null): void {
    if (this.destroyed) return;
    this.groupingState.setRowGroupColumnSort(colId, direction);
  }

  /** Cycle 15.5 / Task 1 — snapshot of the current row-group column
   *  list in nesting order. */
  getRowGroupColumns(): string[] {
    return this.groupingState.getRowGroupColumns();
  }

  /** Cycle 15.5 / Task 2 — class-level mirror of the public-API getter.
   *  Lives here too (not just on `makeApi()`) so the default main-menu
   *  registry — which receives `this` as its `DefaultMainMenuGrid`
   *  surface — can resolve header names without round-tripping through
   *  the API surface. Mirrors the `getColumnHeaderName` API entry. */
  getColumnHeaderName(colId: string): string | undefined {
    return this.columnDefsMap.get(colId)?.headerName;
  }

  /** Cycle 15.5 / Task 2 — class-level mirror of the public-API getter.
   *  Lives here too (not just on `makeApi()`) so the default main-menu
   *  registry — which receives `this` as its `DefaultMainMenuGrid`
   *  surface — can decide whether to render the "Group by `<col>`"
   *  item without round-tripping through the API surface. Mirrors the
   *  `isColumnRowGroupEnabled` API entry. */
  isColumnRowGroupEnabled(colId: string): boolean {
    return this.columnDefsMap.get(colId)?.enableRowGroup === true;
  }

  /** Cycle 18 / Task 5 — `true` when the column's resolved colDef carries
   *  `enablePivot: true`. Gates whether the columns tool panel + context
   *  menu offer the "add as pivot" affordance. Mirrors the
   *  `isColumnRowGroupEnabled` shape; same class+API duality. */
  isColumnPivotEnabled(colId: string): boolean {
    return this.columnDefsMap.get(colId)?.enablePivot === true;
  }

  /** Cycle 18 / Task 5 — `true` when the column's resolved colDef carries
   *  `enableValue: true`. Gates whether the columns tool panel + context
   *  menu offer the "add as value/aggregation" affordance. */
  isColumnValueEnabled(colId: string): boolean {
    return this.columnDefsMap.get(colId)?.enableValue === true;
  }

  /** Cycle 18 / Task 7 — `true` when the column's resolved colDef would
   *  render in the body (i.e. `hide !== true`). Distinct from "currently
   *  paints" — a hidden column still rides `columnDefsMap` and
   *  `getColumnState()`. Gates the "Scroll to column" context-menu item:
   *  scrolling to a hidden column is a no-op. */
  isColumnVisible(colId: string): boolean {
    const def = this.columnDefsMap.get(colId);
    return def !== undefined && def.hide !== true;
  }

  /** Cycle 18 / Task 7 — names of every aggregation the "Value:
   *  Aggregate `<col>`" submenu offers. The built-in subset
   *  (`sum / avg / min / max / count`) plus any names registered via
   *  `CGridOptions.aggFuncs` / `setGridOption('aggFuncs', …)`. `first` /
   *  `last` are intentionally excluded — AG-Grid's value submenu omits
   *  them too (not aggregations, just array access). Read at menu-open
   *  time so a runtime `aggFuncs` swap takes effect on the next
   *  right-click without re-wiring. */
  getRegisteredAggFuncNames(): string[] {
    const out: string[] = ['sum', 'avg', 'min', 'max', 'count'];
    const custom = this.options.aggFuncs;
    if (custom) {
      for (const name of Object.keys(custom)) {
        if (!out.includes(name)) out.push(name);
      }
    }
    return out;
  }

  /** Cycle 15.5 / Task 2 (gap-fill) — expose the row-group-panel
   *  hit-test on the public CGridApi so external drag sources (columns
   *  tool panel column-list row drag) can route through the panel. */
  isPointInRowGroupPanel(clientX: number, clientY: number): boolean {
    return this.rowGroupPanel?.isPointInPanel(clientX, clientY) === true;
  }

  /** Cycle 15.5 / Task 2 (gap-fill) — forward external drag hover to
   *  the row group panel host. */
  setRowGroupPanelDragHover(colId: string | null, clientX: number, clientY: number): void {
    if (this.destroyed) return;
    this.rowGroupPanel?.setDragHover(colId, clientX, clientY);
  }

  /** Cycle 15.5 / Task 2 (gap-fill) — commit an external column-list
   *  drag drop into the row group panel. */
  commitRowGroupPanelDrop(colId: string): boolean {
    if (this.destroyed) return false;
    return this.rowGroupPanel?.handleColumnDrop(colId) ?? false;
  }

  /** Cycle 18 / Task 6 — `true` when the pivot panel is mounted AND
   *  the viewport-coord point `(clientX, clientY)` falls inside its
   *  DOM rect AND the panel currently accepts drops. */
  isPointInPivotPanel(clientX: number, clientY: number): boolean {
    return this.pivotPanel?.isPointInPanel(clientX, clientY) === true;
  }

  /** Cycle 18 / Task 6 — forward an external drag hover to the pivot
   *  panel host. */
  setPivotPanelDragHover(colId: string | null, clientX: number, clientY: number): void {
    if (this.destroyed) return;
    this.pivotPanel?.setDragHover(colId, clientX, clientY);
  }

  /** Cycle 18 / Task 6 — commit an external column drag drop into the
   *  pivot panel. */
  commitPivotPanelDrop(colId: string): boolean {
    if (this.destroyed) return false;
    return this.pivotPanel?.handleColumnDrop(colId) ?? false;
  }

  /** True when (clientX, clientY) falls within the leaf column-header
   *  band of the canvas.  Used by external drag sources (e.g. the
   *  Columns tool panel) to decide whether the cursor is hovering
   *  over the column-header strip. */
  isPointInColumnHeaderBand(clientX: number, clientY: number): boolean {
    if (this.destroyed) return false;
    const rect = this.cgridCanvas.canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) return false;
    const leaf = this.viewport.visibleRows.find(
      (r) => !r.subgrid.isData && !('getGroupIdAt' in r.subgrid),
    );
    const leafTop = leaf ? leaf.top : 0;
    const leafHeight = this.options.headerHeight ?? this.theme.headerHeight;
    const top = rect.top + leafTop;
    return clientY >= top && clientY <= top + leafHeight;
  }

  /** Inform the column header band of an external drag hover.  Paints
   *  an insertion line at the nearest column gap.  Pass `colId=null`
   *  to clear (e.g. on drag-end or drag-leave). */
  setColumnHeaderDragHover(colId: string | null, clientX: number, clientY: number): void {
    if (this.destroyed) return;
    if (colId === null) {
      if (this.colDropInsertionLine) this.colDropInsertionLine.style.display = 'none';
      return;
    }
    const rect = this.cgridCanvas.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const ids = this.allColIdsInRenderOrder();
    if (!ids.length) return;
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ids.length; i++) {
      const col = this.viewport.visibleColumns.find((c) => c.colId === ids[i]);
      if (!col) continue;
      const center = col.left + col.width / 2;
      const dist = Math.abs(x - center);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    const targetId = ids[bestIdx];
    const targetCol = targetId
      ? this.viewport.visibleColumns.find((c) => c.colId === targetId)
      : null;
    let lineX = 0;
    if (targetCol) {
      const center = targetCol.left + targetCol.width / 2;
      lineX = x >= center ? targetCol.left + targetCol.width - 1 : targetCol.left;
    }
    if (!this.colDropInsertionLine) {
      const line = document.createElement('div');
      line.className = 'cg-column-drag-insertion-line';
      line.style.cssText = [
        'position:absolute',
        'pointer-events:none',
        'top:0',
        'left:0',
        'width:2px',
        'height:100%',
        'background:var(--cg-selected-cell-color, #3b82f6)',
        'z-index:6',
        'will-change:transform',
      ].join(';');
      this.editorContainer.appendChild(line);
      this.colDropInsertionLine = line;
    }
    this.colDropInsertionLine.style.display = '';
    this.colDropInsertionLine.style.transform = `translate3d(${Math.round(lineX)}px, 0px, 0)`;
  }

  /** Commit an external column drop onto the column-header area.
   *  Moves `colId` to the nearest legal column index at `clientX`. */
  commitColumnHeaderDrop(colId: string, clientX: number): void {
    if (this.destroyed) return;
    if (this.colDropInsertionLine) this.colDropInsertionLine.style.display = 'none';
    const rect = this.cgridCanvas.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const ids = this.allColIdsInRenderOrder();
    if (!ids.length) return;
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ids.length; i++) {
      const col = this.viewport.visibleColumns.find((c) => c.colId === ids[i]);
      if (!col) continue;
      const center = col.left + col.width / 2;
      const dist = Math.abs(x - center);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    this.reorderColumn(colId, bestIdx, 'uiColumnDragged');
  }

  /** Cycle 15 / Task 6 — runtime swap of `rowGroupPanelShow`. When
   *  the option mutates via `setGridOption`, this method either
   *  mounts a fresh host (transition from `'never'`), unmounts the
   *  current one (transition to `'never'`), or hands the new mode
   *  to the existing host. */
  private updateRowGroupPanelShow(show: 'always' | 'onlyWhenGrouping' | 'never' | undefined): void {
    if (this.destroyed) return;
    const next = normalizeRowGroupPanelShow(show);
    if (next === null) {
      this.rowGroupPanel?.destroy();
      this.rowGroupPanel = null;
      return;
    }
    if (this.rowGroupPanel) {
      this.rowGroupPanel.setShowMode(next);
      return;
    }
    const ctx: RowGroupPanelGridContext = this.makeRowGroupPanelContext();
    this.rowGroupPanel = new RowGroupPanelHost(
      this.root,
      ctx,
      next,
      this.groupingState.getRowGroupColumns(),
      this.groupingState.getPerLevelSort(),
      { suppressSort: this.options.rowGroupPanelSuppressSort === true },
    );
    this.setRowGroupPanelTop(this.statusBarInsets.top);
  }

  /** Cycle 18 / Task 6 — runtime swap of `pivotPanelShow`. When the
   *  option mutates via `setGridOption`, this method either mounts a
   *  fresh host (transition from `'never'`), unmounts the current one
   *  (transition to `'never'`), or hands the new mode to the existing
   *  host. */
  /** Cycle 18 / Task 8a — forward the runtime cap to the worker.
   *  Pure pass-through: the worker validates (negative / non-finite
   *  revert to default) and the next `getViewport` honors the new cap. */
  private updatePivotMaxGeneratedColumns(cap: number | undefined): void {
    if (this.destroyed) return;
    this.workerClient.setPivotMaxGeneratedColumns(cap)
      .then(() => {
        if (!this.destroyed) this.requestViewport();
      })
      .catch((err) => {
        if (!this.destroyed) console.error('[cgrid] setPivotMaxGeneratedColumns:', err);
      });
  }

  /** Cycle 18 / Task 8e — re-synthesize the pivot columns so the new
   *  totals position lands on the next chunk. The signature comparison
   *  inside `maybeSyncPivotColumns` already folds the totals options
   *  in, so a single `requestViewport` triggers re-synthesis on the
   *  reply. */
  private updatePivotTotalsOption(): void {
    if (this.destroyed) return;
    // pivotGrandTotals can toggle the TotalsSubgrid in/out of the stack
    // (when pivot is active) — rebuild so the visible row count changes
    // on the next paint, not just the synthesized columns.
    this.rebuildSubgridStack();
    this.recomputeViewport();
    this.requestViewport();
  }

  /** Cycle 18 / Task 8c — flip the strict-order flag at runtime.
   *  The next `getViewport` honors the new behaviour. */
  private updateStrictPivotColumnOrder(strict: boolean | undefined): void {
    if (this.destroyed) return;
    this.workerClient.setStrictPivotColumnOrder(strict === true)
      .then(() => {
        if (!this.destroyed) this.requestViewport();
      })
      .catch((err) => {
        if (!this.destroyed) console.error('[cgrid] setStrictPivotColumnOrder:', err);
      });
  }

  private updatePivotPanelShow(show: 'always' | 'onlyWhenPivoting' | 'never' | undefined): void {
    if (this.destroyed) return;
    const next = normalizePivotPanelShow(show);
    if (next === null) {
      this.pivotPanel?.destroy();
      this.pivotPanel = null;
      return;
    }
    if (this.pivotPanel) {
      this.pivotPanel.setShowMode(next);
      return;
    }
    const ctx: PivotPanelGridContext = this.makePivotPanelContext();
    this.pivotPanel = new PivotPanelHost(
      this.root,
      ctx,
      next,
      this.pivotState.getPivotColumns(),
    );
    this.setPivotPanelTop(this.statusBarInsets.top);
  }

  /** Cycle 18 / Task 6 — build the per-host context object shared by
   *  the construction-time path and the runtime-show-flip path. Every
   *  primitive mutation routes through `pivotState`; the
   *  `pivotStateChanged` handler downstream lands the model swap on
   *  the worker. */
  private makePivotPanelContext(): PivotPanelGridContext {
    return {
      setReservedSpace: (side, height) => this.reservePivotPanelSpace(side, height),
      getHeaderName: (colId) => this.columnDefsMap.get(colId)?.headerName,
      isColumnPivotEnabled: (colId) =>
        this.columnDefsMap.get(colId)?.enablePivot === true,
      addPivotColumn: (colId) => this.pivotState.addPivotColumn(colId),
      removePivotColumn: (colId) => this.pivotState.removePivotColumn(colId),
      movePivotColumn: (from, to) => this.pivotState.movePivotColumn(from, to),
      isPivotActive: () => this.pivotState.isPivotActive(),
    };
  }

  /** Cycle 15.5 / Task 1 — build the per-host context object shared by
   *  the construction-time path and the runtime-show-flip path. Routes
   *  every primitive mutation through `groupingState`; the
   *  `groupingStateChanged` handler downstream lands the model swap
   *  on the worker. */
  private makeRowGroupPanelContext(): RowGroupPanelGridContext {
    return {
      setReservedSpace: (side, height) => this.reserveRowGroupPanelSpace(side, height),
      getHeaderName: (colId) => this.columnDefsMap.get(colId)?.headerName,
      isColumnRowGroupEnabled: (colId) =>
        this.columnDefsMap.get(colId)?.enableRowGroup === true,
      addRowGroupColumn: (colId) => this.groupingState.addRowGroupColumn(colId),
      removeRowGroupColumn: (colId) => this.groupingState.removeRowGroupColumn(colId),
      moveRowGroupColumn: (from, to) => this.groupingState.moveRowGroupColumn(from, to),
      setRowGroupColumnSort: (colId, direction) =>
        this.groupingState.setRowGroupColumnSort(colId, direction),
    };
  }

  /** Cycle 15.5 / Task 1 — `groupingStateChanged` handler. When the
   *  ordered column list changes (`source: 'set' | 'add' | 'remove' |
   *  'move'`), ship a `setGroupModel` round-trip to the worker so the
   *  visible chunk reflects the new grouping.
   *
   *  Cycle 15.5 / Task 9 gap-fill — a pure sort change (`source: 'sort'`)
   *  now drives a real re-order: the per-level group sort is translated
   *  into the worker sort model, and `SortPass.applyGrouped` re-sorts each
   *  group level by the sort entry targeting that level's grouping column.
   *  Both entry points (the public `setRowGroupColumnSort` API and the
   *  row group panel pill chevron) funnel through here, so both re-order.
   *
   *  The panel host re-renders via `setGroupingState` so the updated chip
   *  + indicator paint immediately. */
  private handleGroupingStateChanged(e: GroupingStateChangedEvent): void {
    if (this.destroyed) return;
    this.rowGroupPanel?.setGroupingState(e.rowGroupColumns, e.perLevelSort);
    if (e.source === 'sort') {
      // Translate the per-level group sort into the worker sort model.
      // Rebuild the group-column entries from `perLevelSort` (in nesting
      // order so the outer level sorts first), preserving any leaf-column
      // sort entries already present in the model.
      const groupColSet = new Set(e.rowGroupColumns);
      const nonGroupSort = this.sortModel.filter((s) => !groupColSet.has(s.colId));
      const groupSort: SortModel = [];
      e.rowGroupColumns.forEach((colId, i) => {
        const entry = e.perLevelSort[i];
        if (entry) groupSort.push({ colId, direction: entry.direction });
      });
      this.setSortModel([...groupSort, ...nonGroupSort]);
    } else {
      const sameOrder = this.groupModel.rowGroupCols.length === e.rowGroupColumns.length
        && this.groupModel.rowGroupCols.every((c, i) => c === e.rowGroupColumns[i]);
      if (!sameOrder) {
        this.setGroupModel({ rowGroupCols: [...e.rowGroupColumns] });
      }
    }
    // Cycle 15.5 / Task 2 — fan the change out as a public event so
    // the columns tool panel's Row Groups drop zone (and any other
    // subscriber) re-renders. The event carries the same source verb
    // GroupingState emitted so subscribers can branch (e.g. ignore
    // pure sort decoration when they only mirror membership).
    this.events.emit({
      type: 'columnRowGroupChanged',
      columns: [...e.rowGroupColumns],
      source: e.source,
    });
  }

  /** Resolve `rowId` to its current visible-row index via the worker, then
   *  scroll it into view. No-op when the row is unknown / filtered out. */
  async ensureRowVisible(rowId: string, position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto'): Promise<void> {
    if (this.destroyed) return;
    const idx = await this.workerClient.getRowIndexForId(rowId);
    if (this.destroyed) return;
    if (idx < 0) return;
    this.ensureRowIndexVisible(idx, position);
  }

  /** Scroll `colId` into view. Pinned columns + unknown IDs are no-ops. */
  ensureColumnVisible(colId: string, position: 'auto' | 'start' | 'middle' | 'end' = 'auto'): void {
    this.ensureColIdVisible(colId, position);
  }

  /** Open ancestor groups + the target group, then scroll the group's first
   *  leaf into view. Unknown groupIds are no-ops. */
  ensureColumnGroupVisible(groupId: string, position: 'auto' | 'start' | 'middle' | 'end' = 'auto'): void {
    const group = this.columnTree.groupById.get(groupId);
    if (!group) return;
    const ancestors = this.findGroupAncestors(groupId);
    const entries = ancestors.map((id) => ({ groupId: id, open: true }));
    entries.push({ groupId, open: true });
    this.columnGroupState.apply(entries);
    const firstLeaf = group.leafColIds[0];
    if (!firstLeaf) return;
    this.ensureColIdVisible(firstLeaf, position);
  }

  getSelectedRowIds(): string[] {
    // Prefer the persistent id set populated by `setSelectedRowIds(...)`. When
    // selection came from UI clicks the persistent set is empty — fall back to
    // synthetic `row-${idx}` ids so existing callers (e.g. demo's status bar)
    // keep working. The real index → rowId reverse lookup is deferred to a
    // later cycle when the chunk carries string rowIds.
    const persistent = this.selection.getPersistentSelectedRowIds();
    if (persistent.length > 0) return persistent;
    const out: string[] = [];
    for (const idx of this.selection.state.selectedRowIndices) {
      const id = this.rowIdAt(idx);
      if (id) out.push(id);
    }
    return out;
  }

  /** Replace the current selection with `ids`. Resolves each id to a visible
   *  row index via the worker, paints the rows that resolve, and stashes the
   *  full id set so a later sort / filter / transaction rebuilds the paint
   *  indices instead of dropping the selection. Triggers `selectionChanged`. */
  /** Conventional / ag-grid parity — Delete keyboard shortcut entry
   *  point. Clears every cell in every active range by emitting one
   *  `applyTransaction({ update })`. No-op when no ranges exist or
   *  the grid is destroyed. Per-column `valueSetter` is honored so
   *  apps that virtualise their value-write surface keep that
   *  invariant. */
  clearSelectedCells(): void {
    if (this.destroyed) return;
    const ranges = this.selection.getRanges();
    if (ranges.length === 0) return;
    // Map of rowIndex → set of colIds to clear. Built first so a cell
    // that sits in multiple overlapping ranges is only cleared once.
    const byRow = new Map<number, Set<string>>();
    for (const range of ranges) {
      for (let r = range.rowStart; r <= range.rowEnd; r++) {
        let set = byRow.get(r);
        if (!set) { set = new Set(); byRow.set(r, set); }
        for (const colId of range.colIds) set.add(colId);
      }
    }
    const rowIndices = Array.from(byRow.keys());
    Promise.all(rowIndices.map((rowIndex) =>
      this.workerClient.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
    )).then((results) => {
      if (this.destroyed) return;
      const updates: TRow[] = [];
      for (const { rowIndex, fetched } of results) {
        if (!fetched.rowId || fetched.data == null) continue;
        const rowData = fetched.data as Record<string, unknown>;
        const colsToClear = byRow.get(rowIndex)!;
        for (const colId of colsToClear) {
          const def = this.columnDefsMap.get(colId);
          if (!def) continue;
          if (def.valueSetter) {
            const field = def.field as string | undefined;
            const oldValue = field !== undefined ? rowData[field] : undefined;
            def.valueSetter({
              data: rowData as TRow, newValue: null, oldValue, colDef: def as any,
            });
          } else if (def.field !== undefined) {
            rowData[def.field as string] = null;
          }
        }
        updates.push(rowData as TRow);
      }
      if (updates.length > 0) this.applyTransaction({ update: updates });
    }).catch((err) => {
      if (!this.destroyed) console.error('[cgrid] clearSelectedCells:', err);
    });
  }

  /** Conventional / ag-grid parity — Ctrl+D / Cmd+D entry point. The
   *  TOP row of every multi-row range copies its values into the
   *  range's other rows. Per-column `valueSetter` is honored. */
  fillDown(): void {
    if (this.destroyed) return;
    const ranges = this.selection.getRanges();
    const multi = ranges.filter((r) => r.rowEnd > r.rowStart);
    if (multi.length === 0) return;
    // For each multi-row range, snapshot the top row's values then
    // build the update set for the remaining rows. Read sources
    // synchronously from the visible chunk (the source row is by
    // definition inside the selected range, which is currently
    // visible — otherwise the user couldn't have selected it).
    const allUpdates: Promise<TRow[]>[] = multi.map((range) => {
      const sourceValuesByCol = new Map<string, unknown>();
      for (const colId of range.colIds) {
        const cell = this.cellAt(range.rowStart, colId);
        sourceValuesByCol.set(colId, cell ? cell.value : null);
      }
      const targetRows: number[] = [];
      for (let r = range.rowStart + 1; r <= range.rowEnd; r++) targetRows.push(r);
      return Promise.all(targetRows.map((rowIndex) =>
        this.workerClient.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
      )).then((results) => {
        const updates: TRow[] = [];
        for (const { fetched } of results) {
          if (!fetched.rowId || fetched.data == null) continue;
          const rowData = fetched.data as Record<string, unknown>;
          for (const colId of range.colIds) {
            const def = this.columnDefsMap.get(colId);
            if (!def) continue;
            const newValue = sourceValuesByCol.get(colId);
            if (def.valueSetter) {
              const field = def.field as string | undefined;
              const oldValue = field !== undefined ? rowData[field] : undefined;
              def.valueSetter({
                data: rowData as TRow, newValue, oldValue, colDef: def as any,
              });
            } else if (def.field !== undefined) {
              rowData[def.field as string] = newValue;
            }
          }
          updates.push(rowData as TRow);
        }
        return updates;
      });
    });
    Promise.all(allUpdates).then((batches) => {
      if (this.destroyed) return;
      const flat = batches.flat();
      if (flat.length > 0) this.applyTransaction({ update: flat });
    }).catch((err) => {
      if (!this.destroyed) console.error('[cgrid] fillDown:', err);
    });
  }

  /** Cycle 24 / Task 1 — Ctrl+A keyboard shortcut entry point. Selects
   *  every visible row when `rowSelection: 'multiple'` is in effect;
   *  no-op for `'none'` / `'single'` modes (single-mode selection
   *  semantics are inconsistent with a bulk select). */
  selectAll(): void {
    if (this.destroyed) return;
    if (this.selection.getMode() !== 'multiple') return;
    if (this.rowCount <= 0) return;
    this.selection.range(0, this.rowCount - 1);
  }

  /** Row-select header checkbox toggle. Selects every visible row
   *  when none-or-some are selected; clears the selection when ALL
   *  are. Wired from the header click handler on columns declaring
   *  `headerCheckboxSelection: true`. */
  toggleHeaderCheckbox(_colId: string): void {
    if (this.destroyed) return;
    if (this.selection.getMode() !== 'multiple') return;
    if (this.rowCount <= 0) return;
    const allSelected = this.selection.state.selectedRowIndices.size === this.rowCount;
    if (allSelected) this.selection.clear();
    else this.selection.range(0, this.rowCount - 1);
  }

  setSelectedRowIds(ids: string[]): void {
    if (this.destroyed) return;
    if (ids.length === 0) {
      this.selection.setSelectedRowIds([], []);
      return;
    }
    this.workerClient.getRowIndicesForIds(ids).then((indices) => {
      if (this.destroyed) return;
      this.selection.setSelectedRowIds(ids, Array.from(indices));
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid] setSelectedRowIds:', err); });
  }

  getFocusedCell(): { rowId: string; colId: string } | null {
    const { focusedRowIndex, focusedColId } = this.selection.state;
    if (focusedColId == null) return null;
    // Prefer the persistent rowId from an API-driven setFocusedCell. Falls
    // back to the synthetic id when focus came from a click — same caveat
    // as getSelectedRowIds.
    const persistent = this.selection.getPersistentFocusedRowId();
    if (persistent !== null) return { rowId: persistent, colId: focusedColId };
    if (focusedRowIndex == null) return null;
    const rowId = this.rowIdAt(focusedRowIndex);
    return rowId ? { rowId, colId: focusedColId } : null;
  }

  /** Focus the cell at (`rowId`, `colId`). Scrolls the row into view, then
   *  records both the persistent id and the paint index so subsequent re-sorts
   *  keep the focus on the same logical cell. No-op for unknown row / column.
   *  Observers see the change via `selectionChanged`. */
  setFocusedCell(rowId: string, colId: string): void {
    if (this.destroyed) return;
    if (!this.columnDefsMap.has(colId)) return;
    this.workerClient.getRowIndicesForIds([rowId]).then((idx) => {
      if (this.destroyed) return;
      const resolved = idx.length > 0 ? idx[0]! : -1;
      if (resolved >= 0) this.ensureRowIndexVisible(resolved);
      this.ensureColIdVisible(colId);
      this.selection.setFocusByRowId(rowId, colId, resolved);
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid] setFocusedCell:', err); });
  }

  /** Snapshot of the currently-selected cell ranges. Cycle 9 / Task 6. */
  getCellRanges(): SelectionRange[] {
    return this.selection.getRanges();
  }

  /** Append a range to the selection (disjoint-add). Cycle 9 / Task 6. */
  addCellRange(range: SelectionRange): void {
    if (this.destroyed) return;
    this.selection.addRange(range);
    // Programmatic mutation = instantaneous; both started + finished true.
    this.emitRangeSelectionChanged(true, true);
  }

  /** Drop every range. Row selection + focused cell unaffected.
   *  Cycle 9 / Task 6. */
  clearCellRanges(): void {
    if (this.destroyed) return;
    const hadRanges = this.selection.getRanges().length > 0;
    this.selection.clearRanges();
    // No emit when the call was a no-op (already empty). `started: false`
    // because a clear is the END of a selection, not the START — there's
    // no anchor to drag from.
    if (hadRanges) this.emitRangeSelectionChanged(false, true);
  }

  /** Cycle 10 / Task 3 — TSV / CSV encode the current cell-range
   *  selection on the worker and forward the result to
   *  `navigator.clipboard.writeText`. Honors the runtime-mutable
   *  `clipboardDelimiter` (default `'\t'`). Rejects with `'no-ranges'`
   *  when nothing is selected; the keyboard handler swallows that
   *  rejection so the user doesn't see a console error for a stray
   *  Ctrl+C on an empty selection.
   *
   *  Resolves AFTER `clipboard.writeText` completes (so apps that await
   *  this method can immediately read back via `clipboard.readText`).
   *  Splits the work three ways: worker does the per-cell value lookup
   *  + RFC-4180 quoting + buffer joins (off the main thread); main
   *  does the clipboard write inside the caller's user-gesture stack. */
  async copySelectedRangesToClipboard(): Promise<void> {
    if (this.destroyed) return;
    // Cycle 10 / Task 6 — `suppressClipboardApi` rejects every clipboard
    // entry point before any work happens. Apps that ship their own
    // clipboard layer use this to take over without competing with the
    // worker round-trip + writeText path here. A one-time warn surfaces
    // the gate on first invocation (per method) so developers see the
    // wiring; subsequent rejections are silent.
    if (this.options.suppressClipboardApi === true) {
      this.warnClipboardSuppressed('copySelectedRangesToClipboard');
      throw new Error('clipboard-suppressed');
    }
    const ranges = this.getCellRanges();
    if (ranges.length === 0) throw new Error('no-ranges');
    const delimiter = this.options.clipboardDelimiter ?? '\t';
    // Cycle 10 / Task 5 — `processCellForClipboard` must run on the
    // main thread (apps reference DOM / domain state from the callback).
    // When the option is set, fetch the source rows here and run
    // `serializeRanges` main-side with the callback wired as
    // `transformCell`. Without the option, the worker still owns the
    // serialise hop (the perf-budgeted path).
    const transform = this.options.processCellForClipboard;
    const tsv = transform
      ? await this.serializeRangesMainSide(ranges, delimiter, transform)
      : await this.workerClient.clipboardSerialize(ranges, delimiter);
    // `navigator.clipboard.writeText` requires a user gesture in every
    // mainstream browser; the keyboard / menu handlers already run
    // inside one. Apps that invoke this from a `setTimeout` get a
    // rejected promise back — that's the expected platform behavior.
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      throw new Error('clipboard-unavailable');
    }
    await navigator.clipboard.writeText(tsv);
  }

  // ─── Cycle 20 / Task 3 — public export API ────────────────────────────

  /** Build the per-column metadata maps the worker needs (header
   *  names + type hints by colId). The worker doesn't keep its own
   *  copy of headerName / type, so we resolve here and ship. */
  private buildExportColumnMaps(): { headerNames: Record<string, string>; types: Record<string, 'text' | 'number'> } {
    const headerNames: Record<string, string> = {};
    const types: Record<string, 'text' | 'number'> = {};
    for (const leaf of this.columnTree.leaves) {
      headerNames[leaf.colId] = leaf.headerName ?? leaf.colId;
      // `cellDataType` is the canonical type hint on the resolved
      // column. Anything non-'number' falls back to 'text' in the
      // writer (numeric XLSX columns get `<c t="n">`).
      types[leaf.colId] = leaf.cellDataType === 'number' ? 'number' : 'text';
    }
    return { headerNames, types };
  }

  /** Resolve which export route to use. When any `process*Callback`
   *  is referenced, we fetch rows back to main and run the writer
   *  there so the callbacks (which can't postMessage to the worker)
   *  can fire. Otherwise we keep the worker-side fast path. */
  private hasExportCallback(params: ExportCsvParams | ExportExcelParams): boolean {
    return Boolean(
      (params as ExportCsvParams).processCellCallback
      || (params as ExportCsvParams).processHeaderCallback,
    );
  }

  /** Apply the resolved cell/header callbacks main-side and serialise
   *  through the matching writer. Returns the bytes. */
  private async exportViaMainSide(
    format: 'csv' | 'xlsx',
    params: ExportCsvParams | ExportExcelParams,
  ): Promise<Uint8Array> {
    const { headerNames, types } = this.buildExportColumnMaps();
    const callbacks = this.options.exportCallbacks ?? {};
    const cellCb = callbacks[(params as ExportCsvParams).processCellCallback ?? ''];
    const headerCb = callbacks[(params as ExportCsvParams).processHeaderCallback ?? ''];
    const rows = await this.workerClient.getExportRows({
      selectedRowIds: params.onlySelected ? this.getSelectedRowIds() : undefined,
    });

    // Build column list, mapping each header through `headerCb` once.
    const cols = this.columnTree.leaves.map((leaf) => ({
      colId: leaf.colId,
      field: (leaf as { field?: string }).field ?? leaf.colId,
      headerName: headerCb
        ? String(headerCb({
            value: headerNames[leaf.colId] ?? leaf.colId,
            colId: leaf.colId,
            kind: 'header' as const,
          }))
        : (headerNames[leaf.colId] ?? leaf.colId),
      type: types[leaf.colId] ?? 'text' as const,
    }));

    // Transform per-cell when `cellCb` is configured. We mutate a
    // fresh copy per row so the worker's row store isn't disturbed.
    const transformedRows = cellCb
      ? rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const c of cols) {
            out[c.field] = cellCb({
              value: row[c.field],
              colId: c.colId,
              kind: 'cell',
              node: row,
            });
          }
          return out;
        })
      : rows;

    if (format === 'csv') {
      const { writeCsv } = await import('./worker/export/csv');
      return writeCsv(transformedRows, cols, params as ExportCsvParams);
    }
    const { writeXlsx } = await import('./worker/export/xlsx');
    return writeXlsx(transformedRows, cols, params as ExportExcelParams);
  }

  /** Return the current data as a CSV string. Worker-side serialization
   *  when no callback is set; main-side serialization when one is. */
  async getDataAsCsv(params: ExportCsvParams = {}): Promise<string> {
    if (this.destroyed) return '';
    if (this.hasExportCallback(params)) {
      const bytes = await this.exportViaMainSide('csv', params);
      return new TextDecoder('utf-8').decode(bytes);
    }
    const { headerNames, types } = this.buildExportColumnMaps();
    const buffer = await this.workerClient.exportData({
      format: 'csv',
      headerNames,
      types,
      options: params as unknown as Record<string, unknown>,
      selectedRowIds: params.onlySelected ? this.getSelectedRowIds() : undefined,
    });
    return new TextDecoder('utf-8').decode(buffer);
  }

  /** Export the current data as CSV + trigger a browser download. */
  async exportDataAsCsv(params: ExportCsvParams = {}): Promise<void> {
    if (this.destroyed) return;
    let buffer: ArrayBuffer;
    if (this.hasExportCallback(params)) {
      const bytes = await this.exportViaMainSide('csv', params);
      // Copy out of the writer's possibly-shared scratch into an owned ArrayBuffer.
      buffer = bytes.slice().buffer as ArrayBuffer;
    } else {
      const { headerNames, types } = this.buildExportColumnMaps();
      buffer = await this.workerClient.exportData({
        format: 'csv',
        headerNames,
        types,
        options: params as unknown as Record<string, unknown>,
      });
    }
    triggerDownload(buffer, params.fileName ?? 'export.csv', 'text/csv;charset=utf-8');
  }

  /** Return the current data as an XLSX `Blob`. */
  async getDataAsExcel(params: ExportExcelParams = {}): Promise<Blob> {
    if (this.destroyed) return new Blob([]);
    if (this.hasExportCallback(params)) {
      const bytes = await this.exportViaMainSide('xlsx', params);
      return new Blob([bytes.slice().buffer as ArrayBuffer], { type: XLSX_MIME });
    }
    const { headerNames, types } = this.buildExportColumnMaps();
    const buffer = await this.workerClient.exportData({
      format: 'xlsx',
      headerNames,
      types,
      options: params as unknown as Record<string, unknown>,
      selectedRowIds: params.onlySelected ? this.getSelectedRowIds() : undefined,
    });
    return new Blob([buffer], { type: XLSX_MIME });
  }

  /** Export the current data as XLSX + trigger a browser download. */
  async exportDataAsExcel(params: ExportExcelParams = {}): Promise<void> {
    if (this.destroyed) return;
    let buffer: ArrayBuffer;
    if (this.hasExportCallback(params)) {
      const bytes = await this.exportViaMainSide('xlsx', params);
      buffer = bytes.slice().buffer as ArrayBuffer;
    } else {
      const { headerNames, types } = this.buildExportColumnMaps();
      buffer = await this.workerClient.exportData({
        format: 'xlsx',
        headerNames,
        types,
        options: params as unknown as Record<string, unknown>,
      });
    }
    triggerDownload(buffer, params.fileName ?? 'export.xlsx', XLSX_MIME);
  }

  /** Cycle 10 / Task 5 — main-side serialise used when
   *  `processCellForClipboard` is configured. Batches `getRowByIndex`
   *  for every unique row in `ranges` so the callback sees the row's
   *  current `data` (matches ag-grid). Wraps the user callback in the
   *  `SerializeCellTransform` shape (`{ value, node, column }`) and
   *  hands off to the same pure `serializeRanges` the worker uses, so
   *  RFC-4180 quoting + delimiter + disjoint-range layout stay in
   *  exactly one place. */
  private async serializeRangesMainSide(
    ranges: SelectionRange[],
    delimiter: string,
    transform: NonNullable<CGridOptions<TRow>['processCellForClipboard']>,
  ): Promise<string> {
    // Collect every visible row index touched by any range; batch-fetch
    // the rows in one Promise.all to keep the worker round-trips parallel.
    const rowIndexSet = new Set<number>();
    for (const range of ranges) {
      for (let i = range.rowStart; i <= range.rowEnd; i++) rowIndexSet.add(i);
    }
    const indexArr = Array.from(rowIndexSet);
    const fetched = await Promise.all(indexArr.map((rowIndex) =>
      this.workerClient.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
    ));
    if (this.destroyed) return '';
    // Build the sparse `rows` array `serializeRanges` consumes — keyed
    // by visible-row index, with `undefined` for rows past the bottom
    // (the pure function treats those as a row of blank cells).
    const rows: Array<Record<string, unknown> | undefined> = [];
    for (const r of fetched) {
      if (r.data != null) rows[r.rowIndex] = r.data as Record<string, unknown>;
    }
    const columnsById = new Map<string, { field?: string }>();
    for (const def of this.columnOrder) {
      columnsById.set(def.colId, { field: def.field as string | undefined });
    }
    return serializeRangesPure(rows, columnsById, ranges, delimiter, (params) =>
      transform({
        value: params.value,
        node: { rowIndex: params.node.rowIndex, data: params.node.data as TRow },
        column: { colId: params.column.colId },
      }),
    );
  }

  /** Cycle 10 / Task 4 — read the system clipboard, parse the payload on
   *  the worker, and apply via `applyTransaction({ update })` rooted at
   *  the focused cell. Resolves quietly (no throw) when the paste is a
   *  semantic no-op:
   *  - no cell is focused
   *  - clipboard is empty
   *  - parsed grid covers no rows / cells
   *
   *  Rejects when `navigator.clipboard.readText` rejects (no gesture,
   *  permission denied, insecure context without a polyfill).
   *
   *  Anchor algorithm: the parsed `string[][]` is positioned with its
   *  (0, 0) cell at the focused cell. For each parsed row `r` we
   *  resolve the target row at visible index `focusedRowIndex + r`
   *  (via `workerClient.getRowByIndex`, mirroring Cycle 9 / Task 5's
   *  fill handle); for each parsed cell `c` we write into the visible
   *  column at index `focusedColIndex + c` in `this.columnOrder`. Rows
   *  past the bottom or columns past the right edge are silently
   *  dropped — paste never inserts rows / columns. */
  async pasteFromClipboard(): Promise<void> {
    if (this.destroyed) return;
    // Cycle 10 / Task 6 — `suppressClipboardApi` rejects (apps own the
    // surface); `suppressClipboardPaste` silently no-ops (paste is
    // disabled but copy / cut still work). API wins over paste-only —
    // an app gating both still gets the clearer rejection.
    if (this.options.suppressClipboardApi === true) {
      this.warnClipboardSuppressed('pasteFromClipboard');
      throw new Error('clipboard-suppressed');
    }
    if (this.options.suppressClipboardPaste === true) return;
    const focusedRowIndex = this.selection.state.focusedRowIndex;
    const focusedColId = this.selection.state.focusedColId;
    if (focusedRowIndex === null || focusedColId === null) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      throw new Error('clipboard-unavailable');
    }
    const text = await navigator.clipboard.readText();
    if (text === '') return;
    const delimiter = this.options.clipboardDelimiter ?? '\t';
    const parsed = await this.workerClient.clipboardDeserialize(text, delimiter);
    if (parsed.length === 0) return;
    // Resolve the focused column's render-order index. When the focused
    // column has been hidden between the focus event and the paste,
    // we drop back to "no anchor" → no-op.
    const focusedColIdx = this.columnOrder.findIndex((c) => c.colId === focusedColId);
    if (focusedColIdx === -1) return;
    // Fetch every target row via the worker so the update set ships full
    // TRow objects (RowStore.apply REPLACES rows by id; the unchanged
    // fields must be present on the update payload). Off-bottom rows
    // (rowIndex >= rowCount) skip — the worker returns rowId === null.
    const targetRowIndices: number[] = [];
    for (let r = 0; r < parsed.length; r++) targetRowIndices.push(focusedRowIndex + r);
    const fetches = targetRowIndices.map((rowIndex) =>
      this.workerClient.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
    );
    const results = await Promise.all(fetches);
    if (this.destroyed) return;
    // Cycle 10 / Task 5 — `processCellFromClipboard` transforms each
    // parsed string AFTER worker parse + BEFORE the per-cell write. Runs
    // on the main thread for the same reason copy's transform does. We
    // pre-compute the transformed values via the pure `mapPasteCells`
    // helper so the loop below is a straight write per cell. Without the
    // option, `transformedRows` is `null` and we use the raw parsed
    // strings — keeps the no-callback path allocation-free.
    const transform = this.options.processCellFromClipboard;
    let transformedRows: Array<Array<unknown>> | null = null;
    if (transform) {
      const rowDataByIndex = new Map<number, unknown>();
      for (const r of results) {
        if (r.fetched.data != null) rowDataByIndex.set(r.rowIndex, r.fetched.data);
      }
      const visibleColIds = this.columnOrder.map((c) => c.colId);
      transformedRows = mapPasteCells(
        parsed,
        focusedRowIndex,
        focusedColIdx,
        visibleColIds,
        rowDataByIndex,
        (params) => transform({
          value: params.value,
          node: { rowIndex: params.node.rowIndex, data: params.node.data as TRow },
          column: { colId: params.column.colId },
        }),
      );
    }
    const updates: TRow[] = [];
    for (let i = 0; i < results.length; i++) {
      const fetched = results[i]!.fetched;
      if (!fetched.rowId || fetched.data == null) continue;
      const rowData = fetched.data as Record<string, unknown>;
      const parsedRow = parsed[i]!;
      const transformedRow = transformedRows?.[i];
      for (let c = 0; c < parsedRow.length; c++) {
        const targetColIdx = focusedColIdx + c;
        if (targetColIdx >= this.columnOrder.length) break;
        const def = this.columnOrder[targetColIdx]!;
        const newValue: unknown = transformedRow !== undefined
          ? transformedRow[c]
          : parsedRow[c]!;
        if (def.valueSetter) {
          const field = def.field as string | undefined;
          const oldValue = field !== undefined ? rowData[field] : undefined;
          def.valueSetter({
            data: rowData as TRow, newValue, oldValue, colDef: def as any,
          });
        } else if (def.field) {
          rowData[def.field as string] = newValue;
        }
      }
      updates.push(rowData as TRow);
    }
    if (updates.length === 0) return;
    this.applyTransaction({ update: updates });
  }

  /** Cycle 10 / Task 5 — copy the current ranges to the system clipboard
   *  and clear the source cells in a single follow-up transaction.
   *  Atomicity: the copy fires first; only when its `writeText` resolves
   *  does the clear `applyTransaction({ update })` follow. If copy
   *  rejects (no ranges, clipboard unavailable, permission denied), the
   *  source cells stay untouched — there is no partial-cut state.
   *
   *  Cleared cells go through `valueSetter` when the column defines one
   *  (so apps with rich coercion see the empty string), falling back to
   *  a direct field assignment of `''`. Rows touched by multiple ranges
   *  are merged into one update entry per rowId so `applyTransaction`
   *  sees each row at most once. */
  async cutSelectedRanges(): Promise<void> {
    if (this.destroyed) return;
    // Cycle 10 / Task 6 — gate FIRST so the rejection error message is
    // `clipboard-suppressed` (clearer than the downstream rejection
    // `copySelectedRangesToClipboard` would emit with the same flag).
    // The dedup logic on `warnClipboardSuppressed` keeps the console
    // quiet when both paths fire back-to-back from a Ctrl+X loop.
    if (this.options.suppressClipboardApi === true) {
      this.warnClipboardSuppressed('cutSelectedRanges');
      throw new Error('clipboard-suppressed');
    }
    const ranges = this.getCellRanges();
    if (ranges.length === 0) throw new Error('no-ranges');
    // Copy first — atomicity hinges on this resolving before we touch
    // the data. Any rejection (`no-ranges`, `clipboard-unavailable`,
    // browser permission denial) propagates and the clear never fires.
    await this.copySelectedRangesToClipboard();
    if (this.destroyed) return;
    // Build the union of (rowIndex) across every range, fetch each row
    // once, and apply the clear in a single transaction. Multiple
    // ranges hitting the same row + different cols share the same row
    // object so the column-iteration step accumulates cleared fields.
    const rowIndexSet = new Set<number>();
    for (const range of ranges) {
      for (let i = range.rowStart; i <= range.rowEnd; i++) rowIndexSet.add(i);
    }
    const indexArr = Array.from(rowIndexSet);
    const fetched = await Promise.all(indexArr.map((rowIndex) =>
      this.workerClient.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
    ));
    if (this.destroyed) return;
    const byIndex = new Map<number, { rowId: string | null; data: unknown | null }>();
    for (const r of fetched) byIndex.set(r.rowIndex, { rowId: r.rowId, data: r.data });
    const updatesByRowId = new Map<string, TRow>();
    for (const range of ranges) {
      for (let ri = range.rowStart; ri <= range.rowEnd; ri++) {
        const entry = byIndex.get(ri);
        if (!entry || !entry.rowId || entry.data == null) continue;
        // Reuse the already-mutated rowData for ranges that touch the
        // same row — cleared fields accumulate across iterations.
        const existing = updatesByRowId.get(entry.rowId);
        const rowData = (existing ?? entry.data) as Record<string, unknown>;
        for (const colId of range.colIds) {
          const def = this.columnDefsMap.get(colId);
          if (!def) continue;
          if (def.valueSetter) {
            const field = def.field as string | undefined;
            const oldValue = field !== undefined ? rowData[field] : undefined;
            def.valueSetter({
              data: rowData as TRow, newValue: '', oldValue, colDef: def as any,
            });
          } else if (def.field) {
            rowData[def.field as string] = '';
          }
        }
        updatesByRowId.set(entry.rowId, rowData as TRow);
      }
    }
    if (updatesByRowId.size === 0) return;
    this.applyTransaction({ update: Array.from(updatesByRowId.values()) });
  }

  /** Cycle 10 / Task 6 — resolved `suppressClipboardPaste`. Reads the
   *  option live so a runtime `setGridOption('suppressClipboardPaste',
   *  true)` shows up immediately. Mirrors the boolean shape on
   *  `DefaultMenuGrid`. */
  isClipboardPasteSuppressed(): boolean {
    return this.options.suppressClipboardPaste === true;
  }

  /** Cycle 10 / Task 6 — emit a one-time `console.warn` per clipboard
   *  API method gated by `suppressClipboardApi`. Subsequent rejections
   *  from the same method stay silent so a Ctrl+C polling loop or a
   *  retry handler doesn't flood the console. */
  private warnClipboardSuppressed(method: string): void {
    if (this.clipboardSuppressedWarned.has(method)) return;
    this.clipboardSuppressedWarned.add(method);
    console.warn(`[cgrid] ${method} suppressed by suppressClipboardApi`);
  }

  /** Cycle 9 / Task 7 — fan `rangeSelectionChanged` out to listeners and
   *  drive the `cellSelectionChanged` debounce. Called from feature code
   *  (RangeSelection / FillHandle) at gesture start / mid / end, and from
   *  the programmatic mutation paths (`addCellRange`, `clearCellRanges`,
   *  `selectColumn`). The ranges snapshot is fresh on every call so
   *  listeners that retain the payload don't see later mutations.
   *  `cellSelectionChanged` fires only when `finished: true` AND the
   *  range set is actually different from the last finished emission. */
  private emitRangeSelectionChanged(started: boolean, finished: boolean): void {
    if (this.destroyed) return;
    const ranges = this.selection.getRanges();
    this.events.emit({ type: 'rangeSelectionChanged', ranges, started, finished });
    if (!finished) return;
    if (rangesEqual(ranges, this.lastEmittedCellSelectionRanges)) return;
    // Deep-clone so a later in-place mutation on the SelectionModel can't
    // false-equal the snapshot and silently suppress a future event.
    this.lastEmittedCellSelectionRanges = ranges.map((r) => ({
      rowStart: r.rowStart,
      rowEnd: r.rowEnd,
      colIds: r.colIds.slice(),
    }));
    this.events.emit({ type: 'cellSelectionChanged', ranges: this.selection.getRanges() });
  }

  refresh(): void { this.cgridCanvas.requestRepaint(); }

  /** Cycle 11 / Task 5 — re-render a mounted tool panel. Forwards to
   *  the live instance's `refresh()`; silent no-op when no side bar
   *  is configured, `id` is unknown, or the panel has never been
   *  opened (panels instantiate on open, destroy on close, so an
   *  unopened panel has no instance for `refresh()` to fire on). */
  refreshToolPanel(id: string): void {
    this.sideBar?.getInstance(id)?.refresh();
  }

  /** Cycle 11 / Task 5 — the live `ToolPanel` instance for `id`, or
   *  `null` when no side bar is configured, `id` is unknown, or the
   *  panel is registered but not currently mounted (e.g. user hasn't
   *  opened the tab yet, or just closed it). Built-in IDs
   *  (`agColumnsToolPanel`, `agFiltersToolPanel`) and custom IDs from
   *  `CGridOptions.components` are both reachable through this surface. */
  getToolPanelInstance(id: string): ToolPanel | null {
    return this.sideBar?.getInstance(id) ?? null;
  }

  /** Cycle 11 / Task 6 — `true` when the side bar is mounted AND
   *  visible (i.e. NOT in `display: none`). Returns `false` when no
   *  side bar is configured at all, when `hiddenByDefault: true`, or
   *  after `setSideBarVisible(false)`. */
  isSideBarVisible(): boolean {
    return this.sideBar?.isVisible() ?? false;
  }

  /** Cycle 11 / Task 6 — show or hide the whole side bar. Silent no-op
   *  when no side bar is configured. Triggers one canvas reflow on
   *  state change (the host's reserved-edge width drops to / restores
   *  from zero, which fans out through `reserveSideBarSpace`). */
  setSideBarVisible(show: boolean): void {
    this.sideBar?.setVisible(show);
  }

  /** Cycle 11 / Task 6 — move the side bar to the left or right edge.
   *  Silent no-op when no side bar is configured or when already on
   *  that edge. The host releases the old edge reservation + claims
   *  the new one in one synchronous resize. */
  setSideBarPosition(pos: 'left' | 'right'): void {
    this.sideBar?.setPosition(pos);
  }

  /** Cycle 11 / Task 6 — open the tool panel with the given id. Silent
   *  no-op when no side bar is configured or `id` is unknown. Closes
   *  any previously-open panel first (one-at-a-time). Built-in ids
   *  (`agColumnsToolPanel`, `agFiltersToolPanel`) and custom ids from
   *  `CGridOptions.components` both work. */
  openToolPanel(id: string): void {
    this.sideBar?.openPanel(id);
  }

  /** Cycle 11 / Task 6 — close whatever panel is currently open.
   *  Silent no-op when no side bar is configured or no panel is open.
   *  Destroys the live instance so panels don't leak listeners. */
  closeToolPanel(): void {
    this.sideBar?.closePanel();
  }

  /** Cycle 11 / Task 6 — the id of the currently open panel, or `null`
   *  when no panel is open / no side bar is configured. */
  getOpenedToolPanel(): string | null {
    return this.sideBar?.getOpenedToolPanelId() ?? null;
  }

  /** Cycle 11 / Task 6 — the resolved `SideBarDef` (string shortcuts
   *  expanded, `position` defaulted) currently driving the side bar,
   *  or `undefined` when no side bar was configured. The returned
   *  object reflects the LIVE def — `setSideBarPosition` mutations
   *  show up here. */
  getSideBar(): SideBarDef | undefined {
    return this.sideBar?.getSideBarDef();
  }

  /** Cycle 13 / Task 4 — the live `IStatusPanelComp` instance for
   *  `key`, or `undefined` when no status bar is configured, `key`
   *  is not in the bar's `statusPanels`, or the matching panel's
   *  `statusPanel` string never resolved to a registered component.
   *  Reaches through `StatusBarHost.getInstance(key)`; converts the
   *  host's `null` to `undefined` to match the public API surface
   *  (mirrors `getSideBar()`'s undefined-when-absent shape). Built-in
   *  keys (`agTotalRowCountComponent`, …) and custom keys registered
   *  via `CGridOptions.components` are both reachable here. */
  getStatusPanel<T extends IStatusPanelComp = IStatusPanelComp>(key: string): T | undefined {
    return (this.statusBar?.getInstance(key) as T | null | undefined) ?? undefined;
  }

  /** Cycle 11 / Task 2 — adjust the canvas region's left/right gutter
   *  to make room for the side bar. Called by `SideBarHost` on mount,
   *  open, close, position toggle, hide/show, and at the end of a
   *  resize-handle drag. Mutates the scroller's edge inset (so the
   *  native scrollbar gutter stays inside the visible region), the
   *  editor overlay's edge inset (so popups respect the canvas
   *  region), and the canvas element's offset (so a LEFT side bar
   *  shifts the canvas right by the gutter). One synchronous
   *  `cgridCanvas.resize()` repaints the new region. */
  private reserveSideBarSpace(side: 'left' | 'right', width: number): void {
    if (this.sideBarInsets[side] === width) return;
    this.sideBarInsets[side] = width;
    const { left, right } = this.sideBarInsets;
    this.scroller.style.left = `${left}px`;
    this.scroller.style.right = `${right}px`;
    this.editorContainer.style.left = `${left}px`;
    this.editorContainer.style.right = `${right}px`;
    // setHostBounds shifts the canvas element + triggers a resize() so
    // the backing store re-fits to the new clientWidth and the renderer
    // re-lays out columns + repaints in the same call. Skips when the
    // canvas hasn't been constructed yet (mount-time reservation that
    // lands before CGridCanvas finishes — guarded so a sideBar
    // constructed pre-canvas doesn't crash). Cycle 13 / Task 1 — the
    // current status-bar bottom reservation flows through the same
    // setHostBounds call so a side-bar reflow can't drop the bar inset.
    if (this.cgridCanvas) {
      // Cycle 15 / Task 6 + Cycle 18 / Task 6 — fold the status-bar
      // top + pivot-panel top + row-group-panel top contributions
      // through the same call so a side-bar reflow doesn't drop any
      // of the three insets.
      this.cgridCanvas.setHostBounds({
        left,
        top: this.statusBarInsets.top
          + this.pivotPanelTopInset
          + this.rowGroupPanelTopInset,
        bottom: this.statusBarInsets.bottom,
      });
    }
  }

  /** Cycle 13 / Task 1 — adjust the canvas region's top or bottom inset
   *  to make room for the status bar. Called by `StatusBarHost` on
   *  mount, setVisible, setPosition, def change, and destroy. Mutates
   *  the scroller's `top` / `bottom` style + the editor overlay's
   *  matching inset (so popups respect the canvas region) + calls
   *  `setHostBounds` so the canvas re-fits to the freshly-shrunken
   *  scroller. One synchronous `cgridCanvas.resize()` repaints the new
   *  region — the status bar never triggers a separate body repaint.
   *
   *  Cycle 15 / Task 6 — folds in the row group panel's contribution
   *  via `applyVerticalInsets` so a top-positioned status bar + a
   *  row group panel stack cleanly. */
  private reserveStatusBarSpace(side: StatusBarPosition, height: number): void {
    if (this.statusBarInsets[side] === height) return;
    this.statusBarInsets[side] = height;
    this.applyVerticalInsets();
  }

  /** Cycle 15 / Task 6 — adjust the canvas region's top inset to
   *  make room for the row group panel (the drop strip ABOVE the
   *  column headers). Called by `RowGroupPanelHost` on mount, show-
   *  mode change, chip-count change, and destroy. Combines with the
   *  status bar's top inset via `applyVerticalInsets`. */
  private reserveRowGroupPanelSpace(side: 'top', height: number): void {
    if (side !== 'top') return;
    if (this.rowGroupPanelTopInset === height) return;
    this.rowGroupPanelTopInset = height;
    this.applyVerticalInsets();
  }

  /** Cycle 18 / Task 6 — adjust the canvas region's top inset to
   *  make room for the pivot panel (the drop strip ABOVE the row
   *  group panel). Called by `PivotPanelHost` on mount, show-mode
   *  change, pill-count change, and destroy. Combines with the
   *  status bar + row group panel top insets via `applyVerticalInsets`. */
  private reservePivotPanelSpace(side: 'top', height: number): void {
    if (side !== 'top') return;
    if (this.pivotPanelTopInset === height) return;
    this.pivotPanelTopInset = height;
    this.applyVerticalInsets();
  }

  /** Cycle 15 / Task 6 — recompute and apply the combined top +
   *  bottom insets to the scroller, editor overlay, canvas host,
   *  and the row group panel's own top offset. Top inset is the
   *  sum of `statusBarInsets.top` + `pivotPanelTopInset` +
   *  `rowGroupPanelTopInset` so the visual order top-to-bottom is:
   *  status bar → pivot panel → row group panel → column headers →
   *  body. Bottom inset is `statusBarInsets.bottom` alone (no
   *  panel contribution). */
  private applyVerticalInsets(): void {
    const top = this.statusBarInsets.top
      + this.pivotPanelTopInset
      + this.rowGroupPanelTopInset;
    const bottom = this.statusBarInsets.bottom;
    this.scroller.style.top = `${top}px`;
    this.scroller.style.bottom = `${bottom}px`;
    this.editorContainer.style.top = `${top}px`;
    this.editorContainer.style.bottom = `${bottom}px`;
    if (this.cgridCanvas) {
      this.cgridCanvas.setHostBounds({
        left: this.sideBarInsets.left,
        top,
        bottom,
      });
    }
    // The side bar must start below the panels so the tab strip is not
    // visually occluded. Use the same `top` value as the scroller.
    this.sideBar?.setTopOffset(top);
    // The pivot panel sits at the status bar's top-inset (top of the
    // stack, just below any top status bar). The row group panel sits
    // BELOW the pivot panel — its top equals statusBar + pivotPanel.
    // Keeps stacking deterministic.
    if (this.pivotPanel) {
      this.setPivotPanelTop(this.statusBarInsets.top);
    }
    if (this.rowGroupPanel) {
      this.setRowGroupPanelTop(this.statusBarInsets.top + this.pivotPanelTopInset);
    }
  }

  /** Cycle 15 / Task 6 — set the row group panel's own `top`
   *  style. Called from `applyVerticalInsets` whenever the status
   *  bar's top inset changes (so the panel stays parked just below
   *  the top status bar) and once at construction. */
  private setRowGroupPanelTop(top: number): void {
    const el = this.root.querySelector('.cg-row-group-panel') as HTMLElement | null;
    if (el) el.style.top = `${top}px`;
  }

  /** Cycle 18 / Task 6 — set the pivot panel's own `top` style.
   *  Called from `applyVerticalInsets` whenever the status bar's
   *  top inset changes and once at construction. */
  private setPivotPanelTop(top: number): void {
    const el = this.root.querySelector('.cg-pivot-panel') as HTMLElement | null;
    if (el) el.style.top = `${top}px`;
  }

  /** Register a custom cell renderer. After registration, columns with
   *  `cellRenderer: name` (or whose `cellRendererSelector` returns
   *  `{ component: name }`) will dispatch to `painter`. Built-in names
   *  ('text', 'number', 'checkbox', 'header') can be overridden by
   *  re-registering; the override applies on the next repaint. */
  registerCellRenderer(name: string, painter: CellPainter): void {
    this.cellRenderers.register(name, painter);
    this.cgridCanvas?.requestRepaint();
  }

  /** Cycle 22 / Task 3 — runtime per-token override. Apps tune
   *  individual `--cg-*` variables without writing CSS; the patch
   *  lands as inline styles on the grid root so `getComputedStyle`
   *  resolves them ahead of the theme-class declarations. Pass `''`
   *  for a key to REMOVE the override (the token then falls back to
   *  the theme's declared value).
   *
   *  Side effects: one inline-style mutation per patched key, one
   *  `cssReader.read()`, one repaint. No worker round-trip. */
  setThemeParams(patch: Readonly<Record<string, string>>): void {
    themeParamsSet(this.root, patch);
    this.theme = this.cssReader.read();
    this.recomputeViewport();
    this.cgridCanvas.requestRepaint();
  }

  /** Cycle 22 / Task 3 — read the currently-set inline overrides. Returns
   *  ONLY the values set through `setThemeParams` — NOT the resolved
   *  tokens (call `getComputedStyle(grid.host)` for those). */
  getThemeParams(): Record<string, string> {
    return themeParamsGet(this.root);
  }

  setTheme(themeClass: string): void {
    const current = Array.from(this.root.classList).filter((c) => c.startsWith('cg-theme-'));
    current.forEach((c) => this.root.classList.remove(c));
    this.root.classList.add(themeClass);
    this.theme = this.cssReader.read();
    this.options.theme = themeClass;
    this.recomputeViewport();
    this.cgridCanvas.requestRepaint();
  }

  /** Cycle 22 / Task 2 — swap the density-mode class on the root.
   *  `null` / `undefined` removes any active density class entirely
   *  (back to the theme's native baseline). The CSS class flip is the
   *  only DOM mutation — `cssReader.read()` re-resolves the bundle's
   *  `--cg-row-height` / `--cg-header-height` / `--cg-cell-padding-x`
   *  overrides, and `recomputeViewport` + `requestRepaint` line the new
   *  row geometry up on the next frame. No worker round-trip. */
  setDensity(density: 'compact' | 'normal' | 'comfortable' | null | undefined): void {
    const current = Array.from(this.root.classList).filter((c) => c.startsWith('cg-density-'));
    current.forEach((c) => this.root.classList.remove(c));
    if (density) {
      this.root.classList.add(`cg-density-${density}`);
    }
    this.options.density = density ?? undefined;
    this.theme = this.cssReader.read();
    this.recomputeViewport();
    this.cgridCanvas.requestRepaint();
  }

  /** Read any grid option (runtime or initial). Mirrors ag-grid's
   *  `getGridOption` — useful for app code that needs to round-trip a setting. */
  getGridOption<K extends keyof CGridOptions<TRow>>(key: K): CGridOptions<TRow>[K] | undefined {
    return this.options[key];
  }

  /** Set a single runtime-mutable option. Throws when `key` is in
   *  `INITIAL_ONLY_OPTIONS` (e.g. `columnDefs`, `getRowId`, `worker`). The
   *  `columnDefs` mutation surface lives on `updateGridOptions` because it
   *  needs a coupled tree-rebuild + worker column-metadata swap. */
  setGridOption<K extends keyof CGridOptions<TRow>>(key: K, value: CGridOptions<TRow>[K]): void {
    if (INITIAL_ONLY_OPTIONS.has(key as keyof CGridOptions<any>)) {
      throw new Error(
        `[cgrid] '${String(key)}' is initial-only and cannot be changed at runtime` +
        (key === 'columnDefs' ? "; use api.updateGridOptions({ columnDefs }) instead" : ''),
      );
    }
    if (!isRuntimeOption(key as string)) {
      throw new Error(`[cgrid] '${String(key)}' is not a recognised runtime option`);
    }
    this.options[key] = value;
    applyRuntimeOption(this.runtimeTarget(), key as any, value);
  }

  /** Batch-update grid options. `columnDefs` is honored only via this
   *  entrypoint and rebuilds the column tree, refreshes the worker's column
   *  metadata, and preserves group state for IDs that survive the swap. */
  updateGridOptions(partial: Partial<CGridOptions<TRow>>): void {
    // Special-case columnDefs first so the tree rebuild happens once even when
    // both columnDefs AND defaultColDef change in the same call.
    if ('columnDefs' in partial && partial.columnDefs) {
      const newDefault = partial.defaultColDef ?? this.options.defaultColDef;
      this.options.columnDefs = partial.columnDefs;
      if ('defaultColDef' in partial) this.options.defaultColDef = partial.defaultColDef;
      this.rebuildColumns({ defaultColDef: newDefault });
      this.workerClient.updateColumns(this.workerColumns())
        .then(({ visibleCount }) => {
          this.rowCount = visibleCount;
          this.recomputeViewport();
          this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
          this.events.emit({ type: 'displayedColumnsChanged', source: 'columnDefsChanged' });
          // Cycle 14 / Task 6 — `updateGridOptions({ columnDefs })` can
          // change per-column `aggFunc` declarations as part of the swap.
          // Tag as `columnAggFuncChanged` so listeners that care about
          // aggregation-only changes can correlate, even though some
          // swaps in this path are layout-only (column move / pin etc.
          // route through dedicated APIs that pass `null` instead).
          this.requestViewport('columnAggFuncChanged');
        })
        .catch((err) => { if (!this.destroyed) console.error('[cgrid] updateColumns:', err); });
    }
    for (const k of Object.keys(partial) as (keyof CGridOptions<TRow>)[]) {
      if (k === 'columnDefs') continue;
      // defaultColDef was already applied as part of the columnDefs path
      // (when both were provided) — skip a redundant rebuild.
      if (k === 'defaultColDef' && 'columnDefs' in partial) {
        // still update the stored value if it wasn't already
        if (this.options.defaultColDef !== partial.defaultColDef) {
          this.options.defaultColDef = partial.defaultColDef;
        }
        continue;
      }
      this.setGridOption(k, partial[k] as CGridOptions<TRow>[typeof k]);
    }
  }

  /** Adapter passed to the runtimeOptions apply table. Built fresh per call
   *  so the table never holds a stale reference to mutable internals. */
  private runtimeTarget(): RuntimeOptionTarget<TRow> {
    return {
      options: this.options,
      setTheme: (t) => this.setTheme(t),
      setDensity: (d) => this.setDensity(d),
      refreshA11y: () => this.updateA11y(),
      rebuildColumns: ({ defaultColDef }) => this.rebuildColumns({ defaultColDef }),
      refreshLayout: () => {
        this.recomputeViewport();
        this.cgridCanvas?.requestRepaint();
      },
      setSelectionMode: (mode) => this.selection.setMode(mode),
      applyRowData: (rows) => this.setRowData(rows as TRow[]),
      applyQuickFilter: () => this.applyQuickFilter(),
      forwardEnableCellChangeFlash: (enabled) => {
        // Cycle 4 / Task 11 (cell-flash patch) — forward the flag to
        // the worker. Fire-and-forget; the resolve just signals the
        // worker acked the toggle, no main-side state to update.
        this.workerClient.setEnableCellChangeFlash(enabled).catch((err) => {
          if (!this.destroyed) console.error('[cgrid] setEnableCellChangeFlash:', err);
        });
      },
      rebuildSubgrids: () => {
        // Cycle 14 / Task 2 — re-mount the subgrid stack so pinned-row
        // array changes (pinnedTopRowData / pinnedBottomRowData) take
        // effect without re-resolving the column tree.
        this.rebuildSubgridStack();
        this.recomputeViewport();
        this.cgridCanvas?.requestRepaint();
      },
      forwardAggFuncs: (funcs, triggerRefresh) => {
        // Cycle 14 / Task 3 — serialise each entry (with closure
        // detection) and ship the new map to the worker wholesale.
        // `undefined` or `{}` clears the custom layer; built-ins
        // remain available unchanged.
        // Cycle 14 / Task 6 — when called from the runtime apply
        // table (triggerRefresh = true) chain a viewport refresh
        // tagged `aggFuncChanged` once the worker registry resolves.
        this.forwardAggFuncs(
          funcs as Record<string, IAggFunc> | undefined,
          triggerRefresh === true,
        );
      },
      updateRowGroupPanelShow: (value) => this.updateRowGroupPanelShow(value),
      updatePivotPanelShow: (value) => this.updatePivotPanelShow(value),
      updatePivotMaxGeneratedColumns: (value) => this.updatePivotMaxGeneratedColumns(value),
      updateStrictPivotColumnOrder: (value) => this.updateStrictPivotColumnOrder(value),
      updatePivotTotalsOption: () => this.updatePivotTotalsOption(),
      updateRowGroupPanelSuppressSort: (suppress) =>
        this.rowGroupPanel?.setRenderOptions({ suppressSort: suppress }),
      updateGroupSelectsChildren: (enabled) => this.applyGroupSelectsChildren(enabled),
    };
  }

  /**
   * Cycle 14 / Task 3 — serialise the `aggFuncs` map and dispatch
   * `setAggFuncs` to the worker. Called from both the constructor
   * (after `workerClient.init` resolves) and the runtime apply table
   * (when `setGridOption('aggFuncs', …)` lands).
   *
   * Closure detection runs HERE on the main thread:
   *   1. Round-trip the function through `Function.prototype.toString()`
   *      + `new Function(...)` — the same path the worker will use.
   *   2. Invoke the rebuilt copy on a small probe input. If it throws
   *      with the original NOT throwing on the same input, the source
   *      referenced an outer-scope identifier — reject with a clear
   *      error pointing the app at the constraint. If both versions
   *      return the same value (NaN-safe via `Object.is`), the function
   *      is safe to ship.
   *
   * Keeping the screen on the main thread means the worker never sees a
   * broken aggFunc; that simplifies the worker's error envelope and
   * lets apps get the diagnostic synchronously inside the
   * `setGridOption` call that triggered the swap.
   */
  private forwardAggFuncs(
    funcs: Record<string, IAggFunc> | undefined,
    triggerRefresh: boolean = false,
  ): void {
    const entries: Array<{ name: string; source: string }> = [];
    if (funcs) {
      for (const [name, fn] of Object.entries(funcs)) {
        if (typeof fn !== 'function') {
          throw new Error(
            `[cgrid] aggFuncs.${name} is not a function — ` +
            `entries must be IAggFunc callables (received ${typeof fn})`,
          );
        }
        entries.push({ name, source: serializeAggFunc(name, fn) });
      }
    }
    const promise = this.workerClient.setAggFuncs(entries);
    promise.catch((err) => {
      if (!this.destroyed) console.error('[cgrid] setAggFuncs:', err);
    });
    // Cycle 14 / Task 6 — when the swap arrives via `setGridOption`
    // / `updateGridOptions` at runtime, kick a viewport refresh so the
    // totals row reflects the new aggregation semantics and the
    // `aggregationChanged` event fires tagged `aggFuncChanged`. The
    // constructor's call (which precedes the initial setRowData) passes
    // `false` so the source tag on the first emit stays `rowDataChanged`
    // — that's the cause the app expects to see.
    if (triggerRefresh) {
      promise.then(() => {
        if (this.destroyed) return;
        this.requestViewport('aggFuncChanged');
      }).catch(() => { /* error already logged above */ });
    }
  }

  /** Re-resolve the column tree from `options.columnDefs`, rebuild the
   *  visible column list, refresh layout, and rebuild the subgrid stack so
   *  any change in group depth lands a matching number of header rows. */
  private rebuildColumns({ defaultColDef }: { defaultColDef?: Partial<any> }): void {
    this.columnTree = resolveColumnTree(this.options.columnDefs, defaultColDef ?? this.options.defaultColDef, this.options.columnTypes);
    this.columnDefsMap = this.columnTree.leafById as Map<string, ResolvedColDef<TRow>>;
    // columnTree.leafById is a fresh Map that only holds user-supplied columns.
    // Re-register the synthesized auto-group columns so painter lookups
    // by colId keep working after any rebuildColumns() call (e.g. reorderColumn).
    for (const col of this.autoGroupColumns) {
      this.columnDefsMap.set(col.colId, col);
    }
    this.columnGroupState.setTree(this.columnTree);
    this.columnOrder = this.computeVisibleColumnOrder();
    this.columnLayout = resolveColumnWidths(
      this.columnOrder,
      this.canvasBounds.width || this.scroller.clientWidth || 800,
    );
    this.rebuildSubgridStack();
    this.recomputeViewport();
    this.cgridCanvas?.requestRepaint();
  }

  /** Rebuild the subgrid stack so the header-group row count matches the
   *  current `columnTree.maxDepth`. Data + leaf header subgrids are
   *  callback-driven and therefore re-pickable as-is. */
  private rebuildSubgridStack(): void {
    const stack: Subgrid[] = [];
    for (let depth = 0; depth < this.columnTree.maxDepth; depth++) {
      stack.push(new HeaderGroupSubgrid(
        () => this.columnTree,
        () => this.options.headerHeight ?? this.theme.headerHeight,
        depth,
        () => this.columnOrder.map((c) => c.colId),
      ));
    }
    stack.push(new HeaderSubgrid(
      this.columnDefsMap as Map<string, ResolvedColDef>,
      () => this.options.headerHeight ?? this.theme.headerHeight,
    ));
    // Cycle 7 / Task 1 — floating-filter row sits between the leaf header
    // and the data subgrid. Enabled when the grid-wide option is set OR
    // any column carries `floatingFilter: true`. A column with
    // `floatingFilter: false` skips its own input but does not collapse
    // the row; that's handled by the overlay's per-column gating.
    stack.push(new FloatingFilterSubgrid(
      () => this.options.floatingFilterHeight ?? 28,
      () => this.isFloatingFilterEnabled(),
    ));
    // Cycle 14 / Task 1 + 2 — stack order for the body-edge band:
    //   pre-data  : header → floating filter → totals-top → pinned-top → data
    //   post-data : data → pinned-bottom → totals-bottom
    // Totals sit OUTERMOST (closest to the chrome edge — header or status
    // bar); pinned rows sit INNERMOST (closest to actual data). The design
    // plan justifies the order: totals are most distinct from data (slate
    // tint, +1 weight), pinned rows are closer to "data-like" (warm tint,
    // body weight), so the body↔pinned↔totals transition reads as a smooth
    // step-out from synthesis-adjacent → synthesis. See
    // `docs/superpowers/plans/notes/cycle-14-aggregation-design.md`
    // § Task 2 — Coexistence — pinned + totals.
    const effectiveTotalsPos = this.effectiveTotalsRowPosition();
    if (effectiveTotalsPos === 'top') {
      stack.push(this.makeTotalsSubgrid('top'));
    }
    if (this.pinnedRowsArray('top').length > 0) {
      stack.push(this.makePinnedRowsSubgrid('top'));
    }
    stack.push(new DataSubgrid(
      () => this.rowCount,
      // Per-row height — first try the chunk's heights (canonical for the
      // rows currently in the visible window), fall back to the grid-level
      // `rowHeight`. Rows outside the chunk return the fallback; Task 7's
      // Fenwick tree replaces this with a global O(log n) lookup.
      (local) => this.rowHeightAt(local),
      (rowIndex, colId) => this.cellAt(rowIndex, colId),
    ));
    if (this.pinnedRowsArray('bottom').length > 0) {
      stack.push(this.makePinnedRowsSubgrid('bottom'));
    }
    if (effectiveTotalsPos === 'bottom') {
      stack.push(this.makeTotalsSubgrid('bottom'));
    }
    this.subgrids = stack;
  }

  /** Resolve the effective totals-row position by combining the explicit
   *  `totalsRowPosition` option with `pivotGrandTotals`. When
   *  `pivotGrandTotals: true` and pivot is active, the row is implicitly
   *  pinned to the bottom (Excel-style grand total). Otherwise the
   *  caller's explicit value (or `null`) applies. */
  private effectiveTotalsRowPosition(): 'top' | 'bottom' | null {
    if (this.options.pivotGrandTotals === true && this.pivotActive) {
      return 'bottom';
    }
    return this.options.totalsRowPosition ?? null;
  }

  /** Cycle 14 / Task 2 — read the pinned-rows array for `position`. Returns
   *  an empty array when the option is null / undefined so callers can
   *  uniformly check `.length > 0` to decide whether to mount the subgrid. */
  private pinnedRowsArray(position: 'top' | 'bottom'): readonly TRow[] {
    const raw = position === 'top'
      ? this.options.pinnedTopRowData
      : this.options.pinnedBottomRowData;
    return Array.isArray(raw) ? (raw as TRow[]) : [];
  }

  /** Cycle 14 / Task 2 — factory for a static pinned-rows subgrid. Each
   *  entry in `pinnedTopRowData` / `pinnedBottomRowData` becomes one
   *  non-scrolling row at the matching body edge. The row height
   *  inherits the grid's body row height (per the Task 2 design notes —
   *  "Row height: var(--cg-row-height) — Cycle-wide constraint"). The
   *  cell lookup resolves `row[field ?? colId]` and runs the column's
   *  `valueFormatter` so a moneyFormatter-decorated column reads the
   *  same in a pinned reference row and a data row. */
  private makePinnedRowsSubgrid(position: 'top' | 'bottom'): PinnedRowsSubgrid<TRow> {
    return new PinnedRowsSubgrid<TRow>(
      () => this.pinnedRowsArray(position),
      () => this.options.rowHeight ?? this.theme.rowHeight,
      (row, colId) => this.pinnedCellLookup(row, colId),
    );
  }

  /** Cycle 14 / Task 2 — resolve a single (row × column) cell value for a
   *  pinned subgrid. Honours `field` (with `colId` as fallback) and runs
   *  the column's `valueFormatter` when declared. Unknown columns produce
   *  empty cells (not null) so the row chrome paints across the full
   *  width even when the data only covers a subset of columns. */
  private pinnedCellLookup(row: TRow, colId: string): SubgridCell {
    const def = this.columnDefsMap.get(colId);
    if (!def) return { value: '', valueFormatted: '' };
    const field = def.field ?? (colId as keyof TRow & string);
    const value = (row as Record<string, unknown>)[field];
    let valueFormatted: string;
    if (def.valueFormatter) {
      valueFormatted = def.valueFormatter({ data: row, value, colId });
    } else if (value == null) {
      valueFormatted = '';
    } else if (typeof value === 'string') {
      valueFormatted = value;
    } else {
      valueFormatted = String(value);
    }
    return { value, valueFormatted };
  }

  /** Cycle 14 / Task 1 — factory for the grand-totals subgrid. The
   *  height resolves once per call, defaulting to the grid's body row
   *  height; per-column / per-grid override hooks ship in Task 5 via
   *  `pinnedRowHeight`. The cell lookup reads `chunk.totals[colId]`
   *  through the existing chunk state — totals are computed by the
   *  worker's AggPass and shipped with each viewport reply, so the
   *  row triggers ZERO extra worker round-trips on scroll. The
   *  `_position` arg is informational for now (Task 2 will use it to
   *  decide divider direction for pinned-row chrome). */
  private makeTotalsSubgrid(_position: 'top' | 'bottom'): TotalsSubgrid {
    return new TotalsSubgrid(
      () => this.options.rowHeight ?? this.theme.rowHeight,
      (colId) => this.totalsCellLookup(colId),
    );
  }

  /** Cycle 14 / Task 1 — read the current chunk's totals entry for
   *  `colId` and format it through the column's `valueFormatter` when
   *  declared. Returns `null` when no chunk has arrived yet OR the
   *  column has no aggFunc declared (`chunk.totals` only carries
   *  entries for aggregated columns). The painter skips text for null
   *  results while still painting row chrome.
   *
   *  Cycle 15 / Task 12 — when `parentGroupKey` is non-empty AND the
   *  chunk carries `groupTotals[parentGroupKey]`, the lookup reads the
   *  per-group record instead of the grand-total `chunk.totals` map.
   *  An empty `parentGroupKey` (the default) preserves the grand-total
   *  behaviour for the TotalsSubgrid + the grand-total footer row. */
  private totalsCellLookup(colId: string, parentGroupKey: string = ''): { value: unknown; valueFormatted: string } | null {
    const chunk = this.chunk;
    if (!chunk) return null;
    // Excel-style grand totals — under active pivot, the totals row
    // reads pivot result cells from `chunk.pivotValues` keyed by
    // `groupKey: ''` (the bucket PivotPass.aggregateNode('', inputIds)
    // already populates) so each cross-tab cell shows the
    // grand-of-grand for that (pivotPath, valueColId).
    if (this.pivotActive && parentGroupKey === '') {
      // Match Excel's pivot terminology — "Total Result" labels both the
      // bottom row and the right column header so the corner reads
      // consistently regardless of which axis the eye lands on first.
      if (isAutoGroupColumnId(colId)) {
        return { value: 'Total Result', valueFormatted: 'Total Result' };
      }
      const spec = this.pivotCellSpecById.get(colId);
      if (spec && chunk.pivotValues) {
        const lookupRaw = chunk.pivotValues.get(
          encodePivotValueKey('', spec.pivotPath.join(PIVOT_PATH_SEP), spec.valueColId),
        );
        if (lookupRaw === undefined) return null;
        if (lookupRaw === null) return { value: null, valueFormatted: '' };
        const fmt = typeof lookupRaw === 'number' ? this.formatNumber(colId, lookupRaw) : String(lookupRaw);
        return { value: lookupRaw, valueFormatted: fmt };
      }
    }
    let raw: unknown;
    if (parentGroupKey !== '' && chunk.groupTotals) {
      const groupRec = chunk.groupTotals[parentGroupKey];
      if (groupRec === undefined) return null;
      raw = groupRec[colId];
    } else {
      if (!chunk.totals) return null;
      raw = chunk.totals[colId];
    }
    if (raw === undefined) return null;
    if (raw === null) return { value: null, valueFormatted: '' };
    // Cycle 15.5 / Task 8 — object-returning custom aggFuncs. When `raw`
    // is an object with a `value` field, extract that for display. This
    // supports weighted-average funcs that return `{ value, weight }` and
    // similar compound results where the caller wants the renderer to see
    // only the primary `value` without a custom valueFormatter. If the
    // object also has a `valueFormatted` string field, use it verbatim.
    if (typeof raw === 'object' && raw !== null && 'value' in raw) {
      const obj = raw as { value: unknown; valueFormatted?: string };
      const inner = obj.value;
      if (typeof obj.valueFormatted === 'string') {
        return { value: inner, valueFormatted: obj.valueFormatted };
      }
      if (typeof inner === 'number') {
        return { value: inner, valueFormatted: this.formatNumber(colId, inner) };
      }
      return { value: inner, valueFormatted: inner == null ? '' : String(inner) };
    }
    // Cycle 14 / Task 3 — custom aggFuncs may return non-numeric values
    // (e.g. `'first'` returns whatever shape the column carries). Route
    // numeric returns through the column's number formatter; fall back
    // to `String(...)` for everything else so the totals row still
    // paints text for custom funcs.
    if (typeof raw === 'number') {
      return { value: raw, valueFormatted: this.formatNumber(colId, raw) };
    }
    return { value: raw, valueFormatted: String(raw) };
  }

  /** Cycle 7 / Task 1 — true when the floating-filter row should render.
   *  Resolves the grid-wide default plus any per-column override. A column
   *  explicitly setting `floatingFilter: false` does NOT suppress the row
   *  globally; only the grid-wide default (off) combined with no column
   *  opting in collapses the row to zero height. */
  private isFloatingFilterEnabled(): boolean {
    if (this.options.floatingFilter === true) return true;
    for (const col of this.columnOrder) {
      if (col.floatingFilter === true) return true;
    }
    return false;
  }

  destroy(): void {
    if (this.destroyed) return;
    // gridPreDestroyed fires SYNCHRONOUSLY before any teardown so listeners
    // can read state (selection, scroll, column widths) one last time. The
    // state payload is a stub until Cycle 22's snapshot API; shipping the
    // event surface now means apps can wire listeners against a stable shape.
    this.events.emit({ type: 'gridPreDestroyed', state: {} });
    this.destroyed = true;
    this.selectionUnsubscribe();
    if (this.chunkLRU) this.chunkLRU.clear();
    this.cgridCanvas.destroy();
    this.workerClient.destroy();
    this.featureChain.destroy();
    this.a11y.destroy();
    this.editor.close();
    this.rowEdit.close();
    this.floatingFilterOverlay.destroy();
    this.filterPopupHost.destroy();
    this.contextMenuHost.destroy();
    // Cycle 11 / Task 2 — tear down the side bar AFTER the canvas (so a
    // last reserveSideBarSpace(0) from sideBar.destroy doesn't try to
    // resize a destroyed canvas). The sideBar.destroy already calls
    // setReservedSpace to release its gutter, but the early guard in
    // reserveSideBarSpace (this.cgridCanvas?.setHostBounds) bails out
    // gracefully after cgridCanvas is destroyed.
    this.sideBar?.destroy();
    // Cycle 13 / Task 4 — same teardown contract for the status bar.
    // The host's destroy() fans out a destroy() call to every mounted
    // panel (built-in + custom) so panel-owned listeners + DOM are
    // released. Ordered after sideBar.destroy() for symmetry with the
    // mount order; the canvas-already-destroyed guard in
    // reserveStatusBarSpace bails out gracefully if the host's release
    // call lands after cgridCanvas.destroy.
    this.statusBar?.destroy();
    // Cycle 15 / Task 6 — release the row group panel's top inset
    // + remove its DOM. The host's destroy() calls back into
    // reserveRowGroupPanelSpace(0) which is canvas-destroy-safe via
    // the same guard as the side / status bars.
    this.rowGroupPanel?.destroy();
    this.rowGroupPanel = null;
    // Cycle 18 / Task 6 — release the pivot panel's top inset +
    // remove its DOM. Symmetric with the row group panel teardown
    // above.
    this.pivotPanel?.destroy();
    this.pivotPanel = null;
    // Cycle 15.5 / Task 1 — release the grouping primitive's
    // subscribers + clear its event emitter so a late listener can't
    // fire on a destroyed grid.
    this.groupingStateUnsubscribe();
    this.groupingState.destroy();
    // Cycle 18 / Task 3 — release the pivot state subscriber + emitter
    // so a late listener can't fire on a destroyed grid.
    this.pivotStateUnsubscribe();
    this.pivotState.destroy();
    // Cycle 4 / Task 11 (cell-flash patch) — cancel any in-flight
    // rAF tick + clear the registry so a late callback can't fire on
    // a destroyed grid.
    if (this.flashTickHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.flashTickHandle);
      this.flashTickHandle = null;
    }
    this.flashRegistry.destroy();
    // Cycle 23 / Task 7 — release the state-update bus subscriptions
    // + cancel any pending rAF so a late frame can't emit on a
    // destroyed grid.
    this.stateUpdatedBus?.destroy();
    // Cycle 23 / Task 3 — clear the debounce so a late-firing
    // bodyScrollEnd doesn't try to emit on a destroyed grid.
    if (this.scrollEndTimer !== null) {
      clearTimeout(this.scrollEndTimer);
      this.scrollEndTimer = null;
    }
    // Cycle 22 / Task 3 — explicit cleanup of any inline `--cg-*`
    // overrides so the WeakMap state doesn't leak past destroy. The
    // root element gets removed below, but apps that re-parent / re-
    // use the host expect the inline styles cleared.
    themeParamsClear(this.root);
    this.root.parentElement?.removeChild(this.root);
    this.events.destroy();
  }

  // --- Internals ------------------------------------------------------------

  private makeApi(): CGridApi {
    return {
      setRowData: (r) => this.setRowData(r as TRow[]),
      applyTransaction: (t) => this.applyTransaction(t as Tx<TRow>),
      applyTransactionAsync: (t) => this.applyTransactionAsync(t as Tx<TRow>),
      flushAsyncTransactions: () => this.flushAsyncTransactions(),
      setSortModel: (s) => this.setSortModel(s),
      setFilterModel: (f) => this.setFilterModel(f),
      setGroupModel: (g) => this.setGroupModel(g),
      setRowGroupColumns: (cols) => this.setRowGroupColumns(cols),
      addRowGroupColumn: (colId) => this.addRowGroupColumn(colId),
      removeRowGroupColumn: (colId) => this.removeRowGroupColumn(colId),
      moveRowGroupColumn: (from, to) => this.moveRowGroupColumn(from, to),
      setRowGroupColumnSort: (colId, dir) => this.setRowGroupColumnSort(colId, dir),
      getRowGroupColumns: () => this.getRowGroupColumns(),
      // Cycle 18 / Task 3 — pivot API.
      isPivotMode: () => this.isPivotMode(),
      setPivotMode: (m) => this.setPivotMode(m),
      getPivotColumns: () => this.getPivotColumns(),
      setPivotColumns: (cols) => this.setPivotColumns(cols),
      addPivotColumn: (colId) => this.addPivotColumn(colId),
      removePivotColumn: (colId) => this.removePivotColumn(colId),
      movePivotColumn: (from, to) => this.movePivotColumn(from, to),
      getValueColumns: () => this.getValueColumns(),
      addValueColumn: (colId, aggFunc) => this.addValueColumn(colId, aggFunc),
      removeValueColumn: (colId) => this.removeValueColumn(colId),
      setValueColumnAggFunc: (colId, aggFunc) => this.setValueColumnAggFunc(colId, aggFunc),
      expandAll: () => this.expandAll(),
      collapseAll: () => this.collapseAll(),
      setExpanded: (k, e) => this.setExpanded(k, e),
      getExpandedKeys: () => this.getExpandedKeys(),
      ensureIndexVisible: (i, pos) => this.ensureIndexVisible(i, pos),
      resetRowGroupExpansion: () => this.resetRowGroupExpansion(),
      showColumnFilter: (c) => this.showColumnFilter(c),
      hideColumnFilter: () => this.hideColumnFilter(),
      onFilterChanged: (source) => this.onFilterChanged(source),
      getColumnFilterModel: <TModel extends CFilterModelEntry = CFilterModelEntry>(c: string) =>
        this.getColumnFilterModel(c) as TModel | null,
      setColumnFilterModel: (c, m) => this.setColumnFilterModel(c, m),
      isAnyFilterPresent: () => this.isAnyFilterPresent(),
      isColumnFilterPresent: () => this.isColumnFilterPresent(),
      destroyFilter: (c) => this.destroyFilter(c),
      flashCells: (p) => this.flashCells(p),
      ensureRowVisible: (id, pos) => this.ensureRowVisible(id, pos),
      ensureColumnVisible: (id, pos) => this.ensureColumnVisible(id, pos),
      ensureColumnGroupVisible: (id, pos) => this.ensureColumnGroupVisible(id, pos),
      getSelectedRowIds: () => this.getSelectedRowIds(),
      setSelectedRowIds: (ids) => this.setSelectedRowIds(ids),
      getGroupSelectionState: (key) => this.selection.getGroupSelectionState(key),
      getDisplayedRowCount: () => this.getDisplayedRowCount(),
      getTotalRowCount: () => this.getTotalRowCount(),
      getCellRanges: () => this.getCellRanges(),
      addCellRange: (range) => this.addCellRange(range),
      clearCellRanges: () => this.clearCellRanges(),
      copySelectedRangesToClipboard: () => this.copySelectedRangesToClipboard(),
      pasteFromClipboard: () => this.pasteFromClipboard(),
      cutSelectedRanges: () => this.cutSelectedRanges(),
      getFocusedCell: () => this.getFocusedCell(),
      setFocusedCell: (r, c) => this.setFocusedCell(r, c),
      refresh: () => this.refresh(),
      setTheme: (t) => this.setTheme(t),
      destroy: () => this.destroy(),
      getColumnGroupState: () => this.columnGroupState.getState(),
      setColumnGroupState: (s) => { this.columnGroupState.apply(s); },
      resetColumnGroupState: () => this.columnGroupState.reset(),
      refreshToolPanel: (id) => this.refreshToolPanel(id),
      getToolPanelInstance: (id) => this.getToolPanelInstance(id),
      isSideBarVisible: () => this.isSideBarVisible(),
      setSideBarVisible: (show) => this.setSideBarVisible(show),
      setSideBarPosition: (pos) => this.setSideBarPosition(pos),
      openToolPanel: (id) => this.openToolPanel(id),
      closeToolPanel: () => this.closeToolPanel(),
      getOpenedToolPanel: () => this.getOpenedToolPanel(),
      getSideBar: () => this.getSideBar(),
      getStatusPanel: <T extends IStatusPanelComp = IStatusPanelComp>(key: string) =>
        this.getStatusPanel<T>(key),
      getGridOption: (k) => this.getGridOption(k as keyof CGridOptions<TRow>) as any,
      setGridOption: (k, v) => this.setGridOption(k as keyof CGridOptions<TRow>, v as any),
      updateGridOptions: (p) => this.updateGridOptions(p as Partial<CGridOptions<TRow>>),
      registerCellRenderer: (n, p) => this.registerCellRenderer(n, p),
      registerCellEditor: (n, c) => this.registerCellEditor(n, c),
      registerComparator: <TValue = unknown>(n: string, f: (a: TValue, b: TValue) => number) =>
        this.registerComparator<TValue>(n, f),
      startEditingCell: (r, c) => this.openEditor(r, c),
      stopEditing: (cancel) => this.stopEditing(cancel),
      on: (t, h) => this.on(t as CGridEvent['type'], h as any),
      off: (t, h) => this.off(t as CGridEvent['type'], h as any),
      addEventListener: (t, h) => this.addEventListener(t as CGridEvent['type'], h as any),
      removeEventListener: (t, h) => this.removeEventListener(t as CGridEvent['type'], h as any),
      moveColumnByIndex: (f, t) => this.moveColumnByIndex(f, t),
      getColumnState: () => this.getColumnState(),
      getColumnHeaderName: (colId) => this.getColumnHeaderName(colId),
      isColumnRowGroupEnabled: (colId) => this.isColumnRowGroupEnabled(colId),
      isColumnPivotEnabled: (colId) => this.isColumnPivotEnabled(colId),
      isColumnValueEnabled: (colId) => this.isColumnValueEnabled(colId),
      getColumnFilterType: (colId) => this.getColumnFilterType(colId),
      buildColumnFilterEditor: (colId) => this.buildColumnFilterEditor(colId),
      applyColumnState: (p) => this.applyColumnState(p),
      resetColumnState: () => this.resetColumnState(),
      sizeColumnsToFit: (p) => this.sizeColumnsToFit(p),
      autoSizeColumns: (keys, skipHeader) => this.autoSizeColumns(keys, skipHeader),
      autoSizeAllColumns: (skipHeader) => this.autoSizeAllColumns(skipHeader),
      setColumnsVisible: (keys, visible) => this.setColumnsVisible(keys, visible),
      setColumnsPinned: (keys, pinned) => this.setColumnsPinned(keys, pinned),
      setColumnWidths: (widths, finished) => this.setColumnWidths(widths, finished),
      moveColumns: (keys, toIndex) => this.moveColumns(keys, toIndex),
      getCellBoundsAt: (r, c) => this.getCellBoundsAt(r, c),
      getHeaderBoundsAt: (c) => this.getHeaderBoundsAt(c),
      getRowBoundsAt: (r) => this.getRowBoundsAt(r),
      getCellValue: (r, c) => this.getCellValue(r, c),
      getCellPaintedBg: (r, c) => this.getCellPaintedBg(r, c),
    };
  }

  private toggleColumnGroup(groupId: string): void {
    this.columnGroupState.toggle(groupId);
  }

  /** Cycle 18 / Task 4 follow-up — predicate matching the painter's
   *  chevron-eligibility rule. A column group is toggleable when:
   *    - It's a regular (non-pivot) column group — Cycle 4 / Task 4
   *      groups have always been toggleable, no change there.
   *    - OR it's a BRANCH pivot result group — defined as a pivot
   *      group with at least one CHILD GROUP (a deeper pivot level
   *      below it). AG-Grid parity: the user can collapse/expand the
   *      parent to hide/show all the child column groups beneath it,
   *      and the collapsed state surfaces the rollup leaf (the Total
   *      sub-group when `pivotColumnGroupTotals` is set, or the
   *      legacy `columnGroupShow:'closed'` leaf otherwise).
   *  LEAF pivot groups (deepest pivot level — sectors under a multi-
   *  level pivot, or every group of a 1-level pivot) have no child
   *  groups, only value-col leaves. Collapsing them would hide
   *  everything with nothing to fall back on (the user reported this
   *  as "clicking on any cell of the sector row hides that column").
   *  HeaderClick uses this predicate to short-circuit the toggle for
   *  those groups so the click becomes a no-op. */
  canToggleColumnGroup(groupId: string): boolean {
    const group = this.columnTree.groupById.get(groupId);
    if (!group) return false;
    // Non-pivot groups are toggleable per legacy Cycle 4 behaviour.
    if (!isPivotResultGroupId(groupId)) return true;
    // Pivot result groups — toggleable when they have at least one
    // CHILD GROUP (branch group) OR a `columnGroupShow:'closed'`
    // direct leaf (legacy Task 4 fallback). Either signal indicates
    // collapsing would have a visible effect: child groups hide on
    // collapse; closed-state leaves appear on collapse.
    for (const childGroupId of this.columnTree.groupById.keys()) {
      if (childGroupId === groupId) continue;
      const child = this.columnTree.groupById.get(childGroupId);
      if (!child) continue;
      // Direct parent check: child's leafColIds are a subset of
      // group's leafColIds AND the child is one level deeper.
      // Simpler proxy: the child's groupId starts with the parent's
      // groupId + the path separator (pivot ids encode the path).
      if (childGroupId.startsWith(groupId + '\x01')) return true;
    }
    for (const leafId of group.leafColIds) {
      const def = this.columnDefsMap.get(leafId);
      if (def?.columnGroupShow === 'closed') return true;
    }
    return false;
  }

  /** Cycle 18 / Task 4 — (re)attach the column-group-state listener.
   *  Called from the constructor and from `applyPivotColumns` /
   *  `revertPivotColumns` whenever a new `ColumnGroupState` is installed
   *  (pivot synthesis swaps the tree). Disposes the prior subscription
   *  (if any) so we never accumulate stale listeners. */
  private columnGroupStateUnsubscribe: (() => void) | null = null;
  private subscribeColumnGroupState(): void {
    if (this.columnGroupStateUnsubscribe) this.columnGroupStateUnsubscribe();
    this.columnGroupStateUnsubscribe = this.columnGroupState.onChange((changed) => {
      this.columnOrder = this.computeVisibleColumnOrder();
      this.columnLayout = resolveColumnWidths(this.columnOrder, this.canvasBounds.width || this.scroller.clientWidth || 800);
      this.recomputeViewport();
      this.cgridCanvas?.requestRepaint();
      for (const c of changed) {
        this.events.emit({ type: 'columnGroupOpened', groupId: c.groupId, open: c.open });
      }
      this.events.emit({ type: 'displayedColumnsChanged', source: 'columnGroupOpened' });
      // Re-fetch the chunk for the new visible-column set so newly-shown
      // leaves get data instead of blank cells until the next scroll tick.
      if (this.workerClient) this.requestViewport();
    });
  }

  /** Map `resolveVisibleLeaves` (colIds) back to ResolvedColDefs. Hidden
   *  leaves stay in `columnDefsMap`, so a later toggle picks them up without
   *  re-resolving.
   *
   *  Cycle 6 / Task 2 — additionally filters out leaves with `hide: true`
   *  so column-state mutations remove them from the visible-leaf order
   *  (header + body + layout + hit-test). Hidden leaves still ride
   *  `getColumnState()` so the round-trip is symmetric. */
  private computeVisibleColumnOrder(): ResolvedColDef<TRow>[] {
    const ids = resolveVisibleLeaves(this.columnTree, this.columnGroupState);
    const visible = ids
      .map((id) => this.columnDefsMap.get(id)!)
      .filter((def) => !def.hide);
    // Cycle 15 / Task 4 + Task 5 — when grouping is active AND auto-group
    // column(s) have been synthesized (singleColumn → 1 column;
    // multipleColumns → N columns, one per rowGroupCols entry), insert
    // them at the start of the visible-leaf order so they appear as the
    // leftmost columns. Pinned-left wins over this in the band
    // resolution at paint time; the columns are unpinned by default so
    // they sit in the leftmost CENTER slot, but apps can pin via
    // `autoGroupColumnDef: { pinned: 'left' }`. `'groupRows'` /
    // `'custom'` modes synthesize zero columns — the strip paints
    // row-level chrome in the body painter instead.
    if (this.autoGroupColumns.length > 0) {
      return [...this.autoGroupColumns, ...visible];
    }
    return visible;
  }

  /** Cycle 15 / Task 4 + Task 5 — re-resolve `autoGroupColumns` against
   *  the current `groupModel` + grid options. The set of synthesized
   *  columns depends on the resolved `groupDisplayType`:
   *    - `'singleColumn'` (default) → 1 column at index 0 IF grouping
   *      is active.
   *    - `'multipleColumns'` → N columns (one per `rowGroupCols[i]`) at
   *      indices 0..N-1, each carrying `cellRendererParams.groupColumnDepth`
   *      so the `'group'` renderer's own-depth filter activates.
   *    - `'groupRows'` / `'custom'` → no columns; the body painter
   *      renders group rows as a full-row strip via `groupRowStripCtx`.
   *
   *  Also stamps `groupRowStripCtx` for the strip modes, or clears it
   *  for the column modes. Called by `setGroupModel` and by the
   *  construction-time auto-group resolution.
   */
  private rebuildAutoGroupColumn(): void {
    const displayType = resolveGroupDisplayType(this.options.groupDisplayType);
    // Drop any previously-synthesized auto-group columns from the
    // columnDefsMap before re-synthesizing — switching display types
    // (e.g. singleColumn → multipleColumns) renames the columns and
    // leaves stale entries that would shadow the new ones at lookup.
    for (const col of this.autoGroupColumns) {
      this.columnDefsMap.delete(col.colId);
    }
    const synth = synthesizeAutoGroupColumns<TRow>({
      groupModel: this.groupModel,
      groupDisplayType: displayType,
      override: this.options.autoGroupColumnDef as Partial<CColDef<TRow>> | undefined,
      headerNames: this.groupModel.rowGroupCols.map((colId) =>
        this.columnTree.leafById.get(colId)?.headerName),
    });
    this.autoGroupColumns = synth.columns;
    // Mirror the synthesized defs into `columnDefsMap` so the painter's
    // per-cell lookup resolves the synthesized columns identically to
    // any other leaf. `columnTree.leafById` doesn't carry synthesized
    // entries; we maintain them here for the lifetime of the active
    // group model.
    for (const col of this.autoGroupColumns) {
      this.columnDefsMap.set(col.colId, col);
    }
    // Cycle 15 / Task 5 — wire the full-row strip lookup for
    // `'groupRows'` / `'custom'` modes. The `'group'` renderer is the
    // default strip painter; apps swap it via
    // `CGridOptions.groupRowRenderer` (e.g. for `'custom'`).
    if (synth.fullRowStrip) {
      const renderer = this.options.groupRowRenderer ?? 'group';
      this.groupRowStripCtx = {
        renderer,
        lookup: (rowIndex) => this.groupCellContextAt(rowIndex),
      };
    } else {
      this.groupRowStripCtx = null;
    }
    // Re-resolve the visible-leaf order so the next paint reflects the
    // (now updated) auto-group slot(s). Layout reflows in the same
    // turn so the new column(s) get a width before the next viewport
    // request fires.
    this.columnOrder = this.computeVisibleColumnOrder();
    this.columnLayout = resolveColumnWidths(
      this.columnOrder,
      this.canvasBounds.width || this.scroller.clientWidth || 800,
    );
    this.recomputeViewport();
  }

  /** Cycle 15 / Task 7 — hit-test the chevron region of an auto-group
   *  cell. Returns the composite group key when the canvas-local point
   *  falls inside the chevron's hit zone of a group row, `null`
   *  otherwise. The hit zone matches the chevron's painted bbox
   *  expanded by 4 px on every axis (see Task 7 design notes);
   *  vertical = full row band.
   *
   *  Resolves the column / row via the active viewport state (matches
   *  `HitTester`'s zone partitioning so a right-pinned auto-group
   *  column is hit-testable too). Reads the row's depth + composite
   *  key off the current chunk. The result silently bails when:
   *  - no chunk is loaded yet (initial mount)
   *  - point falls outside the data body band (header / totals row)
   *  - resolved cell is not in an auto-group column
   *  - resolved row is not a group row (rowKind !== 1)
   *  - in multipleColumns mode the column's depth doesn't match the
   *    row's depth
   *  - point is outside the chevron's 4 px-padded hit rect
   */
  private hitTestGroupChevron(x: number, y: number): { groupKey: string } | null {
    if (!this.chunk) return null;
    if (this.groupModel.rowGroupCols.length === 0) return null;
    const vs = this.viewport;
    if (y < vs.bodyTop || y >= vs.bodyBottom) return null;
    let row: ViewportRow | null = null;
    for (const r of vs.visibleRows) {
      if (y >= r.top && y < r.bottom) { row = r; break; }
    }
    if (!row || !row.subgrid.isData) return null;
    // Mirror HitTester's zone partitioning so the cursor only ever
    // picks a column whose home zone matches the X-band the click
    // landed in (center columns extending past `bodyRight` shouldn't
    // win when the cursor is in the pinned-right zone).
    let zone: 'left' | 'right' | 'center';
    if (x < vs.bodyLeft) zone = 'left';
    else if (x >= vs.bodyRight) zone = 'right';
    else zone = 'center';
    let col: ViewportColumn | null = null;
    for (const c of vs.visibleColumns) {
      const home = c.pinned ?? 'center';
      if (home !== zone) continue;
      if (x >= c.left && x < c.right) { col = c; break; }
    }
    if (!col || !isAutoGroupColumnId(col.colId)) return null;
    const rowIndex = row.localRowIndex;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    if ((this.chunk.rowKinds[localIndex] ?? 0) !== 1) return null;
    const rowDepth = this.chunk.groupDepth[localIndex] ?? 0;
    // multipleColumns: each per-level column owns exactly one depth.
    // Chevrons only live on the column whose depth matches the row's.
    const colDepth = autoGroupColumnDepthFromId(col.colId);
    if (colDepth !== null && colDepth !== rowDepth) return null;
    // Cycle 18 / Task 9 follow-up — when the chevron is suppressed
    // (deepest row-group level under pivot mode; leaf rows hidden so
    // nothing to expand into), the hit-test must also bail so a
    // click on the chevron's would-be slot stays a normal cell click
    // instead of a stealthy group toggle.
    const rowGroupDepthCount = this.groupingState.getRowGroupColumns().length;
    if (
      this.pivotActive
      && rowGroupDepthCount > 0
      && rowDepth === rowGroupDepthCount - 1
    ) return null;
    // Chevron geometry must agree with `renderer/cellRenderers/group.ts`.
    // PADDING + CHEVRON_SIZE + indent unit live as constants in both
    // files; if either drifts the chevron paints in one place and is
    // hit-tested in another — visual quality bar would catch it but
    // these constants are explicitly mirrored to make the agreement
    // load-bearing.
    const PADDING = 6;
    const CHEVRON_SIZE = 12;
    const HIT_PAD = 4;
    const INDENT_UNIT = 14;
    const indentX = colDepth !== null ? 0 : rowDepth * INDENT_UNIT;
    const left = col.left + PADDING + indentX;
    const right = left + CHEVRON_SIZE;
    if (x < left - HIT_PAD || x > right + HIT_PAD) return null;
    const groupKey = this.chunk.groupKey?.[localIndex] ?? '';
    if (groupKey === '') return null;
    return { groupKey };
  }

  /** Cycle 15 / Task 16 — hit-test the sticky group band painted at the
   *  top of the body area. Returns the ancestor's composite group key
   *  when the pointer falls on a chevron within the pinned band.
   *
   *  Geometry agrees with `renderer/painters/stickyGroups.ts`:
   *  PADDING + depth×INDENT_UNIT + CHEVRON_SIZE, HIT_PAD = 4 px.
   *  Does NOT require a visible-rows lookup — the band occupies a
   *  fixed y-range (bodyTop .. bodyTop + numAncestors × rowH). */
  private hitTestStickyChevron(x: number, y: number): { groupKey: string } | null {
    const ancestors = this.stickyAncestors;
    if (ancestors.length === 0) return null;
    const vs = this.viewport;
    const rowH = this.options.rowHeight ?? this.theme.rowHeight;
    const bodyTop = vs.bodyTop;
    const bodyLeft = vs.bodyLeft;
    const bodyRight = vs.bodyRight;
    if (y < bodyTop || y >= bodyTop + ancestors.length * rowH) return null;
    if (x < bodyLeft || x >= bodyRight) return null;
    const bandIdx = Math.floor((y - bodyTop) / rowH);
    const ancestor = ancestors[bandIdx];
    if (!ancestor) return null;
    const PADDING = 6;
    const CHEVRON_SIZE = 12;
    const INDENT_UNIT = 14;
    const HIT_PAD = 4;
    const indentX = ancestor.depth * INDENT_UNIT;
    const left = bodyLeft + PADDING + indentX;
    const right = left + CHEVRON_SIZE;
    if (x < left - HIT_PAD || x > right + HIT_PAD) return null;
    return { groupKey: ancestor.key };
  }

  /** Cycle 15 / Task 8 — hit-test a canvas-local point against the
   *  tri-state checkbox of an auto-group cell. Returns the composite
   *  group key + current aggregate state when the point falls inside
   *  the checkbox hit zone, `null` otherwise.
   *
   *  Geometry MUST agree with `renderer/cellRenderers/group.ts`:
   *  PADDING + indent + chevron + chevron-gap + checkbox, with
   *  HIT_PAD = 4 px each side. Mirrors the chevron hit-test pattern.
   *  Returns `null` when `groupSelectsChildren` is off OR when the
   *  row isn't a group row (data rows / non-auto-group columns / the
   *  multipleColumns "other-depth" cells all fall here). */
  private computeCheckboxHit(x: number, y: number): {
    groupKey: string;
    state: 'none' | 'partial' | 'all';
  } | null {
    if (!this.selection.isGroupSelectsChildren()) return null;
    if (!this.chunk) return null;
    const vs = this.viewport;
    let row: ViewportRow | null = null;
    for (const r of vs.visibleRows) {
      if (y >= r.top && y < r.bottom) { row = r; break; }
    }
    if (!row || !row.subgrid.isData) return null;
    let zone: 'left' | 'right' | 'center';
    if (x < vs.bodyLeft) zone = 'left';
    else if (x >= vs.bodyRight) zone = 'right';
    else zone = 'center';
    let col: ViewportColumn | null = null;
    for (const c of vs.visibleColumns) {
      const home = c.pinned ?? 'center';
      if (home !== zone) continue;
      if (x >= c.left && x < c.right) { col = c; break; }
    }
    if (!col || !isAutoGroupColumnId(col.colId)) return null;
    const rowIndex = row.localRowIndex;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    if ((this.chunk.rowKinds[localIndex] ?? 0) !== 1) return null;
    const rowDepth = this.chunk.groupDepth[localIndex] ?? 0;
    const colDepth = autoGroupColumnDepthFromId(col.colId);
    if (colDepth !== null && colDepth !== rowDepth) return null;
    // Constants mirrored from `renderer/cellRenderers/group.ts`. Any
    // drift breaks the click target — the chevron's mirroring already
    // documents the convention.
    const PADDING = 6;
    const CHEVRON_SIZE = 12;
    const CHEVRON_GAP = 6;
    const CHECKBOX_SIZE = 14;
    const HIT_PAD = 4;
    const INDENT_UNIT = 14;
    const indentX = colDepth !== null ? 0 : rowDepth * INDENT_UNIT;
    const checkboxLeft = col.left + PADDING + indentX + CHEVRON_SIZE + CHEVRON_GAP;
    const checkboxRight = checkboxLeft + CHECKBOX_SIZE;
    if (x < checkboxLeft - HIT_PAD || x > checkboxRight + HIT_PAD) return null;
    const groupKey = this.chunk.groupKey?.[localIndex] ?? '';
    if (groupKey === '') return null;
    const state = this.selection.getGroupSelectionState(groupKey);
    return { groupKey, state };
  }

  /** Cycle 15 / Task 8 — cascade select / deselect every leaf row under
   *  `groupKey`. Routes through the SelectionModel; the persistent id
   *  set carries the change so a later sort / filter / transaction
   *  preserves the cascade. */
  private cascadeGroupSelectionFromUi(groupKey: string, selected: boolean): void {
    if (this.destroyed) return;
    if (groupKey === '') return;
    this.selection.setGroupSelected(groupKey, selected);
    // Rebuild the index-keyed selectedRowIndices so the painter highlights
    // the cascaded leaf rows. setGroupSelected only updates the persistent
    // id set; the paint set is index-keyed and requires a worker round-trip
    // to map ids → current row indices.
    this.rebuildSelectionFromPersistentIds();
  }

  /** Cycle 15 / Task 7 — toggle a group's expanded state in response
   *  to a chevron click. Mirrors `setExpanded(key, !current)` but
   *  fires `rowGroupOpened` with `source: 'ui'` so apps can tell a
   *  user-driven toggle from an imperative API call. */
  private toggleGroupExpandedFromUi(groupKey: string): void {
    if (this.destroyed) return;
    if (groupKey === '') return;
    const currentlyExpanded = this.expandedKeys === null
      ? true
      : this.expandedKeys.has(groupKey);
    const next = !currentlyExpanded;
    const materialised = this.expandedKeys === null
      ? new Set(this.knownGroupKeys)
      : new Set(this.expandedKeys);
    if (next) materialised.add(groupKey);
    else materialised.delete(groupKey);
    this.expandedKeys = materialised;
    this.shipExpandedKeys(Array.from(materialised));
    this.events.emit({
      type: 'rowGroupOpened',
      key: groupKey,
      expanded: next,
      source: 'ui',
    });
  }

  /** Cycle 15 / Task 5 — read the per-row group context from the
   *  current chunk. Returns the `GroupCellValue` payload that the
   *  `'group'` cell renderer downcasts and uses, or `null` when the
   *  row is not currently chunked. Shared by the multipleColumns
   *  per-cell path (`cellAt` for an auto-group column) and the
   *  groupRows full-row strip lookup. */
  private groupCellContextAt(rowIndex: number): GroupCellValue | null {
    if (!this.chunk) return null;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    const rowKind = this.chunk.rowKinds[localIndex] ?? 0;
    const depth = this.chunk.groupDepth[localIndex] ?? 0;
    const groupValueArr = this.chunk.groupValue;
    const valueFormatted = groupValueArr ? (groupValueArr[localIndex] ?? '') : '';
    const childCount = this.chunk.groupChildCount
      ? (this.chunk.groupChildCount[localIndex] ?? 0)
      : 0;
    const isExpanded = this.chunk.isExpanded
      ? (this.chunk.isExpanded[localIndex] ?? 0) !== 0
      : true;
    // Cycle 15 / Task 8 + Cycle 15.5 / Task 5 — thread tri-state selection
    // state into the payload when group checkboxes are visible. Three
    // conditions gate this path:
    //   1. The row must be a group row (rowKind === 1).
    //   2. `checkboxLocation` must route to the auto-group column (not
    //      'none' and not 'selectionColumn').
    //   3. A group-selects mode is active (descendants OR self modes).
    const checkboxLoc = this.options.checkboxLocation ?? 'autoGroupColumn';
    const groupSelectsMode = this.selection.getGroupSelects();
    const showCheckboxInGroupCell =
      rowKind === 1
      && checkboxLoc !== 'none'
      && checkboxLoc !== 'selectionColumn'
      && (groupSelectsMode !== 'none' || this.selection.isGroupSelectsChildren());
    let selectionState: 'none' | 'partial' | 'all' | undefined;
    if (showCheckboxInGroupCell) {
      const groupKeyArr = this.chunk.groupKey;
      const groupKey = groupKeyArr ? (groupKeyArr[localIndex] ?? '') : '';
      selectionState = groupKey === ''
        ? 'none'
        : this.selection.getGroupSelectionState(groupKey);
    }
    // Cycle 15.5 / Task 7 — suppressCount and innerRenderer options.
    const suppressCount = this.options.suppressCount === true
      || this.options.groupRowRendererParams?.suppressCount === true;
    const innerRenderer = this.options.groupRowRendererParams?.innerRenderer;
    // Cycle 18 / Task 9 follow-up — under pivot mode a group at the
    // deepest row-group level has nothing to expand into: leaf data
    // rows are suppressed by the worker slicer (commit 8c2f398), so
    // toggling the chevron reveals nothing. Suppress the caret on
    // those rows so the user isn't tricked into thinking there's
    // hidden content. Non-pivot mode keeps the legacy behaviour:
    // every group row paints its chevron even when it has zero child
    // groups (clicking still toggles to reveal leaf rows).
    const rowGroupDepthCount = this.groupingState.getRowGroupColumns().length;
    const suppressChevron = rowKind === 1
      && this.pivotActive
      && rowGroupDepthCount > 0
      && depth === rowGroupDepthCount - 1;
    return {
      kind: 'group',
      rowKind,
      depth,
      valueFormatted,
      childCount,
      isExpanded,
      selectionState,
      suppressCount: suppressCount || undefined,
      innerRenderer,
      suppressChevron: suppressChevron || undefined,
    };
  }

  /** Cycle 15 / Task 16 — group depth for a given local row index.
   *  Same index space as `groupCellContextAt`. Returns 0 outside the chunk. */
  private groupDepthAt(rowIndex: number): number {
    if (!this.chunk) return 0;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return 0;
    return this.chunk.groupDepth[localIndex] ?? 0;
  }

  /** Cycle 15 / Task 16 — composite group key for a given local row index.
   *  Returns `''` for data rows or when outside the current chunk. */
  private groupKeyAt(rowIndex: number): string {
    if (!this.chunk) return '';
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return '';
    return this.chunk.groupKey?.[localIndex] ?? '';
  }

  /** Cycle 15.5 / Task 6 — public surface for the feature interface.
   *  Delegates to the private `groupKeyAt` helper. */
  getGroupKeyAtRow(rowIndex: number): string {
    return this.groupKeyAt(rowIndex);
  }

  /** Cycle 15.5 / Task 6 — true when the row at `rowIndex` is a group
   *  row (rowKind === 1). Returns false on data rows or outside the chunk. */
  isGroupRow(rowIndex: number): boolean {
    if (!this.chunk) return false;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return false;
    return (this.chunk.rowKinds?.[localIndex] ?? 0) === 1;
  }

  /** Cycle 15.5 / Task 6 — true when `groupKey` is in the current
   *  expanded set. Returns false for collapsed or unknown keys. */
  isGroupExpanded(groupKey: string): boolean {
    if (this.expandedKeys === null) return true; // all-expanded sentinel
    return this.expandedKeys.has(groupKey);
  }

  /** Visible-leaf colIds in RENDER order: left-pinned first, then center,
   *  then right-pinned. Within each zone the columns keep their definition
   *  order. Used by interaction features (arrow-key nav, range selection,
   *  header-click column band) so a horizontal drag in the center zone
   *  produces a slice of CENTER columns, not a slice over the raw
   *  definition array that interleaves pinned columns positioned earlier
   *  in `columnDefs`.
   *
   *  Why this matters: `columnDefs` is authored top-to-bottom in the order
   *  the data is shaped (e.g. `currentPrice` near the middle, `pnl` six
   *  positions later but pinned-right). The visual layout pulls every
   *  pinned-right column to the rightmost zone, so a drag from
   *  `currentPrice` to `unrealizedPnl` should produce
   *  `[currentPrice, dailyPnl, unrealizedPnl]` (visually contiguous), NOT
   *  `[currentPrice, pnl, dailyPnl, unrealizedPnl]` (definition slice
   *  that drags the right-pinned `pnl` into the middle of the rect). */
  private allColIdsInRenderOrder(): string[] {
    const left: string[] = [];
    const center: string[] = [];
    const right: string[] = [];
    for (const c of this.columnOrder) {
      if (c.pinned === 'left') left.push(c.colId);
      else if (c.pinned === 'right') right.push(c.colId);
      else center.push(c.colId);
    }
    return [...left, ...center, ...right];
  }

  private workerColumns(): WorkerColumn[] {
    // Start from the visible column order. When auto-hide is active (grouped
    // columns are hidden from display), the grouping columns are missing from
    // `columnOrder` but the worker's GroupPass still needs them in its colIndex
    // to resolve field names. Append any group-by column that is not already
    // visible so the worker never loses the ability to bucket rows by that field.
    const visibleIds = new Set(this.columnOrder.map((c) => c.colId));
    // Source primary leaf defs from the saved primary tree while pivot is
    // active (the live `columnDefsMap` then holds the SYNTHESIZED pivot
    // leaves, not `sector` / `pnl`). Falls back to `columnDefsMap` when no
    // pivot swap is in effect.
    const primaryLeaves = this.primaryColumnTree?.leafById ?? this.columnDefsMap;
    // Columns the worker needs in its colIndex even when hidden from the
    // display: row-group columns (GroupPass) + pivot columns + value
    // columns (PivotPass reads their fields). Cycle 15 hid grouped cols;
    // Cycle 18 / Task 3 hides ALL primaries under pivot, so the pivot +
    // value columns must be re-appended or the worker loses their fields.
    const extraIds = new Set<string>();
    for (const id of this.groupModel.rowGroupCols) if (!visibleIds.has(id)) extraIds.add(id);
    for (const id of this.pivotState.getPivotColumns()) if (!visibleIds.has(id)) extraIds.add(id);
    for (const v of this.pivotState.getValueColumns()) if (!visibleIds.has(v.colId)) extraIds.add(v.colId);
    const extraGroupCols = [...extraIds]
      .map((id) => primaryLeaves.get(id) as ResolvedColDef<TRow> | undefined)
      .filter((def): def is ResolvedColDef<TRow> => def !== undefined);
    return [...this.columnOrder, ...extraGroupCols].map((c) => {
      const base: WorkerColumn = {
        colId: c.colId,
        field: c.field as string | undefined,
        type: c.cellDataType,
        aggFunc: c.aggFunc,
        filter: c.filter,
      };
      // Cycle 7 / Task 5 — forward the text-filter `textFormatter`
      // so the worker's matchesText can normalise both the cell value
      // AND the filter value before the operator comparison fires.
      if (c.filter === 'text') {
        const fp = c.filterParams as import('./types').CTextFilterParams | undefined;
        if (fp?.textFormatter) base.textFormatter = fp.textFormatter;
      }
      // Cycle 8 / Task 3 — forward the registered comparator NAME only.
      // Inline closures don't cross `postMessage`; they're rejected at
      // setSortModel time with a clear error pointing the app at
      // `registerComparator`.
      if (typeof c.comparator === 'string') {
        base.comparator = c.comparator;
      }
      // Cycle 8 / Task 5 — forward the column's accentedSort opt-in so
      // SortPass.compare can route this column's text comparisons
      // through Intl.Collator without re-walking the col def. Only
      // meaningful for text columns; the worker ignores it when a
      // registered comparator is in play.
      if (c.accentedSort === true) {
        base.accentedSort = true;
      }
      // Cycle 15 / Task 11 — forward sortGroupRowsByKey so the
      // group-aware sort can keep the cheap composite-key compare at
      // this column's level (skips a registered comparator / accented
      // collator over the raw group .value). Has no effect on
      // within-bucket leaf-row sorting.
      if (c.sortGroupRowsByKey === true) {
        base.sortGroupRowsByKey = true;
      }
      // Cycle 5 / Task 8 — forward autoHeight metadata so the worker can
      // measure wrapped text without re-walking the column tree. Width is
      // the inner text width (column width minus the cell horizontal
      // padding); font + lineHeight + padding are taken from the active
      // theme so the worker's measure matches what the renderer paints.
      if (c.autoHeight) {
        const horizPad = 16; // matches the inline-cell horizontal padding in painters/byRows
        const fontFromCell = c.cellStyle?.font;
        const lineHeight = this.theme.rowHeight;
        const padding = 4;
        base.autoHeight = true;
        base.autoHeightFont = fontFromCell ?? this.theme.font;
        base.autoHeightWidth = Math.max(0, (c.width ?? 200) - horizPad);
        base.autoHeightLineHeight = lineHeight;
        base.autoHeightPadding = padding;
      }
      return base;
    });
  }

  /** Cycle 5 / Task 8 — apply heights pushed from the worker's autoHeight
   *  pass. Updates the Fenwick index for the affected range and requests a
   *  repaint. Skips when the index has been wiped between request and
   *  response (sort/filter/transaction landed in between) — the next
   *  viewport fetch rebuilds it cleanly. */
  private onHeightsChanged(rowStart: number, heights: Float32Array): void {
    const idx = this.rowHeightIndex;
    if (!idx) return;
    const fallback = this.options.rowHeight ?? this.theme.rowHeight;
    let any = false;
    for (let i = 0; i < heights.length; i++) {
      const globalIdx = rowStart + i;
      if (globalIdx >= idx.length()) break;
      const raw = heights[i]!;
      const resolved = raw > 0 ? raw : fallback;
      if (idx.heightAt(globalIdx) !== resolved) {
        idx.update(globalIdx, resolved);
        any = true;
      }
    }
    if (any) {
      // Mirror into the chunk so DataSubgrid.getRowHeight (which reads
      // chunk.heights for in-window rows) picks up the new values without
      // refetching the chunk.
      if (this.chunk) {
        for (let i = 0; i < heights.length; i++) {
          const localIdx = rowStart + i - this.chunk.rowStart;
          if (localIdx >= 0 && localIdx < this.chunk.heights.length) {
            this.chunk.heights[localIdx] = heights[i]!;
          }
        }
      }
      this.recomputeViewport();
      this.cgridCanvas.requestRepaint();
    }
  }

  /** Cycle 5 / Task 8 — main-thread fallback for `OffscreenCanvas.measureText`.
   *  Runs the same greedy word-wrap the worker would, using a regular
   *  `<canvas>` 2D context so Safari 15.4–16.3 + Firefox 100–104 still get
   *  autoHeight without blocking the worker pipeline. */
  private onMeasureTextRequest(batchId: number, items: import('./worker/protocol').MeasureTextItem[]): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // No 2D context anywhere — best effort: zero-height response so the
      // worker resolves and the autoHeight pass exits cleanly.
      void this.workerClient.measureTextResponse(batchId, new Float32Array(items.length));
      return;
    }
    const heights = new Float32Array(items.length);
    let lastFont = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.font !== lastFont) {
        ctx.font = item.font;
        lastFont = item.font;
      }
      const measure = (s: string) => ctx.measureText(s).width;
      heights[i] = wrapTextToHeight(item.text, item.width, item.lineHeight, item.padding, measure);
    }
    void this.workerClient.measureTextResponse(batchId, heights);
  }

  private computeCurrentViewport(): ViewportState {
    // Use the canvas drawable width (which subtracts the scrollbar gutter on
    // overlay-scrollbar platforms — see CGridCanvas.measureSize). Falling back
    // to scroller.clientWidth would leave the rightmost right-pinned column
    // extending into the gutter, clipped by the canvas right edge.
    const w = this.canvasBounds.width || this.scroller.clientWidth || this.root.clientWidth || 800;
    const h = this.canvasBounds.height || this.scroller.clientHeight || this.root.clientHeight || 600;
    return computeViewport({
      columnLayout: this.columnLayout,
      subgrids: this.subgrids,
      containerWidth: w,
      containerHeight: h,
      scrollLeft: this.scrollLeft,
      scrollTop: this.scrollTop,
      rowBuffer: this.options.rowBuffer,
      // Cycle 20 / Task 6 — `domLayout: 'print'` forces every row +
      // every column to materialise so the browser print path
      // captures the entire grid.
      suppressColumnVirtualisation:
        this.options.suppressColumnVirtualisation
        || this.options.domLayout === 'print',
      suppressRowVirtualisation:
        this.options.suppressRowVirtualisation
        || this.options.domLayout === 'print',
      dataRowHeightIndex: this.rowHeightIndex ?? undefined,
    });
  }

  /** Size the invisible sizer to match the viewport's scrollable extent so the
   * native scrollbars track the right range. When an axis has no overflow
   * (`maxScroll{Left,Top} === 0`) the sizer collapses to 1 px on that axis
   * — NOT `clientArea + 0`. Reason: clientWidth/Height already excludes any
   * existing scrollbar gutter, so setting the sizer equal to the current
   * client extent puts scrollHeight right at the threshold. If the OTHER
   * axis then needs a scrollbar (e.g. wide columns force horizontal
   * scrolling), Chrome shrinks the cross-axis client extent by the gutter
   * width, and `scrollHeight > new clientHeight` triggers a phantom vertical
   * scrollbar even with zero rows.
   */
  private syncSizer(): void {
    if (!this.sizer) return; // happy-dom guard during early construction
    const baseW = this.scroller.clientWidth || this.root.clientWidth;
    const baseH = this.scroller.clientHeight || this.root.clientHeight;
    const w = this.viewport.maxScrollLeft > 0 ? baseW + this.viewport.maxScrollLeft : 1;
    const h = this.viewport.maxScrollTop > 0 ? baseH + this.viewport.maxScrollTop : 1;
    this.sizer.style.width = `${Math.max(1, w)}px`;
    this.sizer.style.height = `${Math.max(1, h)}px`;
  }

  /** Reassign viewport AND re-sync the sizer so native scrollbars stay accurate.
   *  `afterScroll` flags scroll-driven recomputes so the `virtualColumnsChanged`
   *  emission can report `afterScroll: true` in that case (every other caller
   *  — resize, column mutation, group toggle — passes `false`). Cycle 6 / Task 8. */
  private recomputeViewport(afterScroll: boolean = false): void {
    this.viewport = this.computeCurrentViewport();
    this.syncSizer();
    this.detectVirtualColumnsChanged(afterScroll);
    // Cycle 7 / Task 1 — re-pin the floating-filter `<input>` pool after
    // every layout pass. Guarded because `recomputeViewport` runs once in
    // the constructor before `floatingFilterOverlay` is assigned.
    if (this.floatingFilterOverlay) {
      this.floatingFilterOverlay.repositionAll(this.viewport);
    }
  }

  /** Compare the materialised center-column range against the previous
   *  `recomputeViewport` and emit `virtualColumnsChanged` if it shifted.
   *  Identifies the range by the first / last center colId since
   *  `ViewportColumn.index` is a 0..N position within `visibleColumns` —
   *  not a layout index — so it doesn't move when columns slide off-screen.
   *  The first call after construction captures the baseline silently so
   *  external listeners only see real post-mount changes. Cycle 6 / Task 8. */
  private detectVirtualColumnsChanged(afterScroll: boolean): void {
    let first: string | null = null;
    let last: string | null = null;
    for (const c of this.viewport.visibleColumns) {
      if (c.pinned) continue;
      if (first === null) first = c.colId;
      last = c.colId;
    }
    const prev = this.prevVirtualColRange;
    if (prev === null) {
      this.prevVirtualColRange = { first, last };
      return;
    }
    if (prev.first === first && prev.last === last) return;
    this.prevVirtualColRange = { first, last };
    this.events.emit({ type: 'virtualColumnsChanged', afterScroll });
  }

  /** Called by the scroller's native 'scroll' event. Idempotent — if the
   * internal state already matches (e.g., because we just set scrollLeft
   * programmatically), it's a no-op so there's no feedback loop.
   */
  private onScrollerScroll(x: number, y: number): void {
    if (x === this.scrollLeft && y === this.scrollTop) return;
    const horizontal = x !== this.scrollLeft;
    const verticalChanged = y !== this.scrollTop;
    // Cycle 25 / Task 8 — sample scroll velocity (rows/ms) before
    // we mutate scrollTop. requestViewport reads this to widen the
    // fetched range on a fast fling. We use the row-height index
    // when present (variable heights) and fall back to the theme's
    // uniform row height otherwise.
    if (verticalChanged) {
      const now = performance.now();
      const dt = now - this.lastScrollSampleTime;
      if (dt > 0 && this.lastScrollSampleTime > 0 && dt < 200) {
        const idx = this.rowHeightIndex;
        const yRow = idx ? idx.rowAt(y) : Math.floor(y / (this.options.rowHeight ?? this.theme.rowHeight));
        const prevYRow = idx ? idx.rowAt(this.lastScrollSampleTop) : Math.floor(this.lastScrollSampleTop / (this.options.rowHeight ?? this.theme.rowHeight));
        this.scrollVelocityRows = (yRow - prevYRow) / dt;
      } else {
        this.scrollVelocityRows = 0;
      }
      this.lastScrollSampleTop = y;
      this.lastScrollSampleTime = now;
    }
    this.scrollLeft = x;
    this.scrollTop = y;
    this.recomputeViewport(/* afterScroll */ horizontal);
    this.events.emit({ type: 'viewportChanged', firstRow: this.viewport.firstRow, lastRow: this.viewport.lastRow });
    // Cycle 23 / Task 3 — bodyScroll fires every tick. `direction`
    // reports the dominant axis change for THIS tick; ties (both
    // axes moved) report `'vertical'` so listeners get a stable
    // signal for the more common case.
    this.events.emit({
      type: 'bodyScroll', top: y, left: x,
      direction: verticalChanged ? 'vertical' : 'horizontal',
    });
    // Cycle 23 / Task 3 — bodyScrollEnd is debounced 200ms after the
    // last scroll tick. Subsequent scrolls reset the timer so apps
    // that persist on the END event save once per gesture instead of
    // once per pixel.
    if (this.scrollEndTimer !== null) clearTimeout(this.scrollEndTimer);
    this.scrollEndTimer = setTimeout(() => {
      this.scrollEndTimer = null;
      if (this.destroyed) return;
      this.events.emit({ type: 'bodyScrollEnd', top: this.scrollTop, left: this.scrollLeft });
    }, 200);
    this.cgridCanvas.requestRepaint();
    this.requestViewport();
    this.syncOpenEditorPosition();
  }

  /** Keep an open inline / popup editor anchored to its cell when the
   *  grid scrolls. Closes the editor (commit) when the cell scrolls
   *  out of its column's band or out of the body's vertical band —
   *  the DOM-based editor lives on an unclipped host (shared with
   *  filter popups + context menus, which must NOT be clipped), so
   *  the close is what keeps the input from rendering over the header
   *  or sliding into a foreign pinned band. The band-clip rule is
   *  delegated to `getVisibleCellBounds` (Cycle 12 / Task 1) so this
   *  method, the focus ring, and the range overlay all share one
   *  source of truth. No-op when no editor is open. */
  private syncOpenEditorPosition(): void {
    if (!this.activeEdit) return;
    if (!this.editor.isOpen()) return;
    const { rowIndex, colId } = this.activeEdit;
    const bounds = this.getVisibleCellBounds(rowIndex, colId);
    if (!bounds) {
      this.editor.commit();
      return;
    }
    this.editor.reposition(bounds);
  }

  private setScroll(x: number, y: number): void {
    const clampedX = Math.max(0, Math.min(this.viewport.maxScrollLeft, x));
    const clampedY = Math.max(0, Math.min(this.viewport.maxScrollTop, y));
    if (clampedX === this.scrollLeft && clampedY === this.scrollTop) return;
    // Drive the scroller; its scroll event will call onScrollerScroll which
    // updates internal state and repaints. Setting these properties also
    // visually moves the native scrollbar thumb.
    this.scroller.scrollLeft = clampedX;
    this.scroller.scrollTop = clampedY;
    // Belt-and-suspenders: if the scroll event hasn't fired yet (e.g., in
    // happy-dom tests), update synchronously so callers see the new state.
    if (this.scrollLeft !== clampedX || this.scrollTop !== clampedY) {
      this.onScrollerScroll(clampedX, clampedY);
    }
  }

  /** Bring the row at `rowIndex` into the visible body.
   *  `'auto'` scrolls just enough to expose the row (no-op if already in
   *  view); the named positions force `top` / `middle` / `bottom` alignment
   *  inside the body area. Clamping is delegated to `setScroll`.
   *
   *  Row top / height are read from the Fenwick tree when available so
   *  variable-height rows scroll to the right pixel (Cycle 5 / Task 7).
   *  Without an index — e.g. before the first chunk lands — we fall back to
   *  uniform-height arithmetic. */
  private ensureRowIndexVisible(
    rowIndex: number,
    position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto',
  ): void {
    const fallback = this.options.rowHeight ?? this.theme.rowHeight;
    const idx = this.rowHeightIndex;
    const useIdx = idx !== null && rowIndex < idx.length();
    const top = useIdx ? idx!.topOf(rowIndex) : rowIndex * fallback;
    const rh = useIdx ? idx!.heightAt(rowIndex) : fallback;
    const bottom = top + rh;
    const bodyH = this.viewport.bodyHeight;
    if (position === 'top') {
      this.setScroll(this.scrollLeft, top);
      return;
    }
    if (position === 'middle') {
      this.setScroll(this.scrollLeft, top - Math.max(0, (bodyH - rh) / 2));
      return;
    }
    if (position === 'bottom') {
      this.setScroll(this.scrollLeft, bottom - bodyH);
      return;
    }
    if (top < this.scrollTop) {
      this.setScroll(this.scrollLeft, top);
    } else if (bottom > this.scrollTop + bodyH) {
      this.setScroll(this.scrollLeft, bottom - bodyH);
    }
  }

  /** Bring the column with `colId` into the visible body. Pinned columns are
   *  always visible. `'auto'` scrolls just enough; the named positions force
   *  `start` / `middle` / `end` alignment inside the body area. */
  private ensureColIdVisible(
    colId: string,
    position: 'auto' | 'start' | 'middle' | 'end' = 'auto',
  ): void {
    const layoutCol = this.columnLayout.find((c) => c.colId === colId);
    if (!layoutCol || layoutCol.pinned) return;
    // Convert content-space left (relative to layout) into body-content space.
    const pinnedLeftWidth = this.columnLayout.filter((c) => c.pinned === 'left').reduce((s, c) => s + c.width, 0);
    const left = layoutCol.left - pinnedLeftWidth;
    const right = left + layoutCol.width;
    const bodyW = this.viewport.bodyWidth;
    if (position === 'start') {
      this.setScroll(left, this.scrollTop);
      return;
    }
    if (position === 'middle') {
      this.setScroll(left - Math.max(0, (bodyW - layoutCol.width) / 2), this.scrollTop);
      return;
    }
    if (position === 'end') {
      this.setScroll(right - bodyW, this.scrollTop);
      return;
    }
    if (left < this.scrollLeft) {
      this.setScroll(left, this.scrollTop);
    } else if (right > this.scrollLeft + bodyW) {
      this.setScroll(right - bodyW, this.scrollTop);
    }
  }

  /** After the worker model changes (sort / filter / transaction / column
   *  swap), re-resolve every persistent selection rowId to its new visible
   *  index and apply it to the paint set. No worker round-trip when no
   *  persistent ids are tracked — keeps the common no-selection case free. */
  private rebuildSelectionFromPersistentIds(): void {
    const selectedIds = this.selection.getPersistentSelectedRowIds();
    const focusedId = this.selection.getPersistentFocusedRowId();
    const allIds: string[] = [...selectedIds];
    if (focusedId !== null && !selectedIds.includes(focusedId)) allIds.push(focusedId);
    if (allIds.length === 0) {
      // Nothing selected or focused — clear any stale paint indices immediately,
      // no worker round-trip needed.
      this.selection.rebuildIndices(new Map());
      return;
    }
    this.workerClient.getRowIndicesForIds(allIds).then((indices) => {
      if (this.destroyed) return;
      const map = new Map<string, number>();
      for (let i = 0; i < allIds.length; i++) map.set(allIds[i]!, indices[i]!);
      this.selection.rebuildIndices(map);
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid] rebuildSelectionFromPersistentIds:', err); });
  }

  /** Walk the column tree to collect the ancestor groupIds (root → parent)
   *  of `groupId`. Excludes `groupId` itself. Empty for top-level groups. */
  private findGroupAncestors(groupId: string): string[] {
    const path: string[] = [];
    const visit = (node: import('./core/columnTree').ColumnTreeNode, trail: string[]): boolean => {
      if (node.kind !== 'group') return false;
      if (node.groupId === groupId) {
        path.push(...trail);
        return true;
      }
      const nextTrail = [...trail, node.groupId];
      for (const child of node.children) {
        if (visit(child, nextTrail)) return true;
      }
      return false;
    };
    for (const root of this.columnTree.roots) {
      if (visit(root, [])) break;
    }
    return path;
  }

  /** Fetch the next viewport chunk. `aggSource` (Cycle 14 / Task 6) tags the
   *  triggering mutation so the `aggregationChanged` event the response
   *  handler emits carries the correct cause. Pass `null` (default) for
   *  cosmetic re-fetches that don't recompute totals — scroll, sort,
   *  theme, column move / visible / pin / resize — so the response
   *  handler can tell "the totals are the same; suppress the event"
   *  apart from "data / filter / aggFuncs changed; emit". Most-recent-
   *  source wins when multiple data-affecting calls coalesce on a single
   *  in-flight fetch; null calls preserve any pending source. */
  private requestViewport(aggSource: AggregationChangedSource | null = null): void {
    if (aggSource !== null) this.pendingAggSource = aggSource;
    // Coalesce: while one fetch is in-flight, additional calls flip a queued
    // flag so a single follow-up runs after the current completes. Without
    // this, rapid resizes drop all but the first request — the chunk stays
    // stuck on the initial viewport range and newly-visible rows render with
    // no data until the user stops resizing.
    if (this.viewportRequestPending) {
      this.viewportRequestQueued = true;
      return;
    }
    this.viewportRequestPending = true;
    const cols = this.viewport.visibleColumns.map((c) => c.colId);
    // Cycle 25 / Task 8 — widen the row range when scrolling fast so
    // the next chunk already covers the about-to-be-visible rows.
    // expandRangeForVelocity is a no-op when velocity is below the
    // threshold (most scroll ticks), so the request stays at the
    // tight visible range under normal interaction.
    const { rowStart, rowEnd } = expandRangeForVelocity(
      this.viewport.firstRow,
      this.viewport.lastRow + 1,
      this.scrollVelocityRows,
    );
    this.workerClient.getViewport({ rowStart, rowEnd, columns: cols, includeFlashMask: true })
      .then(({ chunk, stickyAncestors }) => {
        this.viewportRequestPending = false;
        // Capture the previous chunk's totals BEFORE overwriting this.chunk
        // so the aggregate-flash diff can compare old vs new values.
        const prevGroupTotals = this.chunk?.groupTotals;
        const prevChunkTotals = this.chunk?.totals;
        this.chunk = chunk;
        this.stickyAncestors = stickyAncestors ?? [];
        this.decodedTextCols.clear();
        // Cycle 25 / Task 10 — park the chunk in the LRU. WeakRef
        // retention means GC can reclaim if real memory pressure
        // builds; the LRU's own eviction kicks in when our running
        // sum exceeds `memoryBudgetMB`. Cache lookup on subsequent
        // requests is intentionally NOT wired here — keying on
        // model versions (sort/filter/group/pivot) needs more
        // surface than this cycle delivers. Foundation only.
        if (this.chunkLRU) {
          const key = `${rowStart}:${rowEnd}:${cols.join(',')}`;
          this.chunkLRU.set(key, chunk, estimateChunkBytes(chunk));
        }
        // Cycle 18 / Task 3 — (re)synthesize or drop the pivot result
        // columns from the freshly-arrived pivot tree before the layout +
        // paint below run off the new column order.
        this.maybeSyncPivotColumns(chunk);
        // Cycle 18 / Task 8a — surface the cap breach as a public event.
        // The chunk already arrived with no pivot output when this is set
        // (PivotPass bypassed early); the grid paints primary columns
        // normally. Apps can listen + raise the cap / narrow the filter.
        // Emit ONCE per chunk that carries the field — no debounce needed
        // since the worker only sets the field when the breach actually
        // happened (not on every chunk).
        if (chunk.pivotMaxColumnsReached !== undefined) {
          this.events.emit({
            type: 'pivotMaxColumnsReached',
            generatedColumns: chunk.pivotMaxColumnsReached.generatedColumns,
            cap: chunk.pivotMaxColumnsReached.cap,
          });
        }
        // Cycle 4 / Task 11 (cell-flash patch) — drain the worker's
        // per-cell flashMask into the registry. The chunk's `rowIds`
        // are numeric (the worker's stable mapping); the painter's
        // cellData callback reads `registry.getAlpha(numericRowId,
        // colId, now)` to produce flashAlpha per visible cell.
        if (chunk.flashMask) {
          this.flashRegistry.ingestMask({
            rowIds: chunk.rowIds,
            colIds: cols,
            mask: chunk.flashMask,
          });
          this.startFlashTickLoop();
        }
        // Flash aggregate cells whose groupTotals or grand totals changed
        // vs the previous chunk. Data-row flashes come from the worker's
        // flashMask (keyed by rowId); group/footer rows carry no rowId
        // so we diff the totals records here on the main thread.
        // groupTotals covers per-group group rows AND per-group footer rows.
        // chunk.totals covers the grand-total footer (groupKey='').
        if (this.options.enableCellChangeFlash) {
          const now = performance.now();
          if (chunk.groupTotals && prevGroupTotals) {
            for (const groupKey of Object.keys(chunk.groupTotals)) {
              const oldRec = prevGroupTotals[groupKey];
              const newRec = chunk.groupTotals[groupKey]!;
              for (const colId of Object.keys(newRec)) {
                if (oldRec?.[colId] !== newRec[colId]) {
                  this.groupFlashMap.set(`${groupKey}\0${colId}`, now);
                }
              }
            }
          }
          // Grand-total footer (groupKey='') sources from chunk.totals,
          // not groupTotals. Diff it separately; store under the '' key
          // so groupFlashAlpha('', colId) resolves for rowKind=3 + empty key.
          if (chunk.totals && prevChunkTotals) {
            for (const colId of Object.keys(chunk.totals)) {
              if (prevChunkTotals[colId] !== chunk.totals[colId]) {
                this.groupFlashMap.set(`\0${colId}`, now);
              }
            }
          }
          if (this.groupFlashMap.size > 0) this.startFlashTickLoop();
        }
        // Build / refresh the cumulative row-height index (Cycle 5 / Task 7).
        // Initial build seeds every row with the grid-level fallback; subsequent
        // chunks layer their per-row heights in. A rowCount change (sort /
        // filter / transaction) discards the existing index so per-row entries
        // that shifted slots aren't read at their old positions — the next
        // chunks rebuild it. Done before recomputeViewport so the index is
        // current for the first paint after the chunk lands.
        this.refreshRowHeightIndex(chunk);
        // Recompute the viewport so DataSubgrid.getRowHeight reads the new
        // chunk's per-row heights (Cycle 5 / Task 6). Without this the
        // visibleRows array carries heights from BEFORE the chunk arrived
        // and variable-height rows paint at the fallback until the next
        // scroll triggers another recompute.
        this.recomputeViewport();
        this.cgridCanvas.requestRepaint();
        this.updateA11y();
        // Cycle 14 / Task 6 — emit `aggregationChanged` ONLY when the
        // mutation that drove this fetch actually changed the totals
        // (data / filter / aggFuncs / column aggFunc / explicit API).
        // Cosmetic re-fetches (scroll, sort, theme, column move /
        // visible / pin / resize) call `requestViewport()` with no
        // source so `pendingAggSource` stays null and we skip the
        // event — listeners that want every paint subscribe to
        // `viewportChanged` instead. Cleared on emit so a follow-up
        // coalesced scroll fetch doesn't re-fire with the same source.
        if (chunk.totals && this.pendingAggSource !== null) {
          this.events.emit({
            type: 'aggregationChanged',
            totals: chunk.totals,
            source: this.pendingAggSource,
          });
          this.pendingAggSource = null;
        }
        // firstDataRendered: latch once per grid instance, the first time a
        // non-empty chunk has landed and a repaint has been scheduled. Empty
        // chunks (e.g. setRowData([]) or filter-out-everything) don't count.
        if (!this.firstDataFired && chunk.rowCount > 0) {
          this.firstDataFired = true;
          this.events.emit({ type: 'firstDataRendered' });
        }
        if (this.viewportRequestQueued) {
          this.viewportRequestQueued = false;
          this.requestViewport();
        }
      })
      .catch((err) => {
        this.viewportRequestPending = false;
        this.viewportRequestQueued = false;
        if (!this.destroyed) console.error('[cgrid] viewport request:', err);
      });
  }

  /** Build the cumulative-height index from scratch when `rowCount` changed,
   *  then merge the chunk's per-row heights into it. The 0 sentinel in
   *  `chunk.heights` means "no per-row override" — we leave those at the
   *  fallback so rows without explicit heights stay at the grid-level
   *  `rowHeight`. Cycle 5 / Task 7. */
  private refreshRowHeightIndex(chunk: ViewportChunk): void {
    const fallback = this.options.rowHeight ?? this.theme.rowHeight;
    if (!this.rowHeightIndex || this.rowHeightIndex.length() !== this.rowCount) {
      this.rowHeightIndex = new RowHeightIndex(this.rowCount, () => fallback);
    }
    const idx = this.rowHeightIndex;
    for (let i = 0; i < chunk.heights.length; i++) {
      const globalIdx = chunk.rowStart + i;
      if (globalIdx >= idx.length()) break;
      const raw = chunk.heights[i]!;
      const resolved = raw > 0 ? raw : fallback;
      if (idx.heightAt(globalIdx) !== resolved) {
        idx.update(globalIdx, resolved);
      }
    }
  }

  /** Resolve the height of the data row at `localRowIndex`. When the row is
   *  present in the current viewport chunk and has a non-zero per-row entry,
   *  use that; otherwise fall back to the grid-level `rowHeight`. The 0
   *  sentinel in `chunk.heights` means "no per-row override" — substitute
   *  the fallback so columns with mixed-heights row sets don't shrink to 0.
   *  Task 7's Fenwick tree extends this with O(log n) global coverage. */
  private rowHeightAt(localRowIndex: number): number {
    const fallback = this.options.rowHeight ?? this.theme.rowHeight;
    if (!this.chunk) return fallback;
    const i = localRowIndex - this.chunk.rowStart;
    if (i < 0 || i >= this.chunk.heights.length) {
      // Under active pivot mode, rows outside the chunk are always leaves
      // (the slicer only ships group rows + footer entries into the chunk).
      // Returning 0 collapses the data subgrid's extent to just the visible
      // group rows — which is what makes the bottom-pinned Grand Total row
      // visible without forcing the user to scroll past hundreds of empty
      // leaf rows.
      if (this.pivotActive) return 0;
      return fallback;
    }
    const h = this.chunk.heights[i]!;
    return h > 0 ? h : fallback;
  }

  /** Cycle 4 / Task 11 (cell-flash patch) — rAF handle for the
   *  self-sustaining flash tick. Held so a chunk that arrives while
   *  the loop is already running doesn't double-schedule. */
  private flashTickHandle: number | null = null;

  /** Start (or keep alive) the per-rAF flash tick. Each tick calls
   *  `registry.tick(now)` which prunes expired entries + requests a
   *  repaint when any remain. The loop self-cancels when the
   *  registry empties. Idempotent — already-running ticks aren't
   *  re-scheduled. */
  private startFlashTickLoop(): void {
    if (this.flashTickHandle !== null) return;
    if (typeof requestAnimationFrame !== 'function') return;
    const tick = (now: number): void => {
      this.flashTickHandle = null;
      if (this.destroyed) return;
      this.flashRegistry.tick(now);
      // Prune expired groupFlashMap entries so the loop self-cancels
      // when both the rowId-keyed and groupKey-keyed flash sets drain.
      if (this.groupFlashMap.size > 0) {
        const flashDur = this.options.cellFlashDuration ?? 500;
        const fadeDur = this.options.cellFadeDuration ?? 1000;
        const cutoff = now - flashDur - fadeDur;
        for (const [k, startedAt] of this.groupFlashMap) {
          if (startedAt < cutoff) this.groupFlashMap.delete(k);
        }
        if (this.groupFlashMap.size > 0) this.cgridCanvas.requestRepaint();
      }
      if (this.flashRegistry.size() > 0 || this.groupFlashMap.size > 0) {
        this.flashTickHandle = requestAnimationFrame(tick);
      }
    };
    this.flashTickHandle = requestAnimationFrame(tick);
  }

  /** Cycle 4 / Task 11 (cell-flash patch) — programmatic cell flash.
   *  Routes through the worker so the worker's string→numeric rowId
   *  mapping resolves; the flash actually paints on the next viewport
   *  chunk reply. No-op when `enableCellChangeFlash: false`,
   *  `prefers-reduced-motion: reduce`, or the row IDs are unknown
   *  worker-side. */
  flashCells(params: FlashCellsParams): void {
    if (this.destroyed) return;
    if (this.options.enableCellChangeFlash !== true) return;
    if (this.reducedMotion) return;
    if (!params.rowIds || params.rowIds.length === 0) return;
    const colIds = params.colIds ?? [];
    this.workerClient.flashCells(params.rowIds, colIds)
      .then(() => {
        if (this.destroyed) return;
        // Force a viewport refresh so the worker drains pendingFlashes
        // into the next chunk's flashMask without waiting for a scroll
        // or other natural trigger.
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid] flashCells:', err); });
  }

  private cellAt(rowIndex: number, colId: string): { value: unknown; valueFormatted: string; flashAlpha?: number } | null {
    if (!this.chunk) return null;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    // Cycle 4 / Task 11 (cell-flash patch) — per-cell flashAlpha read
    // from the FlashRegistry. Keyed by the chunk's numeric rowId
    // (allocation-free per-cell lookup). Returns 0 when no flash is
    // active or when the registry is disabled / reduced-motion.
    const numericRowId = this.chunk.rowIds[localIndex]!;
    const flashAlpha = this.flashRegistry.getAlpha(numericRowId, colId, performance.now());
    const flash = flashAlpha > 0 ? flashAlpha : undefined;
    // Cycle 15 / Task 4 + Task 5 — auto-group column reads per-row group
    // context (rowKind / depth / value / childCount / isExpanded) from
    // the chunk's parallel arrays. Returns a typed `GroupCellValue`
    // payload that the `'group'` cell renderer downcasts and uses. Data
    // rows return a payload with `rowKind: 0` so the renderer's
    // short-circuit kicks in and paints nothing. In `'multipleColumns'`
    // mode (Task 5) each per-level auto-group column carries a colId
    // suffixed with the depth (e.g. `ag-Grid-AutoColumn-1`); the
    // renderer reads the depth slot from `cellRendererParams` and
    // filters per-row. Either way `cellAt` returns the same shape;
    // the renderer handles the own-depth filter.
    if (isAutoGroupColumnId(colId)) {
      const payload = this.groupCellContextAt(rowIndex);
      if (payload === null) return { value: '', valueFormatted: '', flashAlpha: flash };
      return { value: payload, valueFormatted: payload.valueFormatted, flashAlpha: flash };
    }
    // Cycle 18 / Task 3 — pivot result columns read their cross-tab
    // aggregate from `chunk.pivotValues`, addressed by the row's group key
    // × the column's (pivotPath, valueColId). Only aggregated rows carry a
    // value: group rows (1), grand-total (2), and footer rows (3) resolve
    // through their composite `groupKey` (the grand total uses key `''`);
    // leaf data rows (0) are not aggregated under pivot → empty.
    if (this.pivotActive && (isPivotResultColumnId(colId) || isPivotRowTotalColumnId(colId))) {
      const spec = this.pivotCellSpecById.get(colId);
      const pivotValues = this.chunk.pivotValues;
      const kind = this.chunk.rowKinds[localIndex] ?? 0;
      if (!spec || !pivotValues || kind === 0) {
        return { value: '', valueFormatted: '', flashAlpha: flash };
      }
      const groupKey = this.chunk.groupKey?.[localIndex] ?? '';
      // Cycle 18 / Task 8e — row totals carry `pivotPath: []`; the join
      // produces `''` which resolves to the row-total bucket
      // PivotPass.apply now emits per group. Regular pivot cells use the
      // joined per-level path. Both paths use the same lookup.
      const raw = pivotValues.get(
        encodePivotValueKey(groupKey, spec.pivotPath.join(PIVOT_PATH_SEP), spec.valueColId),
      );
      if (raw === undefined || raw === null) {
        return { value: '', valueFormatted: '', flashAlpha: flash };
      }
      const valueFormatted = typeof raw === 'number' ? this.formatNumber(colId, raw) : String(raw);
      const gFlash = this.groupFlashAlpha(groupKey, colId);
      return { value: raw, valueFormatted, flashAlpha: gFlash ?? flash };
    }
    // Cycle 15 / Task 12 — footer rows (rowKind === 3) source their
    // per-column values from the per-group totals map (or, for the
    // grand-total footer with `groupKey === ''`, from the standard
    // `chunk.totals` grand-total record). The lookup runs through the
    // same `totalsCellLookup` the TotalsSubgrid uses so any column
    // `valueFormatter` registered for totals applies uniformly. Footer
    // cells in columns WITHOUT an `aggFunc` resolve to empty (the
    // `'groupFooter'` cell renderer paints the em-dash placeholder,
    // inheriting the Cycle 14 totals empty-cell vocabulary).
    if ((this.chunk.rowKinds[localIndex] ?? 0) === 3) {
      const groupKey = this.chunk.groupKey?.[localIndex] ?? '';
      const entry = this.totalsCellLookup(colId, groupKey);
      if (entry === null) return { value: '', valueFormatted: '', flashAlpha: flash };
      const gFlash = this.groupFlashAlpha(groupKey, colId);
      return { value: entry.value, valueFormatted: entry.valueFormatted, flashAlpha: gFlash ?? flash };
    }
    // Group rows (rowKind === 1) show per-group aggregate values from
    // `chunk.groupTotals` when available — same source as the per-group
    // footer row (rowKind === 3). This matches AG Grid's behaviour where
    // a group row header shows the aggregated column values both when
    // collapsed AND when expanded (the footer row echoes them below).
    // Falls through to empty rather than the zero-filled numericCols
    // slot so a group row without an aggFunc column shows nothing
    // rather than a misleading "0".
    if ((this.chunk.rowKinds[localIndex] ?? 0) === 1) {
      const groupKey = this.chunk.groupKey?.[localIndex] ?? '';
      if (groupKey !== '') {
        const entry = this.totalsCellLookup(colId, groupKey);
        if (entry !== null) {
          const gFlash = this.groupFlashAlpha(groupKey, colId);
          return { value: entry.value, valueFormatted: entry.valueFormatted, flashAlpha: gFlash ?? flash };
        }
      }
      return { value: '', valueFormatted: '', flashAlpha: flash };
    }
    const numeric = this.chunk.numericCols[colId];
    if (numeric) {
      const value = numeric[localIndex]!;
      return { value, valueFormatted: this.formatNumber(colId, value), flashAlpha: flash };
    }
    const text = this.chunk.textCols[colId];
    if (text) {
      let decoded = this.decodedTextCols.get(colId);
      if (!decoded) { decoded = decodeText(text.offsets, text.bytes); this.decodedTextCols.set(colId, decoded); }
      const value = decoded[localIndex] ?? '';
      return { value, valueFormatted: value, flashAlpha: flash };
    }
    return { value: '', valueFormatted: '', flashAlpha: flash };
  }

  private rowIdAt(rowIndex: number): string | null {
    // Foundation: numeric IDs need round-trip via worker. For now, we only support cell-level focus events.
    // Real string IDs need a worker→main mapping deferred to a follow-up cycle.
    return `row-${rowIndex}`;
  }

  /** Cycle 24 / Task 4 — subscribe to state-affecting events and feed
   *  human-readable text into the a11y overlay's aria-live region.
   *  The overlay debounces 250ms internally so multiple events
   *  collapse into one announcement. */
  private wireA11yAnnouncements(): void {
    const headerNameOf = (colId: string): string =>
      this.columnDefsMap.get(colId)?.headerName ?? colId;

    this.events.on('sortChanged', (e) => {
      const m = e.sortModel;
      if (m.length === 0) { this.a11y.announce('Sort cleared'); return; }
      const parts = m.map((s) => `${headerNameOf(s.colId)} ${s.direction === 'asc' ? 'ascending' : 'descending'}`);
      this.a11y.announce(`Sorted by ${parts.join(', ')}`);
    });
    this.events.on('filterChanged', () => {
      const cols = Array.from(this.columnFilterModels.keys());
      if (cols.length === 0) {
        this.a11y.announce(`Filters cleared, ${this.rowCount} rows`);
      } else {
        this.a11y.announce(
          `Filtered: ${this.rowCount} rows, ${cols.length} column${cols.length === 1 ? '' : 's'} active`,
        );
      }
    });
    this.events.on('selectionChanged', (e) => {
      const n = e.selectedRowIds.length;
      this.a11y.announce(
        n === 0 ? 'Selection cleared' : `${n} row${n === 1 ? '' : 's'} selected`,
      );
    });
    this.events.on('rowGroupOpened', (e) => {
      this.a11y.announce(`${e.expanded ? 'Expanded' : 'Collapsed'} group ${e.key}`);
    });
    this.events.on('cellEditingStarted', (e) => {
      this.a11y.announce(`Editing ${headerNameOf(e.colId)}, row ${e.rowIndex + 1}`);
    });
    this.events.on('cellEditingStopped', (e) => {
      if (e.valueChanged) {
        this.a11y.announce(`${headerNameOf(e.colId)} set to ${String(e.newValue)}`);
      } else {
        this.a11y.announce('Edit closed');
      }
    });
  }

  /** Cycle 23 / Task 2 — fan out cellMouseOver. Looked up here (not in
   *  the OnHover feature) so the (rowId, value) shape matches the rest
   *  of the cell-* event family — features don't need to reach into
   *  the data path. */
  private emitCellMouseOverFromHover(rowIndex: number, colId: string, mouse: MouseEvent): void {
    const rowId = this.rowIdAt(rowIndex);
    if (!rowId) return;
    this.events.emit({
      type: 'cellMouseOver', rowId, colId,
      value: this.cellAt(rowIndex, colId)?.value, mouse,
    });
  }
  private emitCellMouseOutFromHover(rowIndex: number, colId: string, mouse: MouseEvent): void {
    const rowId = this.rowIdAt(rowIndex);
    if (!rowId) return;
    this.events.emit({
      type: 'cellMouseOut', rowId, colId,
      value: this.cellAt(rowIndex, colId)?.value, mouse,
    });
  }
  private emitRowMouseOverFromHover(rowIndex: number, mouse: MouseEvent): void {
    const rowId = this.rowIdAt(rowIndex);
    if (!rowId) return;
    this.events.emit({ type: 'rowMouseOver', rowId, mouse });
  }
  private emitRowMouseOutFromHover(rowIndex: number, mouse: MouseEvent): void {
    const rowId = this.rowIdAt(rowIndex);
    if (!rowId) return;
    this.events.emit({ type: 'rowMouseOut', rowId, mouse });
  }

  private formatNumber(colId: string, value: number): string {
    if (!Number.isFinite(value)) return '';
    const def = this.columnDefsMap.get(colId);
    if (def?.valueFormatter) {
      return def.valueFormatter({ value, colId, data: undefined as unknown as TRow });
    }
    return value.toString();
  }

  /** Compute flash alpha for a group/footer aggregate cell from
   *  `groupFlashMap`. Returns `undefined` when no flash is active so
   *  the caller can fall through to the data-row `flashAlpha` (which is
   *  always 0 for group rows since their rowId is 0, but keeps the
   *  return type consistent). */
  private groupFlashAlpha(groupKey: string, colId: string): number | undefined {
    const startedAt = this.groupFlashMap.get(`${groupKey}\0${colId}`);
    if (startedAt === undefined) return undefined;
    const now = performance.now();
    const flashDur = this.options.cellFlashDuration ?? 500;
    const fadeDur = this.options.cellFadeDuration ?? 1000;
    const elapsed = now - startedAt;
    if (elapsed < 0) return 1;
    if (elapsed <= flashDur) return 1;
    const fadeElapsed = elapsed - flashDur;
    if (fadeElapsed >= fadeDur) { this.groupFlashMap.delete(`${groupKey}\0${colId}`); return undefined; }
    return 1 - fadeElapsed / fadeDur;
  }

  private updateA11y(): void {
    const { focusedRowIndex, focusedColId } = this.selection.state;
    const focusedRowData = focusedRowIndex == null ? []
      : this.viewport.visibleColumns
          .filter((c) => !c.pinned || c.pinned === 'left')
          .map((c) => ({ colId: c.colId, valueFormatted: this.cellAt(focusedRowIndex, c.colId)?.valueFormatted ?? '' }));
    // aria-expanded for the focused row: resolve the group state only when
    // the focused row is a group row; leaf rows report `null` (no attribute).
    let groupExpanded: boolean | null = null;
    if (focusedRowIndex != null && this.isGroupRow(focusedRowIndex)) {
      const groupKey = this.getGroupKeyAtRow(focusedRowIndex);
      if (groupKey) groupExpanded = this.isGroupExpanded(groupKey);
    }
    this.a11y.update({
      visibleRowCount: this.rowCount,
      columnCount: this.columnOrder.length,
      focusedRowIndex,
      focusedColId,
      focusedRowData,
      groupExpanded,
      // Cycle 24 / Task 3 — aria-label + aria-busy on the grid root.
      // ariaLabel is opt-in; ariaBusy resolves from the runtime
      // `loading` flag so apps that flip it during async loads get
      // the assistive-tech signal automatically.
      ariaLabel: this.options.ariaLabel,
      ariaBusy: this.options.loading === true,
    });
  }

  private resizeColumn(colId: string, dx: number): void {
    const def = this.columnDefsMap.get(colId);
    if (!def) return;
    const cur = this.columnLayout.find((c) => c.colId === colId);
    if (!cur) return;
    const newW = Math.max(def.minWidth, cur.width + dx);
    def.width = newW;
    this.columnLayout = resolveColumnWidths(this.columnOrder, this.root.clientWidth);
    this.recomputeViewport();
    this.cgridCanvas.requestRepaint();
    // Per-tick emission during a drag: finished:false so apps can defer
    // persistence to the mouseup `finished:true` event. Cycle 6 / Task 5.
    this.events.emit({
      type: 'columnResized', colId, width: newW,
      finished: false, source: 'uiColumnResized',
    });
  }

  /** Emit the trailing `columnResized` with `finished: true` for the last
   *  column touched in a resize-drag. Called by `ColumnResizing` on mouseup
   *  so apps that persist on `finished: true` fire one save per drag.
   *  Cycle 6 / Task 5. */
  private finishColumnResize(colId: string): void {
    const def = this.columnDefsMap.get(colId);
    if (!def || def.width == null) return;
    this.events.emit({
      type: 'columnResized', colId, width: def.width,
      finished: true, source: 'uiColumnResized',
    });
  }

  /** Move `colId` to `toIndex` in the flat visible-leaf order. The legal
   *  landing slot is resolved against `lockPosition` + `marryChildren` —
   *  illegal requests clamp to the nearest legal index rather than throw.
   *  Cross-group moves are not honored: leaves can only be reordered
   *  within their enclosing scope (top-level for ungrouped, group-local
   *  for grouped). This matches the Task-1 worklog's "walk the tree,
   *  reorder leaves inside their nearest enclosing group" guidance.
   *  Emits `columnMoved` with the resolved final index + the originating
   *  `source`. Cycle 6 / Task 1. */
  private reorderColumn(
    colId: string,
    toIndex: number,
    source: 'uiColumnDragged' | 'api' | 'columnState',
  ): void {
    if (!this.columnDefsMap.has(colId)) return;
    const currentOrder = this.columnOrder.map((c) => c.colId);
    const currentIndex = currentOrder.indexOf(colId);
    if (currentIndex < 0) return;
    const constraints = this.buildColumnOrderConstraints();
    const legalTarget = resolveLegalDropIndex(
      currentOrder,
      { colId, toIndex },
      constraints,
    );
    if (legalTarget === currentIndex) return;
    const newOrder = applyReorder(currentOrder, { colId, toIndex: legalTarget });
    const newDefs = rebuildColumnDefsByLeafOrder(this.options.columnDefs, newOrder);
    this.options.columnDefs = newDefs;
    this.rebuildColumns({ defaultColDef: this.options.defaultColDef });
    this.workerClient.updateColumns(this.workerColumns())
      .then(({ visibleCount }) => {
        this.rowCount = visibleCount;
        this.recomputeViewport();
        this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
        this.events.emit({ type: 'displayedColumnsChanged', source: 'columnMoved' });
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid] reorderColumn:', err); });
    this.events.emit({ type: 'columnMoved', toIndex: legalTarget, colIds: [colId], source });
  }

  /** Move the leaf at `fromIndex` to `toIndex` in the flat visible-leaf
   *  order. No-op when indices are out of range or equal. Honors
   *  `lockPosition` + `marryChildren`. Cycle 6 / Task 1. */
  moveColumnByIndex(fromIndex: number, toIndex: number): void {
    const ids = this.columnOrder.map((c) => c.colId);
    if (fromIndex < 0 || fromIndex >= ids.length) return;
    if (toIndex < 0 || toIndex >= ids.length) return;
    if (fromIndex === toIndex) return;
    const colId = ids[fromIndex]!;
    this.reorderColumn(colId, toIndex, 'api');
  }

  /** Cycle 6 / Task 2 — serialisable snapshot of every leaf's mutable
   *  state in declaration order (hidden leaves included).
   *
   *  Cycle 18 / Task 8b — the role slots (rowGroup / rowGroupIndex / pivot
   *  / pivotIndex / aggFunc) source from the runtime GroupingState +
   *  PivotState primitives. The original Cycle 6 implementation read the
   *  static colDef slots and missed runtime API mutations — a latent bug
   *  the tool panel + pivot panel + context menu items all surfaced as
   *  "Restore doesn't restore".
   *
   *  Cycle 18 / Task 9 — under pivot mode the rendered tree is the
   *  SYNTHESIZED pivot result tree (pivotcol* leaves + the auto-group
   *  col), NOT the primary user columns. Snapshotting the synthesized
   *  tree would lose every primary column from the save → the round-
   *  trip restore couldn't reinstate the pivot/value role lists. AG
   *  parity: column state always reflects PRIMARY columns. So when
   *  pivot is active we snapshot against the cached primary tree
   *  instead. */
  getColumnState(): CColumnState[] {
    const treeForSnapshot = this.pivotActive && this.primaryColumnTree !== null
      ? this.primaryColumnTree
      : this.columnTree;
    return snapshotState(
      treeForSnapshot,
      this.columnLayout,
      this.sortModel,
      {
        rowGroupColumns: this.groupingState.getRowGroupColumns(),
        pivotColumns: this.pivotState.getPivotColumns(),
        valueColumns: this.pivotState.getValueColumns(),
      },
    );
  }

  /** Cycle 23 / Task 5 — full grid state snapshot. Includes columnState,
   *  filter / sort / group model, pivot mode + cols, expanded routes,
   *  side bar + selection + scroll position. Round-trippable through
   *  `setState` (Task 6); pair with `stateUpdated` (Task 7) to drive
   *  persistence. Empty fields are omitted so snapshots stay compact —
   *  apps can serialize the result through `JSON.stringify` without
   *  pre-pruning. */
  getState(): GridState {
    return buildSnapshot({
      getColumnState: () => this.getColumnState(),
      getFilterModel: () => this.getFilterModel(),
      getSortModel: () => this.getSortModel(),
      getRowGroupColumns: () => this.getRowGroupColumns(),
      getExpandedKeys: () => this.getExpandedKeys(),
      isPivotMode: () => this.isPivotMode(),
      getPivotColumns: () => this.getPivotColumns(),
      isSideBarVisible: () => this.isSideBarVisible(),
      getOpenedToolPanel: () => this.getOpenedToolPanel(),
      getCellRanges: () => this.getCellRanges(),
      getFocusedCell: () => this.getFocusedCell(),
      getSelectedRowIds: () => this.getSelectedRowIds(),
      getScrollPosition: () => ({ top: this.scrollTop, left: this.scrollLeft }),
    });
  }

  /** Cycle 23 / Task 6 — restore a state snapshot. Applied in the
   *  dependency order documented in the design notes: columnState →
   *  filter → sort → row-group → pivot → expanded → selection →
   *  side-bar → scroll. Each step is a no-op when the snapshot omits
   *  the corresponding field, so partial snapshots restore only the
   *  fields they carry.
   *
   *  Migrates the snapshot forward through `STATE_MIGRATIONS` when
   *  its `version` is older than the current schema. */
  setState(snapshot: GridState): void {
    const migrated = migrateSnapshot(snapshot);
    // Cycle 23 / Task 7 — tag the cascade so the next coalesced
    // stateUpdated event reads source: 'api'. The cascade of internal
    // events (filterChanged + sortChanged + ...) collapses into one
    // emission via the bus's rAF debounce.
    this.stateUpdatedBus?.setNextSource('api');

    // 1. columnState (defines columns + their geometry).
    if (migrated.columnState) {
      this.applyColumnState({ state: migrated.columnState, applyOrder: true });
    }

    // 2. filterModel — filters rows.
    if (migrated.filterModel) {
      this.setFilterModel(migrated.filterModel);
    }

    // 3. sortModel — orders rows.
    if (migrated.sortModel) {
      this.setSortModel(migrated.sortModel);
    }

    // 4. row-group columns.
    if (migrated.rowGroupColumns) {
      this.setRowGroupColumns(migrated.rowGroupColumns);
    }

    // 5. pivot mode + cols.
    if (migrated.pivotMode !== undefined) {
      this.setPivotMode(migrated.pivotMode);
    }
    if (migrated.pivotCols) {
      this.setPivotColumns(migrated.pivotCols);
    }

    // 6. expanded routes (group / tree). Apply after grouping so the
    // keys resolve to live group rows.
    if (migrated.expandedRouteIds) {
      for (const key of migrated.expandedRouteIds) {
        this.setExpanded(key, true);
      }
    }

    // 7. cell + row selection.
    if (migrated.cellSelection) {
      this.clearCellRanges();
      for (const range of migrated.cellSelection.ranges) {
        this.addCellRange(range);
      }
    }
    if (migrated.rowSelection) {
      this.setSelectedRowIds(migrated.rowSelection);
    }

    // 8. side bar.
    if (migrated.sideBar) {
      this.setSideBarVisible(migrated.sideBar.visible);
      if (migrated.sideBar.openedToolPanel) {
        this.openToolPanel(migrated.sideBar.openedToolPanel);
      }
    }

    // 9. scroll — last so viewport math runs after every model that
    // affects layout has settled.
    if (migrated.scroll) {
      this.scroller.scrollTo({ top: migrated.scroll.top, left: migrated.scroll.left });
    }
  }

  /** Cycle 23 / Task 6 — restore the construction-time defaults.
   *  Walks the same setters `setState` uses but with empty / cleared
   *  values across the board; column state replays through the
   *  dedicated `resetColumnState` path so the as-coded layout
   *  (sort, pin, visibility) comes back exactly as the constructor
   *  saw it. */
  resetState(): void {
    this.resetColumnState();
    this.setFilterModel({});
    this.setSortModel([]);
    this.setRowGroupColumns([]);
    this.setPivotColumns([]);
    if (this.isPivotMode()) this.setPivotMode(false);
    // Collapse every currently-expanded group.
    for (const key of Array.from(this.getExpandedKeys())) {
      this.setExpanded(key, false);
    }
    this.clearCellRanges();
    this.setSelectedRowIds([]);
    this.scroller.scrollTo({ top: 0, left: 0 });
  }

  /** Cycle 6 / Task 2 — restore column state through a single re-layout +
   *  repaint cycle. Mutates `columnDefsMap` (the same ResolvedColDef
   *  objects referenced by `columnTree.leafById`) in place, then fans the
   *  matching events out with `source: 'columnState'`. Returns `false`
   *  when one or more `state[].colId` entries did not match a known
   *  leaf. */
  applyColumnState(params: CApplyColumnStateParams): boolean {
    return this.applyColumnStateInternal(params, /* emitReset */ false);
  }

  /** Cycle 6 / Task 2 — restore the construction-time snapshot. Fires
   *  `columnsReset` BEFORE the per-slot change events. */
  resetColumnState(): void {
    this.applyColumnStateInternal(
      { state: cloneStateForReset(this.initialColumnStateSnapshot), applyOrder: true },
      /* emitReset */ true,
    );
  }

  /** Cycle 6 / Task 3 — distribute the canvas drawable width across the
   *  visible non-`suppressSizeToFit` leaves. Pure helper returns the new
   *  widths; we mutate the matching `ResolvedColDef.width` slots, rerun
   *  the standard `resolveColumnWidths` pass so pinned-pane layout still
   *  honors the new sizes, recompute the viewport once, and fire one
   *  `columnResized` per changed leaf with `finished: true`. */
  sizeColumnsToFit(params: ISizeColumnsToFitParams = {}): void {
    const containerWidth = this.canvasBounds.width
      || this.scroller.clientWidth
      || 800;
    const newWidths = computeSizeColumnsToFit(
      this.columnOrder,
      containerWidth,
      params,
    );
    const changes: Array<{ colId: string; width: number }> = [];
    for (const def of this.columnOrder) {
      const next = newWidths.get(def.colId);
      if (next == null) continue;
      if (def.width === next) continue;
      def.width = next;
      changes.push({ colId: def.colId, width: next });
    }
    if (changes.length === 0) return;
    this.columnLayout = resolveColumnWidths(this.columnOrder, containerWidth);
    this.recomputeViewport();
    this.cgridCanvas?.requestRepaint();
    for (const c of changes) {
      this.events.emit({
        type: 'columnResized',
        colId: c.colId,
        width: c.width,
        finished: true,
        source: 'sizeColumnsToFit',
      });
    }
  }

  /** Cycle 6 / Task 4 — autosize the named visible leaves. Awaits the
   *  worker's measure round-trip, clamps each result to per-column
   *  `minWidth` / `maxWidth`, applies widths through ONE
   *  `resolveColumnWidths + recomputeViewport + requestRepaint`, and
   *  fires one `columnResized` per changed leaf with `finished: true`
   *  and `source: 'autosizeColumns'`. Unknown / hidden / `suppressAutoSize`
   *  columns are silently dropped. */
  async autoSizeColumns(keys: string[], skipHeader: boolean = false): Promise<void> {
    if (this.destroyed) return;
    const padding = 16; // matches the inline-cell horizontal padding
    // HEADER_PADDING(8) + SORT_ICON_PAD(8) + SORT_ICON_SIZE(14) = 30px —
    // ensures the auto-sized width always reserves room for the sort caret.
    const headerPadding = 30;
    const requests: AutosizeColumnRequest[] = [];
    for (const key of keys) {
      const def = this.columnDefsMap.get(key);
      if (!def) continue;
      if (def.hide) continue;
      if (def.suppressAutoSize) continue;
      const font = def.cellStyle?.font ?? this.theme.font;
      // Use the decorated header text (e.g. "sum(Notional)") so the
      // measured width matches exactly what the header painter draws.
      const headerName = decorateHeader(def, this.options.suppressAggFuncInHeader === true);
      requests.push({
        colId: def.colId,
        headerName,
        font,
        padding,
        headerPadding,
        minWidth: def.minWidth,
        maxWidth: Number.isFinite(def.maxWidth) ? def.maxWidth : Number.MAX_SAFE_INTEGER,
      });
    }
    if (requests.length === 0) return;
    let widths: Record<string, number>;
    try {
      widths = await this.workerClient.autosizeColumns(requests, skipHeader);
    } catch (err) {
      if (!this.destroyed) console.error('[cgrid] autoSizeColumns:', err);
      return;
    }
    if (this.destroyed) return;
    const changes: Array<{ colId: string; width: number }> = [];
    for (const req of requests) {
      const measured = widths[req.colId];
      if (measured == null) continue;
      // Worker already clamped to min/max; re-clamp defensively in case
      // main-side bounds drifted while the round-trip was in flight.
      const clamped = Math.max(req.minWidth, Math.min(req.maxWidth, Math.ceil(measured)));
      const def = this.columnDefsMap.get(req.colId);
      if (!def) continue;
      if (def.width === clamped) continue;
      def.width = clamped;
      changes.push({ colId: req.colId, width: clamped });
    }
    if (changes.length === 0) return;
    this.columnLayout = resolveColumnWidths(
      this.columnOrder,
      this.canvasBounds.width || this.scroller.clientWidth || 800,
    );
    this.recomputeViewport();
    this.cgridCanvas?.requestRepaint();
    for (const c of changes) {
      this.events.emit({
        type: 'columnResized',
        colId: c.colId,
        width: c.width,
        finished: true,
        source: 'autosizeColumns',
      });
    }
  }

  /** Cycle 6 / Task 4 — autosize every visible non-`suppressAutoSize`
   *  leaf in the current column order. */
  autoSizeAllColumns(skipHeader: boolean = false): Promise<void> {
    const keys = this.columnOrder
      .filter((c) => !c.suppressAutoSize && !c.hide)
      .map((c) => c.colId);
    return this.autoSizeColumns(keys, skipHeader);
  }

  /** Cycle 6 / Task 5 — flip visibility on every listed leaf in a batch.
   *  Unknown keys + `lockVisible: true` columns are silently dropped. One
   *  re-layout + one `columnVisible` event whose `colIds` lists the
   *  actually-changed columns. No-op when nothing flipped. */
  setColumnsVisible(keys: string[], visible: boolean): void {
    const targetHide = !visible;
    const changed: string[] = [];
    for (const key of keys) {
      const def = this.columnDefsMap.get(key);
      if (!def) continue;
      if (def.lockVisible) continue;
      if (def.hide === targetHide) continue;
      def.hide = targetHide;
      changed.push(def.colId);
    }
    if (changed.length === 0) return;
    this.relayoutAfterColumnMutation();
    this.events.emit({
      type: 'columnVisible', visible, colIds: changed, source: 'api',
    });
    this.workerClient?.updateColumns(this.workerColumns())
      .then(({ visibleCount }) => {
        this.rowCount = visibleCount;
        this.recomputeViewport();
        this.events.emit({ type: 'displayedColumnsChanged', source: 'columnVisible' });
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid] setColumnsVisible:', err); });
  }

  /** Cycle 6 / Task 5 — set pinning on every listed leaf in a batch.
   *  Unknown keys + `lockPinned: true` columns are silently dropped. One
   *  re-layout + one `columnPinned` event per distinct `pinned` bucket
   *  whose `colIds` lists the actually-changed columns. No-op when
   *  nothing flipped. */
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void {
    const targetPinned = pinned ?? undefined;
    const changed: string[] = [];
    for (const key of keys) {
      const def = this.columnDefsMap.get(key);
      if (!def) continue;
      if (def.lockPinned) continue;
      if (def.pinned === targetPinned) continue;
      def.pinned = targetPinned;
      changed.push(def.colId);
    }
    if (changed.length === 0) return;
    this.relayoutAfterColumnMutation();
    this.events.emit({
      type: 'columnPinned', pinned, colIds: changed, source: 'api',
    });
    this.events.emit({ type: 'displayedColumnsChanged', source: 'columnPinned' });
  }

  /** Cycle 6 / Task 5 — set explicit widths in a batch. Each width is
   *  clamped to the column's resolved `minWidth` / `maxWidth`. Unknown
   *  keys are silently dropped. Fires one `columnResized` per changed
   *  column with `source: 'api'`. `finished` defaults to `true`. */
  setColumnWidths(
    columnWidths: Array<{ key: string; newWidth: number }>,
    finished: boolean = true,
  ): void {
    const changes: Array<{ colId: string; width: number }> = [];
    for (const { key, newWidth } of columnWidths) {
      const def = this.columnDefsMap.get(key);
      if (!def) continue;
      const clamped = Math.max(def.minWidth, Math.min(def.maxWidth, newWidth));
      if (def.width === clamped) continue;
      def.width = clamped;
      changes.push({ colId: def.colId, width: clamped });
    }
    if (changes.length === 0) return;
    this.relayoutAfterColumnMutation();
    for (const c of changes) {
      this.events.emit({
        type: 'columnResized', colId: c.colId, width: c.width,
        finished, source: 'api',
      });
    }
  }

  /** Cycle 6 / Task 5 — move every listed leaf to start at `toIndex` in
   *  the flat visible-leaf order, preserving input order. Honors
   *  `lockPosition` + `marryChildren` — illegal targets clamp to the
   *  nearest legal index. Unknown keys are silently dropped. Fires one
   *  `columnMoved` per actually-moved column with `source: 'api'`. */
  moveColumns(keys: string[], toIndex: number): void {
    const validKeys: string[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) continue;
      if (!this.columnDefsMap.has(key)) continue;
      seen.add(key);
      validKeys.push(key);
    }
    if (validKeys.length === 0) return;
    const currentOrder = this.columnOrder.map((c) => c.colId);
    const oldIndex: Record<string, number> = {};
    for (let i = 0; i < currentOrder.length; i++) oldIndex[currentOrder[i]!] = i;
    const withoutKeys = currentOrder.filter((id) => !seen.has(id));
    const insertAt = Math.max(0, Math.min(withoutKeys.length, toIndex));
    const desired = withoutKeys
      .slice(0, insertAt)
      .concat(validKeys)
      .concat(withoutKeys.slice(insertAt));
    const constraints = this.buildColumnOrderConstraints();
    const finalOrder = reorderLeavesByList(this.columnTree, desired, constraints);
    const orderChanged = finalOrder.length !== currentOrder.length
      || finalOrder.some((id, i) => id !== currentOrder[i]);
    if (!orderChanged) return;
    const newDefs = rebuildColumnDefsByLeafOrder(this.options.columnDefs, finalOrder);
    this.options.columnDefs = newDefs;
    this.rebuildColumns({ defaultColDef: this.options.defaultColDef });
    this.workerClient?.updateColumns(this.workerColumns())
      .then(({ visibleCount }) => {
        this.rowCount = visibleCount;
        this.recomputeViewport();
        this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
        this.events.emit({ type: 'displayedColumnsChanged', source: 'columnMoved' });
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid] moveColumns:', err); });
    for (const colId of validKeys) {
      const newIdx = finalOrder.indexOf(colId);
      if (newIdx < 0) continue;
      if (newIdx === oldIndex[colId]) continue;
      this.events.emit({
        type: 'columnMoved', toIndex: newIdx, colIds: [colId], source: 'api',
      });
    }
  }

  /** Shared single-re-layout helper for the Task 5 batch mutations that
   *  don't need a column-tree rebuild (`setColumnsVisible` /
   *  `setColumnsPinned` / `setColumnWidths`). Recomputes the visible
   *  column order so hide flips light up, reruns the width pass so
   *  pinned-pane positions update, then one `recomputeViewport +
   *  requestRepaint`. */
  private relayoutAfterColumnMutation(): void {
    this.columnOrder = this.computeVisibleColumnOrder();
    this.columnLayout = resolveColumnWidths(
      this.columnOrder,
      this.canvasBounds.width || this.scroller.clientWidth || 800,
    );
    this.recomputeViewport();
    this.cgridCanvas?.requestRepaint();
  }

  /** Engine entry-point shared by `applyColumnState` and `resetColumnState`.
   *  Single re-layout: mutates resolved slots → optionally rebuilds the
   *  column tree → re-runs the visible-column-order + width pass →
   *  recomputeViewport + requestRepaint → drains the event queue → posts
   *  the worker column-metadata refresh. */
  private applyColumnStateInternal(
    params: CApplyColumnStateParams,
    emitReset: boolean,
  ): boolean {
    // Cycle 18 / Task 9 — under pivot mode the live `columnTree` /
    // `columnDefsMap` describe the SYNTHESIZED pivot result tree
    // (pivotcol* leaves + the auto-group column), NOT the primary
    // user columns. Saved column state always reflects PRIMARY
    // columns (see `getColumnState` above for the AG-parity rationale),
    // so apply must validate + mutate against the primary tree's
    // leaf map under pivot mode. The role fan-out in
    // `applyRoleStateFromColumnState` then drives the pivot synthesis
    // to re-build from the restored primary state.
    const applyTree = this.pivotActive && this.primaryColumnTree !== null
      ? this.primaryColumnTree
      : this.columnTree;
    const applyLeafById = applyTree.leafById;

    let allFound = true;
    if (params.state) {
      for (const entry of params.state) {
        if (!applyLeafById.has(entry.colId)) { allFound = false; break; }
      }
    }

    const locks: SnapshotLocks = {
      lockVisibleOf: (id) => (applyLeafById.get(id) as { lockVisible?: boolean })?.lockVisible ?? false,
      lockPinnedOf: (id) => (applyLeafById.get(id) as { lockPinned?: boolean })?.lockPinned ?? false,
    };

    const oldOrder = this.columnOrder.map((c) => c.colId);
    const result = applyStateToTree(applyTree, params, locks);

    // Cycle 18 / Task 8b — fan the role slots out to the runtime state
    // primitives (GroupingState + PivotState). The Cycle 6 columnState
    // primitive writes the def slots opaquely; without this step
    // mutations made via `api.addRowGroupColumn` / `addPivotColumn` /
    // `addValueColumn` did not round-trip through `applyColumnState`.
    // Semantics: FULL replace — columns NOT present in the input state
    // (or present with rowGroup:false / pivot:false / aggFunc:null) are
    // dropped from the role lists. AG-Grid parity Prompt 8.
    //
    // pivotMode itself is NOT in CColumnState (per AG parity); it
    // persists via the `pivotMode` grid option separately. Apps wanting
    // a single save/restore call use `setPivotMode` + this method.
    if (params.state) {
      this.applyRoleStateFromColumnState(params.state);
    }

    let newDefs = this.options.columnDefs;
    let leafOrderChanged = false;
    if (result.newOrder) {
      // Honor Task-1 locks + marryChildren during the reorder.
      const constraints = this.buildColumnOrderConstraints();
      const finalOrder = reorderLeavesByList(this.columnTree, result.newOrder, constraints);
      const current = Array.from(this.columnTree.leafById.keys());
      leafOrderChanged = finalOrder.length !== current.length
        || finalOrder.some((id, i) => id !== current[i]);
      if (leafOrderChanged) {
        newDefs = rebuildColumnDefsByLeafOrder(this.options.columnDefs, finalOrder);
        this.options.columnDefs = newDefs;
      }
    }

    if (leafOrderChanged) {
      this.rebuildColumns({ defaultColDef: this.options.defaultColDef });
      // rebuildColumns rebuilt the tree from `options.columnDefs` — the
      // raw `CColDef`s do not carry the runtime width / hide / pinned
      // mutations `applyStateToTree` just applied to the now-discarded
      // tree. Re-apply the state against the freshly-resolved leaves so
      // the round-trip lands in ONE call (without this, the demo's
      // Restore button needed two clicks to fully restore). The second
      // call is intentionally a no-op for event reporting — we keep
      // `result.changes` from the first call as the authoritative
      // change log.
      applyStateToTree(this.columnTree, params, locks);
      // Re-run visibility + width pass after the second mutation pass so
      // hide flips light up and widths land before the repaint.
      this.columnOrder = this.computeVisibleColumnOrder();
      this.columnLayout = resolveColumnWidths(
        this.columnOrder,
        this.canvasBounds.width || this.scroller.clientWidth || 800,
      );
      this.recomputeViewport();
      this.cgridCanvas?.requestRepaint();
    } else {
      // Mutations on existing ResolvedColDef slots — recompute the visible
      // column order so a `hide` flip lights up immediately, then rerun
      // the width pass + viewport.
      this.columnOrder = this.computeVisibleColumnOrder();
      this.columnLayout = resolveColumnWidths(
        this.columnOrder,
        this.canvasBounds.width || this.scroller.clientWidth || 800,
      );
      this.recomputeViewport();
      this.cgridCanvas?.requestRepaint();
    }

    // Drain the change queue into typed events. Deterministic order:
    // columnsReset → columnMoved → columnVisible → columnPinned →
    // columnResized → sortChanged.
    if (emitReset) this.events.emit({ type: 'columnsReset' });

    if (leafOrderChanged) {
      const newOrder = this.columnOrder.map((c) => c.colId);
      const moved = collectMovedColIds(oldOrder, newOrder);
      for (const colId of moved) {
        const toIndex = newOrder.indexOf(colId);
        this.events.emit({
          type: 'columnMoved', toIndex, colIds: [colId], source: 'columnState',
        });
      }
    }

    const visibleChanges = result.changes.filter((c) => c.kind === 'hide');
    if (visibleChanges.length > 0) {
      // Group by the new visible boolean (CColumnState.hide is the
      // "should be hidden" flag; the event reports the visible boolean).
      const shown = visibleChanges.filter((c) => c.newValue === false).map((c) => c.colId);
      const hidden = visibleChanges.filter((c) => c.newValue === true).map((c) => c.colId);
      if (shown.length) {
        this.events.emit({
          type: 'columnVisible', visible: true, colIds: shown, source: 'columnState',
        });
      }
      if (hidden.length) {
        this.events.emit({
          type: 'columnVisible', visible: false, colIds: hidden, source: 'columnState',
        });
      }
    }

    const pinnedChanges = result.changes.filter((c) => c.kind === 'pinned');
    if (pinnedChanges.length > 0) {
      const byBucket = new Map<'left' | 'right' | null, string[]>();
      for (const c of pinnedChanges) {
        const key = c.newValue as 'left' | 'right' | null;
        const arr = byBucket.get(key) ?? [];
        arr.push(c.colId);
        byBucket.set(key, arr);
      }
      for (const [pinned, colIds] of byBucket.entries()) {
        this.events.emit({
          type: 'columnPinned', pinned, colIds, source: 'columnState',
        });
      }
    }

    for (const c of result.changes.filter((c) => c.kind === 'width')) {
      this.events.emit({
        type: 'columnResized', colId: c.colId, width: c.newValue as number,
        source: 'columnState',
      });
    }

    // Sort: collect every change record's {colId, direction, sortIndex},
    // drop nulls, and order by sortIndex so multi-column sort restores
    // in the right precedence. The previous implementation walked the
    // filtered array with a stale index against the original array,
    // pairing the wrong colId with each direction.
    const sortChanges = result.changes.filter((c) => c.kind === 'sort');
    if (sortChanges.length > 0) {
      const entries = sortChanges
        .map((c) => {
          const v = c.newValue as { direction: 'asc' | 'desc' | null; index: number | null };
          return { colId: c.colId, direction: v.direction, index: v.index };
        })
        .filter((e): e is { colId: string; direction: 'asc' | 'desc'; index: number | null } =>
          e.direction !== null);
      entries.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const next: SortModel = entries.map(({ colId, direction }) => ({ colId, direction }));
      // Route through setSortModel so the worker re-sorts the chunk —
      // without this, the rendered rows stay in the pre-restore order
      // even though the header sort indicator updates. setSortModel also
      // mutates this.sortModel and emits sortChanged on its own (async
      // after the worker round-trip), so we no longer emit it here.
      const same = this.sortModel.length === next.length
        && this.sortModel.every((e, i) =>
          e.colId === next[i]!.colId && e.direction === next[i]!.direction);
      if (!same) this.setSortModel(next);
    }

    // Push column metadata + visible-set change to the worker so a freshly
    // hidden column stops getting chunked, and a freshly shown column gets
    // populated on the next viewport fetch.
    const displayedSource: 'columnsReset' | 'columnDefsChanged' =
      emitReset ? 'columnsReset' : 'columnDefsChanged';
    this.workerClient?.updateColumns(this.workerColumns())
      .then(({ visibleCount }) => {
        this.rowCount = visibleCount;
        this.recomputeViewport();
        this.events.emit({ type: 'displayedColumnsChanged', source: displayedSource });
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[cgrid] applyColumnState:', err); });

    return allFound;
  }

  /** Cycle 18 / Task 8b — derive the rowGroupColumns / pivotColumns /
   *  valueColumns lists from a CColumnState array and replace the
   *  runtime state primitives in one event tick each. The row-group +
   *  pivot lists honor the per-entry `rowGroupIndex` / `pivotIndex` for
   *  ordering (stable for ties; columns without an index sort last).
   *  Value columns preserve the state input order (no separate index).
   *
   *  Routed through `setRowGroupColumns` / `setPivotColumns` /
   *  `setValueColumns` (batch verbs) so the cross-surface event chain
   *  fires once per role list — NOT once per column. The tool panel +
   *  pivot panel + context menu items + row group panel all repaint
   *  from those events. */
  private applyRoleStateFromColumnState(state: readonly CColumnState[]): void {
    interface Indexed { colId: string; index: number; declOrder: number }
    const rowGroups: Indexed[] = [];
    const pivots: Indexed[] = [];
    const values: Array<{ colId: string; aggFunc: string }> = [];
    // Cycle 18 / Task 9 — under pivot mode `columnDefsMap` covers
    // synthesized leaves only; validate against the primary tree so
    // saved state with primary col ids round-trips.
    const validLeafById = this.pivotActive && this.primaryColumnTree !== null
      ? this.primaryColumnTree.leafById
      : this.columnDefsMap;
    state.forEach((entry, declOrder) => {
      if (!validLeafById.has(entry.colId)) return;
      if (entry.rowGroup === true) {
        rowGroups.push({
          colId: entry.colId,
          index: entry.rowGroupIndex ?? Number.MAX_SAFE_INTEGER,
          declOrder,
        });
      }
      if (entry.pivot === true) {
        pivots.push({
          colId: entry.colId,
          index: entry.pivotIndex ?? Number.MAX_SAFE_INTEGER,
          declOrder,
        });
      }
      if (typeof entry.aggFunc === 'string' && entry.aggFunc.length > 0) {
        values.push({ colId: entry.colId, aggFunc: entry.aggFunc });
      }
    });
    const sortByIndex = (a: Indexed, b: Indexed) =>
      (a.index - b.index) || (a.declOrder - b.declOrder);
    rowGroups.sort(sortByIndex);
    pivots.sort(sortByIndex);

    // Always call the batch verbs — even on empty lists — so a state
    // input that omits any column previously assigned to a role clears
    // that role. The verbs short-circuit when the resulting list is
    // identical to the current one (no spurious event emission).
    this.groupingState.setRowGroupColumns(rowGroups.map((e) => e.colId));
    this.pivotState.setPivotColumns(pivots.map((e) => e.colId));
    this.pivotState.setValueColumns(values);
  }

  /** Build the per-leaf lock + marryChildren constraints used by Task-1's
   *  `resolveLegalDropIndex`. Pulls `lockPosition` from `columnDefsMap`
   *  and walks `columnTree.groupById` to find the nearest marryChildren
   *  ancestor for each leaf. */
  private buildColumnOrderConstraints(): ColumnOrderConstraints {
    return {
      lockOf: (id) => {
        const def = this.columnDefsMap.get(id);
        return def ? def.lockPosition : null;
      },
      marryGroupOf: (id) => this.findMarryGroupForLeaf(id),
      leafIdsOfGroup: (groupId) => {
        const g = this.columnTree.groupById.get(groupId);
        return g ? g.leafColIds : [];
      },
    };
  }

  /** Find the nearest enclosing marryChildren group for the leaf, or
   *  `null` when the leaf is ungrouped / has no marryChildren ancestor. */
  private findMarryGroupForLeaf(leafColId: string): string | null {
    for (const group of this.columnTree.groupById.values()) {
      if (!group.marryChildren) continue;
      if (group.leafColIds.includes(leafColId)) return group.groupId;
    }
    return null;
  }

  /** Resolve `colDef.cellEditor` into a registry name. Strings look up
   *  directly. Constructors are interned under a synthetic name keyed by the
   *  colId so the registry stays the single source of truth at edit time.
   *  Undefined falls back to `'text'` (the universal default for editable
   *  columns; matches ag-grid). */
  private resolveEditorName(def: ResolvedColDef<TRow>): string {
    const e = def.cellEditor as string | CellEditorCtor | undefined;
    if (typeof e === 'string') return e;
    if (typeof e === 'function') {
      const synthetic = `__inline_${def.colId}`;
      if (!this.cellEditorRegistry.has(synthetic)) {
        this.cellEditorRegistry.register(synthetic, e);
      }
      return synthetic;
    }
    return 'text';
  }

  /** Call `cellEditorParams` (or use the static object) to produce the
   *  params forwarded into `ICellEditorParams.params`. Empty object when
   *  no params are configured. */
  private resolveEditorParams(def: ResolvedColDef<TRow>, row: TRow): Record<string, unknown> {
    const p = (def as { cellEditorParams?: unknown }).cellEditorParams;
    if (p == null) return {};
    if (typeof p === 'function') return (p as (r: TRow) => Record<string, unknown>)(row);
    return p as Record<string, unknown>;
  }

  /** Resolve the editable predicate for the cell at `(rowIndex, colId)`.
   *  Static booleans flow through directly; callbacks receive the cell's
   *  current `{ data, colId, rowIndex, value }`. Returns `false` for
   *  unknown columns. */
  private isCellEditable(rowIndex: number, colId: string): boolean {
    const def = this.columnDefsMap.get(colId);
    if (!def) return false;
    const e = def.editable;
    if (typeof e === 'boolean') return e;
    if (typeof e === 'function') {
      const data = this.rowDataSnapshotAt(rowIndex);
      const value = this.cellAt(rowIndex, colId)?.value;
      try {
        return (e as (p: { data: unknown; colId: string; rowIndex: number; value: unknown }) => boolean)(
          { data, colId, rowIndex, value },
        );
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Best-effort row snapshot built from the current viewport chunk —
   *  every cell in the chunk for this row, keyed by colId. Empty object
   *  when the row hasn't been chunked yet. The real `getRowByIndex`
   *  worker round-trip is used at commit time; this synchronous flavour
   *  is what predicates / suppressKeyboardEvent callbacks see. */
  private rowDataSnapshotAt(rowIndex: number): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const col of this.viewport.visibleColumns) {
      const cell = this.cellAt(rowIndex, col.colId);
      if (cell) snapshot[col.colId] = cell.value;
    }
    return snapshot;
  }

  /** Close any open editor. `cancel=true` discards the in-progress value.
   *  Wired into the host blur listener (`stopEditingWhenCellsLoseFocus`)
   *  and the keyboard handler (Escape cancels; Enter / Tab commit). In
   *  full-row mode (Cycle 5 / Task 10) this dispatches to the row-edit
   *  coordinator so every editor in the row commits / cancels together. */
  stopEditing(cancel: boolean = false): void {
    if (this.rowEdit.isOpen()) {
      if (cancel) this.rowEdit.cancel();
      else this.rowEdit.commit();
      return;
    }
    if (!this.editor.isOpen()) return;
    if (cancel) this.editor.cancel();
    else this.editor.commit();
  }

  /** True when either the single-cell overlay or the full-row coordinator
   *  has an editor mounted. The single `isEditing()` exposed to features
   *  and the host blur listener route through this so full-row mode
   *  behaves identically to single-cell mode from the consumer's POV. */
  private isAnyEditOpen(): boolean {
    return this.editor.isOpen() || this.rowEdit.isOpen();
  }

  /** Walk the visible-column order to find the next editable cell from
   *  `(fromRow, fromCol)`. `'forward'` increments by column, wrapping to
   *  the next row's first column at the right edge; `'backward'`
   *  mirrors. Returns `null` when no further editable cell exists. */
  private nextEditableCell(
    fromRow: number,
    fromCol: string,
    direction: 'forward' | 'backward',
  ): { rowIndex: number; colId: string } | null {
    const cols = this.columnOrder.map((c) => c.colId);
    if (cols.length === 0 || this.rowCount === 0) return null;
    const startCi = cols.indexOf(fromCol);
    if (startCi < 0) return null;
    const step = direction === 'forward' ? 1 : -1;
    let row = fromRow;
    let ci = startCi + step;
    const maxIter = cols.length * Math.max(1, this.rowCount);
    for (let i = 0; i < maxIter; i++) {
      if (ci >= cols.length) {
        ci = 0;
        row += 1;
      } else if (ci < 0) {
        ci = cols.length - 1;
        row -= 1;
      }
      if (row < 0 || row >= this.rowCount) return null;
      const candidate = cols[ci]!;
      if (this.isCellEditable(row, candidate)) {
        return { rowIndex: row, colId: candidate };
      }
      ci += step;
    }
    return null;
  }

  /** Open the editor on the cell at `(rowIndex, colId)`. No-op when the
   *  cell is not editable, not currently in the viewport, or already in
   *  edit mode. `mode` controls Excel's Enter / Edit dichotomy — defaults
   *  to `'edit'` (arrows = caret-move). Type-to-edit (KeyPaging printable
   *  key) passes `'enter'` so arrows commit + navigate when
   *  `enableExcelEditing` is on. Called by the EditTrigger feature
   *  (click/dblclick) and KeyPaging (F2 / Enter / Tab next-editable). */
  openEditor(
    rowIndex: number,
    colId: string,
    charPress: string | null = null,
    mode: 'enter' | 'edit' = 'edit',
  ): void {
    if (this.isAnyEditOpen()) return;
    // Full-row dispatch: every editable column in the row opens an editor
    // simultaneously; the coordinator runs the lifecycle and the
    // openRowEditor helper wires events + commit-back. charPress / mode
    // are single-cell concerns (type-to-edit, Excel arrow-commit) and
    // don't apply in full-row.
    if (this.options.editType === 'fullRow') {
      this.openRowEditor(rowIndex, colId);
      return;
    }
    const def = this.columnDefsMap.get(colId);
    if (!def || !this.isCellEditable(rowIndex, colId)) return;
    const col = this.viewport.visibleColumns.find((c) => c.colId === colId);
    const row = this.viewport.visibleRows.find(
      (r) => r.subgrid.isData && r.localRowIndex === rowIndex,
    );
    if (!col || !row) return;
    // Selection follows the editor — without this, closing the editor leaves
    // focus on whatever cell was previously selected, so subsequent arrow-key
    // navigation jumps from the wrong origin.
    this.selection.setFocus(rowIndex, colId);
    const cell = this.cellAt(rowIndex, colId);
    const initialValue = cell?.value ?? '';
    const editorName = this.resolveEditorName(def);
    const rowId = this.rowIdAt(rowIndex) ?? `row-${rowIndex}`;
    // Snapshot the active-edit so the close hook (commit OR cancel) can
    // compose the `cellEditingStopped` payload without re-fetching state.
    this.activeEdit = {
      rowIndex, rowId, colId,
      oldValue: initialValue,
      data: cell?.value !== undefined ? { [colId]: cell.value } : null,
      mode,
    };
    this.editor.open({
      editorName,
      rowData: cell?.value !== undefined ? { [colId]: cell.value } : {},
      colId,
      value: initialValue,
      cellBounds: { x: col.left, y: row.top, w: col.width, h: row.height },
      params: this.resolveEditorParams(def, ({} as TRow)),
      charPress,
      cellEditorPopup: (def as { cellEditorPopup?: boolean }).cellEditorPopup,
      cellEditorPopupPosition: (def as { cellEditorPopupPosition?: 'over' | 'under' }).cellEditorPopupPosition,
      viewportBounds: { width: this.canvasBounds.width, height: this.canvasBounds.height },
      onCommit: (newValue) => {
        // Return focus to the canvas so arrow keys / Tab resume cell
        // navigation immediately after the editor closes. Without this the
        // user has to mouse-click a cell before the keyboard re-engages.
        this.cgridCanvas.canvas.focus({ preventScroll: true });
        // Fetch the full row from the worker, run valueParser → valueSetter
        // (or the default field assignment), emit cellValueChanged with the
        // real rowId + old/new values, then enqueue the update so the worker
        // re-runs filter / sort / agg against the new value.
        this.workerClient.getRowByIndex(rowIndex).then((fetched) => {
          if (this.destroyed || !fetched.rowId || fetched.data == null) return;
          const rowData = fetched.data as Record<string, unknown>;
          const field = def.field as string | undefined;
          const oldValue = field !== undefined ? rowData[field] : undefined;
          const parsed = def.valueParser
            ? def.valueParser({ newValue, oldValue, data: rowData as any, colDef: def as any })
            : newValue;
          if (def.valueSetter) {
            def.valueSetter({ data: rowData as any, newValue: parsed, oldValue, colDef: def as any });
          } else if (field !== undefined) {
            rowData[field] = parsed;
          }
          const changed = parsed !== oldValue;
          this.events.emit({
            type: 'cellValueChanged',
            rowId: fetched.rowId, colId, oldValue, newValue: parsed,
            newRawValue: newValue, source: 'edit', rowIndex, data: rowData,
          });
          this.events.emit({
            type: 'cellEditingStopped',
            rowIndex, rowId: fetched.rowId, colId,
            oldValue, newValue: parsed, valueChanged: changed,
            data: rowData,
          });
          this.activeEdit = null;
          this.workerClient.applyTransaction({ update: [rowData], async: false })
            .catch((err) => { if (!this.destroyed) console.error('[cgrid] commit-back:', err); });
        }).catch((err) => { if (!this.destroyed) console.error('[cgrid] commit-back fetch:', err); });
      },
      onCancel: () => {
        // Mirrors onCommit — restore canvas focus so the keyboard nav layer
        // keeps responding without a mouse click.
        this.cgridCanvas.canvas.focus({ preventScroll: true });
        const e = this.activeEdit;
        this.activeEdit = null;
        if (!e) return;
        this.events.emit({
          type: 'cellEditingStopped',
          rowIndex: e.rowIndex, rowId: e.rowId, colId: e.colId,
          oldValue: e.oldValue, newValue: e.oldValue, valueChanged: false,
          data: e.data,
        });
      },
    });
    // cellEditingStarted fires AFTER the editor has mounted (matches catalog
    // 06: "A cell editor is activated"). The DOM is live, focus is set.
    this.events.emit({
      type: 'cellEditingStarted',
      rowIndex, rowId, colId,
      value: initialValue,
      data: this.activeEdit?.data,
    });
  }

  /** Cycle 5 / Task 10 — full-row edit entrypoint. Iterates the visible
   *  columns in render order and builds one editor spec per editable
   *  cell, then hands the bundle to `RowEditCoordinator`. `initialColId`
   *  is the cell the user actually targeted (clicked / F2 / Tab) and
   *  receives initial focus; the rest of the row's editors mount in the
   *  background, ready for Tab navigation.
   *
   *  Row-level events: `rowEditingStarted` fires after the bundle mounts;
   *  `rowEditingStopped` fires on close (commit OR cancel);
   *  `rowValueChanged` fires only when at least one cell actually changed
   *  value. Per-cell `cellValueChanged` events still fire — one per
   *  changed cell — so existing single-cell listeners keep working. */
  private openRowEditor(rowIndex: number, initialColId: string): void {
    if (this.rowEdit.isOpen()) return;
    const row = this.viewport.visibleRows.find(
      (r) => r.subgrid.isData && r.localRowIndex === rowIndex,
    );
    if (!row) return;
    const specs: RowEditCellSpec[] = [];
    for (const col of this.viewport.visibleColumns) {
      if (!this.isCellEditable(rowIndex, col.colId)) continue;
      const def = this.columnDefsMap.get(col.colId);
      if (!def) continue;
      const cell = this.cellAt(rowIndex, col.colId);
      const value = cell?.value ?? '';
      specs.push({
        colId: col.colId,
        editorName: this.resolveEditorName(def),
        cellBounds: { x: col.left, y: row.top, w: col.width, h: row.height },
        value,
        params: this.resolveEditorParams(def, ({} as TRow)),
      });
    }
    if (specs.length === 0) return;
    const rowId = this.rowIdAt(rowIndex) ?? `row-${rowIndex}`;
    const snapshot = this.rowDataSnapshotAt(rowIndex);
    // Selection mirrors the active editor — without this, Esc + arrow nav
    // resume from the previous focused cell instead of the row being edited.
    this.selection.setFocus(rowIndex, initialColId);
    this.rowEdit.open({
      rowIndex,
      rowId,
      rowData: snapshot,
      cells: specs,
      initialColId,
      onCommit: (commits) => this.handleRowCommit(rowIndex, rowId, commits),
      onCancel: () => this.handleRowCancel(rowIndex, rowId, snapshot),
    });
    this.events.emit({
      type: 'rowEditingStarted',
      rowIndex, rowId, data: snapshot as unknown,
    });
  }

  /** Cycle 5 / Task 10 — full-row commit. Fetches the canonical row from
   *  the worker, runs each commit through valueParser → valueSetter (or the
   *  default field assignment), emits one `cellValueChanged` per changed
   *  cell, then `rowEditingStopped` and (when any cell changed)
   *  `rowValueChanged`, then dispatches a single
   *  `applyTransaction({ update })` so the worker re-runs filter / sort /
   *  agg against the new values. */
  private handleRowCommit(
    rowIndex: number,
    rowId: string,
    commits: Array<{ colId: string; newRawValue: unknown }>,
  ): void {
    this.cgridCanvas.canvas.focus({ preventScroll: true });
    this.workerClient.getRowByIndex(rowIndex).then((fetched) => {
      if (this.destroyed) return;
      const resolvedId = fetched.rowId ?? rowId;
      if (fetched.data == null) {
        // Row is no longer addressable (transaction removed it mid-edit).
        // Emit the stopped event so listeners still close their UI state.
        this.events.emit({ type: 'rowEditingStopped', rowIndex, rowId: resolvedId, data: {} });
        return;
      }
      const rowData = fetched.data as Record<string, unknown>;
      let anyChanged = false;
      for (const commit of commits) {
        const def = this.columnDefsMap.get(commit.colId);
        if (!def) continue;
        const field = def.field as string | undefined;
        const oldValue = field !== undefined ? rowData[field] : undefined;
        const parsed = def.valueParser
          ? def.valueParser({ newValue: commit.newRawValue, oldValue, data: rowData as any, colDef: def as any })
          : commit.newRawValue;
        if (def.valueSetter) {
          def.valueSetter({ data: rowData as any, newValue: parsed, oldValue, colDef: def as any });
        } else if (field !== undefined) {
          rowData[field] = parsed;
        }
        const changed = parsed !== oldValue;
        if (changed) anyChanged = true;
        this.events.emit({
          type: 'cellValueChanged',
          rowId: resolvedId, colId: commit.colId, oldValue, newValue: parsed,
          newRawValue: commit.newRawValue, source: 'edit', rowIndex, data: rowData,
        });
      }
      this.events.emit({ type: 'rowEditingStopped', rowIndex, rowId: resolvedId, data: rowData });
      if (anyChanged) {
        this.events.emit({ type: 'rowValueChanged', rowIndex, rowId: resolvedId, data: rowData });
        this.workerClient.applyTransaction({ update: [rowData], async: false })
          .catch((err) => { if (!this.destroyed) console.error('[cgrid] row commit-back:', err); });
      }
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid] row commit-back fetch:', err); });
  }

  /** Cycle 5 / Task 10 — full-row cancel. No worker round-trip; emit
   *  `rowEditingStopped` with the best-effort snapshot we already had. */
  private handleRowCancel(rowIndex: number, rowId: string, snapshot: unknown): void {
    this.cgridCanvas.canvas.focus({ preventScroll: true });
    this.events.emit({ type: 'rowEditingStopped', rowIndex, rowId, data: snapshot });
  }

  /** Register a custom cell editor. Columns with `cellEditor: name`
   *  dispatch to `ctor` when edit starts. Built-in names ('text') can be
   *  overridden by re-registering. */
  registerCellEditor(name: string, ctor: CellEditorCtor): void {
    this.cellEditorRegistry.register(name, ctor);
  }

  /** Cycle 8 / Task 3 — register a named comparator. String-serialises
   *  the function via `Function.prototype.toString()` and ships it to
   *  the worker, which reconstructs it via `new Function(...)`. Column
   *  defs then reference it by string name (`comparator: 'name'`).
   *  Returns a Promise that resolves once the worker acknowledges the
   *  registration so the caller can await it before the first
   *  `setSortModel` that depends on the comparator. */
  registerComparator<TValue = unknown>(
    name: string,
    fn: (a: TValue, b: TValue) => number,
  ): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    return this.workerClient.registerComparator(name, fn.toString());
  }

  /** Subscribe to a typed grid event. Returns an unsubscribe. */
  on<E extends CGridEvent['type']>(
    type: E,
    handler: (e: Extract<CGridEvent, { type: E }>) => void,
  ): () => void {
    return this.events.on(type, handler);
  }
  /** Remove a previously-registered listener. */
  off<E extends CGridEvent['type']>(
    type: E,
    handler: (e: Extract<CGridEvent, { type: E }>) => void,
  ): void {
    this.events.off(type, handler);
  }
  /** Alias for `on`, present for ag-grid API parity. */
  addEventListener<E extends CGridEvent['type']>(
    type: E,
    handler: (e: Extract<CGridEvent, { type: E }>) => void,
  ): () => void {
    return this.on(type, handler);
  }
  /** Alias for `off`, present for ag-grid API parity. */
  removeEventListener<E extends CGridEvent['type']>(
    type: E,
    handler: (e: Extract<CGridEvent, { type: E }>) => void,
  ): void {
    this.off(type, handler);
  }

  /** Pixel bounds of the cell at (`rowIndex`, `colId`) in the canvas's
   *  coordinate space. Returns `null` when not in the current viewport
   *  (off-screen rows / columns + pinned-but-clipped layouts). */
  getCellBoundsAt(rowIndex: number, colId: string): { x: number; y: number; w: number; h: number } | null {
    const col = this.viewport.visibleColumns.find((c) => c.colId === colId);
    const row = this.viewport.visibleRows.find(
      (r) => r.subgrid.isData && r.localRowIndex === rowIndex,
    );
    if (!col || !row) return null;
    return { x: col.left, y: row.top, w: col.width, h: row.height };
  }

  /** Pixel bounds of the cell at (rowIndex, colId) ONLY when the cell
   *  is fully inside its column's band AND inside [bodyTop, bodyBottom].
   *  Returns null when:
   *    - the row or column isn't in the current viewport
   *    - the cell's vertical band exits [bodyTop, bodyBottom]
   *    - the cell's horizontal extent exits its column's band:
   *        center        → [bodyLeft, bodyRight]
   *        pinned-left   → [0, bodyLeft]
   *        pinned-right  → [bodyRight, +∞)
   *  Use this from any overlay that paints / mounts a DOM node at the
   *  cell's coordinates; the looser getCellBoundsAt is for callers
   *  that need bounds whenever the cell is in the viewport at all
   *  (programmatic scroll math, hit-test).
   */
  getVisibleCellBounds(rowIndex: number, colId: string):
    { x: number; y: number; w: number; h: number } | null {
    const bounds = this.getCellBoundsAt(rowIndex, colId);
    if (!bounds) return null;
    const vs = this.viewport;
    if (bounds.y < vs.bodyTop || bounds.y + bounds.h > vs.bodyBottom) return null;
    const col = vs.visibleColumns.find((c) => c.colId === colId);
    const xL = col?.pinned === 'left' ? 0
      : col?.pinned === 'right' ? vs.bodyRight
      : vs.bodyLeft;
    const xR = col?.pinned === 'left' ? vs.bodyLeft
      : col?.pinned === 'right' ? Number.POSITIVE_INFINITY
      : vs.bodyRight;
    if (bounds.x < xL || bounds.x + bounds.w > xR) return null;
    return bounds;
  }

  /** Pixel bounds of the leaf header for `colId` in the canvas's
   *  coordinate space. The y-band covers the leaf-header row (the one
   *  directly above the data rows), NOT any column-group rows stacked
   *  above it. Returns `null` when the column isn't currently in the
   *  viewport. Cycle 6 / Task 1 — used by E2E to position synthetic
   *  drag gestures. */
  getHeaderBoundsAt(colId: string): { x: number; y: number; w: number; h: number } | null {
    const col = this.viewport.visibleColumns.find((c) => c.colId === colId);
    if (!col) return null;
    const leafHeaderRow = this.viewport.visibleRows.find(
      (r) => !r.subgrid.isData && !('getGroupIdAt' in r.subgrid),
    );
    if (!leafHeaderRow) return null;
    return { x: col.left, y: leafHeaderRow.top, w: col.width, h: leafHeaderRow.height };
  }

  /** Pixel bounds of the data row at `rowIndex` (vertical band spanning the
   *  full body width). Returns `null` when the row isn't currently visible.
   *  Used by E2E to assert variable-height row layout without bottoming out
   *  on a per-column lookup. Cycle 5 / Task 6. */
  getRowBoundsAt(rowIndex: number): { y: number; h: number } | null {
    const row = this.viewport.visibleRows.find(
      (r) => r.subgrid.isData && r.localRowIndex === rowIndex,
    );
    if (!row) return null;
    return { y: row.top, h: row.height };
  }

  /** Raw cell value from the current viewport chunk. `null` when the cell
   *  isn't in the chunk (most common: row outside the visible window). */
  getCellValue(rowIndex: number, colId: string): unknown {
    return this.cellAt(rowIndex, colId)?.value ?? null;
  }

  /**
   * Returns the resolved background color that would be painted for the cell
   * at (`rowIndex`, `colId`), accounting for `cellClass`, `cellClassRules`,
   * and the function-form `cellStyle`. Returns `null` when the column is
   * unknown or the row is not in the current viewport chunk.
   *
   * Used by E2E tests to assert visual differentiation without reading canvas
   * pixels. Pattern mirrors `getCellValue`. Cycle 6 / Task 7.
   */
  getCellPaintedBg(rowIndex: number, colId: string): string | null {
    const def = this.columnDefsMap.get(colId);
    if (!def) return null;
    const cell = this.cellAt(rowIndex, colId);
    if (!cell) return null;

    const rowData = this.rowDataSnapshotAt(rowIndex);
    const isSelected = this.selection.state.selectedRowIndices.has(rowIndex);
    const rowBg = isSelected
      ? this.theme.rowSelectedBg
      : (rowIndex % 2 === 1 ? this.theme.rowAltBg : this.theme.bg);

    const throwaway: import('./renderer/cellRenderers/registry').CellPaintConfig = {
      value: '', valueFormatted: '',
      bounds: { x: 0, y: 0, w: 0, h: 0 },
      font: '', fg: '', bg: '', borderColor: '',
      halign: 'left', prefillColor: '',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    };
    applyCellProps(throwaway, {
      theme: this.theme,
      colDef: def,
      value: cell.value,
      valueFormatted: cell.valueFormatted,
      x: 0, y: 0, w: 0, h: 0,
      rowBg,
      prefillColor: rowBg,
      isFocused: false,
      isSelected,
      isHovered: false,
      isHeader: false,
      rowData,
      rowIndex,
    });
    return throwaway.bg;
  }
}

// ─── Cycle 20 / Task 3 — export support ─────────────────────────────────────

/** Caller-facing CSV export params. Mirrors AG-Grid's
 *  `CsvExportParams` for the subset the worker writer respects. */
export interface ExportCsvParams {
  fileName?: string;
  columnSeparator?: string;
  columnKeys?: string[];
  skipColumnHeaders?: boolean;
  suppressQuotes?: boolean;
  withBOM?: boolean;
  prependContent?: string;
  appendContent?: string;
  /** Name of an `exportCallbacks` entry to transform each cell. */
  processCellCallback?: string;
  /** Name of an `exportCallbacks` entry to transform each header. */
  processHeaderCallback?: string;
  /** Cycle 20 / Task 5 — limit the export to currently-selected rows. */
  onlySelected?: boolean;
}

/** Caller-facing XLSX export params. */
export interface ExportExcelParams {
  fileName?: string;
  sheetName?: string;
  columnKeys?: string[];
  skipColumnHeaders?: boolean;
  freezeRows?: number;
  freezeColumns?: number;
  author?: string;
  processCellCallback?: string;
  processHeaderCallback?: string;
  /** Cycle 20 / Task 5 — limit the export to currently-selected rows. */
  onlySelected?: boolean;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Trigger a browser download for an ArrayBuffer. Builds a Blob,
 *  creates an object-URL, dispatches an anchor click, then revokes
 *  the URL on a microtask so the browser has time to start the
 *  download before we drop the handle. */
function triggerDownload(buffer: ArrayBuffer, fileName: string, mime: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke once the browser has had a chance to fetch the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
