/**
 * StompPerspectiveProvider — the batteries-included entry point.
 *
 * Everything the demo wires by hand (engine bootstrap, shared book, feed
 * leadership, per-view datasource, live-tick fan-out, model sync) behind
 * one class:
 *
 * ```ts
 * const provider = new StompPerspectiveProvider({ feed: 'stomp', wsUrl, clientId });
 * const grid = new VelocityGrid(host, { theme: '...', ...provider.gridOptions() });
 * provider.attach(grid);   // live ticks + group/sort/filter sync
 * ```
 *
 * `gridOptions()` bundles `columnDefs` + the SSRM contract (the provider
 * itself IS the `IServerSideDatasourceV2`); spread it first and override
 * freely. Multiple providers on one page share ONE book/engine/feed per
 * distinct feed config (and, via the Phase 5 SharedWorker + Web Locks
 * leadership, one table + one feed across TABS too).
 */
import type {
  CColDef,
  VelocityGridOptions,
  IServerSideDatasourceV2,
  IServerSideGetGroupLeafIdsParams,
  IServerSideGetLeafRowsParams,
  IServerSideGetRowsParams,
  IServerSideGetSkeletonParams,
} from '@wellsfargo-starui/velocity-grid';
import {
  assertAppDataResolved,
  resolveCfg,
  toAppDataLookup,
  type AppDataLookup,
  type AppDataStore,
} from '@wellsfargo-starui/velocity-grid-appdata';
import {
  PerspectiveBook,
  type BookFeed,
  type BookPhase,
  type BookTelemetry,
  type PspFilter,
  type ViewTick,
} from './book';
import { createPerspectiveSsrmDatasource } from './ssrmDatasource';
import { POSITION_COLUMNS } from './positionColumns';
import type { PositionRow } from './bootstrap';

export interface StompPerspectiveProviderConfig {
  /** `'stomp'` for the live STOMP feed, `'seed'` (default) for the
   *  self-contained deterministic book — no server needed. */
  feed?: BookFeed;
  /**
   * Optional AppData for `{{ProviderName.key}}` tokens in string config
   * fields (`wsUrl`, `clientId`, topics, …). Markets-compatible.
   * When supplied, unresolved tokens throw at construction (fail closed).
   */
  appData?: AppDataLookup | AppDataStore;
  /** STOMP broker URL (feed: 'stomp'), e.g. `ws://localhost:8081`.
   *  May include AppData tokens when `appData` is set. */
  wsUrl?: string;
  /** STOMP topic id — snapshot rides `/snapshot/positions/{clientId}`.
   *  May include AppData tokens when `appData` is set. */
  clientId?: string;
  /** Seed-feed knobs (also the STOMP snapshot request parameters). */
  snapshotRows?: number;
  rate?: number;
  batchSize?: number;
  updatesPerTick?: number;
  /** STOMP listener topic the snapshot + live frames arrive on.
   *  Default `/snapshot/positions/{clientId}`. */
  snapshotTopic?: string;
  /** STOMP destination published to request the snapshot. Used verbatim
   *  when set; default `{snapshotTopic}/{rate}/{batchSize}`. */
  triggerTopic?: string;
  /** Exact frame body marking end-of-snapshot (`{token}: ...` prefix
   *  variants also match). Default `'Success'`. */
  snapshotEndToken?: string;
  /** Unique-key field name in the STOMP payload rows, mapped onto the
   *  canonical `positionId` key. Default `'positionId'`. */
  keyColumn?: string;
  /** Label shown in telemetry for this provider's view. */
  label?: string;
  /** Optional server-side filter fixed onto this provider's view
   *  (Perspective filter triples, e.g. `[['desk', '==', 'RATES']]`). */
  filter?: PspFilter[];
  /** Book telemetry firehose (all providers sharing the book see it). */
  onTelemetry?: (t: BookTelemetry) => void;
}

/** The slice of VelocityGrid the provider needs for `attach` — structural, so the
 *  provider has no hard dependency on the VelocityGrid class. */
export interface AttachableGrid {
  applyServerSideTransaction(tx: { update?: PositionRow[] }): void;
  refreshServerSide(params?: { purge?: boolean }): void;
  getRowGroupColumns(): string[];
  on(type: string, handler: (event: unknown) => void): () => void;
}

// ─── page-level book sharing ───────────────────────────────────────────────
// One PerspectiveBook per distinct feed config per page. (Cross-TAB sharing
// happens a level below — the SharedWorker engine + Web Locks feed
// leadership in book/bootstrap.)

