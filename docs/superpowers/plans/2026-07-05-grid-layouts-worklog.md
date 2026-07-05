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

- [x] A1 · [x] A2 · [x] A3 · [x] A4 · [x] A5 · [x] A6 — **PHASE A MERGED** (squash `3da8e48` on main)
- [x] B1 · [x] B2 · [x] B3 · [x] B4 · [x] B5 — **PHASE B MERGED** (squash `b73ec62` on `origin/main`)
- [ ] C1 · [ ] C2 · [ ] C3 · [ ] C4 (Phase C merged)

**Next: PHASE C** (conditional styling rules — branch `feature/grid-layouts-c`, off merged B).
Phase B squash-merged locally into `main` and pushed (`3da8e48..b73ec62`, ff); tree was clean so
no PR needed. Two Phase-B deferrals carry into Phase C / tracking (see the B5 ledger entry): H2
the calc provider slot is a module-global singleton (multi-grid concern), M5 save-time
template-name uniqueness (spec §12 reconciliation). Also still open from Phase A: `overrides.editing`
capture; B2's StarUI-07 type-default-vs-spec-§3.3 reconcile. Phase C starts at C1 (see the Phase C
table): `ConditionalRule` model + `rules` layout-tier state module, expression via the calc AST.

<!-- Historical A6 note (Phase A now merged):
Phase A branch `feature/grid-layouts-a` — the CLOSEOUT: demo control in
`cgrid-customizer-demo` + browser-verify + 1–2 E2E, SINGLE Phase-A review (fable) + fix wave,
PR + squash-merge. -->

### Ledger

