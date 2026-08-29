/**
 * Binds hub catalog DataProviderConfig entries onto StompPerspectiveProvider
 * (SSRM). Authoring uses the real DataProvider editor; Apply maps STOMP
 * fields → Perspective and attaches.
 *
 * Multi-grid: each Ext/controller creates its own provider **View**. The
 * shared DataProvider book (keyed by `providerId`) owns the Perspective
 * Table + feed — grids never access the table directly.
 */
import type {
  ConfigBackend,
  DataProviderConfig,
  ProviderClientOptions,
} from '@wellsfargo-starui/velocity-grid-data';
import {
  createDefaultConfigBackend,
} from '@wellsfargo-starui/velocity-grid-data';
import {
  StompPerspectiveProvider,
  type AttachableGrid,
  type StompPerspectiveProviderConfig,
} from './provider';
import type { BookTelemetry } from './book';
import { withTimeout } from './bootstrap';
import {
  dataProviderConfigToPerspective,
  gridColumnDefsFromDataProvider,
} from './mapFromDataProvider';
import {
  mergeExpressionColumnDefs,
  type ExpressionColumnMeta,
} from './expressionColumns';

/** `bindConfig` (C-M7) bounds `provider.ready()` so a hung/failed connect
 *  can never make Apply hang or silently "succeed". */
const BIND_READY_TIMEOUT_MS = 20_000;

export type PerspectiveDataProviderStateSlice = {
  activeProviderId: string | null;
  /** Persisted Perspective ExprTK expressions keyed by providerId. */
  expressionsByProvider?: Record<string, Record<string, string>>;
  /** Header / format metadata for expression columns. */
  exprMetaByProvider?: Record<string, Record<string, ExpressionColumnMeta>>;
};

type ExtLikeContext = {
  grid: AttachableGrid & {
    updateGridOptions?: (partial: Record<string, unknown>) => void;
    setServerSideDatasource?: (ds: unknown | null) => void;
    whenReady?: () => Promise<void>;
  };
  registerStateModule: (module: {
    id: string;
    version: number;
    get: () => unknown;
    set: (data: unknown, version: number) => void;
  }) => () => void;
  profiles: { markDirty: () => void; save: () => Promise<void> };
};

export type PerspectiveDataProviderControllerOptions = {
  catalog?: ConfigBackend;
  onActiveChange?: (
    providerId: string | null,
    provider: StompPerspectiveProvider | null,
    /** Present only when the bind failed (C-M7) — `providerId`/`provider`
     *  are `null` in that call. */
    status?: { phase: 'error'; message: string },
  ) => void;
  onTelemetry?: (t: BookTelemetry) => void;
  /** Hub options so the editor popout's Diagnostics session hits the same
   *  in-process / worker hub as the rest of the app (C-m12). Perspective
   *  itself never uses the hub — this is a pure passthrough. */
  hubOpts?: ProviderClientOptions;
};

export class PerspectiveDataProviderController {
  private static readonly byGrid = new WeakMap<object, PerspectiveDataProviderController>();

  private readonly catalog: ConfigBackend;
  private readonly onActiveChange?: PerspectiveDataProviderControllerOptions['onActiveChange'];
  private readonly onTelemetry?: (t: BookTelemetry) => void;
  private readonly hubOpts?: ProviderClientOptions;
  private activeProviderId: string | null = null;
  private desiredProviderId: string | null = null;
  private provider: StompPerspectiveProvider | null = null;
  private detachProvider: (() => void) | null = null;
  private ctx: ExtLikeContext | null = null;
  private unregState: (() => void) | null = null;
  private activateChain: Promise<void> = Promise.resolve();
  private activateEpoch = 0;
  /** Extra telemetry sinks (UI panels), alongside the constructor callback. */
  private readonly telemetrySubs = new Set<(t: BookTelemetry) => void>();
  /** Last frame seen, so a panel mounting mid-feed paints immediately. */
  private lastTelemetry: BookTelemetry | null = null;
  /** Survives provider destroy/rebind so calculated columns stay attached. */
  private expressionsByProvider = new Map<string, Record<string, string>>();
  private exprMetaByProvider = new Map<string, Record<string, ExpressionColumnMeta>>();

