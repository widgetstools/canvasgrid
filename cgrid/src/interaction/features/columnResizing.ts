// ColumnResizing — header right-edge ±hot-zone drag to resize columns.
//
// FeatureChain attaches window mousemove/mouseup listeners while the mouse
// button is down, so handleMouseDrag fires for every drag tick even when the
// pointer leaves the canvas.

import { Feature, type CGridEventCtx } from '../feature';

export class ColumnResizing extends Feature {
  // `edge` records whether the drag started on the column's left or right
  // edge. For left-edge drags (only legal on right-pinned columns) the
  // delta is inverted before being passed to `resizeColumn`: dragging the
  // cursor LEFT grows the column (because its right edge is anchored to
  // the canvas right edge), and dragging RIGHT shrinks it.
  private resizing: { colId: string; lastX: number; edge: 'left' | 'right' } | null = null;

  override handleMouseDown(ctx: CGridEventCtx): void {
    if (ctx.hit.kind === 'headerResizer') {
      this.resizing = { colId: ctx.hit.colId, lastX: ctx.point.x, edge: ctx.hit.edge };
      // Consume — do not forward; CellSelection must not steal focus.
      return;
    }
    super.handleMouseDown(ctx);
  }

  override handleMouseDrag(ctx: CGridEventCtx): void {
    if (this.resizing) {
      const rawDx = ctx.point.x - this.resizing.lastX;
      const dx = this.resizing.edge === 'left' ? -rawDx : rawDx;
      if (dx) {
        ctx.grid.resizeColumn(this.resizing.colId, dx);
        this.resizing.lastX = ctx.point.x;
      }
      return;
    }
    super.handleMouseDrag(ctx);
  }

  override handleMouseUp(ctx: CGridEventCtx): void {
    if (this.resizing) {
      const finishedColId = this.resizing.colId;
      this.resizing = null;
      // Fire the trailing finished:true companion to the per-tick
      // finished:false emissions so apps that persist on mouseup only
      // fire once per drag. Cycle 6 / Task 5.
      ctx.grid.finishColumnResize(finishedColId);
      return;
    }
    super.handleMouseUp(ctx);
  }

  override handleMouseMove(ctx: CGridEventCtx): void {
    this.cursor = ctx.hit.kind === 'headerResizer' ? 'col-resize' : null;
    super.handleMouseMove(ctx);
  }
}
