/**
 * Cycle 18 / Task 6 — PivotPanelHost.
 *
 * Mounts a horizontal DOM strip ABOVE the column header row (and
 * ABOVE the row group panel when both are present — pivot wraps the
 * row dimension). Renders one pill per `pivotColumns[i]` (in pivot-
 * group nesting order) plus a `›` separator between adjacent pills.
 * When `pivotColumns.length === 0` and `pivotPanelShow === 'always'`
 * the strip shows a dashed empty-state placeholder ("Drag here to set
 * column labels" — verbatim from the columns tool panel's plz zone
 * for vocabulary continuity).
 *
 * Structurally this mirrors `RowGroupPanelHost`: a thin context
 * object (`PivotPanelGridContext`) lets the host report its reserved
 * top inset back to the grid + dispatch the primitive pivot API
 * (`addPivotColumn`, `removePivotColumn`, `movePivotColumn`) without
 * importing `VelocityGrid` directly. The grid's `setHostBounds({ top })`
 * channel adjusts to the reservation so the scroller + editor overlay
 * + canvas all shrink to make room.
 *
 * Pill chrome REUSES the Task 5 shared `.vg-columns-panel-pill*`
 * classes from `tokens.css` so the visual idiom across the top-of-grid
 * panel and the sidebar plz zone stays byte-identical.
 *
 * Two visibility modes differ from the row group panel:
 *   - `'always'` mirrors `'always'` exactly.
 *   - `'onlyWhenPivoting'` RESERVES height at construction (so a later
 *     `setPivotMode(true)` doesn't trigger a layout reflow) but PAINT-
 *     SUPPRESSES the strip content (pills + empty placeholder) while
 *     `isPivotActive()` is false. The grid calls `setPivotActive()`
 *     when subscribing to `pivotStateChanged` so the suppression
 *     flips on every mode change.
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-18-pivoting-design.md (Task 7
 *   "Pivot panel in side bar" generalizes to the top-of-grid panel)
 *   + AG-Grid parity Prompt 6.
 */

import type { PivotPanelShow, PivotPanelDropVerdict } from './types';
import { copyResolvedChipStyles } from '../chipGhostStyles';

/** Verbatim from `interaction/toolPanels/columnsPanel.ts`'s plz zone.
 *  ONE drop-zone vocabulary across the grid. */
const EMPTY_PLACEHOLDER = 'Drag here to set column labels';

/** Drag-handle glyph for the pill — empty string because the handle
 *  is rendered entirely via CSS dot-grid (`.vg-columns-panel-pill-
 *  handle` background-image, shared with Task 5 plz pills). */
const DRAG_HANDLE_GLYPH = '';

/** Remove glyph (U+2715) — same as the Task 5 pill chrome. */
const REMOVE_GLYPH = '✕';

/** Between-pill separator (U+203A). Inherits Task 4's chevron color
 *  token so the chevron family stays consistent across the cycle. */
const SEPARATOR_GLYPH = '›';

/** Drag-commit threshold in CSS px. Pointer movement below this in
 *  any direction is treated as a click candidate, so the user can
 *  click `×` inside a pill without inadvertently starting a reorder
 *  gesture. Matches Cycle 6's column drag threshold + Cycle 15.5 /
 *  Task 1's pill-reorder threshold. */
const DRAG_THRESHOLD_PX = 4;

/** Pointer offset for the floating ghost relative to the cursor. */
const GHOST_OFFSET_X = 0;
// Matches the row-group panel's ghost offset (-11) so the dragged
// pill sits at the same cursor-relative position in both panels.
// Tied to the 22px row-group chip height (≈ -chipHeight / 2).
const GHOST_OFFSET_Y = -11;

/** Context handed to PivotPanelHost by VelocityGrid (or a test harness).
 *  Keeps the host framework-agnostic — it can mutate PivotState +
 *  report its reserved inset back without importing VelocityGrid directly. */
