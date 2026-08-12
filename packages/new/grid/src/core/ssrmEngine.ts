/**
 * Unified server-side row model engine (SPEC.md collapse target #1).
 *
 * Legacy shipped two controllers picked by duck-typing `getGroupSkeleton` on
 * the datasource: `serverSideRowModel.ts` (flat blocks, server owns the tree)
 * and `serverSideRowModelV2.ts` (client owns a group skeleton, sparse leaf
 * caches). They shared roughly half their code by copy — op chain, generation
 * guard, block loading, field-merge, contiguous-run hydrate — and diverged in
 * a handful of genuinely different policies.
 *
 * This engine keeps one implementation of the shared machinery and makes the
 * divergences explicit:
 *
 *  - **One block substrate.** `caches: partition -> blockIndex -> Block`. Flat
 *    mode uses the single `''` partition; skeleton mode uses one partition per
 *    group key.
 *  - **One row plan.** A {@link RowPlan} maps display rows to slots. Flat mode
 *    installs a degenerate plan whose slots are `leaf` entries over the `''`
 *    partition, so `ensureRange` / `hydrateRange` / `materialize` have a single
 *    implementation instead of a grouped path and a flat path.
 *  - **One policy table.** {@link SsrmModeProfile} names every behavioural
 *    difference the two controllers actually had, so choosing a mode is a
 *    typed decision rather than a remembered one.
 *
 * Differences preserved verbatim (SPEC.md §2): flat-blocks purges every block
 * on expansion refresh (the flash) while skeleton-sparse reflows its flatten
 * index locally in the same frame; flat-blocks supports add/update/remove
 * transactions while skeleton-sparse is update-only and warns otherwise;
 * skeleton-sparse refuses `ensureFullyHydrated` when grouped; skeleton-sparse
 * keeps per-group leaf caches under LRU eviction and has the `refillColumnKeys`
 * field-merge path for horizontal scroll. The `expansionDrifted()` guard, the
 * soft-refresh conflation, and the field-merge on partial payloads (thin ticks
 * wipe columns without it) are shared and mandatory.
 */

import type { FilterModel, SortModel } from '../types';
import type {
  IServerSideDatasource,
  IServerSideDatasourceV2,
  LoadSuccessParams,
  RefreshServerSideParams,
  ServerSideTransaction,
  SkeletonGroup,
} from '../types/ssrm';
import { attachSsrmRowMeta, readSsrmRowMeta } from './ssrmRowMeta';
import {
  FlattenIndex,
  toDisplayOrder,
  extractRootAggregates,
  type FlattenEntry,
  type SkeletonNode,
} from './ssrmFlattenIndex';

export const SSRM_GROUP_ROW_ID_PREFIX = '__grp__';
export const SSRM_FOOTER_ROW_ID_PREFIX = '__footer__';
export const SSRM_GRAND_TOTAL_ROW_ID = '__grand_total__';

/** Partition key for the flat (ungrouped) block cache. */
const FLAT_PARTITION = '';

// ─── host seam ─────────────────────────────────────────────────────────────

export interface SsrmHost<TRow> {
  getRowId(row: TRow): string;
  getSortModel(): SortModel;
  getFilterModel(): FilterModel;
  getRowGroupCols(): string[];
  getGroupKeys(): string[];
  getExpandedGroupKeys(): string[];
  /**
   * Optional column projection for getRows / getLeafRows. When omitted or
   * empty, datasources return full rows (legacy behaviour).
   */
  getColumnKeys?(): string[] | undefined;
  mergeGroupKeys?(keys: string[]): void;
  setRowCount(count: number, prevCount?: number): void;
  /** Row range to reload on soft refresh — typically the current viewport overscan. */
  getRefreshRange?(): { rowStart: number; rowEnd: number };
  /** Sparse hydrate into the worker — rows cover [startRow, startRow+rows.length). */
  hydrateWindow(startRow: number, rows: TRow[], rowCount: number, reset?: boolean): Promise<void>;
  /** Patch rows already present in the worker store (live ticks). */
  applyTransaction(tx: {
    add?: TRow[];
    update?: TRow[];
    remove?: TRow[];
  }): void;
  requestViewport(): void;
  isDestroyed(): boolean;
}

/** Skeleton-sparse host — flat seam plus exact-group-key replacement. */
export interface SsrmHostV2<TRow> extends SsrmHost<TRow> {
  /** Replace (not merge) the known composite group keys from the skeleton. */
  setGroupKeys?(keys: string[]): void;
  /** Install host-computed grand totals (skeleton root aggregates, keyed
   *  by FIELD) in the worker — drives the pinned totals subgrid and the
   *  in-scroll grand-total footer. `null` clears. */
  setGrandTotals?(totals: Record<string, unknown> | null): void;
}

// ─── modes ─────────────────────────────────────────────────────────────────

/**
 * `flat-blocks`             — server owns grouping; blocks span the flattened
 *                             book; expansion is a server round trip.
 * `skeleton-sparse`         — client owns the group skeleton; leaves cached
 *                             per group; expansion is a local reflow.
 * `client-pipeline-bridge`  — flat blocks fully hydrated into the worker so the
 *                             CSRM pipeline (group/pivot/sort/filter) can run
 *                             over the whole book.
 */
export type SsrmMode = 'flat-blocks' | 'skeleton-sparse' | 'client-pipeline-bridge';

/** Every behavioural difference the two legacy controllers actually had. */
interface SsrmModeProfile {
  /** Client owns the group tree (skeleton + FlattenIndex). */
  readonly ownsGroupSkeleton: boolean;
  /** Expansion refresh drops every cached block (flash) vs reflows locally. */
  readonly expansion: 'purge-all' | 'local-reflow';
  /** Transaction support. `update-only` warns on add/remove/rowCount. */
  readonly transactions: 'add-update-remove' | 'update-only';
  /** `ensureFullyHydrated` policy. */
  readonly fullHydrate: 'always' | 'refuse-when-grouped';
  /** Send the live grouping/expansion state on `getRows` (server-side grouping). */
  readonly serverSideGrouping: boolean;
  /** Adopt rowCount inside load success and invalidate stale sibling blocks. */
  readonly rowCountFromLoad: 'immediate-with-invalidation' | 'deferred';
  /** LRU-evict cached leaf blocks past `maxCachedLeafBlocks`. */
  readonly leafLru: boolean;
  /** Skip the worker round trip when the window identity is unchanged. */
  readonly windowIdentitySuppression: boolean;
  /** Delay the next soft refresh by the moving average of recent durations. */
  readonly adaptiveSoftRefreshPacing: boolean;
  /** Stamp `__ssrm` meta (kind/depth/label) onto materialized rows. */
  readonly attachRowMeta: boolean;
}

