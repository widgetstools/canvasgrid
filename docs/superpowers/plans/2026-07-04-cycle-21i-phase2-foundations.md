# Cycle 21i Phase 2 — foundations + intrinsic toolbar (implementation plan)

Spec: `docs/superpowers/specs/2026-07-04-cycle-21i-phase2-design.md`
Branch: `cycle21i/customizer-phase2` (base: `176d4a5`)
Execution: /subagent-driven-development; ONE batched closeout review +
one fix wave at the end (no per-task reviewers).

Baselines to hold green: full kernel suite (~2720), colgroups E2E 7/7,
customizer-demo E2E, showcase E2E. `aggIncremental.perf.test.ts` is a
known pre-existing timing flake — green in isolation is acceptable.

---

## T1 — Kernel: intrinsic toolbar strip host

**Goal:** the toolbar every grid shows by default — a DOM strip above
all other chrome, NOT a canvas subgrid. Replaces the discarded
`ToolbarSubgrid`/overlay attempt (commits f3ed901^..f3ed901 on the old
`cycle21i/customization-2` branch — reference for API shape ONLY, not
architecture).

1. Recon the strip-host pattern: `RowGroupPanelHost` construction
   (velocityGrid.ts:1307-1322), `reserveStatusBarSpace` (velocityGrid.ts:5083),
   `reserveRowGroupPanelSpace` (velocityGrid.ts:5094), the combined inset
   application (velocityGrid.ts:5116-5161), `setRowGroupPanelTop`
   (velocityGrid.ts:5184). Understand how a top strip reserves space so the
   canvas + header + editor overlay reflow.
2. `interaction/toolbarHost.ts`: `ToolbarHost` class, DOM strip mounted
   on `this.root`, full width, `--vg-header-bg` / `--vg-border-color`
   themed, `.vg-toolbar` / `.vg-toolbar-start` / `.vg-toolbar-end`
   classes, tokens.css additions under a `--vg-toolbar-*` namespace.
3. New `toolbarInset` at the TOP of the inset chain: toolbar sits above
   top status bar, pivot panel, and row group panel; their `top` offsets
   and the canvas insets all shift by the toolbar height. Grid with
   `toolbar: false` reserves zero.
4. Options (`types/options.ts`): `toolbar?: boolean` default true,
   `toolbarHeight?: number` default 40. Runtime-settable via
   `setGridOption` (visibility + height react live).
5. Intrinsic end zone: date picker (native `input[type=date]`, value =
   today, `--vg-input-*` themed, focus ring via
   `--vg-input-focus-border`) + save icon button (28px, SVG glyph from
   the Lucide source set, `currentColor`). Both keyboard-reachable,
   `aria-label`s set.
6. Public surface: `grid.getToolbar()` returns the host; start-zone
   builders (`addButton`, `addIconButton`, `addDivider`, `addSpacer`,
   `addContent`, `clear` = start zone only), `updateHeight`,
   `setVisible`, `onSave`, `onDateChange`, `getDate`, `setDate`. Typed
   events `toolbarSave` / `toolbarDateChanged` on the kernel event bus.
7. Destroy path: unmount + inset release, following the sidebar/status
   bar destroy-safety idiom (velocityGrid.ts:5883-5899 vicinity).
8. Tests: unit (inset math incl. toolbar+statusBar-top+rowGroupPanel
   stacking; opt-out reserves zero; height change reflows), then wire
   both demo apps (customizer-demo zero-config; positions app
   subscribes `onSave`/`onDateChange`).
9. **GATE G1** — user hands-on in both apps, both themes, before
   polish continues.

## T2 — Kernel: module-state persistence registry

1. `core/moduleState.ts`: `registerStateModule({ id, version, get,
   set })`; snapshot integration in `stateSnapshot.ts` under
   `modules: { [id]: { version, data } }`; restore in the ordered
   `setState` path; autosave rides the existing coalesced
   `stateUpdated` bus — no new persistence plumbing.
