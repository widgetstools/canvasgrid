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
import type { CalcValueSource } from './passes/calcPass';

/** Entry in the group-aware visible-row list. Same shape as
 *  `FlatOrderEntry` — re-exported for callers that just want to talk
 *  about "visible rows" without coupling to the group pass module. */
export type VisibleRowEntry = FlatOrderEntry;

/** Materialise the in-order visible row list.
 *
 *  `hideOpenParents` (Cycle 15.5 / Task 4): when `true`, an EXPANDED
 *  group's own group-row entry is skipped — children appear directly in
 *  the parent's slot. A COLLAPSED group still emits its group entry and
 *  suppresses children (existing behaviour).
 *
 *  `suppressLeafRows` (Cycle 18 / Task 3 follow-up): when `true`, every
 *  `kind: 'row'` entry is dropped — only group + footer rows survive.
 *  AG-Grid parity: leaf data rows are NOT shown under pivot mode (the
 *  cross-tab matrix is the only thing the user sees). The cgrid layer
 *  enables this when `pivotMode === true` and pivot is active. */
export function computeGroupVisibleOrder(
  flatOrder: readonly FlatOrderEntry[],
  expandedKeys: ReadonlySet<string>,
  hideOpenParents = false,
  suppressLeafRows = false,
): VisibleRowEntry[] {
  const out: VisibleRowEntry[] = [];
  let skipDepth = -1;
  for (let i = 0; i < flatOrder.length; i++) {
    const entry = flatOrder[i]!;
    if (skipDepth >= 0 && entry.depth > skipDepth) continue;
    skipDepth = -1;
    const isExpandedGroup = entry.kind === 'group' && expandedKeys.has(entry.key);
    const isLeafRow = entry.kind === 'row';
    // hideOpenParents: skip the group-row entry when the group is expanded,
    // but do NOT set skipDepth — children still emit.
    // suppressLeafRows: skip every data row entry — pivot mode only
    // surfaces group + footer rows.
    if ((!hideOpenParents || !isExpandedGroup) && !(suppressLeafRows && isLeafRow)) {
      out.push(entry);
    }
    if (entry.kind === 'group' && !isExpandedGroup) {
      // Collapsed group — skip all its descendants.
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
  hideOpenParents = false,
  suppressLeafRows = false,
): number {
  let count = 0;
  let skipDepth = -1;
  for (let i = 0; i < flatOrder.length; i++) {
    const entry = flatOrder[i]!;
    if (skipDepth >= 0 && entry.depth > skipDepth) continue;
    skipDepth = -1;
    const isExpandedGroup = entry.kind === 'group' && expandedKeys.has(entry.key);
    const isLeafRow = entry.kind === 'row';
    if ((!hideOpenParents || !isExpandedGroup) && !(suppressLeafRows && isLeafRow)) count++;
    if (entry.kind === 'group' && !isExpandedGroup) skipDepth = entry.depth;
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
  /** Cycle 15 / Task 3 — accessor for the group-row metadata the chunk
   *  needs (formatted value, descendant count, expansion state). The
   *  slicer doesn't own the `GroupNode` tree; the caller passes a thin
   *  resolver keyed by `groupKey`. When omitted, group rows ship with
   *  empty value, zero count, and `isExpanded = 1` (defensive default —
   *  the renderer still keys off `rowKinds[i] === 1` for the indent +
   *  chevron paint, so missing metadata won't crash; just produces a
   *  visually incomplete group row). */
  groupMeta?: (key: string) => { value: string; childCount: number; isExpanded: boolean } | undefined,
  /** Cycle 15 / Task 10 — when `true`, every data row's `groupValue[i]`
   *  slot is populated with its leaf-parent group's formatted value
   *  (resolved through `groupMeta`). The auto-group `'group'` cell
   *  renderer paints that label muted, no chevron / count / checkbox,
   *  indented to the leaf group's depth so the user keeps the parent
   *  group's name in view while scrolling inside an expanded group.
   *  Off (the default) leaves data-row slots blank — the pre-Task-10
   *  behaviour.
   *
   *  Resolution: we walk `visibleOrder` from index 0 up to the chunk's
   *  end and track the most recent `kind: 'group'` entry seen. Because
   *  `flatOrder` emits every group BEFORE its descendant data rows,
   *  the most-recent group is always the data row's leaf parent in
   *  the visible tree (an elided ancestor falls through naturally —
   *  the most-recent group becomes the closest non-elided ancestor,
   *  which is the right label to show). */
  showOpenedGroup?: boolean,
  /** Cycle 21d / Task 11 — CalcPass Stage A/B value seam. When supplied,
   *  fieldless calc columns fill their chunk slots (numericCols /
   *  textCols) for `entry.kind === 'row'` slots the same way a data
   *  column does; group/footer slots keep their zero/`''` defaults. */
  calcSource?: CalcValueSource,
  /** Damage-region rendering (Task 3) — rowIds touched by a transaction
   *  since the previous slice. When supplied AND non-empty, the slicer
   *  packs `touchedRows: Uint32Array` — window-relative indices of rows
   *  whose id is in the set. Caller drains the matched ids after slicing
   *  (mirrors the `pendingFlashes` drain-after-slice contract). */
  pendingTouched?: Set<string>,
): ViewportChunk {
  const rowStart = Math.max(0, req.rowStart);
  const rowEnd = Math.min(visibleOrder.length, req.rowEnd);
  const count = Math.max(0, rowEnd - rowStart);

  const rowIds = new Uint32Array(count);
  const rowKinds = new Uint8Array(count);
  const groupDepth = new Uint8Array(count);
  const heights = new Float32Array(count);
  // Cycle 15 / Task 3 — group-row parallel arrays. Group entries
  // populate via the `groupMeta` resolver; data entries stay at
  // defaults (`''` / 0 / 1 = always-visible).
  const groupValue: string[] = new Array<string>(count).fill('');
  const groupChildCount = new Uint32Array(count);
  const isExpanded = new Uint8Array(count);
  isExpanded.fill(1);
  // Cycle 21e / Task 11 — string rowId per chunk slot, parallel to
  // `rowIds` (which carries the numeric id). Group / footer entries
  // leave the empty-string sentinel; only data rows populate it below.
  const stringRowIds: string[] = new Array<string>(count).fill('');
  // Cycle 15 / Task 7 — composite group key per group row. The chevron
  // click hit-test on main reads this back to drive `setExpanded` +
  // `rowGroupOpened`; data rows hold the empty-string sentinel.
  const groupKey: string[] = new Array<string>(count).fill('');

  // Cycle 15 / Task 10 — pre-walk visibleOrder up to `rowStart` so we
  // know the most-recent group entry's key when the first data row in
  // the chunk lands. Without the pre-walk a chunk slicing mid-list
  // would emit empty opened-group labels for its leading data rows
  // (the parent group entry sits BEFORE rowStart and we'd never see
  // it). The walk is O(rowStart) — small relative to a typical chunk
  // (rowStart is the visible-row index where the chunk begins). Skip
  // entirely when `showOpenedGroup` is off — zero overhead for the
  // common ungrouped / no-opened-label path.
  let lastSeenGroupKey = '';
  if (showOpenedGroup) {
    for (let i = 0; i < rowStart; i++) {
      const entry = visibleOrder[i]!;
      if (entry.kind === 'group') lastSeenGroupKey = entry.key;
    }
  }

  for (let i = 0; i < count; i++) {
    const entry = visibleOrder[rowStart + i]!;
    groupDepth[i] = entry.depth;
    if (entry.kind === 'group') {
      rowKinds[i] = 1;
      groupKey[i] = entry.key;
      const meta = groupMeta?.(entry.key);
      if (meta) {
        groupValue[i] = meta.value;
        groupChildCount[i] = meta.childCount;
        isExpanded[i] = meta.isExpanded ? 1 : 0;
      }
      if (showOpenedGroup) lastSeenGroupKey = entry.key;
      continue;
    }
    if (entry.kind === 'footer') {
      // Cycle 15 / Task 12 — per-group footer row marker. `rowKinds[i] = 3`
      // routes the row to the per-group totals lookup in `cgrid.cellAt`
      // (which reads `chunk.groupTotals[groupKey[i]]`). The auto-group
      // cell carries the parent group's formatted value so the cell
      // renderer can paint `Total ${value}` at the parent depth's
      // indent. Footer's `entry.depth` is one deeper than the parent
      // group's; `groupDepth[i] = entry.depth - 1` makes the renderer
      // paint the label at the parent group's indent column. The
      // grand-total footer (key = '') resolves through `chunk.totals`
      // instead; its `groupValue[i]` stays empty so the renderer
      // paints just `Total`.
      rowKinds[i] = 3;
      groupKey[i] = entry.key;
      const renderDepth = Math.max(0, entry.depth - 1);
      groupDepth[i] = renderDepth;
      if (entry.key !== '') {
        const meta = groupMeta?.(entry.key);
        if (meta) groupValue[i] = meta.value;
      }
      continue;
    }
    const rowId = postFilterIds[entry.rowIndex];
    if (rowId === undefined) continue;
    rowIds[i] = store.getNumericId(rowId);
    stringRowIds[i] = rowId;
    heights[i] = store.effectiveShippedHeight(rowId);
    // Cycle 15 / Task 10 — `showOpenedGroup` populates the data row's
    // `groupValue[i]` slot with its leaf-parent's formatted value. The
    // renderer reads the same slot for group rows; data rows leave it
    // blank by default. `rowKinds[i]` stays 0 — the renderer's
    // "rowKind 0 + non-empty value" branch distinguishes the opened-
    // group label paint from the group-row paint. An empty
    // `lastSeenGroupKey` (e.g. data rows before the first group is
    // seen) silently no-ops.
    if (showOpenedGroup && lastSeenGroupKey !== '') {
      const meta = groupMeta?.(lastSeenGroupKey);
      if (meta) groupValue[i] = meta.value;
    }
  }

  const numericCols: Record<string, Float64Array> = {};
  const textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }> = {};

  for (const colId of req.columns) {
    const col = colIndex.get(colId);
    if (!col) continue;
    // Cycle 21d / Task 11 — fieldless calc columns fill their chunk
    // slots from the CalcPass cache; row slots only (group/footer keep
    // their zero/'' defaults, same as data columns above).
    if (!col.field) {
      const src = calcSource;
      if (!src || !src.isCalcCol(colId)) continue;
      if (col.type === 'number') {
        const arr = new Float64Array(count);
        for (let i = 0; i < count; i++) {
          const entry = visibleOrder[rowStart + i]!;
          if (entry.kind !== 'row') continue;
          const rowId = postFilterIds[entry.rowIndex];
          if (rowId === undefined) continue;
          arr[i] = Number(src.valueAt(rowId, colId));
        }
        numericCols[colId] = arr;
      } else {
        const values: string[] = new Array(count);
        for (let i = 0; i < count; i++) {
          const entry = visibleOrder[rowStart + i]!;
          if (entry.kind !== 'row') { values[i] = ''; continue; }
          const rowId = postFilterIds[entry.rowIndex];
          if (rowId === undefined) { values[i] = ''; continue; }
          const v = src.valueAt(rowId, colId);
          values[i] = v == null ? '' : String(v);
        }
        textCols[colId] = encodeText(values);
      }
      continue;
    }
    const field = col.field;
    if (col.type === 'number') {
      const arr = new Float64Array(count);
      for (let i = 0; i < count; i++) {
        const entry = visibleOrder[rowStart + i]!;
        // Cycle 15 / Task 12 — footer entries carry no per-row data; the
        // per-group totals lookup runs main-side via `chunk.groupTotals`.
        if (entry.kind !== 'row') continue;
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
        // Cycle 15 / Task 12 — group + footer entries leave the text
        // slot blank; the renderer reads `chunk.groupTotals` (footer)
        // or paints group-spine chrome (group) without touching the
        // per-column text.
        if (entry.kind !== 'row') {
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

  // Damage-region rendering (Task 3, corrected Task 6) — touchedRows
  // packing. Group rows contribute no pending touches (same rationale as
  // the flashMask block above — a group's rowKey is never in
  // pendingTouched). Same window walk idiom: `visibleOrder[rowStart + r]` /
  // `postFilterIds[entry.rowIndex]`. `touchedRows` is assigned whenever
  // `pendingTouched` is defined — including an EMPTY `Uint32Array` when
  // none of the touched rowIds land in this window — so the caller can
  // tell "checked, nothing here changed" (repaints nothing) apart from
  // true "unknown" (`undefined` — window moved, first fetch, older
  // worker), which must still degrade to full. See dataPipeline.ts's
  // `ViewportSlicer.slice` for the matching fix + full rationale.
  let touchedRows: Uint32Array | undefined;
  if (pendingTouched !== undefined && pendingTouched.size > 0 && count > 0) {
    const hit: number[] = [];
    for (let r = 0; r < count; r++) {
      const entry = visibleOrder[rowStart + r]!;
      if (entry.kind !== 'row') continue;
      const rowId = postFilterIds[entry.rowIndex];
      if (rowId !== undefined && pendingTouched.has(rowId)) hit.push(r);
    }
    touchedRows = Uint32Array.from(hit);
  }

  return {
    rowStart,
    rowCount: count,
    rowIds,
    stringRowIds,
    rowKinds,
    groupDepth,
    heights,
    numericCols,
    textCols,
    flashMask,
    touchedRows,
    groupValue,
    groupChildCount,
    isExpanded,
    groupKey,
  };
}
