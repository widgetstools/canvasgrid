/**
 * Cycle 25 / Task 8 — pre-emptive viewport range expansion based on
 * scroll velocity. Pure function; no side effects.
 *
 * The grid calls this from `requestViewport()` before posting to the
 * worker. When the user is scrolling fast (velocity above the
 * threshold), we widen the requested row range in the scroll direction
 * so the chunk that comes back already covers the rows that are about
 * to scroll into view. Velocity is in rows-per-millisecond, computed
 * by the grid from `onScrollerScroll` deltas; positive = scrolling
 * down, negative = scrolling up.
 *
 * The cap (`maxPrefetch`, default 100) keeps the chunk size bounded
 * during a frantic fling — without it, a 5000 rows/sec velocity would
 * pull a 20× larger chunk than the body height and undo the latency
 * win the prefetch is meant to deliver.
 */

export interface ExpandRangeOptions {
  /** Below this absolute velocity (rows/ms) no prefetch is applied. */
  minVelocity?: number;
  /** Hard ceiling on the extra rows added in one direction. */
  maxPrefetch?: number;
  /** velocity × multiplier is the candidate prefetch (then clamped to
   *  `maxPrefetch`). Default 4 — at ~25 rows/ms the cap kicks in. */
  multiplier?: number;
}

export function expandRangeForVelocity(
  rowStart: number,
  rowEnd: number,
  velocityRowsPerMs: number,
  opts?: ExpandRangeOptions,
): { rowStart: number; rowEnd: number } {
  const minVel = opts?.minVelocity ?? 5;
  const maxPrefetch = opts?.maxPrefetch ?? 100;
  const multiplier = opts?.multiplier ?? 4;
  const v = velocityRowsPerMs;
  if (Math.abs(v) < minVel) return { rowStart, rowEnd };
  const extra = Math.min(maxPrefetch, Math.ceil(Math.abs(v) * multiplier));
  if (v > 0) return { rowStart, rowEnd: rowEnd + extra };
  return { rowStart: Math.max(0, rowStart - extra), rowEnd };
}