const MODE_PROFILES: Record<SsrmMode, SsrmModeProfile> = {
  'flat-blocks': {
    ownsGroupSkeleton: false,
    expansion: 'purge-all',
    transactions: 'add-update-remove',
    fullHydrate: 'always',
    serverSideGrouping: true,
    rowCountFromLoad: 'immediate-with-invalidation',
    leafLru: false,
    windowIdentitySuppression: false,
    adaptiveSoftRefreshPacing: false,
    attachRowMeta: false,
  },
  'skeleton-sparse': {
    ownsGroupSkeleton: true,
    expansion: 'local-reflow',
    transactions: 'update-only',
    fullHydrate: 'refuse-when-grouped',
    serverSideGrouping: false,
    rowCountFromLoad: 'deferred',
    leafLru: true,
    windowIdentitySuppression: true,
    adaptiveSoftRefreshPacing: true,
    attachRowMeta: true,
  },
  'client-pipeline-bridge': {
    ownsGroupSkeleton: false,
    expansion: 'purge-all',
    transactions: 'add-update-remove',
    fullHydrate: 'always',
    serverSideGrouping: true,
    rowCountFromLoad: 'immediate-with-invalidation',
    leafLru: false,
    windowIdentitySuppression: false,
    adaptiveSoftRefreshPacing: false,
    attachRowMeta: false,
  },
};

export interface SsrmEngineOptions {
  mode: SsrmMode;
  /** Required by skeleton-sparse to stamp synthesized group/footer row ids. */
  rowIdField?: string;
  cacheBlockSize?: number;
  maxConcurrentDatasourceRequests?: number;
  maxCachedLeafBlocks?: number;
  /** In-scroll per-group total rows (AG `groupTotalRow`). */
  groupTotalRow?: 'top' | 'bottom' | null;
  /** In-scroll grand-total row (AG `grandTotalRow` 'top'|'bottom' — pinned
   *  variants ride the totals subgrid, not the index). */
  grandTotalRow?: 'top' | 'bottom' | null;
  /** AG `groupMaintainOrder` — pin skeleton sibling order across refetches. */
  maintainOrder?: boolean;
}

// ─── block substrate ───────────────────────────────────────────────────────

interface Block<TRow> {
  rows: TRow[];
  state: 'loading' | 'loaded' | 'failed';
  /** LRU clock — larger = touched more recently. */
  touch: number;
}

/**
 * Display-row plan. Flat mode installs {@link FlatPlan} so the grouped and
 * ungrouped paths share one range/hydrate implementation.
 */
interface RowPlan {
  readonly rowCount: number;
  /** Slots covering display rows [start, end). */
  entriesInRange(start: number, end: number): FlattenEntry[];
  /** Group rows at indices above `start` (sticky ancestor chain). */
  ancestorsOf(start: number): Array<{ index: number; node: SkeletonNode }>;
}

/**
 * Degenerate plan for ungrouped books: display row `i` is leaf `i` of the
 * single `''` partition. Lets flat mode reuse the skeleton assembly code.
 */
class FlatPlan implements RowPlan {
  readonly node: SkeletonNode;

  constructor(public readonly rowCount: number) {
    this.node = {
      key: FLAT_PARTITION,
      path: [],
      depth: 0,
      leafCount: rowCount,
      aggregates: {},
    } as SkeletonNode;
  }

  entriesInRange(start: number, end: number): FlattenEntry[] {
    const out: FlattenEntry[] = [];
    for (let i = start; i < end; i++) {
      out.push({ kind: 'leaf', node: this.node, leafOffset: i } as FlattenEntry);
    }
    return out;
  }

  ancestorsOf(): Array<{ index: number; node: SkeletonNode }> {
    return [];
  }
}

/** Union of the two datasource shapes; the profile decides which calls fire. */
type AnyDatasource<TRow> = IServerSideDatasource<TRow> & Partial<IServerSideDatasourceV2<TRow>>;

/**
 * One SSRM engine. Behaviour is selected by {@link SsrmMode}; every difference
 * between the legacy V1 and V2 controllers is a named field on
 * {@link SsrmModeProfile} rather than a separate class.
 */
export class SsrmEngine<TRow = any> {
  private readonly profile: SsrmModeProfile;
  private datasource: AnyDatasource<TRow> | null = null;

  /** partition key -> block index -> block. `''` is the flat partition. */
  private readonly caches = new Map<string, Map<number, Block<TRow>>>();
  private touchClock = 0;
  /** Bumped on ANY cache content change — part of the hydrate signature so
   *  unchanged windows skip the worker round trip entirely. */
  private cacheEpoch = 0;

  /** Display-ordered skeleton; null until fetched (skeleton-sparse only). */
  private skeleton: SkeletonNode[] | null = null;
  /** Synthesized base group rows (aggregates + stamped row id), by key. */
  private readonly groupBaseRows = new Map<string, TRow>();
  private index: RowPlan | null = null;
  /** Expansion snapshot the current index was built from. */
  private lastExpanded: ReadonlySet<string> = new Set();
  /** Previous display position by key — pins sibling order across skeleton
   *  refetches when `maintainOrder` is on. */
  private prevOrder: Map<string, number> | null = null;

  /** Row total reported by the server for the flat partition. */
  private flatRowCount = 0;
  private reportedRowCount = 0;

  /** Bumped on purge (sort/filter/groupBy/datasource change) — results from an
   *  older generation are discarded. Expansion changes do NOT bump it: leaf
   *  data is expansion-independent. */
  private generation = 0;
  private inflight = 0;
  private chain: Promise<void> = Promise.resolve();
  /** Block indices with an outstanding load, per partition. */
  private readonly pending = new Set<string>();

  /** Identity of the last hydrated window; matching state = no-op. */
  private lastHydrate: {
    start: number;
    end: number;
    index: RowPlan | null;
    generation: number;
    cacheEpoch: number;
  } | null = null;

  /** Conflation handle — at most one QUEUED soft refresh at a time. */
  private pendingSoftRefresh: Promise<void> | null = null;
  /** Last 5 soft-refresh durations (ms) — the pacing signal. */
  private readonly softRefreshDurations: number[] = [];
  private lastSoftRefreshEnd = 0;
  private warnedUnsupportedTx = false;

  private readonly blockSize: number;
  private readonly maxConcurrent: number;
  private readonly maxCachedLeafBlocks: number;
  private readonly rowIdField: string;
  private readonly groupTotalRow: 'top' | 'bottom' | null;
  private readonly grandTotalRow: 'top' | 'bottom' | null;
  private readonly maintainOrder: boolean;

