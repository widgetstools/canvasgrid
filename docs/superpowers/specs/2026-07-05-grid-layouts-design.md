# Grid Layouts — design spec

**Date:** 2026-07-05
**Status:** Approved design; ready for implementation planning
**Branch:** `feature/grid-layouts`

## 1. Summary

Let a single grid (identified by `gridId`) hold **multiple named layouts** — saved,
switchable configurations — on top of a thin **grid-level baseline**. A layout is a
self-contained view of the grid: which columns are shown/ordered/sized/pinned, its
filters, sort, grouping, pivot, side-bar state, conditional-styling rules, column
groups, calculated columns, and data-colour styling. Grid options and editing rules
have a grid-level default that any layout may override. There is always a **'Default'**
layout. Layouts persist with the grid (localStorage keyed by `gridId`) and can be
imported/exported as JSON.

Non-goal for this cycle: built-in layout-switcher UI. The deliverable is the API + data
model + persistence; the app builds its own switcher. We will exercise it end-to-end in
`apps/cgrid-customizer-demo` with a small demo control (not shipped as grid chrome).

## 2. Concepts

Two tiers, both keyed by `gridId`:

- **Grid-level baseline (shared defaults):** editing rules and grid options. These are
  the grid's defaults. A layout MAY override either; when it doesn't, the baseline applies.
- **Layout (per named layout — self-contained):** everything else —
  - **View state:** column visibility / order / width / pinning, filters, sort, row
    grouping + expansion, pivot mode + columns, side-bar (opened panel + visible), scroll,
    cell/row selection.
  - **Layout-owned engine modules:** conditional-styling rules, column groups, calculated
    columns (see §5 for the module-tier mechanism).
  - **Styling:** data-colour token overrides (`themeParams`).
  - **Overrides:** grid options and editing rules that override the grid-level baseline.

**Effective config while layout `L` is active:**
1. Start from the grid-level baseline (editing rules + grid options).
2. Layer `L.overrides` (grid options + editing) on top.
3. Apply `L.state` (view state + layout-owned modules + `themeParams`).

## 3. Relationship to existing state APIs

This feature is built on the existing `getState()` / `setState()` / `GridState` and the
`registerStateModule` registry — it does not invent a parallel snapshot system.

- A layout's `state` is a `GridState` **restricted to the layout tier**: all view-state
  fields plus the layout-tier module slices (§5). It excludes grid-level module slices and
  carries grid-option/editing overrides separately.
- `loadLayout` = apply the grid-level baseline for the grid-tier slices, then
  `setState(...)` the layout's view + layout-tier modules, with the layout's overrides layered
  onto grid options / editing.
- `getConfig()` / `getState()` are unchanged. Layouts get their own API surface; the full
  bundle is `exportLayouts()`.

## 4. Data model

```ts
/** One saved layout. `id: 'default'` is reserved for the always-present Default. */
interface GridLayout {
  id: string;
  name: string;
  /** View state + layout-tier module slices + themeParams. A GridState subset. */
  state: LayoutState;
  /** Overrides of the grid-level baseline. Absent/empty → inherit the baseline. */
  overrides?: {
    /** Grid-option deltas from the baseline (reuses runtimeTouchedOptions semantics). */
    gridOptions?: Record<string, unknown>;
    /** Editing-rules override (the `editSettings` module envelope). */
    editing?: ModuleStateEnvelope;
  };
  updatedAt?: number; // epoch ms, set by the API on save/update (main-thread Date.now)
}

/** LayoutState = GridState minus grid-tier slices, minus the fields folded into
 *  `overrides`. Concretely: columnState, filterModel, sortModel, rowGroupColumns,
 *  expandedRouteIds, pivotMode, pivotCols, sideBar, cellSelection, rowSelection,
 *  scroll, themeParams, version, and `modules` restricted to layout-tier ids. */
type LayoutState = Omit<GridState, 'gridOptions'> & { modules?: Record<string, ModuleStateEnvelope> };

/** The full persisted / exportable bundle for a grid. */
interface GridLayoutsBundle {
  version: number;             // bundle schema version (starts at 1)
  activeLayoutId: string;      // id of the active layout; always present in `layouts`
  layouts: GridLayout[];       // always includes { id:'default', name:'Default' }
  grid: {                      // grid-level baseline (shared defaults)
    gridOptions?: Record<string, unknown>;
    editing?: ModuleStateEnvelope;
  };
}
```

Notes:
- `LayoutState.modules` holds only **layout-tier** module envelopes; grid-tier module
  envelopes (editing) live under `grid.editing` / `overrides.editing`, never in
  `LayoutState.modules`.
