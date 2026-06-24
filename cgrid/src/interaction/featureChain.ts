// FeatureChain — builds the input chain and routes canvas + window DOM events
// into it.
//
// Chain order (head → tail): ColumnResizing, CellSelection, HeaderClick,
// KeyPaging, OnHover. setCursor walks tail→head so the head's cursor wins
// when more than one feature sets one in the same mousemove tick.
//
// Drag handling: on canvas mousedown, FeatureChain attaches window
// mousemove/mouseup listeners so handleMouseDrag fires for every drag tick
// even when the pointer leaves the canvas. This matches hypergrid's
// Canvas.js drag pattern.

import { Feature, type CGridLike, type CGridEventCtx } from './feature';
import { OnHover } from './features/onHover';
import { ColumnResizing } from './features/columnResizing';
import { CellSelection } from './features/cellSelection';
import { KeyPaging } from './features/keyPaging';
import { HeaderClick } from './features/headerClick';

export class FeatureChain {
  private head: Feature;
  private mouseIsDown = false;

  constructor(private grid: CGridLike) {
    this.head = new ColumnResizing();
    this.head
      .append(new CellSelection())
      .append(new HeaderClick())
      .append(new KeyPaging())
      .append(new OnHover());

    const c = grid.canvas.canvas;
    c.tabIndex = 0;
    c.addEventListener('mousedown', this.onMouseDown);
    c.addEventListener('mousemove', this.onMouseMove);
    c.addEventListener('click', this.onClick);
    c.addEventListener('dblclick', this.onDoubleClick);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    const c = this.grid.canvas.canvas;
    c.removeEventListener('mousedown', this.onMouseDown);
    c.removeEventListener('mousemove', this.onMouseMove);
    c.removeEventListener('click', this.onClick);
    c.removeEventListener('dblclick', this.onDoubleClick);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('mousemove', this.onWindowMouseMove);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
  }

  private toLocal(e: MouseEvent): { x: number; y: number } {
    const rect = this.grid.canvas.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private buildCtx(e: MouseEvent | KeyboardEvent | WheelEvent): CGridEventCtx {
    const point = e instanceof MouseEvent ? this.toLocal(e) : { x: 0, y: 0 };
    const hit = this.grid.hitTester.locate(point.x, point.y);
    return { grid: this.grid, hit, point, raw: e };
  }

  private onMouseDown = (e: MouseEvent): void => {
    this.mouseIsDown = true;
    window.addEventListener('mousemove', this.onWindowMouseMove);
    window.addEventListener('mouseup', this.onWindowMouseUp);
    this.head.handleMouseDown(this.buildCtx(e));
  };

  private onWindowMouseMove = (e: MouseEvent): void => {
    if (!this.mouseIsDown) return;
    this.head.handleMouseDrag(this.buildCtx(e));
  };

  private onWindowMouseUp = (e: MouseEvent): void => {
    this.mouseIsDown = false;
    window.removeEventListener('mousemove', this.onWindowMouseMove);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
    this.head.handleMouseUp(this.buildCtx(e));
  };

  private onMouseMove = (e: MouseEvent): void => {
    // During a drag, window's onWindowMouseMove handles tracking; don't also
    // fire handleMouseMove (which would update hover state mid-drag).
    if (this.mouseIsDown) return;
    this.head.handleMouseMove(this.buildCtx(e));
    // Reset to default before walking; otherwise a previous cursor leaks when
    // no feature claims one this tick.
    this.grid.canvas.canvas.style.cursor = '';
    this.head.setCursor(this.grid);
  };

  private onClick = (e: MouseEvent): void => {
    this.head.handleClick(this.buildCtx(e));
  };

  private onDoubleClick = (e: MouseEvent): void => {
    this.head.handleDoubleClick(this.buildCtx(e));
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.head.handleWheel(this.buildCtx(e));
    this.grid.scrollBy(e.deltaX, e.deltaY);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.head.handleKeyDown(this.buildCtx(e));
  };
}
