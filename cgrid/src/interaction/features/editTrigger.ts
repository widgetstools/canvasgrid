// EditTrigger — owns mouse + keyboard gating for entering edit mode.
//
// Sits at the head of the input chain (right after ColumnResizing). Mouse:
// resolves `singleClickEdit` (column wins over grid), `suppressClickEdit`,
// and the `editable` predicate to decide whether a click / dblclick opens
// the editor. Keyboard: forwards `CColDef.suppressKeyboardEvent` so apps
// can swallow keys before any other feature (CellSelection, KeyPaging)
// reacts.
//
// The chain continues via `super.handleX(ctx)` so CellSelection still sets
// focus, emits cellClicked / cellDoubleClicked, and KeyPaging still routes
// editing keys (F2 / Esc / Enter / Tab) — see those features for the
// "what happens when an editor is already open" half of the surface.

import { Feature, type CGridEventCtx } from '../feature';

export class EditTrigger extends Feature {
  override handleClick(ctx: CGridEventCtx): void {
    // Let CellSelection set focus + emit cellClicked first.
    super.handleClick(ctx);
    if (ctx.hit.kind !== 'cell') return;
    const grid = ctx.grid;
    if (grid.isEditing()) return;
    const flags = grid.getEditingFlags();
    if (flags.suppressClickEdit) return;
    const single = grid.isColSingleClickEdit(ctx.hit.colId) ?? flags.singleClickEdit;
    if (!single) return;
    if (!grid.isCellEditable(ctx.hit.rowIndex, ctx.hit.colId)) return;
    grid.openEditor(ctx.hit.rowIndex, ctx.hit.colId);
  }

  override handleDoubleClick(ctx: CGridEventCtx): void {
    super.handleDoubleClick(ctx);
    if (ctx.hit.kind !== 'cell') return;
    const grid = ctx.grid;
    if (grid.isEditing()) return;
    const flags = grid.getEditingFlags();
    if (flags.suppressClickEdit) return;
    if (!grid.isCellEditable(ctx.hit.rowIndex, ctx.hit.colId)) return;
    grid.openEditor(ctx.hit.rowIndex, ctx.hit.colId);
  }

  override handleKeyDown(ctx: CGridEventCtx): void {
    // Head-of-chain suppressKeyboardEvent: when the focused column's
    // callback returns true, swallow the event entirely so nothing
    // downstream (CellSelection, KeyPaging) reacts.
    const fc = ctx.grid.selection.state.focusedColId;
    if (fc != null) {
      const cb = ctx.grid.getColSuppressKeyboardEvent(fc);
      if (cb) {
        const fr = ctx.grid.selection.state.focusedRowIndex ?? 0;
        const data = ctx.grid.getRowDataAt(fr);
        const editing = ctx.grid.isEditing();
        if (cb({ event: ctx.raw as KeyboardEvent, editing, data, colId: fc })) return;
      }
    }
    super.handleKeyDown(ctx);
  }
}
