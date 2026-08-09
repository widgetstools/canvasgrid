/**
 * ConfigSession — thin host persistence facade for view / profile / layouts.
 *
 * Markets Config Manager (Dexie, identity, REST sync) can implement the same
 * surface later. This default adapter stores one Markets-aligned instance
 * bundle per `gridId` and implements `ProfileStore` for ProfilesController.
 *
 * See docs/starui-platform/03-config-planes.md.
 */
import type { GridState, GridLayoutsBundle } from '@wellsfargo-starui/velocity-grid';
import type { ProfileMeta, ProfileSnapshot, ProfileStore } from '../extension/types';

/** Host-level pointers shared across profiles/layouts (not full provider defs). */
export type InstanceGridLevelData = {
  activeProviderId?: string | null;
  liveProviderId?: string | null;
  historicalProviderId?: string | null;
  [k: string]: unknown;
};

/** One document per grid instance — Markets profile-set shaped. */
export type InstanceConfigBundle = {
  version: number;
  activeProfileId: string;
  profiles: ProfileSnapshot[];
  gridLevelData: InstanceGridLevelData;
  /** VelocityGrid named layouts (registry + active id + grid baseline). */
  layouts?: GridLayoutsBundle;
};

/** Workspace blob: live view + layouts (Ext getConfig / layout save disk). */
export type WorkspaceConfig = GridState & { layouts?: GridLayoutsBundle };

export const INSTANCE_BUNDLE_VERSION = 1;
export const INSTANCE_STORAGE_PREFIX = 'velocity-grid:instance:';
export const LEGACY_CONFIG_PREFIX = 'velocity-grid:config:';
export const LEGACY_PROFILES_KEY = 'velocity-grid-ext:profiles';

export function instanceStorageKey(gridId: string): string {
  return `${INSTANCE_STORAGE_PREFIX}${gridId}`;
}

/** Pull provider pointers from GridState modules into gridLevelData. */
export function extractGridLevelData(state: GridState | null | undefined): InstanceGridLevelData {
  const envelope = state?.modules?.['data-provider'];
  const data = (envelope && typeof envelope === 'object' && 'data' in envelope)
    ? (envelope as { data?: { activeProviderId?: string | null } }).data
    : undefined;
  const out: InstanceGridLevelData = {};
  if (data && 'activeProviderId' in data) {
    out.activeProviderId = data.activeProviderId ?? null;
  }
  return out;
}

/** Merge gridLevelData pointers into a GridState modules map (immutable). */
export function applyGridLevelDataToState(
  state: GridState,
  gld: InstanceGridLevelData | null | undefined,
): GridState {
  if (!gld || gld.activeProviderId === undefined) return state;
  const prev = state.modules?.['data-provider'];
  const prevData = (prev && typeof prev === 'object' && 'data' in prev)
    ? (prev as { data?: Record<string, unknown> }).data ?? {}
    : {};
  const version = (prev && typeof prev === 'object' && 'version' in prev)
    ? Number((prev as { version?: number }).version) || 1
    : 1;
  return {
    ...state,
    modules: {
      ...state.modules,
      'data-provider': {
        version,
        data: {
          ...prevData,
          activeProviderId: gld.activeProviderId,
        },
      },
    },
  };
}

export function emptyBundle(activeProfileId = 'default'): InstanceConfigBundle {
  return {
    version: INSTANCE_BUNDLE_VERSION,
    activeProfileId,
    profiles: [],
    gridLevelData: {},
  };
}

export function isConfigSession(x: unknown): x is ConfigSession {
  return !!x
    && typeof x === 'object'
    && typeof (x as ConfigSession).loadWorkspace === 'function'
    && typeof (x as ConfigSession).saveWorkspace === 'function'
    && typeof (x as ConfigSession).list === 'function';
}

/**
 * Host persistence for one grid instance. Extends ProfileStore so
 * ProfilesController can use it unchanged.
 */
export interface ConfigSession extends ProfileStore {
  readonly gridId: string;
  loadBundle(): Promise<InstanceConfigBundle>;
  saveBundle(bundle: InstanceConfigBundle): Promise<void>;
  loadWorkspace(): Promise<WorkspaceConfig | null>;
  saveWorkspace(config: WorkspaceConfig): Promise<void>;
  clearWorkspace(): Promise<void>;
  hasWorkspace(): Promise<boolean>;
  getActiveProfileId(): Promise<string>;
  setActiveProfileId(id: string): Promise<void>;
}

