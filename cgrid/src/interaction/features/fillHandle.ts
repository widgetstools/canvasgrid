// FillHandle — drag the 6×6 square at the bottom-right of the focused range
// to extend the selection and commit a fill on release.
//
// Chain position: AHEAD of RangeSelection. The handle hit zone overlaps the
// last range's bottom-right cell, so without first-claim priority the user
// would get a fresh range drag whenever they tried to drag the handle.
// Forwarding from FillHandle on a non-hit lets RangeSelection see every
// other cell mousedown unchanged.
//
// State machine: idle → dragging(source) → idle. On the claimed mousedown
// we snapshot the LAST range as the source, then extend it on each drag
// tick. Mouseup → grid.commitFill(source, currentLast); the cgrid host
// handles row fetch, extrapolation, and the single applyTransaction.
//
// Direction modes (`CGridOptions.fillHandleDirection`):
//   - `'y'` (default) — only `rowEnd` grows; colIds stay fixed.
//   - `'x'`           — only colIds grow rightward; rows stay fixed.
//   - `'xy'`          — the axis with the larger pointer delta from the
//                       handle wins, then locked for the rest of the drag.
//
// The rangeSelectionChanged event for fill-handle drags lands in Task 7.

import { Feature, type CGridEventCtx } from '../feature';
import type { SelectionRange } from '../../types';

/** Half-side of the square hit zone — pointer must be within ±3 px of the
 *  range's bottom-right corner on both axes. Matches the 6×6 paint size. */
const HANDLE_HALF_PX = 3;

interface DragState {
  /** Snapshot of the source range as it stood at mousedown. The commit
   *  step uses this to project values from the source rect onto the
   *  newly-extended cells. */
  source: SelectionRange;
  /** Resolved drag axis. `'y'` extends rows; `'x'` extends columns. */
  axis: 'x' | 'y';
}

export class FillHandle extends Feature {
  private state: DragState | null = null;

  override handleMouseDown(ctx: CGridEventCtx): void {
    if (ctx.hit.kind !== 'cell') {
      super.handleMouseDown(ctx);
      return;
    }
    if (!ctx.grid.getEnableFillHandle()) {
      super.handleMouseDown(ctx);
      return;
    }
    const ranges = ctx.grid.selection.getRanges();
    if (ranges.length === 0) {
      super.handleMouseDown(ctx);
      return;
    }
    const last = ranges[ranges.length - 1]!;
    const corner = ctx.grid.getRangeBottomRight(last);
    if (corner === null) {
      super.handleMouseDown(ctx);
      return;
    }
    const dx = ctx.point.x - corner.x;
    const dy = ctx.point.y - corner.y;
    if (Math.abs(dx) > HANDLE_HALF_PX || Math.abs(dy) > HANDLE_HALF_PX) {
      super.handleMouseDown(ctx);
      return;
    }
    // Claim. The fill axis is decided up-front from the option (defaults
    // to 'y'); 'xy' resolves to whichever axis the pointer favors at
    // mousedown — locked for the rest of the drag so a wobble doesn't
    // flip the fill mid-gesture.
    const dirOpt = ctx.grid.getFillHandleDirection();
    const axis: 'x' | 'y' = dirOpt === 'xy'
      ? (Math.abs(dx) > Math.abs(dy) ? 'x' : 'y')
      : dirOpt;
    this.state = {
      source: { rowStart: last.rowStart, rowEnd: last.rowEnd, colIds: [...last.colIds] },
      axis,
    };
    // Consume — downstream features must not see the fill press as a
    // fresh range anchor.
  }

  override handleMouseDrag(ctx: CGridEventCtx): void {
    if (this.state === null) {
      super.handleMouseDrag(ctx);
      return;
    }
    if (ctx.hit.kind !== 'cell') return;
    const src = this.state.source;
    if (this.state.axis === 'y') {
      // Extend rowEnd downward; rowStart + colIds frozen at source.
      const nextRowEnd = Math.max(src.rowEnd, ctx.hit.rowIndex);
      ctx.grid.selection.setRanges([{
        rowStart: src.rowStart, rowEnd: nextRowEnd, colIds: [...src.colIds],
      }]);
      return;
    }
    // axis === 'x' — extend colIds rightward in render order; rows frozen.
    const allCols = ctx.grid.allColIds();
    const srcLastIdx = allCols.indexOf(src.colIds[src.colIds.length - 1]!);
    const hitIdx = allCols.indexOf(ctx.hit.colId);
    if (srcLastIdx < 0 || hitIdx < 0) return;
    const srcFirstIdx = allCols.indexOf(src.colIds[0]!);
    if (srcFirstIdx < 0) return;
    const hi = Math.max(srcLastIdx, hitIdx);
    // Slice from the original first column to the new high index — keeps
    // the source's leading columns intact and only grows on the right.
    const nextColIds = allCols.slice(srcFirstIdx, hi + 1);
    ctx.grid.selection.setRanges([{
      rowStart: src.rowStart, rowEnd: src.rowEnd, colIds: nextColIds,
    }]);
  }

  override handleMouseUp(ctx: CGridEventCtx): void {
    const state = this.state;
    this.state = null;
    if (state === null) {
      super.handleMouseUp(ctx);
      return;
    }
    const ranges = ctx.grid.selection.getRanges();
    if (ranges.length === 0) return;
    const target = ranges[ranges.length - 1]!;
    const src = state.source;
    // Skip commit when nothing actually extended (a click without drag).
    // The cheap structural check avoids spinning up a no-op transaction.
    const noChange = target.rowStart === src.rowStart
      && target.rowEnd === src.rowEnd
      && target.colIds.length === src.colIds.length
      && target.colIds.every((c, i) => c === src.colIds[i]);
    if (noChange) return;
    ctx.grid.commitFill(src, target);
  }
}
