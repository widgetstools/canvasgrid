import {
  ProviderClientAdapter,
  bindProviderToGrid,
  bindProviderToSsrmGrid,
  createDefaultConfigBackend,
  registerDefaultTransports,
  type ConfigBackend,
  type DataProviderConfig,
  type ProviderClientOptions,
} from '@wellsfargo-starui/velocity-grid-data';
import type { VelocityGridExtContext } from '../extension/types';

export type DataProviderStateSlice = {
  activeProviderId: string | null;
};

export type DataProviderControllerOptions = {
  catalog?: ConfigBackend;
  workerUrl?: URL | string;
  inProcess?: boolean;
  /** Fired when the active provider changes (after bind/unbind). */
  onActiveChange?: (providerId: string | null, provider: ProviderClientAdapter | null) => void;
};

/**
 * Owns the live ProviderClientAdapter for an Ext grid: catalog lookup,
 * hub attach/bind, and StateModule persistence of activeProviderId.
 */
export class DataProviderController {
  private readonly catalog: ConfigBackend;
  private readonly clientOpts: ProviderClientOptions;
  private readonly onActiveChange?: DataProviderControllerOptions['onActiveChange'];
  private activeProviderId: string | null = null;
  private provider: ProviderClientAdapter | null = null;
  private detachBind: (() => void) | null = null;
  private ctx: VelocityGridExtContext | null = null;
  private unregState: (() => void) | null = null;

  constructor(opts?: DataProviderControllerOptions) {
    registerDefaultTransports();
    this.catalog = opts?.catalog ?? createDefaultConfigBackend();
    this.clientOpts = {
      workerUrl: opts?.workerUrl,
      inProcess: opts?.inProcess,
    };
    this.onActiveChange = opts?.onActiveChange;
  }

  getCatalog(): ConfigBackend {
    return this.catalog;
  }

  getActiveProviderId(): string | null {
    return this.activeProviderId;
  }

  getProvider(): ProviderClientAdapter | null {
    return this.provider;
  }

  /** Wire StateModule + keep ctx for rebind. Call from SettingsModule.init. */
  attach(ctx: VelocityGridExtContext): void {
    this.ctx = ctx;
    this.unregState?.();
    this.unregState = ctx.registerStateModule({
      id: 'data-provider',
      version: 1,
      get: () => {
        if (this.activeProviderId == null) return undefined;
        return { activeProviderId: this.activeProviderId } satisfies DataProviderStateSlice;
      },
      set: (data) => {
        const slice = data as DataProviderStateSlice | null;
        const id = slice?.activeProviderId ?? null;
        void this.setActiveProvider(id, { fromState: true });
      },
    });
  }

  detach(): void {
    void this.stopCurrent();
    this.unregState?.();
    this.unregState = null;
    this.ctx = null;
  }

  /**
   * Select a catalog provider by id, start hub client, bind to the grid.
   * Pass null to unbind. Re-applying the same id forces a restart.
   */
  async setActiveProvider(
    providerId: string | null,
    opts?: { fromState?: boolean; force?: boolean },
  ): Promise<void> {
    if (
      !opts?.force
      && providerId === this.activeProviderId
      && this.provider
      && providerId != null
    ) {
      // Still refresh paint — user may have clicked Apply again.
      await this.provider.refresh();
      this.onActiveChange?.(this.activeProviderId, this.provider);
      return;
    }

    await this.stopCurrent();
    this.activeProviderId = providerId;

    if (!opts?.fromState) this.ctx?.profiles.markDirty();

    if (!providerId || !this.ctx) {
      this.onActiveChange?.(null, null);
      return;
    }

    const cfg = await this.catalog.get(providerId);
    if (!cfg) {
      console.warn(`[velocity-grid-ext] data provider "${providerId}" not found in catalog`);
      this.activeProviderId = null;
      this.onActiveChange?.(null, null);
      return;
    }

    await this.bindConfig(cfg);
    this.onActiveChange?.(this.activeProviderId, this.provider);
  }

  /** Save definition to catalog; rebinds when it is the active provider. */
  async saveDefinition(cfg: DataProviderConfig): Promise<DataProviderConfig> {
    const saved = await this.catalog.save(cfg);
    this.ctx?.profiles.markDirty();
    if (saved.providerId === this.activeProviderId) {
      await this.setActiveProvider(saved.providerId, { force: true, fromState: true });
    }
    return saved;
  }

  private async bindConfig(cfg: DataProviderConfig): Promise<void> {
    if (!this.ctx) return;
    const provider = new ProviderClientAdapter(cfg, this.clientOpts);
    this.provider = provider;
    const grid = this.ctx.grid as unknown as {
      setRowData: (rows: Record<string, unknown>[]) => void;
      applyTransaction?: (tx: { update?: Record<string, unknown>[] }) => void;
      applyTransactionAsync?: (tx: { update?: Record<string, unknown>[] }) => void;
      updateGridOptions?: (partial: { columnDefs?: unknown[] }) => void;
      setServerSideDatasource?: (ds: unknown) => void;
      refreshServerSide?: (p?: { purge?: boolean }) => void;
    };

    const bindable = {
      setRowData: (rows: Record<string, unknown>[]) => grid.setRowData(rows),
      applyTransaction: grid.applyTransaction?.bind(grid),
      applyTransactionAsync: grid.applyTransactionAsync?.bind(grid),
      // columnDefs is initial-only on setGridOption — use updateGridOptions.
      setColumnDefs: (defs: unknown[]) => {
        grid.updateGridOptions?.({ columnDefs: defs });
      },
      setServerSideDatasource: grid.setServerSideDatasource?.bind(grid),
      refreshServerSide: grid.refreshServerSide?.bind(grid),
    };

    if (cfg.rowModel === 'serverSide') {
      const { detach } = bindProviderToSsrmGrid(provider, bindable, { blockSize: cfg.blockSize });
      this.detachBind = detach;
    } else {
      this.detachBind = bindProviderToGrid(provider, bindable);
    }

    await provider.start();
    // Snapshot emit is async (microtask + MessagePort); pull book explicitly.
    await provider.refresh();
    if (cfg.rowModel === 'clientSide') {
      grid.setRowData(provider.getData() as Record<string, unknown>[]);
    }
  }

  private async stopCurrent(): Promise<void> {
    this.detachBind?.();
    this.detachBind = null;
    if (this.provider) {
      try { await this.provider.stop(); } catch { /* */ }
      this.provider.destroy();
      this.provider = null;
    }
  }
}
