import { Client, type IMessage } from '@stomp/stompjs';
import type {
  CFilterModelEntry,
  VelocityGrid,
  CDateFilterModel,
  CMultiConditionFilterModel,
  CNumberFilterModel,
  CSetFilterModel,
  CTextFilterModel,
  FilterModel,
  FilterModelEntry,
  FilterModelEntryLegacy,
  IServerSideDatasource,
  IServerSideGetRowsParams,
  SortModel,
} from '@wellsfargo-starui/velocity-grid';

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

interface GridBinding {
  filter?: (row: StompRow) => boolean;
  /** When true, grid filter/sort run in the worker after hydrate. */
  clientPipeline: boolean;
  /** Ids currently in this blotter's projected set (blotter + grid filters). */
  projectedIds: Set<string>;
  unsubFilter?: () => void;
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

function parseDateMs(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw);
  if (s === '') return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Mirror kernel `matchesV2` / legacy matcher for demo-side SSRM projection. */
function matchesFilterEntry(entry: FilterModelEntry, raw: unknown): boolean {
  if (!entry || typeof entry !== 'object') return true;
  if ('filterType' in entry) {
    return matchesV2(entry as CFilterModelEntry, raw);
  }
  return matchesLegacy(entry as FilterModelEntryLegacy, raw);
}

function matchesLegacy(entry: FilterModelEntryLegacy, raw: unknown): boolean {
  if (entry.type === 'text') {
    const s = String(raw ?? '').toLowerCase();
    const q = entry.value.toLowerCase();
    if (entry.op === 'contains') return s.includes(q);
    if (entry.op === 'equals') return s === q;
    if (entry.op === 'startsWith') return s.startsWith(q);
    return false;
  }
  const n = Number(raw);
  if (Number.isNaN(n)) return false;
  if (entry.op === 'eq') return n === entry.value;
  if (entry.op === 'gt') return n > entry.value;
  if (entry.op === 'lt') return n < entry.value;
  if (entry.op === 'between') return n >= entry.value && n <= (entry.value2 ?? entry.value);
  return false;
}

function matchesV2(entry: CFilterModelEntry, raw: unknown): boolean {
  if (entry.filterType === 'multi') return matchesMulti(entry, raw);
  if (entry.filterType === 'text') return matchesText(entry, raw);
  if (entry.filterType === 'number') return matchesNumber(entry, raw);
  if (entry.filterType === 'date') return matchesDate(entry, raw);
  if (entry.filterType === 'set') return matchesSet(entry, raw);
  return false;
}

function matchesMulti(entry: CMultiConditionFilterModel, raw: unknown): boolean {
  if (entry.conditions.length === 0) return true;
  if (entry.operator === 'AND') {
    for (const c of entry.conditions) {
      if (!matchesV2(c, raw)) return false;
    }
    return true;
  }
  for (const c of entry.conditions) {
    if (matchesV2(c, raw)) return true;
  }
  return false;
}

function matchesText(entry: CTextFilterModel, raw: unknown): boolean {
  let haystack = String(raw ?? '');
  let needle = entry.filter == null ? '' : entry.filter;
  if (entry.caseSensitive !== true) {
    haystack = haystack.toLowerCase();
    needle = needle.toLowerCase();
  }
  switch (entry.type) {
    case 'contains': return haystack.includes(needle);
    case 'notContains': return !haystack.includes(needle);
    case 'equals': return haystack === needle;
    case 'notEqual': return haystack !== needle;
    case 'startsWith': return haystack.startsWith(needle);
    case 'endsWith': return haystack.endsWith(needle);
    case 'blank': return haystack === '';
    case 'notBlank': return haystack !== '';
  }
  return false;
}

function matchesNumber(entry: CNumberFilterModel, raw: unknown): boolean {
  if (entry.type === 'blank') return raw == null || raw === '';
  if (entry.type === 'notBlank') return raw != null && raw !== '';
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n)) return false;
  const a = entry.filter;
  if (a == null) return false;
  switch (entry.type) {
    case 'equals': return n === a;
    case 'notEqual': return n !== a;
    case 'lessThan': return n < a;
    case 'lessThanOrEqual': return n <= a;
    case 'greaterThan': return n > a;
    case 'greaterThanOrEqual': return n >= a;
    case 'inRange': return entry.filterTo != null && n >= a && n <= entry.filterTo;
  }
  return false;
}

