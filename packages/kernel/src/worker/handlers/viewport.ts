// Cycle 19 / Task 6 — viewport service handler.
//
// Owns the viewport + row lookup + autosize + text-measure slice of
// the worker protocol:
//   getViewport, getRowIndexForId, getRowByIndex, getRowIndicesForIds,
//   autosize, measureTextResponse.

import type { HandlerCtx } from '../dispatch';
import type { WorkerRequest, WorkerColumn, StickyAncestor, AutosizeColumnRequest } from '../protocol';
import { collectViewportTransferables } from '../protocol';
import { computeGroupVisibleOrder, sliceGroupedViewport, type VisibleRowEntry } from '../viewportSlicer';
import { offscreenMeasurer } from '../measureText';
import {
  measureColumnWidths,
  type AutosizeColumnSpec,
  type AutosizeGroupNode,
} from '../autosize';
import type { GroupNode } from '../passes/groupPass';

export type ViewportRequest = Extract<WorkerRequest, {
  type:
    | 'getViewport'
    | 'getRowIndexForId'
    | 'getRowByIndex'
    | 'getRowIndicesForIds'
    | 'autosize'
    | 'measureTextResponse';
}>;

export async function handleViewport(
  ctx: HandlerCtx,
  req: ViewportRequest,
): Promise<void> {
  const { state, post, helpers } = ctx;
  switch (req.type) {
    case 'getRowIndexForId': {
      const ids = await helpers.visibleAsync();
      const idx = ids.indexOf(req.payload.rowId);
      post({ id: req.id, type: 'rowIndex', index: idx });
      return;
    }

    case 'getRowByIndex': {
      const ids = await helpers.visibleAsync();
      const { rowIndex } = req.payload;
      if (rowIndex < 0 || rowIndex >= ids.length) {
        post({ id: req.id, type: 'row', rowId: null, data: null });
        return;
      }
      const rowId = ids[rowIndex]!;
      const data = state.store.getById(rowId);
      post({ id: req.id, type: 'row', rowId, data: data ?? null });
      return;
    }

    case 'getRowIndicesForIds': {
      // Build a one-shot lookup table so an N-id batch is
      // O(visible + N) instead of O(visible * N).
      const lookup = new Map<string, number>();
      if (helpers.isGroupingActive() && state.groupOutput && state.groupInputIds) {
        const groupInputIds = state.groupInputIds;
        const visibleOrder = computeGroupVisibleOrder(
          state.groupOutput.flatOrder,
          helpers.effectiveExpandedKeys(),
          state.groupHideOpenParents,
        );
        for (let i = 0; i < visibleOrder.length; i++) {
          const entry = visibleOrder[i]!;
          if (entry.kind === 'row') {
            const id = groupInputIds[entry.rowIndex];
            if (id !== undefined) lookup.set(id, i);
          }
        }
      } else {
        const ids = await helpers.visibleAsync();
        for (let i = 0; i < ids.length; i++) lookup.set(ids[i]!, i);
      }
      const requested = req.payload.rowIds;
      const out = new Int32Array(requested.length);
      for (let i = 0; i < requested.length; i++) {
        const idx = lookup.get(requested[i]!);
        out[i] = idx === undefined ? -1 : idx;
      }
      post({ id: req.id, type: 'rowIndices', indices: out }, [out.buffer]);
      return;
    }

    case 'getViewport': {
      const visIds = await helpers.visibleAsync();
      // Cycle 4 / Task 11 — pass pendingFlashes to the slicer.
      const pending = state.enableCellChangeFlash ? state.pendingFlashes : undefined;
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
        const visibleOrder: VisibleRowEntry[] = computeGroupVisibleOrder(
          groupOutput.flatOrder, expandedKeys, state.groupHideOpenParents,
          helpers.isPivotActive(),
        );
        const colIndex = new Map<string, WorkerColumn>();
        for (const c of state.columns) colIndex.set(c.colId, c);
        const metaLookup = helpers.buildGroupMetaLookup(groupOutput.roots, state.columns, expandedKeys);
        chunk = sliceGroupedViewport(
          state.store, colIndex, visIds, visibleOrder, req.payload, pending,
          (key) => metaLookup.get(key),
          state.showOpenedGroup,
          state.calc.hasProgram() ? state.calc : undefined,
        );
        // Cycle 15 / Task 16 — sticky ancestors from the ordered group
        // tree above firstRow.
        stickyAncestors = helpers.computeStickyAncestors(visibleOrder, chunk.rowStart, metaLookup);
        // Build a per-slot rowId array so the flash drain works
        // identically to the flat path.
        visibleSliceIds = new Array<string>(chunk.rowCount);
        for (let r = 0; r < chunk.rowCount; r++) {
          const entry = visibleOrder[chunk.rowStart + r];
          if (!entry || entry.kind !== 'row') { visibleSliceIds[r] = ''; continue; }
          visibleSliceIds[r] = visIds[entry.rowIndex] ?? '';
        }
      } else {
        chunk = state.slicer.slice(visIds, req.payload, pending);
        visibleSliceIds = visIds.slice(chunk.rowStart, chunk.rowStart + chunk.rowCount);
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
          if (!set) continue;
          for (const f of colFields) set.delete(f);
          if (set.size === 0) pending.delete(rowId);
        }
      }
      // Wire AggPass: compute grand-total aggregations over all visible rows.
      const aggResult = state.agg.apply(visIds);
      if (Object.keys(aggResult.totals).length > 0) {
        chunk.totals = aggResult.totals;
      }
      // Cycle 15 / Task 12 — per-group totals.
      if (
        helpers.isGroupingActive()
        && state.group.getIncludeFooter()
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
      const { columns, skipHeader, maxSampleSize } = req.payload;
      const ids = await helpers.visibleAsync();
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
        const meta = helpers.buildGroupMetaLookup(
          state.groupOutput.roots,
          state.columns,
          helpers.effectiveExpandedKeys(),
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
            const rowId = ids[rowIndex];
            if (rowId === undefined) return '';
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
        rowCount: ids.length,
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