export interface PivotPanelGridContext {
  /** Called on mount / unmount / show-mode change. `height === 0`
   *  means the panel is hidden — the grid releases the reservation. */
  setReservedSpace(side: 'top', height: number): void;
  /** Resolve a colId to its current header name. Used to label pills.
   *  Returns `undefined` for unknown ids; the host falls back to the
   *  raw colId. */
  getHeaderName(colId: string): string | undefined;
  /** True when the column has `enablePivot: true`. Read at drop time
   *  so a runtime `setGridOption('columnDefs', …)` flips the drop
   *  verdict on the next gesture without re-wiring the host. */
  isColumnPivotEnabled(colId: string): boolean;
  /** Append `colId` to the grid's `pivotColumns` via PivotState. */
  addPivotColumn(colId: string): void;
  /** Remove `colId` from the grid's `pivotColumns` via PivotState. */
  removePivotColumn(colId: string): void;
  /** Move the column at `from` to `to`. Called by pill-reorder drag
   *  on `pointerup` when the drop lands inside the panel. */
  movePivotColumn(from: number, to: number): void;
  /** True when `PivotState.isPivotActive()` is true. Used by
   *  `'onlyWhenPivoting'` mode to decide whether to paint strip
   *  content. The grid keeps this fresh by calling `setPivotActive`
   *  from its `pivotStateChanged` handler. */
  isPivotActive(): boolean;
  /** Cross-section pill drag — try routing a pivot pill to a foreign
   *  panel (Row Group panel, Values zone, etc.). Returns `true` when
   *  the column was successfully moved; `false` when no foreign panel
   *  was hit OR the target rejected. */
  tryCrossPanelMove?(colId: string, clientX: number, clientY: number): boolean;
}

/** Internal drag-state machine. `null` when no gesture is in flight. */
type DragState =
  | { kind: 'press'; colId: string; fromIndex: number; downX: number; downY: number; pillEl: HTMLElement; pointerId: number }
  | { kind: 'drag'; colId: string; fromIndex: number; pillEl: HTMLElement; pointerId: number };

export class PivotPanelHost {
  private readonly root: HTMLElement;
  /** The host element (`.vg-pivot-panel`) appended to the grid root. */
  private readonly panel: HTMLDivElement;
  private readonly ctx: PivotPanelGridContext;

  private show: PivotPanelShow;
  private pivotColumns: string[] = [];
  /** Current drop-indicator state. Painted as a panel-level outline. */
  private dropVerdict: PivotPanelDropVerdict = null;
  /** Insertion-line element. Lazily created on first accepted drop
   *  hover; reused thereafter. */
  private insertionLine: HTMLDivElement | null = null;
  /** Floating drag ghost. Lazily created on the first reorder-drag
   *  threshold crossing; reused thereafter. Lives on `document.body`
   *  so its `position: fixed` is screen-relative. */
  private ghost: HTMLDivElement | null = null;
  /** Pill-reorder drag state. Survives across pointer events for
   *  the lifetime of the gesture. */
  private dragState: DragState | null = null;
  /** Bound listeners — kept as instance fields so we can remove them
   *  cleanly on `destroy`. */
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onPointerCancel: (e: PointerEvent) => void;
  private destroyed = false;

  constructor(
    root: HTMLElement,
    ctx: PivotPanelGridContext,
    show: PivotPanelShow,
    initialPivotColumns: string[],
  ) {
    this.root = root;
    this.ctx = ctx;
    this.show = show;
    this.pivotColumns = [...initialPivotColumns];

    this.panel = document.createElement('div');
    this.panel.className = 'vg-pivot-panel';
    // Cross-section pill drag routing. See `core/panelDragMove.ts`.
    this.panel.setAttribute('data-vg-pill-role', 'pivot');

    this.onPointerMove = (e) => this.handlePointerMove(e);
    this.onPointerUp = (e) => this.handlePointerUp(e);
    this.onPointerCancel = (e) => this.handlePointerCancel(e);

    this.root.appendChild(this.panel);
    this.applyVisibility();
  }

  /** Resolved panel height in CSS px when visible. Mirrors the
   *  `.vg-pivot-panel { height }` rule from `tokens.css`. Used by
   *  the grid's geometry reservation. `0` when the panel is hidden. */
  getReservedHeight(): number {
    if (!this.isVisible()) return 0;
    const measured = Math.ceil(this.panel.getBoundingClientRect().height);
    if (measured > 0) return measured;
    return 32;
  }

