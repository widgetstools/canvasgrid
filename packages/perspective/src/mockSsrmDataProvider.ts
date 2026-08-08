/**
 * MockSSRMDataProvider — in-memory SSRM v2 provider with live ticks.
 *
 * Lightweight alternative to `StompPerspectiveProvider` (no WASM / no STOMP).
 * Same host ergonomics: `gridOptions()` + `attach(grid)`.
 *
 * Tick cadence follows Markets CSRM `startMock` (default 750ms, ~1–4% of the
 * book per interval unless `updatesPerTick` is set). Query surface is the
 * sparse SSRM v2 contract ported from the former ext-ssrm-demo MockTradingServer.
 */

import type {
  CColDef,
  VelocityGridOptions,
  FilterModel,
  IServerSideDatasourceV2,
  IServerSideGetGroupLeafIdsParams,
  IServerSideGetLeafRowsParams,
  IServerSideGetRowsParams,
  IServerSideGetSkeletonParams,
  ServerSideTransaction,
  SkeletonGroup,
  SortModel,
} from '@wellsfargo-starui/velocity-grid';
import type { AttachableGrid } from './provider';
import { MOCK_POSITION_COLUMNS, type MockPositionRow } from './mockPositionColumns';

export type { MockPositionRow } from './mockPositionColumns';

export interface MockSSRMDataProviderConfig {
  rowCount?: number;
  /** When false, `attach` / `startTicking` do not start the live loop. Default true. */
  enableUpdates?: boolean;
  /** Tick interval in ms. Default 750 (Markets mock default). */
  updateIntervalMs?: number;
  /** Fixed rows mutated per tick. When omitted, ~1–4% of the book (Markets-style). */
  updatesPerTick?: number;
  /** Simulated per-request latency window in ms. Default [25, 90]. Use [0, 0] in tests. */
  latency?: [min: number, max: number];
  /** Soft-refresh interval so group aggregates / grand totals track ticks. Default 1000; 0 disables. */
  softRefreshIntervalMs?: number;
  /** Inject for deterministic tests. Defaults to `setInterval`. */
  setTicker?: (cb: () => void, ms: number) => unknown;
  /** Companion to `setTicker`. Defaults to `clearInterval`. */
  clearTicker?: (handle: unknown) => void;
  label?: string;
}

const DESKS = ['Rates', 'Credit', 'FX', 'Equities', 'Commodities', 'Munis'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD'];
const TRADERS = ['patel', 'okafor', 'lindqvist', 'tanaka', 'reyes', 'novak', 'silva', 'chen'];

/** Fields aggregated (sum) at every group level. */
const AGG_FIELDS = ['notional', 'marketValue', 'pnl', 'dailyPnl'] as const;

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBook(rowCount: number): MockPositionRow[] {
  const rng = mulberry32(20260725);
  const rows: MockPositionRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const notional = Math.round(rng() * 9_000_000 + 1_000_000);
    const price = 90 + rng() * 20;
    rows.push({
      positionId: `POS-${String(i).padStart(6, '0')}`,
      desk: DESKS[Math.floor(rng() * DESKS.length)]!,
      region: REGIONS[Math.floor(rng() * REGIONS.length)]!,
      currency: CURRENCIES[Math.floor(rng() * CURRENCIES.length)]!,
      trader: TRADERS[Math.floor(rng() * TRADERS.length)]!,
      ticker: `TICK${i % 250}`,
      notional,
      marketValue: Math.round(notional * (price / 100)),
      price,
      pnl: Math.round((rng() - 0.5) * 400_000),
      dailyPnl: Math.round((rng() - 0.5) * 60_000),
    });
  }
  return rows;
}

