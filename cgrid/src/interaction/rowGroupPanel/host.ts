/**
 * Cycle 15 / Task 6 + Cycle 15.5 / Task 1 — RowGroupPanelHost.
 *
 * Mounts a horizontal DOM strip ABOVE the column header row. Renders
 * one chip per `rowGroupColumns[i]` (in nesting order) plus a `›`
 * separator between adjacent chips. When `rowGroupColumns.length === 0`
 * and `rowGroupPanelShow === 'always'`, the strip shows a dashed
 * empty-state placeholder ("Drag here to set row groups" — verbatim
 * from the Cycle 11 sidebar Columns panel for vocabulary continuity).
 *
 * Cycle 15.5 / Task 1 adds:
 *   - pill drag-within-panel REORDER (mouse-down on a chip body →
 *     drag with live insertion line + floating ghost → drop → host
 *     calls `moveRowGroupColumn(from, to)`),
 *   - per-pill SORT INDICATOR (`↑` / `↓` glyph between the label and
 *     `×`; click toggles `none → asc → desc → none`),
 *   - drag GHOST (DOM overlay on `document.body` following the cursor),
 *   - LIVE INSERTION LINE extends the Task 6 column-header path; the
 *     same `updateInsertionLine` helper drives both gestures so the
 *     line snaps to the same gap algorithm regardless of drag source,
 *   - ACCEPTANCE of drag-source IDs other than a column header (the
 *     tool-panel Row Groups drop zone lands in Task 2; the panel's
 *     drop-handler is already source-agnostic, so Task 2 just calls
 *     `setDragHover` / `commitColumnDrop` with the same colId).
 *
 * The host mirrors `SideBarHost` and `StatusBarHost` in shape: a
 * thin context object (`RowGroupPanelGridContext`) lets the host
 * report its reserved top inset back to the grid + dispatch the
 * primitive grouping API (`addRowGroupColumn`, `removeRowGroupColumn`,
 * `moveRowGroupColumn`, `setRowGroupColumnSort`) without importing
 * `CGrid` directly. The grid wires its `setHostBounds({ top })`
 * channel from the reservation so the scroller + editor overlay +
 * canvas all shrink to make room.
 *
 * Drop targets are owned here too — the column-drag feature
 * (Cycle 6 / `columnDrag.ts`) extends to call
 * `host.isPointInPanel(point)` mid-drag and
 * `host.handleColumnDrop(colId, point)` on release. The host paints
 * the drop indicator (panel-level dashed outline + vertical
 * insertion line at the chip-gap mid-point) so the column-drag
 * feature only needs to delegate.
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-15-grouping-design.md
 *   § Task 6 + § Cycle 15.5 / Task 1.
 */

import type { GroupingSortEntry } from '../../core/groupingState';
import type { RowGroupPanelShow, RowGroupPanelDropVerdict } from './types';
import { copyResolvedChipStyles } from '../chipGhostStyles';

/** Verbatim from `cgrid/src/interaction/toolPanels/columnsPanel.ts`'s
 *  Row Groups section. One drop-zone vocabulary across the grid. */
const EMPTY_PLACEHOLDER = 'Drag here to set row groups';

/** Drag-handle glyph for the chip — empty string because the handle
 *  is now rendered entirely via CSS dot-grid (`.cg-row-group-panel-
 *  chip-handle` background-image), matching the column-list and
 *  col-drag-ghost icon patterns. */
const DRAG_HANDLE_GLYPH = '';

/** Remove-chip glyph. Unicode MULTIPLICATION X (U+2715) — crisper
 *  than `×` (U+00D7, a math sign). Matches the close glyph used by
 *  the Cycle 11 dialog close button. */
const REMOVE_GLYPH = '✕';

/** Between-chip separator. Unicode SINGLE-RIGHT-POINTING ANGLE
 *  QUOTATION MARK (U+203A). Reads as typographic punctuation, not as
 *  a chevron control. Color reuses Task 4's
 *  `--cg-group-chevron-color`. */
