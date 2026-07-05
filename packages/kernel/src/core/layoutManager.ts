/**
 * Grid Layouts — Phase A / Unit A1: the LayoutManager.
 *
 * Owns the layouts registry, the active layout id, the construction
 * baseline (retained so `resetLayout` can restore a layout to the view
 * the grid was built with), and the Default-layout invariants.
 *
 * DESIGN — pure engine, injected host. The manager never touches a real
 * grid: every coupling point is a callback on {@link LayoutManagerHost}
 * (`captureState`/`applyState`/`newId`/`now`). This is what lets it be
 * unit-tested in isolation with mock accessors, and lets A3 wire the real
 * grid in through thin accessors without reshaping this file.
 *
 * TIERING (A2) — a layout captures only the LAYOUT tier. `captureState()`
 * returns the FULL current snapshot (all module slices + runtime grid
 * options); the manager then (a) strips GRID-tier module slices
 * (`editSettings`, `templates`, …) so those stay shared across layouts,
 * and (b) lifts the runtime grid-option deltas out of the view state into
 * `overrides.gridOptions`. On apply it re-injects the override into the
 * snapshot handed to `applyState`; the host's `applyState` is responsible
 * for the reset-to-baseline half of §7 (kernel `setState` layers options
 * additively — it does not reset — so the host must clear runtime options
 * to baseline BEFORE applying). Editing overrides (`overrides.editing`)
 * are not captured yet — that refinement rides with the Phase-B template
 * work; grid-tier `editSettings` simply stays on baseline until then.
 *
 * INVARIANTS this file guarantees:
 *  - A Default layout ({@link DEFAULT_LAYOUT_ID}) always exists and is
 *    undeletable; its id is fixed but its display name is editable (§9).
 *  - `activeLayoutId` always names a live layout; deleting the active
 *    layout falls back to Default and re-applies Default's view (§12).
 *  - Layout display names are unique grid-wide (trimmed, case-insensitive).
 *
 * Reference: docs/superpowers/specs/2026-07-05-grid-layouts-design.md §§4, 6–9, 12.
 */

import type { GridLayout, LayoutState, GridLayoutsBundle, GridBaselineConfig } from '../types/layout';
import { DEFAULT_LAYOUT_ID, DEFAULT_GRID_LEVEL_MODULES, LAYOUTS_BUNDLE_VERSION } from '../types/layout';
import { migrateSnapshot, type GridState } from './stateSnapshot';
import type { ModuleStateEnvelope } from './moduleState';

/** The grid coupling the manager needs, injected so the engine stays
 *  pure and testable. A3 supplies the real implementations; A1 tests
 *  supply mocks. */
export interface LayoutManagerHost {
  /** Snapshot the FULL current view (every module tier + runtime grid
   *  options, i.e. what `getState()` returns). The manager tier-filters
   *  it into a layout snapshot; the host stays tier-agnostic. */
  captureState(): GridState;
  /** Apply a layout snapshot to the live grid (load / active-delete
   *  fallback / active-reset). MUST reset runtime grid options to the
   *  construction baseline BEFORE restoring, then apply the snapshot's
   *  `gridOptions` on top — kernel `setState` layers options additively,
   *  so the reset is the host's responsibility (spec §7). Module slices
   *  absent from the snapshot (all grid-tier ones) are left untouched. */
  applyState(state: LayoutState): void;
  /** Mint a fresh, unique id for a newly created (non-default) layout. */
  newId(): string;
  /** Monotonic wall-clock (ms) for `updatedAt` stamps — injected so the
   *  engine never reads the system clock itself (mirrors calc's
   *  host-stamped timestamps). */
  now(): number;
}

/** Construction inputs. */
export interface LayoutManagerInit {
  /** The construction baseline view — seeds a synthesized Default and
   *  backs `resetLayout`. Retained verbatim (deep-cloned) for the
   *  manager's lifetime. */
  baseline: LayoutState;
  /** Seed layouts (from construction options or, later, a persisted
   *  bundle). A Default is synthesized and prepended when none is
   *  present; a supplied Default is kept as-is. */
  layouts?: GridLayout[];
  /** Initial active layout. Ignored (falls back to Default) when it does
   *  not name a supplied layout. */
  activeLayoutId?: string;
  /** Module ids that live at the GRID tier (shared, not captured per
   *  layout). Defaults to {@link DEFAULT_GRID_LEVEL_MODULES}. Mirrors the
   *  `layoutGridLevelModules` construction option (spec §10). */
  layoutGridLevelModules?: string[];
  /** The grid-level baseline config (templates / gridOptions / editing).
   *  Rides in the exported bundle's `grid` field. */
  gridConfig?: GridBaselineConfig;
}

