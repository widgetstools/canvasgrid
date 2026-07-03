// Cycle 19 / Task 4 — owns the cell-edit subsystem extracted from CGrid:
// the `editorContainer` DOM host, the `EditorOverlay` + `RowEditCoordinator`
// instances + the `CellEditorRegistry` they dispatch against, the capture-
// phase keydown matrix that gates F2/Enter/Tab/Escape/arrow nav, the
// editorContainer mousedown listener that flips Excel-mode 'enter' edits
// into 'edit' mode, and the `activeEdit` lifecycle state that drives the
// editor open/close pipeline + the scroll-anchor resync.
//
// CGrid is the thin consumer: `editController.openEditor(...)` /
// `editController.stopEditing(...)` for the edit primitives,
// `editController.isOpen()` for the host blur listener gate,
// `editController.syncOpenEditorPosition()` for the viewport-tick anchor,
// `editController.registerCellEditor(...)` for the public API surface,
// `editController.editorContainer` for the floating-filter overlay +
// filter popup + context menu + column-drop insertion line that all share
// the same DOM host so they stack above the canvas with one consolidated
// pointer-events gate.
//
// The seam leaves the commit-back fetch + valueParser/valueSetter pipeline
// + per-cell `cellValueChanged` / `cellEditingStopped` event composition
// inside the controller — the editor lifecycle is one unit and splitting
// the close-hook off would require dragging the worker + the column-def
// resolution + the events surface across a second boundary for no gain.
// The worker round-trip + the `applyTransaction` ride through the
// `getRowByIndex` / `applyTransaction` deps callbacks so the controller
// stays unaware of WorkerCoordinator (Task 3) directly.
//
// Generic `<TRow>` flows through so column-def callbacks (`valueParser`,
// `valueSetter`, `editable` predicate) type-check against the host's row
// shape. The runtime `as any` casts at the worker-data boundary mirror the
// pre-extraction code — the worker returns `unknown` and the user-provided
// callbacks expect TRow; the bridge stays cast-heavy because TS can't
// recover a runtime guarantee the worker hasn't made.

import type { TypedEventEmitter } from './eventEmitter';
import type { DisposableRegistry } from './disposable';
import type { ResolvedColDef } from './propertyChain';
import type { CGridEvent } from '../types';
import { EditorOverlay } from '../interaction/editorOverlay';
import { CellEditorRegistry } from '../interaction/editors/registry';
import { RowEditCoordinator, type RowEditCellSpec } from '../interaction/editors/rowEditCoordinator';
import type { CellEditorCtor } from '../interaction/editors/iCellEditor';

/** Subset of `CGridOptions` the edit subsystem reads. Passed through a
 *  closure so per-tick `setGridOption` flips light up on the next
 *  edit / keydown without re-wiring the controller. */
export interface EditOptions {
  editType?: 'fullRow';
  enableExcelEditing?: boolean;
  enterNavigatesVerticallyAfterEdit?: boolean;
  suppressStartEditOnTab?: boolean;
}

/** Minimal shape the controller reads from each visible column. Mirrors
 *  `ViewportColumn` but strips the layout-side fields the editor doesn't
 *  need so the dep stays narrow. */
export interface EditViewportColumn {
  colId: string;
  left: number;
  width: number;
}

/** Minimal shape the controller reads from each visible row. `subgrid.isData`
 *  filters header / floating-filter / footer rows out of the edit dispatch. */
export interface EditViewportRow {
  subgrid: { isData: boolean };
  localRowIndex: number;
  top: number;
  height: number;
}

export interface EditControllerDeps<TRow> {
  disposables: DisposableRegistry;
  events: TypedEventEmitter<CGridEvent>;
  /** The root host that the capture-phase keydown listener attaches to.
   *  Same element as `CGrid.root` — the editor's <input> / <select> /
   *  <textarea> has focus while editing, so the keydown matrix lives
   *  on the root to see the keys before any per-editor handler runs. */
  root: HTMLDivElement;
  /** Shared DOM host for the editor overlay, floating-filter overlay,
   *  filter popup, context menu, and column-drop insertion line. Created
   *  by CGrid early (before StatusBarHost / SideBarHost, which read from
   *  it during their construction) and handed in here so ownership of the
   *  mousedown listener + tear-down still moves. `pointer-events:none`
   *  on the host + `pointer-events:auto` on the children keeps the canvas
   *  underneath scrollable. */
  editorContainer: HTMLDivElement;