interface BookEntry {
  book: PerspectiveBook;
  refs: number;
  nextViewSeq: number;
  tickHandlers: Map<string, (tick: ViewTick) => void>;
  phaseHandlers: Map<string, (phase: BookPhase) => void>;
  telemetryHandlers: Map<string, (t: BookTelemetry) => void>;
}

const bookEntries = new Map<string, BookEntry>();

/** String fields that may carry `{{name.key}}` tokens. */
const TEMPLATED_KEYS = [
  'wsUrl',
  'clientId',
  'snapshotTopic',
  'triggerTopic',
  'snapshotEndToken',
  'keyColumn',
  'label',
] as const;

/**
 * Resolve AppData tokens on string config fields. When `appData` is
 * omitted, config is returned unchanged (tokens left for the host).
 * When `appData` is set, fail closed on unresolved tokens.
 */
export function resolveProviderConfig(
  config: StompPerspectiveProviderConfig,
): StompPerspectiveProviderConfig {
  if (!config.appData) return config;
  const lookup = toAppDataLookup(config.appData);
  const { appData: _drop, ...rest } = config;
  const resolved = resolveCfg(rest, lookup);
  const err = assertAppDataResolved(
    Object.fromEntries(TEMPLATED_KEYS.map((k) => [k, resolved[k]])),
    'StompPerspectiveProvider',
  );
  if (err) throw new Error(err);
  return resolved;
}

function entryFor(config: StompPerspectiveProviderConfig): { key: string; entry: BookEntry } {
  const key = [
    config.feed ?? 'seed',
    config.wsUrl ?? 'ws://localhost:8081',
    config.clientId ?? '',
    config.snapshotRows ?? 10_000,
    config.rate ?? 40,
    config.batchSize ?? 50,
    config.updatesPerTick ?? 5,
    config.snapshotTopic ?? '',
    config.triggerTopic ?? '',
    config.snapshotEndToken ?? '',
    config.keyColumn ?? '',
  ].join('|');
  let entry = bookEntries.get(key);
  if (!entry) {
    const created: BookEntry = {
      refs: 0,
      nextViewSeq: 0,
      tickHandlers: new Map(),
      phaseHandlers: new Map(),
      telemetryHandlers: new Map(),
      book: new PerspectiveBook({
        feed: config.feed ?? 'seed',
        wsUrl: config.wsUrl,
        clientId: config.clientId,
        snapshotRows: config.snapshotRows,
        rate: config.rate,
        batchSize: config.batchSize,
        updatesPerTick: config.updatesPerTick,
        snapshotTopic: config.snapshotTopic,
        triggerTopic: config.triggerTopic,
        snapshotEndToken: config.snapshotEndToken,
        keyColumn: config.keyColumn,
        onViewTick: (tick) => created.tickHandlers.get(tick.viewId)?.(tick),
        onPhase: (phase) => { for (const h of created.phaseHandlers.values()) h(phase); },
        onTelemetry: (t) => { for (const h of created.telemetryHandlers.values()) h(t); },
      }),
    };
    entry = created;
    bookEntries.set(key, entry);
  }
  return { key, entry };
}

// ─── the provider ──────────────────────────────────────────────────────────

export class StompPerspectiveProvider implements IServerSideDatasourceV2<PositionRow> {
  /** Curated defaults for the positions schema — grouping-enabled dims,
   *  summed measures, grand-total label. Fresh copies: mutate freely. */
  get columnDefs(): CColDef<PositionRow>[] {
    return POSITION_COLUMNS.map((c) => ({ ...c }));
  }

  readonly viewId: string;
  private readonly bookKey: string;
  private readonly entry: BookEntry;
  private readonly inner: IServerSideDatasourceV2<PositionRow>;
  private readonly readyPromise: Promise<void>;
  private destroyed = false;

  constructor(config: StompPerspectiveProviderConfig = {}) {
    const resolved = resolveProviderConfig(config);
    const { key, entry } = entryFor(resolved);
    this.bookKey = key;
    this.entry = entry;
    entry.refs++;
    this.viewId = `provider-${entry.nextViewSeq++}`;
    if (resolved.onTelemetry) entry.telemetryHandlers.set(this.viewId, resolved.onTelemetry);
    this.inner = createPerspectiveSsrmDatasource(entry.book, this.viewId);
    this.readyPromise = entry.book
      .registerView({
        id: this.viewId,
        label: resolved.label ?? this.viewId,
        ...(resolved.filter ? { filter: resolved.filter } : {}),
      })
      .then(() => {
        // Idempotent across providers — first caller starts the feed
        // (or, on the shared engine, joins/leads via Web Locks).
        this.entry.book.connect();
      });
  }

  /** Resolves once this provider's view exists and the feed is starting. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** The book backing this provider (shared with other providers of the
   *  same feed config on this page) — telemetry, pause, knobs. */
  get book(): PerspectiveBook {
    return this.entry.book;
  }

