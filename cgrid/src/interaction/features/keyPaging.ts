// KeyPaging — PageDown / PageUp / Home / End. Arrow-key cell nav lives in
// CellSelection (matches hypergrid's split — keeps focus & visibility tightly
// coupled).

import { Feature, type CGridEventCtx } from '../feature';

export class KeyPaging extends Feature {
  override handleKeyDown(ctx: CGridEventCtx): void {
    const sel = ctx.grid.selection;
    const cols = ctx.grid.allColIds();
    const rowCount = ctx.grid.totalRowCount();
    if (rowCount === 0 || cols.length === 0) {
      super.handleKeyDown(ctx);
      return;
    }
    const e = ctx.raw as KeyboardEvent;
    const { focusedRowIndex: fr, focusedColId: fc } = sel.state;
    switch (e.key) {
      case 'PageDown': {
        const page = Math.max(1, ctx.grid.visibleRowIndices().length);
        sel.setFocus(Math.min(rowCount - 1, (fr ?? 0) + page), fc ?? cols[0]!);
        e.preventDefault();
        return;
      }
      case 'PageUp': {
        const page = Math.max(1, ctx.grid.visibleRowIndices().length);
        sel.setFocus(Math.max(0, (fr ?? 0) - page), fc ?? cols[0]!);
        e.preventDefault();
        return;
      }
      case 'Home':
        sel.setFocus(fr ?? 0, cols[0]!);
        e.preventDefault();
        return;
      case 'End':
        sel.setFocus(fr ?? 0, cols[cols.length - 1]!);
        e.preventDefault();
        return;
    }
    super.handleKeyDown(ctx);
  }
}