  // --- Column + row + cell read access (per-edit lookups). ----------------
  getColumnDef(colId: string): ResolvedColDef<TRow> | undefined;
  /** Cycle 21i / Phase 1 — pivot mode gate. When pivot mode is on, every
   *  cell is read-only (the visible cells are cross-tab aggregates, not
   *  source data). Optional so pre-existing test harnesses without pivot
   *  wiring keep working (treated as "not pivoting"). */
  isPivotMode?(): boolean;
  getColumnOrder(): ReadonlyArray<ResolvedColDef<TRow>>;
  getRowCount(): number;
  getVisibleColumns(): ReadonlyArray<EditViewportColumn>;
  getVisibleRows(): ReadonlyArray<EditViewportRow>;
  /** Read the cell value snapshot used as the editor's initial value +
   *  the `oldValue` carried in `cellEditingStarted` / `cellEditingStopped`
   *  / `cellValueChanged`. `null` when the cell hasn't been chunked yet. */
  getCellAt(rowIndex: number, colId: string): { value: unknown; valueFormatted: string } | null;
  /** Row id at `rowIndex` — the real string id from the worker's chunk
   *  mapping when available; upstream callers fall back to
   *  `row-${rowIndex}` only when it isn't (row outside the loaded chunk
   *  window). */
  getRowIdAt(rowIndex: number): string | null;
  /** Per-cell snapshot built from the current viewport chunk — used as
   *  the row-edit coordinator's `rowData` + as the cancel-path fallback
   *  payload for `rowEditingStopped`. */
  getRowDataSnapshotAt(rowIndex: number): Record<string, unknown>;
  /** Live canvas pixel bounds — fed to `EditorOverlay.open` so a popup
   *  editor stays inside the canvas region. */
  getCanvasBounds(): { width: number; height: number };
  /** Visibility-clipped cell bounds used by `syncOpenEditorPosition` to
   *  re-anchor an open editor; `null` when the cell scrolled out of the
   *  body's vertical band or its column's horizontal band, which is the
   *  controller's signal to commit + close the editor. */
  getVisibleCellBounds(rowIndex: number, colId: string):
    { x: number; y: number; w: number; h: number } | null;

  // --- Selection bridge. ---------------------------------------------------
  /** Drive focus to follow the editor at open time — WITHOUT collapsing
   *  the active cell-selection range. Called by `openEditor` /
   *  `openRowEdit` because those paths can be triggered by a mouse
   *  gesture whose trailing click fires immediately after a drag: the
   *  drag has already installed a multi-cell range that the following
   *  focus move must not clobber. Cycle 9 patch parity: mouse-driven
   *  focus moves keep multi-cell ranges alive; only keyboard nav
   *  collapses (see `setFocusAndCollapseRanges` below). */
  setFocus(rowIndex: number, colId: string): void;
  /** Move focus AND collapse `selection.ranges` to a 1×1 at
   *  (rowIndex, colId), in a single emit. Called by the keydown matrix's
   *  Enter-nav / Tab-nav / Excel-arrow commit-and-move flows so the
   *  focus ring + range overlay always paint at the same cell. Wiring
   *  the plain non-collapsing `setFocus` here leaked the pre-edit range
   *  through, producing the "two focused cells at once" regression the
   *  PR #21 (`e81c76d`) invariant originally closed. */
  setFocusAndCollapseRanges(rowIndex: number, colId: string): void;
  /** Snapshot of `{ focusedRowIndex, focusedColId }` for the keydown matrix's
   *  Enter / Tab / Excel-arrow flows. The originals reach into
   *  `selection.state` directly; this surface keeps the controller from
   *  knowing about `SelectionModel`. */
  getFocus(): { rowIndex: number | null; colId: string | null };
  /** Return focus to the canvas so arrow-keys / Tab resume cell navigation
   *  immediately after the editor closes. */
  focusCanvas(): void;

  // --- Worker round-trip for commit-back. ----------------------------------
  /** Fetch the canonical row from the worker so the commit pipeline runs
   *  against the authoritative row data (the chunk snapshot is best-effort).
   *  Resolved `data: null` means the row was removed mid-edit; the controller
   *  emits `rowEditingStopped` with an empty payload and skips the
   *  transaction in that case. */
  getRowByIndex(rowIndex: number):
    Promise<{ rowId: string | null; data: unknown | null }>;
  /** Ship the committed row back through the worker so filter / sort / agg
   *  re-run against the new value. Synchronous transaction (async:false) so
   *  the visible state catches up on the next viewport tick. */
  applyTransaction(payload: {
    update: unknown[]; async: false;
  }): Promise<unknown>;

