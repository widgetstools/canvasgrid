/**
 * Cycle 23 / Task 4 — pre-grid cell keyboard events.
 *
 * Sits at the HEAD of the feature chain so every keydown fans out as
 * a `cellKeyDown` event (and `cellKeyPress` for printable chars)
 * BEFORE any grid-side handler — EditTrigger, KeyPaging,
 * KeyboardShortcuts, etc. — runs. App listeners calling
 * `event.preventDefault()` short-circuit the chain: the grid does
 * NOT process the key, so apps can disable Enter-to-commit per
 * column, replace Ctrl+C with their own clipboard logic, or
 * intercept any other shortcut.
 *
 * No focused cell ⇒ no emit. The events live on the cellKey* family
 * by design — global hotkey hooks belong on the host element, not
 * the grid.
 */
import { Feature, type CGridEventCtx } from '../feature';

export class CellKeyboardEvents extends Feature {
  override handleKeyDown(ctx: CGridEventCtx): void {
    const e = ctx.raw as KeyboardEvent;
    const sel = ctx.grid.selection;
    const fr = sel.state.focusedRowIndex;
    const fc = sel.state.focusedColId;
    if (fr === null || fc === null) {
      super.handleKeyDown(ctx);
      return;
    }
    const prevented = ctx.grid.emitCellKeyDown?.(fr, fc, e);
    // Also fan out `cellKeyPress` for single printable chars (length-1
    // key, no Ctrl/Meta/Alt). This synthesizes the deprecated DOM
    // keypress without re-listening: the same KeyboardEvent passes
    // through both subscriptions, and `defaultPrevented` carries
    // through too.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      ctx.grid.emitCellKeyPress?.(fr, fc, e);
    }
    if (prevented || e.defaultPrevented) {
      // App consumed the key. Do NOT forward via super — every
      // downstream feature would otherwise still get to run their
      // grid handler.
      return;
    }
    super.handleKeyDown(ctx);
  }
}
