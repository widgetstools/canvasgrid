/**
 * Shared Perspective book + per-blotter Views.
 *
 * STOMP/seed → Table.update → Views → sparse SSRM getRows (windowed only).
 * Grouping / agg / filter / sort owned by Perspective — never full hydrate.
 */
import type { FilterModel, SkeletonGroup, SortModel } from '@wellsfargo-starui/velocity-grid';
import { Client, type IMessage } from '@stomp/stompjs';
import {
  getPerspectiveWorkerMode,
  openOrCreatePositionsTable,
  SHARED_TABLE_NAME,
  type PositionRow,
  type Table,
  type View,
} from './bootstrap';
import { emptyGrandTotalRow } from './positionColumns';
import {
  buildCompositeGroupKey,
  materializeGroupedWindow as buildGroupedSsrmWindow,
  parseCompositeGroupKey,
} from './ssrmGroupTree';

const SNAPSHOT_END_TOKEN = 'Success';

/** Perspective filter triple: [column, op, term]. */
export type PspFilter = [string, string, string | number | boolean | null];

const DATA_COLUMNS = [
  'positionId',
  'ticker',
  'desk',
  'region',
  'instrumentType',
  'notionalAmount',
  'marketValue',
  'pnl',
  'dailyPnl',
] as const;

const VALUE_AGGREGATES = {
  positionId: 'count',
  notionalAmount: 'sum',
  marketValue: 'sum',
  pnl: 'sum',
  dailyPnl: 'sum',
} as const;

export interface SsrmRowsRequest {
  startRow: number;
  endRow: number;
  sortModel: SortModel;
  filterModel: FilterModel;
  rowGroupCols: string[];
  expandedGroupKeys: string[];
}

export interface SsrmRowsResult {
  rows: PositionRow[];
  rowCount: number;
  groupKeys: string[];
}

/** Fired from a blotter's Perspective View `on_update` (conflated). */
export interface ViewTick {
  viewId: string;
  totals: PositionRow;
  /** Soft-refresh SSRM blocks after grouped View recomputes. */
  refreshSsrm: boolean;
  /** Leaf row patches for flat mode live ticks. */
  updates: PositionRow[];
}

export type BookPhase =
  | 'idle'
  | 'bootstrapping'
  | 'connecting'
  | 'snapshot'
  | 'live'
  | 'error'
  | 'disconnected';

export interface ViewSpec {
  id: string;
  label: string;
  filter?: PspFilter[];
}

export interface BookTelemetry {
  phase: BookPhase;
  bookSize: number;
  snapshotRowsLoaded: number;
  liveBatches: number;
  liveRowsIn: number;
  liveUpdatesPerSec: number;
  getRowsTotal: number;
  rowsServedTotal: number;
  viewCount: number;
  views: Array<{
    id: string;
    label: string;
    getRowsCalls: number;
    rowsServed: number;
    inflight: number;
    projectedRows: number;
  }>;
  wsUrl: string;
  engine: 'perspective';
  /** Phase 5 — 'shared' when the engine lives in the per-origin
   *  SharedWorker (cross-tab table), 'dedicated' on the fallback path. */
  workerMode: 'shared' | 'dedicated';
  /** Phase 5 — 'leader' feeds the table (seed ticks / STOMP); 'follower'
   *  tabs share the book read-only and take over if the leader closes. */
  feedRole: 'leader' | 'follower' | 'none';
}

export type BookFeed = 'stomp' | 'seed';

export interface PerspectiveBookOptions {
  feed?: BookFeed;
  wsUrl?: string;
  clientId?: string;
  snapshotRows?: number;
  rate?: number;
  batchSize?: number;
  updatesPerTick?: number;
  sparse?: boolean;
  /** STOMP listener topic the snapshot + live frames arrive on.
   *  Default `/snapshot/positions/{clientId}`. */
  snapshotTopic?: string;
  /** STOMP destination published to request the snapshot. Used VERBATIM
   *  when set; default `{snapshotTopic}/{rate}/{batchSize}`. */
  triggerTopic?: string;
  /** Exact frame body marking end-of-snapshot (a `{token}: ...` prefixed
   *  variant is also accepted). Default `'Success'`. */
  snapshotEndToken?: string;
  /** Name of the unique-key field in the STOMP payload rows. Mapped onto
   *  the canonical `positionId` key (table index / getRowId / dedupe all
   *  key on it). Default `'positionId'`. The SCHEMA itself stays the
   *  positions shape — fully custom schemas are a later step. */
  keyColumn?: string;
  onTelemetry?: (t: BookTelemetry) => void;
  onPhase?: (phase: BookPhase) => void;
  onViewTick?: (tick: ViewTick) => void;
}

const SEED_DESKS = [
  'Securitized Products',
  'Rates Flow',
  'Credit Trading',
  'Equity Derivatives',
  'FX Spot',
] as const;
const SEED_REGIONS = ['AMER', 'EMEA', 'APAC'] as const;
const SEED_INSTRUMENTS = ['Bond', 'Swap', 'Future', 'Option', 'Equity'] as const;
const SEED_TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'JPM', 'GS', 'BAC'] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeedRow(i: number, rnd: () => number): PositionRow {
  const notional = Math.round(50_000 + rnd() * 5_000_000);
  const pnl = Math.round((rnd() - 0.45) * 250_000 * 100) / 100;
  return {
    positionId: `P${String(i).padStart(6, '0')}`,
    ticker: SEED_TICKERS[i % SEED_TICKERS.length]!,
    desk: SEED_DESKS[i % SEED_DESKS.length]!,
    region: SEED_REGIONS[i % SEED_REGIONS.length]!,
    instrumentType: SEED_INSTRUMENTS[i % SEED_INSTRUMENTS.length]!,
    notionalAmount: notional,
    marketValue: Math.round(notional * (0.9 + rnd() * 0.25)),
    pnl,
    dailyPnl: Math.round(pnl * 0.05 * 100) / 100,
  };
}

interface BoundView {
  spec: ViewSpec;
  view: View | null;
  totalsView: View | null;
  /** ONE persistent flat view sorted by [groupBy cols, user sort] — every
   *  deepest group's leaves are a CONTIGUOUS range in it, so leaf windows
   *  are offset reads instead of per-fetch view create/read/delete churn
   *  (the viewer-datagrid model). Null when ungrouped. */
  leafView: View | null;
  /** Deepest-group leaf ranges in leafView order (display order). Built
   *  alongside the skeleton dump; null until then / after invalidation. */
  leafRanges: Array<{ path: string[]; offset: number; count: number }> | null;
  /** JSON.stringify(path) → range index into `leafRanges`. */
  leafRangeByPath: Map<string, number> | null;
  /** Set when a contiguity spot-check failed (group ordering diverged
   *  between the grouped view and leafView, e.g. aggregate-sorted groups)
   *  — offset reads are skipped until the next remount. */
  leafOffsetsUnreliable: boolean;
  dataUpdateCb: number | null;
  notifyTimer: number | null;
  groupBy: string[];
  /** Raw Perspective grouped rows — invalidated on View `on_update`. */
  groupedRawCache: Record<string, unknown>[] | null;
  groupKeys: string[];
  lastQuerySig: string;
  getRowsCalls: number;
  rowsServed: number;
  inflight: number;
  projectedRows: number;
}