  isDestroyed(): boolean;
}

export class EditController<TRow = unknown> {
  /** DOM host shared with floating-filter overlay, filter popup, context
   *  menu, and the column-drop insertion line. Created by CGrid at
   *  construction step 1 (before StatusBarHost / SideBarHost consume it)
   *  and handed into the controller at step 9; the controller owns the
   *  mousedown listener + the tear-down hook. */
  readonly editorContainer: HTMLDivElement;

  private readonly registry: CellEditorRegistry;
  private readonly editor: EditorOverlay;
  private readonly rowEdit: RowEditCoordinator;

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

  constructor(
    private readonly deps: EditControllerDeps<TRow>,
    private readonly getOptions: () => EditOptions,
  ) {
    // editorContainer is created + appended to `root` by CGrid before this
    // controller comes online (StatusBarHost / SideBarHost consume it
    // during their own construction, which runs upstream). Ownership of
    // the mousedown listener + the editor / rowEdit teardown hook still
    // moves here.
    this.editorContainer = this.deps.editorContainer;

    this.registry = new CellEditorRegistry();
    CellEditorRegistry.seed(this.registry);
    this.editor = new EditorOverlay(this.editorContainer, this.registry);
    this.rowEdit = new RowEditCoordinator(this.editorContainer, this.registry);

    this.installKeydownMatrix();
    this.installExcelModeMousedownFlip();
    // Cleanup hook: tear down both editor surfaces on dispose so a late
    // close() can't paint into a torn-down container. DisposableRegistry
    // runs disposers in LIFO so this fires before the listeners above
    // unwire — matches the destroy-time `editor.close()` / `rowEdit.close()`
    // sequence the pre-extraction CGrid.destroy() ran inline.
    this.deps.disposables.add(() => {
      this.editor.close();
      this.rowEdit.close();
    });
  }

  // ── Public read surface ───────────────────────────────────────────────────

  /** True when either the single-cell overlay or the full-row coordinator
   *  has an editor mounted. The single `isOpen()` exposed to consumers
   *  routes the host blur listener + the `featureChain.isEditing` gate so
   *  full-row mode behaves identically to single-cell from the consumer POV. */
  isOpen(): boolean {
    return this.editor.isOpen() || this.rowEdit.isOpen();
  }

  /** Surface exposed by `CGridApi.getCellEditorInstances` (later cycle) +
   *  the debug flows that reach into the underlying registry. */
  getCellEditorRegistry(): CellEditorRegistry { return this.registry; }

