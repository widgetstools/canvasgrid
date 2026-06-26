// Canvas wrapper ported from hypergrid's lib/Canvas.js.
//
// Owns the <canvas> element, the cached graphics context, the RAF paint loop,
// and the polling resize loop. The component (Renderer) is called via
// `component.setBounds(bounds)` on each resize and `component.paint(gc)`
// every paint tick — both inside the same call when resizing, which is the
// key trick that makes hypergrid resize-flicker-free.

import { attachGcCache, type CachedContext2D } from '../renderer/gc';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaintComponent {
  setBounds(b: Bounds): void;
  paint(gc: CachedContext2D): void;
}

export interface CanvasOptions {
  /** Frames per second cap for the global RAF tick. 0 disables RAF (no scheduled paints). */
  fpsCap?: number;
  /** Resize-poll interval in milliseconds. Default 200. */
  resizePollMs?: number;
  /** Apply devicePixelRatio scaling. Default true. */
  useHiDPI?: boolean;
  /** Context attributes. Default `{ alpha: false }` (opaque backing store). */
  contextAttributes?: CanvasRenderingContext2DSettings;
  /** Override how the host's drawable size is measured. Defaults to host.getBoundingClientRect().
   *  cgrid uses this to read the scroller's clientWidth/clientHeight (which excludes
   *  scrollbar gutters) so the canvas doesn't overlap the native scrollbars. */
  measureSize?: (host: HTMLElement) => { width: number; height: number };
}

const DEFAULT_FPS_CAP = 60;
const DEFAULT_RESIZE_POLL_MS = 200;

// Module-level loops, shared across all CGridCanvas instances.
// Mirrors hypergrid's single RAF + single resize interval design.
const paintables: Set<CGridCanvas> = new Set();
const resizables: Set<CGridCanvas> = new Set();
let paintRequest: number | null = null;
let resizeInterval: ReturnType<typeof setInterval> | null = null;

function paintLoopFunction(now: number): void {
  paintables.forEach((p) => {
    try { p.tickPaint(now); } catch (e) { console.error(e); }
  });
  if (paintables.size > 0) {
    paintRequest = requestAnimationFrame(paintLoopFunction);
  } else {
    paintRequest = null;
  }
}

function ensurePaintLoop(): void {
  if (paintRequest === null && paintables.size > 0) {
    paintRequest = requestAnimationFrame(paintLoopFunction);
  }
}

function resizablesLoopFunction(): void {
  resizables.forEach((r) => {
    try { r.checkSize(); } catch (e) { console.error(e); }
  });
}

function ensureResizeLoop(resizePollMs: number): void {
  if (resizeInterval === null && resizables.size > 0) {
    resizeInterval = setInterval(resizablesLoopFunction, resizePollMs);
  }
}

function stopLoopsIfIdle(): void {
  if (paintables.size === 0 && paintRequest !== null) {
    cancelAnimationFrame(paintRequest);
    paintRequest = null;
  }
  if (resizables.size === 0 && resizeInterval !== null) {
    clearInterval(resizeInterval);
    resizeInterval = null;
  }
}

