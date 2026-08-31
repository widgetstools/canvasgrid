// Owns the pivot subsystem: the canonical `PivotState` (pivotMode +
// pivotColumns + valueColumns), the `pivotActive` flag, the
// `pivotCellSpecById` reverse index the body cell reader uses to address
// `chunk.pivotValues`, and the signature-compare that keeps steady-state
// scrolls from churning the column tree.
//
// The engine DESCRIBES the cross-tab; it does not build one.
// `getProjection()` is stage 4 of `resolveDisplayedColumns`, and the host
// runs that single resolve. `adoptResolved()` takes the outcome back.
//
// It used to do the opposite: synthesize a tree, stash the primary tree and
// its group state, swap the column tree + defs map + group state, re-run the
// order/layout/subgrid pass and repaint — all in parallel with the host's own
// `rebuildColumns`, which did the same job from different inputs. Two builders
// meant whichever ran last won, so a rebuild could leave pivot mode ON while
// painting source columns, and formatting applied to a value column never
// reached its pivot cells. That parallel path is gone; there is one resolve.
//
// The seam shrank with it. Six deps existed only to serve the swap —
// setColumnTree, get/setColumnGroupState, setColumnDefsMap,
// getAutoGroupColumns, subscribeColumnGroupState — and are gone. What remains
// is state, worker plumbing, and the layout tail.
//
// VelocityGrid is the thin consumer:
//   • Public pivot API (`isPivotMode` / `setPivotMode` / `getPivotColumns`
//     / …) delegates to `pivotEngine.*`.
//   • Chunk-arrival calls `maybeSyncPivotColumns(chunk)`, which records the
//     new cross-tab shape and asks the host to re-resolve, or drops the
//     projection to deactivate.
//   • `pivotWorkerModel()` provides the model shipped to the worker.
//   • `getPrimaryColumnTree()` exposes the last resolve's SOURCE tree so
//     `workerColumns()` and the panels can read source columns while pivot is
//     active. Unlike the old stash it is never null — it is recomputed by
//     every resolve, so it cannot go stale, and when pivot is off it is the
//     displayed tree.
//   • `getCellSpec(colId)` powers the body cell reader dispatch for
//     synthesized pivot columns.
//
// Cycle 19 / Task 5b — the pivot-mode-toggle now owns the AG-v36
// "primaries auto-hide under pivot mode" invariant. When the mode
// flips ON, every primary leaf's current `def.hide` is snapshotted and
// hide is set to true through `deps.setColumnsVisible`. When the mode
// flips OFF, the snapshot restores whatever the hide state was before
// pivot. Consequences pinned by the columnsPanel side of the same PR:
//   • `computeRowChecked` becomes role-only under pivot mode
//     (the "visible OR role" fallback is dropped).
//   • `handleRowCheckboxClick` no longer calls `setColumnsVisible`
//     under pivot mode — role assignment is the checkbox's sole job.
//   • `setGroupModel`'s auto-show-on-ungroup path is gated by pivot
//     mode so removing a rowGroup role can't fight the primary
//     auto-hide.
// The commit 89c7a74 "hide flag is sole authority for visibility"
// invariant survives untouched: `computeVisibleColumnOrder` still
// reads only `def.hide`. Pivot mode became an author of that flag —
// not a second visibility authority.

import type { TypedEventEmitter } from './eventEmitter';
import type { ColumnTree } from './columnTree';
import type { ResolvedColDef } from './propertyChain';
import type { ColumnLayout } from './layout';
import type { VelocityGridEvent, VelocityGridOptions } from '../types';
import type { ViewportChunk } from '../worker/protocol';
import type { PivotModel } from '../worker/passes/pivotPass';
import {
  PivotState,
  type PivotStateChangedEvent,
  type PivotStateSnapshot,
  type PivotValueColumn,
} from './pivotState';
import type { PivotCellSpec, PivotValueColumnSpec } from './pivotColumns';
import type { PivotProjection } from './resolveDisplayedColumns';
import { resolveColumnWidths } from './layout';