  constructor(
    private readonly host: SsrmHostV2<TRow>,
    opts: SsrmEngineOptions,
  ) {
    this.profile = MODE_PROFILES[opts.mode];
    this.rowIdField = opts.rowIdField ?? 'id';
    this.blockSize = Math.max(1, opts.cacheBlockSize ?? 100);
    this.maxConcurrent = Math.max(1, opts.maxConcurrentDatasourceRequests ?? 2);
    this.maxCachedLeafBlocks = Math.max(8, opts.maxCachedLeafBlocks ?? 500);
    this.groupTotalRow = opts.groupTotalRow ?? null;
    this.grandTotalRow = opts.grandTotalRow ?? null;
    this.maintainOrder = opts.maintainOrder === true;
  }

  // ─── public surface ──────────────────────────────────────────────────

  setDatasource(ds: AnyDatasource<TRow> | null): void {
    this.datasource?.destroy?.();
    this.datasource = ds;
    void this.refresh({ purge: true });
  }

  getRowCount(): number {
    return this.reportedRowCount;
  }

  ensureRange(rowStart: number, rowEnd: number): Promise<void> {
    return this.enqueue(() => this.ensureRangeInner(rowStart, rowEnd));
  }

  /**
   * Load the whole book and reset-hydrate the worker so the CSRM pipeline can
   * run over it. Resolves false only when the mode refuses (skeleton-sparse is
   * natively sparse — there is nothing to fully hydrate while grouped, and
   * hydrating would silently drop the tree).
   */
  async ensureFullyHydrated(): Promise<boolean> {
    if (this.profile.fullHydrate === 'refuse-when-grouped' && this.grouped()) {
      console.warn('[velocity-grid] SSRM v2: ensureFullyHydrated is unsupported while grouped — the skeleton path serves grouping natively');
      return false;
    }
    await this.enqueue(() => this.ensureFullyHydratedInner());
    return true;
  }

  /**
   * Horizontal column-window refill — re-fetch the viewport band with the
   * latest `columnKeys` and field-merge onto cached rows. Does NOT drop blocks
   * first (that blanked the canvas and caused black voids / flicker during
   * H-scroll). Does NOT bump the generation / purge the skeleton.
   */
  refillColumnKeys(): Promise<void> {
    return this.enqueue(async () => {
      if (this.host.isDestroyed()) return;
      const band = this.refreshBand();
      const gen = this.generation;
      await this.forceReloadBand(band.rowStart, band.rowEnd, gen);
      if (gen !== this.generation || this.host.isDestroyed()) return;
      // Invalidate hydrate signature so the band re-pushes to the worker.
      this.lastHydrate = null;
      this.cacheEpoch++;
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (this.host.isDestroyed()) return;
      this.host.requestViewport();
    });
  }

  refresh(params: RefreshServerSideParams = {}): Promise<void> {
    // Conflate soft refreshes: live ticks can arrive faster than a refresh
    // completes, and queuing one op per tick grows the chain without bound —
    // refreshes lag ever further behind and anything queued later (a purge, an
    // expansion toggle) waits out the whole backlog. While one soft refresh is
    // QUEUED, later ticks ride it; the handle clears when the op starts so
    // ticks landing mid-run coalesce into exactly one follow-up.
    const soft = params.purge === false;
    if (soft && this.pendingSoftRefresh !== null) {
      return this.pendingSoftRefresh;
    }
    if (!soft) {
      return this.enqueue(() => this.refreshInner(params));
    }

    let p: Promise<void> | null = null;
    const run = (): Promise<void> => this.enqueue(async () => {
      if (this.pendingSoftRefresh === p) this.pendingSoftRefresh = null;
      if (!this.profile.adaptiveSoftRefreshPacing) {
        await this.refreshInner(params);
        return;
      }
      const t0 = Date.now();
      try {
        await this.refreshInner(params);
      } finally {
        this.lastSoftRefreshEnd = Date.now();
        this.softRefreshDurations.push(this.lastSoftRefreshEnd - t0);
        if (this.softRefreshDurations.length > 5) this.softRefreshDurations.shift();
      }
    });

    if (!this.profile.adaptiveSoftRefreshPacing) {
      p = run();
      this.pendingSoftRefresh = p;
      return p;
    }
    // Adaptive pacing — the cadence self-tunes to what the datasource
    // actually sustains instead of hammering it every tick.
    const wait = Math.max(0, this.lastSoftRefreshEnd + this.softRefreshAvgMs() - Date.now());
    p = wait > 16
      ? new Promise<void>((resolve, reject) => {
          setTimeout(() => { run().then(resolve, reject); }, wait);
        })
      : run();
    this.pendingSoftRefresh = p;
    return p;
  }

  /**
   * Expansion toggle. `local-reflow` paints the new shape in the same frame
   * (no round trip, no purge flash) and then fills missing leaves on the op
   * chain; `purge-all` drops every cached block because an expand/collapse
   * shifts the flattened index of every row below the toggled group.
   */
  refreshExpansion(): Promise<void> {
    if (this.profile.expansion === 'local-reflow'
      && this.grouped()
      && this.skeleton !== null
      && !this.host.isDestroyed()
    ) {
      this.rebuildIndex();
      const band = this.refreshBand();
      void this.hydrateRange(band.rowStart, band.rowEnd).then(() => {
        if (!this.host.isDestroyed()) this.host.requestViewport();
      });
    }
    return this.enqueue(() => this.refreshExpansionInner());
  }

  /**
   * All descendant leaf row-ids under `groupKey` (any depth) via the
   * datasource's optional `getGroupLeafIds`. Returns null when the datasource
   * doesn't implement it or the group is unknown. Feeds the selection
   * descendant cache so group-checkbox cascade works on the sparse path.
   */
  fetchGroupLeafIds(groupKey: string): Promise<string[] | null> {
    const ds = this.datasource;
    if (!ds?.getGroupLeafIds || this.skeleton === null) return Promise.resolve(null);
    const node = this.skeleton.find((n) => n.key === groupKey);
    if (!node) return Promise.resolve(null);
    return new Promise((resolve) => {
      ds.getGroupLeafIds!({
        request: {
          groupPath: node.path.slice(),
          sortModel: this.host.getSortModel(),
          filterModel: this.host.getFilterModel(),
          rowGroupCols: this.host.getRowGroupCols(),
        },
        success: (result) => resolve(result.ids ?? []),
        fail: () => resolve(null),
      });
    });
  }

