// Feature base class — chain-of-responsibility for canvas input.
//
// Ported from hypergrid's src/features/Feature.js. Each Feature implements
// the handlers it cares about and forwards via `super.handleX(ctx)` (which
// calls `this.next?.handleX(ctx)`). A feature consumes an event by returning
// without calling super. Cursor reconciliation walks tail-first via setCursor,
// so the head feature's cursor wins when multiple are set.
//
// FeatureChain.ts builds the chain and dispatches DOM events into the head.

import type { CGridCanvas } from '../core/canvas';
import type { HitTester, Hit } from './hitTester';
import type { SelectionModel } from './selectionModel';

/** Subset of `CGridOptions` consumed by the edit-trigger and keyboard
 *  features. Pulled into the chain via `CGridLike.getEditingFlags()`. */
export interface EditingFlags {
  singleClickEdit: boolean;
  suppressClickEdit: boolean;
  enterNavigatesVertically: boolean;
  enterNavigatesVerticallyAfterEdit: boolean;
  suppressStartEditOnTab: boolean;
  enableCellEditingOnBackspace: boolean;
  enableExcelEditing: boolean;
}

/** Per-column key-event predicate signature. Mirrors
 *  `SuppressKeyboardEventCallback` in `types.ts` without dragging the full
 *  `CColDef` generic into feature code. */
export type SuppressKeyboardEventFn = (
  params: { event: KeyboardEvent; editing: boolean; data: unknown; colId: string },
) => boolean;

/** Grid surface exposed to features. Minimal by design — additions get a new
 *  method here, not a back-channel via globals. */
export interface CGridLike {
  readonly canvas: CGridCanvas;
  readonly selection: SelectionModel;
  readonly hitTester: HitTester;
  /** Data-row indices currently in the viewport (excludes header/totals). Used by PageDown/PageUp. */
  visibleRowIndices(): number[];
  /** Every column in render order (pinned-left + body + pinned-right). Used by keyboard nav. */
  allColIds(): string[];
  /** Total row count after filter/sort. */
  totalRowCount(): number;
  resizeColumn(colId: string, deltaPx: number): void;
  /** Cycle 6 / Task 5 — fire the trailing `columnResized` with
   *  `finished: true` for the last column touched in a drag-resize. The
   *  per-tick `resizeColumn` calls emit `finished: false`; this is the
   *  mouseup companion so apps that persist on `finished: true` fire
   *  once per drag. */
  finishColumnResize(colId: string): void;
  /** Cycle 6 / Task 1 — drag-reorder commit point. Resolves a legal drop
   *  index against `lockPosition` + `marryChildren` before mutating the
   *  column order. `source` distinguishes UI drag (`'uiColumnDragged'`)
   *  from the imperative API (`'api'`) for the `columnMoved` event. */
  reorderColumn(
    colId: string,
    toIndex: number,
    source: 'uiColumnDragged' | 'api',
  ): void;
  /** Cycle 6 / Task 1 — feature-side lookup for `suppressMovable` /
   *  `lockPosition`. Returns `undefined` for unknown colIds. */
  getColDef(colId: string): { suppressMovable: boolean; lockPosition: 'left' | 'right' | null } | undefined;
  /** Left edge of `colId` in the canvas's coordinate space (CSS px),
   *  or `null` when the column is not currently in the viewport. */
  columnLeftOf(colId: string): number | null;
  /** Width of `colId` in CSS px, or `null` when the column is not
   *  currently in the viewport. */
  columnWidthOf(colId: string): number | null;
  /** Cycle 6 / Task 1 — DOM mount point for the column-drag ghost +
   *  insertion line. The host is positioned over the canvas in the same
   *  coordinate system (top:0 / left:0 == canvas top-left). Children must
   *  be `pointer-events: none` so they don't steal hover/click. */
  getOverlayHost(): HTMLElement;
  /** Cycle 6 / Task 1 — text shown on the drag ghost. Returns the column's
   *  resolved `headerName`. Returns `undefined` for unknown colIds. */
  getHeaderName(colId: string): string | undefined;
  /** Cycle 6 / Task 1 — leaf header height for ghost geometry. */
  getLeafHeaderHeight(): number;
  /** Cycle 6 / Task 1 — Y of the leaf header row's top in the canvas's
   *  coordinate space. Non-zero when column groups are present (group
   *  header rows stack above the leaf header). The drag ghost mounts at
   *  this Y so it visually replaces the leaf header instead of floating
   *  above the group header. */
  getLeafHeaderTop(): number;
  cycleSort(colId: string): void;
  toggleColumnGroup(groupId: string): void;
  scrollBy(dx: number, dy: number): void;
  emitCellClicked(rowIndex: number, colId: string, e: MouseEvent): void;
  emitCellDoubleClicked(rowIndex: number, colId: string, e: MouseEvent): void;

