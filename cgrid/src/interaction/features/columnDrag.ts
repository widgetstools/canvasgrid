// ColumnDrag — hold mousedown on a leaf-header label (NOT the resizer
// hot-zone) and drag horizontally to reorder. On release, the feature calls
// `grid.reorderColumn(colId, targetIndex, 'uiColumnDragged')`, which resolves
// the legal landing slot via `lockPosition` + `marryChildren` and fires
// `columnMoved`. Cycle 6 / Task 1.
//
// State machine:
//   idle    → pressed   on mousedown over a header (and not suppressMovable)
//   pressed → dragging  once movement passes the 4 px threshold
//   *       → idle      on mouseup or external reset
//
// Threshold: the press-vs-drag promotion intentionally uses absolute
// distance from the press point (not the current segment delta) so jitter
// near the start doesn't accidentally promote.

import { Feature, type CGridEventCtx } from '../feature';

const DRAG_THRESHOLD_PX = 4;

interface PressedState {
  kind: 'pressed';
  colId: string;
  startX: number;
  startY: number;
}

interface DraggingState {
  kind: 'dragging';
  colId: string;
  startX: number;
  startY: number;
  currentX: number;
}

type State = PressedState | DraggingState | null;

export class ColumnDrag extends Feature {
  private state: State = null;

  override handleMouseDown(ctx: CGridEventCtx): void {
    if (ctx.hit.kind !== 'header') {
      super.handleMouseDown(ctx);
      return;
    }
    const def = ctx.grid.getColDef(ctx.hit.colId);
    if (!def || def.suppressMovable) {
      // Forward so downstream features (HeaderClick → cycleSort) still
      // see the press. A suppressMovable header should still cycle sort.
      super.handleMouseDown(ctx);
      return;
    }
    this.state = {
      kind: 'pressed',
      colId: ctx.hit.colId,
      startX: ctx.point.x,
      startY: ctx.point.y,
    };
    // Consume — don't forward. CellSelection treats header presses as a
    // no-op already, but consuming keeps focus stable while we wait for
    // the drag threshold to decide between "click" and "drag".
  }

  override handleMouseDrag(ctx: CGridEventCtx): void {
    if (this.state === null) {
      super.handleMouseDrag(ctx);
      return;
    }
    if (this.state.kind === 'pressed') {
      const dx = ctx.point.x - this.state.startX;
      const dy = ctx.point.y - this.state.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
        return; // still under threshold; wait
      }
      this.state = {
        kind: 'dragging',
        colId: this.state.colId,
        startX: this.state.startX,
        startY: this.state.startY,
        currentX: ctx.point.x,
      };
      this.cursor = 'grabbing';
      return;
    }
    // dragging — track pointer X for the drop-target computation
    this.state.currentX = ctx.point.x;
  }

  override handleMouseUp(ctx: CGridEventCtx): void {
    const state = this.state;
    this.state = null;
    this.cursor = null;
    if (state === null || state.kind === 'pressed') {
      // No drag started — let downstream features see the up. HeaderClick
      // (via the headerClick handler chain) will fire its sort cycle.
      super.handleMouseUp(ctx);
      return;
    }
    const target = computeDropTargetIndex(ctx, state.colId);
    if (target !== null) {
      ctx.grid.reorderColumn(state.colId, target, 'uiColumnDragged');
    }
    // Drag completed — do NOT forward to downstream features so a drop on
    // a header doesn't trigger HeaderClick's sort cycle.
  }

  override handleMouseMove(ctx: CGridEventCtx): void {
    if (this.state === null) {
      this.cursor = ctx.hit.kind === 'header'
        && ctx.grid.getColDef(ctx.hit.colId)?.suppressMovable === false
        ? 'grab'
        : null;
    }
    super.handleMouseMove(ctx);
  }
}

/** Walk the current column order and return the index of the column whose
 *  center is nearest to the pointer's X. Off-viewport columns (no resolved
 *  left/width) are skipped — the candidate falls through to the nearest
 *  in-viewport neighbor. Falls back to the moving column's current index
 *  when nothing is in the viewport. */
function computeDropTargetIndex(
  ctx: CGridEventCtx,
  movingColId: string,
): number | null {
  const ids = ctx.grid.allColIds();
  if (ids.length === 0) return null;
  const x = ctx.point.x;
  let bestIdx = ids.indexOf(movingColId);
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const left = ctx.grid.columnLeftOf(id);
    const width = ctx.grid.columnWidthOf(id);
    if (left === null || width === null) continue;
    const center = left + width / 2;
    const dist = Math.abs(x - center);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