  applyServerSideTransaction(tx: ServerSideTransaction<TRow>): void {
    if (this.profile.transactions === 'update-only') {
      this.applyUpdateOnlyTransaction(tx);
      return;
    }
    this.applyStructuralTransaction(tx);
  }

  destroy(): void {
    this.datasource?.destroy?.();
    this.datasource = null;
    this.generation++;
    this.skeleton = null;
    this.index = null;
    this.groupBaseRows.clear();
    this.caches.clear();
    this.pending.clear();
  }

  // ─── transactions ────────────────────────────────────────────────────

  /** Skeleton-sparse: add/remove/rowCount are structural — only `update`
   *  patches in place, and it field-merges so thin ticks keep columns. */
  private applyUpdateOnlyTransaction(tx: ServerSideTransaction<TRow>): void {
    if ((tx.add?.length || tx.remove?.length || tx.rowCount !== undefined) && !this.warnedUnsupportedTx) {
      this.warnedUnsupportedTx = true;
      console.warn('[velocity-grid] SSRM v2: transaction add/remove/rowCount are structural — use refreshServerSide({ purge: false }) so the skeleton re-syncs; only `update` patches in place');
    }
    if (tx.update?.length) {
      const updatesById = new Map<string, TRow>();
      for (const row of tx.update) {
        try {
          updatesById.set(this.host.getRowId(row), row);
        } catch { /* skip */ }
      }
      // Rows as stored after the patch, keyed by id — the worker REPLACES by
      // id, so updates must carry the cached row's __ssrm meta or leaf
      // depth/kind is stripped and the row paints unindented.
      const patched = new Map<string, TRow>();
      for (const cache of this.caches.values()) {
        for (const block of cache.values()) {
          // 'failed' blocks keep partial rows that DO paint — ticks must reach
          // them too, not just fully loaded blocks.
          if (block.state === 'loading') continue;
          for (let i = 0; i < block.rows.length; i++) {
            let id = '';
            try {
              id = this.host.getRowId(block.rows[i]!);
            } catch {
              continue;
            }
            const next = updatesById.get(id);
            if (next === undefined) continue;
            const prevRow = block.rows[i]!;
            // Field-merge so thin/partial tick payloads don't wipe columns.
            const mergedFields = {
              ...(prevRow as Record<string, unknown>),
              ...(next as Record<string, unknown>),
            } as TRow;
            const prevMeta = readSsrmRowMeta(prevRow);
            const merged = prevMeta && !readSsrmRowMeta(mergedFields)
              ? attachSsrmRowMeta(mergedFields as Record<string, unknown>, prevMeta) as TRow
              : mergedFields;
            block.rows[i] = merged;
            patched.set(id, merged);
          }
        }
      }
      this.cacheEpoch++;
      const updates = tx.update.map((row) => {
        try {
          return patched.get(this.host.getRowId(row)) ?? row;
        } catch {
          return row;
        }
      });
      this.host.applyTransaction({ update: updates });
    }
    this.host.requestViewport();
  }

  /** Flat-blocks: the server owns the tree, so add/update/remove all apply. */
  private applyStructuralTransaction(tx: ServerSideTransaction<TRow>): void {
    if (tx.rowCount !== undefined) {
      const prev = this.reportedRowCount;
      this.reportedRowCount = Math.max(0, tx.rowCount);
      this.flatRowCount = this.reportedRowCount;
      this.host.setRowCount(this.reportedRowCount, prev);
    }

    if (tx.update?.length || tx.remove?.length) {
      const removeIds = new Set(
        (tx.remove ?? []).map((r) => {
          try { return this.host.getRowId(r); } catch { return ''; }
        }).filter(Boolean),
      );
      const updatesById = new Map<string, TRow>();
      for (const row of tx.update ?? []) {
        try { updatesById.set(this.host.getRowId(row), row); } catch { /* skip */ }
      }

      for (const cache of this.caches.values()) {
        for (const block of cache.values()) {
          if (block.state !== 'loaded') continue;
          for (let i = 0; i < block.rows.length; i++) {
            const row = block.rows[i]!;
            let id = '';
            try { id = this.host.getRowId(row); } catch { continue; }
            if (removeIds.has(id)) continue;
            const next = updatesById.get(id);
            if (next) block.rows[i] = next;
          }
        }
      }
    }

    this.host.applyTransaction({
      add: tx.add,
      update: tx.update,
      remove: tx.remove,
    });
    this.host.requestViewport();
  }

