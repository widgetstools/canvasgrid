// RangeSelection — drag a cell-range with the pointer. Mousedown on a data
// cell anchors a 1×1 range; subsequent drag ticks widen it to span every row
// between the anchor and the current cell, and every column between the
// anchor's colId and the current cell's colId in render order. Mouseup
// commits — the range stays on the SelectionModel, the feature returns to
// idle, and a follow-up drag with no preceding mousedown is a no-op.
//
// Cycle 9 / Task 4 layers two modifier semantics on the same mousedown:
//   - Shift-click EXTENDS the last range from its existing rect to cover
//     the clicked cell. No drag state is set — shift-click is a discrete
//     extend, not a "drag from here" gesture. Falls back to plain-anchor
//     when no range exists yet.
//   - Ctrl/Cmd-click ADDS a new disjoint 1x1 range, preserving existing
//     ranges. Mirrors ag-grid's "hold ctrl to add another rectangle."
// In both modifier paths we still forward via `super.handleMouseDown` so
// CellSelection runs its shift-range / ctrl-toggle row-selection logic on
// the same press. Shift takes priority when both shift+ctrl are held.
//
// Cycle 9 / Task 7 — every range-mutating path here also fans out the
// `rangeSelectionChanged` event via `ctx.grid.emitRangeSelectionChanged`:
//   - plain drag → start (mousedown), mid (each move tick), end (mouseup)
//   - shift-click / ctrl-click → a single started+finished event
//   - mouseup with no drag in flight → no event (forwarded only)
// The VelocityGrid emitter handles the `cellSelectionChanged` debounce on top.
//
// Cycle 9 patch / Task 2 — auto-scroll while the pointer is in the body's
// edge zone. When `handleMouseDrag` fires with a point inside ±EDGE_PX of
// any body side, an rAF-paced loop calls `ctx.grid.scrollBy` proportional
// to the depth past the edge (linear, capped at MAX_SCROLL_PX_PER_FRAME).
// Each tick re-hit-tests at the LAST captured pointer position so the range
// extends to newly-revealed cells. The loop self-terminates on the first
// non-edge-zone drag tick OR on mouseup.
//
// Chain position: ahead of CellSelection. CellSelection consumes cell
// mousedowns to set focus + row selection; placing RangeSelection earlier
// lets us claim the range first, then forward via `super.handleMouseDown`
// so focus + row selection still happen on the same press.

import { Feature, type VelocityGridEventCtx } from '../feature';
import type { Hit } from '../hitTester';

interface DragState {
  /** Row index hit at mousedown. The range's rowStart = min(anchor, current),
   *  rowEnd = max(anchor, current). */
  anchorRowIndex: number;
  /** ColId hit at mousedown. The range's colIds = the render-order slice
   *  from min(anchorColIndex, currentColIndex) to max(anchorColIndex,
   *  currentColIndex). */
  anchorColId: string;
}

/** Cycle 9 patch / Task 2 — width (CSS px) of the body's edge zone. When the
 *  pointer enters this band on any side during a drag, `RangeSelection`
 *  kicks the auto-scroll loop. 20 px matches Excel's "near the edge"
 *  feel — small enough that an intentional click near the edge of a wide
 *  cell doesn't trigger it, large enough that a drag toward off-screen
 *  cells lands in it without overshooting. */
export const EDGE_PX = 20;

/** Cycle 9 patch / Task 2 — cap on auto-scroll speed (CSS px / frame). At
 *  60 fps that's ~1800 px/sec — fast enough that a 5000-row grid scrolls
 *  through in a few seconds, slow enough that the user can stop near a
 *  target row. Linear ramp below the cap means depth=1 → 1 px/frame so
 *  intentional edge-grazing only nudges the viewport. */
export const MAX_SCROLL_PX_PER_FRAME = 30;

/** Cycle 9 patch / Task 2 — pure edge-zone math. Returns the per-frame
 *  scroll delta in CSS px for a pointer at `point` against a body rect
 *  `bodyRect`. The four directions are independent (corner drag scrolls
 *  diagonally). Each axis's delta is `min(cap, depth)` where
 *  `depth = how far past the inside edge of the zone the pointer has
 *  intruded`. Returns `{0, 0}` when the pointer is safely inside the body
 *  (no axis in an edge zone). */
