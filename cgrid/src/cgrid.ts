// cgrid — vanilla TS canvas grid library
// Public surface lives here. Internals live under core/, renderer/, interaction/,
// worker/, theming/. See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md.
import './theming/tokens.css';
import type {
  CGridOptions, CGridEvent, CGridApi, Tx, TransactionResult, SortModel, FilterModel, GroupModel,
} from './types';
import { TypedEventEmitter } from './core/eventEmitter';
import { type ResolvedColDef } from './core/propertyChain';
import { resolveColumnTree, type ColumnTree } from './core/columnTree';
import { ColumnGroupState, resolveVisibleLeaves } from './core/columnGroupState';
import {
  INITIAL_ONLY_OPTIONS, applyRuntimeOption, isRuntimeOption,
  type RuntimeOptionTarget,
} from './core/runtimeOptions';
import { resolveColumnWidths, type ColumnLayout } from './core/layout';
import { computeViewport, type ViewportState } from './core/viewport';
import { HeaderSubgrid, HeaderGroupSubgrid, DataSubgrid, type Subgrid } from './core/subgrid';
import { CGridCanvas } from './core/canvas';
import { CssReader, type ResolvedTheme } from './theming/cssReader';
import { CellRendererRegistry, textCell, numberCell, checkboxCell, headerCell } from './renderer/cellRenderers/registry';
import { Renderer } from './renderer/renderer';
import { HitTester } from './interaction/hitTester';
import { SelectionModel } from './interaction/selectionModel';
import { FeatureChain } from './interaction/featureChain';
import { EditorOverlay } from './interaction/editorOverlay';
import { A11yOverlay } from './interaction/a11yOverlay';
import { WorkerClient } from './worker/client';
import type { WorkerColumn, ViewportChunk } from './worker/protocol';
import { decodeText } from './worker/chunkFormat';

export const CGRID_VERSION = '0.0.0';

