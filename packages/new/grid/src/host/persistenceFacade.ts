/**
 * Persistence facade — grid state, layouts, templates, rules, and the
 * state-updated bus.
 *
 * Owns `getState`/`setState`, the `LayoutManager` lifecycle and the whole
 * layouts/templates/rules API, the baseline `GridBaselineConfig` round trip,
 * the module-state registry seam, and persisted-blob restore. Extracted from
 * `velocityGrid.ts` as part of splitting the god object (SPEC.md §3 module
 * boundaries — Persistence).
 *
 * A re-seaming, not a redesign: the bodies are the legacy ones verbatim, so
 * the snapshot/apply ordering (including the double `applyStateToTree` after
 * reorder that SPEC.md §2 lists as a workaround to preserve) is unchanged.
 *
 * The seam is the fat {@link PersistenceHost} interface — the same `Deps`
 * pattern the ported coordinators already use. Most of it is the host's own
 * published API, which is what makes this cluster cleanly separable.
 */

import type { VelocityGridOptions, VelocityGridEvent, FilterModel, SortModel } from '../types';
import type { CApplyColumnStateParams, CColumnState } from '../types';
import type { SelectionRange } from '../types/column';
import type {
  GridLayout,
  GridLayoutsBundle,
  GridBaselineConfig,
  TemplateSaveInput,
} from '../types/layout';
import { DEFAULT_GRID_LEVEL_MODULES } from '../types/layout';
import type { LayoutChangeSource, TemplateChangeSource, RuleChangeSource } from '../types/event';
import type { ColumnTemplate } from '@wellsfargo-starui/vg-new-engines';
import type { TypedEventEmitter } from '../core/eventEmitter';
import { buildSnapshot, migrateSnapshot, type GridState } from '../core/stateSnapshot';
import { INITIAL_ONLY_OPTIONS, isRuntimeOption } from '../core/runtimeOptions';
import { clearThemeParams as themeParamsClear } from '../theming/themeParams';
import { LayoutManager, type LayoutManagerHost, type SaveLayoutOptions } from '../core/layoutManager';
import { ModuleStateRegistry, type StateModule } from '../core/moduleState';
import type { StatePersistenceController } from '../core/statePersistence';
import type { StateUpdatedBus } from '../core/stateUpdatedBus';
import type { ViewportManager } from '../core/viewportManager';
import type { CssReader, ResolvedTheme } from '../theming/cssReader';
import type { RowStripCache } from '../renderer/rasterCache';
import type { VelocityGridCanvas } from '../core/canvas';
import type { FloatingRect } from '../interaction/floatingPanel/host';
import { getRuleEngine, type ConditionalRuleShape } from '../core/ruleEngineSlot';
import { getCalcProvider } from '../core/calcSlot';
import type { PaintDriver } from './paintDriver';

/**
 * Host seam. Mostly the grid's own public API — this facade orchestrates it
 * rather than reaching into internals. `VelocityGrid` satisfies it
 * structurally.
 */
export interface PersistenceHost<TRow = any> {
  // ── identity + surfaces ──────────────────────────────────────────────
  readonly root: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  cgridCanvas: VelocityGridCanvas;
  theme: ResolvedTheme;
  cssReader: CssReader;
  paintDriver: PaintDriver<TRow>;
  rasterStrips: RowStripCache | null;
  viewportManager: ViewportManager;
  events: TypedEventEmitter<VelocityGridEvent<TRow>>;
  options: VelocityGridOptions<TRow>;

  // ── persistence collaborators ────────────────────────────────────────
  readonly layoutHost: LayoutManagerHost;
  layoutManager?: LayoutManager;
  moduleStateRegistry: ModuleStateRegistry;
  statePersistence: StatePersistenceController | null;
  stateUpdatedBus: StateUpdatedBus;
  optionBaselines: Map<string, unknown>;
  runtimeTouchedOptions: Map<string, unknown>;
  popoutRect: FloatingRect | undefined;

  // ── model round trip ─────────────────────────────────────────────────
  getColumnState(): CColumnState[];
  applyColumnState(params: CApplyColumnStateParams): boolean;
  resetColumnState(): void;
  getSortModel(): SortModel;
  setSortModel(s: SortModel): void;
  getFilterModel(): FilterModel;
  setFilterModel(f: FilterModel): void;
  getRowGroupColumns(): string[];
  setRowGroupColumns(columns: string[]): void;
  getPivotColumns(): string[];
  setPivotColumns(colIds: string[]): void;
  isPivotMode(): boolean;
  setPivotMode(pivotMode: boolean, opts?: { discardSettings?: boolean }): void;
  getExpandedKeys(): Set<string>;
  setExpanded(groupKey: string, expanded: boolean): void;
  pendingExpandedRouteIds: string[] | null;
  flushPendingExpandedRoutes(): boolean;

  // ── selection ────────────────────────────────────────────────────────
  getSelectedRowIds(): string[];
  setSelectedRowIds(ids: string[]): void;
  getCellRanges(): SelectionRange[];
  addCellRange(range: SelectionRange): void;
  clearCellRanges(): void;
  getFocusedCell(): { rowId: string; colId: string } | null;

