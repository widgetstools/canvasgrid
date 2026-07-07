/**
 * FloatingPanelHost — draggable/resizable NON-MODAL panel frame.
 *
 * Overlays the grid root with a small floating window (title bar + body +
 * bottom-right resize handle) that hosts arbitrary panel DOM. Unlike
 * `ModalHost` (backdrop, focus trap, one-at-a-time) this is a lightweight
 * "floating panel" chrome: no backdrop, no focus trap, the grid stays
 * fully interactive underneath. `CGrid.openFloatingPanel` exposes this
 * generically; content that has somewhere to dock back to (e.g. a
 * side-bar tool panel) supplies `onDock` and gets a Dock button on the
 * titlebar, while content with nowhere to dock (e.g. the Column Groups
 * per-group Style editor) omits it and gets Close only.
 *
 * Content lifecycle is caller-owned: `open()` returns the body element for
 * the caller to fill, and `close()` only tears down the frame chrome — it
 * does not touch whatever DOM the caller appended (the caller reparents
 * its content out first if it wants to keep it alive, e.g. when docking).
 *
 * Drag (titlebar) and resize (corner handle) both follow the same
 * pointer-capture pattern used by `RowGroupPanelHost`'s pill reorder drag:
 * `setPointerCapture` on the element that received `pointerdown`, plus
 * window-level `pointermove`/`pointerup`/`pointercancel` listeners so the
 * gesture survives the pointer straying outside the frame. All the
 * position/size math is delegated to the pure `clampRect` helper in
 * `./geometry` so it's covered by DOM-free unit tests.
 */
import { clampRect, type FloatingBounds, type FloatingMinSize, type FloatingRect } from './geometry';

export type { FloatingRect };

export interface FloatingPanelOptions {
  title: string;
  /** Initial position/size. Any omitted field falls back to the default
   *  placement (top-right inset of `root`, `DEFAULT_WIDTH x DEFAULT_HEIGHT`). */
  rect?: Partial<FloatingRect>;
  /** "Dock" (re-dock into the sidebar) button clicked. Omit when the
   *  hosted content has nowhere to dock back to (e.g. a per-item detail
   *  editor rather than a whole tool panel) — the titlebar then renders
   *  Close only, no Dock button. */
  onDock?: () => void;
  /** Close (×) button clicked. */
  onClose: () => void;
  /** Fired (debounced ~120ms) after a drag or resize gesture settles —
   *  for persisting the panel's rect. NOT fired by `setRect()` (that's the
   *  caller restoring state, not the user changing it). */
  onRectChange?: (rect: FloatingRect) => void;
}

/** Default panel size when `opts.rect` doesn't specify one. */
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 420;
/** Inset from the root's top/right edge for the default placement. */
const DEFAULT_INSET = 16;
/** Floor on both dimensions — small enough to still show the titlebar +
 *  a sliver of body, large enough that the resize handle stays usable. */
const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;
const MIN_SIZE: FloatingMinSize = { w: MIN_WIDTH, h: MIN_HEIGHT };
/** Used only when `root` hasn't been laid out yet (`clientWidth/Height`
 *  read 0 — e.g. mounted before the grid's first paint). Keeps the
 *  initial placement sane instead of collapsing to the min size. */
const FALLBACK_BOUNDS: FloatingBounds = { w: 1200, h: 800 };
/** Debounce window for `onRectChange` after a drag/resize gesture ends. */
const RECT_CHANGE_DEBOUNCE_MS = 120;

// ── DOM helpers (house style — mirrors columnGroupsPanel.ts) ───────────────
function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function icon(...children: SVGElement[]): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  svg.setAttribute('class', 'cg-floating-panel-ic');
  children.forEach((c) => svg.appendChild(c));
  return svg;
}
const strokeAttrs = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
/** × — close. */
function iconClose(): SVGSVGElement {
  return icon(svgEl('path', { d: 'M18 6 6 18M6 6l12 12', ...strokeAttrs }));
}
/** "Dock to side" — a panel outline with a filled right rail and an arrow
 *  pointing INTO it, reading as "send this back into the sidebar". */
