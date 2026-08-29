// Cycle 19 / Task 6 — viewport service handler.
//
// Owns the viewport + row lookup + autosize + text-measure slice of
// the worker protocol:
//   getViewport, getRowIndexForId, getRowByIndex, getRowIndicesForIds,
//   autosize, measureTextResponse.

import type { HandlerCtx } from '../dispatch';
import type { WorkerRequest, WorkerColumn, StickyAncestor, AutosizeColumnRequest } from '../protocol';
import { collectViewportTransferables } from '../protocol';
import { sliceGroupedViewport, type VisibleRowEntry } from '../viewportSlicer';
import { buildVisibleIndexResolver } from '../visibleIndexResolver';
import { cachedGroupMetaLookup, cachedGroupVisibleOrder } from '../groupViewCache';
import { offscreenMeasurer } from '../measureText';
import {
  measureColumnWidths,
  type AutosizeColumnSpec,
  type AutosizeGroupNode,
} from '../autosize';
import type { GroupNode } from '../passes/groupPass';
import { materializeSsrmGroupTotals, computeSsrmStickyAncestors } from '../../core/ssrmRowMeta';
import { readWorkerCellValue } from '../readCellValue';

export type ViewportRequest = Extract<WorkerRequest, {
  type:
    | 'getViewport'
    | 'getRowIndexForId'
    | 'getRowByIndex'
    | 'getRowIndicesForIds'
    | 'autosize'
    | 'autosizeSample'
    | 'measureTextResponse';
}>;

