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

/**
 * PerspectiveBook (greenfield) — Table + N Views + feed leadership contracts.
 * WASM SharedWorker wiring ports from legacy; epoch / per-view batch / resume-live are first-class.
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
      for (let i = 0; i < n; i++) {
        const id = `P${String(i).padStart(5, '0')}`;
        this.tableRows.set(id, {
          positionId: id,
          desk: i % 2 === 0 ? 'EQ' : 'FX',
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

  /**
   * Lock-takeover path: book already live — resume feeding without resnapshot.
   */
  resumeLiveFeed(): void {
    if (this.isFeedStopped() || this.destroyed) return;
    this.snapshotComplete = true;
    this.setPhase('live');
    this.startSeedLive();
  }

  async getSsrmRows(viewId: string, req: {
    startRow: number;
    endRow: number;
    sortModel?: Array<{ colId: string; direction: 'asc' | 'desc' }>;
    filterModel?: Record<string, unknown>;
  }): Promise<{ rows: PositionRow[]; rowCount: number }> {
    void viewId;
    let rows = [...this.tableRows.values()];
    const sort = req.sortModel?.[0];
    if (sort) {
      rows.sort((a, b) => {
        const av = a[sort.colId];
        const bv = b[sort.colId];
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        return sort.direction === 'asc' ? cmp : -cmp;
      });
    }
    const start = Math.max(0, req.startRow | 0);
    const end = Math.max(start, Math.min(req.endRow | 0, rows.length));
    return { rows: rows.slice(start, end), rowCount: rows.length };
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
