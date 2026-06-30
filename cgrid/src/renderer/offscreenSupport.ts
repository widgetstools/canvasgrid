/**
 * Cycle 25 / Task 4 — OffscreenCanvas paint-mode foundation.
 *
 * `paintMode` is a CGridOptions field that lets apps opt into a
 * worker-side painter. `'auto'` (default) picks `'offscreen'` only on
 * platforms where the `OffscreenCanvas` + `Worker` APIs are present,
 * and falls back to `'main'` otherwise. `'offscreen'` is an explicit
 * opt-in; it falls back to `'main'` rather than crashing when the
 * platform doesn't support it (so an SSR or test environment doesn't
 * blow up on construction).
 *
 * This file ships the support detection + resolution. The worker
 * painter is the follow-up that actually moves the renderer off the
 * main thread.
 */

export type PaintMode = 'main' | 'offscreen';
export type PaintModeOption = PaintMode | 'auto';

export function isOffscreenCanvasSupported(): boolean {
  return typeof (globalThis as any).OffscreenCanvas === 'function'
    && typeof (globalThis as any).Worker === 'function';
}

export function resolvePaintMode(mode: PaintModeOption | undefined): PaintMode {
  if (mode === 'main') return 'main';
  // 'offscreen' or 'auto' or undefined → use offscreen only if supported.
  return isOffscreenCanvasSupported() ? 'offscreen' : 'main';
}
