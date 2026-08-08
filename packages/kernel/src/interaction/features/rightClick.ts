/**
 * Cycle 10 / Task 1 — RightClick feature.
 *
 * Intercepts the `contextmenu` event on the canvas. For every hit the
 * grid considers a real right-click target (cell, header, headerGroup,
 * or empty), the feature:
 *
 *  1. Calls `event.preventDefault()` so the native browser menu does NOT
 *     fire.
 *  2. Resolves `MenuItem[]` via `ctx.grid.resolveContextMenuItems(hit)`
 *     (which reads `VelocityGridOptions.getContextMenuItems(params)` and falls
 *     back to the empty list; Task 2 plugs in the default registry).
 *  3. Mounts the menu at the cursor via `ctx.grid.openContextMenu(items, x, y, hit)`.
 *
 * `(x, y)` are the raw `clientX` / `clientY` from the event — viewport
 * coordinates. The host is positioned `fixed`, so viewport coords are
 * exactly what it expects (no canvas-rect offset needed).
 *
 * The feature lives at the TAIL of the chain (after `OnHover`) because
 * the chain dispatch walks head→tail and we want every other feature's
 * contextmenu handler — if any are added later — to run first. Today no
 * other feature claims `contextmenu`, so the position only matters for
 * future-proofing.
 */
import { Feature, type VelocityGridEventCtx } from '../feature';

export class RightClick extends Feature {
  override handleContextMenu(ctx: VelocityGridEventCtx): void {
    const raw = ctx.raw;
    if (!(raw instanceof MouseEvent)) {
      super.handleContextMenu(ctx);
      return;
    }
    // Always preventDefault — once the user has installed a cgrid menu
    // surface (even an empty one via `() => []`), the native menu is
    // never what they want. Apps that want the cgrid menu OFF AND the
    // native menu OFF set `suppressContextMenu: true`. Apps that want
    // BOTH to fire don't have a knob — that's by design.
    raw.preventDefault();

    // Cycle 10 / Task 6 — `suppressContextMenu` swallows the event
    // entirely. We still call `preventDefault` (above) so the native
    // browser menu doesn't fire either; the feature simply doesn't
    // resolve / open the cgrid menu. Read at event time so a runtime
    // `setGridOption('suppressContextMenu', true)` lights up on the
    // next right-click.
    if (ctx.grid.isContextMenuSuppressed()) return;

    const items = ctx.grid.resolveContextMenuItems(ctx.hit);
    if (items.length === 0) {
      // Empty result is the "swallow only" path — no menu mounts. Don't
      // forward via super (the contextmenu is already consumed).
      return;
    }

    ctx.grid.openContextMenu(items, raw.clientX, raw.clientY, ctx.hit);
  }
}
