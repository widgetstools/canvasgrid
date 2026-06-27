/**
 * Cycle 15 / Task 6 — RowGroupPanelHost.
 *
 * Mounts a horizontal DOM strip ABOVE the column header row. Renders
 * one chip per `rowGroupCols[i]` (in nesting order) plus a `›`
 * separator between adjacent chips. When `rowGroupCols.length === 0`
 * and `rowGroupPanelShow === 'always'`, the strip shows a dashed
 * empty-state placeholder ("Drag here to set row groups" — verbatim
 * from the Cycle 11 sidebar Columns panel for vocabulary continuity).
 *
 * The host mirrors `SideBarHost` and `StatusBarHost` in shape: a
 * thin context object (`RowGroupPanelGridContext`) lets the host
 * report its reserved top inset back to the grid + emit add/remove
 * actions without importing `CGrid` directly. The grid wires its
 * `setHostBounds({ top })` channel from the reservation so the
 * scroller + editor overlay + canvas all shrink to make room.
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
 *   docs/superpowers/plans/notes/cycle-15-grouping-design.md § Task 6.
 */

import type { RowGroupPanelShow, RowGroupPanelDropVerdict } from './types';

/** Verbatim from `cgrid/src/interaction/toolPanels/columnsPanel.ts`'s
 *  Row Groups section. One drop-zone vocabulary across the grid. */
const EMPTY_PLACEHOLDER = 'Drag here to set row groups';

/** Drag-handle glyph at the chip's left edge. Unicode IDENTICAL TO
 *  (U+2261) — same family as the Cycle 11 sidebar's `'columns'`
 *  icon `☰` so the "grab here" affordance reads consistently. */
const DRAG_HANDLE_GLYPH = '≡';

/** Remove-chip glyph. Unicode MULTIPLICATION X (U+2715) — crisper
 *  than `×` (U+00D7, a math sign). Matches the close glyph used by
 *  the Cycle 11 dialog close button. */
const REMOVE_GLYPH = '✕';

/** Between-chip separator. Unicode SINGLE-RIGHT-POINTING ANGLE
 *  QUOTATION MARK (U+203A). Reads as typographic punctuation, not as
 *  a chevron control. Color reuses Task 4's
 *  `--cg-group-chevron-color`. */
const SEPARATOR_GLYPH = '›';

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
  /** Append `colId` to the grid's `rowGroupCols`. Called from a
   *  drop on the empty panel OR from a drop at the trailing edge
   *  of the chip strip. The grid is responsible for the
   *  `setGroupModel` round-trip + the resulting viewport refresh. */
  appendRowGroup(colId: string): void;
  /** Remove `colId` from the grid's `rowGroupCols`. Called from a
   *  click on the chip's `×` affordance. */
  removeRowGroup(colId: string): void;
}

export class RowGroupPanelHost {
  private readonly root: HTMLElement;
  /** The host element (`.cg-row-group-panel`) appended to the grid
   *  root. */
  private readonly panel: HTMLDivElement;
  private readonly ctx: RowGroupPanelGridContext;

  private show: RowGroupPanelShow;
  private rowGroupCols: string[] = [];
  /** Current drop-indicator state. Painted as a panel-level dashed
   *  outline. `null` when no drag is in progress. */
  private dropVerdict: RowGroupPanelDropVerdict = null;
  /** Insertion-line element. Lazily created the first time the
   *  host sees an accepted drop hover; reused thereafter. */
  private insertionLine: HTMLDivElement | null = null;
  private destroyed = false;

  constructor(
    root: HTMLElement,
    ctx: RowGroupPanelGridContext,
    show: RowGroupPanelShow,
    initialRowGroupCols: string[],
  ) {
    this.root = root;
    this.ctx = ctx;
    this.show = show;
    this.rowGroupCols = [...initialRowGroupCols];

    this.panel = document.createElement('div');
    this.panel.className = 'cg-row-group-panel';

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
    if (this.show === 'onlyWhenGrouping' && this.rowGroupCols.length === 0) return false;
    return true;
  }

