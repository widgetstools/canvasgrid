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
//
// Cycle 15 / Task 6 — when the cursor crosses INTO the row group panel
// (the horizontal drop strip above the column headers), the drag forwards
// the column id + viewport coords to `grid.setRowGroupPanelDragHover`. The
// panel host paints its own drop indicator (panel-level outline + vertical
// insertion line at the chip-gap mid-point). On mouseup-over-panel, the
// drag commits the drop via `grid.commitRowGroupPanelDrop`; the
// column-reorder pathway is skipped so the column stays where it was in
// the header band.

import { Feature, type CGridEventCtx } from '../feature';

const DRAG_THRESHOLD_PX = 4;

// ---- Shared row-group-panel drag router (exported for tool-panel pills) ----
//
// Both ColumnDrag (column-header drags) and ColumnsToolPanel (column-list
// row drags) need to dispatch hover + drop through the row group panel.
// Rather than duplicating the three-method protocol in each callsite, we
// export a minimal interface and a pair of helpers that any drag source can
// call regardless of which grid context object it has access to.

/** Minimal surface needed to route a drag source through the row group
 *  panel.  Both `CGridEventCtx` (Feature chain) and `CGridApi` (public
 *  surface, after Task 2 gap-fill) satisfy this interface. */
export interface RowGroupPanelDragRouter {
  isPointInRowGroupPanel(clientX: number, clientY: number): boolean;
  setRowGroupPanelDragHover(colId: string | null, clientX: number, clientY: number): void;
  commitRowGroupPanelDrop(colId: string): boolean;
}

/** Dispatch a mid-drag hover tick to the row group panel.
 *
 *  Returns `true` when the cursor is inside the panel (so the caller
 *  can suppress other drop targets, e.g. the in-list reorder or the
 *  tool-panel drop zone).  Returns `false` and clears any prior hover
 *  state when the cursor is outside the panel. */
export function routeExternalDragHover(
  ctx: RowGroupPanelDragRouter,
  colId: string,
  clientX: number,
  clientY: number,
): boolean {
  if (ctx.isPointInRowGroupPanel(clientX, clientY)) {
    ctx.setRowGroupPanelDragHover(colId, clientX, clientY);
    return true;
  }
  ctx.setRowGroupPanelDragHover(null, clientX, clientY);
  return false;
}

/** Clear the row group panel hover state unconditionally.
 *  Call this on drag-end (mouseup / pointercancel) regardless of where
 *  the drag landed, so the panel's outline + insertion line disappear. */
export function clearExternalDragHover(ctx: RowGroupPanelDragRouter): void {
  ctx.setRowGroupPanelDragHover(null, -1, -1);
}
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
  /** Set on mouseup at the end of a real drag. The browser fires a
   *  `click` event after a drag if the cursor is still over the same
   *  element — which would otherwise hit HeaderClick and cycle the
   *  sort on the just-reordered column. Cleared on the next click
   *  (consumed) or on the next mousedown (defensive). */
  private suppressNextClick = false;

  override handleMouseDown(ctx: CGridEventCtx): void {
    // A fresh press starts a new gesture. Clear any stale suppression
    // flag from a previous drag whose click event never fired (rare,
    // but possible if the cursor left the canvas between up and click).
    this.suppressNextClick = false;
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
      this.dispatchRowGroupPanelHover(ctx);
      return;
    }
    // dragging — track pointer X for the drop-target computation
    this.state.currentX = ctx.point.x;
    updateGhostPosition(this.state, ctx);
    updateInsertionLinePosition(this.state, ctx);
    this.dispatchRowGroupPanelHover(ctx);
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
    // Cycle 15 / Task 6 — if the drop landed inside the row group
    // panel, commit the drop there instead of running the header
    // reorder. The panel's drop verdict already filtered for
    // `enableRowGroup`; a `reject` returns `false` and we fall back
    // to a header reorder so the column doesn't disappear into a
    // rejected drop.
    const raw = ctx.raw;
    if (raw instanceof MouseEvent) {
      const droppedIntoPanel = ctx.grid.isPointInRowGroupPanel(raw.clientX, raw.clientY)
        && ctx.grid.commitRowGroupPanelDrop(state.colId);
      // Clear any drop-hover state regardless of accept/reject so the
      // panel's outline + insertion line disappear on release.
      ctx.grid.setRowGroupPanelDragHover(null, raw.clientX, raw.clientY);
      if (droppedIntoPanel) {
        this.suppressNextClick = true;
        return;
      }
    }
    const target = computeDropTargetIndex(ctx, state.colId);
    if (target !== null) {
      ctx.grid.reorderColumn(state.colId, target, 'uiColumnDragged');
    }
    // Drag completed — swallow the follow-up click event that the browser
    // dispatches after mouseup, so HeaderClick doesn't cycle sort on the
    // just-dragged column. Also do NOT forward mouseup to downstream
    // features for the same reason.
    this.suppressNextClick = true;
  }

  /** Cycle 15 / Task 6 — feed the row group panel host the current
   *  drag state via the shared router.  When the cursor is OUTSIDE the
   *  panel, `routeExternalDragHover` clears any prior hover state. */
  private dispatchRowGroupPanelHover(ctx: CGridEventCtx): void {
    const state = this.state;
    if (state === null || state.kind !== 'dragging') return;
    const raw = ctx.raw;
    if (!(raw instanceof MouseEvent)) return;
    routeExternalDragHover(ctx.grid, state.colId, raw.clientX, raw.clientY);
  }

  override handleClick(ctx: CGridEventCtx): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return; // consume — the click is the tail of a drag, not a sort cycle
    }
    super.handleClick(ctx);
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
  // Mount at the leaf-header row's Y, not 0. With column groups present
  // (the demo has the P&L group), the leaf header sits BELOW the group
  // header rows; mounting at 0 would float the ghost above the wrong band.
  const top = ctx.grid.getLeafHeaderTop?.() ?? 0;
  const ghost = document.createElement('div');
  ghost.className = GHOST_CLASS;
  ghost.textContent = ctx.grid.getHeaderName?.(colId) ?? colId;
  // Background opacity lives on the background-color via color-mix so the
  // text stays fully opaque (an element-level `opacity` would fade the
  // headerName too, making it hard to read mid-drag).
  ghost.style.cssText = [
    'position:absolute',
    'pointer-events:none',
    `top:${top}px`,
    'left:0',
    `width:${width}px`,
    `height:${height}px`,
    'box-sizing:border-box',
    'padding:0 8px',
    'display:flex',
    'align-items:center',
    'background:color-mix(in srgb, var(--cg-header-bg) 70%, transparent)',
    'color:var(--cg-header-fg)',
    'font:var(--cg-font)',
    'border:1px solid var(--cg-border-color)',
    'box-shadow:0 4px 12px rgba(0,0,0,0.45)',
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
