/**
 * StompPerspectiveProvider — one **View** onto a shared DataProvider book.
 *
 * Architecture (multi-grid safe):
 * - DataProvider / `PerspectiveBook` owns the Perspective **Table** + feed
 * - Each `StompPerspectiveProvider` registers its own **View** on that table
 * - Grids never touch the table — SSRM reads go View → `getSsrmRows(viewId)`
 *
 * Multiple grids applying the same catalog `providerId` share one book/table
 * and each gets an independent View (group/sort/filter/projection).
 *
 * ```ts
 * const provider = new StompPerspectiveProvider({ feed: 'stomp', wsUrl, clientId });
 * const grid = new VelocityGrid(host, { theme: '...', ...provider.gridOptions() });
 * provider.attach(grid);   // live ticks + group/sort/filter sync on THIS view
 * ```
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
} from '@wellsfargo-starui/velocity-grid-data/appdata';
import { registerDataProviderFeedControl } from '@wellsfargo-starui/velocity-grid-data';
import {
  PerspectiveBook,
  type BookFeed,
  type BookPhase,
  type BookTelemetry,
  type ExpressionValidationResult,
  type PspFilter,
  type ViewTick,
} from './book';
import {
  broadcastProviderFeedRestart,
  broadcastProviderFeedStop,
  subscribeProviderFeedBroadcast,
} from './feedBroadcast';
import { createPerspectiveSsrmDatasource } from './ssrmDatasource';
import { POSITION_COLUMNS } from './positionColumns';
import { POSITION_SCHEMA, type PositionRow } from './bootstrap';
import { resolveTableIndexField, rowIdentity } from './rowIdentity';

export interface StompPerspectiveProviderConfig {
  /** `'stomp'` for the live STOMP feed, `'seed'` (default) for the
   *  self-contained deterministic book — no server needed. */
  feed?: BookFeed;
  /**
   * Catalog DataProvider id. When set, multiple grids applying the same
   * provider share one book/table (each still gets its own View).
   */
  providerId?: string;
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
  /** Unique-key field(s) in the STOMP payload rows. Single field or
   *  composite. Drives LWW coalescing, getRowId, and the Perspective
   *  table index. Default `'positionId'` for the curated positions schema. */
  keyColumn?: string | string[];
  /**
   * Perspective table schema from DataProvider `columnDefinitions`.
   * When omitted, the curated positions schema is used.
   */
  schema?: Record<string, string>;
  /**
   * Run the STOMP transport inside the SharedWorker rather than on this
   * tab's main thread. **Default `true`**; falls back silently where it
   * cannot apply. See `PerspectiveBookOptions.workerFeed`.
   */
  workerFeed?: boolean;
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
  /** Row shape varies by provider (Perspective `PositionRow` vs mock blotter). */
  applyServerSideTransaction(tx: { update?: unknown[] }): void;
  refreshServerSide(params?: { purge?: boolean }): void;
  getRowGroupColumns(): string[];
  on(type: string, handler: (event: unknown) => void): () => void;
  /** Current title-bar / options quick-filter text (sparse SSRM). */
  getQuickFilterText?(): string;
  /** Value columns + aggFunc from the pivot/grouping value registry. */
  getValueColumns?(): Array<{ colId: string; aggFunc: string }>;
  /** Register Perspective expression output aliases for SSRM columnKeys. */
  setSsrmExpressionOutputs?(ids: readonly string[]): void;
  /** Register this provider as the grid's SSRM ExprTK host. */
  setSsrmExpressionHost?(host: unknown | null): void;
  /** Publish host-computed grand totals (sparse SSRM, keyed by field). */
  setServerSideGrandTotals?(totals: Record<string, unknown> | null): void;
  /** Publish a Perspective-computed pivot cross-tab (sparse SSRM). */
  setServerSidePivotResult?(result: unknown | null): void;
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
  /** Unregister Diagnostics Stop/Restart bridge (catalog providerId). */
  unregFeedControl: (() => void) | null;
  /** Unregister cross-tab feed broadcast listener. */
  unregFeedBroadcast: (() => void) | null;
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

