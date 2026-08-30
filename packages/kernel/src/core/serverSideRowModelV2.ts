/**
 * Sparse SSRM v2 controller — client-owned group skeleton.
 *
 * The kernel owns the tree shape: all group rows (skeleton) plus a
 * FlattenIndex over (skeleton × expandedKeys). The datasource answers two
 * expansion-free queries — `getGroupSkeleton` and `getLeafRows` — plus the
 * v1 `getRows` flat window when no grouping is active.
 *
 * What this buys over v1 (`serverSideRowModel.ts`):
 *  - expand/collapse is a local reflow (no round trip, no purge flash);
 *  - leaf caches are per-group, so toggles never invalidate them;
 *  - rowCount, expandAll, sticky ancestors are exact by construction.
 *
 * See docs/ssrm-group-skeleton-design.md.
 */

import type { FilterModel, SortModel } from '../types';
import type {
  IServerSideDatasource,
  IServerSideDatasourceV2,
  RefreshServerSideParams,
  ServerSideTransaction,
} from '../types/ssrm';
import { attachSsrmRowMeta, readSsrmRowMeta } from './ssrmRowMeta';
import {
  FlattenIndex,
  toDisplayOrder,
  extractRootAggregates,
  type FlattenEntry,
  type SkeletonNode,
} from './ssrmFlattenIndex';
import { decodePivotSortTarget } from './pivotColumns';
import { encodePivotValueKey } from '../worker/passes/pivotPass';

export const SSRM_GROUP_ROW_ID_PREFIX = '__grp__';
export const SSRM_FOOTER_ROW_ID_PREFIX = '__footer__';
export const SSRM_GRAND_TOTAL_ROW_ID = '__grand_total__';

/**
 * Grid seam the SSRM controller drives. Relocated here when the v1
 * controller (`core/serverSideRowModel.ts`) was decommissioned — v2 is the
 * only server-side row model, and this is the only host contract.
 */
export interface SsrmHost<TRow> {
  getRowId(row: TRow): string;
  getSortModel(): SortModel;
  getFilterModel(): FilterModel;
  getRowGroupCols(): string[];
  getExpandedGroupKeys(): string[];
  /**
   * Optional column projection for getRows / getLeafRows. When omitted or
   * empty, datasources return full rows (legacy behaviour).
   */
  getColumnKeys?(): string[] | undefined;
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

/** V2 host — base seam plus exact-group-key replacement (expandAll etc.). */
export interface SsrmHostV2<TRow> extends SsrmHost<TRow> {
  /**
   * B-L2 (production hardening) — the leaf-block LRU dropped these rows.
   * Before this seam existed, eviction trimmed only the controller's own
   * `leafCaches`: the worker store and the main-thread `rowDataById` mirror
   * both kept every row ever hydrated, so a long-lived blotter carried the
   * whole book twice regardless of `maxCachedLeafBlocks`.
   *
   * Optional so hosts that predate it (and the controller's own unit-test
   * doubles) keep working unchanged — the controller no-ops when it's absent.
   */
  evictRows?(rowIds: string[]): void;
  /** Replace (not merge) the known composite group keys from the skeleton. */
  setGroupKeys?(keys: string[]): void;
  /** Install host-computed grand totals (skeleton root aggregates, keyed
   *  by FIELD) in the worker — drives the pinned totals subgrid and the
   *  in-scroll grand-total footer. `null` clears. */
  setGrandTotals?(totals: Record<string, unknown> | null): void;
  /**
   * The pivot cross-tab currently published via `setServerSidePivotResult`,
   * or `null`. Read when the sort model targets a pivot result column: the
   * datasource cannot sort by one (it isn't a table column), so the
   * controller orders the skeleton's groups by the cell value instead.
   */
  getPivotResult?(): import('../worker/protocol').SsrmPivotResult | null;
}

interface LeafBlock<TRow> {
  rows: TRow[];
  state: 'loading' | 'loaded' | 'failed';
  /** LRU clock — larger = touched more recently. */
  touch: number;
  /** B-C8 — consecutive failures (network `fail()` OR a short/incomplete
   *  reply that stayed 'failed'). Reset to 0 on a complete 'loaded' result. */
  failCount: number;
  /** B-C8 — epoch ms before which a 'failed' block must NOT be treated as
   *  missing again; 0 = no backoff in effect. Exponential per `failCount`
   *  (1s/4s/15s, capped at 60s) — see `retryBackoffMs`. */
  nextRetryAt: number;
}

/** B-C8 — per-block retry backoff schedule (ms), indexed by
 *  `min(failCount, N) - 1`. */
const SSRM_RETRY_BACKOFF_MS = [1000, 4000, 15000, 60000];

function retryBackoffMs(failCount: number): number {
  const idx = Math.min(Math.max(failCount, 1), SSRM_RETRY_BACKOFF_MS.length) - 1;
  return SSRM_RETRY_BACKOFF_MS[idx]!;
}

/**
 * Datasource shape this controller drives. Since the v1 controller was
 * decommissioned it serves BOTH shapes: a full v2 skeleton datasource, and a
 * plain `getRows`-only datasource (flat path only — such a datasource's
 * grouping, if any, is served by the worker CSRM pipeline over a fully
 * hydrated book). The skeleton methods are therefore optional here.
 */
export type SsrmDatasource<TRow> =
  IServerSideDatasource<TRow> & Partial<Omit<IServerSideDatasourceV2<TRow>, 'getRows'>>;

export class ServerSideRowModelV2Controller<TRow = any> {
  private datasource: SsrmDatasource<TRow> | null = null;

  /** Display-ordered skeleton; null until fetched for the current query. */
  private skeleton: SkeletonNode[] | null = null;
  /** Synthesized base group rows (aggregates + stamped row id), by key. */
  private groupBaseRows = new Map<string, TRow>();
  private index: FlattenIndex | null = null;

  /** Per-group leaf blocks; flat mode uses the '' key via `getRows`. */
  private readonly leafCaches = new Map<string, Map<number, LeafBlock<TRow>>>();
  private touchClock = 0;
  /** Bumped on ANY leaf-cache content change — part of the hydrate
   *  signature so unchanged windows skip the worker round trip entirely
   *  (viewer-datagrid's "integer window unchanged → do nothing" rule). */
  private cacheEpoch = 0;
  /** Identity of the last hydrated window; matching state = no-op. */
  private lastHydrate: {
    start: number;
    end: number;
    index: FlattenIndex;
    dataGen: number;
    cacheEpoch: number;
  } | null = null;

  private flatRowCount = 0;
  /** False while `flatRowCount` is an over-allocated ESTIMATE (unknown-total
   *  datasource, one block past the loaded edge). Set once a reply declares
   *  a `rowCount` or a short window pins the end of the book. */
  private flatRowCountExact = false;
  /**
   * Provenance behind `flatRowCountExact` — the two ways it can become true
   * carry different one-way-ness guarantees. A `'declared'` count (the reply
   * carried `rowCount`) is authoritative and stays one-way: only a fresher
   * declared count ever overwrites it. An `'inferred'` count (a short window
   * with no declared total — end-of-book guessed from the loaded edge) is a
   * clamp, not a fact: a transient short reply (server still settling) or a
   * book that later grows must be able to re-inflate it on the next full
   * window, exactly like the estimate path does. Folding both into one
   * boolean made a transient short reply permanently truncate the book.
   */
  private flatRowCountSource: 'unknown' | 'declared' | 'inferred' = 'unknown';
  private reportedRowCount = 0;

  /** Bumped on purge (sort/filter/groupBy/datasource change) — leaf and
   *  skeleton results from an older generation are discarded. Expansion
   *  changes do NOT bump it: leaf data is expansion-independent. */
  private dataGen = 0;
  private inflight = 0;
  private chain: Promise<void> = Promise.resolve();
  /** Fix wave 6 — fires once per controller lifetime (not once per
   *  ensureRange call) so a persistently too-narrow cap warns exactly
   *  once instead of spamming the console on every scroll tick. */
  private inBandEvictionWarned = false;

  private readonly blockSize: number;
  private readonly maxConcurrent: number;
  private readonly maxCachedLeafBlocks: number;
  private readonly rowIdField: string;
  private readonly groupTotalRow: 'top' | 'bottom' | null;
  private readonly grandTotalRow: 'top' | 'bottom' | null;
  private readonly maintainOrder: boolean;
  /**
   * Client-side ("local") mode — `rowModelType: 'clientSide'`. The whole book
   * is already resident in the worker's `RowStore` (put there by `setRowData`
   * / `applyTransaction`), so every fetch-shaped operation this controller
   * owns is meaningless: there is no latency to hide, no unbounded remote
   * dataset to cap, and nothing to refresh FROM. `ensureRange` / `refresh` /
   * `ensureFullyHydrated` short-circuit, and no datasource is ever installed.
   * The controller still mounts so client-side and server-side grids share
   * ONE row-model code path.
   */
  private readonly localMode: boolean;
  /** Previous display position by key — pins sibling order across skeleton
   *  refetches when `maintainOrder` is on. */
  private prevOrder: Map<string, number> | null = null;
  /** Sort model the current `prevOrder` was captured under — see ingestSkeleton. */
  private lastSortSig: string | null = null;
  private warnedUnsupportedTx = false;

