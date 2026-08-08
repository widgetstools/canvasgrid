/**
 * Lab demo catalogs → full grid config (view state + nested layouts).
 *
 * There is no separate "profile" object. A lab catalog entry is a named
 * layout seed; install builds one VelocityGridExtConfig-shaped blob and
 * loads it via `loadConfig` so demos match the real config→layouts model.
 */
import type { GridState, GridLayoutsBundle } from '@wellsfargo-starui/velocity-grid';
import type { VelocityGridExtConfig } from '@wellsfargo-starui/velocity-grid-ext';
import { loadConfigFromLocalStorage } from '@wellsfargo-starui/velocity-grid-ext';

/** Bump when catalog contents change so labs reinstall demo config. */
export const LAB_DEMO_LAYOUTS_FLAG_VERSION = 'v6';

/** @deprecated use LAB_DEMO_LAYOUTS_FLAG_VERSION */
export const LAB_DEMO_PROFILES_FLAG_VERSION = LAB_DEMO_LAYOUTS_FLAG_VERSION;

/** Modules that stay grid-tier (shared across layouts) — ride top-level
 *  config / `layouts.grid`, not each layout's `state.modules`. */
const GRID_TIER_MODULE_IDS = new Set(['editSettings', 'templates', 'alerts']);

export interface LabModuleSeed {
  columnOverrides?: unknown;
  templates?: unknown;
  calc?: unknown;
  rules?: unknown;
  alerts?: unknown;
  'saved-filters'?: unknown;
  editSettings?: unknown;
  columnGroups?: unknown;
  filterModel?: Record<string, unknown>;
  rowGroupColumns?: string[];
  sortModel?: Array<{ colId: string; direction: 'asc' | 'desc' }>;
}

/** One named demo layout (legacy name "profile" = layout seed). */
export interface LabDemoProfileEntry {
  id: string;
  name: string;
  blurb: string;
  seed: LabModuleSeed;
}

export interface LabProfileCatalog {
  gridId: string;
  /** Active layout id after install (legacy field name). */
  activeProfileId: string;
  /** Demo layout seeds (legacy field name). */
  profiles: LabDemoProfileEntry[];
}

const STATE_V = 4;
const LAYOUTS_BUNDLE_VERSION = 1;

/** Same shape as `VelocityGridExt.getConfig()` / footer Export. */
export type LabGridConfig = VelocityGridExtConfig & {
  layouts: GridLayoutsBundle;
};

export interface LabConfigHost {
  loadConfig(config: VelocityGridExtConfig): void;
  getConfig(): VelocityGridExtConfig;
  grid: {
    getLayouts(): Array<{ id: string }>;
    loadLayout(id: string): unknown;
  };
}

function modulesFromSeed(
  seed: LabModuleSeed,
  opts?: { includeGridTier?: boolean },
): NonNullable<GridState['modules']> {
  const modules: NonNullable<GridState['modules']> = {};
  const put = (id: string, data: unknown) => {
    if (data === undefined) return;
    if (!opts?.includeGridTier && GRID_TIER_MODULE_IDS.has(id)) return;
    modules[id] = { version: 1, data };
  };
  put('columnOverrides', seed.columnOverrides);
  put('templates', seed.templates);
  put('calc', seed.calc);
  put('rules', seed.rules);
  put('alerts', seed.alerts);
  put('saved-filters', seed['saved-filters']);
  put('editSettings', seed.editSettings);
  put('columnGroups', seed.columnGroups);
  return modules;
}

export function buildLayoutState(seed: LabModuleSeed): GridState {
  const gridState: GridState = {
    version: STATE_V,
    modules: modulesFromSeed(seed, { includeGridTier: false }),
  };
  if (seed.filterModel) gridState.filterModel = seed.filterModel as GridState['filterModel'];
  if (seed.rowGroupColumns) gridState.rowGroupColumns = seed.rowGroupColumns;
  if (seed.sortModel) gridState.sortModel = seed.sortModel;
  return gridState;
}

/** Grid-tier slices for an entry (alerts / editSettings / templates). */
export function gridTierSeedFor(entry: LabDemoProfileEntry | undefined): GridState['modules'] {
  if (!entry) return {};
  return modulesFromSeed(entry.seed, { includeGridTier: true });
}