/** Subset of `VelocityGridOptions` the pivot engine reads. Passed through a
 *  closure so per-tick `setGridOption` flips light up on the next
 *  chunk-arrival without re-wiring the engine. */
export interface PivotEngineOptions {
  pivotDefaultExpanded?: number;
  pivotGrandTotals?: boolean;
  pivotRowTotals?: 'before' | 'after' | null;
  pivotColumnGroupTotals?: 'before' | 'after' | null;
  processPivotResultColDef?: VelocityGridOptions<unknown>['processPivotResultColDef'];
  processPivotResultColGroupDef?: VelocityGridOptions<unknown>['processPivotResultColGroupDef'];
}

/** Panel host surface consumed on pivot-state changes. `null` when the
 *  pivot panel wasn't mounted (`pivotPanelShow: 'never'` or absent). */
export interface PivotPanelHostSurface {
  setPivotColumns(cols: string[]): void;
  setPivotActive(active: boolean): void;
}

/** Deps interface: every access the engine needs into VelocityGrid state,
 *  worker plumbing, and layout / repaint pipeline. Intentionally fat —
 *  the pivot swap orchestrates every rendering-state field the tree
 *  swap touches, and routing each one through an explicit callback
 *  keeps the engine unaware of VelocityGrid's private fields. */
export interface PivotEngineDeps<TRow> {
  events: TypedEventEmitter<VelocityGridEvent>;
  isDestroyed(): boolean;
  getOptions(): PivotEngineOptions;

  // ── worker round-trip ────────────────────────────────────────────────
  /** Fresh workerColumns snapshot (already includes pivot/value
   *  columns as extras). VelocityGrid owns the derivation; engine ships it. */
  workerColumns(): unknown[];
  updateWorkerColumns(cols: unknown[]): Promise<unknown>;
  setWorkerPivotModel(model: PivotModel): Promise<unknown>;
  setWorkerPivotMaxGeneratedColumns(cap: number | undefined): Promise<unknown>;
  setWorkerStrictPivotColumnOrder(strict: boolean): Promise<unknown>;
  requestViewport(): void;

  // ── pivot panel host bridge ──────────────────────────────────────────
  /** Fresh reference each call so runtime `setGridOption('pivotPanelShow', …)`
   *  mounts / unmounts land without re-wiring the engine. `null` = no host. */
  getPivotPanel(): PivotPanelHostSurface | null;

  // ── column tree / group state / defs map access ──────────────────────
  getColumnTree(): ColumnTree;
  getColumnDefsMap(): Map<string, ResolvedColDef<TRow>>;
  /** Pre-resolve presentation properties a pivot result column should
   *  inherit from its source value column. See PIVOT_INHERITED_COLDEF_KEYS. */
  getPivotValueInheritance?(colId: string): Record<string, unknown>;

  // ── layout + repaint pipeline ────────────────────────────────────────
  computeVisibleColumnOrder(): ResolvedColDef<TRow>[];
  setColumnOrder(order: ResolvedColDef<TRow>[]): void;
  /** Width available for column layout; falls back to scroller
   *  clientWidth or a hardcoded default upstream. */
  getLayoutWidth(): number;
  setColumnLayout(layout: ColumnLayout[]): void;
  rebuildSubgridStack(): void;
  recomputeViewport(): void;
  requestRepaint(): void;
  /** Pivot mode flip re-evaluates the split-strip layout (AG-Grid
   *  parity — row group panel + pivot panel share one strip in pivot
   *  mode). */
  applyVerticalInsets(): void;

  // ── pivot-mode auto-hide primaries (Task 5b) ─────────────────────────
  /** Same signature as the public API — the engine calls this on
   *  pivot-mode flips to drive the primary auto-hide / restore pass
   *  through the same code path the panel + `applyColumnState` use.
   *  Routing through VelocityGrid keeps the `columnVisible` event + worker
   *  updateColumns roundtrip intact. */
  setColumnsVisible(colIds: string[], visible: boolean): void;
  /** Re-run the single column resolve. The engine describes the cross-tab
   *  (getProjection) and the host builds it — the engine no longer installs a
   *  tree of its own. */
  rebuildColumns(): void;
}

