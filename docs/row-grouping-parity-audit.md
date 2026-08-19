# Row Grouping — AG-Grid parity audit

**Date:** 2026-07-21
**Method:** AG-Grid latest docs (v33/v34, post-restructure) swept page-by-page;
every claim below verified against kernel source (file:line), NOT against
`docs/catalog/FEATURE_MATRIX.md` — whose area-09 ✅ marks overclaim (~20
✅-marked options have zero occurrences in kernel source; the catalog is the
port *target*, not status).

Columns: **CSRM** = worker GroupPass path. **SSRM v2** = sparse skeleton path
(`docs/ssrm-group-skeleton-design.md`; phases 1–3 landed 2026-07-20/21).

---

## 1. Implemented and believed correct (verified, tested)

| AG use case | cgrid | CSRM | SSRM v2 |
|---|---|---|---|
| `groupDisplayType` all 4 modes | `types/options.ts:864`, `core/autoGroupColumn.ts` | ✅ tested (`groupDisplayType.test.ts`) | singleColumn ✅; multipleColumns/groupRows **untested on sparse** |
| `autoGroupColumnDef` | `types/options.ts:847` | ✅ | ✅ |
| `groupRowRenderer(+Params)` | `types/options.ts:896,1193` | ✅ | untested |
| Row group panel (chips, drag reorder, keyboard, cross-panel drag) | `interaction/rowGroupPanel/host.ts` | ✅ | ✅ (reorder verified `ssrmV2Reorder.test.ts`) |
| `rowGroupPanelShow`, `rowGroupPanelSuppressSort` | `options.ts:908,1006` | ✅ | ✅ |
| Per-chip group sort (panel chevron) + per-level sort | `groupingState.ts:127-263`, `sortPass.ts:397-497` | ✅ tested | server-owned (Perspective sort) — behavior differs, see §4 |
| `groupDefaultExpanded` (numeric / all) | `options.ts:1066`, `groupPass.ts:296-329` | ✅ tested | **`0` only** (design gap, phase 4) |
| `isGroupOpenByDefault` | `options.ts:1184` | ✅ (params shape differs: `{key, route}` vs AG `{rowNode, field, key, level, rowGroupColumn}`) | ❌ |
| `expandAll` / `collapseAll` / `setExpanded` / `resetRowGroupExpansion` | `velocityGrid.ts:5311-5378` | ✅ | ✅ (exact via skeleton `setGroupKeys`) |
| Events: `rowGroupOpened`, `expandOrCollapseAll`, `columnRowGroupChanged` | `velocityGrid.ts` | ✅ (payload: key-based, not node-based) | ✅ |
| Sticky group rows | `renderer/painters/stickyGroups.ts`, worker `computeStickyAncestors` / `computeSsrmStickyAncestors` | ✅ | ✅ (fixed 2026-07-20; `ssrmStickyWorker.test.ts`) |
| Group footers + grand total (`groupTotalRow`/`grandTotalRow` top\|bottom; legacy `groupIncludeFooter` pair) | `options.ts:1125,1139,1218,1225`, `groupPass.ts:471-510` | ✅ tested (`groupFooter.test.ts`) | ❌ (phase 4; demo hand-rolls grand total as a pinned row) |
| `showOpenedGroup` | `options.ts:1112`, `viewportSlicer.ts:219-289` | ✅ | ❌ (GroupPass feature) |
| `groupHideOpenParents` | `options.ts:1150`, `viewportSlicer.ts:73-99` | ✅ | ❌ |
| `groupRemoveSingleChildren` (deprecated AG name) | `options.ts:1096`, `groupPass.ts:473-497` | ✅ tested (`groupElision.test.ts`) | ❌ |
| Selection: `groupSelects: self\|descendants\|filteredDescendants`, `checkboxLocation: autoGroupColumn` (matches v33 API) | `options.ts:1161,1170`, `group.ts:337-381` | ✅ tested + e2e | ❌ **broken by design** — descendants of unloaded leaves unresolvable (skeleton design §selection) |
| Group cell renderer: chevron, `(count)`, `suppressCount`, `innerRenderer`, tri-state checkbox | `renderer/cellRenderers/group.ts` | ✅ tested (`groupParityFlags.test.ts`) | ✅ (via `__ssrm` meta) |
| Keyboard expand (Arrow/Enter/Space), chevron click, aria-expanded | `interaction/features/groupExpand.ts` | ✅ | ✅ |
| Filters re-group (Filter → Group → Sort pipeline); aggregates over filtered rows (AG default) | `groupPass.ts`, `aggPass.ts:67-206` | ✅ | server-owned ✅ |
| Agg built-ins (sum/avg/min/max/count/first/last) + custom registry + `suppressAggFuncInHeader` | `aggFuncRegistry.ts`, `options.ts:834` | ✅ | skeleton `aggregates` field ✅ |
| `suppressGroupChangesColumnVisibility` 3-way (matches v33 API) | `options.ts:1210`, `groupingCoordinator.ts:372-377` | ✅ tested | ✅ |
| API: `setRowGroupColumns`, `moveRowGroupColumn`, `getRowGroupColumns`, `setGroupModel` | `velocityGrid.ts:5571-5586,5002` | ✅ | ✅ (`ssrmV2GroupLifecycle.test.ts`) |
| Grouping in grid state save/restore | statePersistence / initialState | ✅ | partial (expansion keys restore untested on sparse) |