const SEPARATOR_GLYPH = '›';

/** Sort indicator glyphs (Cycle 15.5 / Task 1). `↑` (U+2191) ascending,
 *  `↓` (U+2193) descending. The glyph IS the click target — the click
 *  routes through the indicator span so the affordance is visible. */
const SORT_ASC_GLYPH = '↑';
const SORT_DESC_GLYPH = '↓';

/** Drag-commit threshold in CSS px. Pointer movement below this in
 *  any direction is treated as a click candidate (not a drag), so the
 *  user can click `×` / sort indicator inside a pill without
 *  inadvertently starting a reorder gesture. Matches Cycle 6's column
 *  drag threshold. */
const DRAG_THRESHOLD_PX = 4;

/** Pointer offset for the floating ghost relative to the cursor.
 *  Zero X and -11 Y centers the 22px chip vertically on the cursor tip. */
const GHOST_OFFSET_X = 0;
const GHOST_OFFSET_Y = -11;

/** Context handed to RowGroupPanelHost by CGrid (or a test harness).
 *  Keeps the host framework-agnostic — it can mutate the grouping
 *  model + report its reserved inset back without importing CGrid
 *  directly. */
export interface RowGroupPanelGridContext {
  /** Called on mount / unmount / chip-count change. `height === 0`
   *  means the panel is hidden — the grid releases the reservation. */
  setReservedSpace(side: 'top', height: number): void;
  /** Resolve a colId to its current header name. Used to label
   *  chips. Returns `undefined` for unknown ids; the host falls back
   *  to the raw colId. */
  getHeaderName(colId: string): string | undefined;
  /** True when the column has `enableRowGroup: true`. Read at drop
   *  time so a runtime `setGridOption('columnDefs', …)` flips the
   *  drop verdict on the next gesture without re-wiring the host. */
  isColumnRowGroupEnabled(colId: string): boolean;
  /** Append `colId` to the grid's `rowGroupColumns`. Called from a
   *  drop on the empty panel OR from a drop at the trailing edge
   *  of the chip strip. */
  addRowGroupColumn(colId: string): void;
  /** Remove `colId` from the grid's `rowGroupColumns`. Called from a
   *  click on the chip's `×` affordance. */
  removeRowGroupColumn(colId: string): void;
  /** Move the column at `from` to `to`. Called by the pill-reorder
   *  drag on `pointerup` when the drop lands inside the panel. */
  moveRowGroupColumn(from: number, to: number): void;
  /** Toggle the sort entry for `colId`. Called from a click on the
   *  chip's sort indicator. The host passes the NEXT direction
   *  (`'asc' | 'desc' | null`) per the `none → asc → desc → none`
   *  cycle. */
  setRowGroupColumnSort(colId: string, direction: 'asc' | 'desc' | null): void;
}

/** Render-time options governing which decorations the host paints
 *  on each chip. Read off `CGridOptions` on every chip-strip
 *  re-render so `setGridOption('rowGroupPanelSuppressSort', true)`
 *  silently drops the indicator the next time the strip rebuilds. */
export interface RowGroupPanelRenderOptions {
  /** When `true`, no sort indicator is rendered on any chip, AND
   *  clicks on the chip body never toggle a sort. Mirrors
   *  `CGridOptions.rowGroupPanelSuppressSort`. Default `false`. */
  suppressSort: boolean;
}

/** Internal drag-state machine. `null` when no gesture is in flight. */
type DragState =
  | { kind: 'press'; colId: string; fromIndex: number; downX: number; downY: number; pillEl: HTMLElement; pointerId: number }
  | { kind: 'drag'; colId: string; fromIndex: number; pillEl: HTMLElement; pointerId: number };

