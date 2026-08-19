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

import { Feature, type VelocityGridLike, type VelocityGridEventCtx } from '../feature';
import { computeGroupDropTarget, type GroupDropTarget, type HeaderLeafSlot } from './groupDropTarget';

const DRAG_THRESHOLD_PX = 8;

// ---- Shared row-group-panel drag router (exported for tool-panel pills) ----
//
// Both ColumnDrag (column-header drags) and ColumnsToolPanel (column-list
// row drags) need to dispatch hover + drop through the row group panel.
// Rather than duplicating the three-method protocol in each callsite, we
// export a minimal interface and a pair of helpers that any drag source can
// call regardless of which grid context object it has access to.

/** Minimal surface needed to route a drag source through the row group
 *  panel.  Both `VelocityGridEventCtx` (Feature chain) and `VelocityGridApi` (public
 *  surface, after Task 2 gap-fill) satisfy this interface. */
export interface RowGroupPanelDragRouter {
  isPointInRowGroupPanel(clientX: number, clientY: number): boolean;
  setRowGroupPanelDragHover(colId: string | null, clientX: number, clientY: number): void;
  commitRowGroupPanelDrop(colId: string): boolean;
}

/** Cycle 18 / Task 6 — analogue of the row group panel router for the
 *  pivot panel.  Same shape, same `routeExternalDragHover` /
 *  `clearExternalDragHover` consumers, so external drag sources can
 *  route through both panels with a uniform protocol. */
export interface PivotPanelDragRouter {
  isPointInPivotPanel(clientX: number, clientY: number): boolean;
  setPivotPanelDragHover(colId: string | null, clientX: number, clientY: number): void;
  commitPivotPanelDrop(colId: string): boolean;
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

/** Cycle 18 / Task 6 — analogue of `routeExternalDragHover` for the
 *  pivot panel. Same return contract: `true` when the cursor is
 *  inside the pivot panel (so the caller can suppress other drop
 *  targets); `false` (with cleared hover state) when outside. */
export function routePivotPanelDragHover(
  ctx: PivotPanelDragRouter,
  colId: string,
  clientX: number,
  clientY: number,
): boolean {
  if (ctx.isPointInPivotPanel(clientX, clientY)) {
    ctx.setPivotPanelDragHover(colId, clientX, clientY);
    return true;
  }
  ctx.setPivotPanelDragHover(null, clientX, clientY);
  return false;
}

/** Cycle 18 / Task 6 — analogue of `clearExternalDragHover` for the
 *  pivot panel. */
export function clearPivotPanelDragHover(ctx: PivotPanelDragRouter): void {
  ctx.setPivotPanelDragHover(null, -1, -1);
}
const INSERTION_LINE_CLASS = 'vg-column-drag-insertion-line';
const GHOST_HEADER_CLASS = 'vg-column-drag-ghost';

interface LeafPressedState {
  kind: 'pressed';
  dragKind: 'leaf';
  colId: string;
  startX: number;
  startY: number;
  /** Distance from the press X to the moving column's left edge — used
   *  so the ghost stays anchored to the same point under the cursor
   *  during drag, mirroring how the header looked at press time. */
  grabOffsetX: number;
}

/** Grid Layouts / column-group-drag feature (Task 1) — a press on a
 *  `headerGroup` hit. `leafColIds` is snapshotted at press time (every
 *  leaf under the group, render order); `colId` mirrors the group's
 *  first leaf so shared helpers that key off `state.colId` (the ghost /
 *  insertion-line position updaters) keep working unchanged. */
interface GroupPressedState {
  kind: 'pressed';
  dragKind: 'group';
  groupId: string;
  leafColIds: string[];
  colId: string;
  startX: number;
  startY: number;
  grabOffsetX: number;
}

type PressedState = LeafPressedState | GroupPressedState;

interface LeafDraggingState {
  kind: 'dragging';
  dragKind: 'leaf';
  colId: string;
  startX: number;
  startY: number;
  currentX: number;
  grabOffsetX: number;
  ghost: HTMLDivElement | null;
  insertionLine: HTMLDivElement | null;
  /** Pill ghost shown when hovering over the row group panel OR the
   *  pivot panel (Cycle 18 / Task 6).  Lazily created the first time the
   *  cursor enters either panel; the column-header ghost is hidden while
   *  this is visible. */
  pillGhost: HTMLDivElement | null;
  overRowGroupPanel: boolean;
  /** Cycle 18 / Task 6 — true while the cursor is over the pivot panel.
   *  Tracked separately so the pill ghost can flip on / off as the
   *  cursor traverses panel boundaries. */
  overPivotPanel: boolean;
}

/** Grid Layouts / column-group-drag feature (Task 1) — the dragging
 *  state for a group drag. No `pillGhost` / panel-hover tracking: group
 *  drags never route into the row group panel or pivot panel (those
 *  panels accept single leaf columns, not whole groups), so the
 *  mouseup handler skips those branches entirely for `dragKind:'group'`. */
interface GroupDraggingState {
  kind: 'dragging';
  dragKind: 'group';
  groupId: string;
  leafColIds: string[];
  colId: string;
  startX: number;
  startY: number;
  currentX: number;
  grabOffsetX: number;
  ghost: HTMLDivElement | null;
  insertionLine: HTMLDivElement | null;
}

type DraggingState = LeafDraggingState | GroupDraggingState;

type State = PressedState | DraggingState | null;

export class ColumnDrag extends Feature {
  private state: State = null;
  /** Set on mouseup at the end of a real drag. The browser fires a
   *  `click` event after a drag if the cursor is still over the same
   *  element — which would otherwise hit HeaderClick and cycle the
   *  sort on the just-reordered column. Cleared on the next click
   *  (consumed) or on the next mousedown (defensive). */
  private suppressNextClick = false;

