/**
 * Data-plane facade — viewport requests and the worker chunk ingest path.
 *
 * Owns `recomputeViewport`/`requestViewport`, the `handleViewportChunk`
 * pipeline, the row-height index refresh and `rowHeightAt`, worker-pushed
 * auto-heights, scroll handling and the ensure-visible entry points. Extracted
 * from `velocityGrid.ts` as part of splitting the god object (SPEC.md §3
 * module boundaries — Data plane).
 *
 * A re-seaming, not a redesign. The chunk sequence is the load-bearing part
 * and is preserved verbatim: flash-mask ingest → row-height index update →
 * pivot column sync → `aggregationChanged` → the `firstDataRendered` latch,
 * behind the monotonic `viewportReqSeq` guard (plus the worker's generation
 * stamp) that drops superseded chunks. The `getRowHeight(0) === 0` pivot
 * mid-load guard in `rowHeightAt` is likewise unchanged — SPEC.md §2 lists it
 * as a workaround to preserve.
 *
 * The seam is the fat {@link DataPlaneHost} interface — the same `Deps`
 * pattern the ported coordinators already use.
 */

import type { VelocityGridOptions, VelocityGridEvent } from '../types';
import type { ViewportChunk, StickyAncestor } from '../worker/protocol';
import type { AggregationChangedSource } from '../types/event';
import type { TypedEventEmitter } from '../core/eventEmitter';
import type { ColumnTree } from '../core/columnTree';
import { RowHeightIndex } from '../core/rowHeightIndex';
import type { ViewportState } from '../core/viewport';
import type { ViewportManager } from '../core/viewportManager';
import { type ChunkLRU, estimateChunkBytes } from '../core/memoryBudget';
import type { FlashRegistry, FlashOverride } from '../core/flashRegistry';
import type { VelocityGridCanvas } from '../core/canvas';
import type { SelectionModel } from '../interaction/selectionModel';
import type { EditController } from '../core/editController';
import type { WorkerCoordinator } from '../core/workerCoordinator';
import type { PivotEngine } from '../core/pivotEngine';
import type { RowStripCache } from '../renderer/rasterCache';
import type { ResolvedTheme } from '../theming/cssReader';
import type { PaintDriver } from './paintDriver';
import { clampRowHeight } from '../types/options';
import { wrapTextToHeight } from '../worker/measureText';
import { ruleFlashOwnership, isRuleFlashOwned } from '../core/ruleFlashOwnership';
import { getRuleEngine } from '../core/ruleEngineSlot';
import {
  chunkIntersectsRowRange,
  chunkCoversOnScreenRows,
  resolveWindowDamage,
  diffAggregates,
} from './chunkHelpers';

/** Host seam for the viewport / chunk-ingest cluster. */
export interface DataPlaneHost<TRow = any> {
  readonly destroyed: boolean;
  options: VelocityGridOptions<TRow>;
  events: TypedEventEmitter<VelocityGridEvent<TRow>>;
  theme: ResolvedTheme;

  // ── surfaces + collaborators ─────────────────────────────────────────
  cgridCanvas: VelocityGridCanvas;
  paintDriver: PaintDriver<TRow>;
  viewportManager: ViewportManager;
  workerCoord: WorkerCoordinator;
  selection: SelectionModel;
  editController: EditController<TRow>;
  pivotEngine: PivotEngine<TRow>;
  columnTree: ColumnTree;
  flashRegistry: FlashRegistry;

  // ── the viewport/chunk state this cluster owns the transitions of ────
  viewport: ViewportState;
  chunk: ViewportChunk | null;
  chunkLRU: ChunkLRU<ViewportChunk> | null;
  rowCount: number;
  rowHeightIndex: RowHeightIndex | null;
  rasterStrips: RowStripCache | null;
  stickyAncestors: StickyAncestor[];
  decodedTextCols: Map<string, string[]>;
  rowVersionByRowId: Map<string, number>;
  groupFlashMap: Map<string, number>;
  flashOverrides: Map<string, FlashOverride & { expiresAt: number }>;
  firstDataFired: boolean;
  suppressFocusEnsure: boolean;
  layoutPaintEpoch: number;
  lastPaintedLayoutPaintEpoch: number;
  lastPaintedViewportScrollLeft: number;
  paintCacheDeferLayer: boolean;
  paintCacheLayerAnchored: boolean;