/**
 * Default ConfigSession — one localStorage document per gridId.
 * Migrates legacy `velocity-grid:config:*` and flat profile maps on first read.
 *
 * Sync helpers (`*Sync`) exist because toolbar / Ext restore paths are sync
 * today; async methods delegate to them.
 */
export class LocalStorageConfigSession implements ConfigSession {
  constructor(
    readonly gridId: string,
    private opts: {
      /** Legacy ProfileStore namespace to import (default velocity-grid-ext). */
      legacyProfilesNamespace?: string;
    } = {},
  ) {
    if (!gridId) throw new Error('LocalStorageConfigSession requires gridId');
  }

  private get key(): string {
    return instanceStorageKey(this.gridId);
  }

  private readRaw(): InstanceConfigBundle | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as InstanceConfigBundle;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.profiles)) return null;
      return {
        version: typeof parsed.version === 'number' ? parsed.version : INSTANCE_BUNDLE_VERSION,
        activeProfileId: parsed.activeProfileId || 'default',
        profiles: parsed.profiles,
        gridLevelData: parsed.gridLevelData && typeof parsed.gridLevelData === 'object'
          ? parsed.gridLevelData
          : {},
        layouts: parsed.layouts,
      };
    } catch {
      return null;
    }
  }

  private writeRaw(bundle: InstanceConfigBundle): void {
    localStorage.setItem(this.key, JSON.stringify({
      version: bundle.version ?? INSTANCE_BUNDLE_VERSION,
      activeProfileId: bundle.activeProfileId || 'default',
      profiles: bundle.profiles ?? [],
      gridLevelData: bundle.gridLevelData ?? {},
      layouts: bundle.layouts,
    }));
  }

  loadBundleSync(): InstanceConfigBundle {
    const existing = this.readRaw();
    if (existing) return existing;
    const migrated = this.migrateLegacy();
    this.writeRaw(migrated);
    return migrated;
  }

  saveBundleSync(bundle: InstanceConfigBundle): void {
    this.writeRaw(bundle);
  }

  private migrateLegacy(): InstanceConfigBundle {
    const bundle = emptyBundle('default');

    try {
      const raw = localStorage.getItem(`${LEGACY_CONFIG_PREFIX}${this.gridId}`);
      if (raw) {
        const cfg = JSON.parse(raw) as WorkspaceConfig;
        if (cfg && typeof cfg === 'object') {
          const { layouts, ...viewState } = cfg;
          if (layouts && typeof layouts === 'object') {
            bundle.layouts = layouts as GridLayoutsBundle;
          }
          const gld = extractGridLevelData(viewState as GridState);
          bundle.gridLevelData = { ...bundle.gridLevelData, ...gld };
          bundle.profiles.push({
            meta: { id: 'default', name: 'Default', updatedAt: Date.now() },
            gridState: viewState as GridState,
            ext: {},
          });
          bundle.activeProfileId = 'default';
        }
      }
    } catch { /* ignore */ }

    const ns = this.opts.legacyProfilesNamespace ?? 'velocity-grid-ext';
    for (const pk of [`${ns}:profiles`, LEGACY_PROFILES_KEY]) {
      try {
        const raw = localStorage.getItem(pk);
        if (!raw) continue;
        const map = JSON.parse(raw) as Record<string, ProfileSnapshot>;
        if (!map || typeof map !== 'object') continue;
        for (const snap of Object.values(map)) {
          if (!snap?.meta?.id) continue;
          const idx = bundle.profiles.findIndex((p) => p.meta.id === snap.meta.id);
          if (idx >= 0) bundle.profiles[idx] = snap;
          else bundle.profiles.push(snap);
          const gld = extractGridLevelData(snap.gridState);
          bundle.gridLevelData = { ...bundle.gridLevelData, ...gld };
        }
      } catch { /* ignore */ }
    }

    // Leave profiles empty when nothing to migrate — ProfilesController.bootstrap
    // / saveWorkspace seed the default snapshot on demand.
    return bundle;
  }

  listSync(): ProfileMeta[] {
    return this.loadBundleSync().profiles.map((p) => p.meta);
  }

  loadSync(id: string): ProfileSnapshot | null {
    const b = this.loadBundleSync();
    const snap = b.profiles.find((p) => p.meta.id === id) ?? null;
    if (!snap) return null;
    return {
      ...snap,
      gridState: applyGridLevelDataToState(snap.gridState, b.gridLevelData),
    };
  }

  saveSync(id: string, snap: ProfileSnapshot): void {
    const b = this.loadBundleSync();
    const next = { ...snap, meta: { ...snap.meta, id, updatedAt: Date.now() } };
    const idx = b.profiles.findIndex((p) => p.meta.id === id);
    if (idx >= 0) b.profiles[idx] = next;
    else b.profiles.push(next);
    b.gridLevelData = {
      ...b.gridLevelData,
      ...extractGridLevelData(snap.gridState),
    };
    b.activeProfileId = id;
    this.saveBundleSync(b);
  }

  removeSync(id: string): void {
    const b = this.loadBundleSync();
    b.profiles = b.profiles.filter((p) => p.meta.id !== id);
    if (b.activeProfileId === id) {
      b.activeProfileId = b.profiles[0]?.meta.id ?? 'default';
    }
    this.saveBundleSync(b);
  }

  loadWorkspaceSync(): WorkspaceConfig | null {
    const b = this.loadBundleSync();
    const snap = b.profiles.find((p) => p.meta.id === b.activeProfileId)
      ?? b.profiles[0];
    if (!snap && !b.layouts) return null;
    const base = snap
      ? applyGridLevelDataToState(snap.gridState, b.gridLevelData)
      : applyGridLevelDataToState({ version: 4 } as GridState, b.gridLevelData);
    return {
      ...base,
      ...(b.layouts ? { layouts: b.layouts } : {}),
    };
  }

  saveWorkspaceSync(config: WorkspaceConfig): void {
    const b = this.loadBundleSync();
    const { layouts, ...viewState } = config;
    if (layouts && typeof layouts === 'object') {
      b.layouts = layouts as GridLayoutsBundle;
    }
    b.gridLevelData = {
      ...b.gridLevelData,
      ...extractGridLevelData(viewState as GridState),
    };
    const id = b.activeProfileId || 'default';
    const existing = b.profiles.find((p) => p.meta.id === id);
    const snap: ProfileSnapshot = {
      meta: {
        id,
        name: existing?.meta.name ?? (id === 'default' ? 'Default' : id),
        updatedAt: Date.now(),
      },
      gridState: viewState as GridState,
      ext: existing?.ext ?? {},
    };
    const idx = b.profiles.findIndex((p) => p.meta.id === id);
    if (idx >= 0) b.profiles[idx] = snap;
    else b.profiles.push(snap);
    b.activeProfileId = id;
    this.saveBundleSync(b);
  }

  clearWorkspaceSync(): void {
    localStorage.removeItem(this.key);
  }

  hasWorkspaceSync(): boolean {
    if (localStorage.getItem(this.key) != null) return true;
    return localStorage.getItem(`${LEGACY_CONFIG_PREFIX}${this.gridId}`) != null;
  }

  // ── async ProfileStore / ConfigSession surface ─────────────────────────

  async loadBundle(): Promise<InstanceConfigBundle> { return this.loadBundleSync(); }
  async saveBundle(bundle: InstanceConfigBundle): Promise<void> { this.saveBundleSync(bundle); }
  async list(): Promise<ProfileMeta[]> { return this.listSync(); }
  async load(id: string): Promise<ProfileSnapshot | null> { return this.loadSync(id); }
  async save(id: string, snap: ProfileSnapshot): Promise<void> { this.saveSync(id, snap); }
  async remove(id: string): Promise<void> { this.removeSync(id); }
  async getActiveProfileId(): Promise<string> { return this.loadBundleSync().activeProfileId; }
  async setActiveProfileId(id: string): Promise<void> {
    const b = this.loadBundleSync();
    b.activeProfileId = id;
    this.saveBundleSync(b);
  }
  async loadWorkspace(): Promise<WorkspaceConfig | null> { return this.loadWorkspaceSync(); }
  async saveWorkspace(config: WorkspaceConfig): Promise<void> { this.saveWorkspaceSync(config); }
  async clearWorkspace(): Promise<void> { this.clearWorkspaceSync(); }
  async hasWorkspace(): Promise<boolean> { return this.hasWorkspaceSync(); }
}