  constructor(opts?: PerspectiveDataProviderControllerOptions) {
    this.catalog = opts?.catalog ?? createDefaultConfigBackend();
    this.onActiveChange = opts?.onActiveChange;
    this.onTelemetry = opts?.onTelemetry;
    this.hubOpts = opts?.hubOpts;
  }

  /** Hub options for the editor popout's Diagnostics session (C-m12). */
  getHubOpts(): ProviderClientOptions | undefined {
    return this.hubOpts ? { ...this.hubOpts } : undefined;
  }

  /**
   * Subscribe an extra telemetry sink. Additive to the `onTelemetry`
   * constructor option, which keeps firing exactly as before — this exists so
   * UI (the Data settings panel) can show feed state without the host app
   * having to give up its own callback.
   *
   * Fires immediately with the last frame if one has already arrived, so a
   * panel mounted mid-feed paints without waiting for the next tick.
   * Returns an unsubscribe.
   */
  subscribeTelemetry(fn: (t: BookTelemetry) => void): () => void {
    this.telemetrySubs.add(fn);
    if (this.lastTelemetry) {
      try { fn(this.lastTelemetry); } catch { /* ignore */ }
    }
    return () => { this.telemetrySubs.delete(fn); };
  }

  /** Most recent telemetry frame, or null before the first one. */
  getTelemetry(): BookTelemetry | null {
    return this.lastTelemetry;
  }

  /** Resolve the controller bound to a grid (from Ext calculated-columns etc.). */
  static forGrid(grid: object): PerspectiveDataProviderController | null {
    return PerspectiveDataProviderController.byGrid.get(grid) ?? null;
  }

  /** Remember ExprTK expressions + column meta for the active provider. */
  rememberExpressions(
    expressions: Record<string, string>,
    meta: Record<string, ExpressionColumnMeta> = {},
  ): void {
    const id = this.activeProviderId;
    if (!id) return;
    this.expressionsByProvider.set(id, { ...expressions });
    this.exprMetaByProvider.set(id, { ...meta });
    this.ctx?.profiles.markDirty();
  }

  getExpressionMeta(providerId?: string | null): Record<string, ExpressionColumnMeta> {
    const id = providerId ?? this.activeProviderId;
    if (!id) return {};
    return { ...(this.exprMetaByProvider.get(id) ?? {}) };
  }

  getCatalog(): ConfigBackend {
    return this.catalog;
  }

  getActiveProviderId(): string | null {
    return this.activeProviderId;
  }

  getProvider(): StompPerspectiveProvider | null {
    return this.provider;
  }

