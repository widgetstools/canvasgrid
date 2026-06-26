// HeaderClick — cycles sort on a column when its header is clicked.
//
// Cycle 8 / Task 1 — when `multiSortKey` is set and the matching
// modifier is held, the click APPENDS to the existing sort model
// instead of replacing it. The grid resolves the configured key
// via `getMultiSortKey()`; we read the matching DOM modifier off
// the raw MouseEvent.

import { Feature, type CGridEventCtx } from '../feature';

function isAppendClick(
  raw: MouseEvent | KeyboardEvent | WheelEvent,
  key: 'Shift' | 'Ctrl' | 'Alt' | null,
): boolean {
  if (key === null) return false;
  if (!(raw instanceof MouseEvent)) return false;
  if (key === 'Shift') return raw.shiftKey;
  if (key === 'Ctrl') return raw.ctrlKey;
  return raw.altKey;
}

export class HeaderClick extends Feature {
  override handleClick(ctx: CGridEventCtx): void {
    if (ctx.hit.kind === 'header') {
      const append = isAppendClick(ctx.raw, ctx.grid.getMultiSortKey());
      ctx.grid.cycleSort(ctx.hit.colId, { append });
      return;
    }
    if (ctx.hit.kind === 'headerGroup') {
      ctx.grid.toggleColumnGroup(ctx.hit.groupId);
      return;
    }
    super.handleClick(ctx);
  }
}
