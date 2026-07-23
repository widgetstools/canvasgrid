import { Client, type IMessage } from '@stomp/stompjs';
import type {
  CGrid,
  FilterModel,
  IServerSideDatasource,
  IServerSideGetRowsParams,
  SortModel,
} from '@cgrid/kernel';

/** Raw row from stomp-view-server. */
export type StompRow = Record<string, unknown> & { positionId: string };

export type ProviderPhase =
  | 'idle'
  | 'connecting'
  | 'snapshot'
  | 'live'
  | 'error'
  | 'disconnected';

export interface StompSsrmDataProviderOptions {
  wsUrl?: string;
  clientId?: string;
  snapshotRows?: number;
  rate?: number;
  batchSize?: number;
  updatesPerTick?: number;
  sparse?: boolean;
  onPhase?: (phase: ProviderPhase) => void;
  onStats?: (stats: { received: number; storeSize: number; gridCount: number }) => void;
}

const SNAPSHOT_END_TOKEN = 'Success';

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
  if (parsed && typeof parsed === 'object') {
    return [parsed as Partial<StompRow>];
  }
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

export interface DatasourceOptions {
  /** Extra predicate on top of the grid filter model (per-blotter view). */
  filter?: (row: StompRow) => boolean;
  label?: string;
  /** When true, sort/filter run in the worker CSRM pipeline after hydrate. */
  clientPipeline?: boolean;
}

/**
 * One STOMP connection hydrates a shared in-memory book. Each blotter gets
 * an {@link IServerSideDatasource} that windows/sorts/filters from that book.
 * Live ticks fan out via `applyServerSideTransaction`.
 */
export class StompSsrmDataProvider {
  private readonly opts: Required<
    Pick<
      StompSsrmDataProviderOptions,
      'wsUrl' | 'clientId' | 'snapshotRows' | 'rate' | 'batchSize' | 'updatesPerTick' | 'sparse'
    >
  > &
    Pick<StompSsrmDataProviderOptions, 'onPhase' | 'onStats'>;

  private client: Client | null = null;
  private phase: ProviderPhase = 'idle';
  private store = new Map<string, StompRow>();
  private order: string[] = [];
  private snapshotBuffer: StompRow[] = [];
  private liveBuffer: StompRow[] = [];
  private snapshotComplete = false;
  private received = 0;
  /** Grids bound for live fan-out, each with its projection filter. */
  private grids = new Map<CGrid<StompRow>, { filter?: (row: StompRow) => boolean }>();

  constructor(options: StompSsrmDataProviderOptions = {}) {
    this.opts = {
      wsUrl: options.wsUrl ?? 'ws://localhost:8081',
      clientId: options.clientId ?? `cgrid-ssrm-${Math.floor(Math.random() * 1e6).toString(16)}`,
      snapshotRows: options.snapshotRows ?? 10_000,
      rate: options.rate ?? 40,
      batchSize: options.batchSize ?? 50,
      updatesPerTick: options.updatesPerTick ?? 5,
      sparse: options.sparse ?? true,
      onPhase: options.onPhase,
      onStats: options.onStats,
    };
  }

  getPhase(): ProviderPhase {
    return this.phase;
  }

  getStoreSize(): number {
    return this.store.size;
  }

  /** Bind a grid for live `applyServerSideTransaction` fan-out. */
  attachGrid(grid: CGrid<StompRow>, options: DatasourceOptions = {}): () => void {
    this.grids.set(grid, { filter: options.filter });
    this.emitStats();
    return () => {
      this.grids.delete(grid);
      this.emitStats();
    };
  }

  /**
   * Create an SSRM datasource backed by this shared book.
   * Safe to pass the same provider into multiple grids — each call returns
   * a fresh datasource (optionally with its own filter projection).
   */
  createDatasource(options: DatasourceOptions = {}): IServerSideDatasource<StompRow> {
    const clientPipeline = options.clientPipeline === true;
    return {
      getRows: (params: IServerSideGetRowsParams<StompRow>) => {
        try {
          const rows = this.projectRows(
            options.filter,
            params.request.filterModel,
            params.request.sortModel,
            clientPipeline,
          );
          const start = Math.max(0, params.request.startRow);
          const end = Math.max(start, params.request.endRow);
          params.success({ rowData: rows.slice(start, end), rowCount: rows.length });
        } catch (err) {
          console.error('[StompSsrmDataProvider] getRows failed', err);
          params.fail();
        }
      },
    };
  }