  override handleMouseDown(ctx: VelocityGridEventCtx): void {
    // A fresh press starts a new gesture. Clear any stale suppression
    // flag from a previous drag whose click event never fired (rare,
    // but possible if the cursor left the canvas between up and click).
    this.suppressNextClick = false;
    // Grid Layouts / column-group-drag feature (Task 1) — a press on a
    // group header starts a GROUP drag instead of the leaf-reorder path
    // below. Movable unless any leaf under the group has `lockPosition`
    // set (mirrors the leaf-drag `suppressMovable` guard's intent: don't
    // let a locked column silently get dragged along as part of a group).
    if (ctx.hit.kind === 'headerGroup') {
      const leafColIds = ctx.grid.getGroupLeafColIds(ctx.hit.groupId);
      const movable = leafColIds.length > 0
        && leafColIds.every((id) => (ctx.grid.getColDef(id)?.lockPosition ?? null) === null);
      if (!movable) {
        super.handleMouseDown(ctx);
        return;
      }
      const groupLeft = ctx.grid.columnLeftOf(leafColIds[0]!);
      this.state = {
        kind: 'pressed',
        dragKind: 'group',
        groupId: ctx.hit.groupId,
        leafColIds,
        colId: leafColIds[0]!,
        startX: ctx.point.x,
        startY: ctx.point.y,
        grabOffsetX: groupLeft === null ? 0 : ctx.point.x - groupLeft,
      };
      return; // consume
    }
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
      dragKind: 'leaf',
      colId: ctx.hit.colId,
      startX: ctx.point.x,
      startY: ctx.point.y,
      grabOffsetX: colLeft === null ? 0 : ctx.point.x - colLeft,
    };
    // Consume — don't forward. CellSelection treats header presses as a
    // no-op already, but consuming keeps focus stable while we wait for
    // the drag threshold to decide between "click" and "drag".
  }

