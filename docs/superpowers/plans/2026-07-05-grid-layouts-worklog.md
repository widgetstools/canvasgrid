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

- [x] A1 · [x] A2 · [ ] A3 · [ ] A4 · [ ] A5 · [ ] A6 (Phase A merged)
- [ ] B1 · [ ] B2 · [ ] B3 · [ ] B4 · [ ] B5 (Phase B merged)
- [ ] C1 · [ ] C2 · [ ] C3 · [ ] C4 (Phase C merged)

**Next unit: A3.** (Phase A branch `feature/grid-layouts-a` is live — continue A3 on it.)

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
