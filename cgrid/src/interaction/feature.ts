// Feature base class — chain-of-responsibility for canvas input.
//
// Ported from hypergrid's src/features/Feature.js. Each Feature implements
// the handlers it cares about and forwards via `super.handleX(ctx)` (which
// calls `this.next?.handleX(ctx)`). A feature consumes an event by returning
// without calling super. Cursor reconciliation walks tail-first via setCursor,
// so the head feature's cursor wins when multiple are set.
//
// FeatureChain.ts builds the chain and dispatches DOM events into the head.

import type { CGridCanvas } from '../core/canvas';
import type { HitTester, Hit } from './hitTester';
import type { SelectionModel } from './selectionModel';

/** Grid surface exposed to features. Minimal by design — additions get a new
 *  method here, not a back-channel via globals. */
export interface CGridLike {
  readonly canvas: CGridCanvas;
  readonly selection: SelectionModel;
  readonly hitTester: HitTester;
  /** Data-row indices currently in the viewport (excludes header/totals). Used by PageDown/PageUp. */
  visibleRowIndices(): number[];
  /** Every column in render order (pinned-left + body + pinned-right). Used by keyboard nav. */
  allColIds(): string[];
  /** Total row count after filter/sort. */
  totalRowCount(): number;
  resizeColumn(colId: string, deltaPx: number): void;
  cycleSort(colId: string): void;
  scrollBy(dx: number, dy: number): void;
  emitCellClicked(rowIndex: number, colId: string, e: MouseEvent): void;
  emitCellDoubleClicked(rowIndex: number, colId: string, e: MouseEvent): void;
}

export interface CGridEventCtx {
  grid: CGridLike;
  hit: Hit;
  /** Canvas-local CSS-px coords. For KeyboardEvents this is {0,0}. */
  point: { x: number; y: number };
  raw: MouseEvent | KeyboardEvent | WheelEvent;
}

export abstract class Feature {
  next: Feature | null = null;
  /** Set during handleMouseMove; FeatureChain walks the chain after each move
   *  to apply the last non-null cursor. */
  cursor: string | null = null;

  /** Append a feature at the tail of the chain. Returns `this` so chains can
   *  be assembled fluently: head.append(a).append(b). */
  append(f: Feature): this {
    let cur: Feature = this;
    while (cur.next) cur = cur.next;
    cur.next = f;
    return this;
  }

  handleMouseDown(ctx: CGridEventCtx): void { this.next?.handleMouseDown(ctx); }
  handleMouseUp(ctx: CGridEventCtx): void { this.next?.handleMouseUp(ctx); }
  handleMouseMove(ctx: CGridEventCtx): void { this.next?.handleMouseMove(ctx); }
  handleMouseDrag(ctx: CGridEventCtx): void { this.next?.handleMouseDrag(ctx); }
  handleClick(ctx: CGridEventCtx): void { this.next?.handleClick(ctx); }
  handleDoubleClick(ctx: CGridEventCtx): void { this.next?.handleDoubleClick(ctx); }
  handleKeyDown(ctx: CGridEventCtx): void { this.next?.handleKeyDown(ctx); }
  handleWheel(ctx: CGridEventCtx): void { this.next?.handleWheel(ctx); }

  /** Tail-first cursor walk: recurse to the tail, then back up the stack each
   *  feature applies its own cursor if non-null. Result: head's cursor wins. */
  setCursor(grid: CGridLike): void {
    this.next?.setCursor(grid);
    if (this.cursor) grid.canvas.canvas.style.cursor = this.cursor;
  }
}
