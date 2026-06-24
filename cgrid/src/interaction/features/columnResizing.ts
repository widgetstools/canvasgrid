// ColumnResizing — header right-edge ±hot-zone drag to resize columns.
//
// FeatureChain attaches window mousemove/mouseup listeners while the mouse
// button is down, so handleMouseDrag fires for every drag tick even when the
// pointer leaves the canvas.

import { Feature, type CGridEventCtx } from '../feature';

export class ColumnResizing extends Feature {
  private resizing: { colId: string; lastX: number } | null = null;

  override handleMouseDown(ctx: CGridEventCtx): void {
    if (ctx.hit.kind === 'headerResizer') {
      this.resizing = { colId: ctx.hit.colId, lastX: ctx.point.x };
      // Consume — do not forward; CellSelection must not steal focus.
      return;
    }
    super.handleMouseDown(ctx);
  }

  override handleMouseDrag(ctx: CGridEventCtx): void {
    if (this.resizing) {
      const dx = ctx.point.x - this.resizing.lastX;
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
      this.resizing = null;
      return;
    }
    super.handleMouseUp(ctx);
  }

  override handleMouseMove(ctx: CGridEventCtx): void {
    this.cursor = ctx.hit.kind === 'headerResizer' ? 'col-resize' : null;
    super.handleMouseMove(ctx);
  }
}
