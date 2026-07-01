// Cycle 19 / Task 7 — pill drag orchestrator shared by the three zone
// panels (Row Groups / Column Labels / Values).
//
// On release:
//   • Drop inside the source zone → within-zone reorder via
//     `onReorder(toIndex)`.
//   • Drop lands on a DIFFERENT pill panel that accepts the column →
//     atomic cross-panel move via `api.commitPanelMove`. Role-change
//     events drive the panel rebuild — `onDragOut` is NOT called.
//   • Otherwise → `onDragOut()` fires (removes the pill from this
//     zone's role).

import type { CGridApi } from '../../../types';
import {
  DRAG_THRESHOLD_PX,
  getZoneRect,
  isPointInRect,
  makeDragGhost,
  type ZoneKind,
} from './shared';

/** Options threaded into `beginPillDrag`. Every zone panel supplies
 *  the same shape — only the `sourceRole` + callbacks differ. */
export interface BeginPillDragOptions {
  e: MouseEvent;
  pillEl: HTMLElement;
  zone: ZoneKind;
  colId: string;
  label: string;
  /** Panel's root host — used to append the drag ghost into the
   *  closest theme ancestor. */
  rootHost: HTMLElement;
  /** Grid API (used only for cross-panel routing). */
  api: CGridApi;
  /** Called when the drop lands outside every accepting zone (fallback
   *  = remove from this zone's role). */
  onDragOut: () => void;
  /** Called when the drop lands inside the source zone → reorder the
   *  pill to `toIndex`. */
  onReorder: (toIndex: number) => void;
  /** Live accessor for the source zone's outer drop-zone rect. */
  getZoneRect: () => DOMRect | null;
  /** Live accessor for the source zone's inner pill-container. */
  getZoneContent: () => HTMLElement | null;
}

export function beginPillDrag(opts: BeginPillDragOptions): void {
  opts.e.preventDefault();
  const startX = opts.e.clientX;
  const startY = opts.e.clientY;
  let dragging = false;
  const ghost = makeDragGhost(opts.rootHost, opts.label);
  let insertionLine: HTMLDivElement | null = null;

  const liftedClass = `cg-columns-panel-${opts.zone}-pill--lifted`;

  /** Resolve the slot index (0..pills.length) the cursor is hovering
   *  over inside the zone's content container. The slot matches the
   *  AG-Grid `moveInArray` semantics — it indexes into the FULL pill
   *  list (including the dragged pill, which sits at its original
   *  position with `visibility:hidden`). */
  const computeSlotIndex = (clientY: number): { slot: number; gapY: number } | null => {
    const content = opts.getZoneContent();
    if (!content) return null;
    const pills = Array.from(content.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement
        && el.classList.contains('cg-columns-panel-pill'),
    );
    if (pills.length === 0) {
      const rect = content.getBoundingClientRect();
      return { slot: 0, gapY: rect.top + 4 };
    }
    // Compare against each pill's vertical midpoint.
    let slot = pills.length;
    let gapY = pills[pills.length - 1]!.getBoundingClientRect().bottom + 1;
    for (let i = 0; i < pills.length; i++) {
      const r = pills[i]!.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (clientY < mid) { slot = i; gapY = r.top - 1; break; }
    }
    return { slot, gapY };
  };

  const mountInsertionLine = (clientY: number): void => {
    const content = opts.getZoneContent();
    if (!content) return;
    const target = computeSlotIndex(clientY);
    if (!target) return;
    if (!insertionLine) {
      insertionLine = document.createElement('div');
      insertionLine.className = 'cg-columns-panel-insertion-line';
      // Inline a minimum-viable visual so themes that haven't styled
      // the class still see the indicator.
      insertionLine.style.cssText =
        'position:absolute; left:0; right:0; height:2px; background:var(--cg-color-accent, #4aa3ff); pointer-events:none; z-index:5; border-radius:1px;';
    }
    const zoneRect = content.getBoundingClientRect();
    if (insertionLine.parentElement !== content) content.style.position = 'relative';
    if (insertionLine.parentElement !== content) content.appendChild(insertionLine);
    insertionLine.style.top = `${target.gapY - zoneRect.top}px`;
  };

  const removeInsertionLine = (): void => {
    insertionLine?.remove();
    insertionLine = null;
  };

  const onMove = (ev: MouseEvent) => {
    if (!dragging) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      opts.pillEl.classList.add(liftedClass);
      ghost.mount(ev.clientX, ev.clientY);
    }
    ghost.position(ev.clientX, ev.clientY);
    // Paint the insertion line while the cursor is inside the source
    // zone (within-zone reorder feedback). Clear it otherwise so a
    // cross-panel drag doesn't leave a stale marker behind.
    if (isPointInRect(opts.getZoneRect(), ev.clientX, ev.clientY)) {
      mountInsertionLine(ev.clientY);
    } else {
      removeInsertionLine();
    }
  };

  const sourceRole: 'rowGroup' | 'pivot' | 'value' =
    opts.zone === 'rgz' ? 'rowGroup' :
    opts.zone === 'plz' ? 'pivot' :
    'value';

  const onUp = (ev: MouseEvent) => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    opts.pillEl.classList.remove(liftedClass);
    ghost.remove();
    removeInsertionLine();
    if (!dragging) return;
    // Drop landed inside the source zone → within-zone reorder.
    if (isPointInRect(opts.getZoneRect(), ev.clientX, ev.clientY)) {
      const target = computeSlotIndex(ev.clientY);
      if (target) opts.onReorder(target.slot);
      return;
    }
    // Try routing to a foreign pill panel first. If the target accepts,
    // the column moves to the new role; the panel rebuild happens
    // through the role-change event. Only fall back to
    // remove-from-current-role when no foreign panel accepted.
    const target = opts.api.resolveDragTargetRole?.(ev.clientX, ev.clientY) ?? null;
    if (target && target !== sourceRole) {
      const moved = opts.api.commitPanelMove?.(sourceRole, target, opts.colId) ?? false;
      if (moved) return;
    }
    opts.onDragOut();
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  // Reference to silence tslint no-unused-vars if imports change.
  void getZoneRect;
}
