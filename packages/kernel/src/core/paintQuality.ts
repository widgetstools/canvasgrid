/**
 * Paint-quality resolution for no-GPU / software-raster hosts.
 *
 * Continuous scroll with the default paint-cache layer is ~2× the Canvas2D
 * work of the legacy path (offscreen body raster + present drawImage +
 * sync-fill). On SwiftShader / software GL that misses the frame budget.
 *
 * `qualityMode`:
 *   - `'performance'` — force paintCache off (keep rasterCache).
 *   - `'quality'` — keep the retained layer (default paintCache behaviour).
 *   - `'auto'` (default) — disable paintCache when the WebGL renderer is
 *     a known software rasterizer (SwiftShader, llvmpipe, …).
 *
 * Explicit `paintCache: true | false` always wins over `qualityMode`.
 */

export type QualityMode = 'auto' | 'quality' | 'performance';

export interface PaintQualityOptions {
  qualityMode?: QualityMode;
  paintCache?: boolean;
  paintCacheOverscan?: number;
}

/** Known software / basic-render WebGL renderer substrings (lowercased). */
const SOFTWARE_RENDERER_RE =
  /swiftshader|llvmpipe|softpipe|software|microsoft basic render|gdi generic|mesa offscreen|cpu rasterizer/;

/**
 * True when the page's WebGL stack is a software rasterizer.
 * Returns false when WebGL is unavailable (jsdom/tests) so default
 * paintCache behaviour is preserved in unit tests.
 */
export function isSoftwareCanvasRaster(
  getContext: typeof HTMLCanvasElement.prototype.getContext = typeof document !== 'undefined'
    ? HTMLCanvasElement.prototype.getContext
    : undefined as unknown as typeof HTMLCanvasElement.prototype.getContext,
): boolean {
  if (typeof document === 'undefined' || typeof getContext !== 'function') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = (getContext.call(canvas, 'webgl')
      || getContext.call(canvas, 'experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const renderer = String(
      dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    ).toLowerCase();
    return SOFTWARE_RENDERER_RE.test(renderer);
  } catch {
    return false;
  }
}

export interface AppliedPaintQuality {
  /** Whether paintCache was forced off by quality resolution. */
  disabledPaintCache: boolean;
  /** Reason string for diagnostics / tests. */
  reason: 'explicit-off' | 'explicit-on' | 'performance' | 'software-auto' | 'default-on';
}

/**
 * Mutates `options` in place so construction-time `paintCache` /
 * `paintCacheOverscan` reflect the resolved quality profile.
 */
export function applyPaintQualityDefaults(
  options: PaintQualityOptions,
  detectSoftware: () => boolean = isSoftwareCanvasRaster,
): AppliedPaintQuality {
  const mode: QualityMode = options.qualityMode ?? 'auto';

  if (options.paintCache === false) {
    if (options.paintCacheOverscan === undefined && mode === 'performance') {
      options.paintCacheOverscan = 0;
    }
    return { disabledPaintCache: true, reason: 'explicit-off' };
  }
  if (options.paintCache === true) {
    return { disabledPaintCache: false, reason: 'explicit-on' };
  }

  if (mode === 'performance') {
    options.paintCache = false;
    if (options.paintCacheOverscan === undefined) options.paintCacheOverscan = 0;
    return { disabledPaintCache: true, reason: 'performance' };
  }

  if (mode === 'auto' && detectSoftware()) {
    options.paintCache = false;
    if (options.paintCacheOverscan === undefined) options.paintCacheOverscan = 0;
    return { disabledPaintCache: true, reason: 'software-auto' };
  }

  return { disabledPaintCache: false, reason: 'default-on' };
}
