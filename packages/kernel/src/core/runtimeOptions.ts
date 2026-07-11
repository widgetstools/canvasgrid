// Runtime-vs-initial option taxonomy + per-option apply functions.
//
// `setGridOption` and `updateGridOptions` route through `applyRuntimeOption`
// below; initial-only keys (`INITIAL_ONLY_OPTIONS`) throw instead. The aim is
// a single canonical list — downstream cycles (theming, state snapshot) read
// from this module so the taxonomy can't drift between docs/catalog and code.
//
// See docs/catalog/01-grid-options.md "Lifecycle — initial vs runtime
// options" for the source of truth on which keys belong in which bucket.

import type { CGridOptions } from '../types';
import { CgTheme } from '../theming/theme/themeObject';

/**
 * Keys that the grid reads exactly once at construction. Attempts to mutate
 * them via `setGridOption` / `updateGridOptions` throw. `columnDefs` is
 * intentionally listed here because it has its own swap path inside
 * `updateGridOptions` that handles tree rebuild + worker column sync — the
 * `setGridOption` single-key entrypoint cannot perform those side-effects
 * coherently, so it rejects with a clear pointer to the batched API.
 */
export const INITIAL_ONLY_OPTIONS: ReadonlySet<keyof CGridOptions<any>> = new Set<
  keyof CGridOptions<any>
>([
  'columnDefs',
  'getRowId',
  'worker',
  // Cycle 21i / Phase 1 — persistence identity + wiring happen once at
  // construction; re-keying a live grid's storage or re-arming autosave
  // mid-session has no sound semantics (which snapshot would win?).
  'gridId',
  'persistState',
  // Cycle 22 / Task 5 — shadow-root attach happens once at construction
  // and the rebuild cost (re-parent every overlay + re-attach worker
  // listeners) outweighs any plausible runtime flip use case.
  'shadowRoot',
]);

/** Keys handled by the runtime apply table. Anything not here AND not in
 *  `INITIAL_ONLY_OPTIONS` is rejected as unknown — keeps the gate tight. */
export type RuntimeOption =
  | 'theme'
  | 'density'
  | 'rowHeight'
  | 'headerHeight'
  | 'defaultColDef'
  | 'animateRows'
  | 'suppressRowHoverHighlight'
  | 'rowSelection'
  | 'suppressRowClickSelection'
  | 'rowMultiSelectWithClick'
  | 'suppressColumnVirtualisation'
  | 'suppressRowVirtualisation'
  | 'enableCellChangeFlash'
  | 'cellFlashDuration'
  | 'cellFadeDuration'
  | 'asyncTransactionWaitMillis'
  | 'rowBuffer'
  | 'context'
  | 'loading'
  | 'debug'
  | 'rowData'
  | 'quickFilterText'
  | 'cacheQuickFilter'
  | 'includeHiddenColumnsInQuickFilter'
  | 'enableFillHandle'
  | 'fillHandleDirection'
  | 'fillOperation'
  | 'cellSelection'
  | 'getContextMenuItems'
  | 'clipboardDelimiter'
  | 'processCellForClipboard'
  | 'processCellFromClipboard'
  | 'suppressContextMenu'
  | 'suppressClipboardApi'
  | 'suppressClipboardPaste'
  | 'pinnedTopRowData'
  | 'pinnedBottomRowData'
  | 'aggFuncs'
  | 'suppressAggFuncInHeader'
  | 'rowGroupPanelShow'
  | 'rowGroupPanelSuppressSort'
  | 'statusBar'
  | 'floatingFilter'
  | 'pivotPanelShow'
  | 'pivotMaxGeneratedColumns'
  | 'enableStrictPivotColumnOrder'
  | 'pivotRowTotals'
  | 'pivotColumnGroupTotals'
  | 'pivotDefaultExpanded'
  | 'pivotGrandTotals'
  | 'domLayout'
  | 'groupSelectsChildren'
  | 'suppressCount'
  | 'singleClickEdit'
  | 'suppressClickEdit'
  | 'enableExcelEditing'
  | 'paintCache'
  | 'paintCacheOverscan'
  | 'rasterCache'
  | 'rasterCacheBudgetMB';

/** Minimal grid surface the apply table needs. Lives here to avoid a circular
 *  import on `CGrid` (cgrid.ts imports this module). */
