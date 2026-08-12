// GroupExpandFeature — hit-tests the chevron region of an auto-group
// cell on mousedown and toggles the group's expanded state. Routes
// chevron clicks ahead of `EditTrigger` / `CellSelection` so a click
// on the chevron neither opens an editor nor mutates the cell-range
// selection.
//
// Design plan (hit zone, hover affordance, animation):
// `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 7.
//
// Why the toggle runs on mousedown (not click): the canvas grid emits
// a synthetic `click` only after a matching `mouseup` on the same DOM
// element, so a click that happens to start a drag (mousedown → drag →
// mouseup elsewhere) wouldn't fire. We want chevron toggles to feel
// instant — fire on mousedown and consume the event before
// `RangeSelection` / `CellSelection` see it. The companion
// `handleClick` consumes the trailing click so apps that listen for
// `cellClicked` events on the auto-group column don't get a spurious
// "the user clicked the group cell" event for what was really a
// toggle gesture.
//
// Hover affordance is `cursor: pointer` only — set in `handleMouseMove`
// when the pointer is over the chevron hit zone. No background tint,
// no chevron color bump (canvas-paint repaints on every mousemove are
// expensive AND would break the Task 4 "no row chrome" risk). The
// cursor alone signals interactivity globally; the chevron glyph
// itself signals it per cell.

import { Feature, type VelocityGridEventCtx } from '../feature';

export class GroupExpandFeature extends Feature {
  override handleMouseMove(ctx: VelocityGridEventCtx): void {
    // Cursor: pointer when over a sticky chevron, body chevron, OR checkbox.
    const sticky = ctx.grid.hitTestStickyChevron(ctx.point.x, ctx.point.y);
    const chevron = sticky === null
      ? ctx.grid.hitTestGroupChevron(ctx.point.x, ctx.point.y)
      : null;
    const checkbox = sticky === null && chevron === null
      ? ctx.grid.hitTestGroupCheckbox(ctx.point.x, ctx.point.y)
      : null;
    this.cursor = sticky !== null || chevron !== null || checkbox !== null ? 'pointer' : null;
    super.handleMouseMove(ctx);
  }

  override handleMouseDown(ctx: VelocityGridEventCtx): void {
    // Only left-button presses toggle groups. Middle / right go to
    // their respective handlers via `super`.
    if (ctx.raw instanceof MouseEvent && ctx.raw.button !== 0) {
      super.handleMouseDown(ctx);
      return;
    }
    // Cycle 15 / Task 16 — sticky band chevron takes highest priority.
    const sticky = ctx.grid.hitTestStickyChevron(ctx.point.x, ctx.point.y);
    if (sticky !== null) {
      ctx.grid.toggleGroupExpanded(sticky.groupKey);
      return;
    }
    // Chevron takes precedence over checkbox — its hit zone is
    // strictly to the left, so they never overlap, but checking
    // chevron first keeps the geometry assumption explicit.
    const chevron = ctx.grid.hitTestGroupChevron(ctx.point.x, ctx.point.y);
    if (chevron !== null) {
      ctx.grid.toggleGroupExpanded(chevron.groupKey);
      // CONSUME — chevron toggle must not also open an editor, start
      // a range drag, or move focus.
      return;
    }
    // Cycle 15 / Task 8 — checkbox hit lane. Routes through the
    // SelectionModel's cascade so the persistent rowId set carries the
    // change. Toggle rule:
    //   'none' / 'partial' → select all descendants (Excel / ag-grid
    //     pattern: a mixed group "completes" on first click).
    //   'all' → deselect all descendants.
    const checkbox = ctx.grid.hitTestGroupCheckbox(ctx.point.x, ctx.point.y);
    if (checkbox !== null) {
      const nextSelected = checkbox.state !== 'all';
      ctx.grid.toggleGroupChildrenSelected(checkbox.groupKey, nextSelected);
      // CONSUME — selection toggle must not also start a range / open
      // an editor / move focus to the auto-group cell.
      return;
    }
    super.handleMouseDown(ctx);
  }

  /** AG parity — double-clicking anywhere on a GROUP row toggles its
   *  expansion (matching `agGroupCellRenderer`'s default), unless
   *  `suppressDoubleClickExpand` is set. Consumed so the double-click
   *  neither opens an editor nor emits a spurious `cellDoubleClicked`. */
  override handleDoubleClick(ctx: VelocityGridEventCtx): void {
    const hit = ctx.hit;
    if (
      hit !== null
      && hit.kind === 'cell'
      && !ctx.grid.isGroupDoubleClickExpandSuppressed()
      && ctx.grid.isGroupRow(hit.rowIndex)
    ) {
      const groupKey = ctx.grid.getGroupKeyAtRow(hit.rowIndex);
      if (groupKey !== '') {
        ctx.grid.toggleGroupExpanded(groupKey);
        return;
      }
    }
    super.handleDoubleClick(ctx);
  }

  override handleClick(ctx: VelocityGridEventCtx): void {
    // Consume trailing clicks on sticky chevrons, body chevrons, and
    // checkboxes so apps don't see a spurious `cellClicked`.
    const sticky = ctx.grid.hitTestStickyChevron(ctx.point.x, ctx.point.y);
    if (sticky !== null) return;
    const chevron = ctx.grid.hitTestGroupChevron(ctx.point.x, ctx.point.y);
    if (chevron !== null) return;
    const checkbox = ctx.grid.hitTestGroupCheckbox(ctx.point.x, ctx.point.y);
    if (checkbox !== null) return;
    super.handleClick(ctx);
  }

  /** Cycle 15.5 / Task 6 — keyboard group navigation (AG Grid parity).
   *
   *  When focus is on an auto-group column cell of a GROUP row:
   *    ArrowRight → expand the group (no-op if already expanded).
   *    ArrowLeft  → collapse the group (no-op if already collapsed).
   *    Enter      → toggle (same as chevron click).
   *    Space      → toggle (same as chevron click).
   *
   *  When focus is on a DATA row in the auto-group column:
   *    ArrowLeft → move focus to the parent group's row (if visible).
   *
   *  All cases only fire when the focused column is the auto-group
   *  column ('ag-Grid-AutoColumn' or the first column with a
   *  `cellRenderer: 'group'` resolved def). Passes through to super for
   *  any non-group-nav key (tab, alpha, digits, etc.) so the standard
   *  keyboard feature chain remains intact. */
  override handleKeyDown(ctx: VelocityGridEventCtx): void {
    const { focusedRowIndex, focusedColId } = ctx.grid.selection.state;
    if (focusedRowIndex === null || focusedColId === null) {
      super.handleKeyDown(ctx);
      return;
    }
    const key = (ctx.raw as KeyboardEvent).key;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Enter' && key !== ' ') {
      super.handleKeyDown(ctx);
      return;
    }
    const groupKey = ctx.grid.getGroupKeyAtRow(focusedRowIndex);
    const isGroupRow = ctx.grid.isGroupRow(focusedRowIndex);
    if (!isGroupRow || groupKey === '') {
      super.handleKeyDown(ctx);
      return;
    }
    // Group row — handle expand / collapse.
    (ctx.raw as KeyboardEvent).preventDefault();
    const isExpanded = ctx.grid.isGroupExpanded(groupKey);
    if (key === 'ArrowRight') {
      if (!isExpanded) ctx.grid.toggleGroupExpanded(groupKey);
    } else if (key === 'ArrowLeft') {
      if (isExpanded) ctx.grid.toggleGroupExpanded(groupKey);
    } else {
      // Enter / Space — toggle.
      ctx.grid.toggleGroupExpanded(groupKey);
    }
  }
}