function iconDock(): SVGSVGElement {
  return icon(
    svgEl('rect', { x: '3', y: '4', width: '18', height: '16', rx: '2', ...strokeAttrs }),
    svgEl('path', { d: 'M15 4v16', ...strokeAttrs }),
    svgEl('path', { d: 'M11 9l3 3-3 3', ...strokeAttrs }),
  );
}

/** Active drag or resize gesture — the pointer's start position + the
 *  frame's rect at gesture start, so all math is delta-from-start rather
 *  than delta-from-last-move (avoids drift from rounding). */
interface Gesture {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startRect: FloatingRect;
}

export class FloatingPanelHost {
  private readonly root: HTMLElement;

  private frame: HTMLDivElement | null = null;
  private titlebar: HTMLDivElement | null = null;
  private titleEl: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private resizeHandle: HTMLDivElement | null = null;

  private rect: FloatingRect | null = null;
  private opts: FloatingPanelOptions | null = null;
  private rectChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private dragGesture: Gesture | null = null;
  private resizeGesture: Gesture | null = null;

  private readonly onTitlebarPointerDown = (e: PointerEvent) => this.handleDragStart(e);
  private readonly onDragPointerMove = (e: PointerEvent) => this.handleDragMove(e);
  private readonly onDragPointerUp = (e: PointerEvent) => this.handleDragEnd(e);
  private readonly onDragPointerCancel = (e: PointerEvent) => this.handleDragEnd(e);

  private readonly onResizeHandlePointerDown = (e: PointerEvent) => this.handleResizeStart(e);
  private readonly onResizePointerMove = (e: PointerEvent) => this.handleResizeMove(e);
  private readonly onResizePointerUp = (e: PointerEvent) => this.handleResizeEnd(e);
  private readonly onResizePointerCancel = (e: PointerEvent) => this.handleResizeEnd(e);

  constructor(root: HTMLElement) {
    this.root = root;
  }

  isOpen(): boolean {
    return this.frame !== null;
  }

  getRect(): FloatingRect | null {
    return this.rect ? { ...this.rect } : null;
  }

  /** Reposition/resize the open panel. Clamped into the root bounds. A
   *  no-op while closed. Does NOT fire `onRectChange` — this is the
   *  caller setting state (e.g. restoring a persisted rect), not the
   *  user dragging/resizing. */
  setRect(rect: Partial<FloatingRect>): void {
    if (!this.frame || !this.rect) return;
    const candidate: FloatingRect = { ...this.rect, ...rect };
    this.applyRect(clampRect(candidate, this.getBounds(), MIN_SIZE));
  }

  setTitle(title: string): void {
    if (this.titleEl) this.titleEl.textContent = title;
  }

