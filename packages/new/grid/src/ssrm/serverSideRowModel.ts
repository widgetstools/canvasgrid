/**
 * Single SSRM engine — sparse v2 skeleton + flat block cache + explicit pipeline hydrate.
 * Soft refresh is on-chain with adaptive pacing; merges by row id; pivot fail-closed when sparse.
 */
import {
  FlattenIndex,
  extractRootAggregates,
  toDisplayOrder,
  type SkeletonGroup,
  type SkeletonNode,
} from './flattenIndex';
import {
  SSRM_FOOTER_ROW_ID_PREFIX,
  SSRM_GRAND_TOTAL_ROW_ID,
  SSRM_GROUP_ROW_ID_PREFIX,
} from './groupKeys';
import { mergeRowFields } from './mergeRowFields';
import { resultRows, type IServerSideDatasourceV2 } from './types';

type BlockState = 'loading' | 'loaded' | 'failed';

type LeafBlock<T> = {
  rows: T[];
  state: BlockState;
  touch: number;
};

export type SsrmHost<T> = {
  getRowId: (row: T) => string;
  isDestroyed: () => boolean;
  hydrateWindow: (start: number, rows: T[], rowCount: number, replace: boolean) => void | Promise<void>;
  getRowGroupCols: () => string[];
  getExpandedGroupKeys: () => string[];
  getSortModel: () => Array<{ colId: string; direction: 'asc' | 'desc' }>;
  getFilterModel: () => Record<string, unknown>;
  getQuickFilterText?: () => string;
  getColumnKeys?: () => string[] | null;
  getRefreshRange?: () => { rowStart: number; rowEnd: number };
  setRowCount?: (count: number, prev: number) => void;
  setGroupKeys?: (keys: string[]) => void;
  setGrandTotals?: (totals: Record<string, unknown> | null) => void;
  requestViewport?: () => void;
  isSparse: () => boolean;
  wantsClientPipeline: () => boolean;
};

export class ServerSideRowModel<T extends Record<string, unknown>> {
  private datasource: IServerSideDatasourceV2<T> | null = null;

  private skeleton: SkeletonNode[] | null = null;
  private groupBaseRows = new Map<string, T>();
  private index: FlattenIndex | null = null;
  private lastExpanded: ReadonlySet<string> = new Set();

  private readonly leafCaches = new Map<string, Map<number, LeafBlock<T>>>();
  private touchClock = 0;
  private cacheEpoch = 0;
  private lastHydrate: {
    start: number;
    end: number;
    index: FlattenIndex | null;
    dataGen: number;
    cacheEpoch: number;
  } | null = null;

  private flatRowCount = 0;
  private reportedRowCount = 0;
  private dataGen = 0;
  private inflight = 0;
  private opChain: Promise<void> = Promise.resolve();
  private pendingSoftRefresh: Promise<void> | null = null;
  private lastSoftRefreshEnd = 0;
  private softRefreshDurations: number[] = [];
  private fullyHydrated = false;
  private prevOrder: Map<string, number> | null = null;
  private grandTotals: Record<string, unknown> | null = null;

  private readonly blockSize: number;
  private readonly maxConcurrent: number;
  private readonly maxCachedLeafBlocks: number;
  private readonly rowIdField: string;
  private readonly groupTotalRow: 'top' | 'bottom' | null;
  private readonly grandTotalRow: 'top' | 'bottom' | null;
  private readonly maintainOrder: boolean;

  constructor(
    private readonly host: SsrmHost<T>,
    opts?: {
      cacheBlockSize?: number;
      maxConcurrentDatasourceRequests?: number;
      maxCachedLeafBlocks?: number;
      rowIdField?: string;
      groupTotalRow?: 'top' | 'bottom' | null;
      grandTotalRow?: 'top' | 'bottom' | null;
      maintainOrder?: boolean;
    },
  ) {
    this.blockSize = Math.max(1, opts?.cacheBlockSize ?? 100);
    this.maxConcurrent = Math.max(1, opts?.maxConcurrentDatasourceRequests ?? 2);
    this.maxCachedLeafBlocks = Math.max(8, opts?.maxCachedLeafBlocks ?? 500);
    this.rowIdField = opts?.rowIdField ?? 'id';
    this.groupTotalRow = opts?.groupTotalRow ?? null;
    this.grandTotalRow = opts?.grandTotalRow ?? null;
    this.maintainOrder = opts?.maintainOrder === true;
  }