- **2026-07-05 · B5 done — Phase B COMPLETE on branch** (branch `feature/grid-layouts-b`;
  commits `bb25c29` switch-fix, `a377f38` editColumn+demo+E2E, `05b5eb7` review fix-wave).
  - **Carry-in RESOLVED (`bb25c29`):** exhaustive (layout-switch / persisted-restore) `setState`
    now CLEARS the layout-tier module slices the target omits — `ModuleStateRegistry.clearAbsent(present,
    preserve)` via `set(undefined)` (modules treat non-array as empty; `columnGroups` no-ops,
    unchanged), preserve = `layoutGridLevelModules ?? DEFAULT_GRID_LEVEL_MODULES`. So switching a
    styled layout → Default clears its calc cols + template assignments; grid-tier `templates` library
    survives. +3 registry unit +2 integration tests.
  - **`CGridApi.editColumn` (`a377f38`):** auto-template-on-edit (spec §3.1) promoted to the public API
    (was engine-only since B2) so the demo is a pure `@cgrid/kernel` consumer — routes through the calc
    provider (new optional `editColumn` on `CalcProviderShape` + bridge surface) → `CalcEngine.editColumn`;
    fires `templatesChanged`; no-op without calc.
  - **Demo (`a377f38`):** a "Templates" chrome cluster in `cgrid-customizer-demo` (matches the Layout
    cluster) — Apply $ (one template reused across 2 columns), Edit Yield (→ own auto-template), Calc col
    (a calculated column styled by the $ template, stays non-editable). Wires `@cgrid/calc`; library-size
    readout syncs on `templatesChanged` + `layoutChanged`; `__cgcalc` test hook. Browser-verified
    light+dark (chrome consistent; STOMP feed unavailable in this env → 0 rows, so cell styling wasn't
    visually exercised — behavior covered by E2E; dev server + automation browser killed after).
  - **E2E (`a377f38`):** `e2e/templates.spec.ts` +4 (apply/reuse; auto-template-on-edit; calc column
    non-editable; layout switch clears + restores the assignment). Full demo E2E **20/20**.
  - **SINGLE Phase-B closeout review (fable, batch over B1–B5) + fix wave (`05b5eb7`).** Verdict
    NEEDS-WORK → after the wave: ship. Fixed:
    - **[H1] Template/calc mutations never autosaved (spec §11 silent data loss).** `templatesChanged`
      wasn't in the bus `EVENT_TO_KEY` and the calc path emitted no mapped event, so save/rename/apply/
      editColumn/registerCalculatedColumn were lost on reload (bare `renameTemplate` the purest repro —
      no rebuild to piggyback on). Fix: map `templatesChanged → 'modules'` + `notifyModuleStateChanged('calc')`
      from `onCalcColumnsChanged`. Autosave arms only post-restore (statePersistence.ts:123), so no
      construction-time clobber. +2 persist round-trip tests.
    - **[M1]** `editColumn` returns `ok` through the provider; kernel gates the event → a rejected
      (non-compiling) edit fires no `templatesChanged`.
    - **[M2]** `getGridConfig` reads the LIVE library (`getTemplates`) when calc is wired, so an emptied
      library overrides stale `LayoutManager.gridConfig.templates` — a deleted template no longer
      resurrects in an export/reload.
    - **[M3]** `templates` module restore wraps each `saveTemplate` in try/catch (one bad def in a
      foreign bundle can't wipe the library mid-restore).
    - **[M4]** `importLayouts` merge materializes per-layout bundled defs into the live engine (a bundle
      of `exportLayout()` objects now resolves its assignments).
    - **[M6]** `CalcEngine.saveTemplate` strips `headerName` (caption never templated, spec §3.1) on
      every entry path. **[L3]** `editColumn` clones `cellStyle`. **[L5]** `clearAbsent` drops absent
      orphan slices. **[L2]** demo readout re-syncs on `layoutChanged`.
    - **DEFERRED (not merge-blocking, tracked here):** **[H2]** the calc provider slot
      (`core/calcSlot.ts`) is a MODULE-GLOBAL singleton — with multiple grids the template API routes to
      whichever wired calc last, and worse, writes+autosaves under the wrong `gridId`. Pre-existing (all
      of calc's fold path is global-slot); B3 turned it into a public API. Needs a per-instance slot
      before any multi-grid consumer. **[M5]** grid-wide unique template *names* are enforced only by
      `renameTemplate`, not `saveTemplate` (contradicts spec §12) — a design call: enforce in save (risks
      the idempotent re-save + own/synthetic-name cases) or amend the spec. Left for the user.
  - **Verify:** calc typecheck + suite **246** (14 files); kernel typecheck + `npm run build` clean;
    kernel full suite **2878 pass (229 files)**; demo typecheck clean; demo **E2E 20/20**.

- **2026-07-05 · B4 done** (branch `feature/grid-layouts-b`).
  - **Portable layout export w/ templates (spec §5/§8).** `exportLayout` now bundles the template
    defs the layout's columns reference (replacing A4's `[]` stub); importing into a fresh grid
    re-materializes them + restores the assignments.
  - **KEY GAP CLOSED — template assignments now round-trip.** Assignments (`ColumnOverride.templateIds`)
    live in the calc engine's override store, which B1 did NOT persist — so data-column template
    assignments didn't round-trip at ALL. B4 registers a new **layout-tier `columnOverrides` state
    module** in the calc bridge (`get` = `calc.getOverrides()`|undefined; `set` = REPLACE:
    `clearOverrides()` + `applyOverrides(next)`), mirroring B1's `calc` module. New engine method
    `CalcEngine.clearOverrides()` (added to bridge `SILENT_MUTATORS` → colDef rebuild on restore).
  - **DESIGN CALL (flag for B5 review):** the spec §5 says template assignments "ride in
    columnState"; this codebase keeps them in the calc override layer, so B4 persists them via the
    `columnOverrides` module rather than threading `templateIds` through the kernel column pipeline —
    the lower-risk choice, consistent with B1 (calc engine state → module). Reconcile in review
    (keep the module, or migrate `templateIds` into `CColumnState`).
  - **exportLayout collection (`layoutManager.ts`):** pure `collectReferencedTemplateIds(state)` walks
    the layout's `columnOverrides` module `templateIds` (deduped, dangling refs skipped); `exportLayout(id,
    library = gridConfig.templates)` resolves referenced defs from the library. `importLayout`
    re-materializes bundled defs into `gridConfig.templates` via `materializeTemplates` (**add-if-absent
    — a local same-id def is authoritative, never clobbered**) then strips `layout.templates` (runtime
    layouts carry no defs); `importLayouts` replace-path folds + strips per-layout too.
  - **cgrid wiring:** `exportLayout` passes the LIVE library (`getGridConfig().templates`);
    `importLayout` + `importLayouts` re-materialize defs into the LIVE engine via
    `materializeTemplatesLive` (add-if-absent `saveTemplate`) so an activated/merged layout's
    assignments resolve — replace uses the existing full `applyGridConfigLive`; merge folds
    `bundle.grid.templates` add-if-absent without disturbing the live view/library.
  - **Tests:** +3 calc engine (`clearOverrides`), +2 calc bridge (`columnOverrides` module round-trip +
    REPLACE + empty→undefined), +2 kernel pure (`exportLayout` bundles only referenced defs / skips
    dangling; `importLayout` add-if-absent + strip), +3 kernel integration
    (`templatePortability.integration.test.ts`: export→import into a fresh grid re-materializes def +
    restores assignment; same-id not clobbered; full-bundle replace round-trip). Updated the A4 stub
    assertion.
  - **Verify:** calc typecheck + suite **245** (14 files); kernel typecheck + `npm run build` clean;
    kernel full suite **2868 pass (227 files)** — no regressions.

- **2026-07-05 · B3 done** (branch `feature/grid-layouts-b`, commit `9a2870a`).
  - **Template API on `CGridApi` (spec §8)** — `getTemplates` / `saveTemplate` /
    `renameTemplate` / `deleteTemplate` / `applyTemplate(colId, templateId)` /
    `removeTemplate(colId, templateId)` + a `templatesChanged` event
    (`TemplateChangeSource` = save|rename|delete|apply|remove, carries `templateId`).
    Mirrors the Phase-A layout API shape (thin CGrid delegators + `makeApi` entries +
    a public re-export of `TemplateSaveInput` / `TemplateChangeSource`).
  - **Routing (no parallel path):** reuses the EXISTING calc DI slot. `CalcProviderShape`
    (`core/calcSlot.ts`) gains OPTIONAL template ops; the calc bridge's registered provider
    implements them (delegating to the engine); `CGrid.*` template methods call
    `getCalcProvider()?.<op>?.(...)`. Kernel stamps `Date.now()` (engine stays Date-free);
    no calc wired → `getTemplates()` returns `[]` and mutators no-op (no event). A failed
    `renameTemplate` (duplicate name) THROWS before the event fires.
  - **Engine additions (`packages/calc/src/calcEngine.ts`):** `renameTemplate(id, name,
    {now})` — the sole grid-wide unique-name gate (trimmed, case-insensitive; `saveTemplate`
    still guards ids only, as B2 left it); preserves `createdAt`, bumps `updatedAt`; throws on
    unknown id / empty name / name-in-use; rename-to-own-name allowed. `removeTemplate(colId,
    tid)` — inverse of `applyTemplate`; drops `tid` from the column's `templateIds`; last-removed
    leaves an EXPLICIT `[]` (opt out of typeDefault per the `ColumnOverride.templateIds`
    contract), library entry kept; no-op when no override / id absent.
  - **Bridge:** `removeTemplate` added to `SILENT_MUTATORS` (drops a template from a column's
    chain → changes `resolvedPatchFor` → kernel colDef rebuild); `renameTemplate` deliberately
    NOT (metadata-only, no colDef change → no rebuild). `getTemplates` uses the bridge-shadowed
    `listTemplates` (synthetic typeDefaults filtered; own `__cgridOwn:*` templates DO surface —
    they're reusable per B2).
  - **Known limitation (pre-existing calc architecture, flagged for review):** the calc provider
    slot is a MODULE-GLOBAL singleton (`core/calcSlot.ts`), so with multiple grids on a page the
    template API routes to whichever grid wired calc last. Not introduced by B3 (all of calc's
    fold path is global-slot); the B3 no-calc-degradation test resets the slot via
    `_resetCalcProvider_forTests()` for isolation. Leave as-is unless a multi-grid scenario bites.
  - **Tests:** `packages/calc/tests/templateApi.test.ts` +10 (rename: preserve/bump, unknown-id,
    empty-name, duplicate-reject, own-name-ok; remove: drop-from-chain, last→[], no-override no-op,
    id-absent no-op, siblings-unaffected); `bridge.test.ts` +2 (provider surface delegates +
    notifies with rename-not-notifying; duplicate-name reject); `packages/kernel/tests/
    templateApiKernel.integration.test.ts` +4 (save/rename/delete round-trip + events; duplicate
    rename throws + no event; apply/remove on a real column; no-calc degradation → `[]` + no-ops).
  - **Verify:** calc typecheck + suite **240** (14 files); kernel typecheck + `npm run build` clean;
    kernel full suite **2863 pass (226 files)** — no regressions, no perf-flaky red this run.

- **2026-07-05 · B2 done** (branch `feature/grid-layouts-b`).
  - **`CalcEngine.editColumn(colId, patch, { now })`** (`packages/calc/src/calcEngine.ts`) —
    auto-template-on-edit (spec §3.1). Merges an editable-attribute patch (`format`, `cellRenderer`,
    `editable`, `hide`, `width`, `cellStyle`; **`headerName` excluded** — caption is column-unique)
    into the column's OWN template `ownTemplateId(colId)` = `__cgridOwn:<colId>` (name
    `<colId>_template`, create-if-absent; `cellStyle` per-key merge, scalars last-wins; createdAt
    preserved, updatedAt bumped), and ensures the column's `templateIds` references it. Atomic:
    a non-compiling `format` returns `{ok:false, errors:[format-compile]}` and touches nothing.
    Returns `{ok, errors}` like `applyOverrides`.
  - **`resolvedPatchFor` reorders** the folded chain so the own template folds HIGHEST regardless of
    its position in `templateIds` (a shared template applied AFTER an edit still can't override it).
    New exports `ownTemplateId` / `isOwnTemplateId` / `ColumnEditPatch` from the calc index; `editColumn`
    added to the bridge's `SILENT_MUTATORS` so an edit triggers the kernel colDef rebuild.
  - **Key guarantee proven:** editing a column that has a SHARED template applied never mutates the
    shared template — it forks to the column's own (other consumers of the shared template are
    unaffected); the own template is itself reusable via `applyTemplate(ownId, [otherCol])`.
  - **Tests:** `packages/calc/tests/autoTemplateOnEdit.test.ts` +8 (own-template create + templateIds
    ref; successive-edit merge; cascade shared→own; shared-not-mutated + sibling-unaffected;
    own-highest-when-shared-applied-after; own-template reuse; bad-format atomic reject; headerName
    dropped).
  - **Design note (flag for Phase-B review):** the calc engine keeps its StarUI-07 type-default
    semantics — the type-default template applies ONLY when `templateIds === undefined`, so a column
    drops the type-default once it has any template (incl. its own on first edit). The grid-layouts
    spec §3.3 cascade lists type-default as an always-on base UNDER the templates; reconcile in review
    (kept existing behavior in B2 to avoid churning StarUI-07 tests — it's arguably correct that an
    explicitly-customized column no longer inherits the type fallback).
  - **Verify:** calc typecheck + suite **228** (13 files); kernel typecheck + suite **2859** (225) —
    no regressions.

- **2026-07-05 · B1 done** (branch `feature/grid-layouts-b`, off main `3da8e48` = merged Phase A).
  - **The calc bridge (`packages/calc/src/bridge.ts`) now registers two kernel state modules** so
    the template library + calc-column defs ride getState/setState + persistState + layouts:
    - `templates` (v1, **grid-tier** — its id is already in the kernel's `DEFAULT_GRID_LEVEL_MODULES`
      from A2): `get` = the bridge-shadowed `calc.listTemplates()` (synthetic typeDefaults filtered),
      undefined when empty; `set` = REPLACE (drop current library, re-`saveTemplate` each).
    - `calc` (v1, **layout-tier** — not in the grid-level set): `get` = `calc.listCalculatedColumns()`;
      `set` = REPLACE (remove current calc cols, `registerCalculatedColumn` each; invalid defs
      skipped + warned). **Tiering is automatic** — it keys off the module id; no extra wiring.
    - `KernelGridSurface` gains an OPTIONAL `registerStateModule?` (guarded call) so a minimal grid
      surface / pre-Phase-B kernel still wires (just doesn't persist these slices).
  - **Tests:** `packages/calc/tests/bridge.test.ts` +5 (register both ids; empty→undefined; synthetic
    typeDefaults excluded; set() round-trip into a fresh engine; set() REPLACE not merge).
    `packages/kernel/tests/layoutStateModulesCalc.test.ts` +2 (real CGrid + `wireIntoKernel`:
    getState→modules.templates+modules.calc, setState restores into a fresh wired grid; a saved
    layout carries layout-tier `calc` but NOT grid-tier `templates`).
  - **Known quirk (pre-existing calc):** `saveTemplate(now)` collapses `createdAt` onto `updatedAt`,
    so a template's original `createdAt` isn't preserved across restore (tests assert id/name/overrides).
  - **Carry-in still open (from A6):** generic layout-tier MODULE-slice clearing on layout switch —
    now that `calc` is a layout-tier module, switching to a layout without calc cols won't yet clear
    the outgoing layout's calc cols (setState exhaustive mode clears standard view fields, not
    modules). Address before B5 / when it bites (a switch integration test will expose it).
  - **Verify:** calc typecheck + suite (220) green; kernel typecheck + full suite **2859 pass (225
    files)**.

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

- **2026-07-05 · A6 closeout review (fable) + fix wave done** (branch `feature/grid-layouts-a`).
  One batch review over the whole A1–A6 diff (per the batch-review directive). It found 4 real
  bugs + 2 hardening items; all fixed and regression-tested:
  1. **[CRITICAL] View-state leak on switch.** `applyLayoutSnapshot` handed a sparse snapshot to
     the partial `setState`, so switching to a layout that OMITS a field left the outgoing layout's
     filter / pivot / side-bar / expanded / selection / scroll / themeParams in place (masked
     because every test used SORT, which rides `columnState` and coincidentally converges). Fix:
     `setState(snapshot, { exhaustive: true })` — a layout switch now CLEARS every view field the
     target omits (filter→{}, sort→[], rowGroups→[], pivot→off, expanded→collapse, selection→clear,
     side-bar→closed, scroll→0, themeParams→cleared). Public/partial `setState` unchanged. (Module
     slices still not cleared — grid-tier must survive + generic layout-tier module reset needs the
     registry; noted for Phase B, `columnGroups` is the only layout-tier module today.)
  2. **[HIGH] initialState option baseline lost.** Options set via `initialState` recorded a
     baseline of `undefined` (lazy pre-change capture ran before any layout existed), so switching
     to Default reset them to the KERNEL default. Fix: `getLayoutManager` seeds `optionBaselines`
     from the construction-time `runtimeTouchedOptions` (the app baseline).
  3. **[MEDIUM] merge import clobbered the live view.** `importLayouts` re-applied the active
     layout even in `'merge'` mode, discarding unsaved on-screen changes. Fix: only `'replace'`
     resyncs the live grid; `'merge'` folds layouts in without touching the view.
  4. **[MEDIUM-LOW] newer-version layout half-applied on load.** A tolerated newer `state` threw
     mid-`setState`, leaving activeId advanced + options reset. Fix: `applyLayoutSnapshot` migrates
     UP FRONT (throws before side effects) and `LayoutManager.loadLayout` commits `activeId` only
     AFTER a successful apply.
  5/6. **[hardening] Clone at boundaries** — `setGridConfig` / `applyGridConfigLive` now clone
     option-baseline values, and `getGridConfig` clones the live `editSettings`/`templates` module
     envelopes, so a consumer can't corrupt stored baselines or reach into live module state.
  - **Regression tests:** +4 kernel integration tests (filter round-trip on switch — the field that
    exposed #1; initialState baseline; merge preserves view; newer-state throws cleanly) and +1 E2E
    (filter round-trip). All green.
  - **Verify:** kernel typecheck + full suite **2855 pass (224 files)**; `npm run build` clean; demo
    E2E **3/3** (incl. the new filter round-trip). Review verdict was needs-work → after this fix
    wave: ship.
  - **Integration:** local squash-merge was NOT possible — the `main` checkout had uncommitted
    changes to `cgrid.ts` + `api.ts` (the files Phase A rewrote), which blocks a clean merge. So
    Phase A was pushed and opened as **PR #103** (https://github.com/widgetstools/canvasgrid/pull/103)
    for squash-merge on GitHub. Branch `feature/grid-layouts-a` (7 commits) + worktree preserved.
    Once #103 squash-merges, tick A6 and sync main ff-only.