export class PivotEngine<TRow = unknown> {
  private readonly state: PivotState;
  private readonly unsubscribe: () => void;

  /** True while synthesized pivot result columns are installed (the
   *  column tree has been swapped to the pivot tree). */
  private active = false;
  /** Saved primary column structures, restored when pivot deactivates.
   *  `null` while pivot is inactive. */
  private primaryColumnTree: ColumnTree | null = null;
  /** Last cross-tab shape synthesized, so the pivot tree can be rebuilt
   *  without waiting for another chunk (see onPrimaryColumnsRebuilt). */
  private lastKeyTree: import('../worker/passes/pivotPass').PivotKeyNode[] | null = null;
  /** Reverse index: synthetic pivot colId → (pivotPath, valueColId),
   *  for the body cell lookup against `chunk.pivotValues`. */
  private cellSpecById: Map<string, PivotCellSpec> = new Map();
  /** Signature of the last-synthesized pivot tree (leaf paths + value
   *  columns + totals options) so columns re-synthesize only when the
   *  distinct-key set or measures actually change. */
  private treeSignature = '';
  /** Previous pivot mode, tracked so `handleStateChanged` can detect
   *  a mode transition (off→on / on→off) and drive the primary
   *  auto-hide pass. Column-mutation events (pivot cols / value cols)
   *  fire the same state-change handler but must NOT re-trigger the
   *  hide flip. */
  private prevPivotMode: boolean;
  /** Snapshot of every primary leaf's `def.hide` at the moment pivot
   *  mode flipped ON. On flip OFF the entries are consulted to restore
   *  the pre-pivot visibility. Empty while pivot mode is OFF. Task 5b. */
  private preservedPrimaryHide: Map<string, boolean> = new Map();

  constructor(
    private readonly deps: PivotEngineDeps<TRow>,
    init: { pivotMode: boolean },
  ) {
    this.state = new PivotState({ pivotMode: init.pivotMode });
    this.prevPivotMode = init.pivotMode;
    this.unsubscribe = this.state.on('pivotStateChanged', (e) => this.handleStateChanged(e));
  }

  // ── Public read surface ───────────────────────────────────────────────────

  isPivotMode(): boolean { return this.state.isPivotMode(); }


  /**
   * Stage 4 of the column resolve, or `null` when pivot is inactive.
   *
   * The engine no longer BUILDS a tree and swaps it in. It describes what the
   * cross-tab should be and `resolveDisplayedColumns` builds it, from the
   * stage-3 primary leaves — which is what lets a value column's formatting
   * reach its pivot cells, and what stops a rebuild from installing source
   * columns over the cross-tab (there is no separate tree left to overwrite).
   */
  getProjection(): PivotProjection<TRow> | null {
    if (!this.state.isPivotMode() || !this.lastKeyTree) return null;
    const valueColumns = this.buildValueColumnSpecs();
    if (valueColumns.length === 0) return null;
    const opts = this.deps.getOptions();
    return {
      keyTree: this.lastKeyTree,
      valueColumns,
      // A role mutation discards the previous layout and re-synthesizes, and
      // the product rule is that it opens fully — dragging a column into any
      // pivot section must produce a visible matrix without a toggle-off/on
      // round trip. The FIRST synthesis still honours the app's configured
      // depth so first paint matches construction intent.
      pivotDefaultExpanded: this.active
        ? Number.POSITIVE_INFINITY
        : opts.pivotDefaultExpanded,
      pivotGrandTotals: opts.pivotGrandTotals === true,
      pivotRowTotals: opts.pivotRowTotals ?? null,
      pivotColumnGroupTotals: opts.pivotColumnGroupTotals ?? null,
      processPivotResultColDef: opts.processPivotResultColDef as
        ((colDef: import('../types').CColDef<TRow>) => void) | undefined,
      processPivotResultColGroupDef: opts.processPivotResultColGroupDef as
        ((groupDef: import('../types').CColGroupDef<TRow>) => void) | undefined,
    };
  }