/** Transpose Perspective columnar output into row objects. Keeps
 *  `__ROW_PATH__` (skeleton reads need it), drops `__ID__`. */
function columnsToRows(cols: Record<string, unknown[]>): Record<string, unknown>[] {
  const names = Object.keys(cols).filter((n) => n !== '__ID__');
  const first = names[0];
  const n = first !== undefined ? (cols[first]?.length ?? 0) : 0;
  const out: Record<string, unknown>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {};
    for (const name of names) row[name] = cols[name]![i];
    out[i] = row;
  }
  return out;
}

/** Windowed read via `to_columns_string` (columnar JSON string + ONE parse
 *  across the WASM boundary — viewer-datagrid's transport trick) with a
 *  `to_json` fallback for older clients. */
async function readRows(
  view: View,
  window?: { start_row?: number; end_row?: number },
): Promise<Record<string, unknown>[]> {
  const v = view as unknown as {
    to_columns_string?: (w?: object) => Promise<string>;
    to_json: (w?: object) => Promise<unknown[]>;
  };
  if (typeof v.to_columns_string === 'function') {
    const raw = await v.to_columns_string(window ?? {});
    return columnsToRows(JSON.parse(raw) as Record<string, unknown[]>);
  }
  return (await v.to_json(window)) as Record<string, unknown>[];
}

function rowMatchesViewFilter(spec: ViewSpec, row: PositionRow): boolean {
  const filters = spec.filter ?? [];
  if (filters.length === 0) return true;
  for (const [col, op, term] of filters) {
    const raw = row[col];
    const s = String(raw ?? '').toLowerCase();
    const needle = String(term ?? '').toLowerCase();
    if (op === 'contains' && needle && !s.includes(needle)) return false;
    if (op === '>' && !(Number(raw) > Number(term))) return false;
    if (op === '<' && !(Number(raw) < Number(term))) return false;
  }
  return true;
}

function extractRows(parsed: unknown): Partial<PositionRow>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as Partial<PositionRow>[];
  }
  if (parsed && typeof parsed === 'object') return [parsed as Partial<PositionRow>];
  return [];
}

function cgridFilterToPsp(filterModel: FilterModel): PspFilter[] {
  const out: PspFilter[] = [];
  for (const [colId, entry] of Object.entries(filterModel)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e.filterType === 'text' || typeof e.filter === 'string') {
      const needle = String(e.filter ?? '');
      if (needle) out.push([colId, 'contains', needle]);
    } else if (e.filterType === 'number' || typeof e.filter === 'number') {
      const n = Number(e.filter);
      if (!Number.isFinite(n)) continue;
      const op = String(e.type ?? 'equals');
      if (op === 'greaterThan') out.push([colId, '>', n]);
      else if (op === 'lessThan') out.push([colId, '<', n]);
      else out.push([colId, '==', n]);
    }
  }
  return out;
}

function cgridSortToPsp(sortModel: SortModel): Array<[string, 'asc' | 'desc']> {
  return sortModel.map((s) => [s.colId, s.direction] as [string, 'asc' | 'desc']);
}

function normalizeRowGroupCols(rowGroupCols: string[]): string[] {
  return rowGroupCols.filter((c) => DATA_COLUMNS.includes(c as typeof DATA_COLUMNS[number]));
}

function rowGroupColsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export class PerspectiveBook {
  private readonly opts: Required<
    Pick<
      PerspectiveBookOptions,
      | 'feed'
      | 'wsUrl'
      | 'clientId'
      | 'snapshotRows'
      | 'rate'
      | 'batchSize'
      | 'updatesPerTick'
      | 'sparse'
      | 'snapshotEndToken'
      | 'keyColumn'
    >
  > &
    Pick<
      PerspectiveBookOptions,
      'onTelemetry' | 'onPhase' | 'onViewTick' | 'snapshotTopic' | 'triggerTopic'
    >;

  private pendingLiveBatch: PositionRow[] = [];

  private phase: BookPhase = 'idle';
  private table: Table | null = null;
  private stomp: Client | null = null;
  private seedLiveTimer: number | null = null;
  private seedConnecting = false;
  private snapshotComplete = false;
  private updateBuffer: PositionRow[] = [];
  private pauseFanout = false;

  /** Phase 5 — set when `ensureTable` bound the cross-tab shared table. */
  private sharedTable = false;
  /** Phase 5 — this tab's role in the shared feed. */
  private feedRole: 'leader' | 'follower' | 'none' = 'none';
  /** Resolving this releases the Web Lock held while leading the feed. */
  private releaseFeedLock: (() => void) | null = null;
  private leadershipQueued = false;
  private destroyed = false;

  private snapshotRowsLoaded = 0;
  private liveBatches = 0;
  private liveRowsIn = 0;
  private liveWindow: Array<{ t: number; n: number }> = [];
  private getRowsTotal = 0;
  private rowsServedTotal = 0;

  private views = new Map<string, BoundView>();
  /** Serialize getSsrmRows per view — concurrent remounts hang Perspective WASM. */
  private getRowsChains = new Map<string, Promise<void>>();
  /** Serialize Perspective table mutations (shared across all Views). */
  private tableChain: Promise<void> = Promise.resolve();
  /** Last getSsrmRows debug snapshot per view (demo / tests). */
  lastGetRowsDebug = new Map<string, {
    requestedGroupBy: string[];
    boundGroupBy: string[];
    branch: 'flat' | 'grouped' | 'empty';
    rowCount: number;
    served: number;
  }>();
  private telemetryTimer: number | null = null;
  private flushTimer: number | null = null;

  constructor(options: PerspectiveBookOptions = {}) {
    this.opts = {
      feed: options.feed ?? 'seed',
      wsUrl: options.wsUrl ?? 'ws://localhost:8081',
      clientId: options.clientId ?? `psp-${Math.floor(Math.random() * 1e6).toString(16)}`,
      snapshotRows: options.snapshotRows ?? 10_000,
      rate: options.rate ?? 40,
      batchSize: options.batchSize ?? 50,
      updatesPerTick: options.updatesPerTick ?? 5,
      sparse: options.sparse ?? true,
      snapshotTopic: options.snapshotTopic,
      triggerTopic: options.triggerTopic,
      snapshotEndToken: options.snapshotEndToken ?? SNAPSHOT_END_TOKEN,
      keyColumn: options.keyColumn ?? 'positionId',
      onTelemetry: options.onTelemetry,
      onPhase: options.onPhase,
      onViewTick: options.onViewTick,
    };
    this.telemetryTimer = window.setInterval(() => this.emitTelemetry(), 250);
  }

  getPhase(): BookPhase {
    return this.phase;
  }

  isFanoutPaused(): boolean {
    return this.pauseFanout;
  }

  setPauseFanout(paused: boolean): void {
    this.pauseFanout = paused;
    if (!paused) void this.flushUpdates();
    this.emitTelemetry();
  }

  setKnobs(partial: Partial<{ snapshotRows: number; rate: number; batchSize: number; updatesPerTick: number; wsUrl: string }>): void {
    if (partial.snapshotRows !== undefined) this.opts.snapshotRows = partial.snapshotRows;
    if (partial.rate !== undefined) this.opts.rate = partial.rate;
    if (partial.batchSize !== undefined) this.opts.batchSize = partial.batchSize;
    if (partial.updatesPerTick !== undefined) this.opts.updatesPerTick = partial.updatesPerTick;
    if (partial.wsUrl !== undefined) this.opts.wsUrl = partial.wsUrl;
    this.emitTelemetry();
  }

  async ensureTable(): Promise<Table> {
    if (this.table) return this.table;
    this.setPhase('bootstrapping');
    // Phase 5 — under the SharedWorker engine every tab binds ONE fixed
    // table name (attach if another tab already created it). Dedicated
    // fallback keeps the per-client name so parallel dedicated pages
    // can't collide.
    const { table, attached } = await openOrCreatePositionsTable(SHARED_TABLE_NAME);
    if (getPerspectiveWorkerMode() === 'shared') {
      this.table = table;
      this.sharedTable = true;
      void attached;
    } else {
      // openOrCreate on the dedicated engine just created 'positions-shared'
      // locally — fine to use directly (nothing else shares this engine).
      this.table = table;
      this.sharedTable = false;
    }
    this.setPhase('idle');
    return this.table;
  }

  // ─── Phase 5: feed leadership (Web Locks; one feeder per origin) ─────

  private static readonly FEED_LOCK = 'cgrid-ssrm-demo:feed-leader';

  private hasWebLocks(): boolean {
    return typeof navigator !== 'undefined' && 'locks' in navigator;
  }

  /** Race for immediate leadership (`ifAvailable`); winner HOLDS the lock
   *  until `releaseLeadership`. Resolves won/lost without blocking. */
  private tryLeadFeed(): Promise<boolean> {
    if (!this.sharedTable || !this.hasWebLocks()) {
      this.feedRole = 'leader';
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolveWon) => {
      void navigator.locks.request(
        PerspectiveBook.FEED_LOCK,
        { ifAvailable: true },
        async (lock) => {
          if (lock === null || this.destroyed) {
            resolveWon(false);
            return;
          }
          this.feedRole = 'leader';
          resolveWon(true);
          await new Promise<void>((release) => { this.releaseFeedLock = release; });
        },
      );
    });
  }

  /** Queue for takeover: when the current leader's tab closes, the lock
   *  releases and this tab starts feeding the (already-populated) book. */
  private queueFeedTakeover(): void {
    if (!this.sharedTable || !this.hasWebLocks() || this.leadershipQueued) return;
    this.leadershipQueued = true;
    this.feedRole = 'follower';
    this.emitTelemetry();
    void navigator.locks.request(PerspectiveBook.FEED_LOCK, async () => {
      if (this.destroyed) return;
      this.feedRole = 'leader';
      this.emitTelemetry();
      // Book is live already (we adopted the snapshot) — just start feeding.
      if (this.opts.feed === 'seed') this.startSeedLive();
      else this.activateStomp();
      await new Promise<void>((release) => { this.releaseFeedLock = release; });
    });
  }

  private releaseLeadership(): void {
    this.leadershipQueued = false;
    if (this.releaseFeedLock) {
      this.releaseFeedLock();
      this.releaseFeedLock = null;
    }
    if (this.feedRole === 'leader') this.feedRole = 'none';
  }

  private async sharedTableSize(): Promise<number> {
    try {
      return Number(await this.withTableLock(() => this.table!.size()));
    } catch {
      return 0;
    }
  }

  /** Follower boot: the leader owns the snapshot — poll until rows exist
   *  (or give up and seed ourselves; keyed updates make that benign). */
  private async waitForSharedSnapshot(timeoutMs = 30_000): Promise<number> {
    const start = Date.now();
    for (;;) {
      const size = await this.sharedTableSize();
      if (size > 0 || Date.now() - start > timeoutMs || this.destroyed) return size;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** Adopt an already-populated shared book: no snapshot work, straight
   *  to live; the leader's `table.update` ticks reach our views via the
   *  shared engine's realtime poll. */
  private async adoptSharedLive(size: number): Promise<void> {
    this.snapshotComplete = true;
    this.snapshotRowsLoaded = size;
    this.setPhase('live');
    for (const id of this.views.keys()) void this.refreshProjected(id);
    this.emitTelemetry();
  }

  async registerView(spec: ViewSpec): Promise<View> {
    await this.ensureTable();
    await this.unregisterView(spec.id);
    const bound = await this.mountViews(spec, [], []);
    this.views.set(spec.id, bound);
    void this.refreshProjected(spec.id);
    this.emitTelemetry();
    return bound.view!;
  }

  getView(viewId: string): View | null {
    return this.views.get(viewId)?.view ?? null;
  }

  getGroupKeys(viewId: string): string[] {
    return this.views.get(viewId)?.groupKeys ?? [];
  }

  /** Mark pending row-group columns; `getSsrmRows` remounts with full filter/sort. */
  async setViewGroupBy(viewId: string, rowGroupCols: string[]): Promise<void> {
    const bound = this.views.get(viewId);
    if (!bound) return;
    const next = normalizeRowGroupCols(rowGroupCols);
    if (rowGroupColsEqual(next, bound.groupBy)) return;
    bound.groupBy = next;
    bound.groupedRawCache = null;
    bound.groupKeys = [];
  }

  /** Serialize per-view Perspective work — concurrent remounts hang WASM. */
  private async withViewChain<T>(viewId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.getRowsChains.get(viewId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.getRowsChains.set(viewId, prev.then(() => gate, () => gate));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Sparse SSRM v1 row window — flat or grouped (Perspective owns compute). */
  async getSsrmRows(viewId: string, req: SsrmRowsRequest): Promise<SsrmRowsResult> {
    return this.withViewChain(viewId, () => this.getSsrmRowsInner(viewId, req));
  }

  // ─── SSRM v2 skeleton contract (kernel owns the tree shape) ────────────

  /** Every group row (all depths) for the current query — the kernel builds
   *  the flatten index; expansion state never reaches Perspective. */
  async getGroupSkeleton(
    viewId: string,
    req: { sortModel: SortModel; filterModel: FilterModel; rowGroupCols: string[] },
  ): Promise<SkeletonGroup[]> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.view) return [];
      await this.syncQuery(bound, viewId, req.sortModel, req.filterModel, req.rowGroupCols);
      if (bound.groupBy.length === 0) return [];
      const raw = await this.getGroupedRaw(bound);
      const groups: SkeletonGroup[] = [];
      for (const row of raw) {
        const path = row.__ROW_PATH__;
        if (!Array.isArray(path) || path.length > bound.groupBy.length) {
          continue;
        }
        const aggregates: Record<string, unknown> = {};
        for (const col of ['notionalAmount', 'marketValue', 'pnl', 'dailyPnl'] as const) {
          if (row[col] !== undefined) aggregates[col] = row[col];
        }
        // `path: []` is Perspective's root aggregate row — the kernel reads
        // it as the grand total (pinned totals row / grand-total footer).
        groups.push({
          path: path.map((v) => String(v ?? '')),
          // Perspective `count` aggregate on positionId = leaves in subtree.
          leafCount: path.length === 0 ? 0 : Math.max(0, Number(row.positionId ?? 0) | 0),
          aggregates,
        });
      }
      return groups;
    });
  }

  /** Leaf window under one deepest-level group, addressed by raw path. */
  async getLeafRows(
    viewId: string,
    req: {
      groupPath: string[];
      startRow: number;
      endRow: number;
      sortModel: SortModel;
      filterModel: FilterModel;
      rowGroupCols: string[];
    },
  ): Promise<PositionRow[]> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.view) return [];
      const { extraFilter, sort } = await this.syncQuery(
        bound, viewId, req.sortModel, req.filterModel, req.rowGroupCols,
      );
      return this.fetchLeafWindowByPath(
        bound, req.groupPath, req.startRow, req.endRow, extraFilter, sort,
      );
    });
  }

  /** Flat (ungrouped) window for the v2 `getRows` fallback. Carries the
   *  totalsView's root aggregates so the kernel's pinned grand total works
   *  without a skeleton. */
  async getFlatRows(
    viewId: string,
    req: { startRow: number; endRow: number; sortModel: SortModel; filterModel: FilterModel },
  ): Promise<{ rows: PositionRow[]; rowCount: number; grandTotals?: Record<string, unknown> }> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.view) return { rows: [], rowCount: 0 };
      await this.syncQuery(bound, viewId, req.sortModel, req.filterModel, [], true);
      // count + read under one lock — see fetchLeafWindowByPath.
      return this.withTableLock(async () => {
        const rowCount = Math.max(0, Number(await bound.view!.num_rows()));
        let grandTotals: Record<string, unknown> | undefined;
        if (bound.totalsView) {
          try {
            const json = (await bound.totalsView.to_json({ start_row: 0, end_row: 1 })) as Record<string, unknown>[];
            const row = json[0];
            if (row) {
              const { __ROW_PATH__: _p, ...rest } = row as Record<string, unknown> & { __ROW_PATH__?: unknown };
              grandTotals = rest;
            }
          } catch { /* omit totals */ }
        }
        const start = Math.max(0, req.startRow | 0);
        const end = Math.max(start, Math.min(req.endRow | 0, rowCount));
        if (end <= start || rowCount === 0) return { rows: [], rowCount, grandTotals };
        const rows = (await readRows(bound.view!, { start_row: start, end_row: end })) as PositionRow[];
        return { rows, rowCount, grandTotals };
      });
    });
  }

  /** SSRM v2 — every descendant leaf row-id under one group (any depth).
   *  Powers the group-checkbox selection cascade on the sparse path. */
  async getGroupLeafIds(
    viewId: string,
    req: {
      groupPath: string[];
      sortModel: SortModel;
      filterModel: FilterModel;
      rowGroupCols: string[];
    },
  ): Promise<string[]> {
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.view || !this.table) return [];
      const { extraFilter } = await this.syncQuery(
        bound, viewId, req.sortModel, req.filterModel, req.rowGroupCols,
      );
      if (req.groupPath.length === 0 || req.groupPath.length > bound.groupBy.length) return [];
      // Fast path — descendant leaves of ANY-depth group are a contiguous
      // run of deepest-group ranges (display order), so ids are one offset
      // window on the persistent leafView.
      if (bound.leafView !== null && !bound.leafOffsetsUnreliable) {
        if (bound.leafRangeByPath === null) await this.getGroupedRaw(bound);
        const ranges = bound.leafRanges;
        if (ranges !== null) {
          const prefix = req.groupPath;
          let startOff = -1;
          let endOff = -1;
          for (const r of ranges) {
            const matches = prefix.every((v, i) => r.path[i] === v);
            if (matches) {
              if (startOff < 0) startOff = r.offset;
              endOff = r.offset + r.count;
            } else if (startOff >= 0) {
              break; // contiguous run ended
            }
          }
          if (startOff >= 0 && endOff > startOff) {
            const rows = await this.withTableLock(
              () => readRows(bound.leafView!, { start_row: startOff, end_row: endOff }),
            );
            // Same contiguity spot-check as fetchLeafWindowByPath — the
            // first row of the window must belong to the requested group
            // path, else offsets are stale and the selection cascade would
            // collect the WRONG ids. On mismatch fall through to the
            // filtered-view path below.
            const first = rows[0] as Record<string, unknown> | undefined;
            const contiguous = first === undefined || prefix.every(
              (v, i) => String(first[bound.groupBy[i]!] ?? '') === v,
            );
            if (contiguous) {
              return rows
                .map((r) => String((r as { positionId?: unknown }).positionId ?? ''))
                .filter((s) => s !== '');
            }
            if (!this.warnedLeafOffsetMismatch) {
              this.warnedLeafOffsetMismatch = true;
              console.warn(
                '[PerspectiveBook] leaf offset window mismatched its group — grouped-view ordering '
                + 'diverges from the leaf sort; falling back to filtered leaf reads until remount.',
              );
            }
            bound.leafOffsetsUnreliable = true;
          } else {
            return [];
          }
        }
      }
      const groupFilter: PspFilter[] = req.groupPath.map(
        (v, i) => [bound.groupBy[i]!, '==', v],
      );
      const filter = [...(bound.spec.filter ?? []), ...extraFilter, ...groupFilter];
      return this.withTableLock(async () => {
        const idView = await this.table!.view({ columns: ['positionId'], filter } as never);
        try {
          const json = (await idView.to_json()) as Array<{ positionId?: unknown }>;
          return json
            .map((r) => String(r.positionId ?? ''))
            .filter((s) => s !== '');
        } finally {
          try { await idView.delete(); } catch { /* swallow */ }
        }
      });
    });
  }

  private async withTableLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tableChain;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.tableChain = prev.then(() => gate, () => gate);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Sync the bound Perspective view to the requested query (sort / filter /
   * groupBy), remounting when the signature changes. `trustEmptyGroupBy`
   * (v2 flat path) skips the v1 race guard that resurrects a stale
   * `bound.groupBy` when the request carries no group columns.
   */
  private async syncQuery(
    bound: BoundView,
    viewId: string,
    sortModel: SortModel,
    filterModel: FilterModel,
    rowGroupCols: string[],
    trustEmptyGroupBy = false,
  ): Promise<{ extraFilter: PspFilter[]; sort: Array<[string, 'asc' | 'desc']> }> {
    const extraFilter = cgridFilterToPsp(filterModel);
    const sort = cgridSortToPsp(sortModel);
    let requestedGroupBy = normalizeRowGroupCols(rowGroupCols);
    // Race: columnRowGroupChanged may set bound.groupBy before SSRM ships cols.
    if (!trustEmptyGroupBy && requestedGroupBy.length === 0 && bound.groupBy.length > 0) {
      requestedGroupBy = bound.groupBy;
    }
    if (!rowGroupColsEqual(requestedGroupBy, bound.groupBy)) {
      bound.groupBy = requestedGroupBy;
      bound.groupedRawCache = null;
      bound.groupKeys = [];
    }
    const querySig = JSON.stringify({
      sort: sortModel,
      filter: filterModel,
      groupBy: bound.groupBy,
    });
    if (querySig !== bound.lastQuerySig) {
      bound.lastQuerySig = querySig;
      await this.withTableLock(() => this.remountDataView(bound, extraFilter, sort));
      void this.refreshProjected(viewId);
    }
    return { extraFilter, sort };
  }

  private async getSsrmRowsInner(viewId: string, req: SsrmRowsRequest): Promise<SsrmRowsResult> {
    const bound = this.views.get(viewId);
    if (!bound?.view) {
      return { rows: [], rowCount: 0, groupKeys: [] };
    }

    const requestedGroupBy = normalizeRowGroupCols(req.rowGroupCols);
    const { extraFilter, sort } = await this.syncQuery(
      bound, viewId, req.sortModel, req.filterModel, req.rowGroupCols,
    );

    if (bound.groupBy.length === 0) {
      const rowCount = Math.max(0, Number(
        await this.withTableLock(() => bound.view!.num_rows()),
      ));
      const start = Math.max(0, req.startRow | 0);
      const end = Math.max(start, Math.min(req.endRow | 0, rowCount));
      if (end <= start || rowCount === 0) {
        this.lastGetRowsDebug.set(viewId, {
          requestedGroupBy: [...requestedGroupBy],
          boundGroupBy: [...bound.groupBy],
          branch: 'empty',
          rowCount,
          served: 0,
        });
        return { rows: [], rowCount, groupKeys: [] };
      }
      const json = (await this.withTableLock(
        () => bound.view!.to_json({ start_row: start, end_row: end }),
      )) as PositionRow[];
      this.lastGetRowsDebug.set(viewId, {
        requestedGroupBy: [...requestedGroupBy],
        boundGroupBy: [...bound.groupBy],
        branch: 'flat',
        rowCount,
        served: json.length,
      });
      return { rows: json, rowCount, groupKeys: [] };
    }

    const start = Math.max(0, req.startRow | 0);
    const end = Math.max(start, req.endRow | 0);
    const { rows, rowCount } = await this.materializeGroupedWindow(
      bound,
      req.expandedGroupKeys,
      extraFilter,
      sort,
      start,
      end,
    );
    this.lastGetRowsDebug.set(viewId, {
      requestedGroupBy: [...requestedGroupBy],
      boundGroupBy: [...bound.groupBy],
      branch: 'grouped',
      rowCount,
      served: rows.length,
    });
    return {
      rows,
      rowCount,
      groupKeys: bound.groupKeys,
    };
  }

  async fetchGrandTotal(viewId: string): Promise<PositionRow> {
    // Serialize behind the view chain so a concurrent syncQuery remount
    // can't hand us a deleted totalsView mid-read.
    return this.withViewChain(viewId, async () => {
      const bound = this.views.get(viewId);
      if (!bound?.totalsView) return emptyGrandTotalRow();
      try {
        const json = await this.withTableLock(
          () => bound.totalsView!.to_json({ start_row: 0, end_row: 1 }) as Promise<Record<string, unknown>[]>,
        );
        const row = json[0];
        if (!row) return emptyGrandTotalRow();
        const { __ROW_PATH__: _path, ...totals } = row as Record<string, unknown> & {
          __ROW_PATH__?: unknown;
        };
        return { ...emptyGrandTotalRow(), ...totals } as PositionRow;
      } catch {
        return emptyGrandTotalRow();
      }
    });
  }

  private async materializeGroupedWindow(
    bound: BoundView,
    expandedGroupKeys: readonly string[],
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
    startRow: number,
    endRow: number,
  ): Promise<{ rows: PositionRow[]; rowCount: number }> {
    const raw = await this.getGroupedRaw(bound);
    return buildGroupedSsrmWindow(
      raw,
      {
        rowGroupCols: bound.groupBy,
        expandedGroupKeys,
        includeGrandTotal: false,
        includeGroupFooter: false,
      },
      startRow,
      endRow,
      (groupKey, leafStart, leafEnd) =>
        this.fetchLeafWindow(bound, groupKey, leafStart, leafEnd, extraFilter, sort),
    );
  }

  /** v1 shim — composite key → raw path, then the path-based fetch. */
  private async fetchLeafWindow(
    bound: BoundView,
    groupKey: string,
    leafStart: number,
    leafEnd: number,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<PositionRow[]> {
    const segments = parseCompositeGroupKey(groupKey);
    return this.fetchLeafWindowByPath(
      bound, segments.map((s) => s.value), leafStart, leafEnd, extraFilter, sort,
    );
  }

  private warnedLeafOffsetMismatch = false;

  /** Windowed leaf rows for one fully-expanded deepest group.
   *
   *  Fast path (engine-local unification, 2026-07-23): an OFFSET window on
   *  the persistent sorted `leafView` — zero view churn, one read. A
   *  spot-check verifies the first row actually belongs to the group; on
   *  mismatch (group ordering diverged between the grouped view and the
   *  leaf sort, e.g. aggregate-ordered groups) offsets are disabled until
   *  the next remount and the filtered per-fetch path serves instead. */
  private async fetchLeafWindowByPath(
    bound: BoundView,
    groupPath: readonly string[],
    leafStart: number,
    leafEnd: number,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<PositionRow[]> {
    if (!this.table || leafEnd <= leafStart) return [];
    if (groupPath.length !== bound.groupBy.length) return [];

    if (bound.leafView !== null && !bound.leafOffsetsUnreliable) {
      if (bound.leafRangeByPath === null) await this.getGroupedRaw(bound);
      const idx = bound.leafRangeByPath?.get(JSON.stringify([...groupPath]));
      if (idx !== undefined) {
        const range = bound.leafRanges![idx]!;
        const start = range.offset + Math.max(0, leafStart);
        const end = range.offset + Math.min(range.count, leafEnd);
        if (end <= start) return [];
        const rows = (await this.withTableLock(
          () => readRows(bound.leafView!, { start_row: start, end_row: end }),
        )) as PositionRow[];
        const first = rows[0] as Record<string, unknown> | undefined;
        const contiguous = first === undefined || bound.groupBy.every(
          (colId, i) => String(first[colId] ?? '') === groupPath[i],
        );
        if (contiguous) return rows;
        if (!this.warnedLeafOffsetMismatch) {
          this.warnedLeafOffsetMismatch = true;
          console.warn(
            '[PerspectiveBook] leaf offset window mismatched its group — grouped-view ordering '
            + 'diverges from the leaf sort; falling back to filtered leaf reads until remount.',
          );
        }
        bound.leafOffsetsUnreliable = true;
      }
    }
    return this.fetchLeafWindowByFilter(bound, groupPath, leafStart, leafEnd, extraFilter, sort);
  }

  /** Fallback — filtered per-fetch view (create → read → delete). */
  private async fetchLeafWindowByFilter(
    bound: BoundView,
    groupPath: readonly string[],
    leafStart: number,
    leafEnd: number,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<PositionRow[]> {
    const groupFilter: PspFilter[] = bound.groupBy.map(
      (colId, i) => [colId, '==', groupPath[i] ?? ''],
    );
    const filter = [...(bound.spec.filter ?? []), ...extraFilter, ...groupFilter];
    const config: Record<string, unknown> = {
      columns: [...DATA_COLUMNS],
      filter,
    };
    if (sort.length > 0) config.sort = sort;

    // ONE lock hold for create → count → read → delete. The old per-step
    // locking left windows where a concurrent table op (live `update`,
    // another view's remount) interleaved — the exact "concurrent ops hang
    // Perspective WASM" trap the chains exist to prevent.
    return this.withTableLock(async () => {
      const leafView = await this.table!.view(config as never);
      try {
        const count = Number(await leafView.num_rows());
        if (count <= 0) return [];
        const start = Math.max(0, Math.min(leafStart, count));
        const end = Math.max(start, Math.min(leafEnd, count));
        if (end <= start) return [];
        return (await leafView.to_json({ start_row: start, end_row: end })) as PositionRow[];
      } finally {
        try { await leafView.delete(); } catch { /* swallow */ }
      }
    });
  }

  private async getGroupedRaw(bound: BoundView): Promise<Record<string, unknown>[]> {
    if (bound.groupedRawCache) return bound.groupedRawCache;
    const raw = await this.withTableLock(() => readRows(bound.view!));
    bound.groupedRawCache = raw;
    bound.groupKeys = [];
    // Rebuild leaf ranges alongside the skeleton dump: deepest-level rows
    // in dump order → cumulative leafCount offsets into the sorted
    // leafView (contiguity holds as long as the grouped view's group
    // ordering matches the leafView's group-column sort — spot-checked at
    // read time).
    const ranges: Array<{ path: string[]; offset: number; count: number }> = [];
    const byPath = new Map<string, number>();
    let offset = 0;
    for (const row of raw) {
      const path = row.__ROW_PATH__;
      if (!Array.isArray(path) || path.length === 0) continue;
      const strPath = path.map((v) => String(v ?? ''));
      bound.groupKeys.push(buildCompositeGroupKey(bound.groupBy, strPath));
      if (path.length === bound.groupBy.length) {
        const count = Math.max(0, Number(row.positionId ?? 0) | 0);
        byPath.set(JSON.stringify(strPath), ranges.length);
        ranges.push({ path: strPath, offset, count });
        offset += count;
      }
    }
    bound.leafRanges = ranges;
    bound.leafRangeByPath = byPath;
    return raw;
  }

  private async remountDataView(
    bound: BoundView,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<void> {
    if (bound.dataUpdateCb !== null && bound.view) {
      try { await bound.view.remove_update(bound.dataUpdateCb); } catch { /* swallow */ }
    }
    if (bound.totalsView) {
      try { await bound.totalsView.delete(); } catch { /* swallow */ }
    }
    if (bound.leafView) {
      try { await bound.leafView.delete(); } catch { /* swallow */ }
      bound.leafView = null;
    }
    bound.leafRanges = null;
    bound.leafRangeByPath = null;
    bound.leafOffsetsUnreliable = false;
    if (bound.view) {
      try { await bound.view.delete(); } catch { /* swallow */ }
    }

    const filter = [...(bound.spec.filter ?? []), ...extraFilter];
    const config: Record<string, unknown> = {
      columns: [...DATA_COLUMNS],
      filter,
    };
    if (sort.length > 0) config.sort = sort;
    if (bound.groupBy.length > 0) {
      config.group_by = bound.groupBy;
      config.aggregates = { ...VALUE_AGGREGATES };
    }

    bound.view = await this.table!.view(config as never);
    // Perspective IGNORES `aggregates` on an ungrouped view — the old
    // group_by-less config made `fetchGrandTotal` read raw row 0 (zeros on
    // an empty/loading table). Any group_by makes to_json emit the root
    // aggregate row (`__ROW_PATH__: []`) first — the real grand total.
    bound.totalsView = await this.table!.view({
      columns: ['notionalAmount', 'marketValue', 'pnl', 'dailyPnl'],
      filter,
      group_by: ['desk'],
      aggregates: { ...VALUE_AGGREGATES },
    } as never);
    // ONE persistent flat leaf view, sorted by the group columns first
    // (direction matching any user sort on those columns) so each deepest
    // group's leaves form a contiguous range — leaf windows become offset
    // reads on this view instead of per-fetch view create/read/delete.
    if (bound.groupBy.length > 0) {
      const dirFor = (colId: string): 'asc' | 'desc' =>
        sort.find(([c]) => c === colId)?.[1] ?? 'asc';
      const leafSort: Array<[string, 'asc' | 'desc']> = [
        ...bound.groupBy.map((colId): [string, 'asc' | 'desc'] => [colId, dirFor(colId)]),
        ...sort.filter(([c]) => !bound.groupBy.includes(c)),
      ];
      bound.leafView = await this.table!.view({
        columns: [...DATA_COLUMNS],
        filter,
        sort: leafSort,
      } as never);
    }
    bound.groupedRawCache = null;
    bound.dataUpdateCb = Number(
      await bound.view.on_update(() => {
        bound.groupedRawCache = null;
        bound.groupKeys = [];
        // Adds/removes can shift leaf counts — recompute with the next
        // skeleton dump.
        bound.leafRanges = null;
        bound.leafRangeByPath = null;
        this.scheduleViewTick(bound.spec.id);
      }),
    );
    // Push fresh totals after every remount — the pinned grand-total row
    // otherwise only updates on live ticks, so a query change (or the
    // wire-time fetch racing the first remount) left it stale at zeros.
    // Drop any pending live batch first: the post-remount tick must not
    // replay pre-remount rows as fresh updates.
    this.pendingLiveBatch = [];
    this.scheduleViewTick(bound.spec.id);
  }

  private async mountViews(
    spec: ViewSpec,
    extraFilter: PspFilter[],
    sort: Array<[string, 'asc' | 'desc']>,
  ): Promise<BoundView> {
    const bound: BoundView = {
      spec,
      view: null,
      totalsView: null,
      leafView: null,
      leafRanges: null,
      leafRangeByPath: null,
      leafOffsetsUnreliable: false,
      dataUpdateCb: null,
      notifyTimer: null,
      groupBy: [],
      groupedRawCache: null,
      groupKeys: [],
      lastQuerySig: '',
      getRowsCalls: 0,
      rowsServed: 0,
      inflight: 0,
      projectedRows: 0,
    };
    await this.withTableLock(() => this.remountDataView(bound, extraFilter, sort));
    return bound;
  }

  noteGetRowsStart(viewId: string): void {
    const v = this.views.get(viewId);
    if (!v) return;
    v.inflight++;
    v.getRowsCalls++;
    this.getRowsTotal++;
    this.emitTelemetry();
  }

  noteGetRowsEnd(viewId: string, served: number, ok: boolean): void {
    const v = this.views.get(viewId);
    if (!v) return;
    v.inflight = Math.max(0, v.inflight - 1);
    if (ok) {
      v.rowsServed += served;
      this.rowsServedTotal += served;
    }
    this.emitTelemetry();
  }

  async unregisterView(viewId: string): Promise<void> {
    const v = this.views.get(viewId);
    if (!v) return;
    if (v.notifyTimer !== null) {
      clearTimeout(v.notifyTimer);
      v.notifyTimer = null;
    }
    // Drop from the map FIRST so queued chain ops re-reading the view bail
    // cleanly, then tear the handles down under the table lock — deleting a
    // view while the engine is mid-op is a wasm-bindgen "null pointer /
    // borrowed" panic.
    this.views.delete(viewId);
    await this.withTableLock(async () => {
      if (v.view && v.dataUpdateCb !== null) {
        try { await v.view.remove_update(v.dataUpdateCb); } catch { /* swallow */ }
      }
      if (v.view) {
        try { await v.view.delete(); } catch { /* swallow */ }
      }
      if (v.totalsView) {
        try { await v.totalsView.delete(); } catch { /* swallow */ }
      }
      if (v.leafView) {
        try { await v.leafView.delete(); } catch { /* swallow */ }
      }
    });
    this.emitTelemetry();
  }

  connect(): void {
    if (this.stomp || this.seedConnecting || this.seedLiveTimer !== null) return;
    void this.connectRouted();
  }

  /** Phase 5 routing: dedicated engines feed unconditionally (old
   *  behavior); on the shared engine, exactly one tab (the Web-Lock
   *  holder) feeds while the rest attach to the live book and queue for
   *  takeover. */
  private async connectRouted(): Promise<void> {
    await this.ensureTable();
    if (!this.sharedTable) {
      this.feedRole = 'leader';
      if (this.opts.feed === 'seed') await this.connectSeed();
      else this.activateStomp();
      return;
    }
    const size = await this.sharedTableSize();
    if (size > 0) {
      await this.adoptSharedLive(size);
      this.queueFeedTakeover();
      return;
    }
    if (await this.tryLeadFeed()) {
      if (this.opts.feed === 'seed') await this.connectSeed();
      else this.activateStomp();
      return;
    }
    const settled = await this.waitForSharedSnapshot();
    if (settled > 0) {
      await this.adoptSharedLive(settled);
      this.queueFeedTakeover();
      return;
    }
    // Leader never materialized (crashed mid-boot?) — seed ourselves;
    // positionId-keyed updates make a duplicate snapshot benign.
    if (this.opts.feed === 'seed') await this.connectSeed();
    else this.activateStomp();
  }

  private activateStomp(): void {
    void this.ensureTable().then(() => {
      this.setPhase('connecting');
      this.snapshotComplete = false;
      this.snapshotRowsLoaded = 0;
      this.liveBatches = 0;
      this.liveRowsIn = 0;
      this.liveWindow = [];
      this.updateBuffer = [];

      const client = new Client({
        brokerURL: this.opts.wsUrl,
        reconnectDelay: 2000,
        heartbeatIncoming: 0,
        heartbeatOutgoing: 0,
        onConnect: () => this.onConnected(),
        onStompError: () => this.setPhase('error'),
        onWebSocketError: () => this.setPhase('error'),
        onWebSocketClose: () => this.setPhase('disconnected'),
      });
      this.stomp = client;
      client.activate();
      this.emitTelemetry();
    });
  }

  disconnect(): void {
    this.stopSeedLive();
    this.seedConnecting = false;
    // Phase 5 — stop leading so another tab can take the feed over.
    this.releaseLeadership();
    const c = this.stomp;
    this.stomp = null;
    if (c) {
      try { void c.deactivate(); } catch { /* swallow */ }
    }
    this.setPhase('disconnected');
  }

  private async connectSeed(): Promise<void> {
    this.seedConnecting = true;
    try {
      await this.ensureTable();
      this.setPhase('connecting');
      this.snapshotComplete = false;
      this.snapshotRowsLoaded = 0;
      this.liveBatches = 0;
      this.liveRowsIn = 0;
      this.liveWindow = [];
      this.updateBuffer = [];
      this.setPhase('snapshot');

      const n = Math.max(100, this.opts.snapshotRows | 0);
      const rnd = mulberry32(0xc6_1d);
      const chunk = Math.max(200, this.opts.batchSize * 10);
      for (let i = 0; i < n; i += chunk) {
        if (!this.seedConnecting) return;
        const end = Math.min(n, i + chunk);
        const rows: PositionRow[] = [];
        for (let j = i; j < end; j++) rows.push(makeSeedRow(j, rnd));
        // Table writes take the same lock as view create/read/delete —
        // unserialized writes interleaving with the SSRM leaf-view churn
        // wedge Perspective WASM (poisoned op chain → frozen grid).
        await this.withTableLock(() => this.table!.update(rows));
        this.snapshotRowsLoaded = end;
        this.emitTelemetry();
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }

      this.snapshotComplete = true;
      try {
        this.snapshotRowsLoaded = Number(await this.withTableLock(() => this.table!.size()));
      } catch { /* swallow */ }
      this.setPhase('live');
      for (const id of this.views.keys()) void this.refreshProjected(id);
      this.startSeedLive();
    } catch (err) {
      console.error('[PerspectiveBook] seed', err);
      this.setPhase('error');
    } finally {
      this.seedConnecting = false;
    }
  }

  private startSeedLive(): void {
    this.stopSeedLive();
    const intervalMs = Math.max(16, Math.round(1000 / Math.max(1, this.opts.rate)));
    const rnd = mulberry32(0x11fe);
    this.seedLiveTimer = window.setInterval(() => {
      if (this.pauseFanout || !this.table || !this.snapshotComplete) return;
      const n = Math.max(1, this.opts.updatesPerTick | 0);
      const book = Math.max(1, this.snapshotRowsLoaded);
      const rows: PositionRow[] = [];
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rnd() * book);
        const row = makeSeedRow(idx, rnd);
        row.pnl = Math.round((rnd() - 0.5) * 80_000 * 100) / 100;
        row.dailyPnl = Math.round(row.pnl * 0.08 * 100) / 100;
        row.marketValue = Math.round((row.notionalAmount ?? 0) * (0.92 + rnd() * 0.2));
        rows.push(row);
      }
      this.liveRowsIn += rows.length;
      this.liveWindow.push({ t: Date.now(), n: rows.length });
      this.updateBuffer.push(...rows);
      void this.flushUpdates();
    }, intervalMs);
  }

  private stopSeedLive(): void {
    if (this.seedLiveTimer !== null) {
      clearInterval(this.seedLiveTimer);
      this.seedLiveTimer = null;
    }
  }

  getTelemetry(): BookTelemetry {
    return this.buildTelemetry();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.telemetryTimer !== null) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.disconnect();
    for (const id of [...this.views.keys()]) void this.unregisterView(id);
    if (this.table) {
      // Phase 5 — the shared table belongs to every connected tab;
      // deleting it here would blank the others. It dies with the
      // SharedWorker when the last tab disconnects.
      if (!this.sharedTable) {
        try { void this.table.delete(); } catch { /* swallow */ }
      }
      this.table = null;
    }
  }

  private setPhase(phase: BookPhase): void {
    this.phase = phase;
    this.opts.onPhase?.(phase);
    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    this.opts.onTelemetry?.(this.buildTelemetry());
  }

  private buildTelemetry(): BookTelemetry {
    const now = Date.now();
    this.liveWindow = this.liveWindow.filter((x) => now - x.t < 1000);
    const liveUpdatesPerSec = this.liveWindow.reduce((s, x) => s + x.n, 0);
    return {
      phase: this.phase,
      bookSize: this.snapshotRowsLoaded || 0,
      snapshotRowsLoaded: this.snapshotRowsLoaded,
      liveBatches: this.liveBatches,
      liveRowsIn: this.liveRowsIn,
      liveUpdatesPerSec,
      getRowsTotal: this.getRowsTotal,
      rowsServedTotal: this.rowsServedTotal,
      viewCount: this.views.size,
      views: [...this.views.values()].map((v) => ({
        id: v.spec.id,
        label: v.spec.label,
        getRowsCalls: v.getRowsCalls,
        rowsServed: v.rowsServed,
        inflight: v.inflight,
        projectedRows: v.projectedRows,
      })),
      wsUrl: this.opts.feed === 'seed' ? 'seed://local' : this.opts.wsUrl,
      engine: 'perspective',
      workerMode: getPerspectiveWorkerMode(),
      feedRole: this.feedRole,
    };
  }

  private async refreshProjected(viewId: string): Promise<void> {
    const v = this.views.get(viewId);
    if (!v?.view) return;
    try {
      v.projectedRows = Number(await this.withTableLock(() => v.view!.num_rows()));
      this.emitTelemetry();
    } catch { /* swallow */ }
  }

  private onConnected(): void {
    if (!this.stomp) return;
    this.setPhase('snapshot');
    const topic = this.opts.snapshotTopic
      ?? `/snapshot/positions/${this.opts.clientId}`;
    const trigger = this.opts.triggerTopic
      ?? `${topic}/${this.opts.rate}/${this.opts.batchSize}`;
    this.stomp.subscribe(topic, (msg: IMessage) => void this.onMessage(msg));
    const headers: Record<string, string> = {
      'snapshot-rows': String(this.opts.snapshotRows),
      'updates-per-tick': String(this.opts.updatesPerTick),
    };
    if (this.opts.sparse) headers['live-mode'] = 'sparse';
    this.stomp.publish({ destination: trigger, body: trigger, headers });
  }

  private async onMessage(msg: IMessage): Promise<void> {
    const body = msg.body?.trim() ?? '';
    if (!body) return;

    // Exact match — a data row containing the token in a text field must
    // not end the snapshot early (data frames are JSON bodies). The
    // `{token}: ...` prefixed variant some servers send is also accepted.
    const endToken = this.opts.snapshotEndToken;
    if (body === endToken || body.startsWith(`${endToken}:`)) {
      if (this.snapshotComplete) return;
      await this.flushUpdates(true);
      this.snapshotComplete = true;
      if (this.table) {
        try { this.snapshotRowsLoaded = Number(await this.table.size()); } catch { /* swallow */ }
      }
      this.setPhase('live');
      for (const id of this.views.keys()) void this.refreshProjected(id);
      return;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return; }
    const deltas = extractRows(parsed);
    if (deltas.length === 0) return;
    const messageType = msg.headers['message-type'];

    // Key the payload on the configured column, mapped onto the canonical
    // `positionId` (table index / getRowId / dedupe all key on it).
    const keyColumn = this.opts.keyColumn;
    const rows: PositionRow[] = [];
    for (const delta of deltas) {
      const raw = (delta as Record<string, unknown>)[keyColumn];
      const id = raw != null ? String(raw) : '';
      if (!id) continue;
      const row = { ...delta, positionId: id } as PositionRow;
      if (keyColumn !== 'positionId') delete (row as Record<string, unknown>)[keyColumn];
      rows.push(row);
    }
    if (rows.length === 0) return;

    if (!this.snapshotComplete || messageType === 'snapshot') {
      this.updateBuffer.push(...rows);
      if (this.updateBuffer.length >= this.opts.batchSize) {
        await this.flushUpdates();
      } else {
        this.scheduleFlush();
      }
      return;
    }

    this.liveRowsIn += rows.length;
    this.liveWindow.push({ t: Date.now(), n: rows.length });
    this.updateBuffer.push(...rows);
    if (this.updateBuffer.length >= this.opts.batchSize) {
      await this.flushUpdates();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushUpdates();
    }, 32);
  }

  private async flushUpdates(force = false): Promise<void> {
    if (this.pauseFanout && !force) return;
    if (!this.table || this.updateBuffer.length === 0) return;
    const batch = this.updateBuffer.splice(0);
    try {
      // Serialized with view ops — see the seed-snapshot sibling comment.
      await this.withTableLock(() => this.table!.update(batch));
      if (!this.snapshotComplete) {
        this.snapshotRowsLoaded = Number(await this.withTableLock(() => this.table!.size()));
      } else {
        this.liveBatches++;
        // Accumulate (last write per id wins) — overwriting dropped any
        // batch that landed while the 100ms view-tick debounce was armed.
        if (this.pendingLiveBatch.length === 0) {
          this.pendingLiveBatch = batch;
        } else {
          const byId = new Map<string, PositionRow>();
          for (const row of this.pendingLiveBatch) byId.set(row.positionId, row);
          for (const row of batch) byId.set(row.positionId, row);
          this.pendingLiveBatch = [...byId.values()];
        }
        for (const id of this.views.keys()) void this.refreshProjected(id);
      }
      this.emitTelemetry();
    } catch (err) {
      console.error('[PerspectiveBook] table.update', err);
      this.setPhase('error');
    }
  }

  private scheduleViewTick(viewId: string): void {
    const v = this.views.get(viewId);
    if (!v || this.pauseFanout) return;
    if (v.notifyTimer !== null) return;
    v.notifyTimer = window.setTimeout(() => {
      v.notifyTimer = null;
      void this.emitViewTick(viewId);
    }, 100);
  }

  private async emitViewTick(viewId: string): Promise<void> {
    if (this.pauseFanout || !this.opts.onViewTick) return;
    const v = this.views.get(viewId);
    if (!v) return;
    const totals = await this.fetchGrandTotal(viewId);
    const updates = v.groupBy.length === 0
      ? this.pendingLiveBatch.filter((row) => rowMatchesViewFilter(v.spec, row))
      : [];
    // Consumed — clear once the LAST armed tick has fired (earlier ticks in
    // the same round still need it; a later tick must not replay it as
    // fresh updates).
    if (![...this.views.values()].some((x) => x.notifyTimer !== null)) {
      this.pendingLiveBatch = [];
    }
    // Phase 5 — on follower tabs the feeder's row batch lives in ANOTHER
    // tab; this view only learned of the remote update via `on_update`.
    // Route flat views to a band-scoped soft refresh so remote ticks
    // paint (leaders keep the cheaper patch path).
    const remoteFlatTick =
      v.groupBy.length === 0 && updates.length === 0 && this.feedRole === 'follower';
    this.opts.onViewTick({
      viewId,
      totals,
      refreshSsrm: v.groupBy.length > 0 || remoteFlatTick,
      updates,
    });
  }
}
