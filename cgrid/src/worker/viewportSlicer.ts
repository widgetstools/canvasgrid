/**
 * Cycle 15 / Task 2 — group-aware viewport slicer helpers.
 *
 * `GroupPass` (Task 1) produces a depth-first `flatOrder` listing every
 * group node followed by its descendant rows (leaves). When the user
 * collapses a group, that group's descendants must drop out of the
 * visible row set — but `flatOrder` itself stays fixed (computed once
 * per data/grouping mutation; expansion state is a runtime view).
 *
 * The helpers here build the collapse-aware view:
 *
 *   - `computeGroupVisibleOrder(flatOrder, expandedKeys)` materialises
 *     the in-order list of visible entries (one allocation per call).
 *     Useful when callers will iterate the whole list anyway (renderer,
 *     row-count derivation, lookup-by-key).
 *   - `computeGroupVisibleRowCount(flatOrder, expandedKeys)` counts
 *     without allocating — what the worker reports for `modelUpdated`
 *     row counts when the renderer hasn't asked for a viewport chunk yet.
 *   - `findVisibleIndexForGroup(visibleOrder, key)` resolves a group key
 *     to its visible-row index (or -1 when the group is hidden inside a
 *     collapsed ancestor) — the lookup the expand/collapse API (Task 6)
 *     will need to scroll a newly-toggled group into view.
 *   - `sliceGroupedViewport(...)` packs a windowed `ViewportChunk` from
 *     the visible-order list. Group rows occupy a chunk slot just like
 *     data rows (`rowKinds[i] = 1`, `groupDepth[i] = group.depth`); their
 *     numeric / text column cells are zero-filled (the `'group'` cell
 *     renderer in Task 4 paints chevron + indent + groupValue instead of
 *     reading per-column data). Task 3 will extend the chunk format with
 *     the explicit `groupValue / groupChildCount / isExpanded` parallel
 *     arrays the renderer reads — Task 2 establishes the windowing path
 *     so Task 3's additions are a pure additive layer.
 *
 * **Collapse-skip algorithm.** Single linear pass over `flatOrder`. We
 * track a `skipDepth: number` (-1 = not skipping). When we emit a
 * collapsed group at depth D, we set `skipDepth = D`; subsequent entries
 * with `depth > D` are dropped. Hitting any entry with `depth <= D`
 * (the next sibling at the same depth, or an ancestor's next child)
 * resets `skipDepth` and resumes emission. This is correct because
 * `GroupPass.apply` emits rows with `depth = rowGroupCols.length`
 * (strictly greater than every group depth), so a collapsed top-level
 * group's `skipDepth = 0` cleanly skips every nested group AND row
 * underneath without descending the tree manually.
 *
 * **Bypass path.** When `flatOrder.length === 0` (i.e. `GroupPass`
 * returned `bypassed: true`), the helpers return empty results and the
 * caller falls back to the existing flat-row `ViewportSlicer.slice` —
 * no allocation, no walk, no zero-arg fast path branch in the hot loop.
 */

import type { FlatOrderEntry } from './passes/groupPass';
import type { RowStore } from './dataPipeline';
import type { ViewportChunk, ViewportRequest, WorkerColumn } from './protocol';
import { encodeText } from './chunkFormat';

/** Entry in the group-aware visible-row list. Same shape as
 *  `FlatOrderEntry` — re-exported for callers that just want to talk
 *  about "visible rows" without coupling to the group pass module. */
export type VisibleRowEntry = FlatOrderEntry;

/** Materialise the in-order visible row list. */
export function computeGroupVisibleOrder(
  flatOrder: readonly FlatOrderEntry[],
  expandedKeys: ReadonlySet<string>,
): VisibleRowEntry[] {
  const out: VisibleRowEntry[] = [];
  let skipDepth = -1;
  for (let i = 0; i < flatOrder.length; i++) {
    const entry = flatOrder[i]!;
    if (skipDepth >= 0 && entry.depth > skipDepth) continue;
    skipDepth = -1;
    out.push(entry);
    if (entry.kind === 'group' && !expandedKeys.has(entry.key)) {
      skipDepth = entry.depth;
    }
  }
  return out;
}

/** Visible-row count without materialising the list — for `getRowCount`
 *  paths that only need the integer (e.g. `modelUpdated` push payload). */
export function computeGroupVisibleRowCount(
  flatOrder: readonly FlatOrderEntry[],
  expandedKeys: ReadonlySet<string>,
): number {
  let count = 0;
  let skipDepth = -1;
  for (let i = 0; i < flatOrder.length; i++) {
    const entry = flatOrder[i]!;
    if (skipDepth >= 0 && entry.depth > skipDepth) continue;
    skipDepth = -1;
    count++;
    if (entry.kind === 'group' && !expandedKeys.has(entry.key)) {
      skipDepth = entry.depth;
    }
  }
  return count;
}

/** Resolve a group key to its visible-row index, or -1 when the group
 *  is hidden inside a collapsed ancestor. Linear scan — adequate for the
 *  small number of "scroll this group into view" callers; if a future
 *  cycle needs a hot lookup, swap to a key→index map built once per
 *  expandedKeys change. */