function matchesDate(entry: CDateFilterModel, raw: unknown): boolean {
  if (entry.type === 'blank') return raw == null || raw === '';
  if (entry.type === 'notBlank') return raw != null && raw !== '';
  const r = parseDateMs(raw);
  if (r === null) return false;
  const a = entry.filter == null ? null : parseDateMs(entry.filter);
  if (a === null) return false;
  switch (entry.type) {
    case 'equals': return r === a;
    case 'notEqual': return r !== a;
    case 'lessThan': return r < a;
    case 'lessThanOrEqual': return r <= a;
    case 'greaterThan': return r > a;
    case 'greaterThanOrEqual': return r >= a;
    case 'inRange': {
      const b = entry.filterTo == null ? null : parseDateMs(entry.filterTo);
      return b !== null && r >= a && r <= b;
    }
  }
  return false;
}

function matchesSet(entry: CSetFilterModel, raw: unknown): boolean {
  if (raw == null) return false;
  return entry.values.includes(String(raw));
}

function rowMatchesFilterModel(row: StompRow, filterModel: FilterModel): boolean {
  for (const [colId, entry] of Object.entries(filterModel)) {
    if (!entry) continue;
    if (!matchesFilterEntry(entry, row[colId])) return false;
  }
  return true;
}

function applyFilterModel(rows: StompRow[], filterModel: FilterModel): StompRow[] {
  const entries = Object.entries(filterModel);
  if (entries.length === 0) return rows;
  return rows.filter((row) => rowMatchesFilterModel(row, filterModel));
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
  private liveFlushTimer: number | null = null;
  private snapshotComplete = false;
  private received = 0;
  /** Grids bound for live fan-out, each with its projection filter. */
  private grids = new Map<VelocityGrid<StompRow>, GridBinding>();

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
  attachGrid(grid: VelocityGrid<StompRow>, options: DatasourceOptions = {}): () => void {
    const clientPipeline = options.clientPipeline === true;
    const binding: GridBinding = {
      filter: options.filter,
      clientPipeline,
      projectedIds: this.computeProjectedIds(
        options.filter,
        clientPipeline ? {} : grid.getFilterModel(),
      ),
    };
    // Kernel already purges SSRM on filter change; resync membership so
    // subsequent live ticks classify add/remove against the new set.
    binding.unsubFilter = grid.on('filterChanged', () => {
      binding.projectedIds = this.computeProjectedIds(
        binding.filter,
        binding.clientPipeline ? {} : grid.getFilterModel(),
      );
    });
    this.grids.set(grid, binding);
    this.emitStats();
    return () => {
      binding.unsubFilter?.();
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

  destroy(): void {
    this.disconnect();
    for (const binding of this.grids.values()) binding.unsubFilter?.();
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

  private gridFilterModel(binding: GridBinding, grid: VelocityGrid<StompRow>): FilterModel {
    return binding.clientPipeline ? {} : grid.getFilterModel();
  }

  private computeProjectedIds(
    filter: ((row: StompRow) => boolean) | undefined,
    filterModel: FilterModel,
  ): Set<string> {
    const ids = new Set<string>();
    for (const id of this.order) {
      const row = this.store.get(id);
      if (!row) continue;
      if (filter && !filter(row)) continue;
      if (!rowMatchesFilterModel(row, filterModel)) continue;
      ids.add(id);
    }
    return ids;
  }

  private projectedCount(
    filter: ((row: StompRow) => boolean) | undefined,
    filterModel: FilterModel = {},
  ): number {
    let n = 0;
    for (const id of this.order) {
      const row = this.store.get(id);
      if (!row) continue;
      if (filter && !filter(row)) continue;
      if (!rowMatchesFilterModel(row, filterModel)) continue;
      n++;
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
    } else {
      this.scheduleLiveFlush();
    }
    this.received += deltas.length;
    this.emitStats();
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
    if (updates.length === 0) return;
    for (const [grid, binding] of this.grids) {
      const filterModel = this.gridFilterModel(binding, grid);
      const add: StompRow[] = [];
      const update: StompRow[] = [];
      const remove: StompRow[] = [];

      for (const row of updates) {
        const id = row.positionId;
        const inBlotter = !binding.filter || binding.filter(row);
        const matchesNow = inBlotter && rowMatchesFilterModel(row, filterModel);
        const wasIn = binding.projectedIds.has(id);

        if (matchesNow) {
          if (wasIn) update.push(row);
          else {
            add.push(row);
            binding.projectedIds.add(id);
          }
        } else if (wasIn) {
          remove.push(row);
          binding.projectedIds.delete(id);
        }
      }

      if (add.length === 0 && update.length === 0 && remove.length === 0) continue;

      // rowCount must match getRows (blotter predicate + active filter model).
      grid.applyServerSideTransaction({
        add: add.length ? add : undefined,
        update: update.length ? update : undefined,
        remove: remove.length ? remove : undefined,
        rowCount: this.projectedCount(binding.filter, filterModel),
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
    for (const [grid, binding] of this.grids) {
      binding.projectedIds = this.computeProjectedIds(
        binding.filter,
        this.gridFilterModel(binding, grid),
      );
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