  /** Value-column specs, each carrying the presentation its source column
   *  resolved to. Shared by the projection and the legacy swap path. */
  private buildValueColumnSpecs(): PivotValueColumnSpec[] {
    const primaryLeaves = (this.primaryColumnTree ?? this.deps.getColumnTree()).leafById;
    return this.state.getValueColumns().map((v) => {
      const primary = primaryLeaves.get(v.colId);
      return {
        colId: v.colId,
        aggFunc: v.aggFunc,
        headerName: primary?.headerName ?? v.colId,
        cellDataType: primary?.cellDataType ?? 'number',
        width: primary?.width,
        inherit: this.deps.getPivotValueInheritance?.(v.colId),
      };
    });
  }

  /**
   * Take the outcome of a resolve. Replaces the save/restore dance: the
   * primary tree is recomputed on every resolve, so there is nothing to
   * stash and nothing to go stale.
   */
  adoptResolved(
    primaryTree: ColumnTree,
    cellSpecById: Map<string, PivotCellSpec>,
    pivoted: boolean,
  ): void {
    this.primaryColumnTree = primaryTree;
    this.cellSpecById = cellSpecById;
    this.active = pivoted;
  }
  isPivotActive(): boolean { return this.active; }
  /** True when PivotState is configured to produce pivot output
   *  (pivotMode ON AND ≥1 pivot col AND ≥1 value col) — the pre-5a
   *  "state has enough to activate" semantic used by the pivot panel
   *  host's `data-active` attribute. Deterministic from state alone;
   *  flips synchronously when the config changes, unlike `isPivotActive()`
   *  which only flips after the worker chunk lands. */
  isPivotStateActive(): boolean { return this.state.isPivotActive(); }
  getPivotColumns(): string[] { return this.state.getPivotColumns(); }
  getValueColumns(): PivotValueColumn[] { return this.state.getValueColumns(); }
  /** Same signature VelocityGrid exposes on the public API (plain object list). */
  getValueColumnsApiShape(): Array<{ colId: string; aggFunc: string }> {
    return this.state.getValueColumns().map((v) => ({ colId: v.colId, aggFunc: v.aggFunc }));
  }
  /** Synthesized pivot result column IDs — the cross-tabbed colIds the
   *  worker emits when pivot is active. Returns `[]` when pivot is
   *  inactive. Mirrors AG-Grid's `gridApi.getPivotResultColumns()`. */
  getPivotResultColumns(): string[] {
    if (!this.active) return [];
    return Array.from(this.cellSpecById.keys());
  }

  /** Saved primary tree; `null` while pivot is inactive. Consumers:
   *  `workerColumns()` sources primary leaves from here under pivot;
   *  `getColumnState()` snapshots against the primary tree; the pivot
   *  panel host + column-role predicates fall through to it when the
   *  live `columnDefsMap` doesn't carry a source colId. */
  getPrimaryColumnTree(): ColumnTree | null { return this.primaryColumnTree; }

  /** Reverse-index lookup for a synthesized pivot column. Returns
   *  `null` for a non-synthesized colId. */
  getCellSpec(colId: string): PivotCellSpec | null {
    return this.cellSpecById.get(colId) ?? null;
  }

  /** Serialised snapshot suitable for grid-state persistence. */
  serialize(): PivotStateSnapshot { return this.state.serialize(); }
  restore(snapshot: PivotStateSnapshot): void { this.state.restore(snapshot); }

  // ── Public mutation surface ───────────────────────────────────────────────