/** Options for `importLayout`. */
export interface ImportLayoutOptions {
  /** When the incoming id already exists, replace it in place instead of
   *  minting a new id (the default). */
  overwrite?: boolean;
}

/** Options for `importLayouts`. */
export interface ImportLayoutsOptions {
  /** `'merge'` (default) folds the bundle's layouts into the current set
   *  (per-layout collision handling); `'replace'` swaps the whole set +
   *  active id + grid config for the bundle's. */
  mode?: 'replace' | 'merge';
  /** On `'merge'`, colliding ids replace in place instead of minting new
   *  ids. Ignored for `'replace'`. */
  overwrite?: boolean;
}

/**
 * Forward-migrate an exported bundle to {@link LAYOUTS_BUNDLE_VERSION}.
 * Mirrors `migrateSnapshot`: older bundles run through the migration chain;
 * a bundle newer than this build throws a clear error rather than restoring
 * a shape it doesn't understand. Per-layout `state` migration is separate
 * (each layout's `GridState` migrates on import — see `LayoutManager`).
 */
export const LAYOUTS_BUNDLE_MIGRATIONS: Record<number, (b: GridLayoutsBundle) => GridLayoutsBundle> = {
  // 1 -> 2: add the migrator here when the bundle shape next changes.
};

export function migrateLayoutsBundle(bundle: GridLayoutsBundle): GridLayoutsBundle {
  let v = bundle.version ?? 1;
  if (v > LAYOUTS_BUNDLE_VERSION) {
    throw new Error(
      `[cgrid] cannot import layouts: bundle version ${v} is newer than this build (${LAYOUTS_BUNDLE_VERSION})`,
    );
  }
  let current = bundle;
  while (v < LAYOUTS_BUNDLE_VERSION) {
    const step = LAYOUTS_BUNDLE_MIGRATIONS[v];
    if (!step) throw new Error(`[cgrid] missing layouts-bundle migration from version ${v} → ${v + 1}`);
    current = step(current);
    v++;
  }
  return { ...current, version: LAYOUTS_BUNDLE_VERSION };
}

/** Options common to the layout-creating operations. */
export interface SaveLayoutOptions {
  /** Make the new layout active. Defaults documented per method:
   *  `saveLayout` activates (the capture equals the current view, so it
   *  is a metadata switch); `duplicateLayout` does not (the copy's view
   *  may differ from what's on screen). */
  activate?: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Normalize a display name for uniqueness comparison + storage. */
function normName(name: string): string {
  return name.trim();
}
function nameKey(name: string): string {
  return normName(name).toLowerCase();
}

/**
 * Reduce a FULL grid snapshot to its LAYOUT tier (spec §4/§6): drop
 * grid-tier module slices (`gridLevelModuleIds`) and drop `gridOptions`
 * (the runtime option deltas ride separately in `overrides.gridOptions`).
 * Everything else — view state, layout-tier modules, `themeParams`,
 * per-column `templateIds` in `columnState` — is kept. Pure: returns a
 * fresh deep clone and never mutates `full`.
 */
export function toLayoutTierState(
  full: GridState,
  gridLevelModuleIds: ReadonlySet<string>,
): LayoutState {
  const { gridOptions: _options, modules, ...rest } = full;
  const out: LayoutState = clone(rest);
  if (modules) {
    let layoutModules: Record<string, ModuleStateEnvelope> | undefined;
    for (const [id, envelope] of Object.entries(modules)) {
      if (gridLevelModuleIds.has(id)) continue;
      (layoutModules ??= {})[id] = clone(envelope);
    }
    if (layoutModules) out.modules = layoutModules;
  }
  return out;
}

/**
 * The runtime grid-option deltas a layout should carry as its override
 * (spec §7). `captureState()` surfaces them under `gridOptions` (same as
 * `getState()`); returns a clone, or `undefined` when there are none.
 */
export function extractGridOptionOverride(full: GridState): Record<string, unknown> | undefined {
  const options = full.gridOptions;
  if (options && Object.keys(options).length > 0) return clone(options);
  return undefined;
}

export class LayoutManager {
  private readonly host: LayoutManagerHost;
  /** The construction baseline (a FULL snapshot), retained for
   *  `resetLayout` + Default synthesis. */
  private readonly baseline: GridState;
  /** Module ids treated as grid-tier (excluded from layout snapshots). */
  private readonly gridLevelModuleIds: ReadonlySet<string>;
  /** Grid-level baseline config carried in the exported bundle's `grid`. */
  private gridConfig: GridBaselineConfig;
  /** Ordered registry. Default is guaranteed present; order otherwise
   *  follows insertion / the supplied order. */
  private layouts: GridLayout[];
  private activeId: string;

