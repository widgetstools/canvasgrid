/**
 * Cycle 25 / Task 8 — pre-emptive viewport range expansion based on
 * scroll velocity. Pure function; no side effects.
 *
 * Deephaven's grid docs: fetch the visible window "plus a buffer for
 * snappier scrolling". We mirror that by widening the worker
 * `getViewport` range in the scroll direction when the user is flinging
 * so the chunk that comes back already covers rows about to enter view.
 *
 * The grid calls this from `requestViewport()` before posting to the
 * worker. Velocity is in rows-per-millisecond, computed from
 * `onScrollerScroll` deltas; positive = scrolling down, negative = up.
 *
 * The cap (`maxPrefetch`, default 100) keeps the chunk size bounded
 * during a frantic fling — without it, a 5000 rows/sec velocity would
 * pull a 20× larger chunk than the body height and undo the latency
 * win the prefetch is meant to deliver.
 */

export interface ExpandRangeOptions {
  /** Below this absolute velocity (rows/ms) no prefetch is applied.
   *  Default `0.5` — ~16 px/ms at 32px rows; ordinary wheel / trackpad
   *  samples clear it. (Was `5`, which required absurd ~160k px/s and
   *  effectively disabled prefetch on real scrolls.) */
  minVelocity?: number;
  /** Hard ceiling on the extra rows added in one direction. */
  maxPrefetch?: number;
  /** velocity × multiplier is the candidate prefetch (then clamped to
   *  `maxPrefetch`). Default 8 — thumb-drag samples clear this quickly;
   *  at ~25 rows/ms the cap still kicks in. */
  multiplier?: number;
}

export function expandRangeForVelocity(
  rowStart: number,
  rowEnd: number,
  velocityRowsPerMs: number,
  opts?: ExpandRangeOptions,
): { rowStart: number; rowEnd: number } {
  const minVel = opts?.minVelocity ?? 0.5;
  // Higher default than the old 100 so scrollbar thumb drags (large
  // per-tick jumps) pull a window that already covers the landing zone
  // instead of painting empty rows while a follow-up fetch catches up.
  const maxPrefetch = opts?.maxPrefetch ?? 250;
  const multiplier = opts?.multiplier ?? 8;
  const v = velocityRowsPerMs;
  if (Math.abs(v) < minVel) return { rowStart, rowEnd };
  const extra = Math.min(maxPrefetch, Math.ceil(Math.abs(v) * multiplier));
  if (v > 0) return { rowStart, rowEnd: rowEnd + extra };
  return { rowStart: Math.max(0, rowStart - extra), rowEnd };
}

export interface ExpandJumpOptions {
  /** Absolute row delta below which this is a no-op. Default 8 — covers
   *  PageDown / ensureRowIndexVisible jumps; ignores single-row arrows. */
  minJumpRows?: number;
  /** Extra rows to pull in the jump direction. Defaults to the current
   *  window height (one page) so the next PageDown is already covered. */
  pagePrefetch?: number;
  maxPrefetch?: number;
}

/**
 * Widen the fetch window after a discrete scroll jump (keyboard PageUp /
 * PageDown, Ctrl+Home/End, large thumb teleports). Velocity sampling often
 * reports 0 on these (idle gap ≥ 200ms), so `expandRangeForVelocity` alone
 * leaves the landing page uncovered until the next RTT.
 */
export function expandRangeForScrollDelta(
  rowStart: number,
  rowEnd: number,
  deltaRows: number,
  opts?: ExpandJumpOptions,
): { rowStart: number; rowEnd: number } {
  const minJump = opts?.minJumpRows ?? 8;
  if (Math.abs(deltaRows) < minJump) return { rowStart, rowEnd };
  const windowRows = Math.max(1, rowEnd - rowStart);
  const maxPrefetch = opts?.maxPrefetch ?? 250;
  const pagePrefetch = opts?.pagePrefetch ?? windowRows;
  const extra = Math.min(
    maxPrefetch,
    Math.max(pagePrefetch, Math.ceil(Math.abs(deltaRows))),
  );
  if (deltaRows > 0) return { rowStart, rowEnd: rowEnd + extra };
  return { rowStart: Math.max(0, rowStart - extra), rowEnd };
}