export interface RuntimeOptionTarget<TRow = any> {
  options: CGridOptions<TRow>;
  setTheme(theme: string | CgTheme): void;
  /** Cycle 22 / Task 2 — swap the density-mode CSS class on the grid
   *  root (or remove it entirely when `density` is `null` /
   *  `undefined`). The grid re-reads its theme + recomputes the
   *  viewport before the next paint so row + header height pick up the
   *  density bundle's overrides. */
  setDensity(density: 'compact' | 'normal' | 'comfortable' | null | undefined): void;
  /** Cycle 24 / Task 3 — push the current options through to the a11y
   *  overlay (refreshes aria-label + aria-busy). Cheap; safe to call
   *  whenever any of the options' a11y-relevant fields change. */
  refreshA11y?(): void;
  /** Re-resolve the column tree using the current `options.columnDefs` +
   *  the supplied (or current) `defaultColDef`. Triggers viewport + worker
   *  refresh. Used by both the `defaultColDef` runtime apply and the
   *  `columnDefs` swap path in `updateGridOptions`. */
  rebuildColumns(opts: { defaultColDef?: Partial<any> }): void;
  /** Repaint + viewport invalidation hook. Cheap; safe to call repeatedly. */
  refreshLayout(): void;
  /** SelectionModel mode swap (rowSelection runtime option). */
  setSelectionMode(mode: 'none' | 'single' | 'multiple'): void;
  /** Replace the row data set (mirrors `api.setRowData`). */
  applyRowData(rows: unknown[]): void;
  /** Cycle 7 / Task 7 — re-evaluate the quick filter using the current
   *  `options.quickFilterText` / `cacheQuickFilter` /
   *  `includeHiddenColumnsInQuickFilter`. Implementation in `cgrid.ts`
   *  parses the text, ships to the worker, and fires `filterChanged` with
   *  `source: 'quickFilter'`. */
  applyQuickFilter(): void;
  /** Cycle 4 / Task 11 (cell-flash patch) — forward the runtime
   *  `enableCellChangeFlash` flip to the worker so the diff producer
   *  starts / stops on the next applyTransaction. Implementation in
   *  `cgrid.ts` calls `workerClient.setEnableCellChangeFlash`. */
  forwardEnableCellChangeFlash(enabled: boolean): void;
  /** Cycle 14 / Task 2 — rebuild the subgrid stack (without re-resolving
   *  the column tree) and recompute the viewport. The pinnedTopRowData /
   *  pinnedBottomRowData runtime flips route through here: a re-mount
   *  is cheaper than a `rebuildColumns` and skips the worker round-trip
   *  that the column path would trigger. */
  rebuildSubgrids(): void;
  /** Cycle 14 / Task 3 — forward the runtime `aggFuncs` swap to the
   *  worker so the AggFuncRegistry's custom layer reflects the new map.
   *  Implementation in `cgrid.ts` serialises each function, screens for
   *  closures, and calls `workerClient.setAggFuncs`.
   *
   *  Cycle 14 / Task 6 — `triggerRefresh: true` (the runtime-apply path
   *  passes this) kicks a follow-up viewport fetch so the totals row
   *  refreshes and `aggregationChanged` fires tagged `aggFuncChanged`.
   *  The constructor's seed call leaves it `false` so the initial emit
   *  stays tagged `rowDataChanged` from the subsequent setRowData. */
  forwardAggFuncs(funcs: Record<string, unknown> | undefined, triggerRefresh?: boolean): void;
  /** Cycle 15 / Task 6 — hand the runtime row-group-panel show mode
   *  to CGrid so it can mount / unmount / setShowMode on the host.
   *  CGrid normalises the value (undefined / `'never'` → unmount;
   *  otherwise mount-or-update). */
  updateRowGroupPanelShow(value: 'always' | 'onlyWhenGrouping' | 'never' | undefined): void;
  /** Cycle 21i Phase 2 — re-resolve the status bar from the current
   *  `options.statusBar` (intrinsic default-on; `false` opts out).
   *  CGrid mounts, unmounts, or swaps the def on the live host. */
  updateStatusBar(): void;
  /** Cycle 18 / Task 6 — hand the runtime pivot-panel show mode to
   *  CGrid so it can mount / unmount / setShowMode on the host. */
  updatePivotPanelShow(value: 'always' | 'onlyWhenPivoting' | 'never' | undefined): void;
  /** Cycle 18 / Task 8a — forward the runtime cap to the worker so
   *  subsequent `getViewport` calls honor it. `undefined` reverts to
   *  the worker default (5000). */
  updatePivotMaxGeneratedColumns(value: number | undefined): void;
  /** Cycle 18 / Task 8c — flip the strict-order behaviour. `true` =
   *  always re-sort. `false` (AG default) = preserve prior order +
   *  append new keys at end. */
  updateStrictPivotColumnOrder(value: boolean | undefined): void;
  /** Cycle 18 / Task 8e — re-synthesize the pivot columns so the new
   *  totals position lands. The cached pivot tree signature folds the
   *  totals options in, so the next chunk receipt detects the change
   *  and re-synthesizes. CGrid implementation triggers a viewport
   *  request after stashing the option. */
  updatePivotTotalsOption(): void;
  /** Cycle 15.5 / Task 1 — hand the runtime `rowGroupPanelSuppressSort`
   *  flag to CGrid so the panel re-renders (with / without the sort
   *  indicator) on the next frame. */
  updateRowGroupPanelSuppressSort(suppress: boolean): void;
  /** Cycle 15 / Task 8 — flip the `groupSelectsChildren` tri-state
   *  selection feature. CGrid wires the SelectionModel's group
   *  membership resolver, toggles the worker's per-snapshot descendant
   *  emission, and triggers a paint refresh so the auto-group cells
   *  re-render with / without checkboxes. */
  updateGroupSelectsChildren(enabled: boolean): void;
  /** Task 4 (paint-cache layer) — runtime `paintCache` / `paintCacheOverscan`
   *  flip. CGrid's implementation disposes any existing retained layer and
   *  (when the option is now active) constructs a fresh one, then forces a
   *  full repaint — a flip is a teardown/rebuild, never a stale-present
   *  frame. */
  resetPaintCacheLayer(): void;
  /** Cycle 22 / Task 2 — runtime `rasterCache` / `rasterCacheBudgetMB`
   *  flip. CGrid's implementation disposes BOTH raster-cache tiers (cell
   *  bitmaps + row strips) and, when the option is now active, rebuilds
   *  them under a fresh shared `RasterBudget`, then forces a full
   *  repaint. `rasterCache: false` must land as "both tiers disposed" —
   *  the exact shipped cell-paint pipeline with zero retained bytes. */
  resetRasterCache(): void;
}

