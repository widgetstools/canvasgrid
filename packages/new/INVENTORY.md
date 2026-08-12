# Frozen feature inventory

Source of truth for the rebuild: legacy `packages/{kernel,ext,customizer,data,appdata,perspective,calc,rules,format,edit,expression}`
plus `apps/cgrid-ext-demo/e2e/parity/CHECKLIST.md`.

## Honest state (2026-08-12)

`packages/new` is a **rebuild in progress**, not yet a replacement. Measured against legacy:

| | Legacy | `packages/new` | |
|---|---|---|---|
| Source | 463 files / ~124,300 lines | ~83,800 lines | 67% |
| Grid core | 75,406 lines | 77,158 lines | 102% |
| Test files | 415 | 298 | 72% |
| Grid test files | 275 | 279 | 101% |
| E2E specs | 125 | 0 | 0% |

Started the day at 83 files / ~10,000 lines with 19 tests and no ported behavior. Grid core
exceeding 100% is expected — the ports add documentation and, in a few places, the tests the
legacy gate was missing.

The rebuild approach is: extract the behavior spec from the legacy module, re-implement it
cleanly (collapsed dual paths, no god object, one design system), then run the legacy tests
**unmodified** as the gate. A row only becomes `parity` when those tests pass against the new
code with no assertions removed and no skips.

**Ported:** the type contract (verbatim — it *is* the AG-parity surface), the column model,
viewport/virtualization/paint infrastructure, the worker protocol and data pipeline, the
renderer and theming layers, the full interaction layer, and the grid host with its split
into facades. `packages/new/grid` is now feature-complete against the legacy kernel by every
gate legacy ships.

**Package suite: 3,601 passing / 3 failing across 285 files.** **All 275 legacy grid test
files are present and byte-identical** to their originals — zero edits, zero omissions. No
assertion has been deleted, loosened, or skipped anywhere in the rebuild.

The last 65 of those were copied in only after the host port: they had never been run against
the rebuild, and **all 65 passed as-is** (+501 tests). They were an unmeasured gap, not a
failing one — but until they ran, four rows below cited gates that were not actually
executing here. That is the failure mode this document exists to prevent.

**The 3 failures are the two known-bad legacy files below — there are no other failures.**

**Pre-existing legacy breakage — faithfully reproduced, deliberately not hidden:**
`flashOverrides` fails 2/7 and `byRowsRowDataGate` fails against `packages/kernel` itself.
`byRowsRowDataGate` asserts byRows skips the row-data snapshot when the rule-fold mirror
already holds the row; byRows computes it anyway whenever `ruleRowId` is defined.

`src/renderer/`, `src/theming/`, and `src/icons/` began as an unrefactored dependency closure
dragged in by three column gate tests. That is no longer true: the renderer port landed and
collapsed the two paint pipelines into a single `renderSurface`, so the K-PAINT / K-THEME rows
may now cite them.

### Duplication debt — retired