  // ── Imperative surface ────────────────────────────────────────────────────

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
    if (this.isOpen()) return;
    // Full-row dispatch: every editable column in the row opens an editor
    // simultaneously; the coordinator runs the lifecycle and the
    // openRowEditor helper wires events + commit-back. charPress / mode
    // are single-cell concerns (type-to-edit, Excel arrow-commit) and
    // don't apply in full-row.
    if (this.getOptions().editType === 'fullRow') {
      this.openRowEditor(rowIndex, colId);
      return;
    }
    const def = this.deps.getColumnDef(colId);
    if (!def || !this.isCellEditable(rowIndex, colId)) return;
    const col = this.deps.getVisibleColumns().find((c) => c.colId === colId);
    const row = this.deps.getVisibleRows().find(
      (r) => r.subgrid.isData && r.localRowIndex === rowIndex,
    );
    if (!col || !row) return;
    // Selection follows the editor — without this, closing the editor leaves
    // focus on whatever cell was previously selected, so subsequent arrow-key
    // navigation jumps from the wrong origin.
    this.deps.setFocus(rowIndex, colId);
    const cell = this.deps.getCellAt(rowIndex, colId);
    const initialValue = cell?.value ?? '';
    const editorName = this.resolveEditorName(def);
    const rowId = this.deps.getRowIdAt(rowIndex) ?? `row-${rowIndex}`;
    // Snapshot the active-edit so the close hook (commit OR cancel) can
    // compose the `cellEditingStopped` payload without re-fetching state.
    this.activeEdit = {
      rowIndex, rowId, colId,
      oldValue: initialValue,
      data: cell?.value !== undefined ? { [colId]: cell.value } : null,
      mode,
    };
    const canvasBounds = this.deps.getCanvasBounds();
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
      viewportBounds: { width: canvasBounds.width, height: canvasBounds.height },
      onCommit: (newValue) => {
        // Return focus to the canvas so arrow keys / Tab resume cell
        // navigation immediately after the editor closes. Without this the
        // user has to mouse-click a cell before the keyboard re-engages.
        this.deps.focusCanvas();
        // Fetch the full row from the worker, run valueParser → valueSetter
        // (or the default field assignment), emit cellValueChanged with the
        // real rowId + old/new values, then enqueue the update so the worker
        // re-runs filter / sort / agg against the new value.
        this.deps.getRowByIndex(rowIndex).then((fetched) => {
          if (this.deps.isDestroyed() || !fetched.rowId || fetched.data == null) return;
          const rowData = fetched.data as Record<string, unknown>;
          const field = def.field as string | undefined;
          const oldValue = field !== undefined ? rowData[field] : undefined;
          const parsed = def.valueParser
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? def.valueParser({ newValue, oldValue, data: rowData as any, colDef: def as any })
            : newValue;
          if (def.valueSetter) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            def.valueSetter({ data: rowData as any, newValue: parsed, oldValue, colDef: def as any });
          } else if (field !== undefined) {
            rowData[field] = parsed;
          }
          const changed = parsed !== oldValue;
          this.deps.events.emit({
            type: 'cellValueChanged',
            rowId: fetched.rowId, colId, oldValue, newValue: parsed,
            newRawValue: newValue, source: 'edit', rowIndex, data: rowData,
          });
          this.deps.events.emit({
            type: 'cellEditingStopped',
            rowIndex, rowId: fetched.rowId, colId,
            oldValue, newValue: parsed, valueChanged: changed,
            data: rowData,
          });
          this.activeEdit = null;
          this.deps.applyTransaction({ update: [rowData], async: false })
            .catch((err) => { if (!this.deps.isDestroyed()) console.error('[cgrid] commit-back:', err); });
        }).catch((err) => { if (!this.deps.isDestroyed()) console.error('[cgrid] commit-back fetch:', err); });
      },
      onCancel: () => {
        // Mirrors onCommit — restore canvas focus so the keyboard nav layer
        // keeps responding without a mouse click.
        this.deps.focusCanvas();
        const e = this.activeEdit;
        this.activeEdit = null;
        if (!e) return;
        this.deps.events.emit({
          type: 'cellEditingStopped',
          rowIndex: e.rowIndex, rowId: e.rowId, colId: e.colId,
          oldValue: e.oldValue, newValue: e.oldValue, valueChanged: false,
          data: e.data,
        });
      },
    });
    // cellEditingStarted fires AFTER the editor has mounted (matches catalog
    // 06: "A cell editor is activated"). The DOM is live, focus is set.
    this.deps.events.emit({
      type: 'cellEditingStarted',
      rowIndex, rowId, colId,
      value: initialValue,
      data: this.activeEdit?.data,
    });
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

  /** Walk the visible-column order to find the next editable cell from
   *  `(fromRow, fromCol)`. `'forward'` increments by column, wrapping to
   *  the next row's first column at the right edge; `'backward'`
   *  mirrors. Returns `null` when no further editable cell exists. */
  nextEditableCell(
    fromRow: number,
    fromCol: string,
    direction: 'forward' | 'backward',
  ): { rowIndex: number; colId: string } | null {
    const cols = this.deps.getColumnOrder().map((c) => c.colId);
    const rowCount = this.deps.getRowCount();
    if (cols.length === 0 || rowCount === 0) return null;
    const startCi = cols.indexOf(fromCol);
    if (startCi < 0) return null;
    const step = direction === 'forward' ? 1 : -1;
    let row = fromRow;
    let ci = startCi + step;
    const maxIter = cols.length * Math.max(1, rowCount);
    for (let i = 0; i < maxIter; i++) {
      if (ci >= cols.length) {
        ci = 0;
        row += 1;
      } else if (ci < 0) {
        ci = cols.length - 1;
        row -= 1;
      }
      if (row < 0 || row >= rowCount) return null;
      const candidate = cols[ci]!;
      if (this.isCellEditable(row, candidate)) {
        return { rowIndex: row, colId: candidate };
      }
      ci += step;
    }
    return null;
  }

  /** Resolve the editable predicate for the cell at `(rowIndex, colId)`.
   *  Static booleans flow through directly; callbacks receive the cell's
   *  current `{ data, colId, rowIndex, value }`. Returns `false` for
   *  unknown columns. */
  isCellEditable(rowIndex: number, colId: string): boolean {
    // Cycle 21i / Phase 1 — pivot mode is read-only: visible cells are
    // cross-tab aggregates, not editable source data.
    if (this.deps.isPivotMode?.() === true) return false;
    const def = this.deps.getColumnDef(colId);
    if (!def) return false;
    const e = def.editable;
    if (typeof e === 'boolean') return e;
    if (typeof e === 'function') {
      const data = this.deps.getRowDataSnapshotAt(rowIndex);
      const value = this.deps.getCellAt(rowIndex, colId)?.value;
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
  syncOpenEditorPosition(): void {
    if (!this.activeEdit) return;
    if (!this.editor.isOpen()) return;
    const { rowIndex, colId } = this.activeEdit;
    const bounds = this.deps.getVisibleCellBounds(rowIndex, colId);
    if (!bounds) {
      this.editor.commit();
      return;
    }
    this.editor.reposition(bounds);
  }

  /** Register a custom cell editor. Columns with `cellEditor: name`
   *  dispatch to `ctor` when edit starts. Built-in names ('text') can be
   *  overridden by re-registering. */
  registerCellEditor(name: string, ctor: CellEditorCtor): void {
    this.registry.register(name, ctor);
  }

  // ── Private ───────────────────────────────────────────────────────────────

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
      if (!this.registry.has(synthetic)) {
        this.registry.register(synthetic, e);
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
    const row = this.deps.getVisibleRows().find(
      (r) => r.subgrid.isData && r.localRowIndex === rowIndex,
    );
    if (!row) return;
    const specs: RowEditCellSpec[] = [];
    for (const col of this.deps.getVisibleColumns()) {
      if (!this.isCellEditable(rowIndex, col.colId)) continue;
      const def = this.deps.getColumnDef(col.colId);
      if (!def) continue;
      const cell = this.deps.getCellAt(rowIndex, col.colId);
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
    const rowId = this.deps.getRowIdAt(rowIndex) ?? `row-${rowIndex}`;
    const snapshot = this.deps.getRowDataSnapshotAt(rowIndex);
    // Selection mirrors the active editor — without this, Esc + arrow nav
    // resume from the previous focused cell instead of the row being edited.
    this.deps.setFocus(rowIndex, initialColId);
    this.rowEdit.open({
      rowIndex,
      rowId,
      rowData: snapshot,
      cells: specs,
      initialColId,
      onCommit: (commits) => this.handleRowCommit(rowIndex, rowId, commits),
      onCancel: () => this.handleRowCancel(rowIndex, rowId, snapshot),
    });
    this.deps.events.emit({
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
    this.deps.focusCanvas();
    this.deps.getRowByIndex(rowIndex).then((fetched) => {
      if (this.deps.isDestroyed()) return;
      const resolvedId = fetched.rowId ?? rowId;
      if (fetched.data == null) {
        // Row is no longer addressable (transaction removed it mid-edit).
        // Emit the stopped event so listeners still close their UI state.
        this.deps.events.emit({ type: 'rowEditingStopped', rowIndex, rowId: resolvedId, data: {} });
        return;
      }
      const rowData = fetched.data as Record<string, unknown>;
      let anyChanged = false;
      for (const commit of commits) {
        const def = this.deps.getColumnDef(commit.colId);
        if (!def) continue;
        const field = def.field as string | undefined;
        const oldValue = field !== undefined ? rowData[field] : undefined;
        const parsed = def.valueParser
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? def.valueParser({ newValue: commit.newRawValue, oldValue, data: rowData as any, colDef: def as any })
          : commit.newRawValue;
        if (def.valueSetter) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          def.valueSetter({ data: rowData as any, newValue: parsed, oldValue, colDef: def as any });
        } else if (field !== undefined) {
          rowData[field] = parsed;
        }
        const changed = parsed !== oldValue;
        if (changed) anyChanged = true;
        this.deps.events.emit({
          type: 'cellValueChanged',
          rowId: resolvedId, colId: commit.colId, oldValue, newValue: parsed,
          newRawValue: commit.newRawValue, source: 'edit', rowIndex, data: rowData,
        });
      }
      this.deps.events.emit({ type: 'rowEditingStopped', rowIndex, rowId: resolvedId, data: rowData });
      if (anyChanged) {
        this.deps.events.emit({ type: 'rowValueChanged', rowIndex, rowId: resolvedId, data: rowData });
        this.deps.applyTransaction({ update: [rowData], async: false })
          .catch((err) => { if (!this.deps.isDestroyed()) console.error('[cgrid] row commit-back:', err); });
      }
    }).catch((err) => { if (!this.deps.isDestroyed()) console.error('[cgrid] row commit-back fetch:', err); });
  }

  /** Cycle 5 / Task 10 — full-row cancel. No worker round-trip; emit
   *  `rowEditingStopped` with the best-effort snapshot we already had. */
  private handleRowCancel(rowIndex: number, rowId: string, snapshot: unknown): void {
    this.deps.focusCanvas();
    this.deps.events.emit({ type: 'rowEditingStopped', rowIndex, rowId, data: snapshot });
  }

  /** Capture-phase keydown matrix gating F2 / Enter / Tab / Escape / arrow
   *  nav / Excel-mode arrow commits. Registered on the root so the editor's
   *  <input>/<select>/<textarea> can't swallow these keys before the matrix
   *  runs — the per-editor Enter/Esc handlers see the key only when we
   *  don't `stopPropagation` here. Routed through `disposables` so the
   *  listener leaves with the controller.
   *
   *  Full-row edit (Cycle 5 / Task 10) — keys are scoped to the row's
   *  editor bundle: Tab cycles within the row, Enter commits all, Esc
   *  cancels all. Single-cell key flow is bypassed in that mode. */
  private installKeydownMatrix(): void {
    this.deps.disposables.addListener(this.deps.root, 'keydown', ((raw: Event) => {
      const ev = raw as KeyboardEvent;
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
          if (newCol != null && newRow != null) this.deps.setFocusAndCollapseRanges(newRow, newCol);
          return;
        }
        return;
      }
      if (!this.editor.isOpen()) return;
      const opts = this.getOptions();
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.stopEditing(true);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        const { rowIndex: fr, colId: fc } = this.deps.getFocus();
        this.stopEditing(false);
        if (opts.enterNavigatesVerticallyAfterEdit && fr != null && fc != null) {
          const dir = ev.shiftKey ? -1 : 1;
          const rowCount = this.deps.getRowCount();
          this.deps.setFocusAndCollapseRanges(
            Math.max(0, Math.min(Math.max(0, rowCount - 1), fr + dir)),
            fc,
          );
        }
        return;
      }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        ev.stopPropagation();
        const { rowIndex: fr, colId: fc } = this.deps.getFocus();
        this.stopEditing(false);
        if (fr != null && fc != null) {
          const dir = ev.shiftKey ? 'backward' : 'forward';
          const next = this.nextEditableCell(fr, fc, dir);
          if (next) {
            this.deps.setFocusAndCollapseRanges(next.rowIndex, next.colId);
            if (!opts.suppressStartEditOnTab) {
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
        opts.enableExcelEditing
        && this.activeEdit?.mode === 'enter'
        && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp'
            || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        const { rowIndex: fr, colId: fc } = this.deps.getFocus();
        this.stopEditing(false);
        if (fr == null || fc == null) return;
        const cols = this.deps.getColumnOrder().map((c) => c.colId);
        const rowCount = this.deps.getRowCount();
        const ci = cols.indexOf(fc);
        if (ev.key === 'ArrowDown') {
          this.deps.setFocusAndCollapseRanges(Math.min(rowCount - 1, fr + 1), fc);
        } else if (ev.key === 'ArrowUp') {
          this.deps.setFocusAndCollapseRanges(Math.max(0, fr - 1), fc);
        } else if (ev.key === 'ArrowRight' && ci >= 0) {
          this.deps.setFocusAndCollapseRanges(fr, cols[Math.min(cols.length - 1, ci + 1)]!);
        } else if (ev.key === 'ArrowLeft' && ci >= 0) {
          this.deps.setFocusAndCollapseRanges(fr, cols[Math.max(0, ci - 1)]!);
        }
      }
    }) as EventListener, true);
  }

  /** Excel-mode mousedown flip — a click inside the open editor switches a
   *  type-started 'enter' edit into 'edit' mode so the user can move the
   *  caret with the arrow keys instead of accidentally committing. */
  private installExcelModeMousedownFlip(): void {
    this.deps.disposables.addListener(this.editorContainer, 'mousedown', () => {
      if (this.activeEdit?.mode === 'enter') {
        this.activeEdit.mode = 'edit';
      }
    });
  }
}