  // ── host services called back into ───────────────────────────────────
  startFlashTickLoop(): void;
  repaintGroupFlash(): void;
  repaintAggregateDamage(changedGroupKeys: Set<string>, grandTotalChanged: boolean): void;
  updateA11y(): void;
}

export class DataPlaneFacade<TRow = any> {
  constructor(private readonly host: DataPlaneHost<TRow>) {}

  /** Cycle 5 / Task 8 — apply heights pushed from the worker's autoHeight
   *  pass. Updates the Fenwick index for the affected range and requests a
   *  repaint. Skips when the index has been wiped between request and
   *  response (sort/filter/transaction landed in between) — the next
   *  viewport fetch rebuilds it cleanly. */
  onHeightsChanged(rowStart: number, heights: Float32Array): void {
    const idx = this.host.rowHeightIndex;
    if (!idx) return;
    const fallback = clampRowHeight(this.host.options.rowHeight ?? this.host.theme.rowHeight);
    let any = false;
    for (let i = 0; i < heights.length; i++) {
      const globalIdx = rowStart + i;
      if (globalIdx >= idx.length()) break;
      const raw = heights[i]!;
      const resolved = clampRowHeight(raw > 0 ? raw : fallback);
      if (idx.heightAt(globalIdx) !== resolved) {
        idx.update(globalIdx, resolved);
        any = true;
      }
    }
    if (any) {
      // Mirror into the chunk so DataSubgrid.getRowHeight (which reads
      // chunk.heights for in-window rows) picks up the new values without
      // refetching the chunk.
      if (this.host.chunk) {
        for (let i = 0; i < heights.length; i++) {
          const localIdx = rowStart + i - this.host.chunk.rowStart;
          if (localIdx >= 0 && localIdx < this.host.chunk.heights.length) {
            this.host.chunk.heights[localIdx] = clampRowHeight(
              heights[i]! > 0 ? heights[i]! : fallback,
            );
          }
        }
      }
      this.recomputeViewport();
      this.host.cgridCanvas.requestRepaint();
    }
  }

