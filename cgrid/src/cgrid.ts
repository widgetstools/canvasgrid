// cgrid — vanilla TS canvas grid library
// Public surface lives here. Internals live under core/, renderer/, interaction/,
// worker/, theming/. See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md.
import './theming/tokens.css';
import type {
  CGridOptions, CGridEvent, CGridApi, Tx, TransactionResult, SortModel, FilterModel,
  CFilterModelEntry, GroupModel,
} from './types';
import { TypedEventEmitter } from './core/eventEmitter';
import { type ResolvedColDef, applyCellProps } from './core/propertyChain';
import { resolveColumnTree, isColGroupDef, type ColumnTree } from './core/columnTree';
import { ColumnGroupState, resolveVisibleLeaves } from './core/columnGroupState';
import {
  applyReorder, resolveLegalDropIndex, reorderLeavesByList,
  type ColumnOrderConstraints,
} from './core/columnOrder';
import {
  snapshotState, applyStateToTree, cloneStateForReset,
  type SnapshotLocks, type ChangeRecord,
} from './core/columnState';
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
import { computeViewport, type ViewportState } from './core/viewport';
import { RowHeightIndex } from './core/rowHeightIndex';
import { HeaderSubgrid, HeaderGroupSubgrid, DataSubgrid, type Subgrid } from './core/subgrid';
import { FloatingFilterSubgrid } from './core/floatingFilterSubgrid';
import { FloatingFilterOverlay } from './interaction/floatingFilterOverlay';
import { PopupHost } from './interaction/editors/popupHost';
import { FilterPopupHost } from './interaction/filters/filterPopupHost';
import { NumberFilterPopup } from './interaction/filters/numberFilter';
import { DateFilterPopup } from './interaction/filters/dateFilter';
import { TextFilterPopup, applyTrimInputToModel } from './interaction/filters/textFilter';
import { SetFilterPopup } from './interaction/filters/setFilter';
import { CGridCanvas } from './core/canvas';
import { CssReader, type ResolvedTheme } from './theming/cssReader';
import { CellRendererRegistry, textCell, numberCell, checkboxCell, headerCell, type CellPainter } from './renderer/cellRenderers/registry';
import { wrapTextCell } from './renderer/cellRenderers/wrapText';
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
import type { WorkerColumn, ViewportChunk, AutosizeColumnRequest } from './worker/protocol';
import { decodeText } from './worker/chunkFormat';

export const CGRID_VERSION = '0.0.0';

export type {
  CGridOptions, CColDef, CColGroupDef, CGridEvent, CGridApi, Tx, TransactionResult,
  SortModel, SortModelEntry, FilterModel, FilterModelEntry, FilterModelEntryLegacy,
  CFilterModelEntry, CTextFilterModel, CNumberFilterModel, CDateFilterModel,
  CMultiConditionFilterModel, CSetFilterModel,
  CFilterParams, CTextFilterParams, CSetFilterParams,
  CTextFilterOp, CNumberFilterOp, CDateFilterOp,
  GroupModel,
  CValueGetterParams, CValueFormatterParams,
  CCellRendererSelector, CCellRendererSelectorParams, CCellRendererSelectorResult,
  ColCellOverrides,
  CellClass, CellClassRules, CellStyleFunc, HeaderClass,
} from './types';
export type { CellPainter, CellPaintConfig } from './renderer/cellRenderers/registry';
export type { ICellEditor, ICellEditorParams, CellEditorCtor } from './interaction/editors/iCellEditor';

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

export class CGrid<TRow = any> {
  private events = new TypedEventEmitter<CGridEvent>();
  private columnTree!: ColumnTree;
  private columnGroupState!: ColumnGroupState;
  private columnDefsMap: Map<string, ResolvedColDef<TRow>> = new Map();
  private columnOrder: ResolvedColDef<TRow>[] = [];
  private columnLayout: ColumnLayout[] = [];
  private theme: ResolvedTheme;
  private scrollLeft = 0;
  private scrollTop = 0;
  private rowCount = 0;
  private chunk: ViewportChunk | null = null;
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
  /** First / last colId of the materialised center-column slice — the
   *  identity of the virtualisation window. `null` for "no center columns
   *  visible". The outer ref is `null` until the first `recomputeViewport`
   *  captures the baseline, so the construction-time recompute does NOT
   *  emit `virtualColumnsChanged` and external listeners only see real
   *  post-mount shifts. Cycle 6 / Task 8. */
  private prevVirtualColRange: { first: string | null; last: string | null } | null = null;

