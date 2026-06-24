// OnHover — tracks the hovered cell/header and requests a repaint when it
// changes so painters can render a hover background. Sets `pointer` cursor on
// header hover (lower priority than ColumnResizing's `col-resize`).

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
      this.lastHover = key;
      ctx.grid.canvas.requestRepaint();
    }
    super.handleMouseMove(ctx);
  }
}
