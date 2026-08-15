import {
  ProviderClientAdapter,
  bindProviderToGrid,
  createDefaultConfigBackend,
  registerDefaultTransports,
  resolveProviderConfig,
  type ConfigBackend,
  type DataProviderConfig,
  type ProviderClientOptions,
} from '@wellsfargo-starui/velocity-grid-data';
import type { VelocityGridExtContext } from '../extension/types';

export type DataProviderStateSlice = {
  activeProviderId: string | null;
};

/** `{{name.key}}` lookup — pass `store.lookup` from an AppDataStore. */
export type DataProviderAppDataLookup = (providerName: string, key: string) => unknown;

export type DataProviderControllerOptions = {
  catalog?: ConfigBackend;
  /** Resolves `{{name.key}}` tokens in provider configs at bind time. */
  appData?: DataProviderAppDataLookup | { lookup: DataProviderAppDataLookup };
  workerUrl?: URL | string;
  inProcess?: boolean;
  /** Fired when the active provider changes (after bind/unbind). */
  onActiveChange?: (providerId: string | null, provider: ProviderClientAdapter | null) => void;
};

type BindableGrid = {
  setRowData: (rows: Record<string, unknown>[]) => void;
  applyTransaction?: (tx: { update?: Record<string, unknown>[] }) => void;
  applyTransactionAsync?: (tx: { update?: Record<string, unknown>[] }) => void;
  updateGridOptions?: (partial: { columnDefs?: unknown[] }) => void;
  setColumnDefs?: (defs: unknown[]) => void;
  whenReady?: () => Promise<void>;
  addEventListener?: (type: string, handler: (e: unknown) => void) => () => void;
};

/**
 * Owns the live ProviderClientAdapter for an Ext grid: catalog lookup,
 * hub attach/bind, and StateModule persistence of activeProviderId.
 *
 * Activation is serialized + epoch-gated so profile bootstrap / reapply
 * cannot interleave STOMP sessions. Hub providers are CSRM-only; SSRM
 * hosts use `@wellsfargo-starui/velocity-grid-perspective`.
 */