export type {
  CGridOptions, CColDef, CColGroupDef, CGridEvent, CGridApi, Tx, TransactionResult,
  SortModel, SortModelEntry, FilterModel, FilterModelEntry, GroupModel,
  CValueGetterParams, CValueFormatterParams,
} from './types';

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
  private editor: EditorOverlay;
  private a11y: A11yOverlay;
  private workerClient: WorkerClient;
  private destroyed = false;
  private selectionUnsubscribe: () => void = () => {};
  private sortModel: SortModel = [];

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

    // 3. Column model — resolve into a tree (groups + leaves), then derive
    // the visible-leaf ordering from the group open/closed state. Task 3
    // makes group headers clickable and honors `columnGroupShow` on leaves
    // so collapsing a group hides its 'open'-only children (and vice-versa).
    // `columnDefsMap` keeps every leaf (including currently-hidden ones) so
    // toggling a group back open can rehydrate without re-resolving defs.
    this.columnTree = resolveColumnTree(options.columnDefs, options.defaultColDef);
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
      cycleSort: (colId) => this.cycleSort(colId),
      toggleColumnGroup: (groupId) => this.toggleColumnGroup(groupId),
      scrollBy: (dx, dy) => this.scroller.scrollBy({ left: dx, top: dy, behavior: 'auto' }),
      emitCellClicked: (rowIndex, colId, mouse) => {
        const rowId = this.rowIdAt(rowIndex);
        if (rowId) this.events.emit({ type: 'cellClicked', rowId, colId, value: this.cellAt(rowIndex, colId)?.value, mouse });
      },
      emitCellDoubleClicked: (rowIndex, colId, mouse) => {
        const rowId = this.rowIdAt(rowIndex);
        if (rowId) {
          this.events.emit({ type: 'cellDoubleClicked', rowId, colId, value: this.cellAt(rowIndex, colId)?.value, mouse });
          this.openEditor(rowIndex, colId);
        }
      },
    });
    this.editor = new EditorOverlay();
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
      onError: (msg) => console.error('[cgrid] worker error:', msg),
    });

    this.workerClient.init({
      rowIdField: inferRowIdField(options.getRowId),
      columns: this.workerColumns(),
    }).then(() => {
      this.events.emit({ type: 'gridReady', api: this.makeApi() });
      if (options.rowData) this.setRowData(options.rowData);
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });

    // 10. Native scroll listener
    this.scroller.addEventListener('scroll', () => {
      this.onScrollerScroll(this.scroller.scrollLeft, this.scroller.scrollTop);
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
  }

  // --- Public API -----------------------------------------------------------

  on<E extends CGridEvent['type']>(type: E, handler: (e: Extract<CGridEvent, { type: E }>) => void): () => void {
    return this.events.on(type, handler);
  }

  setRowData(rows: TRow[]): void {
    this.workerClient.setRowData(rows).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.recomputeViewport();
      this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
      this.requestViewport();
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  applyTransaction(t: Tx<TRow>): TransactionResult {
    // Foundation: async only. For sync semantics, callers use the worker's sync path via separate cycle.
    this.workerClient.applyTransaction({
      add: t.add as unknown[],
      update: t.update as unknown[],
      remove: (t.remove as TRow[] | undefined)?.map((r) => this.options.getRowId(r)),
      async: false,
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid] applyTransaction:', err); });
    return { add: [], update: [], remove: [] };
  }

  applyTransactionAsync(t: Tx<TRow>): void {
    this.workerClient.applyTransaction({
      add: t.add as unknown[],
      update: t.update as unknown[],
      remove: (t.remove as TRow[] | undefined)?.map((r) => this.options.getRowId(r)),
      async: true,
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid] applyTransaction:', err); });
  }

  flushAsyncTransactions(): void { /* Foundation: deferred — relies on worker's setTimeout */ }

  setSortModel(s: SortModel): void {
    this.sortModel = s;
    this.workerClient.setSortModel(s).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
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
    this.workerClient.setFilterModel(f).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.recomputeViewport();
      // Same rationale as setSortModel — filter changes don't trigger a
      // `modelUpdated` push, so persistent selection indices need to be
      // rebuilt here against the freshly-filtered visible order.
      this.rebuildSelectionFromPersistentIds();
      this.events.emit({ type: 'filterChanged', filterModel: f });
      this.requestViewport();
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

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
    };
  }

  /** Re-resolve the column tree from `options.columnDefs`, rebuild the
   *  visible column list, refresh layout, and rebuild the subgrid stack so
   *  any change in group depth lands a matching number of header rows. */
  private rebuildColumns({ defaultColDef }: { defaultColDef?: Partial<any> }): void {
    this.columnTree = resolveColumnTree(this.options.columnDefs, defaultColDef ?? this.options.defaultColDef);
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
    stack.push(new DataSubgrid(
      () => this.rowCount,
      () => this.options.rowHeight ?? this.theme.rowHeight,
      (rowIndex, colId) => this.cellAt(rowIndex, colId),
    ));
    this.subgrids = stack;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.selectionUnsubscribe();
    this.cgridCanvas.destroy();
    this.workerClient.destroy();
    this.featureChain.destroy();
    this.a11y.destroy();
    this.editor.close();
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
    };
  }

  private toggleColumnGroup(groupId: string): void {
    this.columnGroupState.toggle(groupId);
  }

  /** Map `resolveVisibleLeaves` (colIds) back to ResolvedColDefs. Hidden
   *  leaves stay in `columnDefsMap`, so a later toggle picks them up without
   *  re-resolving. */
  private computeVisibleColumnOrder(): ResolvedColDef<TRow>[] {
    const ids = resolveVisibleLeaves(this.columnTree, this.columnGroupState);
    return ids.map((id) => this.columnDefsMap.get(id)!);
  }

  private workerColumns(): WorkerColumn[] {
    return this.columnOrder.map((c) => ({
      colId: c.colId,
      field: c.field as string | undefined,
      type: c.type,
      aggFunc: c.aggFunc,
      filter: c.filter,
    }));
  }

  private computeCurrentViewport(): ViewportState {
    const w = this.scroller.clientWidth || this.root.clientWidth || 800;
    const h = this.scroller.clientHeight || this.root.clientHeight || 600;
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

  /** Reassign viewport AND re-sync the sizer so native scrollbars stay accurate. */
  private recomputeViewport(): void {
    this.viewport = this.computeCurrentViewport();
    this.syncSizer();
  }

  /** Called by the scroller's native 'scroll' event. Idempotent — if the
   * internal state already matches (e.g., because we just set scrollLeft
   * programmatically), it's a no-op so there's no feedback loop.
   */
  private onScrollerScroll(x: number, y: number): void {
    if (x === this.scrollLeft && y === this.scrollTop) return;
    this.scrollLeft = x;
    this.scrollTop = y;
    this.recomputeViewport();
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
   *  inside the body area. Clamping is delegated to `setScroll`. */
  private ensureRowIndexVisible(
    rowIndex: number,
    position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto',
  ): void {
    const rh = this.options.rowHeight ?? this.theme.rowHeight;
    const top = rowIndex * rh;
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
        this.cgridCanvas.requestRepaint();
        this.updateA11y();
        if (chunk.totals) {
          this.events.emit({ type: 'aggregationChanged', totals: chunk.totals });
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
    this.events.emit({ type: 'columnResized', colId, width: newW });
  }

  private openEditor(rowIndex: number, colId: string): void {
    const def = this.columnDefsMap.get(colId);
    if (!def || !def.editable) return;
    const col = this.viewport.visibleColumns.find((c) => c.colId === colId);
    const row = this.viewport.visibleRows.find(
      (r) => r.subgrid.isData && r.localRowIndex === rowIndex,
    );
    if (!col || !row) return;
    const data = this.cellAt(rowIndex, colId);
    this.editorContainer.style.pointerEvents = 'auto';
    this.editor.open({
      container: this.editorContainer,
      bounds: { x: col.left, y: row.top, w: col.width, h: row.height },
      colDef: def,
      initialValue: data?.value ?? '',
      onCommit: (newValue) => {
        this.editorContainer.style.pointerEvents = 'none';
        const rowId = this.rowIdAt(rowIndex);
        if (!rowId) return;
        this.events.emit({ type: 'cellValueChanged', rowId, colId, oldValue: data?.value, newValue });
        // Foundation: emit only; actual transaction wiring needs rowId-by-index lookup (deferred to a follow-up cycle).
      },
      onCancel: () => { this.editorContainer.style.pointerEvents = 'none'; },
    });
  }
}