- Timestamps are optional and main-thread only (`Date.now()` in the API layer). Tests
  assert presence/monotonicity, not exact values.

## 5. Module tiers

State modules (registered via `registerStateModule`) are split into tiers by **id**:

- **Grid-tier module ids** — a configurable set. **Default: `{ 'editSettings' }`.**
- **Layout-tier** — every other registered module id (default includes `columnGroups`,
  and future `calc` / conditional-format rule modules automatically).

Rationale: the tier is data, not code — as calc and conditional-formatting become
registered state modules, they are layout-tier by default with no change to the layout
engine. The grid-tier set is overridable via a construction option (`layoutGridLevelModules?: string[]`)
so an app can, e.g., move editing to the layout tier.

`snapshot()` / `restore()` on `ModuleStateRegistry` gain tier-aware variants (or the
LayoutManager filters the existing snapshot by id), so:
- Saving a layout captures only layout-tier module envelopes.
- Saving the grid baseline captures only grid-tier module envelopes.
- `loadLayout` restores layout-tier modules from the layout and leaves grid-tier modules
  on the baseline unless the layout's `overrides.editing` is present.

### Known dependency — calc + conditional-format modules

Today only `columnGroups` (layout-tier) and `editSettings` (grid-tier) are registered
state modules. **Conditional-styling rules** (currently colDef `cellClassRules` /
`cellStyle`, i.e. part of `columnDefs`) and **calculated columns** (seeded from
`opts.calculatedColumns`, held in `CalcEngine`, not currently in `GridState`) do NOT yet
round-trip through `getState()`.

For a layout to actually capture conditional styling and calculated columns, those must be
expressed as **layout-tier registered state modules**. This spec includes, as in-scope
work, registering:
- a **`calc`** state module (from `@cgrid/calc`) whose `get`/`set` snapshot & restore the
  CalcEngine's calculated-column definitions, and
- a **conditional-format / `rules`** state module for runtime conditional-styling rules.

If either proves larger than a thin snapshot/restore wrapper, it is sequenced as its own
task in the plan and the layout engine ships first (it already captures `columnGroups` +
view state + `themeParams` + editing/grid-option overrides). The layout engine is designed
so these slices light up automatically once their modules register.

## 6. Grid-option override model

Grid options have a grid-level baseline and per-layout overrides:

- **Baseline** = the options the grid was constructed with (plus any explicitly set as the
  grid-level default via `setGridConfig`).
- **Layout override** = `runtimeTouchedOptions` while that layout is active — i.e. options
  changed from the baseline. This reuses the exact semantics that `getState().gridOptions`
  already produces ("changed from what the app configured").

`loadLayout(id)`:
1. Reset runtime-touched options back to the baseline (re-apply baseline values for any
   currently-overridden keys).
2. Apply `layout.overrides.gridOptions` on top.

`saveLayout` / `updateLayout` capture `overrides.gridOptions` = the current
`runtimeTouchedOptions` snapshot.

Only runtime-mutable option keys participate (initial-only keys can't differ per layout on a
live grid). This is enforced by routing through `setGridOption`, which already rejects
initial-only keys.

## 7. API surface (on `CGridApi`)

Management:
- `getLayouts(): GridLayout[]` — all layouts (incl. Default), in order.
- `getActiveLayoutId(): string`
- `getActiveLayout(): GridLayout`
- `saveLayout(name: string, opts?: { activate?: boolean }): GridLayout` — snapshot the
  current view + layout-tier modules + `themeParams` + grid-option overrides as a NEW layout
  (generated id). `activate` defaults to `true`.
- `updateLayout(id?: string): GridLayout` — overwrite an existing layout (default: active)
  with the current view state.
- `loadLayout(id: string): void` — make `id` active and apply it (§6 steps + `setState`).
- `deleteLayout(id: string): void` — remove; throws/no-ops on `'default'`; if the active
  layout is deleted, falls back to Default.
- `renameLayout(id: string, name: string): void`
- `duplicateLayout(id: string, name: string, opts?: { activate?: boolean }): GridLayout`
- `resetLayout(id?: string): void` — reset a layout (default: active) to the grid's
  construction baseline view state. For `'default'`, resets to baseline.

Grid-level baseline:
- `getGridConfig(): { gridOptions?; editing? }`
- `setGridConfig(config): void` — set the shared baseline (editing rules + grid options).

