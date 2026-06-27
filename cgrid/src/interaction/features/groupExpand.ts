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

import { Feature, type CGridEventCtx } from '../feature';

export class GroupExpandFeature extends Feature {
  override handleMouseMove(ctx: CGridEventCtx): void {
    // Cursor: pointer when over a chevron hit zone. Reset to null
    // otherwise so a previous-tick cursor doesn't leak; FeatureChain's
    // tail-first `setCursor` walk applies the head's non-null value.
    const hit = ctx.grid.hitTestGroupChevron(ctx.point.x, ctx.point.y);
    this.cursor = hit !== null ? 'pointer' : null;
    super.handleMouseMove(ctx);
  }

  override handleMouseDown(ctx: CGridEventCtx): void {
    // Only left-button presses toggle groups. Middle / right go to
    // their respective handlers via `super`.
    if (ctx.raw instanceof MouseEvent && ctx.raw.button !== 0) {
      super.handleMouseDown(ctx);
      return;
    }
    const hit = ctx.grid.hitTestGroupChevron(ctx.point.x, ctx.point.y);
    if (hit === null) {
      super.handleMouseDown(ctx);
      return;
    }
    ctx.grid.toggleGroupExpanded(hit.groupKey);
    // CONSUME — do NOT forward to downstream features. A chevron
    // toggle must not also open an editor (EditTrigger),
    // start a range drag (RangeSelection / FillHandle), or replace
    // the focused cell (CellSelection).
  }

  override handleClick(ctx: CGridEventCtx): void {
    // Consume the trailing click on a chevron hit zone so the grid
    // doesn't fire `cellClicked` for the toggle gesture. Forward
    // everything else.
    const hit = ctx.grid.hitTestGroupChevron(ctx.point.x, ctx.point.y);
    if (hit !== null) return;
    super.handleClick(ctx);
  }
}
