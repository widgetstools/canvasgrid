/**
 * Pure chunk / damage / row-merge helpers shared by the host and the
 * data-plane facade.
 *
 * These were module-local functions in the legacy \`velocityGrid.ts\`. Splitting
 * the host meant two modules needed them, so they moved here rather than being
 * duplicated or re-exported through a cycle. DOM-free and side-effect-free;
 * the bodies are the legacy ones verbatim.
 *
 * \`mergeRowDataFields\` is the field-merge on partial payloads that SPEC.md
 * §2 lists as a workaround to preserve — thin ticks wipe columns without it.
 */

import type { ViewportChunk } from '../worker/protocol';
import type { ColumnLayout } from '../core/layout';
import type { Tx } from '../types/api';

/** Cycle 26 (fling-scroll partials) — max CONTIGUOUS RUNS of damaged rows
 *  a window-diff will still resolve as partial damage before bailing to a
 *  full repaint.
 *
 *  This replaces the old `WINDOW_DIFF_MAX_ROWS = 24` ROW-count cap, which
 *  counted the wrong thing: during a scroll the newly-entered rows are one
 *  CONTIGUOUS run, and the damage ledger now coalesces contiguous rows
 *  into a single full-width band rect (`takeResolved`'s rows banding) —
 *  so 40 consecutive rows cost ONE rect, strictly cheaper than a full
 *  repaint. Capping rows made every fast-scroll chunk arrival degrade to
 *  full (PERF-NOTES: 44–52% full paints at fling pace) for damage that
 *  would have resolved to one or two bands.
 *
 *  Runs are what actually cost: each run is one pre-merge rect. 12 aligns
 *  with the ledger's own `DAMAGE_MAX_RECTS` post-merge cap — beyond that
 *  the resolution would degrade to full anyway, so bail early here (and
 *  keep the strip-store wipe semantics of the full path). */
export const WINDOW_DIFF_MAX_RUNS = 12;

/** Count contiguous runs in a sorted ascending index array. */
export function countRuns(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  let runs = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! !== sorted[i - 1]! + 1) runs++;
  }
  return runs;
}

/**
 * Closeout fix — C2 + adjudication B's MANDATED guard. Replaces the old
 * `sameWindow` check (which compared only `(rowStart, rowCount)` and so
 * could not tell a window MOVE apart from a REORDER at an overlapping —
 * or identical — window). Diffs the previous chunk's row identity
 * (rowId + rowKind + groupKey, positionally, shifted by the window delta)
 * against the new chunk to find exactly which on-screen positions now
 * show a DIFFERENT row than they did last paint — those need repainting
 * even though their WINDOW POSITION didn't change. Any per-row height
 * mismatch inside the overlap bails to `'full'` outright: a height change
 * shifts every row below it, which is a geometry invalidation the
 * position-diff can't reason about locally (spec's "ambiguous → full").
 *
 * Returns `'full'` when there's no previous chunk to diff against (first
 * chunk ever), when `chunk.touchedRows` is `undefined` (unknown whether
 * any VALUE changed at an identity-matched position — "unknown stays
 * full", never assume "nothing changed" from absence), when the viewport
 * COLUMN SET changed (column-group expand/collapse, setColumnsVisible,
 * column move — new colIds would otherwise stick as blank under a
 * defined-empty `touchedRows` live-feed reply), when a height
 * mismatch is found, or when the damage spans more than
 * `WINDOW_DIFF_MAX_RUNS` contiguous runs. Otherwise returns the sorted
 * array of window-relative
 * row indices (0-based, add `chunk.rowStart` for the global index) that
 * need repainting: positionally-mismatched rows, rows newly scrolled
 * into the window (outside the overlap — this also covers the
 * previously-blitted "exposed band" per spec §5's chunk-arrival
 * re-damage contract), and `touchedRows` (value changes at an
 * identity-matched position — e.g. a live tick that doesn't reorder).
 */
/** Inclusive end row index for a chunk's data window (`[rowStart, end)`). */
export function chunkRowEnd(chunk: ViewportChunk): number {
  return chunk.rowStart + chunk.rowCount;
}

/** True when the chunk overlaps `[firstRow, lastRow]` (inclusive). */
export function chunkIntersectsRowRange(
  chunk: ViewportChunk, firstRow: number, lastRow: number,
): boolean {
  if (lastRow < firstRow) return true;
  return chunk.rowStart <= lastRow && chunkRowEnd(chunk) > firstRow;
}

