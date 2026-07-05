# Cycle 21i Phase 2 — Customizer foundations + intrinsic toolbar (2026-07-04)

Branch: `cycle21i/customizer-phase2` (base: `176d4a5`, main after Column
Groups editor merge #101). Recon: `plans/notes/cycle-21i-customizer-recon.md`.
Phase 1 (merged #100): demo testbed, `gridId`/`persistState`, settings-schema
engine, Grid Options panel. Column Groups editor merged separately (#101).

## 0. Decisions (locked 2026-07-04 with user)

- **D1 — No layering.** Engine capabilities land intrinsically in their
  owning packages; editor UI lands in `@cgrid/customizer` — a lockstep
  monorepo member with class-tier access, NOT an external addon over
  public hooks. Reaffirms Cycle 21 locked decision #1.
- **D2 — Lit in customizer only.** `@cgrid/customizer` adopts Lit +
  `@lit/context` (per the StarUI docs' prescribed stack) for editor
  surfaces. `@cgrid/kernel` chrome stays vanilla DOM + `tokens.css`
  vars, zero new dependencies. Monaco/SortableJS/lit-virtualizer enter
  customizer only, lazy where the docs say lazy.
- **D3 — Grandfathered panels.** Grid Options (#08) and Column Groups
  (#02) stay kernel-native. Kernel keeps panels that edit kernel-owned
  state and are already shipped; no migration churn.
- **D4 — Toolbar is a DOM strip, not a subgrid.** The intrinsic grid
  toolbar follows the rowGroupPanel/statusBar host + reserve-space
  pattern (`this.root` child + top inset so the canvas reflows). It is
  NOT part of the column/subgrid/canvas infrastructure (user
  architecture correction 2026-07-04, replacing the discarded
  `ToolbarSubgrid` attempt). Visible by default in every grid
  (`toolbar: false` opt-out), intrinsic save icon button + business-date
  picker pinned at the right edge.
- **D5 — Phase 2 scope.** Foundations (engine gaps every editor needs)
  + toolbar redo + `@cgrid/customizer` bootstrap + lightest panels
  (#09 Smart Edit settings, #10 Bulk Update settings) as the first Lit
  panels exercising the bridge end-to-end.

## 1. Remaining-21i roadmap (context — later phases, no deferral out of cycle)

- **Phase 3 — shared heavyweight editors** (customizer): ExpressionEditor
  (Monaco lazy, input fallback), StyleEditor, FormatterPicker (+ engine:
  per-column compiled-format read-back in `@cgrid/format`), TemplateManager
  (consumes Phase 2 module-state registry). ColorPicker reused from kernel.
- **Phase 4 — master-detail editors** (customizer): #01 Column Settings,
  #03 Calculated Columns, #04 Conditional Styling, #05 Alerts (+ bell
  popover), #06 Plus/Minus, #07 Shortcuts, #11 Data Change History
  (edit-journal monitor). Split 4a/4b by size at planning time.
- **Phase 5 — toolbars**: #13 Formatting Toolbar (+ kernel
  `columnFormatting` state slice — the Phase 1 T5 leftover — + poppable
  OS window), #14 Smart Edit, #15 Bulk Update, #16 Edit History, #17
  Filters pill row (+ engine: saved-filters store in kernel, which does
  not exist yet), #19 Toolbar Date Settings stripped to a row-filter
  panel.
- **Phase 6 — dialog**: #18 Column Selector (modal primitive from this
  phase; SortableJS enters here).
- **#12 Visual Excel** stays blocked on Cycle 21h export (parked at S1);
  it lands when 21h resumes, before Cycle 20.

## 2. Phase 2 deliverables

### T1 — Kernel: intrinsic toolbar strip host (D4)
- `interaction/toolbarHost.ts` following the RowGroupPanelHost /
  StatusBarHost pattern: DOM strip mounted on `this.root`, reserving
  vertical space at the VERY top of the grid (above top status bar →
  pivot panel → row group panel → headers) via a new `toolbarInset`
  folded into the existing inset chain (`applyInsets` path,
  cgrid.ts:5116-5161 vicinity).
- Options: `toolbar?: boolean` (default true — intrinsic, opt-out),
  `toolbarHeight?: number` (default 40). No subgrid, no canvas row.
- Intrinsic end-zone controls (right edge): business-date picker
  (native `<input type="date">`, defaults to today, themed via
  `--cg-input-*` tokens, native popup obeys theme `color-scheme`) and
  save icon button (Lucide Path2D-source SVG glyph, `currentColor`).
- Start-zone app API on the host (returned by `grid.getToolbar()`):
  `addButton`, `addIconButton`, `addDivider`, `addSpacer`, `addContent`,
  `clear` (clears start zone only), `updateHeight`, `setVisible`.
- Subscriptions: `onSave(cb)`, `onDateChange(cb)` (ISO `YYYY-MM-DD`),
  `getDate()`, `setDate(iso)`. Also emit typed grid events
  (`toolbarSave`, `toolbarDateChanged`) through the kernel event bus so
  non-DOM consumers can subscribe.
- Both demo apps show it with zero app code; positions app subscribes
  `onSave`/`onDateChange` as the reference usage.

### T2 — Kernel: module-state persistence registry (recon Tier A #5)
- `registerStateModule({ id, version, get, set })` — module slices fold
  into the `GridState` snapshot under a `modules: { [id]: { version,
  data } }` envelope (matches the ConfigManager profile-bundle shape the
  StarUI docs specify), restored in `setState`, autosaved through the
  existing `persistState` bus.
- Unknown/failed module slices restore gracefully (skip + dev warning),
  version field is the module's migration hook.
- Wire ONE existing slice through it as proof (column-groups overlay
  from #101 or sidebar panel widths) without breaking existing
  persisted-state round-trips (compat test: pre-Phase-2 snapshot still
  restores).

### T3 — Kernel: API widening + enumerations (recon Tier B + Tier A #1-3)
- Widen `makeApi()` with the class-only methods panels need:
  `getFilterModel`, `getState`/`setState`, `getSortModel`,
  `setThemeParams`/`getThemeParams` (exact list from recon Tier B).
- New enumerations: `listIcons()` on the icon registry;
  renderer-registry enumeration on a live grid instance; column
  group-tree traversal (walk the group hierarchy with open/closed +
  children — the recon's missing `forEachNode`-style walk, scoped to
  column groups which is what editors need).
- Document the two-tier contract: customizer panels code against
  `CGridApi` (now sufficient), class-tier reach requires justification.

### T4 — Kernel: modal/sheet primitive (vanilla)
- Generic host-managed modal surface (`interaction/modalHost.ts`):
  open/close, focus trap, ESC + backdrop dismiss, `--cg-*` themed,
  z-order above side bar/status bar, `prefers-reduced-motion` respected.
- Consumed later by #18 Column Selector and the Settings Sheet chrome;
  Phase 2 ships the primitive + a demo-app smoke usage only.

### T5 — `@cgrid/customizer` package bootstrap (D2)
- Fill the empty scaffold: Lit + `@lit/context` deps, vite lib build,
  lockstep versioning, `@cgrid/kernel` peer.
- Theming bridge: customizer components consume `--cg-*` tokens
  directly (no parallel `--ds-*` system; the StarUI token names map in
  a single bridge stylesheet).
- Settings-chrome subset needed by flat panels only (panel section,
  field row, switch, select, number — Lit ports of the kernel
  settings-schema vocabulary; the full ~27-component foundation library
  grows in Phases 3-4 as consumers arrive, not speculatively).
- Panel registration proof: a customizer-exported Lit panel registers
  through the existing kernel tool-panel registry
  (`CGridOptions.components` + `SideBarDef.toolPanels`) with zero kernel
  changes.

### T6 — Customizer: #09 Smart Edit settings panel (Lit)
- Flat settings panel over `@cgrid/edit` smart-edit options, schema
  content per `docs/starui-customizer-ui/09-smart-edit.md`; draft-free
  immediate apply (Phase 1 convention); state persists via T2 registry.

### T7 — Customizer: #10 Bulk Update settings panel (Lit)
- Same shape over bulk-update options per `10-bulk-update.md`; shares
  the T5/T6 chrome — the second consumer proves the components are
  actually reusable.

### T8 — Demo wiring + E2E gates
- customizer-demo: toolbar visible by default, #09/#10 tabs in the side
  bar, modal smoke trigger. positions app: toolbar subscription
  reference.
- E2E (`apps/cgrid-customizer-demo/e2e`): toolbar renders in every
  instance + save/date events fire; canvas reflows under the strip
  (first row fully visible, no overlay clipping); module-state
  persistence round-trip (edit #09/#10 → reload → identical);
  Lit panel registration + open/close; modal open/trap/dismiss.
- Invariance: full kernel suite green (baseline ~2720); existing
  showcase + colgroups E2E untouched and green; pre-Phase-2 persisted
  snapshots still restore.

## 3. UX gates
- **G1 (after T1 first cut):** toolbar hands-on in both demo apps, both
  themes — user tears it apart before polish.
- **G2 (after T6 first cut):** first Lit panel hands-on (chrome quality
  bar: must be indistinguishable from kernel-native settings chrome).
- /frontend-design invoked before T1 and T5 UI builds;
  `docs/catalog/screenshots/` consulted for chrome conventions.

## 4. Sequencing + review
T1 → **G1** → T2 → T3 → T4 → T5 → T6 → **G2** → T7 → T8. One batched
closeout review over the whole task batch + one fix wave (standing
directive — no per-task reviewers).