  /** Cycle 5 / Task 8 — main-thread fallback for `OffscreenCanvas.measureText`.
   *  Runs the same greedy word-wrap the worker would, using a regular
   *  `<canvas>` 2D context so Safari 15.4–16.3 + Firefox 100–104 still get
   *  autoHeight without blocking the worker pipeline. */
  onMeasureTextRequest(batchId: number, items: import('../worker/protocol').MeasureTextItem[]): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // No 2D context anywhere — best effort: zero-height response so the
      // worker resolves and the autoHeight pass exits cleanly.
      void this.host.workerCoord.measureTextResponse(batchId, new Float32Array(items.length));
      return;
    }
    const heights = new Float32Array(items.length);
    let lastFont = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.font !== lastFont) {
        ctx.font = item.font;
        lastFont = item.font;
      }
      const measure = (s: string) => ctx.measureText(s).width;
      heights[i] = wrapTextToHeight(item.text, item.width, item.lineHeight, item.padding, measure);
    }
    void this.host.workerCoord.measureTextResponse(batchId, heights);
  }

  /** Cycle 19 / Task 2 — delegates to `ViewportManager.recompute`. Kept as
   *  a thin wrapper so the 50+ internal `this.recomputeViewport()` callsites
   *  still compile unchanged. The manager owns `computeCurrentViewport` +
   *  `syncSizer` + `detectVirtualColumnsChanged` + the floating-filter
   *  re-pin (via the `afterRecompute` dep). */
  recomputeViewport(afterScroll: boolean = false): void {
    this.host.viewport = this.host.viewportManager.recompute(afterScroll);
    // Horizontal-scroll staleness fix (Cycle 22 closeout) — the viewport
    // now carries a scrollLeft the canvas was NOT last painted at: the
    // scroll handler's queued FULL damage was consumed by a paint that
    // ran BEFORE this recompute (the async fetch→chunk round-trip), so it
    // re-rendered the OLD position and the damage is spent. A diff-armed
    // chunk reply (`touchedRows` defined — any grid that has ever applied
    // a transaction, i.e. every live-ticking blotter) then resolves to
    // row-level damage only, leaving the surface at the old scrollLeft
    // forever while later row repaints land at the new one — per-row
    // horizontal misalignment, persistent at rest. Re-queue the full
    // repaint HERE, the single choke point where `this.viewport` moves,
    // so no scroll entry point (wheel, API, clamp) can miss it. The
    // ledger's 'full' entry absorbs/coalesces with any damage already
    // queued, so the common fast path (chunk lands before the paint, or
    // an undiffed reply that already resolves 'full') costs nothing
    // extra. `cgridCanvas` is unassigned during the constructor's first
    // recompute — nothing has painted yet, the first paint is full anyway.
    if (
      this.host.viewport.scrollLeft !== this.host.lastPaintedViewportScrollLeft
      && this.host.cgridCanvas
      && !this.host.destroyed
    ) {
      this.host.paintDriver.repaintFull();
    }
    // Column-geometry / style-layout staleness — keep forcing full until a
    // damage.full paint stamps `lastPaintedLayoutPaintEpoch`. Do NOT
    // re-bump the epoch here (scroll recomputes every tick); invalidation
    // sites already advanced it.
    if (
      this.host.layoutPaintEpoch !== this.host.lastPaintedLayoutPaintEpoch
      && this.host.cgridCanvas
      && !this.host.destroyed
    ) {
      this.host.paintDriver.repaintFull();
    }
  }

  /** Cycle 19 / Task 4 — delegating wrapper. The viewport-tick anchor +
   *  band-clip close lives in `EditController.syncOpenEditorPosition`. */
  syncOpenEditorPosition(): void {
    this.host.editController.syncOpenEditorPosition();
  }

  /** Cycle 19 / Task 2 — delegating wrappers. The clamp + scroller drive +
   *  belt-and-suspenders happy-dom fallback live in `ViewportManager`. */
  setScroll(x: number, y: number): void {
    this.host.viewportManager.setScroll(x, y);
  }
  /** Cycle 19 / Task 2 — back-compat shim for tests + downstream code that
   *  reach in via `(grid as any).onScrollerScroll(x, y)` to simulate a scroll
   *  event. The real handler is registered inside `ViewportManager`. */
  onScrollerScroll(x: number, y: number): void {
    this.host.viewportManager.onScrollerScroll(x, y);
  }
  /** Cycle 19 / Task 2 — back-compat getters so E2E + integration tests that
   *  read `(grid as any).scrollTop` / `.scrollLeft` keep working. The real
   *  scroll state lives on `ViewportManager`. */
  get scrollLeft(): number { return this.host.viewportManager.scrollLeft; }
  get scrollTop(): number { return this.host.viewportManager.scrollTop; }
  ensureRowIndexVisible(
    rowIndex: number,
    position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto',
  ): void {
    this.host.viewportManager.ensureRowIndexVisible(rowIndex, position);
  }
  ensureColIdVisible(
    colId: string,
    position: 'auto' | 'start' | 'middle' | 'end' = 'auto',
  ): void {
    this.host.viewportManager.ensureColIdVisible(colId, position);
  }

  /** Set only while a model-reorder `rebuildIndices` is running (see
   *  `rebuildIndicesWithoutAutoScroll`), so the selection `onChange` handler
   *  skips its `ensureRowIndexVisible` / `ensureColIdVisible` auto-scroll for
   *  a focus-index shift the user didn't cause. */
  /** Apply `rebuildIndices` without letting the resulting focus-index change
   *  auto-scroll the viewport. `SelectionModel.emit()` runs listeners
   *  synchronously, so the flag reliably brackets the `onChange` emit. */
  rebuildIndicesWithoutAutoScroll(rowIdToIndex: ReadonlyMap<string, number>): void {
    this.host.suppressFocusEnsure = true;
    try {
      this.host.selection.rebuildIndices(rowIdToIndex);
    } finally {
      this.host.suppressFocusEnsure = false;
    }
  }

  /** After the worker model changes (sort / filter / transaction / column
   *  swap), re-resolve every persistent selection rowId to its new visible
   *  index and apply it to the paint set. No worker round-trip when no
   *  persistent ids are tracked — keeps the common no-selection case free. */
  rebuildSelectionFromPersistentIds(): void {
    const selectedIds = this.host.selection.getPersistentSelectedRowIds();
    const focusedId = this.host.selection.getPersistentFocusedRowId();
    const allIds: string[] = [...selectedIds];
    if (focusedId !== null && !selectedIds.includes(focusedId)) allIds.push(focusedId);
    if (allIds.length === 0) {
      // Nothing selected or focused — clear any stale paint indices immediately,
      // no worker round-trip needed.
      this.rebuildIndicesWithoutAutoScroll(new Map());
      return;
    }
    this.host.workerCoord.getRowIndicesForIds(allIds).then((indices) => {
      if (this.host.destroyed) return;
      const map = new Map<string, number>();
      for (let i = 0; i < allIds.length; i++) map.set(allIds[i]!, indices[i]!);
      this.rebuildIndicesWithoutAutoScroll(map);
    }).catch((err) => { if (!this.host.destroyed) console.error('[velocity-grid] rebuildSelectionFromPersistentIds:', err); });
  }

  /** Walk the column tree to collect the ancestor groupIds (root → parent)
   *  of `groupId`. Excludes `groupId` itself. Empty for top-level groups. */
  findGroupAncestors(groupId: string): string[] {
    const path: string[] = [];
    const visit = (node: import('../core/columnTree').ColumnTreeNode, trail: string[]): boolean => {
      if (node.kind !== 'group') return false;
      if (node.groupId === groupId) {
        path.push(...trail);
        return true;
      }
      const nextTrail = [...trail, node.groupId];
      for (const child of node.children) {
        if (visit(child, nextTrail)) return true;
      }
      return false;
    };
    for (const root of this.host.columnTree.roots) {
      if (visit(root, [])) break;
    }
    return path;
  }

  /** Cycle 19 / Task 2 — viewport-fetch entry point. Delegates to
   *  `ViewportManager.request`; the manager handles coalescing + the
   *  velocity-driven prefetch math and invokes `handleViewportChunk` (the
   *  chunk-processing tail below) via the `dispatchViewportRequest` dep.
   *  Cycle 19 / Task 3 will absorb both halves into `WorkerCoordinator`. */
  requestViewport(aggSource: AggregationChangedSource | null = null): void {
    this.host.viewportManager.request(aggSource);
  }

  /** Cycle 19 / Task 3 — chunk-arrival side-effects. Invoked from the
   *  WorkerCoordinator's `onViewportChunk` dep after every successful
   *  `getViewport` round-trip ViewportManager triggered. The worker call +
   *  request coalescing live in the coordinator; this method owns the
   *  main-side fan-out:
   *    LRU caching, pivot column sync, per-cell + per-group flash,
   *    row-height index refresh, recompute + repaint, a11y update,
   *    `aggregationChanged` (gated on `consumePendingAggSource`),
   *    `firstDataRendered` latch.
   *  Returns a Promise the coordinator awaits before resolving
   *  `dispatchViewportRequest`, so ViewportManager's coalescing flag
   *  releases after the mutation lands. */
  async handleViewportChunk(
    opts: { rowStart: number; rowEnd: number; columns: string[]; seq?: number },
    chunk: ViewportChunk,
    stickyAncestors: StickyAncestor[],
  ): Promise<void> {
    const { rowStart, rowEnd, columns: cols } = opts;
    // Latest-wins (Deephaven subscription.setViewport): drop superseded
    // replies, and also drop replies that miss the live fetch window
    // entirely (coalesced in-flight can still resolve for an old range).
    if (
      opts.seq !== undefined
      && opts.seq < this.host.viewportManager.viewportReqSeq
    ) {
      return;
    }
    const liveVs = this.host.viewportManager.state;
    if (
      liveVs.lastRow >= 0
      && !chunkIntersectsRowRange(chunk, liveVs.firstRow, liveVs.lastRow)
    ) {
      return;
    }
    // Capture the previous chunk's totals + full row identity BEFORE
    // overwriting `this.chunk` — the aggregate diff (C3) and the
    // positional-identity window diff (C2 / adjudication B) both compare
    // against the OLD chunk.
    const prevChunk = this.host.chunk;
    const prevGroupTotals = prevChunk?.groupTotals;
    const prevChunkTotals = prevChunk?.totals;
    this.host.chunk = chunk;
    this.host.stickyAncestors = stickyAncestors;
    this.host.decodedTextCols.clear();
    // Cycle 25 / Task 10 — park the chunk in the LRU. WeakRef retention means
    // GC can reclaim if real memory pressure builds; the LRU's own eviction
    // kicks in when our running sum exceeds `memoryBudgetMB`. Cache lookup on
    // subsequent requests is intentionally NOT wired here — keying on model
    // versions (sort/filter/group/pivot) needs more surface than this cycle
    // delivers. Foundation only.
    if (this.host.chunkLRU) {
      const key = `${rowStart}:${rowEnd}:${cols.join(',')}`;
      this.host.chunkLRU.set(key, chunk, estimateChunkBytes(chunk));
    }
    // Cycle 18 / Task 3 — (re)synthesize or drop the pivot result columns
    // from the freshly-arrived pivot tree before the layout + paint below
    // run off the new column order.
    this.host.pivotEngine.maybeSyncPivotColumns(chunk);
    // Cycle 18 / Task 8a — surface the cap breach as a public event. The
    // chunk already arrived with no pivot output when this is set (PivotPass
    // bypassed early); the grid paints primary columns normally. Apps can
    // listen + raise the cap / narrow the filter. Emit ONCE per chunk that
    // carries the field — no debounce needed since the worker only sets the
    // field when the breach actually happened (not on every chunk).
    if (chunk.pivotMaxColumnsReached !== undefined) {
      this.host.events.emit({
        type: 'pivotMaxColumnsReached',
        generatedColumns: chunk.pivotMaxColumnsReached.generatedColumns,
        cap: chunk.pivotMaxColumnsReached.cap,
      });
    }
    // Cycle 4 / Task 11 (cell-flash patch) — drain the worker's per-cell
    // flashMask into the registry. The chunk's `rowIds` are numeric (the
    // worker's stable mapping); the painter's cellData callback reads
    // `registry.getAlpha(numericRowId, colId, now)` to produce flashAlpha
    // per visible cell.
    // Cycle 22 / closeout I-3 — patch-on-tick's PRODUCTION seam. The
    // worker's flashMask IS the tick's cell-granular diff (row-major bits
    // over rowIds × cols): collect the changed cells here so the
    // diff-armed branch below can patch retained strips ONCE per tick
    // (after `repaintRows` has bumped the touched rows, so the patch lands
    // at the row's FINAL post-tick version and the strip HITS at fade
    // settle). Before this seam existed, the only caller of the patch path
    // was the flash-fade rAF loop — whose first attempt died on the
    // cellIcon-existence bail (see `patchStripCells`) and whose per-rAF
    // churn was closeout I-4 — so `stripPatches` was 0 in production.
    let tickDamagedCells: Array<{ rowId: number; colId: string }> | null = null;
    if (chunk.flashMask && this.host.rasterStrips !== null) {
      const mask = chunk.flashMask;
      const rowCount = chunk.rowIds.length;
      const colCount = cols.length;
      for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < colCount; c++) {
          const bitIdx = r * colCount + c;
          if (((mask[bitIdx >>> 3] ?? 0) & (1 << (bitIdx & 7))) === 0) continue;
          (tickDamagedCells ??= []).push({ rowId: chunk.rowIds[r]!, colId: cols[c]! });
        }
      }
    }
    if (chunk.flashMask) {
      // Cycle 21e / Task 13 — join per-call flashCells overrides by the
      // chunk's string rowIds. Zero-cost when the override map is empty
      // (the common case): no lookup closure is even passed.
      //
      // Style-rule flash ownership — when an enabled style rule has
      // `flash.enabled` for a column (or whole row), default worker
      // cell-change flash is suppressed for that cell. Rule / API flash
      // still paints: `flashCells` stages an override marker that
      // `shouldFlash` admits.
      const hasOverrides = this.host.flashOverrides.size > 0;
      const owned = ruleFlashOwnership(getRuleEngine()?.getRules?.());
      const suppressDefault = owned.allColumns || owned.colIds.size > 0;
      const needSid = hasOverrides || suppressDefault;
      this.host.flashRegistry.ingestMask({
        rowIds: chunk.rowIds,
        colIds: cols,
        mask: chunk.flashMask,
        stringRowIds: needSid ? chunk.stringRowIds : undefined,
        getOverride: hasOverrides
          ? (sid, colId) =>
              this.host.flashOverrides.get(`${sid}\0${colId}`)
                ?? this.host.flashOverrides.get(`${sid}\0*`)
          : undefined,
        shouldFlash: suppressDefault
          ? (sid, colId) => {
              if (!isRuleFlashOwned(owned, colId)) return true;
              return this.host.flashOverrides.has(`${sid}\0${colId}`)
                || this.host.flashOverrides.has(`${sid}\0*`);
            }
          : undefined,
      });
      this.host.startFlashTickLoop();
    }
    // Flash aggregate cells whose groupTotals or grand totals changed vs the
    // previous chunk. Data-row flashes come from the worker's flashMask
    // (keyed by rowId); group/footer rows carry no rowId so we diff the
    // totals records here on the main thread. groupTotals covers per-group
    // group rows AND per-group footer rows. chunk.totals covers the grand-
    // total footer (groupKey='').
    // C3 fix — this diff used to run ONLY inside `enableCellChangeFlash`,
    // which meant it was the ONLY thing that routed changed totals into
    // damage — a flash-disabled grid (the DEFAULT) never repainted a
    // changed aggregate on the partial path at all. `diffAggregates` now
    // runs unconditionally; `enableCellChangeFlash` only gates whether the
    // change ALSO drives the visual flash-fade effect.
    const { changedGroupKeys, grandTotalChanged } =
      diffAggregates(chunk, prevGroupTotals, prevChunkTotals);
    const aggregatesChanged = changedGroupKeys.size > 0 || grandTotalChanged;
    // Damage-region rendering (Task 3, extended Task 6) — did THIS chunk
    // add any group/footer flash entries? Those cells live on group/footer
    // rows, which carry no rowId and so never appear in `touchedRows` —
    // the partial branch below calls `repaintGroupFlash()` (flash-enabled
    // path) or `repaintAggregateDamage()` (C3's flash-disabled path)
    // instead of degrading to full.
    let groupFlashChanged = false;
    if (this.host.options.enableCellChangeFlash) {
      const now = performance.now();
      for (const groupKey of changedGroupKeys) {
        const oldRec = prevGroupTotals?.[groupKey];
        const newRec = chunk.groupTotals![groupKey]!;
        for (const colId of Object.keys(newRec)) {
          if (oldRec?.[colId] !== newRec[colId]) {
            this.host.groupFlashMap.set(`${groupKey}\0${colId}`, now);
            groupFlashChanged = true;
          }
        }
      }
      // Grand-total footer (groupKey='') sources from chunk.totals, not
      // groupTotals. Diff it separately; store under the '' key so
      // groupFlashAlpha('', colId) resolves for rowKind=3 + empty key.
      if (grandTotalChanged && chunk.totals) {
        for (const colId of Object.keys(chunk.totals)) {
          if (prevChunkTotals?.[colId] !== chunk.totals[colId]) {
            this.host.groupFlashMap.set(`\0${colId}`, now);
            groupFlashChanged = true;
          }
        }
      }
      if (this.host.groupFlashMap.size > 0) this.host.startFlashTickLoop();
    }
    // Build / refresh the cumulative row-height index (Cycle 5 / Task 7).
    // Initial build seeds every row with the grid-level fallback; subsequent
    // chunks layer their per-row heights in. A rowCount change (sort /
    // filter / transaction) discards the existing index so per-row entries
    // that shifted slots aren't read at their old positions — the next
    // chunks rebuild it. Done before recomputeViewport so the index is
    // current for the first paint after the chunk lands.
    this.refreshRowHeightIndex(chunk);
    // Recompute the viewport so DataSubgrid.getRowHeight reads the new
    // chunk's per-row heights (Cycle 5 / Task 6). Without this the
    // visibleRows array carries heights from BEFORE the chunk arrived and
    // variable-height rows paint at the fallback until the next scroll
    // triggers another recompute.
    this.recomputeViewport();
    // Thumb-drag hybrid defer can stick across a full-damage streak. Once
    // a covering chunk lands, drop deferral and force a clean layer
    // re-anchor so the next scrolls return to present/shift instead of
    // lean full-paints.
    if (
      this.host.paintDriver.paintCacheActive()
      && this.host.paintCacheDeferLayer
      && chunkCoversOnScreenRows(chunk, this.host.viewport)
    ) {
      this.host.paintCacheDeferLayer = false;
      this.host.paintCacheLayerAnchored = false;
    }
    // C2 + adjudication B — `resolveWindowDamage` replaces the old bare
    // `sameWindow` (rowStart+rowCount) check, which trusted `touchedRows`
    // at face value whenever the window looked unchanged. That's unsafe
    // under an active sort: a tick can permute the visible order while
    // rowStart/rowCount stay put, displacing rows that `touchedRows` (named
    // at their NEW positions) never flags — their old content just sits
    // there stale. The position-diff below compares row IDENTITY
    // (rowId+rowKind+groupKey) at every overlapping position (shifted by
    // the window-move delta), so a reorder, a filter-driven window move,
    // AND an ordinary scroll-driven window move all resolve through the
    // same mechanism — closing both C2 (reorder-under-sort) and the
    // scroll-driven full-repaint gap in one guard. Column-set changes
    // (group expand / showColumns) also force 'full' here — otherwise a
    // live-feed empty `touchedRows` leaves newly revealed cells blank.
    // See `resolveWindowDamage` doc for the exact bail conditions (every
    // one degrades to full, never to under-painting).
    const windowDamage = resolveWindowDamage(chunk, prevChunk);
    if (windowDamage === 'full') {
      // Cycle 22 / Task 3 — unknown-diff chunk: no touchedRows (untracked
      // data apply — setRowData, filter/sort/group model change — OR a
      // plain window move with nothing staged), a height change, or a
      // diff past the cap. Any of these can reorder rows (zebra parity is
      // baked into a strip's pixels) or change content invisibly, so
      // EVERY retained strip is untrusted — wipe the store and the
      // version map together (fresh captures restart at version 0). A
      // stale strip is a bug; re-capturing is a cheap drawImage per row.
      if (this.host.rasterStrips !== null) {
        this.host.paintDriver.stripLayoutEpochBump();
        this.host.rowVersionByRowId.clear();
      }
      this.host.paintDriver.repaintFull();
    } else {
      if (windowDamage.length > 0) {
        this.host.paintDriver.repaintRows(windowDamage.map((r) => chunk.rowStart + r));
      }
      // Cycle 22 / closeout I-3 — patch-on-tick, at the tick itself.
      // AFTER `repaintRows` (which bumped every touched row) so the patch
      // advances each patched row to its final post-tick version: the
      // strip holds the SETTLED pixels (flash suppressed) through the
      // fade and HITS the moment the row is eligible again, instead of
      // forcing a full-row live re-raster that cell-sized fade rects can
      // never recapture. Runs under `suppressPartialRepaint` too — same
      // keep-tracking contract as the version bumps in `repaintRows`.
      if (tickDamagedCells !== null) {
        this.host.paintDriver.applyStripCellDamage(tickDamagedCells);
      }
      if (groupFlashChanged) {
        this.host.repaintGroupFlash();
      } else if (aggregatesChanged) {
        // C3 — flash disabled (or suppressed), but a total still changed:
        // damage the changed aggregate cells directly instead of relying
        // on `groupFlashMap`, which stays empty when flash is off.
        this.host.repaintAggregateDamage(changedGroupKeys, grandTotalChanged);
      }
    }
    this.host.updateA11y();
    // Cycle 14 / Task 6 — emit `aggregationChanged` ONLY when the mutation
    // that drove this fetch actually changed the totals (data / filter /
    // aggFuncs / column aggFunc / explicit API). Cosmetic re-fetches
    // (scroll, sort, theme, column move / visible / pin / resize) call
    // `requestViewport()` with no source so the manager's pending source
    // stays null and we skip the event — listeners that want every paint
    // subscribe to `viewportChanged` instead. Consume only when totals
    // exist so a chunk that lacks totals doesn't clear a pending source
    // queued for the next totals-bearing chunk.
    if (chunk.totals) {
      const source = this.host.viewportManager.consumePendingAggSource();
      if (source !== null) {
        this.host.events.emit({
          type: 'aggregationChanged',
          totals: chunk.totals,
          source,
        });
      }
    }
    // firstDataRendered: latch once per grid instance, the first time a
    // non-empty chunk has landed and a repaint has been scheduled. Empty
    // chunks (e.g. setRowData([]) or filter-out-everything) don't count.
    if (!this.host.firstDataFired && chunk.rowCount > 0) {
      this.host.firstDataFired = true;
      this.host.events.emit({ type: 'firstDataRendered' });
    }
  }

  /** Build the cumulative-height index from scratch when `rowCount` changed,
   *  then merge the chunk's per-row heights into it. The 0 sentinel in
   *  `chunk.heights` means "no per-row override" — we leave those at the
   *  fallback so rows without explicit heights stay at the grid-level
   *  `rowHeight`. Cycle 5 / Task 7. */
  refreshRowHeightIndex(chunk: ViewportChunk): void {
    const fallback = clampRowHeight(this.host.options.rowHeight ?? this.host.theme.rowHeight);
    if (!this.host.rowHeightIndex || this.host.rowHeightIndex.length() !== this.host.rowCount) {
      this.host.rowHeightIndex = new RowHeightIndex(this.host.rowCount, () => fallback);
    }
    const idx = this.host.rowHeightIndex;
    for (let i = 0; i < chunk.heights.length; i++) {
      const globalIdx = chunk.rowStart + i;
      if (globalIdx >= idx.length()) break;
      const raw = chunk.heights[i]!;
      const resolved = clampRowHeight(raw > 0 ? raw : fallback);
      if (idx.heightAt(globalIdx) !== resolved) {
        idx.update(globalIdx, resolved);
      }
    }
  }

  /** Resolve the height of the data row at `localRowIndex`. When the row is
   *  present in the current viewport chunk and has a non-zero per-row entry,
   *  use that; otherwise fall back to the grid-level `rowHeight`. The 0
   *  sentinel in `chunk.heights` means "no per-row override" — substitute
   *  the fallback so columns with mixed-heights row sets don't shrink to 0.
   *  Task 7's Fenwick tree extends this with O(log n) global coverage. */
  rowHeightAt(localRowIndex: number): number {
    const fallback = clampRowHeight(this.host.options.rowHeight ?? this.host.theme.rowHeight);
    if (!this.host.chunk) return fallback;
    const i = localRowIndex - this.host.chunk.rowStart;
    if (i < 0 || i >= this.host.chunk.heights.length) {
      // Under active pivot mode, rows outside the chunk are always leaves
      // (the slicer only ships group rows + footer entries into the chunk).
      // Returning 0 collapses the data subgrid's extent to just the visible
      // group rows — which is what makes the bottom-pinned Grand Total row
      // visible without forcing the user to scroll past hundreds of empty
      // leaf rows.
      //
      // Exception: when NO chunk has arrived yet (heights.length === 0) the
      // grid hasn't seen its visible window. Returning 0 here would
      // collapse the data subgrid to zero rows, the viewport would request
      // `[0, 0)`, the worker would ship an empty chunk, and the loop would
      // never break. Use the fallback so the initial request for the
      // visible window has a non-zero range.
      if (this.host.pivotEngine.isPivotActive() && this.host.chunk.heights.length > 0) return 0;
      return fallback;
    }
    const h = this.host.chunk.heights[i]!;
    return clampRowHeight(h > 0 ? h : fallback);
  }
}