  /** Create + show the frame; returns the BODY element for the caller to
   *  append its content into. Caller owns content lifecycle. Reopening
   *  while already open closes the prior frame first. */
  open(opts: FloatingPanelOptions): HTMLElement {
    if (this.destroyed) throw new Error('[cgrid] FloatingPanelHost.open() called after destroy()');
    if (this.frame) this.close();
    this.opts = opts;

    const bounds = this.getBounds();
    const w = opts.rect?.w ?? DEFAULT_WIDTH;
    const h = opts.rect?.h ?? DEFAULT_HEIGHT;
    const initial: FloatingRect = {
      x: opts.rect?.x ?? Math.max(0, bounds.w - w - DEFAULT_INSET),
      y: opts.rect?.y ?? DEFAULT_INSET,
      w,
      h,
    };
    const rect = clampRect(initial, bounds, MIN_SIZE);

    const frame = el('div', 'cg-floating-panel') as HTMLDivElement;
    frame.style.position = 'absolute';

    const titlebar = el('div', 'cg-floating-panel-titlebar') as HTMLDivElement;
    const titleEl = el('div', 'cg-floating-panel-title') as HTMLDivElement;
    titleEl.textContent = opts.title;
    const spacer = el('div', 'cg-floating-panel-spacer');
    const actions = el('div', 'cg-floating-panel-actions');

    // Dock button is optional — only rendered when the caller supplied
    // `onDock` (content that has somewhere to dock back to). Content with
    // nowhere to dock (e.g. a per-item detail editor) gets Close only.
    let dockBtn: HTMLButtonElement | null = null;
    if (opts.onDock) {
      dockBtn = document.createElement('button');
      dockBtn.type = 'button';
      dockBtn.className = 'cg-floating-panel-dock';
      dockBtn.setAttribute('aria-label', 'Dock panel');
      dockBtn.appendChild(iconDock());
      // Buttons must not start a titlebar drag — stop the pointerdown
      // before it reaches the titlebar's own listener.
      dockBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      dockBtn.addEventListener('click', () => this.opts?.onDock?.());
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cg-floating-panel-close';
    closeBtn.setAttribute('aria-label', 'Close panel');
    closeBtn.appendChild(iconClose());
    closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    closeBtn.addEventListener('click', () => this.opts?.onClose());

    if (dockBtn) actions.appendChild(dockBtn);
    actions.appendChild(closeBtn);
    titlebar.appendChild(titleEl);
    titlebar.appendChild(spacer);
    titlebar.appendChild(actions);
    titlebar.addEventListener('pointerdown', this.onTitlebarPointerDown);

    const body = el('div', 'cg-floating-panel-body') as HTMLDivElement;

    const resizeHandle = el('div', 'cg-floating-panel-resize') as HTMLDivElement;
    resizeHandle.addEventListener('pointerdown', this.onResizeHandlePointerDown);

    frame.appendChild(titlebar);
    frame.appendChild(body);
    frame.appendChild(resizeHandle);

    this.frame = frame;
    this.titlebar = titlebar;
    this.titleEl = titleEl;
    this.body = body;
    this.resizeHandle = resizeHandle;

    this.applyRect(rect);
    this.root.appendChild(frame);

    return body;
  }

  /** Remove the frame from the DOM. Does NOT touch/destroy the hosted
   *  content (the caller reparents it out first). Idempotent. */
  close(): void {
    if (!this.frame) return;
    this.titlebar?.removeEventListener('pointerdown', this.onTitlebarPointerDown);
    this.resizeHandle?.removeEventListener('pointerdown', this.onResizeHandlePointerDown);
    this.endDragListeners();
    this.endResizeListeners();
    this.dragGesture = null;
    this.resizeGesture = null;
    if (this.rectChangeTimer !== null) {
      clearTimeout(this.rectChangeTimer);
      this.rectChangeTimer = null;
    }
    this.frame.remove();
    this.frame = null;
    this.titlebar = null;
    this.titleEl = null;
    this.body = null;
    this.resizeHandle = null;
    this.rect = null;
    this.opts = null;
  }

  destroy(): void {
    this.close();
    this.destroyed = true;
  }

  // ---- internals ------------------------------------------------------

  private getBounds(): FloatingBounds {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    return { w: w > 0 ? w : FALLBACK_BOUNDS.w, h: h > 0 ? h : FALLBACK_BOUNDS.h };
  }

  private applyRect(rect: FloatingRect): void {
    this.rect = rect;
    if (!this.frame) return;
    this.frame.style.left = `${rect.x}px`;
    this.frame.style.top = `${rect.y}px`;
    this.frame.style.width = `${rect.w}px`;
    this.frame.style.height = `${rect.h}px`;
  }

  private scheduleRectChange(): void {
    const cb = this.opts?.onRectChange;
    if (!cb || !this.rect) return;
    if (this.rectChangeTimer !== null) clearTimeout(this.rectChangeTimer);
    this.rectChangeTimer = setTimeout(() => {
      this.rectChangeTimer = null;
      if (this.rect) cb(this.rect);
    }, RECT_CHANGE_DEBOUNCE_MS);
  }

  // ---- drag (titlebar) -------------------------------------------------

  private handleDragStart(e: PointerEvent): void {
    if (!this.rect || !this.titlebar) return;
    if (e.button !== 0) return; // left mouse / primary touch only
    e.preventDefault();
    this.dragGesture = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: { ...this.rect },
    };
    try {
      this.titlebar.setPointerCapture(e.pointerId);
    } catch {
      // Unsupported pointer id (rare) — the window-level listeners still
      // drive the gesture, so swallow.
    }
    window.addEventListener('pointermove', this.onDragPointerMove);
    window.addEventListener('pointerup', this.onDragPointerUp);
    window.addEventListener('pointercancel', this.onDragPointerCancel);
  }

