/**
 * ConfigSession — thin host persistence facade for the single grid config
 * (view state + layouts + provider pointers).
 *
 * Product model: one config per grid, with layouts. There is no profiles
 * plane in the document. `ProfileStore` methods are a thin facade so
 * ProfilesController / markDirty call sites keep working.
 *
 * Markets Config Manager (Dexie, identity, REST sync) can implement the same
 * surface later. See docs/starui-platform/03-config-planes.md.
 */
import type { GridState, GridLayoutsBundle } from '@wellsfargo-starui/velocity-grid';
import {
  LocalStore,
  storageGetSync,
  storageSetSync,
  storageRemoveSync,
  type IStorage,
} from '@wellsfargo-starui/velocity-grid-storage';
import type { ProfileMeta, ProfileSnapshot, ProfileStore } from '../extension/types';

/** Host-level pointers shared across layouts (not full provider defs). */
export type InstanceGridLevelData = {
  activeProviderId?: string | null;
  liveProviderId?: string | null;
  historicalProviderId?: string | null;
  [k: string]: unknown;
};

/** Workspace blob: live view + layouts (Ext getConfig / layout save disk). */
export type WorkspaceConfig = GridState & { layouts?: GridLayoutsBundle };

/**
 * One document per grid instance — workspace-flat:
 * GridState fields + layouts at the root, plus gridLevelData and docVersion
 * (avoids clashing with GridState.version).
 */
export type InstanceConfigDoc = {
  docVersion: 1;
  gridLevelData: InstanceGridLevelData;
  /** Single-slot ProfileStore facade meta (not a profiles array). */
  meta?: ProfileMeta;
} & WorkspaceConfig;

/**
 * @deprecated Alias of {@link InstanceConfigDoc}. Older Markets profile-set
 * shape (`profiles[]` / `activeProfileId`) is migrated on read.
 */
export type InstanceConfigBundle = InstanceConfigDoc;

export const INSTANCE_DOC_VERSION = 1 as const;
/** @deprecated Use INSTANCE_DOC_VERSION */
export const INSTANCE_BUNDLE_VERSION = INSTANCE_DOC_VERSION;
export const INSTANCE_STORAGE_PREFIX = 'velocity-grid:instance:';
export const LEGACY_CONFIG_PREFIX = 'velocity-grid:config:';
export const LEGACY_PROFILES_KEY = 'velocity-grid-ext:profiles';

const DEFAULT_META = (): ProfileMeta => ({
  id: 'default',
  name: 'Default',
  updatedAt: Date.now(),
});

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

export function emptyDoc(): InstanceConfigDoc {
  return {
    docVersion: INSTANCE_DOC_VERSION,
    gridLevelData: {},
    version: 4,
  } as InstanceConfigDoc;
}

/** @deprecated Use emptyDoc */
export function emptyBundle(_activeProfileId = 'default'): InstanceConfigDoc {
  return emptyDoc();
}

export function isConfigSession(x: unknown): x is ConfigSession {
  return !!x
    && typeof x === 'object'
    && typeof (x as ConfigSession).loadWorkspace === 'function'
    && typeof (x as ConfigSession).saveWorkspace === 'function'
    && typeof (x as ConfigSession).list === 'function';
}

function isGridLayoutsBundle(x: unknown): x is GridLayoutsBundle {
  return !!x && typeof x === 'object';
}

/** Drop grid-tier module slices (esp. data-provider) from each layout state. */
function stripGridLevelModulesFromLayouts(bundle: GridLayoutsBundle): GridLayoutsBundle {
  const GRID_TIER = new Set(['editSettings', 'templates', 'alerts', 'data-provider']);
  const layouts = (bundle.layouts ?? []).map((layout) => {
    const state = layout.state as GridState & { modules?: Record<string, unknown> } | undefined;
    if (!state?.modules) return layout;
    const modules = { ...state.modules };
    let changed = false;
    for (const id of GRID_TIER) {
      if (id in modules) {
        delete modules[id];
        changed = true;
      }
    }
    if (!changed) return layout;
    return {
      ...layout,
      state: {
        ...state,
        modules: Object.keys(modules).length ? modules : undefined,
      },
    };
  });
  return { ...bundle, layouts };
}

function stripDocEnvelope(doc: InstanceConfigDoc): WorkspaceConfig {
  const {
    docVersion: _dv,
    gridLevelData: _gld,
    meta: _meta,
    ...workspace
  } = doc;
  return workspace;
}

function hasWorkspaceContent(doc: InstanceConfigDoc): boolean {
  const ws = stripDocEnvelope(doc);
  if (doc.layouts) return true;
  if (doc.meta) return true;
  // Any GridState field beyond the empty scaffold
  const keys = Object.keys(ws).filter((k) => k !== 'version');
  return keys.length > 0;
}