export function buildLabLayoutsBundle(catalog: LabProfileCatalog): GridLayoutsBundle {
  const layouts = [
    {
      id: 'default',
      name: 'Default',
      state: { version: STATE_V, modules: {} } as GridState,
    },
    ...catalog.profiles.map((entry) => ({
      id: entry.id,
      name: entry.name,
      state: buildLayoutState(entry.seed),
    })),
  ];

  const active = catalog.profiles.find((p) => p.id === catalog.activeProfileId);
  const tier = gridTierSeedFor(active);
  const grid: GridLayoutsBundle['grid'] = {};
  if (tier?.templates) {
    grid.templates = tier.templates.data as GridLayoutsBundle['grid']['templates'];
  }
  if (tier?.editSettings) grid.editing = tier.editSettings;

  return {
    version: LAYOUTS_BUNDLE_VERSION,
    activeLayoutId: catalog.activeProfileId,
    layouts,
    grid,
  };
}

/**
 * Full demo workspace: active view (layout-tier + grid-tier from the
 * active entry) nested with the complete layouts registry.
 */
export function buildLabGridConfig(catalog: LabProfileCatalog): LabGridConfig {
  const layouts = buildLabLayoutsBundle(catalog);
  const active = catalog.profiles.find((p) => p.id === catalog.activeProfileId);
  const view = buildLayoutState(active?.seed ?? {});
  const tier = gridTierSeedFor(active);
  const modules: NonNullable<GridState['modules']> = { ...(view.modules ?? {}) };
  if (tier?.alerts) modules.alerts = tier.alerts;
  if (tier?.editSettings) modules.editSettings = tier.editSettings;
  if (tier?.templates) modules.templates = tier.templates;

  return {
    ...view,
    modules,
    layouts,
  };
}

/**
 * Install demo workspace via `loadConfig`.
 * Prefer a user-saved config in localStorage (`velocity-grid:config:<gridId>`)
 * over the catalog so toolbar Save round-trips across remounts.
 */
export function installLabDemoLayouts(
  host: LabConfigHost,
  catalog: LabProfileCatalog,
  opts?: { force?: boolean },
): () => void {
  if (!opts?.force) {
    const saved = loadConfigFromLocalStorage(catalog.gridId);
    if (saved && typeof saved === 'object') {
      host.loadConfig(saved as VelocityGridExtConfig);
      return () => { /* saved config owns the workspace */ };
    }
  }

  const flagKey = `lab-demo-layouts-${LAB_DEMO_LAYOUTS_FLAG_VERSION}:${catalog.gridId}`;
  const already = !opts?.force && (() => {
    try { return localStorage.getItem(flagKey) === '1'; } catch { return false; }
  })();

  const existingIds = new Set(host.grid.getLayouts().map((l) => l.id));
  const missing = catalog.profiles.some((p) => !existingIds.has(p.id));
  const config = buildLabGridConfig(catalog);

  if (!already || missing || opts?.force) {
    host.loadConfig(config);
    try { localStorage.setItem(flagKey, '1'); } catch { /* quota */ }
  } else {
    try {
      host.grid.loadLayout(catalog.activeProfileId);
    } catch {
      host.grid.loadLayout('default');
    }
  }

  return () => { /* no live re-seed subscription — config owns layouts */ };
}

/** @deprecated use installLabDemoLayouts */
export async function installLabDemoProfiles(
  catalog: LabProfileCatalog,
): Promise<{ activeId: string }> {
  return { activeId: catalog.activeProfileId };
}

export function clearLabProfileInstallFlag(gridId: string): void {
  try {
    localStorage.removeItem(`lab-demo-layouts-${LAB_DEMO_LAYOUTS_FLAG_VERSION}:${gridId}`);
    localStorage.removeItem('lab-demo-layouts-v5:' + gridId);
    localStorage.removeItem(`lab-demo-profiles-v4:${gridId}`);
    localStorage.removeItem(`lab-demo-profiles-v3:${gridId}`);
  } catch {
    /* ignore */
  }
}