/** Canonical schema for share-key + table create (omit ≡ POSITION_SCHEMA). */
function normalizeSchema(
  schema: Record<string, string> | undefined,
  keyColumn: string | string[] | undefined,
): Record<string, string> {
  const s: Record<string, string> = { ...(schema ?? POSITION_SCHEMA) };
  const indexField = resolveTableIndexField(keyColumn ?? 'positionId');
  if (!s[indexField]) s[indexField] = 'string';
  return s;
}

function schemaKey(schema: Record<string, string>): string {
  return Object.keys(schema).sort().map((k) => `${k}:${schema[k]}`).join(',');
}

/**
 * Provider/connection identity (C-M6) folded into the physical Perspective
 * table name + feed-lock name (`bootstrap.ts` `tableNameForSchema`, via
 * `PerspectiveBookOptions.identity`) — catalog `providerId`, else
 * `websocketUrl` + `listenerTopic`/`clientId`. Two providers with
 * identical `columnDefinitions` but different brokers must never resolve
 * to the same table (previously: schema shape alone decided the name, so
 * provider B could render provider A's rows). Undefined when nothing
 * distinguishing is configured — preserves the historical fixed
 * `positions-shared` table name for the no-catalog seed/demo case.
 */
export function bookIdentityFor(config: StompPerspectiveProviderConfig): string | undefined {
  const parts = [config.providerId, config.wsUrl, config.snapshotTopic ?? config.clientId]
    .filter((v): v is string => !!v);
  return parts.length > 0 ? parts.join('|') : undefined;
}

/**
 * Resolve / create the shared book for this DataProvider.
 * Same catalog `providerId` (+ schema) → one Table; each caller still
 * registers its own View via {@link StompPerspectiveProvider}.
 */
