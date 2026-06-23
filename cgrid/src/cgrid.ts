// cgrid — vanilla TS canvas grid library
// Public surface lives here. Internals live under core/, renderer/, interaction/,
// worker/, theming/. See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md.
import './theming/tokens.css';
import type {
  CGridOptions, CGridEvent, CGridApi, Tx, TransactionResult, SortModel, FilterModel, GroupModel, CColDef,
} from './types';
import { TypedEventEmitter } from './core/eventEmitter';
import { resolveColDef, type ResolvedColDef } from './core/propertyChain';
import { resolveColumnWidths, type ColumnLayout } from './core/layout';
import { computeViewport, type ViewportState } from './core/viewport';
import { PaintLoop, type DirtyRect } from './core/paintLoop';
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
  SortModel, FilterModel, GroupModel,
} from './types';

// Suppress unused import lint for DirtyRect — used as type only via PaintLoop callback signature.
type _DirtyRectAlias = DirtyRect;

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

  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private editorContainer: HTMLDivElement;
  private cssReader: CssReader;
  private cellRenderers: CellRendererRegistry;
  private paintLoop: PaintLoop;
  private renderer: Renderer;
  private viewport: ViewportState;
  private selection: SelectionModel;
  private hitTester: HitTester;
  private pointer: PointerInput;
  private keyboard: KeyboardInput;
  private editor: EditorOverlay;
  private a11y: A11yOverlay;
  private workerClient: WorkerClient;
  private destroyed = false;
  private resizeObs: ResizeObserver;

  constructor(private container: HTMLElement, private options: CGridOptions<TRow>) {
    if (!options.getRowId) throw new Error('[cgrid] options.getRowId is required');

    // 1. DOM scaffold
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
    this.root.classList.add(options.theme ?? 'cg-theme-quartz');
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block; position:absolute; left:0; top:0; outline:none;';
    this.canvas.tabIndex = 0;
    this.editorContainer = document.createElement('div');
    this.editorContainer.style.cssText = 'position:absolute; left:0; top:0; right:0; bottom:0; pointer-events:none;';
    // Children of editorContainer set pointer-events:auto themselves
    this.root.appendChild(this.canvas);
    this.root.appendChild(this.editorContainer);
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

    // 4. Initial viewport
    this.viewport = this.computeCurrentViewport();

    // 5. Selection
    this.selection = new SelectionModel(options.rowSelection ?? 'none');

    // 6. Paint loop + renderer
    this.paintLoop = new PaintLoop((rects) => this.renderer.paint(rects));
    this.renderer = new Renderer({
      canvas: this.canvas,
      paintLoop: this.paintLoop,
      getViewport: () => this.viewport,
      getTheme: () => this.theme,
      getColumnDefs: () => this.columnDefsMap as Map<string, ResolvedColDef>,
      cellRenderers: this.cellRenderers,
      cellData: (rowIndex, colId) => this.cellAt(rowIndex, colId),
      getSelection: () => this.selection.state,
    });

    // 7. Hit-test + input
    this.hitTester = new HitTester(
      () => this.viewport,
      () => this.theme.headerHeight,
      () => this.theme.resizerHotZone,
    );
    const inputDeps = {
      canvas: this.canvas,
      hitTester: this.hitTester,
      selectionModel: this.selection,
      visibleColIds: () => this.viewport.visibleColumns.map((c) => c.colId),
      visibleRowIndices: () => this.viewport.visibleRows.map((r) => r.rowIndex),
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
      onColumnResize: (colId: string, dx: number) => this.resizeColumn(colId, dx),
      onScroll: (dx: number, dy: number) => this.applyScroll(dx, dy),
    };
    this.pointer = new PointerInput(inputDeps);
    this.keyboard = new KeyboardInput(inputDeps);
    this.editor = new EditorOverlay();
    this.a11y = new A11yOverlay(this.root);

    // 8. Worker
    // Foundation: use options.worker.url for test injection; otherwise use the bundler's new URL() for the worker entry.
    const workerUrl = options.worker?.url ?? new URL('./worker/worker.ts', import.meta.url).toString();
    const worker = new Worker(workerUrl as unknown as URL, { type: 'module' });
    this.workerClient = new WorkerClient(worker as unknown as import('./worker/client').WorkerLike, {
      onModelUpdated: (visibleCount) => {
        this.rowCount = visibleCount;
        this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
        this.requestViewport();
      },
      onAsyncTransactionsFlushed: (results) => {
        this.events.emit({ type: 'asyncTransactionsFlushed', results });
      },
      onError: (msg) => console.error('[cgrid] worker error:', msg),
    });

    this.workerClient.init({
      rowIdField: this.inferRowIdField(options),
      columns: this.workerColumns(),
    }).then(() => {
      this.events.emit({ type: 'gridReady', api: this.makeApi() });
      if (options.rowData) this.setRowData(options.rowData);
    });

    // 9. Resize observer
    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(this.root);
    this.handleResize();

    // 10. Selection feedback
    this.selection.onChange(() => {
      this.paintLoop.markFullDirty();
      this.events.emit({ type: 'selectionChanged', selectedRowIds: this.getSelectedRowIds() });
      this.updateA11y();
    });

    this.paintLoop.start();
  }

  // --- Public API -----------------------------------------------------------

  on<E extends CGridEvent['type']>(type: E, handler: (e: Extract<CGridEvent, { type: E }>) => void): () => void {
    return this.events.on(type, handler);
  }

  setRowData(rows: TRow[]): void {
    this.workerClient.setRowData(rows).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
      this.requestViewport();
    });
  }

  applyTransaction(t: Tx<TRow>): TransactionResult {
    // Foundation: async only. For sync semantics, callers use the worker's sync path via separate cycle.
    this.workerClient.applyTransaction({
      add: t.add as unknown[],
      update: t.update as unknown[],
      remove: (t.remove as TRow[] | undefined)?.map((r) => this.options.getRowId(r)),
      async: false,
    });
    return { add: [], update: [], remove: [] };
  }

  applyTransactionAsync(t: Tx<TRow>): void {
    this.workerClient.applyTransaction({
      add: t.add as unknown[],
      update: t.update as unknown[],
      remove: (t.remove as TRow[] | undefined)?.map((r) => this.options.getRowId(r)),
      async: true,
    });
  }

  flushAsyncTransactions(): void { /* Foundation: deferred — relies on worker's setTimeout */ }

  setSortModel(s: SortModel): void {
    this.workerClient.setSortModel(s).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.events.emit({ type: 'sortChanged', sortModel: s });
      this.requestViewport();
    });
  }

  setFilterModel(f: FilterModel): void {
    this.workerClient.setFilterModel(f).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.events.emit({ type: 'filterChanged', filterModel: f });
      this.requestViewport();
    });
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

  refresh(): void { this.paintLoop.markFullDirty(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.paintLoop.stop();
    this.workerClient.destroy();
    this.resizeObs.disconnect();
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

  private inferRowIdField(opts: CGridOptions<TRow>): string {
    // Foundation: parse the field name out of a `(row) => row.id` style fn body.
    const src = opts.getRowId.toString();
    const m = src.match(/(?:return\s+)?(?:\w+|\(\w+\))\.(\w+)/);
    if (m) return m[1]!;
    throw new Error('[cgrid] could not infer rowIdField from getRowId — Foundation cycle only supports `row => row.<field>` style');
  }

  private handleResize(): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.renderer.syncSize(w, h);
    this.columnLayout = resolveColumnWidths(this.columnOrder, w);
    this.viewport = this.computeCurrentViewport();
    this.requestViewport();
  }

  private computeCurrentViewport(): ViewportState {
    const w = this.root.clientWidth || 800;
    const h = this.root.clientHeight || 600;
    return computeViewport({
      columnLayout: this.columnLayout,
      rowCount: this.rowCount,
      rowHeight: this.options.rowHeight ?? this.theme.rowHeight,
      headerHeight: this.options.headerHeight ?? this.theme.headerHeight,
      containerWidth: w,
      containerHeight: h,
      scrollLeft: this.scrollLeft,
      scrollTop: this.scrollTop,
    });
  }

  private applyScroll(dx: number, dy: number): void {
    this.scrollLeft = Math.max(0, this.scrollLeft + dx);
    this.scrollTop  = Math.max(0, this.scrollTop  + dy);
    this.viewport = this.computeCurrentViewport();
    this.events.emit({ type: 'viewportChanged', firstRow: this.viewport.firstRow, lastRow: this.viewport.lastRow });
    this.paintLoop.markFullDirty();
    this.requestViewport();
  }

  private requestViewport(): void {
    if (this.viewportRequestPending) return;
    this.viewportRequestPending = true;
    const cols = this.viewport.visibleColumns.map((c) => c.colId);
    const rowStart = this.viewport.firstRow;
    const rowEnd = this.viewport.lastRow + 1;
    this.workerClient.getViewport({ rowStart, rowEnd, columns: cols, includeFlashMask: true })
      .then((chunk) => {
        this.viewportRequestPending = false;
        this.chunk = chunk;
        this.decodedTextCols.clear();
        this.paintLoop.markFullDirty();
        this.updateA11y();
      })
      .catch((err) => {
        this.viewportRequestPending = false;
        console.error('[cgrid] viewport request:', err);
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
    this.viewport = this.computeCurrentViewport();
    this.paintLoop.markFullDirty();
    this.events.emit({ type: 'columnResized', colId, width: newW });
  }

  private openEditor(rowIndex: number, colId: string): void {
    const def = this.columnDefsMap.get(colId);
    if (!def || !def.editable) return;
    const col = this.viewport.visibleColumns.find((c) => c.colId === colId);
    const row = this.viewport.visibleRows.find((r) => r.rowIndex === rowIndex);
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
