import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type {
  VelocityGridOptions,
  GridState,
  GridLayoutsBundle,
} from '@wellsfargo-starui/velocity-grid';
import { ExtensionRegistry, type ExtensionSpec } from './extension/registry';
import { ShellLayout } from './shell/shell';
import { createExtContext } from './extension/context';
import { ProfilesController } from './profiles/controller';
import {
  LocalStorageConfigSession,
  isConfigSession,
  type ConfigSession,
} from './profiles/configSession';
import { isSettingsModule, isToolbarItem, type VelocityGridExtContext, type ProfileStore } from './extension/types';
import { buildDefaultBundle } from './defaultBundle';
import {
  clearConfigFromLocalStorage,
  hasConfigInLocalStorage,
  loadConfigFromLocalStorage,
  saveConfigToLocalStorage,
} from './configStorage';

export interface VelocityGridExtOptions<TRow = any> extends VelocityGridOptions<TRow> {
  ext?: {
    extensions?: ExtensionSpec[];
    /**
     * Profile / ConfigSession store. Prefer a {@link ConfigSession}
     * (default: LocalStorageConfigSession keyed by `gridId`) so layouts
     * save and profile save share one instance bundle.
     */
    profiles?: { store?: ProfileStore | ConfigSession; initialId?: string };
    modules?: Record<string, unknown>;
  };
}

/**
 * Serializable workspace blob: live view state + the layouts registry.
 * Same shape kernel `persistState` writes under `velocity-grid:state:<gridId>`.
 *
 * Distinct from `grid.getConfig()` / `grid.setConfig()`, which round-trip
 * runtime `VelocityGridOptions` (callbacks, columnDefs, etc.) and are not
 * pure JSON.
 */
export type VelocityGridExtConfig = GridState & {
  layouts?: GridLayoutsBundle;
};

/** Batteries-included wrapper: owns a VelocityGrid + an ExtensionRegistry, wires
 *  every extension to the kernel through a shared context, and lays the
 *  grid + tooling out via ShellLayout. */
export class VelocityGridExt<TRow = any> {
  private _grid: VelocityGrid<TRow>;
  private shell: ShellLayout;
  private registry = new ExtensionRegistry();
  private profiles: ProfilesController;
  private ctx: VelocityGridExtContext;
  /** Set when the profile store is a ConfigSession (default adapter). */
  private configSession: ConfigSession | null = null;

  constructor(container: HTMLElement, options: VelocityGridExtOptions<TRow> = {} as any) {
    const { ext, ...gridOptions } = options;
    this.shell = new ShellLayout(container);
    // Mirror a string theme class onto the shell root so the kernel's
    // `--vg-*` theme tokens (defined on the grid's own `.vg-theme-*` element)
    // cascade to VelocityGridExt's chrome (title bar, settings drawer) — otherwise
    // the chrome, a sibling of the grid, would fall back to its neutral dark
    // defaults instead of matching the active theme.
    if (typeof gridOptions.theme === 'string') {
      container.classList.add(gridOptions.theme);
    }
    this._grid = new VelocityGrid<TRow>(this.shell.gridMount, gridOptions as VelocityGridOptions<TRow>);

    const gridId = typeof gridOptions.gridId === 'string' && gridOptions.gridId
      ? gridOptions.gridId
      : 'default';
    const store = ext?.profiles?.store
      ?? new LocalStorageConfigSession(gridId);
    this.configSession = isConfigSession(store) ? store : null;
    this.profiles = new ProfilesController(this._grid, store, {
      initialId: ext?.profiles?.initialId ?? 'default',
    });
    this.ctx = createExtContext(this._grid, this.profiles);

    // Default bundle is registered by subclass hook / Task 9 wiring first,
    // then consumer specs layer on top (add / remove / replace).
    this.registerDefaults();
    this.registry.applySpecs(ext?.extensions);

    this.registry.initAll(this.ctx);
    for (const e of this.registry.all()) {
      if (isSettingsModule(e)) this.shell.mountSettingsModule(e, this.ctx);
      else if (isToolbarItem(e)) this.shell.mountToolbarItem(e, this.ctx);
    }

    // Seed / restore the active profile so the switcher is never empty and
    // `initialId` actually loads. Fire-and-forget — chrome re-syncs via
    // onListChange when the store settles.
    void this.profiles.bootstrap();
  }

  /** Registers the built-in bundle (settings launcher, save, grid options)
   *  before consumer specs layer on top. Runs after `this.ctx`/`this.shell`
   *  are assigned in the constructor, so both are safe to reference here. */
  protected registerDefaults(): void {
    for (const e of buildDefaultBundle()) this.registry.register(e);
    // Wire the settings launcher's event to the shell.
    this.ctx.events.on('open-settings', (e) =>
      this.shell.openSettings((e as { id?: string }).id));
  }

  get grid(): VelocityGrid<TRow> { return this._grid; }

  /** Shared extension context (events, profiles, modal) for host wiring. */
  get context(): VelocityGridExtContext { return this.ctx; }