export class DataProviderController {
  private readonly catalog: ConfigBackend;
  private readonly appDataLookup: DataProviderAppDataLookup | null;
  private readonly clientOpts: ProviderClientOptions;
  private readonly onActiveChange?: DataProviderControllerOptions['onActiveChange'];
  /** Last committed selection (what the UI / profile snapshot report). */
  private activeProviderId: string | null = null;
  /** In-flight or committed target — used to coalesce duplicate restores. */
  private desiredProviderId: string | null = null;
  private provider: ProviderClientAdapter | null = null;
  private detachBind: (() => void) | null = null;
  private ctx: VelocityGridExtContext | null = null;
  private unregState: (() => void) | null = null;
  private activateChain: Promise<void> = Promise.resolve();
  /** Bumps on every activate so superseded async work exits cleanly. */
  private activateEpoch = 0;
  /** Captured in attach() so restore never misses a already-fired gridReady. */
  private gridReadyWait: Promise<void> | null = null;
  /** Handle for the missed-event poll in captureGridReady; cleared by detach(). */
  private gridReadyPollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts?: DataProviderControllerOptions) {
    registerDefaultTransports();
    this.catalog = opts?.catalog ?? createDefaultConfigBackend();
    const ad = opts?.appData;
    this.appDataLookup = !ad
      ? null
      : typeof ad === 'function'
        ? ad
        : ad.lookup;
    this.clientOpts = {
      workerUrl: opts?.workerUrl,
      inProcess: opts?.inProcess,
    };
    this.onActiveChange = opts?.onActiveChange;
  }

  getHubOpts(): ProviderClientOptions {
    return { ...this.clientOpts };
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
    this.gridReadyWait = this.captureGridReady(ctx.grid as unknown as BindableGrid);
    this.unregState?.();
    this.unregState = ctx.registerStateModule({
      id: 'data-provider',
      version: 1,
      // Always emit the pointer (including null) so a cleared selection
      // overwrites a previously saved id instead of leaving an orphan.
      get: () =>
        ({ activeProviderId: this.activeProviderId }) satisfies DataProviderStateSlice,
      set: (data) => {
        const slice = data as DataProviderStateSlice | null | undefined;
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
    this.gridReadyWait = null;
    if (this.gridReadyPollTimer !== null) {
      clearTimeout(this.gridReadyPollTimer);
      this.gridReadyPollTimer = null;
    }
    this.ctx = null;
  }

  /**
   * Select a catalog provider by id, start hub client, bind to the grid.
   * Pass null to unbind. Re-applying the same id with `{ force: true }` restarts.
   */
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
    // Coalesce duplicate profile restores / Apply of the live provider.
    if (
      !opts?.force
      && providerId != null
      && providerId === this.desiredProviderId
      && providerId === this.activeProviderId
      && this.provider
    ) {
      await this.provider.refresh();
      this.onActiveChange?.(this.activeProviderId, this.provider);
      return;
    }

    // Another fromState restore already targeting this id — let it finish.
    if (
      opts?.fromState
      && !opts.force
      && providerId != null
      && providerId === this.desiredProviderId
      && this.provider == null
    ) {
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

    const cfg = await this.catalog.get(providerId);
    if (epoch !== this.activateEpoch) return;
    if (!cfg) {
      console.warn(`[velocity-grid-ext] data provider "${providerId}" not found in catalog`);
      this.activeProviderId = null;
      this.desiredProviderId = null;
      this.onActiveChange?.(null, null);
      if (!opts?.fromState) await this.persistActiveSelection();
      return;
    }

    await this.bindConfig(cfg, epoch);
    if (epoch !== this.activateEpoch) return;

    this.onActiveChange?.(this.activeProviderId, this.provider);
    if (!opts?.fromState) await this.persistActiveSelection();
  }

  private async persistActiveSelection(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.profiles.save();
    } catch (err) {
      console.warn('[velocity-grid-ext] failed to persist active data provider', err);
    }
  }

  async saveDefinition(cfg: DataProviderConfig): Promise<DataProviderConfig> {
    const saved = await this.catalog.save(cfg);
    this.ctx?.profiles.markDirty();
    if (saved.providerId === this.activeProviderId) {
      await this.setActiveProvider(saved.providerId, { force: true, fromState: true });
    }
    return saved;
  }

  /** Listen from attach-time so restore cannot miss a fired `gridReady`. */
  private captureGridReady(grid: BindableGrid): Promise<void> {
    if (typeof grid.whenReady === 'function') {
      return grid.whenReady();
    }
    // No readiness API (tests / thin hosts) — bind immediately.
    if (typeof grid.addEventListener !== 'function') {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (this.gridReadyPollTimer !== null) {
          clearTimeout(this.gridReadyPollTimer);
          this.gridReadyPollTimer = null;
        }
        resolve();
      };
      const unsub = grid.addEventListener('gridReady', () => {
        unsub?.();
        finish();
      });
      // Missed-event fallback (attach after ready): resolve after deadline.
      const deadline = Date.now() + 15_000;
      const poll = (): void => {
        if (settled) return;
        if (Date.now() >= deadline) {
          unsub?.();
          finish();
          return;
        }
        // C-m5: stored on the instance (not a local closure var) so
        // detach() can genuinely cancel the poll mid-wait.
        this.gridReadyPollTimer = setTimeout(poll, 16);
      };
      poll();
    });
  }

  private async bindConfig(cfg: DataProviderConfig, epoch: number): Promise<void> {
    if (!this.ctx) return;

    if (cfg.rowModel === 'serverSide') {
      // Refuse silent CSRM fallback — that made Apply look like SSRM while
      // binding a full in-memory hub path (memory / tick semantics diverge).
      throw new Error(
        `Provider "${cfg.providerId}" is rowModel=serverSide; the hub binder is clientSide only. `
          + 'Use the Perspective / StompPerspectiveProvider path for SSRM, or change the catalog entry to clientSide.',
      );
    }

    // Don't bind before the grid can accept setRowData (missed first paint).
    if (this.gridReadyWait) await this.gridReadyWait;
    if (epoch !== this.activateEpoch) return;

    const resolved = this.appDataLookup
      ? resolveProviderConfig(cfg, this.appDataLookup)
      : cfg;
    const provider = new ProviderClientAdapter(resolved, this.clientOpts);
    if (epoch !== this.activateEpoch) {
      provider.destroy();
      return;
    }
    this.provider = provider;

    const grid = this.ctx.grid as unknown as BindableGrid;
    const bindable = {
      setRowData: (rows: Record<string, unknown>[]) => grid.setRowData(rows),
      applyTransaction: (tx: { update?: Record<string, unknown>[] }) => {
        grid.applyTransaction?.(tx);
      },
      applyTransactionAsync: (tx: { update?: Record<string, unknown>[] }) => {
        void grid.applyTransactionAsync?.(tx);
      },
      setColumnDefs: (defs: unknown[]) => {
        grid.updateGridOptions?.({ columnDefs: defs });
      },
    };

    this.detachBind = bindProviderToGrid(provider, bindable);

    await provider.start();
    if (epoch !== this.activateEpoch) return;

    await this.waitForProviderReady(provider, epoch);
    if (epoch !== this.activateEpoch) return;

    await provider.refresh();
    if (epoch !== this.activateEpoch) return;

    grid.setRowData(provider.getData() as Record<string, unknown>[]);
  }

  private waitForProviderReady(
    provider: ProviderClientAdapter,
    epoch: number,
  ): Promise<void> {
    const terminal = (s: string): boolean =>
      s === 'ready' || s === 'error' || s === 'disconnected';
    if (terminal(provider.getStatus())) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve();
      };
      const unsub = provider.onStatus((s) => {
        if (terminal(s) || epoch !== this.activateEpoch) finish();
      });
      const timer = setTimeout(finish, 60_000);
      // Status may have flipped between getStatus() and subscribe.
      if (terminal(provider.getStatus()) || epoch !== this.activateEpoch) finish();
    });
  }

  private async stopCurrent(): Promise<void> {
    this.detachBind?.();
    this.detachBind = null;
    if (this.provider) {
      // C-C2, C-M1: on switch, only destroy (which sends detach via the always-detach path).
      // Explicit stop() would kill the shared transport for all other tabs. Controller
      // switches never call stop() — that's reserved for explicit Diagnostics Stop.
      this.provider.destroy();
      this.provider = null;
    }
  }
}