  // ── chrome + options ─────────────────────────────────────────────────
  isSideBarVisible(): boolean;
  setSideBarVisible(show: boolean): void;
  getOpenedToolPanel(): string | null;
  openToolPanel(id: string): void;
  closeToolPanel(): void;
  getThemeParams(): Record<string, string>;
  setThemeParams(patch: Readonly<Record<string, string>>): void;
  setGridOption<K extends keyof VelocityGridOptions<TRow>>(
    key: K,
    value: VelocityGridOptions<TRow>[K],
  ): void;
  updateGridOptions(partial: Partial<VelocityGridOptions<TRow>>): void;
  recomputeViewport(afterScroll?: boolean): void;
}

export class PersistenceFacade<TRow = any> {
  constructor(private readonly host: PersistenceHost<TRow>) {}

  /** Cycle 21i Phase 2 / T2 — register a named, versioned engine-state
   *  slice that folds into `GridState.modules` and rides the
   *  persistState autosave. `get()` returning `undefined` omits the
   *  slice; `set(data, version)` restores it (throwing skips that
   *  slice only). Returns an unregister function. After a mutation
   *  that has no mapped grid event, call
   *  `notifyModuleStateChanged(id)` so the autosave runs. */
  registerStateModule(module: StateModule): () => void {
    return this.host.moduleStateRegistry.register(module);
  }

  /** Cycle 21i Phase 2 / T2 — signal that a registered module's state
   *  changed. Emits the typed `moduleStateChanged` event, which the
   *  stateUpdated bus maps to the `modules` snapshot key (debounced
   *  autosave follows when `persistState` is on). */
  notifyModuleStateChanged(moduleId: string): void {
    this.host.moduleStateRegistry.notifyChanged(moduleId);
  }

  /** Cycle 23 / Task 5 — full grid state snapshot. Includes columnState,
   *  filter / sort / group model, pivot mode + cols, expanded routes,
   *  side bar + selection + scroll position. Round-trippable through
   *  `setState` (Task 6); pair with `stateUpdated` (Task 7) to drive
   *  persistence. Empty fields are omitted so snapshots stay compact —
   *  apps can serialize the result through `JSON.stringify` without
   *  pre-pruning. */
  getState(): GridState {
    return buildSnapshot({
      getColumnState: () => this.host.getColumnState(),
      getModuleState: () => this.host.moduleStateRegistry.snapshot(),
      getFilterModel: () => this.host.getFilterModel(),
      getSortModel: () => this.host.getSortModel(),
      getRowGroupColumns: () => this.host.getRowGroupColumns(),
      getExpandedKeys: () => this.host.getExpandedKeys(),
      isPivotMode: () => this.host.isPivotMode(),
      getPivotColumns: () => this.host.getPivotColumns(),
      isSideBarVisible: () => this.host.isSideBarVisible(),
      getOpenedToolPanel: () => this.host.getOpenedToolPanel(),
      getCellRanges: () => this.host.getCellRanges(),
      getFocusedCell: () => this.host.getFocusedCell(),
      getSelectedRowIds: () => this.host.getSelectedRowIds(),
      getScrollPosition: () => this.host.viewportManager.getScrollPosition(),
      getRuntimeOptions: () => Object.fromEntries(this.host.runtimeTouchedOptions),
      getThemeParams: () => this.host.getThemeParams(),
      getToolPanelPopoutRect: () => this.host.popoutRect,
    });
  }

