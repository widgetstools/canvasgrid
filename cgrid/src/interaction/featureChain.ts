// FeatureChain — builds the input chain and routes canvas + window DOM events
// into it.
//
// Chain order (head → tail): ColumnResizing, ColumnDrag, EditTrigger,
// FillHandle, RangeSelection, CellSelection, HeaderClick, KeyPaging,
// OnHover. setCursor walks tail→head so the head's cursor wins when more
// than one feature sets one in the same mousemove tick.
//
// FillHandle sits ahead of RangeSelection because the 6×6 handle hit zone
// overlaps the last range's bottom-right cell — without first-claim
// priority the user would always get a fresh range drag instead of the
// fill-extend gesture. FillHandle forwards via `super.handleMouseDown`
// for every non-handle press so RangeSelection still sees normal clicks.
//
// EditTrigger sits ahead of CellSelection so its head-of-chain
// `suppressKeyboardEvent` short-circuit covers every downstream feature,
// while its click / dblclick handlers call `super` first so focus is set
// before the editor opens.
//
// RangeSelection sits between EditTrigger and CellSelection: it claims the
// cell-range work on cell mousedown / drag, then forwards via `super` so
// CellSelection still sets focus + row selection on the same press. Placing
// it BEFORE CellSelection matters because CellSelection consumes cell
// mousedowns (no `super` forward when the hit is a cell), so anything after
// it would never see a cell press.
//
// Drag handling: on canvas mousedown, FeatureChain attaches window
// mousemove/mouseup listeners so handleMouseDrag fires for every drag tick
// even when the pointer leaves the canvas. This matches hypergrid's
// Canvas.js drag pattern.

import { Feature, type CGridLike, type CGridEventCtx } from './feature';
import { OnHover } from './features/onHover';
import { ColumnResizing } from './features/columnResizing';
import { ColumnDrag } from './features/columnDrag';
import { CellSelection } from './features/cellSelection';
import { KeyPaging } from './features/keyPaging';
import { HeaderClick } from './features/headerClick';
import { EditTrigger } from './features/editTrigger';
import { RangeSelection } from './features/rangeSelection';
import { FillHandle } from './features/fillHandle';
import { RightClick } from './features/rightClick';
import { KeyboardShortcuts } from './features/keyboardShortcuts';

/** Idle gap (ms) after the last wheel event before the axis lock releases.
 *  ~150ms matches the natural pause between separate trackpad gestures while
 *  still feeling instant — too short and a brief deceleration in a continuous
 *  swipe re-detects the wrong axis; too long and the user can't quickly
 *  switch directions. */
const WHEEL_LOCK_IDLE_MS = 150;

export class FeatureChain {
  private head: Feature;
  private mouseIsDown = false;
  /** Axis the current wheel gesture is locked to. `null` between gestures so
   *  the next event re-detects the dominant axis. */
  private wheelAxis: 'x' | 'y' | null = null;
  private wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private grid: CGridLike) {
    this.head = new ColumnResizing();
    this.head
      .append(new ColumnDrag())
      .append(new EditTrigger())
      .append(new FillHandle())
      .append(new RangeSelection())
      .append(new CellSelection())
      .append(new HeaderClick())
      .append(new KeyPaging())
      // KeyboardShortcuts handles Ctrl+C / Ctrl+V / Ctrl+X. It sits
      // AFTER KeyPaging so navigation keys (PageDown/Home/...) claim
      // first, but BEFORE the tail features (RightClick / OnHover) so
      // the modifier-key combinations actually reach it. KeyPaging
      // already ignores ctrl-modified printable keys (line 37) so
      // there's no conflict.
      .append(new KeyboardShortcuts())
      // RightClick lives ahead of OnHover so the `contextmenu` event flows
      // through the chain before the hover-only tail feature; OnHover does
      // not implement handleContextMenu so the placement is cosmetic today,
      // but matches the "tail-of-input-features" intent from the worklog.
      .append(new RightClick())
      .append(new OnHover());

    const c = grid.canvas.canvas;
    c.tabIndex = 0;
    c.addEventListener('mousedown', this.onMouseDown);
    c.addEventListener('mousemove', this.onMouseMove);
    c.addEventListener('click', this.onClick);
    c.addEventListener('dblclick', this.onDoubleClick);
    c.addEventListener('contextmenu', this.onContextMenu);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    const c = this.grid.canvas.canvas;
    c.removeEventListener('mousedown', this.onMouseDown);
    c.removeEventListener('mousemove', this.onMouseMove);
    c.removeEventListener('click', this.onClick);
    c.removeEventListener('dblclick', this.onDoubleClick);
    c.removeEventListener('contextmenu', this.onContextMenu);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('mousemove', this.onWindowMouseMove);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
    if (this.wheelIdleTimer !== null) {
      clearTimeout(this.wheelIdleTimer);
      this.wheelIdleTimer = null;
    }
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

  private onContextMenu = (e: MouseEvent): void => {
    this.head.handleContextMenu(this.buildCtx(e));
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.head.handleWheel(this.buildCtx(e));
    // Axis lock: pick the dominant axis at gesture start, suppress the
    // off-axis delta until the user pauses (gesture ends). Avoids diagonal
    // drift on trackpads — a swipe down stays vertical even if the user's
    // fingers wobble horizontally mid-gesture.
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (this.wheelAxis === null && (dx !== 0 || dy !== 0)) {
      this.wheelAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (this.wheelAxis === 'x') dy = 0;
    else if (this.wheelAxis === 'y') dx = 0;
    if (this.wheelIdleTimer !== null) clearTimeout(this.wheelIdleTimer);
    this.wheelIdleTimer = setTimeout(() => {
      this.wheelAxis = null;
      this.wheelIdleTimer = null;
    }, WHEEL_LOCK_IDLE_MS);
    this.grid.scrollBy(dx, dy);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.head.handleKeyDown(this.buildCtx(e));
  };
}
