/**
 * Worker-side autosize pass — measures the widest visible text per column
 * and returns the resolved width (text + per-cell horizontal padding,
 * clamped to the column's `minWidth` / `maxWidth`).
 *
 * Hot path uses the worker's `OffscreenCanvas.measureText` via the Cycle 5
 * `MeasureCache` LRU; callers fall back to a main-thread `measureText`
 * round-trip on platforms without `OffscreenCanvas`.
 *
 * Sample cap: a column with > 5,000 rows is scanned across the head
 * (first 2,500) + tail (last 2,500). The widest cell in either window
 * wins. This keeps a 1M-row autosize inside the per-cycle perf budget
 * (< 200 ms p95 on the demo).
 *
 * Cycle 6 / Task 4.
 */

import { measureKey, type MeasureCache } from './measureText';

/** Per-column input the autosize pass needs to size one leaf. */
export interface AutosizeColumnSpec {
  colId: string;
  /** Header label to include when `skipHeader: false`. */
  headerName: string;
  /** Resolved CSS font string used both as the measurer key and as the
   *  `ctx.font` for the `OffscreenCanvas` measurer. */
  font: string;
  /** Per-cell horizontal padding (left + right combined) to add on top of
   *  the measured text width. Matches the inline cell-painter padding so
   *  text doesn't sit flush against the column edge after an autosize. */
  padding: number;
  minWidth: number;
  maxWidth: number;
  /** Text accessor invoked once per sampled row. Returns the visible /
   *  formatted text (matching what the renderer paints). Empty strings
   *  contribute zero width. */
  textOf: (rowIndex: number) => string;
}

export interface MeasureColumnWidthsParams {
  cols: AutosizeColumnSpec[];
  /** Total visible-row count to walk (already filter + sort applied). */
  rowCount: number;
  /** When false, the header label is included in the max-width computation. */
  skipHeader: boolean;
  /** Caller-provided per-font measurer factory. Tests inject a synthetic
   *  measurer (`text.length * 8`); the worker passes `offscreenMeasurer`. */
  measureFor: (font: string) => (text: string) => number;
  /** Optional LRU cache (keyed by `font|width|text`) reused across pass
   *  invocations. Width is set to `0` for the autosize lookup since the
   *  column's measured width is the question we're answering. */
  cache?: MeasureCache;
  /** Sample-cap override. Defaults to 5,000 (head 2,500 + tail 2,500). */
  maxSampleSize?: number;
}

const DEFAULT_SAMPLE_CAP = 5_000;

/**
 * Walk a sampled window of rows for each column in `cols`, returning the
 * resolved per-column width as `Map<colId, number>` (clamped to
 * `minWidth` / `maxWidth` and inclusive of `padding`).
 *
 * Pure with respect to `cols` and `params.cache` — does not mutate either.
 */
export function measureColumnWidths(params: MeasureColumnWidthsParams): Map<string, number> {
  const { cols, rowCount, skipHeader, measureFor, cache } = params;
  const cap = params.maxSampleSize ?? DEFAULT_SAMPLE_CAP;
  const out = new Map<string, number>();

  // Build the head ∪ tail sample window. When rowCount fits the cap we
  // walk every row; otherwise we walk [0..cap/2) and [rowCount-cap/2..rowCount).
  // Cap = 0 ⇒ no rows sampled (header-only path); cap < 0 is ignored.
  const half = Math.max(0, Math.floor(cap / 2));
  const sampleHead = Math.min(rowCount, half);
  const sampleTailStart = Math.max(sampleHead, rowCount - half);

  // Per-font measurer cache. Building one measurer per font avoids
  // re-setting `ctx.font` per cell — a non-trivial CSS shorthand re-parse.
  const measurers = new Map<string, (text: string) => number>();
  const getMeasurer = (font: string): (text: string) => number => {
    let m = measurers.get(font);
    if (!m) { m = measureFor(font); measurers.set(font, m); }
    return m;
  };

  for (const col of cols) {
    const measure = getMeasurer(col.font);
    let max = 0;

    if (!skipHeader && col.headerName) {
      max = measureTextCached(col.headerName, col.font, measure, cache);
    }

    const consider = (rowIndex: number): void => {
      const text = col.textOf(rowIndex);
      if (!text) return;
      const w = measureTextCached(text, col.font, measure, cache);
      if (w > max) max = w;
    };

    for (let i = 0; i < sampleHead; i++) consider(i);
    for (let i = sampleTailStart; i < rowCount; i++) consider(i);

    const padded = max + col.padding;
    const clamped = Math.max(col.minWidth, Math.min(col.maxWidth, padded));
    out.set(col.colId, clamped);
  }

  return out;
}

/** Read-through measure with optional LRU cache. Width is keyed as `0` —
 *  autosize is solving for the width, so it's not a useful cache discriminator. */
function measureTextCached(
  text: string,
  font: string,
  measure: (s: string) => number,
  cache: MeasureCache | undefined,
): number {
  if (!cache) return measure(text);
  const key = measureKey(font, 0, text);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const w = measure(text);
  cache.set(key, w);
  return w;
}
