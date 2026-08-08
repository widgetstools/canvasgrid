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

import type {
  IServerSideDatasourceV2,
  RefreshServerSideParams,
  ServerSideTransaction,
} from '../types/ssrm';
import type { SsrmHost } from './serverSideRowModel';
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

/** V2 host — v1 seam plus exact-group-key replacement (expandAll etc.). */
export interface SsrmHostV2<TRow> extends SsrmHost<TRow> {
  /** Replace (not merge) the known composite group keys from the skeleton. */
  setGroupKeys?(keys: string[]): void;
  /** Install host-computed grand totals (skeleton root aggregates, keyed
   *  by FIELD) in the worker — drives the pinned totals subgrid and the
   *  in-scroll grand-total footer. `null` clears. */
  setGrandTotals?(totals: Record<string, unknown> | null): void;
}

interface LeafBlock<TRow> {
  rows: TRow[];
  state: 'loading' | 'loaded' | 'failed';
  /** LRU clock — larger = touched more recently. */
  touch: number;
}

export class ServerSideRowModelV2Controller<TRow = any> {
  private datasource: IServerSideDatasourceV2<TRow> | null = null;

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
  private reportedRowCount = 0;

  /** Bumped on purge (sort/filter/groupBy/datasource change) — leaf and
   *  skeleton results from an older generation are discarded. Expansion
   *  changes do NOT bump it: leaf data is expansion-independent. */
  private dataGen = 0;
  private inflight = 0;
  private chain: Promise<void> = Promise.resolve();

