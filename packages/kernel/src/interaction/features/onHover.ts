// OnHover — tracks the hovered cell/header and requests a repaint when it
// changes so painters can render a hover background. Sets `pointer` cursor on
// header hover (lower priority than ColumnResizing's `col-resize`).
//
// Cycle 23 / Task 2 — also fans out cellMouseOver/Out + rowMouseOver/Out
// events as the pointer crosses cell/row boundaries. Coalescing is per
// transition (NEVER per pixel): a 100-pixel drag inside one cell fires
// zero hover events.

import { Feature, type CGridEventCtx } from '../feature';

type HoverKey = { kind: 'cell'; rowIndex: number; colId: string }
              | { kind: 'header'; colId: string }
              | null;

function sameHover(a: HoverKey, b: HoverKey): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'cell' && b.kind === 'cell')
    return a.rowIndex === b.rowIndex && a.colId === b.colId;
  if (a.kind === 'header' && b.kind === 'header') return a.colId === b.colId;
  return false;
}

export class OnHover extends Feature {
  private lastHover: HoverKey = null;

  /** Cycle 21i / Phase 1 — pointer left the grid: fire the OUT events for
   *  the last hovered cell/row, clear the row-hover highlight, repaint. */
  reset(grid: CGridEventCtx['grid'], raw: MouseEvent): void {
    const prev = this.lastHover;
    if (prev?.kind === 'cell') {
      grid.emitCellMouseOut?.(prev.rowIndex, prev.colId, raw);
      grid.emitRowMouseOut?.(prev.rowIndex, raw);
    }
    this.lastHover = null;
    grid.setHoveredRow?.(null);
    grid.canvas.requestRepaint();
  }

  override handleMouseMove(ctx: CGridEventCtx): void {
    // Cursor: header hover → pointer. ColumnResizing's `col-resize` is set
    // earlier in the chain and overrides this for the resize hot zone.
    this.cursor = ctx.hit.kind === 'header' ? 'pointer' : null;

    let key: HoverKey = null;
    if (ctx.hit.kind === 'cell') {
      key = { kind: 'cell', rowIndex: ctx.hit.rowIndex, colId: ctx.hit.colId };
    } else if (ctx.hit.kind === 'header') {
      key = { kind: 'header', colId: ctx.hit.colId };
    }
    if (!sameHover(this.lastHover, key)) {
      // Cycle 23 / Task 2 — fan out the hover events BEFORE swapping
      // `lastHover` so the OUT event has access to the previous cell.
      const raw = ctx.raw as MouseEvent;
      const prev = this.lastHover;
      const prevRow = prev?.kind === 'cell' ? prev.rowIndex : null;
      const nextRow = key?.kind === 'cell' ? key.rowIndex : null;
      if (prev?.kind === 'cell') {
        ctx.grid.emitCellMouseOut?.(prev.rowIndex, prev.colId, raw);
      }
      if (key?.kind === 'cell') {
        ctx.grid.emitCellMouseOver?.(key.rowIndex, key.colId, raw);
      }
      if (prevRow !== nextRow) {
        if (prevRow !== null) ctx.grid.emitRowMouseOut?.(prevRow, raw);
        if (nextRow !== null) ctx.grid.emitRowMouseOver?.(nextRow, raw);
        // Cycle 21i / Phase 1 — record the hovered data row for the
        // row-hover highlight paint (grid no-ops when suppressed).
        ctx.grid.setHoveredRow?.(nextRow);
      }
      this.lastHover = key;
      ctx.grid.canvas.requestRepaint();
    }
    super.handleMouseMove(ctx);
  }
}