/**
 * Normalize raw localStorage JSON to a flat InstanceConfigDoc.
 * Migrates legacy `profiles[]` / `activeProfileId` documents on read.
 */
export function normalizeInstanceDoc(raw: unknown): InstanceConfigDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  // Legacy Markets profile-set shape
  if (Array.isArray(o.profiles)) {
    const profiles = o.profiles as ProfileSnapshot[];
    const activeId = (typeof o.activeProfileId === 'string' && o.activeProfileId)
      ? o.activeProfileId
      : 'default';
    const active = profiles.find((p) => p?.meta?.id === activeId) ?? profiles[0];
    const topLayouts = isGridLayoutsBundle(o.layouts) ? o.layouts : undefined;
    const gld = (o.gridLevelData && typeof o.gridLevelData === 'object')
      ? { ...(o.gridLevelData as InstanceGridLevelData) }
      : {};
    const gridState = (active?.gridState && typeof active.gridState === 'object')
      ? active.gridState
      : ({ version: 4 } as GridState);
    // Prefer top-level layouts over anything nested on the profile state
    const { layouts: nestedLayouts, ...viewState } = gridState as GridState & {
      layouts?: GridLayoutsBundle;
    };
    const layouts = topLayouts ?? (isGridLayoutsBundle(nestedLayouts) ? nestedLayouts : undefined);
    const mergedGld = { ...gld, ...extractGridLevelData(gridState) };
    return {
      docVersion: INSTANCE_DOC_VERSION,
      gridLevelData: mergedGld,
      meta: active?.meta ?? DEFAULT_META(),
      ...(viewState as GridState),
      ...(layouts ? { layouts } : {}),
    };
  }

  // Flat doc (docVersion or workspace-shaped without profiles)
  if (
    o.docVersion === 1
    || o.docVersion === INSTANCE_DOC_VERSION
    || (!('profiles' in o) && (
      'version' in o
      || 'columnState' in o
      || 'layouts' in o
      || 'gridLevelData' in o
      || 'modules' in o
    ))
  ) {
    const gld = (o.gridLevelData && typeof o.gridLevelData === 'object')
      ? (o.gridLevelData as InstanceGridLevelData)
      : {};
    const meta = (o.meta && typeof o.meta === 'object' && 'id' in (o.meta as object))
      ? (o.meta as ProfileMeta)
      : undefined;
    const {
      docVersion: _dv,
      gridLevelData: _gld,
      meta: _meta,
      profiles: _profiles,
      activeProfileId: _ap,
      ...rest
    } = o;
    return {
      docVersion: INSTANCE_DOC_VERSION,
      gridLevelData: gld,
      ...(meta ? { meta } : {}),
      ...(rest as WorkspaceConfig),
    } as InstanceConfigDoc;
  }

  return null;
}

/**
 * Host persistence for one grid instance. Extends ProfileStore so
 * ProfilesController can use it unchanged (single-slot facade).
 */
export interface ConfigSession extends ProfileStore {
  readonly gridId: string;
  /** @deprecated Prefer loadWorkspace — returns flat InstanceConfigDoc. */
  loadBundle(): Promise<InstanceConfigDoc>;
  /** @deprecated Prefer saveWorkspace. */
  saveBundle(bundle: InstanceConfigDoc): Promise<void>;
  loadWorkspace(): Promise<WorkspaceConfig | null>;
  saveWorkspace(config: WorkspaceConfig): Promise<void>;
  clearWorkspace(): Promise<void>;
  hasWorkspace(): Promise<boolean>;
  getActiveProfileId(): Promise<string>;
  setActiveProfileId(id: string): Promise<void>;
}

/**
 * Default ConfigSession — one localStorage document per gridId.
 * Migrates legacy `velocity-grid:config:*`, flat profile maps, and
 * `profiles[]` instance docs on first read.
 *
 * Sync helpers (`*Sync`) exist because toolbar / Ext restore paths are sync
 * today; async methods delegate to them.
 */
export class LocalStorageConfigSession implements ConfigSession {
  private readonly storage: IStorage;

  constructor(
    readonly gridId: string,
    private opts: {
      /** Legacy ProfileStore namespace to import (default velocity-grid-ext). */
      legacyProfilesNamespace?: string;
      /** Shared transport (default: new LocalStore()). Sync store required for sync helpers. */
      storage?: IStorage;
    } = {},
  ) {
    if (!gridId) throw new Error('LocalStorageConfigSession requires gridId');
    this.storage = opts.storage ?? new LocalStore();
  }

  private get key(): string {
    return instanceStorageKey(this.gridId);
  }

