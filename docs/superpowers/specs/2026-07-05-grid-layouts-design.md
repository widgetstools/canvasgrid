# Grid Layouts + Styling Templates — design spec

**Date:** 2026-07-05
**Status:** Approved design; ready for implementation planning
**Branch:** `feature/grid-layouts`

## 1. Summary

Two related capabilities:

1. **Layouts** — a single grid (`gridId`) holds **multiple named, switchable layouts** on
   top of a thin **grid-level baseline**. A layout is a self-contained view: columns
   shown/ordered/sized/pinned, filters, sort, grouping, pivot, side-bar state, conditional
   styling rules, column groups, calculated columns, and which style templates each column
   uses. There is always a **'Default'** layout. Layouts persist with the grid and can be
   imported/exported as JSON.

2. **Styling templates** — static per-column styling/attributes are normalized into named,
   reusable **templates**. A column def stores only the **template IDs** it applies (plus
   truly column-unique attributes like caption). Editing any editable column attribute
   writes into that column's own auto-created template. This replaces loose inline per-column
   style overrides.

Non-goal this cycle: built-in switcher/template-manager UI. Deliverable is the API + data
model + persistence; the app builds its own UI. Verified end-to-end in
`apps/cgrid-customizer-demo` with a minimal demo control.

## 2. Concepts

**Grid-level (shared across all layouts):**
- **Template library** — the named `{ id, name, overrides }` style/attribute templates.
- **Editing rules** and **grid options** — baseline defaults. A layout may override either.

**Layout (per named layout — self-contained):**
- **View state** — column visibility/order/width/pinning, filters, sort, row grouping +
  expansion, pivot mode + columns, side-bar (opened panel + visible), scroll, selection.
- **Template assignments** — per column, the ordered `templateIds` it applies (part of
  column state).
- **Conditional styling rules** — expression → style, applied to a row or column set.
- **Column groups** and **calculated columns**.
- **Overrides** — grid options / editing rules that override the grid-level baseline.

**Column-unique (always on the column, never templated):** `colId`, `field`, caption
(`headerName`), and any identity-level attribute. These live in the column def / column
state, not in templates.

**Effective config while layout `L` is active:**
1. Grid-level baseline (editing + grid options).
2. Layer `L`'s overrides.
3. Apply `L`'s view state + template assignments + conditional rules + column groups + calc.

## 3. Styling model (templates + conditional rules)

### 3.1 Templates (static styling/attributes) — already ~80% in `@cgrid/calc`

`@cgrid/calc` already implements this and is the basis:
- `ColumnTemplate = { id, name, overrides }`, `overrides` ⊆
  `{ format, cellRenderer, editable, hide, width, cellStyle }` — **`headerName` is excluded**
  (caption is column-unique, per §2).
- `ColumnOverride = { colId, templateIds, … }` — the per-column assignment references
  `templateIds`.
- `foldTemplateChain()` defines the cascade: **type-default template → `templateIds`
  left-to-right → the column's own template (highest among templates)**; `cellStyle` merges
  per-key, scalars last-writer-wins.

**Auto-template-on-edit (new rule):** whenever a user edits an editable column attribute,
the change is written into that column's **own template**, auto-created on first edit with
name `"<columnName>_template"`. The column's `templateIds` includes its own template as the
highest-priority template layer. Consequences:
- The name is user-editable and **must be unique** grid-wide. The template **id** is a
  separate stable key; renaming changes only the display name.
- **Editing a column mutates only its own template.** Applying another column's/shared
  template to a column is read-only reuse; the instant that column is edited, the edit lands
  in the column's own template (created if absent), layered on top — so shared templates are
  never mutated as a side effect of editing a consumer column.
- A template (including an auto-created one) can be applied to other columns → reuse.

**Templatable attribute set:** `{ format, cellRenderer, editable, hide, width, cellStyle }`
(calc's set minus `headerName`). Extensible as more attributes become templatable.

### 3.2 Conditional styling rules (new subsystem)

A conditional rule = **expression over one or more columns' cell values → a resolved style**,
with a **target**: the whole row, or a specific set of columns.

```ts
interface ConditionalRule {
  id: string;
  name: string;
  expression: string;          // over cell values; compiled via the calc expression engine
  target: { kind: 'row' } | { kind: 'columns'; colIds: string[] };
  style: CellStyle;            // resolved style when the expression is truthy
  enabled?: boolean;
  priority?: number;           // higher wins when multiple rules hit the same cell
}
```

- **Reuses the calc expression engine** (AST, watched-colId tracking) for the expression —
  no second parser.
- Applied at **render time**, layered ABOVE static template styles (templates set the base
  look; conditional rules override on match). Multiple hits resolve by `priority`.
- Rules are a **layout-tier module** — each layout has its own rule set.

### 3.3 Render/precedence pipeline (per cell)

`type-default template → applied templates (templateIds L→R) → column's own template →
conditional rules (by priority)`. Column-unique attrs (caption) always come from the column.

## 4. Relationship to existing state APIs

Built on `getState()` / `setState()` / `GridState` and the `registerStateModule` registry —
not a parallel snapshot system.

- A layout's `state` is a `GridState` restricted to the **layout tier** (view state + layout-
  tier module slices + template assignments in column state), with grid-option/editing
  overrides carried separately.
