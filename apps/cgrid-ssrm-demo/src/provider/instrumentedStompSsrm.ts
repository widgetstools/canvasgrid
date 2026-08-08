import { Client, type IMessage } from '@stomp/stompjs';
import type {
  VelocityGrid,
  FilterModel,
  IServerSideDatasource,
  IServerSideGetRowsParams,
  SortModel,
} from '@wellsfargo-starui/velocity-grid';
import { emptyGrandTotalRow, GRAND_TOTAL_ROW_ID } from '@wellsfargo-starui/velocity-grid-perspective';

export type StompRow = Record<string, unknown> & { positionId: string };

export type ProviderPhase =
  | 'idle'
  | 'connecting'
  | 'snapshot'
  | 'live'
  | 'error'
  | 'disconnected';

export interface ViewWindow {
  startRow: number;
  endRow: number;
  at: number;
}

export interface ViewMetrics {
  id: string;
  label: string;
  /** Rows matching this view's projection filter. */
  projectedRows: number;
  /** SSRM getRows invocations. */
  getRowsCalls: number;
  /** Sum of rowData lengths returned from getRows. */
  rowsServed: number;
  /** getRows currently awaiting success (should stay low). */
  inflight: number;
  /** Recent getRows windows waiting / just completed (visual queue). */
  recentWindows: ViewWindow[];
  /** Live ticks applied to this view. */
  liveTicksApplied: number;
  /** Live update rows pushed to this view. */
  liveRowsPushed: number;
  lastServedAt: number | null;
}

export interface ProviderTelemetry {
  phase: ProviderPhase;
  bookSize: number;
  snapshotRowsLoaded: number;
  liveBatches: number;
  liveRowsIn: number;
  liveUpdatesPerSec: number;
  /** Provider-side coalesce buffer before fan-out. */
  liveQueueDepth: number;
  getRowsTotal: number;
  rowsServedTotal: number;
  viewCount: number;
  views: ViewMetrics[];
  wsUrl: string;
  clientId: string;
  knobs: { snapshotRows: number; rate: number; batchSize: number; updatesPerTick: number };
}

export interface ViewSpec {
  id: string;
  label: string;
  filter?: (row: StompRow) => boolean;
}

export interface InstrumentedProviderOptions {
  wsUrl?: string;
  clientId?: string;
  snapshotRows?: number;
  rate?: number;
  batchSize?: number;
  updatesPerTick?: number;
  sparse?: boolean;
  onTelemetry?: (t: ProviderTelemetry) => void;
  onPhase?: (phase: ProviderPhase) => void;
}

const SNAPSHOT_END_TOKEN = 'Success';
const RECENT_WINDOW_CAP = 12;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

export function deepMergeRow(base: StompRow, patch: Partial<StompRow>): StompRow {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'positionId') continue;
    const prev = out[key];
    if (isPlainObject(value) && isPlainObject(prev)) {
      out[key] = deepMergeRow(prev as StompRow, value as Partial<StompRow>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  out.positionId = base.positionId;
  return out as StompRow;
}

function extractRows(parsed: unknown): Partial<StompRow>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as Partial<StompRow>[];
  }
  if (parsed && typeof parsed === 'object') return [parsed as Partial<StompRow>];
  return [];
}