  attach(ctx: ExtLikeContext): void {
    this.ctx = ctx;
    PerspectiveDataProviderController.byGrid.set(ctx.grid, this);
    this.unregState?.();
    this.unregState = ctx.registerStateModule({
      id: 'perspective-data-provider',
      version: 2,
      get: () => {
        const expressionsByProvider: Record<string, Record<string, string>> = {};
        for (const [k, v] of this.expressionsByProvider) expressionsByProvider[k] = { ...v };
        const exprMetaByProvider: Record<string, Record<string, ExpressionColumnMeta>> = {};
        for (const [k, v] of this.exprMetaByProvider) exprMetaByProvider[k] = { ...v };
        return {
          activeProviderId: this.activeProviderId,
          expressionsByProvider,
          exprMetaByProvider,
        } satisfies PerspectiveDataProviderStateSlice;
      },
      set: (data) => {
        const slice = data as PerspectiveDataProviderStateSlice | null | undefined;
        if (slice && typeof slice === 'object') {
          this.expressionsByProvider.clear();
          this.exprMetaByProvider.clear();
          for (const [k, v] of Object.entries(slice.expressionsByProvider ?? {})) {
            if (v && typeof v === 'object') this.expressionsByProvider.set(k, { ...v });
          }
          for (const [k, v] of Object.entries(slice.exprMetaByProvider ?? {})) {
            if (v && typeof v === 'object') this.exprMetaByProvider.set(k, { ...v });
          }
        }
        const id = slice && typeof slice === 'object' && 'activeProviderId' in slice
          ? (slice.activeProviderId ?? null)
          : null;
        // `setActiveProvider`'s returned promise is a distinct object from
        // the internal `activateChain` relay (which already swallows
        // rejections for its own bookkeeping) — a bare `void` here left it
        // genuinely unhandled once bindConfig started rejecting on a dead
        // broker (C-M7 "honest Apply"). This `.catch` exists ONLY to stop
        // that unhandled rejection; it must NOT re-emit `onActiveChange`.
        // `bindConfig`'s own catch already owns that emission and is
        // epoch-guarded (fix wave 2, Finding 3) — an unguarded duplicate
        // here would fire even when this activation has been superseded,
        // clobbering a newer, correct state with a stale error.
        this.setActiveProvider(id, { fromState: true }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[perspective] state-restore setActiveProvider failed', message);
        });
      },
    });
  }

  detach(): void {
    this.activateEpoch += 1;
    this.desiredProviderId = null;
    void this.stopCurrent();
    this.unregState?.();
    this.unregState = null;
    if (this.ctx) {
      PerspectiveDataProviderController.byGrid.delete(this.ctx.grid);
    }
    this.ctx = null;
  }

  async saveDefinition(cfg: DataProviderConfig): Promise<DataProviderConfig> {
    const saved = await this.catalog.save(cfg);
    this.ctx?.profiles.markDirty();
    if (saved.providerId === this.activeProviderId) {
      await this.setActiveProvider(saved.providerId, { force: true, fromState: true });
    }
    return saved;
  }

  async setActiveProvider(
    providerId: string | null,
    opts?: { fromState?: boolean; force?: boolean },
  ): Promise<void> {
    const run = () => this.setActiveProviderUnlocked(providerId, opts);
    const next = this.activateChain.then(run, run);
    this.activateChain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async setActiveProviderUnlocked(
    providerId: string | null,
    opts?: { fromState?: boolean; force?: boolean },
  ): Promise<void> {
    if (
      !opts?.force
      && providerId != null
      && providerId === this.desiredProviderId
      && providerId === this.activeProviderId
      && this.provider
    ) {
      this.onActiveChange?.(this.activeProviderId, this.provider);
      return;
    }

    const epoch = ++this.activateEpoch;
    this.desiredProviderId = providerId;
    await this.stopCurrent();
    if (epoch !== this.activateEpoch) return;

    this.activeProviderId = providerId;
    if (!opts?.fromState) this.ctx?.profiles.markDirty();

    if (!providerId || !this.ctx) {
      this.onActiveChange?.(null, null);
      if (!opts?.fromState && this.ctx) await this.persistActiveSelection();
      return;
    }

    const entry = await this.catalog.get(providerId);
    if (epoch !== this.activateEpoch) return;
    if (!entry) {
      console.warn(`[perspective] provider "${providerId}" not found in catalog`);
      this.activeProviderId = null;
      this.desiredProviderId = null;
      this.onActiveChange?.(null, null);
      if (!opts?.fromState) await this.persistActiveSelection();
      return;
    }

    await this.bindConfig(entry, epoch);
    if (epoch !== this.activateEpoch) return;

    this.onActiveChange?.(this.activeProviderId, this.provider);
    if (!opts?.fromState) await this.persistActiveSelection();
  }

  private async persistActiveSelection(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.profiles.save();
    } catch (err) {
      console.warn('[perspective] failed to persist active provider', err);
    }
  }

  private async bindConfig(entry: DataProviderConfig, epoch: number): Promise<void> {
    if (!this.ctx) return;
    if (typeof this.ctx.grid.whenReady === 'function') {
      await this.ctx.grid.whenReady();
      if (epoch !== this.activateEpoch) return;
    }

    const mapped = dataProviderConfigToPerspective(entry);
    const cfg: StompPerspectiveProviderConfig = {
      ...mapped,
      // Fan out to the constructor callback AND to anything that registered
      // via `subscribeTelemetry` (the Data settings panel, for one), so the
      // app's own telemetry sink stays exactly as it was.
      onTelemetry: (t) => {
        this.lastTelemetry = t;
        try { this.onTelemetry?.(t); } catch { /* app sink must not break the feed */ }
        for (const fn of this.telemetrySubs) {
          try { fn(t); } catch { /* one bad subscriber must not starve the rest */ }
        }
      },
    };
    const provider = new StompPerspectiveProvider(cfg);
    if (epoch !== this.activateEpoch) {
      provider.destroy();
      return;
    }

    // C-M7 — Apply must not report success (or hang) on a connection that
    // never comes up. Bound the wait, and on failure release the provider
    // and surface an error phase instead of silently wiring a dead
    // datasource onto the grid.
    try {
      await withTimeout(
        provider.ready(),
        BIND_READY_TIMEOUT_MS,
        `[perspective] provider "${entry.providerId}" connect`,
      );
    } catch (err) {
      provider.destroy();
      const message = err instanceof Error ? err.message : String(err);
      // Both the state reset AND the error emit are epoch-guarded: a
      // superseded activation (or a `detach()` mid-bind, which bumps
      // `activateEpoch`) must not clobber newer state or report an error
      // over it — the newer activation already owns `onActiveChange`.
      if (epoch === this.activateEpoch) {
        this.activeProviderId = null;
        this.desiredProviderId = null;
        this.provider = null;
        this.onActiveChange?.(null, null, { phase: 'error', message });
      }
      throw err instanceof Error ? err : new Error(message);
    }
    if (epoch !== this.activateEpoch) {
      provider.destroy();
      return;
    }
    this.provider = provider;

    // `serverSideDatasource` / `rowModelType` are construction-time only —
    // install via the dedicated API. Only push runtime-mutable options.
    // Columns come from the catalog entry, then ExprTK aliases are merged
    // so Apply never wipes calculated columns / rules watched fields.
    const gridOpts = provider.gridOptions();
    const expressions = this.expressionsByProvider.get(entry.providerId) ?? {};
    const exprMeta = this.exprMetaByProvider.get(entry.providerId) ?? {};
    const columnDefs = mergeExpressionColumnDefs(
      gridColumnDefsFromDataProvider(entry),
      expressions,
      exprMeta,
    );
    this.ctx.grid.updateGridOptions?.({
      columnDefs,
      rowGroupPanelShow: gridOpts.rowGroupPanelShow,
      suppressAggFuncInHeader: gridOpts.suppressAggFuncInHeader,
      asyncTransactionConflate: gridOpts.asyncTransactionConflate,
      asyncTransactionWaitMillis: gridOpts.asyncTransactionWaitMillis,
    });
    if (typeof this.ctx.grid.setServerSideDatasource !== 'function') {
      throw new Error(
        '[perspective] grid.setServerSideDatasource is required '
        + '(construct with rowModelType: "serverSide")',
      );
    }
    this.ctx.grid.setServerSideDatasource(provider);
    this.detachProvider = provider.attach(this.ctx.grid);

    if (Object.keys(expressions).length > 0) {
      try {
        await provider.setExpressions(expressions);
      } catch (err) {
        console.warn('[perspective] failed to restore ExprTK expressions', err);
      }
    }
  }

  private async stopCurrent(): Promise<void> {
    // Capture live expressions before the view is destroyed.
    if (this.provider && this.activeProviderId) {
      try {
        this.expressionsByProvider.set(
          this.activeProviderId,
          this.provider.getExpressions(),
        );
      } catch { /* */ }
    }
    try { this.detachProvider?.(); } catch { /* */ }
    this.detachProvider = null;
    if (this.provider) {
      try { this.provider.destroy(); } catch { /* */ }
      this.provider = null;
    }
    try { this.ctx?.grid.setServerSideDatasource?.(null); } catch { /* */ }
    // No active provider → no columns.
    try { this.ctx?.grid.updateGridOptions?.({ columnDefs: [] }); } catch { /* */ }
  }
}