function entryMatches(entry: unknown, value: unknown): boolean {
  if (entry == null || typeof entry !== 'object') return true;
  const e = entry as Record<string, unknown>;
  const asText = String(value ?? '').toLowerCase();
  const asNum = typeof value === 'number' ? value : Number(value);

  if (e.filterType === 'text') {
    const q = String(e.filter ?? '').toLowerCase();
    switch (e.type) {
      case 'equals': return asText === q;
      case 'notEqual': return asText !== q;
      case 'startsWith': return asText.startsWith(q);
      case 'endsWith': return asText.endsWith(q);
      case 'notContains': return !asText.includes(q);
      case 'contains': default: return asText.includes(q);
    }
  }
  if (e.filterType === 'number') {
    const q = Number(e.filter);
    switch (e.type) {
      case 'equals': return asNum === q;
      case 'notEqual': return asNum !== q;
      case 'lessThan': return asNum < q;
      case 'lessThanOrEqual': return asNum <= q;
      case 'greaterThanOrEqual': return asNum >= q;
      case 'inRange': return asNum >= q && asNum <= Number(e.filterTo ?? q);
      case 'greaterThan': default: return asNum > q;
    }
  }
  if (e.filterType === 'set' && Array.isArray(e.values)) {
    return (e.values as unknown[]).map((v) => String(v)).includes(String(value ?? ''));
  }
  if (e.type === 'text') {
    const q = String(e.value ?? '').toLowerCase();
    switch (e.op) {
      case 'equals': return asText === q;
      case 'startsWith': return asText.startsWith(q);
      case 'contains': default: return asText.includes(q);
    }
  }
  if (e.type === 'number') {
    const q = Number(e.value);
    switch (e.op) {
      case 'eq': return asNum === q;
      case 'gt': return asNum > q;
      case 'lt': return asNum < q;
      case 'between': return asNum >= q && asNum <= Number(e.value2 ?? q);
      default: return true;
    }
  }
  return true;
}

function applyFilter(rows: readonly MockPositionRow[], filterModel: FilterModel): MockPositionRow[] {
  const entries = Object.entries(filterModel ?? {}).filter(([, e]) => e != null);
  if (entries.length === 0) return rows.slice();
  return rows.filter((row) => entries.every(([colId, entry]) => entryMatches(entry, row[colId])));
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function applySort(rows: MockPositionRow[], sortModel: SortModel): MockPositionRow[] {
  if (!sortModel?.length) return rows;
  return rows.sort((a, b) => {
    for (const s of sortModel) {
      const c = compareValues(a[s.colId], b[s.colId]);
      if (c !== 0) return s.direction === 'desc' ? -c : c;
    }
    return 0;
  });
}

function sumAggregates(rows: readonly MockPositionRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of AGG_FIELDS) out[f] = 0;
  for (const row of rows) {
    for (const f of AGG_FIELDS) out[f] = (out[f] ?? 0) + (row[f] as number);
  }
  return out;
}

export class MockSSRMDataProvider implements IServerSideDatasourceV2<MockPositionRow> {
  private readonly rows: MockPositionRow[];
  private readonly byId = new Map<string, MockPositionRow>();
  private readonly latency: [number, number];
  private readonly enableUpdates: boolean;
  private readonly updateIntervalMs: number;
  private readonly updatesPerTick: number | undefined;
  private readonly softRefreshIntervalMs: number;
  private readonly setTicker: (cb: () => void, ms: number) => unknown;
  private readonly clearTicker: (handle: unknown) => void;
  private readonly tickRng = mulberry32(7);
  private tickHandle: unknown = null;
  private softRefreshHandle: unknown = null;
  private detachFn: (() => void) | null = null;
  private destroyed = false;
  /** Requests served — demos may surface this in chrome. */
  requestCount = 0;

  constructor(config: MockSSRMDataProviderConfig = {}) {
    this.rows = buildBook(config.rowCount ?? 50_000);
    for (const row of this.rows) this.byId.set(row.positionId, row);
    this.latency = config.latency ?? [25, 90];
    this.enableUpdates = config.enableUpdates ?? true;
    this.updateIntervalMs = config.updateIntervalMs ?? 750;
    this.updatesPerTick = config.updatesPerTick;
    this.softRefreshIntervalMs = config.softRefreshIntervalMs ?? 1000;
    this.setTicker = config.setTicker ?? ((cb, ms) => setInterval(cb, ms));
    this.clearTicker = config.clearTicker ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  }

  get bookSize(): number {
    return this.rows.length;
  }

  get columnDefs(): CColDef<MockPositionRow>[] {
    return MOCK_POSITION_COLUMNS.map((c) => ({ ...c }));
  }