  setDatasource(ds: IServerSideDatasourceV2<T> | null): void {
    this.datasource?.destroy?.();
    this.datasource = ds;
    void this.refresh({ purge: true });
  }

  getRowCount(): number {
    return this.reportedRowCount;
  }

  getCacheEpoch(): number {
    return this.cacheEpoch;
  }

  getDataGen(): number {
    return this.dataGen;
  }

  isFullyHydrated(): boolean {
    return this.fullyHydrated;
  }

  getSkeleton(): SkeletonNode[] {
    return this.skeleton?.slice() ?? [];
  }

  getGrandTotals(): Record<string, unknown> | null {
    return this.grandTotals;
  }

  /** Fail closed: sparse SSRM cannot pivot. */
  assertPivotAllowed(): boolean {
    if (this.host.isSparse()) {
      console.warn(
        '[vg-new-grid] Pivot mode is not supported on sparse SSRM. '
        + 'Use clientSide, or set serverSideEnableClientSidePipeline: true (full hydrate).',
      );
      return false;
    }
    return true;
  }

  ensureRange(rowStart: number, rowEnd: number): Promise<void> {
    return this.enqueue(() => this.ensureRangeInner(rowStart, rowEnd));
  }

  /** Local expansion reflow — no purge, no skeleton refetch. */
  refreshExpansion(): Promise<void> {
    return this.enqueue(() => this.refreshExpansionInner());
  }

  /**
   * Horizontal column-window refill — re-fetch viewport band with latest columnKeys.
   * Keeps prior rows painted (no blanking).
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
      this.lastHydrate = null;
      this.cacheEpoch++;
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (this.host.isDestroyed()) return;
      this.host.requestViewport?.();
    });
  }

  refresh(params: { purge?: boolean } = {}): Promise<void> {
    const soft = params.purge === false;
    if (soft && this.pendingSoftRefresh !== null) return this.pendingSoftRefresh;
    if (soft) {
      let p: Promise<void> | null = null;
      const run = (): Promise<void> => this.enqueue(async () => {
        if (this.pendingSoftRefresh === p) this.pendingSoftRefresh = null;
        const genAtStart = this.dataGen;
        const wait = Math.max(0, this.lastSoftRefreshEnd + this.softRefreshAvgMs() - Date.now());
        if (wait > 16) await new Promise<void>((r) => { setTimeout(r, wait); });
        if (this.host.isDestroyed() || genAtStart !== this.dataGen) return;
        const t0 = Date.now();
        try {
          await this.refreshInner(false);
        } finally {
          this.lastSoftRefreshEnd = Date.now();
          this.softRefreshDurations.push(this.lastSoftRefreshEnd - t0);
          if (this.softRefreshDurations.length > 5) this.softRefreshDurations.shift();
        }
      });
      p = run();
      this.pendingSoftRefresh = p;
      return p;
    }
    this.pendingSoftRefresh = null;
    return this.enqueue(() => this.refreshInner(true));
  }

  async ensureFullyHydrated(): Promise<boolean> {
    if (this.host.getRowGroupCols().length > 0) {
      console.warn('[vg-new-grid] ensureFullyHydrated unsupported while grouped');
      return false;
    }
    if (!this.host.wantsClientPipeline()) {
      console.warn(
        '[vg-new-grid] ensureFullyHydrated requires serverSideEnableClientSidePipeline: true',
      );
      return false;
    }
    let complete = false;
    await this.enqueue(async () => {
      if (this.flatRowCount <= 0) await this.ensureFlatRange(0, this.blockSize, this.dataGen);
      if (this.flatRowCount <= 0) return;
      await this.ensureFlatRange(0, this.flatRowCount, this.dataGen);
      const cache = this.flatCache();
      const rows: T[] = [];
      for (let i = 0; i < this.flatRowCount; i++) {
        const block = cache.get(Math.floor(i / this.blockSize));
        const row = block?.rows[i % this.blockSize];
        if (row === undefined) break;
        rows.push(row);
      }
      complete = rows.length === this.flatRowCount && this.flatRowCount > 0;
      if (complete) {
        this.fullyHydrated = true;
        await this.host.hydrateWindow(0, rows, this.flatRowCount, true);
      }
    });
    return complete;
  }

  applyTransaction(tx: { update?: T[]; rowCount?: number }): void {
    if (typeof tx.rowCount === 'number' && Number.isFinite(tx.rowCount)) {
      this.flatRowCount = Math.max(0, tx.rowCount);
      if (!this.grouped()) {
        const prev = this.reportedRowCount;
        this.reportedRowCount = this.flatRowCount;
        this.host.setRowCount?.(this.reportedRowCount, prev);
      }
    }
    if (!tx.update?.length) return;
    const byId = new Map(tx.update.map((r) => [this.host.getRowId(r), r]));
    for (const cache of this.leafCaches.values()) {
      for (const block of cache.values()) {
        for (let i = 0; i < block.rows.length; i++) {
          const id = this.host.getRowId(block.rows[i]!);
          const next = byId.get(id);
          if (!next) continue;
          block.rows[i] = mergeRowFields(block.rows[i]!, next);
        }
      }
    }
    this.cacheEpoch++;
    this.lastHydrate = null;
  }

  /** Fetch leaf ids for a group (selection cascade). */
  getGroupLeafIds(groupPath: string[]): Promise<string[]> {
    const ds = this.datasource;
    if (!ds?.getGroupLeafIds) return Promise.resolve([]);
    return new Promise((resolve) => {
      ds.getGroupLeafIds!({
        request: { groupPath, rowGroupCols: this.host.getRowGroupCols() },
        success: (r) => resolve(r.ids ?? []),
        fail: () => resolve([]),
      });
    });
  }

