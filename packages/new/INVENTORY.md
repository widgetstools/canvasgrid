# Frozen feature inventory

Every ID must be `done`, `wip`, or `deferred` (deferred only for unshipped AG items).  
Source: legacy kernel/ext/data/perspective + `apps/cgrid-ext-demo/e2e/parity/CHECKLIST.md`.

Status legend: `todo` · `wip` · `done` · `deferred`

---

## K — Grid / row models (`vg-new-grid`)

| ID | Feature | Status |
|----|---------|--------|
| K-CSRM-01 | Client-side row model + worker pipeline order | done |
| K-CSRM-02 | `setRowData` / sync + async transactions | done |
| K-CSRM-03 | Async conflation + scroll-defer | done |
| K-SSRM-01 | Sparse SSRM v2 skeleton (`getGroupSkeleton` / `getLeafRows` / `getGroupLeafIds`) | done |
| K-SSRM-02 | Block cache + column windows | done |
| K-SSRM-03 | Id-based null-safe field merge | done |
| K-SSRM-04 | Soft refresh on-chain + dataGen bail | done |
| K-SSRM-05 | `ensureFullyHydrated` fail-closed | done |
| K-SSRM-06 | Explicit client-pipeline mode | done |
| K-SSRM-07 | Expression host + distinct values hooks | wip |
| K-COL-01 | ColDefs / groups / defaultColDef / types | wip |
| K-COL-02 | Pin / hide / flex / width / column state | wip |
| K-COL-03 | Column drag + sizeToFit / autosize | todo |
| K-SORT-01 | Multi-column sort | done |
| K-FILTER-01 | Text / number / date / multi filters | done |
| K-FILTER-02 | Set filter + distinct values | todo |
| K-FILTER-03 | Quick filter + external filter | wip |
| K-FILTER-04 | One filter-model shape (no legacy dual) | wip |
| K-GROUP-01 | Row grouping API + expand/collapse | done |
| K-GROUP-02 | Aggregations + footers / grand totals | wip |
| K-GROUP-03 | Sticky groups | wip |
| K-PIVOT-01 | Pivot mode (CSRM / pipeline) | wip |
| K-PIVOT-02 | Fail-closed pivot on sparse SSRM | done |
| K-SEL-01 | Unified row selection | wip |
| K-SEL-02 | Cell ranges + fill handle | todo |
| K-SEL-03 | Group cascade select | wip |
| K-EDIT-01 | Cell editors host hooks | wip |
| K-CLIP-01 | Clipboard copy/cut/paste | todo |
| K-MENU-01 | Context + main menus | todo |
| K-EXPORT-01 | CSV / Excel export | todo |
| K-PAINT-01 | Canvas virtualization + pinned bands | wip |
| K-PAINT-02 | Cell flash + damage regions | wip |
| K-PAINT-03 | Quality modes | wip |
| K-PAINT-04 | Sparklines | todo |
| K-THEME-01 | CSS tokens + shadow root option | wip |
| K-STATE-01 | GridState get/set + persist | wip |
| K-STATE-02 | Layouts bundle | wip |
| K-EVT-01 | Lifecycle / model / interaction events | wip |
| K-A11Y-01 | Keyboard nav + a11y overlay | todo |
| K-CHROME-01 | Side bar / tool panels / status bar / overlay | wip |
| K-TREE-01 | Tree data | deferred |
| K-MD-01 | Master-detail | deferred |
| K-INF-01 | Infinite row model | deferred |
| K-CHART-01 | Integrated charts | deferred |

---

## E — Ext shell (`vg-new-ext`)

| ID | Feature | Status |
|----|---------|--------|
| E-SHELL-01 | Title bar + ribbon + customize drawer chrome | done |
| E-SHELL-02 | Extension registry + default bundle | wip |
| E-UI-01 | All chrome on vg-new-ui (no Lit customizer) | done |
| E-CFG-01 | ConfigSession instance plane `vg-new:instance:*` | wip |
| E-CFG-02 | Layouts (no profiles dual UI) | wip |
| E-MOD-01 | Grid options panel | wip |
| E-MOD-02 | Column groups panel | wip |
| E-MOD-03 | Column settings (draft/save) | wip |
| E-MOD-04 | Conditional styling | wip |
| E-MOD-05 | Alerts | wip |
| E-MOD-06 | Calculated columns (CSRM + SSRM ExprTK) | wip |
| E-MOD-07 | Smart edit | wip |
| E-MOD-08 | Bulk update | wip |
| E-MOD-09 | Plus/minus | wip |
| E-MOD-10 | Shortcuts | wip |
| E-MOD-11 | Data-change history | wip |
| E-MOD-12 | One Data Provider panel + bind strategies | wip |
| E-TB-01 | Formatting ribbon | wip |
| E-TB-02 | Editing ribbon | wip |
| E-TB-03 | Saved-filter pills | wip |
| E-TB-04 | Layouts switcher + save | wip |
| E-TB-05 | Search / alerts badge / as-of / overflow | wip |
| E-GRAMMAR-01 | Draft → Validate → Apply/Save | done |

---

## D — Data / AppData / Perspective

| ID | Feature | Status |
|----|---------|--------|
| D-APP-01 | AppData store + subscribe + snapshot | done |
| D-APP-02 | `{{name.key}}` resolve + assert-resolved | done |
| D-APP-03 | LS key `vg-new:appdata` | done |
| D-CAT-01 | Provider catalog backend (LS + memory) | wip |
| D-CAT-02 | Key `vg-new:provider-catalog` | done |
| D-HUB-01 | Data hub + MessagePort client | wip |
| D-HUB-02 | Transport plugins (mock/STOMP/REST/WS) | wip |
| D-ED-01 | ProviderEditor popout on vg-new-ui | wip |
| D-ED-02 | Diagnostics Stop/Restart + feed control | wip |
| D-PSP-01 | SharedWorker multi-session host | wip |
| D-PSP-02 | PerspectiveBook Table + Views | wip |
| D-PSP-03 | Seed + STOMP feeds | wip |
| D-PSP-04 | Web Lock leadership + stop epoch | done |
| D-PSP-05 | Resume-live takeover (no resnapshot) | done |
| D-PSP-06 | Per-view pending live batches | done |
| D-PSP-07 | StompPerspectiveProvider + SSRM datasource | wip |
| D-PSP-08 | Filter tick ops incl. ends with / not contains | done |

---

## Engines (`vg-new-engines`)

| ID | Feature | Status |
|----|---------|--------|
| N-CALC-01 | Calculated columns engine + SSRM adapter | wip |
| N-RULES-01 | Conditional styling rules engine | wip |
| N-FMT-01 | Format engine + ribbon ops | wip |
| N-EDIT-01 | Smart/bulk/nudge/shortcuts/history | wip |
| N-ALERT-01 | Alerts engine + channels | wip |

---

## Collapse checklist (must stay true)

- [x] No dependency on legacy `velocity-grid-customizer`
- [x] One merge helper (`mergeRowFields`)
- [x] Pivot fail-closed helper for sparse SSRM
- [ ] No duplicate provider Customize modules
- [ ] Parity e2e ported from ext-demo checklist
