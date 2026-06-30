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

    // Conventional / ag-grid parity — Delete clears every cell in the
    // active range(s). No modifier; gate on having at least one range
    // selected so a bare Delete with no range falls through (browser
    // default, or downstream features for headers etc.).
    if (e.key === 'Delete' && ctx.grid.clearSelectedCells) {
      const ranges = ctx.grid.selection.getRanges();
      if (ranges.length > 0) {
        e.preventDefault();
        ctx.grid.clearSelectedCells();
        return;
      }
    }

    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) {
      super.handleKeyDown(ctx);
      return;
    }

    // Conventional / ag-grid parity — Ctrl+D / Cmd+D fills down: the
    // top row of the range copies to every other row in the same
    // range. Gated on a multi-row range existing so single-row
    // selections fall through (the browser default for Ctrl+D in a
    // canvas is no-op anyway).
    const isFillDown = e.key === 'd' || e.key === 'D' || e.code === 'KeyD';
    if (isFillDown && ctx.grid.fillDown) {
      const ranges = ctx.grid.selection.getRanges();
      const hasMultiRow = ranges.some((r) => r.rowEnd > r.rowStart);
      if (hasMultiRow) {
        e.preventDefault();
        ctx.grid.fillDown();
        return;
      }
    }
    // Cycle 10 / Task 6 — `suppressClipboardApi: true` removes the
    // shortcut entirely. We forward via super (no `preventDefault`) so
    // host pages that registered `addEventListener('copy' | 'paste' |
    // 'cut', …)` on the document see the gesture and can drive their
    // own clipboard surface. Read at event time so a runtime flip
    // lights up on the next keypress.
    if (ctx.grid.isClipboardApiSuppressed()) {
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
      // Cycle 10 / Task 6 — `suppressClipboardPaste: true` gates ONLY
      // paste (copy / cut still fire). Forward via super with no
      // `preventDefault` so host listeners still see the keypress.
      if (ctx.grid.isClipboardPasteSuppressed()) {
        super.handleKeyDown(ctx);
        return;
      }
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
    // Cycle 24 / Task 1 — Ctrl+A / Cmd+A → select every visible row.
    // Gated on `selectAllRows` actually existing on CGridLike (the
    // hook is optional). The grid implementation no-ops when the
    // selection mode isn't `'multiple'` so single / none modes get
    // their browser default (no select-all on a canvas — fine).
    const isSelectAll = e.key === 'a' || e.key === 'A' || e.code === 'KeyA';
    if (isSelectAll && ctx.grid.selectAllRows) {
      e.preventDefault();
      ctx.grid.selectAllRows();
      return;
    }

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