  /** Update the chip strip from a new `rowGroupCols` list. Called
   *  by the grid whenever `setGroupModel` resolves — the host
   *  re-renders chips in the new order. The reservation may flip
   *  (`'onlyWhenGrouping'` mode) so the host re-reports its
   *  reserved height on every call. */
  setRowGroupCols(rowGroupCols: string[]): void {
    if (this.destroyed) return;
    this.rowGroupCols = [...rowGroupCols];
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
   *  `rowGroupCols` AND isn't the auto-group column itself;
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
   *  `rowGroupCols`, `false` when the drop was rejected (the
   *  column-drag feature can keep the column where it was). */
  handleColumnDrop(colId: string): boolean {
    if (this.destroyed) return false;
    this.clearDragHover();
    if (this.computeDropVerdict(colId) !== 'accept') return false;
    this.ctx.appendRowGroup(colId);
    return true;
  }

  /** Tear down: removes the panel DOM. Safe to call multiple
   *  times. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
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
    if (this.rowGroupCols.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cg-row-group-panel-empty';
      empty.textContent = EMPTY_PLACEHOLDER;
      this.panel.appendChild(empty);
      return;
    }
    for (let i = 0; i < this.rowGroupCols.length; i++) {
      const colId = this.rowGroupCols[i]!;
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

  /** Build one chip: drag-handle + label + `×` remove. The `×`
   *  click handler invokes `ctx.removeRowGroup(colId)` directly;
   *  the drag handle gets `cursor: grab` so the user reads "grab
   *  here" without an explicit drag-out gesture wired in Cycle 15. */
  private buildChip(colId: string, index: number): HTMLDivElement {
    const chip = document.createElement('div');
    chip.className = 'cg-row-group-panel-chip';
    chip.dataset.colId = colId;
    chip.dataset.index = String(index);

    const handle = document.createElement('span');
    handle.className = 'cg-row-group-panel-chip-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = DRAG_HANDLE_GLYPH;
    chip.appendChild(handle);

    const label = document.createElement('span');
    label.className = 'cg-row-group-panel-chip-label';
    label.textContent = this.ctx.getHeaderName(colId) ?? colId;
    chip.appendChild(label);

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
      this.ctx.removeRowGroup(colId);
    });
    chip.appendChild(remove);

    return chip;
  }

  /** Return `'accept'` when `colId` is droppable into the panel.
   *  Rejects when the column lacks `enableRowGroup`, is already
   *  grouped, or has a reserved id (the auto-group column). */
  private computeDropVerdict(colId: string): RowGroupPanelDropVerdict {
    if (colId.startsWith('ag-Grid-AutoColumn')) return 'reject';
    if (this.rowGroupCols.includes(colId)) return 'reject';
    if (!this.ctx.isColumnRowGroupEnabled(colId)) return 'reject';
    return 'accept';
  }

  /** Position the vertical insertion line at the chip-gap nearest
   *  to `clientX`. Lazily creates the element on first use. Lives
   *  inside the panel so its absolute positioning is panel-local. */
  private updateInsertionLine(clientX: number): void {
    if (this.destroyed) return;
    if (!this.insertionLine) {
      this.insertionLine = document.createElement('div');
      this.insertionLine.className = 'cg-row-group-panel-insertion-line';
      this.panel.appendChild(this.insertionLine);
    }
    this.insertionLine.style.display = '';

    // Find the chip-gap nearest to clientX. The insertion point can
    // be BEFORE the first chip, BETWEEN any two chips, or AFTER the
    // last chip. Walk the chip rects and pick the gap whose center
    // is closest to the pointer.
    const panelRect = this.panel.getBoundingClientRect();
    const chips = Array.from(
      this.panel.querySelectorAll('.cg-row-group-panel-chip'),
    ) as HTMLElement[];
    if (chips.length === 0) {
      // Empty strip — drop in the middle so the line reads as "drop
      // here." Otherwise the line would float at the left edge.
      const x = (panelRect.width - 2) / 2;
      this.insertionLine.style.left = `${x}px`;
      return;
    }
    let bestX = chips[chips.length - 1]!.getBoundingClientRect().right - panelRect.left;
    let bestDist = Math.abs(clientX - (bestX + panelRect.left));
    for (let i = 0; i < chips.length; i++) {
      const rect = chips[i]!.getBoundingClientRect();
      // Candidate gap: just to the left of this chip.
      const candidateX = rect.left - panelRect.left;
      const dist = Math.abs(clientX - rect.left);
      if (dist < bestDist) {
        bestDist = dist;
        bestX = candidateX;
      }
    }
    this.insertionLine.style.left = `${Math.max(0, bestX - 1)}px`;
  }

  private hideInsertionLine(): void {
    if (this.insertionLine) this.insertionLine.style.display = 'none';
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