  setPivotMode(pivotMode: boolean): void {
    if (this.deps.isDestroyed()) return;
    this.state.setPivotMode(pivotMode);
  }
  setPivotColumns(colIds: string[]): void {
    if (this.deps.isDestroyed()) return;
    this.state.setPivotColumns(colIds);
  }
  addPivotColumn(colId: string): void {
    if (this.deps.isDestroyed()) return;
    this.state.addPivotColumn(colId);
  }
  removePivotColumn(colId: string): void {
    if (this.deps.isDestroyed()) return;
    this.state.removePivotColumn(colId);
  }
  movePivotColumn(from: number, to: number): void {
    if (this.deps.isDestroyed()) return;
    this.state.movePivotColumn(from, to);
  }
  addValueColumn(colId: string, aggFunc: string): void {
    if (this.deps.isDestroyed()) return;
    this.state.addValueColumn(colId, aggFunc);
  }
  removeValueColumn(colId: string): void {
    if (this.deps.isDestroyed()) return;
    this.state.removeValueColumn(colId);
  }
  moveValueColumn(from: number, to: number): void {
    if (this.deps.isDestroyed()) return;
    this.state.moveValueColumn(from, to);
  }
  setValueColumnAggFunc(colId: string, aggFunc: string): void {
    if (this.deps.isDestroyed()) return;
    this.state.setValueColumnAggFunc(colId, aggFunc);
  }
  setValueColumns(list: Array<{ colId: string; aggFunc: string }>): void {
    if (this.deps.isDestroyed()) return;
    this.state.setValueColumns(list);
  }

  // ── Runtime option flips ──────────────────────────────────────────────────

  /** Pure pass-through to the worker: the worker validates (negative /
   *  non-finite revert to default) and the next `getViewport` honors
   *  the new cap. */
  updateMaxGeneratedColumns(cap: number | undefined): void {
    if (this.deps.isDestroyed()) return;
    this.deps.setWorkerPivotMaxGeneratedColumns(cap)
      .then(() => { if (!this.deps.isDestroyed()) this.deps.requestViewport(); })
      .catch((err) => {
        if (!this.deps.isDestroyed()) console.error('[velocity-grid] setPivotMaxGeneratedColumns:', err);
      });
  }

  /** Flip the strict-order flag at runtime. The next `getViewport`
   *  honors the new behaviour. */
  updateStrictColumnOrder(strict: boolean | undefined): void {
    if (this.deps.isDestroyed()) return;
    this.deps.setWorkerStrictPivotColumnOrder(strict === true)
      .then(() => { if (!this.deps.isDestroyed()) this.deps.requestViewport(); })
      .catch((err) => {
        if (!this.deps.isDestroyed()) console.error('[velocity-grid] setStrictPivotColumnOrder:', err);
      });
  }

  /** Re-synthesize the pivot columns so a new totals-option position
   *  lands on the next chunk. The signature comparison inside
   *  `maybeSyncPivotColumns` folds the totals options in, so a single
   *  `requestViewport` triggers re-synthesis on the reply. Also
   *  rebuilds the subgrid stack + recomputes the viewport upfront
   *  because `pivotGrandTotals` can toggle the TotalsSubgrid in/out
   *  of the stack (when pivot is active). */
  updateTotalsOption(): void {
    if (this.deps.isDestroyed()) return;
    this.deps.rebuildSubgridStack();
    this.deps.recomputeViewport();
    this.deps.requestViewport();
  }

  // ── Chunk-arrival hook ────────────────────────────────────────────────────

  /** Build the worker pivot model from the current pivot state. Returns
   *  an EMPTY model unless the pivot is active (mode on AND ≥1 pivot
   *  column AND ≥1 value column) — `pivotMode` itself is not part of
   *  the worker model, so an inactive pivot must surface as an empty
   *  model or the worker would keep cross-tabbing. */
  pivotWorkerModel(): PivotModel {
    if (!this.state.isPivotActive()) return { pivotColIds: [], valueCols: [] };
    return {
      pivotColIds: this.state.getPivotColumns(),
      valueCols: this.state.getValueColumns().map((v) => ({ colId: v.colId, aggFunc: v.aggFunc })),
    };
  }

