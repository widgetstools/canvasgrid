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
  VelocityGridOptions, VelocityGridEvent, VelocityGridApi, Tx, TransactionResult, SortModel, FilterModel,
  CFilterModelEntry, GroupModel, FlashCellsParams, SelectionRange,
  AggregationChangedSource, PaintStats,
} from './types';
import { clampRowHeight } from './types/options';
import type { ToolPanel, SideBarDef } from './interaction/toolPanels/types';
import { TypedEventEmitter } from './core/eventEmitter';
import { DisposableRegistry } from './core/disposable';
import { ViewportManager } from './core/viewportManager';
import { ServerSideRowModelController } from './core/serverSideRowModel';
import { ServerSideRowModelV2Controller, type SsrmHostV2 } from './core/serverSideRowModelV2';
import { isServerSideDatasourceV2 } from './types/ssrm';
import { buildSsrmColumnKeys } from './core/ssrmColumnKeys';
import { parseCompositeGroupKey, readSsrmRowMeta as readSsrmMeta } from './core/ssrmRowMeta';
import type {
  AnyServerSideDatasource,
  IServerSideDatasource,
  IServerSideDatasourceV2,
  RefreshServerSideParams,
  ServerSideTransaction,
  SsrmExpressionHost,
} from './types/ssrm';
import { type ResolvedColDef, applyCellProps, composeFont } from './core/propertyChain';
import { resolveColumnTree, isColGroupDef, visibleHeaderGroupDepth, type ColumnTree, type ColumnTreeNode, type ResolvedColGroupDef } from './core/columnTree';
import { moveColumnToGroup as moveColumnToGroupPure, moveColumnGroup as moveColumnGroupPure } from './core/columnGroupMutation';
import { resolveSelection, applyResolvedSelectionToOptions } from './core/selectionConfig';
import { serializeAggFuncsMap } from './core/aggFuncSerialization';
import { buildFlashAlphaMask } from './core/flashAlphaMask';
import { applyPaintQualityDefaults } from './core/paintQuality';
import {
  commitPanelMove as commitPanelMoveHelper,
  resolveDragTargetRole as resolveDragTargetRoleHelper,
  type PillPanelRole, type PanelMoveApi,
} from './core/panelDragMove';
import { ChunkLRU, estimateChunkBytes } from './core/memoryBudget';
import { ColumnGroupState, resolveVisibleLeaves } from './core/columnGroupState';
import {
  applyReorder, resolveLegalDropIndex, reorderLeavesByList,
  type ColumnOrderConstraints,
} from './core/columnOrder';
import {
  ColumnStateManager,
  type ColumnStateManagerDeps,
} from './core/columnStateManager';
import {
  buildSnapshot, migrateSnapshot, STATE_SCHEMA_VERSION, type GridState,
} from './core/stateSnapshot';
import { LayoutManager, type LayoutManagerHost, type SaveLayoutOptions } from './core/layoutManager';
import type { GridLayout, GridBaselineConfig, GridLayoutsBundle, TemplateSaveInput } from './types/layout';
import { DEFAULT_GRID_LEVEL_MODULES } from './types/layout';
import type { LayoutChangeSource, TemplateChangeSource, RuleChangeSource } from './types/event';
import type { ColumnTemplate } from '@wellsfargo-starui/velocity-grid-calc';
import { StateUpdatedBus } from './core/stateUpdatedBus';
import {
  flatten as flattenColumnGroups, project as projectColumnGroups,
  rehydrate as rehydrateColumnGroups, toSerializedNodes as toSerializedColumnGroupNodes,
} from './interaction/columnGroups/model';
import type { SerializedNode } from './interaction/columnGroups/model';
import { ModuleStateRegistry, type StateModule } from './core/moduleState';
import { computeAutoHeaderHeight } from './renderer/cellRenderers/headerWrap';
import type { CColumnState, CApplyColumnStateParams, ISizeColumnsToFitParams, ColumnGroupWalkNode } from './types';
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
import { PaintCacheLayer, planLayer, defaultCanvasFactory, type LayerGeometry, type LayerPlan } from './core/paintCache';
import { RasterBudget, CellBitmapCache, RowStripCache } from './renderer/rasterCache';
import type { RasterCellsCtx, RasterStripsCtx } from './renderer/painters/types';
import type { CellPaintConfig } from './renderer/cellRenderers/registry';
import { HeaderSubgrid, HeaderGroupSubgrid, DataSubgrid, TotalsSubgrid, PinnedRowsSubgrid, type Subgrid, type SubgridCell } from './core/subgrid';
import { FloatingFilterSubgrid } from './core/floatingFilterSubgrid';
import { FloatingFilterOverlay } from './interaction/floatingFilterOverlay';
import { PopupHost } from './interaction/editors/popupHost';
import { FilterPopupHost } from './interaction/filters/filterPopupHost';
import { ContextMenuHost } from './interaction/contextMenu/host';
import { ModalHost } from './interaction/modalHost';
import { FloatingPanelHost, type FloatingRect } from './interaction/floatingPanel/host';
import { ToolPanelRegistry } from './interaction/toolPanels/registry';
import { ColumnsToolPanel } from './interaction/toolPanels/columnsPanel';
import { FiltersToolPanel } from './interaction/toolPanels/filtersPanel';
import { GridOptionsToolPanel } from './interaction/toolPanels/gridOptionsPanel';
import { ColumnGroupsToolPanel } from './interaction/toolPanels/columnGroupsPanel';
// Re-exported so VelocityGridExt (and hosts) can mount these panels in a settings
// sheet without depending on kernel-internal paths.
export { GridOptionsToolPanel } from './interaction/toolPanels/gridOptionsPanel';
export { ColumnGroupsToolPanel } from './interaction/toolPanels/columnGroupsPanel';
export {
  ColorPickerControl,
  parseColor,
  rgbaToString,
} from './interaction/settingsForm/colorPicker';
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
import { LoadingOverlay } from './interaction/loadingOverlay';
import type { PivotValueColumn } from './core/pivotState';
import { PivotEngine, type PivotEngineDeps, type PivotEngineOptions } from './core/pivotEngine';
import {
  GroupingCoordinator,
  type GroupingCoordinatorDeps,
  type GroupingCoordinatorOptions,
} from './core/groupingCoordinator';
import {
  isPivotResultColumnId, isPivotRowTotalColumnId,
  isPivotResultGroupId,
} from './core/pivotColumns';
import { encodePivotValueKey, PIVOT_PATH_SEP } from './worker/passes/pivotPass';
import type { MenuItem, GetContextMenuItemsParams, GetMainMenuItemsParams } from './interaction/contextMenu/types';
import { buildDefaultMenuItems } from './interaction/contextMenu/defaults';
import { buildDefaultMainMenuItems } from './interaction/contextMenu/mainMenuDefaults';
import { NumberFilterPopup } from './interaction/filters/numberFilter';
import { DateFilterPopup } from './interaction/filters/dateFilter';
import { TextFilterPopup, applyTrimInputToModel } from './interaction/filters/textFilter';
import { SetFilterPopup } from './interaction/filters/setFilter';
import { FlashRegistry } from './core/flashRegistry';
import { VelocityGridCanvas } from './core/canvas';
import { CssReader, type ResolvedTheme } from './theming/cssReader';
import {
  setThemeParams as themeParamsSet,
  getThemeParams as themeParamsGet,
  clearThemeParams as themeParamsClear,
} from './theming/themeParams';
// Theming Task 6/7 — programmatic `CgTheme` object DOM integration.
// `CgTheme` is imported as a VALUE (not just a type) for the
// `theme instanceof CgTheme` branch in `applyThemeOption`/`setTheme`. The
// rest of the module's public surface (`createTheme`, `themeQuartz`,
// `themeStarui`, `baseTheme`, and the param/value types) is re-exported
// below directly from `./theming/theme` — no local binding needed since
// this file never constructs/inspects them itself.
import { CgTheme, type ThemeMode } from './theming/theme';
import { CellRendererRegistry, textCell, numberCell, checkboxCell, headerCell, type CellPainter, type RegisterCellRendererOpts } from './renderer/cellRenderers/registry';
import { wrapTextCell } from './renderer/cellRenderers/wrapText';
import { totalsCell } from './renderer/cellRenderers/totals';
import { groupCell, GROUP_CELL_GEOMETRY, type GroupCellValue } from './renderer/cellRenderers/group';
import { groupFooterCell } from './renderer/cellRenderers/groupFooter';
import { sparklineCell } from './renderer/cellRenderers/sparkline';
import { compositeCell } from './renderer/cellRenderers/composite';
import { rowSelectCheckboxCell } from './renderer/cellRenderers/rowSelectCheckbox';
import { coerceToNumberArray } from './renderer/cellRenderers/sparkline/coerceToNumberArray';
import { decorateHeader, resolveDrawableCellIcon } from './renderer/painters/byRows';
import {
  autoGroupColumnDepthFromId,
  isAutoGroupColumnId,
  resolveGroupDisplayType,
} from './core/autoGroupColumn';
import { Renderer } from './renderer/renderer';
import type { CachedContext2D } from './renderer/gc';
import {
  DamageLedger,
  decideScrollDamage,
  dataRectToScreen,
  screenYToContentY,
  STICKY_SHADOW_BLEED_PX,
  type DamageResolveCtx,
  type Rect,
} from './core/damageLedger';
import { HitTester } from './interaction/hitTester';
import { SelectionModel } from './interaction/selectionModel';
import { FeatureChain } from './interaction/featureChain';
import type { CellEditorCtor } from './interaction/editors/iCellEditor';
import { A11yOverlay } from './interaction/a11yOverlay';
import { WorkerCoordinator } from './core/workerCoordinator';
import { EditController } from './core/editController';
import { wrapTextToHeight } from './worker/measureText';
import type { WorkerColumn, ViewportChunk, AutosizeColumnRequest, StickyAncestor, WorkerCalcProgram } from './worker/protocol';
import type { IAggFunc, IAggFuncParams } from './types';
import { decodeText } from './worker/chunkFormat';
// Cycle 10 / Task 5 — main-side serialise + paste-cell map helpers used when
// the app configures `processCellForClipboard` / `processCellFromClipboard`.
import {
  serializeRanges as serializeRangesPure,
  mapPasteCells,
} from './worker/passes/clipboardPass';
import {
  registerFormatCompiler as slotRegisterFormatCompiler,
  type FormatCompiler,
} from './core/formatCompilerSlot';
import { registerRuleEngine as slotRegisterRuleEngine, getRuleEngine, type RuleEngineShape, type ConditionalRuleShape } from './core/ruleEngineSlot';
import { isRuleFlashOwned, ruleFlashOwnership } from './core/ruleFlashOwnership';
import {
  registerCalcProvider as slotRegisterCalcProvider,
  getCalcProvider,
  foldCalcColumnDefs,
  type CalcProviderShape,
} from './core/calcSlot';
import { buildFormatEvalCtx } from './core/formatEvalMemo';
import { resolveThemeKind, isDarkColor } from './theming/themeKind';
import {
  registerIconSet as regIcons,
  resolveIcon as resIcon,
  listIcons as listRegisteredIcons,
} from './icons/registry';
import {
  registerTooltipProvider as regTip,
  unregisterTooltipProvider as unregTip,
  type TooltipProviderFn,
} from './interaction/features/tooltipProvider';
import { serializeToHtml, type RowExport } from './interaction/features/clipboardSerializer';

export const VELOCITY_GRID_VERSION = '0.0.0';

export type {
  VelocityGridOptions, CColDef, CColGroupDef, VelocityGridEvent, VelocityGridApi, Tx, TransactionResult,
  SortModel, SortModelEntry, FilterModel, FilterModelEntry, FilterModelEntryLegacy,
  CFilterModelEntry, CTextFilterModel, CNumberFilterModel, CDateFilterModel,
  CMultiConditionFilterModel, CSetFilterModel,
  CFilterParams, CTextFilterParams, CSetFilterParams,
  CTextFilterOp, CNumberFilterOp, CDateFilterOp,
  FlashCellsParams,
  GroupModel,
  IServerSideDatasource, IServerSideGetRowsParams, IServerSideGetRowsRequest,
  LoadSuccessParams, ServerSideTransaction, RefreshServerSideParams,
  SsrmRowMeta, SsrmRowKind,
  // SSRM v2 skeleton contract (docs/ssrm-group-skeleton-design.md).
  IServerSideDatasourceV2, AnyServerSideDatasource, SkeletonGroup,
  IServerSideGetSkeletonRequest, IServerSideGetSkeletonParams,
  IServerSideGetLeafRowsRequest, IServerSideGetLeafRowsParams,
  IServerSideGetGroupLeafIdsRequest, IServerSideGetGroupLeafIdsParams,
  SsrmExpressionHost,
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
  // Grid Layouts (Phase A) — public data model + event source.
  LayoutState, GridLayout, GridLayoutsBundle, GridBaselineConfig, LayoutChangeSource,
  // Grid Layouts (Phase B / B3) — template-save input + event source.
  TemplateSaveInput, TemplateChangeSource,
  // Grid Layouts (Phase C / C3) — conditional-rule event source.
  RuleChangeSource,
} from './types';
// Grid Layouts (Phase C / C3) — the opaque conditional-rule shape the
// VelocityGridApi rule methods accept/return.
export type { ConditionalRuleShape } from './core/ruleEngineSlot';
// Grid Layouts (Phase A) — public value exports (reserved id, tier default,
// bundle version).
export { DEFAULT_LAYOUT_ID, DEFAULT_GRID_LEVEL_MODULES, LAYOUTS_BUNDLE_VERSION } from './types';
export { SSRM_ROW_META_KEY, attachSsrmRowMeta, readSsrmRowMeta, isServerSideDatasourceV2 } from './types/ssrm';
export { buildSsrmColumnKeys, mergeSsrmRowFields } from './core/ssrmColumnKeys';
export type { SsrmColumnKeysInput } from './core/ssrmColumnKeys';
export type { CellPainter, CellPaintConfig, RegisterCellRendererOpts } from './renderer/cellRenderers/registry';
// Workstream A (2026-07-06 CSS styling model) — renderer-palette bundle
// type, so @wellsfargo-starui/velocity-grid-renderers (and follow-on structured-map work) can name
// the shape of `CellPaintConfig.palette` directly.
export type { RendererPalette } from './theming/cssReader';
// Theming Task 6/7 — programmatic `CgTheme` object public surface. `CgTheme`
// + `createTheme` are re-exported as VALUES (a consumer builds themes with
// `themeQuartz.withParams(...)`, or starts from `createTheme()`); the rest
// are types describing the param vocabulary + compiled shape. See
// `theming/theme/index.ts` for the full internal barrel.
export { CgTheme, createTheme, themeQuartz, themeStarui, baseTheme } from './theming/theme';
export type {
  ThemeMode,
  BaseClassPair,
  CompiledTheme,
  Part,
  CgThemeParams,
  StatusColorEntry,
  ColorValue,
  LengthValue,
  BorderValue,
  FontFamilyValue,
  FontWeightValue,
} from './theming/theme';
// Cycle 23 / Tasks 5-6 — state-snapshot public types.
export type { GridState } from './core/stateSnapshot';
export { STATE_SCHEMA_VERSION } from './core/stateSnapshot';
// Cycle 21i Phase 2 / T2 — module-state registry surface. Engines
// register slices via `grid.registerStateModule(...)`; the types are
// exported so engine packages can declare modules without reaching
// into kernel internals.
export type { StateModule, ModuleStateEnvelope } from './core/moduleState';
export type { StateStorageAdapter, PersistStateOptions } from './core/statePersistence';
export { LocalStorageStateAdapter } from './core/statePersistence';

/** Cycle 21i / Phase 1 — runtime options that never enter the GridState
 *  `gridOptions` slice: data inputs, callbacks/functions (not
 *  serializable), and `theme` (app chrome owns the toggle; persisting it
 *  would fight the host's own theme storage). */
const NON_PERSISTABLE_RUNTIME_OPTIONS: ReadonlySet<string> = new Set([
  'rowData',
  'pinnedTopRowData',
  'pinnedBottomRowData',
  'context',
  'loading',
  'loadingMessage',
  'debug',
  'quickFilterText',
  'aggFuncs',
  'fillOperation',
  'getContextMenuItems',
  'processCellForClipboard',
  'processCellFromClipboard',
  'theme',
]);

/** Grid Layouts (Phase A / A3) — mint a stable, unique id for a new
 *  layout. Uses `crypto.randomUUID` where available (browser + modern
 *  Node), with a monotonic-counter fallback so tests / older runtimes
 *  still get collision-free ids. */
let layoutIdCounter = 0;
/** One-shot guard for the 2026-07 `groupDefaultExpanded` semantics-change
 *  warning (levels-open AG parity) — once per page load, not per grid. */
let warnedGroupDefaultExpandedMigration = false;
function generateLayoutId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `layout-${c.randomUUID()}`;
  return `layout-${++layoutIdCounter}-${Date.now().toString(36)}`;
}
export type {
  SettingsSection,
  SettingsBand,
  SettingsField,
  SettingsFieldType,
  SettingsSelectOption,
} from './types/settingsSchema';
// Cycle 21i Phase 2 / T4 — modal primitive. Instance via grid.getModal().
export { ModalHost } from './interaction/modalHost';
export type { ModalOpenOptions, ModalCloseReason } from './interaction/modalHost';
// Floating (draggable/resizable, non-modal) panel primitive. Instantiated
// internally as `this.floatingPanelHost`; exposed generically via
// `grid.openFloatingPanel`/`closeFloatingPanel`/`isFloatingPanelOpen`.
export { FloatingPanelHost } from './interaction/floatingPanel/host';
export type { FloatingRect } from './interaction/floatingPanel/host';
export type {
  SelectionConfig,
  SingleRowSelectionConfig,
  MultiRowSelectionConfig,
  CellSelectionConfig,
  RowCheckboxCallback,
} from './core/selectionConfig';
export type { ICellEditor, ICellEditorParams, CellEditorCtor } from './interaction/editors/iCellEditor';
// price32 — reference bond-price (32nds) editor + its parse/format helpers so
// hosts can format the display value to match the editor's notation.
export { Price32CellEditor, parsePrice32, formatPrice32 } from './interaction/editors/builtins/price32';

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
 * Exported as a top-level function so it can be unit-tested independently of VelocityGrid.
 *
 * Foundation cycle: only top-level single-property accessors are supported.
 * Nested paths like `row.meta.id` are rejected with a clear error — the RowStore
 * does a flat `row[rowIdField]` lookup so nested paths would silently corrupt IDs.
 */
export function inferRowIdField<T>(getRowId: (row: T) => string): string {
  const src = getRowId.toString();
  const matches = Array.from(src.matchAll(/\.(\w+)/g));
  if (matches.length === 0) {
    throw new Error('[velocity-grid] could not infer rowIdField from getRowId — Foundation cycle only supports `row => row.<field>` style');
  }
  if (matches.length > 1) {
    throw new Error('[velocity-grid] Foundation cycle only supports top-level `row => row.<field>` getRowId — nested accessors like `row.meta.id` are deferred to a follow-up cycle');
  }
  return matches[0]![1]!;
}

/** Cycle 7 / Task 7 — default `quickFilterParser`. Splits on runs of
 *  whitespace and drops empty terms so leading / trailing / interior
 *  whitespace never produces a phantom `''` term that matches every row.
 *  Apps override via `VelocityGridOptions.quickFilterParser`. */
function defaultQuickFilterParser(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
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

/** Cycle 26 (fling-scroll partials) — max CONTIGUOUS RUNS of damaged rows
 *  a window-diff will still resolve as partial damage before bailing to a
 *  full repaint.
 *
 *  This replaces the old `WINDOW_DIFF_MAX_ROWS = 24` ROW-count cap, which
 *  counted the wrong thing: during a scroll the newly-entered rows are one
 *  CONTIGUOUS run, and the damage ledger now coalesces contiguous rows
 *  into a single full-width band rect (`takeResolved`'s rows banding) —
 *  so 40 consecutive rows cost ONE rect, strictly cheaper than a full
 *  repaint. Capping rows made every fast-scroll chunk arrival degrade to
 *  full (PERF-NOTES: 44–52% full paints at fling pace) for damage that
 *  would have resolved to one or two bands.
 *
 *  Runs are what actually cost: each run is one pre-merge rect. 12 aligns
 *  with the ledger's own `DAMAGE_MAX_RECTS` post-merge cap — beyond that
 *  the resolution would degrade to full anyway, so bail early here (and
 *  keep the strip-store wipe semantics of the full path). */
const WINDOW_DIFF_MAX_RUNS = 12;

/** Count contiguous runs in a sorted ascending index array. */
function countRuns(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  let runs = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! !== sorted[i - 1]! + 1) runs++;
  }
  return runs;
}

/**
 * Closeout fix — C2 + adjudication B's MANDATED guard. Replaces the old
 * `sameWindow` check (which compared only `(rowStart, rowCount)` and so
 * could not tell a window MOVE apart from a REORDER at an overlapping —
 * or identical — window). Diffs the previous chunk's row identity
 * (rowId + rowKind + groupKey, positionally, shifted by the window delta)
 * against the new chunk to find exactly which on-screen positions now
 * show a DIFFERENT row than they did last paint — those need repainting
 * even though their WINDOW POSITION didn't change. Any per-row height
 * mismatch inside the overlap bails to `'full'` outright: a height change
 * shifts every row below it, which is a geometry invalidation the
 * position-diff can't reason about locally (spec's "ambiguous → full").
 *
 * Returns `'full'` when there's no previous chunk to diff against (first
 * chunk ever), when `chunk.touchedRows` is `undefined` (unknown whether
 * any VALUE changed at an identity-matched position — "unknown stays
 * full", never assume "nothing changed" from absence), when the viewport
 * COLUMN SET changed (column-group expand/collapse, setColumnsVisible,
 * column move — new colIds would otherwise stick as blank under a
 * defined-empty `touchedRows` live-feed reply), when a height
 * mismatch is found, or when the damage spans more than
 * `WINDOW_DIFF_MAX_RUNS` contiguous runs. Otherwise returns the sorted
 * array of window-relative
 * row indices (0-based, add `chunk.rowStart` for the global index) that
 * need repainting: positionally-mismatched rows, rows newly scrolled
 * into the window (outside the overlap — this also covers the
 * previously-blitted "exposed band" per spec §5's chunk-arrival
 * re-damage contract), and `touchedRows` (value changes at an
 * identity-matched position — e.g. a live tick that doesn't reorder).
 */
/** Inclusive end row index for a chunk's data window (`[rowStart, end)`). */
function chunkRowEnd(chunk: ViewportChunk): number {
  return chunk.rowStart + chunk.rowCount;
}

/** True when the chunk overlaps `[firstRow, lastRow]` (inclusive). */
function chunkIntersectsRowRange(
  chunk: ViewportChunk, firstRow: number, lastRow: number,
): boolean {
  if (lastRow < firstRow) return true;
  return chunk.rowStart <= lastRow && chunkRowEnd(chunk) > firstRow;
}

/** On-screen data row span (excludes `rowBuffer` / paint-cache overscan
 *  padding that widens `firstRow`/`lastRow` for the worker fetch). */
function onScreenDataRowRange(
  vs: { firstRow: number; lastRow: number; firstVisibleDataRow?: number },
): { first: number; last: number } | null {
  if (vs.lastRow < 0) return null;
  const firstVis = vs.firstVisibleDataRow ?? vs.firstRow;
  const pad = Math.max(0, firstVis - vs.firstRow);
  const lastVis = Math.max(firstVis, vs.lastRow - pad);
  return { first: firstVis, last: lastVis };
}

/** True when the chunk fully covers the on-screen data rows. */
function chunkCoversOnScreenRows(
  chunk: ViewportChunk, vs: { firstRow: number; lastRow: number; firstVisibleDataRow?: number },
): boolean {
  const range = onScreenDataRowRange(vs);
  if (!range) return true;
  return chunk.rowStart <= range.first && chunkRowEnd(chunk) > range.last;
}

function resolveWindowDamage(
  chunk: ViewportChunk,
  prevChunk: ViewportChunk | null,
): number[] | 'full' {
  if (!prevChunk) return 'full';
  if (chunk.touchedRows === undefined) return 'full';
  // Column-group expand / showColumns / etc. — row identity is unchanged
  // so touchedRows is often `[]` on a live blotter, but the chunk now
  // carries values for colIds the previous paint never had (or drops
  // ones that collapsed). Force full so those cells aren't left blank.
  if (viewportColumnSetChanged(prevChunk, chunk)) return 'full';
  const delta = chunk.rowStart - prevChunk.rowStart;
  const newCount = chunk.rowCount;
  const prevCount = prevChunk.rowCount;
  const overlapStart = Math.max(0, -delta);
  const overlapEnd = Math.min(newCount, prevCount - delta);
  const damaged = new Set<number>();
  for (let i = 0; i < newCount; i++) {
    if (i >= overlapStart && i < overlapEnd) {
      const j = i + delta;
      if (chunk.heights[i] !== prevChunk.heights[j]) return 'full';
      // rowIds alone is insufficient — group/footer rows share sentinel
      // ids, so identity also requires rowKind + groupKey agreement.
      const idMatch = chunk.rowIds[i] === prevChunk.rowIds[j]
        && chunk.rowKinds[i] === prevChunk.rowKinds[j]
        && (chunk.groupKey?.[i] ?? '') === (prevChunk.groupKey?.[j] ?? '');
      if (!idMatch) damaged.add(i);
    } else {
      damaged.add(i); // newly entered position — outside the overlap window
    }
  }
  for (const r of chunk.touchedRows) damaged.add(r);
  // Cap on contiguous RUNS, not rows — see WINDOW_DIFF_MAX_RUNS. The
  // sorted array is returned either way, so run counting is a single
  // linear pass over data we already produce.
  const sorted = Array.from(damaged).sort((a, b) => a - b);
  if (countRuns(sorted) > WINDOW_DIFF_MAX_RUNS) return 'full';
  return sorted;
}

/** True when the set of colIds present in numeric/text payload columns
 *  differs between two chunks (order-insensitive). */
function viewportColumnSetChanged(prev: ViewportChunk, next: ViewportChunk): boolean {
  const prevKeys = viewportChunkColIds(prev);
  const nextKeys = viewportChunkColIds(next);
  if (prevKeys.size !== nextKeys.size) return true;
  for (const id of prevKeys) {
    if (!nextKeys.has(id)) return true;
  }
  return false;
}

function viewportChunkColIds(chunk: ViewportChunk): Set<string> {
  const ids = new Set<string>();
  for (const id of Object.keys(chunk.numericCols)) ids.add(id);
  for (const id of Object.keys(chunk.textCols)) ids.add(id);
  return ids;
}

/** Usable rule/mirror field — blank chunk placeholders must not clobber. */
function isUsableRowField(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  return true;
}

/** Field-merge for SSRM hydrate / tick patches: skip null/undefined so
 *  thin Perspective payloads do not wipe previously hydrated fields. */
function mergeRowDataFields<TRow>(prev: TRow, row: TRow): TRow {
  const out: Record<string, unknown> = { ...(prev as object) as Record<string, unknown> };
  for (const [k, v] of Object.entries(row as object as Record<string, unknown>)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as TRow;
}

/** Mirror ⊕ snapshot for rule eval / getCellPaintedBg — mirror wins;
 *  snapshot only fills gaps with usable values. */
function mergeRuleRowForPaint(
  mirror: Record<string, unknown> | undefined,
  snapshot: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!mirror && !snapshot) return undefined;
  if (!mirror) return snapshot;
  if (!snapshot) return mirror;
  const out: Record<string, unknown> = { ...mirror };
  for (const [k, v] of Object.entries(snapshot)) {
    if (!isUsableRowField(v)) continue;
    if (!isUsableRowField(out[k])) out[k] = v;
  }
  return out;
}

/** Conflate deferred async transactions for scroll-end flush — last write
 *  wins per row id (matches worker `asyncTransactionConflate`). */
function mergeDeferredAsyncTransactions<TRow>(
  txs: Tx<TRow>[],
  getRowId: (row: TRow) => string | null,
): Tx<TRow> {
  const addById = new Map<string, TRow>();
  const updateById = new Map<string, TRow>();
  const removeById = new Map<string, TRow>();
  for (const t of txs) {
    if (t.add) {
      for (const row of t.add) {
        const id = getRowId(row);
        if (id === null) continue;
        removeById.delete(id);
        updateById.delete(id);
        addById.set(id, row);
      }
    }
    if (t.update) {
      for (const row of t.update) {
        const id = getRowId(row);
        if (id === null) continue;
        removeById.delete(id);
        if (addById.has(id)) addById.set(id, row);
        else updateById.set(id, row);
      }
    }
    if (t.remove) {
      for (const row of t.remove) {
        const id = getRowId(row);
        if (id === null) continue;
        addById.delete(id);
        updateById.delete(id);
        removeById.set(id, row);
      }
    }
  }
  const out: Tx<TRow> = {};
  if (addById.size > 0) out.add = Array.from(addById.values());
  if (updateById.size > 0) out.update = Array.from(updateById.values());
  if (removeById.size > 0) out.remove = Array.from(removeById.values());
  return out;
}

/** Closeout fix — C3: has any group/footer total or the grand-total
 *  changed since the previous chunk? Computed UNCONDITIONALLY (unlike the
 *  old code, which only ran this diff inside `enableCellChangeFlash` —
 *  the ONLY thing that routed changed totals into damage, so a
 *  flash-disabled grid never repainted a changed aggregate on the
 *  partial path). `changedGroupKeys` drives `repaintAggregateDamage`'s
 *  row lookup; `grandTotalChanged` drives its totals-band lookup. Absence
 *  of a previous totals record (first chunk with totals, or grouping/agg
 *  just activated) is NOT a change — there's no stale pixel to correct. */
function diffAggregates(
  chunk: ViewportChunk,
  prevGroupTotals: Record<string, Record<string, unknown>> | undefined,
  prevChunkTotals: Record<string, unknown> | undefined,
): { changedGroupKeys: Set<string>; grandTotalChanged: boolean } {
  const changedGroupKeys = new Set<string>();
  if (chunk.groupTotals && prevGroupTotals) {
    for (const groupKey of Object.keys(chunk.groupTotals)) {
      const oldRec = prevGroupTotals[groupKey];
      const newRec = chunk.groupTotals[groupKey]!;
      if (recordChanged(oldRec, newRec)) changedGroupKeys.add(groupKey);
    }
  }
  const grandTotalChanged = chunk.totals !== undefined && prevChunkTotals !== undefined
    && recordChanged(prevChunkTotals, chunk.totals);
  return { changedGroupKeys, grandTotalChanged };
}

/** Shallow value diff — `true` when any key in `newRec` differs from
 *  `oldRec` (or `oldRec` is absent, i.e. a brand-new group this chunk). */
function recordChanged(
  oldRec: Record<string, unknown> | undefined,
  newRec: Record<string, unknown>,
): boolean {
  if (!oldRec) return true;
  for (const k of Object.keys(newRec)) {
    if (oldRec[k] !== newRec[k]) return true;
  }
  return false;
}

/** Cycle 22 / Task 3 — value equality for the `columnLayout` setter's
 *  layoutEpoch guard. A repaint-poll re-measure reassigns a freshly-built
 *  but IDENTICAL layout every tick; comparing by value keeps those from
 *  wiping the Tier-2 strip store. O(columns), only runs while the strip
 *  store is live. */
function columnLayoutsEqual(a: ColumnLayout[], b: ColumnLayout[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (x.colId !== y.colId || x.left !== y.left || x.width !== y.width || x.pinned !== y.pinned) {
      return false;
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

/**
 * Theming Task 6/7 — resolve which mode (`'light'|'dark'`) a `CgTheme`
 * should compile against when it's applied (construction, `setTheme`
 * swap, or the `prefers-color-scheme` listener re-evaluating). Priority:
 *
 *  1. An explicit `data-vg-theme-mode="light"|"dark"` attribute on
 *     `probeHost` or any of its ancestors (`probeHost.closest(...)`) — an
 *     app-level override always wins over everything below.
 *  2. The theme's OWN declared background: `theme.compile('light')` is
 *     used purely as a probe (a `base`-layer `backgroundColor` applies to
 *     both modes identically, so probing with `'light'` is harmless) — if
 *     it declares `--vg-bg-color`, `isDarkColor` on that value decides.
 *     This lets a theme built with e.g. `themeQuartz.withParams({
 *     backgroundColor: '#111827' })` self-select dark without the app
 *     needing to say so explicitly.
 *  3. The OS `prefers-color-scheme` media query.
 *  4. Default `'light'`.
 *
 * `probeHost` is intentionally a parameter rather than always `this.root`:
 * at construction time `this.root` hasn't been appended into the app's
 * container yet, so an ancestor lookup from `this.root` would miss a
 * `data-vg-theme-mode` attribute the app set on (or above) that container.
 * Callers pass `container` at construction and `this.root` (already
 * attached by then) for every later swap.
 */
function pickThemeMode(probeHost: Element, theme: CgTheme): ThemeMode {
  const withAttr = probeHost.closest('[data-vg-theme-mode]');
  const attr = withAttr?.getAttribute('data-vg-theme-mode');
  if (attr === 'light' || attr === 'dark') return attr;

  const probeBg = theme.compile('light').vars['--vg-bg-color'];
  if (probeBg) return isDarkColor(probeBg) ? 'dark' : 'light';

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export class VelocityGrid<TRow = any> {
  private events = new TypedEventEmitter<VelocityGridEvent<TRow>>();
  /** Cycle 21i Phase 2 / T2 — named, versioned engine-state slices that
   *  fold into `GridState.modules` (see `core/moduleState.ts`). The
   *  kernel registers its own `columnGroups` slice at construction;
   *  engines (rules / calc / format / edit) register theirs via
   *  `registerStateModule`. `notifyChanged` fans a `moduleStateChanged`
   *  event into the stateUpdated bus so slices ride the persistState
   *  autosave with zero extra plumbing. */
  private moduleStateRegistry = new ModuleStateRegistry((moduleId) =>
    this.events.emit({ type: 'moduleStateChanged', moduleId }),
  );
  /** Cycle 23 / Task 7 — coalesced `stateUpdated` emitter. Subscribes
   *  to every state-affecting event on `this.events` and emits one
   *  `stateUpdated` per rAF tick carrying the full snapshot + the
   *  merged changedKeys. Lazily constructed in the constructor body
   *  so `this.getState()` is bound by the time it subscribes. */
  private stateUpdatedBus!: StateUpdatedBus;
  /** Cycle 21i / Phase 1 — restore-then-autosave persistence (gridId +
   *  persistState options). Null when persistence is not enabled. */
  private statePersistence: import('./core/statePersistence').StatePersistenceController | null = null;
  /** Cycle 21i / Phase 1 — runtime options touched via setGridOption /
   *  updateGridOptions (persistable keys only). Feeds the `gridOptions`
   *  slice of the GridState snapshot. */
  private runtimeTouchedOptions = new Map<string, unknown>();
  /** Grid Layouts (Phase A / A3) — construction-baseline value of each
   *  runtime option, captured lazily the first time the option is touched
   *  (before the mutation). Lets `applyLayoutSnapshot` reset options a
   *  target layout does not override back to baseline (spec §7), since
   *  kernel `setState` layers option keys additively rather than resetting. */
  private optionBaselines = new Map<string, unknown>();
  /** Grid Layouts (Phase A / A3) — the layouts registry + active id.
   *  Lazily built (see `getLayoutManager`) so the baseline captures the
   *  fully-constructed view (columns + `initialState`). */
  private layoutManager?: LayoutManager;
  /** Grid Layouts (Phase A / A3) — the injected host the LayoutManager
   *  drives: full-snapshot capture, reset-then-restore apply, id + clock. */
  private readonly layoutHost: LayoutManagerHost = {
    captureState: () => this.getState(),
    applyState: (snapshot) => this.applyLayoutSnapshot(snapshot),
    newId: () => generateLayoutId(),
    now: () => Date.now(),
  };
  /** Cycle 21i / Phase 1 — data-row index currently under the pointer
   *  (null when off any data row). Drives the row-hover highlight;
   *  forced null when `suppressRowHoverHighlight`. */
  private hoveredRowIndex: number | null = null;
  /** Damage-region rendering — accumulates semantic damage between paints.
   *  No `requestRepaint()` call site records damage yet (this task's
   *  invariant): the ledger stays empty and every paint resolves to full,
   *  so behavior is byte-identical to pre-damage-region rendering until a
   *  later task migrates a source to `repaintRows`/`repaintCells`. */
  private readonly damageLedger = new DamageLedger();
  /** Task 5 — scroll self-blit. Scroll position + DPR/bounds snapshot at
   *  the LAST PAINT (not the last scroll tick) — `afterScrollTick` diffs
   *  against these so deltas accumulate correctly across frames the fps
   *  gate skips, and updates them INSIDE the paint closure after every
   *  paint so a skipped frame's un-painted delta isn't dropped. Bounds/DPR
   *  start at sentinel values that never equal a real reading, so a scroll
   *  landing before the very first paint safely bails to full via
   *  `decideScrollDamage`'s `boundsChanged`/`dprChanged` inputs. */
  private lastPaintedScrollLeft = 0;
  private lastPaintedScrollTop = 0;
  private lastPaintedDpr = 0;
  private lastPaintedCanvasWidth = 0;
  private lastPaintedCanvasHeight = 0;
  /** Horizontal-scroll staleness fix (Cycle 22 closeout) — the
   *  `this.viewport.scrollLeft` the last executed paint ACTUALLY rendered.
   *  Distinct from `lastPaintedScrollLeft` above, which snapshots the
   *  MANAGER's live scroll position (for `afterScrollTick`'s delta
   *  bookkeeping) and runs AHEAD of what was painted while a horizontal
   *  scroll's fetch→chunk→`recomputeViewport` round-trip is still in
   *  flight: the rAF paint consumes the scroll's queued FULL damage
   *  against the not-yet-recomputed `this.viewport`, re-rendering the OLD
   *  scrollLeft — and once the chunk finally moves the viewport, a
   *  diff-armed reply (`touchedRows` defined) resolves to row-level
   *  damage only, so nothing ever re-rasters the surface at the NEW
   *  scrollLeft. Every later row-level repaint then lands at the new
   *  offset over a canvas painted at the old one — the per-row
   *  horizontal misalignment bug. `recomputeViewport` compares the fresh
   *  viewport against this and re-queues `repaintFull()` on mismatch.
   *  Vertical needs no equivalent: scroll dy is carried by the self-blit
   *  ('scroll' damage) and the chunk-side position-identity diff. */
  private lastPaintedViewportScrollLeft = 0;
  /**
   * Column-geometry / style-layout staleness — same class as
   * `lastPaintedViewportScrollLeft`. Resize, column move, and alignment
   * rebuild the live `columnLayout` (and bump strip epochs) but the
   * retained paint-cache layer can still hold pre-mutation row pixels.
   * Hybrid routing then paints a correct legacy FULL to the screen and
   * later present/partial frames re-blit the stale layer for undamaged
   * rows → per-row staggered cells until scroll. `layoutPaintEpoch`
   * advances on every geometry/style layout invalidation; only a
   * `damage.full` paint that actually ran may catch
   * `lastPaintedLayoutPaintEpoch` up. `recomputeViewport` re-queues
   * `repaintFull()` while they disagree.
   */
  private layoutPaintEpoch = 0;
  private lastPaintedLayoutPaintEpoch = -1;
  /** Task 5 — scroll position as of the LAST `afterScrollTick` (every tick,
   *  not just paints). `DamageLedger.add({kind:'scroll'})` accumulates via
   *  `+=` (same additive contract as `repaintRows`/`repaintCells` — each
   *  call contributes NEW damage on top of whatever's already queued), so
   *  the value pushed per tick must be the INCREMENT since the previous
   *  tick, not the cumulative delta since the last paint — multiple scroll
   *  ticks can land before the fps-gated paint fires (browsers don't
   *  guarantee one 'scroll' event per animation frame), and re-pushing the
   *  since-last-paint total on every one of them would double-count the
   *  overlap. `lastPaintedScrollTop` above stays reserved for the
   *  bail-decision inputs (bodyHeight/dpr/bounds), which DO want the true
   *  cumulative-since-paint magnitude. */
  private lastTickScrollTop = 0;
  /** Damage-region rendering — cumulative paint telemetry surfaced via
   *  `getPaintStats()`. Reset via `resetPaintStats()`. */
  private paintStats: PaintStats = {
    paints: 0, fullPaints: 0, partialPaints: 0, blits: 0,
    presents: 0, layerShifts: 0, layerResets: 0, layerRasterMs: 0,
    lastRects: 0, lastAreaPct: 100, avgPaintMs: 0, worstPaintMs: 0,
    layerSyncFills: 0, layerBacklogPx: 0,
    cellCacheHits: 0, cellCacheMisses: 0, cellCacheBypasses: 0,
    stripHits: 0, stripMisses: 0, stripMissesUncoverable: 0, stripCaptures: 0, stripPatches: 0,
    rasterCacheBytes: 0, rasterCachePooledBytes: 0,
  };
  private columnTree!: ColumnTree;
  /** Grid Layouts / column-group-drag feature (Task 1) — lazily-built
   *  leaf colId → ancestor groupId path (root→parent) map, derived by
   *  walking `columnTree.roots` once. `ResolvedColLeaf.groupPath` only
   *  lives on the heterogeneous `roots` tree, not on `leafById`
   *  (`Map<string, ResolvedColDef>`), so `getColGroupPath` needs this
   *  side map rather than a direct lookup. Invalidated (`null`) whenever
   *  `columnTree` is reassigned — the constructor, `rebuildColumns`, and
   *  the pivot engine's `setColumnTree` callback (all three
   *  `this.columnTree = …` sites). */
  private colGroupPathCache: Map<string, string[]> | null = null;
  private columnGroupState!: ColumnGroupState;
  private columnDefsMap: Map<string, ResolvedColDef<TRow>> = new Map();
  private columnOrder: ResolvedColDef<TRow>[] = [];
  private _columnLayout: ColumnLayout[] = [];
  /** Cycle 22 / Task 3 — layoutEpoch contract, column-geometry choke
   *  point. EVERY column width / order / visibility / pin change (and a
   *  canvas-width change that reflows flex columns) flows through a
   *  `this.columnLayout = …` assignment — the constructor, `setBounds`,
   *  `rebuildColumns`, `resizeColumn`, `sizeColumnsToFit`, `autoSize*`,
   *  `relayoutAfterColumnMutation`, the column-group open/close
   *  subscription, and the grouping/pivot engines' `setColumnLayout`
   *  deps. Funnelling the epoch bump through this ONE setter (with a
   *  value-equality guard so repaint-poll re-measures that resolve the
   *  identical layout never thrash the strip store) means no current or
   *  FUTURE column mutation can silently skip the bump. */
  private get columnLayout(): ColumnLayout[] { return this._columnLayout; }
  private set columnLayout(layout: ColumnLayout[]) {
    const changed = !columnLayoutsEqual(this._columnLayout, layout);
    if (this.rasterStrips !== null && changed) {
      this.stripLayoutEpochBump();
    }
    this._columnLayout = layout;
    // Absolute-x retained surfaces (paint-cache layer + layer-viewport
    // memo) embed the previous column lefts — wipe them on any geometry
    // change so a later present/partial cannot resurrect staggered cells.
    if (changed) this.invalidateRetainedPaintForColumnLayout();
  }
  private theme: ResolvedTheme;
  /** Theming Task 6/7 — the active programmatic `CgTheme`, when
   *  `options.theme` (or a `setTheme`/`setGridOption('theme', …)` swap) was
   *  given an object rather than a plain CSS class string. `undefined` for
   *  the (still 100%-backward-compatible) string/`undefined` theme path. */
  private themeObject: CgTheme | undefined;
  /** Theming Task 6/7 — the `--vg-*` KEYS the active `themeObject` injected
   *  onto `this.root` (via the low-level `themeParamsSet`, NOT
   *  `this.setThemeParams`). Tracked separately from user-set overrides
   *  (which share the same underlying inline-style/WeakMap state via
   *  `theming/themeParams.ts`) so `getThemeParams()` can report ONLY user
   *  edits, and a swap/mode-change can blank exactly the object's own vars
   *  without touching anything the app set through the public API. */
  private themeObjectVars: Set<string> = new Set();
  /** Theming Task 6/7 — the `<style>` element holding the active
   *  `themeObject`'s compiled `Part` CSS (`compile(mode).css`), when any is
   *  present. `null` when no active part contributes CSS. */
  private themeObjectStyleEl: HTMLStyleElement | null = null;
  /** Theming Task 6/7 — the live `prefers-color-scheme` query + its
   *  handler, installed only while an object theme is active AND no
   *  `data-vg-theme-mode` attribute overrides the mode. Not routed through
   *  `DisposableRegistry` (which has no per-item removal) because it must
   *  be torn down and reinstalled independently on every theme swap /
   *  `setThemeMode` call — a single `disposables.add` in the constructor
   *  covers final teardown at `destroy()`. */
  private themeModeQuery: MediaQueryList | null = null;
  private themeModeQueryHandler: ((e: MediaQueryListEvent) => void) | null = null;
  /** Cycle 19 / Task 2 — viewport subsystem: scroll state, the native
   *  scroll listener, `recompute` / `request` entry points, prefetch-range
   *  expansion, and the `setScroll` / `ensure*Visible` helpers. VelocityGrid keeps
   *  delegating wrappers (`recomputeViewport`, `requestViewport`,
   *  `setScroll`, `ensureRowIndexVisible`, `ensureColIdVisible`) so the
   *  50+ internal callsites still compile unchanged. The chunk-processing
   *  tail of `requestViewport` lives on VelocityGrid as `handleViewportChunk`
   *  until cycle 19 / task 3 lands `WorkerCoordinator`. */
  private viewportManager!: ViewportManager;
  /** Cycle 25 / Task 10 — LRU of recently-fetched chunks keyed by
   *  `${rowStart}:${rowEnd}:${cols}`. Holds entries via WeakRef so
   *  GC can reclaim before our eviction runs. `null` when the
   *  `memoryBudgetMB` option is unset / 0 (caching disabled). */
  private chunkLRU: ChunkLRU<ViewportChunk> | null = null;
  private rowCount = 0;
  /** SSRM controller — present only when `rowModelType === 'serverSide'`.
   *  v1 (flat block cache) or v2 (client-owned group skeleton) depending on
   *  the installed datasource's shape. */
  private ssrm: ServerSideRowModelController<TRow> | ServerSideRowModelV2Controller<TRow> | null = null;
  /** True when `ssrm` is the v2 skeleton controller. */
  private ssrmV2 = false;
  /** Perspective expression output aliases included in SSRM columnKeys. */
  private ssrmExpressionOutputIds: string[] = [];
  /** Client rules/alerts/format watched cols included in SSRM columnKeys. */
  private ssrmClientWatchedColIds: string[] = [];
  /** Optional Perspective ExprTK host (StompPerspectiveProvider) for SSRM calc. */
  private ssrmExpressionHost: SsrmExpressionHost | null = null;
  private ssrmColumnRefillTimer: ReturnType<typeof setTimeout> | null = null;
  /** Coalesce column-window refill while the user is still scrolling. */
  private pendingSsrmColumnRefill = false;
  /** Last columnKeys signature that actually triggered a band refill. */
  private lastSsrmColumnKeysSig = '';
  /**
   * Datasource installed via `setServerSideDatasource` before async init
   * mounts `this.ssrm`. Flushed after the construction-time placeholder
   * (if any) so a late hub bind is not overwritten by the empty default.
   */
  private pendingServerSideDatasource:
    | import('./types/ssrm').AnyServerSideDatasource<TRow>
    | null
    | undefined = undefined;
  /** Resolves when async init emits `gridReady` (SSRM mounted if applicable). */
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private readySettled = false;
  /**
   * Main-thread mirror of worker `ssrmClientPipeline`. When true, sort /
   * filter / group / pivot go through the CSRM worker path instead of
   * datasource refresh.
   */
  private ssrmClientPipeline = false;
  /** Serialise SSRM full-hydrate + pipeline toggles. */
  private ssrmPipelineChain: Promise<void> = Promise.resolve();
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

  private root: HTMLDivElement;
  /** Cycle 22 / Task 5 — non-null when the grid was constructed with
   *  `shadowRoot: true`. The constructor attaches the shadow root to
   *  the supplied container and mounts the grid's entire DOM inside
   *  it; the destroy path detaches the same root. */
  private shadowRoot: ShadowRoot | null = null;
  private scroller: HTMLDivElement;
  private sizer: HTMLDivElement;
  private cgridCanvas!: VelocityGridCanvas;
  private canvasBounds = { width: 0, height: 0 };
  /** DOM host shared with `EditController` (owner of the editor overlay +
   *  row-edit coordinator), floating-filter overlay, filter popup, context
   *  menu, and the column-drop insertion line. Created early (before
   *  StatusBarHost + SideBarHost, which reach in via `applyVerticalInsets`
   *  / `reserveSideBarSpace`) and handed into `EditController` when the
   *  edit subsystem gets wired up at construction step 9. */
  private editorContainer: HTMLDivElement;
  private cssReader: CssReader;
  private cellRenderers: CellRendererRegistry;
  private renderer: Renderer;
  private subgrids: Subgrid[] = [];
  private viewport!: ViewportState;
  /** Task 3 (paint-cache layer) — memoizes `buildLayerViewport`'s result.
   *  Keyed on the live `ViewportState` object reference (a fresh object
   *  every `recomputeViewport()` call, so identity alone detects "the real
   *  viewport changed since the last layer-viewport build" with no extra
   *  generation counter) plus the requested layer geometry. `null` until
   *  the first call. */
  private layerViewportCache: {
    vs: ViewportState;
    layerTop: number;
    layerHeight: number;
    layoutPaintEpoch: number;
    result: ViewportState;
  } | null = null;
  /** Task 4 (paint-cache layer) — the retained offscreen layer. `null`
   *  when `paintCache: false` at construction; (re)created by
   *  `resetPaintCacheLayer` on a runtime `paintCache` flip. Always check
   *  `paintCacheActive()` (which additionally gates on `options.paintCache`
   *  AND `.available`) rather than a bare non-null check — a layer whose
   *  offscreen-canvas construction failed (headless/unsupported
   *  environment) still gets an instance here, just an inert one. */
  private paintCacheLayer: PaintCacheLayer | null = null;
  /**
   * Hybrid routing — when true, `damage.full` frames paint via the legacy
   * path until the next non-full frame. Avoids paying offscreen+present
   * on continuous-scroll full streaks (no-GPU / software raster). Cleared
   * on the first partial/present-only frame so the layer can rebuild.
   */
  private paintCacheDeferLayer = false;
  /**
   * Column-resize drag is active. While true, every paint uses the legacy
   * path (no retained layer): mousemove width updates outrun full paints
   * under paint-cache, and presenting a warm layer mid-drag mixes rows
   * rastered at different widths → staircase cells. Also coalesces layout
   * + repaint to one rAF so we don't pay invalidate/full per pointer event.
   */
  private columnResizeDragActive = false;
  /** Pending rAF handle for coalesced resize layout/paint; 0 when idle. */
  private columnResizeFlushRaf = 0;
  /** ColId last touched by `resizeColumn` — emitted on the coalesced flush. */
  private columnResizeFlushColId: string | null = null;
  /** Task 4 — `true` once the layer holds a geometry `planLayer` can
   *  legitimately `'keep'`/`'shift'` against. `false` forces `planLayer`'s
   *  `current: null` branch (an unconditional `'reset'`) on the NEXT
   *  paint — set on every reset trigger this task is responsible for
   *  (`resetPaintCacheLayer`'s option flip, and implicitly whenever this
   *  paint's resolved damage is `full` — see the paint closure) so a
   *  theme/resize/dpr/horizontal-scroll change (all of which already force
   *  `damage.full` via the pre-existing damage system) never lets a stale
   *  layer `'keep'`/`'shift'` through. */
  private paintCacheLayerAnchored = false;
  /** Cycle 22 / Task 2 — the ONE byte budget shared by BOTH raster-cache
   *  tiers (cross-tier LRU: a cell-bitmap charge can evict a row strip
   *  and vice versa). Sized from `rasterCacheBudgetMB` (default 48).
   *  `null` when `rasterCache: false`. */
  private rasterBudget: RasterBudget | null = null;
  /** Cycle 22 / Task 2 — Tier-1 content-keyed cell-bitmap store, consumed
   *  at the byRows cell-paint seam via `getRasterCellsCtx()`. `null` when
   *  `rasterCache: false`; an instance whose canvas construction failed
   *  stays non-null but `available === false` (the ctx getter gates). */
  private rasterCells: CellBitmapCache | null = null;
  /** Cycle 22 / Task 2 — Tier-2 row-strip store. Constructed here (same
   *  shared budget, same lifecycle/epoch wiring) even though its CONSUME
   *  path (the paint-cache layer's band raster) lands in Task 3. */
  private rasterStrips: RowStripCache | null = null;
  /** Cycle 22 / Task 2 — the dpr the cell bitmaps were last rasterized
   *  at. A change is an epoch bump (old backing stores are sized at the
   *  old dpr — blitting them would scale/blur). `0` = not yet observed. */
  private rasterCellsDpr = 0;
  /** Cycle 22 / Task 3 — per-row content version for the Tier-2 strip
   *  store, keyed by string rowId. Bumped in the SAME code paths that
   *  record `cells`/`rows` damage plus on any row-level data apply (chunk
   *  arrival window-diff rows), so a strip captured at version N can never
   *  be consumed after the row's pixels changed. Rows never damaged sit at
   *  the implicit version 0. Cleared on the unknown-diff chunk wipe and on
   *  a `rasterCache` runtime flip. Zero bookkeeping when `rasterStrips` is
   *  null. */
  private rowVersionByRowId = new Map<string, number>();
  /** Cycle 22 / Task 3 — monotonic layout epoch for the Tier-2 strip
   *  store. Every bump site is annotated "layoutEpoch contract" at the
   *  call site: column width/order/visibility/pin (the `columnLayout`
   *  setter), column-group open/close, theme + dpr
   *  (`rasterCacheEpochBump`), canvas width (`setBounds`), horizontal
   *  scroll (`getRasterStripsCtx`), quick-filter term change
   *  (`applyQuickFilter`), sort change (`setSortModel`), and def-level
   *  rule/format/renderer changes (`rebuildColumns`). */
  private stripLayoutEpoch = 0;
  /** Cycle 22 / Task 3 — the scrollLeft the current strip epoch is valid
   *  for (strips are absolute-x device-px row snapshots). */
  private stripScrollLeft = 0;
  /** Cycle 22 / Task 3 — memoized `RasterStripsCtx` (the closures are
   *  stable; only `dpr`/`stats` re-point per read). */
  private stripsCtxMemo: RasterStripsCtx | null = null;
  private selection: SelectionModel;
  private hitTester: HitTester;
  private featureChain: FeatureChain;
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
   *  any `VelocityGridOptions.components` overrides so apps can replace the
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
   *  any `VelocityGridOptions.components` overrides so apps can replace the
   *  built-ins or add custom keys that `StatusBarDef.statusPanels`
   *  entries reference via `statusPanel`. The status bar host reads
   *  this registry to instantiate panels on demand. */
  private statusPanelRegistry: StatusPanelRegistry;
  /** Cycle 21i Phase 2 / T4 — generic modal primitive (backdrop +
   *  centered dialog on the grid root). Lazily constructed on first
   *  `getModal()` — grids that never open a dialog pay nothing. */
  private modalHost: ModalHost | null = null;
  /** Generic floating (draggable/resizable, non-modal) panel primitive —
   *  see `openFloatingPanel`/`closeFloatingPanel`/`isFloatingPanelOpen`.
   *  Lazily constructed on first open; grids that never open one pay
   *  nothing. Hosts content that has nowhere to dock back to (e.g. the
   *  Column Groups per-group Style editor, invoked from a group row's
   *  gear icon). */
  private floatingPanelHost: FloatingPanelHost | null = null;
  /** Last known position/size of the floating panel, so a later open
   *  reopens where the user left it. NOT auto-restored to an open float
   *  on load — only the rect is remembered; the float itself never
   *  auto-reopens. */
  private popoutRect: FloatingRect | undefined = undefined;
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
  /** Cycle 25 / Task 7 wiring — paint-frame flash alpha mask built once
   *  per paint from `buildFlashAlphaMask`. Indexed
   *  `localRow × colCount + colIndex`; `cellAt` reads from this instead
   *  of calling `registry.getAlpha` per cell when the mask is warm. */
  private flashAlphaMask: Float32Array | null = null;
  private flashAlphaMaskColIds: string[] = [];
  private flashAlphaMaskColIndex = new Map<string, number>();
  private flashAlphaMaskOut: Float32Array | undefined;
  /** Cycle 21e / Task 13 — per-call flashCells overrides awaiting the
   *  next mask ingest. Keyed `${stringRowId}\0${colId}`; the
   *  `\0*` colId wildcard covers "all columns" calls. `expiresAt`
   *  bounds staleness (worker round-trip grace included); swept in the
   *  flash tick loop + lazily on each flashCells call. */
  private flashOverrides = new Map<string, import('./core/flashRegistry').FlashOverride & { expiresAt: number }>();
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
  /** Cycle 19 / Task 4 — owns the cell-edit subsystem: editorContainer DOM
   *  host, EditorOverlay + RowEditCoordinator + CellEditorRegistry, the
   *  capture-phase keydown matrix, the Excel-mode mousedown flip, and the
   *  `activeEdit` lifecycle state. VelocityGrid routes the open/stop/sync/register
   *  primitives through this surface. */
  private editController!: EditController<TRow>;
  private a11y: A11yOverlay;
  /** Busy overlay driven by `options.loading`. */
  private loadingOverlay: LoadingOverlay;
  /** Cycle 19 / Task 3 — owns the WorkerClient + its handler wiring +
   *  the viewport-fetch dispatch ViewportManager forwards into. VelocityGrid
   *  routes every worker call through this surface; the chunk-reply
   *  main-side mutation lives in `handleViewportChunk` (delivered via
   *  the `onViewportChunk` dep below). */
  private workerCoord: WorkerCoordinator;
  /** Cycle 19 / Task 3 — back-compat shim. A long tail of integration
   *  tests reach into `(grid as any).workerClient` to read the underlying
   *  `WorkerClient` (FakeWorker access, `vi.spyOn` of a worker method, a
   *  direct `getRowByIndex` round-trip). The real owner is now
   *  `workerCoord`; this getter keeps every existing `(grid as any).workerClient.*`
   *  access pattern resolving without touching the test suite. */
  private get workerClient(): import('./worker/client').WorkerClient {
    return this.workerCoord.workerClient;
  }
  private destroyed = false;
  /** Centralized teardown for every listener / RAF / timer the grid installs.
   *  Use `this.disposables.addListener` / `addRaf` / `addTimeout` instead of
   *  raw `addEventListener` / RAF / setTimeout so destroy() never misses one. */
  private disposables = new DisposableRegistry();
  /** Cycle 10 / Task 6 — methods that have already emitted a one-time
   *  warn after being gated by `suppressClipboardApi`. Keeps the
   *  console quiet for apps that repeatedly hit a suppressed entry
   *  point (e.g. a Ctrl+C polling loop) while still surfacing the
   *  first invocation so developers notice the gate. */
  private clipboardSuppressedWarned = new Set<string>();
  private selectionUnsubscribe: () => void = () => {};
  /** Cycle 21d / Task 9 — unsubscribe from the registered calc provider's
   *  onColumnsChanged; re-registration replaces it (previous unsub called
   *  first), destroy() releases it. Module-level slot itself is NOT
   *  cleared on destroy, matching the format/rule slots. */
  private calcProviderUnsub: (() => void) | null = null;
  private sortModel: SortModel = [];
  /** Cycle 19 / Task 5-ColState — column-state round-trip. Owns
   *  `initialColumnStateSnapshot` + `getColumnState` + `applyColumnState`
   *  + `resetColumnState` + `applyColumnStateInternal` +
   *  `applyRoleStateFromColumnState`. Late-initialised in the ctor so
   *  the deps closures resolve after VelocityGrid's own fields come online. */
  private colStateManager!: ColumnStateManager<TRow>;
  /** Last bounds we emitted `gridSizeChanged` for. `null` until the initial
   *  setBounds lands — that first call records but does not emit, so external
   *  listeners only see real post-mount size changes. */
  private lastEmittedBounds: { width: number; height: number } | null = null;
  /** Latches `firstDataRendered` to exactly once per grid instance. */
  private firstDataFired = false;
  /** Cycle 9 / Task 7 — snapshot of the range set as it stood at the last
   *  `cellSelectionChanged` emission. Used to debounce: a finished
   *  rangeSelectionChanged that lands on the same set as before skips
   *  the cellSelectionChanged fan-out. Deep-cloned on store so a later
   *  in-place mutation can't false-equal. */
  private lastEmittedCellSelectionRanges: SelectionRange[] = [];
  /** Cycle 19 / Task 5-Grouping — grouping subsystem. Owns the current
   *  `GroupModel` + the canonical `GroupingState` primitive the three
   *  grouping UIs subscribe to + the synthesized `autoGroupColumns` +
   *  the `groupRowStripCtx` the body painter reads. Every imperative
   *  grouping API method on VelocityGrid delegates here; the state-change
   *  side effects (public event emission, worker round-trip, panel host
   *  fan-out, expansion mirror reset, auto-hide-on-group / restore-on-
   *  ungroup) all live inside the coordinator. Late-initialised in the
   *  constructor so the deps closures resolve after VelocityGrid's own fields
   *  come online. */
  private grouping!: GroupingCoordinator<TRow>;
  /** Cycle 19 / Task 5a — pivot subsystem. Owns the canonical PivotState
   *  (pivotMode + pivotColumns + valueColumns) + the pivot-active flag
   *  + the saved primary column tree + the `cellSpecById` reverse index
   *  the body cell reader uses to address `chunk.pivotValues`. Every
   *  imperative pivot API method on VelocityGrid delegates here; the state-
   *  change side effects (public event emission, worker round-trip,
   *  panel host fan-out, column tree swap) all live inside the engine.
   *  Late-initialised in the constructor after `workerCoord` +
   *  `pivotPanel` come online. */
  private pivotEngine!: PivotEngine<TRow>;
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
  /** Stashed `expandedRouteIds` from `setState` / persist restore.
   *  Applied after the worker `setGroupModel` reply lands — applying
   *  during `setState` is a no-op when grouping hasn't materialised
   *  yet (and a later `setGroupModel` would wipe it). `null` = none
   *  pending; array (possibly empty) = restore this exact open set. */
  private pendingExpandedRouteIds: string[] | null = null;
  /**
   * Deferred column-group overlay from `setState` / persist restore.
   * Rehydrating against placeholder / incomplete `columnDefs` (common in
   * STOMP demos that boot with one leaf then swap in the real catalog)
   * would prune groups and let autosave persist the destruction. We keep
   * the overlay here and re-apply in {@link flushPendingColumnGroups}
   * whenever a later flat `columnDefs` catalog arrives.
   */
  private pendingColumnGroupDefs: SerializedNode[] | null = null;
  /** Re-entrancy guard for {@link flushPendingColumnGroups}. */
  private applyingPendingColumnGroups = false;
  /** Cycle 15 / Task 8 — `groupKey → descendant leaf rowIds` map
   *  populated from every `groupKeysSnapshot` reply when the worker's
   *  descendant emission is on. Backs the `GroupMembershipResolver`
   *  the SelectionModel calls to cascade selection + recompute
   *  tri-state. Empty when grouping bypasses OR when
   *  `groupSelectsChildren` is off. */
  private groupDescendantsByKey: Map<string, readonly string[]> = new Map();

  constructor(container: HTMLElement, private options: VelocityGridOptions<TRow>) {
    if (!options.getRowId) throw new Error('[velocity-grid] options.getRowId is required');
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    // No-GPU / software-raster profile — resolve `qualityMode` + auto
    // paintCache policy before any layer construction. Explicit
    // `paintCache: true|false` always wins (see paintQuality.ts).
    applyPaintQualityDefaults(options);
    if (options.rowHeight != null) {
      options.rowHeight = clampRowHeight(options.rowHeight);
    }

    // Cycle 25 / Task 10 — memory-pressure release. Holds recent
    // chunks via WeakRef so V8/JSC can collect them ahead of our
    // explicit eviction. `memoryBudgetMB` 0/undefined disables the
    // cache entirely.
    if (options.memoryBudgetMB && options.memoryBudgetMB > 0) {
      this.chunkLRU = new ChunkLRU<ViewportChunk>(options.memoryBudgetMB * 1024 * 1024);
    }

    // 1. DOM scaffold — scroller (with sized sizer child) provides native scrollbars;
    // the canvas (created later by VelocityGridCanvas) overlays the scroller's content area
    // but is sized to scroller.clientWidth/Height so the scrollbar strips remain
    // interactive.
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
    // Cycle 22 / Task 2 — `vg-grid` is the stable marker class for the
    // grid root. Density modes, print mode, and any future host-level
    // chrome layer their own class alongside it; the theme class then
    // contributes the token bundle.
    this.root.classList.add('vg-grid');
    // Theming Task 6/7 — `applyThemeOption` MUST run before the first
    // `CssReader.read()` below (step 2) so the initial `ResolvedTheme`
    // picks up any object-theme's injected `--vg-*` vars. `container` (not
    // `this.root`) is the probe host for `data-vg-theme-mode` lookup: at
    // this point `this.root` hasn't been appended into `container` yet
    // (that happens further down), so `this.root.closest(...)` couldn't see
    // an ancestor attribute — `container` is already wherever the app put
    // it, so it can.
    this.applyThemeOption(options.theme, container);
    // Theming Task 6/7 — final teardown of the OS `prefers-color-scheme`
    // listener (if any is ever installed) at grid destroy. Registered once
    // here; `refreshThemeModeListener` swaps the listener in place on every
    // theme change without touching this registration.
    this.disposables.add(() => this.teardownThemeModeListener());
    // Cycle 22 / Task 2 — density class on the root. Applied here so
    // `--vg-row-height` / `--vg-header-height` / `--vg-cell-padding-x`
    // resolve to the density-bundle's overrides before the first
    // `cssReader.read()`.
    if (options.density) {
      this.root.classList.add(`vg-density-${options.density}`);
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
      styleEl.className = 'vg-shadow-tokens';
      // Vite's `?inline` resolves to the compiled CSS at build time
      // (production); the test runtime returns an empty string, which
      // is fine — the test environment doesn't exercise visual paint,
      // and apps in shadow-root mode that need additional rules layer
      // them via `setThemeParams` or a sibling `<style>` element.
      styleEl.textContent = tokensCssInline;
      this.shadowRoot.appendChild(styleEl);
    }

    this.scroller = document.createElement('div');
    this.scroller.className = 'vg-scroller vg-scrollbar';
    // overflow:auto — tracks hide when content fits. The themed
    // `::-webkit-scrollbar` rules in tokens.css force a visible 8px thumb
    // on Chromium/WebKit (macOS overlay scrollbars otherwise vanish when idle).
    this.scroller.style.cssText = 'position:absolute; inset:0; overflow:auto;';
    this.sizer = document.createElement('div');
    this.sizer.className = 'vg-sizer';
    this.sizer.style.cssText = 'width:1px; height:1px; pointer-events:none;';
    this.scroller.appendChild(this.sizer);

    // Cycle 19 / Task 4 — editorContainer is created here (not inside
    // `EditController`) because StatusBarHost + SideBarHost (constructed
    // downstream at steps 6-8) reach in via `applyVerticalInsets` /
    // `reserveSideBarSpace` before EditController comes online at step 9.
    // The controller takes the pre-existing container as a construction
    // dep so ownership of the mousedown listener + tear-down still moves.
    this.editorContainer = document.createElement('div');
    this.editorContainer.style.cssText = 'position:absolute; left:0; top:0; right:0; bottom:0; pointer-events:none;';
    // Children of editorContainer set pointer-events:auto themselves.
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
    // Cycle 22 / Task 2 — `cacheable: true` opts a built-in into the
    // Tier-1 cell-bitmap cache. Set ONLY where every `config.` read the
    // painter makes is (a) a `cellStyleSignature` covered field, (b) a
    // theme-scoped field that rides the epoch (`checkboxCheckedBg/Fg`,
    // `emptyFg` — see cellCache.ts's module doc), or (c) a field whose
    // presence already forces a seam bypass (`flashAlpha`, `content`,
    // `decorators`, `params`, `pivotGroupExpand`). Audited per renderer:
    //   text / number / checkbox / header / text-wrap / totals /
    //   rowSelectCheckbox → all reads covered → cacheable.
    //   group / groupFooter → read a `GroupCellValue` PAYLOAD object off
    //     `p.value` (depth / isExpanded / childCount / selectionState /
    //     payload.valueFormatted) — `String(value)` is '[object Object]',
    //     so the key can't see the pixels → NOT cacheable.
    //   sparkline → `p.value` may be an arbitrary object shape and the
    //     variant painters read `p.params` + `p.palette` → NOT cacheable.
    //   composite → binding Task-1 carry-forward: pixels depend on
    //     `compositeProgram` + `rowData` reads OUTSIDE the signature →
    //     NOT cacheable.
    this.cellRenderers.register('text', textCell, { cacheable: true });
    this.cellRenderers.register('number', numberCell, { cacheable: true });
    this.cellRenderers.register('checkbox', checkboxCell, { cacheable: true });
    this.cellRenderers.register('header', headerCell, { cacheable: true });
    this.cellRenderers.register('text-wrap', wrapTextCell, { cacheable: true });
    this.cellRenderers.register('totals', totalsCell, { cacheable: true });
    this.cellRenderers.register('group', groupCell);
    this.cellRenderers.register('groupFooter', groupFooterCell);
    // Cycle 21 / Task 1 — canvas-painted sparkline (line variant; Task 2
    // plugs the column / area / bar / pie sibling painters through the
    // same registered name via `cellRendererParams.sparkline.type`).
    this.cellRenderers.register('sparkline', sparklineCell);
    // Per-row checkbox renderer — forced as the cellRenderer for any
    // column declaring `checkboxSelection: true`. Reads `p.isSelected`
    // for state (NOT row data); a chain feature claims the click.
    this.cellRenderers.register('rowSelectCheckbox', rowSelectCheckboxCell, { cacheable: true });
    // Cycle 21c / Task 13 — composite fragment renderer. Only reached
    // when a `type: 'composite'` ColDef compiled successfully via the
    // injected format compiler (see propertyChain.compileFormatSlots).
    this.cellRenderers.register('composite', compositeCell);

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
    // Cycle 21i / Phase 1 — native Grid Options settings tab.
    this.toolPanelRegistry.register('agGridOptionsToolPanel', GridOptionsToolPanel);
    // Cycle 21i — native Column Groups editor tab.
    this.toolPanelRegistry.register('agColumnGroupsToolPanel', ColumnGroupsToolPanel);
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
    applyResolvedSelectionToOptions(
      options,
      resolveSelection<TRow>(options.selection),
    )
    // Cycle 21d / Task 9 — fold registered calc provider output (synthesized
    // calc columns + override/template patches) into the def array before
    // tree resolution. No provider → same-reference pass-through.
    this.columnTree = resolveColumnTree(foldCalcColumnDefs<CColDef<TRow> | CColGroupDef<TRow>>(options.columnDefs), options.defaultColDef, options.columnTypes);
    this.columnDefsMap = this.columnTree.leafById as Map<string, ResolvedColDef<TRow>>;
    this.colGroupPathCache = null;
    this.columnGroupState = new ColumnGroupState(this.columnTree);
    // Cycle 21i Phase 2 / T2 — the kernel's own column-groups slice rides
    // the module-state registry (formerly the dedicated columnGroupDefs /
    // columnGroupOpen GridState fields; the v3→v4 snapshot migrator
    // relocates legacy snapshots into this envelope). `get()` omits the
    // slice when the grid has no groups AND never had any (a flat grid
    // persists nothing, keeping snapshots compact) — but a grid whose
    // AUTHORED defs carry groups persists even a FLAT overlay, so
    // "user removed every group" survives a reload instead of the
    // constructor's grouped defs resurrecting (and re-inflating the
    // header band; user report 2026-07-04). `set()` reuses the exact
    // rehydrate → updateGridOptions path the Column Groups panel's
    // Apply uses, then layers the runtime open/collapse state on top
    // (open state applies AFTER the tree rebuild so a user's collapse
    // wins over `openByDefault`).
    // Sticky: flips true the first time ANY snapshot sees groups —
    // covers grids whose grouped defs arrive AFTER construction via
    // updateGridOptions (a pattern the repo's own apps use). Without
    // it, "user removed every group" wouldn't persist for those grids
    // and the authored groups would resurrect on reload.
    let everHadGroups = flattenColumnGroups(options.columnDefs ?? [])
      .some((n) => n.kind === 'group');
    // Serialization cache keyed by the columnDefs array REFERENCE:
    // snapshots run once per coalesced stateUpdated rAF flush (resize /
    // range-select drags feed the bus per frame), while the defs array
    // only changes identity through the updateGridOptions swap path —
    // re-walking the whole column tree per frame is pure GC pressure.
    let defsCacheKey: unknown = null;
    let defsCache: SerializedNode[] = [];
    this.moduleStateRegistry.register({
      id: 'columnGroups',
      version: 1,
      get: () => {
        // Prefer the deferred restore overlay while leaf coverage is still
        // incomplete — otherwise a placeholder rehydrate would autosave a
        // pruned tree and permanently lose the user's groups.
        if (this.pendingColumnGroupDefs) {
          const defs = this.pendingColumnGroupDefs;
          everHadGroups ||= defs.some((n) => n.kind === 'group');
          const open = this.columnGroupState.getState();
          return open.length > 0 ? { defs, open } : { defs };
        }
        const currentDefs = this.options.columnDefs ?? [];
        if (currentDefs !== defsCacheKey) {
          defsCacheKey = currentDefs;
          defsCache = toSerializedColumnGroupNodes(flattenColumnGroups(currentDefs));
        }
        const defs = defsCache;
        const hasGroups = defs.some((n) => n.kind === 'group');
        everHadGroups ||= hasGroups;
        if (!hasGroups && !everHadGroups) return undefined;
        const open = this.columnGroupState.getState();
        return open.length > 0 ? { defs, open } : { defs };
      },
      set: (data) => {
        const slice = data as { defs?: SerializedNode[]; open?: { groupId: string; open: boolean }[] };
        if (slice?.defs) {
          this.pendingColumnGroupDefs = slice.defs;
          this.flushPendingColumnGroups();
        }
        if (slice?.open) {
          this.columnGroupState.apply(slice.open);
        }
      },
    });
    // Cycle 19 / Task 5-Grouping — grouping coordinator. Constructed
    // BEFORE `computeVisibleColumnOrder()` at construction because that
    // method reads `this.grouping.getAutoGroupColumns()` synchronously.
    // Seeded with empty rowGroupCols; the ctor is inert (no state-change
    // callbacks fire from the initial-seed values). The deps' worker /
    // panel / pivot-engine closures resolve lazily to whatever holds
    // `this.workerCoord` / `this.rowGroupPanel` / `this.pivotEngine`
    // at call-time.
    this.grouping = new GroupingCoordinator<TRow>(
      this.makeGroupingCoordinatorDeps(),
      { rowGroupCols: [] },
    );
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
    // VelocityGridCanvas constructor below (via the setBounds callback), but
    // recomputeViewport needs an initial layout so it doesn't crash on undefined.
    this.columnLayout = resolveColumnWidths(this.columnOrder, this.scroller.clientWidth || 800);
    // Cycle 19 / Task 2 — viewport subsystem. Constructed BEFORE the first
    // recompute so `recomputeViewport()` and `requestViewport()` can delegate
    // immediately. The scroller listener is registered inside the constructor
    // (routed through `disposables` so destroy tears it down).
    this.viewportManager = new ViewportManager({
      disposables: this.disposables,
      events: this.events,
      scroller: this.scroller,
      sizer: this.sizer,
      root: this.root,
      getColumnLayout: () => this.columnLayout,
      getSubgrids: () => this.subgrids,
      getCanvasBounds: () => this.canvasBounds,
      getOptions: () => this.options,
      getRowHeightFallback: () => this.options.rowHeight ?? this.theme.rowHeight,
      getRowHeightIndex: () => this.rowHeightIndex,
      afterRecompute: (vp) => {
        // Cycle 7 / Task 1 — re-pin the floating-filter `<input>` pool after
        // every layout pass. Guarded because `recompute()` runs once in the
        // constructor before `floatingFilterOverlay` is assigned.
        if (this.floatingFilterOverlay) this.floatingFilterOverlay.repositionAll(vp);
      },
      afterScrollTick: () => {
        // Scroll paint policy (Deephaven-aligned — iris-grid / @deephaven/grid):
        //   • Always paint at the LIVE scroll position every tick. Never
        //     freeze/hold content while the scrollbar moves — that kills
        //     smooth scrolling. Missing cells paint empty until the chunk
        //     lands (ViewportDataGridModel returns '' for out-of-window).
        //   • Retained layer warm + not hybrid-deferred → scroll damage
        //     feeds present-only frames (layer shift + edge fill) — our
        //     GPU enhancement over Deephaven's always-full redraw.
        //   • Otherwise → FULL viewport redraw (Hypergrid / Deephaven lean
        //     path; `qualityMode: 'performance'` lands here). Never legacy
        //     canvas self-blit (overlapping drawImage tears mid-body rows).
        //   • Data lag is absorbed by a ~1-page buffer + throttled
        //     latest-wins viewport fetches (see ViewportManager.request /
        //     paintCacheOverscan), not by skipping paints.
        const curLeft = this.viewportManager.scrollLeft;
        const curTop = this.viewportManager.scrollTop;
        const live = this.viewportManager.state;
        const dx = curLeft - this.lastPaintedScrollLeft;
        const dy = curTop - this.lastPaintedScrollTop;
        const layerScrollOk = this.paintCacheActive()
          && this.paintCacheLayerAnchored
          && !this.paintCacheDeferLayer;
        if (!layerScrollOk) {
          // Sync metrics now (Deephaven paints from live view metrics);
          // uncovered rows stay empty until the chunk arrives.
          this.viewport = live;
          this.damageLedger.add({ kind: 'full' });
          this.lastTickScrollTop = curTop;
          this.cgridCanvas.requestRepaint();
          this.editController.syncOpenEditorPosition();
          return;
        }
        // Task 5 — scroll self-blit decision for the retained-layer path.
        // Reads the freshest scroll position off `ViewportManager` (not
        // `this.viewport`, which can lag a tick behind a native scroll
        // event until the async chunk round-trip re-syncs it). Phase B
        // scope is vertical-only: any horizontal component (dx !== 0)
        // bails to full inside `decideScrollDamage`. Pinned rows / totals
        // bands: the resolver already redamages the sticky band on scroll
        // AND (Task 5) unconditionally pushes every `pinnedBandRects`
        // rect whenever `blit !== null` — see `DamageLedger.takeResolved`.
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const decision = decideScrollDamage({
          dx,
          dy,
          bodyHeight: live.bodyHeight,
          dprChanged: dpr !== this.lastPaintedDpr,
          boundsChanged: this.canvasBounds.width !== this.lastPaintedCanvasWidth
            || this.canvasBounds.height !== this.lastPaintedCanvasHeight,
          dpr,
        });
        if (decision.kind === 'full') {
          // Large jump: re-anchor the layer at the live scrollTop instead
          // of hybrid-deferring into the lean path for the rest of a
          // thumb-drag gesture (which would full-paint empty cells while
          // the chunk catches up).
          this.viewport = live;
          this.paintCacheLayerAnchored = false;
          this.damageLedger.add(decision);
        } else {
          // Push the INCREMENT since the last TICK (not `decision.dy`, the
          // cumulative-since-last-PAINT total decideScrollDamage validated
          // against bodyHeight) — see `lastTickScrollTop`'s doc comment.
          // `DamageLedger.add` sums 'scroll' entries via `+=`, so pushing
          // the running total on every tick of a multi-tick un-painted
          // window would double-count the overlap.
          this.damageLedger.add({ kind: 'scroll', dy: curTop - this.lastTickScrollTop });
        }
        this.lastTickScrollTop = curTop;
        this.cgridCanvas.requestRepaint();
        this.editController.syncOpenEditorPosition();
      },
      isDestroyed: () => this.destroyed,
      // Cycle 19 / Task 3 — viewport-fetch + chunk-reply both go through the
      // coordinator now. The chunk arrival side-effects (column sync,
      // flash, height index, recompute, events, firstDataRendered latch)
      // live in `handleViewportChunk` and are reached via the coord's
      // `onViewportChunk` dep.
      dispatchViewportRequest: async (opts) => {
        if (this.ssrm) {
          await this.ssrm.ensureRange(opts.rowStart, opts.rowEnd);
          if (this.destroyed) return;
        }
        await this.workerCoord.dispatchViewportRequest(opts);
      },
    });
    this.recomputeViewport();

    // 5. Selection
    this.selection = new SelectionModel(options.rowSelection ?? 'none');
    // Cycle 21i / Phase 1 — let UI-driven selection record row IDs so it
    // survives `modelUpdated` (live transactions fire it constantly). The
    // resolver maps a visible row index → its string rowId from the chunk.
    //
    // REAL ids only — never `rowIdAt`, whose `row-<n>` synthetic fallback
    // exists for flash/registry contracts. A synthetic id recorded as
    // persistent focus identity is unresolvable by the worker: the next
    // `modelUpdated` rebuild got -1 back, nulled the focus, and the next
    // arrow press navigated from `fr ?? 1` → row 0 — teleporting the
    // viewport to the top the moment focus had landed on a row outside
    // the loaded chunk (held-arrow scrolling outruns the 150ms-throttled
    // fetch routinely). A null id simply means "no persistent identity":
    // `rebuildIndices` leaves the focus index alone and the focus ring
    // stays where the user put it. Group/footer rows ('' from
    // `stringRowIdAt`) also map to null for the same reason.
    this.selection.setRowIdResolver((rowIndex) => {
      const id = this.stringRowIdAt(rowIndex);
      return id ? id : null;
    });

    // 6. Renderer — no canvas, no paint loop; just the per-frame paint logic.
    this.renderer = new Renderer({
      getViewport: () => this.viewport,
      getTheme: () => this.theme,
      getColumnDefs: () => this.columnDefsMap as Map<string, ResolvedColDef>,
      cellRenderers: this.cellRenderers,
      cellData: (rowIndex, colId) => this.cellAt(rowIndex, colId),
      getSelection: () => this.selection.state,
      getHoveredRowIndex: () =>
        this.options.suppressRowHoverHighlight ? null : this.hoveredRowIndex,
      getSortModel: () => this.sortModel,
      getTotalRowCount: () => this.rowCount,
      getCanvasWidth: () => this.canvasBounds.width,
      getCanvasHeight: () => this.canvasBounds.height,
      rowDataSnapshotAt: (rowIndex) => this.rowDataSnapshotAt(rowIndex),
      // Cycle 21e / Task 11 — rule-fold threading: string rowId per data
      // row, full-row lookup from the rowDataById mirror (the paint
      // snapshot is visible-columns-only), and the active theme kind.
      stringRowIdAt: (rowIndex) => this.stringRowIdAt(rowIndex),
      getRowDataById: (rowId) => this.rowDataById.get(rowId),
      getThemeKind: () => this.getThemeKind(),
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
      // Task 4 (paint-cache layer) — the optional 3rd `vs` arg lets the
      // renderer's LAYER pass resolve focus-ring / range-overlay bounds
      // against `layerVs` (the layer's own, possibly off-screen coverage)
      // instead of the real viewport; `vs ?? this.viewport` preserves the
      // exact pre-Task-4 behavior when omitted (chrome pass, legacy
      // `paint()`, and the public `getVisibleCellBounds()` API below).
      getVisibleCellBounds: (rowIndex, colId, vs) => this.cellBoundsAgainst(vs ?? this.viewport, rowIndex, colId),
      // Cycle 15 / Task 5 — full-row group-strip lookup for `groupRows` /
      // `custom` display types. Returns `null` for singleColumn /
      // multipleColumns / no-grouping so the byRows painter skips the
      // strip code path with zero overhead. The renderer key defaults to
      // `'group'`; apps override via `VelocityGridOptions.groupRowRenderer` for
      // `'custom'` mode.
      getGroupRowStrip: () => this.grouping.getGroupRowStripCtx(),
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
      // Task 5 — scroll self-blit source. `VelocityGridCanvas` construction can
      // paint synchronously inside `resize()` BEFORE `this.cgridCanvas` is
      // assigned — optional-chain so that first paint skips the blit path.
      getCanvasElement: () => this.cgridCanvas?.canvas,
      // C1 fix — the actual backing-store dpr (not a `canvas.width /
      // cssWidth` derived ratio) so the scroll blit's destination-rect math
      // is exact even at odd CSS widths.
      getDevicePixelRatio: () => this.cgridCanvas?.devicePixelRatio ?? 1,
      // Cycle 22 / Task 2 — Tier-1 cell-bitmap cache handle. Read fresh
      // per paint (gates on the option + availability, tracks dpr).
      getRasterCells: () => this.getRasterCellsCtx(),
      // Cycle 22 / Task 3 — Tier-2 row-strip handle for the layer band
      // raster. Same gating discipline as Tier-1; also owns the
      // horizontal-scroll layoutEpoch bump (see `getRasterStripsCtx`).
      getRasterStrips: () => this.getRasterStripsCtx(),
    });

    // Task 4 (paint-cache layer) — construct the retained offscreen layer
    // up front unless the app opted all the way out at construction time.
    // `PaintCacheLayer`'s constructor never throws (a failed/unsupported
    // canvas just sets `.available = false`), so this is safe even in a
    // headless/unsupported environment — `paintCacheActive()` gates every
    // actual use on both the option AND `.available`.
    if (this.options.paintCache !== false) {
      this.paintCacheLayer = new PaintCacheLayer();
    }

    // Cycle 22 / Task 2 — raster caches (Tier 1 cell bitmaps + Tier 2 row
    // strips) under ONE shared budget. Construction never throws (a
    // failed/unsupported canvas degrades to `available = false`, and
    // `getRasterCellsCtx()` gates every use), so this is safe headless.
    if (this.options.rasterCache !== false) {
      this.buildRasterCaches();
    }

    // 7. Canvas wrapper — owns the <canvas>, gc cache, RAF + resize polling.
    // The setBounds callback fires synchronously inside the constructor's first
    // resize() — BEFORE this.cgridCanvas is assigned — so the renderer must
    // read canvas dimensions from `canvasBounds` (which setBounds sets first),
    // not from this.cgridCanvas.bounds.
    this.cgridCanvas = new VelocityGridCanvas(this.root, {
      setBounds: (b) => {
        // Cycle 22 / Task 3 — layoutEpoch contract: canvas WIDTH change.
        // Strips span the layer's full backing-store width, so a width
        // change stales every strip even when the resolved column layout
        // happens to come back identical (all-fixed-width columns).
        const widthChanged = b.width !== this.canvasBounds.width;
        const heightChanged = b.height !== this.canvasBounds.height;
        if (this.rasterStrips !== null && widthChanged) {
          this.stripLayoutEpochBump();
        }
        this.canvasBounds.width = b.width;
        this.canvasBounds.height = b.height;
        this.columnLayout = resolveColumnWidths(this.columnOrder, b.width);
        this.recomputeViewport();
        // Canvas resize assigns canvas.width/height which WIPES the
        // backing store (black). Fixed-width column layouts often resolve
        // identically after a side-bar open/close (container shrinks but
        // left/width unchanged), so the columnLayout setter does not
        // invalidate — queued live-tick PARTIAL damage would then paint
        // only those rows over a blank canvas (black gaps between
        // clusters). Always full-damage on a real size change; paintNow
        // runs synchronously from resize() right after this callback.
        if (widthChanged || heightChanged) {
          this.invalidateRetainedPaintForColumnLayout();
          this.damageLedger.add({ kind: 'full' });
        }
        // Only request viewport once the worker is connected; before that, the
        // worker client throws on send. After init the gridReady handler does
        // the first fetch and any later resize re-fetches normally.
        if (this.workerCoord) this.requestViewport();
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
      paint: (gc) => {
        const t0 = performance.now();
        // Cycle 25 / Task 7 — rebuild the flash alpha mask once per paint
        // so `cellAt` can index instead of Map-lookup per cell.
        this.rebuildFlashAlphaMaskForPaint();
        // Task 4 (paint-cache layer) — `paintCache: false` (or a layer
        // whose offscreen-canvas construction failed) short-circuits to
        // the EXISTING shipped pipeline below, byte-for-byte unchanged —
        // it is the field escape hatch alongside `suppressPartialRepaint`.
        // Closeout M-4 fix — `suppressPartialRepaint` is documented as
        // "reproduce the full-surface path"; before this fix a
        // `paintCache:true` + `suppressPartialRepaint:true` grid instead
        // re-rastered the layer's FULL extent AND presented every single
        // frame — strictly more work than legacy for zero benefit, since
        // the layer's whole present-by-blit value proposition is moot
        // once every frame is already forced full. Folding the suppress
        // flag into `cacheOn` routes a suppressed frame through the
        // legacy `Renderer.paint()` branch below instead — genuinely
        // "cache-off for the frame" (the layer's own geometry/pending
        // state simply doesn't advance while suppressed; the next
        // non-suppressed frame re-anchors normally, safely, since nothing
        // was ever presented FROM the layer during the suppressed
        // window).
        // Column-resize drag: force cache-off. Width changes faster than a
        // full layer rebuild; presenting retained rows mid-drag is what
        // produces the staircase misalignment the user sees while dragging.
        const cacheOn = this.paintCacheActive()
          && !this.options.suppressPartialRepaint
          && !this.columnResizeDragActive;
        // Snapshot BEFORE planLayer — a bootstrap `reset` sets
        // `paintCacheLayerAnchored = true` this frame; hybrid routing
        // must key off the pre-maintain state so the first paint still
        // builds the layer.
        const wasLayerAnchored = this.paintCacheLayerAnchored;
        const wasDeferred = this.paintCacheDeferLayer;
        // Task 4 — maintain the layer's geometry (spec §3 step 1) BEFORE
        // resolving damage: `buildDamageResolveCtx()` reads
        // `this.paintCacheLayer.geometry()` for the data-domain area cap,
        // so it must already reflect whatever THIS frame's `planLayer`
        // decision does to the anchor. Skip while hybrid-deferred — the
        // layer is idle and planLayer would only synthesize a reset from
        // the un-anchored state.
        let layerPlan: LayerPlan | null = null;
        let layerVs: ViewportState | null = null;
        // Task 4 — the dpr the layer's backing store was JUST sized at
        // (below), reused by the present step further down. Read fresh
        // here (not via `this.cgridCanvas.devicePixelRatio`) because this
        // whole `paint` closure can run SYNCHRONOUSLY from inside
        // `VelocityGridCanvas`'s own constructor (its first `resize()` call) —
        // `this.cgridCanvas` isn't assigned yet at that point (same
        // gotcha `getDevicePixelRatio`'s doc above already calls out for
        // the legacy scroll-blit wiring).
        let layerDpr = 1;
        if (cacheOn && !wasDeferred) {
          const layer = this.paintCacheLayer!;
          const vsNow = this.viewport;
          const overscanRatio = Math.max(0, Math.min(2, this.options.paintCacheOverscan ?? 1));
          const overscanPx = overscanRatio * vsNow.bodyHeight;
          const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
          layerDpr = dpr;
          // Closeout I-4 fix — capture the geometry `planLayer` should
          // compare against BEFORE calling `ensureSize`, not after.
          // `ensureSize` assigns `_layerHeight` UNCONDITIONALLY, first
          // thing (paintCache.ts doc) — by the time `planLayer` used to
          // read `layer.geometry()` below, it had already been overwritten
          // with THIS frame's target, so `planLayer`'s own `current.
          // layerHeight !== layerHeight` mismatch guard could never fire
          // in the integrated path (it always compared a value against
          // itself). Reading it NOW, while `this.paintCacheLayerAnchored`
          // still reflects the PREVIOUS frame's anchor validity, preserves
          // the last-committed geometry for the comparison below.
          const wasAnchored = this.paintCacheLayerAnchored;
          const geomBefore = wasAnchored ? layer.geometry() : null;
          // A REAL backing-store reallocation (dpr change, or a bodyHeight/
          // overscan change that alone might not trip `planLayer`'s own
          // `layerHeight` mismatch check below — it does here too, but a
          // dpr-only change wouldn't) silently wipes every pixel; force
          // the anchor invalid so `planLayer` can never `'keep'`/`'shift'`
          // against a just-blanked canvas.
          if (layer.ensureSize(this.canvasBounds.width, vsNow.bodyHeight + 2 * overscanPx, dpr)) {
            this.paintCacheLayerAnchored = false;
          }
          layerPlan = planLayer({
            current: this.paintCacheLayerAnchored ? geomBefore : null,
            scrollTop: vsNow.scrollTop,
            bodyHeight: vsNow.bodyHeight,
            overscanPx,
            contentHeight: vsNow.contentHeight,
          });
          if (layerPlan.kind === 'reset') {
            // Closeout I-1 fix — quantize the reset anchor to the DEVICE
            // pixel grid before committing it. `visibleSrcRect`'s present
            // blit always rounds `(scrollTop - layerTop) * dpr` to an
            // integer device px; if `layerTop` itself isn't already
            // device-aligned, every subsequent `shift()` (which advances
            // `layerTop` by an EXACT, unquantized `dy`) drifts the anchor
            // away from the pixel grid by up to 0.5 device px per shift,
            // accumulating across shifts (the C1-class bug this mirrors —
            // damageLedger.ts:181-183 — but for the layer's own self-blit
            // instead of the legacy scroll blit).
            const qTop = Math.round(layerPlan.newTop * dpr) / dpr;
            layer.reset(qTop);
            this.paintCacheLayerAnchored = true;
          } else if (layerPlan.kind === 'shift') {
            // Closeout I-1 fix — quantize `dy` to the device grid so the
            // anchor (`layer.shift`'s `_layerTop += dy`) advances by
            // EXACTLY what the self-blit moved the pixels by (`devDy =
            // round(dy * dpr)`), not the raw fractional CSS delta
            // `planLayer` computed. Without this, `dy * dpr` being
            // non-integer (fractional scrollTop from momentum scrolling,
            // fractional dpr, or an odd `bodyHeight` making `overscanPx`/
            // `idealTop` fractional) lets the anchor and the pixels
            // diverge — and because each shift rounds independently, the
            // error is a random walk that accumulates across shifts.
            const qdy = Math.round(layerPlan.dy * dpr) / dpr;
            layer.shift(qdy);
          }
          layerVs = this.buildLayerViewport(layer.geometry());
        }
        // Damage-region rendering — `suppressPartialRepaint` forces every
        // paint through the full-surface path regardless of what's on the
        // ledger (an escape hatch for apps that hit a damage-resolution
        // bug; also handy for screenshot/print paths that always want the
        // whole canvas). Otherwise resolve the ledger against the LIVE
        // viewport at paint time — semantic damage (row indices, rowId+colId
        // cells) survives scroll because geometry is computed here, not at
        // enqueue. An empty ledger (no `repaint*` call site has recorded
        // anything yet) resolves to full, so this is a byte-identical no-op
        // until a later task migrates a `requestRepaint()` source.
        // I4 fix — the suppressed branch used to build its `{full:true}`
        // WITHOUT draining the ledger, so `afterScrollTick`'s accumulated
        // `scrollDy` (and any other queued damage) survived underneath it.
        // Flipping the option back off mid-session would then resolve a
        // stale net `dy` on the FIRST unsuppressed paint — a wrong blit
        // over an already-correct canvas. Always drain via `takeResolved`
        // (discarding the result while suppressed) so the ledger stays
        // honest regardless of which branch actually painted.
        const resolved = this.damageLedger.takeResolved(this.buildDamageResolveCtx());
        const damage = this.options.suppressPartialRepaint
          ? { full: true as const, chromeRects: [], dataRects: [], blit: null }
          : resolved;

        const s = this.paintStats;
        let rasterAreaRects: Rect[] = [];
        let chromeAreaRects: Rect[] = [];

        // Hybrid routing (no-GPU / continuous-scroll): once the layer is
        // warm, `damage.full` keep/shift frames enter a deferral that
        // paints via legacy `Renderer.paint` for the WHOLE full streak
        // (no offscreen+present thrash). Cleared on the first non-full
        // frame so the layer can rebuild once. Bootstrap / coverage-jump
        // (`plan.kind === 'reset'` while not yet deferred) still builds
        // the layer.
        const planKind = layerPlan?.kind;
        if (
          cacheOn
          && damage.full
          && planKind !== 'reset'
          && (wasLayerAnchored || wasDeferred)
        ) {
          this.paintCacheDeferLayer = true;
          this.paintCacheLayerAnchored = false;
          // Legacy paints the screen correctly, but the layer still holds
          // pre-change column geometry. Wipe it so a later present / exit
          // from deferral can never blit staggered cells over the canvas.
          const deferLayer = this.paintCacheLayer;
          if (deferLayer?.available) {
            deferLayer.reset(deferLayer.geometry().layerTop);
          }
        } else if (cacheOn && wasDeferred && !damage.full) {
          this.paintCacheDeferLayer = false;
        }
        const useLayer = cacheOn && !this.paintCacheDeferLayer;

        if (!useLayer) {
          this.renderer.paint(gc, damage);
        } else {
          // Task 4 — spec §3 frame algorithm, steps 2-5. Step 1 (maintain)
          // already ran above — unless we just left a hybrid deferral, in
          // which case maintain now so the layer can reset cleanly.
          if (!layerPlan) {
            const layer = this.paintCacheLayer!;
            const vsNow = this.viewport;
            const overscanRatio = Math.max(0, Math.min(2, this.options.paintCacheOverscan ?? 1));
            const overscanPx = overscanRatio * vsNow.bodyHeight;
            const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
            layerDpr = dpr;
            const wasAnchored = this.paintCacheLayerAnchored;
            const geomBefore = wasAnchored ? layer.geometry() : null;
            if (layer.ensureSize(this.canvasBounds.width, vsNow.bodyHeight + 2 * overscanPx, dpr)) {
              this.paintCacheLayerAnchored = false;
            }
            layerPlan = planLayer({
              current: this.paintCacheLayerAnchored ? geomBefore : null,
              scrollTop: vsNow.scrollTop,
              bodyHeight: vsNow.bodyHeight,
              overscanPx,
              contentHeight: vsNow.contentHeight,
            });
            if (layerPlan.kind === 'reset') {
              const qTop = Math.round(layerPlan.newTop * dpr) / dpr;
              layer.reset(qTop);
              this.paintCacheLayerAnchored = true;
            } else if (layerPlan.kind === 'shift') {
              const qdy = Math.round(layerPlan.dy * dpr) / dpr;
              layer.shift(qdy);
            }
            layerVs = this.buildLayerViewport(layer.geometry());
          }
          const layer = this.paintCacheLayer!;
          const vsNow = this.viewport;
          const plan = layerPlan!;
          const vs2 = layerVs!;
          // Hybrid routing diverts warm `damage.full` frames to legacy, so
          // a layer frame only goes "raster full" when `planLayer` itself
          // reset the anchor (bootstrap / resize / overscan change).
          const layerRasterFull = damage.full || plan.kind === 'reset';

          // 2. Raster into the layer. Closeout directive B — a
          // `layerRasterFull` frame no longer rasters the layer's ENTIRE
          // ~2x-viewport extent synchronously (I-3's finding: that cost
          // 2-3x a legacy full paint on every full-damage frame —
          // horizontal scroll drags, theme swaps, cap trips, resizes).
          // Instead it rasters ONLY the currently-visible slice
          // synchronously (matching legacy's own per-frame cost) and
          // defers the layer's overscan margins (above/below the visible
          // slice) to the pending-band ledger — drained opportunistically
          // by the sync-fill (below, before every present) and the
          // budgeted drain (after present + chrome). A `plan.kind==='shift'`
          // frame's newly-exposed edge band gets the SAME deferred
          // treatment (the shift-lump problem directive B exists to
          // fix) — only `damage.dataRects` (real chunk-arrival/tick/
          // selection/etc. damage) still rasters inline, same as always
          // (point 4: idempotent against a later pending raster of the
          // same region, so no subtraction needed).
          const layerCtx = layer.context();
          if (layerCtx) {
            if (layerRasterFull) {
              const geom = layer.geometry();
              const visTop = vsNow.scrollTop;
              const visBottom = vsNow.scrollTop + vsNow.bodyHeight;
              const topOverscanBottom = Math.min(visTop, geom.layerTop + geom.layerHeight);
              if (topOverscanBottom > geom.layerTop) layer.addPending(geom.layerTop, topOverscanBottom);
              const bottomOverscanTop = Math.max(visBottom, geom.layerTop);
              if (geom.layerTop + geom.layerHeight > bottomOverscanTop) {
                layer.addPending(bottomOverscanTop, geom.layerTop + geom.layerHeight);
              }
              const h = Math.max(0, visBottom - visTop);
              if (h > 0) rasterAreaRects.push({ x: 0, y: visTop, w: this.canvasBounds.width, h });
            } else {
              if (plan.kind === 'shift') {
                for (const b of plan.rasterBands) {
                  const snapped = this.snapContentBandToRows(b.top, b.bottom);
                  if (snapped.bottom > snapped.top) layer.addPending(snapped.top, snapped.bottom);
                }
              }
              for (const r of damage.dataRects) rasterAreaRects.push(r);
            }
            // `paintLayer`'s `!full` branch clips/fills/paints under the
            // SAME ambient `ctx.translate(0, -vsNow.bodyTop)` the caller
            // applies below — so these rects must be in that SAME
            // vs2/bodyTop-relative space, NOT the raw layer-local
            // (`contentToLayerY`) space (which is only valid for the
            // untransformed raw-canvas ops in `PaintCacheLayer.shift`/
            // `reset`/`visibleSrcRect`, none of which run under this
            // translate). Reusing `dataRectToScreen` with `scrollTop:
            // layerTop` computes exactly that: `y: r.y + bodyTop -
            // layerTop`, which the ambient translate then correctly
            // reduces to `r.y - layerTop` (`contentToLayerY`) at the
            // physical canvas level — matching where `paintCellsByRows`
            // actually draws each row via `layerVs`. Passing raw
            // `contentToLayerY` rects here double-subtracted `bodyTop`,
            // clipping the fill/clip region `bodyTop` px away from where
            // cell content actually painted: content painted correctly but
            // landed OUTSIDE the clip, leaving damaged cells blank (caught
            // by the paint-cache invariance harness, Task 5). Closeout
            // directive B — `full` is now ALWAYS `false` here (never the
            // whole-layer-extent fill): the `layerRasterFull` branch above
            // already narrowed `rasterAreaRects` to just the visible
            // slice, so this always goes through the clip/rect path.
            const layerLocalRects = rasterAreaRects.map((r) =>
              dataRectToScreen(r, { scrollTop: layer.geometry().layerTop, bodyTop: vsNow.bodyTop }),
            );
            if (layerLocalRects.length > 0) {
              const rt0 = performance.now();
              // `.cache.save()`/`.cache.restore()` (NOT raw `save`/
              // `restore`) — the layer's `gc` has no per-tick outer cache
              // frame the way the main canvas's `paintNow()` provides
              // (`gc.cache.save()`/`.restore()` around the ENTIRE paint
              // call); using the cache-aware pair here is what makes THIS
              // invocation's fillStyle/etc writes correctly roll back
              // (both the real ctx state AND the JS `values` cache) once
              // it returns, so the layer's cache never drifts out of
              // sync with the real backing store across retained-layer
              // paints (a raw `save`/`restore` pair would revert the
              // REAL ctx but leave the JS cache believing a stale value
              // is still live).
              layerCtx.cache.save();
              layerCtx.translate(0, -vsNow.bodyTop);
              this.renderer.paintLayer(layerCtx, vs2, false, layerLocalRects);
              layerCtx.cache.restore();
              const rasterMs = performance.now() - rt0;
              s.layerRasterMs = s.layerRasterMs === 0 ? rasterMs : s.layerRasterMs * 0.9 + rasterMs * 0.1;
            }
            // Directive B.2 — present-safety sync-fill invariant. MUST run
            // before `presentLayer` below, on EVERY cache-on frame
            // (regardless of what just happened above): unrastered
            // content is thus never presentable BY CONSTRUCTION, since
            // the check lives at the consumer (present) site, not any
            // producer site above.
            this.syncFillLayerPending(layer, layerCtx, vsNow, vs2);
          }

          // 3. Present — one `drawImage` of the layer's visible slice.
          const layerCanvasEl = layer.canvasElement();
          if (layerCanvasEl) {
            const src = layer.visibleSrcRect(vsNow.scrollTop, vsNow.bodyHeight, layerDpr);
            this.renderer.presentLayer(
              gc,
              layerCanvasEl as unknown as CanvasImageSource,
              layerCanvasEl.width,
              src,
              { bodyTop: vsNow.bodyTop, bodyBottom: vsNow.bodyBottom, width: this.canvasBounds.width },
            );
          }
          s.presents++;

          // 4/5. Chrome + sticky, on-screen. `paintChrome`'s `!full` branch
          // paints in `'chrome'` mode, which deliberately SKIPS every data
          // band (`paintCellsByRows`'s `mode === 'chrome' && isData`
          // guard) — the data region is already fully handled by the
          // present() blit above plus the layer raster pass. Only
          // `damage.chromeRects` (genuinely screen-space chrome damage:
          // header/floating-filter/totals/pinned-row/sticky) belongs here.
          // Task-4 fix — the Task-2 bridge formula this used to reuse
          // (`chromeRects` UNION `dataRects` mapped back to screen) was
          // correct ONLY for the legacy `Renderer.paint()`, whose single
          // undifferentiated pass repaints BOTH data and chrome inside
          // that same clip; folding `dataRects` in here instead
          // background-filled the on-screen data region the present blit
          // had just drawn, then skipped repainting it (chrome mode never
          // touches data bands) — the just-presented cells went blank.
          // Caught by the paint-cache invariance harness (Task 5).
          const chromeFull = damage.full;
          chromeAreaRects = chromeFull ? [] : damage.chromeRects;
          this.renderer.paintChrome(gc, chromeFull, chromeAreaRects);

          if (plan.kind === 'reset') s.layerResets++;
          else if (plan.kind === 'shift') s.layerShifts++;

          // Directive B.3 — budgeted drain. Spends a small time budget
          // (after present + chrome, so it never delays what's actually
          // on-screen this frame) rastering pending bands nearest-
          // viewport-first, and keeps requesting another frame while any
          // backlog remains so the grid converges to fully-rastered at
          // idle (`waitSettled`/pixel-invariance need a "settled" grid to
          // mean zero pending, not just "no NEW damage").
          if (layerCtx && layer.hasPendingBands()) {
            this.drainLayerPendingBands(layer, layerCtx, vsNow, vs2);
          }
          s.layerBacklogPx = layer.pendingBacklogPx();
        }
        // Task 5 — snapshot the position/DPR/bounds THIS paint actually
        // painted at, so the next `afterScrollTick`'s delta (and its
        // dprChanged/boundsChanged bail checks) are always relative to
        // what's really on the canvas — never the scroll handler's own
        // read, which would double-count or drop deltas across frames the
        // fps gate skips.
        this.lastPaintedScrollLeft = this.viewportManager.scrollLeft;
        this.lastPaintedScrollTop = this.viewportManager.scrollTop;
        // Horizontal-scroll staleness fix — record the scrollLeft this
        // paint ACTUALLY rendered (every branch above paints from
        // `this.viewport`), so `recomputeViewport` can detect a viewport
        // that moved horizontally AFTER the scroll's full damage was
        // already consumed, and re-queue the full repaint. See the
        // `lastPaintedViewportScrollLeft` field doc.
        this.lastPaintedViewportScrollLeft = this.viewport.scrollLeft;
        this.lastPaintedDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        this.lastPaintedCanvasWidth = this.canvasBounds.width;
        this.lastPaintedCanvasHeight = this.canvasBounds.height;
        // Every consumed tick's increment is now reflected on the canvas —
        // the per-tick baseline resets alongside the per-paint one.
        this.lastTickScrollTop = this.lastPaintedScrollTop;
        const ms = performance.now() - t0;
        s.paints++;
        if (damage.full) {
          s.fullPaints++;
          s.lastRects = 0;
          s.lastAreaPct = 100;
          // Only full paints may catch the layout epoch up — a partial
          // that redrew a few rows at the new geometry must NOT silence
          // the healing full for neighbors still showing old column lefts.
          this.lastPaintedLayoutPaintEpoch = this.layoutPaintEpoch;
        } else {
          s.partialPaints++;
          if (!cacheOn && damage.blit) s.blits++;
          // Two-domain damage (Task 2) — `chromeRects` (screen space) and
          // `dataRects` (content space) never overlap in the region they
          // cover, and area (w×h) is translation-invariant, so summing raw
          // w×h from both arrays without transforming is exact. Task 4 —
          // for a cache-on frame this sums the SAME rect sets the layer/
          // chrome passes actually rastered from (`rasterAreaRects`/
          // `chromeAreaRects`), which are empty on a present-only frame —
          // giving `lastAreaPct: 0` exactly as the present-only contract
          // requires, with no special-casing needed.
          const rects = cacheOn ? rasterAreaRects.concat(chromeAreaRects) : damage.chromeRects.concat(damage.dataRects);
          s.lastRects = rects.length;
          const area = rects.reduce((a, r) => a + r.w * r.h, 0);
          const ca = this.canvasBounds.width * this.canvasBounds.height;
          s.lastAreaPct = ca > 0 ? Math.round((area / ca) * 1000) / 10 : 0;
        }
        s.avgPaintMs = s.avgPaintMs === 0 ? ms : s.avgPaintMs * 0.9 + ms * 0.1;
        if (ms > s.worstPaintMs) s.worstPaintMs = ms;
        // Cycle 22 / Task 2 — raster-cache byte gauge (both tiers share
        // the one budget). Refreshed per paint; `0` when disabled.
        s.rasterCacheBytes = this.rasterBudget?.spent() ?? 0;
        // Closeout M-1 — the OFF-ledger canvas reuse pools, so the
        // reported envelope can't under-report retained memory (ledger +
        // pools together worst-case ≈ 2× the configured budget).
        s.rasterCachePooledBytes =
          (this.rasterCells?.pooledBytes() ?? 0) + (this.rasterStrips?.pooledBytes() ?? 0);
      },
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
    // by VelocityGridCanvas, so editor goes on top).
    this.root.appendChild(this.editorContainer);

    // Theming — the constructor's first `cssReader.read()` can run before
    // an app-injected stylesheet (Vite dev `<link rel="stylesheet">`, lazy
    // CSS chunk, etc.) has applied its `--vg-*` bundle. DOM chrome reads
    // live CSS vars on every frame, but canvas paint uses the cached
    // `ResolvedTheme` snapshot — re-read once styles land.
    this.scheduleThemeCssResync();

    // Cycle 19 / Task 5a — pivot engine. Owns the canonical PivotState
    // seeded from the `pivotMode` option (pivot/value columns are
    // configured afterwards via the imperative API / tool panels), the
    // pivot-active flag, the saved primary tree, and the cellSpecById
    // reverse index. Every pivot UI mutates the engine via delegating
    // methods on VelocityGrid; the engine owns the worker round-trip + panel
    // fan-out + column-tree swap. Constructed BEFORE the side bar +
    // status bar + pivot panel because their tool panels read
    // `pivotEngine.isPivotMode()` synchronously during init (e.g. the
    // columns tool panel's `buildPivotModeRow` at construction time)
    // and `applyVerticalInsets` fires during status/pivot panel
    // construction (via `setReservedSpace` → `isSharingTopStrip`),
    // which also reads it. The ctor doesn't fire state-change side
    // effects — the `getPivotPanel` closure resolves lazily to whatever
    // `this.pivotPanel` holds at call-time.
    this.pivotEngine = new PivotEngine<TRow>(
      this.makePivotEngineDeps(),
      { pivotMode: options.pivotMode === true },
    );

    // Cycle 19 / Task 5-ColState — column-state manager. Owns the
    // Cycle 6 / Task 2 `getColumnState` / `applyColumnState` /
    // `resetColumnState` round-trip + the `applyRoleStateFromColumnState`
    // fan-out into GroupingState + PivotState + valueColumns.
    // Constructed HERE — AFTER the pivot engine so the
    // `isPivotActive` / `getPrimaryColumnTree` deps closures can resolve,
    // BEFORE the side bar so `columnsPanel` (which calls
    // `api.getColumnState()` synchronously at construction) hits a
    // live manager. The initial-state snapshot is captured at the same
    // spot the pre-extraction code captured it (end of the ctor after
    // the full initial `columnLayout` resolves), so
    // `resetColumnState` replays the as-coded layout.
    this.colStateManager = new ColumnStateManager<TRow>(
      this.makeColStateManagerDeps(),
    );

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
        // same as the VelocityGridEvent union members for `toolPanelVisibleChanged`
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

    // Cycle 21i Phase 2 — the status bar is intrinsic: `undefined`
    // normalizes to the default def (row counts + selection/aggregates),
    // `statusBar: false` opts out. Runtime flips route through
    // `updateStatusBar()`.
    const statusBarDef = normalizeStatusBarOption(options.statusBar);
    if (statusBarDef) {
      this.statusBar = new StatusBarHost(this.root, this.makeStatusBarContext(), statusBarDef);
    }

    // Cycle 15 / Task 6 — row group panel (DOM strip ABOVE the
    // column header row, hosting one chip per `rowGroupCols[i]` and
    // accepting column-header drops). Mounts when `options.rowGroupPanelShow`
    // resolves to `'always'` or `'onlyWhenGrouping'` (the latter only
    // produces a visible reservation when grouping is active). Attaches
    // to `this.root` AFTER the status bar so its z-order sits above
    // the canvas + side bar + status bar without explicit z-index
    // plumbing.

    const rgShow = normalizeRowGroupPanelShow(options.rowGroupPanelShow);
    if (rgShow !== null) {
      const ctx: RowGroupPanelGridContext = this.makeRowGroupPanelContext();
      this.rowGroupPanel = new RowGroupPanelHost(
        this.root,
        ctx,
        rgShow,
        this.grouping.getRowGroupColumns(),
        this.grouping.getGroupingState().getPerLevelSort(),
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
    // The strip is STRICTLY opt-in via `pivotPanelShow` (AG contract) —
    // the Cycle 21i auto-provision alongside the row-group panel was
    // dropped; the columns tool panel's Column Labels zone is the
    // default column-labels surface.
    const ppShow = normalizePivotPanelShow(options.pivotPanelShow);
    if (ppShow !== null) {
      const ctx: PivotPanelGridContext = this.makePivotPanelContext();
      this.pivotPanel = new PivotPanelHost(
        this.root,
        ctx,
        ppShow,
        this.pivotEngine.getPivotColumns(),
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
      getLeafHeaderHeight: () => this.effectiveLeafHeaderHeight(),
      getLeafHeaderTop: () => {
        const leaf = this.viewport.visibleRows.find(
          (r) => !r.subgrid.isData && !('getGroupIdAt' in r.subgrid),
        );
        return leaf ? leaf.top : 0;
      },
      // Grid Layouts / column-group-drag feature (Task 1).
      getGroupLeafColIds: (groupId) => this.columnTree.groupById.get(groupId)?.leafColIds.slice() ?? [],
      getGroupHeaderName: (groupId) => this.columnTree.groupById.get(groupId)?.headerName,
      getColGroupPath: (colId) => this.getColGroupPath(colId),
      getGroupDescendantIds: (groupId) => this.getGroupDescendantIds(groupId),
      moveColumnGroup: (groupId, targetParentGroupId, beforeId) =>
        this.moveColumnGroup(groupId, targetParentGroupId, beforeId),
      // Grid Layouts / column-group-drag feature (Task 2).
      isColumnGroupMarried: (groupId) => this.columnTree.groupById.get(groupId)?.marryChildren === true,
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
      setHoveredRow: (rowIndex) => {
        // Suppressed → never track (stays null so the painter skips it).
        this.hoveredRowIndex = this.options.suppressRowHoverHighlight ? null : rowIndex;
      },
      // Damage-region rendering (Task 4) — thin wrapper over the private
      // `repaintRows` helper so `OnHover` (hover) and future row-scoped
      // features reach the ledger through `VelocityGridLike` instead of a
      // blanket `canvas.requestRepaint()`.
      repaintRows: (rows) => this.repaintRows(rows),
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
      isGroupDoubleClickExpandSuppressed: () => this.isGroupDoubleClickExpandSuppressed(),
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
    // Cycle 19 / Task 4 — instantiate the EditController BEFORE the surfaces
    // that mount onto its DOM host (floating-filter overlay, filter popup,
    // context menu) so `this.editorContainer` (a getter that proxies to the
    // controller's `editorContainer`) is live by the time they look it up.
    this.editController = new EditController<TRow>(
      {
        disposables: this.disposables,
        events: this.events,
        root: this.root,
        editorContainer: this.editorContainer,
        getColumnDef: (colId) => this.columnDefsMap.get(colId),
        isPivotMode: () => this.pivotEngine.isPivotMode(),
        getColumnOrder: () => this.columnOrder,
        getRowCount: () => this.rowCount,
        getVisibleColumns: () => this.viewport.visibleColumns,
        getVisibleRows: () => this.viewport.visibleRows,
        getCellAt: (rowIndex, colId) => this.cellAt(rowIndex, colId),
        getRowIdAt: (rowIndex) => this.rowIdAt(rowIndex),
        getRowDataSnapshotAt: (rowIndex) => this.rowDataSnapshotAt(rowIndex),
        getCanvasBounds: () => this.canvasBounds,
        getVisibleCellBounds: (rowIndex, colId) => this.getVisibleCellBounds(rowIndex, colId),
        // `setFocus` is the non-collapsing verb used by `openEditor` /
        // `openRowEdit` — those paths can be triggered by a mouse
        // gesture whose trailing click fires immediately after a drag,
        // and the drag has already installed a multi-cell range that
        // the following focus move must not clobber. The keyboard
        // commit-and-move paths (Enter / Tab / Excel-arrow) reach for
        // `setFocusAndCollapseRanges` below so the range collapses to
        // a 1×1 at the new focused cell — matching the "one focused
        // cell at a time" invariant PR #21 (`e81c76d`) established.
        setFocus: (rowIndex, colId) => { this.selection.setFocus(rowIndex, colId); },
        setFocusAndCollapseRanges: (rowIndex, colId) => {
          this.selection.setFocusAndCollapseRanges(rowIndex, colId);
        },
        getFocus: () => ({
          rowIndex: this.selection.state.focusedRowIndex,
          colId: this.selection.state.focusedColId,
        }),
        focusCanvas: () => { this.cgridCanvas.canvas.focus({ preventScroll: true }); },
        getRowByIndex: (rowIndex) => this.workerCoord.getRowByIndex(rowIndex),
        applyTransaction: (payload) => {
          // Cycle 21e / Task 12 — rowsChanged (source 'edit'), listener-gated.
          this.mirrorEditCommit(payload.update as TRow[] | undefined);
          return this.workerCoord.applyTransaction(payload);
        },
        isDestroyed: () => this.destroyed,
      },
      () => ({
        editType: this.options.editType,
        enableExcelEditing: this.options.enableExcelEditing,
        enterNavigatesVerticallyAfterEdit: this.options.enterNavigatesVerticallyAfterEdit,
        suppressStartEditOnTab: this.options.suppressStartEditOnTab,
      }),
    );
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
      getInsetY: () => this.options.floatingFilterInsetY ?? 4,
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
      this.disposables.addMediaQueryListener(this.reducedMotionQuery, (e) => {
        this.reducedMotion = e.matches;
      });
    }
    this.flashRegistry = new FlashRegistry({
      getEnabled: () => this.options.enableCellChangeFlash === true,
      getFlashDuration: () => this.options.cellFlashDuration ?? 500,
      getFadeDuration: () => this.options.cellFadeDuration ?? 1000,
      getReducedMotion: () => this.reducedMotion,
      // Damage-region rendering (Task 3) — route the per-rAF fade repaint
      // through the cells-damage ledger (the active flash entries'
      // rowId/colId cells) instead of a bare `requestRepaint()`, which the
      // ledger would resolve to a full-surface repaint every tick.
      // Closeout I-4 — fade frames use `repaintCellsFlashFade` (identical
      // ledger damage, NO Tier-2 strip bookkeeping): a fade frame carries
      // no content change, so per-rAF version bumps + re-patches of the
      // same settled span (~90 frames per 1.5s fade) are pure waste.
      requestRepaint: () => this.repaintCellsFlashFade(this.flashRegistry.activeCells()),
      // Cycle 22 / closeout I-3 — when a row's LAST flash expires it is
      // strip-eligible again: re-capture it if its strip is missing/stale
      // (the tick-time patch bailed — icon cell, last-in-band column,
      // fractional geometry...). One row repaint per flash generation,
      // replacing "stays cold and paints live at every subsequent raster".
      onRowsSettled: (rowIds) => this.recaptureSettledFlashRows(rowIds),
    });

    // Live-tick deferral: pause async txs + flash fade for the scroll
    // gesture; flush on bodyScrollEnd (200ms debounce from ViewportManager).
    // Wired after FlashRegistry exists so bodyScrollEnd can resume fade.
    this.disposables.add(this.events.on('bodyScroll', () => {
      this.bodyScrollActive = true;
      if (this.flashTickHandle !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.flashTickHandle);
        this.flashTickHandle = null;
        this.flashPausedForScroll = true;
      }
    }));
    this.disposables.add(this.events.on('bodyScrollEnd', () => {
      this.bodyScrollActive = false;
      this.flushDeferredAsyncTransactions();
      this.flushDeferredSsrmUpdates();
      if (this.pendingSsrmColumnRefill) {
        this.pendingSsrmColumnRefill = false;
        this.scheduleSsrmColumnRefill();
      }
      if (
        this.flashPausedForScroll
        || this.flashRegistry.size() > 0
        || this.groupFlashMap.size > 0
      ) {
        this.flashPausedForScroll = false;
        this.startFlashTickLoop();
      }
    }));

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
    this.loadingOverlay = new LoadingOverlay(this.root);
    this.loadingOverlay.setLoading(options.loading === true);
    this.loadingOverlay.setMessage(options.loadingMessage);
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
    // Cycle 19 / Task 3 — coordinator owns the WorkerClient + the viewport
    // dispatch. The handler closures route every worker push back into
    // VelocityGrid's existing state-mutation methods so behaviour is unchanged.
    this.workerCoord = new WorkerCoordinator(
      worker as unknown as import('./core/workerCoordinator').WorkerLike,
      {
        onModelUpdated: (visibleCount, groupKeys, expandedKeys) => {
          // Sparse SSRM owns rowCount through hydrate replies. A
          // transaction-driven modelUpdated computed against a
          // pre-resize ssrmOrder (live tick racing a regroup / initial
          // hydrate) carries a stale count — applying it makes
          // getDisplayedRowCount flap (e.g. flat 50k reasserting after
          // a regroup reported 3) until the next hydrate corrects it.
          if (!(this.ssrm && !this.ssrmClientPipeline)) {
            this.rowCount = visibleCount;
          }
          // Cycle 15 / Task 7 — keep the main-side mirror in lockstep
          // with the worker's tree across transactions that add or
          // remove group keys (e.g. a new ticker entered the dataset).
          // The worker only ships this when grouping is active.
          if (groupKeys !== undefined) this.knownGroupKeys = groupKeys;
          // AG parity — a transaction-driven rebuild consumed the
          // deferred `groupDefaultExpanded` seed; adopt the seeded set
          // (same rule as the setRowData reply) so the first caret click
          // doesn't ship a wrong mirror.
          if (expandedKeys !== undefined) {
            this.expandedKeys = expandedKeys === null ? null : new Set(expandedKeys);
          }
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
          // per-row heights live with row identity, not slot. Rebuild the
          // index in place with the grid-level fallback for every row.
          // Nulling and waiting for the next chunk would collapse
          // `maxScrollTop` to 0 mid-scroll under pivot mode (the data
          // subgrid's `getRowHeight(0)` returns 0 for rows outside the
          // loaded chunk window), the sizer would flip to 1px for one
          // frame, and the browser would clamp scrollTop to 0. Seeding
          // with the fallback keeps the scrollable extent intact; the
          // next chunk arrival overlays the real per-row heights via
          // `refreshRowHeightIndex`.
          const fallbackH = this.options.rowHeight ?? this.theme.rowHeight;
          this.rowHeightIndex = new RowHeightIndex(this.rowCount, () => fallbackH);
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
        onHeightsChanged: (rowStart, heights) => this.onHeightsChanged(rowStart, heights),
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
        onError: (msg) => console.error('[velocity-grid] worker error:', msg),
        onViewportChunk: (opts, chunk, stickyAncestors) =>
          this.handleViewportChunk(opts, chunk, stickyAncestors),
        isDestroyed: () => this.destroyed,
      },
    );

    // Migration warning (2026-07, one per page load): `groupDefaultExpanded`
    // moved to AG-Grid levels-open semantics. `-1` flipped from collapse-all
    // to expand-all; `0` flipped from first-level-open to all-collapsed.
    if (
      !warnedGroupDefaultExpandedMigration
      && (options.groupDefaultExpanded === -1 || options.groupDefaultExpanded === 0)
    ) {
      warnedGroupDefaultExpandedMigration = true;
      console.warn(
        `[velocity-grid] groupDefaultExpanded: ${options.groupDefaultExpanded} — semantics changed to AG-Grid levels-open: `
        + '-1 now expands ALL groups (was: collapse all); 0 now collapses all (was: top level open); '
        + 'N >= 1 opens N levels. Use groupDefaultExpandedKeys: [] for an explicit all-collapsed start.',
      );
    }

    this.workerCoord.init({
      rowIdField: inferRowIdField(options.getRowId),
      columns: this.workerColumns(),
      rowHeight: this.options.rowHeight ?? this.theme.rowHeight,
      // Cycle 4 / Task 11 — forward the cell-flash flag at init time so
      // the very first setRowData → applyTransaction sequence ships
      // diffs to main. Runtime mutation via `setGridOption('enableCellChangeFlash', N)`
      // flows through `setEnableCellChangeFlash` later.
      enableCellChangeFlash: this.options.enableCellChangeFlash === true,
      asyncTransactionWaitMillis: this.options.asyncTransactionWaitMillis,
      asyncTransactionConflate: this.options.asyncTransactionConflate,
      asyncTransactionThrottleMillis: this.resolveAsyncThrottleMillis(),
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
      groupHideParentOfSingleChild: this.options.groupHideParentOfSingleChild,
      groupMaintainOrder: this.options.groupMaintainOrder,
      groupAggFiltering: this.options.groupAggFiltering,
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
        // Pinned variants map onto the totals SUBGRID, not the in-scroll
        // footer row (see effectiveTotalsRowPosition).
        ?? (this.options.grandTotalRow === 'top' || this.options.grandTotalRow === 'bottom'
          ? true
          : undefined),
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
        await this.workerCoord.setExternalFilterPresent(true).catch(() => {});
      }
      // Cycle 8 / Task 2 — push the construction-time sort model to the
      // worker BEFORE the first setRowData so the very first paint is
      // already sorted. When the model is empty (no `initialSort` on any
      // column) the round-trip is skipped entirely.
      if (this.sortModel.length > 0) {
        await this.workerCoord.setSortModel(this.sortModel).catch(() => {});
      }
      // Cycle 8 / Task 4 — when `postSortRows` is configured, register
      // the round-trip BEFORE the first setRowData so the very first
      // visible-build runs the hook. Skipped when the option is absent;
      // the worker's pipeline then runs end-to-end with zero overhead.
      if (typeof this.options.postSortRows === 'function') {
        await this.workerCoord.setPostSortRowsPresent(true).catch(() => {});
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
        this.workerCoord
          .setPivotMaxGeneratedColumns(this.options.pivotMaxGeneratedColumns)
          .catch((err) => {
            if (!this.destroyed) console.error('[velocity-grid] setPivotMaxGeneratedColumns:', err);
          });
      }
      // Cycle 18 / Task 8c — flip the worker's PivotPass to the
      // AG-parity "append new keys at the end" default UNLESS the app
      // opts back into strict alphanumeric ordering. The PivotPass
      // constructor still defaults to `strict=true` to preserve the
      // legacy single-test behaviour for the standalone engine; cgrid
      // ALWAYS forwards the resolved flag so the boundary is
      // unambiguous.
      this.workerCoord
        .setStrictPivotColumnOrder(this.options.enableStrictPivotColumnOrder === true)
        .catch((err) => {
          if (!this.destroyed) console.error('[velocity-grid] setStrictPivotColumnOrder:', err);
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
      // SSRM mounts BEFORE gridReady so the canonical AG pattern — install
      // the datasource from the gridReady handler — finds `this.ssrm` live.
      if (options.rowModelType === 'serverSide') {
        this.mountSsrmController(isServerSideDatasourceV2(options.serverSideDatasource));
        if (options.serverSideDatasource) {
          this.installServerSideDatasource(options.serverSideDatasource);
        }
        // Prefer a datasource that arrived during async init (hub restore)
        // over the construction-time placeholder.
        if (this.pendingServerSideDatasource !== undefined) {
          this.installServerSideDatasource(this.pendingServerSideDatasource);
          this.pendingServerSideDatasource = undefined;
        }
      }
      this.events.emit({ type: 'gridReady', api: this.makeApi() });
      this.readySettled = true;
      this.resolveReady();
      if (options.rowModelType !== 'serverSide' && options.rowData) {
        this.setRowData(options.rowData);
      }
      // AG parity — construction-time `colDef.rowGroup` / `rowGroupIndex`
      // seed the group model (previously only initialState / API / panel
      // grouping took effect; the colDef fields were parsed but inert).
      // Runs BEFORE initialState so a snapshot's rowGroupColumns still win.
      {
        const seedGroupCols = this.computeInitialRowGroupColumns();
        if (seedGroupCols.length > 0 && this.grouping.getRowGroupColumns().length === 0) {
          this.setRowGroupColumns(seedGroupCols);
        }
      }
      // Same AG parity for measures: `colDef.aggFunc` seeds value columns
      // so getColumnState round-trips them (and SSRM group-total paint,
      // which gates on leaf.aggFunc, keeps working after a profile restore).
      {
        const seedValueCols = this.computeInitialValueColumns();
        if (seedValueCols.length > 0 && this.getValueColumns().length === 0) {
          this.setValueColumns(seedValueCols);
        }
      }
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
      // Grid Layouts (Phase A / A3) — seed the layout registry now that the
      // construction view (columns + initialState) is live, so a synthesized
      // Default captures the as-built baseline. Idempotent: the lazy getter
      // no-ops if a layout API call already created it.
      this.getLayoutManager();
      // Cycle 21i / Phase 1 — persistState: restore the saved snapshot
      // (AFTER initialState so the user's last session wins over the
      // app default), then arm the debounced autosave. Autosave only
      // arms once restore resolves, so construction-time stateUpdated
      // emits can't clobber the saved snapshot.
      if (options.persistState) {
        if (!options.gridId) {
          console.warn("[velocity-grid] persistState requires a 'gridId' — persistence disabled");
        } else {
          const { StatePersistenceController } = await import('./core/statePersistence');
          const persistOpts = options.persistState === true ? {} : options.persistState;
          this.statePersistence = new StatePersistenceController(options.gridId, persistOpts, {
            applyState: (state) => this.restorePersistedBlob(state),
            // Grid Layouts (A5) — fold the layouts bundle into the saved blob
            // under the reserved `layouts` field (spec §11). The adapter is
            // unchanged; normal view-restore ignores the extra field.
            onStateUpdated: (fn) =>
              this.events.on('stateUpdated', (ev) => {
                const state = (ev as unknown as { state: GridState }).state;
                fn({ ...state, layouts: this.exportLayouts() } as GridState);
              }),
          });
          await this.statePersistence.restore();
        }
      }
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid]', err); });

    // 10. Native scroll listener — Cycle 19 / Task 2: now owned by
    // `ViewportManager` (registered in its constructor at step 5).

    // stopEditingWhenCellsLoseFocus — commit the open editor when focus
    // leaves the grid root. Uses focusout (which bubbles, unlike blur) so a
    // shift from the canvas to e.g. the document body still fires. The
    // relatedTarget check keeps the editor open while focus moves between
    // the canvas and the editor's own DOM (or between popup DOM and canvas).
    if (this.options.stopEditingWhenCellsLoseFocus) {
      this.disposables.addListener(this.root, 'focusout', (ev) => {
        if (!this.isAnyEditOpen()) return;
        const next = (ev as FocusEvent).relatedTarget as Node | null;
        if (next && this.root.contains(next)) return;
        this.stopEditing(false);
      });
    }

    // Cycle 19 / Task 4 — edit-mode keyboard matrix (root capture-phase
    // listener) + Excel-mode mousedown flip (on the editorContainer) are
    // now owned by `EditController` and wire through its own
    // DisposableRegistry registration inside the controller's constructor.

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
    let lastFocusEmitKey: string | null = null;
    // Damage-region rendering (Task 4) — snapshot of the previous
    // selection state used to classify each onChange below instead of a
    // blanket full repaint. `selectedRowIndices: 'all'` is a sentinel for
    // a full-grid row selection (selectAll / header checkbox) so a
    // 5,000-row selectAll never materializes a 5,000-entry array just to
    // diff against the NEXT change.
    let lastSelDamage: { selectedRowIndices: number[] | 'all'; rangesKey: string } = {
      selectedRowIndices: [], rangesKey: JSON.stringify([]),
    };
    this.selectionUnsubscribe = this.selection.onChange((state) => {
      const oldFocusRowForDamage = lastFocusRow;
      const focusChanged =
        state.focusedRowIndex !== lastFocusRow || state.focusedColId !== lastFocusCol;
      if (focusChanged) {
        // A focus-INDEX shift caused by a MODEL REORDER (sort / filter /
        // real-time transaction re-resolving the focused rowId to a new
        // visible index) must NOT auto-scroll: the user's logical focus
        // (same rowId + colId) hasn't moved, so scrolling the focused
        // column/row back into view would fight the user's own scroll —
        // e.g. horizontal scroll snapping back on every live tick while a
        // column is sorted. `suppressFocusEnsure` is set ONLY around the
        // `rebuildIndices` reorder in `rebuildSelectionFromPersistentIds`;
        // genuine user navigation still scrolls the new focus into view.
        if (!this.suppressFocusEnsure) {
          if (state.focusedRowIndex !== null) this.ensureRowIndexVisible(state.focusedRowIndex);
          if (state.focusedColId !== null) this.ensureColIdVisible(state.focusedColId);
        }
        lastFocusRow = state.focusedRowIndex;
        lastFocusCol = state.focusedColId;
        // `cellFocused` — declared in the event map since Cycle 21 but never
        // emitted anywhere (toolbars subscribed to a dead event). Fire it on
        // genuine focus moves, keyed on the RESOLVED (rowId, colId) pair so
        // model reorders that re-index the same logical cell stay silent.
        const fc = this.getFocusedCell();
        const key = fc ? `${fc.rowId}\u0000${fc.colId}` : null;
        if (key !== lastFocusEmitKey) {
          lastFocusEmitKey = key;
          if (fc) this.events.emit({ type: 'cellFocused', rowId: fc.rowId, colId: fc.colId });
        }
      }
      // Damage-region rendering (Task 4) — classify the change instead of
      // a blanket full repaint. Priority order (first match wins):
      //   1. ranges changed (range gestures / header column-band select)
      //      → FULL. Range-rect precision is future work — full-on-
      //      range-change is correct and still rare.
      //   2. row-selection SET changed: a small delta (≤24 indices)
      //      repaints just those rows; a large delta, a transition
      //      into/out of a full selectAll, or select-all itself → FULL
      //      (never enumerates a multi-thousand-row selection into the
      //      ledger).
      //   3. focus-only change (selection set + ranges untouched):
      //      repaint just the old/new focused row band.
      //   4. anything else (onChange fired with no tracked-field delta
      //      detected) → FULL. Global Constraint: ambiguous never means
      //      partial.
      const rangesKey = JSON.stringify(state.ranges);
      const rangesChanged = rangesKey !== lastSelDamage.rangesKey;
      const newSelSize = state.selectedRowIndices.size;
      const isFullSelectAll = newSelSize > 0 && newSelSize === this.rowCount;
      const newSelSnapshot: number[] | 'all' = isFullSelectAll
        ? 'all'
        : Array.from(state.selectedRowIndices);

      let rowSelectionChanged: boolean;
      const rowDelta: number[] = [];
      if (lastSelDamage.selectedRowIndices === 'all' && newSelSnapshot === 'all') {
        rowSelectionChanged = false;
      } else if (lastSelDamage.selectedRowIndices === 'all' || newSelSnapshot === 'all') {
        // Transition into/out of a full selection — always "changed";
        // the size check below routes it to FULL regardless of rowDelta.
        rowSelectionChanged = true;
      } else {
        const oldSet = new Set(lastSelDamage.selectedRowIndices);
        const newSet = state.selectedRowIndices;
        for (const idx of oldSet) if (!newSet.has(idx)) rowDelta.push(idx);
        for (const idx of newSet) if (!oldSet.has(idx)) rowDelta.push(idx);
        rowSelectionChanged = rowDelta.length > 0;
      }

      if (rangesChanged) {
        this.repaintFull();
      } else if (rowSelectionChanged) {
        // I2 fix — a single emit can carry BOTH a row-selection delta AND
        // a focus move (the model-rebuild emit that re-resolves selection
        // indices and `focusedRowIndex` together). Without this, the OLD
        // focus row's ring survives because this branch only repaints
        // `rowDelta` — union the old/new focus rows in (still subject to
        // the same ≤24 cap below) so the stale ring gets repainted too.
        if (focusChanged) {
          for (const r of [oldFocusRowForDamage, state.focusedRowIndex]) {
            if (r !== null && !rowDelta.includes(r)) rowDelta.push(r);
          }
        }
        const tooLarge = lastSelDamage.selectedRowIndices === 'all'
          || newSelSnapshot === 'all'
          || rowDelta.length > 24;
        if (tooLarge) this.repaintFull();
        else this.repaintRows(rowDelta);
      } else if (focusChanged) {
        const focusRows = Array.from(new Set(
          [oldFocusRowForDamage, state.focusedRowIndex].filter((n): n is number => n !== null),
        ));
        if (focusRows.length) this.repaintRows(focusRows);
        else this.repaintFull();
      } else {
        this.repaintFull();
      }
      lastSelDamage = { selectedRowIndices: newSelSnapshot, rangesKey };

      this.events.emit({ type: 'selectionChanged', selectedRowIds: this.getSelectedRowIds() });
      this.updateA11y();
    });

    // Cycle 19 / Task 5-ColState — capture the initial column state
    // snapshot HERE (end of ctor, after the initial `columnLayout` fully
    // resolves) so `resetColumnState` replays the as-coded hidden /
    // pinned / width / sort layout — including `initial*` field defaults
    // that propertyChain already folded into the resolved slots. The
    // manager itself was constructed earlier (before the side bar) so
    // `columnsPanel`'s synchronous `api.getColumnState()` reads a live
    // manager during panel init.
    this.colStateManager.captureInitialSnapshot();
  }

  // --- Public API -----------------------------------------------------------
  // `on` / `off` / `addEventListener` / `removeEventListener` live further
  // down with the rest of the editor-cycle additions (Cycle 5 / Task 1).

  setServerSideDatasource(ds: AnyServerSideDatasource<TRow> | null): void {
    if (!this.ssrm) {
      if (this.options.rowModelType === 'serverSide' && !this.readySettled) {
        // Async worker init hasn't mounted SSRM yet — keep the latest ds
        // and install it after the construction-time placeholder.
        this.pendingServerSideDatasource = ds;
        return;
      }
      console.warn('[velocity-grid] setServerSideDatasource requires rowModelType: \"serverSide\"');
      return;
    }
    this.pendingServerSideDatasource = undefined;
    this.installServerSideDatasource(ds);
  }

  /** Resolves once async init has emitted `gridReady` (SSRM live if configured). */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Route a datasource to the matching controller kind, remounting the
   *  controller when the kind (v1 flat-window vs v2 skeleton) changes. */
  private installServerSideDatasource(ds: AnyServerSideDatasource<TRow> | null): void {
    const wantV2 = isServerSideDatasourceV2(ds);
    if (ds !== null && this.ssrm !== null && wantV2 !== this.ssrmV2) {
      this.ssrm.destroy();
      this.mountSsrmController(wantV2);
    }
    if (this.ssrmV2) {
      (this.ssrm as ServerSideRowModelV2Controller<TRow>)
        .setDatasource(ds as IServerSideDatasourceV2<TRow> | null);
    } else {
      (this.ssrm as ServerSideRowModelController<TRow>)
        .setDatasource(ds as IServerSideDatasource<TRow> | null);
    }
  }

  /** Shared host seam for both SSRM controllers. */
  private buildSsrmHost(): SsrmHostV2<TRow> {
    return {
      getRowId: (row) => this.options.getRowId(row),
      getSortModel: () => this.sortModel,
      getFilterModel: () => this.getFilterModel(),
      getRowGroupCols: () => this.grouping.getRowGroupColumns(),
      getGroupKeys: () => [],
      getExpandedGroupKeys: () => Array.from(this.getExpandedKeys()),
      getColumnKeys: () => this.isSsrmColumnWindowingActive()
        ? this.buildSsrmFetchColumnKeys()
        : undefined,
      mergeGroupKeys: (keys) => {
        if (keys.length === 0) return;
        const merged = new Set(this.knownGroupKeys);
        for (const k of keys) merged.add(k);
        this.knownGroupKeys = [...merged];
      },
      // v2 skeleton — exact replacement (expandAll / collapseAll read this).
      setGroupKeys: (keys) => {
        this.knownGroupKeys = keys.slice();
      },
      // v2 skeleton — grand totals (field-keyed root aggregates) for the
      // pinned totals subgrid + in-scroll grand-total footer.
      setGrandTotals: (totals) => {
        if (this.destroyed) return;
        void this.workerCoord.ssrmSetGrandTotals(totals).then(() => {
          if (!this.destroyed) this.cgridCanvas?.requestRepaint();
        }).catch(() => { /* worker torn down */ });
      },
      setRowCount: (count, prevCount) => {
        if (this.destroyed) return;
        const prev = prevCount ?? this.rowCount;
        if (prev === count) return;
        this.rowCount = count;
        this.rowHeightIndex = null;
        this.recomputeViewport();
        if (count < prev && this.viewportManager.scrollTop > this.viewport.maxScrollTop) {
          this.viewportManager.setScroll(
            this.viewportManager.scrollLeft,
            this.viewport.maxScrollTop,
          );
        }
        this.events.emit({ type: 'modelUpdated', visibleRowCount: count });
        if (count > 0 && prev === 0 && this.ssrmWantsClientPipeline()) {
          void this.enableSsrmClientPipeline();
        }
      },
      getRefreshRange: () => {
        const block = this.options.cacheBlockSize ?? 100;
        const vp = this.viewport;
        if (!vp || this.rowCount <= 0) {
          return { rowStart: 0, rowEnd: block };
        }
        return {
          rowStart: Math.max(0, vp.firstRow),
          rowEnd: Math.min(this.rowCount, vp.lastRow + 1),
        };
      },
      hydrateWindow: async (startRow, rows, rowCount, reset) => {
        if (this.destroyed) return;
        // Reset = new generation (purge / skeleton swap): drop the stale
        // mirror so a long-lived blotter doesn't accumulate every row (and
        // every stale generation's synthetics) ever hydrated.
        if (reset) this.rowDataById.clear();
        // Keep main-side id mirror in sync for selection / external APIs.
        // Skeleton chrome (group/footer/grand-total rows) stays out of the
        // mirror — it is paint state, not data, and forEachNode/getRowNode
        // must not yield it.
        let hydratedIds = 0;
        for (const row of rows) {
          const kind = readSsrmMeta(row)?.kind;
          if (kind === 'group' || kind === 'footer' || kind === 'grandTotal') continue;
          try {
            const id = this.options.getRowId(row);
            const prev = this.rowDataById.get(id);
            // Field-merge so column-window / thin payloads do not wipe
            // previously hydrated fields (Perspective expression deps stay
            // on the table; paint columns arrive in slices). Skip
            // null/undefined so sparse to_json nulls don't clobber mirror
            // values rules still need (condition cols off the paint window).
            this.rowDataById.set(
              id,
              prev ? mergeRowDataFields(prev, row) : row,
            );
            // Soft-refresh / column-window hydrates often arrive without a
            // flashMask — bump row versions so Tier-2 strips don't keep
            // serving pre-rule / pre-tick pixels (conditional styles freeze).
            if (this.rasterStrips !== null) {
              this.rowVersionByRowId.set(id, (this.rowVersionByRowId.get(id) ?? 0) + 1);
              hydratedIds++;
            }
          } catch { /* skip */ }
        }
        const { visibleCount } = await this.workerCoord.ssrmHydrate({
          rowCount,
          startRow,
          rows,
          reset,
        });
        if (this.destroyed) return;
        this.rowCount = visibleCount;
        this.recomputeViewport();
        if (this.viewportManager.scrollTop > this.viewport.maxScrollTop) {
          this.viewportManager.setScroll(
            this.viewportManager.scrollLeft,
            this.viewport.maxScrollTop,
          );
        }
        if (hydratedIds > 0) this.cgridCanvas?.requestRepaint();
      },
      applyTransaction: (tx) => {
        this.applyTransaction(tx as Tx<TRow>);
      },
      requestViewport: () => {
        if (!this.destroyed) this.requestViewport('rowDataChanged');
      },
      isDestroyed: () => this.destroyed,
    };
  }

  /** Instantiate the SSRM controller for the given datasource kind. */
  private mountSsrmController(v2: boolean): void {
    const host = this.buildSsrmHost();
    this.ssrmV2 = v2;
    if (v2) {
      // In-scroll footer/grand-total config (pinned grandTotalRow variants
      // ride the totals subgrid — see effectiveTotalsRowPosition).
      const groupTotalRow = this.options.groupTotalRow
        ?? (this.options.groupIncludeFooter === true ? 'bottom' : null);
      const grandInScroll = this.options.grandTotalRow === 'top' || this.options.grandTotalRow === 'bottom'
        ? this.options.grandTotalRow
        : (this.options.groupIncludeTotalFooter === true ? 'bottom' : null);
      this.ssrm = new ServerSideRowModelV2Controller<TRow>(host, {
        rowIdField: inferRowIdField(this.options.getRowId),
        cacheBlockSize: this.options.cacheBlockSize,
        maxConcurrentDatasourceRequests: this.options.maxConcurrentDatasourceRequests,
        groupTotalRow,
        grandTotalRow: grandInScroll,
        maintainOrder: this.options.groupMaintainOrder === true,
      });
    } else {
      this.ssrm = new ServerSideRowModelController<TRow>(host, {
        cacheBlockSize: this.options.cacheBlockSize,
        maxConcurrentDatasourceRequests: this.options.maxConcurrentDatasourceRequests,
      });
    }
    this.wireSsrmColumnWindowRefill();
  }

  /**
   * Column projection is opt-in for Perspective ExprTK / client watched
   * deps. Hub STOMP and other full-width SSRM datasources must not enter
   * the H-scroll refill path — that caused black voids and flicker.
   */
  private isSsrmColumnWindowingActive(): boolean {
    return this.ssrmExpressionHost != null
      || this.ssrmExpressionOutputIds.length > 0
      || this.ssrmClientWatchedColIds.length > 0;
  }

  /**
   * Column projection for SSRM fetches — paint window + system cols +
   * Perspective expression outputs + client watched fields. Datasources
   * that ignore `columnKeys` still return full rows (backward compatible).
   */
  private buildSsrmFetchColumnKeys(): string[] {
    const visibleColIds = (this.viewport?.visibleColumns ?? []).map((c) => c.colId);
    let filterIds: string[] = [];
    try {
      filterIds = Object.keys(this.getFilterModel());
    } catch {
      filterIds = [];
    }
    return buildSsrmColumnKeys({
      visibleColIds,
      rowIdField: inferRowIdField(this.options.getRowId),
      sortColIds: this.sortModel.map((s) => s.colId),
      filterColIds: filterIds,
      rowGroupColIds: this.grouping.getRowGroupColumns(),
      valueAggColIds: this.getValueColumns().map((v) => v.colId),
      expressionOutputIds: this.ssrmExpressionOutputIds,
      clientWatchedColIds: this.ssrmClientWatchedColIds,
    });
  }

  /** Register Perspective expression output aliases for SSRM columnKeys. */
  setSsrmExpressionOutputs(ids: readonly string[]): void {
    this.ssrmExpressionOutputIds = [...new Set(ids.filter(Boolean))];
    this.lastSsrmColumnKeysSig = '';
    this.scheduleSsrmColumnRefill();
  }

  /**
   * Register / clear the Perspective ExprTK host used by SSRM calculated
   * columns (validate + apply without Stage A / cgrid DSL).
   */
  setSsrmExpressionHost(host: SsrmExpressionHost | null): void {
    this.ssrmExpressionHost = host;
    if (host) {
      this.setSsrmExpressionOutputs(Object.keys(host.getExpressions()));
    } else {
      this.ssrmExpressionOutputIds = [];
      this.lastSsrmColumnKeysSig = '';
    }
  }

  getSsrmExpressionHost(): SsrmExpressionHost | null {
    return this.ssrmExpressionHost;
  }

  /** Register client rules/alerts/format watched cols for SSRM columnKeys. */
  setSsrmClientWatchedColumns(ids: readonly string[]): void {
    this.ssrmClientWatchedColIds = [...new Set(ids.filter(Boolean))];
    this.lastSsrmColumnKeysSig = '';
    this.scheduleSsrmColumnRefill();
  }

  private wireSsrmColumnWindowRefill(): void {
    this.disposables.add(this.events.on('virtualColumnsChanged', () => {
      this.scheduleSsrmColumnRefill();
    }));
  }

  private scheduleSsrmColumnRefill(): void {
    if (!this.ssrm || this.destroyed) return;
    // Full-width SSRM (STOMP hub sample, etc.) — never refill on H-scroll.
    if (!this.isSsrmColumnWindowingActive()) {
      this.pendingSsrmColumnRefill = false;
      return;
    }
    // Defer during scroll — refill mid-gesture races paint and caused the
    // black voids / flicker on the STOMP SSRM sample.
    if (this.bodyScrollActive) {
      this.pendingSsrmColumnRefill = true;
      return;
    }
    if (this.ssrmColumnRefillTimer) clearTimeout(this.ssrmColumnRefillTimer);
    this.ssrmColumnRefillTimer = setTimeout(() => {
      this.ssrmColumnRefillTimer = null;
      if (this.destroyed || !this.ssrm) return;
      if (!this.isSsrmColumnWindowingActive()) return;
      if (this.bodyScrollActive) {
        this.pendingSsrmColumnRefill = true;
        return;
      }
      const keys = this.buildSsrmFetchColumnKeys();
      const sig = keys.join('\0');
      // Skip when nothing changed, or when hydrated rows already carry every
      // requested field (full-width payloads — H-scroll must not thrash).
      if (sig === this.lastSsrmColumnKeysSig) return;
      if (!this.ssrmColumnKeysNeedFetch(keys)) {
        this.lastSsrmColumnKeysSig = sig;
        return;
      }
      this.lastSsrmColumnKeysSig = sig;
      const v2 = this.ssrm as ServerSideRowModelV2Controller<TRow>;
      if (typeof v2.refillColumnKeys === 'function') {
        void v2.refillColumnKeys();
      } else {
        void this.ssrm.refresh({ purge: false });
      }
    }, 120);
  }

  /**
   * True when at least one fetch key is missing from sample hydrated rows
   * (Perspective column windows). Full-width datasources always return
   * false after the first hydrate — no H-scroll refill.
   */
  private ssrmColumnKeysNeedFetch(keys: readonly string[]): boolean {
    if (keys.length === 0) return false;
    const samples: Array<Record<string, unknown>> = [];
    for (const row of this.rowDataById.values()) {
      samples.push(row as Record<string, unknown>);
      if (samples.length >= 4) break;
    }
    // Nothing hydrated yet — let the normal ensureRange path populate;
    // a refill would only race the first paint.
    if (samples.length === 0) return false;
    for (const key of keys) {
      for (const row of samples) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) return true;
      }
    }
    return false;
  }

  refreshServerSide(params?: RefreshServerSideParams): void {
    if (
      this.bodyScrollActive
      && this.options.deferAsyncTransactionsWhileScrolling !== false
    ) {
      // Merge instead of overwrite: a queued purge must survive later soft
      // refreshes landing in the same scroll (last-write-wins dropped it).
      const next = params ?? {};
      const prev = this.deferredSsrmRefresh;
      this.deferredSsrmRefresh = prev
        ? { ...prev, ...next, purge: prev.purge === true || next.purge === true }
        : next;
      return;
    }
    void this.ssrm?.refresh(params);
  }

  applyServerSideTransaction(tx: ServerSideTransaction<TRow>): void {
    if (!this.ssrm) {
      console.warn('[velocity-grid] applyServerSideTransaction requires rowModelType: \"serverSide\"');
      return;
    }
    if (
      this.bodyScrollActive
      && this.options.deferAsyncTransactionsWhileScrolling !== false
    ) {
      this.deferredSsrmTxs.push(tx);
      return;
    }
    this.dispatchServerSideTransaction(tx);
  }

  /** Apply an SSRM transaction immediately (bypasses scroll deferral). */
  private dispatchServerSideTransaction(tx: ServerSideTransaction<TRow>): void {
    // Detect sort-key changes BEFORE warming the mirror (needs prior values).
    const sortKeyChanged = this.ssrmUpdateTouchesActiveSort(tx);

    // Cycle 21e parity with CSRM `updateRowDataCache`: when rules/alerts
    // listen for `rowsChanged`, capture oldRow BEFORE field-merge and emit
    // so Perspective/STOMP ticks feed flash, diff styles, and alerts.
    const emitRowsChanged = this.events.hasListener('rowsChanged');
    const added: Array<{ rowId: string; row: TRow }> = [];
    const updated: Array<{ rowId: string; row: TRow; oldRow: TRow }> = [];
    const removed: Array<{ rowId: string; row: TRow }> = [];

    // Keep main mirror warm for updates — field-merge so thin ticks don't
    // wipe columns the STOMP payload omitted.
    if (tx.update) {
      for (const row of tx.update) {
        try {
          const id = this.options.getRowId(row);
          const prev = this.rowDataById.get(id);
          const next = prev ? mergeRowDataFields(prev, row) : row;
          this.rowDataById.set(id, next);
          if (emitRowsChanged) {
            if (prev !== undefined) updated.push({ rowId: id, row: next, oldRow: { ...(prev as object) } as TRow });
            else added.push({ rowId: id, row: next });
          }
        } catch { /* skip */ }
      }
    }
    if (tx.add) {
      for (const row of tx.add) {
        try {
          const id = this.options.getRowId(row);
          const prev = this.rowDataById.get(id);
          this.rowDataById.set(id, row);
          if (emitRowsChanged) {
            if (prev !== undefined) {
              updated.push({ rowId: id, row, oldRow: { ...(prev as object) } as TRow });
            } else {
              added.push({ rowId: id, row });
            }
          }
        } catch { /* skip */ }
      }
    }
    if (tx.remove) {
      for (const row of tx.remove) {
        try {
          const id = this.options.getRowId(row);
          const prev = this.rowDataById.get(id);
          this.rowDataById.delete(id);
          if (emitRowsChanged) {
            removed.push({ rowId: id, row: prev ?? row });
          }
        } catch { /* skip */ }
      }
    }
    this.ssrm!.applyServerSideTransaction(tx);
    if (
      emitRowsChanged
      && (added.length > 0 || updated.length > 0 || removed.length > 0)
    ) {
      this.events.emit({
        type: 'rowsChanged',
        added,
        updated,
        removed,
        source: 'transaction',
      });
    }
    // Sparse SSRM: SortPass is skipped — soft-refresh so getRows re-applies
    // the active sort. Do NOT gate on "visible band would reorder": an
    // off-screen row can rise into the viewport (or displace a visible row)
    // without changing relative order among currently-visible ids.
    // Trailing debounce + SSRM soft-refresh conflation absorb tick storms
    // so we don't thrash hydrate vs live txs.
    if (sortKeyChanged && !this.ssrmClientPipeline) {
      this.scheduleSsrmResortRefresh();
    }
  }

  /**
   * True when an SSRM update changes a value under the active sort model
   * (or introduces a sort-key for a row not yet mirrored). Only columns
   * present on the update payload count — thin ticks that omit the sort
   * field must not spuriously refresh. Unsorted grids stay on the tx-only
   * path so cell flash is preserved.
   */
  private ssrmUpdateTouchesActiveSort(tx: ServerSideTransaction<TRow>): boolean {
    const sortModel = this.sortModel;
    if (!sortModel.length || !tx.update?.length) return false;
    const cols = sortModel.map((s) => s.colId);
    for (const row of tx.update) {
      let id: string;
      try { id = this.options.getRowId(row); } catch { continue; }
      const next = row as Record<string, unknown>;
      const prev = this.rowDataById.get(id) as Record<string, unknown> | undefined;
      if (!prev) {
        if (cols.some((c) => Object.prototype.hasOwnProperty.call(next, c))) return true;
        continue;
      }
      for (const c of cols) {
        if (!Object.prototype.hasOwnProperty.call(next, c)) continue;
        if (prev[c] !== next[c]) return true;
      }
    }
    return false;
  }

  /**
   * Coalesce high-frequency sort-key ticks into soft SSRM refreshes.
   * Pure trailing debounce never fires when the sort column ticks
   * continuously (each tick resets the timer). Use debounce + maxWait.
   */
  private scheduleSsrmResortRefresh(): void {
    if (this.destroyed) return;
    const debounceMs = 150;
    const maxWaitMs = 300;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.ssrmResortFirstAt == null) this.ssrmResortFirstAt = now;
    if (this.ssrmResortTimer != null) clearTimeout(this.ssrmResortTimer);

    const waited = now - this.ssrmResortFirstAt;
    const delay = waited >= maxWaitMs ? 0 : Math.min(debounceMs, maxWaitMs - waited);

    this.ssrmResortTimer = setTimeout(() => {
      this.ssrmResortTimer = null;
      this.ssrmResortFirstAt = null;
      if (this.destroyed || !this.ssrm) return;
      if (this.sortModel.length === 0) return;
      this.refreshServerSide({ purge: false });
    }, delay);
  }

  setRowData(rows: TRow[]): void {
    if (this.ssrm) {
      console.warn('[velocity-grid] setRowData is ignored in serverSide row model — use the datasource');
      return;
    }
    const heightsByRowId = this.resolveHeightsForRows(rows);
    // Cycle 7 / Task 8 — refresh the main-side row cache so the external
    // filter + alwaysPass predicates evaluate against current data.
    // setRowData is a full replace, so wipe the cache first.
    this.rowDataById.clear();
    for (const row of rows) {
      try { this.rowDataById.set(this.options.getRowId(row), row); } catch { /* skip bad rowId */ }
    }
    this.workerCoord.setRowData(rows, heightsByRowId).then(({ visibleCount, groupKeys, expandedKeys }) => {
      if (this.destroyed) return;
      this.rowCount = visibleCount;
      // Cycle 15 / Task 7 — setRowData may have grown the set of
      // group keys (data flowing into a grouped grid for the first
      // time). The worker rides them back on the reply so the mirror
      // for `getExpandedKeys()` populates before the next UI tick.
      if (groupKeys !== undefined) this.knownGroupKeys = groupKeys;
      // AG parity 2026-07-21 — this load re-seeded groupDefaultExpanded
      // defaults (the model landed before data); adopt the worker's set.
      if (expandedKeys !== undefined) {
        this.expandedKeys = expandedKeys === null ? null : new Set(expandedKeys);
      }
      // Persist / profile restore can paint row-group chips while the
      // worker still rejects unknown group ids (placeholder columnDefs).
      // `groupKeys === undefined` means the worker is not grouping at all
      // (`isGroupingActive()` false); an empty array means grouping is on
      // but the current data has no group nodes.
      const groupCols = this.grouping.getRowGroupColumns();
      if (groupCols.length > 0 && groupKeys === undefined) {
        this.setGroupModel({ rowGroupCols: [...groupCols] });
      }
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
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid]', err); });
  }

  applyTransaction(t: Tx<TRow>): TransactionResult {
    // Foundation: async only. For sync semantics, callers use the worker's sync path via separate cycle.
    const heightsByRowId = this.resolveHeightsForRows([...(t.add ?? []), ...(t.update ?? [])]);
    this.updateRowDataCache(t, 'transaction');
    this.workerCoord.applyTransaction({
      add: t.add,
      update: t.update,
      remove: t.remove?.map((r) => this.options.getRowId(r)),
      async: false,
      heightsByRowId,
    }).then(() => this.recomputeAlwaysPass())
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] applyTransaction:', err); });
    return { add: [], update: [], remove: [] };
  }

  applyTransactionAsync(t: Tx<TRow>): void {
    // During body scroll, buffer live ticks and flush on bodyScrollEnd so
    // scroll paints / viewport fetches are not competing with worker txs.
    if (
      this.bodyScrollActive
      && this.options.deferAsyncTransactionsWhileScrolling !== false
    ) {
      this.deferredAsyncTxs.push(t);
      return;
    }
    this.dispatchAsyncTransaction(t);
  }

  /** Cycle 26 (W3) — resolve the effective async-transaction throttle,
   *  the grid's live-update rate cap. Omitted → 200ms (at most 5 grid
   *  updates/second); explicit 0 → off (programmatic escape hatch —
   *  tests / apps needing every flush immediately); anything else clamps
   *  to [100, 1000], the same range the Grid Options editor offers.
   *  The single source of truth for BOTH worker forwarding sites (init
   *  config + `forwardAsyncTransactionOptions`). Isolated updates are
   *  never delayed by the throttle — the worker's queue only spaces
   *  flushes under a continuous stream (see dataPipeline `schedule`). */
  private resolveAsyncThrottleMillis(): number {
    const v = this.options.asyncTransactionThrottleMillis;
    if (v === undefined) return 200;
    if (v === 0) return 0;
    return Math.max(100, Math.min(1000, v));
  }

  /** Apply an async transaction immediately (bypasses scroll deferral). */
  private dispatchAsyncTransaction(t: Tx<TRow>): void {
    const heightsByRowId = this.resolveHeightsForRows([...(t.add ?? []), ...(t.update ?? [])]);
    this.updateRowDataCache(t, 'transactionAsync');
    this.workerCoord.applyTransaction({
      add: t.add,
      update: t.update,
      remove: t.remove?.map((r) => this.options.getRowId(r)),
      async: true,
      heightsByRowId,
    }).then(() => this.recomputeAlwaysPass())
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] applyTransaction:', err); });
  }

  /** Merge deferred async txs (last-write-wins per row id) and dispatch. */
  private flushDeferredAsyncTransactions(): void {
    if (this.deferredAsyncTxs.length === 0) return;
    const queued = this.deferredAsyncTxs;
    this.deferredAsyncTxs = [];
    const merged = mergeDeferredAsyncTransactions(queued, (row) => {
      try { return this.options.getRowId(row); } catch { return null; }
    });
    if (
      (merged.add && merged.add.length > 0)
      || (merged.update && merged.update.length > 0)
      || (merged.remove && merged.remove.length > 0)
    ) {
      this.dispatchAsyncTransaction(merged);
    }
  }

  /** Flush SSRM refresh / transactions deferred during body scroll. */
  private flushDeferredSsrmUpdates(): void {
    if (this.deferredSsrmTxs.length > 0) {
      const queued = this.deferredSsrmTxs;
      this.deferredSsrmTxs = [];
      for (const tx of queued) this.dispatchServerSideTransaction(tx);
    }
    if (this.deferredSsrmRefresh !== null) {
      const params = this.deferredSsrmRefresh;
      this.deferredSsrmRefresh = null;
      void this.ssrm?.refresh(params);
    }
  }

  /** Cycle 7 / Task 8 — keep `rowDataById` in sync with a transaction.
   *  add / update both write the row in place; remove drops the entry.
   *  Same `getRowId` derivation the worker uses so the keys line up
   *  across the two caches. Errors in `getRowId` skip the row silently.
   *
   *  Cycle 21e / Task 12 — emits ONE `rowsChanged` per transaction when
   *  (and only when) a listener is registered. The old-row shallow
   *  snapshot (`{...prev}`) is captured BEFORE the overwrite. Fully
   *  listener-gated: without a listener this method is byte-identical
   *  to its pre-21e body. */
  private updateRowDataCache(t: Tx<TRow>, source: 'transaction' | 'transactionAsync'): void {
    if (!this.events.hasListener('rowsChanged')) {
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
      return;
    }
    const added: Array<{ rowId: string; row: TRow }> = [];
    const updated: Array<{ rowId: string; row: TRow; oldRow: TRow }> = [];
    const removed: Array<{ rowId: string; row: TRow }> = [];
    if (t.add) {
      for (const row of t.add) {
        try {
          const rowId = this.options.getRowId(row);
          const prev = this.rowDataById.get(rowId);
          this.rowDataById.set(rowId, row);
          // A transaction "add" for an already-known rowId is an upsert —
          // report it as updated so listeners see the old row.
          if (prev !== undefined) updated.push({ rowId, row, oldRow: { ...prev } });
          else added.push({ rowId, row });
        } catch { /* skip */ }
      }
    }
    if (t.update) {
      for (const row of t.update) {
        try {
          const rowId = this.options.getRowId(row);
          const prev = this.rowDataById.get(rowId);
          this.rowDataById.set(rowId, row);
          if (prev !== undefined) updated.push({ rowId, row, oldRow: { ...prev } });
          else added.push({ rowId, row });
        } catch { /* skip */ }
      }
    }
    if (t.remove) {
      for (const row of t.remove) {
        try {
          const rowId = this.options.getRowId(row);
          const prev = this.rowDataById.get(rowId);
          this.rowDataById.delete(rowId);
          removed.push({ rowId, row: prev ?? row });
        } catch { /* skip */ }
      }
    }
    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      this.events.emit({ type: 'rowsChanged', added, updated, removed, source });
    }
  }

  /** Cycle 21e / Task 12 — mirror an editor commit-back into rowsChanged.
   *  The edit path historically bypasses updateRowDataCache (the dep at
   *  the EditController wiring calls workerCoord.applyTransaction
   *  directly), so `source: 'edit'` is produced here. Fully listener-
   *  gated, INCLUDING the rowDataById freshening: without a rowsChanged
   *  listener the mirror keeps its pre-21e (stale-after-edit) behavior
   *  and this method is a no-op — byte-identical for non-rules apps.
   *  With a listener, the mirror is updated so consecutive edits report
   *  correct oldRow values. */
  private mirrorEditCommit(update: TRow[] | undefined): void {
    if (!this.events.hasListener('rowsChanged')) return;
    if (!update || update.length === 0) return;
    const updated: Array<{ rowId: string; row: TRow; oldRow: TRow }> = [];
    for (const row of update) {
      try {
        const rowId = this.options.getRowId(row);
        const prev = this.rowDataById.get(rowId);
        this.rowDataById.set(rowId, row);
        updated.push({ rowId, row, oldRow: prev !== undefined ? { ...prev } : { ...row } });
      } catch { /* skip */ }
    }
    if (updated.length > 0) {
      this.events.emit({ type: 'rowsChanged', added: [], updated, removed: [], source: 'edit' });
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
    this.workerCoord.setAlwaysPassRowIds(ids).then(({ visibleCount }) => {
      if (this.destroyed) return;
      this.rowCount = visibleCount;
      this.recomputeViewport();
      // Cycle 14 / Task 6 — alwaysPass evaluation is part of the filter
      // pipeline; tagging as `filterChanged` so listeners can correlate.
      this.requestViewport('filterChanged');
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid] alwaysPass:', err); });
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
      this.workerCoord.externalFilterResult(callId, rowIds).catch(() => {});
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
    this.workerCoord.externalFilterResult(callId, surviving).catch((err) => {
      if (!this.destroyed) console.error('[velocity-grid] externalFilterResult:', err);
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
      | ((p: { rowIds: string[]; getData: (rowId: string) => TRow | undefined }) => string[])
      | undefined;
    if (typeof hook !== 'function') {
      this.workerCoord.postSortRowsResult(callId, rowIds).catch(() => {});
      return;
    }
    let reordered: string[];
    try {
      const result = hook({ rowIds, getData: (rowId) => this.rowDataById.get(rowId) });
      // Guard against bad hook returns. A non-array (or one with mismatched
      // length / unknown ids) would silently corrupt the visible set —
      // fall back to the input order instead.
      if (Array.isArray(result) && result.length === rowIds.length) {
        reordered = result;
      } else {
        reordered = rowIds;
      }
    } catch (err) {
      if (!this.destroyed) console.error('[velocity-grid] postSortRows hook threw:', err);
      reordered = rowIds;
    }
    this.workerCoord.postSortRowsResult(callId, reordered).catch((err) => {
      if (!this.destroyed) console.error('[velocity-grid] postSortRowsResult:', err);
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
    if (!this.workerCoord) return;
    // alwaysPass may close over the same state the external predicate
    // does (e.g. a toggle that flips both at once); refresh it before
    // the refilter so the worker sees a consistent set on the next pass.
    this.recomputeAlwaysPass();
    const present = this.options.isExternalFilterPresent?.() === true;
    const reqId = ++this.externalFilterReqId;
    this.workerCoord.setExternalFilterPresent(present).then(({ visibleCount }) => {
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
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid] onFilterChanged:', err); });
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

  flushAsyncTransactions(): void {
    this.workerCoord.flushAsyncTransactions();
  }

  /** Cycle 8 / Task 4 — read the active sort model. Mirrors the api
   *  object's `getSortModel` so callers that hold a VelocityGrid reference (e.g.
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
          `[velocity-grid] column '${entry.colId}' has an inline-closure comparator; ` +
          `sort runs worker-side and closures don't cross postMessage. ` +
          `Use api.registerComparator(name, fn) and set comparator: name on the col def.`,
        );
      }
    }
    this.sortModel = s;
    // Cycle 22 / Task 3 — layoutEpoch contract: SORT change. A sort
    // permutes row positions, and zebra parity (dataIdx % 2) is baked
    // into every strip's pixels — belt-and-suspenders over the chunk
    // window-diff (which also degrades to a full wipe for big reorders).
    if (this.rasterStrips !== null) this.stripLayoutEpochBump();
    // SSRM sparse path — sort is applied by the datasource on the next getRows.
    // Client-pipeline mode uses the CSRM SortPass below.
    if (this.ssrm && !this.ssrmClientPipeline) {
      this.events.emit({ type: 'sortChanged', sortModel: s });
      this.ssrm.refresh({ purge: true });
      return;
    }
    this.workerCoord.setSortModel(s).then(({ visibleCount }) => {
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
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid]', err); });
  }

  /** Cycle the sort state for a column. The cycle order is taken from
   *  `VelocityGridOptions.sortingOrder` (default `['asc', 'desc', null]`):
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
      this.workerCoord.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
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
      if (!this.destroyed) console.error('[velocity-grid] commitFill:', err);
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
    // SSRM sparse path — filter is applied by the datasource on the next getRows.
    // Client-pipeline mode uses the CSRM FilterPass below.
    if (this.ssrm && !this.ssrmClientPipeline) {
      this.events.emit({
        type: 'filterChanged',
        filterModel: f,
        source: 'api',
        columns: changedColIds,
      });
      this.ssrm.refresh({ purge: true });
      return;
    }
    this.workerCoord.setFilterModel(f).then(({ visibleCount }) => {
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
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid]', err); });
  }

  /** Cycle 7 / Task 1 — return the v2 filter model entry for `colId`, or
   *  `null` when the column is unfiltered. Backs the floating-filter
   *  overlay's `getColumnFilterModel` dep. Tasks 3-6 + 9 surface this on
   *  `VelocityGridApi`. */
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

  /** Current `quickFilterText` option (title-bar search). Sparse SSRM
   *  datasources read this via filterChanged → View remount. */
  getQuickFilterText(): string {
    return this.options.quickFilterText ?? '';
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
    // Sparse SSRM — server owns filter. Mirror setFilterModel: skip the
    // worker FilterPass (no-op on ssrmOrder) and purge so getRows remounts.
    if (this.ssrm && !this.ssrmClientPipeline) {
      this.events.emit({
        type: 'filterChanged',
        filterModel: combined,
        source: 'columnFilter',
        columns: changed ? [colId] : [],
      });
      this.ssrm.refresh({ purge: true });
      return Promise.resolve();
    }
    return this.workerCoord.setFilterModel(combined).then(({ visibleCount }) => {
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
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid]', err); });
  }

  /** Cycle 7 / Task 9 — `true` when any filter source is active:
   *  per-column, quick, external, or alwaysPass. Backs `VelocityGridApi.isAnyFilterPresent`. */
  isAnyFilterPresent(): boolean {
    if (this.columnFilterModels.size > 0) return true;
    if ((this.options.quickFilterText ?? '') !== '') return true;
    if (this.options.isExternalFilterPresent?.() === true) return true;
    if (this.options.alwaysPassFilter !== undefined) return true;
    return false;
  }

  /** Cycle 7 / Task 9 — `true` when at least one per-column filter
   *  entry is set. Independent of quick / external state. Backs
   *  `VelocityGridApi.isColumnFilterPresent`. */
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
    if (!this.workerCoord) return;
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
        '[velocity-grid] quickFilterMatcher is shipped in Cycle 7 as API surface only; ' +
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
    // Cycle 22 / Task 3 — layoutEpoch contract: QUICK-FILTER term change.
    // The per-cell match tint isn't part of the strip version key, and the
    // filtered row set re-shuffles zebra parity — any term change (set,
    // edit, or clear) stales every strip. Value-compared so the periodic
    // option re-apply with identical terms never thrashes the store.
    const nextQuickFilterTerms = terms === null ? [] : terms.map((t) => t.toLowerCase());
    if (this.rasterStrips !== null) {
      const prevTerms = this.quickFilterLowerTerms;
      if (prevTerms.length !== nextQuickFilterTerms.length
        || nextQuickFilterTerms.some((t, i) => t !== prevTerms[i])) {
        this.stripLayoutEpochBump();
      }
    }
    this.quickFilterLowerTerms = nextQuickFilterTerms;
    // Trigger a repaint right away so the highlight reflects the new
    // terms even before the worker round-trip lands. The visible row set
    // may still be stale for one frame — that's fine; cells that no
    // longer match are simply un-tinted in the next paint, while the
    // chunk catches up.
    this.cgridCanvas?.requestRepaint();

    // Sparse SSRM — worker QuickFilterPass is skipped; Perspective (or
    // another datasource) must apply the search on the next getRows.
    if (this.ssrm && !this.ssrmClientPipeline) {
      const combined: FilterModel = {};
      for (const [id, entry] of this.columnFilterModels) combined[id] = entry;
      this.events.emit({ type: 'filterChanged', filterModel: combined, source: 'quickFilter' });
      this.ssrm.refresh({ purge: true });
      return;
    }

    // Bump the request id so any in-flight reply for an earlier term set
    // (the user's previous keystroke) is dropped on arrival — see the
    // `reqId` check inside the `.then` below.
    const reqId = ++this.quickFilterReqId;
    this.workerCoord.setQuickFilter({ terms, cacheQuickFilter, colIds })
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
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid]', err); });
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
      if (!this.destroyed) console.error('[velocity-grid] showColumnFilter:', err);
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
      : this.getDistinctValues(colId);
    return valuesPromise.then((values) => {
      if (this.destroyed) return null;
      return new SetFilterPopup({
        values,
        initialModel: initialEntry,
        onApply: (model) => {
          // Empty universe (distinct fetch failed) + empty selection must
          // clear the filter — otherwise Apply writes match-nothing and
          // the SSRM blotter sticks at Total Rows: 0.
          if ((!model || model.values.length === 0) && values.length === 0) {
            callbacks.onApply(null);
            return;
          }
          callbacks.onApply(model as CFilterModelEntry | null);
        },
        onClose: callbacks.onClose,
        onModified: callbacks.onModified,
        buttons: params.buttons,
        closeOnApply: params.closeOnApply ?? true,
        suppressMiniFilter: params.suppressMiniFilter,
        suppressSelectAll: params.suppressSelectAll,
        caseSensitive: params.caseSensitive,
      });
    }).catch((err) => {
      if (!this.destroyed) console.error('[velocity-grid] getDistinctValues:', err);
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

  /** Cycle 21d / Task 13 — distinct stringified values for `colId`, in
   *  first-seen row order (worker DistinctValuesPass; nulls dropped).
   *  `limit` truncates the reply; the worker cache keeps the full set so
   *  different limits share one derivation. Public surface for
   *  @wellsfargo-starui/velocity-grid-calc's typed wrapper + apps.
   *
   *  Sparse SSRM: prefer the expression host (Perspective table) — the
   *  worker store only holds hydrated windows and often answers `[]`. */
  getDistinctValues(colId: string, limit?: number): Promise<string[]> {
    if (this.ssrm && !this.ssrmClientPipeline) {
      const host = this.ssrmExpressionHost;
      if (host && typeof host.getDistinctValues === 'function') {
        return host.getDistinctValues(colId, limit).then((values) => {
          if (values.length > 0) return values;
          return this.distinctValuesFromMirror(colId, limit);
        }).catch(() => this.distinctValuesFromMirror(colId, limit));
      }
      return Promise.resolve(this.distinctValuesFromMirror(colId, limit));
    }
    return this.workerCoord.getDistinctValues(colId, limit);
  }

  /** Distinct values from the main-thread SSRM hydrate mirror. */
  private distinctValuesFromMirror(colId: string, limit?: number): string[] {
    const field = this.columnDefsMap.get(colId)?.field ?? colId;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of this.rowDataById.values()) {
      const v = (row as Record<string, unknown>)[field as string];
      if (v == null) continue;
      const s = String(v);
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (limit != null && out.length >= limit) break;
    }
    return out;
  }

  /** Cycle 21g / Task 10 — fetch full rows by current visible-order index
   *  (batched worker round-trip). One entry per requested index, order
   *  preserved; null for out-of-range indexes. Dedupes indexes before
   *  fetching — one `workerCoord.getRowByIndex` per UNIQUE index,
   *  `Promise.all`'d (precedents: `serializeRangesMainSide`'s Set-dedupe
   *  + parallel batch, `commitFill`'s parallel fetch) — then maps results
   *  back onto every requested (possibly duplicate) input index. Guards
   *  at entry AND after the `Promise.all`: a destroy mid-flight resolves
   *  an all-null array of `rowIndexes.length` rather than mapping stale
   *  fetches, keeping 1:1 alignment with the input even on the teardown
   *  path. Empty input resolves `[]` with no worker traffic. */
  getRowsByIndex(rowIndexes: number[]): Promise<Array<{ rowIndex: number; rowId: string; data: TRow } | null>> {
    if (this.destroyed) return Promise.resolve(rowIndexes.map(() => null));
    if (rowIndexes.length === 0) return Promise.resolve([]);
    const uniqueIndexes = Array.from(new Set(rowIndexes));
    return Promise.all(
      uniqueIndexes.map((rowIndex) =>
        this.workerCoord.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
      ),
    ).then((fetched) => {
      if (this.destroyed) return rowIndexes.map(() => null);
      const byIndex = new Map(fetched.map((f) => [f.rowIndex, f]));
      return rowIndexes.map((rowIndex) => {
        const f = byIndex.get(rowIndex);
        if (!f || f.rowId == null || f.data == null) return null;
        return { rowIndex, rowId: f.rowId, data: f.data as TRow };
      });
    });
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

  /** Cycle 13 / Task 2 — total pre-filter row count. CSRM: size of the
   *  main-thread `rowDataById` mirror. SSRM: same as displayed count
   *  (the datasource owns filtering; `rowDataById` is only a hydrate
   *  cache and must not drive the status bar). */
  getTotalRowCount(): number {
    if (this.ssrm) return this.rowCount;
    return this.rowDataById.size;
  }

  /** Cycle 21e / Task 10 — iterate every row in the main-thread
   *  `rowDataById` mirror (setRowData + all transaction paths keep it in
   *  sync since Cycle 7 / Task 8). Insertion order. Used by
   *  @wellsfargo-starui/velocity-grid-rules' wireIntoKernel to seed match counts. */
  forEachRow(fn: (rowId: string, row: TRow) => void): void {
    for (const [rowId, row] of this.rowDataById) fn(rowId, row);
  }

  /** Cycle 19 / Task 5-Grouping — public grouping API delegates. The
   *  coordinator owns the model + the worker round-trip + the
   *  auto-hide-on-group / restore-on-ungroup pass. */
  setGroupModel(g: GroupModel): void {
    if (!this.destroyed) this.grouping.setGroupModel(g);
  }

  /**
   * SSRM → CSRM feature bridge: fully hydrate the book, then toggle the
   * worker client pipeline so grouping / pivot / filter / sort / totals
   * run through the same passes as `rowModelType: 'clientSide'`.
   */
  private ssrmWantsClientPipeline(): boolean {
    if (this.options.rowModelType !== 'serverSide') return false;
    const opt = this.options.serverSideEnableClientSidePipeline;
    if (opt === false) return false;
    // v2 skeleton datasource serves grouping natively on the sparse path —
    // never auto-download the book; the pipeline is explicit opt-in only.
    if (this.ssrmV2) return opt === true;
    if (opt === true) return true;
    // auto (undefined): CSRM-shaping options were configured at construction.
    return this.hasSsrmCsrmFeatures();
  }

  /** Construction-time CSRM features that require the worker pipeline under SSRM. */
  private hasSsrmCsrmFeatures(): boolean {
    return (
      this.options.groupTotalRow != null
      || this.options.grandTotalRow != null
      || this.options.groupIncludeFooter === true
      || this.options.groupIncludeTotalFooter === true
      || this.options.rowGroupPanelShow != null
      || (this.options.initialState?.rowGroupColumns?.length ?? 0) > 0
      || this.pivotEngine.isPivotMode()
    );
  }

  private enableSsrmClientPipeline(): Promise<void> {
    if (!this.ssrm || this.destroyed) return Promise.resolve();
    if (this.ssrmClientPipeline) return Promise.resolve();
    const run = async (): Promise<void> => {
      if (!this.ssrm || this.destroyed) return;
      const hydrated = await this.ssrm.ensureFullyHydrated();
      if (!this.ssrm || this.destroyed) return;
      // Refused (grouped v2 stays sparse): running the CSRM pipeline over a
      // sparse store would treat skeleton group rows as leaf data.
      if (!hydrated) return;
      const reply = await this.workerCoord.ssrmSetClientPipeline(true);
      if (this.destroyed) return;
      this.ssrmClientPipeline = true;
      if (reply.groupKeys !== undefined) this.knownGroupKeys = reply.groupKeys;
      // Deferred groupDefaultExpanded seed may have fired on this rebuild.
      if (reply.expandedKeys !== undefined) {
        this.expandedKeys = reply.expandedKeys === null ? null : new Set(reply.expandedKeys);
      }
      this.rowCount = reply.visibleCount;
      this.rowHeightIndex = null;
      this.recomputeViewport();
      this.requestViewport('rowDataChanged');
    };
    this.ssrmPipelineChain = this.ssrmPipelineChain.then(run, run);
    return this.ssrmPipelineChain;
  }

  private disableSsrmClientPipeline(): Promise<void> {
    if (!this.ssrm || this.destroyed) return Promise.resolve();
    // Keep pipeline on when CSRM parity is requested for the life of the grid.
    if (this.ssrmWantsClientPipeline()) {
      return Promise.resolve();
    }
    if (!this.ssrmClientPipeline) return Promise.resolve();
    const run = async (): Promise<void> => {
      if (!this.ssrm || this.destroyed) return;
      await this.workerCoord.ssrmSetClientPipeline(false);
      if (this.destroyed) return;
      this.ssrmClientPipeline = false;
      this.ssrm.refresh({ purge: true });
    };
    this.ssrmPipelineChain = this.ssrmPipelineChain.then(run, run);
    return this.ssrmPipelineChain;
  }

  /** GroupingCoordinator seam — ensure SSRM can host GroupPass first. */
  private setWorkerGroupModelForSsrm(g: GroupModel): ReturnType<WorkerCoordinator['setGroupModel']> {
    // Sparse SSRM (v2 skeleton, or v1 with the pipeline explicitly off) —
    // the host owns group/agg. Purge so the next fetch reflects the new
    // rowGroupCols (v2: skeleton refetch); worker GroupPass stays off.
    if (this.isSparseSsrm()) {
      void this.ssrm?.refresh({ purge: true });
      return Promise.resolve({
        visibleCount: this.rowCount,
        groupKeys: [],
        groupDescendants: [],
        expandedKeys: null,
      });
    }
    const wantsGroup = g.rowGroupCols.length > 0;
    const prep = wantsGroup
      ? this.enableSsrmClientPipeline()
      : this.disableSsrmClientPipelineIfIdle();
    return prep.then(() => this.workerCoord.setGroupModel(g));
  }

  /** Drop client pipeline only when neither grouping nor pivot needs it. */
  private disableSsrmClientPipelineIfIdle(): Promise<void> {
    if (this.pivotEngine.isPivotMode()) return Promise.resolve();
    if (this.grouping.getRowGroupColumns().length > 0) return Promise.resolve();
    return this.disableSsrmClientPipeline();
  }

  // ─── Cycle 18 / Task 3 — pivot API + render wiring ─────────────────────

  isPivotMode(): boolean { return this.pivotEngine.isPivotMode(); }
  setPivotMode(pivotMode: boolean, opts?: { discardSettings?: boolean }): void {
    if (this.destroyed) return;
    if (this.ssrm && pivotMode) {
      // Sparse Perspective SSRM cannot build a pivot matrix (no full hydrate
      // while grouped; sample forces client pipeline off). Fail closed so
      // the Columns panel doesn't show Pivot ON with an empty/wrong grid.
      const sparsePerspective = this.ssrmExpressionHost != null
        && this.options.serverSideEnableClientSidePipeline === false;
      if (sparsePerspective) {
        console.warn(
          '[velocity-grid] Pivot mode is not supported on sparse Perspective SSRM. '
          + 'Use clientSide, or set serverSideEnableClientSidePipeline: true (full hydrate).',
        );
        return;
      }
      void this.enableSsrmClientPipeline().then(() => {
        if (this.destroyed) return;
        if (!this.ssrmClientPipeline) {
          console.warn(
            '[velocity-grid] Pivot mode aborted — SSRM could not fully hydrate for the client pipeline.',
          );
          return;
        }
        this.applyPivotModeChange(true, opts);
      });
      return;
    }
    if (this.ssrm && !pivotMode) {
      void this.disableSsrmClientPipelineIfIdle();
    }
    this.applyPivotModeChange(pivotMode, opts);
  }

  /** Shared body of setPivotMode after SSRM hydrate gating. */
  private applyPivotModeChange(
    pivotMode: boolean,
    opts?: { discardSettings?: boolean },
  ): void {
    // Cycle 21i / Phase 1 (user directive) — `discardSettings` (passed by
    // the Pivot Mode toggle in the columns tool panel, i.e. a user-driven
    // switch) gives a clean slate on the mode change so table-mode state
    // never leaks into pivot and vice versa. Programmatic setup
    // (`setPivotColumns(...); setPivotMode(true)`) omits it and keeps the
    // configured pivot. Clears the data-shaping config (row groups, pivot
    // + value roles, sort, filter); on → table every column becomes
    // visible with no grouping; on → pivot every role is cleared so the
    // tool panel reads "all deselected". Layout (widths/order/pinning) is
    // preserved.
    if (opts?.discardSettings && this.pivotEngine.isPivotMode() !== pivotMode) {
      this.setRowGroupColumns([]);
      this.setPivotColumns([]);
      for (const v of this.getValueColumns()) this.removeValueColumn(v.colId);
      this.setSortModel([]);
      this.setFilterModel({});
      if (!pivotMode) {
        const primaryIds = this.getColumnState()
          .map((c) => c.colId)
          .filter((id) => !isAutoGroupColumnId(id) && !id.startsWith('pivotcol'));
        this.setColumnsVisible(primaryIds, true);
      }
    }
    this.pivotEngine.setPivotMode(pivotMode);
  }
  getPivotColumns(): string[] { return this.pivotEngine.getPivotColumns(); }
  setPivotColumns(colIds: string[]): void {
    if (!this.destroyed) this.pivotEngine.setPivotColumns(colIds);
  }
  addPivotColumn(colId: string): void {
    if (!this.destroyed) this.pivotEngine.addPivotColumn(colId);
  }
  removePivotColumn(colId: string): void {
    if (!this.destroyed) this.pivotEngine.removePivotColumn(colId);
  }
  movePivotColumn(from: number, to: number): void {
    if (!this.destroyed) this.pivotEngine.movePivotColumn(from, to);
  }
  getValueColumns(): Array<{ colId: string; aggFunc: string }> {
    return this.pivotEngine.getValueColumnsApiShape();
  }
  addValueColumn(colId: string, aggFunc: string): void {
    if (!this.destroyed) this.pivotEngine.addValueColumn(colId, aggFunc);
  }
  removeValueColumn(colId: string): void {
    if (!this.destroyed) this.pivotEngine.removeValueColumn(colId);
  }
  /** Reorder a value column in-place — `from` and `to` are indices
   *  into the current `getValueColumns()` order. Drives the
   *  drag-to-reorder gesture inside the columns side-panel Values
   *  zone. */
  moveValueColumn(from: number, to: number): void {
    if (!this.destroyed) this.pivotEngine.moveValueColumn(from, to);
  }
  setValueColumnAggFunc(colId: string, aggFunc: string): void {
    if (!this.destroyed) this.pivotEngine.setValueColumnAggFunc(colId, aggFunc);
  }
  setValueColumns(list: Array<{ colId: string; aggFunc: string }>): void {
    if (!this.destroyed) this.pivotEngine.setValueColumns(list);
  }
  /** Synthesized pivot result column IDs — the cross-tabbed
   *  `pivot_<pivotKey>_<valueColId>` colIds the worker emits when
   *  pivot is active. Returns `[]` when pivot is inactive. Mirrors
   *  AG-Grid's `gridApi.getPivotResultColumns()`. */
  getPivotResultColumns(): string[] {
    return this.pivotEngine.getPivotResultColumns();
  }

  /** Cycle 19 / Task 5a — PivotEngine deps bundle. Threaded into the
   *  engine at construction so every reach into VelocityGrid state is
   *  explicit + auditable. The panel / worker fields are read at
   *  call-time closures — the engine is constructed BEFORE both
   *  come online, but mutation-driven callbacks only fire after the
   *  wiring lands. */
  private makePivotEngineDeps(): PivotEngineDeps<TRow> {
    return {
      events: this.events,
      isDestroyed: () => this.destroyed,
      getOptions: (): PivotEngineOptions => ({
        pivotDefaultExpanded: this.options.pivotDefaultExpanded,
        pivotGrandTotals: this.options.pivotGrandTotals,
        pivotRowTotals: this.options.pivotRowTotals ?? null,
        pivotColumnGroupTotals: this.options.pivotColumnGroupTotals ?? null,
        processPivotResultColDef: this.options.processPivotResultColDef as
          PivotEngineOptions['processPivotResultColDef'],
        processPivotResultColGroupDef: this.options.processPivotResultColGroupDef as
          PivotEngineOptions['processPivotResultColGroupDef'],
      }),
      workerColumns: () => this.workerColumns(),
      updateWorkerColumns: (cols) =>
        this.workerCoord.updateColumns(cols as WorkerColumn[]),
      setWorkerPivotModel: (model) => this.workerCoord.setPivotModel(model),
      setWorkerPivotMaxGeneratedColumns: (cap) =>
        this.workerCoord.setPivotMaxGeneratedColumns(cap),
      setWorkerStrictPivotColumnOrder: (strict) =>
        this.workerCoord.setStrictPivotColumnOrder(strict),
      requestViewport: () => this.requestViewport(),
      getPivotPanel: () => this.pivotPanel,
      getColumnTree: () => this.columnTree,
      setColumnTree: (tree) => { this.columnTree = tree; this.colGroupPathCache = null; },
      getColumnGroupState: () => this.columnGroupState,
      setColumnGroupState: (state) => { this.columnGroupState = state; },
      getColumnDefsMap: () => this.columnDefsMap,
      setColumnDefsMap: (map) => { this.columnDefsMap = map; },
      getAutoGroupColumns: () => this.grouping.getAutoGroupColumns(),
      subscribeColumnGroupState: () => this.subscribeColumnGroupState(),
      computeVisibleColumnOrder: () => this.computeVisibleColumnOrder(),
      setColumnOrder: (order) => { this.columnOrder = order; },
      getLayoutWidth: () =>
        this.canvasBounds.width || this.scroller.clientWidth || 800,
      setColumnLayout: (layout) => { this.columnLayout = layout; },
      rebuildSubgridStack: () => this.rebuildSubgridStack(),
      recomputeViewport: () => this.recomputeViewport(),
      requestRepaint: () => { this.cgridCanvas?.requestRepaint(); },
      applyVerticalInsets: () => this.applyVerticalInsets(),
      // Task 5b — pivot mode toggle drives the primary auto-hide pass
      // through the same seam the panel + `applyColumnState` use.
      setColumnsVisible: (colIds, visible) => this.setColumnsVisible(colIds, visible),
    };
  }

  /** Cycle 19 / Task 5-Grouping — GroupingCoordinator deps bundle.
   *  Threaded into the coordinator at construction so every reach into
   *  VelocityGrid state is explicit + auditable. The panel field is read at
   *  call-time closure — the coordinator is constructed BEFORE the row
   *  group panel comes online, but state-change callbacks only fire
   *  after the wiring lands. */
  private makeGroupingCoordinatorDeps(): GroupingCoordinatorDeps<TRow> {
    return {
      events: this.events,
      isDestroyed: () => this.destroyed,
      getOptions: (): GroupingCoordinatorOptions => ({
        suppressGroupChangesColumnVisibility: this.options.suppressGroupChangesColumnVisibility,
        groupDisplayType: this.options.groupDisplayType,
        autoGroupColumnDef: this.options.autoGroupColumnDef as
          GroupingCoordinatorOptions['autoGroupColumnDef'],
        groupRowRenderer: this.options.groupRowRenderer,
      }),
      workerColumns: () => this.workerColumns(),
      updateWorkerColumns: (cols) =>
        this.workerCoord.updateColumns(cols as WorkerColumn[]),
      setWorkerGroupModel: (g) => this.setWorkerGroupModelForSsrm(g),
      getRowGroupPanel: () => this.rowGroupPanel,
      getColumnTree: () => this.columnTree,
      getColumnDefsMap: () => this.columnDefsMap,
      computeVisibleColumnOrder: () => this.computeVisibleColumnOrder(),
      setColumnOrder: (order) => { this.columnOrder = order; },
      getLayoutWidth: () =>
        this.canvasBounds.width || this.scroller.clientWidth || 800,
      setColumnLayout: (layout) => { this.columnLayout = layout; },
      recomputeViewport: () => this.recomputeViewport(),
      requestRepaint: () => { this.cgridCanvas?.requestRepaint(); },
      requestViewport: () => this.requestViewport(),
      setExpandedKeys: (keys) => { this.expandedKeys = keys; },
      getExpandedKeysMirror: () => this.expandedKeys,
      flushPendingExpandedRoutes: () => this.flushPendingExpandedRoutes(),
      hasPendingExpandedRoutes: () => this.hasPendingExpandedRoutes(),
      shipExpandedKeys: (keys) => this.shipExpandedKeys(keys),
      setKnownGroupKeys: (keys) => { this.knownGroupKeys = keys; },
      updateGroupDescendantsCache: (keys, desc) =>
        this.updateGroupDescendantsCache(keys, desc),
      setRowCount: (n) => { this.rowCount = n; },
      invalidateRowHeightIndex: () => { this.rowHeightIndex = null; },
      groupCellContextAt: (rowIndex) => this.groupCellContextAt(rowIndex),
      setColumnsVisible: (colIds, visible) => this.setColumnsVisible(colIds, visible),
      isPivotMode: () => this.pivotEngine.isPivotMode(),
      getSortModel: () => this.sortModel,
      setSortModel: (model) => this.setSortModel(model),
    };
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
    this.setGroupModel(this.grouping.getGroupModel());
  }

  expandAll(): void {
    if (this.destroyed) return;
    // Sparse SSRM — the null sentinel maps to the DEFAULT expansion set,
    // not expand-all; ship an explicit all-keys set instead.
    if (this.isSparseSsrm()) {
      this.expandedKeys = new Set(this.knownGroupKeys);
      this.shipExpandedKeys(Array.from(this.expandedKeys));
    } else {
      this.expandedKeys = null;
      this.shipExpandedKeys(null);
    }
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

  /**
   * Sparse SSRM with host-owned grouping + `groupDefaultExpanded: 0`.
   * In that mode `expandedKeys === null` means "not yet toggled — all
   * collapsed", matching `getRows` / painted chevrons. CSRM (and SSRM
   * client pipeline) still treat null as the expand-all sentinel.
   */
  /**
   * Sparse-SSRM default expansion for the null sentinel — mirrors the
   * worker GroupPass rules over `knownGroupKeys` (AG semantics:
   * `isGroupOpenByDefault` wins, then `groupDefaultExpandedKeys`, then
   * `groupDefaultExpanded`: -1/'all' = everything, N = number of LEVELS
   * open, 0/other negatives = nothing). Depth derives from the composite
   * key's segment count.
   */
  private sparseDefaultExpandedKeys(): Set<string> {
    const cb = this.options.isGroupOpenByDefault;
    if (cb) {
      const set = new Set<string>();
      for (const key of this.knownGroupKeys) {
        const route = parseCompositeGroupKey(key).map((s) => s.value);
        try {
          if (cb({ key, route })) set.add(key);
        } catch { /* skip */ }
      }
      return set;
    }
    if (this.options.groupDefaultExpandedKeys !== undefined) {
      return new Set(this.options.groupDefaultExpandedKeys);
    }
    const d = this.options.groupDefaultExpanded ?? 0;
    if (d === 'all' || d === -1) return new Set(this.knownGroupKeys);
    if (typeof d === 'number' && d > 0) {
      const set = new Set<string>();
      for (const key of this.knownGroupKeys) {
        const depth = key.split('::').length - 1;
        if (depth < d) set.add(key);
      }
      return set;
    }
    return new Set();
  }

  /** Under the null sentinel, is `groupKey` expanded? CSRM: yes (null =
   *  expand-all). Sparse SSRM: membership in the default expansion set. */
  private isKeyExpandedUnderNullSentinel(groupKey: string): boolean {
    if (this.isSparseSsrm()) return this.sparseDefaultExpandedKeys().has(groupKey);
    return true;
  }

  /** Host-owned-grouping SSRM: v2 skeleton datasource, or v1 with the
   *  client pipeline explicitly disabled. Falls back to the construction
   *  options before the controller mounts (the grouping coordinator can
   *  ship the initial group model earlier in construction). */
  private isSparseSsrm(): boolean {
    if (this.options.rowModelType !== 'serverSide') return false;
    if (this.options.serverSideEnableClientSidePipeline === false) return true;
    if (this.ssrm !== null) return this.ssrmV2 && !this.ssrmClientPipeline;
    return isServerSideDatasourceV2(this.options.serverSideDatasource);
  }

  /** Materialise an explicit set when leaving the null sentinel. */
  private materializeExpandedKeysFromNull(): Set<string> {
    if (this.isSparseSsrm()) return this.sparseDefaultExpandedKeys();
    return new Set(this.knownGroupKeys);
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
    // the null sentinel.
    let next: Set<string>;
    if (this.expandedKeys === null) {
      const defaultExpanded = this.isKeyExpandedUnderNullSentinel(groupKey);
      if (expanded === defaultExpanded) return;
      next = this.materializeExpandedKeysFromNull();
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
   *  honest about which keys are open. Sparse SSRM with
   *  `groupDefaultExpanded: 0` treats null as all-collapsed. */
  getExpandedKeys(): Set<string> {
    if (this.expandedKeys === null) {
      return this.materializeExpandedKeysFromNull();
    }
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
    // Sparse SSRM — expansion state drives the flattened order. v2: local
    // skeleton reflow (same frame). v1: `refreshExpansion` drops the whole
    // block cache (a toggle shifts every flattened index below it;
    // band-only invalidation left stale rows to rehydrate at old offsets).
    if (this.ssrm && !this.ssrmClientPipeline && this.isSparseSsrm()) {
      void this.ssrm.refreshExpansion().then(() => {
        if (this.destroyed) return;
        this.rowHeightIndex = null;
        this.recomputeViewport();
        this.cgridCanvas.requestRepaint();
        this.requestViewport();
      }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid]', err); });
      return;
    }
    this.workerCoord
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
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid]', err); });
  }

  /** Apply stashed `expandedRouteIds` from `setState` once grouping is
   *  active on the main thread. Returns true when pending keys were
   *  consumed (including the empty "all collapsed" set). Returns false
   *  only when there is nothing pending — callers must not seed
   *  groupDefaultExpanded in that case when a restore is still queued
   *  behind a failed worker round-trip; use `hasPendingExpandedRoutes`. */
  private flushPendingExpandedRoutes(): boolean {
    if (this.pendingExpandedRouteIds === null) return false;
    if (this.grouping.getRowGroupColumns().length === 0) {
      // Ungrouped restore — drop the stash; nothing to expand.
      this.pendingExpandedRouteIds = null;
      this.expandedKeys = new Set();
      return true;
    }
    const ids = this.pendingExpandedRouteIds;
    this.pendingExpandedRouteIds = null;
    this.expandedKeys = new Set(ids);
    this.shipExpandedKeys(ids);
    return true;
  }

  /** True while `setState` has stashed expand/collapse keys that have
   *  not yet been flushed to the worker. */
  private hasPendingExpandedRoutes(): boolean {
    return this.pendingExpandedRouteIds !== null;
  }

  /** Cycle 15 / Task 8 — re-fetch the worker's descendant snapshot
   *  without flipping the emission flag. Used after `modelUpdated`
   *  pushes (data transactions / sort / filter) when
   *  `groupSelectsChildren` is on, so the membership cache stays in
   *  lockstep with the worker's tree. Fire-and-forget; a stale paint
   *  for one frame is acceptable while the round-trip resolves. */
  private refreshGroupDescendantsCache(): void {
    this.workerCoord
      .setEmitGroupDescendants(true)
      .then(({ groupKeys, groupDescendants }) => {
        if (this.destroyed) return;
        this.knownGroupKeys = groupKeys;
        this.updateGroupDescendantsCache(groupKeys, groupDescendants);
        this.cgridCanvas?.requestRepaint();
      })
      .catch((err) => {
        if (!this.destroyed) console.error('[velocity-grid] refreshGroupDescendantsCache:', err);
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
      const { groupKeys, groupDescendants } = await this.workerCoord
        .setEmitGroupDescendants(enabled);
      if (this.destroyed) return;
      this.knownGroupKeys = groupKeys;
      this.updateGroupDescendantsCache(groupKeys, enabled ? groupDescendants : undefined);
    } catch (err) {
      if (!this.destroyed) console.error('[velocity-grid] setEmitGroupDescendants:', err);
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

  /** Cycle 19 / Task 5-Grouping — primitive grouping API delegates.
   *  The coordinator owns the `GroupingState` primitive; the
   *  `groupingStateChanged` handler downstream ships the model swap
   *  to the worker (or merges the per-level sort into the sort model
   *  on a pure-sort change). */
  setRowGroupColumns(columns: string[]): void {
    if (!this.destroyed) this.grouping.setRowGroupColumns(columns);
  }
  addRowGroupColumn(colId: string): void {
    if (!this.destroyed) this.grouping.addRowGroupColumn(colId);
  }
  removeRowGroupColumn(colId: string): void {
    if (!this.destroyed) this.grouping.removeRowGroupColumn(colId);
  }
  /** AG v33 plural form — appends each column in order. */
  addRowGroupColumns(colIds: string[]): void {
    for (const colId of colIds) this.addRowGroupColumn(colId);
  }
  /** AG v33 plural form — removes each listed column. */
  removeRowGroupColumns(colIds: string[]): void {
    for (const colId of colIds) this.removeRowGroupColumn(colId);
  }
  moveRowGroupColumn(from: number, to: number): void {
    if (!this.destroyed) this.grouping.moveRowGroupColumn(from, to);
  }
  setRowGroupColumnSort(colId: string, direction: 'asc' | 'desc' | null): void {
    if (!this.destroyed) this.grouping.setRowGroupColumnSort(colId, direction);
  }
  getRowGroupColumns(): string[] {
    return this.grouping.getRowGroupColumns();
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
    if (this.columnDefsMap.get(colId)?.enableRowGroup === true) return true;
    // Pivot mode swaps source colDefs out of columnDefsMap; fall through
    // to the preserved `primaryColumnTree` so the source columns'
    // eligibility flags remain queryable for cross-section pill drags.
    return this.pivotEngine.getPrimaryColumnTree()?.leafById.get(colId)?.enableRowGroup === true;
  }

  /** Cycle 18 / Task 5 — `true` when the column's resolved colDef carries
   *  `enablePivot: true`. Gates whether the columns tool panel + context
   *  menu offer the "add as pivot" affordance. Mirrors the
   *  `isColumnRowGroupEnabled` shape; same class+API duality.
   *
   *  When pivot is active `columnDefsMap` is replaced by the synthesised
   *  pivot result columns; the original source colDefs (the ones the
   *  user marked with `enablePivot: true`) live on `primaryColumnTree`.
   *  The fall-through preserves the eligibility flags during pivot mode
   *  so cross-section drags (Row Groups → Column Labels) can still
   *  check them. */
  isColumnPivotEnabled(colId: string): boolean {
    if (this.columnDefsMap.get(colId)?.enablePivot === true) return true;
    return this.pivotEngine.getPrimaryColumnTree()?.leafById.get(colId)?.enablePivot === true;
  }

  /** Cycle 18 / Task 5 — `true` when the column's resolved colDef carries
   *  `enableValue: true`. Gates whether the columns tool panel + context
   *  menu offer the "add as value/aggregation" affordance. */
  isColumnValueEnabled(colId: string): boolean {
    if (this.columnDefsMap.get(colId)?.enableValue === true) return true;
    return this.pivotEngine.getPrimaryColumnTree()?.leafById.get(colId)?.enableValue === true;
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
   *  `VelocityGridOptions.aggFuncs` / `setGridOption('aggFuncs', …)`. `first` /
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
   *  hit-test on the public VelocityGridApi so external drag sources (columns
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

  /** Cross-section pill drag routing — resolve the panel role at a
   *  viewport-coord point. Walks `elementFromPoint` upward for the
   *  first `data-vg-pill-role` marker; returns `null` outside any
   *  panel. See `core/panelDragMove.ts`. */
  resolveDragTargetRole(clientX: number, clientY: number): PillPanelRole | null {
    if (this.destroyed) return null;
    return resolveDragTargetRoleHelper(clientX, clientY);
  }

  /** Cross-section pill drag routing — atomically move `colId` from
   *  `fromRole` to `toRole`. Each pill drag handler calls this on
   *  pointerup when the drop lands on a foreign panel. Returns `true`
   *  on success; `false` when the source equals the target OR the
   *  target rejects the column (no matching `enableRowGroup` /
   *  `enablePivot` / `enableValue` flag). Rejection is silent — the
   *  source role is preserved so an accidental drop doesn't lose the
   *  column. */
  commitPanelMove(fromRole: PillPanelRole, toRole: PillPanelRole, colId: string): boolean {
    if (this.destroyed) return false;
    return commitPanelMoveHelper(this.panelMoveApi(), fromRole, toRole, colId);
  }

  /** Narrow surface that `commitPanelMove` consumes. Kept private so
   *  the helper can be exercised against this exact shape via the
   *  public `commitPanelMove` entry. */
  private panelMoveApi(): PanelMoveApi {
    return {
      isColumnRowGroupEnabled: (c) => this.isColumnRowGroupEnabled(c),
      isColumnPivotEnabled: (c) => this.isColumnPivotEnabled(c),
      isColumnValueEnabled: (c) => this.isColumnValueEnabled(c),
      getRowGroupColumns: () => this.getRowGroupColumns(),
      getPivotColumns: () => this.getPivotColumns(),
      getValueColumns: () => this.getValueColumns().map((v) => ({ colId: v.colId })),
      addRowGroupColumn: (c) => this.addRowGroupColumn(c),
      removeRowGroupColumn: (c) => this.removeRowGroupColumn(c),
      addPivotColumn: (c) => this.addPivotColumn(c),
      removePivotColumn: (c) => this.removePivotColumn(c),
      addValueColumn: (c, agg) => this.addValueColumn(c, agg ?? 'sum'),
      removeValueColumn: (c) => this.removeValueColumn(c),
      getColumnDefaultAggFunc: (c) => {
        const agg = this.columnDefsMap.get(c)?.aggFunc;
        return typeof agg === 'string' ? agg : undefined;
      },
    };
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
    const leafHeight = this.effectiveLeafHeaderHeight();
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
      line.className = 'vg-column-drag-insertion-line';
      line.style.cssText = [
        'position:absolute',
        'pointer-events:none',
        'top:0',
        'left:0',
        'width:2px',
        'height:100%',
        'background:var(--vg-selected-cell-color, #3b82f6)',
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
    // Dragging from the columns side panel onto the header band can
    // target a column that is currently hidden — un-hide it first so
    // the drop visibly adds the column to the grid. Visible columns
    // are no-op for setColumnsVisible (idempotent).
    const stateEntry = this.getColumnState().find((s) => s.colId === colId);
    if (stateEntry?.hide === true) this.setColumnsVisible([colId], true);
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
      this.grouping.getRowGroupColumns(),
      this.grouping.getGroupingState().getPerLevelSort(),
      { suppressSort: this.options.rowGroupPanelSuppressSort === true },
    );
    this.setRowGroupPanelTop(this.statusBarInsets.top);
  }

  /** Cycle 18 / Task 6 — runtime swap of `pivotPanelShow`. When the
   *  option mutates via `setGridOption`, this method either mounts a
   *  fresh host (transition from `'never'`), unmounts the current one
   *  (transition to `'never'`), or hands the new mode to the existing
   *  host. */
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
      this.pivotEngine.getPivotColumns(),
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
      getHeaderName: (colId) =>
        this.columnDefsMap.get(colId)?.headerName
        ?? this.pivotEngine.getPrimaryColumnTree()?.leafById.get(colId)?.headerName,
      // Pivot mode swaps source colDefs out of `columnDefsMap`; fall
      // through to `primaryColumnTree` so the pivot panel still
      // accepts drops of source columns that carry `enablePivot`.
      isColumnPivotEnabled: (colId) => this.isColumnPivotEnabled(colId),
      addPivotColumn: (colId) => this.pivotEngine.addPivotColumn(colId),
      removePivotColumn: (colId) => this.pivotEngine.removePivotColumn(colId),
      movePivotColumn: (from, to) => this.pivotEngine.movePivotColumn(from, to),
      // Cycle 19 / Task 5b — the pivot panel's `data-active` reflects
      // "PivotState is configured to pivot" (mode + ≥1 pivot col + ≥1
      // value col), not the internal tree-swap flag that only flips
      // after the worker chunk lands. Task 5a extracted this callback
      // and inadvertently switched it to the internal `active` field,
      // which produced a chunk-arrival delay for `data-active='true'`
      // that the `onlyWhenPivoting` E2E test caught intermittently.
      // Restored to the state-based check via `isPivotStateActive()`.
      isPivotActive: () => this.pivotEngine.isPivotStateActive(),
      tryCrossPanelMove: (colId, x, y) => this.tryCrossPanelMoveFrom('pivot', colId, x, y),
    };
  }

  /** Cycle 15.5 / Task 1 — build the per-host context object shared by
   *  the construction-time path and the runtime-show-flip path. Routes
   *  every primitive mutation through the grouping coordinator's
   *  `GroupingState`; the coordinator's state-change handler downstream
   *  lands the model swap on the worker. */
  private makeRowGroupPanelContext(): RowGroupPanelGridContext {
    return {
      setReservedSpace: (side, height) => this.reserveRowGroupPanelSpace(side, height),
      getHeaderName: (colId) =>
        this.columnDefsMap.get(colId)?.headerName
        ?? this.pivotEngine.getPrimaryColumnTree()?.leafById.get(colId)?.headerName,
      // Pivot mode swaps source colDefs out of `columnDefsMap`; fall
      // through to `primaryColumnTree` so the row-group panel still
      // accepts drops of source columns that carry `enableRowGroup`.
      isColumnRowGroupEnabled: (colId) => this.isColumnRowGroupEnabled(colId),
      addRowGroupColumn: (colId) => this.grouping.addRowGroupColumn(colId),
      removeRowGroupColumn: (colId) => this.grouping.removeRowGroupColumn(colId),
      moveRowGroupColumn: (from, to) => this.grouping.moveRowGroupColumn(from, to),
      setRowGroupColumnSort: (colId, direction) =>
        this.grouping.setRowGroupColumnSort(colId, direction),
      tryCrossPanelMove: (colId, x, y) => this.tryCrossPanelMoveFrom('rowGroup', colId, x, y),
      hidePanel: () => this.setGridOption('rowGroupPanelShow', 'never'),
    };
  }

  /** Helper invoked by each pill drag handler on pointerup-outside-the-source-panel.
   *  Resolves the panel role under (x, y) and commits a move if the
   *  target is foreign + accepts the column. Returns the boolean
   *  result of `commitPanelMove` (`true` on success). */
  private tryCrossPanelMoveFrom(fromRole: PillPanelRole, colId: string, clientX: number, clientY: number): boolean {
    const target = this.resolveDragTargetRole(clientX, clientY);
    if (target === null) return false;
    if (target === fromRole) return false;
    return this.commitPanelMove(fromRole, target, colId);
  }

  /** Resolve `rowId` to its current visible-row index via the worker, then
   *  scroll it into view. No-op when the row is unknown / filtered out. */
  async ensureRowVisible(rowId: string, position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto'): Promise<void> {
    if (this.destroyed) return;
    const idx = await this.workerCoord.getRowIndexForId(rowId);
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
    // `rowIdAt`, which resolves the real string id from the loaded chunk and
    // only synthesizes `row-${idx}` for indices outside that window.
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
      this.workerCoord.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
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
      if (!this.destroyed) console.error('[velocity-grid] clearSelectedCells:', err);
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
        this.workerCoord.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
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
      if (!this.destroyed) console.error('[velocity-grid] fillDown:', err);
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
    this.workerCoord.getRowIndicesForIds(ids).then((indices) => {
      if (this.destroyed) return;
      this.selection.setSelectedRowIds(ids, Array.from(indices));
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid] setSelectedRowIds:', err); });
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
    this.workerCoord.getRowIndicesForIds([rowId]).then((idx) => {
      if (this.destroyed) return;
      const resolved = idx.length > 0 ? idx[0]! : -1;
      if (resolved >= 0) this.ensureRowIndexVisible(resolved);
      this.ensureColIdVisible(colId);
      this.selection.setFocusByRowId(rowId, colId, resolved);
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid] setFocusedCell:', err); });
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
  async copySelectedRangesToClipboard(opts?: { includeHeaders?: boolean }): Promise<void> {
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
    // Cycle 21i / Phase 1 — under active pivot the visible cells are
    // cross-tab aggregates that live in the chunk (not in the leaf source
    // rows the worker/main-side leaf serializers read), so those paths
    // return blank cells. Serialize "what you see" via `cellAt`, which
    // resolves pivot result cells + the auto-group column + formatting.
    const body = this.pivotEngine.isPivotActive()
      ? this.serializeRangesViaCellAt(ranges, delimiter, transform)
      : transform
        ? await this.serializeRangesMainSide(ranges, delimiter, transform)
        : await this.workerCoord.clipboardSerialize(ranges, delimiter);
    // Cycle 21i / Phase 1 — "Copy with Headers" prepends a header row of
    // the selected columns' header names (in column order), delimiter- and
    // newline-joined to match the body TSV.
    const tsv = opts?.includeHeaders
      ? `${this.clipboardHeaderLine(ranges, delimiter)}\n${body}`
      : body;
    // `navigator.clipboard.writeText` requires a user gesture in every
    // mainstream browser; the keyboard / menu handlers already run
    // inside one. Apps that invoke this from a `setTimeout` get a
    // rejected promise back — that's the expected platform behavior.
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      throw new Error('clipboard-unavailable');
    }
    // Cycle 21c / Task 15 — multi-format write when the copied range
    // touches a composite column. text/plain stays byte-identical to
    // the plain path (the worker/main-side TSV above); text/html adds
    // styled <span> runs per composite fragment so Excel / Sheets
    // paste keeps the formatting. Feature-detected: environments
    // without ClipboardItem / clipboard.write fall back to writeText.
    const hasComposite = ranges.some((range) =>
      range.colIds.some((colId) => this.columnDefsMap.get(colId)?._compositeProgram !== undefined),
    );
    if (hasComposite) {
      const clip = navigator.clipboard as Clipboard & { write?: (items: ClipboardItem[]) => Promise<void> };
      if (typeof ClipboardItem !== 'undefined' && typeof clip.write === 'function') {
        const html = await this.serializeRangesToHtml(ranges, opts?.includeHeaders === true);
        const item = new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        });
        await clip.write([item]);
        return;
      }
      console.debug('[cgrid.clipboard] rich copy unavailable, using plain text');
    }
    await navigator.clipboard.writeText(tsv);
  }

  /** Cycle 21i / Phase 1 — serialize ranges from the painter's own cell
   *  resolver (`cellAt`), so pivot cross-tab cells, group/auto-group
   *  cells, and totals serialize as their displayed value. Reuses the
   *  pure serializer by projecting each cell's value onto a per-row
   *  object keyed by colId (field === colId). Cells outside the loaded
   *  chunk resolve to '' (the pivot matrix is small and typically fully
   *  loaded). `transform` (processCellForClipboard) still applies. */
  private serializeRangesViaCellAt(
    ranges: SelectionRange[],
    delimiter: string,
    transform: VelocityGridOptions<TRow>['processCellForClipboard'],
  ): string {
    const rows: Array<Record<string, unknown> | undefined> = [];
    const colIds = new Set<string>();
    for (const range of ranges) {
      for (const id of range.colIds) colIds.add(id);
      for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex++) {
        if (rows[rowIndex] !== undefined) continue;
        const obj: Record<string, unknown> = {};
        for (const id of range.colIds) {
          const cell = this.cellAt(rowIndex, id);
          // Primitive value (pivot aggregate number, plain text) copies
          // raw so it pastes as a number; the auto-group / group cells
          // carry an object value whose label lives in valueFormatted.
          obj[id] = cell == null
            ? ''
            : (cell.value !== null && typeof cell.value === 'object'
                ? cell.valueFormatted
                : cell.value);
        }
        rows[rowIndex] = obj;
      }
    }
    const columnsById = new Map<string, { field?: string }>();
    for (const id of colIds) columnsById.set(id, { field: id });
    return serializeRangesPure(rows, columnsById, ranges, delimiter, transform
      ? (params) => transform({
          value: params.value,
          node: { rowIndex: params.node.rowIndex, data: params.node.data as TRow },
          column: { colId: params.column.colId },
        })
      : undefined);
  }

  /** Cycle 21i / Phase 1 — the header row for "Copy with Headers": the
   *  distinct column headerNames touched by `ranges`, ordered by the
   *  grid's column order, joined by `delimiter`. */
  private clipboardHeaderLine(ranges: SelectionRange[], delimiter: string): string {
    const orderIdx = new Map(this.columnOrder.map((c, i) => [c.colId, i]));
    const ids = [...new Set(ranges.flatMap((r) => r.colIds))].sort(
      (a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0),
    );
    return ids
      .map((id) => this.columnDefsMap.get(id)?.headerName ?? id)
      .join(delimiter);
  }

  /** Cycle 21c / Task 15 — build the text/html clipboard flavor for
   *  ranges that include composite columns. Fetches the touched rows
   *  main-side (composite programs are main-thread closures — they
   *  don't cross postMessage), resolves fragments per composite cell,
   *  and falls back to formatted plain text for regular columns. */
  private async serializeRangesToHtml(ranges: SelectionRange[], includeHeaders = false): Promise<string> {
    const rowIndexSet = new Set<number>();
    for (const range of ranges) {
      for (let i = range.rowStart; i <= range.rowEnd; i++) rowIndexSet.add(i);
    }
    const indexArr = Array.from(rowIndexSet);
    const fetched = await Promise.all(indexArr.map((rowIndex) =>
      this.workerCoord.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
    ));
    if (this.destroyed) return '';
    const rowsByIndex = new Map<number, Record<string, unknown>>();
    for (const r of fetched) {
      if (r.data != null) rowsByIndex.set(r.rowIndex, r.data as Record<string, unknown>);
    }

    const out: RowExport[] = [];
    for (const range of ranges) {
      for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex++) {
        const rowData = rowsByIndex.get(rowIndex) ?? {};
        const cells: RowExport['cells'] = [];
        for (const colId of range.colIds) {
          const def = this.columnDefsMap.get(colId);
          if (!def) {
            cells.push({ text: '' });
            continue;
          }
          const value = rowData[(def.field as string | undefined) ?? colId];
          const program = def._compositeProgram;
          if (program) {
            // Cycle 21e / final-review fix — rule-aware ctx so copied
            // composite fragments carry resolved rule:<ruleId> colors,
            // matching what the painter shows.
            const evalCtx = buildFormatEvalCtx({
              value,
              data: rowData,
              colId,
              rowId: this.stringRowIdAt(rowIndex) ?? undefined,
              themeKind: this.getThemeKind(),
            });
            const fragments = program.resolveFragments(evalCtx);
            cells.push({
              text: program.formatText(evalCtx),
              fragments: (fragments ?? []).map((f) => ({
                text: f.text,
                style: (f.style ?? {}) as Record<string, string | number | undefined>,
              })),
            });
            continue;
          }
          const text = def.valueFormatter
            ? def.valueFormatter({ value, data: rowData as TRow, colId })
            : value == null ? '' : String(value);
          cells.push({ text });
        }
        out.push({ cells });
      }
    }
    if (includeHeaders) {
      const orderIdx = new Map(this.columnOrder.map((c, i) => [c.colId, i]));
      const ids = [...new Set(ranges.flatMap((r) => r.colIds))].sort(
        (a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0),
      );
      out.unshift({
        cells: ids.map((id) => ({ text: this.columnDefsMap.get(id)?.headerName ?? id })),
      });
    }
    return serializeToHtml(out);
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
    const rows = await this.workerCoord.getExportRows({
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
    const buffer = await this.workerCoord.exportData({
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
      buffer = await this.workerCoord.exportData({
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
    const buffer = await this.workerCoord.exportData({
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
      buffer = await this.workerCoord.exportData({
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
    transform: NonNullable<VelocityGridOptions<TRow>['processCellForClipboard']>,
  ): Promise<string> {
    // Collect every visible row index touched by any range; batch-fetch
    // the rows in one Promise.all to keep the worker round-trips parallel.
    const rowIndexSet = new Set<number>();
    for (const range of ranges) {
      for (let i = range.rowStart; i <= range.rowEnd; i++) rowIndexSet.add(i);
    }
    const indexArr = Array.from(rowIndexSet);
    const fetched = await Promise.all(indexArr.map((rowIndex) =>
      this.workerCoord.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
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
    const parsed = await this.workerCoord.clipboardDeserialize(text, delimiter);
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
      this.workerCoord.getRowByIndex(rowIndex).then((fetched) => ({ rowIndex, fetched })),
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
      this.workerCoord.getRowByIndex(rowIndex).then((r) => ({ rowIndex, ...r })),
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
    console.warn(`[velocity-grid] ${method} suppressed by suppressClipboardApi`);
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

  /**
   * Damage-region rendering — record a full-surface repaint on the ledger
   * and request the next frame. Equivalent to today's `refresh()`/
   * `requestRepaint()` but goes through the ledger so a `suppressPartialRepaint`
   * flip mid-frame-batch can't leave stale partial damage queued underneath
   * a full one (`DamageLedger.add({kind:'full'})` clears any pending entries).
   */
  private repaintFull(): void {
    this.damageLedger.add({ kind: 'full' });
    this.cgridCanvas?.requestRepaint();
  }

  /**
   * Damage-region rendering — record damage for a set of DATA-row indices
   * (same index space as `cellAt`'s `rowIndex` / the chunk's `rowStart`-
   * relative local index) and request the next frame. `suppressPartialRepaint`
   * degrades this to a full repaint. No call site migrates to this helper
   * in this task — it's plumbed for later tasks (hover/selection/scroll).
   */
  private repaintRows(rowIndices: number[]): void {
    // Cycle 22 / Task 3 — rowVersionByRowId contract: 'rows' damage bumps
    // every damaged row's strip version, so a Tier-2 strip captured before
    // this damage can never be consumed again (the next layer raster of
    // the row paints live and re-captures). Deliberately ABOVE the
    // suppressPartialRepaint short-circuit: while suppressed the grid
    // paints through the legacy full path (strips dormant), but retained
    // strips + versions must keep tracking damage or flipping the option
    // back off would consume pre-flip pixels at matching versions. Zero
    // cost when strips are off.
    if (this.rasterStrips !== null) {
      for (const r of rowIndices) {
        const id = this.stringRowIdAt(r);
        if (id !== null && id !== '') {
          this.rowVersionByRowId.set(id, (this.rowVersionByRowId.get(id) ?? 0) + 1);
        }
      }
    }
    if (this.options.suppressPartialRepaint) { this.repaintFull(); return; }
    this.damageLedger.add({ kind: 'rows', rowIndices });
    this.cgridCanvas.requestRepaint();
  }

  /**
   * Damage-region rendering — record damage for a set of (rowId, colId)
   * cells and request the next frame. `suppressPartialRepaint` degrades
   * this to a full repaint. No call site migrates to this helper in this
   * task — it's plumbed for later tasks (flash, cell edits, formula recalc).
   */
  private repaintCells(cells: Array<{ rowId: number; colId: string }>): void {
    // Cycle 22 / Task 3 — rowVersionByRowId contract ('cells' damage) +
    // patch-on-tick. Runs BEFORE the ledger add / repaint request, so the
    // layer raster that consumes the resolved cell rects on the next frame
    // already sees the advanced versions (and, when the patch succeeded,
    // an up-to-date strip that HITS at the new version instead of forcing
    // a full row re-raster). ABOVE the suppressPartialRepaint
    // short-circuit for the same reason as `repaintRows` — retained
    // strips must keep tracking damage while suppressed.
    if (this.rasterStrips !== null && cells.length > 0) {
      this.applyStripCellDamage(cells);
    }
    if (this.options.suppressPartialRepaint) { this.repaintFull(); return; }
    this.damageLedger.add({ kind: 'cells', cells });
    this.cgridCanvas.requestRepaint();
  }

  /**
   * Cycle 22 / closeout I-4 — the flash-fade per-rAF repaint path.
   * Identical to `repaintCells` MINUS the Tier-2 strip bookkeeping: a fade
   * frame carries NO content change — the ORIGINAL tick's damage already
   * bumped the row version and patched (or dropped) the strip — so per-rAF
   * version bumps and re-patches of the same settled span (~90 frames per
   * 1.5s fade, `localByNumericId` rebuilt O(chunk) each) are pure hot-path
   * waste, and a version bump WITHOUT the matching patch would force a
   * needless full-row re-raster at fade settle. While the fade runs the
   * row is strip-ineligible (live flash) and paints live; at settle the
   * strip patched at tick time hits at the still-current version. Visible
   * fade behavior is untouched — same ledger damage, same repaint request.
   * (`api.flashCells` without a data change is also correct here: nothing
   * changed, so the retained strip's settled pixels stay valid.)
   */
  private repaintCellsFlashFade(cells: Array<{ rowId: number; colId: string }>): void {
    if (this.options.suppressPartialRepaint) { this.repaintFull(); return; }
    this.damageLedger.add({ kind: 'cells', cells });
    this.cgridCanvas.requestRepaint();
  }

  /**
   * Cycle 22 / closeout I-3 — re-capture seam for rows whose tick-time
   * strip patch BAILED (icon cell, last-in-band damaged column, fractional
   * geometry — the strip was dropped, correctly). While such a row keeps
   * flashing it is strip-ineligible, and once settled nothing ever damages
   * it full-width again: cell-sized fade rects can never re-capture, so
   * the row would paint live at EVERY subsequent raster — the exact
   * "stripPatches = 0 and strips stay cold under steady ticking" shape the
   * closeout measured on the live feed. Called from the flash registry
   * when a row's last flash expires (it is eligible again): if the strip
   * is still current (the tick-time patch SUCCEEDED), do nothing — a row
   * repaint would only bump the version and waste the patch. Otherwise
   * issue one row-level repaint; the resulting full-width raster of the
   * settled row re-captures it, and every later raster HITS.
   */
  private recaptureSettledFlashRows(rowIds: number[]): void {
    const strips = this.rasterStrips;
    const chunk = this.chunk;
    if (strips === null || !strips.available || chunk === null) return;
    let rowIndices: number[] | null = null;
    for (const nid of rowIds) {
      // O(chunk) per settled row is fine: settle batches are small (a few
      // rows per flash generation) and this runs once per generation, not
      // per rAF.
      let local = -1;
      for (let i = 0; i < chunk.rowCount; i++) {
        if (chunk.rowIds[i] === nid) { local = i; break; }
      }
      if (local === -1) continue; // scrolled out of the window — nothing retained to warm
      const sid = chunk.stringRowIds?.[local];
      if (sid === undefined || sid === null || sid === '') continue;
      const version = this.rowVersionByRowId.get(sid) ?? 0;
      if (strips.get(sid, version, this.stripLayoutEpoch) !== null) continue; // patched & current — keep it
      (rowIndices ??= []).push(chunk.rowStart + local);
    }
    if (rowIndices !== null) this.repaintRows(rowIndices);
  }

  /**
   * Cycle 22 / Task 3 — the cell-damage half of the Tier-2 bookkeeping.
   * For every damaged (numeric rowId, colId) cell that resolves into the
   * current chunk window:
   *  1. bump the row's `rowVersionByRowId` entry (once per row per call);
   *  2. when a strip is retained for the row, PATCH the damaged cell spans
   *     in place — repaint just those spans inside the strip via the live
   *     cell painter (flash suppressed: a strip must only ever hold the
   *     row's SETTLED pixels) and advance the stored version so the next
   *     consume hits without a full row re-raster;
   *  3. when ANY span can't be patched safely (column not fully visible in
   *     its band, last-in-band right edge, icon/rule-indicator cell,
   *     fractional geometry, a live cross-column dependency — see
   *     `stripPatchCrossColumnSafe`), drop the strip instead — a bypass is
   *     a perf miss, a stale strip is a bug.
   */
  private applyStripCellDamage(cells: Array<{ rowId: number; colId: string }>): void {
    const strips = this.rasterStrips;
    const chunk = this.chunk;
    if (strips === null || chunk === null) return;
    // numeric rowId → chunk-local index (numeric ids are the damage keys;
    // strips + versions key on string rowIds).
    const localByNumericId = new Map<number, number>();
    for (let i = 0; i < chunk.rowCount; i++) localByNumericId.set(chunk.rowIds[i]!, i);
    const colsByLocal = new Map<number, string[]>();
    for (const c of cells) {
      const local = localByNumericId.get(c.rowId);
      if (local === undefined) continue;
      const list = colsByLocal.get(local);
      if (list === undefined) colsByLocal.set(local, [c.colId]);
      else if (!list.includes(c.colId)) list.push(c.colId);
    }
    // Carry-forward (Task 1): `patch` maps CSS-px spans onto the strip's
    // device backing store — it MUST receive the LIVE dpr or strips
    // corrupt at dpr≠1. Same read discipline as `getRasterCellsCtx`.
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // Cycle 22 / closeout I-2 (adjudicated BYPASS) — at non-integer dpr the
    // patch rounds its span origin (`x0 = round(xCss*dpr)`), so painter
    // output can land sub-pixel-shifted vs the live raster. Never patch:
    // drop the strip instead (versions keep tracking; the next full-row
    // raster re-captures). Capture/consume stay on — they are pure
    // integer-device-px copies of the layer's own raster.
    const dprPatchable = Number.isInteger(dpr);
    // Cycle 22 / closeout N-1 — cross-column dependency bail. The damage
    // this helper receives is RAW-FIELD-granular (the tick seam derives it
    // from the worker's flashMask = diffRowFields ∧ column.field), yet a
    // committed patch advances the strip to FULL-ROW validity at the final
    // version. Any column whose pixels can change WITHOUT its own field
    // being flagged — a calc column computed from the ticked field
    // (fieldless, never flagged by construction) or a row-scope rule STYLE
    // repainting an unflagged span (the `ruleIndicator` bail in
    // `patchStripCells` covers indicators only) — would keep PRE-TICK
    // pixels in its span, and the settle/scroll consume would serve them
    // at rest. While either hazard is live, never patch: drop the strip
    // (versions keep tracking; the `onRowsSettled` recapture heals the row
    // with one full-width raster — Run C measured recapture alone as
    // sufficient to sustain the Tier-2 win). A bypass is a perf miss, a
    // stale strip is a bug.
    const crossColumnSafe = this.stripPatchCrossColumnSafe();
    for (const [local, colIds] of colsByLocal) {
      const rowId = chunk.stringRowIds?.[local];
      if (rowId === undefined || rowId === null || rowId === '') continue;
      const rowIndex = chunk.rowStart + local;
      const newVersion = (this.rowVersionByRowId.get(rowId) ?? 0) + 1;
      this.rowVersionByRowId.set(rowId, newVersion);
      if (!strips.available || !strips.has(rowId)) continue;
      if (!dprPatchable || !crossColumnSafe
        || !this.patchStripCells(strips, rowIndex, rowId, newVersion, colIds, dpr)) {
        strips.invalidateRow(rowId);
      }
    }
  }

  /**
   * Cycle 22 / closeout N-1 — is a cell-granular strip patch safe against
   * cross-column dependencies? `false` (BYPASS — the caller drops the
   * strip instead of patching) whenever:
   *  - a calc-column provider is registered AND at least one of its
   *    synthesized (fieldless) calc columns is VISIBLE: its value can
   *    change when a raw input field ticks, but the flashMask never flags
   *    it, so its span would survive a patch with pre-tick pixels;
   *  - a rule engine is registered with ≥1 rule — row-scope rule styles
   *    can repaint spans whose own field never ticked. An engine that
   *    doesn't expose `getRules` (a paint-only adapter) has an UNKNOWN
   *    rule set — ambiguous, and ambiguous means BYPASS;
   *  - ANY visible column carries a compiled format program (string-DSL
   *    `_formatProgram` or composite `_compositeProgram`): every program
   *    evaluates against the FULL row (`FormatEvalCtxShape.row` — e.g.
   *    `[color=[qty] > 100]` on the price column), so a tick on field A
   *    can restyle column B's span without B ever being flagged. The
   *    `tiers` flags CANNOT prove row-independence — the `=expr`
   *    value-formatter form is tier0-flagged yet evaluates against the
   *    row — so per the house rule (ambiguous means BYPASS) ANY compiled
   *    program bails; a compile-time `usesRowFields` flag on
   *    `FormatProgramShape` (precedented by `hasRuleRefs`) is the filed
   *    refinement that would re-enable patching for value-only programs.
   * Cheap: runs once per damage batch (not per span); the format scan is
   * O(visible columns), and all three slots are empty for grids that
   * never wire @wellsfargo-starui/velocity-grid-format / @wellsfargo-starui/velocity-grid-calc / @wellsfargo-starui/velocity-grid-rules.
   */
  private stripPatchCrossColumnSafe(): boolean {
    const engine = getRuleEngine();
    if (engine !== null) {
      const rules = engine.getRules?.();
      if (rules === undefined || rules.length > 0) return false;
    }
    const visible = this.viewport.visibleColumns;
    for (const col of visible) {
      const def = this.columnDefsMap.get(col.colId);
      if (def !== undefined
        && (def._formatProgram !== undefined || def._compositeProgram !== undefined)) {
        return false;
      }
    }
    const provider = getCalcProvider();
    if (provider !== null) {
      const synthesized = provider.synthesizedColDefs();
      if (synthesized.length > 0) {
        for (const def of synthesized) {
          const colId = def.colId;
          if (typeof colId === 'string' && visible.some((c) => c.colId === colId)) return false;
        }
      }
    }
    return true;
  }

  /**
   * Cycle 22 / Task 3 — patch every damaged cell span of one retained
   * strip in place. Reproduces EXACTLY what the live layer raster lays
   * down for that span, in the same order: row bg fill → cell painter
   * (the Tier-1/live cell paint, bounds rebased to the span origin, flash
   * suppressed) → the span's slice of the row's bottom horizontal
   * gridline → the column's interior right-edge vertical. Returns `false`
   * on ANY ambiguity — the caller drops the strip so it can never go
   * stale (the version was already bumped; the next full-row raster
   * re-captures).
   */
  private patchStripCells(
    strips: RowStripCache,
    rowIndex: number,
    rowId: string,
    newVersion: number,
    colIds: string[],
    dpr: number,
  ): boolean {
    const vs = this.viewport;
    const theme = this.theme;
    // NOTE: deliberately NOT gated on `stripRowEligible` — a FLASHING
    // row's strip is exactly what patch-on-tick exists for: the row
    // paints live (bypass) while the flash runs, and the patched strip
    // (settled pixels, new version) hits the moment the flash fades. An
    // active quick filter can't reach here: activating it bumps the
    // layout epoch (wiping every strip), so `strips.has()` upstream
    // already returned false.
    const hCss = this.rowHeightAt(rowIndex);
    // The strip's device height must match what this row's patch assumes,
    // and the gridline math below assumes integer CSS geometry (the
    // overwhelmingly common case — fractional layouts bypass).
    if (!Number.isInteger(hCss) || hCss <= 0) return false;
    // Closeout M-3 — the capture rounds its DEVICE origin from the row's
    // absolute top, while the patch paints its bottom hairline at
    // span-local `hCss - 1`: with a FRACTIONAL row top (measured/wrapped
    // heights somewhere above this row) the two roundings can disagree by
    // one device px at dpr > 1. Same conservative bypass as fractional
    // heights — a bail is a perf miss, a shifted hairline is a bug.
    const rowTopCss = this.rowHeightIndex !== null
      ? this.rowHeightIndex.topOf(rowIndex)
      : rowIndex * (this.options.rowHeight ?? this.theme.rowHeight);
    if (!Number.isInteger(rowTopCss)) return false;
    // Band split mirrors byRows: a column's interior right-edge vertical
    // only exists for non-last-in-band columns; the last column's right
    // edge is a band boundary (pinned-edge borderColor line / canvas edge)
    // — conservative bypass rather than reproducing that logic here.
    const leftPinned: typeof vs.visibleColumns = [];
    const center: typeof vs.visibleColumns = [];
    const rightPinned: typeof vs.visibleColumns = [];
    for (const col of vs.visibleColumns) {
      if (col.pinned === 'left') leftPinned.push(col);
      else if (col.pinned === 'right') rightPinned.push(col);
      else center.push(col);
    }
    const rowData = this.rowDataSnapshotAt(rowIndex);
    const ruleRow = (this.rowDataById.get(rowId) as Record<string, unknown> | undefined) ?? rowData;
    // Closeout I-3 — count spans locally and commit to PaintStats only when
    // the WHOLE row patched: a later column's bail drops the strip, so
    // spans painted before it never serve a pixel. Committing per-span
    // inflated `stripPatches` on rows that ultimately bailed (the live-feed
    // probe run showed 55 "patches" from rows that all bailed last-in-band
    // — semantically zero).
    let patchedSpans = 0;
    for (const colId of colIds) {
      const col = vs.visibleColumns.find((c) => c.colId === colId);
      if (col === undefined) return false; // column not visible → span unknown
      const band = col.pinned === 'left' ? leftPinned : col.pinned === 'right' ? rightPinned : center;
      if (band[band.length - 1] === col) return false; // last-in-band → band-edge line, bypass
      // Center-band cells clipped at a pinned boundary paint partially
      // live — a full-span patch would repaint clipped pixels. Bypass.
      if (col.pinned === undefined && (col.left < vs.bodyLeft || col.right > vs.bodyRight)) return false;
      if (!Number.isInteger(col.left) || !Number.isInteger(col.width)) return false;
      const def = this.columnDefsMap.get(colId);
      if (def === undefined) return false;
      const cell = this.cellAt(rowIndex, colId);
      const value = cell?.value ?? '';
      const valueFormatted = cell?.valueFormatted ?? '';
      // Closeout I-3 — bail only when a cell icon WOULD DRAW for this
      // cell's current value (byRows' exact decision, shared via
      // `resolveDrawableCellIcon`): the icon draws OVER the painter at
      // live coords, which the patch closure does not reproduce. The old
      // `typeof def.cellIcon === 'function'` existence test killed
      // patch-on-tick in production (stripPatches=0 on the live feed):
      // format-compiled columns synthesize the fn on EVERY def — it
      // returns null unless the format carries an icon() — and every
      // ticking numeric column is format-compiled, so the first tick
      // dropped the strip and cell-sized rasters could never recapture.
      if (resolveDrawableCellIcon(def as ResolvedColDef, {
        value, data: (rowData ?? {}) as never, colId,
        rowId, themeKind: this.getThemeKind(),
      }) !== null) return false; // icon draws over the painter — live only
      let rendererName: string;
      let params: unknown;
      if (def.cellRendererSelector) {
        const selected = def.cellRendererSelector({ value, colId, data: null });
        rendererName = selected?.component ?? def.cellRenderer;
        params = selected?.params !== undefined ? selected.params : def.cellRendererParams;
      } else {
        rendererName = def.cellRenderer;
        params = def.cellRendererParams;
      }
      // Strip rows are eligible-only (plain data rows), so the bg is the
      // plain zebra — never hover/selection (those rows have no strips).
      const rowBg = rowIndex % 2 === 1 ? theme.rowAltBg : theme.bg;
      const config: CellPaintConfig = {
        value: '', valueFormatted: '',
        bounds: { x: 0, y: 0, w: 0, h: 0 },
        font: '', fg: '', bg: '', borderColor: '',
        halign: 'left', prefillColor: '',
        isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      };
      applyCellProps(config, {
        theme,
        colDef: def as ResolvedColDef,
        value,
        valueFormatted,
        // Span-origin bounds — the patch CTM (`setTransform(dpr,0,0,dpr,
        // x0,0)`) lands (0,0,w,h) exactly on the cell's device span, the
        // same rebase discipline as a Tier-1 miss render.
        x: 0, y: 0, w: col.width, h: hCss,
        rowBg,
        prefillColor: rowBg,
        isFocused: false, isSelected: false, isHovered: false, isHeader: false,
        iconColor: theme.focusRingColor,
        // Flash suppressed by contract: the strip holds the SETTLED cell.
        // While the flash is live the row is ineligible and paints live;
        // once it fades, the next consume blits this settled patch.
        flashAlpha: undefined,
        params,
        rowData,
        rowIndex,
        rowId,
        ruleRow,
        themeKind: this.getThemeKind(),
      });
      if (config.ruleIndicator !== undefined) return false; // indicator icon → live only
      const painter = this.cellRenderers.get(rendererName);
      const wCss = col.width;
      const colLeft = col.left;
      const colRight = col.right;
      const gridLineColor = theme.gridLineColor;
      const ok = strips.patch(rowId, newVersion, colLeft, wCss, (sgc) => {
        // Task 4 — flatten over the opaque surface first (the Tier-1 miss
        // scratch's exact discipline, see `paintCellThroughCache`):
        // `patch` CLEARS the span to transparent, so opening directly
        // with a translucent rowBg (cursor-dark's 2%-alpha zebra) would
        // store double-composited premultiplied pixels that diverge from
        // the live raster by a few LSB at the next consume. The live
        // layer raster's op order is: band `theme.bg` fill → row-bg
        // bundle (only when the row bg differs) → cell painter →
        // gridlines on top; reproduce it verbatim.
        sgc.cache.fillStyle = theme.bg;
        sgc.fillRect(0, 0, wCss, hCss);
        if (rowBg !== theme.bg) {
          sgc.cache.fillStyle = rowBg;
          sgc.fillRect(0, 0, wCss, hCss);
        }
        painter.paint(sgc, config);
        sgc.cache.fillStyle = gridLineColor;
        // The row's bottom horizontal hairline slice (every in-body data
        // row paints one at round(row.bottom)-1 → span-local hCss-1).
        sgc.fillRect(0, hCss - 1, wCss, 1);
        // The column's interior right-edge vertical at round(col.right)-1
        // — span-local, exact against the patch's own x0 rounding.
        const lineX = (dpr * (Math.round(colRight) - 1) - Math.round(colLeft * dpr)) / dpr;
        sgc.fillRect(lineX, 0, 1, hCss);
      }, dpr);
      if (!ok) return false;
      patchedSpans++;
    }
    this.paintStats.stripPatches += patchedSpans;
    return true;
  }

  /**
   * Damage-region rendering — builds the live-viewport resolution context
   * the ledger needs to turn semantic damage (row indices / rowId+colId
   * cells) into merged clip rects at paint time. Reading `this.viewport` /
   * `this.chunk` / `this.canvasBounds` fresh on every paint (rather than
   * caching) means damage recorded before a scroll or column resize still
   * resolves against CURRENT geometry.
   */
  private buildDamageResolveCtx(): DamageResolveCtx {
    const vs = this.viewport;
    // M3 (closeout review, SKIPPED — not cheap) — assumes every sticky
    // ancestor row paints at the uniform `theme.rowHeight`. Under
    // variable/autoHeight row heights, a taller ancestor row makes this
    // underestimate the band, so the scroll-redamage band
    // (`DamageLedger.takeResolved`'s unconditional sticky-band push) can
    // fall short and leave a stale lower sticky row for one frame. A real
    // fix needs a source row index on `StickyAncestor` (currently only
    // `depth`/`key`/`colId`/`value`/`childCount`/`isExpanded` — see
    // `worker/protocol.ts`) threaded from the worker's
    // `computeStickyAncestors` so this could sum `RowHeightIndex` entries
    // instead of multiplying by a constant — a worker↔main wire-protocol
    // change out of scope for this fix wave's Minor-severity bar. The
    // renderer's own `paintStickyGroups` makes the identical
    // uniform-height assumption (`ancestors.length * rowH`), so this stays
    // internally consistent (the redamage band matches what's painted)
    // even though both are wrong together under autoHeight groups.
    const stickyBandBottom = this.stickyAncestors.length > 0
      ? vs.bodyTop + this.stickyAncestors.length * this.theme.rowHeight
      : null;
    return {
      canvasWidth: this.canvasBounds.width,
      canvasHeight: this.canvasBounds.height,
      dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      bodyTop: vs.bodyTop,
      bodyBottom: vs.bodyBottom,
      bodyLeft: vs.bodyLeft,
      bodyRight: vs.bodyRight,
      // Two-domain damage (Task 2/4) — `scrollTop` pivots the screen↔
      // content transform (`screenYToContentY`/`dataRectToScreen`).
      // `layerTop`/`layerHeight` feed the data-domain area cap
      // (`DamageLedger.takeResolved`) against the LAYER's real extent —
      // when the retained layer is active this frame, the paint closure
      // has already applied this paint's `planLayer` decision (reset/
      // shift geometry mutation) BEFORE calling this method, so
      // `this.paintCacheLayer.geometry()` reflects the anchor THIS
      // frame's raster/present will actually use. When the layer isn't
      // active (option off, unavailable, or construction-time default),
      // this degrades to the Task-2 placeholder — `layerTop` mirrors the
      // live scroll position and `layerHeight` mirrors today's body
      // height, exactly reproducing pre-Task-4 behavior.
      scrollTop: vs.scrollTop,
      layerTop: this.paintCacheActive() ? this.paintCacheLayer!.geometry().layerTop : vs.scrollTop,
      layerHeight: this.paintCacheActive()
        ? this.paintCacheLayer!.geometry().layerHeight
        : vs.bodyBottom - vs.bodyTop,
      // Task 4 — gates the ledger's scroll-exposed-band push (see
      // `DamageResolveCtx.paintCacheLayerActive`'s doc). While hybrid-
      // deferred or un-anchored the layer is NOT serving pixels — treat
      // it inactive so scroll/partial damage still expands correctly and
      // cannot assume a valid retained present.
      paintCacheLayerActive: this.paintCacheActive()
        && this.paintCacheLayerAnchored
        && !this.paintCacheDeferLayer,
      stickyBandBottom,
      // Task 5 — totals-row / static-pinned-row bands (top or bottom
      // position), derived from the live viewport's non-data subgrid rows.
      pinnedBandRects: this.buildPinnedBandRects(vs),
      rowBand: (localRowIndex) => {
        const row = vs.visibleRows.find(
          (r) => r.subgrid.isData && r.localRowIndex === localRowIndex,
        );
        return row ? { top: row.top, bottom: row.bottom } : null;
      },
      rowIndexForRowId: (rowId) => {
        const chunk = this.chunk;
        if (!chunk) return null;
        for (let i = 0; i < chunk.rowIds.length; i++) {
          if (chunk.rowIds[i] === rowId) return chunk.rowStart + i;
        }
        return null;
      },
      colBounds: (colId) => {
        const col = vs.visibleColumns.find((c) => c.colId === colId);
        return col ? { x: col.left, w: col.width } : null;
      },
      // Task 6 (pixel-invariance harness fix) — any visible row (not just
      // data rows, unlike `rowBand` above) whose band strictly contains
      // `y`. Lets `DamageLedger.expand()` snap a bleed-expanded edge that
      // lands mid-row out to that row's full bounds instead of clipping
      // through the middle of its content.
      rowBoundsAtY: (y) => {
        const row = vs.visibleRows.find((r) => y > r.top && y < r.bottom);
        return row ? { top: row.top, bottom: row.bottom } : null;
      },
      // I1 fix — horizontal mirror of `rowBoundsAtY`: the visible column
      // whose bounds strictly contain `x`, so `DamageLedger.expand()` can
      // snap a bleed-expanded vertical edge out to full column bounds.
      colBoundsAtX: (x) => {
        const col = vs.visibleColumns.find((c) => x > c.left && x < c.right);
        return col ? { left: col.left, right: col.right } : null;
      },
    };
  }

  /** Task 5 — pinned/totals band rects for the damage-resolve ctx. Any
   *  non-data subgrid whose rows are a totals row OR a static pinned row
   *  (top or bottom position — see `rebuildSubgridStack`'s stack-order
   *  comment) contributes one full-width rect spanning the min/max
   *  top/bottom of its visible rows THIS frame. Header + floating-filter
   *  subgrids are excluded — they sit entirely above `bodyTop`, never
   *  touched by the scroll blit, so redamaging them every scroll frame
   *  would be pure waste. Returns `[]` when the grid has neither (the
   *  common case) so the ledger's band-atomic-extend logic (§4.4) and the
   *  Task 5 unconditional-scroll-redamage are both no-ops. */
  private buildPinnedBandRects(vs: ViewportState): Rect[] {
    const bands = new Map<Subgrid, { top: number; bottom: number }>();
    for (const row of vs.visibleRows) {
      const sg = row.subgrid;
      if (sg.isData) continue;
      if (!sg.isTotals && !(sg instanceof PinnedRowsSubgrid)) continue;
      const cur = bands.get(sg);
      if (!cur) bands.set(sg, { top: row.top, bottom: row.bottom });
      else {
        if (row.top < cur.top) cur.top = row.top;
        if (row.bottom > cur.bottom) cur.bottom = row.bottom;
      }
    }
    const rects: Rect[] = [];
    for (const b of bands.values()) {
      rects.push({ x: 0, y: b.top, w: this.canvasBounds.width, h: b.bottom - b.top });
    }
    return rects;
  }

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
   *  `VelocityGridOptions.components` are both reachable through this surface. */
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
   *  `VelocityGridOptions.components` both work. */
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

  /** Generic floating-panel primitive: opens (or retargets) a Close-only,
   *  draggable/resizable, non-modal floating panel and returns its body
   *  element for the caller to fill. Used by tool panels whose content
   *  has nowhere to dock back to (e.g. the Column Groups per-group Style
   *  editor, invoked from a group row's gear icon) — contrast with the
   *  side bar's dock/undock tool-panel flow, which this is NOT part of.
   *  If already open, closes the previous frame first and opens a fresh
   *  one (`FloatingPanelHost.open()` is itself reopen-safe), so the
   *  caller can retarget the float (new title/content) without an
   *  explicit `closeFloatingPanel()` first. `rect` defaults to the last
   *  remembered position/size (persisted under the `toolPanelPopoutRect`
   *  state slice) when omitted, so successive opens land where the user
   *  last left the float. */
  openFloatingPanel(opts: { title: string; rect?: Partial<FloatingRect>; onClose: () => void }): HTMLElement {
    const host = this.getFloatingPanelHost();
    return host.open({
      title: opts.title,
      rect: opts.rect ?? this.popoutRect,
      onClose: opts.onClose,
      onRectChange: (r) => {
        this.popoutRect = r;
        this.stateUpdatedBus?.markChanged('toolPanelPopoutRect');
      },
    });
  }

  /** Close the floating panel opened via `openFloatingPanel`, if any.
   *  Idempotent (safe to call when already closed/closing). Does NOT
   *  itself invoke the caller's `onClose` — that only fires from the
   *  frame's own Close (×) button — so a caller reacting to that click
   *  is expected to call this (directly or via a subsequent render). */
  closeFloatingPanel(): void {
    this.floatingPanelHost?.close();
  }

  /** Whether the floating panel opened via `openFloatingPanel` is
   *  currently showing. */
  isFloatingPanelOpen(): boolean {
    return this.floatingPanelHost?.isOpen() ?? false;
  }

  /** Update the floating panel's titlebar text in place (no reopen), so a
   *  caller can keep the frame's position/focus while its subject is
   *  renamed. No-op when no float is open. */
  setFloatingPanelTitle(title: string): void {
    this.floatingPanelHost?.setTitle(title);
  }

  /** Resize the open floating panel's height to hug its current content
   *  (width/position untouched), removing any empty lower band. Call after
   *  (re)rendering fixed-height content into the body. No-op when no float
   *  is open. */
  fitFloatingPanelHeight(): void {
    this.floatingPanelHost?.fitContentHeight();
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
   *  via `VelocityGridOptions.components` are both reachable here. */
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
    // lands before VelocityGridCanvas finishes — guarded so a sideBar
    // constructed pre-canvas doesn't crash). Cycle 13 / Task 1 — the
    // current status-bar bottom reservation flows through the same
    // setHostBounds call so a side-bar reflow can't drop the bar inset.
    if (this.cgridCanvas) {
      // Cycle 15 / Task 6 + Cycle 18 / Task 6 + Cycle 21i Phase 2 —
      // the full top-strip stack (status bar + pivot panel + row group
      // panel, incl. the pivot-mode shared-strip collapse) flows
      // through the SAME helper `applyVerticalInsets` uses, so a
      // side-bar reflow can never drop one of the insets and drift the
      // canvas out from under the DOM overlays (floating filters,
      // editors).
      this.cgridCanvas.setHostBounds({
        left,
        top: this.computeTopInset(),
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



  /** Cycle 21i Phase 2 — context handed to StatusBarHost. Shared by the
   *  constructor mount and the runtime `statusBar` apply path. */
  private makeStatusBarContext(): StatusBarGridContext {
    return {
      registry: this.statusPanelRegistry,
      api: this.makeApi(),
      setReservedSpace: (side, height) => this.reserveStatusBarSpace(side, height),
    };
  }

  /** Cycle 21i Phase 2 — runtime `statusBar` flips route here from the
   *  runtime-options apply table. Re-normalizes the option (intrinsic
   *  default-on; `false` opts out) and mounts, unmounts, or swaps the
   *  def on the live host; the reservation release/re-emit reflows the
   *  grid body. */
  updateStatusBar(): void {
    const def = normalizeStatusBarOption(this.options.statusBar);
    if (!def) {
      this.statusBar?.destroy();
      this.statusBar = null;
      return;
    }
    if (this.statusBar) {
      this.statusBar.setStatusBarDef(def);
      return;
    }
    this.statusBar = new StatusBarHost(this.root, this.makeStatusBarContext(), def);
  }



  /** Cycle 21i Phase 2 / T4 — the grid's modal primitive. Lazily
   *  created; one modal at a time. `open(content, { title, onClose,
   *  ... })` mounts caller-owned DOM in a themed, focus-trapped dialog
   *  over a backdrop covering the grid. */
  getModal(): ModalHost {
    this.modalHost ??= new ModalHost(this.root);
    return this.modalHost;
  }

  /** The grid's floating-panel primitive. Lazily created; used by
   *  `openFloatingPanel`. */
  private getFloatingPanelHost(): FloatingPanelHost {
    this.floatingPanelHost ??= new FloatingPanelHost(this.root);
    return this.floatingPanelHost;
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
    // AG-Grid parity — in pivot mode, the row group panel and pivot
    // panel share ONE 32-px strip side-by-side (row groups on the
    // left half, column labels on the right half, separated by a
    // thin hairline). Saves the second 32 px of vertical inset.
    const sharing = this.isSharingTopStrip();
    const stripTop = this.statusBarInsets.top;
    const top = this.computeTopInset();
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
    // Cycle 21i Phase 2 — and end above a bottom status bar, so panel
    // footers (Apply/Reset) stay visible + clickable.
    this.sideBar?.setBottomOffset(bottom);
    const rgEl = this.root.querySelector('.vg-row-group-panel') as HTMLElement | null;
    const pvEl = this.root.querySelector('.vg-pivot-panel') as HTMLElement | null;
    if (sharing) {
      // Both panels at the same vertical position; the split modifier
      // class drives their half-width via CSS so they sit side-by-side.
      if (this.pivotPanel) this.setPivotPanelTop(stripTop);
      if (this.rowGroupPanel) this.setRowGroupPanelTop(stripTop);
      if (rgEl) rgEl.classList.add('vg-row-group-panel--split-left');
      if (pvEl) pvEl.classList.add('vg-pivot-panel--split-right');
    } else {
      // Stacked: pivot panel just below the top status bar; row group
      // panel beneath the pivot panel.
      if (this.pivotPanel) this.setPivotPanelTop(stripTop);
      if (this.rowGroupPanel) {
        this.setRowGroupPanelTop(stripTop + this.pivotPanelTopInset);
      }
      if (rgEl) rgEl.classList.remove('vg-row-group-panel--split-left');
      if (pvEl) pvEl.classList.remove('vg-pivot-panel--split-right');
    }
  }

  /** Cycle 21i Phase 2 — the ONE formula for the canvas region's
   *  total top inset: top status bar + pivot/row-group panel
   *  strips (collapsed to one 32px strip when pivot mode shares it).
   *  Used by BOTH `applyVerticalInsets` and `reserveSideBarSpace` so
   *  the two reflow paths can never disagree — a drift here shows up
   *  as the canvas sliding out from under the DOM overlays (floating
   *  filters, editors) the moment a side-bar reflow fires. */
  private computeTopInset(): number {
    const panelInset = this.isSharingTopStrip()
      ? Math.max(this.pivotPanelTopInset, this.rowGroupPanelTopInset)
      : this.pivotPanelTopInset + this.rowGroupPanelTopInset;
    return this.statusBarInsets.top + panelInset;
  }

  /** AG-Grid parity — true when the row group panel and pivot panel
   *  should share a single 32 px strip (row groups on the left,
   *  column labels on the right). Both panel hosts must exist and be
   *  visible, and pivot MODE (not just pivot-active) must be on so
   *  the user sees an empty Column Labels half waiting for input. */
  private isSharingTopStrip(): boolean {
    if (!this.pivotEngine.isPivotMode()) return false;
    if (!this.pivotPanel?.isVisible()) return false;
    if (!this.rowGroupPanel?.isVisible()) return false;
    return true;
  }

  /** Cycle 15 / Task 6 — set the row group panel's own `top`
   *  style. Called from `applyVerticalInsets` whenever the status
   *  bar's top inset changes (so the panel stays parked just below
   *  the top status bar) and once at construction. */
  private setRowGroupPanelTop(top: number): void {
    const el = this.root.querySelector('.vg-row-group-panel') as HTMLElement | null;
    if (el) el.style.top = `${top}px`;
  }

  /** Cycle 18 / Task 6 — set the pivot panel's own `top` style.
   *  Called from `applyVerticalInsets` whenever the status bar's
   *  top inset changes and once at construction. */
  private setPivotPanelTop(top: number): void {
    const el = this.root.querySelector('.vg-pivot-panel') as HTMLElement | null;
    if (el) el.style.top = `${top}px`;
  }

  /** Register a custom cell renderer. After registration, columns with
   *  `cellRenderer: name` (or whose `cellRendererSelector` returns
   *  `{ component: name }`) will dispatch to `painter`. Built-in names
   *  ('text', 'number', 'checkbox', 'header') can be overridden by
   *  re-registering; the override applies on the next repaint. */
  registerCellRenderer(name: string, painter: CellPainter, opts?: RegisterCellRendererOpts): void {
    this.cellRenderers.register(name, painter, opts);
    // Cycle 22 / closeout I-1 — layoutEpoch contract: re-registering an
    // in-use renderer name changes what its cells paint, but retained
    // strips hold the OLD painter's pixels at unchanged keys. Harmless at
    // boot (the store is empty). Tier 1 needs no bump: an override clears
    // `cacheableNames`, so those cells bypass the bitmap cache entirely.
    if (this.rasterStrips !== null) this.stripLayoutEpochBump();
    this.cgridCanvas?.requestRepaint();
  }

  /** Cycle 21i Phase 2 / T3 — instance-truth renderer enumeration:
   *  built-ins plus everything registered on THIS grid, in
   *  registration order. */
  listCellRenderers(): string[] {
    return this.cellRenderers.list();
  }

  /** Cycle 21i Phase 2 / T3 — pre-order depth-first walk over the live
   *  column-GROUP hierarchy. Each visit hands a snapshot node carrying
   *  structure (`childGroupIds` / `leafColIds` / `depth`), the authored
   *  `columnGroupShow`, and the LIVE runtime `open` state — the single
   *  traversal group editors need without stitching
   *  `getColumnGroupDefs` + `getColumnGroupState` themselves. */
  forEachColumnGroup(callback: (node: ColumnGroupWalkNode) => void): void {
    const visit = (node: ColumnTreeNode): void => {
      if (node.kind !== 'group') return;
      callback({
        groupId: node.groupId,
        headerName: node.headerName,
        depth: node.depth,
        open: this.columnGroupState.isOpen(node.groupId),
        columnGroupShow: node.columnGroupShow,
        childGroupIds: node.children
          .filter((c): c is ResolvedColGroupDef => c.kind === 'group')
          .map((c) => c.groupId),
        leafColIds: node.leafColIds.slice(),
      });
      for (const child of node.children) visit(child);
    };
    for (const root of this.columnTree.roots) visit(root);
  }

  /** Cycle 21c / Task 10 — register the @wellsfargo-starui/velocity-grid-format compiler into the
   *  kernel DI slot. Invoked by wireIntoKernel(grid) in @wellsfargo-starui/velocity-grid-format;
   *  kernel's compileFormatSlots pass (Task 11) calls getFormatCompiler()
   *  to obtain it. Apps that never call this see no behavior change. */
  registerFormatCompiler(fn: FormatCompiler): void {
    slotRegisterFormatCompiler(fn);
  }

  /** Cycle 21e / Task 10 — register the @wellsfargo-starui/velocity-grid-rules engine adapter into
   *  the kernel DI slot. Invoked by wireIntoKernel(grid) in @wellsfargo-starui/velocity-grid-rules;
   *  kernel's applyCellProps fold (Task 11) calls getRuleEngine() to
   *  obtain it. Apps that never call this see no behavior change. */
  registerRuleEngine(engine: RuleEngineShape): void {
    slotRegisterRuleEngine(engine);
    // Cycle 22 / closeout I-1 — layoutEpoch contract: registering (or
    // swapping) the rule engine post-boot activates the rule fold for
    // every cell, but retained strips hold pre-fold pixels at unchanged
    // keys. Harmless at boot (the store is empty).
    if (this.rasterStrips !== null) this.stripLayoutEpochBump();
    this.cgridCanvas?.requestRepaint();
  }

  /** Cycle 21d / Task 9 — register the @wellsfargo-starui/velocity-grid-calc provider into the
   *  kernel DI slot. Invoked by wireIntoKernel(grid) in @wellsfargo-starui/velocity-grid-calc.
   *  Registration folds the provider's synthesized calc ColDefs +
   *  override patches into the column tree (rebuild + worker column
   *  reship) and re-folds on every provider-side column mutation.
   *  Apps that never call this see no behavior change. */
  registerCalcProvider(provider: CalcProviderShape): void {
    slotRegisterCalcProvider(provider);
    this.calcProviderUnsub?.();
    this.calcProviderUnsub = provider.onColumnsChanged(() => this.onCalcColumnsChanged());
    this.onCalcColumnsChanged();
  }

  /** Cycle 21d / Task 9 — re-fold calc defs into the tree and reship the
   *  worker's column metadata. Mirrors the updateGridOptions({columnDefs})
   *  rebuild sequence. Cycle 21d / Task 10 ships the worker calc program
   *  FIRST so the column reship (which triggers a pipeline rebuild)
   *  already sees the installed program. */
  private onCalcColumnsChanged(): void {
    this.rebuildColumns({ defaultColDef: this.options.defaultColDef });
    // Grid Layouts (Phase B / B5 fix) — a calc-engine mutation (register/remove
    // calc column, applyOverrides, applyTemplate, …) changed the `calc` /
    // `columnOverrides` module slices; dirty the persist bus so autosave picks
    // them up. Suppressed during an 'init'/'api'-sourced restore by the bus.
    // (Template-API mutations ALSO emit `templatesChanged` → 'modules'; the bus
    // coalesces the double-dirty per frame.)
    this.notifyModuleStateChanged('calc');
    const provider = getCalcProvider();
    this.workerCoord.setCalcProgram((provider?.workerProgram() ?? null) as WorkerCalcProgram | null)
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] setCalcProgram:', err); });
    this.workerCoord.updateColumns(this.workerColumns())
      .then(({ visibleCount }) => {
        this.rowCount = visibleCount;
        this.recomputeViewport();
        this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
        this.events.emit({ type: 'displayedColumnsChanged', source: 'columnDefsChanged' });
        this.requestViewport('columnAggFuncChanged');
      })
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] calc updateColumns:', err); });
  }

  /** Cycle 21e / Task 10 — binary light/dark kind of the active theme.
   *  Derived from the root's `vg-theme-*` class (`-dark` suffix
   *  convention), `matchMedia` for `vg-theme-auto`, or the resolved
   *  `theme.bg` luminance for custom themes. */
  getThemeKind(): 'light' | 'dark' {
    return resolveThemeKind(Array.from(this.root.classList), this.theme.bg);
  }

  /** Cycle 21c / Task 12 — register a named icon set. Delegated to the
   *  module-level icon registry; kernel never auto-registers any set. */
  registerIconSet(name: string, paths: Record<string, string | Path2D>): void {
    regIcons(name, paths);
  }

  /** Cycle 21c / Task 12 — resolve an icon name to a cached Path2D
   *  across all registered sets. Returns null when not found or when
   *  Path2D is unavailable (SSR / Node). */
  resolveIcon(name: string, setHint?: string): Path2D | null {
    return resIcon(name, setHint);
  }

  /** Cycle 21i Phase 2 / T3 — enumerate registered icon names (icon
   *  pickers need to know what exists; `resolveIcon` is lookup-only).
   *  With `setName`, that set's names; without, the deduped union
   *  across all sets in resolution order. */
  listIcons(setName?: string): string[] {
    return listRegisteredIcons(setName);
  }

  /** Cycle 21c / Task 14 — register a per-column tooltip provider.
   *  Fires after a 500ms hover debounce; returns `{ plain }` or
   *  `{ html }` (or null). Delegated to the module-level provider
   *  registry consumed by the TooltipProvider chain feature. */
  registerTooltipProvider(colId: string, fn: TooltipProviderFn): void {
    regTip(colId, fn);
  }

  /** Cycle 21c / Task 14 — remove the tooltip provider for `colId`. */
  unregisterTooltipProvider(colId: string): void {
    unregTip(colId);
  }

  /** Re-read theme tokens once external stylesheets have applied. The
   *  constructor's initial `cssReader.read()` can capture literal
   *  fallbacks while DOM chrome (row-group panel, filters, status bar)
   *  already resolves the live `--vg-*` bundle — leaving canvas rows
   *  painted light on a dark theme until the next explicit theme swap. */
  private scheduleThemeCssResync(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    let cancelled = false;
    this.disposables.add(() => { cancelled = true; });
    const attempt = (framesLeft: number): void => {
      requestAnimationFrame(() => {
        if (cancelled || this.destroyed) return;
        const next = this.cssReader.read();
        const changed =
          next.bg !== this.theme.bg
          || next.headerBg !== this.theme.headerBg
          || next.fg !== this.theme.fg
          || next.rowAltBg !== this.theme.rowAltBg;
        if (changed) {
          this.theme = next;
          this.rasterCacheEpochBump();
          this.recomputeViewport();
          this.repaintFull();
          return;
        }
        if (framesLeft > 0) attempt(framesLeft - 1);
      });
    };
    // Two deferred frames covers async `<link>` injection in Vite dev.
    attempt(2);
  }

  /** Cycle 22 / Task 3 — runtime per-token override. Apps tune
   *  individual `--vg-*` variables without writing CSS; the patch
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
    // Cycle 22 / Task 2 — any theme re-read is a raster-cache epoch: the
    // per-cell keys cover fg/bg/font, but theme-scoped colors
    // (checkboxCheckedBg, group*, emptyFg, palette) ride the epoch.
    this.rasterCacheEpochBump();
    this.recomputeViewport();
    this.cgridCanvas.requestRepaint();
    // Cycle 21i / Phase 1 — theme-token overrides ride in the GridState
    // `themeParams` slice; dirty the autosave bus so color-picker edits
    // in the Grid Options panel survive reload.
    this.stateUpdatedBus?.markChanged('themeParams');
  }

  /** Cycle 22 / Task 3 — read the currently-set inline overrides. Returns
   *  ONLY the values set through `setThemeParams` — NOT the resolved
   *  tokens (call `getComputedStyle(grid.host)` for those). Theming Task
   *  6/7 — also excludes any `--vg-*` keys the active `themeObject`
   *  injected (`this.themeObjectVars`), even though both share the same
   *  underlying inline-style state, so an object theme's own derived vars
   *  never masquerade as user overrides. */
  getThemeParams(): Record<string, string> {
    const raw = themeParamsGet(this.root);
    if (this.themeObjectVars.size === 0) return raw;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!this.themeObjectVars.has(key)) out[key] = value;
    }
    return out;
  }

  /** Theming Task 6/7 — inject a `CgTheme`'s compiled `mode` output onto
   *  `this.root`: the structural base class (`theme.baseClass[mode]`), its
   *  `--vg-*` vars (via the LOW-LEVEL `themeParamsSet` — NOT
   *  `this.setThemeParams`, which also dirties the user `themeParams`
   *  GridState slice; object-derived vars must never persist as a user
   *  override), and any part-contributed CSS as a scoped `<style>`. Records
   *  `this.themeObject` + `this.themeObjectVars` for later blanking. Callers
   *  are responsible for having already removed any PRIOR theme's class +
   *  vars (`clearThemeObjectInjection` + the `vg-theme-*` strip in
   *  `setTheme`). */
  private injectThemeObject(theme: CgTheme, mode: ThemeMode): void {
    this.root.classList.add(theme.baseClass[mode]);
    const compiled = theme.compile(mode);
    themeParamsSet(this.root, compiled.vars);
    this.themeObjectVars = new Set(Object.keys(compiled.vars));
    if (compiled.css) {
      const styleEl = document.createElement('style');
      styleEl.className = 'vg-theme-object-css';
      styleEl.textContent = compiled.css;
      this.root.appendChild(styleEl);
      this.themeObjectStyleEl = styleEl;
    }
    this.themeObject = theme;
  }

  /** Theming Task 6/7 — blank every `--vg-*` var the active `themeObject`
   *  injected (pass `''` through the low-level `setThemeParams`, which
   *  REMOVES the inline override — see `theming/themeParams.ts`) and
   *  remove its part-CSS `<style>` element, if any. Does NOT touch
   *  `this.themeObject` itself or the base class — callers do that
   *  separately (a swap replaces both; `setThemeMode` re-adds a different
   *  base class right after calling this). */
  private clearThemeObjectInjection(): void {
    if (this.themeObjectVars.size > 0) {
      const blank: Record<string, string> = {};
      for (const key of this.themeObjectVars) blank[key] = '';
      themeParamsSet(this.root, blank);
    }
    this.themeObjectVars = new Set();
    if (this.themeObjectStyleEl) {
      this.themeObjectStyleEl.remove();
      this.themeObjectStyleEl = null;
    }
  }

  /** Theming Task 6/7 — apply `theme` (construction or after `setTheme` has
   *  already stripped any prior `vg-theme-*` class) to `this.root`:
   *  `string | undefined` adds the class verbatim (100% backward-compatible
   *  legacy path, unchanged since before this feature); a `CgTheme` picks
   *  its mode (`pickThemeMode`), injects it (`injectThemeObject`), and
   *  (re)installs the `prefers-color-scheme` listener as appropriate. */
  private applyThemeOption(theme: string | CgTheme | undefined, probeHost: Element): void {
    if (theme instanceof CgTheme) {
      const mode = pickThemeMode(probeHost, theme);
      this.injectThemeObject(theme, mode);
    } else {
      this.root.classList.add(theme ?? 'vg-theme-quartz');
      this.themeObject = undefined;
    }
    this.refreshThemeModeListener(probeHost);
  }

  /** Theming Task 6/7 — remove the live `prefers-color-scheme` listener
   *  (if one is installed). Safe to call unconditionally / repeatedly. */
  private teardownThemeModeListener(): void {
    if (this.themeModeQuery && this.themeModeQueryHandler) {
      this.themeModeQuery.removeEventListener('change', this.themeModeQueryHandler);
    }
    this.themeModeQuery = null;
    this.themeModeQueryHandler = null;
  }

  /** Theming Task 6/7 — (re)install the OS `prefers-color-scheme` listener
   *  for the CURRENTLY active `themeObject`, or ensure none is installed
   *  (string theme, or an explicit `data-vg-theme-mode` override present —
   *  an app-level override should not be fought by OS changes). Always
   *  tears down any previous listener first so repeated calls (every theme
   *  swap) never leak a stale registration. */
  private refreshThemeModeListener(probeHost: Element): void {
    this.teardownThemeModeListener();
    if (!this.themeObject) return;
    const withAttr = probeHost.closest('[data-vg-theme-mode]');
    const attr = withAttr?.getAttribute('data-vg-theme-mode');
    if (attr === 'light' || attr === 'dark') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent): void => {
      if (!this.themeObject) return;
      this.applyThemeModeSwap(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', handler);
    this.themeModeQuery = mql;
    this.themeModeQueryHandler = handler;
  }

  /** Theming Task 6/7 — shared re-apply used by both the imperative
   *  `setThemeMode` and the OS listener installed by
   *  `refreshThemeModeListener`: swap the active `themeObject`'s base class
   *  + injected vars/css to `mode`, re-read the theme, and repaint. No-op
   *  (the caller guards) when no `themeObject` is active. */
  private applyThemeModeSwap(mode: ThemeMode): void {
    const theme = this.themeObject;
    if (!theme) return;
    this.root.classList.remove(theme.baseClass.light, theme.baseClass.dark);
    this.clearThemeObjectInjection();
    this.injectThemeObject(theme, mode);
    this.theme = this.cssReader.read();
    // Cycle 22 / Task 2 — theme mode swap is a raster-cache epoch (same
    // trigger family as the paint-cache layer reset below).
    this.rasterCacheEpochBump();
    this.recomputeViewport();
    // Task 4 (paint-cache layer) — a theme swap is one of the layer's
    // required reset triggers; `repaintFull()` (not a bare
    // `requestRepaint()`) guarantees this paint's resolved damage is
    // `full` regardless of whatever else might be queued on the ledger,
    // so the paint closure's `damage.full`-driven layer reset actually
    // fires. Also closes a latent gap in the base damage system itself —
    // previously a theme swap relied on the ledger happening to be empty.
    this.repaintFull();
  }

  /** Theming Task 6/7 — imperatively force the active `themeObject` to
   *  `mode` (bypassing `pickThemeMode`'s attribute/OS inference — this IS
   *  the explicit override). No-op for the string/`undefined` theme path
   *  (there is no mode to pick for a plain CSS class). Does not touch the
   *  `prefers-color-scheme` listener: without a `data-vg-theme-mode`
   *  attribute, a later OS change still takes over, matching
   *  `pickThemeMode`'s own precedence. */
  setThemeMode(mode: ThemeMode): void {
    if (!this.themeObject) return;
    this.applyThemeModeSwap(mode);
  }

  /** `theme` overload: a plain CSS class name (unchanged legacy path) or a
   *  programmatic `CgTheme`. For a `CgTheme`, blanks the PRIOR object's
   *  vars/css (if any — swapping object→object or object→string) before
   *  stripping the existing `vg-theme-*` class(es) and applying the new
   *  theme via the same `applyThemeOption` construction uses. */
  setTheme(theme: string | CgTheme): void {
    if (this.themeObject) {
      this.clearThemeObjectInjection();
      this.themeObject = undefined;
    }
    const current = Array.from(this.root.classList).filter((c) => c.startsWith('vg-theme-'));
    current.forEach((c) => this.root.classList.remove(c));
    this.applyThemeOption(theme, this.root);
    this.theme = this.cssReader.read();
    // Cycle 22 / Task 2 — theme swap is a raster-cache epoch (same
    // trigger family as the paint-cache layer reset below).
    this.rasterCacheEpochBump();
    this.options.theme = theme;
    this.recomputeViewport();
    // Task 4 — see `applyThemeModeSwap`'s doc: a theme change is a
    // required paint-cache-layer reset trigger.
    this.repaintFull();
  }

  /** Cycle 22 / Task 2 — swap the density-mode class on the root.
   *  `null` / `undefined` removes any active density class entirely
   *  (back to the theme's native baseline). The CSS class flip is the
   *  only DOM mutation — `cssReader.read()` re-resolves the bundle's
   *  `--vg-row-height` / `--vg-header-height` / `--vg-cell-padding-x`
   *  overrides, and `recomputeViewport` + `requestRepaint` line the new
   *  row geometry up on the next frame. No worker round-trip. */
  setDensity(density: 'compact' | 'normal' | 'comfortable' | null | undefined): void {
    const current = Array.from(this.root.classList).filter((c) => c.startsWith('vg-density-'));
    current.forEach((c) => this.root.classList.remove(c));
    if (density) {
      this.root.classList.add(`vg-density-${density}`);
    }
    this.options.density = density ?? undefined;
    this.theme = this.cssReader.read();
    // Cycle 22 / Task 2 — density re-reads the theme (row heights change
    // cell bounds — already in the key — but padding/font tokens can move
    // too): raster-cache epoch.
    this.rasterCacheEpochBump();
    this.recomputeViewport();
    // Task 4 — density changes row/header height, which is functionally
    // a resize for the paint-cache layer (its own reset condition already
    // fires on a `layerHeight` mismatch, but forcing full here keeps the
    // BASE damage system honest too — see `applyThemeModeSwap`'s doc).
    this.repaintFull();
  }

  /** Read any grid option (runtime or initial). Mirrors ag-grid's
   *  `getGridOption` — useful for app code that needs to round-trip a setting. */
  getGridOption<K extends keyof VelocityGridOptions<TRow>>(key: K): VelocityGridOptions<TRow>[K] | undefined {
    return this.options[key];
  }

  /**
   * Push a row-load counter onto the busy overlay detail line.
   * Cleared automatically when `loading` flips to false.
   */
  setLoadingProgress(loaded: number | null, total?: number | null): void {
    if (loaded == null) {
      this.loadingOverlay.setDetail(null);
      return;
    }
    this.loadingOverlay.setProgress(loaded, total);
  }

  /** Set a single runtime-mutable option. Throws when `key` is in
   *  `INITIAL_ONLY_OPTIONS` (e.g. `columnDefs`, `getRowId`, `worker`). The
   *  `columnDefs` mutation surface lives on `updateGridOptions` because it
   *  needs a coupled tree-rebuild + worker column-metadata swap. */
  setGridOption<K extends keyof VelocityGridOptions<TRow>>(key: K, value: VelocityGridOptions<TRow>[K]): void {
    if (INITIAL_ONLY_OPTIONS.has(key as keyof VelocityGridOptions<any>)) {
      throw new Error(
        `[velocity-grid] '${String(key)}' is initial-only and cannot be changed at runtime` +
        (key === 'columnDefs' ? "; use api.updateGridOptions({ columnDefs }) instead" : ''),
      );
    }
    if (!isRuntimeOption(key as string)) {
      throw new Error(`[velocity-grid] '${String(key)}' is not a recognised runtime option`);
    }
    // Grid Layouts (A3) — remember the pre-change value as this option's
    // baseline the first time it's touched, so a layout switch can reset
    // it (spec §7). Only persistable keys participate in layout overrides.
    if (!NON_PERSISTABLE_RUNTIME_OPTIONS.has(key as string) && !this.optionBaselines.has(key as string)) {
      this.optionBaselines.set(key as string, this.options[key]);
    }
    this.options[key] = value;
    applyRuntimeOption(this.runtimeTarget(), key as any, value);
    // Cycle 21i / Phase 1 — record the touch for the GridState
    // `gridOptions` slice + dirty the coalesced autosave bus. Data
    // inputs / callbacks / theme (app chrome) never persist.
    if (!NON_PERSISTABLE_RUNTIME_OPTIONS.has(key as string)) {
      this.runtimeTouchedOptions.set(key as string, value);
      this.stateUpdatedBus?.markChanged('gridOptions');
    }
  }

  /**
   * Rehydrate {@link pendingColumnGroupDefs} onto the current columnDefs
   * catalog. Clears the pending overlay once every overlay leaf is present
   * in the live catalog (full coverage). No-op when nothing is pending.
   */
  private flushPendingColumnGroups(): void {
    if (!this.pendingColumnGroupDefs || this.applyingPendingColumnGroups) return;
    const overlay = this.pendingColumnGroupDefs;
    const base = this.options.columnDefs ?? [];
    const rehydrated = rehydrateColumnGroups(overlay, base);
    const projected = projectColumnGroups(rehydrated);
    this.applyingPendingColumnGroups = true;
    try {
      this.updateGridOptions({ columnDefs: projected as VelocityGridOptions<TRow>['columnDefs'] });
    } finally {
      this.applyingPendingColumnGroups = false;
    }
    const baseIds = new Set(
      flattenColumnGroups(base)
        .filter((n) => n.kind === 'column')
        .map((n) => n.colId),
    );
    const overlayCols = overlay.filter((n) => n.kind === 'column');
    if (overlayCols.every((c) => baseIds.has(c.colId))) {
      this.pendingColumnGroupDefs = null;
    }
  }

  /** Batch-update grid options. `columnDefs` is honored only via this
   *  entrypoint and rebuilds the column tree, refreshes the worker's column
   *  metadata, and preserves group state for IDs that survive the swap. */
  updateGridOptions(partial: Partial<VelocityGridOptions<TRow>>): void {
    // Special-case columnDefs first so the tree rebuild happens once even when
    // both columnDefs AND defaultColDef change in the same call.
    if ('columnDefs' in partial && partial.columnDefs) {
      const incomingHasGroups = flattenColumnGroups(partial.columnDefs)
        .some((n) => n.kind === 'group');
      const newDefault = partial.defaultColDef ?? this.options.defaultColDef;
      this.options.columnDefs = partial.columnDefs;
      if ('defaultColDef' in partial) this.options.defaultColDef = partial.defaultColDef;
      this.rebuildColumns({ defaultColDef: newDefault });
      // Cycle 21i / Task 6 — dirty the `columnGroupDefs` GridState slice
      // (see EVENT_TO_KEY in stateUpdatedBus.ts) so structural group edits
      // made through this path — the Column Groups panel's Apply, and the
      // `setState` restore below — survive a getState()/setState()
      // round-trip. Emitted synchronously right after the tree rebuild,
      // not gated on the worker round-trip.
      this.events.emit({ type: 'columnDefsChanged' });
      // Deferred column-group restore (persist / profile): a flat leaf
      // catalog swap (STOMP discovery, field refresh) must re-apply the
      // pending overlay. An incoming tree that already carries groups is
      // treated as authoritative (Column Groups Apply / app-authored) and
      // drops the deferred overlay so we don't overwrite the user's edit.
      if (!this.applyingPendingColumnGroups) {
        if (incomingHasGroups) {
          this.pendingColumnGroupDefs = null;
        } else if (this.pendingColumnGroupDefs) {
          this.flushPendingColumnGroups();
        }
      }
      this.workerCoord.updateColumns(this.workerColumns())
        .then(({ visibleCount }) => {
          if (this.destroyed) return;
          this.rowCount = visibleCount;
          this.recomputeViewport();
          this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
          this.events.emit({ type: 'displayedColumnsChanged', source: 'columnDefsChanged' });
          // Persist / profile restore can install `rowGroupColumns` while
          // only placeholder columnDefs exist (e.g. STOMP demo boot). The
          // worker then rejects unknown group ids and data stays flat while
          // chips stay painted. Re-ship the current group model now that
          // columns exist — `setGroupModel` always pushes the worker even
          // when the main-thread list is unchanged (unlike
          // `setRowGroupColumns`, which short-circuits on sameOrder).
          const groupCols = this.grouping.getRowGroupColumns();
          if (groupCols.length > 0) {
            this.setGroupModel({ rowGroupCols: [...groupCols] });
          }
          // Cycle 14 / Task 6 — `updateGridOptions({ columnDefs })` can
          // change per-column `aggFunc` declarations as part of the swap.
          // Tag as `columnAggFuncChanged` so listeners that care about
          // aggregation-only changes can correlate, even though some
          // swaps in this path are layout-only (column move / pin etc.
          // route through dedicated APIs that pass `null` instead).
          this.requestViewport('columnAggFuncChanged');
        })
        .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] updateColumns:', err); });
    }
    for (const k of Object.keys(partial) as (keyof VelocityGridOptions<TRow>)[]) {
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
      this.setGridOption(k, partial[k] as VelocityGridOptions<TRow>[typeof k]);
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
      syncLoadingOverlay: () => this.loadingOverlay.setLoading(this.options.loading === true),
      syncLoadingMessage: () => this.loadingOverlay.setMessage(this.options.loadingMessage),
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
        this.workerCoord.setEnableCellChangeFlash(enabled).catch((err) => {
          if (!this.destroyed) console.error('[velocity-grid] setEnableCellChangeFlash:', err);
        });
      },
      forwardAsyncTransactionOptions: () => {
        this.workerCoord.setAsyncTransactionOptions({
          waitMillis: this.options.asyncTransactionWaitMillis,
          conflate: this.options.asyncTransactionConflate,
          throttleMillis: this.resolveAsyncThrottleMillis(),
        }).catch((err) => {
          if (!this.destroyed) console.error('[velocity-grid] setAsyncTransactionOptions:', err);
        });
      },
      rebuildSubgrids: () => {
        // Cycle 14 / Task 2 — re-mount the subgrid stack so pinned-row
        // array changes (pinnedTopRowData / pinnedBottomRowData) take
        // effect without re-resolving the column tree.
        //
        // Value-only TOTAL ticks (same row count) still remount today;
        // paint MUST land synchronously. A bare RAF `requestRepaint`
        // under a high-frequency Perspective `on_update` storm can be
        // perpetually deferred behind the next options write, leaving
        // the canvas showing the first totals forever while
        // `getGridOption('pinnedBottomRowData')` keeps moving.
        this.rebuildSubgridStack();
        this.recomputeViewport();
        this.repaintFull();
        this.cgridCanvas?.paintNow();
      },
      /** Value-only pinned-row refresh — no stack remount. */
      refreshPinnedRowPixels: () => {
        this.repaintPinnedRowBands();
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
      updateStatusBar: () => this.updateStatusBar(),
      updatePivotMaxGeneratedColumns: (value) => this.pivotEngine.updateMaxGeneratedColumns(value),
      updateStrictPivotColumnOrder: (value) => this.pivotEngine.updateStrictColumnOrder(value),
      updatePivotTotalsOption: () => this.pivotEngine.updateTotalsOption(),
      updateRowGroupPanelSuppressSort: (suppress) =>
        this.rowGroupPanel?.setRenderOptions({ suppressSort: suppress }),
      updateGroupSelectsChildren: (enabled) => this.applyGroupSelectsChildren(enabled),
      resetPaintCacheLayer: () => this.resetPaintCacheLayer(),
      resetRasterCache: () => this.resetRasterCache(),
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
    // Closure detection / new Function round-trip lives in
    // `serializeAggFuncsMap` — trusted-app source only.
    const entries = serializeAggFuncsMap(funcs);
    const promise = this.workerCoord.setAggFuncs(entries);
    promise.catch((err) => {
      if (!this.destroyed) console.error('[velocity-grid] setAggFuncs:', err);
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
    // Cycle 22 / Task 3 — layoutEpoch contract: DEF-LEVEL rule / format /
    // renderer / cellStyle changes. A columnDefs / defaultColDef rebuild
    // can change every cell's pixels without any data changing OR the
    // resolved geometry differing (which is why the `columnLayout`
    // setter's equality guard alone can't cover this site) — bump
    // unconditionally.
    if (this.rasterStrips !== null) this.stripLayoutEpochBump();
    const prevLeaves = this.columnDefsMap as Map<string, ResolvedColDef<TRow>> | undefined;
    // Cycle 21d / Task 9 — same calc-provider fold as the constructor path.
    this.columnTree = resolveColumnTree(foldCalcColumnDefs<CColDef<TRow> | CColGroupDef<TRow>>(this.options.columnDefs), defaultColDef ?? this.options.defaultColDef, this.options.columnTypes);
    // Live column widths survive the rebuild. A drag-resize (and
    // setColumnWidths / applyColumnState) mutates ONLY the resolved def —
    // re-resolving from `options.columnDefs` would silently discard it, so
    // any calc-driven rebuild (editColumn styling a header, applying a
    // template, …) visibly reset the user's column widths. Carry the
    // previous leaf's width forward UNLESS the calc override explicitly
    // sets a width for that column (an explicit `editColumn({width})` /
    // template width must still win).
    if (prevLeaves !== undefined) {
      const provider = getCalcProvider();
      for (const [colId, def] of this.columnTree.leafById as Map<string, ResolvedColDef<TRow>>) {
        const prev = prevLeaves.get(colId);
        if (prev?.width === undefined || prev.width === def.width) continue;
        const patch = provider?.resolvedPatchFor(
          colId, (def as { cellDataType?: string }).cellDataType === 'number' ? 'number' : 'text',
        );
        if (patch === null || patch === undefined || (patch as { width?: number }).width === undefined) {
          (def as { width?: number }).width = prev.width;
        }
      }
    }
    this.columnDefsMap = this.columnTree.leafById as Map<string, ResolvedColDef<TRow>>;
    this.colGroupPathCache = null;
    // columnTree.leafById is a fresh Map that only holds user-supplied columns.
    // Re-register the synthesized auto-group columns so painter lookups
    // by colId keep working after any rebuildColumns() call (e.g. reorderColumn).
    for (const col of this.grouping.getAutoGroupColumns()) {
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
    // Style-only rebuilds (halign / cellStyle) may leave columnLayout
    // equal — the setter's geometry guard would skip wipe. Always
    // invalidate retained paint + full-paint so alignment/move never
    // leave staggered cells from a warm layer or partial tick.
    this.invalidateRetainedPaintForColumnLayout();
    this.repaintFull();
  }

  /** Rebuild the subgrid stack so the header-group row count matches the
   *  current `columnTree.maxDepth`. Data + leaf header subgrids are
   *  callback-driven and therefore re-pickable as-is. */
  /** Cycle 21i / Phase 1 — auto header height. Lazy measuring ctx +
   *  signature-keyed cache; recomputes only when a wrap-enabled column's
   *  width / header text / font / base height changes. */
  private headerMeasureCtx: CanvasRenderingContext2D | null = null;
  private autoHeaderHeightCache: { signature: string; height: number } | null = null;

  /** Leaf header row height: base (options.headerHeight ?? theme) unless
   *  a visible column sets `wrapHeaderText` + `autoHeaderHeight`, in which
   *  case the row grows to the tallest wrapped header. Group header rows
   *  always use the base height. */
  private effectiveLeafHeaderHeight(): number {
    const base = this.options.headerHeight ?? this.theme.headerHeight;
    const cols = this.viewport?.visibleColumns;
    if (!cols || cols.length === 0) return base;
    const suppress = this.options.suppressAggFuncInHeader === true;
    const wrapCols: Array<{ colId: string; width: number; text: string }> = [];
    let signature = `${this.theme.font}|${base}`;
    for (const c of cols) {
      const def = this.columnDefsMap.get(c.colId);
      if (def?.wrapHeaderText !== true || def?.autoHeaderHeight !== true) continue;
      // Measure the DECORATED text (`sum(P&L)`) — exactly what paints.
      const text = decorateHeader(def, suppress);
      wrapCols.push({ colId: c.colId, width: c.width, text });
      signature += `|${c.colId}:${c.width}:${text}`;
    }
    if (wrapCols.length === 0) return base;
    if (this.autoHeaderHeightCache?.signature === signature) {
      return this.autoHeaderHeightCache.height;
    }
    if (!this.headerMeasureCtx) {
      this.headerMeasureCtx = document.createElement('canvas').getContext('2d');
    }
    const ctx = this.headerMeasureCtx;
    if (!ctx) return base;
    ctx.font = this.theme.font;
    const byId = new Map(wrapCols.map((w) => [w.colId, w.text]));
    const height = computeAutoHeaderHeight({
      columns: wrapCols,
      wrapText: (colId) => byId.get(colId) ?? null,
      measure: (t) => ctx.measureText(t).width,
      font: this.theme.font,
      baseHeight: base,
    });
    this.autoHeaderHeightCache = { signature, height };
    return height;
  }

  private rebuildSubgridStack(): void {
    const stack: Subgrid[] = [];
    // Collapse group-header rows when every group is empty of visible
    // leaves (no groups, or all groups unchecked/hidden) so the header
    // band reverts to the single leaf-header height.
    const groupDepth = visibleHeaderGroupDepth(this.columnTree);
    for (let depth = 0; depth < groupDepth; depth++) {
      stack.push(new HeaderGroupSubgrid(
        () => this.columnTree,
        () => this.options.headerHeight ?? this.theme.headerHeight,
        depth,
        () => this.columnOrder.map((c) => c.colId),
      ));
    }
    stack.push(new HeaderSubgrid(
      this.columnDefsMap as Map<string, ResolvedColDef>,
      () => this.effectiveLeafHeaderHeight(),
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
    if (this.options.pivotGrandTotals === true && this.pivotEngine.isPivotActive()) {
      return 'bottom';
    }
    if (this.options.totalsRowPosition != null) return this.options.totalsRowPosition;
    // AG parity — `grandTotalRow: 'pinnedTop' | 'pinnedBottom'` rides the
    // same pinned totals subgrid `totalsRowPosition` mounts.
    if (this.options.grandTotalRow === 'pinnedBottom') return 'bottom';
    if (this.options.grandTotalRow === 'pinnedTop') return 'top';
    return null;
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
   *  "Row height: var(--vg-row-height) — Cycle-wide constraint"). The
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

  /**
   * Damage + paint pinned-top / pinned-bottom bands in place. Used when
   * `pinned*RowData` values change without a mount/unmount (row count
   * stable) so TOTAL ticks do not rebuild the whole subgrid stack.
   */
  private repaintPinnedRowBands(): void {
    if (this.options.suppressPartialRepaint) {
      this.repaintFull();
      this.cgridCanvas?.paintNow();
      return;
    }
    let top = Infinity;
    let bottom = -Infinity;
    let found = false;
    for (const row of this.viewport.visibleRows) {
      if (!(row.subgrid instanceof PinnedRowsSubgrid) && !row.subgrid.isTotals) continue;
      found = true;
      if (row.top < top) top = row.top;
      if (row.bottom > bottom) bottom = row.bottom;
    }
    if (found) this.damageLedger.add({ kind: 'band', top, bottom });
    else this.damageLedger.add({ kind: 'full' });
    this.cgridCanvas?.requestRepaint();
    this.cgridCanvas?.paintNow();
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
    if (this.pivotEngine.isPivotActive() && parentGroupKey === '') {
      // Match Excel's pivot terminology — "Total Result" labels both the
      // bottom row and the right column header so the corner reads
      // consistently regardless of which axis the eye lands on first.
      if (isAutoGroupColumnId(colId)) {
        return { value: 'Total Result', valueFormatted: 'Total Result' };
      }
      const spec = this.pivotEngine.getCellSpec(colId);
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
    // Grand-total label — the pinned grand-total row shows 'Total' in
    // the auto-group column (AG parity with the in-body grand-total
    // footer), customizable via the same
    // `autoGroupColumnDef.cellRendererParams.totalValueGetter` hook the
    // `'groupFooter'` renderer reads. Per-group lookups never resolve
    // the auto-group column, and `cellAt` routes in-body auto-group
    // cells through the group renderers before this lookup — only the
    // TotalsSubgrid lands here with an auto-group colId.
    if (parentGroupKey === '' && isAutoGroupColumnId(colId)) {
      const totalValueGetter = (this.options.autoGroupColumnDef?.cellRendererParams as {
        totalValueGetter?: (params: { value: string; isGrandTotal: boolean }) => unknown;
      } | undefined)?.totalValueGetter;
      const label = typeof totalValueGetter === 'function'
        ? String(totalValueGetter({ value: '', isGrandTotal: true }) ?? '')
        : 'Total';
      return { value: label, valueFormatted: label };
    }
    let raw: unknown;
    if (parentGroupKey !== '') {
      // Collapsed-group aggregate fix — a per-group lookup must NEVER
      // fall back to the grand-total `chunk.totals` record. It used to
      // (`parentGroupKey !== '' && chunk.groupTotals` fell into the
      // else-branch when `groupTotals` hadn't shipped), which painted
      // the GRAND total on every group row — byte-identical values
      // across distinct groups — and, because grand-total damage only
      // targets the totals band / `groupKey: ''`, those rows never
      // repainted on later ticks either. No per-group record ⇒ paint
      // the cell empty until the worker ships `groupTotals`.
      const groupRec = chunk.groupTotals?.[parentGroupKey];
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
    // Cycle 21 / Floating filter visible by default unless explicitly disabled
    if (this.options.floatingFilter === false) return false;
    if (this.options.floatingFilter === true) return true;
    // Default: floating filter is enabled unless all columns opt out
    for (const col of this.columnOrder) {
      if (col.floatingFilter === false) continue;
      return true; // Show if any column doesn't explicitly disable it
    }
    return true; // Default to showing floating filter row
  }

  destroy(): void {
    if (this.destroyed) return;
    // gridPreDestroyed fires SYNCHRONOUSLY before any teardown so listeners
    // can read state (selection, scroll, column widths) one last time. The
    // state payload is a stub until Cycle 22's snapshot API; shipping the
    // event surface now means apps can wire listeners against a stable shape.
    this.events.emit({ type: 'gridPreDestroyed', state: {} });
    if (this.columnResizeFlushRaf !== 0) {
      cancelAnimationFrame(this.columnResizeFlushRaf);
      this.columnResizeFlushRaf = 0;
    }
    this.columnResizeDragActive = false;
    if (this.ssrmResortTimer != null) {
      clearTimeout(this.ssrmResortTimer);
      this.ssrmResortTimer = null;
    }
    this.ssrmResortFirstAt = null;
    this.ssrm?.destroy();
    this.ssrm = null;
    this.pendingServerSideDatasource = undefined;
    if (!this.readySettled) {
      this.readySettled = true;
      this.resolveReady();
    }
    this.destroyed = true;
    this.deferredAsyncTxs = [];
    this.bodyScrollActive = false;
    // Cycle 21i / Phase 1 — flush any pending autosave BEFORE teardown so
    // the last user change survives an immediate page unload.
    this.statePersistence?.destroy();
    this.statePersistence = null;
    // Tear down every listener / RAF / timer routed through the registry
    // FIRST so callbacks fired during the rest of destroy() (e.g. a scroll
    // event triggered by a layout invalidation) can't hit half-disposed state.
    this.disposables.dispose();
    this.selectionUnsubscribe();
    this.calcProviderUnsub?.();
    if (this.chunkLRU) this.chunkLRU.clear();
    // Closeout I-2 fix — the retained paint-cache layer's backing store
    // (`canvasWidth × (bodyHeight + 2*overscanPx)` device px — tens of MB at
    // HiDPI) is otherwise never freed for a destroyed-but-still-referenced
    // grid (app-side caches, event closures, devtools). `dispose()` zeroes
    // the backing store (`PaintCacheLayer.dispose`'s doc) and is safe to
    // call even on an inert/never-constructed layer.
    this.paintCacheLayer?.dispose();
    this.paintCacheLayer = null;
    this.layerViewportCache = null;
    // Cycle 22 / Task 2 — release both raster-cache tiers' retained
    // bitmaps (same rationale as the layer dispose above: a destroyed-
    // but-still-referenced grid must not pin tens of MB of canvases).
    this.rasterCells?.dispose();
    this.rasterStrips?.dispose();
    this.rasterCells = null;
    this.rasterStrips = null;
    this.rasterBudget = null;
    this.cgridCanvas.destroy();
    this.workerCoord.destroy();
    this.featureChain.destroy();
    this.a11y.destroy();
    this.loadingOverlay.destroy();
    // Cycle 19 / Task 4 — `editController.editor.close()` +
    // `editController.rowEdit.close()` ride on the DisposableRegistry hook
    // the controller registers in its constructor; tearing down via
    // `this.disposables.dispose()` above already fired both.
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
    // Cycle 21i Phase 2 / T4 — close + release any open modal.
    this.modalHost?.destroy();
    this.modalHost = null;
    // Close + release any open floating panel. The content itself
    // (e.g. a tool panel's Style editor) is the caller's responsibility
    // to tear down — this only removes the frame chrome.
    this.floatingPanelHost?.destroy();
    this.floatingPanelHost = null;
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
    // Cycle 19 / Task 5-Grouping — release the grouping coordinator's
    // GroupingState subscribers + clear its event emitter so a late
    // listener can't fire on a destroyed grid.
    this.grouping.destroy();
    // Cycle 18 / Task 3 — release the pivot state subscriber + emitter
    // so a late listener can't fire on a destroyed grid.
    // Cycle 19 / Task 5a — release the pivot engine's state subscriber
    // + underlying PivotState emitter so a late listener can't fire
    // on a destroyed grid.
    this.pivotEngine.destroy();
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
    // Cycle 23 / Task 3 — the `bodyScrollEnd` debounce cleanup is now owned
    // by `ViewportManager`'s disposer (Cycle 19 / Task 2).
    // Cycle 22 / Task 3 — explicit cleanup of any inline `--vg-*`
    // overrides so the WeakMap state doesn't leak past destroy. The
    // root element gets removed below, but apps that re-parent / re-
    // use the host expect the inline styles cleared.
    themeParamsClear(this.root);
    this.root.parentElement?.removeChild(this.root);
    this.events.destroy();
  }

  // --- Internals ------------------------------------------------------------

  private makeApi(): VelocityGridApi<TRow> {
    return {
      setRowData: (r) => this.setRowData(r),
      applyTransaction: (t) => this.applyTransaction(t),
      applyTransactionAsync: (t) => this.applyTransactionAsync(t),
      flushAsyncTransactions: () => this.flushAsyncTransactions(),
      setServerSideDatasource: (ds) => this.setServerSideDatasource(ds),
      refreshServerSide: (p) => this.refreshServerSide(p),
      applyServerSideTransaction: (tx) => this.applyServerSideTransaction(tx),
      whenReady: () => this.whenReady(),
      setSortModel: (s) => this.setSortModel(s),
      setFilterModel: (f) => this.setFilterModel(f),
      setGroupModel: (g) => this.setGroupModel(g),
      setRowGroupColumns: (cols) => this.setRowGroupColumns(cols),
      addRowGroupColumn: (colId) => this.addRowGroupColumn(colId),
      removeRowGroupColumn: (colId) => this.removeRowGroupColumn(colId),
      addRowGroupColumns: (colIds) => this.addRowGroupColumns(colIds),
      removeRowGroupColumns: (colIds) => this.removeRowGroupColumns(colIds),
      moveRowGroupColumn: (from, to) => this.moveRowGroupColumn(from, to),
      setRowGroupColumnSort: (colId, dir) => this.setRowGroupColumnSort(colId, dir),
      getRowGroupColumns: () => this.getRowGroupColumns(),
      // Cycle 18 / Task 3 — pivot API.
      isPivotMode: () => this.isPivotMode(),
      setPivotMode: (m, opts) => this.setPivotMode(m, opts),
      getPivotColumns: () => this.getPivotColumns(),
      setPivotColumns: (cols) => this.setPivotColumns(cols),
      addPivotColumn: (colId) => this.addPivotColumn(colId),
      removePivotColumn: (colId) => this.removePivotColumn(colId),
      movePivotColumn: (from, to) => this.movePivotColumn(from, to),
      getValueColumns: () => this.getValueColumns(),
      addValueColumn: (colId, aggFunc) => this.addValueColumn(colId, aggFunc),
      removeValueColumn: (colId) => this.removeValueColumn(colId),
      moveValueColumn: (from, to) => this.moveValueColumn(from, to),
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
      getPaintStats: () => this.getPaintStats(),
      resetPaintStats: () => this.resetPaintStats(),
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
      isCellEditable: (rowIndex, colId) => this.isCellEditable(rowIndex, colId),
      refresh: () => this.refresh(),
      setTheme: (t) => this.setTheme(t),
      setThemeMode: (m) => this.setThemeMode(m),
      destroy: () => this.destroy(),
      getColumnGroupState: () => this.columnGroupState.getState(),
      setColumnGroupState: (s) => { this.columnGroupState.apply(s); },
      resetColumnGroupState: () => this.columnGroupState.reset(),
      getColumnGroupDefs: () => this.getColumnGroupDefs(),
      refreshToolPanel: (id) => this.refreshToolPanel(id),
      getToolPanelInstance: (id) => this.getToolPanelInstance(id),
      isSideBarVisible: () => this.isSideBarVisible(),
      setSideBarVisible: (show) => this.setSideBarVisible(show),
      setSideBarPosition: (pos) => this.setSideBarPosition(pos),
      openToolPanel: (id) => this.openToolPanel(id),
      closeToolPanel: () => this.closeToolPanel(),
      getOpenedToolPanel: () => this.getOpenedToolPanel(),
      openFloatingPanel: (opts) => this.openFloatingPanel(opts),
      closeFloatingPanel: () => this.closeFloatingPanel(),
      isFloatingPanelOpen: () => this.isFloatingPanelOpen(),
      setFloatingPanelTitle: (title) => this.setFloatingPanelTitle(title),
      fitFloatingPanelHeight: () => this.fitFloatingPanelHeight(),
      getSideBar: () => this.getSideBar(),
      getStatusPanel: <T extends IStatusPanelComp = IStatusPanelComp>(key: string) =>
        this.getStatusPanel<T>(key),
      getGridOption: (k) => this.getGridOption(k),
      setGridOption: (k, v) => this.setGridOption(k, v),
      setLoadingProgress: (loaded, total) => this.setLoadingProgress(loaded, total),
      updateGridOptions: (p) => this.updateGridOptions(p),
      registerCellRenderer: (n, p, o) => this.registerCellRenderer(n, p, o),
      registerFormatCompiler: (fn) => this.registerFormatCompiler(fn),
      registerRuleEngine: (engine) => this.registerRuleEngine(engine),
      registerCalcProvider: (provider) => this.registerCalcProvider(provider),
      forEachRow: (fn) => this.forEachRow(fn),
      getThemeKind: () => this.getThemeKind(),
      // Cycle 21i Phase 2 / T3 — Tier B widening: these existed
      // class-only; customizer panels code against VelocityGridApi, so the
      // aggregate reads + state round-trip belong here.
      getSortModel: () => this.getSortModel(),
      getFilterModel: () => this.getFilterModel(),
      getState: () => this.getState(),
      setState: (snapshot) => this.setState(snapshot),
      getConfig: () => this.getConfig(),
      setConfig: (config) => this.setConfig(config),
      // Grid Layouts (Phase A / A3).
      getLayouts: () => this.getLayouts(),
      getActiveLayoutId: () => this.getActiveLayoutId(),
      getActiveLayout: () => this.getActiveLayout(),
      saveLayout: (name, opts) => this.saveLayout(name, opts),
      updateLayout: (id) => this.updateLayout(id),
      loadLayout: (id) => this.loadLayout(id),
      deleteLayout: (id) => this.deleteLayout(id),
      renameLayout: (id, name) => this.renameLayout(id, name),
      duplicateLayout: (id, name, opts) => this.duplicateLayout(id, name, opts),
      resetLayout: (id) => this.resetLayout(id),
      getGridConfig: () => this.getGridConfig(),
      setGridConfig: (config) => this.setGridConfig(config),
      exportLayout: (id) => this.exportLayout(id),
      exportLayouts: () => this.exportLayouts(),
      importLayout: (layout, opts) => this.importLayout(layout, opts),
      importLayouts: (bundle, opts) => this.importLayouts(bundle, opts),
      // Styling templates (Phase B / B3).
      getTemplates: () => this.getTemplates(),
      saveTemplate: (spec) => this.saveTemplate(spec),
      renameTemplate: (templateId, name) => this.renameTemplate(templateId, name),
      deleteTemplate: (templateId) => this.deleteTemplate(templateId),
      applyTemplate: (colId, templateId) => this.applyTemplate(colId, templateId),
      removeTemplate: (colId, templateId) => this.removeTemplate(colId, templateId),
      getRules: () => this.getRules(),
      addRule: (rule) => this.addRule(rule),
      updateRule: (id, patch) => this.updateRule(id, patch),
      deleteRule: (id) => this.deleteRule(id),
      setRuleEnabled: (id, enabled) => this.setRuleEnabled(id, enabled),
      reorderRules: (orderedIds) => this.reorderRules(orderedIds),
      editColumn: (colId, patch) => this.editColumn(colId, patch),
      listCellRenderers: () => this.listCellRenderers(),
      getModal: () => this.getModal(),
      forEachColumnGroup: (callback) => this.forEachColumnGroup(callback),
      setThemeParams: (patch) => this.setThemeParams(patch),
      getThemeParams: () => this.getThemeParams(),
      getDefaultRowHeight: () => this.theme.rowHeight,
      getDefaultHeaderHeight: () => this.theme.headerHeight,
      registerIconSet: (name, paths) => this.registerIconSet(name, paths),
      resolveIcon: (name, setHint) => this.resolveIcon(name, setHint),
      listIcons: (setName) => this.listIcons(setName),
      registerTooltipProvider: (colId, fn) => this.registerTooltipProvider(colId, fn),
      unregisterTooltipProvider: (colId) => this.unregisterTooltipProvider(colId),
      registerCellEditor: (n, c) => this.registerCellEditor(n, c),
      registerComparator: <TValue = unknown>(n: string, f: (a: TValue, b: TValue) => number) =>
        this.registerComparator<TValue>(n, f),
      startEditingCell: (r, c) => this.openEditor(r, c),
      stopEditing: (cancel) => this.stopEditing(cancel),
      on: (t, h) => this.on(t, h),
      off: (t, h) => this.off(t, h),
      addEventListener: (t, h) => this.addEventListener(t, h),
      removeEventListener: (t, h) => this.removeEventListener(t, h),
      moveColumnByIndex: (f, t) => this.moveColumnByIndex(f, t),
      getColumnState: () => this.getColumnState(),
      getColumnHeaderName: (colId) => this.getColumnHeaderName(colId),
      isColumnRowGroupEnabled: (colId) => this.isColumnRowGroupEnabled(colId),
      isColumnPivotEnabled: (colId) => this.isColumnPivotEnabled(colId),
      isColumnValueEnabled: (colId) => this.isColumnValueEnabled(colId),
      getColumnFilterType: (colId) => this.getColumnFilterType(colId),
      getDistinctValues: (colId, limit) => this.getDistinctValues(colId, limit),
      getRowsByIndex: (idx) => this.getRowsByIndex(idx),
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
      moveColumnToGroup: (colId, targetGroupId, beforeColId) =>
        this.moveColumnToGroup(colId, targetGroupId, beforeColId),
      moveColumnGroup: (groupId, targetParentGroupId, beforeId) =>
        this.moveColumnGroup(groupId, targetParentGroupId, beforeId),
      getCellBoundsAt: (r, c) => this.getCellBoundsAt(r, c),
      getHeaderBoundsAt: (c) => this.getHeaderBoundsAt(c),
      getRowBoundsAt: (r) => this.getRowBoundsAt(r),
      getCellValue: (r, c) => this.getCellValue(r, c),
      getCellPaintedBg: (r, c) => this.getCellPaintedBg(r, c),
      // External-drag routers — exposed so tool panels (Columns side
      // panel) can drag a row onto the top-strip Row Groups panel, the
      // top-strip Pivot panel (Column Labels), or the column header
      // band itself, and have the drop commit.
      isPointInRowGroupPanel: (x, y) => this.isPointInRowGroupPanel(x, y),
      setRowGroupPanelDragHover: (colId, x, y) => this.setRowGroupPanelDragHover(colId, x, y),
      commitRowGroupPanelDrop: (colId) => this.commitRowGroupPanelDrop(colId),
      isPointInPivotPanel: (x, y) => this.isPointInPivotPanel(x, y),
      setPivotPanelDragHover: (colId, x, y) => this.setPivotPanelDragHover(colId, x, y),
      commitPivotPanelDrop: (colId) => this.commitPivotPanelDrop(colId),
      isPointInColumnHeaderBand: (x, y) => this.isPointInColumnHeaderBand(x, y),
      setColumnHeaderDragHover: (colId, x, y) => this.setColumnHeaderDragHover(colId, x, y),
      commitColumnHeaderDrop: (colId, x) => this.commitColumnHeaderDrop(colId, x),
    } as VelocityGridApi<TRow>;
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
      // Cycle 22 / Task 3 — layoutEpoch contract: COLUMN-GROUP OPEN/CLOSE
      // (Task 1 carry-forward #2). A toggle changes column visibility /
      // geometry; bump explicitly (the `columnLayout` setter below also
      // catches the geometric case, but a toggle whose layout happens to
      // resolve identically must still never reuse pre-toggle strips).
      if (this.rasterStrips !== null) this.stripLayoutEpochBump();
      this.columnOrder = this.computeVisibleColumnOrder();
      this.columnLayout = resolveColumnWidths(this.columnOrder, this.canvasBounds.width || this.scroller.clientWidth || 800);
      this.recomputeViewport();
      // columnLayout setter already wiped retained paint; force full.
      this.repaintFull();
      for (const c of changed) {
        this.events.emit({ type: 'columnGroupOpened', groupId: c.groupId, open: c.open });
      }
      this.events.emit({ type: 'displayedColumnsChanged', source: 'columnGroupOpened' });
      // Re-ship the worker's column metadata BEFORE re-fetching the chunk.
      // `workerColumns()` starts from the VISIBLE column order, so a leaf
      // hidden at init time (e.g. the grid booted from saved state with its
      // group collapsed) is absent from the worker's colIndex; a toggle that
      // reveals it would otherwise request values for a column the worker
      // doesn't know, leaving the cells permanently blank. Mirrors the
      // `setColumnsVisible` / column-move paths.
      if (this.workerCoord) {
        this.workerCoord.updateColumns(this.workerColumns())
          .then(({ visibleCount }) => {
            this.rowCount = visibleCount;
            this.recomputeViewport();
            this.requestViewport();
          })
          .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] columnGroup updateColumns:', err); });
      }
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
    // The `hide` flag is the sole authority for column visibility —
    // pivot mode is not a special case. Whatever the columns side
    // panel checkbox says about a column must match what's on the
    // grid, without exception. Visibility flips (panel click,
    // `setColumnsVisible`, role auto-hide, etc.) all route through
    // `def.hide`; nothing else gets to override it here.
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
    const autoGroups = this.grouping.getAutoGroupColumns();
    if (autoGroups.length > 0) {
      return [...autoGroups, ...visible];
    }
    return visible;
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
    if (this.grouping.getGroupModel().rowGroupCols.length === 0) return null;
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
    const rowGroupDepthCount = this.grouping.getRowGroupColumns().length;
    if (
      this.pivotEngine.isPivotActive()
      && rowGroupDepthCount > 0
      && rowDepth === rowGroupDepthCount - 1
    ) return null;
    // Chevron geometry must agree with `renderer/cellRenderers/group.ts`.
    // Expand hit target: from the chevron through the rest of the
    // auto-group cell (label + count). The checkbox lane (when enabled)
    // is excluded so GroupExpandFeature can still route it separately.
    // A 12px-only chevron was too easy to miss — users reported groups
    // as "unexpandable" when clicking the group label.
    const PADDING = 6;
    const CHEVRON_SIZE = 12;
    const CHEVRON_GAP = 6;
    const CHECKBOX_SIZE = 14;
    const HIT_PAD = 4;
    const INDENT_UNIT = 14;
    const indentX = colDepth !== null ? 0 : rowDepth * INDENT_UNIT;
    const chevronLeft = col.left + PADDING + indentX;
    let hitRight = col.right;
    if (this.selection.isGroupSelectsChildren()) {
      const checkboxLeft = chevronLeft + CHEVRON_SIZE + CHEVRON_GAP;
      hitRight = Math.min(hitRight, checkboxLeft - HIT_PAD);
    }
    if (x < chevronLeft - HIT_PAD || x > hitRight) return null;
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
    // Cycle 21i moved the painted band to anchor on the auto-group
    // column's left (pinned-left by default), not `bodyLeft` — the hit
    // zone must live where the chevron paints, or with a pinned group
    // column every sticky-caret click lands short of `bodyLeft` and
    // falls through to the leaf row hidden under the band.
    const autoGroupCol = vs.visibleColumns.find((c) => isAutoGroupColumnId(c.colId));
    const bandLeft = autoGroupCol ? Math.min(autoGroupCol.left, bodyLeft) : bodyLeft;
    if (y < bodyTop || y >= bodyTop + ancestors.length * rowH) return null;
    if (x < bandLeft || x >= bodyRight) return null;
    const bandIdx = Math.floor((y - bodyTop) / rowH);
    const ancestor = ancestors[bandIdx];
    if (!ancestor) return null;
    const PADDING = 6;
    const CHEVRON_SIZE = 12;
    const INDENT_UNIT = 14;
    const HIT_PAD = 4;
    const indentX = ancestor.depth * INDENT_UNIT;
    const left = bandLeft + PADDING + indentX;
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
    // Sparse SSRM v2 — descendants of unloaded leaves are unknown to the
    // worker; resolve them through the datasource's optional
    // `getGroupLeafIds`, seed the descendant cache, then cascade through
    // the normal SelectionModel path (tri-state paint included).
    if (this.ssrmV2 && this.ssrm instanceof ServerSideRowModelV2Controller) {
      const ctrl = this.ssrm as ServerSideRowModelV2Controller<TRow>;
      void ctrl.fetchGroupLeafIds(groupKey).then((ids) => {
        if (this.destroyed) return;
        if (ids !== null) this.groupDescendantsByKey.set(groupKey, ids);
        this.selection.setGroupSelected(groupKey, selected);
        this.rebuildSelectionFromPersistentIds();
      }).catch(() => { /* leave selection untouched on datasource failure */ });
      return;
    }
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
    // CSRM: null = expand-all. Sparse SSRM: null = the DEFAULT expansion
    // set (per-key — must NOT materialise knownGroupKeys wholesale, which
    // would expand every other desk when the user clicks the first).
    const currentlyExpanded = this.expandedKeys === null
      ? this.isKeyExpandedUnderNullSentinel(groupKey)
      : this.expandedKeys.has(groupKey);
    const next = !currentlyExpanded;
    const materialised = this.expandedKeys === null
      ? this.materializeExpandedKeysFromNull()
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

  /** AG parity — mirrors `VelocityGridOptions.suppressDoubleClickExpand` for the
   *  GroupExpandFeature's double-click handler. */
  isGroupDoubleClickExpandSuppressed(): boolean {
    return this.options.suppressDoubleClickExpand === true;
  }

  /** AG parity — derive construction-time row-group columns from
   *  `colDef.rowGroup` / `rowGroupIndex`. Indexed entries order first
   *  (by index, ties by definition order); bare `rowGroup: true` columns
   *  follow in definition order. A set `rowGroupIndex` implies grouping
   *  even without `rowGroup: true` (AG semantics). */
  private computeInitialRowGroupColumns(): string[] {
    // Read the RAW columnDefs — the resolver treats rowGroup/rowGroupIndex
    // as reserved fields and does not carry them onto ResolvedColDef.
    const leaves: Array<Record<string, unknown>> = [];
    const collect = (list: readonly unknown[] | undefined): void => {
      for (const d of (list ?? []) as Array<Record<string, unknown>>) {
        if (d && Array.isArray((d as { children?: unknown[] }).children)) {
          collect((d as { children: unknown[] }).children);
        } else if (d) {
          leaves.push(d);
        }
      }
    };
    collect(this.options.columnDefs as unknown as readonly unknown[]);

    const entries: Array<{ colId: string; index: number | null; seq: number }> = [];
    let seq = 0;
    for (const d of leaves) {
      const colId = String(d.colId ?? d.field ?? '');
      const hasIdx = typeof d.rowGroupIndex === 'number';
      if (colId !== '' && (hasIdx || d.rowGroup === true)) {
        entries.push({ colId, index: hasIdx ? (d.rowGroupIndex as number) : null, seq });
      }
      seq++;
    }
    entries.sort((a, b) => {
      if (a.index !== null && b.index !== null) return a.index - b.index || a.seq - b.seq;
      if (a.index !== null) return -1;
      if (b.index !== null) return 1;
      return a.seq - b.seq;
    });
    return entries.map((e) => e.colId);
  }

  /** Construction-time `colDef.aggFunc` → value-column registry (AG parity).
   *  Array-form `aggFunc: ['sum','avg']` seeds the first entry. */
  private computeInitialValueColumns(): Array<{ colId: string; aggFunc: string }> {
    const leaves: Array<Record<string, unknown>> = [];
    const collect = (list: readonly unknown[] | undefined): void => {
      for (const d of (list ?? []) as Array<Record<string, unknown>>) {
        if (d && Array.isArray((d as { children?: unknown[] }).children)) {
          collect((d as { children: unknown[] }).children);
        } else if (d) {
          leaves.push(d);
        }
      }
    };
    collect(this.options.columnDefs as unknown as readonly unknown[]);

    const out: Array<{ colId: string; aggFunc: string }> = [];
    for (const d of leaves) {
      const colId = String(d.colId ?? d.field ?? '');
      if (!colId) continue;
      const agg = d.aggFunc;
      if (typeof agg === 'string' && agg.length > 0) {
        out.push({ colId, aggFunc: agg });
      } else if (Array.isArray(agg) && typeof agg[0] === 'string' && agg[0].length > 0) {
        out.push({ colId, aggFunc: agg[0] });
      }
    }
    return out;
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
    const rowGroupDepthCount = this.grouping.getRowGroupColumns().length;
    const suppressChevron = rowKind === 1
      && this.pivotEngine.isPivotActive()
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

  /**
   * Damage-region rendering (Task 6 pixel-invariance follow-up) — current
   * visible-window row indices for every group / per-group-footer /
   * grand-total row whose composite key has an active entry in
   * `groupFlashMap` (keys are `${groupKey}\0${colId}`, or `\0${colId}` for
   * the grand total). Group/footer/grand-total rows carry no rowId (so
   * `repaintCells` can't address them), but they ARE ordinary DataSubgrid
   * rows — `chunk.groupKey[i]` / `chunk.rowKinds[i]` (1 = group, 2 =
   * grandTotal, 3 = footer) address them the same way leaf rows are
   * addressed by `chunk.rowIds[i]` — so this resolves them for an ordinary
   * `repaintRows` band repaint instead of the previous unconditional
   * full-repaint fallback. Returns `[]` when nothing currently visible
   * matches (caller falls back to full — the row may have scrolled out of
   * view since it started flashing, and "unknown position" still degrades
   * toward full, never toward under-painting).
   */
  private groupFlashRowIndices(): number[] {
    const chunk = this.chunk;
    if (!chunk || this.groupFlashMap.size === 0) return [];
    const activeGroupKeys = new Set<string>();
    for (const k of this.groupFlashMap.keys()) {
      const nul = k.indexOf('\0');
      activeGroupKeys.add(nul === -1 ? k : k.slice(0, nul));
    }
    const out: number[] = [];
    for (let i = 0; i < chunk.rowCount; i++) {
      const kind = chunk.rowKinds[i] ?? 0;
      if (kind !== 1 && kind !== 2 && kind !== 3) continue; // leaf rows never carry group flashes
      const key = chunk.groupKey?.[i] ?? '';
      if (activeGroupKeys.has(key)) out.push(chunk.rowStart + i);
    }
    return out;
  }

  /**
   * Damage-region rendering (Task 6 pixel-invariance follow-up) — the flat
   * grand-total row's current band, for the common case where NO row
   * grouping is active but aggregated (`aggFunc`) columns still show a
   * grand-total footer. That row paints through a dedicated `TotalsSubgrid`
   * (`isTotals: true`), a SEPARATE row-index space from the regular
   * DataSubgrid `groupFlashRowIndices` resolves against — so it never
   * shows up there (confirmed empirically: `chunk.rowKinds` is all-zero
   * whenever grouping is off, even though `chunk.totals` is populated and
   * `groupFlashMap` gets a `\0${colId}` entry per changed aggregate).
   * Returns `null` when the grand-total key has no active flash entry, or
   * when no `TotalsSubgrid` row is currently in the viewport.
   */
  private groupFlashTotalsBand(): { top: number; bottom: number } | null {
    let grandTotalActive = false;
    for (const k of this.groupFlashMap.keys()) {
      if (k.startsWith('\0')) { grandTotalActive = true; break; }
    }
    if (!grandTotalActive) return null;
    let top = Infinity, bottom = -Infinity, found = false;
    for (const row of this.viewport.visibleRows) {
      if (!row.subgrid.isTotals) continue;
      found = true;
      if (row.top < top) top = row.top;
      if (row.bottom > bottom) bottom = row.bottom;
    }
    return found ? { top, bottom } : null;
  }

  /**
   * Damage-region rendering (Task 6 pixel-invariance follow-up) — resolve
   * `groupFlashMap`'s currently-active entries to concrete damage
   * (`groupFlashRowIndices` for data-space group/footer rows,
   * `groupFlashTotalsBand` for the flat grand-total row) and queue it for
   * the next paint. Honors `suppressPartialRepaint` (forces full,
   * unconditionally — the explicit escape hatch). Otherwise, when NEITHER
   * resolution locates anything currently visible, this is a genuine no-op
   * — not a fallback to full. "Degrade toward full, never under-paint"
   * only applies when something ON SCREEN might be affected; a grand-total
   * row that's scrolled out of the viewport entirely (the common case for
   * a tall, ungrouped dataset — confirmed empirically: `vs.visibleRows`
   * has zero `isTotals` entries when scrolled anywhere near the top of a
   * 5000-row set) has nothing visible to under-paint, so forcing a full
   * repaint here bought nothing but cost everything: it was the dominant
   * source of full paints under live ticking (every aggregate-touching
   * batch re-triggered ~1.5s of full-repaint-per-frame from the flash
   * fade loop, for a row nobody could see).
   */
  private repaintGroupFlash(): void {
    if (this.options.suppressPartialRepaint) { this.repaintFull(); return; }
    const rows = this.groupFlashRowIndices();
    const band = this.groupFlashTotalsBand();
    if (rows.length === 0 && !band) return;
    if (band) this.damageLedger.add({ kind: 'band', top: band.top, bottom: band.bottom });
    if (rows.length > 0) this.damageLedger.add({ kind: 'rows', rowIndices: rows });
    // C4 — a sticky ancestor's LIVE total (painted via
    // `getStickyGroupTotals`, not the regular chunk row it's derived from)
    // is invisible to both `groupFlashRowIndices` (walks only chunk-window
    // rows) and `groupFlashTotalsBand` (the flat `TotalsSubgrid` only) — a
    // sticky ancestor is by definition scrolled ABOVE the fetch window. Any
    // group total change might belong to a pinned ancestor, so redamage
    // the whole sticky band whenever one is showing rather than trying to
    // identify which ancestor (cheap: the band is small).
    if (this.stickyAncestors.length > 0) this.repaintStickyBand();
    this.cgridCanvas.requestRepaint();
  }

  /**
   * C3 fix — resolve CHANGED aggregate cells to damage regardless of
   * `enableCellChangeFlash`. Mirrors `groupFlashRowIndices` /
   * `groupFlashTotalsBand` but is driven directly by the diff computed in
   * `diffAggregates` (this chunk's changed group keys / grand-total flag)
   * rather than `groupFlashMap`, which stays empty — and so resolves to no
   * damage at all — when flash is disabled (the DEFAULT). Also redamages
   * the sticky band (C4) since a changed group total may belong to a
   * pinned ancestor.
   */
  private repaintAggregateDamage(changedGroupKeys: Set<string>, grandTotalChanged: boolean): void {
    if (this.options.suppressPartialRepaint) { this.repaintFull(); return; }
    const chunk = this.chunk;
    if (chunk && changedGroupKeys.size > 0) {
      const rows: number[] = [];
      for (let i = 0; i < chunk.rowCount; i++) {
        const kind = chunk.rowKinds[i] ?? 0;
        if (kind !== 1 && kind !== 2 && kind !== 3) continue; // leaf rows never carry group totals
        const key = chunk.groupKey?.[i] ?? '';
        if (changedGroupKeys.has(key)) rows.push(chunk.rowStart + i);
      }
      if (rows.length > 0) this.damageLedger.add({ kind: 'rows', rowIndices: rows });
    }
    if (grandTotalChanged) {
      let top = Infinity, bottom = -Infinity, found = false;
      for (const row of this.viewport.visibleRows) {
        if (!row.subgrid.isTotals) continue;
        found = true;
        if (row.top < top) top = row.top;
        if (row.bottom > bottom) bottom = row.bottom;
      }
      if (found) this.damageLedger.add({ kind: 'band', top, bottom });
    }
    if (this.stickyAncestors.length > 0) this.repaintStickyBand();
    this.cgridCanvas.requestRepaint();
  }

  /** C4 — redamage the sticky ancestor band + its drop-shadow bleed.
   *  Shared by `repaintGroupFlash` (flash-enabled aggregate changes) and
   *  `repaintAggregateDamage` (C3's flash-disabled path) — both are places
   *  a group total can change while an ancestor of that group is pinned
   *  above the fetch window, invisible to the regular chunk-row damage
   *  paths above. */
  private repaintStickyBand(): void {
    const bandTop = this.viewport.bodyTop;
    const bandBottom = bandTop
      + this.stickyAncestors.length * this.theme.rowHeight
      + STICKY_SHADOW_BLEED_PX;
    this.damageLedger.add({ kind: 'band', top: bandTop, bottom: bandBottom });
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
    if (this.expandedKeys === null) {
      // CSRM expand-all sentinel; sparse SSRM → per-key default set.
      return this.isKeyExpandedUnderNullSentinel(groupKey);
    }
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
    const primaryLeaves = this.pivotEngine.getPrimaryColumnTree()?.leafById ?? this.columnDefsMap;
    // Columns the worker needs in its colIndex even when hidden from the
    // display: row-group columns (GroupPass) + pivot columns + value
    // columns (PivotPass reads their fields). Cycle 15 hid grouped cols;
    // Cycle 18 / Task 3 hides ALL primaries under pivot, so the pivot +
    // value columns must be re-appended or the worker loses their fields.
    const extraIds = new Set<string>();
    for (const id of this.grouping.getGroupModel().rowGroupCols) if (!visibleIds.has(id)) extraIds.add(id);
    for (const id of this.pivotEngine.getPivotColumns()) if (!visibleIds.has(id)) extraIds.add(id);
    for (const v of this.pivotEngine.getValueColumns()) if (!visibleIds.has(v.colId)) extraIds.add(v.colId);
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
      // AG parity 2026-07-21 — keyCreator crosses to the worker as source
      // (same serialization contract as comparators / custom aggFuncs).
      const keyCreator = (c as unknown as { keyCreator?: unknown }).keyCreator;
      if (typeof keyCreator === 'function') {
        base.keyCreatorSource = String(keyCreator);
      }
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
        base.autoHeightFont = fontFromCell ?? this.theme.cellFont ?? this.theme.font;
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
    const fallback = clampRowHeight(this.options.rowHeight ?? this.theme.rowHeight);
    let any = false;
    for (let i = 0; i < heights.length; i++) {
      const globalIdx = rowStart + i;
      if (globalIdx >= idx.length()) break;
      const raw = heights[i]!;
      const resolved = clampRowHeight(raw > 0 ? raw : fallback);
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
            this.chunk.heights[localIdx] = clampRowHeight(
              heights[i]! > 0 ? heights[i]! : fallback,
            );
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
      void this.workerCoord.measureTextResponse(batchId, new Float32Array(items.length));
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
    void this.workerCoord.measureTextResponse(batchId, heights);
  }

  /** Cycle 19 / Task 2 — delegates to `ViewportManager.recompute`. Kept as
   *  a thin wrapper so the 50+ internal `this.recomputeViewport()` callsites
   *  still compile unchanged. The manager owns `computeCurrentViewport` +
   *  `syncSizer` + `detectVirtualColumnsChanged` + the floating-filter
   *  re-pin (via the `afterRecompute` dep). */
  private recomputeViewport(afterScroll: boolean = false): void {
    this.viewport = this.viewportManager.recompute(afterScroll);
    // Horizontal-scroll staleness fix (Cycle 22 closeout) — the viewport
    // now carries a scrollLeft the canvas was NOT last painted at: the
    // scroll handler's queued FULL damage was consumed by a paint that
    // ran BEFORE this recompute (the async fetch→chunk round-trip), so it
    // re-rendered the OLD position and the damage is spent. A diff-armed
    // chunk reply (`touchedRows` defined — any grid that has ever applied
    // a transaction, i.e. every live-ticking blotter) then resolves to
    // row-level damage only, leaving the surface at the old scrollLeft
    // forever while later row repaints land at the new one — per-row
    // horizontal misalignment, persistent at rest. Re-queue the full
    // repaint HERE, the single choke point where `this.viewport` moves,
    // so no scroll entry point (wheel, API, clamp) can miss it. The
    // ledger's 'full' entry absorbs/coalesces with any damage already
    // queued, so the common fast path (chunk lands before the paint, or
    // an undiffed reply that already resolves 'full') costs nothing
    // extra. `cgridCanvas` is unassigned during the constructor's first
    // recompute — nothing has painted yet, the first paint is full anyway.
    if (
      this.viewport.scrollLeft !== this.lastPaintedViewportScrollLeft
      && this.cgridCanvas
      && !this.destroyed
    ) {
      this.repaintFull();
    }
    // Column-geometry / style-layout staleness — keep forcing full until a
    // damage.full paint stamps `lastPaintedLayoutPaintEpoch`. Do NOT
    // re-bump the epoch here (scroll recomputes every tick); invalidation
    // sites already advanced it.
    if (
      this.layoutPaintEpoch !== this.lastPaintedLayoutPaintEpoch
      && this.cgridCanvas
      && !this.destroyed
    ) {
      this.repaintFull();
    }
  }

  /**
   * Wipe retained surfaces that embed absolute column x / cell style
   * (paint-cache layer pixels + layer-viewport memo) and advance
   * `layoutPaintEpoch` so `recomputeViewport` keeps re-queuing full
   * paints until a real full frame lands. Does not itself request a
   * repaint — callers pair with `repaintFull()`.
   */
  private invalidateRetainedPaintForColumnLayout(): void {
    this.layoutPaintEpoch++;
    this.layerViewportCache = null;
    this.paintCacheLayerAnchored = false;
    // Stay on legacy for the whole resize drag — clearing defer here would
    // let the next frame rebuild/present the layer with mixed widths.
    this.paintCacheDeferLayer = this.columnResizeDragActive ? true : false;
    const layer = this.paintCacheLayer;
    if (layer?.available) {
      layer.reset(layer.geometry().layerTop);
    }
  }

  /** Task 4 (paint-cache layer) — `true` when the retained layer is
   *  actually usable THIS paint: the option isn't explicitly `false` AND
   *  the layer's own offscreen-canvas construction succeeded. Every call
   *  site that decides between the retained-layer frame algorithm and the
   *  legacy `Renderer.paint()` escape hatch gates on this, never on a bare
   *  `this.paintCacheLayer !== null` (which stays non-null even for an
   *  inert, construction-failed instance). */
  private paintCacheActive(): boolean {
    return this.options.paintCache !== false && (this.paintCacheLayer?.available ?? false);
  }

  /** Task 4 (paint-cache layer) — runtime `paintCache` / `paintCacheOverscan`
   *  flip handler (wired via `RuntimeOptionTarget.resetPaintCacheLayer`).
   *  Disposes any existing layer instance and, when the option is now
   *  active, constructs a fresh one — a flip is treated as a full
   *  teardown/rebuild per the spec (`paintCacheOverscan` changing the
   *  layer's target height is ALSO a `planLayer` reset condition on its
   *  own, but disposing here is simpler than trying to reuse a
   *  differently-sized backing store across an option change apps make
   *  rarely, if ever, at runtime). `paintCacheLayerAnchored = false` +
   *  `repaintFull()` force the next paint through a full layer reset +
   *  full chrome raster, so the flip is never a stale-present frame. */
  private resetPaintCacheLayer(): void {
    this.paintCacheLayer?.dispose();
    this.paintCacheLayer = this.options.paintCache !== false ? new PaintCacheLayer() : null;
    this.paintCacheLayerAnchored = false;
    this.paintCacheDeferLayer = false;
    this.layerViewportCache = null;
    this.layoutPaintEpoch++;
    this.repaintFull();
  }

  /** Cycle 22 / Task 2 — construct both raster-cache tiers from ONE
   *  shared `RasterBudget` sized by `rasterCacheBudgetMB` (default 48).
   *  Both stores use the same platform-canvas policy the paint-cache
   *  layer uses (`defaultCanvasFactory`); construction never throws. */
  private buildRasterCaches(): void {
    const mb = this.options.rasterCacheBudgetMB ?? 48;
    const budget = new RasterBudget(Math.max(1, mb) * 1024 * 1024);
    this.rasterBudget = budget;
    this.rasterCells = new CellBitmapCache(budget, defaultCanvasFactory);
    this.rasterStrips = new RowStripCache(budget, defaultCanvasFactory);
    this.rasterCellsDpr = 0;
  }

  /** Cycle 22 / Task 2 — the per-paint Tier-1 handle for the byRows cell
   *  seam. `null` (⇒ every cell paints live, the exact shipped pipeline)
   *  when `rasterCache: false` or the store's canvas construction failed.
   *  Also owns the DPR epoch: a devicePixelRatio change invalidates every
   *  cached bitmap (they were rasterized at the old dpr — blitting them
   *  under the new CTM would scale/blur, the C1 lesson's cousin). Reads
   *  `window.devicePixelRatio` fresh (NOT `cgridCanvas.devicePixelRatio`)
   *  because the paint closure can run synchronously from inside
   *  `VelocityGridCanvas`'s own constructor, before `this.cgridCanvas` exists —
   *  the same gotcha the layer's own dpr read documents. */
  private getRasterCellsCtx(): RasterCellsCtx | null {
    const cache = this.rasterCells;
    if (this.options.rasterCache === false || cache === null || !cache.available) return null;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // Cycle 22 / closeout I-2 (adjudicated BYPASS) — at non-integer dpr
    // (Windows 125%/150% scaling) the hit blit's CSS-px dest rect maps to a
    // FRACTIONAL device origin, so `drawImage` resamples: hit pixels would
    // not be byte-identical to a live paint. Tier 1 goes fully dormant
    // (every cell paints live — the shipped pipeline). Gated BEFORE the
    // dpr-epoch tracking below so an integer→fractional→same-integer round
    // trip keeps its still-valid integer-dpr bitmaps. Strip capture/consume
    // stay on at any dpr (integer-device-px copies of the layer's own
    // raster); the strip PATCH path carries its own gate — see
    // `applyStripCellDamage`. A bypass is a perf miss, a stale blit is a bug.
    if (!Number.isInteger(dpr)) return null;
    if (dpr !== this.rasterCellsDpr) {
      if (this.rasterCellsDpr !== 0) this.rasterCacheEpochBump();
      this.rasterCellsDpr = dpr;
    }
    // Task 4 — `surfaceBg` (the opaque base the miss scratch flattens
    // over) is read fresh per paint; it only moves on a theme swap, which
    // already bumps the epoch, so stale bitmaps can never be served
    // against a new surface color.
    return { cache, dpr, surfaceBg: this.theme.bg, stats: this.paintStats };
  }

  /** Cycle 22 / Task 2 — theme/dpr epoch: invalidate EVERY cached raster
   *  in both tiers (bytes return to the shared budget immediately; the
   *  backing canvases land in the reuse pools). Wired at the same sites
   *  the paint-cache layer already resets on: every theme re-read
   *  (`setTheme` / `setThemeMode` / `setThemeParams` / `setDensity` /
   *  `setState`'s themeParams clear) and a devicePixelRatio change
   *  (detected in `getRasterCellsCtx`). Theme-scoped colors deliberately
   *  OUTSIDE `cellStyleSignature`'s key (`checkboxCheckedBg/Fg`,
   *  `group*`, `emptyFg`, `palette`) ride exactly this epoch. */
  private rasterCacheEpochBump(): void {
    this.rasterCells?.epochBump();
    // Cycle 22 / Task 3 — layoutEpoch contract: THEME changes (every
    // caller of this method) and DPR changes (`getRasterCellsCtx`'s
    // detector) stale every strip's pixels; `stripLayoutEpochBump` both
    // advances the epoch counter and drops the store.
    this.stripLayoutEpochBump();
  }

  /** Cycle 22 / Task 3 — advance the Tier-2 strip layout epoch AND drop
   *  every retained strip. THE single mechanism behind every "layoutEpoch
   *  contract" call site: column width/order/visibility/pin (the
   *  `columnLayout` setter), column-group open/close
   *  (`subscribeColumnGroupState`), theme + dpr (`rasterCacheEpochBump`),
   *  canvas width (`setBounds`), horizontal scroll
   *  (`getRasterStripsCtx`), quick-filter term change
   *  (`applyQuickFilter`), sort change (`setSortModel`), def-level
   *  rule/format/renderer changes (`rebuildColumns`), and the
   *  unknown-diff chunk wipe (`handleViewportChunk`). */
  private stripLayoutEpochBump(): void {
    this.stripLayoutEpoch++;
    this.rasterStrips?.layoutEpochBump();
  }

  /** Cycle 22 / Task 3 — the per-paint Tier-2 handle for the retained
   *  layer's band raster. `null` (⇒ the strip path is fully dormant,
   *  byte-identical call sequence to the shipped pipeline) when
   *  `rasterCache: false` or the store's canvas construction failed.
   *  Also owns the HORIZONTAL-SCROLL layoutEpoch bump: strips are
   *  absolute-x device-px snapshots of full layer rows, and `scrollLeft`
   *  shifts every column's pixels, so any change stales the whole store
   *  (the vertical axis needs no such bump — strips are re-anchored per
   *  row at blit time). Checked here, at the consume site, so no scroll
   *  entry point can be missed. */
  private getRasterStripsCtx(): RasterStripsCtx | null {
    const cache = this.rasterStrips;
    if (this.options.rasterCache === false || cache === null || !cache.available) return null;
    // layoutEpoch contract — horizontal scroll.
    const sl = this.viewport.scrollLeft;
    if (sl !== this.stripScrollLeft) {
      this.stripScrollLeft = sl;
      this.stripLayoutEpochBump();
    }
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    let ctx = this.stripsCtxMemo;
    if (ctx === null || ctx.cache !== cache) {
      ctx = {
        cache,
        dpr,
        rowVersionOf: (rowIndex) => {
          const id = this.stringRowIdAt(rowIndex);
          if (id === null || id === '') return null;
          return this.rowVersionByRowId.get(id) ?? 0;
        },
        stringRowIdAt: (rowIndex) => this.stringRowIdAt(rowIndex),
        eligible: (rowIndex) => this.stripRowEligible(rowIndex),
        layoutEpoch: () => this.stripLayoutEpoch,
        stats: this.paintStats,
      };
      this.stripsCtxMemo = ctx;
    } else {
      ctx.dpr = dpr;
      // `resetPaintStats` swaps the whole object — re-point every read.
      ctx.stats = this.paintStats;
    }
    return ctx;
  }

  /** Cycle 22 / Task 3 — the BINDING Tier-2 eligibility contract,
   *  enforced identically on capture and consume (the renderer calls this
   *  once per candidate row per layer raster). A row is strip-cacheable
   *  only when it is a PLAIN data row:
   *   - no active quick-filter terms (the match tint is data+term
   *     dependent, not captured in the version key);
   *   - inside the current chunk window with rowKind 0 (group=1 and
   *     footer=3 rows carry structural chrome; totals/pinned/sticky rows
   *     never reach here — they are not DataSubgrid rows);
   *   - NOT immediately above a footer row (`groupFooterBorderTop`
   *     overpaints this row's bottom pixel line with the footer border —
   *     that line must never ride a strip);
   *   - not holding the focused cell, not selected, not hovered;
   *   - no live flash on any of its cells.
   *  Anything else paints live: a bypass is a perf miss, a stale strip is
   *  a bug. */
  private stripRowEligible(rowIndex: number): boolean {
    if (this.quickFilterLowerTerms.length > 0) return false;
    const chunk = this.chunk;
    if (chunk === null) return false;
    const local = rowIndex - chunk.rowStart;
    if (local < 0 || local >= chunk.rowCount) return false;
    if ((chunk.rowKinds[local] ?? 0) !== 0) return false;
    if (local + 1 < chunk.rowCount && (chunk.rowKinds[local + 1] ?? 0) === 3) return false;
    const sel = this.selection.state;
    if (sel.focusedRowIndex === rowIndex) return false;
    if (sel.selectedRowIndices.has(rowIndex)) return false;
    if (!this.options.suppressRowHoverHighlight && this.hoveredRowIndex === rowIndex) return false;
    if (this.flashRegistry.size() > 0) {
      const nid = chunk.rowIds[local];
      if (nid !== undefined && this.flashRegistry.hasRow(nid)) return false;
    }
    return true;
  }

  /** Cycle 22 / Task 2 — runtime `rasterCache` / `rasterCacheBudgetMB`
   *  flip handler (wired via `RuntimeOptionTarget.resetRasterCache`).
   *  Disposes BOTH tiers (every byte credited back, stores permanently
   *  inert) and, when the option is now active, rebuilds them under a
   *  fresh shared budget. `repaintFull()` so the flip lands on the next
   *  frame either way. */
  private resetRasterCache(): void {
    this.rasterCells?.dispose();
    this.rasterStrips?.dispose();
    this.rasterCells = null;
    this.rasterStrips = null;
    this.rasterBudget = null;
    this.rasterCellsDpr = 0;
    // Cycle 22 / Task 3 — Tier-2 bookkeeping restarts with the stores.
    this.rowVersionByRowId.clear();
    this.stripsCtxMemo = null;
    this.stripLayoutEpoch++;
    if (this.options.rasterCache !== false) {
      this.buildRasterCaches();
    }
    this.repaintFull();
  }

  /** Task 3 (paint-cache layer, spec §1 "Layer layout") — the synthetic
   *  second `computeViewport` call that lays out rows for the retained
   *  offscreen layer, independent of the on-screen viewport. Mirrors the
   *  real recompute's argument construction (`ViewportManager.
   *  computeCurrentViewport`) — same columnLayout / subgrids / scrollLeft /
   *  dataRowHeightIndex / column-virtualisation suppression — but re-
   *  anchored to the layer's own coverage: `scrollTop: layerTop`,
   *  `containerHeight: bodyTop + layerHeight` (so the returned
   *  `bodyHeight` is exactly `layerHeight`), `overscanRows: 0` (the
   *  layer's own extent IS its buffer — no additional row padding), and
   *  `suppressRowVirtualisation: false` (unlike whatever the live grid
   *  option says — the layer always virtualises to its own bounded
   *  coverage, never "every row").
   *
   *  Memoized on (the live `this.viewport` object reference, `layerTop`,
   *  `layerHeight`) — `recomputeViewport()` always assigns a NEW
   *  `ViewportState` object, so reference equality alone detects "the real
   *  viewport changed since the last build" without a separate generation
   *  counter. Returns the same object back-to-back for the same geometry
   *  against the same real-viewport snapshot. */
  buildLayerViewport(geometry: LayerGeometry): ViewportState {
    const vs = this.viewport;
    const cached = this.layerViewportCache;
    const layoutPaintEpoch = this.layoutPaintEpoch;
    if (
      cached
      && cached.vs === vs
      && cached.layerTop === geometry.layerTop
      && cached.layerHeight === geometry.layerHeight
      && cached.layoutPaintEpoch === layoutPaintEpoch
    ) {
      return cached.result;
    }
    const containerWidth =
      this.canvasBounds.width || this.scroller.clientWidth || this.root.clientWidth || 800;
    const result = computeViewport({
      columnLayout: this.columnLayout,
      subgrids: this.subgrids,
      containerWidth,
      containerHeight: vs.bodyTop + geometry.layerHeight,
      scrollLeft: vs.scrollLeft,
      scrollTop: geometry.layerTop,
      overscanRows: 0,
      suppressColumnVirtualisation:
        this.options.suppressColumnVirtualisation || this.options.domLayout === 'print',
      suppressRowVirtualisation: false,
      dataRowHeightIndex: this.rowHeightIndex ?? undefined,
    });
    this.layerViewportCache = {
      vs,
      layerTop: geometry.layerTop,
      layerHeight: geometry.layerHeight,
      layoutPaintEpoch,
      result,
    };
    return result;
  }

  /** Closeout directive B / M-2 — row-align a CONTENT-space band (a
   *  shift's newly-exposed edge, or a chunk carved off during the
   *  budgeted drain) to the FULL bounds of whichever row(s) its edges
   *  land inside, using the same widened live-viewport row list
   *  `rowBand`/`rowBoundsAtY` already resolve against
   *  (`this.viewport.visibleRows` — Task 3's overscan-widened set, which
   *  by the fetch-window-coupling design already spans the retained
   *  layer's own coverage). Snapping OUTWARD only (never inward) keeps
   *  every layer raster row-atomic, avoiding the T6 mid-glyph clip-AA
   *  class this same widening already fixed for the damage ledger's own
   *  bleed expansion (`DamageLedger.expand`'s row-atomic-bleed comment).
   *  A boundary that resolves to no row (an edge case right at the very
   *  top/bottom of data, or outside the widened viewport's own range) is
   *  left unsnapped — fails open, the same conservatism `rowBoundsAtY`
   *  itself already uses. */
  private snapContentBandToRows(top: number, bottom: number): { top: number; bottom: number } {
    if (bottom <= top) return { top, bottom };
    const vs = this.viewport;
    const t = { scrollTop: vs.scrollTop, bodyTop: vs.bodyTop };
    const topScreen = dataRectToScreen({ x: 0, y: top, w: 0, h: 0 }, t).y;
    const bottomScreen = dataRectToScreen({ x: 0, y: bottom, w: 0, h: 0 }, t).y;
    const topRow = vs.visibleRows.find((r) => topScreen >= r.top && topScreen < r.bottom);
    // `bottom` is an EXCLUSIVE band edge — look up the row containing the
    // last INCLUDED px (a hair below `bottomScreen`) so an edge already
    // exactly on a row seam doesn't spuriously pull in the row below.
    const lastIncludedScreen = bottomScreen - 0.01;
    const bottomRow = vs.visibleRows.find((r) => lastIncludedScreen >= r.top && lastIncludedScreen < r.bottom);
    const snappedTopScreen = topRow ? Math.min(topScreen, topRow.top) : topScreen;
    const snappedBottomScreen = bottomRow ? Math.max(bottomScreen, bottomRow.bottom) : bottomScreen;
    return {
      top: screenYToContentY(snappedTopScreen, t),
      bottom: screenYToContentY(snappedBottomScreen, t),
    };
  }

  /** Closeout directive B.2 — the present-safety sync-fill invariant.
   *  Runs unconditionally right before `presentLayer`, on every cache-on
   *  frame: intersects the about-to-be-presented range
   *  (`[scrollTop, scrollTop+bodyHeight]`, widened by one row-height
   *  margin each side per the directive) against the layer's pending-band
   *  ledger, and rasters SYNCHRONOUSLY whatever overlaps THIS frame,
   *  before the present blit runs. This is the hard guarantee ("unrastered
   *  content is thus never presentable BY CONSTRUCTION") — it does not
   *  depend on the budgeted drain (`drainLayerPendingBands`) having caught
   *  up; a scroll that outruns the drain's own budget just pays for a
   *  bigger synchronous fill here instead of ever presenting stale/blank
   *  pixels. Counted via `PaintStats.layerSyncFills` — the "scroll outran
   *  the budget" signal. */
  private syncFillLayerPending(
    layer: PaintCacheLayer, layerCtx: CachedContext2D, vsNow: ViewportState, layerVs: ViewportState,
  ): void {
    if (!layer.hasPendingBands()) return;
    const rowFallback = this.options.rowHeight ?? this.theme.rowHeight;
    const queryTop = vsNow.scrollTop - rowFallback;
    const queryBottom = vsNow.scrollTop + vsNow.bodyHeight + rowFallback;
    let pieces: Array<{ top: number; bottom: number }>;
    try {
      pieces = layer.takePendingIntersecting(queryTop, queryBottom);
    } catch {
      // Conservative fallback (directive B.2) — any ambiguity drains the
      // FULL pending set rather than risk presenting unrastered content.
      pieces = layer.takeAllPending();
    }
    if (pieces.length === 0) return;
    this.paintStats.layerSyncFills++;
    const geom = layer.geometry();
    const rects = pieces
      .map((p) => this.snapContentBandToRows(p.top, p.bottom))
      .filter((p) => p.bottom > p.top)
      .map((p) => ({ x: 0, y: p.top, w: this.canvasBounds.width, h: p.bottom - p.top }));
    if (rects.length === 0) return;
    const localRects = rects.map((r) => dataRectToScreen(r, { scrollTop: geom.layerTop, bodyTop: vsNow.bodyTop }));
    layerCtx.cache.save();
    layerCtx.translate(0, -vsNow.bodyTop);
    this.renderer.paintLayer(layerCtx, layerVs, false, localRects);
    layerCtx.cache.restore();
  }

  /** Closeout directive B.3 — the budgeted drain. Runs AFTER present +
   *  chrome (so it never delays what's actually on-screen this frame),
   *  spending a small (~3ms) time budget rastering pending bands
   *  nearest-viewport-first, in row-aligned chunks of at least 4 rows
   *  (`PaintCacheLayer.takePendingNearest`). Requests another frame
   *  (`cgridCanvas.requestRepaint()`) while any backlog remains so the
   *  grid keeps draining at idle — REQUIRED so `waitSettled`/pixel-
   *  invariance still observe a fully-converged grid (a "settled" grid
   *  must have zero pending; see the paint-cache closeout review,
   *  adjudication B, point 3). */
  private drainLayerPendingBands(
    layer: PaintCacheLayer, layerCtx: CachedContext2D, vsNow: ViewportState, layerVs: ViewportState,
  ): void {
    const BUDGET_MS = 3;
    const rowFallback = this.options.rowHeight ?? this.theme.rowHeight;
    const minChunkPx = Math.max(4 * rowFallback, 1);
    const anchor = vsNow.scrollTop + vsNow.bodyHeight / 2;
    const geom = layer.geometry();
    const t0 = performance.now();
    while (layer.hasPendingBands() && (performance.now() - t0) < BUDGET_MS) {
      const chunk = layer.takePendingNearest(anchor, minChunkPx);
      if (!chunk) break;
      const snapped = this.snapContentBandToRows(chunk.top, chunk.bottom);
      const h = snapped.bottom - snapped.top;
      if (h <= 0) continue;
      const rect = { x: 0, y: snapped.top, w: this.canvasBounds.width, h };
      const localRect = dataRectToScreen(rect, { scrollTop: geom.layerTop, bodyTop: vsNow.bodyTop });
      layerCtx.cache.save();
      layerCtx.translate(0, -vsNow.bodyTop);
      this.renderer.paintLayer(layerCtx, layerVs, false, [localRect]);
      layerCtx.cache.restore();
    }
    if (layer.hasPendingBands()) {
      this.cgridCanvas.requestRepaint();
    }
  }

  /** Cycle 19 / Task 4 — delegating wrapper. The viewport-tick anchor +
   *  band-clip close lives in `EditController.syncOpenEditorPosition`. */
  private syncOpenEditorPosition(): void {
    this.editController.syncOpenEditorPosition();
  }

  /** Cycle 19 / Task 2 — delegating wrappers. The clamp + scroller drive +
   *  belt-and-suspenders happy-dom fallback live in `ViewportManager`. */
  private setScroll(x: number, y: number): void {
    this.viewportManager.setScroll(x, y);
  }
  /** Cycle 19 / Task 2 — back-compat shim for tests + downstream code that
   *  reach in via `(grid as any).onScrollerScroll(x, y)` to simulate a scroll
   *  event. The real handler is registered inside `ViewportManager`. */
  private onScrollerScroll(x: number, y: number): void {
    this.viewportManager.onScrollerScroll(x, y);
  }
  /** Cycle 19 / Task 2 — back-compat getters so E2E + integration tests that
   *  read `(grid as any).scrollTop` / `.scrollLeft` keep working. The real
   *  scroll state lives on `ViewportManager`. */
  private get scrollLeft(): number { return this.viewportManager.scrollLeft; }
  private get scrollTop(): number { return this.viewportManager.scrollTop; }
  private ensureRowIndexVisible(
    rowIndex: number,
    position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto',
  ): void {
    this.viewportManager.ensureRowIndexVisible(rowIndex, position);
  }
  private ensureColIdVisible(
    colId: string,
    position: 'auto' | 'start' | 'middle' | 'end' = 'auto',
  ): void {
    this.viewportManager.ensureColIdVisible(colId, position);
  }

  /** Set only while a model-reorder `rebuildIndices` is running (see
   *  `rebuildIndicesWithoutAutoScroll`), so the selection `onChange` handler
   *  skips its `ensureRowIndexVisible` / `ensureColIdVisible` auto-scroll for
   *  a focus-index shift the user didn't cause. */
  private suppressFocusEnsure = false;

  /** Apply `rebuildIndices` without letting the resulting focus-index change
   *  auto-scroll the viewport. `SelectionModel.emit()` runs listeners
   *  synchronously, so the flag reliably brackets the `onChange` emit. */
  private rebuildIndicesWithoutAutoScroll(rowIdToIndex: ReadonlyMap<string, number>): void {
    this.suppressFocusEnsure = true;
    try {
      this.selection.rebuildIndices(rowIdToIndex);
    } finally {
      this.suppressFocusEnsure = false;
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
      this.rebuildIndicesWithoutAutoScroll(new Map());
      return;
    }
    this.workerCoord.getRowIndicesForIds(allIds).then((indices) => {
      if (this.destroyed) return;
      const map = new Map<string, number>();
      for (let i = 0; i < allIds.length; i++) map.set(allIds[i]!, indices[i]!);
      this.rebuildIndicesWithoutAutoScroll(map);
    }).catch((err) => { if (!this.destroyed) console.error('[velocity-grid] rebuildSelectionFromPersistentIds:', err); });
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

  /** Cycle 19 / Task 2 — viewport-fetch entry point. Delegates to
   *  `ViewportManager.request`; the manager handles coalescing + the
   *  velocity-driven prefetch math and invokes `handleViewportChunk` (the
   *  chunk-processing tail below) via the `dispatchViewportRequest` dep.
   *  Cycle 19 / Task 3 will absorb both halves into `WorkerCoordinator`. */
  private requestViewport(aggSource: AggregationChangedSource | null = null): void {
    this.viewportManager.request(aggSource);
  }

  /** Cycle 19 / Task 3 — chunk-arrival side-effects. Invoked from the
   *  WorkerCoordinator's `onViewportChunk` dep after every successful
   *  `getViewport` round-trip ViewportManager triggered. The worker call +
   *  request coalescing live in the coordinator; this method owns the
   *  main-side fan-out:
   *    LRU caching, pivot column sync, per-cell + per-group flash,
   *    row-height index refresh, recompute + repaint, a11y update,
   *    `aggregationChanged` (gated on `consumePendingAggSource`),
   *    `firstDataRendered` latch.
   *  Returns a Promise the coordinator awaits before resolving
   *  `dispatchViewportRequest`, so ViewportManager's coalescing flag
   *  releases after the mutation lands. */
  private async handleViewportChunk(
    opts: { rowStart: number; rowEnd: number; columns: string[]; seq?: number },
    chunk: ViewportChunk,
    stickyAncestors: StickyAncestor[],
  ): Promise<void> {
    const { rowStart, rowEnd, columns: cols } = opts;
    // Latest-wins (Deephaven subscription.setViewport): drop superseded
    // replies, and also drop replies that miss the live fetch window
    // entirely (coalesced in-flight can still resolve for an old range).
    if (
      opts.seq !== undefined
      && opts.seq < this.viewportManager.viewportReqSeq
    ) {
      return;
    }
    const liveVs = this.viewportManager.state;
    if (
      liveVs.lastRow >= 0
      && !chunkIntersectsRowRange(chunk, liveVs.firstRow, liveVs.lastRow)
    ) {
      return;
    }
    // Capture the previous chunk's totals + full row identity BEFORE
    // overwriting `this.chunk` — the aggregate diff (C3) and the
    // positional-identity window diff (C2 / adjudication B) both compare
    // against the OLD chunk.
    const prevChunk = this.chunk;
    const prevGroupTotals = prevChunk?.groupTotals;
    const prevChunkTotals = prevChunk?.totals;
    this.chunk = chunk;
    this.stickyAncestors = stickyAncestors;
    this.decodedTextCols.clear();
    // Cycle 25 / Task 10 — park the chunk in the LRU. WeakRef retention means
    // GC can reclaim if real memory pressure builds; the LRU's own eviction
    // kicks in when our running sum exceeds `memoryBudgetMB`. Cache lookup on
    // subsequent requests is intentionally NOT wired here — keying on model
    // versions (sort/filter/group/pivot) needs more surface than this cycle
    // delivers. Foundation only.
    if (this.chunkLRU) {
      const key = `${rowStart}:${rowEnd}:${cols.join(',')}`;
      this.chunkLRU.set(key, chunk, estimateChunkBytes(chunk));
    }
    // Cycle 18 / Task 3 — (re)synthesize or drop the pivot result columns
    // from the freshly-arrived pivot tree before the layout + paint below
    // run off the new column order.
    this.pivotEngine.maybeSyncPivotColumns(chunk);
    // Cycle 18 / Task 8a — surface the cap breach as a public event. The
    // chunk already arrived with no pivot output when this is set (PivotPass
    // bypassed early); the grid paints primary columns normally. Apps can
    // listen + raise the cap / narrow the filter. Emit ONCE per chunk that
    // carries the field — no debounce needed since the worker only sets the
    // field when the breach actually happened (not on every chunk).
    if (chunk.pivotMaxColumnsReached !== undefined) {
      this.events.emit({
        type: 'pivotMaxColumnsReached',
        generatedColumns: chunk.pivotMaxColumnsReached.generatedColumns,
        cap: chunk.pivotMaxColumnsReached.cap,
      });
    }
    // Cycle 4 / Task 11 (cell-flash patch) — drain the worker's per-cell
    // flashMask into the registry. The chunk's `rowIds` are numeric (the
    // worker's stable mapping); the painter's cellData callback reads
    // `registry.getAlpha(numericRowId, colId, now)` to produce flashAlpha
    // per visible cell.
    // Cycle 22 / closeout I-3 — patch-on-tick's PRODUCTION seam. The
    // worker's flashMask IS the tick's cell-granular diff (row-major bits
    // over rowIds × cols): collect the changed cells here so the
    // diff-armed branch below can patch retained strips ONCE per tick
    // (after `repaintRows` has bumped the touched rows, so the patch lands
    // at the row's FINAL post-tick version and the strip HITS at fade
    // settle). Before this seam existed, the only caller of the patch path
    // was the flash-fade rAF loop — whose first attempt died on the
    // cellIcon-existence bail (see `patchStripCells`) and whose per-rAF
    // churn was closeout I-4 — so `stripPatches` was 0 in production.
    let tickDamagedCells: Array<{ rowId: number; colId: string }> | null = null;
    if (chunk.flashMask && this.rasterStrips !== null) {
      const mask = chunk.flashMask;
      const rowCount = chunk.rowIds.length;
      const colCount = cols.length;
      for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < colCount; c++) {
          const bitIdx = r * colCount + c;
          if (((mask[bitIdx >>> 3] ?? 0) & (1 << (bitIdx & 7))) === 0) continue;
          (tickDamagedCells ??= []).push({ rowId: chunk.rowIds[r]!, colId: cols[c]! });
        }
      }
    }
    if (chunk.flashMask) {
      // Cycle 21e / Task 13 — join per-call flashCells overrides by the
      // chunk's string rowIds. Zero-cost when the override map is empty
      // (the common case): no lookup closure is even passed.
      //
      // Style-rule flash ownership — when an enabled style rule has
      // `flash.enabled` for a column (or whole row), default worker
      // cell-change flash is suppressed for that cell. Rule / API flash
      // still paints: `flashCells` stages an override marker that
      // `shouldFlash` admits.
      const hasOverrides = this.flashOverrides.size > 0;
      const owned = ruleFlashOwnership(getRuleEngine()?.getRules?.());
      const suppressDefault = owned.allColumns || owned.colIds.size > 0;
      const needSid = hasOverrides || suppressDefault;
      this.flashRegistry.ingestMask({
        rowIds: chunk.rowIds,
        colIds: cols,
        mask: chunk.flashMask,
        stringRowIds: needSid ? chunk.stringRowIds : undefined,
        getOverride: hasOverrides
          ? (sid, colId) =>
              this.flashOverrides.get(`${sid}\0${colId}`)
                ?? this.flashOverrides.get(`${sid}\0*`)
          : undefined,
        shouldFlash: suppressDefault
          ? (sid, colId) => {
              if (!isRuleFlashOwned(owned, colId)) return true;
              return this.flashOverrides.has(`${sid}\0${colId}`)
                || this.flashOverrides.has(`${sid}\0*`);
            }
          : undefined,
      });
      this.startFlashTickLoop();
    }
    // Flash aggregate cells whose groupTotals or grand totals changed vs the
    // previous chunk. Data-row flashes come from the worker's flashMask
    // (keyed by rowId); group/footer rows carry no rowId so we diff the
    // totals records here on the main thread. groupTotals covers per-group
    // group rows AND per-group footer rows. chunk.totals covers the grand-
    // total footer (groupKey='').
    // C3 fix — this diff used to run ONLY inside `enableCellChangeFlash`,
    // which meant it was the ONLY thing that routed changed totals into
    // damage — a flash-disabled grid (the DEFAULT) never repainted a
    // changed aggregate on the partial path at all. `diffAggregates` now
    // runs unconditionally; `enableCellChangeFlash` only gates whether the
    // change ALSO drives the visual flash-fade effect.
    const { changedGroupKeys, grandTotalChanged } =
      diffAggregates(chunk, prevGroupTotals, prevChunkTotals);
    const aggregatesChanged = changedGroupKeys.size > 0 || grandTotalChanged;
    // Damage-region rendering (Task 3, extended Task 6) — did THIS chunk
    // add any group/footer flash entries? Those cells live on group/footer
    // rows, which carry no rowId and so never appear in `touchedRows` —
    // the partial branch below calls `repaintGroupFlash()` (flash-enabled
    // path) or `repaintAggregateDamage()` (C3's flash-disabled path)
    // instead of degrading to full.
    let groupFlashChanged = false;
    if (this.options.enableCellChangeFlash) {
      const now = performance.now();
      for (const groupKey of changedGroupKeys) {
        const oldRec = prevGroupTotals?.[groupKey];
        const newRec = chunk.groupTotals![groupKey]!;
        for (const colId of Object.keys(newRec)) {
          if (oldRec?.[colId] !== newRec[colId]) {
            this.groupFlashMap.set(`${groupKey}\0${colId}`, now);
            groupFlashChanged = true;
          }
        }
      }
      // Grand-total footer (groupKey='') sources from chunk.totals, not
      // groupTotals. Diff it separately; store under the '' key so
      // groupFlashAlpha('', colId) resolves for rowKind=3 + empty key.
      if (grandTotalChanged && chunk.totals) {
        for (const colId of Object.keys(chunk.totals)) {
          if (prevChunkTotals?.[colId] !== chunk.totals[colId]) {
            this.groupFlashMap.set(`\0${colId}`, now);
            groupFlashChanged = true;
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
    // visibleRows array carries heights from BEFORE the chunk arrived and
    // variable-height rows paint at the fallback until the next scroll
    // triggers another recompute.
    this.recomputeViewport();
    // Thumb-drag hybrid defer can stick across a full-damage streak. Once
    // a covering chunk lands, drop deferral and force a clean layer
    // re-anchor so the next scrolls return to present/shift instead of
    // lean full-paints.
    if (
      this.paintCacheActive()
      && this.paintCacheDeferLayer
      && chunkCoversOnScreenRows(chunk, this.viewport)
    ) {
      this.paintCacheDeferLayer = false;
      this.paintCacheLayerAnchored = false;
    }
    // C2 + adjudication B — `resolveWindowDamage` replaces the old bare
    // `sameWindow` (rowStart+rowCount) check, which trusted `touchedRows`
    // at face value whenever the window looked unchanged. That's unsafe
    // under an active sort: a tick can permute the visible order while
    // rowStart/rowCount stay put, displacing rows that `touchedRows` (named
    // at their NEW positions) never flags — their old content just sits
    // there stale. The position-diff below compares row IDENTITY
    // (rowId+rowKind+groupKey) at every overlapping position (shifted by
    // the window-move delta), so a reorder, a filter-driven window move,
    // AND an ordinary scroll-driven window move all resolve through the
    // same mechanism — closing both C2 (reorder-under-sort) and the
    // scroll-driven full-repaint gap in one guard. Column-set changes
    // (group expand / showColumns) also force 'full' here — otherwise a
    // live-feed empty `touchedRows` leaves newly revealed cells blank.
    // See `resolveWindowDamage` doc for the exact bail conditions (every
    // one degrades to full, never to under-painting).
    const windowDamage = resolveWindowDamage(chunk, prevChunk);
    if (windowDamage === 'full') {
      // Cycle 22 / Task 3 — unknown-diff chunk: no touchedRows (untracked
      // data apply — setRowData, filter/sort/group model change — OR a
      // plain window move with nothing staged), a height change, or a
      // diff past the cap. Any of these can reorder rows (zebra parity is
      // baked into a strip's pixels) or change content invisibly, so
      // EVERY retained strip is untrusted — wipe the store and the
      // version map together (fresh captures restart at version 0). A
      // stale strip is a bug; re-capturing is a cheap drawImage per row.
      if (this.rasterStrips !== null) {
        this.stripLayoutEpochBump();
        this.rowVersionByRowId.clear();
      }
      this.repaintFull();
    } else {
      if (windowDamage.length > 0) {
        this.repaintRows(windowDamage.map((r) => chunk.rowStart + r));
      }
      // Cycle 22 / closeout I-3 — patch-on-tick, at the tick itself.
      // AFTER `repaintRows` (which bumped every touched row) so the patch
      // advances each patched row to its final post-tick version: the
      // strip holds the SETTLED pixels (flash suppressed) through the
      // fade and HITS the moment the row is eligible again, instead of
      // forcing a full-row live re-raster that cell-sized fade rects can
      // never recapture. Runs under `suppressPartialRepaint` too — same
      // keep-tracking contract as the version bumps in `repaintRows`.
      if (tickDamagedCells !== null) {
        this.applyStripCellDamage(tickDamagedCells);
      }
      if (groupFlashChanged) {
        this.repaintGroupFlash();
      } else if (aggregatesChanged) {
        // C3 — flash disabled (or suppressed), but a total still changed:
        // damage the changed aggregate cells directly instead of relying
        // on `groupFlashMap`, which stays empty when flash is off.
        this.repaintAggregateDamage(changedGroupKeys, grandTotalChanged);
      }
    }
    this.updateA11y();
    // Cycle 14 / Task 6 — emit `aggregationChanged` ONLY when the mutation
    // that drove this fetch actually changed the totals (data / filter /
    // aggFuncs / column aggFunc / explicit API). Cosmetic re-fetches
    // (scroll, sort, theme, column move / visible / pin / resize) call
    // `requestViewport()` with no source so the manager's pending source
    // stays null and we skip the event — listeners that want every paint
    // subscribe to `viewportChanged` instead. Consume only when totals
    // exist so a chunk that lacks totals doesn't clear a pending source
    // queued for the next totals-bearing chunk.
    if (chunk.totals) {
      const source = this.viewportManager.consumePendingAggSource();
      if (source !== null) {
        this.events.emit({
          type: 'aggregationChanged',
          totals: chunk.totals,
          source,
        });
      }
    }
    // firstDataRendered: latch once per grid instance, the first time a
    // non-empty chunk has landed and a repaint has been scheduled. Empty
    // chunks (e.g. setRowData([]) or filter-out-everything) don't count.
    if (!this.firstDataFired && chunk.rowCount > 0) {
      this.firstDataFired = true;
      this.events.emit({ type: 'firstDataRendered' });
    }
  }

  /** Build the cumulative-height index from scratch when `rowCount` changed,
   *  then merge the chunk's per-row heights into it. The 0 sentinel in
   *  `chunk.heights` means "no per-row override" — we leave those at the
   *  fallback so rows without explicit heights stay at the grid-level
   *  `rowHeight`. Cycle 5 / Task 7. */
  private refreshRowHeightIndex(chunk: ViewportChunk): void {
    const fallback = clampRowHeight(this.options.rowHeight ?? this.theme.rowHeight);
    if (!this.rowHeightIndex || this.rowHeightIndex.length() !== this.rowCount) {
      this.rowHeightIndex = new RowHeightIndex(this.rowCount, () => fallback);
    }
    const idx = this.rowHeightIndex;
    for (let i = 0; i < chunk.heights.length; i++) {
      const globalIdx = chunk.rowStart + i;
      if (globalIdx >= idx.length()) break;
      const raw = chunk.heights[i]!;
      const resolved = clampRowHeight(raw > 0 ? raw : fallback);
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
    const fallback = clampRowHeight(this.options.rowHeight ?? this.theme.rowHeight);
    if (!this.chunk) return fallback;
    const i = localRowIndex - this.chunk.rowStart;
    if (i < 0 || i >= this.chunk.heights.length) {
      // Under active pivot mode, rows outside the chunk are always leaves
      // (the slicer only ships group rows + footer entries into the chunk).
      // Returning 0 collapses the data subgrid's extent to just the visible
      // group rows — which is what makes the bottom-pinned Grand Total row
      // visible without forcing the user to scroll past hundreds of empty
      // leaf rows.
      //
      // Exception: when NO chunk has arrived yet (heights.length === 0) the
      // grid hasn't seen its visible window. Returning 0 here would
      // collapse the data subgrid to zero rows, the viewport would request
      // `[0, 0)`, the worker would ship an empty chunk, and the loop would
      // never break. Use the fallback so the initial request for the
      // visible window has a non-zero range.
      if (this.pivotEngine.isPivotActive() && this.chunk.heights.length > 0) return 0;
      return fallback;
    }
    const h = this.chunk.heights[i]!;
    return clampRowHeight(h > 0 ? h : fallback);
  }

  /** Cycle 4 / Task 11 (cell-flash patch) — rAF handle for the
   *  self-sustaining flash tick. Held so a chunk that arrives while
   *  the loop is already running doesn't double-schedule. */
  private flashTickHandle: number | null = null;
  /**
   * Live-tick deferral during body scroll (Deephaven-aligned): while the
   * user is scrolling, async transactions queue here (last-write-wins per
   * row id) and the flash fade rAF is suspended so scroll owns the frame
   * budget. Flushed on `bodyScrollEnd`.
   */
  private bodyScrollActive = false;
  private deferredAsyncTxs: Tx<TRow>[] = [];
  /** SSRM soft refresh queued while the user is scrolling. */
  private deferredSsrmRefresh: RefreshServerSideParams | null = null;
  /** SSRM transactions queued while the user is scrolling. */
  private deferredSsrmTxs: ServerSideTransaction<TRow>[] = [];
  /**
   * Trailing debounce for soft-refresh after live updates touch an active
   * sort column. Sparse SSRM patches values in place and keeps `ssrmOrder`
   * fixed — without this, sorted blotters go stale until the next purge.
   * `ssrmResortFirstAt` enforces a maxWait so continuous sort-key ticks
   * (which would otherwise reset a pure trailing debounce forever) still
   * flush a refresh.
   */
  private ssrmResortTimer: ReturnType<typeof setTimeout> | null = null;
  private ssrmResortFirstAt: number | null = null;
  private flashPausedForScroll = false;

  /** Start (or keep alive) the per-rAF flash tick. Each tick calls
   *  `registry.tick(now)` which prunes expired entries + requests a
   *  repaint when any remain. The loop self-cancels when the
   *  registry empties. Idempotent — already-running ticks aren't
   *  re-scheduled. */
  private startFlashTickLoop(): void {
    if (this.flashTickHandle !== null) return;
    if (typeof requestAnimationFrame !== 'function') return;
    // Don't compete with scroll paints — resume from bodyScrollEnd.
    if (this.bodyScrollActive) {
      this.flashPausedForScroll = true;
      return;
    }
    const tick = (now: number): void => {
      this.flashTickHandle = null;
      if (this.destroyed) return;
      if (this.bodyScrollActive) {
        this.flashPausedForScroll = true;
        return;
      }
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
        // Damage-region rendering (Task 3, extended Task 6) — group/footer
        // rows carry no rowId, so `repaintCells` (rowId-keyed) can't
        // address them; `repaintGroupFlash()` resolves their current
        // geometry (data-space group/footer rows, and/or the flat
        // grand-total row's separate `TotalsSubgrid` band) instead of the
        // previous unconditional full-repaint fallback.
        if (this.groupFlashMap.size > 0) this.repaintGroupFlash();
      }
      // Cycle 21e / Task 13 — expire staged flash overrides.
      if (this.flashOverrides.size > 0) {
        for (const [k, v] of this.flashOverrides) {
          if (v.expiresAt <= now) this.flashOverrides.delete(k);
        }
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
   *  worker-side.
   *
   *  M5 (closeout review, known + documented cost) — this call forces a
   *  `getViewport` refresh with no STAGED transaction behind it, so
   *  `pendingTouched` is untouched and the resulting chunk's
   *  `touchedRows` comes back `undefined` (nothing was checked — the
   *  worker never even looked, since there's nothing in `pendingTouched`
   *  to check against). `resolveWindowDamage`'s "unknown stays full" rule
   *  then degrades the paint to full. Conservative and correct — just
   *  don't be surprised that a `flashCells()` call full-paints once. */
  flashCells(params: FlashCellsParams): void {
    if (this.destroyed) return;
    if (this.options.enableCellChangeFlash !== true) return;
    if (this.reducedMotion) return;
    if (!params.rowIds || params.rowIds.length === 0) return;
    const colIds = params.colIds ?? [];
    // Cycle 21e / Task 13 — stage per-call overrides for the mask-ingest
    // join. Always stage a marker (even with no color/mode) so rule-flash
    // ownership can admit `flashCells` bits while suppressing default
    // value-change flash on the same columns.
    {
      const now = performance.now();
      // Lazy sweep so abandoned overrides can't accumulate.
      for (const [k, v] of this.flashOverrides) {
        if (v.expiresAt <= now) this.flashOverrides.delete(k);
      }
      const flashDur = params.flashDuration ?? this.options.cellFlashDuration ?? 500;
      const fadeDur = params.fadeDuration ?? this.options.cellFadeDuration ?? 1000;
      const override = {
        color: params.color,
        mode: params.mode,
        flashDuration: params.flashDuration,
        fadeDuration: params.fadeDuration,
        // Grace for the worker round-trip + next chunk arrival.
        expiresAt: now + flashDur + fadeDur + 2000,
      };
      const colKeys = colIds.length > 0 ? colIds : ['*'];
      for (const rowId of params.rowIds) {
        for (const c of colKeys) {
          this.flashOverrides.set(`${rowId}\0${c}`, override);
        }
      }
    }
    this.workerCoord.flashCells(params.rowIds, colIds)
      .then(() => {
        if (this.destroyed) return;
        // Force a viewport refresh so the worker drains pendingFlashes
        // into the next chunk's flashMask without waiting for a scroll
        // or other natural trigger.
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] flashCells:', err); });
  }

  /** Damage-region rendering — snapshot of cumulative paint telemetry. See
   *  `PaintStats` for field semantics. Returns a shallow copy so callers
   *  can't mutate the live counters. */
  getPaintStats(): PaintStats {
    return { ...this.paintStats };
  }

  /** Damage-region rendering — zero the running `PaintStats` counters. */
  resetPaintStats(): void {
    this.paintStats = {
      paints: 0, fullPaints: 0, partialPaints: 0, blits: 0,
      presents: 0, layerShifts: 0, layerResets: 0, layerRasterMs: 0,
      lastRects: 0, lastAreaPct: 100, avgPaintMs: 0, worstPaintMs: 0,
      layerSyncFills: 0, layerBacklogPx: 0,
      cellCacheHits: 0, cellCacheMisses: 0, cellCacheBypasses: 0,
      stripHits: 0, stripMisses: 0, stripMissesUncoverable: 0, stripCaptures: 0, stripPatches: 0,
      rasterCacheBytes: 0, rasterCachePooledBytes: 0,
    };
  }

  /**
   * Cycle 25 / Task 7 — build (or reuse) the per-paint flash alpha mask
   * for the current chunk × visible columns. No-op when flash is off or
   * there is no chunk.
   */
  private rebuildFlashAlphaMaskForPaint(): void {
    if (!this.chunk || !this.options.enableCellChangeFlash) {
      this.flashAlphaMask = null;
      return;
    }
    const colIds = this.viewport.visibleColumns.map((c) => c.colId);
    if (colIds.length === 0) {
      this.flashAlphaMask = null;
      return;
    }
    // Rebuild the colId → index map only when the visible set changes.
    let colsChanged = colIds.length !== this.flashAlphaMaskColIds.length;
    if (!colsChanged) {
      for (let i = 0; i < colIds.length; i++) {
        if (colIds[i] !== this.flashAlphaMaskColIds[i]) {
          colsChanged = true;
          break;
        }
      }
    }
    if (colsChanged) {
      this.flashAlphaMaskColIds = colIds;
      this.flashAlphaMaskColIndex = new Map(colIds.map((id, i) => [id, i]));
    }
    this.flashAlphaMask = buildFlashAlphaMask({
      registry: this.flashRegistry,
      rowIds: this.chunk.rowIds,
      colIds,
      now: performance.now(),
      out: this.flashAlphaMaskOut,
    });
    this.flashAlphaMaskOut = this.flashAlphaMask;
  }

  private cellAt(rowIndex: number, colId: string): { value: unknown; valueFormatted: string; flashAlpha?: number; flashColor?: string } | null {
    if (!this.chunk) return null;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    // Cycle 4 / Task 11 + Cycle 25 / Task 7 — prefer the paint-frame
    // flash alpha mask (one Map walk per paint) over per-cell
    // `registry.getAlpha`. Fall back when the mask is cold or the
    // colId is outside the visible set used to build it.
    const numericRowId = this.chunk.rowIds[localIndex]!;
    let flashAlpha = 0;
    const mask = this.flashAlphaMask;
    const colIdx = mask ? this.flashAlphaMaskColIndex.get(colId) : undefined;
    if (mask && colIdx !== undefined) {
      flashAlpha = mask[localIndex * this.flashAlphaMaskColIds.length + colIdx] ?? 0;
    } else {
      flashAlpha = this.flashRegistry.getAlpha(numericRowId, colId, performance.now());
    }
    const flash = flashAlpha > 0 ? flashAlpha : undefined;
    // Cycle 21e / Task 13 — per-call color override rides alongside the
    // alpha; undefined keeps the theme flashFromColor blend.
    const flashColor = flash !== undefined
      ? this.flashRegistry.getColor(numericRowId, colId)
      : undefined;
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
      if (payload === null) return { value: '', valueFormatted: '', flashAlpha: flash, flashColor };
      return { value: payload, valueFormatted: payload.valueFormatted, flashAlpha: flash, flashColor };
    }
    // Cycle 18 / Task 3 — pivot result columns read their cross-tab
    // aggregate from `chunk.pivotValues`, addressed by the row's group key
    // × the column's (pivotPath, valueColId). Only aggregated rows carry a
    // value: group rows (1), grand-total (2), and footer rows (3) resolve
    // through their composite `groupKey` (the grand total uses key `''`);
    // leaf data rows (0) are not aggregated under pivot → empty.
    if (this.pivotEngine.isPivotActive() && (isPivotResultColumnId(colId) || isPivotRowTotalColumnId(colId))) {
      const spec = this.pivotEngine.getCellSpec(colId);
      const pivotValues = this.chunk.pivotValues;
      const kind = this.chunk.rowKinds[localIndex] ?? 0;
      if (!spec || !pivotValues || kind === 0) {
        return { value: '', valueFormatted: '', flashAlpha: flash, flashColor };
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
        return { value: '', valueFormatted: '', flashAlpha: flash, flashColor };
      }
      const valueFormatted = typeof raw === 'number' ? this.formatNumber(colId, raw) : String(raw);
      const gFlash = this.groupFlashAlpha(groupKey, colId);
      return { value: raw, valueFormatted, flashAlpha: gFlash ?? flash, flashColor };
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
      if (entry === null) return { value: '', valueFormatted: '', flashAlpha: flash, flashColor };
      const gFlash = this.groupFlashAlpha(groupKey, colId);
      return { value: entry.value, valueFormatted: entry.valueFormatted, flashAlpha: gFlash ?? flash, flashColor };
    }
    // Group rows (rowKind === 1) show per-group aggregate values from
    // `chunk.groupTotals` when available — same source as the per-group
    // footer row (rowKind === 3). CSRM uses AggPass; sparse SSRM hosts
    // materialise the same map in the worker from hydrated row fields.
    if ((this.chunk.rowKinds[localIndex] ?? 0) === 1) {
      const groupKey = this.chunk.groupKey?.[localIndex] ?? '';
      if (groupKey !== '') {
        const entry = this.totalsCellLookup(colId, groupKey);
        if (entry !== null) {
          const gFlash = this.groupFlashAlpha(groupKey, colId);
          return { value: entry.value, valueFormatted: entry.valueFormatted, flashAlpha: gFlash ?? flash, flashColor };
        }
      }
      return { value: '', valueFormatted: '', flashAlpha: flash, flashColor };
    }
    const numeric = this.chunk.numericCols[colId];
    if (numeric) {
      const value = numeric[localIndex]!;
      return { value, valueFormatted: this.formatNumber(colId, value), flashAlpha: flash, flashColor };
    }
    const text = this.chunk.textCols[colId];
    if (text) {
      let decoded = this.decodedTextCols.get(colId);
      if (!decoded) { decoded = decodeText(text.offsets, text.bytes); this.decodedTextCols.set(colId, decoded); }
      const value = decoded[localIndex] ?? '';
      // Symmetric with the numeric branch above: a text column's
      // valueFormatter (incl. format-DSL strings compiled by
      // compileFormatSlots) must reach the painted text too — this branch
      // used to return the raw decoded string verbatim, silently ignoring
      // any formatter on text columns.
      return { value, valueFormatted: this.formatText(colId, value), flashAlpha: flash, flashColor };
    }
    // Cycle 26 (W3) — column absent from the chunk: a horizontally-entering
    // column whose (now-buffered) fetch hasn't landed yet, or a fast fling
    // that outran the buffer. For a plain data row the FULL row already
    // lives in the main-thread `rowDataById` mirror — serve the value from
    // there, through the same memoized formatters, so entering columns
    // paint real content immediately instead of a blank that fills in a
    // throttle period + worker round-trip later. Gated to field-backed
    // columns without a `valueGetter` (worker-computed values — calc /
    // pivot-result / getter columns — keep today's blank-until-chunk; a
    // wrong value is worse than a briefly missing one).
    if ((this.chunk.rowKinds[localIndex] ?? 0) === 0) {
      const sid = this.chunk.stringRowIds?.[localIndex];
      if (sid) {
        const def = this.columnDefsMap.get(colId);
        const field = def?.field;
        if (field !== undefined && def?.valueGetter === undefined) {
          const row = this.rowDataById.get(sid) as Record<string, unknown> | undefined;
          const raw = row?.[field];
          if (raw !== undefined && raw !== null) {
            if (typeof raw === 'number') {
              return { value: raw, valueFormatted: this.formatNumber(colId, raw), flashAlpha: flash, flashColor };
            }
            const s = String(raw);
            return { value: s, valueFormatted: this.formatText(colId, s), flashAlpha: flash, flashColor };
          }
        }
      }
    }
    return { value: '', valueFormatted: '', flashAlpha: flash, flashColor };
  }

  /** Kernel bugfix follow-up (post-21f) — this used to be a permanent stub
   *  (`` `row-${rowIndex}` ``) that every pointer/keyboard event builder
   *  (cellClicked, cellDoubleClicked, cellKeyDown/Press, cellMouseOver/Out,
   *  rowMouseOver/Out) fed into its payload. The paint pipeline, meanwhile,
   *  already had the REAL string rowId via `stringRowIdAt` (chunk's
   *  `stringRowIds` mirror) — @wellsfargo-starui/velocity-grid-renderers keys its hit regions on that
   *  real id. Result: hit regions registered under 'r1' while clicks
   *  resolved 'row-0', so action callbacks (onAction/onOpen) could never
   *  correlate a click back to its row.
   *
   *  Fix: delegate to the real mapping first, falling back to the
   *  synthetic `row-${rowIndex}` only when no real id is available (group /
   *  footer rows, where `stringRowIdAt` returns `''`, or a row outside the
   *  currently-loaded chunk window, where it returns `null` — e.g.
   *  `getSelectedRowIds()`/`getFocusedCell()` can be asked about indices
   *  that scrolled out of the loaded window). This preserves the public
   *  signature/contract (always returns a non-null string for any in-range
   *  index) while making on-screen interactions agree with what the paint
   *  path — and therefore renderer hit-testing — actually used. */
  private rowIdAt(rowIndex: number): string | null {
    const real = this.stringRowIdAt(rowIndex);
    return real ? real : `row-${rowIndex}`;
  }

  /** Cycle 21e / Task 11 — real string rowId for a visible data row, from
   *  the chunk's `stringRowIds` mirror. Returns null for rows outside the
   *  chunk window and '' for non-data rows (group / footer). Also the
   *  source `rowIdAt` (above) now delegates to, for pointer/keyboard event
   *  payloads. */
  private stringRowIdAt(rowIndex: number): string | null {
    if (!this.chunk) return null;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    return this.chunk.stringRowIds?.[localIndex] ?? null;
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

  /** Cycle 26 (W2) — per-column formatted-value memo.
   *
   *  `formatNumber`/`formatText` run for EVERY data cell on EVERY paint —
   *  including Tier-1 raster-cache hits, because `cellStyleSignature`
   *  embeds `valueFormatted` in the bitmap key. Both formatters call
   *  `valueFormatter({ value, colId, data: undefined })` — `data` is
   *  explicitly undefined (the documented cross-field limitation) — so
   *  the output is a pure function of (formatter identity, value).
   *  Financial grids repeat values heavily (prices, sizes, enums, dates)
   *  and repaint the same values across flash fades / hover / selection /
   *  scroll frames, so a value-keyed memo turns the per-cell formatter
   *  call + string allocation into a Map hit.
   *
   *  Invalidation: the entry is dropped when the column's CURRENT
   *  `valueFormatter` identity differs from the one the entry was built
   *  under — `setColumnDefs` / `editColumn` / format-toolbar recompiles
   *  swap the function reference, so staleness self-heals per lookup with
   *  no epoch plumbing. Assumes formatters are pure (the same assumption
   *  the raster cache already bakes into bitmap reuse; DSL-compiled
   *  formatters are pure by construction). Capped per column; overflow
   *  clears the column's map (values re-memoize immediately — cheaper
   *  and simpler than LRU bookkeeping at this size). */
  private formatMemoByCol = new Map<string, { formatter: unknown; cache: Map<unknown, string> }>();
  private static readonly FORMAT_MEMO_CAP = 4096;

  private formatMemoEntry(colId: string, formatter: unknown): { formatter: unknown; cache: Map<unknown, string> } {
    let entry = this.formatMemoByCol.get(colId);
    if (entry === undefined || entry.formatter !== formatter) {
      entry = { formatter, cache: new Map() };
      this.formatMemoByCol.set(colId, entry);
    }
    return entry;
  }

  private formatNumber(colId: string, value: number): string {
    if (!Number.isFinite(value)) return '';
    const def = this.columnDefsMap.get(colId);
    const entry = this.formatMemoEntry(colId, def?.valueFormatter);
    const hit = entry.cache.get(value);
    if (hit !== undefined) return hit;
    const formatted = def?.valueFormatter
      ? def.valueFormatter({ value, colId, data: undefined as unknown as TRow })
      : value.toString();
    if (entry.cache.size >= VelocityGrid.FORMAT_MEMO_CAP) entry.cache.clear();
    entry.cache.set(value, formatted);
    return formatted;
  }

  /** Text-column twin of `formatNumber` — runs the column's valueFormatter
   *  (function-form or compiled-from-DSL-string) over the decoded chunk
   *  text; identity when the column has none. Same `data: undefined`
   *  limitation as the numeric path: `[value]`-based programs resolve,
   *  cross-field references don't. Memoized — see `formatMemoByCol`. */
  private formatText(colId: string, value: string): string {
    const def = this.columnDefsMap.get(colId);
    if (!def?.valueFormatter) return value;
    const entry = this.formatMemoEntry(colId, def.valueFormatter);
    const hit = entry.cache.get(value);
    if (hit !== undefined) return hit;
    let formatted: string;
    try {
      formatted = String(def.valueFormatter({ value, colId, data: undefined as unknown as TRow }));
    } catch { formatted = value; }
    if (entry.cache.size >= VelocityGrid.FORMAT_MEMO_CAP) entry.cache.clear();
    entry.cache.set(value, formatted);
    return formatted;
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
    // Prefer def.width (updated every pointer event) over columnLayout.width
    // (only refreshed on the coalesced rAF flush) so multiple dx in one
    // frame accumulate instead of each overwriting from the stale layout.
    const base = def.width ?? cur.width;
    const newW = Math.max(def.minWidth, base + dx);
    def.width = newW;
    // Enter drag paint mode once: wipe the retained layer and keep paints
    // on the legacy path for the whole gesture (see columnResizeDragActive).
    if (!this.columnResizeDragActive) {
      this.columnResizeDragActive = true;
      this.paintCacheDeferLayer = true;
      this.paintCacheLayerAnchored = false;
      this.layerViewportCache = null;
      const layer = this.paintCacheLayer;
      if (layer?.available) layer.reset(layer.geometry().layerTop);
    }
    // Coalesce layout + repaint to one rAF. Pointer events outrun paints;
    // applying resolveColumnWidths + invalidate + full per mousemove is
    // what makes resize feel slow and leaves staircase frames when the
    // layer path briefly wins.
    this.columnResizeFlushColId = colId;
    if (this.columnResizeFlushRaf === 0) {
      this.columnResizeFlushRaf = requestAnimationFrame(() => {
        this.columnResizeFlushRaf = 0;
        this.flushColumnResizePaint();
      });
    }
  }

  /** Apply the coalesced resize layout and request one full legacy paint. */
  private flushColumnResizePaint(): void {
    if (this.destroyed) return;
    const colId = this.columnResizeFlushColId;
    this.columnLayout = resolveColumnWidths(this.columnOrder, this.root.clientWidth);
    this.recomputeViewport();
    this.paintCacheDeferLayer = true;
    this.repaintFull();
    // Per-frame emission during a drag: finished:false so apps can defer
    // persistence to the mouseup `finished:true` event. Cycle 6 / Task 5.
    if (colId) {
      const def = this.columnDefsMap.get(colId);
      if (def?.width != null) {
        this.events.emit({
          type: 'columnResized', colId, width: def.width,
          finished: false, source: 'uiColumnResized',
        });
      }
    }
  }

  /** Emit the trailing `columnResized` with `finished: true` for the last
   *  column touched in a resize-drag. Called by `ColumnResizing` on mouseup
   *  so apps that persist on `finished: true` fire one save per drag.
   *  Cycle 6 / Task 5. */
  private finishColumnResize(colId: string): void {
    // Flush any pending coalesced layout so mouseup width matches the drag.
    if (this.columnResizeFlushRaf !== 0) {
      cancelAnimationFrame(this.columnResizeFlushRaf);
      this.columnResizeFlushRaf = 0;
      this.flushColumnResizePaint();
    }
    this.columnResizeDragActive = false;
    this.columnResizeFlushColId = null;
    // Rebuild retained paint cleanly now that geometry is stable.
    this.invalidateRetainedPaintForColumnLayout();
    this.repaintFull();
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
    this.workerCoord.updateColumns(this.workerColumns())
      .then(({ visibleCount }) => {
        this.rowCount = visibleCount;
        this.recomputeViewport();
        this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
        this.events.emit({ type: 'displayedColumnsChanged', source: 'columnMoved' });
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] reorderColumn:', err); });
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

  /** Cycle 19 / Task 5-ColState — column-state snapshot delegate. See
   *  `ColumnStateManager.getColumnState` for the pivot-primary /
   *  runtime-role invariants. */
  getColumnState(): CColumnState[] {
    return this.colStateManager.getColumnState();
  }

  /** Cycle 21i Phase 2 / T2 — register a named, versioned engine-state
   *  slice that folds into `GridState.modules` and rides the
   *  persistState autosave. `get()` returning `undefined` omits the
   *  slice; `set(data, version)` restores it (throwing skips that
   *  slice only). Returns an unregister function. After a mutation
   *  that has no mapped grid event, call
   *  `notifyModuleStateChanged(id)` so the autosave runs. */
  registerStateModule(module: StateModule): () => void {
    return this.moduleStateRegistry.register(module);
  }

  /** Cycle 21i Phase 2 / T2 — signal that a registered module's state
   *  changed. Emits the typed `moduleStateChanged` event, which the
   *  stateUpdated bus maps to the `modules` snapshot key (debounced
   *  autosave follows when `persistState` is on). */
  notifyModuleStateChanged(moduleId: string): void {
    this.moduleStateRegistry.notifyChanged(moduleId);
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
      getModuleState: () => this.moduleStateRegistry.snapshot(),
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
      getScrollPosition: () => this.viewportManager.getScrollPosition(),
      getRuntimeOptions: () => Object.fromEntries(this.runtimeTouchedOptions),
      getThemeParams: () => this.getThemeParams(),
      getToolPanelPopoutRect: () => this.popoutRect,
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
  setState(snapshot: GridState, opts?: { exhaustive?: boolean }): void {
    const migrated = migrateSnapshot(snapshot);
    // Grid Layouts (A6) — `exhaustive` makes a restore a full REPLACE: every
    // view field the snapshot omits is reset to empty rather than left as-is.
    // A partial `setState` (the default, public API) restores only what it
    // carries; switching layouts needs the target's empties to actually
    // clear the outgoing layout's filter / sort / pivot / side-bar / etc.
    // (spec §1: a layout is a self-contained view). Grid-tier module slices
    // are still left untouched — see the modules note below.
    const exhaustive = opts?.exhaustive === true;
    // Cycle 23 / Task 7 — tag the cascade so the next coalesced
    // stateUpdated event reads source: 'api'. The cascade of internal
    // events (filterChanged + sortChanged + ...) collapses into one
    // emission via the bus's rAF debounce.
    this.stateUpdatedBus?.setNextSource('api');

    // 0. runtime options (Cycle 21i / Phase 1) — FIRST so option-driven
    // layout (row heights, panels, defaultColDef) settles before column
    // state applies on top. Each key applies independently; one bad
    // value degrades to a warning, not a dropped restore.
    if (migrated.gridOptions) {
      for (const [key, value] of Object.entries(migrated.gridOptions)) {
        try {
          this.setGridOption(key as keyof VelocityGridOptions<TRow>, value as never);
        } catch (err) {
          console.warn(`[velocity-grid] setState: skipped gridOptions['${key}']`, err);
        }
      }
    }

    // 0b. theme token overrides (Cycle 21i / Phase 1) — data colours.
    if (migrated.themeParams) {
      this.setThemeParams(migrated.themeParams);
    } else if (exhaustive && Object.keys(this.getThemeParams()).length > 0) {
      themeParamsClear(this.root);
      this.theme = this.cssReader.read();
      // Cycle 22 / Task 2 — theme-token clear is a raster-cache epoch.
      this.rasterCacheEpochBump();
      this.recomputeViewport();
      this.cgridCanvas.requestRepaint();
      this.stateUpdatedBus?.markChanged('themeParams');
    }

    // 0d. Floating-panel rect (non-persist-of-open) — only the last
    // position/size is restored; the float itself is NEVER auto-reopened
    // on `setState`/load.
    if (migrated.toolPanelPopoutRect) {
      this.popoutRect = migrated.toolPanelPopoutRect;
      this.stateUpdatedBus?.markChanged('toolPanelPopoutRect');
    } else if (exhaustive && this.popoutRect !== undefined) {
      this.popoutRect = undefined;
      this.stateUpdatedBus?.markChanged('toolPanelPopoutRect');
    }

    // 0c. module slices (Cycle 21i Phase 2 / T2) — engine-owned state
    // envelopes, including the kernel's own `columnGroups` slice (the
    // Task 6/8 overlay relocated behind the registry; legacy top-level
    // `columnGroupDefs`/`columnGroupOpen` fields arrive here via the
    // v3→v4 migrator). Positioned BEFORE columnState so structural
    // slices (group hierarchy) settle before per-leaf width/hide/pinned
    // apply on top. The columnGroups slice reuses the exact
    // `updateGridOptions({ columnDefs })` path the panel's Apply uses —
    // that path re-fires `columnDefsChanged`, which re-marks the
    // `modules` key dirty; harmless (the bus coalesces per rAF frame and
    // this restore's own emit is tagged with the 'api'/'init' source set
    // above, matching how the sibling restores below re-dirty their own
    // keys). Restore degrades gracefully per-slice: unknown module ids
    // and throwing `set()`s warn + skip without dropping the rest.
    // Exhaustive (layout switch / persisted restore): CLEAR the layout-tier
    // module slices the incoming snapshot omits, so a layout without calc
    // columns / template assignments doesn't leak the outgoing layout's
    // slices (Grid Layouts / Phase B / B5). Grid-tier ids (editSettings,
    // templates — shared) are preserved. Modules that can't clear from
    // `undefined` (columnGroups) no-op, unchanged. Cleared BEFORE the restore
    // so present slices below re-apply on a clean base.
    if (exhaustive) {
      const present = new Set(Object.keys(migrated.modules ?? {}));
      const preserve = new Set(this.options.layoutGridLevelModules ?? DEFAULT_GRID_LEVEL_MODULES);
      this.moduleStateRegistry.clearAbsent(present, preserve);
    }
    if (migrated.modules) {
      this.moduleStateRegistry.restore(migrated.modules);
    }

    // 1. columnState (defines columns + their geometry).
    if (migrated.columnState) {
      this.applyColumnState({ state: migrated.columnState, applyOrder: true });
    }

    // 2. filterModel — filters rows.
    if (migrated.filterModel) {
      this.setFilterModel(migrated.filterModel);
    } else if (exhaustive) {
      this.setFilterModel({});
    }

    // 3. sortModel — orders rows.
    if (migrated.sortModel) {
      this.setSortModel(migrated.sortModel);
    } else if (exhaustive) {
      this.setSortModel([]);
    }

    // 4→6. Stash expanded routes BEFORE mutating the group model so a
    // fast `setGroupModel` reply can still consume them. Exhaustive +
    // omitted field means "all collapsed".
    if (migrated.expandedRouteIds) {
      this.pendingExpandedRouteIds = [...migrated.expandedRouteIds];
    } else if (exhaustive) {
      this.pendingExpandedRouteIds = [];
    } else {
      this.pendingExpandedRouteIds = null;
    }

    // 4. row-group columns.
    if (migrated.rowGroupColumns) {
      this.setRowGroupColumns(migrated.rowGroupColumns);
    } else if (exhaustive) {
      this.setRowGroupColumns([]);
    }

    // 5. pivot mode + cols.
    if (migrated.pivotMode !== undefined) {
      this.setPivotMode(migrated.pivotMode);
    } else if (exhaustive && this.isPivotMode()) {
      this.setPivotMode(false);
    }
    if (migrated.pivotCols) {
      this.setPivotColumns(migrated.pivotCols);
    } else if (exhaustive) {
      this.setPivotColumns([]);
    }

    // 6. expanded routes (group / tree) — best-effort immediate apply when
    // grouping is already live (layout switch on a warm grid). Otherwise
    // the `setGroupModel` reply path calls `flushPendingExpandedRoutes`.
    this.flushPendingExpandedRoutes();

    // 7. cell + row selection.
    if (migrated.cellSelection) {
      this.clearCellRanges();
      for (const range of migrated.cellSelection.ranges) {
        this.addCellRange(range);
      }
    } else if (exhaustive) {
      this.clearCellRanges();
    }
    if (migrated.rowSelection) {
      this.setSelectedRowIds(migrated.rowSelection);
    } else if (exhaustive) {
      this.setSelectedRowIds([]);
    }

    // 8. side bar.
    if (migrated.sideBar) {
      this.setSideBarVisible(migrated.sideBar.visible);
      if (migrated.sideBar.openedToolPanel) {
        this.openToolPanel(migrated.sideBar.openedToolPanel);
      } else if (exhaustive) {
        this.closeToolPanel();
      }
    } else if (exhaustive) {
      this.closeToolPanel();
      this.setSideBarVisible(false);
    }

    // 9. scroll — last so viewport math runs after every model that
    // affects layout has settled.
    if (migrated.scroll) {
      this.scroller.scrollTo({ top: migrated.scroll.top, left: migrated.scroll.left });
    } else if (exhaustive) {
      this.scroller.scrollTo({ top: 0, left: 0 });
    }
  }

  /** The grid's complete configuration in one object: the full live options
   *  (columnDefs, defaultColDef, callbacks, and every runtime-updated option)
   *  with the current runtime + view state embedded as `initialState`. Pass
   *  it straight to `new VelocityGrid(host, grid.getConfig())` to reconstruct the
   *  grid exactly, or to `setConfig` to apply it to a live grid.
   *
   *  This is a SHALLOW copy — `columnDefs` / `defaultColDef` and any function
   *  options are shared by reference (so the result is not pure-JSON; use
   *  `getState()` for the serialisable view-state slice). Treat it as
   *  read-only or clone before mutating. */
  getConfig(): VelocityGridOptions<TRow> {
    return { ...this.options, initialState: this.getState() };
  }

  /** Apply a config object (as produced by `getConfig`) to this live grid.
   *  The embedded `initialState` restores via `setState`; the remaining
   *  options are applied via `updateGridOptions`. Initial-only keys
   *  (`gridId`, `getRowId`, `worker`, …) and any non-runtime keys can't
   *  change on a live grid, so they're skipped — construct a new grid from
   *  `getConfig()` when you need those to differ. */
  setConfig(config: VelocityGridOptions<TRow>): void {
    const initialState = config.initialState;
    const src = config as unknown as Record<string, unknown>;
    const applicable: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      if (k === 'initialState') continue;
      if (INITIAL_ONLY_OPTIONS.has(k as keyof VelocityGridOptions<any>)) continue;
      // Only columnDefs (handled specially by updateGridOptions) and known
      // runtime options can apply mid-session; everything else (callbacks,
      // construction-time flags) would be rejected by setGridOption.
      if (k === 'columnDefs' || isRuntimeOption(k)) {
        applicable[k] = src[k];
      }
    }
    this.updateGridOptions(applicable as Partial<VelocityGridOptions<TRow>>);
    if (initialState) this.setState(initialState);
  }

  // ── Grid Layouts (Phase A / A3) ─────────────────────────────────────
  //
  // Thin delegation to the LayoutManager (core/layoutManager.ts), which
  // owns the registry / active id / Default invariants / tier filtering.
  // VelocityGrid supplies the live-grid seam (capture = getState, apply =
  // reset-options-then-setState) and fans a `layoutChanged` event.

  /** Build the LayoutManager on first use, capturing the as-constructed
   *  view as the baseline. Called eagerly at the end of construction so the
   *  baseline is the post-`initialState` view, and lazily as a guard for a
   *  layout API call that races construction. */
  private getLayoutManager(): LayoutManager {
    if (!this.layoutManager) {
      // Options touched at construction (via `initialState` / the seeded
      // options) are the APP baseline — record their current value so a
      // layout switch resets to the app default, not the kernel default.
      // Their lazy pre-change capture in `setGridOption` was `undefined`
      // (they were set before any layout existed); overwrite with the live
      // value. Safe because this runs eagerly at construction end, before any
      // user interaction, so `runtimeTouchedOptions` holds only those.
      for (const [key, value] of this.runtimeTouchedOptions) {
        this.optionBaselines.set(key, structuredClone(value));
      }
      this.layoutManager = new LayoutManager(this.layoutHost, {
        baseline: this.getState(),
        layouts: this.options.layouts,
        activeLayoutId: this.options.activeLayoutId,
        layoutGridLevelModules: this.options.layoutGridLevelModules,
      });
    }
    return this.layoutManager;
  }

  /** Restore a layout snapshot: first reset every runtime option the target
   *  does NOT override back to its baseline (kernel `setState` layers
   *  options additively — spec §7), then `setState` the snapshot (which
   *  layers the target's option overrides + restores layout-tier modules;
   *  grid-tier module slices, absent from the snapshot, are left as-is). */
  private applyLayoutSnapshot(snapshot: GridState): void {
    // Migrate up front so an un-migratable (newer-than-build) snapshot throws
    // BEFORE any side effect — no half-reset options, no half-switched view.
    const migrated = migrateSnapshot(snapshot);
    // Strip grid-tier modules (incl. data-provider) so a polluted legacy
    // layout snapshot cannot overwrite the live shared selection / edits /
    // templates / alerts. Capture already omits these via
    // DEFAULT_GRID_LEVEL_MODULES; this hardens apply for older bundles.
    const preserve = new Set(this.options.layoutGridLevelModules ?? DEFAULT_GRID_LEVEL_MODULES);
    if (migrated.modules) {
      const mods = { ...migrated.modules };
      for (const id of preserve) delete mods[id];
      migrated.modules = Object.keys(mods).length > 0 ? mods : undefined;
    }
    const targetOptions = migrated.gridOptions ?? {};
    for (const key of [...this.runtimeTouchedOptions.keys()]) {
      if (key in targetOptions) continue;
      try {
        this.setGridOption(key as keyof VelocityGridOptions<TRow>, this.optionBaselines.get(key) as never);
      } catch (err) {
        console.warn(`[velocity-grid] layout apply: could not reset gridOptions['${key}']`, err);
      }
      // `setGridOption` re-records the touch; un-record so a value equal to
      // baseline is no longer treated as an override on the next capture.
      this.runtimeTouchedOptions.delete(key);
    }
    // Exhaustive: a layout switch must CLEAR view state the target omits.
    this.setState(migrated, { exhaustive: true });
  }

  private emitLayoutChanged(source: LayoutChangeSource): void {
    this.events.emit({
      type: 'layoutChanged',
      activeLayoutId: this.getLayoutManager().getActiveLayoutId(),
      source,
    });
  }

  /** All layouts (Default always present). */
  getLayouts(): GridLayout[] {
    return this.getLayoutManager().getLayouts();
  }
  getActiveLayoutId(): string {
    return this.getLayoutManager().getActiveLayoutId();
  }
  getActiveLayout(): GridLayout {
    return this.getLayoutManager().getActiveLayout();
  }
  /** Capture the current view as a new named layout (activates by default). */
  saveLayout(name: string, opts?: SaveLayoutOptions): GridLayout {
    const layout = this.getLayoutManager().saveLayout(name, opts);
    this.emitLayoutChanged('save');
    return layout;
  }
  /** Recapture the current view into an existing layout (default: active). */
  updateLayout(id?: string): GridLayout {
    const layout = this.getLayoutManager().updateLayout(id);
    this.emitLayoutChanged('update');
    return layout;
  }
  /** Activate a layout and restore its view. */
  loadLayout(id: string): GridLayout {
    const layout = this.getLayoutManager().loadLayout(id);
    this.emitLayoutChanged('load');
    return layout;
  }
  /** Delete a layout (Default undeletable; active-delete → Default). */
  deleteLayout(id: string): void {
    this.getLayoutManager().deleteLayout(id);
    this.emitLayoutChanged('delete');
  }
  /** Rename a layout's display name (unique). */
  renameLayout(id: string, name: string): GridLayout {
    const layout = this.getLayoutManager().renameLayout(id, name);
    this.emitLayoutChanged('rename');
    return layout;
  }
  /** Clone a layout under a new unique name (no activation by default). */
  duplicateLayout(id: string, name: string, opts?: SaveLayoutOptions): GridLayout {
    const layout = this.getLayoutManager().duplicateLayout(id, name, opts);
    this.emitLayoutChanged('duplicate');
    return layout;
  }
  /** Reset a layout (default: active) to the construction baseline. */
  resetLayout(id?: string): GridLayout {
    const layout = this.getLayoutManager().resetLayout(id);
    this.emitLayoutChanged('reset');
    return layout;
  }

  /** The grid-level baseline config (spec §8): the stored baseline
   *  (`gridOptions` + whatever was last set) overlaid with the LIVE
   *  `editSettings` / `templates` module slices (templates lights up in
   *  Phase B). */
  getGridConfig(): GridBaselineConfig {
    const out = this.getLayoutManager().getGridConfig();
    if (out.gridOptions && Object.keys(out.gridOptions).length === 0) delete out.gridOptions;
    // Clone the LIVE module envelopes so a consumer mutating the returned
    // config / exported bundle can't reach into engine-owned module state.
    const modules = this.moduleStateRegistry.snapshot();
    if (modules?.editSettings) out.editing = structuredClone(modules.editSettings);
    // Templates: when calc is wired the LIVE library is authoritative — an
    // EMPTY library must override any stale `LayoutManager.gridConfig.templates`
    // (which materializeTemplates populates but delete/rename never prune), so a
    // deleted template can't resurrect in an export/reload (M2). `getTemplates`
    // is defensively cloned and returns `[]` when empty. Only when calc is NOT
    // wired do we fall through to the manager's stored library.
    if (getCalcProvider()?.getTemplates) out.templates = this.getTemplates();
    return out;
  }

  /** Set the grid-level baseline (spec §7/§8): apply it to the live grid
   *  and store it in the LayoutManager so it rides the exported bundle. */
  setGridConfig(config: GridBaselineConfig): void {
    this.applyGridConfigLive(config);
    this.getLayoutManager().setGridConfig(config);
    this.emitLayoutChanged('setGridConfig');
  }

  /** Apply a grid-level config to the LIVE grid (no manager write / event):
   *  `gridOptions` become the new option baseline (applied + recorded so
   *  layout resets return to them, not treated as an override); `editing` /
   *  `templates` restore their module slices. Shared by `setGridConfig` and
   *  the import path. */
  private applyGridConfigLive(config: GridBaselineConfig): void {
    if (config.gridOptions) {
      for (const [key, value] of Object.entries(config.gridOptions)) {
        try {
          this.setGridOption(key as keyof VelocityGridOptions<TRow>, value as never);
          // Clone so a later mutation of a caller's object-valued option
          // (e.g. defaultColDef) can't corrupt the stored baseline.
          this.optionBaselines.set(key, structuredClone(value)); // new baseline
          this.runtimeTouchedOptions.delete(key);                 // baseline ≠ override
        } catch (err) {
          console.warn(`[velocity-grid] setGridConfig: skipped gridOptions['${key}']`, err);
        }
      }
    }
    if (config.editing) {
      this.moduleStateRegistry.restore({ editSettings: config.editing });
    }
    if (config.templates) {
      this.moduleStateRegistry.restore({ templates: { version: 1, data: config.templates } });
    }
  }

  // ── Import / export (A4 + B4) ───────────────────────────────────────

  /** Export a single layout, bundling the template defs its columns
   *  reference (Phase B / B4) — resolved against the LIVE grid-level library
   *  so the export is self-contained across grids. */
  exportLayout(id: string): GridLayout {
    return this.getLayoutManager().exportLayout(id, this.getGridConfig().templates ?? []);
  }
  /** Export the full bundle: layouts + active id + the live grid config
   *  (whose `templates` carries the whole shared library). */
  exportLayouts(): GridLayoutsBundle {
    const bundle = this.getLayoutManager().exportLayouts();
    bundle.grid = this.getGridConfig(); // overlay live editing/templates modules
    return bundle;
  }
  /** Import a single layout (collision → new id unless `overwrite`),
   *  optionally activating (and applying) it. Bundled template defs are
   *  re-materialized into the LIVE library (add-if-absent) so an activated
   *  layout's template assignments resolve (Phase B / B4). */
  importLayout(layout: GridLayout, opts?: { overwrite?: boolean; activate?: boolean }): GridLayout {
    const mgr = this.getLayoutManager();
    const imported = mgr.importLayout(layout, opts); // folds defs into the bundle library
    this.materializeTemplatesLive(layout.templates); // …and into the live engine
    if (opts?.activate) mgr.loadLayout(imported.id); // apply to the live grid
    this.emitLayoutChanged('import');
    return imported;
  }
  /** Import a bundle (`'merge'` default / `'replace'`), then resync the live
   *  grid to the (possibly new) grid config + active layout view.
   *  `{ apply: false }` on replace reseeds only (emits `restore`) — used when
   *  a following `setState` is the authoritative view restore. */
  importLayouts(
    bundle: GridLayoutsBundle,
    opts?: { mode?: 'replace' | 'merge'; overwrite?: boolean; apply?: boolean },
  ): void {
    const mgr = this.getLayoutManager();
    mgr.importLayouts(bundle, opts);
    // Only `'replace'` swaps the active layout + config → resync the live grid.
    // `'merge'` folds layouts in WITHOUT disturbing the current (possibly
    // unsaved) on-screen view; the merged config is stored for later resets.
    if ((opts?.mode ?? 'merge') === 'replace') {
      // Grid config first (sets the option baseline) so the active view's
      // reset-to-baseline in loadLayout lands on the imported baseline. The
      // replaced config's `templates` restores the whole library to the engine.
      this.applyGridConfigLive(mgr.getGridConfig());
      if (opts?.apply === false) {
        // Registry + baseline only — caller will setState the saved view.
        // Emit `restore` (not `import`) so Ext layout-save auto-persist does
        // not write getState() before grid-tier modules (data-provider) restore.
        this.emitLayoutChanged('restore');
        return;
      }
      mgr.loadLayout(mgr.getActiveLayoutId());
    } else {
      // Merge: fold the bundle library into the LIVE engine (add-if-absent) so
      // a later loadLayout of a merged layout resolves its assignments —
      // without a full library replace that would disturb live own-templates.
      // Covers BOTH the bundle-level library AND per-layout bundled defs (a
      // bundle assembled from `exportLayout()` objects carries defs on each
      // layout, not in `grid.templates`) — M4.
      this.materializeTemplatesLive(bundle.grid?.templates);
      for (const l of bundle.layouts ?? []) this.materializeTemplatesLive(l.templates);
    }
    this.emitLayoutChanged('import');
  }

  /** Fold template defs into the LIVE engine library (add-if-absent) — the
   *  runtime half of the manager's `materializeTemplates`. Skips ids already
   *  present (never clobbers a live/customized def); no-op without calc. */
  private materializeTemplatesLive(templates: ColumnTemplate[] | undefined): void {
    if (!templates || templates.length === 0) return;
    const have = new Set(this.getTemplates().map((t) => t.id));
    for (const t of templates) {
      if (!have.has(t.id)) this.saveTemplate(t);
    }
  }

  // ── Styling templates (Phase B / B3) ────────────────────────────────
  // The shared styling-template library, routed to the calc provider
  // (registered by @wellsfargo-starui/velocity-grid-calc's wireIntoKernel). No provider (calc not
  // wired) → `getTemplates` returns `[]` and the mutators no-op without an
  // event. The engine is Date-free, so save/rename stamp `Date.now()` here.
  // Mutations that change a column's resolved def (save/apply/remove) trigger
  // the kernel colDef rebuild via the provider's onColumnsChanged wiring;
  // every op fires `templatesChanged` for switchers/editors to re-sync.

  private emitTemplatesChanged(source: TemplateChangeSource, templateId?: string): void {
    this.events.emit({ type: 'templatesChanged', source, templateId });
  }

  /** The shared styling-template library (defensive clones; `[]` when no
   *  calc engine is wired). */
  getTemplates(): ColumnTemplate[] {
    return (getCalcProvider()?.getTemplates?.() ?? []) as unknown as ColumnTemplate[];
  }
  /** Create-or-replace a template by id (kernel stamps timestamps). */
  saveTemplate(spec: TemplateSaveInput): void {
    const provider = getCalcProvider();
    if (!provider?.saveTemplate) return;
    provider.saveTemplate({
      id: spec.id, name: spec.name, description: spec.description,
      overrides: spec.overrides as Record<string, unknown>, now: Date.now(),
    });
    this.emitTemplatesChanged('save', spec.id);
  }
  /** Rename a template's display name (grid-wide unique; throws on collision). */
  renameTemplate(templateId: string, name: string): void {
    const provider = getCalcProvider();
    if (!provider?.renameTemplate) return;
    provider.renameTemplate(templateId, name, Date.now()); // throws propagate (no event)
    this.emitTemplatesChanged('rename', templateId);
  }
  /** Delete a template from the library (assignments become dangling refs). */
  deleteTemplate(templateId: string): void {
    const provider = getCalcProvider();
    if (!provider?.deleteTemplate) return;
    provider.deleteTemplate(templateId);
    this.emitTemplatesChanged('delete', templateId);
  }
  /** Assign a template to a single column (appends to its chain). */
  applyTemplate(colId: string, templateId: string): void {
    const provider = getCalcProvider();
    if (!provider?.applyTemplate) return;
    provider.applyTemplate(colId, templateId);
    this.emitTemplatesChanged('apply', templateId);
  }
  /** Unassign a template from a single column (library entry kept). */
  removeTemplate(colId: string, templateId: string): void {
    const provider = getCalcProvider();
    if (!provider?.removeTemplate) return;
    provider.removeTemplate(colId, templateId);
    this.emitTemplatesChanged('remove', templateId);
  }
  /** Auto-template-on-edit (spec §3.1): patch a column's editable attributes
   *  into its OWN template (forking from any shared template). Fires
   *  `templatesChanged` (source `'save'` — it writes the column's own
   *  template). No-op without a calc engine. */
  editColumn(colId: string, patch: import('@wellsfargo-starui/velocity-grid-calc').ColumnEditPatch): void {
    const provider = getCalcProvider();
    if (!provider?.editColumn) return;
    // Gate the event on the engine's result — a rejected edit (e.g. a
    // non-compiling format) changes nothing, so it must not fire
    // `templatesChanged` (M1).
    const ok = provider.editColumn(colId, patch as Record<string, unknown>, Date.now());
    if (ok) this.emitTemplatesChanged('save');
  }

  // ── Conditional styling rules (Phase C / C3) ────────────────────────────
  // The active layout's conditional-rule set, routed to the @wellsfargo-starui/velocity-grid-rules
  // RuleEngine via the rule-engine provider (registered by @wellsfargo-starui/velocity-grid-rules'
  // wireIntoKernel). No engine wired → `getRules` returns `[]` and the
  // mutators no-op without an event. The kernel owns the CRUD semantics as
  // pure array transforms over getRules()/setRules() (like LayoutManager owns
  // layout CRUD) — the engine stays the paint + validation owner. Every
  // mutation fires `rulesChanged` (→ persist bus `'modules'` → autosave, since
  // rules ride the layout-tier `rules` module) and repaints (rule style is
  // evaluated live in the paint fold, so a rule change needs a fresh frame).

  private emitRulesChanged(source: RuleChangeSource, ruleId?: string): void {
    this.events.emit({ type: 'rulesChanged', source, ruleId });
    // Cycle 22 / closeout C-2 — layoutEpoch contract: a rule mutation
    // changes matching cells' resolved fg/bg/indicator with NO data change,
    // column rebuild, or geometry change — rowVersionByRowId and the strip
    // keys all stand still, so retained strips would keep serving pre-rule
    // pixels at rest. All five VelocityGridApi rule mutators route through here.
    // (Tier 1 is safe without this: rule-resolved styles and ruleIndicator
    // are cellStyleSignature fields, so the key itself changes.)
    if (this.rasterStrips !== null) this.stripLayoutEpochBump();
    // Rule style changes every matching cell's pixels with no data /
    // geometry change — wipe retained layer + force full.
    this.invalidateRetainedPaintForColumnLayout();
    this.repaintFull();
  }

  /** The active layout's conditional-rule set (`[]` when no rules engine is
   *  wired). Order is the application order (stable tiebreak for equal
   *  priority; `reorderRules` rewrites it). */
  getRules(): ConditionalRuleShape[] {
    return getRuleEngine()?.getRules?.() ?? [];
  }
  /** Append a rule to the set. No-op (no event) when a rule with the same `id`
   *  already exists — ids must be unique (the engine keys match state + counts
   *  by id, so a duplicate would corrupt update/delete/enable); use
   *  `updateRule` to change an existing rule. */
  addRule(rule: ConditionalRuleShape): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    if (current.some((r) => r.id === rule.id)) return;
    engine.setRules([...current, rule]);
    this.emitRulesChanged('add', rule.id);
  }
  /** Shallow-merge a patch into the rule with `id` (its `id` is preserved). The
   *  patch may carry any rule field — `enabled` / `priority` / `condition` /
   *  `style` / … (the engine re-validates). No-op (no event) when the id is
   *  unknown. */
  updateRule(id: string, patch: Partial<ConditionalRuleShape> | Record<string, unknown>): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    if (!current.some((r) => r.id === id)) return;
    engine.setRules(current.map((r) => (r.id === id ? { ...r, ...patch, id } : r)));
    this.emitRulesChanged('update', id);
  }
  /** Remove the rule with `id`. No-op (no event) when the id is unknown. */
  deleteRule(id: string): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    const next = current.filter((r) => r.id !== id);
    if (next.length === current.length) return;
    engine.setRules(next);
    this.emitRulesChanged('delete', id);
  }
  /** Toggle a rule's `enabled` flag. No-op (no event) when the id is unknown or
   *  the rule is already in that state (avoids a needless recompile + autosave). */
  setRuleEnabled(id: string, enabled: boolean): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    const target = current.find((r) => r.id === id);
    if (!target || target.enabled === enabled) return;
    engine.setRules(current.map((r) => (r.id === id ? { ...r, enabled } : r)));
    this.emitRulesChanged('enable', id);
  }
  /** Reorder the rule set to match `orderedIds` (application order — the
   *  stable tiebreak for equal priority). Ids not present in `orderedIds`
   *  keep their relative order after the listed ones; unknown ids are
   *  ignored. No-op (no event) without a rules engine. */
  reorderRules(orderedIds: string[]): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    const byId = new Map(current.map((r) => [r.id, r]));
    const seen = new Set<string>();
    const next: ConditionalRuleShape[] = [];
    for (const id of orderedIds) {
      const r = byId.get(id);
      if (r && !seen.has(id)) { next.push(r); seen.add(id); }
    }
    for (const r of current) if (!seen.has(r.id)) next.push(r);
    // No-op if the order is unchanged (avoids a needless recompile + autosave).
    if (next.every((r, i) => r.id === current[i]?.id)) return;
    engine.setRules(next);
    this.emitRulesChanged('reorder');
  }

  /** Grid Layouts (A5) — restore a persisted blob (`{ ...viewState, layouts?
   *  }`). The reserved `layouts` bundle (when present) reseeds the manager
   *  — taking PRECEDENCE over `options.layouts` (spec §11) — and its grid
   *  config baseline is applied to the live grid; then the top-level view
   *  state restores the last-seen view on top. No `layouts` field → a plain
   *  view-state restore (older blobs, or grids that never used layouts). */
  private restorePersistedBlob(blob: GridState): void {
    this.stateUpdatedBus?.setNextSource('init');
    const { layouts, ...viewState } = blob as GridState & { layouts?: GridLayoutsBundle };
    if (layouts) {
      // Pure reseed (no view apply — the view is restored below).
      this.getLayoutManager().importLayouts(layouts, { mode: 'replace' });
      this.applyGridConfigLive(this.getLayoutManager().getGridConfig());
    }
    // Exhaustive so persisted state fully defines the view — any leftover
    // from `initialState` (applied earlier in construction) is cleared:
    // persisted state wins (spec §11).
    this.setState(viewState as GridState, { exhaustive: true });
    // Let app UI (layout switchers) re-sync to the restored set. Fired after
    // the view settles; listeners attached before construction's async
    // restore (the common case) receive it.
    if (layouts) this.emitLayoutChanged('restore');
  }

  /** Cycle 23 / Task 6 — restore the construction-time defaults.
   *  Walks the same setters `setState` uses but with empty / cleared
   *  values across the board; column state replays through the
   *  dedicated `resetColumnState` path so the as-coded layout
   *  (sort, pin, visibility) comes back exactly as the constructor
   *  saw it. */
  /** Cycle 21i / Phase 1 — delete the persisted snapshot for this grid's
   *  `gridId` (and cancel any pending autosave write). Does not change the
   *  live grid state; pair with `resetState()` + a reload for a full
   *  factory reset. No-op when persistence isn't enabled. */
  clearPersistedState(): void {
    this.statePersistence?.clear();
  }

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

  /** Cycle 19 / Task 5-ColState — column-state restore delegates. See
   *  `ColumnStateManager.applyColumnState` / `resetColumnState` for the
   *  single re-layout + repaint cycle + deterministic event fan-out. */
  applyColumnState(params: CApplyColumnStateParams): boolean {
    return this.colStateManager.applyColumnState(params);
  }
  resetColumnState(): void {
    this.colStateManager.resetColumnState();
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
    this.repaintFull();
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
    // Auto-group chrome context is computed ONCE across the batch (all
    // auto-group columns share display type + checkbox slot + count
    // suppression + theme indent). Individual per-column context clones
    // this and overlays the multipleColumns depth slot when needed.
    const groupChromeBase = this.computeGroupAutosizeChromeBase();
    const groupIndentUnit = this.theme.groupIndent ?? 14;
    const suppressCount = this.options.suppressCount === true
      || this.options.groupRowRendererParams?.suppressCount === true;
    const displayType = resolveGroupDisplayType(this.options.groupDisplayType);
    // Formatted-measurement split: the worker only sees RAW `row[field]`
    // values, but the painter draws `valueFormatter` output ("(2,230,893)"
    // vs "-2230893") in the document's fonts (which the worker's
    // OffscreenCanvas may not have loaded). Measuring raw text therefore
    // under-sizes formatter-lengthened columns — the "autosize clips my
    // cells" bug. Regular columns now measure MAIN-SIDE: the worker ships
    // the sample window's raw values back, main formats each through the
    // same path `cellAt` uses at paint time and measures with the real
    // document fonts. Auto-group columns keep the worker pass — their
    // formatted values + chrome geometry already live worker-side.
    const groupRequests: AutosizeColumnRequest[] = [];
    const mainDefs: Array<ResolvedColDef<TRow>> = [];
    for (const key of keys) {
      const def = this.columnDefsMap.get(key);
      if (!def) continue;
      if (def.hide) continue;
      if (def.suppressAutoSize) continue;
      if (isAutoGroupColumnId(def.colId)) {
        // Use the decorated header text (e.g. "sum(Notional)") so the
        // measured width matches exactly what the header painter draws.
        const headerName = decorateHeader(def, this.options.suppressAggFuncInHeader === true);
        // multipleColumns: indent lives in column ORDER, not in the
        // cell — the renderer paints indentX = 0 in that mode. Pass 0
        // so autosize agrees. singleColumn: `depth × groupIndent`.
        const indentUnit = displayType === 'multipleColumns' ? 0 : groupIndentUnit;
        const depthSlot = displayType === 'multipleColumns'
          ? (autoGroupColumnDepthFromId(def.colId) ?? undefined)
          : undefined;
        groupRequests.push({
          colId: def.colId,
          headerName,
          font: def.cellStyle?.font ?? this.theme.cellFont ?? this.theme.font,
          padding,
          headerPadding,
          minWidth: def.minWidth,
          maxWidth: Number.isFinite(def.maxWidth) ? def.maxWidth : Number.MAX_SAFE_INTEGER,
          groupContext: {
            chromeBase: groupChromeBase,
            indentUnit,
            suppressCount,
            countGap: GROUP_CELL_GEOMETRY.countGap,
            groupColumnDepth: depthSlot,
          },
        });
      } else {
        mainDefs.push(def);
      }
    }
    if (groupRequests.length === 0 && mainDefs.length === 0) return;
    const widths: Record<string, number> = {};
    try {
      const jobs: Array<Promise<void>> = [];
      if (groupRequests.length > 0) {
        jobs.push(
          this.workerCoord.autosizeColumns(groupRequests, skipHeader)
            .then((w) => { Object.assign(widths, w); }),
        );
      }
      if (mainDefs.length > 0) {
        const ctx = this.autosizeMeasureCtx();
        if (ctx) {
          jobs.push(
            this.measureColumnsMainSide(mainDefs, skipHeader, padding, headerPadding, ctx)
              .then((w) => { Object.assign(widths, w); }),
          );
        } else {
          // No 2D canvas available (non-DOM test envs) — fall back to
          // the legacy worker raw-text measurement.
          const legacy: AutosizeColumnRequest[] = mainDefs.map((def) => ({
            colId: def.colId,
            headerName: decorateHeader(def, this.options.suppressAggFuncInHeader === true),
            font: def.cellStyle?.font ?? this.theme.cellFont ?? this.theme.font,
            padding,
            headerPadding,
            minWidth: def.minWidth,
            maxWidth: Number.isFinite(def.maxWidth) ? def.maxWidth : Number.MAX_SAFE_INTEGER,
          }));
          jobs.push(
            this.workerCoord.autosizeColumns(legacy, skipHeader)
              .then((w) => { Object.assign(widths, w); }),
          );
        }
      }
      await Promise.all(jobs);
    } catch (err) {
      if (!this.destroyed) console.error('[velocity-grid] autoSizeColumns:', err);
      return;
    }
    if (this.destroyed) return;
    const changes: Array<{ colId: string; width: number }> = [];
    for (const [colId, measured] of Object.entries(widths)) {
      if (measured == null) continue;
      const def = this.columnDefsMap.get(colId);
      if (!def) continue;
      // Both measurement paths already clamp to min/max; re-clamp
      // defensively in case main-side bounds drifted while the
      // round-trip was in flight.
      const maxW = Number.isFinite(def.maxWidth) ? def.maxWidth : Number.MAX_SAFE_INTEGER;
      const clamped = Math.max(def.minWidth, Math.min(maxW, Math.ceil(measured)));
      if (def.width === clamped) continue;
      def.width = clamped;
      changes.push({ colId: def.colId, width: clamped });
    }
    if (changes.length === 0) return;
    this.columnLayout = resolveColumnWidths(
      this.columnOrder,
      this.canvasBounds.width || this.scroller.clientWidth || 800,
    );
    this.recomputeViewport();
    this.repaintFull();
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

  /** Per-cell chrome floor for an auto-group column, in CSS px. Sole
   *  source of truth: the constants published from
   *  `renderer/cellRenderers/group.ts` via `GROUP_CELL_GEOMETRY`. Adds
   *  the tri-state checkbox slot when a group-selects checkbox is
   *  actually painted in the auto-group column (mirrors the gating in
   *  `groupCellContextAt` — checkboxLocation routes to the auto-group
   *  column AND a group-selects mode is active). */
  private computeGroupAutosizeChromeBase(): number {
    const checkboxLoc = this.options.checkboxLocation ?? 'autoGroupColumn';
    const groupSelectsMode = this.selection.getGroupSelects();
    const showCheckboxInGroupCell =
      checkboxLoc !== 'none'
      && checkboxLoc !== 'selectionColumn'
      && (groupSelectsMode !== 'none' || this.selection.isGroupSelectsChildren());
    let base = GROUP_CELL_GEOMETRY.chromeBaseNoCheckbox;
    if (showCheckboxInGroupCell) base += GROUP_CELL_GEOMETRY.checkboxSlot;
    return base;
  }

  /** Shared main-thread 2D measuring context for the autosize pass.
   *  Reuses the auto-header-height context (font is re-set before every
   *  measurement anyway). Null in non-DOM environments — callers fall
   *  back to the worker's raw-text measurement. */
  private autosizeMeasureCtx(): CanvasRenderingContext2D | null {
    if (!this.headerMeasureCtx) {
      try {
        this.headerMeasureCtx = document.createElement('canvas').getContext('2d');
      } catch {
        this.headerMeasureCtx = null;
      }
    }
    return this.headerMeasureCtx;
  }

  /** Main-side autosize measurement for regular (non-auto-group) leaves.
   *
   *  Fetches the sample window's RAW cell values from the worker (head +
   *  tail of the visible set, same window `measureColumnWidths` walks),
   *  then reproduces the PAINT text/font per value:
   *    - number columns run `formatNumber` (the column's `valueFormatter`,
   *      exactly what `cellAt` feeds the renderer);
   *    - text columns paint the raw string verbatim (`cellAt` parity);
   *    - the font starts from the static cellStyle composed over the
   *      theme cell font, and per-value `cellStyleFn` font patches (e.g.
   *      a P&L column bolding losses) are honoured via `composeFont`.
   *  The header competes with the CHROME font (what the header painter
   *  uses) + `headerPadding`; results are `minWidth`/`maxWidth`-clamped.
   *  Fieldless columns (pivot results, calc columns) contribute no cell
   *  values and resolve to header-or-minWidth — same as before. */
  private async measureColumnsMainSide(
    defs: Array<ResolvedColDef<TRow>>,
    skipHeader: boolean,
    padding: number,
    headerPadding: number,
    ctx: CanvasRenderingContext2D,
  ): Promise<Record<string, number>> {
    const { values } = await this.workerCoord.autosizeSampleValues(defs.map((d) => d.colId));
    const cache = new Map<string, number>();
    let currentFont = '';
    const measure = (text: string, font: string): number => {
      const key = `${font}|${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      if (currentFont !== font) { ctx.font = font; currentFont = font; }
      const w = ctx.measureText(text).width;
      cache.set(key, w);
      return w;
    };
    const themeCellFont = this.theme.cellFont ?? this.theme.font;
    const out: Record<string, number> = {};
    for (const def of defs) {
      const baseFont = def.cellStyle ? composeFont(def.cellStyle, themeCellFont) : themeCellFont;
      const isNumber = def.cellDataType === 'number';
      let maxData = 0;
      for (const v of values[def.colId] ?? []) {
        // cellAt parity: numbers AND text run the column's valueFormatter so
        // measured width matches the painted (formatted) text.
        const text = isNumber && typeof v === 'number'
          ? this.formatNumber(def.colId, v)
          : this.formatText(def.colId, String(v));
        if (!text) continue;
        let font = baseFont;
        if (def.cellStyleFn) {
          // Per-value style function — the painter runs it per cell, so a
          // weight/size patch (bold losses) widens the painted text. Data
          // rides as undefined, mirroring `formatNumber`'s formatter call;
          // style functions that throw on it just keep the base font.
          try {
            const patch = def.cellStyleFn({ value: v, colId: def.colId, data: undefined as unknown as TRow } as never);
            if (patch && (patch.font !== undefined || patch.fontFamily !== undefined
              || patch.fontSize !== undefined || patch.fontWeight !== undefined
              || patch.fontStyle !== undefined)) {
              font = composeFont(patch, baseFont);
            }
          } catch { /* style errors never break autosize */ }
        }
        const w = measure(text, font);
        if (w > maxData) maxData = w;
      }
      let maxRaw = maxData + padding;
      if (!skipHeader) {
        const headerName = decorateHeader(def, this.options.suppressAggFuncInHeader === true);
        if (headerName) {
          const headerFont = def.headerStyle
            ? composeFont(def.headerStyle, this.theme.font)
            : this.theme.font;
          const headerW = measure(headerName, headerFont) + headerPadding;
          if (headerW > maxRaw) maxRaw = headerW;
        }
      }
      const maxW = Number.isFinite(def.maxWidth) ? def.maxWidth : Number.MAX_SAFE_INTEGER;
      out[def.colId] = Math.max(def.minWidth, Math.min(maxW, maxRaw));
    }
    return out;
  }

  /** Cycle 6 / Task 5 — flip visibility on every listed leaf in a batch.
   *  Unknown keys + `lockVisible: true` columns are silently dropped. One
   *  re-layout + one `columnVisible` event whose `colIds` lists the
   *  actually-changed columns. No-op when nothing flipped. */
  setColumnsVisible(keys: string[], visible: boolean): void {
    const targetHide = !visible;
    const changed: string[] = [];
    for (const key of keys) {
      // Under active pivot, source colDefs are swapped out of
      // `columnDefsMap`. They live on the preserved
      // `primaryColumnTree` and are still surfaced through
      // `getColumnState`, so visibility set against them must
      // round-trip through the panel checkbox and survive pivot
      // toggles. Mutate the primary def in place when the live
      // map doesn't carry the colId.
      const def = this.columnDefsMap.get(key)
        ?? this.pivotEngine.getPrimaryColumnTree()?.leafById.get(key);
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
    this.workerCoord?.updateColumns(this.workerColumns())
      .then(({ visibleCount }) => {
        this.rowCount = visibleCount;
        this.recomputeViewport();
        this.events.emit({ type: 'displayedColumnsChanged', source: 'columnVisible' });
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] setColumnsVisible:', err); });
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
    this.workerCoord?.updateColumns(this.workerColumns())
      .then(({ visibleCount }) => {
        this.rowCount = visibleCount;
        this.recomputeViewport();
        this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
        this.events.emit({ type: 'displayedColumnsChanged', source: 'columnMoved' });
        this.requestViewport();
      })
      .catch((err) => { if (!this.destroyed) console.error('[velocity-grid] moveColumns:', err); });
    for (const colId of validKeys) {
      const newIdx = finalOrder.indexOf(colId);
      if (newIdx < 0) continue;
      if (newIdx === oldIndex[colId]) continue;
      this.events.emit({
        type: 'columnMoved', toIndex: newIdx, colIds: [colId], source: 'api',
      });
    }
  }

  /** The raw, authored `columnDefs` tree (groups + leaves), unresolved.
   *  Backs the `VelocityGridApi.getColumnGroupDefs` closure and the Task 1
   *  hierarchy mutators below — kept as a real class method (rather than
   *  an inline `makeApi` closure) so both call sites share one
   *  definition. */
  getColumnGroupDefs(): (CColDef<TRow> | CColGroupDef<TRow>)[] {
    return this.options.columnDefs ?? [];
  }

  /** Columns tool panel hierarchy (Task 1) — apply a re-parented/reordered
   *  `columnDefs` tree via `updateGridOptions` (the only entry point that
   *  rebuilds the column tree), then re-apply the runtime column state
   *  (width / hide / pinned / sort / flex) that predates the swap.
   *  `rebuildColumns` re-resolves every leaf from its AUTHORED colDef, so
   *  any state set through the runtime mutators (`setColumnWidths`,
   *  `setColumnsVisible`, `setColumnsPinned`, ...) — which mutate the
   *  RESOLVED copy in `columnDefsMap`, never the raw authored def — would
   *  otherwise be silently dropped by the rebuild. `leafOrder` is not
   *  re-applied via `applyOrder` — the pure mutation core already encodes
   *  the desired order structurally in `defs`. */
  private applyColumnDefsPreservingState(
    defs: (CColDef<TRow> | CColGroupDef<TRow>)[],
    _leafOrder: string[],
  ): void {
    const prevState = this.getColumnState();
    this.updateGridOptions({ columnDefs: defs });
    this.applyColumnState({ state: prevState });
  }

  /** Columns tool panel hierarchy (Task 1) — re-parent (or reorder) a
   *  single leaf column via the pure `columnGroupMutation` core. Pass
   *  `targetGroupId: null` to move `colId` to the top level. No-op
   *  (including a rejected `marryChildren` guard, unknown ids, or a move
   *  that doesn't actually change anything) fires nothing. On success,
   *  `updateGridOptions({ columnDefs })` fires `columnDefsChanged` +
   *  `displayedColumnsChanged` as usual. */
  moveColumnToGroup(colId: string, targetGroupId: string | null, beforeColId?: string): void {
    const res = moveColumnToGroupPure(this.getColumnGroupDefs(), colId, targetGroupId, beforeColId);
    if (!res) return;
    this.applyColumnDefsPreservingState(
      res.defs as (CColDef<TRow> | CColGroupDef<TRow>)[],
      res.leafOrder,
    );
  }

  /** Columns tool panel hierarchy (Task 1) — re-parent (or reorder) a
   *  whole column group via the pure `columnGroupMutation` core. Pass
   *  `targetParentGroupId: null` to move `groupId` to the top level.
   *  Rejects moving a group into itself or one of its own descendants.
   *  No-op fires nothing; a successful move fires `columnDefsChanged` +
   *  `displayedColumnsChanged` via `updateGridOptions`. */
  moveColumnGroup(groupId: string, targetParentGroupId: string | null, beforeId?: string): void {
    const res = moveColumnGroupPure(this.getColumnGroupDefs(), groupId, targetParentGroupId, beforeId);
    if (!res) return;
    this.applyColumnDefsPreservingState(
      res.defs as (CColDef<TRow> | CColGroupDef<TRow>)[],
      res.leafOrder,
    );
  }

  /** Grid Layouts / column-group-drag feature (Task 1) — lazily build +
   *  cache the leaf colId → ancestor groupId path map by walking
   *  `columnTree.roots` once (`ResolvedColLeaf.groupPath` only lives on
   *  the heterogeneous tree, not on `leafById`). Cache is invalidated
   *  (`null`) on every `columnTree` reassignment. */
  private buildColGroupPathCache(): Map<string, string[]> {
    const cache = new Map<string, string[]>();
    const visit = (node: ColumnTreeNode): void => {
      if (node.kind === 'leaf') {
        cache.set(node.colDef.colId, node.groupPath);
      } else {
        for (const child of node.children) visit(child);
      }
    };
    for (const root of this.columnTree.roots) visit(root);
    return cache;
  }

  /** Grid Layouts / column-group-drag feature (Task 1) — `VelocityGridLike`
   *  accessor: ancestor group ids of `colId`, root→parent. `[]` for an
   *  unknown or ungrouped colId. */
  private getColGroupPath(colId: string): string[] {
    if (!this.colGroupPathCache) this.colGroupPathCache = this.buildColGroupPathCache();
    return this.colGroupPathCache.get(colId) ?? [];
  }

  /** Grid Layouts / column-group-drag feature (Task 1) — `VelocityGridLike`
   *  accessor: `groupId` plus every descendant group's id (depth-first).
   *  `[groupId]` alone when `groupId` has no sub-groups; `[]` when
   *  `groupId` is unknown. */
  private getGroupDescendantIds(groupId: string): string[] {
    const group = this.columnTree.groupById.get(groupId);
    if (!group) return [];
    const out: string[] = [];
    const visit = (node: ResolvedColGroupDef): void => {
      out.push(node.groupId);
      for (const child of node.children) {
        if (child.kind === 'group') visit(child);
      }
    };
    visit(group);
    return out;
  }

  /** Shared single-re-layout helper for the Task 5 batch mutations that
   *  don't need a column-tree rebuild (`setColumnsVisible` /
   *  `setColumnsPinned` / `setColumnWidths`). Recomputes the visible
   *  column order so hide flips light up, reruns the width pass so
   *  pinned-pane positions update, then one `recomputeViewport +
   *  repaintFull` (geometry change — partial damage would stagger cells). */
  private relayoutAfterColumnMutation(): void {
    this.columnOrder = this.computeVisibleColumnOrder();
    this.columnLayout = resolveColumnWidths(
      this.columnOrder,
      this.canvasBounds.width || this.scroller.clientWidth || 800,
    );
    // Visibility flips can empty every group of visible leaves — rebuild
    // the header stack so group-header rows drop and height reverts.
    this.rebuildSubgridStack();
    this.recomputeViewport();
    this.repaintFull();
  }

  /** Cycle 19 / Task 5-ColState — ColumnStateManager deps bundle.
   *  Threaded into the manager at construction so every reach into
   *  VelocityGrid state is explicit + auditable. The worker / pivot / grouping
   *  closures resolve at call-time, matching the PivotEngine /
   *  GroupingCoordinator pattern. */
  private makeColStateManagerDeps(): ColumnStateManagerDeps<TRow> {
    return {
      events: this.events,
      isDestroyed: () => this.destroyed,
      getColumnTree: () => this.columnTree,
      getColumnOrder: () => this.columnOrder,
      setColumnOrder: (order) => { this.columnOrder = order; },
      getColumnLayout: () => this.columnLayout,
      setColumnLayout: (layout) => { this.columnLayout = layout; },
      computeVisibleColumnOrder: () => this.computeVisibleColumnOrder(),
      getLayoutWidth: () =>
        this.canvasBounds.width || this.scroller.clientWidth || 800,
      getColumnDefs: () => this.options.columnDefs,
      setColumnDefs: (defs) => { this.options.columnDefs = defs; },
      rebuildColumns: () =>
        this.rebuildColumns({ defaultColDef: this.options.defaultColDef }),
      buildColumnOrderConstraints: () => this.buildColumnOrderConstraints(),
      rebuildColumnDefsByLeafOrder: (defs, order) =>
        rebuildColumnDefsByLeafOrder(defs, order),
      collectMovedColIds: (o, n) => collectMovedColIds(o, n),
      getSortModel: () => this.sortModel,
      setSortModel: (m) => this.setSortModel(m),
      recomputeViewport: () => this.recomputeViewport(),
      // Column-state relayout — wipe retained paint + full (style/order
      // can change without a columnLayout identity change in edge cases).
      requestRepaint: () => {
        this.invalidateRetainedPaintForColumnLayout();
        this.repaintFull();
      },
      workerColumns: () => this.workerColumns(),
      updateWorkerColumns: (cols) =>
        this.workerCoord.updateColumns(cols as WorkerColumn[]),
      requestViewport: () => this.requestViewport(),
      setRowCount: (n) => { this.rowCount = n; },
      isPivotActive: () => this.pivotEngine.isPivotActive(),
      getPrimaryColumnTree: () => this.pivotEngine.getPrimaryColumnTree(),
      getPivotColumns: () => this.pivotEngine.getPivotColumns(),
      getPivotValueColumns: () => this.pivotEngine.getValueColumns(),
      setPivotColumns: (cols) => this.pivotEngine.setPivotColumns(cols),
      setValueColumns: (list) => this.pivotEngine.setValueColumns(list),
      getGroupingRowGroupColumns: () => this.grouping.getRowGroupColumns(),
      setGroupingRowGroupColumns: (cols) =>
        this.grouping.getGroupingState().setRowGroupColumns(cols),
    };
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

  /** Cycle 19 / Task 4 — delegating wrapper. Predicate resolution +
   *  static-bool/function dispatch lives in `EditController.isCellEditable`.
   *  PUBLIC (VelocityGridExt toolbars): resolves against the RESOLVED colDef
   *  (defaultColDef/columnTypes folded) and carries the pivot-mode read-only
   *  gate — engine bridges (`@wellsfargo-starui/velocity-grid-edit`) delegate here instead of
   *  replicating the predicate against authored defs. */
  isCellEditable(rowIndex: number, colId: string): boolean {
    return this.editController.isCellEditable(rowIndex, colId);
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

  /** Cycle 19 / Task 4 — delegating wrappers. Lifecycle + keyboard matrix +
   *  full-row dispatch + commit-back pipeline live in `EditController`. */
  stopEditing(cancel: boolean = false): void {
    this.editController.stopEditing(cancel);
  }
  private isAnyEditOpen(): boolean {
    return this.editController.isOpen();
  }
  private nextEditableCell(
    fromRow: number,
    fromCol: string,
    direction: 'forward' | 'backward',
  ): { rowIndex: number; colId: string } | null {
    return this.editController.nextEditableCell(fromRow, fromCol, direction);
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
    this.editController.openEditor(rowIndex, colId, charPress, mode);
  }

  /** Cycle 19 / Task 4 — delegating wrapper. Ctor / synthetic-name intern
   *  routes through `EditController.registerCellEditor` so the shared
   *  registry stays the single source of truth. */
  registerCellEditor(name: string, ctor: CellEditorCtor): void {
    this.editController.registerCellEditor(name, ctor);
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
    return this.workerCoord.registerComparator(name, fn.toString());
  }

  /** Subscribe to a typed grid event. Returns an unsubscribe. */
  on<E extends VelocityGridEvent<TRow>['type']>(
    type: E,
    handler: (e: Extract<VelocityGridEvent<TRow>, { type: E }>) => void,
  ): () => void {
    return this.events.on(type, handler);
  }
  /** Remove a previously-registered listener. */
  off<E extends VelocityGridEvent<TRow>['type']>(
    type: E,
    handler: (e: Extract<VelocityGridEvent<TRow>, { type: E }>) => void,
  ): void {
    this.events.off(type, handler);
  }
  /** Alias for `on`, present for ag-grid API parity. */
  addEventListener<E extends VelocityGridEvent<TRow>['type']>(
    type: E,
    handler: (e: Extract<VelocityGridEvent<TRow>, { type: E }>) => void,
  ): () => void {
    return this.on(type, handler);
  }
  /** Alias for `off`, present for ag-grid API parity. */
  removeEventListener<E extends VelocityGridEvent<TRow>['type']>(
    type: E,
    handler: (e: Extract<VelocityGridEvent<TRow>, { type: E }>) => void,
  ): void {
    this.off(type, handler);
  }

  /** Pixel bounds of the cell at (`rowIndex`, `colId`) in the canvas's
   *  coordinate space. Returns `null` when not in the current viewport
   *  (off-screen rows / columns + pinned-but-clipped layouts). */
  getCellBoundsAt(rowIndex: number, colId: string): { x: number; y: number; w: number; h: number } | null {
    return this.cellBoundsAgainstFor(this.viewport, rowIndex, colId);
  }

  /** Task 4 (paint-cache layer) — `getCellBoundsAt`'s logic, parameterized
   *  by an explicit `ViewportState` so the renderer's LAYER pass can
   *  resolve bounds against `layerVs` instead of the real viewport. The
   *  public `getCellBoundsAt` above always passes `this.viewport`
   *  (unchanged behavior). */
  private cellBoundsAgainstFor(vs: ViewportState, rowIndex: number, colId: string):
    { x: number; y: number; w: number; h: number } | null {
    const col = vs.visibleColumns.find((c) => c.colId === colId);
    const row = vs.visibleRows.find(
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
    return this.cellBoundsAgainst(this.viewport, rowIndex, colId);
  }

  /** Task 4 (paint-cache layer) — `getVisibleCellBounds`'s band-clip logic,
   *  parameterized by an explicit `ViewportState`. The public
   *  `getVisibleCellBounds` above always passes `this.viewport` (unchanged
   *  behavior); the renderer's `getVisibleCellBounds` wiring (constructor,
   *  ~line 1600) passes `layerVs` during the retained layer's raster pass
   *  so the focus-ring / range overlay resolve against the LAYER's own
   *  (possibly off-screen) coverage instead of the narrower on-screen
   *  body. */
  private cellBoundsAgainst(vs: ViewportState, rowIndex: number, colId: string):
    { x: number; y: number; w: number; h: number } | null {
    const bounds = this.cellBoundsAgainstFor(vs, rowIndex, colId);
    if (!bounds) return null;
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
      // Cycle 21e / Task 11 — rule fold participates in the painted-bg
      // probe so E2E can assert rule styles without reading pixels.
      rowId: this.stringRowIdAt(rowIndex) || undefined,
      ruleRow: (() => {
        const id = this.stringRowIdAt(rowIndex);
        if (!id) return undefined;
        const mirror = this.rowDataById.get(id) as Record<string, unknown> | undefined;
        const snap = this.rowDataSnapshotAt(rowIndex) as Record<string, unknown> | undefined;
        // Match paint path: mirror wins; snapshot only fills usable gaps
        // (blank chunk cells must not clobber hydrated condition fields).
        return mergeRuleRowForPaint(mirror, snap);
      })(),
      themeKind: this.getThemeKind(),
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
