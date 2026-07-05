# Grid Layouts + Styling Templates — Session Worklog

**Purpose:** carve the layouts + templates + conditional-rules work into SMALL units, each
sized for one modest session, so this can be executed across many fresh sessions without
carrying the full history in context. Written 2026-07-05 (the design session grew large).

**Spec (source of truth):** `docs/superpowers/specs/2026-07-05-grid-layouts-design.md`
(approved). Read it first, every session.

## How to run a session (read every session)

1. **Recover state:** read the spec + this worklog + the Progress tracker at the bottom
   (tail = truth). `git log --oneline -8`. Trust the ledger over memory.
2. **Fresh branch first:** sync main ff-only, then `git switch -c <phase-branch>` (one branch
   per phase, e.g. `feature/grid-layouts-a`). Never implement on main. Stash-first if the
   tree is dirty; NEVER `reset --hard` over a dirty tree.
3. **Durability:** every artifact goes in the repo (docs/ or committed code), never the
   session scratchpad. Commit per task on the phase branch; commit worklog/spec edits to main.
4. **Review cadence (USER DIRECTIVE — don't over-review):** NO per-task reviewers. ONE
   closeout review over the whole phase's task batch at the end of the phase, then one fix
   wave. (Matches the standing batch-review directive.)
5. **Verification gates every phase:** kernel unit suite green (`npm run build && npx vitest
   run` in `packages/kernel`); typecheck clean; then rebuild kernel and **browser-verify in
   `apps/cgrid-customizer-demo`** (port 5187, live STOMP, `window.__cgapi`/`__cgrid` hooks) —
   reset saved state first, and **kill the automation browser + dev server when done**. UI
   features need an E2E, not just unit tests.
6. **Session end:** append a Progress-tracker ledger line (what completed, commits, next unit).

## Baselines (main @ current)

Run `npx vitest run` in `packages/kernel` to confirm before starting (≈2780 kernel tests as
of the design session). Prior merged work this session: StarUI theme, options-editor
floating-filter/side-panel switches, `getConfig`/`setConfig`. No pending layout code yet —
only the spec + this worklog.

**Existing foundations to build ON (do not reinvent):**
- `getState()`/`setState()` + `GridState` + `ModuleStateRegistry` (`registerStateModule`) —
  layouts are tiered snapshots over these.
- `runtimeTouchedOptions` = per-layout grid-option deltas (§7).
- `@cgrid/calc`: `ColumnTemplate`, `ColumnOverride.templateIds`, `foldTemplateChain` (the
  template cascade), CalcEngine (calculated columns) — Phase B extends these.
- Registered modules today: `columnGroups` (layout-tier), `editSettings` (grid-tier).
- `persistState` / `statePersistence.ts` (localStorage keyed by `gridId`).

---

## PHASE A — Layout engine (branch `feature/grid-layouts-a`)

Delivers save/switch/import/export named layouts + Default, persisted. Works with what
round-trips TODAY (view state, `columnGroups`, `themeParams`, grid-option + editing
overrides). No calc/rules dependency. Spec §§4–12.

| Unit | Scope | End state |
|------|-------|-----------|
| **A1** | Types (`GridLayout`, `GridLayoutsBundle`, `LayoutState`) + new `core/layoutManager.ts`: registry, active id, construction-baseline retention, Default invariants. Pure unit tests with mock accessors (save/load/delete/rename/duplicate/reset; Default undeletable; active-delete→Default fallback; unique-name enforcement). | LayoutManager unit-tested in isolation |
| **A2** | Module-tier filtering (grid-tier set default `{editSettings}`; layout-tier snapshot/restore) + grid-option override capture (from `runtimeTouchedOptions`) & apply (reset-to-baseline then layer overrides). Unit tests. | Tier split + option override proven |
| **A3** | CGrid wiring: delegate API methods (getLayouts/getActiveLayoutId/getActiveLayout/saveLayout/updateLayout/loadLayout/deleteLayout/renameLayout/duplicateLayout/resetLayout/getGridConfig/setGridConfig) to LayoutManager via thin accessors; add to `CGridApi` + api wiring; construction opts (`layouts?`, `activeLayoutId?`, `layoutGridLevelModules?`); `layoutChanged` event. Kernel integration tests (mount → save → mutate view → load → view restored, grid-tier modules untouched). | API live + round-trips on a real grid |
| **A4** | Import/export: `exportLayout` (bundles referenced template defs — stub until Phase B), `exportLayouts`, `importLayout(s)` (collision→new id unless overwrite; replace vs merge); bundle version + `migrateSnapshot`-style migration. Unit tests. | JSON round-trip + migration |
| **A5** | Persistence: fold bundle under reserved `layouts` field of the persisted blob; restore precedence (persisted > `options.layouts` > synthesized Default); mutations mark the state bus dirty → autosave. Kernel persistence round-trip test. | Layouts survive reload |
| **A6** | Minimal demo control in `cgrid-customizer-demo` (save / select / delete / export / import layouts); browser-verify (light+dark; reset state; kill browser after) + 1–2 E2E. **SINGLE Phase-A closeout review** (fable) + fix wave. PR + squash-merge; ff-only sync; ledger. | Phase A MERGED |

## PHASE B — Styling templates (branch `feature/grid-layouts-b`, off merged A)

Normalize static styling into the shared template library so column defs stay light and
templates ride in layouts. Extends `@cgrid/calc`. Spec §3.1, §3.4, §5–§6.

| Unit | Scope | End state |
|------|-------|-----------|
| **B1** | Register `templates` state module (grid-tier) = the calc template library snapshot/restore (`ColumnTemplate[]`); register `calc` state module (layout-tier) = calculated-column definitions from CalcEngine. Unit tests: both round-trip through getState/setState. | Templates + calc defs persist |
| **B2** | Auto-template-on-edit in calc: editing an editable column attr writes to that column's own `<col>_template` (create-if-absent, unique name), assign its id to the column's `templateIds`; consumer-edit never mutates a shared template (forks to own). Column state carries `templateIds`. Unit tests (calc engine + cascade order). | Auto-template rule proven |
| **B3** | Template API on `CGridApi` (getTemplates/saveTemplate/renameTemplate[unique]/deleteTemplate/applyTemplate/removeTemplate) via the calc bridge; `templatesChanged` event. Reconcile against the existing calc bridge surface (don't fork it). Tests. | Template API live |
| **B4** | Export portability: `exportLayout` bundles the template defs its columns reference; import re-materializes them. Layouts round-trip template assignments + library. Tests. | Portable layout export w/ templates |
| **B5** | Demo (apply template; edit a column → auto-template; reuse a template across columns; calc column styled by a template, stays non-editable); browser-verify. **SINGLE Phase-B closeout review** + fix wave. PR + merge; sync; ledger. | Phase B MERGED |

## PHASE C — Conditional styling rules (branch `feature/grid-layouts-c`, off merged B)

New subsystem: expression → style, targeting rows/columns; layout-tier. Spec §3.2, §3.3.

| Unit | Scope | End state |
|------|-------|-----------|
| **C1** | `ConditionalRule` model + rule store + `rules` state module (layout-tier). Expression compiled via the calc AST/watched-colId engine (reuse; no second parser). Unit tests: eval truthiness + watched-column tracking. | Rule store + eval |
| **C2** | Render-time application: painter layers conditional-rule style over the template-resolved base by `priority`; target = whole row or `colIds` set. Integration tests (a rule paints the right cells). | Rules render |
| **C3** | Rules API on `CGridApi` (add/update/delete/enable/reorder) + events; rules ride in the layout (`rules` module) so they round-trip + import/export. Tests. | Rules API + round-trip |
| **C4** | Demo (create a rule → row/column restyle; per-layout rule sets); browser-verify + E2E. **SINGLE Phase-C closeout review** + fix wave. PR + merge; sync; ledger. | Phase C MERGED — feature complete |

## Standing constraints (all sessions)

- Reuse existing engines: expression eval via calc AST; template cascade via `foldTemplateChain`;
  snapshots via `getState`/module registry. Do not build parallel systems.
- `colId` vocabulary; caption (`headerName`) + identity are ALWAYS column-unique (never templated).
- Calculated columns are first-class (column state, templates, rule targets) but forced
  `editable:false`.
- Kernel perf tests are CPU-flaky under load → re-run standalone before trusting a red.
- customizer-demo dev server on :5187; reset saved state before demos; kill the automation
  browser + server when done.

## Progress tracker (update every session)

- [x] A1 · [x] A2 · [x] A3 · [x] A4 · [x] A5 · [ ] A6 (Phase A merged)
- [ ] B1 · [ ] B2 · [ ] B3 · [ ] B4 · [ ] B5 (Phase B merged)
- [ ] C1 · [ ] C2 · [ ] C3 · [ ] C4 (Phase C merged)

**Next unit: A6.** (Phase A branch `feature/grid-layouts-a` — the CLOSEOUT: demo control in
`cgrid-customizer-demo` + browser-verify + 1–2 E2E, SINGLE Phase-A review (fable) + fix wave,
PR + squash-merge.)

### Ledger

- **2026-07-05 · A1 done** (branch `feature/grid-layouts-a`, off `origin/main` @ `abbb155`).
  - `packages/kernel/src/types/layout.ts` — `LayoutState` (= layout-tier `GridState`),
    `GridLayout`, `GridLayoutsBundle`, `DEFAULT_LAYOUT_ID`; reuses `@cgrid/calc`'s
    `ColumnTemplate` (no parallel type). Re-exported from the `types.ts` barrel.
  - `packages/kernel/src/core/layoutManager.ts` — pure `LayoutManager` over an injected
    `LayoutManagerHost` (`captureState`/`applyState`/`newId`/`now`): registry, active id,
    construction-baseline retention, Default invariants. Full op surface
    (get/save/update/load/delete/rename/duplicate/reset).
  - `packages/kernel/tests/layoutManager.test.ts` — 31 mock-accessor unit tests
    (save/load/delete/rename/duplicate/reset; Default undeletable; active-delete→Default
    fallback + re-apply; unique-name (trimmed, case-insensitive); value-semantics/defensive
    clones; construction Default synthesis + activeId fallback).
  - **Scope boundaries honored:** `overrides` (grid-option/editing deltas) carried but NOT
    captured (→ A2); no persistence (→ A5); no CGrid wiring / events (→ A3).
  - **Design calls (flagged for A2/A3 review):** (1) `saveLayout` activates by default
    (capture == live view, no re-apply); `duplicateLayout` does NOT (copy may differ from
    screen). (2) Default's DISPLAY NAME is renamable per §9 (only the id is fixed) —
    reconciling §9 vs §12's "reject renaming id of 'default'". (3) name uniqueness is
    case-insensitive + trimmed.
  - **Verify:** kernel typecheck clean; full suite 2814 pass (lone red =
    `aggIncremental.perf.test.ts`, CPU-flaky, passes standalone). No UI in A1 → no
    browser-verify (that's A6).
  - **Note:** ledger committed on the phase branch (main working tree had unrelated
    uncommitted work); reaches main when Phase A merges at A6.

- **2026-07-05 · A2 done** (branch `feature/grid-layouts-a`).
  - `packages/kernel/src/types/layout.ts` — added `DEFAULT_GRID_LEVEL_MODULES`
    (`['editSettings','templates']`, the §10 `layoutGridLevelModules` default; `templates`
    filtered pre-emptively — no-op until Phase B registers it).
  - `packages/kernel/src/core/layoutManager.ts` — module-tier filtering + grid-option
    override capture/apply:
    - Pure exports `toLayoutTierState(full, gridLevelIds)` (drops grid-tier module slices +
      `gridOptions`; keeps view state / layout-tier modules / `themeParams` / `columnState`)
      and `extractGridOptionOverride(full)`.
    - `captureState()` now returns the FULL snapshot; capture (save/update) tier-filters it
      into `state` and lifts option deltas into `overrides.gridOptions` (recapture clears a
      stale delta). Synthesized Default seeded from the baseline's layout tier.
    - Apply (load/fallback/reset) re-injects `overrides.gridOptions` into the applied
      snapshot; **host `applyState` owns the reset-to-baseline half of §7** (kernel `setState`
      layers options additively — verified cgrid.ts:7698 — so the host must clear runtime
      options to baseline first; wired in A3). New `layoutGridLevelModules` init option.
  - `packages/kernel/tests/layoutManagerTier.test.ts` — 14 tests: pure tier-filter + option
    extraction; tier-aware capture (grid-tier excluded, options lifted, custom grid-level
    set, Default seeding); apply + **grid-option override round-trip across Default↔layout
    switches**; grid-tier slices never leak into an applied snapshot; reset clears overrides.
  - **Host contract change:** `captureState(): GridState` (full snapshot); `applyState` must
    reset runtime options to baseline before restoring. A1's mock host already returned a
    full state → all 31 A1 tests unchanged & green.
  - **Scope held:** `overrides.editing` still NOT captured (grid-tier `editSettings` stays on
    baseline; the editing-override refinement rides with Phase B). No CGrid wiring (→ A3), no
    persistence (→ A5).
  - **Verify:** typecheck clean; full suite 2826 pass (222 files). Unit-only (no UI in A2).

- **2026-07-05 · A3 done** (branch `feature/grid-layouts-a`).
  - **Types:** `types/event.ts` — `layoutChanged` event + `LayoutChangeSource`. `types/layout.ts`
    — `GridBaselineConfig` (reused by `GridLayoutsBundle.grid`). `types/options.ts` — construction
    opts `layouts?` / `activeLayoutId?` / `layoutGridLevelModules?`. `types/api.ts` — 12 methods on
    `CGridApi`. Barrel exports `GridBaselineConfig`, `DEFAULT_GRID_LEVEL_MODULES`, `LayoutChangeSource`.
  - **cgrid.ts wiring:** `LayoutManager` built lazily (`getLayoutManager`, eager call after
    `initialState` so baseline = as-built view) over a real host —
    `captureState = getState`, `applyState = applyLayoutSnapshot`, `newId = generateLayoutId`
    (crypto.randomUUID + counter fallback), `now = Date.now`. **`applyLayoutSnapshot` implements the
    §7 reset-to-baseline** the A2 host contract requires: reverts every runtime option the target
    doesn't override to its baseline (via new `optionBaselines`, captured lazily in `setGridOption`),
    un-records the touch, then `setState` layers the override. 12 delegating methods emit
    `layoutChanged` with a per-op `source`. `getGridConfig`/`setGridConfig` = grid-level baseline
    (option baseline apply + `editSettings`/`templates` module passthrough — templates a Phase-B
    no-op). 12 `makeApi` entries.
  - `packages/kernel/tests/layoutManagerApi.integration.test.ts` — 6 live-grid tests (fake
    worker+canvas harness): Default present + save + `layoutChanged`; **view-state (sortModel)
    round-trip with grid-tier module untouched + layout-tier restored**; **grid-option override
    round-trip across Default↔layout**; construction seeds; active-delete→Default fallback +
    Default-undeletable; `setGridConfig` baseline that `resetLayout` returns to.
  - **Design calls:** `layoutChanged` fires on ALL mutations (save/update/load/delete/rename/
    duplicate/reset/setGridConfig), always carrying the current `activeLayoutId`. Layout mutations
    do NOT yet mark the persist bus dirty (→ A5); layouts are NOT yet folded into the persisted blob
    (→ A5). `overrides.editing` still not captured (Phase B).
  - **Verify:** typecheck clean; `npm run build` clean; full suite **2832 pass (223 files)**;
    A1(31)+A2(14)+A3(6) green. Integration-tested on a real grid; browser-verify + demo is A6.

- **2026-07-05 · A4 done** (branch `feature/grid-layouts-a`).
  - `types/layout.ts` — `LAYOUTS_BUNDLE_VERSION` (=1). Barrel re-exports it.
  - `core/layoutManager.ts` — **grid baseline config moved into the manager** (owns
    `gridConfig`; `getGridConfig`/`setGridConfig` — merge gridOptions, replace editing/templates)
    so the exported bundle is self-contained + unit-testable. `migrateLayoutsBundle` +
    `LAYOUTS_BUNDLE_MIGRATIONS` (mirror `migrateSnapshot`: older migrates forward, newer throws).
    `exportLayout(id)` (templates stub `[]` until B4; unknown id throws), `exportLayouts()` (full
    bundle), `importLayout(layout, {overwrite})` (collision→new id unless overwrite; name
    uniquified to keep the invariant; per-layout `state` forward-migrated tolerantly),
    `importLayouts(bundle, {mode:'replace'|'merge', overwrite})` (replace swaps set+active+config,
    synthesizes Default if absent, dedupes names; merge folds in + merges config). Import methods
    are PURE (no host apply) — the live grid resync is CGrid's job.
  - `cgrid.ts` — dropped the local `gridBaseline`; `getGridConfig`/`setGridConfig` delegate to the
    manager (with a live editSettings/templates module overlay). `applyGridConfigLive` extracted +
    reused by import. 4 methods: `exportLayout`/`exportLayouts` (overlays live grid config),
    `importLayout` (activate→loadLayout applies), `importLayouts` (import → applyGridConfigLive →
    loadLayout(active) so the option baseline lands before the active view resets to it). 4 `makeApi`
    + `CGridApi` entries.
  - `tests/layoutManagerImportExport.test.ts` — 14 pure tests: export shape + defensive copy;
    exportLayout stub + unknown-throw; importLayout collision→new-id / overwrite-in-place /
    name-uniquify / state-migration; merge (keep existing, merge config, no active switch); replace
    (swap set+active+config, synth Default, keep bundle Default, unknown-active fallback); bundle
    newer→throw; **full JSON round-trip**. +2 live-grid integration tests (export→import into a
    fresh grid restores view + option override; importLayout{activate} applies).
  - **Design calls:** `importLayout(s)` PURE in the manager (activation/live-apply orchestrated by
    CGrid). Import names are uniquified (never rejected — import must not drop a layout). CGrid
    import emits a single `layoutChanged` source `'import'`.
  - **Scope held:** layouts still NOT folded into the persisted blob / no autosave-dirty (→ A5);
    `exportLayout` templates stub (→ B4); `overrides.editing` not captured (Phase B).
  - **Verify:** typecheck + `npm run build` clean; full suite **2848 pass (224 files)**;
    A1(31)+A2(14)+A4-unit(14)+integration(8) green.

- **2026-07-05 · A5 done** (branch `feature/grid-layouts-a`).
  - **Save fold (spec §11):** CGrid's persistence `onStateUpdated` hook folds the bundle into the
    saved blob under the reserved `layouts` field — `{ ...getState(), layouts: exportLayouts() }`.
    `StateStorageAdapter.save` unchanged.
  - **Autosave-dirty:** `stateUpdatedBus` `EVENT_TO_KEY` now maps `layoutChanged → 'layouts'` (a
    virtual persist key added to the bus `StateKey` + the public `stateUpdated.changedKeys` union),
    so EVERY layout mutation (which already emits `layoutChanged`) dirties the bus → debounced
    autosave — even mutations that don't touch the live view (save/rename/delete-other/update).
  - **Restore + precedence:** new `restorePersistedBlob` (the persistence `applyState` hook) splits
    `{ layouts, ...viewState }`; when `layouts` is present it reseeds the manager via a PURE
    `importLayouts(replace)` (no event/apply) + `applyGridConfigLive`, then `setState(viewState)`
    restores the last-seen view on top. Persisted bundle thus wins over `options.layouts` (which
    only seeded the manager at construction) > synthesized Default. A blob with no `layouts` field
    (pre-A5 / never-used-layouts grids) restores as a plain view-state setState. Manager `baseline`
    stays the construction view, so `resetLayout` still targets the app default (not the persisted
    state).
  - **Tests:** +3 live-grid integration tests (fold+reload restores layouts + active + option
    override into a fresh grid; persisted > options.layouts; legacy no-`layouts` blob still
    restores). `statePersistence.test.ts` (controller unit) unaffected — the fold is at the CGrid
    seam, not in the controller/adapter.
  - **Scope held:** template-library persistence rides the same `layouts` bundle once Phase B
    registers the `templates` module; `overrides.editing` still Phase B.
  - **Verify:** typecheck + `npm run build` clean; full suite **2851 pass (224 files)**;
    layout tests: A1(31)+A2(14)+A4-unit(14)+integration(11) green. Phase-A engine (A1–A5) COMPLETE
    — A6 is the demo + browser-verify + closeout review + merge.

- **2026-07-05 · A6 (demo + browser-verify + E2E) done; review+merge in progress** (branch
  `feature/grid-layouts-a`).
  - **Public API surface:** `cgrid.ts` now re-exports the layout types (`LayoutState`,
    `GridLayout`, `GridLayoutsBundle`, `GridBaselineConfig`, `LayoutChangeSource`) + value consts
    (`DEFAULT_LAYOUT_ID`, `DEFAULT_GRID_LEVEL_MODULES`, `LAYOUTS_BUNDLE_VERSION`) from the public
    entry — they were only on the `types` barrel before, so `@cgrid/kernel` consumers (the demo)
    couldn't import them. Kernel `dist` rebuilt.
  - **Restore event:** `restorePersistedBlob` now emits `layoutChanged` (new source `'restore'`)
    after a persisted bundle reseeds the manager, so app switchers re-sync on reload. (Fills a real
    gap — the demo needs it; per no-retroactive-layering it's a kernel-level fix, not app glue.)
  - **Demo control** (`apps/cgrid-customizer-demo`): a "Layouts" cluster in the header — a `<select>`
    mirroring the active layout (re-synced on every `layoutChanged`, incl. `'restore'`) + Save
    (prompt→saveLayout), Delete (disabled on Default), Export (download bundle JSON), Import (file→
    importLayouts merge). Matches the demo's slate chrome; `.actions` now wraps. Zero feature code in
    the app — pure `@cgrid/kernel` API.
  - **Browser-verified** (customizer-demo :5188, live STOMP 5k rows, state reset first, light+dark,
    browser + dev server killed after): save→switch round-trips the view (Default clears sort,
    Blotter restores it); reload persists Blotter (active + view) via the restore event; export
    yields a valid v1 bundle; delete-active falls back to Default; NO console errors.
  - **E2E** `e2e/layouts.spec.ts` — 2 journeys (save+switch round-trip; persistence across reload),
    both green. `playwright.config.ts` port made env-overridable (`CGRID_DEMO_PORT`, default 5187)
    so the suite can target a running server when 5187 is taken by another worktree.
  - **Verify:** kernel typecheck + full suite **2851 pass (224 files)**; demo typecheck clean; E2E
    2/2. **Remaining:** SINGLE Phase-A closeout review (fable) + fix wave, then PR + squash-merge +
    ff-only sync → then check A6.