  /** Recommended VelocityGrid options bundle: columnDefs + the sparse-SSRM
   *  contract with this provider as the datasource. Includes every
   *  required VelocityGridOptions field, so `new VelocityGrid(el, { ...p.gridOptions() })`
   *  typechecks directly; spread FIRST, then override anything
   *  (theme/quality are the caller's business). */
  gridOptions(): VelocityGridOptions<PositionRow> {
    return {
      getRowId: (r: PositionRow) => r.positionId,
      columnDefs: this.columnDefs,
      rowModelType: 'serverSide',
      serverSideDatasource: this,
      serverSideEnableClientSidePipeline: false,
      cacheBlockSize: 100,
      maxConcurrentDatasourceRequests: 2,
      deferAsyncTransactionsWhileScrolling: true,
      asyncTransactionConflate: true,
      asyncTransactionWaitMillis: 50,
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
    } as VelocityGridOptions<PositionRow>;
  }

  /**
   * Wire the live loop onto a mounted grid: Perspective `on_update` ticks
   * → SSRM transactions / soft refresh (scroll-deferred), and grid model
   * changes (group-by / sort / filter) → Perspective view remount +
   * purge. Returns a detach function; also detached by `destroy()`.
   */
  attach(grid: AttachableGrid): () => void {
    const unsubs: Array<() => void> = [];
    let scrollActive = false;
    let pendingTick: ViewTick | null = null;

    const applyTick = (tick: ViewTick): void => {
      if (tick.refreshSsrm) {
        try { grid.refreshServerSide({ purge: false }); } catch { /* grid tearing down */ }
        return;
      }
      if (tick.updates.length === 0) return;
      try { grid.applyServerSideTransaction({ update: tick.updates }); } catch { /* grid tearing down */ }
    };

    this.entry.tickHandlers.set(this.viewId, (tick) => {
      if (scrollActive) { pendingTick = tick; return; }
      applyTick(tick);
    });
    unsubs.push(() => this.entry.tickHandlers.delete(this.viewId));

    this.entry.phaseHandlers.set(this.viewId, (phase) => {
      if (phase === 'live' || phase === 'snapshot') {
        try { grid.refreshServerSide({ purge: true }); } catch { /* grid tearing down */ }
      }
    });
    unsubs.push(() => this.entry.phaseHandlers.delete(this.viewId));

    unsubs.push(grid.on('columnRowGroupChanged', (ev) => {
      const cols = (ev as { columns?: string[] }).columns ?? grid.getRowGroupColumns();
      void this.entry.book.setViewGroupBy(this.viewId, cols);
    }));
    unsubs.push(grid.on('sortChanged', () => grid.refreshServerSide({ purge: true })));
    unsubs.push(grid.on('filterChanged', () => grid.refreshServerSide({ purge: true })));
    unsubs.push(grid.on('bodyScroll', () => { scrollActive = true; }));
    unsubs.push(grid.on('bodyScrollEnd', () => {
      scrollActive = false;
      if (pendingTick) { const t = pendingTick; pendingTick = null; applyTick(t); }
    }));

    return () => { for (const u of unsubs.splice(0)) u(); };
  }

  // ── IServerSideDatasourceV2 — delegate once the view exists ──────────

  getRows(params: IServerSideGetRowsParams<PositionRow>): void {
    void this.readyPromise.then(() => this.inner.getRows(params)).catch(() => params.fail());
  }

  getGroupSkeleton(params: IServerSideGetSkeletonParams): void {
    void this.readyPromise.then(() => this.inner.getGroupSkeleton(params)).catch(() => params.fail());
  }

  getLeafRows(params: IServerSideGetLeafRowsParams<PositionRow>): void {
    void this.readyPromise.then(() => this.inner.getLeafRows(params)).catch(() => params.fail());
  }

  getGroupLeafIds(params: IServerSideGetGroupLeafIdsParams): void {
    void this.readyPromise
      .then(() => this.inner.getGroupLeafIds?.(params) ?? params.success({ ids: [] }))
      .catch(() => params.fail());
  }

  /** Called by the grid on datasource swap/teardown — releases this
   *  provider's view; the shared book dies with its last provider. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.entry.tickHandlers.delete(this.viewId);
    this.entry.phaseHandlers.delete(this.viewId);
    this.entry.telemetryHandlers.delete(this.viewId);
    void this.entry.book.unregisterView(this.viewId);
    this.entry.refs--;
    if (this.entry.refs <= 0) {
      bookEntries.delete(this.bookKey);
      this.entry.book.destroy();
    }
  }
}
