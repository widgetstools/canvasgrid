// HeaderClick — cycles sort on a column when its header is clicked.
//
// Cycle 8 / Task 1 — when `multiSortKey` is set and the matching
// modifier is held, the click APPENDS to the existing sort model
// instead of replacing it. The grid resolves the configured key
// via `getMultiSortKey()`; we read the matching DOM modifier off
// the raw MouseEvent.
//
// Cycle 9 / Task 4 — every header click ALSO selects the whole column
// via `grid.selectColumn(colId, { extend })`. Shift selects a column
// band from the previous anchor through the clicked header (render
// order); plain click replaces with a single full-column rect. Sort
// cycling and column selection are additive — both fire on the same
// click so existing keyboard-paged sort UX keeps working while range
// users get the column band they expect.

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
      // Row-select header checkbox — when the column declares
      // `headerCheckboxSelection: true`, the entire header rect is
      // the click target for the select-all / clear-all toggle. The
      // sort cycle + column-band selection are skipped on these
      // columns so the gesture stays unambiguous (you can't sort a
      // pure checkbox column anyway).
      if (ctx.grid.isHeaderCheckboxSelectionColumn?.(ctx.hit.colId)) {
        ctx.grid.toggleHeaderCheckbox?.(ctx.hit.colId);
        ctx.grid.canvas.requestRepaint();
        return;
      }
      const append = isAppendClick(ctx.raw, ctx.grid.getMultiSortKey());
      ctx.grid.cycleSort(ctx.hit.colId, { append });
      // Cycle 9 / Task 6 — skip the column-band selection when
      // `cellSelection.suppressHeader` is set. Sort cycling above still
      // runs so apps that disable range selection don't lose sort UX.
      // Read at event time so a runtime `setGridOption('cellSelection',
      // …)` takes effect on the next click.
      if (ctx.grid.getCellSelectionOptions()?.suppressHeader !== true) {
        const extend = ctx.raw instanceof MouseEvent && ctx.raw.shiftKey;
        ctx.grid.selectColumn(ctx.hit.colId, { extend });
      }
      return;
    }
    if (ctx.hit.kind === 'headerGroup') {
      // Cycle 18 / Task 4 follow-up — only toggle when the group has a
      // closed-state fallback child (the painter only paints a chevron
      // on these groups too). Leaf pivot groups have NO totals leaf to
      // fall back on, so toggling them would hide every value-col leaf
      // with nothing to show — the user reported this as "clicking on
      // any cell of the sector row hides that column".
      if (ctx.grid.canToggleColumnGroup(ctx.hit.groupId)) {
        ctx.grid.toggleColumnGroup(ctx.hit.groupId);
      }
      return;
    }
    super.handleClick(ctx);
  }
}