**cgrid extensions beyond AG:** `groupDefaultExpandedKeys`, `setRowGroupColumnSort`, `sortGroupRowsByKey`, sort-groups-by-aggregate.

## 2. Implemented with deviations (correctness/semantics differ from AG)

1. **`groupDefaultExpanded: -1`** — AG: expand ALL. velocity-grid: negative = collapse-all, with a separate `'all'` sentinel. An AG user passing `-1` gets the opposite behavior. **Should accept `-1` as expand-all.**
2. **`'custom'` display type** — AG drives it via `colDef.showRowGroup`; cgrid via `groupRowRenderer`. `showRowGroup` is absent, so AG-style custom group columns can't be expressed.
3. **`colDef.rowGroup` / `rowGroupIndex`** — declared in `types/column.ts:664` but marked "reserved", consumed only via column-state role slots — construction-time `rowGroup: true` on a plain colDef needs verification; AG treats it as the primary grouping entry point.
4. **API naming (v33)** — cgrid has singular `addRowGroupColumn`/`removeRowGroupColumn`; AG removed singular in favor of plural. `setRowNodeExpanded(node,…)` → cgrid `setExpanded(key,…)` (key-addressed; no `expandParents`). Migration shims worth adding.
5. **Footer text** — fixed `"Total {value}"`; AG's `totalValueGetter` (renamed from `footerValueGetter`) absent.
6. **Group row aggregates + footers together** — AG blanks group-row aggregates when a total row shows (unless `groupSuppressBlankHeader: true`); cgrid always paints both.
7. **Dual footer APIs** — both `groupIncludeFooter`/`groupIncludeTotalFooter` (Cycle 15) and `groupTotalRow`/`grandTotalRow` (Cycle 15.5) live; AG removed the legacy pair in v33. Consolidate.
8. **Unbalanced groups** — null/undefined keys collapse into an unlabeled `''` group; AG shows a labeled `(Blanks)` group by default and offers `groupAllowUnbalanced` to inline them. cgrid has neither the label nor the toggle.

## 3. Absent (verified zero kernel occurrences)

**Grouping semantics:** `keyCreator` (grouping object values), `groupHierarchy`/`groupHierarchyConfig` (date-part hierarchies), `groupMaintainOrder`, `initialGroupOrderComparator`, `groupAllowUnbalanced` + `(Blanks)`, `groupHideParentOfSingleChild` (`'leafGroupsOnly'` variant has no equivalent), `groupHideColumnsUntilExpanded`, `groupLockGroupColumns`.

**Totals/agg:** `grandTotalRow: 'pinnedTop'|'pinnedBottom'`, `groupTotalRow` callback form, `suppressStickyTotalRow`, `groupSuppressBlankHeader`, `totalValueGetter`, `groupAggFiltering`, `suppressAggFilteredOnly` toggle, `alwaysAggregateAtRootLevel`, `aggregateOnlyChangedColumns` (cgrid has its own damage machinery), `getGroupRowAgg`, `allowedAggFuncs`, `defaultAggFunc`, `initialAggFunc`.

**Filtering:** group column filter (`agGroupColumnFilter`), `filterValueGetter` on the auto group column.

**Renderer/interaction:** double-click-to-expand (and `suppressDoubleClickExpand`/`suppressEnterExpand`/`suppressPadding`), `innerRendererSelector`.

**Editing/dragging (new AG pages):** `refreshAfterGroupEdit`, `groupRowEditable`, `groupRowValueSetter`, managed row-drag between groups.

**Misc:** `initialRowGroup`/`initialRowGroupIndex`, `suppressGroupRowsSticky`, `onGroupExpandedOrCollapsed` (legacy).

## 4. SSRM v2 sparse path — known parity list (tracked in skeleton design, phase 4)

Works today: singleColumn display, same-frame expand/collapse, exact
expandAll/collapseAll, sticky band, skeleton aggregates, panel + reorder,
sort/filter re-query, live-tick refresh (conflated).

Not yet: `groupDefaultExpanded` ≠ 0 / keys / callback; footers & grand total
(kernel-side); selection descendant cascade; every GroupPass-only feature
(§1 marked ❌); group ordering semantics are server-owned (Perspective sorts
groups by key/aggregate — `groupMaintainOrder`/`initialGroupOrderComparator`
would need contract support); group-column autosize reads GroupPass output
(returns header width on sparse).

## 5. Actions — status 2026-07-21 (same-day fix batch)

Landed (tests: `tests/groupParityAg.test.ts` + updated
`groupDefaultExpanded.test.ts`):

