/**
 * Cycle 10 / Task 3 — keyboard shortcuts feature.
 *
 * Owns the clipboard keyboard surface that lands across Cycle 10:
 *   - Task 3 (this commit): Ctrl/Cmd+C → `copySelectedRangesToClipboard`.
 *   - Task 4: Ctrl/Cmd+V → `pasteFromClipboard`.
 *   - Task 5: Ctrl/Cmd+X → `cutSelectedRanges`.
 *
 * Sits ahead of `OnHover` (the tail) so other features can still claim
 * the same keys when an editor is open — this feature short-circuits
 * away when `ctx.grid.isEditing()` is true so the editor's own paste
 * /copy logic (textarea's native handling) wins.
 *
 * Critical: the copy entry point fires inside the `keydown` handler
 * stack so `navigator.clipboard.writeText` runs inside the browser's
 * user-gesture window. A `setTimeout` deferral would reject in every
 * mainstream browser. The async serialize hop is fine — the gesture
 * carries through `await` for the first turn — but we resolve the
 * promise here without forcing it onto the gesture stack to avoid
 * blocking on the typecheck.
 */
import { Feature, type CGridEventCtx } from '../feature';

export class KeyboardShortcuts extends Feature {
  override handleKeyDown(ctx: CGridEventCtx): void {
    const e = ctx.raw as KeyboardEvent;

    // Defer to the editor when one is open — its textarea / input owns
    // the clipboard verbs while focused.
    if (ctx.grid.isEditing()) {
      super.handleKeyDown(ctx);
      return;
    }

    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) {
      super.handleKeyDown(ctx);
      return;
    }
    // `KeyboardEvent.key` is the printable character — case varies with
    // shift state ('C' vs 'c'). `.code` is layout-stable ('KeyC'), so
    // we match both to cover every layout + caps-lock combination.
    const isCopy = e.key === 'c' || e.key === 'C' || e.code === 'KeyC';
    if (isCopy) {
      // No-op when nothing is selected — let the browser keep its
      // default (which is also a no-op on a canvas).
      const ranges = ctx.grid.selection.getRanges();
      if (ranges.length === 0) {
        super.handleKeyDown(ctx);
        return;
      }
      e.preventDefault();
      // Fire inside the gesture stack so `navigator.clipboard.writeText`
      // sees the user gesture. The serialise round-trip is async; the
      // browser keeps the gesture flag alive for the resolving
      // microtask, so awaiting through the worker is safe. The
      // outermost `.catch` keeps stray rejections out of the console
      // (e.g. transient permission denials).
      void ctx.grid.copySelectedRangesToClipboard().catch((err) => {
        if (err instanceof Error && err.message === 'no-ranges') return;
        console.warn('[cgrid] copySelectedRangesToClipboard:', err);
      });
      return;
    }

    // Cycle 10 / Task 4 — Ctrl+V / Cmd+V → paste from system clipboard.
    // The paste anchor is `selection.state.focusedRowIndex/Col` — when
    // no cell is focused, the API returns without reading the clipboard
    // (so the browser falls through to its default, which is a no-op
    // on a canvas).
    const isPaste = e.key === 'v' || e.key === 'V' || e.code === 'KeyV';
    if (isPaste) {
      const fr = ctx.grid.selection.state.focusedRowIndex;
      const fc = ctx.grid.selection.state.focusedColId;
      if (fr === null || fc === null) {
        super.handleKeyDown(ctx);
        return;
      }
      e.preventDefault();
      // Same gesture-stack reasoning as copy — `navigator.clipboard.readText`
      // is the gesture-gated call here, and it fires synchronously off the
      // first turn of `pasteFromClipboard`.
      void ctx.grid.pasteFromClipboard().catch((err) => {
        console.warn('[cgrid] pasteFromClipboard:', err);
      });
      return;
    }

    // Cycle 10 / Task 5 — Ctrl+X / Cmd+X → cut (copy + clear). Same
    // selection gate as copy: an empty range set is a silent no-op so
    // the browser keeps its default (which is also a no-op on a
    // canvas). `cutSelectedRanges` writes to the clipboard FIRST and
    // only proceeds to the clear `applyTransaction` if writeText
    // resolves, so the user-gesture stack must be active here — the
    // keydown handler runs inside it.
    const isCut = e.key === 'x' || e.key === 'X' || e.code === 'KeyX';
    if (isCut) {
      const ranges = ctx.grid.selection.getRanges();
      if (ranges.length === 0) {
        super.handleKeyDown(ctx);
        return;
      }
      e.preventDefault();
      void ctx.grid.cutSelectedRanges().catch((err) => {
        if (err instanceof Error && err.message === 'no-ranges') return;
        console.warn('[cgrid] cutSelectedRanges:', err);
      });
      return;
    }

    super.handleKeyDown(ctx);
  }
}