  destroy(): void {
    this.datasource?.destroy?.();
    this.datasource = null;
    this.leafCaches.clear();
    this.skeleton = null;
    this.index = null;
    this.groupBaseRows.clear();
  }

  // ─── internals ─────────────────────────────────────────────────────────

  private softRefreshAvgMs(): number {
    if (this.softRefreshDurations.length === 0) return 50;
    const sum = this.softRefreshDurations.reduce((a, b) => a + b, 0);
    return sum / this.softRefreshDurations.length;
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const p = this.opChain.then(fn, fn);
    this.opChain = p.then(() => undefined, () => undefined);
    return p;
  }

  private waitUntil(pred: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const tick = (): void => {
        if (pred()) resolve();
        else queueMicrotask(tick);
      };
      tick();
    });
  }

  private grouped(): boolean {
    return this.host.getRowGroupCols().length > 0;
  }

  private mergeBlockRows(prev: T[] | undefined, incoming: T[]): T[] {
    if (!prev?.length) return incoming.slice();
    const prevById = new Map<string, T>();
    for (const row of prev) {
      try { prevById.set(this.host.getRowId(row), row); } catch { /* skip */ }
    }
    return incoming.map((row) => {
      let id = '';
      try { id = this.host.getRowId(row); } catch { return row; }
      const prior = prevById.get(id);
      return prior ? mergeRowFields(prior, row) : row;
    });
  }

  private refreshBand(): { rowStart: number; rowEnd: number } {
    const r = this.host.getRefreshRange?.();
    if (!r || r.rowEnd <= r.rowStart) return { rowStart: 0, rowEnd: this.blockSize };
    return r;
  }

  private async refreshInner(purge: boolean): Promise<void> {
    if (this.host.isDestroyed()) return;
    if (purge) {
      this.dataGen++;
      this.leafCaches.clear();
      this.flatRowCount = 0;
      this.reportedRowCount = 0;
      this.skeleton = null;
      this.index = null;
      this.groupBaseRows.clear();
      this.fullyHydrated = false;
      this.lastHydrate = null;
      this.cacheEpoch++;
      this.grandTotals = null;
      this.host.setGrandTotals?.(null);
    }

    if (purge) {
      const band = this.refreshBand();
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (!this.host.isDestroyed()) this.host.requestViewport?.();
      return;
    }

    // Soft refresh — keep painted rows; reload skeleton + band blocks.
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
    this.host.requestViewport?.();
  }

  private async refreshExpansionInner(): Promise<void> {
    if (this.host.isDestroyed()) return;
    if (!this.grouped() || this.skeleton === null) {
      const band = this.refreshBand();
      await this.ensureRangeInner(band.rowStart, band.rowEnd);
      if (!this.host.isDestroyed()) this.host.requestViewport?.();
      return;
    }
    this.rebuildIndex();
    const band = this.refreshBand();
    await this.hydrateRange(band.rowStart, band.rowEnd);
    if (this.host.isDestroyed()) return;
    this.host.requestViewport?.();
    await this.ensureRangeInner(band.rowStart, band.rowEnd);
    if (this.host.isDestroyed()) return;
    this.host.requestViewport?.();
  }

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
    const rootAggs = extractRootAggregates(groups);
    this.grandTotals = rootAggs;
    this.host.setGrandTotals?.(rootAggs);

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
        __groupKey: n.key,
        __groupDepth: n.depth,
        __leafCount: n.leafCount,
        __isGroup: true,
      } as unknown as T);
    }
    this.host.setGroupKeys?.(nodes.map((n) => n.key));
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    if (this.skeleton === null) return;
    const rowGroupCols = this.host.getRowGroupCols();
    const expanded = new Set(this.host.getExpandedGroupKeys());
    this.lastExpanded = expanded;
    this.index = new FlattenIndex(this.skeleton, expanded, Math.max(0, rowGroupCols.length - 1), {
      groupTotalRow: this.groupTotalRow,
      grandTotalRow: this.grandTotalRow,
    });
    const prev = this.reportedRowCount;
    this.reportedRowCount = this.index.rowCount;
    this.host.setRowCount?.(this.reportedRowCount, prev);
  }

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
      if (!block || block.state === 'failed') {
        missing.push({ node: entry.node, blockIdx });
      } else if (block.state === 'loading') {
        waiting.push(this.waitUntil(
          () => cache!.get(blockIdx)?.state !== 'loading' || gen !== this.dataGen,
        ));
      }
    }
    if (missing.length > 0 || waiting.length > 0) {
      await Promise.all([
        ...missing.map((m) => this.loadLeafBlock(m.node, m.blockIdx, gen)),
        ...waiting,
      ]);
    }
    if (gen !== this.dataGen || this.host.isDestroyed()) return;
    await this.hydrateRange(start, end);
  }

  private async hydrateRange(start: number, end: number): Promise<void> {
    const index = this.index;
    if (!index) return;
    if (
      this.lastHydrate
      && this.lastHydrate.start === start
      && this.lastHydrate.end === end
      && this.lastHydrate.index === index
      && this.lastHydrate.dataGen === this.dataGen
      && this.lastHydrate.cacheEpoch === this.cacheEpoch
    ) {
      return;
    }

    const rows: T[] = [];
    for (const entry of index.entriesInRange(start, end)) {
      rows.push(this.materialize(entry));
    }
    await this.host.hydrateWindow(start, rows, index.rowCount, false);
    this.lastHydrate = {
      start,
      end,
      index,
      dataGen: this.dataGen,
      cacheEpoch: this.cacheEpoch,
    };
  }

  private materialize(entry: import('./flattenIndex').FlattenEntry): T {
    if (entry.kind === 'grandTotal') {
      return {
        ...(this.grandTotals ?? {}),
        [this.rowIdField]: SSRM_GRAND_TOTAL_ROW_ID,
        __isGrandTotal: true,
      } as unknown as T;
    }
    if (entry.kind === 'footer') {
      return {
        ...entry.node.aggregates,
        [this.rowIdField]: `${SSRM_FOOTER_ROW_ID_PREFIX}${entry.node.key}`,
        __isFooter: true,
        __groupKey: entry.node.key,
      } as unknown as T;
    }
    if (entry.kind === 'group') {
      return (
        this.groupBaseRows.get(entry.node.key)
        ?? ({
          [this.rowIdField]: `${SSRM_GROUP_ROW_ID_PREFIX}${entry.node.key}`,
          __isGroup: true,
        } as unknown as T)
      );
    }
    const cache = this.leafCaches.get(entry.node.key);
    const blockIdx = Math.floor(entry.leafOffset / this.blockSize);
    const offset = entry.leafOffset % this.blockSize;
    const row = cache?.get(blockIdx)?.rows[offset];
    if (row) return row;
    return {
      [this.rowIdField]: `__pending__${entry.node.key}:${entry.leafOffset}`,
      __pending: true,
    } as unknown as T;
  }

  private loadLeafBlock(
    node: SkeletonNode,
    blockIdx: number,
    gen: number,
    force = false,
  ): Promise<void> {
    const ds = this.datasource;
    if (!ds?.getLeafRows) return Promise.resolve();
    let cache = this.leafCaches.get(node.key);
    if (!cache) {
      cache = new Map();
      this.leafCaches.set(node.key, cache);
    }
    const existing = cache.get(blockIdx);
    if (existing && existing.state === 'loading') {
      return this.waitUntil(() => cache!.get(blockIdx)?.state !== 'loading' || gen !== this.dataGen);
    }
    const preserved = existing?.rows ?? [];
    cache.set(blockIdx, { rows: preserved, state: 'loading', touch: ++this.touchClock });
    void force;

    const startRow = blockIdx * this.blockSize;
    const endRow = Math.min(node.leafCount, startRow + this.blockSize);

    const run = (): Promise<void> => new Promise<void>((resolve) => {
      if (gen !== this.dataGen || this.host.isDestroyed()) {
        cache!.delete(blockIdx);
        resolve();
        return;
      }
      this.inflight++;
      const columnKeys = this.host.getColumnKeys?.();
      ds.getLeafRows!({
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
          this.inflight = Math.max(0, this.inflight - 1);
          if (gen !== this.dataGen || this.host.isDestroyed()) {
            cache!.delete(blockIdx);
            resolve();
            return;
          }
          const prevBlock = cache!.get(blockIdx);
          const incoming = resultRows(result);
          const rows = this.mergeBlockRows(prevBlock?.rows, incoming);
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
          cache!.set(blockIdx, {
            rows: preserved,
            state: 'failed',
            touch: ++this.touchClock,
          });
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

  private flatCache(): Map<number, LeafBlock<T>> {
    let cache = this.leafCaches.get('');
    if (!cache) {
      cache = new Map();
      this.leafCaches.set('', cache);
    }
    return cache;
  }

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
    const start = Math.max(0, Math.floor(rowStart));
    const end = Math.max(start + 1, Math.ceil(rowEnd));
    const first = Math.floor(start / this.blockSize);
    const last = Math.floor(Math.max(start, end - 1) / this.blockSize);
    const cache = this.flatCache();

    const loads: Array<Promise<void>> = [];
    for (let b = first; b <= last; b++) {
      const cur = cache.get(b);
      if (cur?.state === 'loading') {
        loads.push(this.waitUntil(
          () => cache.get(b)?.state !== 'loading' || gen !== this.dataGen,
        ));
        continue;
      }
      if (cur && cur.state !== 'failed') continue;
      loads.push(this.loadFlatBlock(b, gen));
    }
    if (loads.length > 0) await Promise.all(loads);
    if (gen !== this.dataGen || this.host.isDestroyed()) return;

    const prev = this.reportedRowCount;
    if (this.flatRowCount !== prev) {
      this.reportedRowCount = this.flatRowCount;
      this.host.setRowCount?.(this.reportedRowCount, prev);
    }

    const hi = this.flatRowCount > 0 ? Math.min(this.flatRowCount, end) : end;
    let run: T[] = [];
    let runStart = start;
    const flush = async (): Promise<void> => {
      if (run.length === 0) return;
      await this.host.hydrateWindow(
        runStart,
        run,
        Math.max(this.flatRowCount, runStart + run.length),
        false,
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
    if (existing && existing.state === 'loading') {
      return this.waitUntil(() => cache.get(blockIdx)?.state !== 'loading' || gen !== this.dataGen);
    }
    const preserved = existing?.rows ?? [];
    cache.set(blockIdx, { rows: preserved, state: 'loading', touch: ++this.touchClock });
    void force;
    const startRow = blockIdx * this.blockSize;
    const endRow = startRow + this.blockSize;

    const run = (): Promise<void> => new Promise<void>((resolve) => {
      if (gen !== this.dataGen || this.host.isDestroyed()) {
        cache.delete(blockIdx);
        resolve();
        return;
      }
      this.inflight++;
      const columnKeys = this.host.getColumnKeys?.();
      const qf = this.host.getQuickFilterText?.();
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
          ...(qf ? { quickFilterText: qf } : {}),
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
          } else {
            const incoming = resultRows(result);
            if (incoming.length > 0) {
              this.flatRowCount = Math.max(this.flatRowCount, startRow + incoming.length);
            }
          }
          if (result.grandTotals !== undefined) {
            this.grandTotals = result.grandTotals;
            this.host.setGrandTotals?.(result.grandTotals);
          }
          const prevBlock = cache.get(blockIdx);
          const rows = this.mergeBlockRows(prevBlock?.rows, resultRows(result));
          const expected = Math.max(0, Math.min(this.blockSize, this.flatRowCount - startRow));
          const complete = rows.length >= expected;
          cache.set(blockIdx, {
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
          cache.set(blockIdx, {
            rows: preserved,
            state: 'failed',
            touch: ++this.touchClock,
          });
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

  private evictIfNeeded(): void {
    const holdsRows = (b: LeafBlock<T>): boolean =>
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
      if (cache && cache.size === 0) this.leafCaches.delete(lruKey);
      count--;
      this.cacheEpoch++;
    }
  }
}