1. ✅ `groupDefaultExpanded: -1` = expand ALL (AG semantics; other negatives
   keep collapse-all). Was inverted.
2. ✅ `(Blanks)` label for null/undefined/empty group keys (worker
   `buildGroupMetaLookup`).
3. ✅ Plural API aliases `addRowGroupColumns` / `removeRowGroupColumns`.
4. ✅ `groupHideParentOfSingleChild: boolean | 'leafGroupsOnly'` (AG v33
   name; `'leafGroupsOnly'` = old `groupRemoveLowestSingleChildren`
   semantics). Wired through GroupPass AND SortPass's flatOrder rebuild.
5. ✅ Double-click on a group row toggles expansion +
   `suppressDoubleClickExpand` option (GroupExpandFeature).
6. ✅ Construction-time `colDef.rowGroup` / `rowGroupIndex` now seed the
   group model (verified BROKEN before — the resolver treats those fields
   as reserved; the seed reads raw columnDefs, initialState still wins).
7. ✅ `FEATURE_MATRIX.md` area 09 — 13 falsely-✅ rows flipped.

First wave (2026-07-21, same day — tests: `ssrmV2FirstWave.test.ts`,
extended `groupParityAg.test.ts`/`groupDefaultExpanded.test.ts`, browser
e2e `apps/velocitygrid-positions/e2e/agParityFirstWave.spec.ts`, 8/8 passing):

8. ✅ `grandTotalRow: 'pinnedTop' | 'pinnedBottom'` — rides the existing
   `totalsRowPosition` pinned totals subgrid on BOTH paths. Sparse feeds it
   from the skeleton's `path: []` root aggregates (grouped) or the
   `LoadSuccessParams.grandTotals` field (flat) via the new
   `ssrmSetGrandTotals` worker message. The SSRM demo's hand-rolled
   `pinnedBottomRowData` plumbing is deleted.
9. ✅ **AG levels-open semantics for `groupDefaultExpanded`** — `N` now
   counts LEVELS OPEN (`0` = none, `1` = first level; was `depth <= N`,
   off-by-one from ag-grid). ⚠ BEHAVIOR CHANGE for existing configs.
   Also: defaults seeded against an empty tree (model before data) now
   re-seed on the first non-empty build — caught by browser e2e.
10. ✅ Sparse expansion defaults — `-1`/`N`/`groupDefaultExpandedKeys`/
    `isGroupOpenByDefault` all honored on the SSRM v2 null sentinel
    (computed client-side over `knownGroupKeys`).
11. ✅ Sparse group/grand total footers — FlattenIndex emits footer slots
    (top/bottom, after subtree for nested groups) + in-scroll grand total;
    footer rows resolve per-group totals via the existing
    `chunk.groupTotals` path.
12. ✅ `groupMaintainOrder` — CSRM: SortPass skips the group-level
    re-order; sparse: skeleton refetches keep previous sibling order.
13. ✅ Sparse selection cascade — optional datasource `getGroupLeafIds`
    resolves descendant leaf ids; group checkbox cascade + tri-state work
    on unloaded groups.

Second wave (2026-07-21, same day — tests:
`tests/groupParitySecondWave.test.ts` (8), browser e2e
`apps/velocitygrid-positions/e2e/agParitySecondWave.spec.ts` (3), both green):

14. ✅ `totalValueGetter` — via
    `autoGroupColumnDef.cellRendererParams.totalValueGetter` (AG's exact
    shape; params `{ value, isGrandTotal }`), consumed by the groupFooter
    painter through the standard `p.params` channel.
15. ✅ `keyCreator` — colDef function serialized to the worker (same
    `toString()`/`new Function` contract as comparators); GroupPass
    buckets by (and displays) the derived key. CSRM only (sparse grouping
    is host-owned); closures over outer scope don't survive — documented.
16. ✅ `groupAggFiltering` (boolean form) — leaves bypass the column
    filter; the model prunes the group tree by aggregate values
    (FilterPass's matchers reused). A passing group keeps its whole
    subtree; non-passing ancestors survive as chrome. Only entries on
    aggregated columns constrain groups. AG's per-node callback form
    still open.
17. ✅ `filter: 'agGroupColumnFilter'` — the auto-group column adopts the
    underlying grouped column's `field` + concrete filter type at
    synthesis (per-depth in `multipleColumns`), so the existing filter
    UI/worker path serves it. Deviation vs AG: the model is stored under
    the auto column's colId (AG stores against the underlying column);
    singleColumn mode inherits the FIRST level only (no dropdown
    switcher).

Still open:

18. AG callback forms: `groupAggFiltering` per-node callback,
    `groupTotalRow` callback.
19. Remaining §3 absences (initialGroupOrderComparator,
    `groupAllowUnbalanced` toggle, suppress-sticky options,
    `groupHierarchy`, group editing/dragging, set-filter tree, …).
20. SSRM v2 phase-4 leftovers: `groupHideOpenParents` / `showOpenedGroup` /
    single-child elision on sparse; group-column autosize from skeleton.