export class CGridCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly gc: CachedContext2D;
  bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  devicePixelRatio = 1;

  private readonly host: HTMLElement;
  private readonly component: PaintComponent;
  private readonly fpsCap: number;
  private readonly useHiDPI: boolean;
  private readonly measureSize: (host: HTMLElement) => { width: number; height: number };
  private readonly resizePollMs: number;

  private width = 0;
  private height = 0;
  private dirty = false;
  private lastRepaintTime = 0;
  private destroyed = false;
  /** Cycle 11 / Task 2 — top-left offset (in CSS px) the canvas should
   *  sit at inside its host. Set by `setHostBounds` so a left-positioned
   *  side bar can shift the canvas right by the side bar's reserved
   *  width. Default {left:0, top:0}. */
  private hostOffset = { left: 0, top: 0 };

  constructor(host: HTMLElement, component: PaintComponent, opts: CanvasOptions = {}) {
    this.host = host;
    this.component = component;
    this.fpsCap = opts.fpsCap ?? DEFAULT_FPS_CAP;
    this.useHiDPI = opts.useHiDPI ?? true;
    this.resizePollMs = opts.resizePollMs ?? DEFAULT_RESIZE_POLL_MS;
    this.measureSize = opts.measureSize ?? ((h) => {
      const r = h.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cg-canvas';
    this.canvas.style.cssText = 'display:block; position:absolute; left:0; top:0; outline:none;';
    this.canvas.tabIndex = 0;
    this.gc = attachGcCache(this.canvas, opts.contextAttributes ?? { alpha: false });
    host.appendChild(this.canvas);

    // Synchronous first paint inside resize() — no transparent gap between
    // attach and first frame.
    this.resize();

    paintables.add(this);
    resizables.add(this);
    ensurePaintLoop();
    ensureResizeLoop(this.resizePollMs);
  }

  /** Mark this canvas as needing a repaint on the next RAF tick. */
  requestRepaint(): void {
    this.dirty = true;
  }

  /** Force an immediate synchronous paint, bypassing the RAF + FPS gate. */
  paintNow(): void {
    if (this.destroyed) return;
    this.gc.cache.save();
    try {
      this.dirty = false;
      this.component.paint(this.gc);
    } catch (e) {
      console.error(e);
    } finally {
      this.gc.cache.restore();
    }
  }

  /** Cycle 11 / Task 2 — shift the canvas element by `(left, top)` CSS
   *  pixels inside the host. Used by `SideBarHost` so a left-positioned
   *  side bar can vacate the leftmost gutter. `measureSize` is expected
   *  to ALSO honor the gutter (typically by reading the scroller's
   *  `clientWidth`, which the cgrid host has already shrunk to match).
   *  Triggers an immediate `resize()` so the canvas re-fits + repaints
   *  in the same call. */
  setHostBounds(offset: { left: number; top: number }): void {
    this.hostOffset = { left: offset.left, top: offset.top };
    this.canvas.style.left = `${offset.left}px`;
    this.canvas.style.top = `${offset.top}px`;
    this.resize();
  }

  /** Re-measure host, re-fit canvas backing store + style, notify component, paint synchronously. */
  resize(): void {
    if (this.destroyed) return;
    const size = this.measureSize(this.host);
    this.width = size.width;
    this.height = size.height;
    const dpr = this.useHiDPI ? (window.devicePixelRatio || 1) : 1;
    this.devicePixelRatio = dpr;
    const newW = Math.round(this.width * dpr);
    const newH = Math.round(this.height * dpr);
    const styleW = this.width + 'px';
    const styleH = this.height + 'px';

    // Skip the assignment when backing store + style already match — assigning
    // canvas.width or height clears the backing store even when the value is
    // identical, which would itself be a flicker source on resize-poll no-ops.
    const sameBacking = this.canvas.width === newW && this.canvas.height === newH;
    const sameStyle = this.canvas.style.width === styleW && this.canvas.style.height === styleH;
    if (!sameBacking) {
      this.canvas.width = newW;
      this.canvas.height = newH;
      // Backing store was just cleared — reset the transform so subsequent
      // drawing operations are in CSS pixels.
      this.gc.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (!sameStyle) {
      this.canvas.style.width = styleW;
      this.canvas.style.height = styleH;
    }

    this.bounds = { x: 0, y: 0, width: this.width, height: this.height };
    this.component.setBounds(this.bounds);
    // SYNCHRONOUS — paint in the same call so the canvas is never visibly blank
    // between the size change and the next RAF tick.
    this.paintNow();
  }

  /** Resize-loop callback: re-measure, re-fit only if dimensions changed. */
  checkSize(): void {
    if (this.destroyed) return;
    const size = this.measureSize(this.host);
    if (size.width !== this.width || size.height !== this.height) {
      this.resize();
    }
  }

  /** RAF tick — gated by fpsCap + dirty flag. */
  tickPaint(now: number): void {
    if (this.destroyed) return;
    const fps = this.fpsCap;
    if (fps === 0) return;
    const interval = 1000 / fps;
    const elapsed = now - this.lastRepaintTime;
    if (elapsed > interval && this.dirty) {
      this.paintNow();
      this.lastRepaintTime = now;
    }
  }

  /** Return canvas-local CSS-px coordinates for a mouse/pointer event. */
  getLocal(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    paintables.delete(this);
    resizables.delete(this);
    stopLoopsIfIdle();
    this.canvas.parentElement?.removeChild(this.canvas);
  }
}