export function computeAutoScrollDelta(
  point: { x: number; y: number },
  bodyRect: { left: number; right: number; top: number; bottom: number },
  edgePx: number = EDGE_PX,
  capPx: number = MAX_SCROLL_PX_PER_FRAME,
): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  // X axis. The inside edges of the left/right zones are at
  // `bodyLeft + edgePx` and `bodyRight - edgePx`. Depth is how far past
  // those inside edges the pointer has gone — positive means inside the
  // zone (or past the body edge entirely).
  if (point.x < bodyRect.left + edgePx) {
    const depth = (bodyRect.left + edgePx) - point.x;
    dx = -Math.min(capPx, depth);
  } else if (point.x > bodyRect.right - edgePx) {
    const depth = point.x - (bodyRect.right - edgePx);
    dx = Math.min(capPx, depth);
  }
  if (point.y < bodyRect.top + edgePx) {
    const depth = (bodyRect.top + edgePx) - point.y;
    dy = -Math.min(capPx, depth);
  } else if (point.y > bodyRect.bottom - edgePx) {
    const depth = point.y - (bodyRect.bottom - edgePx);
    dy = Math.min(capPx, depth);
  }
  return { dx, dy };
}

export class RangeSelection extends Feature {
  private state: DragState | null = null;
  /** Cycle 9 patch / Task 2 — auto-scroll rAF id. Non-null only while a
   *  drag's pointer is in an edge zone. Cancelled on the first
   *  out-of-zone drag tick OR on mouseup. */
  private autoScrollRafId: number | null = null;
  /** Cycle 9 patch / Task 2 — last in-zone drag context. The rAF tick
   *  reads `point` + `grid` from here and synthesises a fresh hit-test at
   *  the same canvas-local point after the scroll, so the range follows
   *  the newly-revealed cells. */
  private lastDragCtx: VelocityGridEventCtx | null = null;

  override handleMouseDown(ctx: VelocityGridEventCtx): void {
    if (ctx.hit.kind !== 'cell') {
      super.handleMouseDown(ctx);
      return;
    }
    // Cycle 9 / Task 6 — `cellSelection.suppressDrag` makes this feature
    // a pass-through on cell presses: no plain/shift/ctrl range mutation,
    // no drag state. Forwarding via `super` preserves focus + row-selection
    // behavior on the same press. Read at event time so a runtime
    // `setGridOption('cellSelection', …)` takes effect on the next press.
    if (ctx.grid.getCellSelectionOptions()?.suppressDrag === true) {
      this.state = null;
      super.handleMouseDown(ctx);
      return;
    }
    const e = ctx.raw as MouseEvent;
    const sel = ctx.grid.selection;
    // Cycle 9 patch / Task 1 — right-click on a cell INSIDE the current
    // range MUST preserve the range so the context menu's Copy serialises
    // the visible block (not a 1×1 collapsed at the click). Focus still
    // moves to the clicked cell so the menu's actions read the clicked
    // cell. Right-clicks OUTSIDE the range fall through to the plain-anchor
    // path below — the menu still gets a fresh 1×1 to act on.
    //
    // No `super.handleMouseDown` here: CellSelection's mousedown would call
    // `selectSingle` which clears row selection. The matching CellSelection
    // guard (right-click on a selected row) handles the OUTSIDE-the-range
    // case downstream.
    if (e.button === 2 && sel.isInsideAnyRange(ctx.hit.rowIndex, ctx.hit.colId)) {
      sel.setFocus(ctx.hit.rowIndex, ctx.hit.colId);
      this.state = null;
      return;
    }
    // Shift-click: discrete extend of the last range. Falls back to a fresh
    // 1x1 anchor when no range exists yet so the first shift-click of a
    // session still gives the user something to extend from. No drag state
    // — a shift-mousedown is not a "drag from here" gesture.
    if (e.shiftKey) {
      if (sel.getRanges().length === 0) {
        sel.setRanges([{
          rowStart: ctx.hit.rowIndex,
          rowEnd: ctx.hit.rowIndex,
          colIds: [ctx.hit.colId],
        }]);
      } else {
        sel.extendLastRangeToCell(ctx.hit.rowIndex, ctx.hit.colId, ctx.grid.allColIds());
      }
      this.state = null;
      // Shift-click is a single instantaneous extend — no drag state, so
      // the event is both started and finished.
      ctx.grid.emitRangeSelectionChanged(true, true);
      super.handleMouseDown(ctx);
      return;
    }
    // Ctrl/Cmd-click on a cell. Two diverging behaviors based on row
    // selection mode:
    //
    //   rowSelection: 'multiple' (blotter / data-grid pattern) — the
    //     gesture is primarily a ROW toggle (CellSelection consumes
    //     that). Accumulating disjoint single-cell ranges on top
    //     produces a visual the user reads as "multiple focused
    //     cells" — a major perceptual bug. REPLACE the range with a
    //     single 1×1 at the clicked cell so only one range overlay
    //     paints at any time.
    //
    //   rowSelection: 'single' / 'none' (spreadsheet pattern) — apps
    //     selected this mode because they want Excel-style disjoint
    //     ranges for copy / paste / fill. Preserve the accumulation
    //     behavior.
    if (e.ctrlKey || e.metaKey) {
      const oneRange = {
        rowStart: ctx.hit.rowIndex,
        rowEnd: ctx.hit.rowIndex,
        colIds: [ctx.hit.colId],
      };
      if (sel.getMode() === 'multiple') {
        sel.setRanges([oneRange]);
      } else {
        sel.addRange(oneRange);
      }
      this.state = null;
      ctx.grid.emitRangeSelectionChanged(true, true);
      super.handleMouseDown(ctx);
      return;
    }
    this.state = { anchorRowIndex: ctx.hit.rowIndex, anchorColId: ctx.hit.colId };
    sel.setRanges([{
      rowStart: ctx.hit.rowIndex,
      rowEnd: ctx.hit.rowIndex,
      colIds: [ctx.hit.colId],
    }]);
    // Drag start — emits started:true, finished:false. The mid-drag
    // ticks land in handleMouseDrag and the end in handleMouseUp.
    ctx.grid.emitRangeSelectionChanged(true, false);
    // Forward so CellSelection still sets focus + row selection on the
    // same press. CellSelection consumes the cell mousedown, so anything
    // after it won't see this event — that's fine; range work is done.
    super.handleMouseDown(ctx);
  }

