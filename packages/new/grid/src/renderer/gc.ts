// Graphics-cache proxy ported from hypergrid's getCachedContext (Canvas.js).
//
// The 2D context's state properties (fillStyle, font, …) are surprisingly
// expensive to write in tight per-cell loops because each write triggers
// parser/lookup work even when the value is unchanged. The cache stores the
// last value set per property and only forwards to the real ctx when the value
// changes. Painters write through `gc.cache.fillStyle = …` instead of
// `gc.fillStyle = …`.
//
// Save/restore mirrors the ctx's transform/clip stack: `cache.save()` calls
// `gc.save()` AND swaps `values` for `Object.create(values)`, so subsequent
// reads/writes layer on a fresh frame whose pop reinstates the prior state.

// The explicit list is more robust than hypergrid's prototype walk: in modern
// browsers most 2D context members are non-enumerable on the prototype, so
// `Object.keys(Object.getPrototypeOf(gc))` returns nothing. Listing the
// settable state props by hand is reliable across browsers AND mock contexts.
const CACHED_PROPS = [
  'fillStyle', 'strokeStyle', 'font', 'textBaseline', 'textAlign',
  'lineWidth', 'globalAlpha', 'lineCap', 'lineJoin', 'miterLimit',
  'lineDashOffset', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur',
  'shadowColor', 'globalCompositeOperation', 'imageSmoothingEnabled',
  'direction', 'filter',
] as const;

export interface CanvasPaintState {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  lineWidth: number;
  globalAlpha: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  miterLimit?: number;
  lineDashOffset?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowBlur?: number;
  shadowColor?: string;
  globalCompositeOperation?: GlobalCompositeOperation;
  imageSmoothingEnabled?: boolean;
  direction?: CanvasDirection;
  filter?: string;
  save(): void;
  restore(): void;
}

export interface CachedContext2D extends CanvasRenderingContext2D {
  cache: CanvasPaintState;
  clearFill(x: number, y: number, w: number, h: number, color: string): void;
  /** Closeout C-1 — drop every cached value so the lazy-prime / first-write
   *  path re-syncs from the LIVE context. MUST be called whenever the
   *  canvas backing store is resized (`canvas.width`/`height` assignment
   *  resets the real 2d context to defaults — verified in real Chrome for
   *  both `HTMLCanvasElement` and `OffscreenCanvas` — while this cache
   *  would otherwise persist, silently skipping writes equal to the stale
   *  cached value). Call it OUTSIDE any `cache.save()` frame. */
  resetCache(): void;
}

// Matches 'transparent' or 'rgba(...)' / 'hsla(...)'. Group 4 = alpha number.
// Mirrors hypergrid's ALPHA_REGEX so we get the exact same semantics.
const ALPHA_REGEX = /^(transparent|((RGB|HSL)A\(.*,\s*([\d.]+)\)))$/i;

function alpha(cssColorSpec: string): number {
  if (!cssColorSpec) return 0;
  const m = cssColorSpec.match(ALPHA_REGEX);
  if (m === null) return 1;
  if (m[4] === undefined) return 0; // matched 'transparent'
  return Number(m[4]);
}

/** Task 4 (paint-cache layer) — minimal canvas surface `attachGcCache`
 *  actually needs. `HTMLCanvasElement` satisfies this structurally, and so
 *  does `OffscreenCanvas` / any test fake — widened from the original
 *  `HTMLCanvasElement`-only signature so `PaintCacheLayer` (which backs its
 *  retained layer with an `OffscreenCanvas` when available) can call this
 *  directly instead of casting through `as unknown as HTMLCanvasElement`. */
export interface GcCanvasLike {
  getContext(type: '2d', attrs?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

export function attachGcCache(
  canvas: GcCanvasLike,
  attrs: CanvasRenderingContext2DSettings = { alpha: false },
): CachedContext2D {
  const raw = canvas.getContext('2d', attrs);
  if (!raw) throw new Error('[velocity-grid] failed to get 2d context');
  const gc = raw as CanvasRenderingContext2D;

  // The values store. On save(), it's swapped for a prototype-chained child;
  // on restore(), the parent is reinstated. Lookups walk the chain so an
  // inner frame inherits the outer frame's state until it overrides.
  let values: Record<string, unknown> = {};

  const props: Record<string, unknown> = {};
  for (const key of CACHED_PROPS) {
    Object.defineProperty(props, key, {
      enumerable: true,
      get() {
        // Lazy-prime: first read fetches the ctx's current value so the
        // cache reflects what's actually set on the underlying canvas.
        if (values[key] === undefined) {
          const live = (gc as unknown as Record<string, unknown>)[key];
          if (live !== undefined) values[key] = live;
        }
        return values[key];
      },
      set(v: unknown) {
        if (v !== values[key]) {
          (gc as unknown as Record<string, unknown>)[key] = v;
          values[key] = v;
        }
      },
    });
  }
  props['save'] = function save(): void {
    gc.save();
    values = Object.create(values);
  };
  props['restore'] = function restore(): void {
    gc.restore();
    values = Object.getPrototypeOf(values) as Record<string, unknown>;
  };

  const cached = gc as CachedContext2D;
  cached.cache = props as unknown as CanvasPaintState;
  cached.resetCache = function resetCache(): void {
    values = {};
  };
  cached.clearFill = function clearFill(x, y, w, h, color): void {
    const a = alpha(color);
    if (a < 1) {
      // Translucent: clear first so previous frame doesn't blend through.
      gc.clearRect(x, y, w, h);
    }
    if (a > 0) {
      cached.cache.fillStyle = color;
      gc.fillRect(x, y, w, h);
    }
  };
  return cached;
}

// Exported for tests + future bundle painter.
export { alpha as parseAlpha };