  /** Cycle 23 / Task 6 — restore a state snapshot. Applied in the
   *  dependency order documented in the design notes: columnState →
   *  filter → sort → row-group → pivot → expanded → selection →
   *  side-bar → scroll. Each step is a no-op when the snapshot omits
   *  the corresponding field, so partial snapshots restore only the
   *  fields they carry.
   *
   *  Migrates the snapshot forward through `STATE_MIGRATIONS` when
   *  its `version` is older than the current schema. */
  setState(snapshot: GridState, opts?: { exhaustive?: boolean }): void {
    const migrated = migrateSnapshot(snapshot);
    // Grid Layouts (A6) — `exhaustive` makes a restore a full REPLACE: every
    // view field the snapshot omits is reset to empty rather than left as-is.
    // A partial `setState` (the default, public API) restores only what it
    // carries; switching layouts needs the target's empties to actually
    // clear the outgoing layout's filter / sort / pivot / side-bar / etc.
    // (spec §1: a layout is a self-contained view). Grid-tier module slices
    // are still left untouched — see the modules note below.
    const exhaustive = opts?.exhaustive === true;
    // Cycle 23 / Task 7 — tag the cascade so the next coalesced
    // stateUpdated event reads source: 'api'. The cascade of internal
    // events (filterChanged + sortChanged + ...) collapses into one
    // emission via the bus's rAF debounce.
    this.host.stateUpdatedBus?.setNextSource('api');

    // 0. runtime options (Cycle 21i / Phase 1) — FIRST so option-driven
    // layout (row heights, panels, defaultColDef) settles before column
    // state applies on top. Each key applies independently; one bad
    // value degrades to a warning, not a dropped restore.
    if (migrated.gridOptions) {
      for (const [key, value] of Object.entries(migrated.gridOptions)) {
        try {
          this.host.setGridOption(key as keyof VelocityGridOptions<TRow>, value as never);
        } catch (err) {
          console.warn(`[velocity-grid] setState: skipped gridOptions['${key}']`, err);
        }
      }
    }

    // 0b. theme token overrides (Cycle 21i / Phase 1) — data colours.
    if (migrated.themeParams) {
      this.host.setThemeParams(migrated.themeParams);
    } else if (exhaustive && Object.keys(this.host.getThemeParams()).length > 0) {
      themeParamsClear(this.host.root);
      this.host.theme = this.host.cssReader.read();
      // Cycle 22 / Task 2 — theme-token clear is a raster-cache epoch.
      this.host.paintDriver.rasterCacheEpochBump();
      this.host.recomputeViewport();
      this.host.cgridCanvas.requestRepaint();
      this.host.stateUpdatedBus?.markChanged('themeParams');
    }

    // 0d. Floating-panel rect (non-persist-of-open) — only the last
    // position/size is restored; the float itself is NEVER auto-reopened
    // on `setState`/load.
    if (migrated.toolPanelPopoutRect) {
      this.host.popoutRect = migrated.toolPanelPopoutRect;
      this.host.stateUpdatedBus?.markChanged('toolPanelPopoutRect');
    } else if (exhaustive && this.host.popoutRect !== undefined) {
      this.host.popoutRect = undefined;
      this.host.stateUpdatedBus?.markChanged('toolPanelPopoutRect');
    }

    // 0c. module slices (Cycle 21i Phase 2 / T2) — engine-owned state
    // envelopes, including the kernel's own `columnGroups` slice (the
    // Task 6/8 overlay relocated behind the registry; legacy top-level
    // `columnGroupDefs`/`columnGroupOpen` fields arrive here via the
    // v3→v4 migrator). Positioned BEFORE columnState so structural
    // slices (group hierarchy) settle before per-leaf width/hide/pinned
    // apply on top. The columnGroups slice reuses the exact
    // `updateGridOptions({ columnDefs })` path the panel's Apply uses —
    // that path re-fires `columnDefsChanged`, which re-marks the
    // `modules` key dirty; harmless (the bus coalesces per rAF frame and
    // this restore's own emit is tagged with the 'api'/'init' source set
    // above, matching how the sibling restores below re-dirty their own
    // keys). Restore degrades gracefully per-slice: unknown module ids
    // and throwing `set()`s warn + skip without dropping the rest.
    // Exhaustive (layout switch / persisted restore): CLEAR the layout-tier
    // module slices the incoming snapshot omits, so a layout without calc
    // columns / template assignments doesn't leak the outgoing layout's
    // slices (Grid Layouts / Phase B / B5). Grid-tier ids (editSettings,
    // templates — shared) are preserved. Modules that can't clear from
    // `undefined` (columnGroups) no-op, unchanged. Cleared BEFORE the restore
    // so present slices below re-apply on a clean base.
    if (exhaustive) {
      const present = new Set(Object.keys(migrated.modules ?? {}));
      const preserve = new Set(this.host.options.layoutGridLevelModules ?? DEFAULT_GRID_LEVEL_MODULES);
      this.host.moduleStateRegistry.clearAbsent(present, preserve);
    }
    if (migrated.modules) {
      this.host.moduleStateRegistry.restore(migrated.modules);
    }

    // 1. columnState (defines columns + their geometry).
    if (migrated.columnState) {
      this.host.applyColumnState({ state: migrated.columnState, applyOrder: true });
    }

    // 2. filterModel — filters rows.
    if (migrated.filterModel) {
      this.host.setFilterModel(migrated.filterModel);
    } else if (exhaustive) {
      this.host.setFilterModel({});
    }

    // 3. sortModel — orders rows.
    if (migrated.sortModel) {
      this.host.setSortModel(migrated.sortModel);
    } else if (exhaustive) {
      this.host.setSortModel([]);
    }

    // 4→6. Stash expanded routes BEFORE mutating the group model so a
    // fast `setGroupModel` reply can still consume them. Exhaustive +
    // omitted field means "all collapsed".
    if (migrated.expandedRouteIds) {
      this.host.pendingExpandedRouteIds = [...migrated.expandedRouteIds];
    } else if (exhaustive) {
      this.host.pendingExpandedRouteIds = [];
    } else {
      this.host.pendingExpandedRouteIds = null;
    }

    // 4. row-group columns.
    if (migrated.rowGroupColumns) {
      this.host.setRowGroupColumns(migrated.rowGroupColumns);
    } else if (exhaustive) {
      this.host.setRowGroupColumns([]);
    }

    // 5. pivot mode + cols.
    if (migrated.pivotMode !== undefined) {
      this.host.setPivotMode(migrated.pivotMode);
    } else if (exhaustive && this.host.isPivotMode()) {
      this.host.setPivotMode(false);
    }
    if (migrated.pivotCols) {
      this.host.setPivotColumns(migrated.pivotCols);
    } else if (exhaustive) {
      this.host.setPivotColumns([]);
    }

    // 6. expanded routes (group / tree) — best-effort immediate apply when
    // grouping is already live (layout switch on a warm grid). Otherwise
    // the `setGroupModel` reply path calls `flushPendingExpandedRoutes`.
    this.host.flushPendingExpandedRoutes();

    // 7. cell + row selection.
    if (migrated.cellSelection) {
      this.host.clearCellRanges();
      for (const range of migrated.cellSelection.ranges) {
        this.host.addCellRange(range);
      }
    } else if (exhaustive) {
      this.host.clearCellRanges();
    }
    if (migrated.rowSelection) {
      this.host.setSelectedRowIds(migrated.rowSelection);
    } else if (exhaustive) {
      this.host.setSelectedRowIds([]);
    }

    // 8. side bar.
    if (migrated.sideBar) {
      this.host.setSideBarVisible(migrated.sideBar.visible);
      if (migrated.sideBar.openedToolPanel) {
        this.host.openToolPanel(migrated.sideBar.openedToolPanel);
      } else if (exhaustive) {
        this.host.closeToolPanel();
      }
    } else if (exhaustive) {
      this.host.closeToolPanel();
      this.host.setSideBarVisible(false);
    }

    // 9. scroll — last so viewport math runs after every model that
    // affects layout has settled.
    if (migrated.scroll) {
      this.host.scroller.scrollTo({ top: migrated.scroll.top, left: migrated.scroll.left });
    } else if (exhaustive) {
      this.host.scroller.scrollTo({ top: 0, left: 0 });
    }
  }