  constructor(
    private readonly host: SsrmHostV2<TRow>,
    opts: {
      rowIdField: string;
      cacheBlockSize?: number;
      maxConcurrentDatasourceRequests?: number;
      maxCachedLeafBlocks?: number;
      /** In-scroll per-group total rows (AG `groupTotalRow`). */
      groupTotalRow?: 'top' | 'bottom' | null;
      /** In-scroll grand-total row (AG `grandTotalRow` 'top'|'bottom' —
       *  pinned variants ride the totals subgrid, not the index). */
      grandTotalRow?: 'top' | 'bottom' | null;
      /** AG `groupMaintainOrder` — pin skeleton sibling order across
       *  refetches. */
      maintainOrder?: boolean;
      /** Client-side grid — see {@link localMode}. */
      localMode?: boolean;
    },
  ) {
    this.rowIdField = opts.rowIdField;
    this.blockSize = Math.max(1, opts.cacheBlockSize ?? 100);
    this.maxConcurrent = Math.max(1, opts.maxConcurrentDatasourceRequests ?? 2);
    this.maxCachedLeafBlocks = Math.max(8, opts.maxCachedLeafBlocks ?? 500);
    if (opts.maxCachedLeafBlocks !== undefined && opts.maxCachedLeafBlocks < 8) {
      console.warn(
        `[velocity-grid] serverSideMaxCachedLeafBlocks (${opts.maxCachedLeafBlocks}) is below `
        + 'the floor of 8 and was clamped to 8.',
      );
    }
    this.groupTotalRow = opts.groupTotalRow ?? null;
    this.grandTotalRow = opts.grandTotalRow ?? null;
    this.maintainOrder = opts.maintainOrder === true;
    this.localMode = opts.localMode === true;
  }

  /** True for a client-side grid — see {@link localMode}. */
  isLocalMode(): boolean {
    return this.localMode;
  }

  setDatasource(ds: SsrmDatasource<TRow> | null): void {
    this.datasource?.destroy?.();
    this.datasource = ds;
    void this.refresh({ purge: true });
  }

  getRowCount(): number {
    return this.reportedRowCount;
  }

  /**
   * True while the reported row count is an over-allocated ESTIMATE — a flat
   * datasource that never declares `rowCount`, still discovering the end of
   * the book. Deliberately NOT folded into `setRowCount`: every row-count
   * consumer (status-bar count panels, `getTotalRowCount`,
   * `getDisplayedRowCount`) takes a plain number, and an estimate that reads
   * one block high is the standard infinite-scroll contract. Exposed so
   * callers that want to render "N+" can ask.
   */
  isRowCountEstimated(): boolean {
    return !this.grouped() && !this.flatRowCountExact && this.reportedRowCount > 0;
  }

  ensureRange(rowStart: number, rowEnd: number): Promise<void> {
    // Local mode: the worker already holds every row. This runs on the
    // viewport hot path (once per scroll fetch), so short-circuit BEFORE
    // `enqueue` — a client-side grid must not pay a promise-chain hop per
    // scroll tick for a fetch that can never have anything to do.
    if (this.localMode) return Promise.resolve();
    return this.enqueue(() => this.ensureRangeInner(rowStart, rowEnd));
  }