  /** True when the panel is mounted (height reserved + DOM present).
   *    • `'always'` — mounted unconditionally (AG-v36 parity; the
   *      cycle 18 follow-up that also gated on `isPivotMode()` was
   *      a v35 carryover that conflicted with the option's contract).
   *    • `'onlyWhenPivoting'` — mounted only while pivot is active.
   *      Per user feedback (see the unit-test contract in
   *      `pivotPanel.test.ts`), the strip is FULLY RELEASED when
   *      pivot is off — the data area reclaims the band and we
   *      accept the one-time reflow on `setPivotMode(true)` in
   *      exchange for the cleaner off-state.
   *    • `'never'` — never mounted. */
  isVisible(): boolean {
    if (this.destroyed) return false;
    if (this.show === 'never') return false;
    if (this.show === 'always') return true;
    // 'onlyWhenPivoting' — hide while pivot is inactive (AG contract).
    return this.ctx.isPivotActive();
  }

  /** Receive a fresh ordered pivot column list from PivotState.
   *  Re-renders the pill strip; reservation may flip (when the strip's
   *  height changes) so the host re-reports its reserved height. */
  setPivotColumns(pivotColumns: string[]): void {
    if (this.destroyed) return;
    this.pivotColumns = [...pivotColumns];
    this.applyVisibility();
  }

  /** Notify the host that `PivotState.isPivotActive()` may have
   *  changed. Used by `'onlyWhenPivoting'` mode to flip between
   *  painted and paint-suppressed states. No-op when the host is not
   *  in `'onlyWhenPivoting'` mode — `'always'` paints regardless and
   *  `'never'` doesn't mount.
   *
   *  Reads `ctx.isPivotActive()` rather than the passed flag so this
   *  method can also be called argument-less by the grid as a "state
   *  may have changed" tick. */
  setPivotActive(_active?: boolean): void {
    if (this.destroyed) return;
    this.applyVisibility();
  }

  /** Swap the `pivotPanelShow` mode at runtime. Mirrors the row
   *  group panel host's `setShowMode` semantics. */
  setShowMode(show: PivotPanelShow): void {
    if (this.destroyed) return;
    if (this.show === show) return;
    this.show = show;
    this.applyVisibility();
  }

  /** Resolved bounding rect for the panel in viewport coords. Used
   *  by external drag sources to hit-test mid-drag. Returns `null`
   *  when the panel is hidden. */
  getRect(): DOMRect | null {
    if (!this.isVisible()) return null;
    const rect = this.panel.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  /** True when `(clientX, clientY)` (viewport coords) falls inside
   *  the panel's bounding rect. Called by external drag sources
   *  every mousemove tick during a drag. While in
   *  `'onlyWhenPivoting'` mode with pivot inactive, the panel still
   *  has bounds but does NOT accept drops — returns `false` so the
   *  drag source falls through to the next drop target. */
  isPointInPanel(clientX: number, clientY: number): boolean {
    if (!this.acceptsDrops()) return false;
    const rect = this.getRect();
    if (!rect) return false;
    return clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }

  /** Begin a drag-hover over the panel. `colId` is the column being
   *  dragged. The host evaluates the drop verdict and paints the
   *  matching outline. */
  setDragHover(colId: string | null, clientX: number, clientY: number): void {
    if (this.destroyed) return;
    if (colId === null || !this.isPointInPanel(clientX, clientY)) {
      this.clearDragHover();
      return;
    }
    const verdict: PivotPanelDropVerdict = this.computeDropVerdict(colId);
    if (verdict !== this.dropVerdict) {
      this.dropVerdict = verdict;
      this.panel.dataset.drop = verdict ?? '';
    }
    if (verdict === 'accept') {
      this.updateInsertionLine(clientX);
    } else {
      this.hideInsertionLine();
    }
  }

  /** End any in-progress drag-hover. Clears the outline + insertion
   *  line in one call. */
  clearDragHover(): void {
    if (this.destroyed) return;
    if (this.dropVerdict !== null) {
      this.dropVerdict = null;
      delete this.panel.dataset.drop;
    }
    this.hideInsertionLine();
  }

  /** Commit a drop. Returns `true` when the column was appended to
   *  `pivotColumns`, `false` when the drop was rejected. */
  handleColumnDrop(colId: string): boolean {
    if (this.destroyed) return false;
    this.clearDragHover();
    if (!this.acceptsDrops()) return false;
    if (this.computeDropVerdict(colId) !== 'accept') return false;
    this.ctx.addPivotColumn(colId);
    return true;
  }

  /** Tear down: removes the panel DOM. Safe to call multiple times. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelDrag();
    this.ctx.setReservedSpace('top', 0);
    this.panel.parentElement?.removeChild(this.panel);
  }

  // ---- internals ----------------------------------------------------

  /** True when the panel accepts external drops (column-header drags
   *  + tool-panel column-row drags). 'always' always accepts;
   *  'onlyWhenPivoting' accepts only when pivot is active. */
  private acceptsDrops(): boolean {
    if (this.show === 'always') return true;
    if (this.show === 'onlyWhenPivoting') return this.ctx.isPivotActive();
    return false;
  }

  /** Decide whether the strip's CONTENT (pills + empty placeholder)
   *  should paint right now. 'always' always paints; 'onlyWhenPivoting'
   *  paints when (a) pivot is active OR (b) the pill strip is non-
   *  empty — pre-configured but mode-off should still display the
   *  retained pills so the user can see what's set. */
  private shouldPaintContent(): boolean {
    if (this.show === 'always') return true;
    if (this.show === 'onlyWhenPivoting') {
      return this.ctx.isPivotActive() || this.pivotColumns.length > 0;
    }
    return false;
  }

  /** Decide whether the strip is visible (mounted + space reserved)
   *  and paint the matching DOM. The strip is always present (with
   *  reserved height) for 'always' and 'onlyWhenPivoting'; only the
   *  content is paint-suppressed in 'onlyWhenPivoting' + inactive. */
  private applyVisibility(): void {
    if (this.destroyed) return;
    const visible = this.isVisible();
    this.panel.style.display = visible ? '' : 'none';
    this.panel.dataset.show = this.show;
    this.panel.dataset.active = this.ctx.isPivotActive() ? 'true' : 'false';
    if (visible) {
      if (this.shouldPaintContent()) {
        this.renderContents();
      } else {
        this.panel.replaceChildren();
      }
    } else {
      this.panel.replaceChildren();
    }
    this.ctx.setReservedSpace('top', this.getReservedHeight());
  }

  /** Build the pill strip (or empty-state placeholder) and replace
   *  the panel's children in one pass. */
  private renderContents(): void {
    this.panel.replaceChildren();
    if (this.pivotColumns.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vg-pivot-panel-empty';
      empty.textContent = EMPTY_PLACEHOLDER;
      this.panel.appendChild(empty);
      return;
    }
    for (let i = 0; i < this.pivotColumns.length; i++) {
      const colId = this.pivotColumns[i]!;
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'vg-pivot-panel-separator';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = SEPARATOR_GLYPH;
        this.panel.appendChild(sep);
      }
      this.panel.appendChild(this.buildPill(colId, i));
    }
  }

