// KeyPaging — PageDown / PageUp / Home / End, plus the editor keyboard
// matrix (F2 / Esc / Enter / Tab). Arrow-key cell nav lives in
// CellSelection (matches hypergrid's split — keeps focus & visibility
// tightly coupled).
//
// Editor keys split into two halves:
//   - Editor open: Esc cancels; Enter commits (optionally + descend); Tab
//     commits + jumps to the next editable cell.
//   - Editor closed: F2 opens; Enter opens unless `enterNavigatesVertically`
//     is on, in which case Enter walks down by one row.

import { Feature, type CGridEventCtx } from '../feature';

export class KeyPaging extends Feature {
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
    const flags = ctx.grid.getEditingFlags();
    const editing = ctx.grid.isEditing();

    // Type-to-edit (Cycle 5 / Task 5): when no editor is open and the
    // focused cell is editable, a printable character starts the edit
    // with the char as initial value. Excel-mode dispatch tags this path
    // as `'enter'` so arrows commit + nav (when `enableExcelEditing` is
    // on). Modifier-key combos (Ctrl+/Cmd+/Alt+) are ignored so shortcuts
    // like Ctrl+A keep working.
    if (
      !editing && fr != null && fc != null
      && e.key.length === 1
      && !e.ctrlKey && !e.metaKey && !e.altKey
      && ctx.grid.isCellEditable(fr, fc)
    ) {
      ctx.grid.openEditor(fr, fc, e.key, 'enter');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (editing) {
      switch (e.key) {
        case 'Escape':
          ctx.grid.stopEditing(true);
          e.preventDefault();
          return;
        case 'Enter': {
          ctx.grid.stopEditing(false);
          if (flags.enterNavigatesVerticallyAfterEdit && fr != null && fc != null) {
            const dir = e.shiftKey ? -1 : 1;
            sel.setFocus(Math.max(0, Math.min(rowCount - 1, fr + dir)), fc);
          }
          e.preventDefault();
          return;
        }
        case 'Tab': {
          ctx.grid.stopEditing(false);
          if (fr != null && fc != null) {
            const dir = e.shiftKey ? 'backward' : 'forward';
            const next = ctx.grid.nextEditableCell(fr, fc, dir);
            if (next) {
              sel.setFocus(next.rowIndex, next.colId);
              if (!flags.suppressStartEditOnTab) {
                ctx.grid.openEditor(next.rowIndex, next.colId, undefined, 'edit');
              }
            }
          }
          e.preventDefault();
          return;
        }
      }
    } else {
      switch (e.key) {
        case 'F2':
          if (fr != null && fc != null && ctx.grid.isCellEditable(fr, fc)) {
            ctx.grid.openEditor(fr, fc, undefined, 'edit');
            e.preventDefault();
            return;
          }
          break;
        case 'Enter': {
          if (fr == null || fc == null) break;
          if (flags.enterNavigatesVertically) {
            const dir = e.shiftKey ? -1 : 1;
            sel.setFocus(Math.max(0, Math.min(rowCount - 1, fr + dir)), fc);
            e.preventDefault();
            return;
          }
          if (ctx.grid.isCellEditable(fr, fc)) {
            ctx.grid.openEditor(fr, fc, undefined, 'edit');
            e.preventDefault();
            return;
          }
          break;
        }
      }
    }

    switch (e.key) {
      case 'PageDown': {
        const page = Math.max(1, ctx.grid.visibleRowIndices().length);
        sel.setFocus(Math.min(rowCount - 1, (fr ?? 0) + page), fc ?? cols[0]!);
        e.preventDefault();
        return;
      }
      case 'PageUp': {
        const page = Math.max(1, ctx.grid.visibleRowIndices().length);
        sel.setFocus(Math.max(0, (fr ?? 0) - page), fc ?? cols[0]!);
        e.preventDefault();
        return;
      }
      case 'Home':
        sel.setFocus(fr ?? 0, cols[0]!);
        e.preventDefault();
        return;
      case 'End':
        sel.setFocus(fr ?? 0, cols[cols.length - 1]!);
        e.preventDefault();
        return;
    }
    super.handleKeyDown(ctx);
  }
}
