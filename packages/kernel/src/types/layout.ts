/**
 * Grid Layouts — public data model (Phase A / Unit A1).
 *
 * A single grid (`gridId`) holds MULTIPLE named, switchable layouts on
 * top of a thin grid-level baseline. A layout is a self-contained view
 * (columns shown/ordered/sized/pinned, filters, sort, grouping, pivot,
 * side-bar state, column groups, calculated columns, per-column template
 * assignments, conditional rules) plus optional overrides of the
 * grid-level baseline (grid options / editing rules). There is always a
 * reserved `'default'` layout.
 *
 * These types build ON the existing state stack — a layout's `state` is a
 * `GridState` restricted to the LAYOUT tier (see `LayoutState`); the tier
 * split itself lands in Unit A2. The shared template library reuses
 * `@wellsfargo-starui/velocity-grid/calc`'s `ColumnTemplate` rather than defining a parallel model.
 *
 * Authoritative reference: docs/superpowers/specs/2026-07-05-grid-layouts-design.md §5.
 */

import type { ColumnTemplate } from '../calc/index';
import type { GridState } from '../core/stateSnapshot';
import type { ModuleStateEnvelope } from '../core/moduleState';

/** The reserved id of the always-present Default layout. Its display
 *  name is user-editable (and must stay unique), but the id is fixed. */
export const DEFAULT_LAYOUT_ID = 'default';

/**
 * The default set of state-module ids that live at the GRID tier — shared
 * across all layouts rather than captured per-layout. A layout's snapshot
 * excludes these; on load they stay on the grid baseline (spec §6/§10).
 *
 * `templates` is included even though its module only registers in Phase B
 * — filtering an id no snapshot carries yet is a harmless no-op, and this
 * keeps the documented default (the `layoutGridLevelModules` construction
 * option, §10) stable as templates lights up. Everything NOT in this set
 * (`columnGroups`, `calc`, `rules`, …) is layout-tier.
 *
 * `data-provider` is grid-tier: the active provider is shared across all
 * layouts (ConfigSession `gridLevelData.activeProviderId` is the persisted
 * pointer). Baking it into layout snapshots made layout switches rebind /
 * clear the live provider.
 */
export const DEFAULT_GRID_LEVEL_MODULES: readonly string[] = [
  'editSettings',
  'templates',
  'alerts',
  'data-provider',
  'perspective-data-provider',
];

/**
 * Schema version of an exported {@link GridLayoutsBundle} envelope. Bumped
 * when the bundle SHAPE changes (independent of each layout's own
 * `state.version`, which the `GridState` migrator handles). Import forward-
 * migrates older bundles; a newer bundle throws a clear error (mirrors
 * `migrateSnapshot`). See `migrateLayoutsBundle`.
 */
export const LAYOUTS_BUNDLE_VERSION = 1;

/**
 * A layout's persisted view state.
 *
 * Structurally a `GridState` — column geometry, filter/sort/group/pivot,
 * side-bar, scroll, `themeParams`, and the LAYOUT-tier module slices
 * (`columnGroups`, `calc`, `rules`, …) under `modules`. The grid-TIER
 * slices (`editSettings`, `templates`, `alerts`) do NOT belong here; the tier
 * filtering that decides what a capture includes is Unit A2's concern —
 * the TYPE is the full snapshot, the RUNTIME restricts it to the layout
 * tier. Per-column `templateIds` ride inside `columnState`.
 */
export type LayoutState = GridState;

/** One named, switchable layout. */
export interface GridLayout {
  /** Stable identity. `'default'` is reserved for the Default layout
   *  (see {@link DEFAULT_LAYOUT_ID}); every other layout gets a minted id. */
  id: string;
  /** Display name — user-editable, must be unique grid-wide. */
  name: string;
  /** The layout-tier view state (see {@link LayoutState}). */
  state: LayoutState;
  /** Grid-level baseline overrides carried by this layout. Populated in
   *  Unit A2 (grid-option delta capture from `runtimeTouchedOptions`);
   *  left undefined by the A1 engine. */
  overrides?: {
    gridOptions?: Record<string, unknown>;
    editing?: ModuleStateEnvelope;
  };
  /** Template defs referenced by this layout — populated on EXPORT for
   *  portability (Unit A4 / Phase B); empty at runtime because the defs
   *  live in the grid-level library ({@link GridLayoutsBundle.grid}). */
  templates?: ColumnTemplate[];
  /** Host-stamped last-modified time (ms). The engine never reads the
   *  system clock itself — it is handed a `now()` — mirroring calc's
   *  host-stamped `createdAt`/`updatedAt` convention. */
  updatedAt?: number;
}

/** The full, portable bundle of a grid's layouts + shared grid-level
 *  configuration. This is what `exportLayouts()` produces and what
 *  persistence folds under the reserved `layouts` field (Units A4/A5). */
export interface GridLayoutsBundle {
  /** Bundle schema version — gates forward migration on import (A4). */
  version: number;
  /** Id of the layout that is active. Always names a member of `layouts`. */
  activeLayoutId: string;
  /** All layouts; always includes `{ id: 'default', name: 'Default' }`. */
  layouts: GridLayout[];
  /** Grid-level (shared across all layouts) baseline configuration. */
  grid: GridBaselineConfig;
}

/**
 * The grid-level (shared) baseline configuration — the tier `getGridConfig`
 * returns and `setGridConfig` sets (spec §8). Distinct from a layout's
 * per-view state: these apply to every layout unless a layout overrides
 * them. `templates` is the shared library (Phase B); `editing` is the
 * `editSettings` module envelope; `gridOptions` is the option baseline (§7).
 */
export interface GridBaselineConfig {
  /** The shared template library (grid tier). */
  templates?: ColumnTemplate[];
  /** Baseline grid options. */
  gridOptions?: Record<string, unknown>;
  /** Baseline editing rules (`editSettings` module envelope). */
  editing?: ModuleStateEnvelope;
}

/**
 * Host-facing input to `VelocityGridApi.saveTemplate` (Grid Layouts / Phase B, §8) —
 * a {@link ColumnTemplate} without the engine-managed timestamps (the kernel
 * stamps `createdAt`/`updatedAt` on the caller's behalf, since the calc engine
 * is Date-free). Re-saving an existing `id` replaces it (preserving its
 * original `createdAt`).
 */
export type TemplateSaveInput = Omit<ColumnTemplate, 'createdAt' | 'updatedAt'>;