`src/worker/interop/` is **gone**. The four modules vendored there during the worker port
(because their owning layers hadn't landed) are retired now that those layers have:

- `trimInput` was dead — zero importers. Deleted.
- `aggMath` differed from the status-bar copy only in comments. `worker/aggFuncRegistry.ts`
  now imports `../interaction/statusBar/aggMath`, which is legacy's own wiring and its own
  documented decision that exactly one bundle carries the canonical copy.
- `pivotColumnIds` was created on a false premise. `worker/passes/sortPass.ts` now imports
  `decodePivotResultColumnId` from `core/pivotColumns` exactly as legacy does. A cycle *does*
  form (`pivotPass → worker/dataPipeline → sortPass → core/pivotColumns → pivotPass`, since
  `pivotPass` reaches `sortPass` transitively), but **legacy's graph contains the identical
  cycle**, so the duplicate bought nothing legacy wasn't already living with.
- `ssrmRowMeta` was the one with real behavioral drift: the worker copy delegated sticky-ancestor
  traversal to `worker/stickyAncestors`, while `core/ssrmRowMeta` kept the legacy inline walk.
  Resolved toward `core/`, keeping the legacy-verbatim version — adopting the refactor would have
  made `core/` take a *value* import on worker-layer code and introduced two cycles legacy does
  not have.

`aggFuncRegistry.ts`, `sortPass.ts`, and `core/ssrmRowMeta.ts` are now byte-identical to legacy.
There are zero `PORT-NOTE` comments left anywhere in `src/`.

**Remaining, by choice:** the sticky-walk dedup is half-done. The CSRM caller in `worker/worker.ts`
uses the shared `collectStickyAncestors`; the SSRM caller keeps its own inline copy of the same
traversal. Two implementations of one subtle algorithm can drift, so `stickyAncestorWalk.port.test.ts`
pins both against the same invariants. The true fix is moving `collectStickyAncestors` to a
layer-neutral module both `core/` and `worker/` may import — a deliberate divergence from legacy.

### Encapsulation debt from the host split

Making the five facades' `Deps` interfaces satisfiable meant dropping `private` from ~90
members of `VelocityGrid`. That widens the host's internal surface. It was mechanically
necessary for the extraction, but it is real debt — tightening it means introducing narrower
accessor seams rather than exposing whole members.

The split covers 5 of the 7 seams in §3. The **column facade** and the **lifecycle/wiring
core** remain inline because their methods are scattered across roughly fifteen sites rather
than contiguous, so extraction is multi-range surgery. The column *state* logic already lives
in `ColumnStateManager`; what stays inline is thin delegation plus interaction glue.

### Uncovered by any parity gate

The SSRM sticky-ancestor path and the pivot sort-by-pivot-column path have no legacy test
exercising them. Refactors there rest on port-added tests only — treat with corresponding care.

K-PIVOT-02 (fail-closed pivot on sparse SSRM) is the one grid row still `partial`, and it stays
that way because **legacy ships no test for it either** — no legacy test file combines pivot with
`skeleton-sparse`. It cannot be raised to `parity` by porting; closing it means writing a new gate
that legacy never had.

## Status legend

| Status | Meaning |
|--------|---------|
| `todo` | Not started |
| `stub` | Demo-grade placeholder — looks present, not usable as a product feature |
| `partial` | Real implementation, materially thinner than legacy |
| `parity` | Behavior matches legacy **and** ported legacy tests pass |
| `deferred` | Intentionally out of scope (not shipped in legacy either) |

---

## K — Grid / row models (`vg-new-grid`)

| ID | Feature | Status | Gap vs legacy |
|----|---------|--------|---------------|
| K-CSRM-01 | Client-side row model + worker pipeline order | parity | Real worker ported; `groupPass` `quickFilterPass` `calcPassStageA/B` `viewportSlicer*` `chunkFormat*` green |
| K-CSRM-02 | `setRowData` / sync + async transactions | parity | Real host landed; `velocityGrid.integration` green |
| K-CSRM-03 | Async conflation + scroll-defer | parity | Per-rAF push coalescing green (`workerClientCoalesce`) |
| K-SSRM-01 | Sparse SSRM v2 skeleton | parity | `ssrmV2Controller` `ssrmV2FirstWave` `ssrmFlattenIndex` `ssrmRowMeta` green |
| K-SSRM-02 | Block cache + column windows | parity | `ssrmBlockInvalidation` `ssrmColumnKeys` green |
| K-SSRM-03 | Id-based null-safe field merge | parity | Preserved through the collapse; `ssrmResortOnTick` green |
| K-SSRM-04 | Soft refresh on-chain + dataGen bail | parity | Adaptive pacing is a mode-profile flag |
| K-SSRM-05 | `ensureFullyHydrated` fail-closed | parity | `fullHydrate: 'refuse-when-grouped'` profile flag |
| K-SSRM-06 | Explicit client-pipeline mode | parity | Now a first-class engine mode, not a duck-typed branch |
| K-SSRM-07 | Expression host + distinct values hooks | parity | `distinctValuesPass` green |
| K-COL-01 | ColDefs / groups / defaultColDef / types | parity | `propertyChain` `columnTypes` `columnTree` `columnGroupState` `columnGroupMutation` `columnOrder` green |
| K-COL-02 | Pin / hide / flex / width / column state | parity | State model only — `columnState` `columnStateManager` green; painting pinned bands is K-PAINT-01 |
| K-COL-03 | Column drag + sizeToFit / autosize | parity | `columnDrag` `columnResizing` `autosizeMainSide` `sizeColumnsToFit` `columnGroupHeaderDrag` green |
| K-SORT-01 | Multi-column sort | parity | `cycleSort` `initialSort` `groupSort` green |
| K-FILTER-01 | Text / number / date / multi filters | parity | `textFilter` `numberFilter` `dateFilter` `multiCondition` `filterPopupHost` `floatingFilterOverlay` green |
| K-FILTER-02 | Set filter + distinct values | parity | `setFilter` `distinctValuesPass` green |
| K-FILTER-03 | Quick filter + external filter | parity | `quickFilterPass` `cellMatchesAnyQuickFilterTerm` green |
| K-FILTER-04 | One filter-model shape (no legacy dual) | parity | Collapse done — one `matchesFilterEntry`; 18 port-added tests pin the legacy shape |
| K-GROUP-01 | Row grouping API + expand/collapse | parity | `groupPass` `groupElision` `hideOpenParents` `filteringWithGrouping` green |
| K-GROUP-02 | Aggregations + footers / grand totals | parity | `aggPass` `aggFuncRegistry` `groupFooter` `grandTotalLabel` `aggExtensions` `aggregationEvent` green |
| K-GROUP-03 | Sticky groups | parity | `stickyGroupsClip` `stickyChevronHitTest` green; one shared ancestor walk |
| K-PIVOT-01 | Pivot mode (CSRM / pipeline) | parity | `pivotPass` `pivotEngine` `pivotIntegration` `pivotInvariants` `pivotColumns` `pivotPanel` green |
| K-PIVOT-02 | Fail-closed pivot on sparse SSRM | partial | |
| K-SEL-01 | Unified row selection | parity | `selectionModel` `selectionModes` `selectionConfig` `triStateSelection` `checkboxSelectionColumn` green |
| K-SEL-02 | Cell ranges + fill handle | parity | `rangeSelection` `rangeSelectionEvents` `cellRangesApi` `fillHandle` green |
| K-SEL-03 | Group cascade select | parity | `triStateSelection` `groupExpand` green |
| K-EDIT-01 | Cell editors host hooks | parity | All 8 editors — `builtinEditors` `editTrigger` `editorOverlay.registry` `cellEditorRegistry` `rowEditCoordinator` `popupHost` `price32Editor` green |
| K-CLIP-01 | Clipboard copy/cut/paste | parity | `clipboardSerialize` `clipboardSerializerHtml` `clipboardSuppress` green |
| K-MENU-01 | Context + main menus | parity | `contextMenuHost` `contextMenuDefaults` `contextMenuMainDefaults` `contextMenuGroupBy` `contextMenuPivot` green |
| K-EXPORT-01 | CSV / Excel export | parity | `exportCsv` `exportApi` `exportOptions` green |
| K-PAINT-01 | Canvas virtualization + pinned bands | parity | Full renderer ported; `byRows` `renderer` `rendererDamage` `pinnedRows` `stickyGroupsClip` green |
| K-PAINT-02 | Cell flash + damage regions | parity | `damageLedger` `scrollBlit` `paintCache` `flashRegistry` `flashAlphaMask` `ruleFlashOwnership` green. `flashOverrides` excluded — fails 2/7 against legacy too |
| K-PAINT-03 | Quality modes | parity | `paintQuality` green |
| K-PAINT-04 | Sparklines | parity | `sparkline` green (31) |
| K-THEME-01 | CSS tokens + shadow root option | parity | `cssReader` `theming` `theme/*` green |
| K-STATE-01 | GridState get/set + persist | parity | `stateSnapshot` + persistence suites green via `host/persistenceFacade` |
| K-STATE-02 | Layouts bundle | parity | `layoutManager` `layoutManagerTier` `layoutManagerImportExport` `layoutManagerApi` green |
| K-EVT-01 | Lifecycle / model / interaction events | parity | Real event surface; `velocityGrid.integration` green |
| K-A11Y-01 | Keyboard nav + a11y overlay | parity | `a11yKeyboard` `a11yOverlay` `keyboardConventional` `keyboardScrollFocusStability` `singleFocusInvariant` green |
| K-CHROME-01 | Side bar / tool panels / status bar / overlay | parity | `sideBarHost` `sideBarEvents` `columnsToolPanel` `filtersToolPanel` `toolPanelRegistry` `statusBarHost` `countPanels` `aggregationPanel` `loadingOverlay` `modalHost` green |
| K-TREE-01 | Tree data | deferred | |
| K-MD-01 | Master-detail | deferred | |
| K-INF-01 | Infinite row model | deferred | |
| K-CHART-01 | Integrated charts | deferred | |

---

## E — Ext shell (`vg-new-ext`)

| ID | Feature | Status | Gap vs legacy |
|----|---------|--------|---------------|
| E-SHELL-01 | Title bar + ribbon + customize drawer chrome | partial | Chrome exists and is clean |
| E-SHELL-02 | Extension registry + default bundle | stub | Static array; no registry/lifecycle |
| E-UI-01 | All chrome on vg-new-ui (no Lit customizer) | partial | Holds so far |
| E-CFG-01 | ConfigSession instance plane | partial | Draft/validate/apply works; no layouts/profiles |
| E-CFG-02 | Layouts (no profiles dual UI) | todo | |
| E-MOD-01 | Grid options panel | stub | 2 fields vs legacy option set |
| E-MOD-02 | Column groups panel | todo | |
| E-MOD-03 | Column settings | stub | Caption/width only |
| E-MOD-04 | Conditional styling | stub | One hardcoded rule, no CRUD |
| E-MOD-05 | Alerts | stub | One rule, no channels/frequency/kill-switch |
| E-MOD-06 | Calculated columns | stub | One expression, no list/validation UI |
| E-MOD-07 | Smart edit | stub | No preview/confirm, no enforceSingleColumn |
| E-MOD-08 | Bulk update | stub | No distinct-value dropdown |
| E-MOD-09 | Plus/minus | stub | Fixed ±1, no step config/expression gate |
| E-MOD-10 | Shortcuts | todo | |
| E-MOD-11 | Data-change history | stub | Undo/redo buttons only; no journal UI |
| E-MOD-12 | One Data Provider panel + bind strategies | partial | Catalog list + mock bind + stop/restart |
| E-TB-01 | Formatting ribbon | partial | Applies to a hardcoded colId list, not selection |
| E-TB-02 | Editing ribbon | partial | Fixed ops on `pnl` |
| E-TB-03 | Saved-filter pills | partial | Save/remove/persist; no rename/compose/collapse |
| E-TB-04 | Layouts switcher + save | todo | |
| E-TB-05 | Search / alerts badge / as-of / overflow | partial | |
| E-GRAMMAR-01 | Draft → Validate → Apply/Save | partial | Grammar implemented; only as deep as the modules |

---

## D — Data / AppData / Perspective

| ID | Feature | Status | Gap vs legacy |
|----|---------|--------|---------------|
| D-APP-01 | AppData store + subscribe + snapshot | partial | Closest to legacy (legacy is only 326 lines) |
| D-APP-02 | `{{name.key}}` resolve + assert-resolved | partial | |
| D-APP-03 | LS key `vg-new:appdata` + legacy migrator | partial | |
| D-CAT-01 | Provider catalog backend (LS + memory) | partial | |
| D-CAT-02 | Key `vg-new:provider-catalog` | partial | |
| D-HUB-01 | Data hub + MessagePort client | todo | Legacy `data/` is 8.2k lines; ~600 ported |
| D-HUB-02 | Transport plugins (mock/STOMP/REST/WS) | stub | Only a mock; STOMP/REST/WS alias to mock |
| D-ED-01 | ProviderEditor popout | stub | |
| D-ED-02 | Diagnostics Stop/Restart + feed control | partial | Registry works |
| D-PSP-01 | SharedWorker multi-session host | partial | |
| D-PSP-02 | PerspectiveBook Table + Views | partial | |
| D-PSP-03 | Seed + STOMP feeds | partial | |
| D-PSP-04 | Web Lock leadership + stop epoch | partial | |
| D-PSP-05 | Resume-live takeover | partial | |
| D-PSP-06 | Per-view pending live batches | partial | |
| D-PSP-07 | StompPerspectiveProvider + SSRM datasource | partial | |
| D-PSP-08 | Filter tick ops | partial | |

---

## N — Engines (`vg-new-engines`)

Legacy equivalent is ~10.2k lines across `calc`/`rules`/`format`/`edit`/`expression`;
`vg-new-engines` is ~2.1k.

| ID | Feature | Status |
|----|---------|--------|
| N-EXPR-01 | Expression DSL (parse/compile/validate/evaluate) | partial |
| N-CALC-01 | Calculated columns engine + SSRM adapter | partial |
| N-RULES-01 | Conditional styling rules engine | partial |
| N-FMT-01 | Format engine + ribbon ops | partial |
| N-EDIT-01 | Smart/bulk/nudge/shortcuts/history | partial |
| N-ALERT-01 | Alerts engine + channels | partial |

---

## Collapse checklist (must stay true)

- [x] No dependency on legacy `velocity-grid-customizer`
- [x] One merge helper (`mergeRowFields`)
- [x] Pivot fail-closed helper for sparse SSRM
- [x] No duplicate provider Customize modules
- [ ] Dual SSRM paths collapsed on **ported** code (not on a fresh minimal implementation)
- [ ] God-object `velocityGrid.ts` split on ported code
- [ ] Legacy kernel tests (279 files) adapted and green
- [ ] Parity e2e ported from ext-demo checklist (125 specs)
