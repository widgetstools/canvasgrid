import {
  clearSharedFeedStop,
  isSharedFeedStopped,
  writeSharedFeedStop,
} from './feedEpoch';
import { FeedLeadership, type FeedRole } from './feedLeadership';
import {
  feedLockNameForSchema,
  POSITION_SCHEMA,
  type PerspectiveTableSchema,
} from './schema';

type WasmTable = { size(): Promise<number> | number; update(rows: unknown[]): Promise<void> };

export type BookPhase = 'idle' | 'connecting' | 'snapshot' | 'live' | 'disconnected' | 'error';
export type BookFeed = 'seed' | 'stomp';
export type BookEngine = 'memory' | 'wasm';

export type PositionRow = Record<string, unknown> & { positionId: string };

export type ViewTick = {
  viewId: string;
  updates: PositionRow[];
  refreshSsrm: boolean;
  totals: PositionRow;
};

type BoundView = {
  id: string;
  pendingLiveBatch: PositionRow[];
  groupBy: string[];
};

export type PerspectiveBookOptions = {
  feed?: BookFeed;
  /** `memory` = in-process Map (tests / default until WASM boots). `wasm` = Perspective table. */
  engine?: BookEngine;
  schemaKey?: string;
  schema?: PerspectiveTableSchema;
  snapshotRows?: number;
  /** Force shared-table leadership semantics (Web Locks) even on memory engine — for tests. */
  sharedTable?: boolean;
  onPhase?: (p: BookPhase) => void;
  onViewTick?: (t: ViewTick) => void;
  onRole?: (role: FeedRole) => void;
};

export type SsrmSortModel = Array<{ colId: string; direction: 'asc' | 'desc' }>;

/**
 * PerspectiveBook — Table + N Views + feed leadership.
 * Stop epoch is written BEFORE Web Lock release (ADR-003).
 * Lock takeover resumes live only — never resnapshots.
 */
export class PerspectiveBook {
  private phase: BookPhase = 'idle';
  private feedStopped = false;
  private feedStopEpoch = 0;
  private readonly schemaKey: string;
  private readonly schema: PerspectiveTableSchema;
  private readonly views = new Map<string, BoundView>();
  private tableRows = new Map<string, PositionRow>();
  private snapshotComplete = false;
  private seedTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private sharedTable: boolean;
  private engine: BookEngine;
  private wasmTable: WasmTable | null = null;
  private leadership: FeedLeadership;
  private connecting = false;

  constructor(private readonly opts: PerspectiveBookOptions = {}) {
    this.schemaKey = opts.schemaKey ?? 'positions';
    this.schema = opts.schema ?? { ...POSITION_SCHEMA };
    this.engine = opts.engine ?? 'memory';
    this.sharedTable = opts.sharedTable ?? false;
    this.leadership = this.makeLeadership();
  }

  private makeLeadership(): FeedLeadership {
    return new FeedLeadership({
      lockName: feedLockNameForSchema(this.schema),
      sharedTable: this.sharedTable,
      isDestroyed: () => this.destroyed,
      isFeedStopped: () => this.isFeedStopped(),
      onTakeover: () => this.onLeadershipTakeover(),
    });
  }

  getPhase(): BookPhase {
    return this.phase;
  }

  getFeedRole(): FeedRole {
    return this.leadership.getRole();
  }

  isFeedStopped(): boolean {
    return this.feedStopped || isSharedFeedStopped(this.schemaKey);
  }

  /**
   * Diagnostics Stop — write stop epoch BEFORE releasing the feed lock
   * so a waiter cannot resume while BroadcastChannel is still in flight.
   */
  stopFeed(): void {
    this.feedStopped = true;
    this.feedStopEpoch++;
    writeSharedFeedStop(this.schemaKey, this.feedStopEpoch);
    this.stopSeed();
    this.leadership.release();
    this.setPhase('disconnected');
  }

  restartFeed(): void {
    this.feedStopped = false;
    clearSharedFeedStop(this.schemaKey);
    this.connect();
  }

  async registerView(spec: { id: string; label?: string }): Promise<void> {
    this.views.set(spec.id, { id: spec.id, pendingLiveBatch: [], groupBy: [] });
  }

