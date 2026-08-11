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
import {
  dataProviderConfigToPerspective,
  gridColumnDefsFromDataProvider,
} from './mapFromDataProvider';
import {
  mergeExpressionColumnDefs,
  type ExpressionColumnMeta,
} from './expressionColumns';

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
  ) => void;
  onTelemetry?: (t: BookTelemetry) => void;
};

export class PerspectiveDataProviderController {
  private static readonly byGrid = new WeakMap<object, PerspectiveDataProviderController>();

  private readonly catalog: ConfigBackend;
  private readonly onActiveChange?: PerspectiveDataProviderControllerOptions['onActiveChange'];
  private readonly onTelemetry?: (t: BookTelemetry) => void;
  private activeProviderId: string | null = null;
  private desiredProviderId: string | null = null;
  private provider: StompPerspectiveProvider | null = null;
  private detachProvider: (() => void) | null = null;
  private ctx: ExtLikeContext | null = null;
  private unregState: (() => void) | null = null;
  private activateChain: Promise<void> = Promise.resolve();
  private activateEpoch = 0;
  /** Survives provider destroy/rebind so calculated columns stay attached. */
  private expressionsByProvider = new Map<string, Record<string, string>>();
  private exprMetaByProvider = new Map<string, Record<string, ExpressionColumnMeta>>();

  constructor(opts?: PerspectiveDataProviderControllerOptions) {
    this.catalog = opts?.catalog ?? createDefaultConfigBackend();
    this.onActiveChange = opts?.onActiveChange;
    this.onTelemetry = opts?.onTelemetry;
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
        void this.setActiveProvider(id, { fromState: true });
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
      onTelemetry: this.onTelemetry,
    };
    const provider = new StompPerspectiveProvider(cfg);
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
