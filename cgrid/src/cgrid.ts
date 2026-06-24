// cgrid — vanilla TS canvas grid library
// Public surface lives here. Internals live under core/, renderer/, interaction/,
// worker/, theming/. See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md.
import './theming/tokens.css';
import type {
  CGridOptions, CGridEvent, CGridApi, Tx, TransactionResult, SortModel, FilterModel, GroupModel,
} from './types';
import { TypedEventEmitter } from './core/eventEmitter';
import { resolveColDef, type ResolvedColDef } from './core/propertyChain';
import { resolveColumnWidths, type ColumnLayout } from './core/layout';
import { computeViewport, type ViewportState } from './core/viewport';
import { HeaderSubgrid, DataSubgrid, type Subgrid } from './core/subgrid';
import { CGridCanvas } from './core/canvas';
import { CssReader, type ResolvedTheme } from './theming/cssReader';
import { CellRendererRegistry, textCell, numberCell, checkboxCell } from './renderer/cellRenderers/registry';
import { Renderer } from './renderer/renderer';
import { HitTester } from './interaction/hitTester';
import { SelectionModel } from './interaction/selectionModel';
import { PointerInput } from './interaction/pointerInput';
import { KeyboardInput } from './interaction/keyboardInput';
import { EditorOverlay } from './interaction/editorOverlay';
import { A11yOverlay } from './interaction/a11yOverlay';
import { WorkerClient } from './worker/client';
import type { WorkerColumn, ViewportChunk } from './worker/protocol';
import { decodeText } from './worker/chunkFormat';

export const CGRID_VERSION = '0.0.0';

