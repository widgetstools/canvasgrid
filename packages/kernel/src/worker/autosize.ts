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
  /** Padding applied to the header label measurement when `skipHeader` is
   *  false. Defaults to `padding` when not supplied. Pass a larger value
   *  here (e.g. left-pad + sort-icon-pad + sort-icon-size) so the
   *  auto-sized width always reserves room for the sort/unsort caret. */
  headerPadding?: number;
  minWidth: number;
  maxWidth: number;
  /** Text accessor invoked once per sampled row. Returns the visible /
   *  formatted text (matching what the renderer paints). Empty strings
   *  contribute zero width. */
  textOf: (rowIndex: number) => string;
  /** When present, the pass measures the SYNTHESIZED auto-group column
   *  by walking a pre-flattened list of group nodes instead of sampling
   *  rows via `textOf`. Auto-group columns have no `field` and paint
   *  chevron + indent + valueFormatted + optional (count) — chrome the
   *  regular per-row-field measurement never captures. See the
   *  `AutosizeGroupContext` docstring for the width formula. */
  groupContext?: AutosizeGroupContext;
}

/** One tree node's contribution to the auto-group column autosize.
 *  The worker flattens `state.groupOutput.roots` into this shape; the
 *  formatted value matches what `chunk.groupValue[i]` carries into the
 *  `'group'` renderer, so the measured width reflects real paint output.
 */
export interface AutosizeGroupNode {
  /** Group node's formatted value (same source as `chunk.groupValue[i]`).
   *  Empty strings contribute zero to the value width but the chrome + indent
   *  still count (an empty group still paints its chevron). */
  valueFormatted: string;
  /** 0-indexed group depth in the tree. Drives the `depth × indentUnit`
   *  offset in singleColumn mode; ignored (indent=0) in multipleColumns. */
  depth: number;
  /** Descendant leaf-row count. Drives the `(count)` suffix width when
   *  `suppressCount === false`. Zero omits the suffix. */
  childCount: number;
}

/** Chrome-aware context for the synthesized auto-group column autosize.
 *  All width contributions the renderer paints but that don't originate
 *  from a row-object field live here. The renderer's per-cell paint
 *  formula (see `renderer/cellRenderers/group.ts`) is:
 *
 *    chromeBase + depth × indentUnit + measure(valueFormatted)
 *      + (childCount > 0 && !suppressCount ? countGap + measure(count) : 0)
 *
 *  where `chromeBase` folds in the two horizontal paddings, the chevron
 *  glyph + gap, and the optional tri-state checkbox slot + gap when
 *  `checkboxLocation === 'autoGroupColumn'` and a group-selects mode is
 *  active. The main thread computes `chromeBase` once at request time —
 *  the worker never needs the individual constants. */
export interface AutosizeGroupContext {
  /** Sum of static per-cell chrome in px:
   *    2 × PADDING + CHEVRON_SIZE + CHEVRON_GAP
   *    + (hasCheckbox ? CHECKBOX_SIZE + CHECKBOX_GAP : 0)
   *  Constants live in `renderer/cellRenderers/group.ts`. */
  chromeBase: number;
  /** Per-depth indent in px. Typically the `groupIndent` theme token
   *  (14). Pass 0 in multipleColumns mode — each column owns one depth,
   *  so the indent lives in the column ORDER rather than in the cell. */
  indentUnit: number;
  /** `true` suppresses the `(count)` suffix regardless of `childCount`
   *  (mirrors `CGridOptions.suppressCount` / `groupRowRendererParams.suppressCount`). */
  suppressCount: boolean;
  /** Gap between the value text and the `(count)` suffix in px.
   *  Constant in the renderer (`COUNT_GAP = 4`). */
  countGap: number;
  /** In `'multipleColumns'` mode the auto-group column at slot N only
   *  paints nodes at `depth === N`. When present, the pass filters the
   *  `nodes` list to that depth before measuring. Omit in `'singleColumn'`
   *  mode (all depths contribute; the widest wins). */
  groupColumnDepth?: number;
  /** Pre-flattened group tree. The worker walks `state.groupOutput.roots`
   *  once per request and hands the collected nodes in here — bounds the
   *  cost at `O(node count)` (typically << 5k, far below the leaf row
   *  count autosize would otherwise scan). */
  nodes: readonly AutosizeGroupNode[];
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
    let maxRaw = 0;

    if (col.groupContext) {
      // Auto-group column: walk the pre-flattened group tree instead of
      // sampling rows via `textOf`. `textOf` on a group column would
      // return '' for every row (no `field` on the synthesized def), so
      // the pre-groupContext path silently collapsed to header / minWidth.
      // The formula below MUST stay in lockstep with `groupCell.paint` in
      // `renderer/cellRenderers/group.ts` — every additive term there
      // needs a term here or the resulting width truncates the paint.
      maxRaw = maxGroupNodeWidth(col.groupContext, col.font, measure, cache);
    } else {
      let maxData = 0;

      const consider = (rowIndex: number): void => {
        const text = col.textOf(rowIndex);
        if (!text) return;
        const w = measureTextCached(text, col.font, measure, cache);
        if (w > maxData) maxData = w;
      };

      for (let i = 0; i < sampleHead; i++) consider(i);
      for (let i = sampleTailStart; i < rowCount; i++) consider(i);

      maxRaw = maxData + col.padding;
    }

    // Header padding uses col.headerPadding (defaults to col.padding).
    // The header padding is typically larger to reserve room for the
    // sort/unsort caret drawn at the right edge of each header cell.
    // Both the group and regular paths compete against the header
    // measurement so the auto-sized width always fits the label too.
    const hPad = col.headerPadding ?? col.padding;
    if (!skipHeader && col.headerName) {
      const headerW = measureTextCached(col.headerName, col.font, measure, cache) + hPad;
      if (headerW > maxRaw) maxRaw = headerW;
    }

    const clamped = Math.max(col.minWidth, Math.min(col.maxWidth, maxRaw));
    out.set(col.colId, clamped);
  }

  return out;
}

/** Auto-group column width — walks the pre-flattened tree, keeping the
 *  widest per-node paint width. Terms mirror `groupCell.paint` so a
 *  change in one MUST land in the other.
 *
 *  Per-node paint = chromeBase + depth × indentUnit + measure(value)
 *    + (childCount > 0 && !suppressCount ? countGap + measure(count) : 0)
 */
function maxGroupNodeWidth(
  ctx: AutosizeGroupContext,
  font: string,
  measure: (s: string) => number,
  cache: MeasureCache | undefined,
): number {
  const filterDepth = ctx.groupColumnDepth;
  let max = 0;
  for (const n of ctx.nodes) {
    if (filterDepth !== undefined && n.depth !== filterDepth) continue;
    // Indent contribution: multipleColumns mode passes indentUnit === 0
    // (each column owns one depth; indent lives in column order) OR the
    // filterDepth is set and every kept node has the same depth (also
    // yielding a uniform contribution). Either way the math still holds:
    // depth × 0 === 0, and constant depth × indentUnit is a per-node add.
    const indent = n.depth * ctx.indentUnit;
    const valueW = n.valueFormatted
      ? measureTextCached(n.valueFormatted, font, measure, cache)
      : 0;
    let countW = 0;
    if (n.childCount > 0 && !ctx.suppressCount) {
      const countText = `(${n.childCount.toLocaleString()})`;
      countW = ctx.countGap + measureTextCached(countText, font, measure, cache);
    }
    const total = ctx.chromeBase + indent + valueW + countW;
    if (total > max) max = total;
  }
  return max;
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