- `loadLayout` = apply the grid baseline for grid-tier slices, then `setState(...)` the
  layout's view + layout-tier modules, layering the layout's overrides.
- `getConfig()` / `getState()` unchanged. Full bundle = `exportLayouts()`.

## 5. Data model

```ts
interface ColumnTemplate { id: string; name: string; overrides: TemplateOverrides; updatedAt?: number; }
// TemplateOverrides = { format?, cellRenderer?, editable?, hide?, width?, cellStyle? }

interface ConditionalRule { /* §3.2 */ }

interface GridLayout {
  id: string;                  // 'default' reserved
  name: string;
  state: LayoutState;          // view state (incl. per-column templateIds) + layout-tier modules + themeParams
  overrides?: { gridOptions?: Record<string, unknown>; editing?: ModuleStateEnvelope };
  /** Template defs referenced by this layout — populated on export for portability;
   *  empty at runtime (defs live in the grid-level library). */
  templates?: ColumnTemplate[];
  updatedAt?: number;
}

interface GridLayoutsBundle {
  version: number;
  activeLayoutId: string;
  layouts: GridLayout[];       // always includes { id:'default', name:'Default' }
  grid: {
    templates?: ColumnTemplate[];              // the shared template library
    gridOptions?: Record<string, unknown>;     // baseline
    editing?: ModuleStateEnvelope;             // baseline editing rules
  };
}
```

- Column state carries each column's `templateIds` (assignments) — layout tier.
- Conditional rules ride in `LayoutState.modules['rules']` — layout tier.
- Column groups (`columnGroups`) and calculated columns (`calc`) ride in
  `LayoutState.modules` — layout tier.
- The **template library** (`grid.templates`) is grid tier / shared.

## 6. Module tiers

Modules split by id:
- **Grid-tier ids (default):** `{ 'editSettings', 'templates' }`.
- **Layout-tier:** everything else — `columnGroups`, `calc`, `rules`, … (default + future).

Configurable via `layoutGridLevelModules?: string[]`. `loadLayout` restores layout-tier
modules from the layout and leaves grid-tier modules on the baseline unless the layout
overrides them.

### Dependencies (net-new module wiring)

Today only `columnGroups` (layout) and `editSettings` (grid) are registered state modules.
This feature additionally requires registering, as state modules:
- **`templates`** (grid-tier) — the calc column-template library (`@cgrid/calc` already holds
  the defs + `foldTemplateChain`; wrap its templates/overrides as a snapshot/restore module).
- **`calc`** (layout-tier) — calculated-column definitions from `CalcEngine` (not currently
  in `GridState`).
- **`rules`** (layout-tier) — the new conditional-styling rule store (§3.2).

