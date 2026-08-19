// ColumnResizing — header right-edge ±hot-zone drag to resize columns.
//
// FeatureChain attaches window mousemove/mouseup listeners while the mouse
// button is down, so handleMouseDrag fires for every drag tick even when the
// pointer leaves the canvas.

import { Feature, type VelocityGridLike, type VelocityGridEventCtx } from '../feature';

export class ColumnResizing extends Feature {
  // `edge` records whether the drag started on the column's left or right
  // edge. For left-edge drags (only legal on right-pinned columns) the
  // delta is inverted before being passed to `resizeColumn`: dragging the
  // cursor LEFT grows the column (because its right edge is anchored to
  // the canvas right edge), and dragging RIGHT shrinks it.
  private resizing: { colId: string; lastX: number; edge: 'left' | 'right' } | null = null;
  /** True once this press applied at least one non-zero resize delta.
   *  Used to swallow the trailing browser `click` so HeaderClick does
   *  not also cycle sort after a real resize. Cleared on the next click
   *  (consumed) or the next mousedown (defensive). */
  private suppressNextClick = false;
  /** True while a resizer press is active, whether or not width changed. */
  private didResize = false;

  override handleMouseDown(ctx: VelocityGridEventCtx): void {
    this.suppressNextClick = false;
    if (ctx.hit.kind === 'headerResizer') {
      this.resizing = { colId: ctx.hit.colId, lastX: ctx.point.x, edge: ctx.hit.edge };
      this.didResize = false;
      // Consume — do not forward; CellSelection must not steal focus.
      return;
    }
    super.handleMouseDown(ctx);
  }

  override handleMouseDrag(ctx: VelocityGridEventCtx): void {
    if (this.resizing) {
      const rawDx = ctx.point.x - this.resizing.lastX;
      const dx = this.resizing.edge === 'left' ? -rawDx : rawDx;
      if (dx) {
        ctx.grid.resizeColumn(this.resizing.colId, dx);
        this.resizing.lastX = ctx.point.x;
        this.didResize = true;
      }
      return;
    }
    super.handleMouseDrag(ctx);
  }

  override handleMouseUp(ctx: VelocityGridEventCtx): void {
    if (this.resizing) {
      const finishedColId = this.resizing.colId;
      const resized = this.didResize;
      this.resizing = null;
      this.didResize = false;
      // Fire the trailing finished:true companion to the per-tick
      // finished:false emissions so apps that persist on mouseup only
      // fire once per drag. Cycle 6 / Task 5.
      ctx.grid.finishColumnResize(finishedColId);
      // Only swallow the trailing click after a real width change. A
      // plain click on the resizer hot-zone (sort-indicator side of the
      // header) must still reach HeaderClick.
      if (resized) this.suppressNextClick = true;
      return;
    }
    super.handleMouseUp(ctx);
  }

  /** Reset in-flight resize state without touching the grid. Used by
   *  `FeatureChain.destroy()` mid-resize, when the grid may already be
   *  torn down and calling back into it (`finishColumnResize`) would be
   *  unsafe. */
  resetDragState(): void {
    this.resizing = null;
    this.didResize = false;
  }

  /** External cancel — `pointercancel` / window `blur` / tab hidden while
   *  a resize is in progress. The DOM `mouseup` used to be the only path
   *  that reset `columnResizeDragActive` (which gates the fast paint-cache
   *  path grid-wide); a lost mouseup left the grid stranded on the slow
   *  paint path forever. Mirrors `handleMouseUp`'s cleanup by calling the
   *  same `finishColumnResize` grid hook. No-op when not resizing. */
  cancelResize(grid: VelocityGridLike): void {
    if (!this.resizing) return;
    const colId = this.resizing.colId;
    this.resetDragState();
    grid.finishColumnResize(colId);
  }

  override handleClick(ctx: VelocityGridEventCtx): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    super.handleClick(ctx);
  }

  override handleDoubleClick(ctx: VelocityGridEventCtx): void {
    if (ctx.hit.kind === 'headerResizer') {
      void ctx.grid.autoSizeColumn(ctx.hit.colId);
      return;
    }
    super.handleDoubleClick(ctx);
  }

  override handleMouseMove(ctx: VelocityGridEventCtx): void {
    this.cursor = ctx.hit.kind === 'headerResizer' ? 'col-resize' : null;
    super.handleMouseMove(ctx);
  }
}
