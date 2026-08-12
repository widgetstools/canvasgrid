# Frozen feature inventory

Source of truth for the rebuild: legacy `packages/{kernel,ext,customizer,data,appdata,perspective,calc,rules,format,edit,expression}`
plus `apps/cgrid-ext-demo/e2e/parity/CHECKLIST.md`.

## Honest state (2026-08-12)

`packages/new` is currently a **prototype**, not a replacement. Measured against legacy:

| | Legacy | `packages/new` |
|---|---|---|
| Source | 463 files / ~124,300 lines | 83 files / ~10,000 lines |
| Grid core | 75,406 lines | 3,545 lines |
| Unit tests | 415 files | 19 files |
| E2E specs | 125 | 0 |

No legacy test has been ported yet, so **nothing below can claim parity**. The rebuild
approach is: extract the behavior spec from the legacy module, re-implement it cleanly
(collapsed dual paths, no god object, one design system), then port the legacy tests as
the gate. A row only becomes `parity` when those tests pass against the new code.

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
| K-CSRM-01 | Client-side row model + worker pipeline order | partial | Runs in-process; legacy `worker/` (11k lines) not ported |
| K-CSRM-02 | `setRowData` / sync + async transactions | partial | No transaction result/ledger semantics |
| K-CSRM-03 | Async conflation + scroll-defer | partial | Conflation only; no damage ledger integration |
| K-SSRM-01 | Sparse SSRM v2 skeleton | partial | Closest to real; still lacks v2 controller depth |
| K-SSRM-02 | Block cache + column windows | partial | |
| K-SSRM-03 | Id-based null-safe field merge | partial | |
| K-SSRM-04 | Soft refresh on-chain + dataGen bail | partial | |
| K-SSRM-05 | `ensureFullyHydrated` fail-closed | partial | |
| K-SSRM-06 | Explicit client-pipeline mode | partial | |
| K-SSRM-07 | Expression host + distinct values hooks | partial | |
| K-COL-01 | ColDefs / groups / defaultColDef / types | stub | 69-line ColumnModel vs legacy propertyChain + columnTree + group state |
| K-COL-02 | Pin / hide / flex / width / column state | stub | State shape only; pinned bands not painted |
| K-COL-03 | Column drag + sizeToFit / autosize | todo | |
| K-SORT-01 | Multi-column sort | partial | Header click cycle only; no shift multi-sort UI |
| K-FILTER-01 | Text / number / date / multi filters | partial | Model only — no filter UI components |
| K-FILTER-02 | Set filter + distinct values | todo | |
| K-FILTER-03 | Quick filter + external filter | partial | |
| K-FILTER-04 | One filter-model shape (no legacy dual) | partial | |
| K-GROUP-01 | Row grouping API + expand/collapse | partial | |
| K-GROUP-02 | Aggregations + footers / grand totals | partial | |
| K-GROUP-03 | Sticky groups | partial | Computed, not painted as sticky band |
| K-PIVOT-01 | Pivot mode (CSRM / pipeline) | todo | Legacy `pivotEngine`/`pivotColumns`/`pivotState` not ported |
| K-PIVOT-02 | Fail-closed pivot on sparse SSRM | partial | |
| K-SEL-01 | Unified row selection | partial | |
| K-SEL-02 | Cell ranges + fill handle | todo | |
| K-SEL-03 | Group cascade select | partial | |
| K-EDIT-01 | Cell editors host hooks | stub | Single dblclick `<input>`; no editor types/lifecycle |
| K-CLIP-01 | Clipboard copy/cut/paste | todo | |
| K-MENU-01 | Context + main menus | todo | |
| K-EXPORT-01 | CSV / Excel export | todo | |
| K-PAINT-01 | Canvas virtualization + pinned bands | partial | 221-line painter vs 6.9k-line renderer |
| K-PAINT-02 | Cell flash + damage regions | stub | Flash timer only; no damage ledger / paint cache |
| K-PAINT-03 | Quality modes | todo | |
| K-PAINT-04 | Sparklines | todo | |
| K-THEME-01 | CSS tokens + shadow root option | partial | Tokens exist; no shadow-root path |
| K-STATE-01 | GridState get/set + persist | stub | |
| K-STATE-02 | Layouts bundle | todo | |
| K-EVT-01 | Lifecycle / model / interaction events | partial | Callback options only; no typed event bus |
| K-A11Y-01 | Keyboard nav + a11y overlay | todo | Entire legacy `interaction/` (18.6k lines) unported |
| K-CHROME-01 | Side bar / tool panels / status bar / overlay | todo | |
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