  constructor(container: HTMLElement, private options: CGridOptions<TRow>) {
    if (!options.getRowId) throw new Error('[cgrid] options.getRowId is required');

    // 1. DOM scaffold — scroller (with sized sizer child) provides native scrollbars;
    // the canvas (created later by CGridCanvas) overlays the scroller's content area
    // but is sized to scroller.clientWidth/Height so the scrollbar strips remain
    // interactive.
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
    this.root.classList.add(options.theme ?? 'cg-theme-quartz');

    this.scroller = document.createElement('div');
    this.scroller.className = 'cg-scroller';
    // overflow:scroll (not auto) so scrollbar gutters are reserved unconditionally —
    // macOS overlay scrollbars otherwise disappear when idle and the user can't
    // see they're scrollable. The webkit-scrollbar styles in tokens.css then
    // theme the persistent track + thumb.
    this.scroller.style.cssText = 'position:absolute; inset:0; overflow:scroll;';
    this.sizer = document.createElement('div');
    this.sizer.className = 'cg-sizer';
    this.sizer.style.cssText = 'width:1px; height:1px; pointer-events:none;';
    this.scroller.appendChild(this.sizer);

    this.editorContainer = document.createElement('div');
    this.editorContainer.style.cssText = 'position:absolute; left:0; top:0; right:0; bottom:0; pointer-events:none;';
    // Children of editorContainer set pointer-events:auto themselves
    this.root.appendChild(this.scroller);
    container.appendChild(this.root);

    // 2. Theme + cell renderers
    this.cssReader = new CssReader(this.root);
    this.theme = this.cssReader.read();
    this.cellRenderers = new CellRendererRegistry();
    this.cellRenderers.register('text', textCell);
    this.cellRenderers.register('number', numberCell);
    this.cellRenderers.register('checkbox', checkboxCell);
    this.cellRenderers.register('header', headerCell);
    this.cellRenderers.register('text-wrap', wrapTextCell);

    // 3. Column model — resolve into a tree (groups + leaves), then derive
    // the visible-leaf ordering from the group open/closed state. Task 3
    // makes group headers clickable and honors `columnGroupShow` on leaves
    // so collapsing a group hides its 'open'-only children (and vice-versa).
    // `columnDefsMap` keeps every leaf (including currently-hidden ones) so
    // toggling a group back open can rehydrate without re-resolving defs.
    this.columnTree = resolveColumnTree(options.columnDefs, options.defaultColDef, options.columnTypes);
    this.columnDefsMap = this.columnTree.leafById as Map<string, ResolvedColDef<TRow>>;
    this.columnGroupState = new ColumnGroupState(this.columnTree);
    this.columnOrder = this.computeVisibleColumnOrder();

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
      getCanvasWidth: () => this.canvasBounds.width,
      getCanvasHeight: () => this.canvasBounds.height,
      rowDataSnapshotAt: (rowIndex) => this.rowDataSnapshotAt(rowIndex),
      getQuickFilterLowerTerms: () => this.quickFilterLowerTerms,
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
      allColIds: () => this.columnOrder.map((c) => c.colId),
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
      cycleSort: (colId) => this.cycleSort(colId),
      toggleColumnGroup: (groupId) => this.toggleColumnGroup(groupId),
      scrollBy: (dx, dy) => this.scroller.scrollBy({ left: dx, top: dy, behavior: 'auto' }),
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
    this.a11y = new A11yOverlay(this.root);

    // 9. Worker
    // Foundation: use options.worker.url for test injection; otherwise resolve the co-emitted worker.js
    // via new URL() so bundlers (Vite library mode) emit a proper static asset reference rather than
    // inlining raw TypeScript as a data: URL (which browsers reject).
    const workerUrl = options.worker?.url ?? new URL('./worker.js', import.meta.url).toString();
    const worker = new Worker(workerUrl as unknown as URL, { type: 'module' });
    this.workerClient = new WorkerClient(worker as unknown as import('./worker/client').WorkerLike, {
      onModelUpdated: (visibleCount) => {
        this.rowCount = visibleCount;
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
        this.requestViewport();
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
      onError: (msg) => console.error('[cgrid] worker error:', msg),
    });

    this.workerClient.init({
      rowIdField: inferRowIdField(options.getRowId),
      columns: this.workerColumns(),
      rowHeight: this.options.rowHeight ?? this.theme.rowHeight,
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
      this.events.emit({ type: 'gridReady', api: this.makeApi() });
      if (options.rowData) this.setRowData(options.rowData);
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
    this.columnGroupState.onChange((changed) => {
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

    // 11. Selection feedback
    this.selectionUnsubscribe = this.selection.onChange((state) => {
      // Auto-scroll the focused cell into view so keyboard nav past the
      // visible window keeps the focus in the rendered region.
      if (state.focusedRowIndex !== null) this.ensureRowIndexVisible(state.focusedRowIndex);
      if (state.focusedColId !== null) this.ensureColIdVisible(state.focusedColId);
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
    this.workerClient.setRowData(rows, heightsByRowId).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.recomputeViewport();
      this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
      this.requestViewport();
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
      this.requestViewport();
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
      this.requestViewport();
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

  setSortModel(s: SortModel): void {
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

  /** Cycle the sort state for a column: unsorted → asc → desc → unsorted. */
  private cycleSort(colId: string): void {
    const existing = this.sortModel.find((e) => e.colId === colId);
    let next: SortModel;
    if (!existing) {
      next = [{ colId, direction: 'asc' }];
    } else if (existing.direction === 'asc') {
      next = [{ colId, direction: 'desc' }];
    } else {
      next = [];
    }
    this.setSortModel(next);
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
      this.requestViewport();
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  /** Cycle 7 / Task 1 — return the v2 filter model entry for `colId`, or
   *  `null` when the column is unfiltered. Backs the floating-filter
   *  overlay's `getColumnFilterModel` dep. Tasks 3-6 + 9 surface this on
   *  `CGridApi`. */
  getColumnFilterModel(colId: string): CFilterModelEntry | null {
    return this.columnFilterModels.get(colId) ?? null;
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
      this.requestViewport();
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
        this.requestViewport();
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
   *  Task 3 implements the number filter; tasks 4 (date) / 5 (text) /
   *  6 (multi) / 9 (set) extend the type switch.
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
    if (filterType === 'number') {
      const params = (def.filterParams ?? {}) as import('./types').CFilterParams;
      const initial = this.getColumnFilterModel(colId);
      // Cycle 7 / Task 6 — both number and multi-shaped entries seed the
      // popup. Single popups normalise a multi-shape to its first
      // condition; multi popups hydrate the full conditions array.
      const initialEntry = initial && (initial.filterType === 'number' || initial.filterType === 'multi')
        ? initial
        : null;
      const popup = new NumberFilterPopup({
        initialModel: initialEntry,
        onApply: (model) => void this.setColumnFilterModel(colId, model),
        onClose: () => this.hideColumnFilter(),
        buttons: params.buttons,
        closeOnApply: params.closeOnApply ?? true,
        maxNumConditions: params.maxNumConditions,
        numAlwaysVisibleConditions: params.numAlwaysVisibleConditions,
        defaultJoinOperator: params.defaultJoinOperator,
        onModified: () => this.events.emit({ type: 'filterModified', colId }),
      });
      this.filterPopupHost.open(colId, { cellBounds: anchorCell, viewportBounds }, popup);
      this.events.emit({ type: 'filterOpened', colId });
    } else if (filterType === 'date') {
      const params = (def.filterParams ?? {}) as import('./types').CFilterParams;
      const initial = this.getColumnFilterModel(colId);
      const initialEntry = initial && (initial.filterType === 'date' || initial.filterType === 'multi')
        ? initial
        : null;
      const popup = new DateFilterPopup({
        initialModel: initialEntry,
        onApply: (model) => void this.setColumnFilterModel(colId, model),
        onClose: () => this.hideColumnFilter(),
        buttons: params.buttons,
        closeOnApply: params.closeOnApply ?? true,
        maxNumConditions: params.maxNumConditions,
        numAlwaysVisibleConditions: params.numAlwaysVisibleConditions,
        defaultJoinOperator: params.defaultJoinOperator,
        onModified: () => this.events.emit({ type: 'filterModified', colId }),
      });
      this.filterPopupHost.open(colId, { cellBounds: anchorCell, viewportBounds }, popup);
      this.events.emit({ type: 'filterOpened', colId });
    } else if (filterType === 'text') {
      // Cycle 7 / Task 5 — text-filter popup. Reads `caseSensitive` /
      // `showCaseSensitiveToggle` from filterParams; the
      // `textFormatter` / `trimInput` knobs land on the worker
      // (textFormatter) or main-side setColumnFilterModel (trimInput).
      const params = (def.filterParams ?? {}) as import('./types').CTextFilterParams;
      const initial = this.getColumnFilterModel(colId);
      const initialEntry = initial && (initial.filterType === 'text' || initial.filterType === 'multi')
        ? initial
        : null;
      const popup = new TextFilterPopup({
        initialModel: initialEntry,
        onApply: (model) => void this.setColumnFilterModel(colId, model),
        onClose: () => this.hideColumnFilter(),
        buttons: params.buttons,
        closeOnApply: params.closeOnApply ?? true,
        showCaseSensitiveToggle: params.showCaseSensitiveToggle,
        maxNumConditions: params.maxNumConditions,
        numAlwaysVisibleConditions: params.numAlwaysVisibleConditions,
        defaultJoinOperator: params.defaultJoinOperator,
        onModified: () => this.events.emit({ type: 'filterModified', colId }),
      });
      this.filterPopupHost.open(colId, { cellBounds: anchorCell, viewportBounds }, popup);
      this.events.emit({ type: 'filterOpened', colId });
    } else if (filterType === 'set') {
      // Cycle 7 / Task 9 — set filter. Distinct values arrive via a
      // worker round-trip first; the popup mounts after the values
      // resolve so the checkbox list is rendered against real data
      // (not flashed empty). Static-array `filterParams.values`
      // overrides the data-derived path — useful for Cycle 18's SSRM
      // where the server supplies values.
      const params = (def.filterParams ?? {}) as import('./types').CSetFilterParams;
      const initial = this.getColumnFilterModel(colId);
      const initialEntry = initial && initial.filterType === 'set' ? initial : null;
      const valuesPromise: Promise<string[]> = params.values !== undefined
        ? Promise.resolve(params.values)
        : this.workerClient.getDistinctValues(colId);
      valuesPromise.then((values) => {
        if (this.destroyed) return;
        // Guard against a second `showColumnFilter` racing in before
        // distinct values land — drop this open if a different popup
        // has since taken over.
        const openCol = this.filterPopupHost.openColId();
        if (openCol !== null && openCol !== colId) return;
        const popup = new SetFilterPopup({
          values,
          initialModel: initialEntry,
          onApply: (model) => void this.setColumnFilterModel(colId, model),
          onClose: () => this.hideColumnFilter(),
          buttons: params.buttons,
          closeOnApply: params.closeOnApply ?? true,
          suppressMiniFilter: params.suppressMiniFilter,
          suppressSelectAll: params.suppressSelectAll,
          caseSensitive: params.caseSensitive,
          onModified: () => this.events.emit({ type: 'filterModified', colId }),
        });
        this.filterPopupHost.open(colId, { cellBounds: anchorCell, viewportBounds }, popup);
        this.events.emit({ type: 'filterOpened', colId });
      }).catch((err) => {
        if (!this.destroyed) console.error('[cgrid] getDistinctValues:', err);
      });
    }
  }

  /** Cycle 7 / Task 3 — close the active filter popup. Idempotent. */
  hideColumnFilter(): void {
    if (this.destroyed) return;
    this.filterPopupHost.close();
  }

  /** Cycle 7 / Task 1 — current displayed (post-filter) row count. Backs
   *  the floating-filter E2E that asserts typing reduces the visible
   *  rows. Identical to the value last shipped via `modelUpdated`. */
  getDisplayedRowCount(): number { return this.rowCount; }

  setGroupModel(_g: GroupModel): void { /* Out of scope for Foundation */ }

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

  refresh(): void { this.cgridCanvas.requestRepaint(); }

  /** Register a custom cell renderer. After registration, columns with
   *  `cellRenderer: name` (or whose `cellRendererSelector` returns
   *  `{ component: name }`) will dispatch to `painter`. Built-in names
   *  ('text', 'number', 'checkbox', 'header') can be overridden by
   *  re-registering; the override applies on the next repaint. */
  registerCellRenderer(name: string, painter: CellPainter): void {
    this.cellRenderers.register(name, painter);
    this.cgridCanvas?.requestRepaint();
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
          this.requestViewport();
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
      rebuildColumns: ({ defaultColDef }) => this.rebuildColumns({ defaultColDef }),
      refreshLayout: () => {
        this.recomputeViewport();
        this.cgridCanvas?.requestRepaint();
      },
      setSelectionMode: (mode) => this.selection.setMode(mode),
      applyRowData: (rows) => this.setRowData(rows as TRow[]),
      applyQuickFilter: () => this.applyQuickFilter(),
    };
  }

  /** Re-resolve the column tree from `options.columnDefs`, rebuild the
   *  visible column list, refresh layout, and rebuild the subgrid stack so
   *  any change in group depth lands a matching number of header rows. */
  private rebuildColumns({ defaultColDef }: { defaultColDef?: Partial<any> }): void {
    this.columnTree = resolveColumnTree(this.options.columnDefs, defaultColDef ?? this.options.defaultColDef, this.options.columnTypes);
    this.columnDefsMap = this.columnTree.leafById as Map<string, ResolvedColDef<TRow>>;
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
    stack.push(new DataSubgrid(
      () => this.rowCount,
      // Per-row height — first try the chunk's heights (canonical for the
      // rows currently in the visible window), fall back to the grid-level
      // `rowHeight`. Rows outside the chunk return the fallback; Task 7's
      // Fenwick tree replaces this with a global O(log n) lookup.
      (local) => this.rowHeightAt(local),
      (rowIndex, colId) => this.cellAt(rowIndex, colId),
    ));
    this.subgrids = stack;
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
    this.cgridCanvas.destroy();
    this.workerClient.destroy();
    this.featureChain.destroy();
    this.a11y.destroy();
    this.editor.close();
    this.rowEdit.close();
    this.floatingFilterOverlay.destroy();
    this.filterPopupHost.destroy();
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
      showColumnFilter: (c) => this.showColumnFilter(c),
      hideColumnFilter: () => this.hideColumnFilter(),
      onFilterChanged: (source) => this.onFilterChanged(source),
      getColumnFilterModel: <TModel extends CFilterModelEntry = CFilterModelEntry>(c: string) =>
        this.getColumnFilterModel(c) as TModel | null,
      setColumnFilterModel: (c, m) => this.setColumnFilterModel(c, m),
      isAnyFilterPresent: () => this.isAnyFilterPresent(),
      isColumnFilterPresent: () => this.isColumnFilterPresent(),
      destroyFilter: (c) => this.destroyFilter(c),
      ensureRowVisible: (id, pos) => this.ensureRowVisible(id, pos),
      ensureColumnVisible: (id, pos) => this.ensureColumnVisible(id, pos),
      ensureColumnGroupVisible: (id, pos) => this.ensureColumnGroupVisible(id, pos),
      getSelectedRowIds: () => this.getSelectedRowIds(),
      setSelectedRowIds: (ids) => this.setSelectedRowIds(ids),
      getFocusedCell: () => this.getFocusedCell(),
      setFocusedCell: (r, c) => this.setFocusedCell(r, c),
      refresh: () => this.refresh(),
      setTheme: (t) => this.setTheme(t),
      destroy: () => this.destroy(),
      getColumnGroupState: () => this.columnGroupState.getState(),
      setColumnGroupState: (s) => { this.columnGroupState.apply(s); },
      resetColumnGroupState: () => this.columnGroupState.reset(),
      getGridOption: (k) => this.getGridOption(k as keyof CGridOptions<TRow>) as any,
      setGridOption: (k, v) => this.setGridOption(k as keyof CGridOptions<TRow>, v as any),
      updateGridOptions: (p) => this.updateGridOptions(p as Partial<CGridOptions<TRow>>),
      registerCellRenderer: (n, p) => this.registerCellRenderer(n, p),
      registerCellEditor: (n, c) => this.registerCellEditor(n, c),
      startEditingCell: (r, c) => this.openEditor(r, c),
      stopEditing: (cancel) => this.stopEditing(cancel),
      on: (t, h) => this.on(t as CGridEvent['type'], h as any),
      off: (t, h) => this.off(t as CGridEvent['type'], h as any),
      addEventListener: (t, h) => this.addEventListener(t as CGridEvent['type'], h as any),
      removeEventListener: (t, h) => this.removeEventListener(t as CGridEvent['type'], h as any),
      moveColumnByIndex: (f, t) => this.moveColumnByIndex(f, t),
      getColumnState: () => this.getColumnState(),
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
    return ids
      .map((id) => this.columnDefsMap.get(id)!)
      .filter((def) => !def.hide);
  }

  private workerColumns(): WorkerColumn[] {
    return this.columnOrder.map((c) => {
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
      suppressColumnVirtualisation: this.options.suppressColumnVirtualisation,
      suppressRowVirtualisation: this.options.suppressRowVirtualisation,
      dataRowHeightIndex: this.rowHeightIndex ?? undefined,
    });
  }

  /** Size the invisible sizer to match the viewport's scrollable extent so the
   * native scrollbars track the right range. clientWidth/Height excludes the
   * scrollbar gutter, so adding maxScrollLeft/Top gives the browser exactly
   * the overflow it needs to expose.
   */
  private syncSizer(): void {
    if (!this.sizer) return; // happy-dom guard during early construction
    const w = (this.scroller.clientWidth || this.root.clientWidth) + this.viewport.maxScrollLeft;
    const h = (this.scroller.clientHeight || this.root.clientHeight) + this.viewport.maxScrollTop;
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
    this.scrollLeft = x;
    this.scrollTop = y;
    this.recomputeViewport(/* afterScroll */ horizontal);
    this.events.emit({ type: 'viewportChanged', firstRow: this.viewport.firstRow, lastRow: this.viewport.lastRow });
    this.cgridCanvas.requestRepaint();
    this.requestViewport();
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
    if (allIds.length === 0) return;
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

  private requestViewport(): void {
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
    const rowStart = this.viewport.firstRow;
    const rowEnd = this.viewport.lastRow + 1;
    this.workerClient.getViewport({ rowStart, rowEnd, columns: cols, includeFlashMask: true })
      .then((chunk) => {
        this.viewportRequestPending = false;
        this.chunk = chunk;
        this.decodedTextCols.clear();
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
        if (chunk.totals) {
          this.events.emit({ type: 'aggregationChanged', totals: chunk.totals });
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
    if (i < 0 || i >= this.chunk.heights.length) return fallback;
    const h = this.chunk.heights[i]!;
    return h > 0 ? h : fallback;
  }

  private cellAt(rowIndex: number, colId: string): { value: unknown; valueFormatted: string } | null {
    if (!this.chunk) return null;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    const numeric = this.chunk.numericCols[colId];
    if (numeric) {
      const value = numeric[localIndex]!;
      return { value, valueFormatted: this.formatNumber(colId, value) };
    }
    const text = this.chunk.textCols[colId];
    if (text) {
      let decoded = this.decodedTextCols.get(colId);
      if (!decoded) { decoded = decodeText(text.offsets, text.bytes); this.decodedTextCols.set(colId, decoded); }
      const value = decoded[localIndex] ?? '';
      return { value, valueFormatted: value };
    }
    return { value: '', valueFormatted: '' };
  }

  private rowIdAt(rowIndex: number): string | null {
    // Foundation: numeric IDs need round-trip via worker. For now, we only support cell-level focus events.
    // Real string IDs need a worker→main mapping deferred to a follow-up cycle.
    return `row-${rowIndex}`;
  }

  private formatNumber(_colId: string, value: number): string {
    return Number.isFinite(value) ? value.toString() : '';
  }

  private updateA11y(): void {
    const { focusedRowIndex, focusedColId } = this.selection.state;
    const focusedRowData = focusedRowIndex == null ? []
      : this.viewport.visibleColumns
          .filter((c) => !c.pinned || c.pinned === 'left')
          .map((c) => ({ colId: c.colId, valueFormatted: this.cellAt(focusedRowIndex, c.colId)?.valueFormatted ?? '' }));
    this.a11y.update({
      visibleRowCount: this.rowCount,
      columnCount: this.columnOrder.length,
      focusedRowIndex,
      focusedColId,
      focusedRowData,
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
   *  state in declaration order (hidden leaves included). */
  getColumnState(): CColumnState[] {
    return snapshotState(this.columnTree, this.columnLayout, this.sortModel);
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
    const requests: AutosizeColumnRequest[] = [];
    for (const key of keys) {
      const def = this.columnDefsMap.get(key);
      if (!def) continue;
      if (def.hide) continue;
      if (def.suppressAutoSize) continue;
      const font = def.cellStyle?.font ?? this.theme.font;
      requests.push({
        colId: def.colId,
        headerName: def.headerName,
        font,
        padding,
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
    let allFound = true;
    if (params.state) {
      for (const entry of params.state) {
        if (!this.columnDefsMap.has(entry.colId)) { allFound = false; break; }
      }
    }

    const locks: SnapshotLocks = {
      lockVisibleOf: (id) => this.columnDefsMap.get(id)?.lockVisible ?? false,
      lockPinnedOf: (id) => this.columnDefsMap.get(id)?.lockPinned ?? false,
    };

    const oldOrder = this.columnOrder.map((c) => c.colId);
    const result = applyStateToTree(this.columnTree, params, locks);

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
