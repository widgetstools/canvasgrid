import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type {
  VelocityGridOptions,
  GridState,
  GridLayoutsBundle,
} from '@wellsfargo-starui/velocity-grid';
import {
  LocalStore,
  storageRemoveSync,
  type IStorage,
} from '@wellsfargo-starui/velocity-grid-data/storage';
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
     * Shared KV transport for the default ConfigSession (and helpers).
     * Pass the same instance to LocalStorageConfigBackend / PersistedAppDataStore.
     */
    storage?: IStorage;
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

/**
 * Some ConfigSessions (the built-in `LocalStorageConfigSession`, or any
 * custom implementation backed by something already in memory) can also
 * answer restore/has/clear synchronously. That surface is NOT part of the
 * `ConfigSession` interface — checked structurally (`typeof x.foo ===
 * 'function'`) rather than `instanceof LocalStorageConfigSession`, so any
 * conforming session gets the sync fast path, not only that one built-in
 * class (D-F4). All three members are optional, so every `ConfigSession`
 * value already satisfies this type with no cast.
 */
type MaybeSyncConfigSession = ConfigSession & {
  loadWorkspaceSync?(): VelocityGridExtConfig | null;
  hasWorkspaceSync?(): boolean;
  clearWorkspaceSync?(): void;
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
  private configSession: MaybeSyncConfigSession | null = null;
  /** Shared transport for default ConfigSession / clear helpers. */
  private readonly storage: IStorage;
  /** The chrome root the theme class was mirrored onto — kept so `destroy()`
   *  can remove it again (D-F9). */
  private readonly container: HTMLElement;
  /** Theme class mirrored from `options.theme` onto `container`; `null` when
   *  no string theme was passed. */
  private themeClass: string | null = null;
  /** `restorePersistedConfig()` warns at most once per instance when the
   *  active ConfigSession has no sync capability (D-F4). */
  private warnedSyncRestoreUnsupported = false;
  /** Same warn-once pattern for `hasPersistedConfig()` / `clearPersistedConfig()`
   *  on a ConfigSession without the matching sync capability — a silent
   *  `false` / no-op is a footgun (a host could believe `clearPersistedConfig()`
   *  actually cleared something). */
  private warnedSyncHasUnsupported = false;
  private warnedSyncClearUnsupported = false;

  constructor(container: HTMLElement, options: VelocityGridExtOptions<TRow> = {} as any) {
    const { ext, ...gridOptions } = options;
    this.container = container;
    this.shell = new ShellLayout(container);
    // Mirror a string theme class onto the shell root so the kernel's
    // `--vg-*` theme tokens (defined on the grid's own `.vg-theme-*` element)
    // cascade to VelocityGridExt's chrome (title bar, settings drawer) — otherwise
    // the chrome, a sibling of the grid, would fall back to its neutral dark
    // defaults instead of matching the active theme. Removed again in
    // destroy() (D-F9) so a re-mounted/replaced instance doesn't inherit a
    // stale theme class from a previous one. Only added — and only
    // remembered for removal — when the container doesn't already carry the
    // class: a host that pre-applied `theme:`'s class itself owns it, and
    // destroy() must not strip a class it never added.
    if (typeof gridOptions.theme === 'string' && !container.classList.contains(gridOptions.theme)) {
      this.themeClass = gridOptions.theme;
      container.classList.add(gridOptions.theme);
    }
    this._grid = new VelocityGrid<TRow>(this.shell.gridMount, gridOptions as VelocityGridOptions<TRow>);

    // Everything below reaches for `this._grid` (directly or via
    // ProfilesController/context/extensions). If any of it throws — a
    // consumer extension's `factory()`, a malformed profiles store, etc. —
    // the kernel Worker the grid above just spun up would otherwise leak
    // (D-F1): the constructor never finishes, so the caller has no `.grid`
    // to call `destroy()` on. Guarantee the grid is released and rethrow.
    try {
      const gridId = typeof gridOptions.gridId === 'string' && gridOptions.gridId
        ? gridOptions.gridId
        : 'default';
      this.storage = ext?.storage ?? new LocalStore();
      const store = ext?.profiles?.store
        ?? new LocalStorageConfigSession(gridId, { storage: this.storage });
      this.configSession = isConfigSession(store) ? store : null;
      if (gridOptions.persistState && this.configSession) {
        // D-F6: the kernel's own `persistState` autosave and the Ext
        // ConfigSession both write a document for this gridId — see
        // docs/velocity-grid-architecture.md §4.4 ("do not enable both
        // writers for the same grid"). Whichever settles last wins,
        // silently discarding the other's write.
        console.warn(
          `[velocity-grid-ext] gridId "${gridId}" has both kernel \`persistState\` and an Ext `
          + 'ConfigSession active — this double-writes the grid\'s persisted state. Drop '
          + '`persistState` from VelocityGridOptions and let the ConfigSession own persistence.',
        );
      }
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
        // Isolated per extension (mirrors ExtensionRegistry.initAll/disposeAll)
        // — one broken settings module or toolbar item must not stop the
        // rest from mounting, nor leave the shell half-built.
        try {
          if (isSettingsModule(e)) this.shell.mountSettingsModule(e, this.ctx);
          else if (isToolbarItem(e)) this.shell.mountToolbarItem(e, this.ctx);
        } catch (err) {
          console.warn(`[velocity-grid-ext] extension "${e.id}" threw while mounting into the shell`, err);
        }
      }

      // Seed / restore the active profile so the switcher is never empty and
      // `initialId` actually loads. Fire-and-forget — chrome re-syncs via
      // onListChange when the store settles.
      //
      // Final review — `bootstrap()` can now reject (configSession's D-F12
      // forward-compat guard refuses to persist over a newer build's
      // document, and `syncActivePointer()`'s write is part of the same
      // bootstrap flow). That guard fires on ordinary startup whenever the
      // stored config was written by a newer build — not a rare event —
      // so this fire-and-forget needs its own catch rather than relying on
      // an unhandled-rejection floor.
      this.profiles.bootstrap().catch((err) => {
        console.error('[velocity-grid-ext] profile bootstrap failed', err);
      });
    } catch (e) {
      try { this._grid.destroy(); } catch { /* best-effort — already broken */ }
      throw e;
    }
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
      // `persistConfig()` is synchronous (`void`-returning) by design, so a
      // rejected save can only be surfaced here, not propagated to the
      // caller. configSession's D-F12 forward-compat guard refuses to
      // persist over a newer build's document and (final review) now
      // rejects rather than silently no-opping.
      this.configSession.saveWorkspace(cfg).catch((err) => {
        console.error('[velocity-grid-ext] persistConfig failed', err);
      });
      return;
    }
    saveConfigToLocalStorage(gid, cfg, this.storage);
  }

  /** Restore a blob previously written by {@link persistConfig} / the
   *  title-bar save disk. Returns `true` when a config was applied.
   *
   *  Only works synchronously for a sync-capable ConfigSession (the default
   *  `LocalStorageConfigSession`, or any custom session exposing the same
   *  `loadWorkspaceSync`). A ConfigSession without that capability (REST /
   *  IndexedDB-backed, etc.) can't answer synchronously — this degrades to
   *  `false` (logging once) rather than silently reading an unrelated
   *  localStorage key the session never wrote (D-F4). Use
   *  {@link restorePersistedConfigAsync} for those sessions. */
  restorePersistedConfig(): boolean {
    const gid = this._grid.getGridOption('gridId');
    if (typeof gid !== 'string' || !gid) return false;
    if (this.configSession) {
      if (typeof this.configSession.loadWorkspaceSync === 'function') {
        const raw = this.configSession.loadWorkspaceSync();
        if (!raw || typeof raw !== 'object') return false;
        this.loadConfig(raw as VelocityGridExtConfig);
        return true;
      }
      if (!this.warnedSyncRestoreUnsupported) {
        this.warnedSyncRestoreUnsupported = true;
        console.warn(
          '[velocity-grid-ext] restorePersistedConfig() requires a sync-capable ConfigSession '
          + '(loadWorkspaceSync) — this session is async-only. Use restorePersistedConfigAsync() instead.',
        );
      }
      return false;
    }
    const raw = loadConfigFromLocalStorage(gid, this.storage);
    if (!raw || typeof raw !== 'object') return false;
    this.loadConfig(raw as VelocityGridExtConfig);
    return true;
  }

  /** Async counterpart of {@link restorePersistedConfig} — works for every
   *  ConfigSession regardless of sync capability by awaiting
   *  `session.loadWorkspace()`. Falls back to
   *  {@link restorePersistedConfig}'s (sync) localStorage path when no
   *  ConfigSession is active. */
  async restorePersistedConfigAsync(): Promise<boolean> {
    const gid = this._grid.getGridOption('gridId');
    if (typeof gid !== 'string' || !gid) return false;
    if (this.configSession) {
      const raw = await this.configSession.loadWorkspace();
      if (!raw || typeof raw !== 'object') return false;
      this.loadConfig(raw as VelocityGridExtConfig);
      return true;
    }
    return this.restorePersistedConfig();
  }

  /** Whether a saved instance / workspace exists for this grid's `gridId`.
   *  Capability-checked against the active session (D-F4) rather than
   *  falling through to the unrelated raw-localStorage helper whenever a
   *  non-default ConfigSession is active. An async-only ConfigSession has
   *  no sync answer available and conservatively reports `false`. */
  hasPersistedConfig(): boolean {
    const gid = this._grid.getGridOption('gridId');
    if (typeof gid !== 'string' || !gid) return false;
    if (this.configSession) {
      if (typeof this.configSession.hasWorkspaceSync === 'function') {
        return this.configSession.hasWorkspaceSync();
      }
      if (!this.warnedSyncHasUnsupported) {
        this.warnedSyncHasUnsupported = true;
        console.warn(
          '[velocity-grid-ext] hasPersistedConfig() requires a sync-capable ConfigSession '
          + '(hasWorkspaceSync) — this session is async-only, so `false` is a conservative '
          + 'guess, not a real answer. Use `await getConfigSession()?.hasWorkspace()` instead.',
        );
      }
      return false;
    }
    return hasConfigInLocalStorage(gid, this.storage);
  }

  /** Delete the persisted instance bundle for this grid's `gridId`.
   *  Capability-checked against the active session (D-F4) — see
   *  {@link hasPersistedConfig}. */
  clearPersistedConfig(): void {
    const gid = this._grid.getGridOption('gridId');
    if (typeof gid !== 'string' || !gid) return;
    if (this.configSession) {
      if (typeof this.configSession.clearWorkspaceSync === 'function') {
        this.configSession.clearWorkspaceSync();
        try { storageRemoveSync(this.storage, `velocity-grid:config:${gid}`); } catch { /* ignore */ }
      } else if (!this.warnedSyncClearUnsupported) {
        this.warnedSyncClearUnsupported = true;
        console.warn(
          '[velocity-grid-ext] clearPersistedConfig() requires a sync-capable ConfigSession '
          + '(clearWorkspaceSync) — this session is async-only, so nothing was cleared. Use '
          + '`await getConfigSession()?.clearWorkspace()` instead.',
        );
      }
      return;
    }
    clearConfigFromLocalStorage(gid, this.storage);
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

  /** Profiles first (D-F2) → registry → shell → grid, in that order — but
   *  the kernel Worker MUST be released even if registry or shell teardown
   *  throws, so grid.destroy() runs in an outer `finally` (and
   *  shell.destroy() in an inner one). Cancelling the profiles controller
   *  first ensures a bootstrap/switchTo/save continuation still in flight
   *  bails out before it can reach the grid being torn down below. */
  destroy(): void {
    this.profiles.dispose();
    // Theme class mirrored onto `container` in the ctor (D-F9) — remove it
    // so a container reused for a fresh instance doesn't inherit a stale
    // theme alongside the new one.
    if (this.themeClass) this.container.classList.remove(this.themeClass);
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
