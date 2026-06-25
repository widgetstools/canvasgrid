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
// Visual feedback (dragging state only):
//   - Ghost header — absolutely-positioned DOM div in the overlay layer
//     mirroring the moving header's size and translating with the cursor.
//   - Insertion line — 2 px vertical bar at the resolved drop target's
//     left edge (spans the canvas height). Both elements are
//     `pointer-events: none` so hover and click flow through to the canvas.

import { Feature, type CGridEventCtx } from '../feature';

const DRAG_THRESHOLD_PX = 4;
const GHOST_CLASS = 'cg-column-drag-ghost';
const INSERTION_LINE_CLASS = 'cg-column-drag-insertion-line';

interface PressedState {
  kind: 'pressed';
  colId: string;
  startX: number;
  startY: number;
  /** Distance from the press X to the moving column's left edge — used
   *  so the ghost stays anchored to the same point under the cursor
   *  during drag, mirroring how the header looked at press time. */
  grabOffsetX: number;
}

interface DraggingState {
  kind: 'dragging';
  colId: string;
  startX: number;
  startY: number;
  currentX: number;
  grabOffsetX: number;
  ghost: HTMLDivElement | null;
  insertionLine: HTMLDivElement | null;
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
    const colLeft = ctx.grid.columnLeftOf(ctx.hit.colId);
    this.state = {
      kind: 'pressed',
      colId: ctx.hit.colId,
      startX: ctx.point.x,
      startY: ctx.point.y,
      grabOffsetX: colLeft === null ? 0 : ctx.point.x - colLeft,
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
        grabOffsetX: this.state.grabOffsetX,
        ghost: createGhost(ctx, this.state.colId),
        insertionLine: createInsertionLine(ctx),
      };
      this.cursor = 'grabbing';
      updateGhostPosition(this.state, ctx);
      updateInsertionLinePosition(this.state, ctx);
      return;
    }
    // dragging — track pointer X for the drop-target computation
    this.state.currentX = ctx.point.x;
    updateGhostPosition(this.state, ctx);
    updateInsertionLinePosition(this.state, ctx);
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
    state.ghost?.remove();
    state.insertionLine?.remove();
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

/** Build the ghost header div and append it to the overlay host. Returns
 *  `null` when the overlay host isn't available (test mocks, headless
 *  environments) — the drag still commits, just without the visual
 *  affordance. */
function createGhost(ctx: CGridEventCtx, colId: string): HTMLDivElement | null {
  const host = ctx.grid.getOverlayHost?.();
  if (!host || typeof document === 'undefined') return null;
  const width = ctx.grid.columnWidthOf(colId) ?? 100;
  const height = ctx.grid.getLeafHeaderHeight?.() ?? 30;
  const ghost = document.createElement('div');
  ghost.className = GHOST_CLASS;
  ghost.textContent = ctx.grid.getHeaderName?.(colId) ?? colId;
  ghost.style.cssText = [
    'position:absolute',
    'pointer-events:none',
    'top:0',
    'left:0',
    `width:${width}px`,
    `height:${height}px`,
    'box-sizing:border-box',
    'padding:0 8px',
    'display:flex',
    'align-items:center',
    'opacity:0.7',
    'background:var(--cg-header-bg)',
    'color:var(--cg-header-fg)',
    'font:var(--cg-font)',
    'border:1px solid var(--cg-border-color)',
    'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
    'z-index:5',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'will-change:transform',
  ].join(';');
  host.appendChild(ghost);
  return ghost;
}

/** Build the 2 px vertical insertion line and append it to the overlay
 *  host. Spans full canvas height; X is set by `updateInsertionLinePosition`. */
function createInsertionLine(ctx: CGridEventCtx): HTMLDivElement | null {
  const host = ctx.grid.getOverlayHost?.();
  if (!host || typeof document === 'undefined') return null;
  const line = document.createElement('div');
  line.className = INSERTION_LINE_CLASS;
  line.style.cssText = [
    'position:absolute',
    'pointer-events:none',
    'top:0',
    'left:0',
    'width:2px',
    'height:100%',
    'background:var(--cg-selected-cell-color, #3b82f6)',
    'z-index:6',
    'will-change:transform',
  ].join(';');
  host.appendChild(line);
  return line;
}

/** Translate the ghost to follow the cursor — anchored so the click point
 *  remains under the cursor. */
function updateGhostPosition(state: DraggingState, ctx: CGridEventCtx): void {
  if (!state.ghost) return;
  const x = Math.round(ctx.point.x - state.grabOffsetX);
  state.ghost.style.transform = `translate3d(${x}px, 0px, 0)`;
}

/** Position the insertion line at the LEFT edge of the column the moving
 *  column would land on — or the RIGHT edge when the pointer is past
 *  that column's center, so the user sees the column will end up *after*
 *  the column they're hovering past. */
function updateInsertionLinePosition(state: DraggingState, ctx: CGridEventCtx): void {
  if (!state.insertionLine) return;
  const targetIdx = computeDropTargetIndex(ctx, state.colId);
  if (targetIdx === null) return;
  const ids = ctx.grid.allColIds();
  const targetId = ids[targetIdx];
  if (!targetId) return;
  const left = ctx.grid.columnLeftOf(targetId);
  const width = ctx.grid.columnWidthOf(targetId);
  if (left === null || width === null) return;
  const center = left + width / 2;
  const x = ctx.point.x >= center ? left + width - 1 : left;
  state.insertionLine.style.transform = `translate3d(${Math.round(x)}px, 0px, 0)`;
}
