import type { AppDataLookup } from '@wellsfargo-starui/vg-new-appdata';
import {
  LocalStorageConfigBackend,
  type ConfigBackend,
  type DataProviderConfig,
} from '../catalog/ConfigBackend';
import { bindProviderToGrid, type BindableGrid, type BindHandle } from './bind';
import { resolveProviderConfig } from './resolveConfig';

export type DataProviderControllerOptions = {
  catalog?: ConfigBackend;
  appData?: AppDataLookup | { lookup: AppDataLookup };
  onActiveChange?: (providerId: string | null) => void;
};

/**
 * Owns catalog lookup + bind lifecycle for one Ext grid.
 * Activation is epoch-gated so overlapping applies don't interleave.
 */
export class DataProviderController {
  private readonly catalog: ConfigBackend;
  private readonly appDataLookup: AppDataLookup | null;
  private readonly onActiveChange?: (providerId: string | null) => void;
  private activeProviderId: string | null = null;
  private bind: BindHandle | null = null;
  private grid: BindableGrid | null = null;
  private activateEpoch = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: DataProviderControllerOptions = {}) {
    this.catalog = opts.catalog ?? new LocalStorageConfigBackend();
    const ad = opts.appData;
    this.appDataLookup = !ad
      ? null
      : typeof ad === 'function'
        ? ad
        : ad.lookup.bind(ad);
    this.onActiveChange = opts.onActiveChange;
  }

  getCatalog(): ConfigBackend {
    return this.catalog;
  }

  getActiveProviderId(): string | null {
    return this.activeProviderId;
  }

  attachGrid(grid: BindableGrid): void {
    this.grid = grid;
  }

  setActiveProvider(id: string | null): Promise<void> {
    const p = this.chain.then(() => this.activateInner(id));
    this.chain = p.then(() => undefined, () => undefined);
    return p;
  }

  private async activateInner(id: string | null): Promise<void> {
    const epoch = ++this.activateEpoch;
    this.bind?.detach();
    this.bind = null;

    if (!id || !this.grid) {
      this.activeProviderId = null;
      this.onActiveChange?.(null);
      return;
    }

    const raw = await this.catalog.get(id);
    if (epoch !== this.activateEpoch) return;
    if (!raw) {
      throw new Error(`[vg-new-data] provider '${id}' not found in catalog`);
    }

    const cfg = resolveProviderConfig(raw, this.appDataLookup);
    if (epoch !== this.activateEpoch) return;

    this.bind = bindProviderToGrid(this.grid, cfg);
    this.activeProviderId = id;
    this.onActiveChange?.(id);
  }

  async ensureSeedCatalog(seeds: DataProviderConfig[]): Promise<void> {
    const existing = await this.catalog.list();
    const ids = new Set(existing.map((c) => c.id));
    for (const s of seeds) {
      if (!ids.has(s.id)) await this.catalog.save(s);
    }
  }

  destroy(): void {
    this.activateEpoch++;
    this.bind?.detach();
    this.bind = null;
    this.grid = null;
    this.activeProviderId = null;
  }
}