export class RowGroupPanelHost {
  private readonly root: HTMLElement;
  /** The host element (`.cg-row-group-panel`) appended to the grid
   *  root. */
  private readonly panel: HTMLDivElement;
  private readonly ctx: RowGroupPanelGridContext;

  private show: RowGroupPanelShow;
  private rowGroupColumns: string[] = [];
  /** Parallel to `rowGroupColumns`; `null` at index i means no sort
   *  applied at level i. Re-set by `setGroupingState` whenever the
   *  GroupingState primitive emits. */
  private perLevelSort: Array<GroupingSortEntry | null> = [];
  /** Render-time options snapshot. Default reads `suppressSort: false`. */
  private renderOptions: RowGroupPanelRenderOptions = { suppressSort: false };
  /** Current drop-indicator state. Painted as a panel-level dashed
   *  outline. `null` when no drag is in progress. */
  private dropVerdict: RowGroupPanelDropVerdict = null;
  /** Insertion-line element. Lazily created the first time the
   *  host sees an accepted drop hover; reused thereafter. */
  private insertionLine: HTMLDivElement | null = null;
  /** Floating drag ghost. Lazily created on the first reorder-drag
   *  threshold crossing; reused thereafter. Lives on `document.body`
   *  (NOT the panel) so its `position: fixed` is screen-relative. */
  private ghost: HTMLDivElement | null = null;
  /** Pill-reorder drag state. Survives across pointer events for the
   *  lifetime of the gesture. */
  private dragState: DragState | null = null;
  /** Cycle 15.5 / Task 1 — when a drag actually committed (threshold
   *  crossed), the follow-up `click` event browsers synthesise after
   *  pointerup is swallowed so the chip-body click handler doesn't
   *  cycle sort as a side effect of the drag. Cleared on the next
   *  click. */
  private suppressNextChipClick = false;
  /** Bound listeners — kept as instance fields so we can remove them
   *  cleanly on `destroy`. */
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onPointerCancel: (e: PointerEvent) => void;
  private destroyed = false;

  constructor(
    root: HTMLElement,
    ctx: RowGroupPanelGridContext,
    show: RowGroupPanelShow,
    initialRowGroupColumns: string[],
    initialPerLevelSort?: Array<GroupingSortEntry | null>,
    renderOptions?: Partial<RowGroupPanelRenderOptions>,
  ) {
    this.root = root;
    this.ctx = ctx;
    this.show = show;
    this.rowGroupColumns = [...initialRowGroupColumns];
    if (initialPerLevelSort && initialPerLevelSort.length === initialRowGroupColumns.length) {
      this.perLevelSort = initialPerLevelSort.map((entry) =>
        entry === null ? null : { direction: entry.direction },
      );
    } else {
      this.perLevelSort = this.rowGroupColumns.map(() => null);
    }
    if (renderOptions?.suppressSort !== undefined) {
      this.renderOptions = { suppressSort: renderOptions.suppressSort };
    }

    this.panel = document.createElement('div');
    this.panel.className = 'cg-row-group-panel';

    this.onPointerMove = (e) => this.handlePointerMove(e);
    this.onPointerUp = (e) => this.handlePointerUp(e);
    this.onPointerCancel = (e) => this.handlePointerCancel(e);

    this.root.appendChild(this.panel);
    this.applyVisibility();
  }

  /** Resolved panel height in CSS px when visible. Mirrors the
   *  `.cg-row-group-panel { height }` rule from `tokens.css`. Used
   *  by the grid's geometry reservation. `0` when the panel is
   *  hidden. */
  getReservedHeight(): number {
    if (!this.isVisible()) return 0;
    const measured = Math.ceil(this.panel.getBoundingClientRect().height);
    if (measured > 0) return measured;
    return 32;
  }

  /** True when the panel is currently mounted AND visible. Mirrors
   *  the `display !== 'none'` state on the DOM element. */
  isVisible(): boolean {
    if (this.destroyed) return false;
    if (this.show === 'never') return false;
    if (this.show === 'onlyWhenGrouping' && this.rowGroupColumns.length === 0) return false;
    return true;
  }