  // --- Editing surface (Cycle 5 / Task 4) ---
  /** Snapshot of every grid-level edit-trigger flag, with defaults applied. */
  getEditingFlags(): EditingFlags;
  /** Resolve the editable predicate for the cell — boolean OR callback. */
  isCellEditable(rowIndex: number, colId: string): boolean;
  /** Column-level override of `singleClickEdit`, or `undefined` to inherit. */
  isColSingleClickEdit(colId: string): boolean | undefined;
  /** Column-level key-event short-circuit, or `undefined` when none. */
  getColSuppressKeyboardEvent(colId: string): SuppressKeyboardEventFn | undefined;
  /** Best-effort row data for callback contexts; may be a partial when the
   *  full row hasn't been chunked back from the worker yet. */
  getRowDataAt(rowIndex: number): unknown;
  /** True when an editor is currently mounted. */
  isEditing(): boolean;
  /** Open the cell editor at `(rowIndex, colId)`. No-op when the cell is
   *  not editable or not currently in the viewport. `mode` controls
   *  Excel's Enter / Edit dichotomy (see `CGridOptions.enableExcelEditing`).
   *  Defaults to `'edit'` (arrows = caret-move). */
  openEditor(
    rowIndex: number, colId: string,
    charPress?: string,
    mode?: 'enter' | 'edit',
  ): void;
  /** Close any open editor. `cancel=true` discards; default commits. */
  stopEditing(cancel?: boolean): void;
  /** Find the next editable cell from `(rowIndex, colId)` in render order.
   *  `'forward'` walks right then wraps to the next row's first editable
   *  cell; `'backward'` mirrors. Returns `null` when the grid has no other
   *  editable cells. */
  nextEditableCell(
    rowIndex: number,
    colId: string,
    direction: 'forward' | 'backward',
  ): { rowIndex: number; colId: string } | null;
}

export interface CGridEventCtx {
  grid: CGridLike;
  hit: Hit;
  /** Canvas-local CSS-px coords. For KeyboardEvents this is {0,0}. */
  point: { x: number; y: number };
  raw: MouseEvent | KeyboardEvent | WheelEvent;
}

export abstract class Feature {
  next: Feature | null = null;
  /** Set during handleMouseMove; FeatureChain walks the chain after each move
   *  to apply the last non-null cursor. */
  cursor: string | null = null;

  /** Append a feature at the tail of the chain. Returns `this` so chains can
   *  be assembled fluently: head.append(a).append(b). */
  append(f: Feature): this {
    let cur: Feature = this;
    while (cur.next) cur = cur.next;
    cur.next = f;
    return this;
  }

  handleMouseDown(ctx: CGridEventCtx): void { this.next?.handleMouseDown(ctx); }
  handleMouseUp(ctx: CGridEventCtx): void { this.next?.handleMouseUp(ctx); }
  handleMouseMove(ctx: CGridEventCtx): void { this.next?.handleMouseMove(ctx); }
  handleMouseDrag(ctx: CGridEventCtx): void { this.next?.handleMouseDrag(ctx); }
  handleClick(ctx: CGridEventCtx): void { this.next?.handleClick(ctx); }
  handleDoubleClick(ctx: CGridEventCtx): void { this.next?.handleDoubleClick(ctx); }
  handleKeyDown(ctx: CGridEventCtx): void { this.next?.handleKeyDown(ctx); }
  handleWheel(ctx: CGridEventCtx): void { this.next?.handleWheel(ctx); }

  /** Tail-first cursor walk: recurse to the tail, then back up the stack each
   *  feature applies its own cursor if non-null. Result: head's cursor wins. */
  setCursor(grid: CGridLike): void {
    this.next?.setCursor(grid);
    if (this.cursor) grid.canvas.canvas.style.cursor = this.cursor;
  }
}
