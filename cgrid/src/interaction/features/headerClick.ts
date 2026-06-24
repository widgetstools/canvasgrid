// HeaderClick — cycles sort on a column when its header is clicked.

import { Feature, type CGridEventCtx } from '../feature';

export class HeaderClick extends Feature {
  override handleClick(ctx: CGridEventCtx): void {
    if (ctx.hit.kind === 'header') {
      ctx.grid.cycleSort(ctx.hit.colId);
      return;
    }
    if (ctx.hit.kind === 'headerGroup') {
      ctx.grid.toggleColumnGroup(ctx.hit.groupId);
      return;
    }
    super.handleClick(ctx);
  }
}