export function findVisibleIndexForGroup(
  visibleOrder: readonly VisibleRowEntry[],
  groupKey: string,
): number {
  for (let i = 0; i < visibleOrder.length; i++) {
    const entry = visibleOrder[i]!;
    if (entry.kind === 'group' && entry.key === groupKey) return i;
  }
  return -1;
}

/** Pack a windowed `ViewportChunk` from a visible-order list.
 *
 *  `postFilterIds` is the rowId array fed into `GroupPass.apply` — the
 *  `rowIndex` on each row-kind entry indexes into it. Group-kind entries
 *  carry no rowId; their chunk slot reports `rowIds[i] = 0`, column data
 *  zero-filled, `rowKinds[i] = 1` and `groupDepth[i] = entry.depth`.
 *
 *  Out-of-range `req.rowStart / rowEnd` clamp the same way the flat
 *  `ViewportSlicer.slice` does — main asks for an overscan window past
 *  the end of the visible set and gets a short chunk back, not an error. */
export function sliceGroupedViewport<TRow>(
  store: RowStore<TRow>,
  colIndex: ReadonlyMap<string, WorkerColumn>,
  postFilterIds: readonly string[],
  visibleOrder: readonly VisibleRowEntry[],
  req: ViewportRequest,
  pendingFlashes?: Map<string, Set<string>>,
): ViewportChunk {
  const rowStart = Math.max(0, req.rowStart);
  const rowEnd = Math.min(visibleOrder.length, req.rowEnd);
  const count = Math.max(0, rowEnd - rowStart);

  const rowIds = new Uint32Array(count);
  const rowKinds = new Uint8Array(count);
  const groupDepth = new Uint8Array(count);
  const heights = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const entry = visibleOrder[rowStart + i]!;
    groupDepth[i] = entry.depth;
    if (entry.kind === 'group') {
      rowKinds[i] = 1;
      continue;
    }
    const rowId = postFilterIds[entry.rowIndex];
    if (rowId === undefined) continue;
    rowIds[i] = store.getNumericId(rowId);
    heights[i] = store.effectiveShippedHeight(rowId);
  }

  const numericCols: Record<string, Float64Array> = {};
  const textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }> = {};

  for (const colId of req.columns) {
    const col = colIndex.get(colId);
    if (!col || !col.field) continue;
    const field = col.field;
    if (col.type === 'number') {
      const arr = new Float64Array(count);
      for (let i = 0; i < count; i++) {
        const entry = visibleOrder[rowStart + i]!;
        if (entry.kind === 'group') continue;
        const rowId = postFilterIds[entry.rowIndex];
        if (rowId === undefined) continue;
        const row = store.getById(rowId);
        arr[i] = Number((row as Record<string, unknown> | undefined)?.[field]);
      }
      numericCols[colId] = arr;
    } else {
      const values: string[] = new Array(count);
      for (let i = 0; i < count; i++) {
        const entry = visibleOrder[rowStart + i]!;
        if (entry.kind === 'group') {
          values[i] = '';
          continue;
        }
        const rowId = postFilterIds[entry.rowIndex];
        if (rowId === undefined) {
          values[i] = '';
          continue;
        }
        const row = store.getById(rowId);
        const v = (row as Record<string, unknown> | undefined)?.[field];
        values[i] = v == null ? '' : String(v);
      }
      textCols[colId] = encodeText(values);
    }
  }

  // flashMask packing — group rows contribute no pending flashes (the
  // worker only diffs `applyTransaction.update` data rows, so a group's
  // rowKey is never in pendingFlashes). The bit layout matches the flat
  // slicer's: bit `r * colCount + c`, row-major.
  let flashMask: Uint8Array | undefined;
  if (
    pendingFlashes !== undefined && pendingFlashes.size > 0
    && req.includeFlashMask !== false
    && count > 0 && req.columns.length > 0
  ) {
    const colCount = req.columns.length;
    const totalBits = count * colCount;
    const mask = new Uint8Array((totalBits + 7) >>> 3);
    let anySet = false;
    const colFields: Array<string | undefined> = new Array(colCount);
    for (let c = 0; c < colCount; c++) {
      const col = colIndex.get(req.columns[c]!);
      colFields[c] = col?.field;
    }
    for (let r = 0; r < count; r++) {
      const entry = visibleOrder[rowStart + r]!;
      if (entry.kind !== 'row') continue;
      const rowId = postFilterIds[entry.rowIndex];
      if (rowId === undefined) continue;
      const fields = pendingFlashes.get(rowId);
      if (!fields || fields.size === 0) continue;
      for (let c = 0; c < colCount; c++) {
        const field = colFields[c];
        if (!field || !fields.has(field)) continue;
        const bitIdx = r * colCount + c;
        mask[bitIdx >>> 3]! |= 1 << (bitIdx & 7);
        anySet = true;
      }
    }
    if (anySet) flashMask = mask;
  }

  return {
    rowStart,
    rowCount: count,
    rowIds,
    rowKinds,
    groupDepth,
    heights,
    numericCols,
    textCols,
    flashMask,
  };
}