  /** The grid's complete configuration in one object: the full live options
   *  (columnDefs, defaultColDef, callbacks, and every runtime-updated option)
   *  with the current runtime + view state embedded as `initialState`. Pass
   *  it straight to `new VelocityGrid(host, grid.getConfig())` to reconstruct the
   *  grid exactly, or to `setConfig` to apply it to a live grid.
   *
   *  This is a SHALLOW copy — `columnDefs` / `defaultColDef` and any function
   *  options are shared by reference (so the result is not pure-JSON; use
   *  `getState()` for the serialisable view-state slice). Treat it as
   *  read-only or clone before mutating. */
  getConfig(): VelocityGridOptions<TRow> {
    return { ...this.host.options, initialState: this.getState() };
  }

  /** Apply a config object (as produced by `getConfig`) to this live grid.
   *  The embedded `initialState` restores via `setState`; the remaining
   *  options are applied via `updateGridOptions`. Initial-only keys
   *  (`gridId`, `getRowId`, `worker`, …) and any non-runtime keys can't
   *  change on a live grid, so they're skipped — construct a new grid from
   *  `getConfig()` when you need those to differ. */
  setConfig(config: VelocityGridOptions<TRow>): void {
    const initialState = config.initialState;
    const src = config as unknown as Record<string, unknown>;
    const applicable: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      if (k === 'initialState') continue;
      if (INITIAL_ONLY_OPTIONS.has(k as keyof VelocityGridOptions<any>)) continue;
      // Only columnDefs (handled specially by updateGridOptions) and known
      // runtime options can apply mid-session; everything else (callbacks,
      // construction-time flags) would be rejected by setGridOption.
      if (k === 'columnDefs' || isRuntimeOption(k)) {
        applicable[k] = src[k];
      }
    }
    this.host.updateGridOptions(applicable as Partial<VelocityGridOptions<TRow>>);
    if (initialState) this.setState(initialState);
  }

  // ── Grid Layouts (Phase A / A3) ─────────────────────────────────────
  //
  // Thin delegation to the LayoutManager (core/layoutManager.ts), which
  // owns the registry / active id / Default invariants / tier filtering.
  // VelocityGrid supplies the live-grid seam (capture = getState, apply =
  // reset-options-then-setState) and fans a `layoutChanged` event.

  /** Build the LayoutManager on first use, capturing the as-constructed
   *  view as the baseline. Called eagerly at the end of construction so the
   *  baseline is the post-`initialState` view, and lazily as a guard for a
   *  layout API call that races construction. */
  getLayoutManager(): LayoutManager {
    if (!this.host.layoutManager) {
      // Options touched at construction (via `initialState` / the seeded
      // options) are the APP baseline — record their current value so a
      // layout switch resets to the app default, not the kernel default.
      // Their lazy pre-change capture in `setGridOption` was `undefined`
      // (they were set before any layout existed); overwrite with the live
      // value. Safe because this runs eagerly at construction end, before any
      // user interaction, so `runtimeTouchedOptions` holds only those.
      for (const [key, value] of this.host.runtimeTouchedOptions) {
        this.host.optionBaselines.set(key, structuredClone(value));
      }
      this.host.layoutManager = new LayoutManager(this.host.layoutHost, {
        baseline: this.getState(),
        layouts: this.host.options.layouts,
        activeLayoutId: this.host.options.activeLayoutId,
        layoutGridLevelModules: this.host.options.layoutGridLevelModules,
      });
    }
    return this.host.layoutManager;
  }

  /** Restore a layout snapshot: first reset every runtime option the target
   *  does NOT override back to its baseline (kernel `setState` layers
   *  options additively — spec §7), then `setState` the snapshot (which
   *  layers the target's option overrides + restores layout-tier modules;
   *  grid-tier module slices, absent from the snapshot, are left as-is). */
  applyLayoutSnapshot(snapshot: GridState): void {
    // Migrate up front so an un-migratable (newer-than-build) snapshot throws
    // BEFORE any side effect — no half-reset options, no half-switched view.
    const migrated = migrateSnapshot(snapshot);
    // Strip grid-tier modules (incl. data-provider) so a polluted legacy
    // layout snapshot cannot overwrite the live shared selection / edits /
    // templates / alerts. Capture already omits these via
    // DEFAULT_GRID_LEVEL_MODULES; this hardens apply for older bundles.
    const preserve = new Set(this.host.options.layoutGridLevelModules ?? DEFAULT_GRID_LEVEL_MODULES);
    if (migrated.modules) {
      const mods = { ...migrated.modules };
      for (const id of preserve) delete mods[id];
      migrated.modules = Object.keys(mods).length > 0 ? mods : undefined;
    }
    const targetOptions = migrated.gridOptions ?? {};
    for (const key of [...this.host.runtimeTouchedOptions.keys()]) {
      if (key in targetOptions) continue;
      try {
        this.host.setGridOption(key as keyof VelocityGridOptions<TRow>, this.host.optionBaselines.get(key) as never);
      } catch (err) {
        console.warn(`[velocity-grid] layout apply: could not reset gridOptions['${key}']`, err);
      }
      // `setGridOption` re-records the touch; un-record so a value equal to
      // baseline is no longer treated as an override on the next capture.
      this.host.runtimeTouchedOptions.delete(key);
    }
    // Exhaustive: a layout switch must CLEAR view state the target omits.
    this.setState(migrated, { exhaustive: true });
  }

  emitLayoutChanged(source: LayoutChangeSource): void {
    this.host.events.emit({
      type: 'layoutChanged',
      activeLayoutId: this.getLayoutManager().getActiveLayoutId(),
      source,
    });
  }

  /** All layouts (Default always present). */
  getLayouts(): GridLayout[] {
    return this.getLayoutManager().getLayouts();
  }
  getActiveLayoutId(): string {
    return this.getLayoutManager().getActiveLayoutId();
  }
  getActiveLayout(): GridLayout {
    return this.getLayoutManager().getActiveLayout();
  }
  /** Capture the current view as a new named layout (activates by default). */
  saveLayout(name: string, opts?: SaveLayoutOptions): GridLayout {
    const layout = this.getLayoutManager().saveLayout(name, opts);
    this.emitLayoutChanged('save');
    return layout;
  }
  /** Recapture the current view into an existing layout (default: active). */
  updateLayout(id?: string): GridLayout {
    const layout = this.getLayoutManager().updateLayout(id);
    this.emitLayoutChanged('update');
    return layout;
  }
  /** Activate a layout and restore its view. */
  loadLayout(id: string): GridLayout {
    const layout = this.getLayoutManager().loadLayout(id);
    this.emitLayoutChanged('load');
    return layout;
  }
  /** Delete a layout (Default undeletable; active-delete → Default). */
  deleteLayout(id: string): void {
    this.getLayoutManager().deleteLayout(id);
    this.emitLayoutChanged('delete');
  }
  /** Rename a layout's display name (unique). */
  renameLayout(id: string, name: string): GridLayout {
    const layout = this.getLayoutManager().renameLayout(id, name);
    this.emitLayoutChanged('rename');
    return layout;
  }
  /** Clone a layout under a new unique name (no activation by default). */
  duplicateLayout(id: string, name: string, opts?: SaveLayoutOptions): GridLayout {
    const layout = this.getLayoutManager().duplicateLayout(id, name, opts);
    this.emitLayoutChanged('duplicate');
    return layout;
  }
  /** Reset a layout (default: active) to the construction baseline. */
  resetLayout(id?: string): GridLayout {
    const layout = this.getLayoutManager().resetLayout(id);
    this.emitLayoutChanged('reset');
    return layout;
  }

  /** The grid-level baseline config (spec §8): the stored baseline
   *  (`gridOptions` + whatever was last set) overlaid with the LIVE
   *  `editSettings` / `templates` module slices (templates lights up in
   *  Phase B). */
  getGridConfig(): GridBaselineConfig {
    const out = this.getLayoutManager().getGridConfig();
    if (out.gridOptions && Object.keys(out.gridOptions).length === 0) delete out.gridOptions;
    // Clone the LIVE module envelopes so a consumer mutating the returned
    // config / exported bundle can't reach into engine-owned module state.
    const modules = this.host.moduleStateRegistry.snapshot();
    if (modules?.editSettings) out.editing = structuredClone(modules.editSettings);
    // Templates: when calc is wired the LIVE library is authoritative — an
    // EMPTY library must override any stale `LayoutManager.gridConfig.templates`
    // (which materializeTemplates populates but delete/rename never prune), so a
    // deleted template can't resurrect in an export/reload (M2). `getTemplates`
    // is defensively cloned and returns `[]` when empty. Only when calc is NOT
    // wired do we fall through to the manager's stored library.
    if (getCalcProvider()?.getTemplates) out.templates = this.getTemplates();
    return out;
  }

  /** Set the grid-level baseline (spec §7/§8): apply it to the live grid
   *  and store it in the LayoutManager so it rides the exported bundle. */
  setGridConfig(config: GridBaselineConfig): void {
    this.applyGridConfigLive(config);
    this.getLayoutManager().setGridConfig(config);
    this.emitLayoutChanged('setGridConfig');
  }

  /** Apply a grid-level config to the LIVE grid (no manager write / event):
   *  `gridOptions` become the new option baseline (applied + recorded so
   *  layout resets return to them, not treated as an override); `editing` /
   *  `templates` restore their module slices. Shared by `setGridConfig` and
   *  the import path. */
  applyGridConfigLive(config: GridBaselineConfig): void {
    if (config.gridOptions) {
      for (const [key, value] of Object.entries(config.gridOptions)) {
        try {
          this.host.setGridOption(key as keyof VelocityGridOptions<TRow>, value as never);
          // Clone so a later mutation of a caller's object-valued option
          // (e.g. defaultColDef) can't corrupt the stored baseline.
          this.host.optionBaselines.set(key, structuredClone(value)); // new baseline
          this.host.runtimeTouchedOptions.delete(key);                 // baseline ≠ override
        } catch (err) {
          console.warn(`[velocity-grid] setGridConfig: skipped gridOptions['${key}']`, err);
        }
      }
    }
    if (config.editing) {
      this.host.moduleStateRegistry.restore({ editSettings: config.editing });
    }
    if (config.templates) {
      this.host.moduleStateRegistry.restore({ templates: { version: 1, data: config.templates } });
    }
  }

  // ── Import / export (A4 + B4) ───────────────────────────────────────

  /** Export a single layout, bundling the template defs its columns
   *  reference (Phase B / B4) — resolved against the LIVE grid-level library
   *  so the export is self-contained across grids. */
  exportLayout(id: string): GridLayout {
    return this.getLayoutManager().exportLayout(id, this.getGridConfig().templates ?? []);
  }
  /** Export the full bundle: layouts + active id + the live grid config
   *  (whose `templates` carries the whole shared library). */
  exportLayouts(): GridLayoutsBundle {
    const bundle = this.getLayoutManager().exportLayouts();
    bundle.grid = this.getGridConfig(); // overlay live editing/templates modules
    return bundle;
  }
  /** Import a single layout (collision → new id unless `overwrite`),
   *  optionally activating (and applying) it. Bundled template defs are
   *  re-materialized into the LIVE library (add-if-absent) so an activated
   *  layout's template assignments resolve (Phase B / B4). */
  importLayout(layout: GridLayout, opts?: { overwrite?: boolean; activate?: boolean }): GridLayout {
    const mgr = this.getLayoutManager();
    const imported = mgr.importLayout(layout, opts); // folds defs into the bundle library
    this.materializeTemplatesLive(layout.templates); // …and into the live engine
    if (opts?.activate) mgr.loadLayout(imported.id); // apply to the live grid
    this.emitLayoutChanged('import');
    return imported;
  }
  /** Import a bundle (`'merge'` default / `'replace'`), then resync the live
   *  grid to the (possibly new) grid config + active layout view.
   *  `{ apply: false }` on replace reseeds only (emits `restore`) — used when
   *  a following `setState` is the authoritative view restore. */
  importLayouts(
    bundle: GridLayoutsBundle,
    opts?: { mode?: 'replace' | 'merge'; overwrite?: boolean; apply?: boolean },
  ): void {
    const mgr = this.getLayoutManager();
    mgr.importLayouts(bundle, opts);
    // Only `'replace'` swaps the active layout + config → resync the live grid.
    // `'merge'` folds layouts in WITHOUT disturbing the current (possibly
    // unsaved) on-screen view; the merged config is stored for later resets.
    if ((opts?.mode ?? 'merge') === 'replace') {
      // Grid config first (sets the option baseline) so the active view's
      // reset-to-baseline in loadLayout lands on the imported baseline. The
      // replaced config's `templates` restores the whole library to the engine.
      this.applyGridConfigLive(mgr.getGridConfig());
      if (opts?.apply === false) {
        // Registry + baseline only — caller will setState the saved view.
        // Emit `restore` (not `import`) so Ext layout-save auto-persist does
        // not write getState() before grid-tier modules (data-provider) restore.
        this.emitLayoutChanged('restore');
        return;
      }
      mgr.loadLayout(mgr.getActiveLayoutId());
    } else {
      // Merge: fold the bundle library into the LIVE engine (add-if-absent) so
      // a later loadLayout of a merged layout resolves its assignments —
      // without a full library replace that would disturb live own-templates.
      // Covers BOTH the bundle-level library AND per-layout bundled defs (a
      // bundle assembled from `exportLayout()` objects carries defs on each
      // layout, not in `grid.templates`) — M4.
      this.materializeTemplatesLive(bundle.grid?.templates);
      for (const l of bundle.layouts ?? []) this.materializeTemplatesLive(l.templates);
    }
    this.emitLayoutChanged('import');
  }

  /** Fold template defs into the LIVE engine library (add-if-absent) — the
   *  runtime half of the manager's `materializeTemplates`. Skips ids already
   *  present (never clobbers a live/customized def); no-op without calc. */
  materializeTemplatesLive(templates: ColumnTemplate[] | undefined): void {
    if (!templates || templates.length === 0) return;
    const have = new Set(this.getTemplates().map((t) => t.id));
    for (const t of templates) {
      if (!have.has(t.id)) this.saveTemplate(t);
    }
  }

  // ── Styling templates (Phase B / B3) ────────────────────────────────
  // The shared styling-template library, routed to the calc provider
  // (registered by @wellsfargo-starui/velocity-grid-calc's wireIntoKernel). No provider (calc not
  // wired) → `getTemplates` returns `[]` and the mutators no-op without an
  // event. The engine is Date-free, so save/rename stamp `Date.now()` here.
  // Mutations that change a column's resolved def (save/apply/remove) trigger
  // the kernel colDef rebuild via the provider's onColumnsChanged wiring;
  // every op fires `templatesChanged` for switchers/editors to re-sync.

  emitTemplatesChanged(source: TemplateChangeSource, templateId?: string): void {
    this.host.events.emit({ type: 'templatesChanged', source, templateId });
  }

  /** The shared styling-template library (defensive clones; `[]` when no
   *  calc engine is wired). */
  getTemplates(): ColumnTemplate[] {
    return (getCalcProvider()?.getTemplates?.() ?? []) as unknown as ColumnTemplate[];
  }
  /** Create-or-replace a template by id (kernel stamps timestamps). */
  saveTemplate(spec: TemplateSaveInput): void {
    const provider = getCalcProvider();
    if (!provider?.saveTemplate) return;
    provider.saveTemplate({
      id: spec.id, name: spec.name, description: spec.description,
      overrides: spec.overrides as Record<string, unknown>, now: Date.now(),
    });
    this.emitTemplatesChanged('save', spec.id);
  }
  /** Rename a template's display name (grid-wide unique; throws on collision). */
  renameTemplate(templateId: string, name: string): void {
    const provider = getCalcProvider();
    if (!provider?.renameTemplate) return;
    provider.renameTemplate(templateId, name, Date.now()); // throws propagate (no event)
    this.emitTemplatesChanged('rename', templateId);
  }
  /** Delete a template from the library (assignments become dangling refs). */
  deleteTemplate(templateId: string): void {
    const provider = getCalcProvider();
    if (!provider?.deleteTemplate) return;
    provider.deleteTemplate(templateId);
    this.emitTemplatesChanged('delete', templateId);
  }
  /** Assign a template to a single column (appends to its chain). */
  applyTemplate(colId: string, templateId: string): void {
    const provider = getCalcProvider();
    if (!provider?.applyTemplate) return;
    provider.applyTemplate(colId, templateId);
    this.emitTemplatesChanged('apply', templateId);
  }
  /** Unassign a template from a single column (library entry kept). */
  removeTemplate(colId: string, templateId: string): void {
    const provider = getCalcProvider();
    if (!provider?.removeTemplate) return;
    provider.removeTemplate(colId, templateId);
    this.emitTemplatesChanged('remove', templateId);
  }
  /** Auto-template-on-edit (spec §3.1): patch a column's editable attributes
   *  into its OWN template (forking from any shared template). Fires
   *  `templatesChanged` (source `'save'` — it writes the column's own
   *  template). No-op without a calc engine. */
  editColumn(colId: string, patch: import('@wellsfargo-starui/velocity-grid-calc').ColumnEditPatch): void {
    const provider = getCalcProvider();
    if (!provider?.editColumn) return;
    // Gate the event on the engine's result — a rejected edit (e.g. a
    // non-compiling format) changes nothing, so it must not fire
    // `templatesChanged` (M1).
    const ok = provider.editColumn(colId, patch as Record<string, unknown>, Date.now());
    if (ok) this.emitTemplatesChanged('save');
  }

  // ── Conditional styling rules (Phase C / C3) ────────────────────────────
  // The active layout's conditional-rule set, routed to the @wellsfargo-starui/velocity-grid-rules
  // RuleEngine via the rule-engine provider (registered by @wellsfargo-starui/velocity-grid-rules'
  // wireIntoKernel). No engine wired → `getRules` returns `[]` and the
  // mutators no-op without an event. The kernel owns the CRUD semantics as
  // pure array transforms over getRules()/setRules() (like LayoutManager owns
  // layout CRUD) — the engine stays the paint + validation owner. Every
  // mutation fires `rulesChanged` (→ persist bus `'modules'` → autosave, since
  // rules ride the layout-tier `rules` module) and repaints (rule style is
  // evaluated live in the paint fold, so a rule change needs a fresh frame).

  emitRulesChanged(source: RuleChangeSource, ruleId?: string): void {
    this.host.events.emit({ type: 'rulesChanged', source, ruleId });
    // Cycle 22 / closeout C-2 — layoutEpoch contract: a rule mutation
    // changes matching cells' resolved fg/bg/indicator with NO data change,
    // column rebuild, or geometry change — rowVersionByRowId and the strip
    // keys all stand still, so retained strips would keep serving pre-rule
    // pixels at rest. All five VelocityGridApi rule mutators route through here.
    // (Tier 1 is safe without this: rule-resolved styles and ruleIndicator
    // are cellStyleSignature fields, so the key itself changes.)
    if (this.host.rasterStrips !== null) this.host.paintDriver.stripLayoutEpochBump();
    // Rule style changes every matching cell's pixels with no data /
    // geometry change — wipe retained layer + force full.
    this.host.paintDriver.invalidateRetainedPaintForColumnLayout();
    this.host.paintDriver.repaintFull();
  }

  /** The active layout's conditional-rule set (`[]` when no rules engine is
   *  wired). Order is the application order (stable tiebreak for equal
   *  priority; `reorderRules` rewrites it). */
  getRules(): ConditionalRuleShape[] {
    return getRuleEngine()?.getRules?.() ?? [];
  }
  /** Append a rule to the set. No-op (no event) when a rule with the same `id`
   *  already exists — ids must be unique (the engine keys match state + counts
   *  by id, so a duplicate would corrupt update/delete/enable); use
   *  `updateRule` to change an existing rule. */
  addRule(rule: ConditionalRuleShape): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    if (current.some((r) => r.id === rule.id)) return;
    engine.setRules([...current, rule]);
    this.emitRulesChanged('add', rule.id);
  }
  /** Shallow-merge a patch into the rule with `id` (its `id` is preserved). The
   *  patch may carry any rule field — `enabled` / `priority` / `condition` /
   *  `style` / … (the engine re-validates). No-op (no event) when the id is
   *  unknown. */
  updateRule(id: string, patch: Partial<ConditionalRuleShape> | Record<string, unknown>): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    if (!current.some((r) => r.id === id)) return;
    engine.setRules(current.map((r) => (r.id === id ? { ...r, ...patch, id } : r)));
    this.emitRulesChanged('update', id);
  }
  /** Remove the rule with `id`. No-op (no event) when the id is unknown. */
  deleteRule(id: string): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    const next = current.filter((r) => r.id !== id);
    if (next.length === current.length) return;
    engine.setRules(next);
    this.emitRulesChanged('delete', id);
  }
  /** Toggle a rule's `enabled` flag. No-op (no event) when the id is unknown or
   *  the rule is already in that state (avoids a needless recompile + autosave). */
  setRuleEnabled(id: string, enabled: boolean): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    const target = current.find((r) => r.id === id);
    if (!target || target.enabled === enabled) return;
    engine.setRules(current.map((r) => (r.id === id ? { ...r, enabled } : r)));
    this.emitRulesChanged('enable', id);
  }
  /** Reorder the rule set to match `orderedIds` (application order — the
   *  stable tiebreak for equal priority). Ids not present in `orderedIds`
   *  keep their relative order after the listed ones; unknown ids are
   *  ignored. No-op (no event) without a rules engine. */
  reorderRules(orderedIds: string[]): void {
    const engine = getRuleEngine();
    if (!engine?.setRules) return;
    const current = this.getRules();
    const byId = new Map(current.map((r) => [r.id, r]));
    const seen = new Set<string>();
    const next: ConditionalRuleShape[] = [];
    for (const id of orderedIds) {
      const r = byId.get(id);
      if (r && !seen.has(id)) { next.push(r); seen.add(id); }
    }
    for (const r of current) if (!seen.has(r.id)) next.push(r);
    // No-op if the order is unchanged (avoids a needless recompile + autosave).
    if (next.every((r, i) => r.id === current[i]?.id)) return;
    engine.setRules(next);
    this.emitRulesChanged('reorder');
  }

  /** Grid Layouts (A5) — restore a persisted blob (`{ ...viewState, layouts?
   *  }`). The reserved `layouts` bundle (when present) reseeds the manager
   *  — taking PRECEDENCE over `options.layouts` (spec §11) — and its grid
   *  config baseline is applied to the live grid; then the top-level view
   *  state restores the last-seen view on top. No `layouts` field → a plain
   *  view-state restore (older blobs, or grids that never used layouts). */
  restorePersistedBlob(blob: GridState): void {
    this.host.stateUpdatedBus?.setNextSource('init');
    const { layouts, ...viewState } = blob as GridState & { layouts?: GridLayoutsBundle };
    if (layouts) {
      // Pure reseed (no view apply — the view is restored below).
      this.getLayoutManager().importLayouts(layouts, { mode: 'replace' });
      this.applyGridConfigLive(this.getLayoutManager().getGridConfig());
    }
    // Exhaustive so persisted state fully defines the view — any leftover
    // from `initialState` (applied earlier in construction) is cleared:
    // persisted state wins (spec §11).
    this.setState(viewState as GridState, { exhaustive: true });
    // Let app UI (layout switchers) re-sync to the restored set. Fired after
    // the view settles; listeners attached before construction's async
    // restore (the common case) receive it.
    if (layouts) this.emitLayoutChanged('restore');
  }

  /** Cycle 23 / Task 6 — restore the construction-time defaults.
   *  Walks the same setters `setState` uses but with empty / cleared
   *  values across the board; column state replays through the
   *  dedicated `resetColumnState` path so the as-coded layout
   *  (sort, pin, visibility) comes back exactly as the constructor
   *  saw it. */
  /** Cycle 21i / Phase 1 — delete the persisted snapshot for this grid's
   *  `gridId` (and cancel any pending autosave write). Does not change the
   *  live grid state; pair with `resetState()` + a reload for a full
   *  factory reset. No-op when persistence isn't enabled. */
  clearPersistedState(): void {
    this.host.statePersistence?.clear();
  }

  resetState(): void {
    this.host.resetColumnState();
    this.host.setFilterModel({});
    this.host.setSortModel([]);
    this.host.setRowGroupColumns([]);
    this.host.setPivotColumns([]);
    if (this.host.isPivotMode()) this.host.setPivotMode(false);
    // Collapse every currently-expanded group.
    for (const key of Array.from(this.host.getExpandedKeys())) {
      this.host.setExpanded(key, false);
    }
    this.host.clearCellRanges();
    this.host.setSelectedRowIds([]);
    this.host.scroller.scrollTo({ top: 0, left: 0 });
  }
}