  async unregisterView(viewId: string): Promise<void> {
    this.views.delete(viewId);
  }

  /** Boot feed — routes through leadership when the table is shared. */
  connect(): Promise<void> {
    if (this.isFeedStopped() || this.destroyed || this.connecting) {
      return Promise.resolve();
    }
    return this.connectRouted();
  }

  private async connectRouted(): Promise<void> {
    this.connecting = true;
    try {
      if (this.isFeedStopped() || this.destroyed) return;
      this.setPhase('connecting');

      if (this.engine === 'wasm') {
        await this.ensureWasmTable();
        if (this.isFeedStopped() || this.destroyed) return;
      } else if (this.opts.sharedTable) {
        this.sharedTable = true;
        this.rebuildLeadership();
      }

      if (this.sharedTable) {
        const size = this.engine === 'wasm'
          ? await this.wasmTableSize()
          : this.tableRows.size;

        if (size > 0) {
          await this.adoptSharedLive(size);
          this.leadership.queueTakeover();
          return;
        }

        if (await this.leadership.tryLead()) {
          if (this.isFeedStopped() || this.destroyed) {
            this.leadership.release();
            return;
          }
          this.opts.onRole?.(this.leadership.getRole());
          await this.connectSeed();
          return;
        }

        // Follower — wait for leader snapshot then adopt.
        const settled = await this.waitForSharedSnapshot();
        if (this.isFeedStopped() || this.destroyed) return;
        if (settled > 0) {
          await this.adoptSharedLive(settled);
          this.leadership.queueTakeover();
          return;
        }
        // Timeout — seed ourselves.
        if (await this.leadership.tryLead()) {
          await this.connectSeed();
        }
        return;
      }

      // Dedicated / memory single-tab — always leader.
      await this.leadership.tryLead();
      await this.connectSeed();
    } finally {
      this.connecting = false;
    }
  }

  private rebuildLeadership(): void {
    this.leadership.release();
    this.leadership = this.makeLeadership();
  }

  private onLeadershipTakeover(): void {
    this.opts.onRole?.(this.leadership.getRole());
    // Resume live only — never clear rows / resnapshot.
    this.resumeLiveFeed();
  }

  private async ensureWasmTable(): Promise<void> {
    if (this.wasmTable) return;
    // Dynamic import keeps unit tests free of WASM module resolution.
    const boot = await import('./bootstrap');
    const { table, attached } = await boot.openOrCreatePositionsTable(
      undefined,
      this.schema,
    );
    this.wasmTable = table;
    this.sharedTable = boot.getPerspectiveWorkerMode() === 'shared';
    if (this.sharedTable) this.rebuildLeadership();
    void attached;
  }

  private async wasmTableSize(): Promise<number> {
    if (!this.wasmTable) return this.tableRows.size;
    try {
      return Number(await this.wasmTable.size());
    } catch {
      return this.tableRows.size;
    }
  }