  override handleMouseDrag(ctx: VelocityGridEventCtx): void {
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
      if (this.state.dragKind === 'group') {
        const pressed = this.state;
        this.state = {
          kind: 'dragging',
          dragKind: 'group',
          groupId: pressed.groupId,
          leafColIds: pressed.leafColIds,
          colId: pressed.colId,
          startX: pressed.startX,
          startY: pressed.startY,
          currentX: ctx.point.x,
          grabOffsetX: pressed.grabOffsetX,
          ghost: createGroupGhostHeader(ctx, pressed.groupId, pressed.leafColIds),
          insertionLine: createInsertionLine(ctx),
        };
        updateHeaderGhostPosition(this.state, ctx);
        const rejected = updateGroupInsertionLinePosition(this.state, ctx);
        this.cursor = rejected ? 'no-drop' : 'grabbing';
        return;
      }
      this.state = {
        kind: 'dragging',
        dragKind: 'leaf',
        colId: this.state.colId,
        startX: this.state.startX,
        startY: this.state.startY,
        currentX: ctx.point.x,
        grabOffsetX: this.state.grabOffsetX,
        ghost: createGhostHeader(ctx, this.state.colId),
        insertionLine: createInsertionLine(ctx),
        pillGhost: createPillGhost(ctx, this.state.colId),
        overRowGroupPanel: false,
        overPivotPanel: false,
      };
      this.cursor = 'grabbing';
      updateHeaderGhostPosition(this.state, ctx);
      updatePillGhostPosition(this.state, ctx);
      updateInsertionLinePosition(this.state, ctx);
      this.dispatchPanelHover(ctx);
      return;
    }
    // dragging — track pointer X for the drop-target computation
    if (this.state.dragKind === 'group') {
      this.state.currentX = ctx.point.x;
      updateHeaderGhostPosition(this.state, ctx);
      const rejected = updateGroupInsertionLinePosition(this.state, ctx);
      this.cursor = rejected ? 'no-drop' : 'grabbing';
      return;
    }
    this.state.currentX = ctx.point.x;
    updateHeaderGhostPosition(this.state, ctx);
    updatePillGhostPosition(this.state, ctx);
    updateInsertionLinePosition(this.state, ctx);
    this.dispatchPanelHover(ctx);
  }

  override handleMouseUp(ctx: VelocityGridEventCtx): void {
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
    // Grid Layouts / column-group-drag feature (Task 1) — group drags
    // skip the pivot-panel / row-group-panel hover + commit branches
    // entirely (those panels accept single leaf columns, not whole
    // groups) and commit straight through `moveColumnGroup` — the SAME
    // primitive the Columns tool panel's hierarchy drag already uses.
    if (state.dragKind === 'group') {
      const slots = buildHeaderSlots(ctx);
      const descendants = new Set(ctx.grid.getGroupDescendantIds(state.groupId));
      const t = computeGroupDropTarget(slots, state.groupId, descendants, ctx.point.x);
      if (t) {
        ctx.grid.moveColumnGroup(state.groupId, t.targetParentGroupId, t.beforeId);
        // Real group move — swallow the trailing click so HeaderClick
        // doesn't also toggle expand/collapse on the same gesture.
        this.suppressNextClick = true;
      }
      return;
    }
    state.pillGhost?.remove();
    // Cycle 15 / Task 6 + Cycle 18 / Task 6 — if the drop landed
    // inside the pivot panel OR the row group panel, commit the drop
    // there instead of running the header reorder. Pivot panel takes
    // priority because it sits ABOVE the row group panel (matching
    // the stacking order in `applyVerticalInsets`). The panel's drop
    // verdict already filtered for `enableX`; a `reject` returns
    // `false` and we fall back to header reorder so the column
    // doesn't disappear into a rejected drop.
    const raw = ctx.raw;
    if (raw instanceof MouseEvent) {
      const droppedIntoPivot = ctx.grid.isPointInPivotPanel(raw.clientX, raw.clientY)
        && ctx.grid.commitPivotPanelDrop(state.colId);
      ctx.grid.setPivotPanelDragHover(null, raw.clientX, raw.clientY);
      if (droppedIntoPivot) {
        this.suppressNextClick = true;
        return;
      }
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
    // If the pointer is still over the source column at release, treat the
    // gesture as a click — never reorder. Nearest-center drop targeting can
    // flip to an adjacent column while the cursor is still inside the
    // source header (unequal widths / near the right edge), which used to
    // silently reorder + swallow sort. Real reorders release over a
    // different column (or past it).
    const releaseColId =
      ctx.hit.kind === 'header' || ctx.hit.kind === 'headerResizer'
        ? ctx.hit.colId
        : null;
    if (releaseColId === state.colId) {
      super.handleMouseUp(ctx);
      return;
    }
    const fromIdx = ctx.grid.allColIds().indexOf(state.colId);
    const target = computeDropTargetIndex(ctx, state.colId);
    // Only treat this as a completed reorder when the drop index actually
    // changed. A press that crossed the drag threshold but released over
    // the same column (trackpad jitter, tiny slip) must NOT swallow the
    // trailing click — otherwise HeaderClick never cycles sort and sorting
    // looks broken.
    if (target !== null && target !== fromIdx) {
      ctx.grid.reorderColumn(state.colId, target, 'uiColumnDragged');
      this.suppressNextClick = true;
      return;
    }
    // No-op drag — forward mouseup so downstream features stay in sync;
    // leave suppressNextClick false so the browser's click → HeaderClick
    // sort cycle still runs.
    super.handleMouseUp(ctx);
  }

  /** Remove any mounted ghost / insertion-line / pill-ghost DOM nodes and
   *  reset to idle, without notifying the grid. Used by `FeatureChain`'s
   *  destroy() safety net — `grid.destroy()` may already have torn down
   *  the row-group / pivot panels a grid call here would try to notify,
   *  so this only touches this feature's own DOM + local state. */
  resetDragState(): void {
    const state = this.state;
    this.state = null;
    this.cursor = null;
    if (state === null || state.kind === 'pressed') return;
    state.ghost?.remove();
    state.insertionLine?.remove();
    if (state.dragKind === 'leaf') state.pillGhost?.remove();
  }

  /** External cancel — `pointercancel` / window `blur` / tab hidden while
   *  a column-header drag is in progress. Mirrors `handleMouseUp`'s ghost
   *  cleanup (never commits a reorder) and additionally clears any
   *  row-group/pivot panel drag-hover state so a lost mouseup can't leave
   *  the panel's drop outline stuck. No-op when not dragging. */
  cancelDrag(grid: VelocityGridLike): void {
    const state = this.state;
    const wasLeafDragging = state !== null && state.kind === 'dragging' && state.dragKind === 'leaf';
    this.resetDragState();
    if (wasLeafDragging) {
      clearExternalDragHover(grid);
      clearPivotPanelDragHover(grid);
    }
  }

  /** Feed the row group panel + pivot panel hosts the current drag
   *  state via the shared router. The two ghosts swap as the cursor
   *  crosses ANY panel boundary:
   *    - OUTSIDE both panels (plain column reorder): the header ghost +
   *      insertion line are shown; the pill ghost is hidden.
   *    - INSIDE either panel: the header ghost + insertion line are
   *      hidden and the pill ghost is shown to signal "I'm dropping
   *      a chip here". Pivot panel is checked first so its hover
   *      paint wins when both panels would accept the cursor (pivot
   *      sits ABOVE row group panel in the stacking order).
   *
   *  Leaf drags only — group drags never call this (Grid Layouts /
   *  column-group-drag feature, Task 1): those panels accept single
   *  leaf columns, not whole groups. */
  private dispatchPanelHover(ctx: VelocityGridEventCtx): void {
    const state = this.state;
    if (state === null || state.kind !== 'dragging' || state.dragKind !== 'leaf') return;
    const raw = ctx.raw;
    if (!(raw instanceof MouseEvent)) return;
    const inPivot = routePivotPanelDragHover(ctx.grid, state.colId, raw.clientX, raw.clientY);
    if (inPivot !== state.overPivotPanel) {
      state.overPivotPanel = inPivot;
    }
    // When the cursor is over the pivot panel, suppress hover on the
    // row group panel (clear any prior hover so the outline goes away)
    // — pivot takes drop precedence. When NOT over the pivot panel,
    // route hover to the row group panel normally.
    const inRowGroup = inPivot
      ? (clearExternalDragHover(ctx.grid), false)
      : routeExternalDragHover(ctx.grid, state.colId, raw.clientX, raw.clientY);
    if (inRowGroup !== state.overRowGroupPanel) {
      state.overRowGroupPanel = inRowGroup;
    }
    const overAnyPanel = inPivot || inRowGroup;
    if (state.insertionLine) state.insertionLine.style.display = overAnyPanel ? 'none' : '';
    if (state.ghost) state.ghost.style.display = overAnyPanel ? 'none' : '';
    if (state.pillGhost) {
      state.pillGhost.classList.toggle('vg-col-drag-ghost--visible', overAnyPanel);
    }
  }

  override handleClick(ctx: VelocityGridEventCtx): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return; // consume — the click is the tail of a drag, not a sort cycle
    }
    super.handleClick(ctx);
  }

  override handleMouseMove(ctx: VelocityGridEventCtx): void {
    if (this.state === null) {
      if (ctx.hit.kind === 'header') {
        // Idle hover: pointer (sort / click affordance). Grab only appears
        // once a drag is underway (`grabbing` below) — hovering the header
        // must not look like a drag handle.
        this.cursor = ctx.grid.getColDef(ctx.hit.colId)?.suppressMovable === false ? 'pointer' : null;
      } else if (ctx.hit.kind === 'headerGroup') {
        // Grid Layouts / column-group-drag feature (Task 1) — same
        // movable check `handleMouseDown` uses, so the hover affordance
        // never promises a drag that would be refused on press.
        const leafColIds = ctx.grid.getGroupLeafColIds(ctx.hit.groupId);
        const movable = leafColIds.length > 0
          && leafColIds.every((id) => (ctx.grid.getColDef(id)?.lockPosition ?? null) === null);
        this.cursor = movable ? 'pointer' : null;
      } else {
        this.cursor = null;
      }
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
  ctx: VelocityGridEventCtx,
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

/** Build the 2 px vertical insertion line and append it to the overlay
 *  host. Spans full canvas height; X is set by `updateInsertionLinePosition`. */
function createInsertionLine(ctx: VelocityGridEventCtx): HTMLDivElement | null {
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
    'background:var(--vg-selected-cell-color, #3b82f6)',
    'z-index:6',
    'will-change:transform',
  ].join(';');
  host.appendChild(line);
  return line;
}

/** Build the header ghost (`.vg-column-drag-ghost`) — a floating card that
 *  mirrors the moving column header's width + label and follows the cursor
 *  during a plain reorder (Cycle 6 / Task 1 design; the affordance shown
 *  when the drag target is a column slot, not the row group panel). Mounts
 *  on the overlay host in canvas-coordinate space alongside the insertion
 *  line. Returns `null` in headless environments. */
function createGhostHeader(ctx: VelocityGridEventCtx, colId: string): HTMLDivElement | null {
  const host = ctx.grid.getOverlayHost?.();
  if (!host || typeof document === 'undefined') return null;
  const label = ctx.grid.getHeaderName?.(colId) ?? colId;
  const width = ctx.grid.columnWidthOf?.(colId);
  const height = ctx.grid.getLeafHeaderHeight?.();
  const el = document.createElement('div');
  el.className = GHOST_HEADER_CLASS;
  el.textContent = label;
  el.style.width = `${Math.round(width ?? 120)}px`;
  el.style.height = `${Math.round(height ?? 28)}px`;
  host.appendChild(el);
  return el;
}

/** Translate the header ghost so its left edge stays under the same grab
 *  point on the column the drag started from, riding vertically centred on
 *  the cursor. Coordinates are canvas-relative (the overlay host's space). */
function updateHeaderGhostPosition(state: DraggingState, ctx: VelocityGridEventCtx): void {
  if (!state.ghost) return;
  const x = ctx.point.x - state.grabOffsetX;
  const h = state.ghost.offsetHeight || 28;
  const y = ctx.point.y - h / 2;
  state.ghost.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}

/** Translate the pill chip to follow the cursor (sits just above the
 *  pointer tip). Only made visible while the cursor is over the row group
 *  panel — see `dispatchRowGroupPanelHover`. Leaf drags only — group
 *  drags never mount a pill ghost (Grid Layouts / Task 1). */
function updatePillGhostPosition(state: LeafDraggingState, ctx: VelocityGridEventCtx): void {
  if (!state.pillGhost) return;
  const raw = ctx.raw;
  if (!(raw instanceof MouseEvent)) return;
  state.pillGhost.style.transform =
    `translate(${Math.round(raw.clientX)}px,${Math.round(raw.clientY - 14)}px)`;
}

/** Position the insertion line at the LEFT edge of the column the moving
 *  column would land on — or the RIGHT edge when the pointer is past
 *  that column's center, so the user sees the column will end up *after*
 *  the column they're hovering past. */
function updateInsertionLinePosition(state: DraggingState, ctx: VelocityGridEventCtx): void {
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

// ---- Group drag (Grid Layouts / column-group-drag feature, Task 1) ----

/** Build the `HeaderLeafSlot[]` `computeGroupDropTarget` resolves gaps
 *  against: every visible leaf in render order, with its horizontal slot
 *  + ancestor group path. Off-viewport columns (no resolved left/width)
 *  are skipped, mirroring `computeDropTargetIndex`'s own viewport guard. */
function buildHeaderSlots(ctx: VelocityGridEventCtx): HeaderLeafSlot[] {
  const slots: HeaderLeafSlot[] = [];
  for (const colId of ctx.grid.allColIds()) {
    const left = ctx.grid.columnLeftOf(colId);
    const width = ctx.grid.columnWidthOf(colId);
    if (left === null || width === null) continue;
    slots.push({ colId, left, width, groupPath: ctx.grid.getColGroupPath(colId) });
  }
  return slots;
}

/** Left edge of `id` (a leaf colId OR an ancestor groupId) among `slots`.
 *  A leaf resolves directly; a group resolves to the leftmost slot whose
 *  `groupPath` includes it (a group's visual left edge is its first
 *  descendant leaf's left edge). `null` when `id` matches nothing. */
function leftEdgeOfId(slots: HeaderLeafSlot[], id: string): number | null {
  const direct = slots.find((s) => s.colId === id);
  if (direct) return direct.left;
  let min: number | null = null;
  for (const s of slots) {
    if (s.groupPath.includes(id) && (min === null || s.left < min)) min = s.left;
  }
  return min;
}

/** Build the group-drag ghost (`.vg-column-drag-ghost`) — a floating card
 *  spanning the group's full aggregate width (sum of its leaves' widths),
 *  labelled with the group's `headerName`. Mirrors `createGhostHeader`'s
 *  leaf-drag counterpart. Returns `null` in headless environments. */
function createGroupGhostHeader(
  ctx: VelocityGridEventCtx,
  groupId: string,
  leafColIds: string[],
): HTMLDivElement | null {
  const host = ctx.grid.getOverlayHost?.();
  if (!host || typeof document === 'undefined') return null;
  const label = ctx.grid.getGroupHeaderName(groupId) ?? groupId;
  let width = 0;
  for (const id of leafColIds) {
    const w = ctx.grid.columnWidthOf?.(id);
    if (w !== null && w !== undefined) width += w;
  }
  const height = ctx.grid.getLeafHeaderHeight?.();
  const el = document.createElement('div');
  el.className = GHOST_HEADER_CLASS;
  el.textContent = label;
  el.style.width = `${Math.round(width || 120)}px`;
  el.style.height = `${Math.round(height ?? 28)}px`;
  host.appendChild(el);
  return el;
}

/** Grid Layouts / column-group-drag feature (Task 2, corrected in review) —
 *  true when the resolved `target` would be a no-op/rejected
 *  `moveColumnGroup` call. Mirrors `moveColumnGroupPure`'s own guard —
 *  `isReparent && (isMarried(sourceParent) || isMarried(target))` — so the
 *  dry-run reject affordance (hidden insertion line + `no-drop` cursor)
 *  matches the commit exactly:
 *  - no target at all (`computeGroupDropTarget` returned `null` — the gap
 *    sits inside the moving group's own span);
 *  - the target's parent group has `marryChildren: true`;
 *  - this is a REPARENT (the target parent differs from the moving group's
 *    CURRENT parent) and the moving group's current (source) parent has
 *    `marryChildren: true` — a married group's children can't be
 *    re-parented OUT either, only reordered in place among its siblings.
 *  The source parent is derived from the moving group's first leaf's
 *  `getColGroupPath`: that path is `[...ancestors, movingGroupId]`, so the
 *  second-to-last entry (or `null` if the moving group is top-level) is its
 *  current parent. */
function isGroupDropRejected(ctx: VelocityGridEventCtx, movingGroupId: string, target: GroupDropTarget | null): boolean {
  if (!target) return true;
  if (target.targetParentGroupId !== null && ctx.grid.isColumnGroupMarried(target.targetParentGroupId)) return true;
  const firstLeaf = ctx.grid.getGroupLeafColIds(movingGroupId)[0];
  if (!firstLeaf) return false;
  const path = ctx.grid.getColGroupPath(firstLeaf);
  const sourceParentGroupId = path.length >= 2 ? path[path.length - 2]! : null;
  const isReparent = sourceParentGroupId !== target.targetParentGroupId;
  return isReparent && sourceParentGroupId !== null && ctx.grid.isColumnGroupMarried(sourceParentGroupId);
}

/** Position the insertion line at the resolved GAP boundary for a group
 *  drag: `computeGroupDropTarget` resolves the landing `{targetParentGroupId,
 *  beforeId}`, then the line sits at `beforeId`'s left edge — or the right
 *  edge of the last slot when `beforeId` is `undefined` (append at the
 *  very end). Task 2 — reject affordance: the line is HIDDEN (rather than
 *  left at its last position) when the drop is illegal
 *  (`computeGroupDropTarget` returns `null`) or would be rejected by
 *  `moveColumnGroup` (a married target — `isGroupDropRejected`). Returns
 *  whether the drop is currently rejected so the caller can flip the
 *  cursor to `no-drop` in lockstep. */
function updateGroupInsertionLinePosition(state: GroupDraggingState, ctx: VelocityGridEventCtx): boolean {
  if (!state.insertionLine) return false;
  const slots = buildHeaderSlots(ctx);
  const descendants = new Set(ctx.grid.getGroupDescendantIds(state.groupId));
  const target = computeGroupDropTarget(slots, state.groupId, descendants, ctx.point.x);
  if (isGroupDropRejected(ctx, state.groupId, target)) {
    state.insertionLine.style.display = 'none';
    return true;
  }
  // `isGroupDropRejected` returning false means `target` is non-null.
  const resolved = target as GroupDropTarget;
  let x: number;
  if (resolved.beforeId !== undefined) {
    const left = leftEdgeOfId(slots, resolved.beforeId);
    if (left === null) {
      state.insertionLine.style.display = 'none';
      return true;
    }
    x = left;
  } else {
    const last = slots[slots.length - 1];
    if (!last) {
      state.insertionLine.style.display = 'none';
      return true;
    }
    x = last.left + last.width;
  }
  state.insertionLine.style.display = '';
  state.insertionLine.style.transform = `translate3d(${Math.round(x)}px, 0px, 0)`;
  return false;
}

/** Build a pill ghost (`.vg-col-drag-ghost`) on `document.body` to show
 *  when a column-header drag enters the row group panel.  Uses the same
 *  pill style as the Columns tool panel's column-list row drag so the
 *  "I'm dropping a group chip" affordance reads consistently across
 *  drag sources.  Returns `null` in headless environments. */
function createPillGhost(ctx: VelocityGridEventCtx, colId: string): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  const label = ctx.grid.getHeaderName?.(colId) ?? colId;
  // Mounts hidden — `dispatchRowGroupPanelHover` adds the `--visible`
  // modifier only while the cursor is over the row group panel. During a
  // plain column reorder the header ghost is shown instead.
  const el = document.createElement('div');
  el.className = 'vg-col-drag-ghost';
  const icon = document.createElement('span');
  icon.className = 'vg-col-drag-ghost-icon';
  icon.setAttribute('aria-hidden', 'true');
  const lbl = document.createElement('span');
  lbl.className = 'vg-col-drag-ghost-label';
  lbl.textContent = label;
  el.appendChild(icon);
  el.appendChild(lbl);
  // Mount inside the themed ancestor so CSS variables resolve. Uses
  // position:fixed which stays viewport-relative as long as no ancestor
  // introduces a transform stacking context — grid containers don't.
  const themeHost =
    (ctx.grid.getOverlayHost?.()?.closest<HTMLElement>('[class*="vg-theme"]'))
    ?? document.body;
  themeHost.appendChild(el);
  return el;
}