  override handleMouseDrag(ctx: VelocityGridEventCtx): void {
    if (this.state === null) {
      super.handleMouseDrag(ctx);
      return;
    }
    // Extend the range from the current hit. When the raw hit isn't a cell
    // (pointer drifted past the body's edge, into the header, scrollbar,
    // or off the canvas), fall back to the cell nearest the clamped body
    // interior — without this, a drag that overshoots a viewport edge
    // would freeze the range at the anchor cell even though auto-scroll
    // is moving the viewport underneath (the synthesised hit at the
    // out-of-body point keeps returning `{kind: 'empty'}`). The result is
    // Excel-style: the range tracks the nearest visible cell along the
    // axis the user is overshooting.
    this.extendRangeToHit(this.withClampedHit(ctx));

    // Auto-scroll detection. The kickoff is gated on the drag actually
    // being in flight (state != null), so a hover near the edge does
    // nothing. The cancel side is also bounded by `state` — `handleMouseUp`
    // clears both.
    const bodyRect = ctx.grid.getBodyRect();
    const { dx, dy } = computeAutoScrollDelta(ctx.point, bodyRect);
    if (dx === 0 && dy === 0) {
      // Out of the edge zone — kill any active loop. Re-entering the zone
      // later starts a fresh one (matches "ONE active loop at a time" in
      // the worklog).
      this.cancelAutoScroll();
      return;
    }
    // In the edge zone. Remember this ctx so the rAF tick can replay the
    // drag at the same canvas-local point after the scroll.
    this.lastDragCtx = ctx;
    if (this.autoScrollRafId === null) {
      this.autoScrollRafId = requestAnimationFrame(this.tickAutoScroll);
    }
  }

  override handleMouseUp(ctx: VelocityGridEventCtx): void {
    // Always kill the auto-scroll loop on mouseup — even if the drag never
    // entered an edge zone, the conditional handles `state === null` below
    // and a degenerate `lastDragCtx` reset here keeps invariants tidy.
    this.cancelAutoScroll();
    if (this.state === null) {
      super.handleMouseUp(ctx);
      return;
    }
    // Commit-in-place: the last drag tick already wrote the final range
    // onto the SelectionModel. Returning to idle is the entire commit.
    this.state = null;
    // Drag end — emits started:false, finished:true. This is the ping
    // that drives the cellSelectionChanged fan-out.
    ctx.grid.emitRangeSelectionChanged(false, true);
    super.handleMouseUp(ctx);
  }