export type {
  CGridOptions, CColDef, CGridEvent, CGridApi, Tx, TransactionResult,
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
  private columnDefsMap = new Map<string, ResolvedColDef<TRow>>();
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
  private pointer: PointerInput;
  private keyboard: KeyboardInput;
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
    this.scroller.style.cssText = 'position:absolute; inset:0; overflow:auto;';
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

    // 3. Column model
    for (const def of options.columnDefs) {
      const r = resolveColDef(def, options.defaultColDef);
      this.columnDefsMap.set(r.colId, r);
      this.columnOrder.push(r);
    }

    // 4. Subgrid stack — header on top, data below. Future totals/footer rows
    // are a `this.subgrids.push(...)` away. computeViewport walks this list.
    this.subgrids = [
      new HeaderSubgrid(
        this.columnDefsMap as Map<string, ResolvedColDef>,
        () => this.options.headerHeight ?? this.theme.headerHeight,
      ),
      new DataSubgrid(
        () => this.rowCount,
        () => this.options.rowHeight ?? this.theme.rowHeight,
        (rowIndex, colId) => this.cellAt(rowIndex, colId),
      ),
    ];

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
      // Drawable size = scroller's inner area (excludes the scrollbar gutter)
      // so the canvas never overlaps the native scrollbar.
      measureSize: () => ({
        width: this.scroller.clientWidth || this.root.clientWidth || 0,
        height: this.scroller.clientHeight || this.root.clientHeight || 0,
      }),
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
    const inputDeps: import('./interaction/pointerInput').InputDeps = {
      canvas: this.cgridCanvas.canvas,
      hitTester: this.hitTester,
      selectionModel: this.selection,
      visibleColIds: () => this.viewport.visibleColumns.map((c) => c.colId),
      visibleRowIndices: () => this.viewport.visibleRows
        .filter((r) => r.subgrid.isData)
        .map((r) => r.localRowIndex),
      allColIds: () => this.columnOrder.map((c) => c.colId),
      totalRowCount: () => this.rowCount,
      onCellClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => {
        const rowId = this.rowIdAt(rowIndex);
        if (rowId) this.events.emit({ type: 'cellClicked', rowId, colId, value: this.cellAt(rowIndex, colId)?.value, mouse });
      },
      onCellDoubleClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => {
        const rowId = this.rowIdAt(rowIndex);
        if (rowId) {
          this.events.emit({ type: 'cellDoubleClicked', rowId, colId, value: this.cellAt(rowIndex, colId)?.value, mouse });
          this.openEditor(rowIndex, colId);
        }
      },
      onHeaderClicked: (colId: string) => this.cycleSort(colId),
      onColumnResize: (colId: string, dx: number) => this.resizeColumn(colId, dx),
      onWheel: (dx, dy) => this.scroller.scrollBy({ left: dx, top: dy, behavior: 'auto' }),
    };
    this.pointer = new PointerInput(inputDeps);
    this.keyboard = new KeyboardInput(inputDeps);
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
      this.events.emit({ type: 'filterChanged', filterModel: f });
      this.requestViewport();
    }).catch((err) => { if (!this.destroyed) console.error('[cgrid]', err); });
  }

  setGroupModel(_g: GroupModel): void { /* Out of scope for Foundation */ }

  ensureRowVisible(_rowId: string, _position?: 'top' | 'middle' | 'bottom'): void {
    // Foundation: simple — scroll to the row's index*rowHeight. Lookup requires worker support not in v1.
  }

  getSelectedRowIds(): string[] {
    const out: string[] = [];
    for (const idx of this.selection.state.selectedRowIndices) {
      const id = this.rowIdAt(idx);
      if (id) out.push(id);
    }
    return out;
  }

  setSelectedRowIds(_ids: string[]): void { /* needs a rowId -> rowIndex map; deferred */ }

  getFocusedCell(): { rowId: string; colId: string } | null {
    const { focusedRowIndex, focusedColId } = this.selection.state;
    if (focusedRowIndex == null || focusedColId == null) return null;
    const rowId = this.rowIdAt(focusedRowIndex);
    return rowId ? { rowId, colId: focusedColId } : null;
  }

  setFocusedCell(_rowId: string, _colId: string): void { /* deferred */ }

  refresh(): void { this.cgridCanvas.requestRepaint(); }

  setTheme(themeClass: string): void {
    const current = Array.from(this.root.classList).filter((c) => c.startsWith('cg-theme-'));
    current.forEach((c) => this.root.classList.remove(c));
    this.root.classList.add(themeClass);
    this.theme = this.cssReader.read();
    this.recomputeViewport();
    this.cgridCanvas.requestRepaint();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.selectionUnsubscribe();
    this.cgridCanvas.destroy();
    this.workerClient.destroy();
    this.pointer.destroy();
    this.keyboard.destroy();
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
      getSelectedRowIds: () => this.getSelectedRowIds(),
      setSelectedRowIds: (ids) => this.setSelectedRowIds(ids),
      getFocusedCell: () => this.getFocusedCell(),
      setFocusedCell: (r, c) => this.setFocusedCell(r, c),
      refresh: () => this.refresh(),
      setTheme: (t) => this.setTheme(t),
      destroy: () => this.destroy(),
    };
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

  /** Bring the row at `rowIndex` into the visible body, with a small overscan buffer. */
  private ensureRowIndexVisible(rowIndex: number): void {
    const rh = this.options.rowHeight ?? this.theme.rowHeight;
    const top = rowIndex * rh;
    const bottom = top + rh;
    if (top < this.scrollTop) {
      this.setScroll(this.scrollLeft, top);
    } else if (bottom > this.scrollTop + this.viewport.bodyHeight) {
      this.setScroll(this.scrollLeft, bottom - this.viewport.bodyHeight);
    }
  }

  /** Bring the column with `colId` into the visible body. Pinned columns are always visible. */
  private ensureColIdVisible(colId: string): void {
    const layoutCol = this.columnLayout.find((c) => c.colId === colId);
    if (!layoutCol || layoutCol.pinned) return;
    // Convert content-space left (relative to layout) into body-content space.
    const pinnedLeftWidth = this.columnLayout.filter((c) => c.pinned === 'left').reduce((s, c) => s + c.width, 0);
    const left = layoutCol.left - pinnedLeftWidth;
    const right = left + layoutCol.width;
    if (left < this.scrollLeft) {
      this.setScroll(left, this.scrollTop);
    } else if (right > this.scrollLeft + this.viewport.bodyWidth) {
      this.setScroll(right - this.viewport.bodyWidth, this.scrollTop);
    }
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