function entryFor(config: StompPerspectiveProviderConfig): { key: string; entry: BookEntry } {
  const schema = normalizeSchema(config.schema, config.keyColumn);
  // Prefer DataProvider identity so multiple grids share one table/views.
  // Schema is part of the key so column-definition edits get a fresh table
  // once every grid has released the previous book.
  const key = config.providerId
    ? `dp:${config.providerId}|${schemaKey(schema)}`
    : [
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
      Array.isArray(config.keyColumn) ? config.keyColumn.join('\u001F') : (config.keyColumn ?? ''),
      schemaKey(schema),
    ].join('|');
  let entry = bookEntries.get(key);
  if (!entry) {
    const created: BookEntry = {
      refs: 0,
      nextViewSeq: 0,
      tickHandlers: new Map(),
      phaseHandlers: new Map(),
      telemetryHandlers: new Map(),
      unregFeedControl: null,
      unregFeedBroadcast: null,
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
        schema,
        workerFeed: config.workerFeed,
        identity: bookIdentityFor(config),
        onViewTick: (tick) => created.tickHandlers.get(tick.viewId)?.(tick),
        onPhase: (phase) => { for (const h of created.phaseHandlers.values()) h(phase); },
        onTelemetry: (t) => { for (const h of created.telemetryHandlers.values()) h(t); },
      }),
    };
    // Bridge Diagnostics Stop → this tab's book, and BroadcastChannel so
    // every other tab on the same providerId freezes/restarts too.
    if (config.providerId) {
      const providerId = config.providerId;
      created.unregFeedBroadcast = subscribeProviderFeedBroadcast(providerId, {
        onStop: () => { created.book.stopFeed(); },
        onRestart: () => { created.book.restartFeed(); },
      });
      created.unregFeedControl = registerDataProviderFeedControl(providerId, {
        stop: () => {
          created.book.stopFeed();
          broadcastProviderFeedStop(providerId);
        },
        restart: () => {
          created.book.restartFeed();
          broadcastProviderFeedRestart(providerId);
        },
      });
    }
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
  private readonly keyColumn: string | string[];
  private readonly inner: IServerSideDatasourceV2<PositionRow>;
  private readonly readyPromise: Promise<void>;
  private destroyed = false;
  private attachedGrid: AttachableGrid | null = null;

  constructor(config: StompPerspectiveProviderConfig = {}) {
    const resolved = resolveProviderConfig(config);
    const { key, entry } = entryFor(resolved);
    this.bookKey = key;
    this.entry = entry;
    this.keyColumn = resolved.keyColumn ?? 'positionId';
    entry.refs++;
    this.viewId = `provider-${entry.nextViewSeq++}`;
    if (resolved.onTelemetry) entry.telemetryHandlers.set(this.viewId, resolved.onTelemetry);
    // C-m10 — the book's 4Hz telemetry recompute runs only while a
    // consumer is actually listening.
    entry.book.setTelemetryActive(entry.telemetryHandlers.size > 0);
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
    // C-M7 — a rejected view registration must not become an unhandled
    // promise rejection when no caller ever awaits `ready()` / calls
    // `getRows()` before `destroy()` (e.g. a superseded Apply). Real
    // awaiters still observe the rejection through `ready()` / `getRows()`
    // etc. below — this is a second, independent handler on the same
    // promise, not a replacement for it.
    this.readyPromise.catch(() => { /* observed; see ready() for real handling */ });
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

  /** Current Perspective ExprTK expressions for this provider's view. */
  getExpressions(): Record<string, string> {
    return this.entry.book.getViewExpressions(this.viewId);
  }

  /**
   * Validate ExprTK expressions against the shared table (no remount).
   * Returns Perspective `expression_schema` + per-alias `errors`.
   */
  validateExpressions(
    expressions: Record<string, string>,
  ): Promise<ExpressionValidationResult> {
    return this.entry.book.validateExpressions(expressions);
  }

  /**
   * Set/replace ViewConfig.expressions for this blotter, remount Views,
   * and sync expression output aliases onto an attached grid's SSRM
   * `columnKeys` builder.
   */
  async setExpressions(expressions: Record<string, string>): Promise<void> {
    await this.readyPromise;
    await this.entry.book.setViewExpressions(this.viewId, expressions);
    this.syncExpressionOutputsToGrid();
    try {
      this.attachedGrid?.refreshServerSide({ purge: false });
    } catch { /* grid tearing down */ }
  }

  /**
   * Distinct column values for set-filter popups (full table, not the
   * sparse SSRM hydrate window).
   */
  async getDistinctValues(colId: string, limit?: number): Promise<string[]> {
    await this.readyPromise;
    return this.entry.book.getDistinctColumnValues(colId, limit);
  }

  /** Full-book row count for a filter model (saved-filter pill badges). */
  async countMatchingFilterModel(
    filterModel: import('@wellsfargo-starui/velocity-grid').FilterModel,
  ): Promise<number> {
    await this.readyPromise;
    return this.entry.book.countMatchingFilterModel(filterModel);
  }

  private syncExpressionOutputsToGrid(): void {
    const ids = Object.keys(this.getExpressions());
    try {
      this.attachedGrid?.setSsrmExpressionOutputs?.(ids);
    } catch { /* grid tearing down */ }
  }

  /** Recommended VelocityGrid options bundle: columnDefs + the sparse-SSRM
   *  contract with this provider as the datasource. Includes every
   *  required VelocityGridOptions field, so `new VelocityGrid(el, { ...p.gridOptions() })`
   *  typechecks directly; spread FIRST, then override anything
   *  (theme/quality are the caller's business). */
  gridOptions(): VelocityGridOptions<PositionRow> {
    return {
      getRowId: (r: PositionRow) => {
        const id = rowIdentity(r as Record<string, unknown>, this.keyColumn);
        return id ?? '';
      },
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
   * Point Perspective's `split_by` at the grid's pivot columns, then publish
   * the resulting cross-tab.
   *
   * Called on every `pivotStateChanged`. Turning pivot off passes `[]`, which
   * tears the split_by views down and pushes `null` to clear the matrix.
   */
  private async syncPivot(grid: AttachableGrid, pivotColumns: string[]): Promise<void> {
    if (typeof grid.setServerSidePivotResult !== 'function') return;
    try {
      await this.entry.book.setViewPivotColumns(this.viewId, pivotColumns);
    } catch { return; /* view torn down mid-flight */ }
    await this.pushPivotResult(grid);
  }

  /**
   * Read the cross-tab from Perspective and hand it to the grid. Cheap no-op
   * when not pivoting, so tick/refresh paths can call it unconditionally.
   */
  private async pushPivotResult(grid: AttachableGrid): Promise<void> {
    if (typeof grid.setServerSidePivotResult !== 'function') return;
    if (this.entry.book.getViewPivotColumns(this.viewId).length === 0) return;
    try {
      const result = await this.entry.book.getPivotResult(this.viewId);
      grid.setServerSidePivotResult(result);
    } catch { /* view torn down, or grid detached mid-read */ }
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
    this.attachedGrid = grid;
    this.syncExpressionOutputsToGrid();
    try {
      grid.setSsrmExpressionHost?.(this);
    } catch { /* optional */ }
    // Declare pivot capability UP FRONT with an empty cross-tab.
    //
    // Ordering matters: `setPivotMode(true)` refuses unless the host has
    // already declared it can pivot, but the provider only learns the pivot
    // columns from `pivotStateChanged` — which `setPivotMode` never emits
    // when it refuses. Waiting for the first real result would deadlock the
    // two. A `null` push is exactly the "I can pivot, nothing to show yet"
    // signal, so the kernel stops routing pivot through a full hydrate.
    try {
      grid.setServerSidePivotResult?.(null);
    } catch { /* optional */ }
    try {
      const qf = typeof grid.getQuickFilterText === 'function'
        ? grid.getQuickFilterText()
        : '';
      this.entry.book.setViewQuickFilterText(this.viewId, qf ?? '');
    } catch { /* optional */ }

    const syncValueAggregates = (): void => {
      try {
        const cols = typeof grid.getValueColumns === 'function'
          ? grid.getValueColumns()
          : [];
        void this.entry.book.setViewValueAggregates(this.viewId, cols ?? []).then((changed) => {
          if (!changed) return;
          try { grid.refreshServerSide({ purge: true }); } catch { /* grid tearing down */ }
        });
      } catch { /* optional */ }
    };
    // Seed from colDef.aggFunc / existing value columns at attach time.
    syncValueAggregates();

    const applyTick = (tick: ViewTick): void => {
      // Push leaf patches FIRST so rules / alerts / cell flash see
      // `rowsChanged` before a soft-refresh hydrate can race the strip cache.
      if (tick.updates.length > 0) {
        try { grid.applyServerSideTransaction({ update: tick.updates }); } catch { /* grid tearing down */ }
      }
      // Flat views: publish the grand totals this tick already computed.
      //
      // `emitViewTick` awaits `fetchGrandTotal` for every ungrouped view and
      // ships the result on the tick — but nothing consumed it, so a flat
      // leader tick (which takes the cheap patch path above, with
      // `refreshSsrm: false`) never re-issued `getRows` and never refreshed
      // the totals. Rows ticked; the pinned grand-total row painted its
      // first value forever.
      //
      // Grouped views are skipped deliberately: their tick carries a
      // placeholder (`emptyGrandTotalRow()`) and the real aggregates come
      // from the skeleton root on the soft refresh below — pushing the
      // placeholder here would blank them.
      if (tick.totals && grid.getRowGroupColumns().length === 0) {
        try {
          grid.setServerSideGrandTotals?.(tick.totals as unknown as Record<string, unknown>);
        } catch { /* grid tearing down */ }
      }
      // Soft-refresh group aggregates / ExprTK outputs when asked.
      if (tick.refreshSsrm) {
        try { grid.refreshServerSide({ purge: false }); } catch { /* grid tearing down */ }
      }
      // A tick moved the table, so a published cross-tab is now stale. Only
      // re-read when actually pivoting — `pushPivotResult` no-ops otherwise.
      void this.pushPivotResult(grid);
    };

    // Multiple ticks can land while one scroll is active — merge into the
    // pending tick instead of replacing it, or an earlier tick's row
    // patches / `refreshSsrm: true` get silently lost under a later tick
    // that carries fewer updates or `refreshSsrm: false`.
    const mergePendingTick = (prev: ViewTick, next: ViewTick): ViewTick => {
      const byId = new Map<string, PositionRow>();
      for (const row of prev.updates) {
        const id = rowIdentity(row as Record<string, unknown>, this.keyColumn);
        if (id != null) byId.set(id, row);
      }
      for (const row of next.updates) {
        const id = rowIdentity(row as Record<string, unknown>, this.keyColumn);
        if (id != null) byId.set(id, row);
      }
      return {
        viewId: next.viewId,
        totals: next.totals,
        refreshSsrm: prev.refreshSsrm || next.refreshSsrm,
        updates: [...byId.values()],
      };
    };

    this.entry.tickHandlers.set(this.viewId, (tick) => {
      if (scrollActive) {
        pendingTick = pendingTick ? mergePendingTick(pendingTick, tick) : tick;
        return;
      }
      applyTick(tick);
    });
    unsubs.push(() => this.entry.tickHandlers.delete(this.viewId));

    // Purge once when the book is usable (`live`). Purging on both
    // `snapshot` and `live` blanked the viewport twice (flicker / lost
    // scroll) on every Apply/connect — seed+STOMP always emit snapshot
    // then live in sequence.
    this.entry.phaseHandlers.set(this.viewId, (phase) => {
      if (phase === 'live') {
        try { grid.refreshServerSide({ purge: true }); } catch { /* grid tearing down */ }
      }
    });
    unsubs.push(() => this.entry.phaseHandlers.delete(this.viewId));

    unsubs.push(grid.on('columnRowGroupChanged', (ev) => {
      const cols = (ev as { columns?: string[] }).columns ?? grid.getRowGroupColumns();
      void this.entry.book.setViewGroupBy(this.viewId, cols).then(() => {
        // Kernel does not auto-refresh SSRM on group changes — rebuild
        // the skeleton / flat window after the View remounts.
        try { grid.refreshServerSide({ purge: true }); } catch { /* grid tearing down */ }
        // The cross-tab is keyed by composite GROUP key, so a group change
        // invalidates every key in it. The remount above already rebuilt the
        // split_by views against the new group_by; re-publish from them.
        void this.pushPivotResult(grid);
      });
    }));
    // Value-column / aggFunc mutations live on PivotState even outside pivot
    // mode — remount Perspective aggregates when they change.
    unsubs.push(grid.on('pivotStateChanged', (ev) => {
      const e = ev as {
        source?: string; pivotMode?: boolean; pivotColumns?: string[];
      };
      // Value-column / aggFunc mutations apply in or out of pivot mode.
      if (e.source !== 'mode') syncValueAggregates();
      // Drive Perspective `split_by` off the grid's pivot state. Previously
      // `source === 'mode'` returned early and pivot never reached
      // Perspective at all — the kernel had to full-hydrate to pivot, which
      // a sparse book refuses. Now Perspective computes the cross-tab and we
      // push it back, so pivot works without abandoning SSRM.
      void this.syncPivot(grid, e.pivotMode === true ? (e.pivotColumns ?? []) : []);
    }));
    // Sort / column filters: kernel already `ssrm.refresh({ purge: true })`
    // on sparse SSRM — do not double-purge here (wipes in-flight blocks).
    unsubs.push(grid.on('filterChanged', () => {
      // Push title-bar quick filter onto the View before the kernel's
      // refresh getRows remounts with haystack contains terms.
      try {
        const qf = typeof grid.getQuickFilterText === 'function'
          ? grid.getQuickFilterText()
          : '';
        this.entry.book.setViewQuickFilterText(this.viewId, qf ?? '');
      } catch { /* optional */ }
    }));
    unsubs.push(grid.on('bodyScroll', () => { scrollActive = true; }));
    unsubs.push(grid.on('bodyScrollEnd', () => {
      scrollActive = false;
      if (pendingTick) { const t = pendingTick; pendingTick = null; applyTick(t); }
    }));

    return () => {
      if (this.attachedGrid === grid) this.attachedGrid = null;
      try { grid.setSsrmExpressionHost?.(null); } catch { /* optional */ }
      for (const u of unsubs.splice(0)) u();
    };
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
      try { this.entry.unregFeedControl?.(); } catch { /* */ }
      try { this.entry.unregFeedBroadcast?.(); } catch { /* */ }
      this.entry.unregFeedControl = null;
      this.entry.unregFeedBroadcast = null;
      this.entry.book.destroy();
    } else {
      // C-m10 — stop the 4Hz recompute once the last telemetry consumer
      // on this (still-shared) book detaches.
      this.entry.book.setTelemetryActive(this.entry.telemetryHandlers.size > 0);
    }
  }
}