  private readRaw(): InstanceConfigDoc | null {
    try {
      const raw = storageGetSync(this.storage, this.key);
      if (!raw) return null;
      return normalizeInstanceDoc(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private writeRaw(doc: InstanceConfigDoc): void {
    const {
      docVersion: _dv,
      gridLevelData,
      meta,
      ...workspace
    } = doc;
    const payload: Record<string, unknown> = {
      docVersion: INSTANCE_DOC_VERSION,
      gridLevelData: gridLevelData ?? {},
      ...workspace,
    };
    if (meta) payload.meta = meta;
    storageSetSync(this.storage, this.key, JSON.stringify(payload));
  }

  /** True when the on-disk JSON still uses the legacy profiles[] shape. */
  private needsRewrite(raw: string | null): boolean {
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Array.isArray(parsed.profiles) || parsed.docVersion !== INSTANCE_DOC_VERSION;
    } catch {
      return false;
    }
  }

  loadBundleSync(): InstanceConfigDoc {
    const existing = this.readRaw();
    if (existing) {
      // Persist migration when old profiles[] (or missing docVersion) was read
      if (this.needsRewrite(storageGetSync(this.storage, this.key))) {
        this.writeRaw(existing);
      }
      return existing;
    }
    const migrated = this.migrateLegacy();
    if (hasWorkspaceContent(migrated)) {
      this.writeRaw(migrated);
    }
    return migrated;
  }

  saveBundleSync(bundle: InstanceConfigDoc): void {
    const normalized = normalizeInstanceDoc(bundle) ?? {
      ...emptyDoc(),
      ...bundle,
      docVersion: INSTANCE_DOC_VERSION,
      gridLevelData: bundle.gridLevelData ?? {},
    };
    this.writeRaw(normalized);
  }

  private migrateLegacy(): InstanceConfigDoc {
    const doc = emptyDoc();

    try {
      const raw = storageGetSync(this.storage, `${LEGACY_CONFIG_PREFIX}${this.gridId}`);
      if (raw) {
        const cfg = JSON.parse(raw) as WorkspaceConfig;
        if (cfg && typeof cfg === 'object') {
          const { layouts, ...viewState } = cfg;
          if (isGridLayoutsBundle(layouts)) {
            doc.layouts = layouts;
          }
          Object.assign(doc, viewState);
          doc.gridLevelData = {
            ...doc.gridLevelData,
            ...extractGridLevelData(viewState as GridState),
          };
          doc.meta = DEFAULT_META();
        }
      }
    } catch { /* ignore */ }

    // Legacy flat profile map: take active/default (or first) snapshot into the
    // single config; prefer an existing view from LEGACY_CONFIG over overwriting.
    const ns = this.opts.legacyProfilesNamespace ?? 'velocity-grid-ext';
    for (const pk of [`${ns}:profiles`, LEGACY_PROFILES_KEY]) {
      try {
        const raw = storageGetSync(this.storage, pk);
        if (!raw) continue;
        const map = JSON.parse(raw) as Record<string, ProfileSnapshot>;
        if (!map || typeof map !== 'object') continue;
        const snaps = Object.values(map).filter((s) => s?.meta?.id);
        if (!snaps.length) continue;
        const preferred = snaps.find((s) => s.meta.id === 'default') ?? snaps[0]!;
        // If we already have view from LEGACY_CONFIG, only merge gridLevelData /
        // keep preferred meta when doc has no meta yet.
        if (!hasWorkspaceContent(doc) || !doc.meta) {
          const { layouts: nestedLayouts, ...viewState } = preferred.gridState as GridState & {
            layouts?: GridLayoutsBundle;
          };
          if (!doc.layouts && isGridLayoutsBundle(nestedLayouts)) {
            doc.layouts = nestedLayouts;
          }
          if (!hasWorkspaceContent(doc)) {
            Object.assign(doc, viewState);
          }
          doc.meta = preferred.meta;
        }
        for (const s of snaps) {
          doc.gridLevelData = {
            ...doc.gridLevelData,
            ...extractGridLevelData(s.gridState),
          };
        }
      } catch { /* ignore */ }
    }

    return doc;
  }

  listSync(): ProfileMeta[] {
    const doc = this.loadBundleSync();
    if (!hasWorkspaceContent(doc) && !doc.meta) return [];
    return [doc.meta ?? DEFAULT_META()];
  }

  loadSync(id: string): ProfileSnapshot | null {
    const doc = this.loadBundleSync();
    if (!hasWorkspaceContent(doc) && !doc.meta) return null;
    const meta = doc.meta ?? DEFAULT_META();
    // Single-slot facade — only the active meta id loads
    if (id !== meta.id) return null;

    const workspace = stripDocEnvelope(doc);
    const { layouts: _layouts, ...gridState } = workspace;
    return {
      meta,
      gridState: applyGridLevelDataToState(gridState as GridState, doc.gridLevelData),
      ext: {},
    };
  }

  saveSync(id: string, snap: ProfileSnapshot): void {
    const doc = this.loadBundleSync();
    const viewState = snap.gridState;
    // Replace workspace GridState — spreading `doc` first left stale keys
    // (e.g. rowGroupColumns) when the new snapshot omitted empty slices.
    const next: InstanceConfigDoc = {
      docVersion: INSTANCE_DOC_VERSION,
      ...(viewState as GridState),
      gridLevelData: {
        ...doc.gridLevelData,
        ...extractGridLevelData(viewState),
      },
      meta: {
        ...snap.meta,
        id,
        updatedAt: Date.now(),
      },
      ...(doc.layouts ? { layouts: doc.layouts } : {}),
    };
    this.writeRaw(next);
  }

  removeSync(id: string): void {
    const doc = this.loadBundleSync();
    const meta = doc.meta ?? DEFAULT_META();
    if (meta.id !== id) return;
    // Single config — removing the only slot clears the document
    this.clearWorkspaceSync();
  }

  loadWorkspaceSync(): WorkspaceConfig | null {
    const doc = this.loadBundleSync();
    if (!hasWorkspaceContent(doc)) return null;
    const workspace = stripDocEnvelope(doc);
    const { layouts, ...viewState } = workspace;
    const base = applyGridLevelDataToState(
      viewState as GridState,
      doc.gridLevelData,
    );
    return {
      ...base,
      ...(layouts ? { layouts } : {}),
    };
  }

  saveWorkspaceSync(config: WorkspaceConfig): void {
    const doc = this.loadBundleSync();
    const { layouts, ...viewState } = config;
    const cleanedLayouts = layouts ? stripGridLevelModulesFromLayouts(layouts) : undefined;
    const extracted = extractGridLevelData(viewState as GridState);
    // Persist provider pointer only in gridLevelData (not root modules) so
    // layout restore / import cannot race a null modules slice over the id.
    const modules = viewState.modules ? { ...viewState.modules } : undefined;
    if (modules && 'data-provider' in modules) {
      delete modules['data-provider'];
    }
    // Replace workspace view state. Do NOT `{ ...doc, ...viewState }` —
    // cleared slices are omitted from getState() (rowGroupColumns, empty
    // filterModel, etc.) and spreading the prior doc kept those keys forever
    // so reload resurrected grouping / filters the user had cleared.
    const next: InstanceConfigDoc = {
      docVersion: INSTANCE_DOC_VERSION,
      ...(viewState as GridState),
      ...(modules !== undefined
        ? { modules: Object.keys(modules).length ? modules : undefined }
        : {}),
      gridLevelData: {
        ...doc.gridLevelData,
        ...extracted,
      },
      meta: { ...(doc.meta ?? DEFAULT_META()), updatedAt: Date.now() },
      ...(isGridLayoutsBundle(cleanedLayouts)
        ? { layouts: cleanedLayouts }
        : doc.layouts
          ? { layouts: stripGridLevelModulesFromLayouts(doc.layouts) }
          : {}),
    };
    this.writeRaw(next);
  }

  clearWorkspaceSync(): void {
    storageRemoveSync(this.storage, this.key);
  }

  hasWorkspaceSync(): boolean {
    if (storageGetSync(this.storage, this.key) != null) return true;
    return storageGetSync(this.storage, `${LEGACY_CONFIG_PREFIX}${this.gridId}`) != null;
  }

  // ── async ProfileStore / ConfigSession surface ─────────────────────────

  async loadBundle(): Promise<InstanceConfigDoc> { return this.loadBundleSync(); }
  async saveBundle(bundle: InstanceConfigDoc): Promise<void> { this.saveBundleSync(bundle); }
  async list(): Promise<ProfileMeta[]> { return this.listSync(); }
  async load(id: string): Promise<ProfileSnapshot | null> { return this.loadSync(id); }
  async save(id: string, snap: ProfileSnapshot): Promise<void> { this.saveSync(id, snap); }
  async remove(id: string): Promise<void> { this.removeSync(id); }
  async getActiveProfileId(): Promise<string> {
    const doc = this.loadBundleSync();
    return doc.meta?.id ?? 'default';
  }
  async setActiveProfileId(id: string): Promise<void> {
    const doc = this.loadBundleSync();
    doc.meta = {
      ...(doc.meta ?? DEFAULT_META()),
      id,
      updatedAt: Date.now(),
    };
    this.writeRaw(doc);
  }
  async loadWorkspace(): Promise<WorkspaceConfig | null> { return this.loadWorkspaceSync(); }
  async saveWorkspace(config: WorkspaceConfig): Promise<void> { this.saveWorkspaceSync(config); }
  async clearWorkspace(): Promise<void> { this.clearWorkspaceSync(); }
  async hasWorkspace(): Promise<boolean> { return this.hasWorkspaceSync(); }
}