  /** Cycle 15.5 / Task 1 — receive a full state snapshot from the
   *  grouping primitive. Re-renders the chip strip with the new
   *  column order + per-level sort entries. Reservation flip
   *  (`onlyWhenGrouping`) is honored. */
  setGroupingState(rowGroupColumns: string[], perLevelSort: Array<GroupingSortEntry | null>): void {
    if (this.destroyed) return;
    this.rowGroupColumns = [...rowGroupColumns];
    if (perLevelSort.length === rowGroupColumns.length) {
      this.perLevelSort = perLevelSort.map((entry) =>
        entry === null ? null : { direction: entry.direction },
      );
    } else {
      this.perLevelSort = this.rowGroupColumns.map(() => null);
    }
    this.applyVisibility();
  }

  /** Update the chip strip from a new `rowGroupColumns` list. Called
   *  by the grid whenever `setGroupModel` resolves — the host
   *  re-renders chips in the new order. The reservation may flip
   *  (`'onlyWhenGrouping'` mode) so the host re-reports its
   *  reserved height on every call.
   *
   *  Sort entries are CLEARED on this call — `setGroupModel` is a
   *  full model swap, so the per-level sort entries don't carry
   *  over. Callers wanting to preserve sort across a model swap use
   *  `setGroupingState` instead. */
  setRowGroupCols(rowGroupColumns: string[]): void {
    if (this.destroyed) return;
    this.rowGroupColumns = [...rowGroupColumns];
    this.perLevelSort = this.rowGroupColumns.map(() => null);
    this.applyVisibility();
  }

  /** Swap render-time options (currently just `suppressSort`) at
   *  runtime. The strip re-renders on the next visibility pass. */
  setRenderOptions(options: Partial<RowGroupPanelRenderOptions>): void {
    if (this.destroyed) return;
    const next: RowGroupPanelRenderOptions = {
      suppressSort: options.suppressSort ?? this.renderOptions.suppressSort,
    };
    if (next.suppressSort === this.renderOptions.suppressSort) return;
    this.renderOptions = next;
    this.applyVisibility();
  }

  /** Swap the `rowGroupPanelShow` mode at runtime. Mirrors the
   *  sidebar's `setVisible` semantics — the host re-evaluates its
   *  visibility + reservation in one call. */
  setShowMode(show: RowGroupPanelShow): void {
    if (this.destroyed) return;
    if (this.show === show) return;
    this.show = show;
    this.applyVisibility();
  }