  /**
   * Horizontal column-window refill — re-fetch the viewport band with the
   * latest `columnKeys` and field-merge onto cached rows. Does NOT drop
   * blocks first (that blanked the canvas and caused black voids / flicker
   * during H-scroll). Does NOT bump dataGen / purge the skeleton.
   */
  refillColumnKeys(): Promise<void> {
    return this.enqueue(async () => {
      if (this.host.isDestroyed()) return;
      const band = this.refreshBand();
      const gen = this.dataGen;
      if (this.grouped()) {
        await this.forceReloadBandLeafBlocks(band.rowStart, band.rowEnd, gen);
      } else {
        await this.forceReloadFlatBlocks(band.rowStart, band.rowEnd, gen);
      }
      if (gen !== this.dataGen || this.host.isDestroyed()) return;
      // Invalidate hydrate signature so the band re-pushes to the worker.
      this.lastHydrate = null;
      this.cacheEpoch++;
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (this.host.isDestroyed()) return;
      this.host.requestViewport();
    });
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

  refresh(params: RefreshServerSideParams = {}): Promise<void> {
    // Local mode: there is no datasource to refresh FROM — the worker's
    // store IS the book. Callers reach `refresh` through shared seams
    // (e.g. the grouping coordinator), so absorb it here rather than
    // requiring every caller to know the mode.
    if (this.localMode) return Promise.resolve();
    // Conflate soft refreshes: live ticks can arrive faster than a refresh
    // completes, and queuing one op per tick grows the chain without bound
    // — refreshes lag ever further behind and anything queued later (a
    // purge, an expansion toggle) waits out the whole backlog. While one
    // soft refresh is QUEUED, later ticks ride it; the handle clears when
    // the op starts so ticks landing mid-run coalesce into exactly one
    // follow-up.
    //
    // Adaptive pacing (viewer-datagrid style): on top of conflation, the
    // next soft refresh is delayed by the moving average of recent
    // refresh durations, so the cadence self-tunes to what the datasource
    // actually sustains instead of hammering it every tick.
    const soft = params.purge === false;
    if (!soft) {
      // Invalidate any queued/paced soft refresh so it cannot run after a
      // structural purge (or race a blank hydrate with a soft band reload).
      this.softRefreshEpoch++;
      this.pendingSoftRefresh = null;
      return this.enqueue(() => this.refreshInner(params));
    }
    if (this.pendingSoftRefresh !== null) {
      return this.pendingSoftRefresh;
    }
    const epoch = this.softRefreshEpoch;
    let p: Promise<void> | null = null;
    const run = (): Promise<void> => this.enqueue(async () => {
      if (this.pendingSoftRefresh === p) this.pendingSoftRefresh = null;
      if (epoch !== this.softRefreshEpoch) return;
      const t0 = Date.now();
      try {
        await this.refreshInner(params);
      } finally {
        this.lastSoftRefreshEnd = Date.now();
        this.softRefreshDurations.push(this.lastSoftRefreshEnd - t0);
        if (this.softRefreshDurations.length > 5) this.softRefreshDurations.shift();
      }
    });
    const wait = Math.max(0, this.lastSoftRefreshEnd + this.softRefreshAvgMs() - Date.now());
    p = wait > 16
      ? new Promise<void>((resolve, reject) => {
          setTimeout(() => { run().then(resolve, reject); }, wait);
        })
      : run();
    this.pendingSoftRefresh = p;
    return p;
  }

  /** Conflation handle — at most one QUEUED soft refresh at a time. */
  private pendingSoftRefresh: Promise<void> | null = null;
  /** Bumped on purge to cancel paced soft refreshes still waiting on setTimeout. */
  private softRefreshEpoch = 0;
  /** Per-block fetch tokens — force reloads must not ride a stale in-flight getRows. */
  private readonly blockFetchSeq = new Map<string, number>();
  /** Last 5 soft-refresh durations (ms) — the pacing signal. */
  private readonly softRefreshDurations: number[] = [];
  private lastSoftRefreshEnd = 0;

  /** Moving average of recent soft-refresh cost, capped at 2s. */
  private softRefreshAvgMs(): number {
    const d = this.softRefreshDurations;
    if (d.length === 0) return 0;
    let sum = 0;
    for (const v of d) sum += v;
    return Math.min(2000, sum / d.length);
  }

  /**
   * Expansion toggle — paint the reflow immediately (same frame), then fill
   * missing leaves on the op chain. Live soft-refreshes must not block the
   * chevron; otherwise a hot feed makes groups look un-expandable.
   */
  refreshExpansion(): Promise<void> {
    if (this.grouped() && this.skeleton !== null && !this.host.isDestroyed()) {
      this.rebuildIndex();
      const band = this.refreshBand();
      // A-L1 / baseline-hardening — this dispatch is intentionally
      // fire-and-forget (the chevron paints immediately; this fills
      // leaves after). Nothing else awaits or observes it, so a rejected
      // `hydrateRange` (most commonly: the grid was destroyed mid-flight,
      // which rejects every in-flight worker round-trip) must be handled
      // HERE or it surfaces as a Node unhandledRejection. Destroy-mid-flight
      // is expected and silent; any other failure still gets a loud
      // console.error — this is the only place this call can be observed.
      void this.hydrateRange(band.rowStart, band.rowEnd).then(
        () => {
          if (!this.host.isDestroyed()) this.host.requestViewport();
        },
        (err: unknown) => {
          if (!this.host.isDestroyed()) {
            console.error('[velocity-grid] SSRM v2 refreshExpansion hydrate failed:', err);
          }
        },
      );
    }
    return this.enqueue(() => this.refreshExpansionInner());
  }

  /** Full hydrate only exists for the flat fallback (client-pipeline
   *  bridge). Grouped v2 is natively sparse — nothing to fully hydrate.
   *  Returns false when hydration is refused so the caller must NOT
   *  enable the client pipeline over the sparse store. */
  async ensureFullyHydrated(): Promise<boolean> {
    // Local mode is fully hydrated by definition — `setRowData` /
    // `applyTransaction` put the whole book in the worker store directly,
    // so there is nothing to page in and the answer is trivially yes.
    if (this.localMode) return true;
    // Only the SKELETON path refuses. A getRows-only datasource with a group
    // model is NOT sparse — full hydrate is exactly how it serves grouping
    // (worker CSRM pipeline), which is what the decommissioned v1 controller
    // did. Gating on the raw group model here would break that path.
    if (this.grouped()) {
      console.warn('[velocity-grid] SSRM v2: ensureFullyHydrated is unsupported while grouped — the skeleton path serves grouping natively');
      return false;
    }
    // Starts true: a genuinely empty book (flatRowCount stays 0 after the
    // probe fetch) is a legitimate, fully-hydrated result, not a failure.
    let hydrated = true;
    await this.enqueue(async () => {
      // Captured HERE, not re-read at the `postHydrate` call below — a
      // purge (`destroy()` bumps `dataGen` outside the chain) can land in
      // either `await ensureRangeInner` below. Reading `this.dataGen`/
      // `this.index` fresh at send time would compare the post-purge value
      // to itself and never catch it — see `postHydrate`'s doc comment.
      const gen = this.dataGen;
      const index = this.index;
      if (this.flatRowCount <= 0) await this.ensureRangeInner(0, this.blockSize);
      if (this.flatRowCount <= 0) return;
      await this.ensureRangeInner(0, this.flatRowCount);
      const cache = this.leafCaches.get('');
      const rows: TRow[] = [];
      for (let i = 0; i < this.flatRowCount; i++) {
        const row = cache?.get(Math.floor(i / this.blockSize))?.rows[i % this.blockSize];
        if (row === undefined) break;
        rows.push(row);
      }
      // `ensureRangeInner` above can LRU-evict its own earlier blocks under
      // `maxCachedLeafBlocks` pressure for a book larger than the cache —
      // the collection loop then breaks at the first hole (often i=0) and
      // `rows` is short (or empty). Report that honestly: a truncated book
      // must NOT be treated as a successful hydrate, or the caller enables
      // the client pipeline over data it doesn't actually have.
      hydrated = rows.length === this.flatRowCount;
      if (!hydrated) {
        console.warn(
          `[velocity-grid] SSRM v2: ensureFullyHydrated collected ${rows.length}/${this.flatRowCount} rows `
          + '(LRU eviction dropped earlier blocks under memory pressure — the book is larger than '
          + 'maxCachedLeafBlocks × blockSize). Declining to enable the client pipeline over a truncated book.',
        );
      }
      await this.postHydrate(0, rows, this.flatRowCount, true, gen, index);
    });
    return hydrated;
  }

  /**
   * All descendant leaf row-ids under `groupKey` (any depth) via the
   * datasource's optional `getGroupLeafIds`. Returns null when the
   * datasource doesn't implement it or the group is unknown. Used to feed
   * the selection descendant cache so group-checkbox cascade works on the
   * sparse path.
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
      // Rows as stored after the patch, keyed by id — the worker REPLACES
      // by id, so updates must carry the cached row's __ssrm meta or leaf
      // depth/kind is stripped and the row paints unindented.
      const patched = new Map<string, TRow>();
      for (const cache of this.leafCaches.values()) {
        for (const block of cache.values()) {
          // 'failed' blocks keep partial rows that DO paint — ticks must
          // reach them too, not just fully loaded blocks.
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

  destroy(): void {
    this.datasource?.destroy?.();
    this.datasource = null;
    this.dataGen++;
    this.skeleton = null;
    this.index = null;
    this.groupBaseRows.clear();
    this.leafCaches.clear();
    // Mirrors `refreshInner`'s purge branch, which clears this on every
    // purge — without this, a late `fail()`/`success()` for a fetch begun
    // before this `destroy()` could still pass the `blockFetchSeq` fetchId
    // check (a stale entry left behind) even though the `gen`/
    // `isDestroyed()` guard above it already independently stops it;
    // belt-and-suspenders against the same resurrection class the `fail()`
    // guard closes.
    this.blockFetchSeq.clear();
    // B-P5 — every pending `waitUntil` predicate ORs in `gen !==
    // this.dataGen`; waking here is what settles them all instead of
    // leaving them to poll (or, pre-fix, to poll forever now that nothing
    // else will ever flip their block-state/inflight clause again). Slot
    // waiters need their own drain — see `wakeOnGenChange`.
    this.wakeOnGenChange();
  }

  // ─── op serialization ────────────────────────────────────────────────

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op, op);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  // ─── refresh flows ───────────────────────────────────────────────────

  private async refreshInner(params: RefreshServerSideParams): Promise<void> {
    if (this.host.isDestroyed()) return;
    if (params.purge !== false) {
      this.dataGen++;
      this.skeleton = null;
      this.index = null;
      this.groupBaseRows.clear();
      this.leafCaches.clear();
      this.blockFetchSeq.clear();
      this.cacheEpoch++;
      this.flatRowCount = 0;
      this.flatRowCountExact = false;
      this.flatRowCountSource = 'unknown';
      // Captured HERE, immediately after our own bump above, rather than
      // re-read at the `postHydrate` call below — `setGrandTotals` is a
      // synchronous call into host code, and if it were to reenter (e.g.
      // a synchronous `destroy()`) before returning, reading `this.dataGen`
      // fresh at send time would compare that later value to itself and
      // never notice; `postHydrate`'s own `isDestroyed()` check still
      // covers that specific case, but this keeps the gen/index half of
      // the gate meaningful too (see `postHydrate`'s doc comment).
      const gen = this.dataGen;
      const index = this.index;
      // B-P5 — wake every waiter gating on this purge's `gen` bump (see
      // `destroy()`'s identical comment).
      this.wakeOnGenChange();
      this.host.setGrandTotals?.(null);
      await this.postHydrate(0, [], Math.max(this.reportedRowCount, 0), true, gen, index);
      if (this.host.isDestroyed()) return;
      const band = this.refreshBand();
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (this.host.isDestroyed()) return;
      this.host.requestViewport();
      return;
    }
    // Soft refresh — live tick. Keep painted rows on screen while reloading
    // (drop-then-fetch blanked the band → black voids during scroll + ticks).
    const gen = this.dataGen;
    const band = this.refreshBand();
    if (this.grouped()) {
      const groups = await this.fetchSkeletonRaw();
      if (gen !== this.dataGen || this.host.isDestroyed()) return;
      if (groups !== null) this.ingestSkeleton(groups, /* soft */ true);
      await this.forceReloadBandLeafBlocks(band.rowStart, band.rowEnd, gen);
    } else {
      await this.forceReloadFlatBlocks(band.rowStart, band.rowEnd, gen);
    }
    if (gen !== this.dataGen || this.host.isDestroyed()) return;
    this.lastHydrate = null;
    this.cacheEpoch++;
    await this.ensureRangeInner(band.rowStart, band.rowEnd);
    if (gen !== this.dataGen || this.host.isDestroyed()) return;
    this.host.requestViewport();
  }

  private async refreshExpansionInner(): Promise<void> {
    if (this.host.isDestroyed()) return;
    if (!this.grouped() || this.skeleton === null) {
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
    // Paint what we already have (all group rows + cached leaves) before
    // any fetch: collapse renders complete instantly; expand shows group
    // rows and fills leaves as they land.
    await this.hydrateRange(band.rowStart, band.rowEnd);
    if (this.host.isDestroyed()) return;
    this.host.requestViewport();
    // Fill missing leaf blocks, then re-paint.
    await this.ensureRangeInner(band.rowStart, band.rowEnd);
    if (this.host.isDestroyed()) return;
    this.host.requestViewport();
  }

  private refreshBand(): { rowStart: number; rowEnd: number } {
    const r = this.host.getRefreshRange?.();
    if (!r || r.rowEnd <= r.rowStart) return { rowStart: 0, rowEnd: this.blockSize };
    return r;
  }

  // ─── skeleton ────────────────────────────────────────────────────────

  /**
   * Does the mounted datasource speak the skeleton protocol? Since the v1
   * controller was decommissioned this controller also serves plain
   * `getRows`-only datasources, which have no `getGroupSkeleton` to call —
   * those stay on the flat path regardless of the group model (grouping is
   * then served by the worker CSRM pipeline over a fully hydrated book).
   */
  private skeletonCapable(): boolean {
    return typeof this.datasource?.getGroupSkeleton === 'function';
  }

  /** Is the SKELETON path active? Requires both a group model and a
   *  datasource that can answer skeleton queries. */
  private grouped(): boolean {
    return this.host.getRowGroupCols().length > 0 && this.skeletonCapable();
  }

  private fetchSkeletonRaw(): Promise<import('../types/ssrm').SkeletonGroup[] | null> {
    const ds = this.datasource;
    // Unreachable behind `grouped()`, which requires skeleton capability —
    // the guard is what makes that fact checkable. Bound to a local because
    // property narrowing does not survive into the promise callback.
    const getGroupSkeleton = ds?.getGroupSkeleton?.bind(ds);
    if (!getGroupSkeleton) return Promise.resolve(null);
    return new Promise((resolve) => {
      getGroupSkeleton({
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
   * Sibling comparator for a sort on a PIVOT result column, or `null` when
   * the sort model doesn't target one.
   *
   * A pivot result column is synthesized by the kernel and does not exist in
   * the datasource, so the sort can't be pushed down — Perspective aborts on
   * an unknown column. The cross-tab is already published here, so order the
   * skeleton's groups by the cell value instead.
   *
   * Deliberately mirrors CSRM's `reorderGroupLevelByPivot`
   * (worker/passes/sortPass.ts) including its missing-value rule — nullish
   * and NaN sort last on asc, first on desc — so the same click produces the
   * same order in both row models.
   */
  private buildPivotSiblingSort(): ((a: string, b: string) => number) | null {
    const pivot = this.host.getPivotResult?.();
    if (!pivot || pivot.values.size === 0) return null;
    let decoded: { joinedPath: string; valueColId: string } | null = null;
    let entry: { direction: 'asc' | 'desc' } | undefined;
    for (const s of this.host.getSortModel()) {
      const target = decodePivotSortTarget(s.colId);
      if (target !== null) { decoded = target; entry = s; break; }
    }
    if (decoded === null || entry === undefined) return null;
    const dir = entry.direction === 'asc' ? 1 : -1;
    const valueOf = (key: string): unknown =>
      pivot.values.get(encodePivotValueKey(key, decoded.joinedPath, decoded.valueColId));
    return (aKey, bKey) => {
      const av = valueOf(aKey);
      const bv = valueOf(bKey);
      const aMissing = av === undefined || av === null;
      const bMissing = bv === undefined || bv === null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      const an = Number(av);
      const bn = Number(bv);
      if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
      if (Number.isNaN(an)) return 1;
      if (Number.isNaN(bn)) return -1;
      return dir * (an < bn ? -1 : an > bn ? 1 : 0);
    };
  }

  /**
   * Install a fetched skeleton. On soft refresh, caches survive for groups
   * whose leafCount is unchanged (their leaf indices are stable); changed /
   * removed groups drop theirs.
   */
  private ingestSkeleton(
    groups: import('../types/ssrm').SkeletonGroup[],
    soft: boolean,
  ): void {
    const rowGroupCols = this.host.getRowGroupCols();
    // `groupMaintainOrder` keeps group order stable across DATA refreshes.
    // It must not outlive a sort change: `prevOrder` is recaptured from the
    // order it just imposed, so without this the first order ever seen gets
    // re-pinned onto every later skeleton and group order can never change
    // again — sorting a group column would silently do nothing.
    const sortSig = JSON.stringify(this.host.getSortModel());
    if (sortSig !== this.lastSortSig) {
      this.lastSortSig = sortSig;
      this.prevOrder = null;
    }
    const pivotSort = this.buildPivotSiblingSort();
    const nodes = toDisplayOrder(
      groups,
      rowGroupCols,
      // An explicit pivot sort overrides maintain-order; otherwise a header
      // click would be pinned back to the previous positions.
      this.maintainOrder && pivotSort === null ? (this.prevOrder ?? undefined) : undefined,
      pivotSort ?? undefined,
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
        if (prev !== undefined && prev !== n.leafCount) this.dropGroupCache(n.key);
        prevLeafCount.delete(n.key);
      }
      for (const removedKey of prevLeafCount.keys()) this.dropGroupCache(removedKey);
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

  /** Expansion snapshot the current index was built from. */
  private lastExpanded: ReadonlySet<string> = new Set();

  /** True when the host's expansion set no longer matches the index — e.g.
   *  a scroll-driven ensureRange that landed between a toggle and its
   *  refreshExpansion op. Rebuilding here keeps assembly honest. */
  private expansionDrifted(): boolean {
    const cur = this.host.getExpandedGroupKeys();
    if (cur.length !== this.lastExpanded.size) return true;
    for (const k of cur) {
      if (!this.lastExpanded.has(k)) return true;
    }
    return false;
  }

  private dropGroupCache(groupKey: string): void {
    if (!this.leafCaches.delete(groupKey)) return;
    this.cacheEpoch++;
  }

  /** Get-or-create the live per-group leaf block map by key (B-C6). Always
   *  re-resolves through `this.leafCaches` rather than trusting a
   *  closure-captured reference — `dropGroupCache` can delete the map a
   *  fetch started against while that fetch is still in flight. */
  private resolveLeafCache(groupKey: string): Map<number, LeafBlock<TRow>> {
    let cache = this.leafCaches.get(groupKey);
    if (!cache) {
      cache = new Map();
      this.leafCaches.set(groupKey, cache);
    }
    return cache;
  }

  // ─── range loading ───────────────────────────────────────────────────

  private async ensureRangeInner(rowStart: number, rowEnd: number): Promise<void> {
    if (!this.datasource || this.host.isDestroyed()) return;
    const gen = this.dataGen;

    if (!this.grouped()) {
      await this.ensureFlatRange(rowStart, rowEnd, gen);
      return;
    }

    if (this.skeleton === null) {
      const groups = await this.fetchSkeletonRaw();
      if (gen !== this.dataGen || this.host.isDestroyed()) return;
      if (groups === null) return;
      this.ingestSkeleton(groups, false);
    } else if (this.index === null || this.expansionDrifted()) {
      this.rebuildIndex();
    }
    const index = this.index;
    if (!index) return;

    const start = Math.max(0, Math.floor(rowStart));
    const end = Math.min(index.rowCount, Math.max(start, Math.ceil(rowEnd)));

    // Collect missing / in-flight leaf blocks for the range. Fast scroll can
    // overlap ensureRange calls — always wait for `loading` blocks, otherwise
    // hydrate runs over empty slots and paints black voids.
    const missing: Array<{ node: SkeletonNode; blockIdx: number }> = [];
    const waiting: Array<Promise<void>> = [];
    const seen = new Set<string>();
    for (const entry of index.entriesInRange(start, end)) {
      if (entry.kind !== 'leaf') continue;
      const blockIdx = Math.floor(entry.leafOffset / this.blockSize);
      const tag = `${entry.node.key}\u0000${blockIdx}`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      const cache = this.leafCaches.get(entry.node.key);
      const block = cache?.get(blockIdx);
      // B-C8 — a 'failed' block within its backoff window is left alone:
      // not re-fetched (that's the whole point), not waited on either
      // (nothing is in flight for it). Whatever rows it holds still paint.
      if (block?.state === 'failed' && block.nextRetryAt > Date.now()) {
        continue;
      }
      if (!block || block.state === 'failed') {
        missing.push({ node: entry.node, blockIdx });
      } else if (block.state === 'loading') {
        // B-C6 — re-resolve the LIVE map by key on every re-check, not the
        // `cache` closure captured above. `dropGroupCache` can delete that
        // map while this fetch is still in flight; the reply then lands
        // (via `resolveLeafCache`) in a freshly-recreated live map that this
        // predicate must also see, or it can never become true again — see
        // `resolveLeafCache`'s doc comment. A missing map reads as "not
        // loading", which is correct: nothing is in flight against it here.
        waiting.push(this.waitUntil(
          () => this.leafCaches.get(entry.node.key)?.get(blockIdx)?.state !== 'loading' || gen !== this.dataGen,
        ));
      }
    }
    // Fix wave 6 — `seen` is every distinct leaf block this band touches;
    // if that already exceeds the cap, the LRU trim below (via
    // `evictIfNeeded`, called from each block's load success) WILL evict
    // blocks still inside this same band. See `warnInBandEviction`.
    if (seen.size > this.maxCachedLeafBlocks) this.warnInBandEviction(seen.size);
    if (missing.length > 0 || waiting.length > 0) {
      await Promise.all([
        ...missing.map((m) => this.loadLeafBlock(m.node, m.blockIdx, gen)),
        ...waiting,
      ]);
    }
    if (gen !== this.dataGen || this.host.isDestroyed()) return;
    await this.hydrateRange(start, end);
  }

  private loadLeafBlock(
    node: SkeletonNode,
    blockIdx: number,
    gen: number,
    force = false,
  ): Promise<void> {
    const ds = this.datasource;
    // Leaf fetches only happen on the skeleton path (see `grouped()`), which
    // guarantees the method exists; guarded so the type reflects that. Bound
    // to a local because narrowing does not survive into the fetch callback.
    const getLeafRows = ds?.getLeafRows?.bind(ds);
    if (!getLeafRows) return Promise.resolve();
    let cache = this.leafCaches.get(node.key);
    if (!cache) {
      cache = new Map();
      this.leafCaches.set(node.key, cache);
    }
    const existing = cache.get(blockIdx);
    const fetchKey = `leaf:${node.key}:${blockIdx}`;
    // Non-force: coalesce onto the in-flight request. Force (soft refresh /
    // column refill): mint a new fetch token so the stale reply is dropped.
    if (existing && existing.state === 'loading' && !force) {
      // B-C6 — same live-map re-resolution as the identical predicate in
      // `ensureRangeInner`, above; see its comment.
      return this.waitUntil(() => this.leafCaches.get(node.key)?.get(blockIdx)?.state !== 'loading' || gen !== this.dataGen);
    }
    const fetchId = (this.blockFetchSeq.get(fetchKey) ?? 0) + 1;
    this.blockFetchSeq.set(fetchKey, fetchId);
    // Keep prior rows visible while reloading (column-window refill). Wiping
    // to `[]` blanked the canvas between drop and success — black voids.
    const preserved = existing?.rows ?? [];
    // B-C8 — carry the prior failCount through the 'loading' placeholder so
    // a failure on THIS attempt can compute the next backoff step; clear
    // nextRetryAt since this attempt is the retry the backoff was gating.
    const preservedFailCount = existing?.failCount ?? 0;
    cache.set(blockIdx, {
      rows: preserved,
      state: 'loading',
      touch: ++this.touchClock,
      failCount: preservedFailCount,
      nextRetryAt: 0,
    });

    const startRow = blockIdx * this.blockSize;
    const endRow = Math.min(node.leafCount, startRow + this.blockSize);

    const run = (): Promise<void> => new Promise<void>((resolve) => {
      if (gen !== this.dataGen || this.host.isDestroyed()) {
        cache!.delete(blockIdx);
        // Only reachable via `isDestroyed()`-with-unchanged-gen (a `gen`
        // mismatch already went through `wakeOnGenChange()` at the bump
        // site) — wake here too so a waiter coalesced onto this exact
        // block doesn't sit until the controller's own `destroy()` bumps
        // `dataGen` for an unrelated reason. Consistent with "wake at every
        // state transition" rather than a documented exemption.
        this.wakeWaiters();
        resolve();
        return;
      }
      this.inflight++;
      const columnKeys = this.host.getColumnKeys?.();
      getLeafRows({
        request: {
          groupPath: node.path.slice(),
          startRow,
          endRow,
          sortModel: this.host.getSortModel(),
          filterModel: this.host.getFilterModel(),
          rowGroupCols: this.host.getRowGroupCols(),
          ...(columnKeys && columnKeys.length > 0 ? { columnKeys } : {}),
        },
        success: (result) => {
          // B-P5 — releases the slot to exactly one queued waiter (covers
          // the early-return branches below too); block-state waiters wake
          // separately once this block's new state is actually set.
          this.releaseSlot();
          if (
            gen !== this.dataGen
            || this.host.isDestroyed()
            || this.blockFetchSeq.get(fetchKey) !== fetchId
          ) {
            resolve();
            return;
          }
          // B-C6 — `cache` (closure-captured above) can reference a map
          // `dropGroupCache` already deleted from `this.leafCaches` (a soft
          // refresh whose skeleton fetch raced this leaf fetch and found the
          // group's leafCount changed). Writing into that detached map
          // strands the reply somewhere no future `ensureRange` will ever
          // look. Re-resolve the LIVE map by key — recreating it if the
          // drop left nothing behind — so the arriving data is visible on
          // the very next lookup instead of triggering a silent re-fetch.
          const liveCache = this.resolveLeafCache(node.key);
          const prevBlock = liveCache.get(blockIdx);
          const rows = this.mergeBlockRows(prevBlock?.rows, result.rowData);
          // A short / empty window (server still loading, count drift
          // between skeleton and leaves) must stay RETRYABLE — caching it
          // as 'loaded' turned a transient race into permanently blank
          // leaf rows. 'failed' blocks are refetched by the next
          // ensureRange / soft refresh; whatever rows DID arrive still
          // paint meanwhile (materialize reads rows regardless of state).
          const complete = rows.length >= endRow - startRow;
          // B-C8 — backoff protects against a misbehaving/erroring
          // datasource (the `fail()` callback below); ANY `success()` reply
          // — complete or a short/incomplete one — proves the datasource is
          // responsive, so it always clears backoff state, keeping a short
          // reply immediately retryable (pre-existing contract — see
          // "short/empty leaf results stay retryable").
          liveCache.set(blockIdx, {
            rows,
            state: complete ? 'loaded' : 'failed',
            touch: ++this.touchClock,
            failCount: 0,
            nextRetryAt: 0,
          });
          this.cacheEpoch++;
          this.evictIfNeeded();
          // B-P5 — this block's state just changed; wake anything waiting
          // on it (or on the concurrency slot the inflight-- above freed).
          this.wakeWaiters();
          resolve();
        },
        fail: () => {
          this.releaseSlot();
          // Guarded the same way as `success`, above — a late `fail()`
          // after a purge/destroy must not resurrect a cache entry
          // `destroy()`/purge just cleared (`resolveLeafCache` below would
          // otherwise recreate it in the live `leafCaches` map).
          if (
            gen !== this.dataGen
            || this.host.isDestroyed()
            || this.blockFetchSeq.get(fetchKey) !== fetchId
          ) {
            resolve();
            return;
          }
          // Same detached-map hazard as `success` (B-C6) — re-resolve
          // rather than writing through the closure-captured `cache`.
          const liveCache = this.resolveLeafCache(node.key);
          // B-C8 — per-block exponential backoff (1s/4s/15s, cap 60s).
          // Consulted only by `ensureRangeInner`/`ensureFlatRange` (the
          // "not re-fetched" half of the contract) — `forceReloadBand-
          // LeafBlocks`/`forceReloadFlatBlocks` (soft-refresh reload) skip
          // this check entirely and re-fetch every band block regardless of
          // `nextRetryAt`, so a persistently failing block is still
          // re-hammered once per soft refresh. Extending backoff to those
          // paths is a separate, deliberately out-of-scope change.
          const failCount = (liveCache.get(blockIdx)?.failCount ?? 0) + 1;
          liveCache.set(blockIdx, {
            rows: preserved,
            state: 'failed',
            touch: ++this.touchClock,
            failCount,
            nextRetryAt: Date.now() + retryBackoffMs(failCount),
          });
          this.cacheEpoch++;
          this.wakeWaiters();
          resolve();
        },
      });
    });

    // B-P5 — dedicated slot queue, not a `waitUntil` predicate (see its
    // block comment for why a broadcast wake would over-admit fetches).
    // Checked inline (not folded into `acquireSlot` alone) so the common
    // case — a slot is free — dispatches `run()` synchronously instead of
    // picking up an extra microtask tick from `.then()` on an
    // already-resolved promise; that tick previously shifted downstream
    // await timing enough to break a same-tick test assertion elsewhere
    // in this file (see `postHydrate`'s identical concern).
    if (this.inflight < this.maxConcurrent || gen !== this.dataGen) return run();
    return this.acquireSlot(gen).then(run);
  }

  /** Any block holding rows costs memory — 'loaded' AND 'failed' blocks
   *  keeping partial rows for paint. Counted on the fly: the previous
   *  incremental counter never saw failed partial blocks, so they
   *  accumulated unevictably until purge. */
  private evictIfNeeded(): void {
    const holdsRows = (b: LeafBlock<TRow>): boolean =>
      b.state === 'loaded' || (b.state === 'failed' && b.rows.length > 0);
    let count = 0;
    for (const cache of this.leafCaches.values()) {
      for (const block of cache.values()) if (holdsRows(block)) count++;
    }
    // B-L2 — ids of every row this pass drops, forwarded to the host so the
    // worker store + main mirror shed them too. Collected across the whole
    // while-loop so a multi-block trim costs one host round trip.
    const evictedRowIds: string[] = [];
    while (count > this.maxCachedLeafBlocks) {
      let lruKey = '';
      let lruIdx = -1;
      let lruTouch = Infinity;
      for (const [key, cache] of this.leafCaches) {
        for (const [idx, block] of cache) {
          if (holdsRows(block) && block.touch < lruTouch) {
            lruTouch = block.touch;
            lruKey = key;
            lruIdx = idx;
          }
        }
      }
      if (lruIdx < 0) break;
      const cache = this.leafCaches.get(lruKey);
      const victim = cache?.get(lruIdx);
      if (victim) {
        for (const row of victim.rows) {
          if (row == null) continue;
          try { evictedRowIds.push(this.host.getRowId(row)); } catch { /* unkeyable row — nothing downstream to drop */ }
        }
      }
      cache?.delete(lruIdx);
      // Emptied per-group maps go too — they leaked before (only
      // dropGroupCache removed them).
      if (cache && cache.size === 0) this.leafCaches.delete(lruKey);
      count--;
      this.cacheEpoch++;
    }
    if (evictedRowIds.length > 0) this.host.evictRows?.(evictedRowIds);
  }

  /** Fix wave 6 — the plan assumed evicted rows are always outside the
   *  loaded band "by construction"; that does not hold (see
   *  `evictIfNeeded`'s block comment above and B-L2 in the commit this
   *  warns about). When a single `ensureRange` call spans more distinct
   *  leaf blocks than `maxCachedLeafBlocks`, the LRU trim that follows
   *  each block's load can evict a block still inside THIS SAME band —
   *  rows that were painting go blank until the next viewport request,
   *  and a viewport that never shrinks below the cap can thrash
   *  (fetch → evict → blank → refetch) every scroll. Same shape/prefix as
   *  the sub-8-floor warning in the constructor above. */
  private warnInBandEviction(blockCount: number): void {
    if (this.inBandEvictionWarned) return;
    this.inBandEvictionWarned = true;
    console.warn(
      `[velocity-grid] the requested row range spans ${blockCount} leaf blocks, more than `
      + `serverSideMaxCachedLeafBlocks (${this.maxCachedLeafBlocks}); rows inside the visible `
      + 'band can be evicted and go blank until the next viewport request. Raise '
      + 'serverSideMaxCachedLeafBlocks to cover the widest viewport band.',
    );
  }

  private dropBandLeafBlocks(rowStart: number, rowEnd: number): void {
    const index = this.index;
    if (!index) return;
    for (const entry of index.entriesInRange(rowStart, rowEnd)) {
      if (entry.kind !== 'leaf') continue;
      const blockIdx = Math.floor(entry.leafOffset / this.blockSize);
      const cache = this.leafCaches.get(entry.node.key);
      const block = cache?.get(blockIdx);
      if (block) {
        cache!.delete(blockIdx);
        this.cacheEpoch++;
      }
    }
  }

  /** Re-fetch leaf blocks in the band while keeping prior rows on screen. */
  private async forceReloadBandLeafBlocks(
    rowStart: number,
    rowEnd: number,
    gen: number,
  ): Promise<void> {
    const index = this.index;
    if (!index) return;
    const seen = new Set<string>();
    const loads: Array<Promise<void>> = [];
    for (const entry of index.entriesInRange(rowStart, rowEnd)) {
      if (entry.kind !== 'leaf') continue;
      const blockIdx = Math.floor(entry.leafOffset / this.blockSize);
      const tag = `${entry.node.key}\u0000${blockIdx}`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      loads.push(this.loadLeafBlock(entry.node, blockIdx, gen, true));
    }
    if (loads.length > 0) await Promise.all(loads);
  }

  // ─── flat fallback (no grouping) ─────────────────────────────────────

  private flatCache(): Map<number, LeafBlock<TRow>> {
    let cache = this.leafCaches.get('');
    if (!cache) {
      cache = new Map();
      this.leafCaches.set('', cache);
    }
    return cache;
  }

  private dropFlatBlocks(rowStart: number, rowEnd: number): void {
    const cache = this.flatCache();
    const first = Math.floor(Math.max(0, rowStart) / this.blockSize);
    const last = Math.floor(Math.max(rowStart, rowEnd - 1) / this.blockSize);
    for (let b = first; b <= last; b++) {
      if (cache.delete(b)) this.cacheEpoch++;
    }
  }

  /** Re-fetch flat blocks in the band while keeping prior rows on screen. */
  private async forceReloadFlatBlocks(
    rowStart: number,
    rowEnd: number,
    gen: number,
  ): Promise<void> {
    const first = Math.floor(Math.max(0, rowStart) / this.blockSize);
    const last = Math.floor(Math.max(rowStart, rowEnd - 1) / this.blockSize);
    const loads: Array<Promise<void>> = [];
    for (let b = first; b <= last; b++) {
      loads.push(this.loadFlatBlock(b, gen, true));
    }
    if (loads.length > 0) await Promise.all(loads);
  }

  private async ensureFlatRange(rowStart: number, rowEnd: number, gen: number): Promise<void> {
    const ds = this.datasource;
    if (!ds) return;
    // Snapshot alongside `gen` (B-C4) — flat mode never sets `this.index`,
    // so this is normally null, but capturing it here (rather than
    // re-reading `this.index` at send time) is what makes `postHydrate`'s
    // check meaningful if a grouped toggle races in mid-flight.
    const index = this.index;
    const start = Math.max(0, Math.floor(rowStart));
    const end = Math.max(start + 1, Math.ceil(rowEnd));
    const first = Math.floor(start / this.blockSize);
    const last = Math.floor(Math.max(start, end - 1) / this.blockSize);
    const cache = this.flatCache();

    // Fix wave 6 — flat-path counterpart of the grouped-path check in
    // `ensureRangeInner`; see `warnInBandEviction`.
    const bandBlocks = last - first + 1;
    if (bandBlocks > this.maxCachedLeafBlocks) this.warnInBandEviction(bandBlocks);

    const loads: Array<Promise<void>> = [];
    for (let b = first; b <= last; b++) {
      const cur = cache.get(b);
      if (cur?.state === 'loading') {
        // Overlapping ensureRange during fast V-scroll — wait, don't hydrate
        // empty slots under a still-loading block.
        loads.push(this.waitUntil(
          () => cache.get(b)?.state !== 'loading' || gen !== this.dataGen,
        ));
        continue;
      }
      // B-C8 — a 'failed' block within its backoff window is left alone
      // (see `ensureRangeInner`'s identical comment).
      if (cur?.state === 'failed' && cur.nextRetryAt > Date.now()) continue;
      if (cur && cur.state !== 'failed') continue;
      loads.push(this.loadFlatBlock(b, gen));
    }
    if (loads.length > 0) await Promise.all(loads);
    if (gen !== this.dataGen || this.host.isDestroyed()) return;

    const prev = this.reportedRowCount;
    if (this.flatRowCount !== prev) {
      this.reportedRowCount = this.flatRowCount;
      this.host.setRowCount(this.reportedRowCount, prev);
    }

    // Hydrate contiguous loaded runs only — never push an empty window that
    // races paint (was: hydrateWindow(0, [], count) while blocks still empty).
    const hi = this.flatRowCount > 0 ? Math.min(this.flatRowCount, end) : end;
    let run: TRow[] = [];
    let runStart = start;
    const flush = async (): Promise<void> => {
      if (run.length === 0) return;
      await this.postHydrate(
        runStart,
        run,
        Math.max(this.flatRowCount, runStart + run.length),
        false,
        gen,
        index,
      );
      run = [];
    };
    for (let i = start; i < hi; i++) {
      const row = cache.get(Math.floor(i / this.blockSize))?.rows[i % this.blockSize];
      if (row === undefined) {
        await flush();
        runStart = i + 1;
        continue;
      }
      if (run.length === 0) runStart = i;
      run.push(row);
    }
    await flush();
  }

  private loadFlatBlock(blockIdx: number, gen: number, force = false): Promise<void> {
    const ds = this.datasource;
    if (!ds) return Promise.resolve();
    const cache = this.flatCache();
    const existing = cache.get(blockIdx);
    const fetchKey = `flat:${blockIdx}`;
    // Non-force: coalesce onto the in-flight request. Force (soft refresh /
    // column-window refill): mint a new fetch token so a stale in-flight
    // reply cannot satisfy the reload (was: waitUntil loading → wrong band).
    if (existing && existing.state === 'loading' && !force) {
      return this.waitUntil(() => cache.get(blockIdx)?.state !== 'loading' || gen !== this.dataGen);
    }
    const fetchId = (this.blockFetchSeq.get(fetchKey) ?? 0) + 1;
    this.blockFetchSeq.set(fetchKey, fetchId);
    // Preserve painted rows while the column-window (or soft) reload is in
    // flight — empty loading rows were the flicker/void source.
    const preserved = existing?.rows ?? [];
    // B-C8 — see `loadLeafBlock`'s identical comment.
    const preservedFailCount = existing?.failCount ?? 0;
    cache.set(blockIdx, {
      rows: preserved,
      state: 'loading',
      touch: ++this.touchClock,
      failCount: preservedFailCount,
      nextRetryAt: 0,
    });
    const startRow = blockIdx * this.blockSize;
    const endRow = startRow + this.blockSize;

    const run = (): Promise<void> => new Promise<void>((resolve) => {
      if (gen !== this.dataGen || this.host.isDestroyed()) {
        cache.delete(blockIdx);
        // Same reasoning as the grouped-path twin above: only reachable via
        // `isDestroyed()`-with-unchanged-gen (a `gen` mismatch already went
        // through `wakeOnGenChange()` at the bump site) — wake here too so
        // a waiter coalesced onto this exact block doesn't sit until the
        // controller's own `destroy()` bumps `dataGen` for an unrelated
        // reason.
        this.wakeWaiters();
        resolve();
        return;
      }
      this.inflight++;
      const columnKeys = this.host.getColumnKeys?.();
      ds.getRows({
        request: {
          startRow,
          endRow,
          sortModel: this.host.getSortModel(),
          filterModel: this.host.getFilterModel(),
          rowGroupCols: [],
          groupKeys: [],
          expandedGroupKeys: [],
          ...(columnKeys && columnKeys.length > 0 ? { columnKeys } : {}),
        },
        success: (result) => {
          // B-P5 — see the identical comment in `loadLeafBlock`'s success.
          this.releaseSlot();
          if (
            gen !== this.dataGen
            || this.host.isDestroyed()
            || this.blockFetchSeq.get(fetchKey) !== fetchId
          ) {
            resolve();
            return;
          }
          const requested = Math.max(0, endRow - startRow);
          const prevFlatCount = this.flatRowCount;
          const prevExact = this.flatRowCountExact;
          if (typeof result.rowCount === 'number' && Number.isFinite(result.rowCount)) {
            this.flatRowCount = Math.max(0, result.rowCount);
            this.flatRowCountExact = true;
            this.flatRowCountSource = 'declared';
          } else if (result.rowData.length < requested) {
            // Short window and no declared total = end of book, AS FAR AS
            // THIS REPLY SHOWS. Clamp the count EXACTLY and stop
            // over-allocating, so no further block is requested past this
            // edge — but record the clamp as INFERRED, not declared: unlike
            // a declared total, it must still be able to re-inflate below if
            // a later full-window reply proves it wrong (the short reply was
            // transient — server still settling — or the book genuinely
            // grew since). Folding both provenances into one boolean used to
            // make this one-way, so a transient short reply permanently
            // truncated the book.
            this.flatRowCount = startRow + result.rowData.length;
            this.flatRowCountExact = true;
            this.flatRowCountSource = 'inferred';
          } else if (
            this.flatRowCountSource === 'unknown'
            || (
              // A prior INFERRED clamp only gets to be re-opened by a reply
              // that actually reaches (or passes) the edge it pinned — one
              // for the SAME block coming back fuller, or a later block
              // proving the book grew past it. A full-window reply for some
              // OTHER, already-covered block (e.g. an unrelated soft-refresh
              // band) proves nothing about that edge and must not demote an
              // otherwise-still-accurate inferred count back to "estimated".
              // Strictly-greater (not >=): with block-aligned fetches, a
              // full-window reply can land EXACTLY on the pinned edge only
              // when an empty-tail pin (k=0) is followed by a re-fetch of
              // the immediately preceding block — which proves nothing
              // about the true edge, so `>=` would reopen an otherwise-
              // accurate pin at that one boundary.
              this.flatRowCountSource === 'inferred'
              && startRow + result.rowData.length > this.flatRowCount
            )
          ) {
            // Full window, and the count is not a DECLARED fact — over-
            // allocate ONE block past the loaded edge so the viewport can
            // scroll into it and trigger the next fetch. Without this the
            // reported count equals the loaded edge exactly and infinite
            // scroll dead-ends at the first block (B-C3). Re-inflating also
            // demotes the count back to an estimate — a declared total is
            // the only provenance that stays one-way.
            this.flatRowCount = Math.max(
              this.flatRowCount,
              startRow + result.rowData.length + this.blockSize,
            );
            this.flatRowCountExact = false;
            this.flatRowCountSource = 'unknown';
          }
          // v1-parity safety net (migrated from the decommissioned
          // controller): an EXACT total that differs from a previously exact
          // one means the server book shifted under the cache — blocks
          // loaded against the old total would rehydrate stale rows at moved
          // offsets. Drop them so scroll refetches. Estimate growth (the
          // `flatRowCountExact = false` branch above) is not exact-to-exact,
          // so unknown-count discovery never thrashes this.
          //
          // Scope (Q1, fix-wave-4): `loadFlatBlock` serves ANY datasource
          // with no active group model — not only `getRows`-only ones. A
          // skeleton-capable datasource (`getGroupSkeleton` present) that is
          // currently ungrouped also lands here, e.g. Perspective's flat
          // fallback (`createPerspectiveSsrmDatasource`), which declares
          // `rowCount` on every reply and whose book resizes on live
          // add/remove. So on an ungrouped ticking grid, every soft refresh
          // whose band reload reports a changed total drops ALL other loaded
          // flat blocks too — not just for plain getRows-only datasources.
          // This is intentional, not an oversight: without knowing WHERE in
          // the book the shift happened, dropping everything off-band is the
          // only safe choice (the alternative — stale rows painted at
          // shifted offsets — is the defect this net exists to prevent). The
          // cost is real: the off-band cache degrades to the viewport band
          // on every such tick, and scrolling back re-fetches it. Left
          // ungated deliberately rather than narrowed to non-skeleton
          // datasources, so ungrouped skeleton datasources keep the same
          // protection non-skeleton ones get.
          if (
            prevExact
            && this.flatRowCountExact
            && prevFlatCount > 0
            && prevFlatCount !== this.flatRowCount
          ) {
            for (const [idx, blk] of cache) {
              if (idx !== blockIdx && blk.state === 'loaded') {
                cache.delete(idx);
                this.cacheEpoch++;
              }
            }
          }
          // Flat mode has no skeleton root — the datasource may carry
          // grand totals on the load reply instead.
          if (result.grandTotals !== undefined) {
            this.host.setGrandTotals?.(result.grandTotals);
          }
          const prevBlock = cache.get(blockIdx);
          const rows = this.mergeBlockRows(prevBlock?.rows, result.rowData);
          // Same retryable rule as the grouped leaf path: a window shorter
          // than the reported rowCount implies (server still settling) must
          // NOT cache as 'loaded' — that turns a transient race into
          // permanently blank rows. Whatever arrived still paints; 'failed'
          // is refetched by the next ensureRange / soft refresh.
          const expected = Math.max(0, Math.min(this.blockSize, this.flatRowCount - startRow));
          const complete = rows.length >= expected;
          // B-C8 — same success-always-clears-backoff rule as the grouped
          // leaf path (see its comment): only the `fail()` callback below
          // counts toward the backoff schedule.
          cache.set(blockIdx, {
            rows,
            state: complete ? 'loaded' : 'failed',
            touch: ++this.touchClock,
            failCount: 0,
            nextRetryAt: 0,
          });
          this.evictIfNeeded();
          // B-P5 — see the identical comment in `loadLeafBlock`'s success.
          this.wakeWaiters();
          resolve();
        },
        fail: () => {
          this.releaseSlot();
          if (this.blockFetchSeq.get(fetchKey) !== fetchId) {
            resolve();
            return;
          }
          // B-C8 — per-block exponential backoff (1s/4s/15s, cap 60s).
          const failCount = (cache.get(blockIdx)?.failCount ?? 0) + 1;
          cache.set(blockIdx, {
            rows: preserved,
            state: 'failed',
            touch: ++this.touchClock,
            failCount,
            nextRetryAt: Date.now() + retryBackoffMs(failCount),
          });
          this.wakeWaiters();
          resolve();
        },
      });
    });

    // B-P5 — dedicated slot queue, not a `waitUntil` predicate (see its
    // block comment for why a broadcast wake would over-admit fetches).
    // Checked inline (not folded into `acquireSlot` alone) so the common
    // case — a slot is free — dispatches `run()` synchronously instead of
    // picking up an extra microtask tick from `.then()` on an
    // already-resolved promise; that tick previously shifted downstream
    // await timing enough to break a same-tick test assertion elsewhere
    // in this file (see `postHydrate`'s identical concern).
    if (this.inflight < this.maxConcurrent || gen !== this.dataGen) return run();
    return this.acquireSlot(gen).then(run);
  }

  // ─── assembly + hydrate ──────────────────────────────────────────────

  /** Materialize a flattened entry into a paint-ready row (or null when its
   *  leaf block isn't cached). Group rows always materialize. */
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
      // In-scroll grand total — CSRM parity: a footer with an empty key
      // paints `Total` and resolves its values through `chunk.totals`
      // (fed by ssrmSetGrandTotals on the sparse path).
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
    const block = this.leafCaches.get(entry.node.key)?.get(blockIdx);
    // Paint whatever rows a block holds even when it's marked 'failed'
    // (short result pending retry) — partial beats blank.
    if (!block) return null;
    block.touch = ++this.touchClock;
    const leaf = block.rows[entry.leafOffset - blockIdx * this.blockSize];
    if (leaf === undefined) return null;
    return attachSsrmRowMeta(leaf as Record<string, unknown>, {
      kind: 'leaf',
      key: entry.node.key,
      depth: Math.min(entry.node.depth + 1, rowGroupCols.length),
      label: '',
    }) as TRow;
  }

  /**
   * B-C4 — single serialized dispatcher for every `host.hydrateWindow`
   * post. Callers snapshot their own generation (`dataGen`) and, on the
   * grouped/skeleton path, the `FlattenIndex` identity the window was
   * computed against, at the point they decided the data was fresh; this
   * method re-validates that snapshot immediately before the actual post —
   * "at send time", not merely between an enclosing loop's iterations — so
   * a window computed off a generation the controller has since moved past
   * can never reach the worker. This is the one seam `refreshExpansion`'s
   * same-frame fire-and-forget reflow posts through too (it calls
   * `hydrateRange`, below, which routes every send here): that reflow
   * paints outside the serialized op chain (`this.chain`) on purpose — a
   * queued soft refresh must not block the chevron — so its sends need
   * this out-of-band check instead of the chain's ordering guarantee.
   */
  private postHydrate(
    startRow: number,
    rows: TRow[],
    rowCount: number,
    reset: boolean,
    gen: number,
    index: FlattenIndex | null,
  ): Promise<void> {
    // Deliberately NOT `async` — an async wrapper would resolve its
    // `Promise.resolve(undefined)` fast path (and the `await` inside it)
    // one microtask tick later than calling `host.hydrateWindow` directly,
    // shifting every caller's downstream await timing. Returning the
    // callee's promise (or an already-resolved one) verbatim keeps this
    // gate timing-neutral for callers that awaited `host.hydrateWindow`
    // directly before this dispatcher existed.
    if (gen !== this.dataGen || this.index !== index || this.host.isDestroyed()) {
      return Promise.resolve();
    }
    return this.host.hydrateWindow(startRow, rows, rowCount, reset);
  }

  /** Hydrate [start, end) from skeleton + caches as contiguous runs, plus
   *  the ancestor group rows above `start` so the sticky band always has
   *  its chain hydrated. */
  private async hydrateRange(rowStart: number, rowEnd: number): Promise<void> {
    const index = this.index;
    if (!index || this.host.isDestroyed()) return;
    // Every flush() below is a worker round-trip; a purge (dataGen bump)
    // or a toggle's same-frame index swap can land between awaits. Stale
    // hydrates must not reach the worker — they would reset ssrmRowCount
    // to the old count and place rows at indices of the dead tree (the
    // flat path has the same guard). The loop-level checks below stop
    // wasted materialize() work early; `postHydrate` is the send-time gate
    // that actually matters.
    const gen = this.dataGen;
    const stale = (): boolean =>
      gen !== this.dataGen || this.index !== index || this.host.isDestroyed();
    const rowCount = index.rowCount;
    const start = Math.max(0, Math.floor(rowStart));
    const end = Math.min(rowCount, Math.max(start, Math.ceil(rowEnd)));
    // Window-identity suppression — same window, same index (expansion /
    // skeleton unchanged), same data generation, no cache mutations since
    // the last hydrate → the worker already holds exactly these rows.
    const last = this.lastHydrate;
    if (
      last !== null
      && last.start === start
      && last.end === end
      && last.index === index
      && last.dataGen === this.dataGen
      && last.cacheEpoch === this.cacheEpoch
    ) {
      return;
    }
    const expanded = new Set(this.host.getExpandedGroupKeys());

    const entries = index.entriesInRange(start, end);
    let run: TRow[] = [];
    let runStart = start;
    let cursor = start;
    const flush = async (): Promise<void> => {
      if (run.length > 0) {
        await this.postHydrate(runStart, run, rowCount, false, gen, index);
        run = [];
      }
    };
    for (const entry of entries) {
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
      await this.postHydrate(0, [], 0, false, gen, index);
      return;
    }

    // Sticky chain — ancestors above the hydrated window.
    for (const anc of index.ancestorsOf(start)) {
      if (anc.index >= start) continue;
      const row = this.materialize({ kind: 'group', node: anc.node }, expanded);
      if (row !== null) {
        await this.postHydrate(anc.index, [row], rowCount, false, gen, index);
      }
      if (stale()) return;
    }

    this.lastHydrate = { start, end, index, dataGen: this.dataGen, cacheEpoch: this.cacheEpoch };
  }

  /** B-P5 — pending `waitUntil` predicates, re-checked on demand instead of
   *  polled. `wakeWaiters()` is called at every site that could flip one:
   *  block-state transitions (`loadLeafBlock`/`loadFlatBlock` success/fail)
   *  and `dataGen` bumping (covers every waiter's `gen !== this.dataGen`
   *  escape hatch in one call, including destroy — see `destroy()`, which
   *  is what guarantees every waiter here is eventually settled and never
   *  leaks a pending promise).
   *
   *  This is a broadcast: EVERY waiter whose predicate currently passes is
   *  resolved in the same synchronous pass. That's correct for these
   *  observer-style waiters (multiple callers coalesced onto "block X left
   *  'loading'" all deserve to wake together — nothing is consumed by
   *  waking one of them). It would be WRONG for the concurrency slot below
   *  (`acquireSlot`/`releaseSlot`) — a scarce resource, where broadcasting
   *  to every waiter whose `inflight < maxConcurrent` check reads the
   *  not-yet-decremented count in the same pass would let more fetches
   *  start than `maxConcurrentDatasourceRequests` allows (`inflight` isn't
   *  re-incremented until each waiter's own `.then(run)` continuation runs
   *  — a LATER microtask, invisible to this loop). That's why slots get
   *  their own one-at-a-time queue instead of reusing this broadcast. */
  private readonly waiters = new Set<{ pred: () => boolean; resolve: () => void }>();

  private waitUntil(pred: () => boolean): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.add({ pred, resolve });
    });
  }

  /** Re-check every pending `waitUntil` predicate; settle and drop any that
   *  now pass. Cheap to over-call — the waiter set is bounded by in-flight
   *  fetches, not by dataset size. */
  private wakeWaiters(): void {
    if (this.waiters.size === 0) return;
    for (const w of this.waiters) {
      if (w.pred()) {
        this.waiters.delete(w);
        w.resolve();
      }
    }
  }

  /** FIFO queue of callers waiting on a concurrency slot (B-P5) — see the
   *  block comment above `waiters` for why this can't just be another
   *  `waitUntil` predicate. */
  private readonly slotWaiters: Array<{ gen: number; resolve: () => void }> = [];

  /** Resolves once a fetch slot is available for generation `gen` (or
   *  immediately if `gen` is already stale — no point queuing doomed
   *  work). Callers must `this.inflight++` themselves once this resolves,
   *  exactly as the pre-existing `run()` bodies already do. */
  private acquireSlot(gen: number): Promise<void> {
    if (this.inflight < this.maxConcurrent || gen !== this.dataGen) return Promise.resolve();
    return new Promise((resolve) => {
      this.slotWaiters.push({ gen, resolve });
    });
  }

  /** Decrement `inflight` and hand the freed slot to exactly one queued
   *  waiter — never a broadcast (see `waiters`'s comment). A waiter whose
   *  generation is already stale is drained for free (its `run()` aborts
   *  without ever calling `this.inflight++`, so it wouldn't consume the
   *  slot anyway) and the search continues until a live waiter claims it
   *  or the queue empties. `isDestroyed()` drains the whole queue — no
   *  more fetches will ever start, so nothing further is worth waiting for. */
  private releaseSlot(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    while (this.slotWaiters.length > 0) {
      const next = this.slotWaiters.shift()!;
      const live = next.gen === this.dataGen && !this.host.isDestroyed();
      next.resolve();
      if (live) break;
    }
  }

  /** Called at every `dataGen` bump (purge, destroy) — wakes the generic
   *  `waitUntil` broadcast AND drains every queued slot waiter. Slot
   *  waiters can't rely on a LATER `releaseSlot()` to flush them: if the
   *  fetch ahead of them in the queue never settles (destroyed mid-flight
   *  with the datasource never calling back — the exact scenario a
   *  destroy must not hang on), nothing would ever call `releaseSlot()`
   *  again to drain them. Every queued slot waiter's captured `gen` is
   *  necessarily stale the instant `dataGen` moves past it, so resolving
   *  them all here immediately is always safe — their `run()` continuation
   *  will see the mismatch and abort without consuming a slot, exactly
   *  like a live `releaseSlot()` drain would have done for them anyway. */
  private wakeOnGenChange(): void {
    this.wakeWaiters();
    while (this.slotWaiters.length > 0) this.slotWaiters.shift()!.resolve();
  }
}