  private readonly blockSize: number;
  private readonly maxConcurrent: number;
  private readonly maxCachedLeafBlocks: number;
  private readonly rowIdField: string;
  private readonly groupTotalRow: 'top' | 'bottom' | null;
  private readonly grandTotalRow: 'top' | 'bottom' | null;
  private readonly maintainOrder: boolean;
  /** Previous display position by key — pins sibling order across skeleton
   *  refetches when `maintainOrder` is on. */
  private prevOrder: Map<string, number> | null = null;
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
    },
  ) {
    this.rowIdField = opts.rowIdField;
    this.blockSize = Math.max(1, opts.cacheBlockSize ?? 100);
    this.maxConcurrent = Math.max(1, opts.maxConcurrentDatasourceRequests ?? 2);
    this.maxCachedLeafBlocks = Math.max(8, opts.maxCachedLeafBlocks ?? 500);
    this.groupTotalRow = opts.groupTotalRow ?? null;
    this.grandTotalRow = opts.grandTotalRow ?? null;
    this.maintainOrder = opts.maintainOrder === true;
  }

  setDatasource(ds: IServerSideDatasourceV2<TRow> | null): void {
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

  refresh(params: RefreshServerSideParams = {}): Promise<void> {
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
    if (soft && this.pendingSoftRefresh !== null) {
      return this.pendingSoftRefresh;
    }
    if (soft) {
      let p: Promise<void> | null = null;
      const run = (): Promise<void> => this.enqueue(async () => {
        if (this.pendingSoftRefresh === p) this.pendingSoftRefresh = null;
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
    return this.enqueue(() => this.refreshInner(params));
  }

  /** Conflation handle — at most one QUEUED soft refresh at a time. */
  private pendingSoftRefresh: Promise<void> | null = null;
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

  /** Expansion toggle — local reflow, then fill missing leaves. */
  refreshExpansion(): Promise<void> {
    return this.enqueue(() => this.refreshExpansionInner());
  }

  /** Full hydrate only exists for the flat fallback (client-pipeline
   *  bridge). Grouped v2 is natively sparse — nothing to fully hydrate.
   *  Returns false when hydration is refused so the caller must NOT
   *  enable the client pipeline over the sparse store. */
  async ensureFullyHydrated(): Promise<boolean> {
    if (this.host.getRowGroupCols().length > 0) {
      console.warn('[velocity-grid] SSRM v2: ensureFullyHydrated is unsupported while grouped — the skeleton path serves grouping natively');
      return false;
    }
    await this.enqueue(async () => {
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
      await this.host.hydrateWindow(0, rows, this.flatRowCount, true);
    });
    return true;
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
            const prevMeta = readSsrmRowMeta(block.rows[i]);
            const merged = prevMeta && !readSsrmRowMeta(next)
              ? attachSsrmRowMeta(next as Record<string, unknown>, prevMeta) as TRow
              : next;
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
      this.cacheEpoch++;
      this.flatRowCount = 0;
      this.host.setGrandTotals?.(null);
      await this.host.hydrateWindow(0, [], Math.max(this.reportedRowCount, 0), true);
      if (this.host.isDestroyed()) return;
      const band = this.refreshBand();
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (this.host.isDestroyed()) return;
      this.host.requestViewport();
      return;
    }
    // Soft refresh — live tick. Grouped: re-sync the skeleton (aggregates
    // and/or structure), refresh band leaves. Flat: refetch band blocks.
    const gen = this.dataGen;
    const band = this.refreshBand();
    if (this.grouped()) {
      const groups = await this.fetchSkeletonRaw();
      if (gen !== this.dataGen || this.host.isDestroyed()) return;
      if (groups !== null) this.ingestSkeleton(groups, /* soft */ true);
      this.dropBandLeafBlocks(band.rowStart, band.rowEnd);
    } else {
      this.dropFlatBlocks(band.rowStart, band.rowEnd);
    }
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

  private grouped(): boolean {
    return this.host.getRowGroupCols().length > 0;
  }

  private fetchSkeletonRaw(): Promise<import('../types/ssrm').SkeletonGroup[] | null> {
    const ds = this.datasource;
    if (!ds) return Promise.resolve(null);
    return new Promise((resolve) => {
      ds.getGroupSkeleton({
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
  private ingestSkeleton(
    groups: import('../types/ssrm').SkeletonGroup[],
    soft: boolean,
  ): void {
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

    // Collect missing leaf blocks for the range.
    const missing: Array<{ node: SkeletonNode; blockIdx: number }> = [];
    const seen = new Set<string>();
    for (const entry of index.entriesInRange(start, end)) {
      if (entry.kind !== 'leaf') continue;
      const blockIdx = Math.floor(entry.leafOffset / this.blockSize);
      const tag = `${entry.node.key}\u0000${blockIdx}`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      const block = this.leafCaches.get(entry.node.key)?.get(blockIdx);
      if (!block || block.state === 'failed') missing.push({ node: entry.node, blockIdx });
    }
    if (missing.length > 0) {
      await Promise.all(missing.map((m) => this.loadLeafBlock(m.node, m.blockIdx, gen)));
    }
    if (gen !== this.dataGen || this.host.isDestroyed()) return;
    await this.hydrateRange(start, end);
  }

  private loadLeafBlock(node: SkeletonNode, blockIdx: number, gen: number): Promise<void> {
    const ds = this.datasource;
    if (!ds) return Promise.resolve();
    let cache = this.leafCaches.get(node.key);
    if (!cache) {
      cache = new Map();
      this.leafCaches.set(node.key, cache);
    }
    const existing = cache.get(blockIdx);
    if (existing && existing.state === 'loading') {
      return this.waitUntil(() => cache!.get(blockIdx)?.state !== 'loading' || gen !== this.dataGen);
    }
    cache.set(blockIdx, { rows: [], state: 'loading', touch: ++this.touchClock });

    const startRow = blockIdx * this.blockSize;
    const endRow = Math.min(node.leafCount, startRow + this.blockSize);

    const run = (): Promise<void> => new Promise<void>((resolve) => {
      if (gen !== this.dataGen || this.host.isDestroyed()) {
        cache!.delete(blockIdx);
        resolve();
        return;
      }
      this.inflight++;
      ds.getLeafRows({
        request: {
          groupPath: node.path.slice(),
          startRow,
          endRow,
          sortModel: this.host.getSortModel(),
          filterModel: this.host.getFilterModel(),
          rowGroupCols: this.host.getRowGroupCols(),
        },
        success: (result) => {
          this.inflight = Math.max(0, this.inflight - 1);
          if (gen !== this.dataGen || this.host.isDestroyed()) {
            cache!.delete(blockIdx);
            resolve();
            return;
          }
          const rows = result.rowData.slice();
          // A short / empty window (server still loading, count drift
          // between skeleton and leaves) must stay RETRYABLE — caching it
          // as 'loaded' turned a transient race into permanently blank
          // leaf rows. 'failed' blocks are refetched by the next
          // ensureRange / soft refresh; whatever rows DID arrive still
          // paint meanwhile (materialize reads rows regardless of state).
          const complete = rows.length >= endRow - startRow;
          cache!.set(blockIdx, {
            rows,
            state: complete ? 'loaded' : 'failed',
            touch: ++this.touchClock,
          });
          this.cacheEpoch++;
          this.evictIfNeeded();
          resolve();
        },
        fail: () => {
          this.inflight = Math.max(0, this.inflight - 1);
          cache!.set(blockIdx, { rows: [], state: 'failed', touch: ++this.touchClock });
          this.cacheEpoch++;
          resolve();
        },
      });
    });

    if (this.inflight >= this.maxConcurrent) {
      return this.waitUntil(() => this.inflight < this.maxConcurrent || gen !== this.dataGen)
        .then(run);
    }
    return run();
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
      if (lruIdx < 0) return;
      const cache = this.leafCaches.get(lruKey);
      cache?.delete(lruIdx);
      // Emptied per-group maps go too — they leaked before (only
      // dropGroupCache removed them).
      if (cache && cache.size === 0) this.leafCaches.delete(lruKey);
      count--;
      this.cacheEpoch++;
    }
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

  private async ensureFlatRange(rowStart: number, rowEnd: number, gen: number): Promise<void> {
    const ds = this.datasource;
    if (!ds) return;
    const start = Math.max(0, Math.floor(rowStart));
    const end = Math.max(start + 1, Math.ceil(rowEnd));
    const first = Math.floor(start / this.blockSize);
    const last = Math.floor(Math.max(start, end - 1) / this.blockSize);
    const cache = this.flatCache();

    const loads: Array<Promise<void>> = [];
    for (let b = first; b <= last; b++) {
      const cur = cache.get(b);
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

    const hi = this.flatRowCount > 0 ? Math.min(this.flatRowCount, end) : end;
    const rows: TRow[] = [];
    let runStart = start;
    for (let i = start; i < hi; i++) {
      const row = cache.get(Math.floor(i / this.blockSize))?.rows[i % this.blockSize];
      if (row === undefined) break;
      rows.push(row);
    }
    if (rows.length > 0) {
      await this.host.hydrateWindow(
        runStart,
        rows,
        Math.max(this.flatRowCount, runStart + rows.length),
        false,
      );
    } else if (this.flatRowCount > 0) {
      await this.host.hydrateWindow(0, [], this.flatRowCount, false);
    }
  }

  private loadFlatBlock(blockIdx: number, gen: number): Promise<void> {
    const ds = this.datasource;
    if (!ds) return Promise.resolve();
    const cache = this.flatCache();
    const existing = cache.get(blockIdx);
    if (existing && existing.state === 'loading') {
      return this.waitUntil(() => cache.get(blockIdx)?.state !== 'loading' || gen !== this.dataGen);
    }
    cache.set(blockIdx, { rows: [], state: 'loading', touch: ++this.touchClock });
    const startRow = blockIdx * this.blockSize;
    const endRow = startRow + this.blockSize;

    const run = (): Promise<void> => new Promise<void>((resolve) => {
      if (gen !== this.dataGen || this.host.isDestroyed()) {
        cache.delete(blockIdx);
        resolve();
        return;
      }
      this.inflight++;
      ds.getRows({
        request: {
          startRow,
          endRow,
          sortModel: this.host.getSortModel(),
          filterModel: this.host.getFilterModel(),
          rowGroupCols: [],
          groupKeys: [],
          expandedGroupKeys: [],
        },
        success: (result) => {
          this.inflight = Math.max(0, this.inflight - 1);
          if (gen !== this.dataGen || this.host.isDestroyed()) {
            cache.delete(blockIdx);
            resolve();
            return;
          }
          if (typeof result.rowCount === 'number' && Number.isFinite(result.rowCount)) {
            this.flatRowCount = Math.max(0, result.rowCount);
          } else if (result.rowData.length > 0) {
            this.flatRowCount = Math.max(this.flatRowCount, startRow + result.rowData.length);
          }
          // Flat mode has no skeleton root — the datasource may carry
          // grand totals on the load reply instead.
          if (result.grandTotals !== undefined) {
            this.host.setGrandTotals?.(result.grandTotals);
          }
          const rows = result.rowData.slice();
          // Same retryable rule as the grouped leaf path: a window shorter
          // than the reported rowCount implies (server still settling) must
          // NOT cache as 'loaded' — that turns a transient race into
          // permanently blank rows. Whatever arrived still paints; 'failed'
          // is refetched by the next ensureRange / soft refresh.
          const expected = Math.max(0, Math.min(this.blockSize, this.flatRowCount - startRow));
          const complete = rows.length >= expected;
          cache.set(blockIdx, {
            rows,
            state: complete ? 'loaded' : 'failed',
            touch: ++this.touchClock,
          });
          this.evictIfNeeded();
          resolve();
        },
        fail: () => {
          this.inflight = Math.max(0, this.inflight - 1);
          cache.set(blockIdx, { rows: [], state: 'failed', touch: ++this.touchClock });
          resolve();
        },
      });
    });

    if (this.inflight >= this.maxConcurrent) {
      return this.waitUntil(() => this.inflight < this.maxConcurrent || gen !== this.dataGen)
        .then(run);
    }
    return run();
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
    // flat path has the same guard).
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
        await this.host.hydrateWindow(runStart, run, rowCount, false);
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
      await this.host.hydrateWindow(0, [], 0, false);
      return;
    }

    // Sticky chain — ancestors above the hydrated window.
    for (const anc of index.ancestorsOf(start)) {
      if (anc.index >= start) continue;
      const row = this.materialize({ kind: 'group', node: anc.node }, expanded);
      if (row !== null) {
        await this.host.hydrateWindow(anc.index, [row], rowCount, false);
      }
      if (stale()) return;
    }

    this.lastHydrate = { start, end, index, dataGen: this.dataGen, cacheEpoch: this.cacheEpoch };
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
}