  /** Recommended VelocityGrid options: columnDefs + this provider as the SSRM datasource. */
  gridOptions(): VelocityGridOptions<MockPositionRow> {
    return {
      getRowId: (r: MockPositionRow) => r.positionId,
      columnDefs: this.columnDefs,
      rowModelType: 'serverSide',
      serverSideDatasource: this,
      serverSideEnableClientSidePipeline: false,
      cacheBlockSize: 100,
      maxConcurrentDatasourceRequests: 2,
      deferAsyncTransactionsWhileScrolling: true,
      asyncTransactionConflate: true,
      asyncTransactionWaitMillis: 50,
      enableCellChangeFlash: true,
      suppressAggFuncInHeader: true,
      rowGroupPanelShow: 'always',
      groupDefaultExpanded: 0,
      grandTotalRow: 'pinnedBottom',
      groupDisplayType: 'singleColumn',
      autoGroupColumnDef: {
        cellRendererParams: {
          totalValueGetter: (p: { isGrandTotal: boolean; value: string }) =>
            p.isGrandTotal ? 'Grand Total' : `Total ${p.value}`,
        },
      },
    } as VelocityGridOptions<MockPositionRow>;
  }

  /**
   * Wire live ticks onto a mounted grid (scroll-deferred SSRM txs + soft
   * refresh for group aggregates). Returns a detach function; also run by `destroy()`.
   */
  attach(grid: AttachableGrid): () => void {
    this.detachFn?.();
    const unsubs: Array<() => void> = [];
    let scrollActive = false;
    let pendingUpdate: MockPositionRow[] | null = null;

    const applyUpdate = (update: MockPositionRow[]): void => {
      if (update.length === 0) return;
      try {
        grid.applyServerSideTransaction({ update });
      } catch {
        /* grid tearing down */
      }
    };

    this.startTicking((tx) => {
      const update = (tx.update ?? []) as MockPositionRow[];
      if (scrollActive) {
        pendingUpdate = pendingUpdate ? pendingUpdate.concat(update) : update;
        return;
      }
      applyUpdate(update);
    });

    if (this.enableUpdates && this.softRefreshIntervalMs > 0) {
      this.softRefreshHandle = this.setTicker(() => {
        try {
          grid.refreshServerSide({ purge: false });
        } catch {
          /* grid tearing down */
        }
      }, this.softRefreshIntervalMs);
    }

    unsubs.push(grid.on('bodyScroll', () => {
      scrollActive = true;
    }));
    unsubs.push(grid.on('bodyScrollEnd', () => {
      scrollActive = false;
      if (pendingUpdate) {
        const u = pendingUpdate;
        pendingUpdate = null;
        applyUpdate(u);
      }
    }));

    const detach = () => {
      for (const u of unsubs.splice(0)) u();
      this.stopTicking();
      if (this.softRefreshHandle !== null) {
        this.clearTicker(this.softRefreshHandle);
        this.softRefreshHandle = null;
      }
      if (this.detachFn === detach) this.detachFn = null;
    };
    this.detachFn = detach;
    return detach;
  }

  /** Live ticks — mutate a slice of the book and emit SSRM update copies. */
  startTicking(
    onTransaction: (tx: ServerSideTransaction<MockPositionRow>) => void,
    intervalMs = this.updateIntervalMs,
  ): void {
    this.stopTicking();
    if (!this.enableUpdates || this.rows.length === 0 || this.destroyed) return;
    this.tickHandle = this.setTicker(() => {
      const n =
        this.updatesPerTick ??
        Math.max(1, Math.floor(this.rows.length * (0.01 + this.tickRng() * 0.03)));
      const update: MockPositionRow[] = [];
      for (let i = 0; i < n; i++) {
        const row = this.rows[Math.floor(this.tickRng() * this.rows.length)]!;
        const drift = (this.tickRng() - 0.5) * 0.6;
        row.price = Math.max(1, row.price + drift);
        row.marketValue = Math.round(row.notional * (row.price / 100));
        const pnlDelta = Math.round(drift * 10_000);
        row.pnl += pnlDelta;
        row.dailyPnl += pnlDelta;
        update.push({ ...row });
      }
      onTransaction({ update });
    }, intervalMs);
  }

  stopTicking(): void {
    if (this.tickHandle !== null) {
      this.clearTicker(this.tickHandle);
      this.tickHandle = null;
    }
  }

  /** Persist a committed cell edit into the authoritative book. */
  applyEdit(positionId: string, field: string, value: unknown): MockPositionRow | null {
    const row = this.byId.get(positionId);
    if (!row) return null;
    row[field] = value;
    if (field === 'price' || field === 'notional') {
      row.marketValue = Math.round(row.notional * (row.price / 100));
    }
    return { ...row };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachFn?.();
    this.detachFn = null;
    this.stopTicking();
    if (this.softRefreshHandle !== null) {
      this.clearTicker(this.softRefreshHandle);
      this.softRefreshHandle = null;
    }
  }