/** On-screen data row span (excludes `rowBuffer` / paint-cache overscan
 *  padding that widens `firstRow`/`lastRow` for the worker fetch). */
export function onScreenDataRowRange(
  vs: { firstRow: number; lastRow: number; firstVisibleDataRow?: number },
): { first: number; last: number } | null {
  if (vs.lastRow < 0) return null;
  const firstVis = vs.firstVisibleDataRow ?? vs.firstRow;
  const pad = Math.max(0, firstVis - vs.firstRow);
  const lastVis = Math.max(firstVis, vs.lastRow - pad);
  return { first: firstVis, last: lastVis };
}

/** True when the chunk fully covers the on-screen data rows. */
export function chunkCoversOnScreenRows(
  chunk: ViewportChunk, vs: { firstRow: number; lastRow: number; firstVisibleDataRow?: number },
): boolean {
  const range = onScreenDataRowRange(vs);
  if (!range) return true;
  return chunk.rowStart <= range.first && chunkRowEnd(chunk) > range.last;
}

export function resolveWindowDamage(
  chunk: ViewportChunk,
  prevChunk: ViewportChunk | null,
): number[] | 'full' {
  if (!prevChunk) return 'full';
  if (chunk.touchedRows === undefined) return 'full';
  // Column-group expand / showColumns / etc. — row identity is unchanged
  // so touchedRows is often `[]` on a live blotter, but the chunk now
  // carries values for colIds the previous paint never had (or drops
  // ones that collapsed). Force full so those cells aren't left blank.
  if (viewportColumnSetChanged(prevChunk, chunk)) return 'full';
  const delta = chunk.rowStart - prevChunk.rowStart;
  const newCount = chunk.rowCount;
  const prevCount = prevChunk.rowCount;
  const overlapStart = Math.max(0, -delta);
  const overlapEnd = Math.min(newCount, prevCount - delta);
  const damaged = new Set<number>();
  for (let i = 0; i < newCount; i++) {
    if (i >= overlapStart && i < overlapEnd) {
      const j = i + delta;
      if (chunk.heights[i] !== prevChunk.heights[j]) return 'full';
      // rowIds alone is insufficient — group/footer rows share sentinel
      // ids, so identity also requires rowKind + groupKey agreement.
      const idMatch = chunk.rowIds[i] === prevChunk.rowIds[j]
        && chunk.rowKinds[i] === prevChunk.rowKinds[j]
        && (chunk.groupKey?.[i] ?? '') === (prevChunk.groupKey?.[j] ?? '');
      if (!idMatch) damaged.add(i);
    } else {
      damaged.add(i); // newly entered position — outside the overlap window
    }
  }
  for (const r of chunk.touchedRows) damaged.add(r);
  // Cap on contiguous RUNS, not rows — see WINDOW_DIFF_MAX_RUNS. The
  // sorted array is returned either way, so run counting is a single
  // linear pass over data we already produce.
  const sorted = Array.from(damaged).sort((a, b) => a - b);
  if (countRuns(sorted) > WINDOW_DIFF_MAX_RUNS) return 'full';
  return sorted;
}

/** True when the set of colIds present in numeric/text payload columns
 *  differs between two chunks (order-insensitive). */
export function viewportColumnSetChanged(prev: ViewportChunk, next: ViewportChunk): boolean {
  const prevKeys = viewportChunkColIds(prev);
  const nextKeys = viewportChunkColIds(next);
  if (prevKeys.size !== nextKeys.size) return true;
  for (const id of prevKeys) {
    if (!nextKeys.has(id)) return true;
  }
  return false;
}

export function viewportChunkColIds(chunk: ViewportChunk): Set<string> {
  const ids = new Set<string>();
  for (const id of Object.keys(chunk.numericCols)) ids.add(id);
  for (const id of Object.keys(chunk.textCols)) ids.add(id);
  return ids;
}

/** Usable rule/mirror field — blank chunk placeholders must not clobber. */
export function isUsableRowField(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  return true;
}

/** Field-merge for SSRM hydrate / tick patches: skip null/undefined so
 *  thin Perspective payloads do not wipe previously hydrated fields. */