  connect(): void {
    if (this.client) return;
    this.setPhase('connecting');
    this.store.clear();
    this.order = [];
    this.snapshotBuffer = [];
    this.liveBuffer = [];
    this.snapshotComplete = false;
    this.received = 0;

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
  }

  disconnect(): void {
    const c = this.client;
    this.client = null;
    if (c) {
      try { void c.deactivate(); } catch { /* swallow */ }
    }
    this.setPhase('disconnected');
  }

  destroy(): void {
    this.disconnect();
    this.grids.clear();
    this.store.clear();
    this.order = [];
  }

  private setPhase(phase: ProviderPhase): void {
    this.phase = phase;
    this.opts.onPhase?.(phase);
  }

  private emitStats(): void {
    this.opts.onStats?.({
      received: this.received,
      storeSize: this.store.size,
      gridCount: this.grids.size,
    });
  }

  private projectRows(
    filter: ((row: StompRow) => boolean) | undefined,
    filterModel: FilterModel = {},
    sortModel: SortModel = [],
    clientPipeline = false,
  ): StompRow[] {
    let rows = this.order.map((id) => this.store.get(id)!).filter(Boolean);
    if (filter) rows = rows.filter(filter);
    if (!clientPipeline) {
      rows = applyFilterModel(rows, filterModel);
      rows = applySort(rows, sortModel);
    }
    return rows;
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

    if (body.includes(SNAPSHOT_END_TOKEN) || body.startsWith('Success: All')) {
      if (this.snapshotComplete) return;
      this.snapshotComplete = true;
      this.drainSnapshotBuffer();
      this.received = this.store.size;
      this.setPhase('live');
      this.emitStats();
      this.reloadGrids();
      return;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return; }
    const deltas = extractRows(parsed);
    if (deltas.length === 0) return;

    const messageType = msg.headers['message-type'];

    if (!this.snapshotComplete || messageType === 'snapshot') {
      for (const row of deltas) {
        if (row.positionId == null || row.positionId === '') continue;
        const id = String(row.positionId);
        const full = { ...row, positionId: id } as StompRow;
        if (!this.store.has(id)) this.order.push(id);
        this.store.set(id, full);
      }
      const prev = this.received;
      this.received = this.store.size;
      this.emitStats();
      // Paint early — don't wait for the Success sentinel (matches CSRM demo).
      if (prev === 0 || Math.floor(prev / 500) !== Math.floor(this.received / 500)) {
        this.reloadGrids();
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

    if (this.liveBuffer.length >= this.opts.batchSize) {
      this.flushLive(this.liveBuffer.splice(0));
    }
    this.received += deltas.length;
    this.emitStats();
  }

  private flushLive(updates: StompRow[]): void {
    if (updates.length === 0) return;
    for (const [grid, { filter }] of this.grids) {
      // Only push ticks that belong in this blotter's projection.
      // Never overwrite SSRM rowCount with the full book size — that
      // was making every blotter report Rows: 10,000 and could leave
      // empty blocks stranded under a non-zero count.
      const relevant = filter ? updates.filter(filter) : updates;
      if (relevant.length === 0) continue;
      grid.applyServerSideTransaction({
        update: relevant,
        rowCount: this.projectedCount(filter),
      });
    }
  }

  private drainSnapshotBuffer(): void {
    for (const row of this.snapshotBuffer) {
      if (!row.positionId) continue;
      const id = String(row.positionId);
      if (!this.store.has(id)) this.order.push(id);
      this.store.set(id, row);
    }
    this.snapshotBuffer = [];
  }

  private reloadGrids(): void {
    for (const grid of this.grids.keys()) {
      grid.refreshServerSide({ purge: true });
    }
    // Second pass after flex panels get a real height.
    requestAnimationFrame(() => {
      for (const grid of this.grids.keys()) {
        grid.refreshServerSide({ purge: false });
      }
    });
  }
}
