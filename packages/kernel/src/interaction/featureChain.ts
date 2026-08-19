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

import { Feature, type VelocityGridLike, type VelocityGridEventCtx } from './feature';
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
import { GroupExpandFeature } from './features/groupExpand';
import { SparklineTooltip } from './features/sparklineTooltip';
import { TooltipProvider } from './features/tooltipProvider';
import { CellKeyboardEvents } from './features/cellKeyboardEvents';
import { RowSelectCheckboxClick } from './features/rowSelectCheckboxClick';

/** Idle gap (ms) after the last wheel event before the axis lock releases.
 *  ~150ms matches the natural pause between separate trackpad gestures while
 *  still feeling instant — too short and a brief deceleration in a continuous
 *  swipe re-detects the wrong axis; too long and the user can't quickly
 *  switch directions. */
const WHEEL_LOCK_IDLE_MS = 150;

export class FeatureChain {
  private head: Feature;
  /** Cycle 21i / Phase 1 — kept for `mouseleave` to clear the row-hover
   *  highlight + fire the trailing mouse-out events. */
  private onHover!: OnHover;
  /** Kept so the pointercancel/blur/visibilitychange safety net (and
   *  `destroy()`) can reach each feature's drag-state cleanup directly —
   *  see `onDragAbort` below. */
  private columnResizing!: ColumnResizing;
  private columnDrag!: ColumnDrag;
  private mouseIsDown = false;
  /** Axis the current wheel gesture is locked to. `null` between gestures so
   *  the next event re-detects the dominant axis. */
  private wheelAxis: 'x' | 'y' | null = null;
  private wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private grid: VelocityGridLike) {
    // Cycle 23 / Task 4 — CellKeyboardEvents sits at the HEAD of the
    // chain so every keydown fires `cellKeyDown` BEFORE any grid-side
    // key handler runs. App listeners calling preventDefault
    // short-circuit the chain entirely (the feature skips its
    // `super.handleKeyDown` forward), so apps can disable
    // Enter-to-commit per column, replace shortcuts, etc.
    this.head = new CellKeyboardEvents();
    this.head
      // Row-select checkbox column — sits ahead of every selection
      // / range / focus feature so a click on the checkbox cell can
      // claim the gesture as a pure row-toggle BEFORE downstream
      // features try to focus the cell or create a cell range.
      .append(new RowSelectCheckboxClick())
      .append((this.columnResizing = new ColumnResizing()))
      .append((this.columnDrag = new ColumnDrag()))
      // Cycle 15 / Task 7 — GroupExpand sits ahead of EditTrigger /
      // FillHandle / RangeSelection / CellSelection. A click on the
      // chevron must not also open an editor, mutate the cell range,
      // or replace focus. Outside the chevron hit zone the feature
      // forwards via `super` so every downstream gesture keeps
      // working in grouped + ungrouped grids alike.
      .append(new GroupExpandFeature())
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
      // Cycle 21 / Task 3 — sparkline tooltip sits ahead of OnHover so
      // its DOM overlay update runs on every mousemove tick. Both
      // features forward via `super` (neither claims the move), so the
      // ordering only affects which one runs first; placing the
      // tooltip ahead of OnHover keeps it visible immediately when the
      // pointer enters a sparkline cell.
      .append(new SparklineTooltip())
      // Cycle 21c / Task 14 — generic per-column tooltip provider hook.
      // Sits after SparklineTooltip (its specialized sibling) and before
      // OnHover; forwards every move via `super` so hover state still
      // updates downstream.
      .append(new TooltipProvider())
      .append((this.onHover = new OnHover()));

    const c = grid.canvas.canvas;
    c.tabIndex = 0;
    c.addEventListener('mousedown', this.onMouseDown);
    c.addEventListener('mousemove', this.onMouseMove);
    c.addEventListener('mouseleave', this.onMouseLeave);
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
    c.removeEventListener('mouseleave', this.onMouseLeave);
    c.removeEventListener('click', this.onClick);
    c.removeEventListener('dblclick', this.onDoubleClick);
    c.removeEventListener('contextmenu', this.onContextMenu);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('mousemove', this.onWindowMouseMove);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
    this.removeDragAbortListeners();
    if (this.wheelIdleTimer !== null) {
      clearTimeout(this.wheelIdleTimer);
      this.wheelIdleTimer = null;
    }
    // MEDIUM — a destroy mid-drag/resize otherwise leaves the feature's
    // own local state (and, for ColumnDrag, its ghost DOM nodes — which
    // fall back to mounting on `document.body`) stranded. Local-only
    // reset: the grid is already mid-teardown here, so this must not
    // call back into it (no `finishColumnResize` / panel-hover clears).
    this.columnResizing.resetDragState();
    this.columnDrag.resetDragState();
  }

  private toLocal(e: MouseEvent): { x: number; y: number } {
    const rect = this.grid.canvas.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private buildCtx(e: MouseEvent | KeyboardEvent | WheelEvent): VelocityGridEventCtx {
    const point = e instanceof MouseEvent ? this.toLocal(e) : { x: 0, y: 0 };
    const hit = this.grid.hitTester.locate(point.x, point.y);
    return { grid: this.grid, hit, point, raw: e };
  }

  private onMouseDown = (e: MouseEvent): void => {
    this.mouseIsDown = true;
    window.addEventListener('mousemove', this.onWindowMouseMove);
    window.addEventListener('mouseup', this.onWindowMouseUp);
    // HIGH — safety net for a lost mouseup (pointer capture stolen by a
    // native drag/resize, alt-tab, devtools grabbing focus, etc.). Without
    // this, a resize strands the grid on the slow paint path forever
    // (`columnResizeDragActive` never resets) and a column-header drag
    // leaves its ghost DOM nodes mounted forever. Registered per-gesture
    // (paired with the window mousemove/mouseup above) and torn down on
    // every normal mouseup too, so the listeners themselves never leak.
    window.addEventListener('pointercancel', this.onDragAbort);
    window.addEventListener('blur', this.onDragAbort);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
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
    this.removeDragAbortListeners();
    this.head.handleMouseUp(this.buildCtx(e));
  };

  private removeDragAbortListeners(): void {
    window.removeEventListener('pointercancel', this.onDragAbort);
    window.removeEventListener('blur', this.onDragAbort);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Fires on `pointercancel` or window `blur` while the mouse is down —
   *  the two ways a resize/drag gesture can end without a `mouseup` ever
   *  reaching the window. Forces the same cleanup a normal mouseup would:
   *  resets `mouseIsDown` + removes the drag listeners, then invokes each
   *  feature's own cancel path (no-op for whichever feature wasn't mid-
   *  gesture). */
  private onDragAbort = (): void => {
    if (!this.mouseIsDown) return;
    this.mouseIsDown = false;
    window.removeEventListener('mousemove', this.onWindowMouseMove);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
    this.removeDragAbortListeners();
    this.columnResizing.cancelResize(this.grid);
    this.columnDrag.cancelDrag(this.grid);
  };

  /** `visibilitychange` fires on tab-hide too (not just blur — e.g. a
   *  same-window fullscreen video, or macOS Mission Control), so it's
   *  covered as an independent trigger via the same `onDragAbort` path. */
  private onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.hidden) this.onDragAbort();
  };

  private onMouseLeave = (e: MouseEvent): void => {
    // Pointer left the canvas — clear the row-hover highlight (and fire
    // the trailing mouse-out events for the last hovered cell/row).
    if (this.mouseIsDown) return;
    this.onHover.reset(this.grid, e);
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