  /** Extract the range-extension body so the rAF tick can call it with a
   *  freshly-synthesised hit at the same canvas-local point as the last
   *  in-zone drag, picking up the newly-revealed cells after the scroll. */
  private extendRangeToHit(ctx: VelocityGridEventCtx): void {
    // Drag tick outside the data area (pointer drifted into the header
    // band, scrollbar gutter, or off the canvas) — keep the last range
    // instead of clobbering it.
    if (ctx.hit.kind !== 'cell') return;
    const allCols = ctx.grid.allColIds();
    const aColIdx = allCols.indexOf(this.state!.anchorColId);
    const bColIdx = allCols.indexOf(ctx.hit.colId);
    // If either column is gone (mid-drag column removal), keep the last
    // range. The next valid drag tick will resync.
    if (aColIdx < 0 || bColIdx < 0) return;

    const rowStart = Math.min(this.state!.anchorRowIndex, ctx.hit.rowIndex);
    const rowEnd = Math.max(this.state!.anchorRowIndex, ctx.hit.rowIndex);
    const colLo = Math.min(aColIdx, bColIdx);
    const colHi = Math.max(aColIdx, bColIdx);
    const colIds = allCols.slice(colLo, colHi + 1);

    ctx.grid.selection.setRanges([{ rowStart, rowEnd, colIds }]);
    // Mid-drag ping — started:false, finished:false. The
    // cellSelectionChanged debounce inside VelocityGrid drops this; only the
    // raw rangeSelectionChanged listener sees it.
    ctx.grid.emitRangeSelectionChanged(false, false);
  }

  /** Each rAF tick: scroll, re-hit-test at the LAST captured pointer, extend
   *  the range, and schedule the next frame if still in the edge zone.
   *  Arrow-fn so `this` binds correctly when passed to `requestAnimationFrame`. */
  private tickAutoScroll = (): void => {
    this.autoScrollRafId = null;
    if (this.state === null || this.lastDragCtx === null) return;
    const ctx = this.lastDragCtx;
    const bodyRect = ctx.grid.getBodyRect();
    const { dx, dy } = computeAutoScrollDelta(ctx.point, bodyRect);
    if (dx === 0 && dy === 0) {
      // Pointer moved back into the body between the last drag tick and
      // now — nothing to do.
      return;
    }
    ctx.grid.scrollBy(dx, dy);
    // Re-hit-test at the CLAMPED canvas-local point — the raw pointer is
    // outside the body (that's why we're auto-scrolling), so a literal
    // `locate(ctx.point.x, ctx.point.y)` would return `{kind: 'empty'}`
    // and `extendRangeToHit` would bail without extending. Clamping into
    // the body interior makes the synthesised hit land on the bottommost
    // / topmost / rightmost / leftmost visible cell — the one that just
    // scrolled into view along the overshoot axis — so the range follows
    // the auto-scroll.
    this.extendRangeToHit(this.withClampedHit(ctx));
    // Continue the loop. The next tick will re-evaluate the edge-zone math
    // against the (potentially updated) body rect.
    this.autoScrollRafId = requestAnimationFrame(this.tickAutoScroll);
  };

  private cancelAutoScroll(): void {
    if (this.autoScrollRafId !== null) {
      cancelAnimationFrame(this.autoScrollRafId);
      this.autoScrollRafId = null;
    }
    this.lastDragCtx = null;
  }

  /** Return `ctx` unchanged when the pointer is over a body cell; otherwise
   *  re-hit-test at the SAME pointer position clamped into the body
   *  rectangle's interior, so a drag that overshoots an edge still resolves
   *  to a cell (the bottommost / topmost / rightmost / leftmost visible row
   *  or column along the overshoot axis). Used by `handleMouseDrag` (so the
   *  first overshooting drag tick still extends the range to the edge
   *  visible cell) and by `tickAutoScroll` (so each rAF tick after the
   *  scroll picks up the newly-revealed cell). */
  private withClampedHit(ctx: VelocityGridEventCtx): VelocityGridEventCtx {
    if (ctx.hit.kind === 'cell') return ctx;
    const body = ctx.grid.getBodyRect();
    if (body.right <= body.left || body.bottom <= body.top) return ctx;
    const cx = Math.max(body.left, Math.min(body.right - 1, ctx.point.x));
    const cy = Math.max(body.top, Math.min(body.bottom - 1, ctx.point.y));
    const hit = ctx.grid.hitTester.locate(cx, cy);
    return { ...ctx, hit };
  }
}
