// RangeSelection — drag a cell-range with the pointer. Mousedown on a data
// cell anchors a 1×1 range; subsequent drag ticks widen it to span every row
// between the anchor and the current cell, and every column between the
// anchor's colId and the current cell's colId in render order. Mouseup
// commits — the range stays on the SelectionModel, the feature returns to
// idle, and a follow-up drag with no preceding mousedown is a no-op.
//
// Cycle 9 / Task 4 layers two modifier semantics on the same mousedown:
//   - Shift-click EXTENDS the last range from its existing rect to cover
//     the clicked cell. No drag state is set — shift-click is a discrete
//     extend, not a "drag from here" gesture. Falls back to plain-anchor
//     when no range exists yet.
//   - Ctrl/Cmd-click ADDS a new disjoint 1x1 range, preserving existing
//     ranges. Mirrors ag-grid's "hold ctrl to add another rectangle."
// In both modifier paths we still forward via `super.handleMouseDown` so
// CellSelection runs its shift-range / ctrl-toggle row-selection logic on
// the same press. Shift takes priority when both shift+ctrl are held.
//
// The rangeSelectionChanged event lands in Task 7.
//
// Chain position: ahead of CellSelection. CellSelection consumes cell
// mousedowns to set focus + row selection; placing RangeSelection earlier
// lets us claim the range first, then forward via `super.handleMouseDown`
// so focus + row selection still happen on the same press.

import { Feature, type CGridEventCtx } from '../feature';

interface DragState {
  /** Row index hit at mousedown. The range's rowStart = min(anchor, current),
   *  rowEnd = max(anchor, current). */
  anchorRowIndex: number;
  /** ColId hit at mousedown. The range's colIds = the render-order slice
   *  from min(anchorColIndex, currentColIndex) to max(anchorColIndex,
   *  currentColIndex). */
  anchorColId: string;
}

export class RangeSelection extends Feature {
  private state: DragState | null = null;

  override handleMouseDown(ctx: CGridEventCtx): void {
    if (ctx.hit.kind !== 'cell') {
      super.handleMouseDown(ctx);
      return;
    }
    const e = ctx.raw as MouseEvent;
    const sel = ctx.grid.selection;
    // Shift-click: discrete extend of the last range. Falls back to a fresh
    // 1x1 anchor when no range exists yet so the first shift-click of a
    // session still gives the user something to extend from. No drag state
    // — a shift-mousedown is not a "drag from here" gesture.
    if (e.shiftKey) {
      if (sel.getRanges().length === 0) {
        sel.setRanges([{
          rowStart: ctx.hit.rowIndex,
          rowEnd: ctx.hit.rowIndex,
          colIds: [ctx.hit.colId],
        }]);
      } else {
        sel.extendLastRangeToCell(ctx.hit.rowIndex, ctx.hit.colId, ctx.grid.allColIds());
      }
      this.state = null;
      super.handleMouseDown(ctx);
      return;
    }
    // Ctrl/Cmd-click: add a new disjoint 1x1 range. Existing ranges stay.
    // No drag state — a follow-up drag here would clobber the disjoint set.
    if (e.ctrlKey || e.metaKey) {
      sel.addRange({
        rowStart: ctx.hit.rowIndex,
        rowEnd: ctx.hit.rowIndex,
        colIds: [ctx.hit.colId],
      });
      this.state = null;
      super.handleMouseDown(ctx);
      return;
    }
    this.state = { anchorRowIndex: ctx.hit.rowIndex, anchorColId: ctx.hit.colId };
    sel.setRanges([{
      rowStart: ctx.hit.rowIndex,
      rowEnd: ctx.hit.rowIndex,
      colIds: [ctx.hit.colId],
    }]);
    // Forward so CellSelection still sets focus + row selection on the
    // same press. CellSelection consumes the cell mousedown, so anything
    // after it won't see this event — that's fine; range work is done.
    super.handleMouseDown(ctx);
  }

  override handleMouseDrag(ctx: CGridEventCtx): void {
    if (this.state === null) {
      super.handleMouseDrag(ctx);
      return;
    }
    // Drag tick outside the data area (pointer drifted into the header
    // band, scrollbar gutter, or off the canvas) — keep the last range
    // instead of clobbering it.
    if (ctx.hit.kind !== 'cell') return;

    const allCols = ctx.grid.allColIds();
    const aColIdx = allCols.indexOf(this.state.anchorColId);
    const bColIdx = allCols.indexOf(ctx.hit.colId);
    // If either column is gone (mid-drag column removal), keep the last
    // range. The next valid drag tick will resync.
    if (aColIdx < 0 || bColIdx < 0) return;

    const rowStart = Math.min(this.state.anchorRowIndex, ctx.hit.rowIndex);
    const rowEnd = Math.max(this.state.anchorRowIndex, ctx.hit.rowIndex);
    const colLo = Math.min(aColIdx, bColIdx);
    const colHi = Math.max(aColIdx, bColIdx);
    const colIds = allCols.slice(colLo, colHi + 1);

    ctx.grid.selection.setRanges([{ rowStart, rowEnd, colIds }]);
  }

  override handleMouseUp(ctx: CGridEventCtx): void {
    if (this.state === null) {
      super.handleMouseUp(ctx);
      return;
    }
    // Commit-in-place: the last drag tick already wrote the final range
    // onto the SelectionModel. Returning to idle is the entire commit.
    this.state = null;
    super.handleMouseUp(ctx);
  }
}
