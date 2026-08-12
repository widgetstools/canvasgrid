import {
  clearSharedFeedStop,
  isSharedFeedStopped,
  writeSharedFeedStop,
} from './feedEpoch';

export type BookPhase = 'idle' | 'connecting' | 'snapshot' | 'live' | 'disconnected' | 'error';
export type BookFeed = 'seed' | 'stomp';

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
  schemaKey?: string;
  snapshotRows?: number;
  onPhase?: (p: BookPhase) => void;
  onViewTick?: (t: ViewTick) => void;
};

export type SsrmSortModel = Array<{ colId: string; direction: 'asc' | 'desc' }>;

/**
 * PerspectiveBook (greenfield) — Table + N Views + feed leadership.
 * Seed path implements real sparse SSRM queries (flat + skeleton + leaf windows).
 * SharedWorker WASM ports in Phase 4.
 */
export class PerspectiveBook {
  private phase: BookPhase = 'idle';
  private feedStopped = false;
  private feedStopEpoch = 0;
  private readonly schemaKey: string;
  private readonly views = new Map<string, BoundView>();
  private tableRows = new Map<string, PositionRow>();
  private snapshotComplete = false;
  private seedTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(private readonly opts: PerspectiveBookOptions = {}) {
    this.schemaKey = opts.schemaKey ?? 'positions';
  }

  getPhase(): BookPhase {
    return this.phase;
  }

  isFeedStopped(): boolean {
    return this.feedStopped || isSharedFeedStopped(this.schemaKey);
  }

  stopFeed(): void {
    this.feedStopped = true;
    this.feedStopEpoch++;
    writeSharedFeedStop(this.schemaKey, this.feedStopEpoch);
    this.stopSeed();
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

  connect(): void {
    if (this.isFeedStopped() || this.destroyed) return;
    if (this.tableRows.size === 0) {
      this.setPhase('snapshot');
      const n = this.opts.snapshotRows ?? 500;
      const desks = ['EQ', 'FX', 'FI'];
      const regions = ['AMER', 'EMEA', 'APAC'];
      for (let i = 0; i < n; i++) {
        const id = `P${String(i).padStart(5, '0')}`;
        this.tableRows.set(id, {
          positionId: id,
          desk: desks[i % desks.length]!,
          region: regions[i % regions.length]!,
          ticker: `T${i % 50}`,
          pnl: Math.round((Math.random() - 0.5) * 100000) / 100,
          dailyPnl: Math.round((Math.random() - 0.5) * 5000) / 100,
        });
      }
      this.snapshotComplete = true;
      this.setPhase('live');
    }
    this.startSeedLive();
  }

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

  /**
   * Sparse v2 skeleton — every group at every depth for the active rowGroupCols.
   * Includes a `path: []` root carrier with grand-total aggregates.
   */
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

  /** Tick filter ops — includes ends with / not contains; unknown ops fail closed. */
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
    this.seedTimer = setInterval(() => {
      if (this.isFeedStopped()) return;
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
    this.views.clear();
  }
}