  /** Build one pill: drag-handle + label + `×` remove. Wears the
   *  row-group panel's chip classes so the top-of-grid pivot strip
   *  and row-group strip share one visual vocabulary (compact 22px,
   *  fully-rounded ends). The pivot-scoped `.vg-pivot-panel-pill*`
   *  classes are kept for JS targeting + per-panel hooks. */
  private buildPill(colId: string, index: number): HTMLDivElement {
    const pill = document.createElement('div');
    pill.className = 'vg-pivot-panel-pill vg-row-group-panel-chip';
    pill.dataset.colId = colId;
    pill.dataset.index = String(index);
    pill.setAttribute('role', 'button');
    pill.setAttribute(
      'aria-label',
      `${this.ctx.getHeaderName(colId) ?? colId} pivot level ${index + 1}`,
    );
    pill.tabIndex = 0;

    const handle = document.createElement('span');
    handle.className = 'vg-pivot-panel-pill-handle vg-row-group-panel-chip-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = DRAG_HANDLE_GLYPH;
    pill.appendChild(handle);

    const label = document.createElement('span');
    label.className = 'vg-pivot-panel-pill-label vg-row-group-panel-chip-label';
    label.textContent = this.ctx.getHeaderName(colId) ?? colId;
    pill.appendChild(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'vg-pivot-panel-pill-remove vg-row-group-panel-chip-remove';
    remove.setAttribute(
      'aria-label',
      `Remove ${this.ctx.getHeaderName(colId) ?? colId} from column labels`,
    );
    remove.textContent = REMOVE_GLYPH;
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.removePivotColumn(colId);
    });
    remove.addEventListener('pointerdown', (e) => e.stopPropagation());
    pill.appendChild(remove);

    // Pill-reorder drag (within-panel reorder + drag-out remove).
    pill.addEventListener('pointerdown', (e) => this.handlePointerDown(e, colId, index, pill));
    pill.addEventListener('keydown', (e) => this.handlePillKeydown(e, colId, index));