/**
 * Apply a single runtime option. The caller has already stored
 * `target.options[key] = value`, so per-option handlers only need to perform
 * downstream side-effects (recompute viewport, update SelectionModel, etc.).
 * Storage-only keys (e.g. `animateRows`, `debug`) fall through to a no-op.
 */
export function applyRuntimeOption<TRow>(
  target: RuntimeOptionTarget<TRow>,
  key: RuntimeOption,
  value: unknown,
): void {
  switch (key) {
    case 'theme':
      if (typeof value === 'string' || value instanceof CgTheme) target.setTheme(value);
      return;
    case 'density':
      // Cycle 22 / Task 2 — accept `'compact' | 'normal' | 'comfortable'`
      // and `null` / `undefined` (clears the density class). The
      // helper swaps the host class, re-reads tokens, and triggers
      // one viewport recompute + one repaint.
      if (value === 'compact' || value === 'normal' || value === 'comfortable'
          || value === null || value === undefined) {
        target.setDensity(value as 'compact' | 'normal' | 'comfortable' | null | undefined);
      }
      return;
    case 'rowHeight':
    case 'headerHeight':
      target.refreshLayout();
      return;
    case 'defaultColDef':
      // Re-resolve with the new defaults; existing columnDefs stay the same.
      target.rebuildColumns({ defaultColDef: value as Partial<any> | undefined });
      return;
    case 'rowSelection':
      if (value === 'none' || value === 'single' || value === 'multiple') {
        target.setSelectionMode(value);
      }
      return;
    case 'suppressColumnVirtualisation':
    case 'suppressRowVirtualisation':
    case 'rowBuffer':
      // computeViewport reads these directly from CGridOptions, so a single
      // viewport recompute is enough — no column-tree rebuild needed.
      target.refreshLayout();
      return;
    case 'rowData':
      if (Array.isArray(value)) target.applyRowData(value);
      return;
    case 'quickFilterText':
    case 'cacheQuickFilter':
    case 'includeHiddenColumnsInQuickFilter':
      // All three feed into a single worker round-trip. The caller has
      // already mutated `target.options[key]` so `applyQuickFilter` reads
      // the current values back; toggling cache or the hidden-columns
      // flag therefore re-evaluates with the existing text in place.
      target.applyQuickFilter();
      return;
    case 'enableCellChangeFlash':
      // Cycle 4 / Task 11 — forward to the worker so the diff producer
      // starts / stops on the next applyTransaction. The main-side
      // FlashRegistry reads `options.enableCellChangeFlash` live so no
      // additional wiring is needed there.
      target.forwardEnableCellChangeFlash(value === true);
      return;
    case 'aggFuncs':
      // Cycle 14 / Task 3 — forward the new aggFuncs map to the worker
      // wholesale. Main side serialises each function (with closure
      // detection) and posts `setAggFuncs`. The forwarder accepts
      // `undefined` to clear the custom layer.
      // Cycle 14 / Task 6 — pass `triggerRefresh: true` so the
      // forwarder kicks a follow-up viewport fetch tagged
      // `aggFuncChanged` after the worker registry updates.
      target.forwardAggFuncs(value as Record<string, unknown> | undefined, true);
      return;
    case 'loading':
      // Cycle 24 / Task 3 — aria-busy reflects this flag. Push the new
      // value through to the a11y overlay immediately so screen
      // readers learn the loading transition.
      target.refreshA11y?.();
      return;
    case 'suppressRowClickSelection':
    case 'rowMultiSelectWithClick':
      // Both flags are storage-only at runtime — CellSelection reads
      // them at event time via `CGridLike.isRowClickSelectionSuppressed`
      // / `isRowMultiSelectWithClick`, so a flip lights up on the
      // next click without further wiring.
      return;
    case 'suppressRowHoverHighlight':
      // Painter reads `options.suppressRowHoverHighlight` via the
      // getHoveredRowIndex gate each paint; repaint so a live toggle
      // clears/enables the highlight immediately.
      target.refreshLayout();
      return;
    case 'animateRows':
    case 'cellFlashDuration':
    case 'cellFadeDuration':
    case 'asyncTransactionWaitMillis':
    case 'context':
    case 'debug':
    // Cycle 9 / Task 5 — fill-handle options are storage-only at runtime.
    // The feature reads `options.enableFillHandle` / `fillHandleDirection`
    // / `fillOperation` at event time (mousedown), and the painter reads
    // `options.enableFillHandle` per paint, so a flip lights up on the
    // next interaction / frame without further wiring.
    case 'enableFillHandle':
    case 'fillHandleDirection':
    case 'fillOperation':
    // Cycle 9 / Task 6 — `cellSelection` is storage-only at runtime. The
    // feature chain reads `options.cellSelection` at event time via
    // `CGridLike.getCellSelectionOptions()`, so a flip lights up on the
    // next pointer event without further wiring.
    case 'cellSelection':
    // Cycle 10 / Task 1 — `getContextMenuItems` is storage-only at runtime.
    // CGrid.resolveContextMenuItems reads `options.getContextMenuItems`
    // at event time, so a runtime flip lights up on the next
    // right-click without further wiring.
    case 'getContextMenuItems':
    // Cycle 10 / Task 3 — `clipboardDelimiter` is storage-only at runtime.
    // `copySelectedRangesToClipboard` reads `options.clipboardDelimiter`
    // at copy time, so a runtime flip takes effect on the next Ctrl+C.
    case 'clipboardDelimiter':
    // Cycle 10 / Task 5 — `processCellForClipboard` /
    // `processCellFromClipboard` are storage-only at runtime.
    // `copySelectedRangesToClipboard` / `cutSelectedRanges` /
    // `pasteFromClipboard` read the callbacks at copy / paste time,
    // so a runtime swap (or `undefined` to clear) takes effect on the
    // next clipboard verb without further wiring.
    case 'processCellForClipboard':
    case 'processCellFromClipboard':
    // Cycle 10 / Task 6 — `suppressContextMenu` / `suppressClipboardApi`
    // / `suppressClipboardPaste` are storage-only at runtime. RightClick
    // reads `suppressContextMenu` on every contextmenu event;
    // KeyboardShortcuts reads `suppressClipboardApi` / `suppressClipboardPaste`
    // on every keydown; `cgrid.copySelectedRangesToClipboard` /
    // `pasteFromClipboard` / `cutSelectedRanges` re-read the flags on
    // every call. A `setGridOption` flip therefore lights up on the next
    // event / invocation without any further wiring here.
    case 'suppressContextMenu':
    case 'suppressClipboardApi':
    case 'suppressClipboardPaste':
      // Storage-only: downstream cycles read directly from `options[key]`.
      return;
    case 'suppressAggFuncInHeader':
      // Cycle 14 / Task 4 — toggle header decoration. The painter reads
      // `options.suppressAggFuncInHeader` per paint via the Renderer's
      // `getSuppressAggFuncInHeader` callback, so a single repaint is
      // enough to flip every leaf header's text. No worker round-trip
      // (the aggFunc resolution stays worker-side; only the visible
      // label changes).
      target.refreshLayout();
      return;
    case 'singleClickEdit':
    case 'suppressClickEdit':
    case 'enableExcelEditing':
      // Cycle 21i / Phase 1 — storage-only. EditTrigger reads
      // `getEditingFlags()` (→ options.singleClickEdit / suppressClickEdit)
      // at click time, and EditController reads `options.enableExcelEditing`
      // at edit-start / keydown, so a runtime flip takes effect on the next
      // interaction with no re-render needed.
      return;
    case 'suppressCount':
      // Cycle 15.5 / Task 7 — toggle the `(n)` child-count badge on group
      // rows. The group cell-renderer params builder reads
      // `options.suppressCount` per cell-build (childCount is already
      // known main-side), so a single repaint flips every group row's
      // badge with no worker round-trip.
      target.refreshLayout();
      return;
    case 'pinnedTopRowData':
    case 'pinnedBottomRowData':
      // Cycle 14 / Task 2 — re-mount the subgrid stack. The new array is
      // already stored in `target.options[key]`; rebuildSubgrids reads it
      // back and picks up / drops the PinnedRowsSubgrid accordingly.
      target.rebuildSubgrids();
      return;
    case 'rowGroupPanelShow':
      // Cycle 15 / Task 6 — runtime mount / unmount / show-mode swap.
      // CGrid normalises `undefined` / `'never'` to "unmount"; any other
      // valid value mounts (or updates an existing host).
      target.updateRowGroupPanelShow(
        value as 'always' | 'onlyWhenGrouping' | 'never' | undefined,
      );
      return;
    case 'statusBar':
      // Cycle 21i Phase 2 — runtime mount / unmount / def swap for the
      // intrinsic status bar. The new value is already stored in
      // `target.options.statusBar`; updateStatusBar re-normalizes it.
      target.updateStatusBar();
      return;
    case 'floatingFilter':
      // Runtime show/hide of the floating-filter row. The value is already
      // stored in `target.options.floatingFilter`; the FloatingFilterSubgrid
      // reads `isFloatingFilterEnabled()` live, so re-mounting the subgrid
      // stack + recomputing the viewport adds/removes the row and its input
      // overlay (the viewport's `afterRecompute` re-pins the input pool).
      target.rebuildSubgrids();
      return;
    case 'pivotPanelShow':
      // Cycle 18 / Task 6 — runtime mount / unmount / show-mode swap
      // for the pivot panel (top-of-grid drop strip).
      target.updatePivotPanelShow(
        value as 'always' | 'onlyWhenPivoting' | 'never' | undefined,
      );
      return;
    case 'pivotMaxGeneratedColumns':
      // Cycle 18 / Task 8a — forward the runtime cap. Worker handles
      // negative / non-finite by reverting to the default — main here
      // just ships whatever the app wrote, no pre-validation.
      target.updatePivotMaxGeneratedColumns(
        value as number | undefined,
      );
      return;
    case 'enableStrictPivotColumnOrder':
      // Cycle 18 / Task 8c — flip the strict-order flag. Both branches
      // are explicit booleans on the worker side; `undefined` resolves
      // to `false` (the AG default).
      target.updateStrictPivotColumnOrder(value as boolean | undefined);
      return;
    case 'pivotRowTotals':
    case 'pivotColumnGroupTotals':
    case 'pivotDefaultExpanded':
    case 'pivotGrandTotals':
      // Cycle 18 / Task 8e + Excel-grand-totals — re-synthesize on the
      // next viewport. All four options are inputs to
      // `synthesizePivotColumns` (NOT to the worker pipeline), so the
      // change only matters once the next chunk arrives + the
      // signature compare picks up the option delta. CGrid
      // implementation issues a viewport request.
      target.updatePivotTotalsOption();
      return;
    case 'domLayout':
      // Cycle 20 / Task 6 — flipping between 'normal' and 'print'
      // changes the effective virtualisation flags read on the next
      // viewport compute. Re-request a viewport so the data subgrid
      // expands (print) or re-virtualises (normal).
      target.refreshLayout();
      return;
    case 'rowGroupPanelSuppressSort':
      // Cycle 15.5 / Task 1 — re-render the chip strip without the
      // sort indicator span when `true`. The flag toggles which DOM
      // pieces the panel host renders + whether the click handlers
      // are wired.
      target.updateRowGroupPanelSuppressSort(value === true);
      return;
    case 'groupSelectsChildren':
      // Cycle 15 / Task 8 — flip the tri-state cascading. CGrid wires
      // the SelectionModel's membership resolver, toggles the worker's
      // descendant emission, and repaints. A runtime flip on a grid
      // that is currently grouped lights up checkboxes (true) or hides
      // them (false) on the next frame.
      target.updateGroupSelectsChildren(value === true);
      return;
    case 'paintCache':
    case 'paintCacheOverscan':
      // Task 4 — a flip tears down / rebuilds the retained layer and
      // forces a full repaint (see `resetPaintCacheLayer`'s doc).
      target.resetPaintCacheLayer();
      return;
    case 'rasterCache':
    case 'rasterCacheBudgetMB':
      // Cycle 22 / Task 2 — a flip disposes / rebuilds both raster-cache
      // tiers and forces a full repaint (see `resetRasterCache`'s doc).
      target.resetRasterCache();
      return;
  }
}