Import / export (JSON round-trippable):
- `exportLayout(id: string): GridLayout`
- `exportLayouts(): GridLayoutsBundle` — full bundle (all layouts + active + grid baseline).
- `importLayout(layout: GridLayout, opts?: { activate?: boolean; overwrite?: boolean }): GridLayout`
  — add one; new id on collision unless `overwrite`.
- `importLayouts(bundle: GridLayoutsBundle, opts?: { replace?: boolean }): void` — merge
  (default) or replace all. `replace` keeps a Default if the bundle omits one.

Events:
- `layoutChanged` — fired on active-layout switch, save, update, delete, rename, import.
  Payload: `{ activeLayoutId, source }`. Lets an app's switcher UI stay in sync.

## 8. Default layout semantics

- Always present: `{ id: 'default', name: 'Default' }`.
- Seeded from the **construction baseline** (the initial view state / `initialState`) at
  first run.
- Can be updated (`updateLayout('default')`) and reset (`resetLayout('default')` → back to
  the construction baseline, which the manager retains internally).
- Cannot be deleted or renamed away from id `'default'` (display name is editable).
- A fresh grid with no persisted layouts starts as `layouts: [Default]`, `active: 'default'`.

## 9. Construction options

Added to `CGridOptions`:
- `layouts?: GridLayout[]` — seed layouts. If none includes `id:'default'`, a Default is
  synthesized from the construction baseline and prepended.
- `activeLayoutId?: string` — which layout is active at mount (default `'default'`).
- `layoutGridLevelModules?: string[]` — module ids that are grid-tier (default
  `['editSettings']`).

## 10. Persistence

Layouts persist through the existing `persistState` mechanism (localStorage keyed by
`gridId`), so they survive reload automatically.

- The persisted blob is extended to carry the layouts bundle alongside the active state.
  Approach: fold the bundle under a reserved `layouts` field on the saved object
  (`{ ...activeGridState, layouts: GridLayoutsBundle }`) so the existing
  `StateStorageAdapter.save(gridId, state)` signature is unchanged; the LayoutManager
  consumes `state.layouts` on load and normal view-restore ignores it.
- Autosave: layout mutations (save/update/delete/rename/import/switch) mark the state bus
  dirty, so the debounced autosave persists the bundle. The active layout's live view also
  autosaves as today.
- On construction with `persistState`, restore precedence: persisted bundle (if present) >
  `options.layouts` > synthesized Default.

## 11. Error handling / edge cases

- Unknown `id` in load/delete/rename/duplicate/export → throw a clear error (or documented
  no-op for load — decide in plan; lean throw for programmer errors).
- Deleting the active layout → fall back to Default and fire `layoutChanged`.
- Deleting/renaming-id of `'default'` → rejected.
- Import with colliding ids → new id unless `overwrite`.
- Import of a forward-version bundle → migrate (mirror `migrateSnapshot`); unknown fields
  preserved-or-dropped per slice, never crash.
- Layout `state` restore degrades gracefully per-slice (reuses `setState`'s per-field
  tolerance).

## 12. Testing

Unit:
- Save → new layout appears; load applies its view state; Default always present + undeletable.
- `loadLayout` restores layout-tier modules (columnGroups) but leaves grid-tier (editSettings)
  on the baseline unless overridden.
- Grid-option override: change an option under layout A, save; switch to Default (baseline
  restored); switch back to A (override re-applied).
- Import/export round-trip (single + bundle); collision handling; replace vs merge.
- Persistence: mutate layouts → reload a grid with the same `gridId` → layouts + active restored.
- Default reset returns to construction baseline.

Integration (customizer-demo, browser-verified):
- Save a layout with hidden columns + a filter + a sort + a data-colour tweak; switch to
  Default; switch back; export to JSON, re-import into a fresh grid.

## 13. Out of scope (this cycle)

- Built-in layout-switcher grid chrome / options-editor UI (app builds its own; demo gets a
  minimal control).
- Server-side / cross-device sync (import/export JSON is the interchange).

## 14. Open implementation notes

- Extract a `LayoutManager` (new `core/layoutManager.ts`) that owns the layouts registry,
  active id, baseline retention, tier filtering, and persistence-bundle assembly. CGrid
  delegates the API methods to it, passing thin accessors (getState/setState,
  runtimeTouchedOptions, module registry snapshot/restore, baseline options). Keeps CGrid
  thin and the manager unit-testable in isolation.
- Reuse `migrateSnapshot` / the version-migration pattern for the bundle.
- `themeParams` are per-layout (agreed): a layout can restyle data colours; conditional-format
  rules remain layout-tier modules.