    return pill;
  }

  /** Return `'accept'` when `colId` is droppable into the panel.
   *  Rejects when the column lacks `enablePivot` or is already
   *  pivoted. */
  private computeDropVerdict(colId: string): PivotPanelDropVerdict {
    if (this.pivotColumns.includes(colId)) return 'reject';
    if (!this.ctx.isColumnPivotEnabled(colId)) return 'reject';
    return 'accept';
  }

  /** Position the vertical insertion line at the pill-gap nearest
   *  to `clientX`. Lazily creates the element on first use. Returns
   *  the gap INDEX (0..pivotColumns.length). */
  private updateInsertionLine(clientX: number): number {
    if (this.destroyed) return 0;
    if (!this.insertionLine) {
      this.insertionLine = document.createElement('div');
      this.insertionLine.className = 'vg-pivot-panel-insertion-line';
      this.panel.appendChild(this.insertionLine);
    }
    this.insertionLine.style.display = '';

    const panelRect = this.panel.getBoundingClientRect();
    const pills = Array.from(
      this.panel.querySelectorAll('.vg-pivot-panel-pill'),
    ) as HTMLElement[];
    if (pills.length === 0) {
      const x = (panelRect.width - 2) / 2;
      this.insertionLine.style.left = `${x}px`;
      return 0;
    }
    const candidates: Array<{ slotIndex: number; centerX: number; panelLeftX: number }> = [];
    const firstRect = pills[0]!.getBoundingClientRect();
    candidates.push({
      slotIndex: 0,
      centerX: firstRect.left - 3,
      panelLeftX: firstRect.left - panelRect.left - 3,
    });
    for (let i = 1; i < pills.length; i++) {
      const left = pills[i - 1]!.getBoundingClientRect().right;
      const right = pills[i]!.getBoundingClientRect().left;
      const center = (left + right) / 2;
      candidates.push({
        slotIndex: i,
        centerX: center,
        panelLeftX: center - panelRect.left - 1,
      });
    }
    const lastRect = pills[pills.length - 1]!.getBoundingClientRect();
    candidates.push({
      slotIndex: pills.length,
      centerX: lastRect.right + 3,
      panelLeftX: lastRect.right - panelRect.left + 1,
    });
    let best = candidates[0]!;
    let bestDist = Math.abs(clientX - best.centerX);
    for (let i = 1; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      const dist = Math.abs(clientX - candidate.centerX);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    this.insertionLine.style.left = `${Math.max(0, best.panelLeftX)}px`;
    return best.slotIndex;
  }

  private hideInsertionLine(): void {
    if (this.insertionLine) this.insertionLine.style.display = 'none';
  }

  // ---- pill reorder drag -------------------------------------------

  private handlePointerDown(
    e: PointerEvent,
    colId: string,
    index: number,
    pillEl: HTMLElement,
  ): void {
    if (this.destroyed) return;
    if (e.button !== 0) return;
    this.cancelDrag();
    this.dragState = {
      kind: 'press',
      colId,
      fromIndex: index,
      downX: e.clientX,
      downY: e.clientY,
      pillEl,
      pointerId: e.pointerId,
    };
    try {
      pillEl.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture throws on browsers that don't track this
      // pointer id (rare); swallow.
    }
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.destroyed || this.dragState === null) return;
    if (e.pointerId !== this.dragState.pointerId) return;
    const state = this.dragState;
    if (state.kind === 'press') {
      const dx = e.clientX - state.downX;
      const dy = e.clientY - state.downY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      this.dragState = {
        kind: 'drag',
        colId: state.colId,
        fromIndex: state.fromIndex,
        pillEl: state.pillEl,
        pointerId: state.pointerId,
      };
      this.mountGhost(state.pillEl, e.clientX, e.clientY);
    }
    this.positionGhost(e.clientX, e.clientY);
    if (this.isPointInPanel(e.clientX, e.clientY)) {
      // Within-panel reorder is always 'accept' — the column already
      // lives in `pivotColumns`.
      if (this.dropVerdict !== 'accept') {
        this.dropVerdict = 'accept';
        this.panel.dataset.drop = 'accept';
      }
      this.updateInsertionLine(e.clientX);
    } else {
      this.clearDragHover();
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.destroyed || this.dragState === null) return;
    if (e.pointerId !== this.dragState.pointerId) return;
    const state = this.dragState;
    if (state.kind === 'drag') {
      if (this.isPointInPanel(e.clientX, e.clientY)) {
        const targetSlot = this.updateInsertionLine(e.clientX);
        this.ctx.movePivotColumn(state.fromIndex, targetSlot);
      } else {
        // Drag-out: first try routing to a foreign pill panel
        // (Row Group panel, side-panel Values zone, etc.). If the
        // route commits, the column is now in the new role; the
        // pivot panel rebuild happens through `pivotStateChanged`.
        // Otherwise fall back to the existing remove-on-drag-out
        // behavior so the user can still drag a pill into empty
        // space to clear its pivot role.
        const moved = this.ctx.tryCrossPanelMove?.(state.colId, e.clientX, e.clientY) ?? false;
        if (!moved) this.ctx.removePivotColumn(state.colId);
      }
    }
    this.cancelDrag();
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (this.destroyed || this.dragState === null) return;
    if (e.pointerId !== this.dragState.pointerId) return;
    this.cancelDrag();
  }

  private cancelDrag(): void {
    const state = this.dragState;
    if (state !== null) {
      try {
        state.pillEl.releasePointerCapture(state.pointerId);
      } catch {
        // pointer was never captured (rare browser path); swallow.
      }
    }
    this.dragState = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.clearDragHover();
    this.unmountGhost();
  }

  // ---- drag ghost --------------------------------------------------

  private mountGhost(sourcePill: HTMLElement, clientX: number, clientY: number): void {
    if (this.destroyed) return;
    if (this.ghost) this.unmountGhost();
    const ghost = sourcePill.cloneNode(true) as HTMLDivElement;
    // Inherits the row-group chip's ghost styling (opaque bg, soft
    // shadow, fixed positioning, top-most z-index) so dragging a pill
    // in either panel produces an identical floating ghost.
    ghost.classList.add('vg-pivot-panel-pill-ghost', 'vg-row-group-panel-chip-ghost');
    ghost.removeAttribute('data-col-id');
    ghost.removeAttribute('data-index');
    ghost.setAttribute('aria-hidden', 'true');
    // The chip CSS uses panel-scoped variables which DO NOT resolve
    // on document.body. Snapshot resolved computed styles from the
    // source pill into inline declarations so the ghost renders
    // correctly outside the panel scope.
    copyResolvedChipStyles(sourcePill, ghost);
    const rect = sourcePill.getBoundingClientRect();
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    this.ghost = ghost;
    this.positionGhost(clientX, clientY);
  }

  private positionGhost(clientX: number, clientY: number): void {
    if (this.ghost === null) return;
    this.ghost.style.left = `${clientX + GHOST_OFFSET_X}px`;
    this.ghost.style.top = `${clientY + GHOST_OFFSET_Y}px`;
  }

  private unmountGhost(): void {
    if (this.ghost === null) return;
    this.ghost.parentElement?.removeChild(this.ghost);
    this.ghost = null;
  }

  // ---- keyboard reorder --------------------------------------------

  /** Cmd+ArrowLeft / Cmd+ArrowRight reorders the pill without a drag.
   *  Delete / Backspace removes the pill. Plain arrow keys don't
   *  reorder so keyboard users can still tab-navigate normally. */
  private handlePillKeydown(e: KeyboardEvent, colId: string, index: number): void {
    if (this.destroyed) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.ctx.removePivotColumn(colId);
      return;
    }
    const modifier = e.metaKey || e.ctrlKey;
    if (!modifier) return;
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      this.ctx.movePivotColumn(index, index - 1);
    } else if (e.key === 'ArrowRight' && index < this.pivotColumns.length - 1) {
      e.preventDefault();
      // movePivotColumn target is "insert at slot K"; moving right
      // means inserting AFTER the next pill, i.e. slot index + 2.
      this.ctx.movePivotColumn(index, index + 2);
    }
  }
}

/** Resolve `VelocityGridOptions.pivotPanelShow` (accepts only the canonical
 *  strings; default `'never'`) to a non-`'never'` value OR `null`
 *  when the panel should never mount. Apps can also pass `undefined`
 *  (default off). Returns `null` for `'never'` / undefined so the
 *  construction-time decision is a single null check. */
export function normalizePivotPanelShow(
  opt: PivotPanelShow | undefined,
): Exclude<PivotPanelShow, 'never'> | null {
  if (opt === undefined || opt === 'never') return null;
  return opt;
}