  setRowData(rows: TRow[]): void { this._grid.setRowData(rows); }
  getState(): GridState { return this._grid.getState(); }
  // Kernel `setState` is typed to take a full `GridState`, but at runtime
  // every field is optional — each step is a no-op when the snapshot omits
  // the corresponding slice (see velocityGrid.ts `setState` docblock, and the same
  // cast in extension/context.ts). Cast localized to this composition
  // boundary; `VelocityGridExt.setState`'s own signature stays the accurate
  // `Partial<GridState>` contract for callers.
  setState(state: Partial<GridState>): void { this._grid.setState(state as GridState); }

  /**
   * Capture a JSON-serialisable config: current view state + all named
   * layouts (active id, per-layout view, shared grid baseline). Persist
   * the result anywhere (localStorage, REST, file) and restore with
   * {@link loadConfig}.
   */
  getConfig(): VelocityGridExtConfig {
    return {
      ...this._grid.getState(),
      layouts: this._grid.exportLayouts(),
    };
  }

  /**
   * Restore a blob from {@link getConfig}: reseeds the layouts registry
   * (replace) then applies the saved view state. Safe to call with an
   * older blob that omits `layouts` (view-only restore).
   */
  loadConfig(config: VelocityGridExtConfig): void {
    const { layouts, ...viewState } = config;
    if (layouts) {
      // Reseed only — setState below is the authoritative view (incl. grid-tier
      // data-provider). Applying the active layout here would emit
      // layoutChanged('import') and Ext auto-persist would wipe activeProviderId
      // before modules restore.
      this._grid.importLayouts(layouts, { mode: 'replace', overwrite: true, apply: false });
    }
    // Exhaustive so omitted slices clear — matches kernel persist restore.
    this._grid.setState(viewState as GridState, { exhaustive: true });
  }

  /** Persist {@link getConfig} through the ConfigSession instance bundle
   *  (`velocity-grid:instance:<gridId>`). Falls back to the same helper
   *  path when a custom non-session ProfileStore is injected. */
  persistConfig(): void {
    const gid = this._grid.getGridOption('gridId');
    if (typeof gid !== 'string' || !gid) {
      console.warn('[velocity-grid-ext] persistConfig requires options.gridId');
      return;
    }
    const cfg = this.getConfig();
    if (this.configSession) {
      void this.configSession.saveWorkspace(cfg);
      return;
    }
    saveConfigToLocalStorage(gid, cfg);
  }

  /** Restore a blob previously written by {@link persistConfig} / the
   *  title-bar save disk. Returns `true` when a config was applied. */
  restorePersistedConfig(): boolean {
    const gid = this._grid.getGridOption('gridId');
    if (typeof gid !== 'string' || !gid) return false;
    if (this.configSession) {
      // sync path for LocalStorageConfigSession
      if (this.configSession instanceof LocalStorageConfigSession) {
        const raw = this.configSession.loadWorkspaceSync();
        if (!raw || typeof raw !== 'object') return false;
        this.loadConfig(raw as VelocityGridExtConfig);
        return true;
      }
    }
    const raw = loadConfigFromLocalStorage(gid);
    if (!raw || typeof raw !== 'object') return false;
    this.loadConfig(raw as VelocityGridExtConfig);
    return true;
  }

  /** Whether a saved instance / workspace exists for this grid's `gridId`. */
  hasPersistedConfig(): boolean {
    const gid = this._grid.getGridOption('gridId');
    if (typeof gid !== 'string' || !gid) return false;
    if (this.configSession instanceof LocalStorageConfigSession) {
      return this.configSession.hasWorkspaceSync();
    }
    return hasConfigInLocalStorage(gid);
  }

  /** Delete the persisted instance bundle for this grid's `gridId`. */
  clearPersistedConfig(): void {
    const gid = this._grid.getGridOption('gridId');
    if (typeof gid !== 'string' || !gid) return;
    if (this.configSession instanceof LocalStorageConfigSession) {
      this.configSession.clearWorkspaceSync();
      try { localStorage.removeItem(`velocity-grid:config:${gid}`); } catch { /* ignore */ }
      return;
    }
    clearConfigFromLocalStorage(gid);
  }

  /** Active ConfigSession when the profile store implements it. */
  getConfigSession(): ConfigSession | null {
    return this.configSession;
  }

  on(type: string, fn: (e: unknown) => void): () => void {
    return this._grid.addEventListener(type as any, fn as any);
  }

  openSettings(id?: string): void { this.shell.openSettings(id); }
  closeSettings(): void { this.shell.closeSettings(); }

  /**
   * Re-apply the active profile after late-wired engines (`wireEdit` /
   * `wireCalc` / `wireRules`) register their state modules. The ctor fires
   * `profiles.bootstrap()` before hosts typically call those wires, so the
   * first `setState` can miss `editSettings` / `calc` / `rules` slices.
   * Await this after wiring so those modules restore from the saved snapshot.
   */
  async reapplyActiveProfile(): Promise<void> {
    await this.profiles.bootstrap();
    await this.profiles.switchTo(this.profiles.activeId());
  }

  /** Registry → shell → grid, in that order — but the kernel Worker MUST be
   *  released even if registry or shell teardown throws, so grid.destroy()
   *  runs in an outer `finally` (and shell.destroy() in an inner one). */
  destroy(): void {
    try {
      this.registry.disposeAll();
    } finally {
      try {
        this.shell.destroy();
      } finally {
        this._grid.destroy();
      }
    }
  }
}
