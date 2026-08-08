// CellSelection — handles cell focus + selection modifiers on mousedown,
// emits cellClicked/cellDoubleClicked, and owns arrow / Tab / Space / F2 /
// Enter / Escape keyboard navigation.

import { Feature, type VelocityGridEventCtx } from '../feature';

export class CellSelection extends Feature {
  override handleMouseDown(ctx: VelocityGridEventCtx): void {
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
    // Grid-level `suppressRowClickSelection` — focus still moved
    // above, but the row-selection set MUST NOT mutate from a body
    // click. Apps that opt in have wired a checkbox column for the
    // selection gesture.
    if (ctx.grid.isRowClickSelectionSuppressed?.()) {
      return;
    }
    if (e.shiftKey) {
      if (prevFocus != null) sel.range(prevFocus, ctx.hit.rowIndex);
    } else if (e.ctrlKey || e.metaKey) {
      sel.toggleMulti(ctx.hit.rowIndex);
    } else if (ctx.grid.isRowMultiSelectWithClick?.()) {
      // Grid-level `rowMultiSelectWithClick` — plain click toggles
      // the row in/out of the selection set without requiring a
      // Ctrl/Cmd modifier. Mirrors the checkbox-list pattern in
      // email clients / file managers.
      sel.toggleMulti(ctx.hit.rowIndex);
    } else {
      sel.selectSingle(ctx.hit.rowIndex);
    }
    // Consume — fully handled.
  }

  override handleClick(ctx: VelocityGridEventCtx): void {
    if (ctx.hit.kind === 'cell') {
      ctx.grid.emitCellClicked(ctx.hit.rowIndex, ctx.hit.colId, ctx.raw as MouseEvent);
      return;
    }
    super.handleClick(ctx);
  }

  override handleDoubleClick(ctx: VelocityGridEventCtx): void {
    if (ctx.hit.kind === 'cell') {
      ctx.grid.emitCellDoubleClicked(ctx.hit.rowIndex, ctx.hit.colId, ctx.raw as MouseEvent);
      return;
    }
    super.handleDoubleClick(ctx);
  }

  override handleKeyDown(ctx: VelocityGridEventCtx): void {
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

    // Cycle 24 / Task 1 (follow-up) — Shift+Arrow grows the active
    // cell range toward the new target; Ctrl+Shift+Arrow grows it to
    // the data boundary. The bare-Arrow path stays exactly as it was
    // (move + collapse to a 1×1 range at the new focused cell). The
    // Ctrl-only path (no Shift) jumps focus to the data boundary +
    // collapses ranges — same as bare-Arrow but with the boundary
    // target.
    const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp'
      || e.key === 'ArrowRight' || e.key === 'ArrowLeft';
    if (isArrow) {
      const ctrl = e.ctrlKey || e.metaKey;
      let targetRow = fr ?? 0;
      let targetColIndex = ci;
      switch (e.key) {
        case 'ArrowDown':
          targetRow = ctrl ? rowCount - 1 : Math.min(rowCount - 1, (fr ?? -1) + 1);
          break;
        case 'ArrowUp':
          targetRow = ctrl ? 0 : Math.max(0, (fr ?? 1) - 1);
          break;
        case 'ArrowRight':
          targetColIndex = ctrl ? cols.length - 1 : Math.min(cols.length - 1, ci + 1);
          break;
        case 'ArrowLeft':
          targetColIndex = ctrl ? 0 : Math.max(0, ci - 1);
          break;
      }
      const targetCol = cols[targetColIndex]!;
      if (e.shiftKey) {
        // Seed a range on the focused cell when none exists yet — the
        // user's first Shift+Arrow press should produce a 2-cell range
        // (focus + neighbor), NOT a no-op.
        if (sel.getRanges().length === 0 && fr != null && fc != null) {
          sel.addRange({ rowStart: fr, rowEnd: fr, colIds: [fc] });
        }
        sel.extendLastRangeToCell(targetRow, targetCol, cols);
        // Move focus without collapsing the range we just grew.
        sel.setFocus(targetRow, targetCol);
        ctx.grid.emitRangeSelectionChanged?.(false, true);
      } else {
        sel.setFocusAndCollapseRanges(targetRow, targetCol);
      }
      e.preventDefault();
      return;
    }
    switch (e.key) {
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
          // Conventional / ag-grid parity — Shift+Space extends a row
          // range from the FIRST currently-selected row (the anchor)
          // to the focused row. Without a prior selection, falls back
          // to a single-row toggle so the first press still
          // produces a useful row selection.
          if (e.shiftKey) {
            const anchor = sel.state.selectedRowIndices.values().next().value as number | undefined;
            if (anchor != null) {
              sel.range(anchor, fr);
            } else {
              sel.toggleMulti(fr);
            }
          } else {
            sel.toggleMulti(fr);
          }
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