  /** Install / drop the synthesized pivot result columns based on the
   *  freshly-arrived chunk. Re-synthesizes only when the distinct-key
   *  set or value columns changed (cheap signature compare) so steady-
   *  state scrolls don't churn the column tree. */
  maybeSyncPivotColumns(chunk: ViewportChunk): void {
    const active = this.state.isPivotActive() && chunk.pivotColumnTree !== undefined;
    if (active) {
      const opts = this.deps.getOptions();
      const signature = JSON.stringify({
        // pivotRowTotals + pivotColumnGroupTotals are inputs to
        // synthesis; folding them into the signature so a runtime
        // swap re-synthesizes (without this, the cached pivot tree
        // would paint without the totals column).
        rowTotals: opts.pivotRowTotals ?? null,
        colGroupTotals: opts.pivotColumnGroupTotals ?? null,
        defaultExpanded: opts.pivotDefaultExpanded ?? null,
        grandTotals: opts.pivotGrandTotals === true,
        leaves: chunk.pivotLeafPaths ?? [],
        vals: this.state.getValueColumns(),
      });
      if (!this.active || signature !== this.treeSignature) {
        this.treeSignature = signature;
        this.applyPivotColumns(chunk.pivotColumnTree!);
      }
    } else if (this.active) {
      this.revertPivotColumns();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  destroy(): void {
    this.unsubscribe();
    this.state.destroy();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** React to any pivot state mutation. Refresh the worker's column
   *  metadata (so pivot/value fields survive the primaries being
   *  hidden), install the model, then request a viewport — the chunk
   *  reply carries the pivot tree + values and `maybeSyncPivotColumns`
   *  (re)synthesizes the secondary columns. */
  private handleStateChanged(e: PivotStateChangedEvent): void {
    if (this.deps.isDestroyed()) return;
    // Task 5b — pivot-mode toggle drives the AG-v36 auto-hide-primaries
    // pass. Detects the transition off the tracked `prevPivotMode` so
    // pivot/value column mutations (which fire the same event) don't
    // re-hide primaries. Runs BEFORE the `pivotStateChanged` fanout so
    // subscribers that read `columnVisible` state (columns panel checks,
    // status bar column counts) see the flipped hide flags on arrival.
    if (e.pivotMode !== this.prevPivotMode) {
      this.prevPivotMode = e.pivotMode;
      this.applyPivotModeVisibility(e.pivotMode);
    }
    // Fan the change out as a public event so the columns tool panel +
    // pivot panel + context menu keep their views over PivotState in
    // sync. Fire BEFORE the worker round-trip so subscribers can
    // repaint optimistically — the chunk reply that lands a tick
    // later only matters for body cell values, not the pill / toggle
    // chrome these surfaces render from state.
    this.deps.events.emit({
      type: 'pivotStateChanged',
      pivotMode: e.pivotMode,
      pivotColumns: [...e.pivotColumns],
      valueColumns: e.valueColumns.map((v) => ({ ...v })),
      source: e.source,
    });
    // Fan out to the pivot panel host (when mounted) so its pill strip
    // + onlyWhenPivoting paint state stay in sync. Pills mirror
    // `pivotColumns`; the active flag toggles whether 'onlyWhenPivoting'
    // paints content.
    const panel = this.deps.getPivotPanel();
    if (panel) {
      panel.setPivotColumns(e.pivotColumns);
      panel.setPivotActive(this.state.isPivotActive());
    }
    // When pivot was synthesised but the new state would produce no
    // chunk (every pivot/value role removed at runtime), revert
    // BEFORE the worker round-trip. Otherwise `workerColumns()` would
    // ship the stale `pivotcol…` colIds the worker doesn't know
    // about, the next `getViewport` would throw on `col.field`, and
    // the grid would stay painted with the old pivot matrix.
    if (this.active && !this.state.isPivotActive()) {
      this.revertPivotColumns();
    } else if (this.state.isPivotMode() && !this.active) {
      // Pivot mode is on but pivot is inactive — rebuild the visible
      // column order so the pivot-mode role filter in
      // `computeVisibleColumnOrder` re-evaluates each source column's
      // role membership. Without this, unchecking a value column
      // AFTER pivot already went inactive leaves it stale in
      // `columnOrder` and the painter keeps drawing it.
      const order = this.deps.computeVisibleColumnOrder();
      this.deps.setColumnOrder(order);
      this.deps.setColumnLayout(
        resolveColumnWidths(order, this.deps.getLayoutWidth()),
      );
      this.deps.rebuildSubgridStack();
      this.deps.recomputeViewport();
      this.deps.requestRepaint();
    }
    // Pivot mode flip re-evaluates the split-strip layout (AG-Grid
    // parity). Hosts only call `setReservedSpace` when their own
    // visibility changes; with `pivotPanelShow: 'always'` neither
    // host's visibility moves, so the split toggle wouldn't otherwise
    // re-apply.
    this.deps.applyVerticalInsets();
    this.deps.updateWorkerColumns(this.deps.workerColumns())
      .then(() => this.deps.setWorkerPivotModel(this.pivotWorkerModel()))
      .then(() => {
        if (this.deps.isDestroyed()) return;
        this.deps.requestViewport();
      })
      .catch((err) => { if (!this.deps.isDestroyed()) console.error('[velocity-grid]', err); });
  }

  /** Task 5b — apply the AG-v36 "primaries auto-hide under pivot mode"
   *  invariant. On flip ON: snapshot every primary leaf's current
   *  `def.hide` and hide those currently visible. On flip OFF: restore
   *  the snapshot, un-hiding leaves that were pre-pivot visible. The
   *  primary tree source depends on pivot activation state — while
   *  active the live tree carries synthesized pivot leaves, so we
   *  consult the saved `primaryColumnTree`; while inactive the live
   *  tree IS the primary tree. Routing hide flips through
   *  `deps.setColumnsVisible` reuses the existing `columnVisible`
   *  event + worker updateColumns roundtrip, keeping downstream
   *  consumers (columns panel, status bar) in sync via a single seam. */
  private applyPivotModeVisibility(enteringPivot: boolean): void {
    if (enteringPivot) {
      const primaryTree = this.primaryColumnTree ?? this.deps.getColumnTree();
      const toHide: string[] = [];
      for (const leaf of primaryTree.leaves) {
        this.preservedPrimaryHide.set(leaf.colId, leaf.hide === true);
        if (leaf.hide !== true) toHide.push(leaf.colId);
      }
      if (toHide.length > 0) this.deps.setColumnsVisible(toHide, false);
      return;
    }
    // Exit: any primary that was VISIBLE pre-pivot needs restoring.
    // Pre-hidden leaves stay hidden — `setColumnsVisible` is a no-op
    // when the target `hide` already matches.
    const toShow: string[] = [];
    for (const [colId, wasHidden] of this.preservedPrimaryHide) {
      if (!wasHidden) toShow.push(colId);
    }
    this.preservedPrimaryHide.clear();
    if (toShow.length > 0) this.deps.setColumnsVisible(toShow, true);
  }

  /** Swap the column tree to the synthesized pivot tree: pivot levels
   *  become column groups (`HeaderGroupSubgrid` renders them verbatim),
   *  the primary data columns drop out, and the auto-group column is
   *  kept as the row-dim axis. */
  /**
   * A new cross-tab shape arrived. Record it and re-resolve — the resolve
   * builds the pivot tree as stage 4, from the same primary leaves the
   * non-pivot path uses.
   *
   * This used to synthesize a tree, stash the primary one, swap both column
   * maps, rebuild the group state and re-run layout itself. That parallel
   * path is what a column rebuild could silently overwrite (leaving pivot
   * mode ON with source columns painted), and what kept formatting out of
   * pivot cells. There is now only one path.
   */
  private applyPivotColumns(keyTree: import('../worker/passes/pivotPass').PivotKeyNode[]): void {
    this.lastKeyTree = keyTree;
    this.deps.rebuildColumns();
    this.deps.requestViewport();
    this.deps.requestRepaint();
  }

  /** Deactivate pivot. Re-fetches a viewport too, because the current chunk
   *  carries pivot values rather than primary column data. */
  private revertPivotColumns(): void {
    if (!this.active) return;
    // Nothing to restore: the primary tree is recomputed by every resolve, so
    // dropping the projection is the whole of deactivation.
    this.lastKeyTree = null;
    this.treeSignature = '';
    this.deps.rebuildColumns();
    this.deps.requestViewport();
    this.deps.requestRepaint();
  }
}