export async function handleViewport(
  ctx: HandlerCtx,
  req: ViewportRequest,
): Promise<void> {
  const { state, post, helpers } = ctx;
  switch (req.type) {
    case 'getRowIndexForId': {
      // Production hardening (Task 2 / A-C1) — resolve through the
      // shared grouping-aware resolver so this matches the GROUP-VISIBLE
      // index the main thread scrolls/focuses against, not the flat
      // leaf array.
      const resolver = await buildVisibleIndexResolver(ctx);
      const idx = resolver.indexOfLeafId(req.payload.rowId);
      post({ id: req.id, type: 'rowIndex', index: idx });
      return;
    }

    case 'getRowByIndex': {
      const resolver = await buildVisibleIndexResolver(ctx);
      const { rowIndex } = req.payload;
      const rowId = resolver.leafIdAt(rowIndex);
      // Out-of-range AND group-header slots share the same not-found
      // shape — there is no row data to load either way.
      if (rowId === null) {
        post({ id: req.id, type: 'row', rowId: null, data: null });
        return;
      }
      const data = state.store.getById(rowId);
      post({ id: req.id, type: 'row', rowId, data: data ?? null });
      return;
    }

    case 'getRowIndicesForIds': {
      // Single source of truth with getRowIndexForId / getRowByIndex —
      // the resolver builds its id→index lookup once (O(visible)), so
      // an N-id batch stays O(visible + N).
      const resolver = await buildVisibleIndexResolver(ctx);
      const requested = req.payload.rowIds;
      const out = new Int32Array(requested.length);
      for (let i = 0; i < requested.length; i++) {
        out[i] = resolver.indexOfLeafId(requested[i]!);
      }
      post({ id: req.id, type: 'rowIndices', indices: out }, [out.buffer]);
      return;
    }

    case 'getViewport': {
      const visIds = await helpers.visibleAsync();
      // Cycle 4 / Task 11 — pass pendingFlashes to the slicer.
      const pending = state.enableCellChangeFlash ? state.pendingFlashes : undefined;
      const pendingDirs = state.enableCellChangeFlash ? state.pendingFlashDirs : undefined;
      // Damage-region rendering (Task 3) — pass pendingTouched to the
      // slicer. Unlike `pending`, this is NOT gated by
      // `enableCellChangeFlash` (damage tracking is independent of the
      // cell-flash feature).
      const touchedPending = state.pendingTouched.size > 0 ? state.pendingTouched : undefined;
      // Cycle 15 / Task 4 — walk the collapse-aware visible order when
      // grouping is active.
      let chunk;
      let visibleSliceIds: string[];
      let stickyAncestors: StickyAncestor[] | undefined;
      if (helpers.isGroupingActive()) {
        const groupOutput = state.groupOutput!;
        const expandedKeys = helpers.effectiveExpandedKeys();
        // Cycle 18 / Task 3 follow-up — under pivot mode, drop leaf
        // data rows entirely (AG-Grid parity).
        //
        // A-P2 (production hardening) — both walks are memoized per
        // pipeline generation (`state.groupViewCache`). Identical inputs
        // ⇒ identical output, so this is byte-for-byte what the direct
        // `computeGroupVisibleOrder` / `buildGroupMetaLookup` calls
        // produced; the memo only skips re-doing the O(N) work on a
        // scroll fetch that changed nothing.
        const visibleOrder: readonly VisibleRowEntry[] = cachedGroupVisibleOrder(
          state.groupViewCache, groupOutput, state.expandedKeys, expandedKeys,
          state.groupHideOpenParents, helpers.isPivotActive(),
        );
        const colIndex = new Map<string, WorkerColumn>();
        for (const c of state.columns) colIndex.set(c.colId, c);
        const metaLookup = cachedGroupMetaLookup(
          state.groupViewCache, groupOutput, state.columns, state.expandedKeys,
          expandedKeys, helpers.buildGroupMetaLookup,
        );
        chunk = sliceGroupedViewport(
          state.store, colIndex, visIds, visibleOrder, req.payload, pending,
          (key) => metaLookup.get(key),
          state.showOpenedGroup,
          state.calc.hasProgram() ? state.calc : undefined,
          touchedPending,
        );
        // Cycle 15 / Task 16 — sticky ancestors from the ordered group
        // tree above firstRow. Task 5 (paint-cache layer) fix — use the
        // caller's TRUE on-screen first-visible row (`stickyBoundaryRow`)
        // when supplied, not `chunk.rowStart` (the fetch window, widened
        // by row overscan for the retained layer's coverage per spec §1
        // — see `ViewportState.firstVisibleDataRow`'s doc, core/
        // viewport.ts). Using the overscan-padded `rowStart` here made a
        // group's header stay "in view" (fetched) long after it had
        // genuinely scrolled off screen, so the sticky band silently
        // failed to appear for any scroll shallower than the overscan
        // buffer. Falls back to `chunk.rowStart` for an older/stale
        // client build that hasn't sent the field.
        stickyAncestors = helpers.computeStickyAncestors(
          visibleOrder,
          req.payload.stickyBoundaryRow ?? chunk.rowStart,
          metaLookup,
        );
        // Build a per-slot rowId array so the flash drain works
        // identically to the flat path.
        visibleSliceIds = new Array<string>(chunk.rowCount);
        for (let r = 0; r < chunk.rowCount; r++) {
          const entry = visibleOrder[chunk.rowStart + r];
          if (!entry || entry.kind !== 'row') { visibleSliceIds[r] = ''; continue; }
          visibleSliceIds[r] = visIds[entry.rowIndex] ?? '';
        }
      } else {
        chunk = state.slicer.slice(visIds, req.payload, pending, touchedPending, pendingDirs);
        visibleSliceIds = visIds.slice(chunk.rowStart, chunk.rowStart + chunk.rowCount);
        // Sparse SSRM — host supplies grouped rows + field aggregates; ship
        // `groupTotals` in CSRM shape (AggPass parity) so paint needs no fork.
        if (state.ssrmActive && !state.ssrmClientPipeline && chunk.groupKey) {
          const stickyBoundary = req.payload.stickyBoundaryRow ?? chunk.rowStart;
          const ssrmGroupTotals = materializeSsrmGroupTotals(
            (id) => state.store.getById(id),
            state.columns,
            visibleSliceIds,
            chunk.rowKinds,
            chunk.groupKey,
            visIds,
            stickyBoundary,
          );
          if (Object.keys(ssrmGroupTotals).length > 0) {
            chunk.groupTotals = ssrmGroupTotals;
          }
        }
        // Sparse SSRM never ships the worker group model (GroupPass stays
        // off — the host owns grouping), so `state.group` can't gate this
        // path; `ssrmGroupMetaSeen` (set when a hydrate carries `__ssrm`
        // group rows) is the signal. `rowGroupCols` still rides along when
        // a model IS present; the helper falls back to composite-key
        // segments for per-depth colIds otherwise.
        if (
          state.ssrmActive
          && !state.ssrmClientPipeline
          && state.ssrmGroupMetaSeen
        ) {
          stickyAncestors = computeSsrmStickyAncestors(
            (id) => state.store.getById(id),
            visIds,
            req.payload.stickyBoundaryRow ?? chunk.rowStart,
            state.group.getModel().rowGroupCols,
          );
        }
      }
      if (pending !== undefined && chunk.flashMask !== undefined) {
        // Drain: clear the (rowId, field) entries this chunk flashed.
        const s = state;
        const colFields = req.payload.columns
          .map((colId: string) => s.columns.find((c) => c.colId === colId)?.field)
          .filter((f: unknown): f is string => f !== undefined);
        for (let r = 0; r < chunk.rowCount; r++) {
          const rowId = visibleSliceIds[r];
          if (!rowId) continue;
          const set = pending.get(rowId);
          if (set) {
            for (const f of colFields) set.delete(f);
            if (set.size === 0) pending.delete(rowId);
          }
          // Directions drain on the same beat as the flashes they describe.
          const dirMap = pendingDirs;
          const dirs = dirMap?.get(rowId);
          if (dirMap && dirs) {
            for (const f of colFields) dirs.delete(f);
            if (dirs.size === 0) dirMap.delete(rowId);
          }
        }
      }
      // Damage-region rendering (Task 3) — drain: each rowId this chunk
      // reported as touched fires exactly once. Whole-entry delete (no
      // per-field granularity — `pendingTouched` is a flat rowId set,
      // unlike `pendingFlashes`'s per-field map), same drain-after-slice
      // lifecycle as the flashMask block above.
      //
      // M1 (closeout review) — REVISED from "drain the whole set after
      // every slice" after the fix-wave's OWN OpenFin re-measure caught a
      // regression: `resolveWindowDamage` (adjudication B, velocityGrid.ts) bails
      // to FULL whenever `chunk.touchedRows === undefined` ("unknown stays
      // full"), and `touchedRows` is undefined exactly when
      // `pendingTouched.size === 0` at request time. Draining the WHOLE
      // set on every slice meant the FIRST scroll-driven fetch after any
      // tick emptied it immediately, so every SUBSEQUENT scroll fetch
      // before the next tick saw `touchedRows === undefined` and fell back
      // to full — measured 199/209 full paints under continuous scroll
      // (worse than the 128/201 pre-fix baseline). Draining only the
      // in-window subset keeps off-window entries around, which keeps
      // `touchedRows` a defined (if empty) "checked, nothing here" signal
      // across a whole scroll sequence between ticks — exactly what
      // `resolveWindowDamage`'s identity-diff needs to activate instead of
      // bailing. The unbounded-growth concern M1 originally raised is
      // handled by the size cap below instead: a size this large is
      // already pathological (a live feed spread across a huge fraction
      // of the whole row set with a viewport that never revisits most of
      // it), so paying for ONE full repaint to reset the set is cheap
      // insurance against genuine unbounded growth.
      if (touchedPending !== undefined && chunk.touchedRows !== undefined) {
        for (const r of chunk.touchedRows) {
          const rowId = visibleSliceIds[r];
          if (rowId) touchedPending.delete(rowId);
        }
      }
      if (touchedPending !== undefined && touchedPending.size > Math.max(1000, visIds.length / 2)) {
        touchedPending.clear();
      }
      // Wire AggPass: compute grand-total aggregations over all visible rows.
      const aggResult = state.agg.apply(visIds);
      if (Object.keys(aggResult.totals).length > 0) {
        chunk.totals = aggResult.totals;
      }
      // Sparse SSRM v2 — AggPass only saw hydrated rows; the host-computed
      // grand totals (skeleton root aggregates, field-keyed) are the truth.
      if (state.ssrmActive && !state.ssrmClientPipeline && state.ssrmGrandTotals !== null) {
        const mapped: Record<string, unknown> = {};
        for (const c of state.columns) {
          if (c.aggFunc != null && c.field && state.ssrmGrandTotals[c.field] !== undefined) {
            mapped[c.colId] = state.ssrmGrandTotals[c.field];
          }
        }
        if (Object.keys(mapped).length > 0) chunk.totals = mapped;
      }
      // Cycle 15 / Task 12 — per-group totals.
      //
      // Collapsed-group aggregate fix — this used to ALSO gate on
      // `state.group.getIncludeFooter()`, but group ROWS (rowKind 1)
      // display per-group aggregates whenever aggregated columns exist,
      // footers or not (AG parity: the group header carries the sums).
      // With the gate in place, a grouped grid without
      // `groupIncludeFooter` never shipped `chunk.groupTotals`, so the
      // main thread's `totalsCellLookup` had nothing per-group to read
      // AND `diffAggregates` never saw a changed group key — collapsed
      // group rows painted once and went permanently stale.
      // `includeFooter` only controls footer ROW synthesis (GroupPass /
      // sortPass flatten); the totals DATA ships whenever grouping is
      // active. AggPass emits no entries when no column carries an
      // aggFunc, and the length guard below keeps the field absent in
      // that case — so ungrouped/unaggregated grids are unaffected.
      if (
        helpers.isGroupingActive()
        && state.groupInputIds !== null
        && state.groupOutput !== null
      ) {
        const groupAggResult = state.agg.applyGroups(
          state.groupInputIds,
          state.groupOutput,
        );
        if (Object.keys(groupAggResult.groupTotals).length > 0) {
          chunk.groupTotals = groupAggResult.groupTotals;
        }
      }
      // Cycle 18 / Task 3 + Task 8d — pivot cross-tab.
      const pivotOut = state.pivotOut;
      if (pivotOut !== null) {
        if (!pivotOut.bypassed) {
          chunk.pivotColumnTree = pivotOut.keyTree;
          chunk.pivotLeafPaths = pivotOut.leafPaths;
          chunk.pivotValues = pivotOut.values;
        }
        if (pivotOut.maxColumnsReached !== undefined) {
          // Cycle 18 / Task 8a — surface the breach.
          chunk.pivotMaxColumnsReached = { ...pivotOut.maxColumnsReached };
        }
      }
      post(
        { id: req.id, type: 'viewport', chunk, stickyAncestors },
        collectViewportTransferables(chunk) as ArrayBuffer[],
      );
      // AutoHeight pass — runs out-of-band so the first chunk lands
      // fast. Cycle 5 / Task 8.
      const rowStart = chunk.rowStart;
      const rowEnd = chunk.rowStart + chunk.rowCount;
      void helpers.runAutoHeightPass(visIds, rowStart, rowEnd);
      return;
    }

    case 'autosize': {
      // Cycle 6 / Task 4 — measure widest visible text per column.
      // Production hardening (Task 2 / A-C1) — sample through the
      // grouping-aware resolver: under grouping, `rowIndex` is a
      // GROUP-VISIBLE index (group headers occupy a slot; collapsed
      // leaves are excluded), matching what the renderer actually paints.
      const { columns, skipHeader, maxSampleSize } = req.payload;
      const resolver = await buildVisibleIndexResolver(ctx);
      const fieldByColId = new Map<string, string | undefined>();
      for (const c of state.columns) fieldByColId.set(c.colId, c.field);
      const measureFor = (font: string) => {
        const off = offscreenMeasurer(font);
        if (off) return off;
        // Fallback when OffscreenCanvas.measureText is unavailable.
        return (s: string) => s.length * 7;
      };
      // Auto-group column path: materialise the group-node list once
      // (reused across every column that carries a `groupContext`). The
      // main thread only ships the chrome geometry; the worker owns the
      // tree + the formatted per-node values (same source
      // `chunk.groupValue[i]` reads from via `buildGroupMetaLookup`), so
      // both sides format identically without a per-node round-trip.
      let groupNodes: readonly AutosizeGroupNode[] | null = null;
      const wantsGroupContext = columns.some((c) => c.groupContext !== undefined);
      if (wantsGroupContext && helpers.isGroupingActive() && state.groupOutput) {
        // A-P2 — same memo the getViewport path uses (identical key ⇒
        // identical lookup); autosize now shares the entry instead of
        // re-walking the whole group tree.
        const meta = cachedGroupMetaLookup(
          state.groupViewCache,
          state.groupOutput,
          state.columns,
          state.expandedKeys,
          helpers.effectiveExpandedKeys(),
          helpers.buildGroupMetaLookup,
        );
        groupNodes = flattenGroupNodes(state.groupOutput.roots, meta);
      }
      const specs: AutosizeColumnSpec[] = columns.map((c: AutosizeColumnRequest) => {
        const field = fieldByColId.get(c.colId);
        const spec: AutosizeColumnSpec = {
          colId: c.colId,
          headerName: c.headerName,
          font: c.font,
          padding: c.padding,
          headerPadding: c.headerPadding,
          minWidth: c.minWidth,
          maxWidth: c.maxWidth,
          textOf: (rowIndex: number) => {
            if (!field) return '';
            const rowId = resolver.leafIdAt(rowIndex);
            if (rowId === null) return ''; // group-header slot — no field value.
            const row = state.store.getById(rowId) as Record<string, unknown> | undefined;
            if (!row) return '';
            const raw = row[field];
            return raw == null ? '' : String(raw);
          },
        };
        // When the main thread flagged this column as an auto-group
        // column (via `groupContext`), attach the shared node list +
        // per-column chrome params. `groupNodes === null` (grouping not
        // active, or `state.groupOutput` missing) surfaces as an empty
        // list — the pass then falls back to header/minWidth width,
        // which matches "there are no group nodes to fit".
        if (c.groupContext) {
          spec.groupContext = {
            chromeBase: c.groupContext.chromeBase,
            indentUnit: c.groupContext.indentUnit,
            suppressCount: c.groupContext.suppressCount,
            countGap: c.groupContext.countGap,
            groupColumnDepth: c.groupContext.groupColumnDepth,
            nodes: groupNodes ?? [],
          };
        }
        return spec;
      });
      const widthsMap = measureColumnWidths({
        cols: specs,
        rowCount: resolver.length,
        skipHeader,
        measureFor,
        cache: state.measureCache,
        maxSampleSize,
      });
      const widths: Record<string, number> = {};
      for (const [colId, w] of widthsMap.entries()) widths[colId] = w;
      post({ id: req.id, type: 'autosizeResult', widths });
      return;
    }

    case 'autosizeSample': {
      // Autosize formatted-measurement support — ship the RAW cell
      // values of the sample window back to main. Main owns the
      // `valueFormatter` functions (they can't cross the worker
      // boundary) and the document's loaded fonts, so it formats +
      // measures there. Window shape mirrors `measureColumnWidths`:
      // head half + tail half of the visible set, capped at
      // `maxSampleSize` (default 5,000).
      const { colIds, maxSampleSize } = req.payload;
      const ids = await helpers.visibleAsync();
      const cap = maxSampleSize ?? 5_000;
      const half = Math.max(0, Math.floor(cap / 2));
      const sampleHead = Math.min(ids.length, half);
      const sampleTailStart = Math.max(sampleHead, ids.length - half);
      const colById = new Map(state.columns.map((c) => [c.colId, c]));
      const values: Record<string, unknown[]> = {};
      const wanted: Array<{ col: WorkerColumn; out: unknown[] }> = [];
      for (const colId of colIds) {
        const out: unknown[] = [];
        values[colId] = out;
        const col = colById.get(colId);
        if (col && (col.field || col.valueGetter)) wanted.push({ col, out });
      }
      if (wanted.length > 0) {
        const collect = (rowIndex: number): void => {
          const rowId = ids[rowIndex];
          if (rowId === undefined) return;
          const row = state.store.getById(rowId) as Record<string, unknown> | undefined;
          if (!row) return;
          for (const w of wanted) {
            const raw = readWorkerCellValue(row, w.col);
            if (raw != null) w.out.push(raw);
          }
        };
        for (let i = 0; i < sampleHead; i++) collect(i);
        for (let i = sampleTailStart; i < ids.length; i++) collect(i);
      }
      post({ id: req.id, type: 'autosizeSampleResult', values, rowCount: ids.length });
      return;
    }

    case 'measureTextResponse': {
      // Fallback path: main has measured the previously-batched items.
      const { batchId, heights } = req.payload;
      const resolver = state.pendingFallbacks.get(batchId);
      if (resolver) {
        state.pendingFallbacks.delete(batchId);
        resolver(heights);
      }
      post({ id: req.id, type: 'measureTextAck' });
      return;
    }
  }
}

/** Depth-first flatten the group tree into `AutosizeGroupNode[]`.
 *  Uses the metaLookup's formatted values so the measurement input
 *  matches what `chunk.groupValue[i]` carries into the `'group'`
 *  renderer — one source of truth for both paths. */
function flattenGroupNodes(
  roots: readonly GroupNode[],
  meta: ReadonlyMap<string, { value: string; childCount: number; isExpanded: boolean; colId: string }>,
): AutosizeGroupNode[] {
  const out: AutosizeGroupNode[] = [];
  const walk = (nodes: readonly GroupNode[]): void => {
    for (const node of nodes) {
      const m = meta.get(node.key);
      out.push({
        valueFormatted: m?.value ?? '',
        depth: node.depth,
        childCount: node.childCount,
      });
      if (node.childGroups.length > 0) walk(node.childGroups);
    }
  };
  walk(roots);
  return out;
}
