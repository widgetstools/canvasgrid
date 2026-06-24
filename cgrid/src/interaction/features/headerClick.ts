// HeaderClick — cycles sort on a column when its header is clicked.

import { Feature, type CGridEventCtx } from '../feature';

export class HeaderClick extends Feature {
  override handleClick(ctx: CGridEventCtx): void {
    if (ctx.hit.kind === 'header') {
      ctx.grid.cycleSort(ctx.hit.colId);
      return;
    }
    super.handleClick(ctx);
  }
}