/** True when `key` is a known runtime-mutable option. */
export function isRuntimeOption(key: string): key is RuntimeOption {
  return RUNTIME_OPTION_SET.has(key as RuntimeOption);
}

export const RUNTIME_OPTION_SET: ReadonlySet<RuntimeOption> = new Set<RuntimeOption>([
  'theme', 'density', 'rowHeight', 'headerHeight', 'defaultColDef',
  'animateRows', 'suppressRowHoverHighlight', 'rowSelection',
  'suppressRowClickSelection', 'rowMultiSelectWithClick',
  'suppressColumnVirtualisation', 'suppressRowVirtualisation',
  'enableCellChangeFlash', 'cellFlashDuration', 'cellFadeDuration',
  'asyncTransactionWaitMillis', 'rowBuffer',
  'context', 'loading', 'debug', 'rowData',
  'quickFilterText', 'cacheQuickFilter', 'includeHiddenColumnsInQuickFilter',
  'enableFillHandle', 'fillHandleDirection', 'fillOperation',
  'cellSelection',
  'getContextMenuItems',
  'clipboardDelimiter',
  'processCellForClipboard',
  'processCellFromClipboard',
  'suppressContextMenu',
  'suppressClipboardApi',
  'suppressClipboardPaste',
  'pinnedTopRowData',
  'pinnedBottomRowData',
  'aggFuncs',
  'suppressAggFuncInHeader',
  'rowGroupPanelShow',
  'rowGroupPanelSuppressSort',
  'statusBar',
  'floatingFilter',
  'pivotPanelShow',
  'pivotMaxGeneratedColumns',
  'enableStrictPivotColumnOrder',
  'pivotRowTotals',
  'pivotColumnGroupTotals',
  'pivotDefaultExpanded',
  'pivotGrandTotals',
  'domLayout',
  'groupSelectsChildren',
  'suppressCount', 'singleClickEdit', 'suppressClickEdit', 'enableExcelEditing',
  'paintCache', 'paintCacheOverscan',
  'rasterCache', 'rasterCacheBudgetMB',
]);
