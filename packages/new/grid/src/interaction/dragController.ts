// Collapse target #6 — ONE drag controller.
//
// Legacy grew four independent drag orchestrations, each re-declaring the
// 4px threshold, each hand-rolling its own window listener pair, its own
// `dragStarted` latch, its own ghost teardown and its own idempotent
// cancel:
//
//   1. `features/columnDrag.ts`               — header column + column-group drag
//   2. `toolPanels/columns/visibilityPanel.ts` — panel row drag (incl. group hierarchy)
//   3. `toolPanels/columns/pillDrag.ts`        — zone pill drag (rgz / plz / valz)
//   4. `rowGroupPanel/host.ts` + `pivotPanel/host.ts` — zone chip reorder drag
//
// The gesture skeleton was identical in all four; only the hover routing
// and the drop verdict differed. `DragController` owns the skeleton:
//
//   press → (threshold crossed) → drag → release ⇒ drop | cancel
//
// and each call site supplies just the parts that are actually its own:
// `onDragStart` / `onDragMove` / `onDrop` / `onCancel`.
//
// Two event families are supported because the two halves of the grid
// legitimately need different ones, and this is observable behavior the
// parity tests pin:
//   • `'mouse'`   — canvas + columns-tool-panel drags, window mousemove/mouseup.
//   • `'pointer'` — row-group / pivot panel chips, which additionally take
//     a pointer capture and match on `pointerId` so a release outside the
//     chip still lands on the originating listener, and which must honour
//     `pointercancel`.
//
// Escape-to-cancel is available but OPT-IN (`cancelOnEscape`) and off by
// default: none of the four legacy orchestrations had it, and this port is
// not the place to invent it.

/** Threshold (CSS px) the pointer must move from the down-event before a
 *  press is promoted to a drag. ONE drag budget across the grid — the
 *  header drag, the panel row drag, the zone pill drag and the chip
 *  reorder drag all used a separately-declared `4` before this. */
export const DRAG_THRESHOLD_PX = 4;

/** Which DOM event family drives the gesture. See the module header for
 *  why both exist. */
export type DragFamily = 'mouse' | 'pointer';

/** The subset of `MouseEvent` / `PointerEvent` the controller reads. Kept
 *  structural so the panel tests' `PointerEvent` polyfill (jsdom / happy-dom
 *  ship no `PointerEvent`) satisfies it. */
export interface DragPointerEvent {
  clientX: number;
  clientY: number;
  button?: number;
  pointerId?: number;
  preventDefault?(): void;
}

/** Live gesture handle handed to every callback. */
export interface DragSession {
  /** Pointer position of the originating down-event. */
  readonly startX: number;
  readonly startY: number;
  /** True once the threshold has been crossed (i.e. we are really dragging
   *  rather than sitting on a press that may still turn out to be a click). */
  readonly dragging: boolean;
  /** `pointerId` of the originating event (pointer family only). */
  readonly pointerId: number;
  /** Tear the gesture down and run `onCancel`. Idempotent. */
  cancel(): void;
}

export interface DragBehavior {
  family?: DragFamily;
  /** Override the shared 4px threshold. Only do this with a reason. */
  thresholdPx?: number;
  /** Element to take a pointer capture on (pointer family only) so a
   *  release outside it still reports to this gesture. */
  captureOn?: HTMLElement | null;
  /** `preventDefault()` the down-event. The mouse-family sites do this to
   *  stop the browser's native text/image drag from hijacking the gesture. */
  preventDefaultOnDown?: boolean;
  /** Abort the gesture when Escape is pressed. Off by default — no legacy
   *  drag did this, and turning it on silently would be a new feature. */
  cancelOnEscape?: boolean;
  /** Skip the primary-button check. `FeatureChain` needs this: it routes
   *  EVERY canvas mousedown (including right-clicks, which the RightClick
   *  feature handles downstream) through the same gesture. */
  anyButton?: boolean;
  /** Fired once, when the threshold is first crossed. */
  onDragStart?(e: DragPointerEvent, s: DragSession): void;
  /** Fired on every move once dragging. Hover routing lives here. */
  onDragMove?(e: DragPointerEvent, s: DragSession): void;
  /** Release AFTER a real drag. The drop verdict lives here. */
  onDrop?(e: DragPointerEvent, s: DragSession): void;
  /** Release BELOW the threshold — the gesture was a click, not a drag.
   *  Nothing to commit, but some sites clear press-time decoration here. */
  onClickRelease?(e: DragPointerEvent, s: DragSession): void;
  /** Escape / `pointercancel` / an explicit `session.cancel()`. Also runs
   *  after `onDrop` / `onClickRelease` as the single teardown hook, so
   *  ghost + insertion-line removal only has to be written once. */
  onCancel?(): void;
}

/** Begin a gesture. Returns the session, or `null` when the down-event is
 *  not a primary-button press (right-click opens menus, middle is reserved).
 *
 *  The controller attaches its window listeners immediately — before the
 *  threshold is crossed — because it cannot know whether the press will
 *  become a drag until the pointer moves. */