The template-assignment normalization (columns store `templateIds`; editing writes to the
column's own template) also lands in `@cgrid/calc`, extending its existing override model so
the inline per-column override layer becomes the column's own auto-template.

If any of these grow beyond a thin wrapper, they are sequenced as their own plan tasks; the
layout engine ships first (it already captures view state, column groups, `themeParams`,
and option/editing overrides), and the styling slices light up as their modules register.

## 7. Grid-option override model

- **Baseline** = construction options (+ any set via `setGridConfig`).
- **Layout override** = `runtimeTouchedOptions` while that layout is active (deltas from
  baseline — same semantics `getState().gridOptions` already produces).
- `loadLayout(id)`: reset runtime-touched options to baseline, then apply
  `layout.overrides.gridOptions`.
- `saveLayout` / `updateLayout` capture `overrides.gridOptions` from `runtimeTouchedOptions`.
- Only runtime-mutable keys participate (enforced by `setGridOption`).

## 8. API surface (on `CGridApi`)

Layout management:
- `getLayouts()`, `getActiveLayoutId()`, `getActiveLayout()`
- `saveLayout(name, opts?: { activate? })`, `updateLayout(id?)`, `loadLayout(id)`
- `deleteLayout(id)` (rejects `'default'`; active→Default fallback), `renameLayout(id, name)`,
  `duplicateLayout(id, name, opts?)`, `resetLayout(id?)`

Templates:
- `getTemplates()`, `saveTemplate(t)`, `renameTemplate(id, name)` (unique-name enforced),
  `deleteTemplate(id)`, `applyTemplate(colId, templateId)`, `removeTemplate(colId, templateId)`
  — (thin surface over the calc template engine; final shape confirmed in the plan against
  the existing calc bridge API).

Grid baseline:
- `getGridConfig(): { templates?; gridOptions?; editing? }`, `setGridConfig(config)`

Import / export (JSON):
- `exportLayout(id)` — includes referenced template defs (portability), `exportLayouts()`
  (full bundle), `importLayout(layout, opts?)`, `importLayouts(bundle, opts?)`

Events:
- `layoutChanged` `{ activeLayoutId, source }` on switch/save/update/delete/rename/import.
- `templatesChanged` on template create/rename/delete/apply.

## 9. Default layout semantics

- Always present `{ id:'default', name:'Default' }`; seeded from the construction baseline.
- Updatable (`updateLayout('default')`) and resettable (`resetLayout('default')` → baseline).
- Cannot be deleted; id `'default'` fixed (display name editable, must stay unique).
- Fresh grid with no persisted layouts → `layouts: [Default]`, active `'default'`.

## 10. Construction options (`CGridOptions`)

- `layouts?: GridLayout[]`, `activeLayoutId?: string`
- `templates?: ColumnTemplate[]` (seed the library; calc already accepts `templates`)
- `layoutGridLevelModules?: string[]` (default `['editSettings', 'templates']`)

## 11. Persistence

- Layouts + templates persist via `persistState` (localStorage keyed by `gridId`). The
  saved blob folds the bundle under a reserved `layouts` field
  (`{ ...activeGridState, layouts: GridLayoutsBundle }`) so `StateStorageAdapter.save(gridId,
  state)` is unchanged; the manager consumes `state.layouts` on load, normal view-restore
  ignores it.
- Layout/template mutations mark the state bus dirty → debounced autosave.
- Construction restore precedence: persisted bundle > `options.layouts`/`templates` >
  synthesized Default.

## 12. Error handling / edge cases

- Unknown id (load/delete/rename/duplicate/export) → throw a clear error.
- Delete active layout → fall back to Default + `layoutChanged`.
- Reject deleting/renaming id of `'default'`.
- Duplicate template/layout name → reject (uniqueness enforced) with a clear error.
- Import colliding ids → new id unless `overwrite`; forward-version bundle → migrate
  (mirror `migrateSnapshot`), never crash; per-slice tolerant restore.
- Deleting a template still referenced by a column → drop the reference (calc already drops
  missing template ids in `foldTemplateChain`).

## 13. Testing

Unit:
- Layout save/load/delete/rename/duplicate; Default always present + undeletable.
- `loadLayout` restores layout-tier modules (columnGroups/rules/calc) but leaves grid-tier
  (editSettings/templates) on baseline unless overridden.
- Grid-option override round-trip across layout switches.
- Template model: editing a column auto-creates `<col>_template`; editing a column with a
  shared template applied does NOT mutate the shared template; unique-name enforcement;
  apply-to-other-column reuse; cascade order (type-default → templates → own → conditional).
- Conditional rule: expression truthy → style applied to row/target columns; priority
  resolution; enable/disable.
- Import/export round-trip (single layout carries its referenced templates; bundle).
- Persistence: mutate layouts/templates → reload same `gridId` → restored.
- Default reset → construction baseline.

Integration (customizer-demo, browser-verified):
- Save a layout with hidden columns + filter + sort + a template-styled column + a
  conditional rule; switch to Default; switch back; export a layout to JSON and re-import
  into a fresh grid (templates carried).

## 14. Out of scope (this cycle)

- Built-in layout-switcher / template-manager grid chrome (app builds it; demo gets a
  minimal control).
- Server/cross-device sync (import/export JSON is the interchange).

## 15. Open implementation notes

- New `core/layoutManager.ts` owns the layouts registry, active id, baseline retention, tier
  filtering, and persistence-bundle assembly; CGrid delegates API methods to it via thin
  accessors (getState/setState, runtimeTouchedOptions, module snapshot/restore, baseline).
- Templates + assignments extend the existing `@cgrid/calc` engine (`ColumnTemplate`,
  `ColumnOverride.templateIds`, `foldTemplateChain`); the plan reconciles the exact bridge
  API rather than inventing a parallel one.
- Conditional-rules render application layers over the template-resolved base in the painter
  pipeline; expression eval reuses the calc AST/watched-colId engine.
- Reuse `migrateSnapshot` for bundle versioning. `themeParams` per-layout (agreed).