function applySort(rows: StompRow[], sortModel: SortModel): StompRow[] {
  if (!sortModel.length) return rows;
  const out = rows.slice();
  out.sort((a, b) => {
    for (const { colId, direction } of sortModel) {
      const av = a[colId];
      const bv = b[colId];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return out;
}

function applyFilterModel(rows: StompRow[], filterModel: FilterModel): StompRow[] {
  const entries = Object.entries(filterModel);
  if (entries.length === 0) return rows;
  return rows.filter((row) => {
    for (const [colId, entry] of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const raw = row[colId];
      if (e.filterType === 'text' || typeof e.filter === 'string') {
        const needle = String(e.filter ?? '').toLowerCase();
        if (needle && !String(raw ?? '').toLowerCase().includes(needle)) return false;
      } else if (e.filterType === 'number' || typeof e.filter === 'number') {
        const n = Number(raw);
        const f = Number(e.filter);
        if (!Number.isFinite(n) || !Number.isFinite(f)) return false;
        const op = String(e.type ?? 'equals');
        if (op === 'equals' && n !== f) return false;
        if (op === 'greaterThan' && !(n > f)) return false;
        if (op === 'lessThan' && !(n < f)) return false;
      }
    }
    return true;
  });
}

interface BoundView {
  spec: ViewSpec;
  grid: VelocityGrid<StompRow> | null;
  getRowsCalls: number;
  rowsServed: number;
  inflight: number;
  recentWindows: ViewWindow[];
  liveTicksApplied: number;
  liveRowsPushed: number;
  lastServedAt: number | null;
}

/**
 * STOMP → shared book → N SSRM views, with rich telemetry for the demo visualizer.
 */
export class InstrumentedStompSsrmProvider {
  private readonly opts: Required<
    Pick<
      InstrumentedProviderOptions,
      'wsUrl' | 'clientId' | 'snapshotRows' | 'rate' | 'batchSize' | 'updatesPerTick' | 'sparse'
    >
  > &
    Pick<InstrumentedProviderOptions, 'onTelemetry' | 'onPhase'>;

  private client: Client | null = null;
  private phase: ProviderPhase = 'idle';
  private store = new Map<string, StompRow>();
  private order: string[] = [];
  private liveBuffer: StompRow[] = [];
  private liveFlushTimer: number | null = null;
  private snapshotComplete = false;
  private pauseFanout = false;

  private snapshotRowsLoaded = 0;
  private liveBatches = 0;
  private liveRowsIn = 0;
  private liveWindow: Array<{ t: number; n: number }> = [];
  private getRowsTotal = 0;
  private rowsServedTotal = 0;

  private views = new Map<string, BoundView>();
  private telemetryTimer: number | null = null;
  private totalsSyncTimer: number | null = null;

  constructor(options: InstrumentedProviderOptions = {}) {
    this.opts = {
      wsUrl: options.wsUrl ?? 'ws://localhost:8081',
      clientId: options.clientId ?? `ssrm-demo-${Math.floor(Math.random() * 1e6).toString(16)}`,
      snapshotRows: options.snapshotRows ?? 10_000,
      rate: options.rate ?? 40,
      batchSize: options.batchSize ?? 50,
      updatesPerTick: options.updatesPerTick ?? 5,
      sparse: options.sparse ?? true,
      onTelemetry: options.onTelemetry,
      onPhase: options.onPhase,
    };
    this.telemetryTimer = window.setInterval(() => this.emitTelemetry(), 200);
  }

  getPhase(): ProviderPhase {
    return this.phase;
  }

  getKnobs() {
    return {
      snapshotRows: this.opts.snapshotRows,
      rate: this.opts.rate,
      batchSize: this.opts.batchSize,
      updatesPerTick: this.opts.updatesPerTick,
      wsUrl: this.opts.wsUrl,
    };
  }

  setKnobs(partial: Partial<{ snapshotRows: number; rate: number; batchSize: number; updatesPerTick: number; wsUrl: string }>): void {
    if (partial.snapshotRows !== undefined) this.opts.snapshotRows = partial.snapshotRows;
    if (partial.rate !== undefined) this.opts.rate = partial.rate;
    if (partial.batchSize !== undefined) this.opts.batchSize = partial.batchSize;
    if (partial.updatesPerTick !== undefined) this.opts.updatesPerTick = partial.updatesPerTick;
    if (partial.wsUrl !== undefined) this.opts.wsUrl = partial.wsUrl;
    this.emitTelemetry();
  }

  setPauseFanout(paused: boolean): void {
    this.pauseFanout = paused;
    if (!paused && this.liveBuffer.length) this.flushLive(this.liveBuffer.splice(0));
    this.emitTelemetry();
  }

  isFanoutPaused(): boolean {
    return this.pauseFanout;
  }

  /** Register a named view (before or after connect). */
  registerView(spec: ViewSpec): IServerSideDatasource<StompRow> {
    const existing = this.views.get(spec.id);
    const bound: BoundView = existing ?? {
      spec,
      grid: null,
      getRowsCalls: 0,
      rowsServed: 0,
      inflight: 0,
      recentWindows: [],
      liveTicksApplied: 0,
      liveRowsPushed: 0,
      lastServedAt: null,
    };
    bound.spec = spec;
    this.views.set(spec.id, bound);
    this.emitTelemetry();

    return {
      getRows: (params: IServerSideGetRowsParams<StompRow>) => {
        const view = this.views.get(spec.id);
        if (!view) {
          params.fail();
          return;
        }
        view.inflight++;
        view.getRowsCalls++;
        this.getRowsTotal++;
        const window: ViewWindow = {
          startRow: params.request.startRow,
          endRow: params.request.endRow,
          at: Date.now(),
        };
        view.recentWindows.unshift(window);
        if (view.recentWindows.length > RECENT_WINDOW_CAP) view.recentWindows.length = RECENT_WINDOW_CAP;
        this.emitTelemetry();

        // Yield so the visualizer can paint inflight state.
        queueMicrotask(() => {
          try {
            const rows = this.projectRows(spec.filter, params.request.filterModel, params.request.sortModel);
            const start = Math.max(0, params.request.startRow);
            const end = Math.max(start, params.request.endRow);
            const slice = rows.slice(start, end);
            view.rowsServed += slice.length;
            this.rowsServedTotal += slice.length;
            view.lastServedAt = Date.now();
            params.success({ rowData: slice, rowCount: rows.length });
          } catch (err) {
            console.error('[InstrumentedStompSsrm] getRows', err);
            params.fail();
          } finally {
            view.inflight = Math.max(0, view.inflight - 1);
            this.emitTelemetry();
          }
        });
      },
      destroy: () => {
        const view = this.views.get(spec.id);
        if (view) view.grid = null;
        this.emitTelemetry();
      },
    };
  }

  attachGrid(viewId: string, grid: VelocityGrid<StompRow>): () => void {
    const view = this.views.get(viewId);
    if (view) view.grid = grid;
    this.syncPinnedTotals(viewId);
    this.emitTelemetry();
    return () => {
      const v = this.views.get(viewId);
      if (v) v.grid = null;
      this.emitTelemetry();
    };
  }

  unregisterView(viewId: string): void {
    const view = this.views.get(viewId);
    if (view?.grid) {
      try { view.grid.setServerSideDatasource(null); } catch { /* swallow */ }
    }
    this.views.delete(viewId);
    this.emitTelemetry();
  }

  connect(): void {
    if (this.client) return;
    this.setPhase('connecting');
    this.store.clear();
    this.order = [];
    this.liveBuffer = [];
    this.snapshotComplete = false;
    this.snapshotRowsLoaded = 0;
    this.liveBatches = 0;
    this.liveRowsIn = 0;
    this.liveWindow = [];
    for (const v of this.views.values()) {
      v.getRowsCalls = 0;
      v.rowsServed = 0;
      v.inflight = 0;
      v.recentWindows = [];
      v.liveTicksApplied = 0;
      v.liveRowsPushed = 0;
      v.lastServedAt = null;
    }
    this.getRowsTotal = 0;
    this.rowsServedTotal = 0;

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
    this.client = client;
    client.activate();
    this.emitTelemetry();
  }

  disconnect(): void {
    if (this.liveFlushTimer !== null) {
      clearTimeout(this.liveFlushTimer);
      this.liveFlushTimer = null;
    }
    const c = this.client;
    this.client = null;
    if (c) {
      try { void c.deactivate(); } catch { /* swallow */ }
    }
    this.setPhase('disconnected');
  }

  /** Force every attached grid to refetch its viewport from the book. */
  refreshAllViews(purge = true): void {
    for (const v of this.views.values()) {
      v.grid?.refreshServerSide({ purge });
    }
  }

  destroy(): void {
    if (this.telemetryTimer !== null) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    if (this.totalsSyncTimer !== null) {
      clearTimeout(this.totalsSyncTimer);
      this.totalsSyncTimer = null;
    }
    this.disconnect();
    this.views.clear();
    this.store.clear();
    this.order = [];
  }

  getTelemetry(): ProviderTelemetry {
    return this.buildTelemetry();
  }

  private setPhase(phase: ProviderPhase): void {
    this.phase = phase;
    this.opts.onPhase?.(phase);
    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    this.opts.onTelemetry?.(this.buildTelemetry());
  }

  private buildTelemetry(): ProviderTelemetry {
    const now = Date.now();
    this.liveWindow = this.liveWindow.filter((x) => now - x.t < 1000);
    const liveUpdatesPerSec = this.liveWindow.reduce((s, x) => s + x.n, 0);

    const views: ViewMetrics[] = [];
    for (const v of this.views.values()) {
      views.push({
        id: v.spec.id,
        label: v.spec.label,
        projectedRows: this.projectedCount(v.spec.filter),
        getRowsCalls: v.getRowsCalls,
        rowsServed: v.rowsServed,
        inflight: v.inflight,
        recentWindows: v.recentWindows.slice(),
        liveTicksApplied: v.liveTicksApplied,
        liveRowsPushed: v.liveRowsPushed,
        lastServedAt: v.lastServedAt,
      });
    }

    return {
      phase: this.phase,
      bookSize: this.store.size,
      snapshotRowsLoaded: this.snapshotRowsLoaded,
      liveBatches: this.liveBatches,
      liveRowsIn: this.liveRowsIn,
      liveUpdatesPerSec,
      liveQueueDepth: this.liveBuffer.length,
      getRowsTotal: this.getRowsTotal,
      rowsServedTotal: this.rowsServedTotal,
      viewCount: this.views.size,
      views,
      wsUrl: this.opts.wsUrl,
      clientId: this.opts.clientId,
      knobs: {
        snapshotRows: this.opts.snapshotRows,
        rate: this.opts.rate,
        batchSize: this.opts.batchSize,
        updatesPerTick: this.opts.updatesPerTick,
      },
    };
  }

  private projectRows(
    filter: ((row: StompRow) => boolean) | undefined,
    filterModel: FilterModel = {},
    sortModel: SortModel = [],
  ): StompRow[] {
    let rows = this.order.map((id) => this.store.get(id)!).filter(Boolean);
    if (filter) rows = rows.filter(filter);
    rows = applyFilterModel(rows, filterModel);
    return applySort(rows, sortModel);
  }

  private projectedCount(filter: ((row: StompRow) => boolean) | undefined): number {
    if (!filter) return this.store.size;
    let n = 0;
    for (const id of this.order) {
      const row = this.store.get(id);
      if (row && filter(row)) n++;
    }
    return n;
  }

  private onConnected(): void {
    if (!this.client) return;
    this.setPhase('snapshot');
    const topic = `/snapshot/positions/${this.opts.clientId}`;
    const trigger = `/snapshot/positions/${this.opts.clientId}/${this.opts.rate}/${this.opts.batchSize}`;
    this.client.subscribe(topic, (msg: IMessage) => this.onMessage(msg));
    const headers: Record<string, string> = {
      'snapshot-rows': String(this.opts.snapshotRows),
      'updates-per-tick': String(this.opts.updatesPerTick),
    };
    if (this.opts.sparse) headers['live-mode'] = 'sparse';
    this.client.publish({ destination: trigger, body: trigger, headers });
  }

  private onMessage(msg: IMessage): void {
    const body = msg.body?.trim() ?? '';
    if (!body) return;

    // Exact match — a data row containing "Success" in a text field must
    // not end the snapshot early (data frames are JSON bodies).
    if (body === SNAPSHOT_END_TOKEN || body.startsWith('Success: All')) {
      if (this.snapshotComplete) return;
      this.snapshotComplete = true;
      this.snapshotRowsLoaded = this.store.size;
      this.setPhase('live');
      this.schedulePinnedTotalsSync(true);
      this.refreshAllViews(true);
      requestAnimationFrame(() => this.refreshAllViews(false));
      return;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return; }
    const deltas = extractRows(parsed);
    if (deltas.length === 0) return;
    const messageType = msg.headers['message-type'];

    if (!this.snapshotComplete || messageType === 'snapshot') {
      const prev = this.store.size;
      for (const row of deltas) {
        if (row.positionId == null || row.positionId === '') continue;
        const id = String(row.positionId);
        const full = { ...row, positionId: id } as StompRow;
        if (!this.store.has(id)) this.order.push(id);
        this.store.set(id, full);
      }
      this.snapshotRowsLoaded = this.store.size;
      this.schedulePinnedTotalsSync();
      this.emitTelemetry();
      if (prev === 0 || Math.floor(prev / 500) !== Math.floor(this.store.size / 500)) {
        this.refreshAllViews(true);
      }
      return;
    }

    for (const delta of deltas) {
      const id = delta.positionId != null ? String(delta.positionId) : '';
      if (!id) continue;
      const existing = this.store.get(id);
      if (!existing) {
        const created = { ...delta, positionId: id } as StompRow;
        this.store.set(id, created);
        this.order.push(id);
        this.liveBuffer.push(created);
        continue;
      }
      const merged = deepMergeRow(existing, delta);
      this.store.set(id, merged);
      this.liveBuffer.push(merged);
    }

    this.liveRowsIn += deltas.length;
    this.liveWindow.push({ t: Date.now(), n: deltas.length });

    if (this.liveBuffer.length >= this.opts.batchSize) {
      this.flushLive(this.liveBuffer.splice(0));
    } else {
      this.scheduleLiveFlush();
    }
    this.emitTelemetry();
  }

  /** Debounced flush so a trickle (< batchSize rows) never strands in the
   *  live buffer — same scheduleFlush()/32ms idiom as the Perspective book. */
  private scheduleLiveFlush(): void {
    if (this.liveFlushTimer !== null) return;
    this.liveFlushTimer = window.setTimeout(() => {
      this.liveFlushTimer = null;
      this.flushLive(this.liveBuffer.splice(0));
    }, 32);
  }

  private flushLive(updates: StompRow[]): void {
    if (updates.length === 0 || this.pauseFanout) {
      if (this.pauseFanout) this.liveBuffer.unshift(...updates);
      return;
    }
    this.liveBatches++;
    for (const view of this.views.values()) {
      const filter = view.spec.filter;
      const relevant = filter ? updates.filter(filter) : updates;
      if (relevant.length === 0 || !view.grid) continue;
      view.liveTicksApplied++;
      view.liveRowsPushed += relevant.length;
      // With serverSideEnableClientSidePipeline the worker CSRM path
      // re-sorts / re-groups on applyTransaction inside this call.
      view.grid.applyServerSideTransaction({
        update: relevant,
        rowCount: this.projectedCount(filter),
      });
    }
    this.schedulePinnedTotalsSync();
    this.emitTelemetry();
  }

  private schedulePinnedTotalsSync(immediate = false): void {
    if (immediate) {
      if (this.totalsSyncTimer !== null) {
        clearTimeout(this.totalsSyncTimer);
        this.totalsSyncTimer = null;
      }
      for (const id of this.views.keys()) this.syncPinnedTotals(id);
      return;
    }
    if (this.totalsSyncTimer !== null) return;
    this.totalsSyncTimer = window.setTimeout(() => {
      this.totalsSyncTimer = null;
      for (const id of this.views.keys()) this.syncPinnedTotals(id);
    }, 200);
  }

  private syncPinnedTotals(viewId: string): void {
    const view = this.views.get(viewId);
    if (!view?.grid) return;
    // Grouped grids use kernel group / grand-total footers — hide pinned TOTAL.
    const grouped = view.grid.getRowGroupColumns().length > 0;
    try {
      view.grid.updateGridOptions({
        pinnedBottomRowData: grouped ? null : [this.computeGrandTotal(view.spec.filter)],
      });
    } catch { /* swallow */ }
  }

  /** Full projected-book sums — not the SSRM hydrated cache. */
  private computeGrandTotal(filter: ((row: StompRow) => boolean) | undefined): StompRow {
    const out = emptyGrandTotalRow();
    let count = 0;
    let notional = 0;
    let marketValue = 0;
    let pnl = 0;
    let dailyPnl = 0;
    for (const id of this.order) {
      if (id === GRAND_TOTAL_ROW_ID) continue;
      const row = this.store.get(id);
      if (!row) continue;
      if (filter && !filter(row)) continue;
      count++;
      notional += Number(row.notionalAmount) || 0;
      marketValue += Number(row.marketValue) || 0;
      pnl += Number(row.pnl) || 0;
      dailyPnl += Number(row.dailyPnl) || 0;
    }
    out.ticker = `${count.toLocaleString()} rows`;
    out.notionalAmount = notional;
    out.marketValue = marketValue;
    out.pnl = pnl;
    out.dailyPnl = dailyPnl;
    return out;
  }
}
