// RangeSelection — drag a cell-range with the pointer. Mousedown on a data
// cell anchors a 1×1 range; subsequent drag ticks widen it to span every row
// between the anchor and the current cell, and every column between the
// anchor's colId and the current cell's colId in render order. Mouseup
// commits — the range stays on the SelectionModel, the feature returns to
// idle, and a follow-up drag with no preceding mousedown is a no-op.
//
// The plain-drag pathway lives here; Shift/Ctrl modifier semantics (extend
// the last range, add a disjoint range) layer on top in Task 4. The
// rangeSelectionChanged event lands in Task 7.
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
    // Task 4 layers Shift / Ctrl semantics on top. For plain drag (this
    // task), only an unmodified click anchors a new range; modifier presses
    // fall through to downstream features and will be picked up in Task 4.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      super.handleMouseDown(ctx);
      return;
    }
    this.state = { anchorRowIndex: ctx.hit.rowIndex, anchorColId: ctx.hit.colId };
    ctx.grid.selection.setRanges([{
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
