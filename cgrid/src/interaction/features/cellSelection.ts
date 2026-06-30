// CellSelection — handles cell focus + selection modifiers on mousedown,
// emits cellClicked/cellDoubleClicked, and owns arrow / Tab / Space / F2 /
// Enter / Escape keyboard navigation.

import { Feature, type CGridEventCtx } from '../feature';

export class CellSelection extends Feature {
  override handleMouseDown(ctx: CGridEventCtx): void {
    if (ctx.hit.kind !== 'cell') {
      super.handleMouseDown(ctx);
      return;
    }
    // Esc semantics on click-another-cell: cancel any open editor before
    // moving focus. The mousedown only reaches the canvas when the user
    // clicks outside the editor's DOM overlay, so any hit here is by
    // definition "click outside the editor input." singleClickEdit will
    // re-open a fresh editor on the new cell via EditTrigger.handleClick.
    if (ctx.grid.isEditing()) {
      ctx.grid.stopEditing(true);
    }
    const sel = ctx.grid.selection;
    const e = ctx.raw as MouseEvent;
    const prevFocus = sel.state.focusedRowIndex;
    sel.setFocus(ctx.hit.rowIndex, ctx.hit.colId);
    // Cycle 9 patch / Task 1 — right-click on a row that's already part of
    // the row selection set MUST preserve that selection so the context
    // menu's row-scoped actions (Copy, Delete, etc.) see every selected
    // row, not just the one under the cursor. Focus already moved (above);
    // skip the `selectSingle` / `toggleMulti` branch that would clobber the
    // multi-row selection. Right-clicks on rows NOT in the selection fall
    // through to the existing behaviour (selectSingle picks the clicked
    // row) so the menu still acts on the user's intended target.
    if (e.button === 2 && sel.state.selectedRowIndices.has(ctx.hit.rowIndex)) {
      return;
    }
    if (e.shiftKey) {
      if (prevFocus != null) sel.range(prevFocus, ctx.hit.rowIndex);
    } else if (e.ctrlKey || e.metaKey) {
      sel.toggleMulti(ctx.hit.rowIndex);
    } else {
      sel.selectSingle(ctx.hit.rowIndex);
    }
    // Consume — fully handled.
  }

  override handleClick(ctx: CGridEventCtx): void {
    if (ctx.hit.kind === 'cell') {
      ctx.grid.emitCellClicked(ctx.hit.rowIndex, ctx.hit.colId, ctx.raw as MouseEvent);
      return;
    }
    super.handleClick(ctx);
  }

  override handleDoubleClick(ctx: CGridEventCtx): void {
    if (ctx.hit.kind === 'cell') {
      ctx.grid.emitCellDoubleClicked(ctx.hit.rowIndex, ctx.hit.colId, ctx.raw as MouseEvent);
      return;
    }
    super.handleDoubleClick(ctx);
  }