export function beginDrag(down: DragPointerEvent, behavior: DragBehavior): DragSession | null {
  if (!behavior.anyButton && down.button !== undefined && down.button !== 0) return null;

  const family = behavior.family ?? 'mouse';
  const threshold = behavior.thresholdPx ?? DRAG_THRESHOLD_PX;
  const pointerId = down.pointerId ?? 1;
  const startX = down.clientX;
  const startY = down.clientY;

  if (behavior.preventDefaultOnDown) down.preventDefault?.();

  let dragging = false;
  let finished = false;

  const session: DragSession = {
    startX,
    startY,
    get dragging() { return dragging; },
    pointerId,
    cancel: () => teardown(true),
  };

  const moveEvt = family === 'pointer' ? 'pointermove' : 'mousemove';
  const upEvt = family === 'pointer' ? 'pointerup' : 'mouseup';

  /** Single teardown path for every exit — drop, click-release, Escape,
   *  `pointercancel`, explicit cancel. Idempotent: legacy had four separate
   *  `cancelDrag()` implementations and three of them could double-run. */
  function teardown(runCancel: boolean): void {
    if (finished) return;
    finished = true;
    window.removeEventListener(moveEvt, onMove as unknown as EventListener);
    window.removeEventListener(upEvt, onUp as unknown as EventListener);
    if (behavior.cancelOnEscape) window.removeEventListener('keydown', onKeyDown);
    if (family === 'pointer') {
      window.removeEventListener('pointercancel', onPointerCancel as unknown as EventListener);
      if (behavior.captureOn) {
        try {
          behavior.captureOn.releasePointerCapture(pointerId);
        } catch {
          // The pointer was never captured (browsers throw on an unknown
          // pointerId). The window listeners drove the gesture regardless.
        }
      }
    }
    if (runCancel) behavior.onCancel?.();
  }

  function matches(e: DragPointerEvent): boolean {
    // Pointer gestures must ignore a second, unrelated pointer (a stray
    // touch mid-drag would otherwise steer the ghost).
    return family !== 'pointer' || (e.pointerId ?? 1) === pointerId;
  }

  function onMove(e: DragPointerEvent): void {
    if (finished || !matches(e)) return;
    if (!dragging) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      dragging = true;
      behavior.onDragStart?.(e, session);
    }
    behavior.onDragMove?.(e, session);
  }

  function onUp(e: DragPointerEvent): void {
    if (finished || !matches(e)) return;
    const wasDragging = dragging;
    // Run the verdict BEFORE teardown so the drop handler can still read
    // the insertion line / ghost geometry it is about to commit against.
    if (wasDragging) behavior.onDrop?.(e, session);
    else behavior.onClickRelease?.(e, session);
    teardown(true);
  }

  function onPointerCancel(e: DragPointerEvent): void {
    if (!matches(e)) return;
    teardown(true);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') teardown(true);
  }

  if (family === 'pointer' && behavior.captureOn) {
    try {
      behavior.captureOn.setPointerCapture(pointerId);
    } catch {
      // Not fatal — window listeners still drive the gesture.
    }
  }

  window.addEventListener(moveEvt, onMove as unknown as EventListener);
  window.addEventListener(upEvt, onUp as unknown as EventListener);
  if (behavior.cancelOnEscape) window.addEventListener('keydown', onKeyDown);
  if (family === 'pointer') {
    window.addEventListener('pointercancel', onPointerCancel as unknown as EventListener);
  }

  return session;
}

// ---------------------------------------------------------------------------
// Shared drag vocabulary
// ---------------------------------------------------------------------------

/** Horizontal or vertical insertion marker. All four legacy orchestrations
 *  grew their own copy of "make a 2px absolutely-positioned div, inline a
 *  fallback style in case the theme hasn't shipped the class, move it, then
 *  remember to remove it". */
export interface InsertionLine {
  /** Mount (if needed) into `parent` and move to the given offset. */
  showAt(parent: HTMLElement, offset: number): void;
  hide(): void;
  remove(): void;
  readonly element: HTMLDivElement | null;
}

export function makeInsertionLine(
  className: string,
  axis: 'horizontal' | 'vertical' = 'horizontal',
): InsertionLine {
  let el: HTMLDivElement | null = null;
  const base = axis === 'horizontal'
    ? 'position:absolute; left:0; right:0; height:2px;'
    : 'position:absolute; top:0; bottom:0; width:2px;';
  return {
    get element() { return el; },
    showAt(parent, offset) {
      if (!el) {
        el = document.createElement('div');
        el.className = className;
        // Inline a minimum-viable visual so a theme that hasn't styled the
        // class still shows the indicator.
        el.style.cssText = `${base} background:var(--vg-color-accent, #4aa3ff); pointer-events:none; z-index:5; border-radius:1px;`;
      }
      if (el.parentElement !== parent) {
        parent.style.position = 'relative';
        parent.appendChild(el);
      }
      el.style.display = '';
      if (axis === 'horizontal') el.style.top = `${offset}px`;
      else el.style.left = `${offset}px`;
    },
    hide() {
      if (el) el.style.display = 'none';
    },
    remove() {
      el?.remove();
      el = null;
    },
  };
}