export function mergeRowDataFields<TRow>(prev: TRow, row: TRow): TRow {
  const out: Record<string, unknown> = { ...(prev as object) as Record<string, unknown> };
  for (const [k, v] of Object.entries(row as object as Record<string, unknown>)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as TRow;
}

/** Mirror ⊕ snapshot for rule eval / getCellPaintedBg — mirror wins;
 *  snapshot only fills gaps with usable values. */
export function mergeRuleRowForPaint(
  mirror: Record<string, unknown> | undefined,
  snapshot: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!mirror && !snapshot) return undefined;
  if (!mirror) return snapshot;
  if (!snapshot) return mirror;
  const out: Record<string, unknown> = { ...mirror };
  for (const [k, v] of Object.entries(snapshot)) {
    if (!isUsableRowField(v)) continue;
    if (!isUsableRowField(out[k])) out[k] = v;
  }
  return out;
}

/** Conflate deferred async transactions for scroll-end flush — last write
 *  wins per row id (matches worker `asyncTransactionConflate`). */
export function mergeDeferredAsyncTransactions<TRow>(
  txs: Tx<TRow>[],
  getRowId: (row: TRow) => string | null,
): Tx<TRow> {
  const addById = new Map<string, TRow>();
  const updateById = new Map<string, TRow>();
  const removeById = new Map<string, TRow>();
  for (const t of txs) {
    if (t.add) {
      for (const row of t.add) {
        const id = getRowId(row);
        if (id === null) continue;
        removeById.delete(id);
        updateById.delete(id);
        addById.set(id, row);
      }
    }
    if (t.update) {
      for (const row of t.update) {
        const id = getRowId(row);
        if (id === null) continue;
        removeById.delete(id);
        if (addById.has(id)) addById.set(id, row);
        else updateById.set(id, row);
      }
    }
    if (t.remove) {
      for (const row of t.remove) {
        const id = getRowId(row);
        if (id === null) continue;
        addById.delete(id);
        updateById.delete(id);
        removeById.set(id, row);
      }
    }
  }
  const out: Tx<TRow> = {};
  if (addById.size > 0) out.add = Array.from(addById.values());
  if (updateById.size > 0) out.update = Array.from(updateById.values());
  if (removeById.size > 0) out.remove = Array.from(removeById.values());
  return out;
}

/** Closeout fix — C3: has any group/footer total or the grand-total
 *  changed since the previous chunk? Computed UNCONDITIONALLY (unlike the
 *  old code, which only ran this diff inside `enableCellChangeFlash` —
 *  the ONLY thing that routed changed totals into damage, so a
 *  flash-disabled grid never repainted a changed aggregate on the
 *  partial path). `changedGroupKeys` drives `repaintAggregateDamage`'s
 *  row lookup; `grandTotalChanged` drives its totals-band lookup. Absence
 *  of a previous totals record (first chunk with totals, or grouping/agg
 *  just activated) is NOT a change — there's no stale pixel to correct. */
export function diffAggregates(
  chunk: ViewportChunk,
  prevGroupTotals: Record<string, Record<string, unknown>> | undefined,
  prevChunkTotals: Record<string, unknown> | undefined,
): { changedGroupKeys: Set<string>; grandTotalChanged: boolean } {
  const changedGroupKeys = new Set<string>();
  if (chunk.groupTotals && prevGroupTotals) {
    for (const groupKey of Object.keys(chunk.groupTotals)) {
      const oldRec = prevGroupTotals[groupKey];
      const newRec = chunk.groupTotals[groupKey]!;
      if (recordChanged(oldRec, newRec)) changedGroupKeys.add(groupKey);
    }
  }
  const grandTotalChanged = chunk.totals !== undefined && prevChunkTotals !== undefined
    && recordChanged(prevChunkTotals, chunk.totals);
  return { changedGroupKeys, grandTotalChanged };
}

/** Shallow value diff — `true` when any key in `newRec` differs from
 *  `oldRec` (or `oldRec` is absent, i.e. a brand-new group this chunk). */
export function recordChanged(
  oldRec: Record<string, unknown> | undefined,
  newRec: Record<string, unknown>,
): boolean {
  if (!oldRec) return true;
  for (const k of Object.keys(newRec)) {
    if (oldRec[k] !== newRec[k]) return true;
  }
  return false;
}

/** Cycle 22 / Task 3 — value equality for the `columnLayout` setter's
 *  layoutEpoch guard. A repaint-poll re-measure reassigns a freshly-built
 *  but IDENTICAL layout every tick; comparing by value keeps those from
 *  wiping the Tier-2 strip store. O(columns), only runs while the strip
 *  store is live. */
export function columnLayoutsEqual(a: ColumnLayout[], b: ColumnLayout[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (x.colId !== y.colId || x.left !== y.left || x.width !== y.width || x.pinned !== y.pinned) {
      return false;
    }
  }
  return true;
}