  constructor(host: LayoutManagerHost, init: LayoutManagerInit) {
    this.host = host;
    this.baseline = clone(init.baseline);
    this.gridLevelModuleIds = new Set(
      init.layoutGridLevelModules ?? DEFAULT_GRID_LEVEL_MODULES,
    );
    this.gridConfig = clone(init.gridConfig ?? {});

    // Adopt supplied layouts (deep-cloned so external mutation can't leak
    // into the registry), then guarantee a Default exists — seeded from
    // the LAYOUT tier of the baseline (grid-tier slices/options excluded).
    this.layouts = (init.layouts ?? []).map((l) => clone(l));
    if (!this.layouts.some((l) => l.id === DEFAULT_LAYOUT_ID)) {
      this.layouts.unshift({
        id: DEFAULT_LAYOUT_ID,
        name: 'Default',
        state: toLayoutTierState(this.baseline, this.gridLevelModuleIds),
      });
    }

    // Active id must name a live layout; otherwise fall back to Default.
    this.activeId =
      init.activeLayoutId && this.has(init.activeLayoutId)
        ? init.activeLayoutId
        : DEFAULT_LAYOUT_ID;
  }

  // ── reads ────────────────────────────────────────────────────────────

  /** All layouts, as defensive clones (Default always included). */
  getLayouts(): GridLayout[] {
    return this.layouts.map((l) => clone(l));
  }

  getActiveLayoutId(): string {
    return this.activeId;
  }

  /** The active layout, as a defensive clone. Always valid (invariant). */
  getActiveLayout(): GridLayout {
    return clone(this.require(this.activeId));
  }

  // ── mutations ────────────────────────────────────────────────────────

  /** Create a NEW layout capturing the current view. Activates it by
   *  default (the capture equals the live view, so no re-apply needed). */
  saveLayout(name: string, opts?: SaveLayoutOptions): GridLayout {
    const clean = this.assertUsableName(name);
    const full = this.host.captureState();
    const layout: GridLayout = {
      id: this.host.newId(),
      name: clean,
      state: toLayoutTierState(full, this.gridLevelModuleIds),
      updatedAt: this.host.now(),
    };
    this.applyCapturedOverrides(layout, full);
    this.layouts.push(layout);
    if (opts?.activate !== false) {
      // The captured state IS the live view — activate without re-applying.
      this.activeId = layout.id;
    }
    return clone(layout);
  }

  /** Recapture the current view into an existing layout (default: the
   *  active one). Does not change which layout is active. */
  updateLayout(id?: string): GridLayout {
    const layout = this.require(id ?? this.activeId);
    const full = this.host.captureState();
    layout.state = toLayoutTierState(full, this.gridLevelModuleIds);
    this.applyCapturedOverrides(layout, full);
    layout.updatedAt = this.host.now();
    return clone(layout);
  }

  /** Make `id` active and apply its stored view to the grid. */
  loadLayout(id: string): GridLayout {
    const layout = this.require(id);
    this.activeId = layout.id;
    this.applyLayout(layout);
    return clone(layout);
  }

  /** Delete a layout. Default is undeletable; deleting the active layout
   *  falls back to Default and re-applies Default's view. */
  deleteLayout(id: string): void {
    if (id === DEFAULT_LAYOUT_ID) {
      throw new Error('[cgrid] the Default layout cannot be deleted');
    }
    const idx = this.indexOf(id); // throws on unknown
    this.layouts.splice(idx, 1);
    if (this.activeId === id) {
      this.activeId = DEFAULT_LAYOUT_ID;
      this.applyLayout(this.require(DEFAULT_LAYOUT_ID));
    }
  }

  /** Rename a layout's display name (unique, non-empty). The Default's
   *  display name is editable — only its id is fixed (§9). */
  renameLayout(id: string, name: string): GridLayout {
    const layout = this.require(id);
    const clean = this.assertUsableName(name, id);
    layout.name = clean;
    layout.updatedAt = this.host.now();
    return clone(layout);
  }

