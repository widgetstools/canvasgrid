// Cycle 21e / Task 13 — pure per-mode flash alpha curves. The 'fade'
// branch reproduces FlashRegistry.getAlpha's original math EXACTLY
// (hold at 1 during flashDuration, linear 1→0 across fadeDuration) so
// the default path stays byte-identical.

export type FlashMode = 'fade' | 'pulse' | 'glow';

export function shapeFlashAlpha(
  mode: FlashMode,
  elapsed: number,
  flashDuration: number,
  fadeDuration: number,
): number {
  if (elapsed < 0) return 0;
  const total = flashDuration + fadeDuration;
  switch (mode) {
    case 'pulse': {
      // Two full sin² peaks over the window: 0 at t=0, 1 at t=0.25T,
      // 0 at t=0.5T, 1 at t=0.75T, 0 at t=T.
      if (total <= 0 || elapsed >= total) return 0;
      const t = elapsed / total;
      const s = Math.sin(Math.PI * 2 * t);
      return s * s;
    }
    case 'glow': {
      // Plateau at 1 for the first 60% of the window, then linear fade.
      if (total <= 0 || elapsed >= total) return 0;
      const t = elapsed / total;
      return t <= 0.6 ? 1 : (1 - t) / 0.4;
    }
    case 'fade':
    default: {
      if (elapsed <= flashDuration) return 1;
      const fadeElapsed = elapsed - flashDuration;
      if (fadeElapsed >= fadeDuration) return 0;
      return 1 - fadeElapsed / fadeDuration;
    }
  }
}
