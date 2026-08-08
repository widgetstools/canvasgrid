# Cycle 21i Phase 1 — Grid Options editor + basic formatting toolbar (2026-07-03)

Branch: `cycle21i/customizer`. Decisions: S0 recon notes
(`plans/notes/cycle-21i-customizer-recon.md`, D-A…D-H + execution model).
Tier: **everything in this phase is NATIVE** — vanilla DOM in
`@wellsfargo-starui/velocity-grid`, zero new dependencies, themed by `tokens.css` vars only.
Tested via the new zero-feature-code demo app on live STOMP data.

## 1. Deliverables (tasks)

### T1 — Demo testbed `apps/cgrid-customizer-demo`
Vite app, one full-viewport VelocityGrid. STOMP feed cloned from
`apps/cgrid-positions/src/stomp.ts` (ws://localhost:8081, snapshot +
applyTransactionAsync updates). `gridId: 'customizer-demo'`,
`persistState: true`, sideBar with columns/filters/gridOptions tabs,
formatting toolbar on, theme toggle (light/dark), reset-state button.
NO feature code — consumer API only (violations = missing kernel API,
fixed in kernel). Dev server port 5187.

### T2 — Kernel: `gridId` + `persistState` (D-H)
- `VelocityGridOptions.gridId?: string`; `persistState?: boolean |
  { adapter?: StateStorageAdapter; debounceMs?: number }`.
- `StateStorageAdapter { load(gridId): GridState|null|Promise<...>;
  save(gridId, state): void|Promise<void>; clear(gridId): void|... }`.
- Default adapter: localStorage, key `velocity-grid:state:<gridId>`.
- Autosave: subscribe the existing coalesced `stateUpdated` bus
  (velocityGrid.ts:499-504); debounce (default 500ms); write full snapshot.
- Restore: after first ready, `adapter.load()` → existing ordered
  `setState()`. `persistState` without `gridId` → dev warning, no-op.
- Public: `clearPersistedState()`. Last-write-wins; multi-tab is the
  adapter's concern.

### T3 — Kernel: settings-schema engine (native substrate for D-A/D-G)
- Types in `types/settingsSchema.ts`: `SettingsSection { id, title,
  bands: SettingsBand[] }`, `SettingsBand { id, title, fields }`,
  `SettingsField { key, label, type: 'switch'|'checkbox'|'text'|'number'|
  'select', options?, min?, max?, step?, hint?, get(), set(v) }`.
- Vanilla renderer `interaction/settingsForm/` → DOM per kernel
  conventions (createElement, `.vg-settings-*` classes, tokens.css vars
  incl. new `--vg-settings-*` tokens, dark+light).
- Behaviors: collapsible bands; free-text filter (match band title + field
  label/key — port of StarUI `fieldSchema.tsx` filter as pure functions);
  "modified only" toggle (field is modified iff `get() !==` its declared
  default); immediate-apply on change (no draft/save in Phase 1 — panel
  edits are live; revert = reset-state).
- Public now (D-G lands the full app-slice registration in a later phase;
  the renderer + types are built reusable from day 1).

### T4 — Kernel: Grid Options tool panel (native, built-in id `gridOptions`)
- Registered like columns/filters built-ins; tab icon `settings-2`;
  `SideBarDef.toolPanels: [..., 'gridOptions']` shorthand supported.
- Schema source of truth: `core/optionSchema.ts` NEXT TO
  `runtimeOptions.ts` — a declarative table over the runtime whitelist
  (label, band, control type, enum options, min/max) + the `defaultColDef`
  fan-out band (~27 fields writing patches into one
  `setGridOption('defaultColDef', …)`); CI-adjacent unit test asserts
  every whitelisted UI-relevant option appears in the schema (drift guard)
  with an explicit exclusion list (rowData, context, callbacks, aggFuncs,
  pinned row data, quickFilterText).
- Bands (~8): Appearance, Selection, Editing feedback, Clipboard & Fill,
  Grouping, Pivot, Quick Filter, Advanced. ~60 fields at launch.
- Read via `getGridOption` (exists, api.ts:384), write via
  `setGridOption`; panel subscribes to option-change effects and refreshes
  control values (e.g. state restore).

### T5 — Kernel: basic formatting toolbar (native top strip)
- New strip host `interaction/formatToolbar/` following the
  rowGroupPanel/pivotPanel host pattern; option
  `formatToolbarShow?: 'always'|'never'` (default 'never').
- Controls (quick-apply to the FOCUSED column, disabled when none):
  align left/center/right · number-format preset select (from
  `@wellsfargo-starui/velocity-grid-format` template registry when wired, built-in presets
  otherwise: General, #,##0, #,##0.00, 0%, £/$ currency, date) ·
  decimals − / + · bold · italic · fg color · bg color (native
  `<input type=color>` in Phase 1) · clear-formatting.
- State: new kernel `columnFormatting` slice — per-colId
  `{ align?, formatCode?, bold?, italic?, fg?, bg? }` — applied in the
  paint path via the existing cellStyle/format hooks, INCLUDED in
  `GridState` (first concrete module-state slice; forward-compatible with
  the D-C registry). Toolbar writes the slice; painter + persistence come
  free.
- Explicitly out of Phase 1: templates/library, popout, per-selection
  (multi-column) apply, CM6 anything — that's the enterprise composer.

### T6 — Demo wiring + gates
- Both themes screenshot set; E2E (new `apps/cgrid-customizer-demo/e2e`):
  option flip via panel → grid behavior changes; persistence round-trip
  (set options + formatting → reload → identical); formatting toolbar
  apply/clear; search + modified-only.
- Invariance: kernel suite (baseline 2581) green; existing showcase E2E
  untouched/green.

## 2. UX gates (user-facing checkpoints)
- **G1 (after T3+T4 first cut):** clickable Grid Options tab in the demo on
  live data, both themes — user tears it apart before polish.
- **G2 (after T5 first cut):** formatting toolbar hands-on.
- /frontend-design invoked before T3/T4 UI build and before T5 (standing
  rule); `docs/catalog/screenshots/` consulted for chrome conventions.

## 3. Sequencing
T1 → T2 (testbed shows persistence immediately) → T3+T4 → **G1** →
iterate → T5 → **G2** → iterate → T6 close-out. Single batched code
review at phase end per standing directive.