  /** Clone an existing layout under a fresh id + unique name. Does NOT
   *  activate by default (the copy may differ from the on-screen view);
   *  pass `{ activate: true }` to switch to it. */
  duplicateLayout(id: string, name: string, opts?: SaveLayoutOptions): GridLayout {
    const source = this.require(id);
    const clean = this.assertUsableName(name);
    const dup: GridLayout = {
      ...clone(source),
      id: this.host.newId(),
      name: clean,
      updatedAt: this.host.now(),
    };
    this.layouts.push(dup);
    if (opts?.activate === true) {
      this.activeId = dup.id;
      this.applyLayout(dup);
    }
    return clone(dup);
  }

  /** Reset a layout (default: the active one) to the construction
   *  baseline (layout tier; no overrides — options return to baseline).
   *  Re-applies the baseline view when the reset layout is active. */
  resetLayout(id?: string): GridLayout {
    const layout = this.require(id ?? this.activeId);
    layout.state = toLayoutTierState(this.baseline, this.gridLevelModuleIds);
    layout.overrides = undefined;
    layout.updatedAt = this.host.now();
    if (layout.id === this.activeId) {
      this.applyLayout(layout);
    }
    return clone(layout);
  }

  // ── grid-level baseline config ─────────────────────────────────────────

  /** The grid-level baseline config (templates / gridOptions / editing). */
  getGridConfig(): GridBaselineConfig {
    return clone(this.gridConfig);
  }

  /** Merge a partial grid-level config into the baseline. `gridOptions`
   *  accumulate per-key; `editing` / `templates` replace when provided.
   *  Applying it to the live grid is the host's concern (CGrid). */
  setGridConfig(config: GridBaselineConfig): void {
    const next: GridBaselineConfig = { ...this.gridConfig };
    if (config.gridOptions) {
      next.gridOptions = { ...next.gridOptions, ...config.gridOptions };
    }
    if (config.editing) next.editing = clone(config.editing);
    if (config.templates) next.templates = clone(config.templates);
    this.gridConfig = next;
  }

  // ── import / export (A4) ───────────────────────────────────────────────

  /** Export a single layout as a portable object. Unknown id throws (§12).
   *  `templates` is populated with the referenced defs in Phase B (B4);
   *  A4 stubs it empty — the layout still round-trips its state + overrides. */
  exportLayout(id: string): GridLayout {
    const layout = clone(this.require(id));
    layout.templates = [];
    return layout;
  }

  /** Export the full bundle: version + active id + all layouts + the
   *  grid-level baseline config. JSON-serializable. */
  exportLayouts(): GridLayoutsBundle {
    return {
      version: LAYOUTS_BUNDLE_VERSION,
      activeLayoutId: this.activeId,
      layouts: this.layouts.map((l) => clone(l)),
      grid: clone(this.gridConfig),
    };
  }

  /** Import one layout (pure registry mutation — activation/apply is the
   *  caller's concern). Its `state` is forward-migrated (tolerant). A
   *  colliding id mints a new id unless `overwrite`; the display name is
   *  uniquified to preserve the grid-wide unique-name invariant. */
  importLayout(layout: GridLayout, opts?: ImportLayoutOptions): GridLayout {
    const incoming = clone(layout);
    incoming.state = this.migrateState(incoming.state);
    const existingIdx = this.layouts.findIndex((l) => l.id === incoming.id);
    if (existingIdx >= 0 && opts?.overwrite) {
      incoming.name = this.uniquify(incoming.name, incoming.id);
      incoming.updatedAt = this.host.now();
      this.layouts[existingIdx] = incoming;
    } else {
      if (existingIdx >= 0) incoming.id = this.host.newId(); // collision → new id
      incoming.name = this.uniquify(incoming.name, incoming.id);
      incoming.updatedAt = this.host.now();
      this.layouts.push(incoming);
    }
    return clone(incoming);
  }