  override handleKeyDown(ctx: CGridEventCtx): void {
    const sel = ctx.grid.selection;
    const cols = ctx.grid.allColIds();
    const rowCount = ctx.grid.totalRowCount();
    if (rowCount === 0 || cols.length === 0) {
      super.handleKeyDown(ctx);
      return;
    }
    const e = ctx.raw as KeyboardEvent;
    const { focusedRowIndex: fr, focusedColId: fc } = sel.state;
    const ci = fc == null ? 0 : Math.max(0, cols.indexOf(fc));

    switch (e.key) {
      case 'ArrowDown':
        // Cycle 24 / Task 1 — Ctrl+ArrowDown jumps to the last row in
        // the same column (data-boundary nav).
        if (e.ctrlKey || e.metaKey) {
          sel.setFocusAndCollapseRanges(rowCount - 1, fc ?? cols[0]!);
        } else {
          sel.setFocusAndCollapseRanges(fr == null ? 0 : Math.min(rowCount - 1, fr + 1), fc ?? cols[0]!);
        }
        e.preventDefault();
        return;
      case 'ArrowUp':
        if (e.ctrlKey || e.metaKey) {
          sel.setFocusAndCollapseRanges(0, fc ?? cols[0]!);
        } else {
          sel.setFocusAndCollapseRanges(fr == null ? 0 : Math.max(0, fr - 1), fc ?? cols[0]!);
        }
        e.preventDefault();
        return;
      case 'ArrowRight':
        if (e.ctrlKey || e.metaKey) {
          sel.setFocusAndCollapseRanges(fr ?? 0, cols[cols.length - 1]!);
        } else {
          sel.setFocusAndCollapseRanges(fr ?? 0, cols[Math.min(cols.length - 1, ci + 1)]!);
        }
        e.preventDefault();
        return;
      case 'ArrowLeft':
        if (e.ctrlKey || e.metaKey) {
          sel.setFocusAndCollapseRanges(fr ?? 0, cols[0]!);
        } else {
          sel.setFocusAndCollapseRanges(fr ?? 0, cols[Math.max(0, ci - 1)]!);
        }
        e.preventDefault();
        return;
      case 'Home':
        // Cycle 24 / Task 1 — Ctrl+Home jumps to row 0 / col 0; plain
        // Home is already handled by KeyPaging downstream. Only consume
        // the ctrl variant here so KeyPaging's bare-Home path keeps
        // working.
        if (e.ctrlKey || e.metaKey) {
          sel.setFocusAndCollapseRanges(0, cols[0]!);
          e.preventDefault();
          return;
        }
        break;
      case 'End':
        if (e.ctrlKey || e.metaKey) {
          sel.setFocusAndCollapseRanges(rowCount - 1, cols[cols.length - 1]!);
          e.preventDefault();
          return;
        }
        break;
      case 'Tab': {
        // KeyPaging owns Tab while an editor is open (commit + jump to the
        // next editable cell). When closed, normal cell navigation.
        if (ctx.grid.isEditing()) break;
        // Cycle 24 / Task 6 — at the LAST tabbable cell on Tab (or
        // FIRST on Shift+Tab) consult the app-supplied
        // tabToNextHeader / tabToPreviousHeader callback before
        // wrapping. Returning false from the callback releases focus
        // so the browser's native Tab takes the user OUT of the
        // grid; the grid does NOT preventDefault, so the next
        // focusable element on the page receives focus.
        const atLastCell = !e.shiftKey
          && (fr ?? 0) === rowCount - 1 && ci === cols.length - 1;
        const atFirstCell = e.shiftKey && (fr ?? 0) === 0 && ci === 0;
        if (atLastCell) {
          const cb = ctx.grid.getTabToNextHeader?.();
          if (cb) {
            const wrap = cb({ event: e });
            if (!wrap) return;  // app released focus — let browser handle Tab
            sel.setFocusAndCollapseRanges(0, cols[0]!);
            e.preventDefault();
            return;
          }
        }
        if (atFirstCell) {
          const cb = ctx.grid.getTabToPreviousHeader?.();
          if (cb) {
            const wrap = cb({ event: e });
            if (!wrap) return;
            sel.setFocusAndCollapseRanges(rowCount - 1, cols[cols.length - 1]!);
            e.preventDefault();
            return;
          }
        }
        let nextRow = fr ?? 0;
        let nextCi: number;
        if (e.shiftKey) {
          nextCi = ci - 1;
          if (nextCi < 0) { nextRow = Math.max(0, nextRow - 1); nextCi = cols.length - 1; }
        } else {
          nextCi = ci + 1;
          if (nextCi >= cols.length) { nextRow = Math.min(rowCount - 1, nextRow + 1); nextCi = 0; }
        }
        sel.setFocusAndCollapseRanges(nextRow, cols[nextCi]!);
        e.preventDefault();
        return;
      }
      case ' ':
        if (fr != null) {
          sel.toggleMulti(fr);
          e.preventDefault();
          return;
        }
        break;
      case 'Escape':
        // KeyPaging owns Esc while editing (cancel). When closed, Esc clears
        // both the row selection AND any active cell ranges so the user has
        // a single "blank slate" gesture.
        if (ctx.grid.isEditing()) break;
        sel.clear();
        sel.clearRanges();
        return;
    }
    super.handleKeyDown(ctx);
  }
}