  private async waitForSharedSnapshot(timeoutMs = 30_000): Promise<number> {
    const start = Date.now();
    for (;;) {
      const size = this.engine === 'wasm'
        ? await this.wasmTableSize()
        : this.tableRows.size;
      if (size > 0 || Date.now() - start > timeoutMs || this.destroyed) return size;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async adoptSharedLive(size: number): Promise<void> {
    this.snapshotComplete = true;
    // Memory followers in tests may have empty local maps — that's OK;
    // WASM followers read via SharedWorker Views (SSRM path uses local
    // mirror when dual-written by the leader in this process).
    void size;
    this.setPhase('live');
    this.opts.onRole?.(this.leadership.getRole());
  }

  private async connectSeed(): Promise<void> {
    if (this.isFeedStopped() || this.destroyed) return;
    if (this.tableRows.size === 0) {
      this.setPhase('snapshot');
      const n = this.opts.snapshotRows ?? 500;
      const desks = ['EQ', 'FX', 'FI'];
      const regions = ['AMER', 'EMEA', 'APAC'];
      const batch: PositionRow[] = [];
      for (let i = 0; i < n; i++) {
        const id = `P${String(i).padStart(5, '0')}`;
        const row: PositionRow = {
          positionId: id,
          desk: desks[i % desks.length]!,
          region: regions[i % regions.length]!,
          ticker: `T${i % 50}`,
          pnl: Math.round((Math.random() - 0.5) * 100000) / 100,
          dailyPnl: Math.round((Math.random() - 0.5) * 5000) / 100,
        };
        this.tableRows.set(id, row);
        batch.push(row);
      }
      if (this.wasmTable && batch.length) {
        try { await this.wasmTable.update(batch); } catch { /* mirror best-effort */ }
      }
    }
    this.snapshotComplete = true;
    this.setPhase('live');
    this.opts.onRole?.(this.leadership.getRole());
    this.startSeedLive();
  }

  /**
   * Lock-takeover / resume path: book already live — feed without resnapshot.
   */
  resumeLiveFeed(): void {
    if (this.isFeedStopped() || this.destroyed) return;
    this.snapshotComplete = true;
    this.setPhase('live');
    this.startSeedLive();
  }

  private sortedRows(sortModel?: SsrmSortModel): PositionRow[] {
    const rows = [...this.tableRows.values()];
    const sort = sortModel?.[0];
    if (!sort) return rows;
    rows.sort((a, b) => {
      const av = a[sort.colId];
      const bv = b[sort.colId];
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return rows;
  }

  async getSsrmRows(viewId: string, req: {
    startRow: number;
    endRow: number;
    sortModel?: SsrmSortModel;
    filterModel?: Record<string, unknown>;
    columnKeys?: string[];
  }): Promise<{ rows: PositionRow[]; rowCount: number }> {
    void viewId;
    void req.filterModel;
    let rows = this.sortedRows(req.sortModel);
    if (req.columnKeys?.length) {
      const keys = new Set(req.columnKeys);
      keys.add('positionId');
      rows = rows.map((r) => {
        const out: PositionRow = { positionId: r.positionId };
        for (const k of keys) {
          if (k in r) out[k] = r[k];
        }
        return out;
      });
    }
    const start = Math.max(0, req.startRow | 0);
    const end = Math.max(start, Math.min(req.endRow | 0, rows.length));
    return { rows: rows.slice(start, end), rowCount: rows.length };
  }

  async getGroupSkeleton(viewId: string, req: {
    rowGroupCols: string[];
    sortModel?: SsrmSortModel;
    filterModel?: Record<string, unknown>;
  }): Promise<{ groups: Array<{ path: string[]; leafCount: number; aggregates?: Record<string, unknown> }> }> {
    void viewId;
    void req.filterModel;
    const cols = req.rowGroupCols;
    if (!cols.length) return { groups: [] };

    const rows = this.sortedRows(req.sortModel);
    type Agg = { leafCount: number; pnl: number; dailyPnl: number };
    const byPath = new Map<string, Agg>();
    let totalPnl = 0;
    let totalDaily = 0;

    for (const row of rows) {
      const pnl = Number(row.pnl) || 0;
      const daily = Number(row.dailyPnl) || 0;
      totalPnl += pnl;
      totalDaily += daily;
      for (let depth = 1; depth <= cols.length; depth++) {
        const path = cols.slice(0, depth).map((c) => String(row[c] ?? ''));
        const key = path.join('\0');
        let agg = byPath.get(key);
        if (!agg) {
          agg = { leafCount: 0, pnl: 0, dailyPnl: 0 };
          byPath.set(key, agg);
        }
        agg.leafCount++;
        agg.pnl += pnl;
        agg.dailyPnl += daily;
      }
    }

    const groups: Array<{ path: string[]; leafCount: number; aggregates?: Record<string, unknown> }> = [
      {
        path: [],
        leafCount: rows.length,
        aggregates: { pnl: Math.round(totalPnl * 100) / 100, dailyPnl: Math.round(totalDaily * 100) / 100 },
      },
    ];
    for (const [key, agg] of byPath) {
      groups.push({
        path: key.split('\0'),
        leafCount: agg.leafCount,
        aggregates: {
          pnl: Math.round(agg.pnl * 100) / 100,
          dailyPnl: Math.round(agg.dailyPnl * 100) / 100,
        },
      });
    }
    return { groups };
  }

  async getLeafRows(viewId: string, req: {
    groupPath: string[];
    rowGroupCols: string[];
    startRow: number;
    endRow: number;
    sortModel?: SsrmSortModel;
    columnKeys?: string[];
  }): Promise<{ rows: PositionRow[] }> {
    void viewId;
    const cols = req.rowGroupCols;
    let rows = this.sortedRows(req.sortModel).filter((row) =>
      req.groupPath.every((v, i) => String(row[cols[i]!] ?? '') === v),
    );
    if (req.columnKeys?.length) {
      const keys = new Set(req.columnKeys);
      keys.add('positionId');
      rows = rows.map((r) => {
        const out: PositionRow = { positionId: r.positionId };
        for (const k of keys) {
          if (k in r) out[k] = r[k];
        }
        return out;
      });
    }
    const start = Math.max(0, req.startRow | 0);
    const end = Math.max(start, Math.min(req.endRow | 0, rows.length));
    return { rows: rows.slice(start, end) };
  }

  async getGroupLeafIds(viewId: string, req: {
    groupPath: string[];
    rowGroupCols: string[];
  }): Promise<{ ids: string[] }> {
    void viewId;
    const cols = req.rowGroupCols;
    const ids = this.sortedRows().filter((row) =>
      req.groupPath.every((v, i) => String(row[cols[i]!] ?? '') === v),
    ).map((r) => r.positionId);
    return { ids };
  }

  /** Row count for leadership / follower polls (memory mirror). */
  getLocalRowCount(): number {
    return this.tableRows.size;
  }

  /** Inject rows into the memory mirror — test helper for follower adopt. */
  __seedRowsForTests(rows: PositionRow[]): void {
    for (const r of rows) this.tableRows.set(r.positionId, r);
    this.snapshotComplete = true;
  }

  static rowMatchesFilterOp(op: string, raw: unknown, term: unknown): boolean {
    const s = String(raw ?? '').toLowerCase();
    const needle = String(term ?? '').toLowerCase();
    switch (op) {
      case 'contains': return !needle || s.includes(needle);
      case 'not contains': return !needle || !s.includes(needle);
      case 'begins with': return !needle || s.startsWith(needle);
      case 'ends with': return !needle || s.endsWith(needle);
      case '==': return String(raw ?? '') === String(term ?? '');
      case '!=': return String(raw ?? '') !== String(term ?? '');
      default: return false;
    }
  }

  private startSeedLive(): void {
    this.stopSeed();
    if (this.isFeedStopped() || !this.snapshotComplete) return;
    if (this.leadership.getRole() === 'follower') return;
    this.seedTimer = setInterval(() => {
      if (this.isFeedStopped()) return;
      if (this.leadership.getRole() === 'follower') return;
      const ids = [...this.tableRows.keys()];
      if (!ids.length) return;
      const batch: PositionRow[] = [];
      for (let i = 0; i < 5; i++) {
        const id = ids[Math.floor(Math.random() * ids.length)]!;
        const prev = this.tableRows.get(id)!;
        const next = {
          ...prev,
          pnl: Math.round((Math.random() - 0.5) * 100000) / 100,
        };
        this.tableRows.set(id, next);
        batch.push(next);
      }
      if (this.wasmTable) {
        void this.wasmTable.update(batch).catch(() => undefined);
      }
      for (const v of this.views.values()) {
        const byId = new Map(v.pendingLiveBatch.map((r) => [r.positionId, r]));
        for (const row of batch) byId.set(row.positionId, row);
        v.pendingLiveBatch = [...byId.values()];
        const updates = v.pendingLiveBatch;
        v.pendingLiveBatch = [];
        this.opts.onViewTick?.({
          viewId: v.id,
          updates,
          refreshSsrm: false,
          totals: { positionId: '__total__' },
        });
      }
    }, 250);
  }

  private stopSeed(): void {
    if (this.seedTimer != null) {
      clearInterval(this.seedTimer);
      this.seedTimer = null;
    }
  }

  private setPhase(p: BookPhase): void {
    this.phase = p;
    this.opts.onPhase?.(p);
  }

  destroy(): void {
    this.destroyed = true;
    this.stopSeed();
    this.leadership.release();
    this.views.clear();
    this.wasmTable = null;
  }
}