  // ─── op serialization ────────────────────────────────────────────────

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op, op);
    // Keep the chain alive even if an op fails.
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  private waitUntil(pred: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const tick = (): void => {
        if (pred()) resolve();
        else setTimeout(tick, 4);
      };
      tick();
    });
  }

  /** Moving average of recent soft-refresh cost, capped at 2s. */
  private softRefreshAvgMs(): number {
    const d = this.softRefreshDurations;
    if (d.length === 0) return 0;
    let sum = 0;
    for (const v of d) sum += v;
    return Math.min(2000, sum / d.length);
  }

  private grouped(): boolean {
    return this.host.getRowGroupCols().length > 0;
  }

  /** True when the client owns the tree AND the book is grouped. */
  private skeletonActive(): boolean {
    return this.profile.ownsGroupSkeleton && this.grouped();
  }

  private refreshBand(): { rowStart: number; rowEnd: number } {
    const r = this.host.getRefreshRange?.();
    if (!r || r.rowEnd <= r.rowStart) return { rowStart: 0, rowEnd: this.blockSize };
    return r;
  }

  // ─── refresh flows ───────────────────────────────────────────────────

  private async refreshInner(params: RefreshServerSideParams): Promise<void> {
    if (this.host.isDestroyed()) return;

    if (params.purge !== false) {
      this.generation++;
      this.skeleton = null;
      this.index = null;
      this.groupBaseRows.clear();
      this.caches.clear();
      this.pending.clear();
      this.cacheEpoch++;
      this.flatRowCount = 0;
      this.lastHydrate = null;
      if (this.profile.ownsGroupSkeleton) this.host.setGrandTotals?.(null);
      // Await reset so it cannot land after a subsequent data hydrate.
      await this.host.hydrateWindow(0, [], Math.max(this.reportedRowCount, 0), true);
      if (this.host.isDestroyed()) return;
      const gen = this.generation;
      const band = this.profile.ownsGroupSkeleton
        ? this.refreshBand()
        // Always pull at least the first block — viewport may still be
        // 0-height on the first paint of a flex panel.
        : { rowStart: 0, rowEnd: this.blockSize };
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (gen !== this.generation || this.host.isDestroyed()) return;
      this.host.requestViewport();
      return;
    }

    // Soft refresh — live tick. Keep painted rows on screen while reloading
    // (drop-then-fetch blanked the band → black voids during scroll + ticks).
    const gen = this.generation;
    const band = this.refreshBand();
    if (this.skeletonActive()) {
      const groups = await this.fetchSkeletonRaw();
      if (gen !== this.generation || this.host.isDestroyed()) return;
      if (groups !== null) this.ingestSkeleton(groups, /* soft */ true);
    }
    await this.forceReloadBand(band.rowStart, band.rowEnd, gen);
    if (gen !== this.generation || this.host.isDestroyed()) return;
    this.lastHydrate = null;
    this.cacheEpoch++;
    await this.ensureRangeInner(band.rowStart, band.rowEnd);
    if (gen !== this.generation || this.host.isDestroyed()) return;
    this.host.requestViewport();
  }

  private async refreshExpansionInner(): Promise<void> {
    if (this.host.isDestroyed()) return;

    if (this.profile.expansion === 'purge-all') {
      // An expand/collapse shifts the flattened index of every row below the
      // toggled group, so every cached block is suspect — drop the whole
      // cache (not just the viewport band), then refetch the band. Rows keep
      // painting until the new data lands (no purge flash from a reset).
      const gen = ++this.generation;
      this.caches.clear();
      this.pending.clear();
      this.cacheEpoch++;
      this.lastHydrate = null;
      const band = this.refreshBand();
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (gen !== this.generation || this.host.isDestroyed()) return;
      this.host.requestViewport();
      return;
    }

    if (!this.skeletonActive() || this.skeleton === null) {
      // No skeleton yet — the ensureRange path builds it with the current
      // expansion state anyway.
      const band = this.refreshBand();
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (!this.host.isDestroyed()) this.host.requestViewport();
      return;
    }
    // Local reflow — same frame, no datasource involvement.
    this.rebuildIndex();
    const band = this.refreshBand();
    // Paint what we already have (all group rows + cached leaves) before any
    // fetch: collapse renders complete instantly; expand shows group rows and
    // fills leaves as they land.
    await this.hydrateRange(band.rowStart, band.rowEnd);
    if (this.host.isDestroyed()) return;
    this.host.requestViewport();
    // Fill missing leaf blocks, then re-paint.
    await this.ensureRangeInner(band.rowStart, band.rowEnd);
    if (this.host.isDestroyed()) return;
    this.host.requestViewport();
  }

  private async ensureFullyHydratedInner(): Promise<void> {
    if (this.host.isDestroyed()) return;
    if (this.flatRowCount <= 0) {
      await this.ensureRangeInner(0, this.blockSize);
    }
    if (this.host.isDestroyed() || this.flatRowCount <= 0) return;

    const gen = this.generation;
    await this.ensureRangeInner(0, this.flatRowCount);
    if (gen !== this.generation || this.host.isDestroyed()) return;

    const cache = this.caches.get(FLAT_PARTITION);
    const rows: TRow[] = [];
    for (let i = 0; i < this.flatRowCount; i++) {
      const row = cache?.get(Math.floor(i / this.blockSize))?.rows[i % this.blockSize];
      if (row === undefined) break;
      rows.push(row);
    }
    await this.host.hydrateWindow(0, rows, this.flatRowCount, true);
  }

  // ─── skeleton ────────────────────────────────────────────────────────

  private fetchSkeletonRaw(): Promise<SkeletonGroup[] | null> {
    const ds = this.datasource;
    if (!ds?.getGroupSkeleton) return Promise.resolve(null);
    return new Promise((resolve) => {
      ds.getGroupSkeleton!({
        request: {
          sortModel: this.host.getSortModel(),
          filterModel: this.host.getFilterModel(),
          rowGroupCols: this.host.getRowGroupCols(),
        },
        success: (result) => resolve(result.groups ?? []),
        fail: () => resolve(null),
      });
    });
  }

  /**
   * Install a fetched skeleton. On soft refresh, caches survive for groups
   * whose leafCount is unchanged (their leaf indices are stable); changed /
   * removed groups drop theirs.
   */
  private ingestSkeleton(groups: SkeletonGroup[], soft: boolean): void {
    const rowGroupCols = this.host.getRowGroupCols();
    const nodes = toDisplayOrder(
      groups,
      rowGroupCols,
      this.maintainOrder ? (this.prevOrder ?? undefined) : undefined,
    );
    if (this.maintainOrder) {
      this.prevOrder = new Map(nodes.map((n, i) => [n.key, i]));
    }
    // Grand totals from the skeleton's `path: []` root row — drives the
    // pinned totals subgrid and the in-scroll grand-total footer.
    this.host.setGrandTotals?.(extractRootAggregates(groups));

    if (soft && this.skeleton !== null) {
      const prevLeafCount = new Map<string, number>();
      for (const n of this.skeleton) prevLeafCount.set(n.key, n.leafCount);
      for (const n of nodes) {
        const prev = prevLeafCount.get(n.key);
        if (prev !== undefined && prev !== n.leafCount) this.dropPartition(n.key);
        prevLeafCount.delete(n.key);
      }
      for (const removedKey of prevLeafCount.keys()) this.dropPartition(removedKey);
    }

    this.skeleton = nodes;
    this.groupBaseRows.clear();
    for (const n of nodes) {
      this.groupBaseRows.set(n.key, {
        ...n.aggregates,
        [this.rowIdField]: `${SSRM_GROUP_ROW_ID_PREFIX}${n.key}`,
      } as TRow);
    }
    this.host.setGroupKeys?.(nodes.map((n) => n.key));
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    if (this.skeleton === null) return;
    const rowGroupCols = this.host.getRowGroupCols();
    const expanded = new Set(this.host.getExpandedGroupKeys());
    this.lastExpanded = expanded;
    this.index = new FlattenIndex(this.skeleton, expanded, rowGroupCols.length - 1, {
      groupTotalRow: this.groupTotalRow,
      grandTotalRow: this.grandTotalRow,
    });
    const prev = this.reportedRowCount;
    this.reportedRowCount = this.index.rowCount;
    this.host.setRowCount(this.reportedRowCount, prev);
  }

  /** True when the host's expansion set no longer matches the index — e.g. a
   *  scroll-driven ensureRange that landed between a toggle and its
   *  refreshExpansion op. Rebuilding here keeps assembly honest. */
  private expansionDrifted(): boolean {
    const cur = this.host.getExpandedGroupKeys();
    if (cur.length !== this.lastExpanded.size) return true;
    for (const k of cur) {
      if (!this.lastExpanded.has(k)) return true;
    }
    return false;
  }

  private dropPartition(key: string): void {
    if (!this.caches.delete(key)) return;
    this.cacheEpoch++;
  }

  // ─── range loading ───────────────────────────────────────────────────

  private async ensureRangeInner(rowStart: number, rowEnd: number): Promise<void> {
    if (!this.datasource || this.host.isDestroyed()) return;
    const gen = this.generation;

    if (this.skeletonActive()) {
      if (this.skeleton === null) {
        const groups = await this.fetchSkeletonRaw();
        if (gen !== this.generation || this.host.isDestroyed()) return;
        if (groups === null) return;
        this.ingestSkeleton(groups, false);
      } else if (this.index === null || this.expansionDrifted()) {
        this.rebuildIndex();
      }
    } else {
      // Flat book — the plan is rebuilt from the server's row total after the
      // blocks below land, so seed it if this is the first pass.
      if (this.index === null) this.index = new FlatPlan(this.flatRowCount);
    }

    const plan = this.index;
    if (!plan) return;

    const start = Math.max(0, Math.floor(rowStart));
    // A collapsed viewport (end <= start) still needs block 0 — either to
    // discover rowCount from the datasource or to paint a zero-height panel's
    // first frame.
    const end = this.skeletonActive()
      ? Math.min(plan.rowCount, Math.max(start, Math.ceil(rowEnd)))
      : Math.max(start + 1, Math.ceil(rowEnd));

    await this.loadSlotsForRange(start, end, gen);
    if (gen !== this.generation || this.host.isDestroyed()) return;

    if (!this.skeletonActive()) {
      // Adopt the server's total and re-plan before hydrating.
      const prev = this.reportedRowCount;
      if (this.flatRowCount !== prev) {
        this.reportedRowCount = this.flatRowCount;
        this.host.setRowCount(this.reportedRowCount, prev);
      }
      this.index = new FlatPlan(this.flatRowCount);
    }

    await this.hydrateRange(start, end);
  }

  /**
   * Fetch every block backing display rows [start, end). Fast scroll can
   * overlap ensureRange calls — always wait for `loading` blocks, otherwise
   * hydrate runs over empty slots and paints black voids.
   */
  private async loadSlotsForRange(start: number, end: number, gen: number): Promise<void> {
    const targets = this.blocksForRange(start, end);
    const missing: Array<{ node: SkeletonNode; blockIdx: number }> = [];
    const waiting: Array<Promise<void>> = [];

    for (const t of targets) {
      const cache = this.caches.get(t.node.key);
      const block = cache?.get(t.blockIdx);
      const tag = this.pendingTag(t.node.key, t.blockIdx);
      if (block?.state === 'loading' || this.pending.has(tag)) {
        waiting.push(this.waitUntil(
          () => (!this.pending.has(tag)
              && this.caches.get(t.node.key)?.get(t.blockIdx)?.state !== 'loading')
            || gen !== this.generation,
        ));
        continue;
      }
      if (!block || block.state === 'failed') {
        missing.push(t);
        continue;
      }
      // Empty "loaded" block from a pre-snapshot / empty-book reply — reload
      // once we believe rows exist (or always when the count is unknown).
      if (!this.skeletonActive()
        && block.state === 'loaded'
        && block.rows.length === 0
      ) {
        const blockStart = t.blockIdx * this.blockSize;
        if (this.flatRowCount === 0 || blockStart < this.flatRowCount) missing.push(t);
      }
    }

    if (missing.length > 0 || waiting.length > 0) {
      await Promise.all([
        ...missing.map((m) => this.loadBlock(m.node, m.blockIdx, gen)),
        ...waiting,
      ]);
    }
  }

  /** Distinct (partition, block) pairs backing display rows [start, end). */
  private blocksForRange(
    start: number,
    end: number,
  ): Array<{ node: SkeletonNode; blockIdx: number }> {
    const out: Array<{ node: SkeletonNode; blockIdx: number }> = [];
    const seen = new Set<string>();

    if (!this.skeletonActive()) {
      const node = (this.index as FlatPlan | null)?.node
        ?? new FlatPlan(this.flatRowCount).node;
      const first = Math.floor(Math.max(0, start) / this.blockSize);
      const last = Math.floor(Math.max(start, end - 1) / this.blockSize);
      for (let b = first; b <= last; b++) out.push({ node, blockIdx: b });
      return out;
    }

    const plan = this.index;
    if (!plan) return out;
    for (const entry of plan.entriesInRange(start, end)) {
      if (entry.kind !== 'leaf') continue;
      const blockIdx = Math.floor(entry.leafOffset / this.blockSize);
      const tag = this.pendingTag(entry.node.key, blockIdx);
      if (seen.has(tag)) continue;
      seen.add(tag);
      out.push({ node: entry.node, blockIdx });
    }
    return out;
  }

  private pendingTag(partition: string, blockIdx: number): string {
    return `${partition}\u0000${blockIdx}`;
  }

  private partition(key: string): Map<number, Block<TRow>> {
    let cache = this.caches.get(key);
    if (!cache) {
      cache = new Map();
      this.caches.set(key, cache);
    }
    return cache;
  }

  /** Re-fetch blocks in the band while keeping prior rows on screen. */
  private async forceReloadBand(rowStart: number, rowEnd: number, gen: number): Promise<void> {
    const targets = this.blocksForRange(rowStart, rowEnd);
    if (targets.length === 0) return;
    await Promise.all(targets.map((t) => this.loadBlock(t.node, t.blockIdx, gen, true)));
  }

  /**
   * Load one block. The request shape is the only place the modes diverge:
   * a skeleton partition asks `getLeafRows` for a group path, a flat partition
   * asks `getRows` — carrying the live grouping/expansion state only when the
   * server owns the tree.
   */
  private loadBlock(
    node: SkeletonNode,
    blockIdx: number,
    gen: number,
    force = false,
  ): Promise<void> {
    const ds = this.datasource;
    if (!ds) return Promise.resolve();
    const isLeafPartition = this.skeletonActive();
    const cache = this.partition(node.key);
    const tag = this.pendingTag(node.key, blockIdx);

    const existing = cache.get(blockIdx);
    if (existing?.state === 'loading' || this.pending.has(tag)) {
      return this.waitUntil(
        () => (!this.pending.has(tag) && cache.get(blockIdx)?.state !== 'loading')
          || gen !== this.generation,
      );
    }
    if (existing?.state === 'loaded' && !force && !isLeafPartition) {
      return Promise.resolve();
    }

    // Keep prior rows visible while reloading (column-window refill). Wiping
    // to `[]` blanked the canvas between drop and success — black voids.
    const preserved = existing?.rows ?? [];
    cache.set(blockIdx, { rows: preserved, state: 'loading', touch: ++this.touchClock });
    this.pending.add(tag);

    const startRow = blockIdx * this.blockSize;
    const endRow = isLeafPartition
      ? Math.min(node.leafCount, startRow + this.blockSize)
      : startRow + this.blockSize;

    const run = (): Promise<void> => new Promise<void>((resolve) => {
      if (gen !== this.generation || this.host.isDestroyed()) {
        this.pending.delete(tag);
        if (isLeafPartition) cache.delete(blockIdx);
        resolve();
        return;
      }
      this.inflight++;
      const columnKeys = this.host.getColumnKeys?.();
      const withColumnKeys = columnKeys && columnKeys.length > 0 ? { columnKeys } : {};

      const onSuccess = (result: LoadSuccessParams<TRow>): void => {
        this.inflight = Math.max(0, this.inflight - 1);
        this.pending.delete(tag);
        if (gen !== this.generation || this.host.isDestroyed()) {
          if (isLeafPartition) cache.delete(blockIdx);
          resolve();
          return;
        }
        this.ingestBlockResult(node, blockIdx, startRow, endRow, preserved, result, isLeafPartition);
        resolve();
      };
      const onFail = (): void => {
        this.inflight = Math.max(0, this.inflight - 1);
        this.pending.delete(tag);
        cache.set(blockIdx, { rows: preserved, state: 'failed', touch: ++this.touchClock });
        if (isLeafPartition) this.cacheEpoch++;
        resolve();
      };

      if (isLeafPartition) {
        ds.getLeafRows!({
          request: {
            groupPath: node.path.slice(),
            startRow,
            endRow,
            sortModel: this.host.getSortModel(),
            filterModel: this.host.getFilterModel(),
            rowGroupCols: this.host.getRowGroupCols(),
            ...withColumnKeys,
          },
          success: onSuccess,
          fail: onFail,
        });
        return;
      }

      ds.getRows({
        request: {
          startRow,
          endRow,
          sortModel: this.host.getSortModel(),
          filterModel: this.host.getFilterModel(),
          rowGroupCols: this.profile.serverSideGrouping ? this.host.getRowGroupCols() : [],
          groupKeys: this.profile.serverSideGrouping ? this.host.getGroupKeys() : [],
          expandedGroupKeys: this.profile.serverSideGrouping
            ? this.host.getExpandedGroupKeys()
            : [],
          ...withColumnKeys,
        },
        success: onSuccess,
        fail: onFail,
      });
    });

    if (this.inflight >= this.maxConcurrent) {
      return this.waitUntil(() => this.inflight < this.maxConcurrent || gen !== this.generation)
        .then(run);
    }
    return run();
  }

  /**
   * Fold a datasource reply into the cache. Shared by both partition kinds:
   * field-merge onto preserved rows (thin ticks wipe columns otherwise) and
   * the retryable short-window rule — a window shorter than the expected size
   * means the server is still settling, so cache it 'failed' (refetchable),
   * never 'loaded'. Caching a short mid-book block as 'loaded' turned a
   * transient race into a permanently blank band.
   */
  private ingestBlockResult(
    node: SkeletonNode,
    blockIdx: number,
    startRow: number,
    endRow: number,
    preserved: TRow[],
    result: LoadSuccessParams<TRow>,
    isLeafPartition: boolean,
  ): void {
    const cache = this.partition(node.key);

    if (!isLeafPartition) {
      const prevCount = this.flatRowCount;
      if (typeof result.rowCount === 'number' && Number.isFinite(result.rowCount)) {
        this.flatRowCount = Math.max(0, result.rowCount);
      } else if (result.rowData.length > 0) {
        this.flatRowCount = Math.max(this.flatRowCount, startRow + result.rowData.length);
      }
      if (this.profile.rowCountFromLoad === 'immediate-with-invalidation') {
        if (this.flatRowCount !== prevCount) {
          this.reportedRowCount = this.flatRowCount;
          this.host.setRowCount(this.reportedRowCount, prevCount);
        }
        // A changed total means flattened indices moved (server-side
        // add/remove, or an expansion change that reached the server outside
        // refreshExpansion). Blocks loaded under the old total would rehydrate
        // stale rows at shifted offsets — drop them so scroll refetches. Skip
        // initial discovery (prev === 0) and in-flight loads (issued against
        // the current model; they land under this generation with fresh data).
        if (prevCount > 0 && prevCount !== this.flatRowCount) {
          for (const [idx, blk] of cache) {
            if (idx !== blockIdx && blk.state === 'loaded') cache.delete(idx);
          }
        }
      }
      if (result.groupKeys?.length) {
        this.host.mergeGroupKeys?.(result.groupKeys);
      }
      // Flat mode has no skeleton root — the datasource may carry grand
      // totals on the load reply instead.
      if (result.grandTotals !== undefined) {
        this.host.setGrandTotals?.(result.grandTotals);
      }
    }

    const prevRows = cache.get(blockIdx)?.rows ?? preserved;
    const rows = this.mergeBlockRows(prevRows, result.rowData);

    let expected: number;
    if (isLeafPartition) {
      expected = endRow - startRow;
    } else if (this.flatRowCount > 0) {
      expected = Math.max(0, Math.min(this.blockSize, this.flatRowCount - startRow));
    } else {
      // No count known yet — whatever arrived is the whole story.
      expected = rows.length;
    }

    cache.set(blockIdx, {
      rows: rows.length > 0 ? rows : prevRows,
      state: rows.length >= expected ? 'loaded' : 'failed',
      touch: ++this.touchClock,
    });
    this.cacheEpoch++;
    if (this.profile.leafLru) this.evictIfNeeded();
  }

  /** Field-merge an incoming column slice onto previously cached block rows. */
  private mergeBlockRows(prev: TRow[] | undefined, incoming: TRow[]): TRow[] {
    if (!prev?.length) return incoming.slice();
    const n = Math.max(prev.length, incoming.length);
    const out: TRow[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = prev[i];
      const b = incoming[i];
      if (a && b) out[i] = { ...(a as object), ...(b as object) } as TRow;
      else out[i] = (b ?? a)!;
    }
    return out;
  }

  /** Any block holding rows costs memory — 'loaded' AND 'failed' blocks
   *  keeping partial rows for paint. Counted on the fly: an incremental
   *  counter never saw failed partial blocks, so they accumulated
   *  unevictably until purge. */
  private evictIfNeeded(): void {
    const holdsRows = (b: Block<TRow>): boolean =>
      b.state === 'loaded' || (b.state === 'failed' && b.rows.length > 0);
    let count = 0;
    for (const cache of this.caches.values()) {
      for (const block of cache.values()) if (holdsRows(block)) count++;
    }
    while (count > this.maxCachedLeafBlocks) {
      let lruKey = '';
      let lruIdx = -1;
      let lruTouch = Infinity;
      for (const [key, cache] of this.caches) {
        for (const [idx, block] of cache) {
          if (holdsRows(block) && block.touch < lruTouch) {
            lruTouch = block.touch;
            lruKey = key;
            lruIdx = idx;
          }
        }
      }
      if (lruIdx < 0) return;
      const cache = this.caches.get(lruKey);
      cache?.delete(lruIdx);
      // Emptied per-group maps go too — they leaked before.
      if (cache && cache.size === 0) this.caches.delete(lruKey);
      count--;
      this.cacheEpoch++;
    }
  }

  // ─── assembly + hydrate ──────────────────────────────────────────────

  /**
   * Materialize a slot into a paint-ready row (or null when its block isn't
   * cached). Group / footer / grand-total rows are synthesized from the
   * skeleton and always materialize.
   */
  private materialize(entry: FlattenEntry, expanded: ReadonlySet<string>): TRow | null {
    const rowGroupCols = this.host.getRowGroupCols();

    if (entry.kind === 'footer') {
      // Per-group total row — aggregates ride as fields (same mechanism as
      // group rows) so agg columns paint via totalsCellLookup; the label
      // paints as `Total {label}` (CSRM groupFooter renderer parity).
      const base = {
        ...entry.node.aggregates,
        [this.rowIdField]: `${SSRM_FOOTER_ROW_ID_PREFIX}${entry.node.key}`,
      } as Record<string, unknown>;
      return attachSsrmRowMeta(base, {
        kind: 'footer',
        key: entry.node.key,
        depth: entry.node.depth,
        label: entry.node.path[entry.node.depth] ?? '',
      }) as TRow;
    }
    if (entry.kind === 'grandTotal') {
      // In-scroll grand total — CSRM parity: a footer with an empty key paints
      // `Total` and resolves its values through `chunk.totals` (fed by
      // ssrmSetGrandTotals on the sparse path).
      const base = { [this.rowIdField]: SSRM_GRAND_TOTAL_ROW_ID } as Record<string, unknown>;
      return attachSsrmRowMeta(base, {
        kind: 'footer',
        key: '',
        depth: 0,
        label: '',
      }) as TRow;
    }
    if (entry.kind === 'group') {
      const base = this.groupBaseRows.get(entry.node.key);
      if (base === undefined) return null;
      return attachSsrmRowMeta(base as Record<string, unknown>, {
        kind: 'group',
        key: entry.node.key,
        depth: entry.node.depth,
        label: entry.node.path[entry.node.depth] ?? '',
        childCount: entry.node.leafCount,
        expanded: expanded.has(entry.node.key),
      }) as TRow;
    }

    const blockIdx = Math.floor(entry.leafOffset / this.blockSize);
    const block = this.caches.get(entry.node.key)?.get(blockIdx);
    // Paint whatever rows a block holds even when it's marked 'failed' (short
    // result pending retry) — partial beats blank.
    if (!block) return null;
    block.touch = ++this.touchClock;
    const leaf = block.rows[entry.leafOffset - blockIdx * this.blockSize];
    if (leaf === undefined) return null;
    if (!this.profile.attachRowMeta || !this.skeletonActive()) return leaf;
    return attachSsrmRowMeta(leaf as Record<string, unknown>, {
      kind: 'leaf',
      key: entry.node.key,
      depth: Math.min(entry.node.depth + 1, rowGroupCols.length),
      label: '',
    }) as TRow;
  }

  /**
   * Hydrate [start, end) from the plan + caches as contiguous runs, plus the
   * ancestor group rows above `start` so the sticky band always has its chain
   * hydrated.
   */
  private async hydrateRange(rowStart: number, rowEnd: number): Promise<void> {
    const plan = this.index;
    if (!plan || this.host.isDestroyed()) return;
    // Every flush() below is a worker round-trip; a purge (generation bump) or
    // a toggle's same-frame index swap can land between awaits. Stale hydrates
    // must not reach the worker — they would reset ssrmRowCount to the old
    // count and place rows at indices of the dead tree.
    const gen = this.generation;
    const stale = (): boolean =>
      gen !== this.generation || this.index !== plan || this.host.isDestroyed();

    const rowCount = plan.rowCount;
    const start = Math.max(0, Math.floor(rowStart));
    const end = Math.min(rowCount, Math.max(start, Math.ceil(rowEnd)));

    // Window-identity suppression — same window, same plan (expansion /
    // skeleton unchanged), same data generation, no cache mutations since the
    // last hydrate → the worker already holds exactly these rows.
    if (this.profile.windowIdentitySuppression) {
      const last = this.lastHydrate;
      if (
        last !== null
        && last.start === start
        && last.end === end
        && last.index === plan
        && last.generation === this.generation
        && last.cacheEpoch === this.cacheEpoch
      ) {
        return;
      }
    }

    const expanded = new Set(this.host.getExpandedGroupKeys());
    let run: TRow[] = [];
    let runStart = start;
    let cursor = start;
    const flush = async (): Promise<void> => {
      if (run.length === 0) return;
      await this.host.hydrateWindow(
        runStart,
        run,
        Math.max(rowCount, runStart + run.length),
        false,
      );
      run = [];
    };

    // Contiguous loaded runs only — skip gaps instead of aborting the whole
    // window, and never push an empty hydrate that races paint.
    for (const entry of plan.entriesInRange(start, end)) {
      const row = this.materialize(entry, expanded);
      if (row === null) {
        await flush();
        runStart = cursor + 1;
      } else {
        if (run.length === 0) runStart = cursor;
        run.push(row);
      }
      cursor++;
      if (stale()) return;
    }
    await flush();
    if (stale()) return;

    if (rowCount === 0 && this.reportedRowCount === 0) {
      if (this.skeletonActive()) await this.host.hydrateWindow(0, [], 0, false);
      return;
    }

    // Sticky chain — ancestors above the hydrated window.
    for (const anc of plan.ancestorsOf(start)) {
      if (anc.index >= start) continue;
      const row = this.materialize({ kind: 'group', node: anc.node } as FlattenEntry, expanded);
      if (row !== null) {
        await this.host.hydrateWindow(anc.index, [row], rowCount, false);
      }
      if (stale()) return;
    }

    this.lastHydrate = {
      start,
      end,
      index: plan,
      generation: this.generation,
      cacheEpoch: this.cacheEpoch,
    };
  }
}
