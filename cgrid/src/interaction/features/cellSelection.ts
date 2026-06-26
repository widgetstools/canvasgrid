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
        sel.setFocusAndCollapseRanges(fr == null ? 0 : Math.min(rowCount - 1, fr + 1), fc ?? cols[0]!);
        e.preventDefault();
        return;
      case 'ArrowUp':
        sel.setFocusAndCollapseRanges(fr == null ? 0 : Math.max(0, fr - 1), fc ?? cols[0]!);
        e.preventDefault();
        return;
      case 'ArrowRight':
        sel.setFocusAndCollapseRanges(fr ?? 0, cols[Math.min(cols.length - 1, ci + 1)]!);
        e.preventDefault();
        return;
      case 'ArrowLeft':
        sel.setFocusAndCollapseRanges(fr ?? 0, cols[Math.max(0, ci - 1)]!);
        e.preventDefault();
        return;
      case 'Tab': {
        // KeyPaging owns Tab while an editor is open (commit + jump to the
        // next editable cell). When closed, normal cell navigation.
        if (ctx.grid.isEditing()) break;
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
