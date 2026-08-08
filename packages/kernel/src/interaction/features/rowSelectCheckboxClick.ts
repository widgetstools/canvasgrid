/**
 * Click handler for `CColDef.checkboxSelection` columns.
 *
 * Sits near the HEAD of the feature chain so it claims clicks on
 * checkbox columns before RangeSelection (which would create a cell
 * range overlay) and before CellSelection (which would replace the
 * row-selection set with a `selectSingle`). The checkbox cell is a
 * pure row-toggle gesture: clicking it does NOT focus the cell,
 * does NOT create a range, does NOT participate in any of the
 * other selection vocabularies — it just flips the row's membership
 * in `selectedRowIndices`.
 *
 * No-op for any non-cell hit, any column without
 * `checkboxSelection: true`, or any modifier-key press other than
 * Shift (which extends the selection from the anchor — mirrors the
 * checkbox-list pattern users know from email clients).
 */
import { Feature, type VelocityGridEventCtx } from '../feature';

export class RowSelectCheckboxClick extends Feature {
  override handleMouseDown(ctx: VelocityGridEventCtx): void {
    if (ctx.hit.kind !== 'cell') {
      super.handleMouseDown(ctx);
      return;
    }
    if (!ctx.grid.isCheckboxSelectionColumn?.(ctx.hit.colId)) {
      super.handleMouseDown(ctx);
      return;
    }
    const e = ctx.raw as MouseEvent;
    if (e.button !== 0) {
      // Right-click on the checkbox falls through so the context
      // menu still opens.
      super.handleMouseDown(ctx);
      return;
    }
    const sel = ctx.grid.selection;
    if (e.shiftKey) {
      // Shift+click on a checkbox extends the row range from the
      // anchor (first selected row) to the clicked row. Mirrors the
      // checkbox-list pattern in email clients / file managers.
      const anchor = sel.state.selectedRowIndices.values().next().value as number | undefined;
      if (anchor != null) sel.range(anchor, ctx.hit.rowIndex);
      else sel.toggleMulti(ctx.hit.rowIndex);
    } else {
      sel.toggleMulti(ctx.hit.rowIndex);
    }
    ctx.grid.canvas.requestRepaint();
    // Consume — do NOT forward via super. Downstream features would
    // otherwise replace the row-selection set or create a cell
    // range, both of which contradict the gesture.
  }

  override handleClick(ctx: VelocityGridEventCtx): void {
    // Swallow the trailing click event for checkbox cells so
    // `cellClicked` doesn't fire — the gesture is a toggle, not a
    // cell selection.
    if (ctx.hit.kind === 'cell'
        && ctx.grid.isCheckboxSelectionColumn?.(ctx.hit.colId)) {
      return;
    }
    super.handleClick(ctx);
  }
}