2. Graceful degradation: unknown module id or `set` throw → skip that
   slice + dev warning, rest of state restores.
3. Migrate ONE existing slice (column-groups overlay from #101 is the
   candidate — it already has its own persist path from Task 6/8 of
   that cycle) onto the registry. Compat test: a pre-Phase-2 snapshot
   (fixture captured from current main) still restores byte-identically
   minus the new envelope.
4. Unit tests: register/round-trip/version-mismatch/unknown-module.

## T3 — Kernel: API widening + enumerations

1. Recon exact Tier B list in
   `plans/notes/cycle-21i-customizer-recon.md` §4; widen `makeApi()`
   (velocityGrid.ts:5640 vicinity) accordingly (`getFilterModel`, `getState`,
   `setState`, `getSortModel`, `setThemeParams`, `getThemeParams`, …).
2. `listIcons()` on the icon registry; instance-truth renderer
   enumeration on the renderer registry; column group-tree walk
   (visit group nodes with id/caption/open/children/columnGroupShow).
3. Unit tests per addition; JSDoc states the two-tier contract.

## T4 — Kernel: modal primitive

1. `interaction/modalHost.ts`: open/close API, focus trap, ESC +
   backdrop dismiss, `--vg-*` themed, z-order above all chrome,
   `prefers-reduced-motion` respected. Vanilla DOM.
2. Reuse/extend the existing `PopupHost` idiom where sensible — do not
   fork a parallel popup stack if extension is clean.
3. Unit + demo smoke (a demo button opens a modal with focus trap).

## T5 — `@wellsfargo-starui/velocity-grid-customizer` bootstrap (Lit)

1. Fill the empty scaffold: `lit` + `@lit/context` deps, vite lib
   build + d.ts, lockstep version, `@wellsfargo-starui/velocity-grid` peer dep, turborepo
   task wiring. /frontend-design before component work.
2. Theming: components consume `--vg-*` tokens directly; one bridge
   stylesheet maps any StarUI token names the doc ports keep.
3. Flat-panel chrome subset (Lit): panel section, field row, switch,
   select, number input — visually indistinguishable from the kernel
   settings-schema chrome (side-by-side screenshot check against the
   Grid Options panel).
4. Registration proof: exported Lit panel registers via
   `VelocityGridOptions.components` + `SideBarDef.toolPanels` with zero kernel
   changes; `init/getGui/refresh/destroy` contract satisfied by a thin
   Lit-element adapter.

## T6 — #09 Smart Edit settings panel

1. Recon `docs/starui-customizer-ui/09-smart-edit.md` + the smart-edit
   option surface shipped in `@wellsfargo-starui/velocity-grid-edit` (Cycle 21g); map doc fields
   to real engine options — missing engine option = fix in
   `@wellsfargo-starui/velocity-grid-edit`, not a UI shim.
2. Build the panel on T5 chrome; immediate apply; persist via T2
   registry (`modules['smartEdit']`).
3. **GATE G2** — user hands-on; chrome quality bar.

## T7 — #10 Bulk Update settings panel

1. Same shape per `10-bulk-update.md` over `@wellsfargo-starui/velocity-grid-edit` bulk-update
   options; second consumer of the T5 chrome (refactor shared pieces
   if T6 hard-coded anything).

## T8 — Demo wiring + E2E + closeout

1. customizer-demo: #09/#10 side-bar tabs, modal smoke trigger; both
   themes screenshot set into `docs/catalog/screenshots/`.
2. E2E: toolbar default-visible + events; canvas reflow under strip
   (first data row fully visible at scroll-top); module-state
   round-trip (edit #09/#10 → reload → identical); Lit panel
   open/close; modal focus trap + dismiss.
3. Invariance run: full kernel suite, colgroups 7/7, showcase E2E.
4. FINAL batched review (whole branch) + one fix wave. Kill dev
   servers + automation browser when verification finishes.
