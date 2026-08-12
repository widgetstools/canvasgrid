import { mergeRowFields } from './mergeRowFields';
import type { IServerSideDatasourceV2, SkeletonNode } from './types';

type Block<T> = { rows: T[]; loaded: boolean };

export type SsrmHost<T> = {
  getRowId: (row: T) => string;
  isDestroyed: () => boolean;
  hydrateWindow: (start: number, rows: T[], rowCount: number, replace: boolean) => void | Promise<void>;
  getRowGroupCols: () => string[];
  isSparse: () => boolean;
  wantsClientPipeline: () => boolean;
};

/**
 * Single SSRM engine — v2 skeleton semantics.
 * Soft refresh pacing runs inside the op chain; merges by row id.
 */
export class ServerSideRowModel<T extends Record<string, unknown>> {
  private datasource: IServerSideDatasourceV2<T> | null = null;
  private blockSize: number;
  private leafCaches = new Map<string, Map<number, Block<T>>>();
  private flatRowCount = 0;
  private dataGen = 0;
  private opChain: Promise<void> = Promise.resolve();
  private pendingSoftRefresh: Promise<void> | null = null;
  private lastSoftRefreshEnd = 0;
  private softRefreshDurations: number[] = [];
  private skeleton: SkeletonNode[] = [];
  private fullyHydrated = false;

  constructor(
    private readonly host: SsrmHost<T>,
    opts?: { cacheBlockSize?: number },
  ) {
    this.blockSize = Math.max(1, opts?.cacheBlockSize ?? 100);
  }

  setDatasource(ds: IServerSideDatasourceV2<T> | null): void {
    this.datasource = ds;
    void this.refresh({ purge: true });
  }

  getRowCount(): number {
    return this.flatRowCount;
  }

  isFullyHydrated(): boolean {
    return this.fullyHydrated;
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

  refresh(params: { purge?: boolean } = {}): Promise<void> {
    const soft = params.purge === false;
    if (soft && this.pendingSoftRefresh) return this.pendingSoftRefresh;
    if (soft) {
      let p: Promise<void> | null = null;
      p = this.enqueue(async () => {
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
      this.pendingSoftRefresh = p;
      return p;
    }
    this.pendingSoftRefresh = null;
    return this.enqueue(() => this.refreshInner(true));
  }

  private async refreshInner(purge: boolean): Promise<void> {
    if (purge) {
      this.dataGen++;
      this.leafCaches.clear();
      this.flatRowCount = 0;
      this.skeleton = [];
      this.fullyHydrated = false;
    }
    const groups = this.host.getRowGroupCols();
    if (groups.length > 0 && this.datasource?.getGroupSkeleton) {
      await this.loadSkeleton();
    } else {
      await this.ensureRange(0, this.blockSize);
    }
  }

  private loadSkeleton(): Promise<void> {
    const ds = this.datasource;
    if (!ds?.getGroupSkeleton) return Promise.resolve();
    return new Promise((resolve) => {
      ds.getGroupSkeleton!({
        request: { rowGroupCols: this.host.getRowGroupCols(), sortModel: [], filterModel: {} },
        success: (r) => {
          this.skeleton = r.roots;
          this.flatRowCount = r.rowCount;
          resolve();
        },
        fail: () => resolve(),
      });
    });
  }

  async ensureRange(start: number, end: number): Promise<void> {
    const ds = this.datasource;
    if (!ds) return;
    const cacheKey = '';
    let cache = this.leafCaches.get(cacheKey);
    if (!cache) {
      cache = new Map();
      this.leafCaches.set(cacheKey, cache);
    }
    const first = Math.floor(start / this.blockSize);
    const last = Math.floor(Math.max(start, end - 1) / this.blockSize);
    const loads: Promise<void>[] = [];
    for (let b = first; b <= last; b++) {
      if (cache.has(b)) continue;
      loads.push(this.loadBlock(cache, b));
    }
    await Promise.all(loads);
  }

  private loadBlock(cache: Map<number, Block<T>>, block: number): Promise<void> {
    const ds = this.datasource!;
    const start = block * this.blockSize;
    const end = start + this.blockSize;
    return new Promise((resolve) => {
      ds.getRows({
        request: {
          startRow: start,
          endRow: end,
          sortModel: [],
          filterModel: {},
          rowGroupCols: this.host.getRowGroupCols(),
          groupKeys: [],
        },
        success: (r) => {
          this.flatRowCount = r.rowCount;
          const prev = cache.get(block)?.rows;
          const rows = this.mergeBlockRows(prev, r.rows as T[]);
          cache.set(block, { rows, loaded: true });
          void this.host.hydrateWindow(start, rows, r.rowCount, false);
          resolve();
        },
        fail: () => resolve(),
      });
    });
  }

  async ensureFullyHydrated(): Promise<boolean> {
    if (this.host.getRowGroupCols().length > 0) {
      console.warn('[vg-new-grid] ensureFullyHydrated unsupported while grouped');
      return false;
    }
    if (!this.host.wantsClientPipeline()) return false;
    let complete = false;
    await this.enqueue(async () => {
      if (this.flatRowCount <= 0) await this.ensureRange(0, this.blockSize);
      if (this.flatRowCount <= 0) return;
      await this.ensureRange(0, this.flatRowCount);
      const cache = this.leafCaches.get('');
      const rows: T[] = [];
      for (let i = 0; i < this.flatRowCount; i++) {
        const row = cache?.get(Math.floor(i / this.blockSize))?.rows[i % this.blockSize];
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

  applyTransaction(tx: { update?: T[] }): void {
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
  }

  getSkeleton(): SkeletonNode[] {
    return this.skeleton;
  }

  destroy(): void {
    this.datasource?.destroy?.();
    this.datasource = null;
    this.leafCaches.clear();
  }
}