  private handleDragMove(e: PointerEvent): void {
    const gesture = this.dragGesture;
    if (!gesture) return;
    const dx = e.clientX - gesture.startClientX;
    const dy = e.clientY - gesture.startClientY;
    const candidate: FloatingRect = {
      ...gesture.startRect,
      x: gesture.startRect.x + dx,
      y: gesture.startRect.y + dy,
    };
    this.applyRect(clampRect(candidate, this.getBounds(), MIN_SIZE));
  }

  private handleDragEnd(_e: PointerEvent): void {
    if (!this.dragGesture) return;
    this.dragGesture = null;
    this.endDragListeners();
    this.scheduleRectChange();
  }

  private endDragListeners(): void {
    window.removeEventListener('pointermove', this.onDragPointerMove);
    window.removeEventListener('pointerup', this.onDragPointerUp);
    window.removeEventListener('pointercancel', this.onDragPointerCancel);
  }

  // ---- resize (corner handle) ------------------------------------------

  private handleResizeStart(e: PointerEvent): void {
    if (!this.rect || !this.resizeHandle) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.resizeGesture = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: { ...this.rect },
    };
    try {
      this.resizeHandle.setPointerCapture(e.pointerId);
    } catch {
      // see handleDragStart
    }
    window.addEventListener('pointermove', this.onResizePointerMove);
    window.addEventListener('pointerup', this.onResizePointerUp);
    window.addEventListener('pointercancel', this.onResizePointerCancel);
  }

  private handleResizeMove(e: PointerEvent): void {
    const gesture = this.resizeGesture;
    if (!gesture) return;
    const dx = e.clientX - gesture.startClientX;
    const dy = e.clientY - gesture.startClientY;
    const bounds = this.getBounds();
    // The top-left anchor (startRect.x/y) must stay fixed while resizing
    // from the bottom-right handle — only width/height grow or shrink.
    // Clamping the candidate rect directly through `clampRect` would let
    // an oversized width push `x` back to keep the rect in bounds (correct
    // for drag, wrong here — it would visibly slide the panel while the
    // user is only resizing). Instead, clamp in a frame translated to the
    // anchor (so the anchor is always "in bounds" at local (0,0)) and cap
    // width/height to the room actually remaining beyond it.
    const localBounds: FloatingBounds = {
      w: Math.max(0, bounds.w - gesture.startRect.x),
      h: Math.max(0, bounds.h - gesture.startRect.y),
    };
    const localCandidate: FloatingRect = { x: 0, y: 0, w: gesture.startRect.w + dx, h: gesture.startRect.h + dy };
    const localClamped = clampRect(localCandidate, localBounds, MIN_SIZE);
    this.applyRect({ x: gesture.startRect.x, y: gesture.startRect.y, w: localClamped.w, h: localClamped.h });
  }

  private handleResizeEnd(_e: PointerEvent): void {
    if (!this.resizeGesture) return;
    this.resizeGesture = null;
    this.endResizeListeners();
    this.scheduleRectChange();
  }

  private endResizeListeners(): void {
    window.removeEventListener('pointermove', this.onResizePointerMove);
    window.removeEventListener('pointerup', this.onResizePointerUp);
    window.removeEventListener('pointercancel', this.onResizePointerCancel);
  }
}