  /** Import a bundle (pure registry mutation). `'replace'` swaps the whole
   *  set + active id + grid config (a Default is synthesized if the bundle
   *  omits one); `'merge'` (default) folds each layout in via
   *  {@link importLayout} and merges the grid config. Older bundles migrate
   *  forward; a newer bundle throws (`migrateLayoutsBundle`). */
  importLayouts(bundle: GridLayoutsBundle, opts?: ImportLayoutsOptions): void {
    const migrated = migrateLayoutsBundle(clone(bundle));
    const mode = opts?.mode ?? 'merge';
    if (mode === 'replace') {
      this.gridConfig = clone(migrated.grid ?? {});
      this.layouts = migrated.layouts.map((l) => {
        const copy = clone(l);
        copy.state = this.migrateState(copy.state);
        return copy;
      });
      if (!this.layouts.some((l) => l.id === DEFAULT_LAYOUT_ID)) {
        this.layouts.unshift({
          id: DEFAULT_LAYOUT_ID,
          name: 'Default',
          state: toLayoutTierState(this.baseline, this.gridLevelModuleIds),
        });
      }
      this.dedupeNames();
      this.activeId = this.has(migrated.activeLayoutId) ? migrated.activeLayoutId : DEFAULT_LAYOUT_ID;
    } else {
      this.setGridConfig(migrated.grid ?? {});
      for (const l of migrated.layouts) {
        this.importLayout(l, { overwrite: opts?.overwrite });
      }
    }
  }

  // ── internals ────────────────────────────────────────────────────────

  /** Restore a layout to the grid: re-inject its grid-option override into
   *  the snapshot's `gridOptions` (so the host layers it after resetting
   *  options to baseline) and hand it to `applyState`. No override → the
   *  snapshot carries no `gridOptions`, so the host's reset leaves options
   *  at baseline. */
  private applyLayout(layout: GridLayout): void {
    const toApply = clone(layout.state);
    const options = layout.overrides?.gridOptions;
    if (options && Object.keys(options).length > 0) {
      toApply.gridOptions = options;
    }
    this.host.applyState(toApply);
  }

  /** Fold the grid-option delta from a full capture into `layout.overrides`
   *  (replacing any prior delta; cleared when the capture has none). A2
   *  captures grid options only — `overrides.editing` is left for later. */
  private applyCapturedOverrides(layout: GridLayout, full: GridState): void {
    const gridOptions = extractGridOptionOverride(full);
    layout.overrides = gridOptions ? { gridOptions } : undefined;
  }

  private has(id: string): boolean {
    return this.layouts.some((l) => l.id === id);
  }

  private indexOf(id: string): number {
    const idx = this.layouts.findIndex((l) => l.id === id);
    if (idx === -1) throw new Error(`[cgrid] unknown layout id '${id}'`);
    return idx;
  }

  private require(id: string): GridLayout {
    const layout = this.layouts.find((l) => l.id === id);
    if (!layout) throw new Error(`[cgrid] unknown layout id '${id}'`);
    return layout;
  }

  /** Validate a display name: non-empty after trimming, and unique
   *  grid-wide (case-insensitive) excluding `exceptId`. Returns the
   *  trimmed name to store. */
  private assertUsableName(name: string, exceptId?: string): string {
    const clean = normName(name);
    if (clean.length === 0) {
      throw new Error('[cgrid] a layout name cannot be empty');
    }
    const key = nameKey(clean);
    const clash = this.layouts.some((l) => l.id !== exceptId && nameKey(l.name) === key);
    if (clash) {
      throw new Error(`[cgrid] a layout named '${clean}' already exists`);
    }
    return clean;
  }

  /** Forward-migrate a layout's `GridState`, tolerantly: an un-migratable
   *  snapshot (e.g. one newer than this build) is kept as-is rather than
   *  aborting the whole import — `setState` warns/degrades on load (§12). */
  private migrateState(state: LayoutState): LayoutState {
    try {
      return migrateSnapshot(state);
    } catch {
      return state;
    }
  }

  /** Return a grid-wide unique display name (case-insensitive), suffixing
   *  ` (2)`, ` (3)`, … on collision. Import can't reject on a name clash
   *  (it must not lose the layout), so it disambiguates instead. */
  private uniquify(name: string, exceptId?: string): string {
    const base = normName(name) || 'Layout';
    const taken = (candidate: string) =>
      this.layouts.some((l) => l.id !== exceptId && nameKey(l.name) === nameKey(candidate));
    if (!taken(base)) return base;
    let n = 2;
    let candidate = `${base} (${n})`;
    while (taken(candidate)) candidate = `${base} (${++n})`;
    return candidate;
  }

  /** Enforce the unique-name invariant across the whole registry (used
   *  after a `'replace'` import, where the incoming set is trusted but
   *  might still carry a clash once a synthesized Default is added). */
  private dedupeNames(): void {
    const seen = new Set<string>();
    for (const layout of this.layouts) {
      const base = normName(layout.name) || 'Layout';
      let candidate = base;
      let n = 2;
      while (seen.has(nameKey(candidate))) candidate = `${base} (${n++})`;
      layout.name = candidate;
      seen.add(nameKey(candidate));
    }
  }
}