  /** Resolved bounding rect for the panel in viewport coords. Used
   *  by the column-drag feature to hit-test mid-drag. Returns `null`
   *  when the panel is hidden. */
  getRect(): DOMRect | null {
    if (!this.isVisible()) return null;
    const rect = this.panel.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  /** True when `(clientX, clientY)` (viewport coords) falls inside
   *  the panel's bounding rect. Called by the column-drag feature
   *  each mousemove tick during a drag. */
  isPointInPanel(clientX: number, clientY: number): boolean {
    const rect = this.getRect();
    if (!rect) return false;
    return clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }

  /** Begin a drag-hover over the panel. `colId` is the column being
   *  dragged. The host evaluates the drop verdict (`'accept'` when
   *  the column has `enableRowGroup: true` AND isn't already in
   *  `rowGroupColumns` AND isn't the auto-group column itself;
   *  `'reject'` otherwise) and paints the matching outline. */
  setDragHover(colId: string | null, clientX: number, clientY: number): void {
    if (this.destroyed) return;
    if (colId === null || !this.isPointInPanel(clientX, clientY)) {
      this.clearDragHover();
      return;
    }
    const verdict: RowGroupPanelDropVerdict = this.computeDropVerdict(colId);
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

  /** End any in-progress drag-hover (drag left the panel, drag
   *  cancelled, drag committed). Clears the outline + insertion
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
   *  `rowGroupColumns`, `false` when the drop was rejected (the
   *  column-drag feature can keep the column where it was). */
  handleColumnDrop(colId: string): boolean {
    if (this.destroyed) return false;
    this.clearDragHover();
    if (this.computeDropVerdict(colId) !== 'accept') return false;
    this.ctx.addRowGroupColumn(colId);
    return true;
  }

  /** Tear down: removes the panel DOM. Safe to call multiple
   *  times. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelDrag();
    this.ctx.setReservedSpace('top', 0);
    this.panel.parentElement?.removeChild(this.panel);
  }

  // ---- internals ----------------------------------------------------

  /** Decide whether the panel should show the empty placeholder or
   *  the chip strip, paint the matching DOM, and re-report the
   *  reserved height. Idempotent — calling twice in a row with the
   *  same state is a no-op for the DOM but emits the height
   *  reservation each time (the grid de-dupes). */
  private applyVisibility(): void {
    if (this.destroyed) return;
    const visible = this.isVisible();
    this.panel.style.display = visible ? '' : 'none';
    if (visible) {
      this.renderContents();
    } else {
      this.panel.replaceChildren();
    }
    this.ctx.setReservedSpace('top', this.getReservedHeight());
  }

  /** Build the chip strip (or empty-state placeholder) and replace
   *  the panel's children in one pass. */
  private renderContents(): void {
    this.panel.replaceChildren();
    if (this.rowGroupColumns.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cg-row-group-panel-empty';
      empty.textContent = EMPTY_PLACEHOLDER;
      this.panel.appendChild(empty);
      return;
    }
    for (let i = 0; i < this.rowGroupColumns.length; i++) {
      const colId = this.rowGroupColumns[i]!;
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'cg-row-group-panel-separator';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = SEPARATOR_GLYPH;
        this.panel.appendChild(sep);
      }
      this.panel.appendChild(this.buildChip(colId, i));
    }
  }

  /** Build one chip: drag-handle + label + (sort indicator) + `×`
   *  remove. The `×` click handler invokes `ctx.removeRowGroupColumn`
   *  directly; the sort-indicator click cycles
   *  `none → asc → desc → none`. The chip body itself is the drag
   *  source — a pointerdown anywhere outside the `×` / sort spans
   *  starts the reorder gesture (committed once movement crosses
   *  `DRAG_THRESHOLD_PX`). */
  private buildChip(colId: string, index: number): HTMLDivElement {
    const chip = document.createElement('div');
    chip.className = 'cg-row-group-panel-chip';
    chip.dataset.colId = colId;
    chip.dataset.index = String(index);
    chip.setAttribute('role', 'button');
    chip.setAttribute(
      'aria-label',
      `${this.ctx.getHeaderName(colId) ?? colId} group level ${index + 1}`,
    );
    chip.tabIndex = 0;

    const handle = document.createElement('span');
    handle.className = 'cg-row-group-panel-chip-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = DRAG_HANDLE_GLYPH;
    chip.appendChild(handle);

    const label = document.createElement('span');
    label.className = 'cg-row-group-panel-chip-label';
    label.textContent = this.ctx.getHeaderName(colId) ?? colId;
    chip.appendChild(label);

    // Cycle 15.5 / Task 1 — sort indicator. Suppressed entirely when
    // `rowGroupPanelSuppressSort: true`. When a sort entry is present
    // for this level, the indicator span renders showing `↑` (asc) /
    // `↓` (desc); clicking it cycles `asc → desc → null`. When no
    // sort entry is present (default Task 6 state), the indicator is
    // OMITTED so chip width matches the byte-stable Task 6 baseline
    // — the user starts a sort by either (a) clicking the chip body
    // below the drag threshold (cycles `null → asc`), or (b) calling
    // the primitive API (`api.setRowGroupColumnSort(colId, 'asc')`),
    // or (c) the column-header context menu's Sort item (Task 2).
    if (!this.renderOptions.suppressSort) {
      const sortEntry = this.perLevelSort[index] ?? null;
      if (sortEntry !== null) {
        const sortBtn = document.createElement('button');
        sortBtn.type = 'button';
        sortBtn.className = 'cg-row-group-panel-chip-sort';
        sortBtn.dataset.direction = sortEntry.direction;
        const sortLabel = sortEntry.direction === 'asc'
          ? `Sort ${this.ctx.getHeaderName(colId) ?? colId} descending`
          : `Clear sort on ${this.ctx.getHeaderName(colId) ?? colId}`;
        sortBtn.setAttribute('aria-label', sortLabel);
        sortBtn.textContent = sortEntry.direction === 'asc'
          ? SORT_ASC_GLYPH
          : SORT_DESC_GLYPH;
        sortBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const current = this.perLevelSort[index] ?? null;
          const next: 'asc' | 'desc' | null = current === null
            ? 'asc'
            : current.direction === 'asc'
              ? 'desc'
              : null;
          this.ctx.setRowGroupColumnSort(colId, next);
        });
        // Pointerdown on the sort button must NOT start a drag — stop it
        // bubbling to the chip body's drag handler.
        sortBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        chip.appendChild(sortBtn);
      }
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cg-row-group-panel-chip-remove';
    remove.setAttribute(
      'aria-label',
      `Remove ${this.ctx.getHeaderName(colId) ?? colId} from row groups`,
    );
    remove.textContent = REMOVE_GLYPH;
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.removeRowGroupColumn(colId);
    });
    // Pointerdown on the remove button must NOT start a drag.
    remove.addEventListener('pointerdown', (e) => e.stopPropagation());
    chip.appendChild(remove);

    // Cycle 15.5 / Task 1 — drag source for pill reorder. Pointerdown
    // captures the gesture; pointermove + pointerup are handled by
    // window-level listeners so a drag survives a brief excursion
    // outside the panel rect.
    chip.addEventListener('pointerdown', (e) => this.handlePointerDown(e, colId, index, chip));
    // Cycle 15.5 / Task 1 — chip-body click cycles sort
    // (`null → asc → desc → null`). The click event only fires when
    // the press → release sequence did NOT cross the drag threshold;
    // a drag's `pointerup` is captured by the window-level listener
    // before this click fires, and `cancelDrag` clears the gesture
    // without emitting a click. Suppressed when
    // `rowGroupPanelSuppressSort: true`.
    chip.addEventListener('click', (e) => {
      if (this.renderOptions.suppressSort) return;
      // Drag-end synthesises a click that we want to swallow; the
      // `suppressNextClick` flag is set on cancelDrag when a gesture
      // committed.
      if (this.suppressNextChipClick) {
        this.suppressNextChipClick = false;
        return;
      }
      // Click on the `×` / sort button already stopped propagation; we
      // only see the chip-body click here.
      e.stopPropagation();
      const current = this.perLevelSort[index] ?? null;
      const next: 'asc' | 'desc' | null = current === null
        ? 'asc'
        : current.direction === 'asc'
          ? 'desc'
          : null;
      this.ctx.setRowGroupColumnSort(colId, next);
    });
    // Cycle 15.5 / Task 1 — keyboard reorder (Cmd+ArrowLeft /
    // Cmd+ArrowRight). Modifier is required so plain arrow keys still
    // navigate elsewhere; Cmd / Ctrl reorder the chip without
    // requiring a drag gesture (a11y win for keyboard users).
    chip.addEventListener('keydown', (e) => this.handleChipKeydown(e, colId, index));

    return chip;
  }

  /** Return `'accept'` when `colId` is droppable into the panel.
   *  Rejects when the column lacks `enableRowGroup`, is already
   *  grouped, or has a reserved id (the auto-group column). */
  private computeDropVerdict(colId: string): RowGroupPanelDropVerdict {
    if (colId.startsWith('ag-Grid-AutoColumn')) return 'reject';
    if (this.rowGroupColumns.includes(colId)) return 'reject';
    if (!this.ctx.isColumnRowGroupEnabled(colId)) return 'reject';
    return 'accept';
  }

  /** Position the vertical insertion line at the chip-gap nearest
   *  to `clientX`. Lazily creates the element on first use. Lives
   *  inside the panel so its absolute positioning is panel-local.
   *  Returns the gap INDEX (0..rowGroupColumns.length) the line is
   *  currently snapped to — used by the reorder drop to decide the
   *  target slot.
   *
   *  Snap algorithm: walk the chip rects + the trailing edge of the
   *  last chip; for each gap candidate, compute the distance from
   *  `clientX` to the gap's mid-point; the closest gap wins. Empty
   *  strip snaps to the middle of the panel. */
  private updateInsertionLine(clientX: number): number {
    if (this.destroyed) return 0;
    if (!this.insertionLine) {
      this.insertionLine = document.createElement('div');
      this.insertionLine.className = 'cg-row-group-panel-insertion-line';
      this.panel.appendChild(this.insertionLine);
    }
    this.insertionLine.style.display = '';

    const panelRect = this.panel.getBoundingClientRect();
    const chips = Array.from(
      this.panel.querySelectorAll('.cg-row-group-panel-chip'),
    ) as HTMLElement[];
    if (chips.length === 0) {
      const x = (panelRect.width - 2) / 2;
      this.insertionLine.style.left = `${x}px`;
      return 0;
    }
    // Build the list of gap candidates: BEFORE chip[0], BETWEEN
    // chip[i-1] and chip[i] for i ∈ [1, N), and AFTER chip[N-1].
    // Each candidate carries its slot index + its center x in viewport
    // coords; we pick the closest by abs(clientX - candidate.center).
    const candidates: Array<{ slotIndex: number; centerX: number; panelLeftX: number }> = [];
    // Before chip[0]: gap is BETWEEN panel-left-padding and chip[0]'s left.
    const firstRect = chips[0]!.getBoundingClientRect();
    candidates.push({
      slotIndex: 0,
      centerX: firstRect.left - 3,
      panelLeftX: firstRect.left - panelRect.left - 3,
    });
    // Between consecutive chips: gap is BETWEEN chip[i-1].right and
    // chip[i].left.
    for (let i = 1; i < chips.length; i++) {
      const left = chips[i - 1]!.getBoundingClientRect().right;
      const right = chips[i]!.getBoundingClientRect().left;
      const center = (left + right) / 2;
      candidates.push({
        slotIndex: i,
        centerX: center,
        panelLeftX: center - panelRect.left - 1,
      });
    }
    // After chip[N-1]: gap is BETWEEN chip[N-1].right and panel right.
    const lastRect = chips[chips.length - 1]!.getBoundingClientRect();
    candidates.push({
      slotIndex: chips.length,
      centerX: lastRect.right + 3,
      panelLeftX: lastRect.right - panelRect.left + 1,
    });
    // Pick the closest gap.
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

  /** Pointerdown on a chip body — captures the gesture but does NOT
   *  yet start the drag. The drag commits once the pointer moves past
   *  `DRAG_THRESHOLD_PX`. Window-level pointermove + pointerup
   *  listeners drive the rest of the lifecycle. */
  private handlePointerDown(
    e: PointerEvent,
    colId: string,
    index: number,
    pillEl: HTMLElement,
  ): void {
    if (this.destroyed) return;
    // Left mouse / primary touch only — right-clicks open the column
    // context menu (Cycle 10), middle-clicks are reserved.
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
    // Capture so a release outside the chip / panel still fires the
    // matching pointerup on this listener.
    try {
      pillEl.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture throws on browsers that don't track this
      // pointer id (rare); the window-level listeners still drive the
      // gesture, so swallow.
    }
    // Window-level so the drag survives going off the panel.
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
    // We're in a drag.
    this.positionGhost(e.clientX, e.clientY);
    if (this.isPointInPanel(e.clientX, e.clientY)) {
      // Reorder verdict is always 'accept' inside the panel — the
      // column already lives in `rowGroupColumns`, so the verdict
      // panes don't apply (those are for add-via-drop).
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
      // A drag committed (or didn't, if released outside the panel).
      // Either way, the follow-up click event the browser synthesises
      // from this pointerup must NOT cycle sort on the chip body.
      this.suppressNextChipClick = true;
      if (this.isPointInPanel(e.clientX, e.clientY)) {
        const targetSlot = this.updateInsertionLine(e.clientX);
        this.ctx.moveRowGroupColumn(state.fromIndex, targetSlot);
      }
    }
    this.cancelDrag();
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (this.destroyed || this.dragState === null) return;
    if (e.pointerId !== this.dragState.pointerId) return;
    this.cancelDrag();
  }

  /** Tear down any in-flight drag state. Clears hover decorations, the
   *  ghost, and the window-level listeners. Idempotent. */
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

  /** Mount the floating ghost element on `document.body`. Sized to
   *  match the source chip; positioned by `positionGhost`. */
  private mountGhost(sourceChip: HTMLElement, clientX: number, clientY: number): void {
    if (this.destroyed) return;
    if (this.ghost) this.unmountGhost();
    const ghost = sourceChip.cloneNode(true) as HTMLDivElement;
    ghost.classList.add('cg-row-group-panel-chip-ghost');
    ghost.removeAttribute('data-col-id');
    ghost.removeAttribute('data-index');
    ghost.setAttribute('aria-hidden', 'true');
    // The chip CSS uses panel-scoped variables (`--cg-row-group-chip-bg`,
    // `--cg-row-group-chip-border`, etc.) which DO NOT resolve when the
    // ghost lives on `document.body`. Snapshot the resolved computed
    // styles from the source chip and apply them inline so the ghost
    // renders correctly outside the panel scope.
    copyResolvedChipStyles(sourceChip, ghost);
    // Pin the rendered width/height so `position: fixed` doesn't reflow.
    const rect = sourceChip.getBoundingClientRect();
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

  /** Cmd+ArrowLeft / Cmd+ArrowRight reorders the chip without a drag.
   *  Delete / Backspace removes the chip. Plain arrow keys don't
   *  reorder so keyboard users can still tab-navigate normally. */
  private handleChipKeydown(e: KeyboardEvent, colId: string, index: number): void {
    if (this.destroyed) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.ctx.removeRowGroupColumn(colId);
      return;
    }
    const modifier = e.metaKey || e.ctrlKey;
    if (!modifier) return;
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      this.ctx.moveRowGroupColumn(index, index - 1);
    } else if (e.key === 'ArrowRight' && index < this.rowGroupColumns.length - 1) {
      e.preventDefault();
      // moveRowGroupColumn target is "insert at slot K"; moving right
      // means inserting AFTER the next chip, i.e. slot index + 2.
      this.ctx.moveRowGroupColumn(index, index + 2);
    }
  }
}

/** Resolve `CGridOptions.rowGroupPanelShow` (accepts only the
 *  canonical strings; default `'never'`) to a non-`'never'` value
 *  OR `null` when the panel should never mount. Apps can also pass
 *  `undefined` (default off). Returns `null` for `'never'` /
 *  undefined so the construction-time decision is a single null
 *  check. */
export function normalizeRowGroupPanelShow(
  opt: RowGroupPanelShow | undefined,
): Exclude<RowGroupPanelShow, 'never'> | null {
  if (opt === undefined || opt === 'never') return null;
  return opt;
}