  // ── IServerSideDatasourceV2 ────────────────────────────────────────────

  getRows(params: IServerSideGetRowsParams<MockPositionRow>): void {
    this.respond(() => {
      const filtered = applyFilter(this.rows, params.request.filterModel);
      const sorted = applySort(filtered, params.request.sortModel);
      params.success({
        rowData: sorted.slice(params.request.startRow, params.request.endRow).map((r) => ({ ...r })),
        rowCount: sorted.length,
        grandTotals: sumAggregates(filtered),
      });
    });
  }

  getGroupSkeleton(params: IServerSideGetSkeletonParams): void {
    this.respond(() => {
      params.success({
        groups: this.buildSkeleton(
          params.request.rowGroupCols,
          params.request.sortModel,
          params.request.filterModel,
        ),
      });
    });
  }

  getLeafRows(params: IServerSideGetLeafRowsParams<MockPositionRow>): void {
    this.respond(() => {
      const subset = this.groupSubset(
        params.request.groupPath,
        params.request.rowGroupCols,
        params.request.filterModel,
      );
      const sorted = applySort(subset, params.request.sortModel);
      params.success({
        rowData: sorted.slice(params.request.startRow, params.request.endRow).map((r) => ({ ...r })),
      });
    });
  }

  getGroupLeafIds(params: IServerSideGetGroupLeafIdsParams): void {
    this.respond(() => {
      const subset = this.groupSubset(
        params.request.groupPath,
        params.request.rowGroupCols,
        params.request.filterModel,
      );
      params.success({
        ids: applySort(subset, params.request.sortModel).map((r) => r.positionId),
      });
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private respond(fn: () => void): void {
    this.requestCount++;
    const [min, max] = this.latency;
    if (max <= 0) {
      fn();
      return;
    }
    setTimeout(fn, min + Math.random() * (max - min));
  }

  private groupSubset(
    groupPath: readonly string[],
    rowGroupCols: readonly string[],
    filterModel: FilterModel,
  ): MockPositionRow[] {
    let subset = applyFilter(this.rows, filterModel);
    for (let i = 0; i < groupPath.length && i < rowGroupCols.length; i++) {
      const col = rowGroupCols[i]!;
      const val = groupPath[i]!;
      subset = subset.filter((row) => String(row[col] ?? '') === val);
    }
    return subset;
  }

  private buildSkeleton(
    rowGroupCols: readonly string[],
    sortModel: SortModel,
    filterModel: FilterModel,
  ): SkeletonGroup[] {
    const filtered = applyFilter(this.rows, filterModel);
    const groups: SkeletonGroup[] = [
      { path: [], leafCount: filtered.length, aggregates: sumAggregates(filtered) },
    ];
    const walk = (subset: readonly MockPositionRow[], path: string[], depth: number): void => {
      if (depth >= rowGroupCols.length) return;
      const col = rowGroupCols[depth]!;
      const buckets = new Map<string, MockPositionRow[]>();
      for (const row of subset) {
        const key = String(row[col] ?? '');
        const bucket = buckets.get(key);
        if (bucket) bucket.push(row);
        else buckets.set(key, [row]);
      }
      const entries = [...buckets.entries()].map(([key, rows]) => ({
        key,
        rows,
        aggregates: sumAggregates(rows),
      }));
      const groupSort = sortModel?.find((s) => s.colId === col);
      const aggSort = sortModel?.find((s) => (AGG_FIELDS as readonly string[]).includes(s.colId));
      entries.sort((a, b) => {
        if (groupSort) {
          const c = compareValues(a.key, b.key);
          return groupSort.direction === 'desc' ? -c : c;
        }
        if (aggSort) {
          const c = (a.aggregates[aggSort.colId] ?? 0) - (b.aggregates[aggSort.colId] ?? 0);
          return aggSort.direction === 'desc' ? -c : c;
        }
        return compareValues(a.key, b.key);
      });
      for (const entry of entries) {
        const childPath = [...path, entry.key];
        groups.push({
          path: childPath,
          leafCount: entry.rows.length,
          aggregates: entry.aggregates,
        });
        walk(entry.rows, childPath, depth + 1);
      }
    };
    walk(filtered, [], 0);
    return groups;
  }
}
