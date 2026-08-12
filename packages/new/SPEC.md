# Rebuild spec — invariants, collapse targets, parity gates

Distilled from a full audit of legacy `packages/kernel/src/{core,interaction,renderer,theming,worker}`
(~55k lines). This is the contract the rebuild is held to. Anything here marked **invariant**
is behavior that must survive refactoring byte-for-byte; anything marked **collapse** is debt
the rebuild is expected to remove.

---

## 1. Ordering invariants (do not "clean up")

These orders are semantic. Reordering them silently changes behavior.

### 1.1 Paint order (per frame)

1. Tier-2 row-strip pre-pass (blit list + skipRows)
2. Scroll self-blit (identity CTM, integer device px)
3. Clip + background fill
4. Cells + row backgrounds (`paintCellsByRows`)
5. **Grid lines — after cells**
6. Tier-2 strip consume, then strip capture (**after gridlines, before overlays**)
7. Sticky group band
8. Focus ring
9. Range overlay + fill handle

**Coordinate spaces:** painters take CSS px under a `setTransform(dpr,0,0,dpr,0,0)` CTM; blits
and strip copies switch to identity CTM with **integer device px** source/dest (fractional DPR
seams are a known bug class). Layer painting applies `translate(0, -bodyTop)`.

**Row background precedence:** group strip → footer → header → data (selected → hovered → zebra)
→ totals → pinned. Consecutive same-color rows merge into one `fillRect`; data bundles clamp to
`[bodyTop, bodyBottom]`.

### 1.2 Worker pipeline order

Calc Stage A → quick filter → filter → intersect → external filter (async) → group →
agg-filter prune → pivot → Calc Stage B → sort (grouped or flat) → postSortRows (async).

Two async round-trips (`externalFilterCandidates`, `postSortRowsRequest`) sit mid-pipeline;
the memoized `visibleCache` is nulled by any data/filter/sort/group/pivot mutation.

### 1.3 Interaction feature chain (head → tail)

`CellKeyboardEvents` → `RowSelectCheckboxClick` → `ColumnResizing` → `ColumnDrag` →
`GroupExpandFeature` → `EditTrigger` → `FillHandle` → `RangeSelection` → `CellSelection` →
`HeaderClick` → `KeyPaging` → `KeyboardShortcuts` → `RightClick` → `SparklineTooltip` →
`TooltipProvider` → `OnHover`.

Load-bearing adjacencies: `CellKeyboardEvents` at head (a `preventDefault` stops the whole
chain), `FillHandle` before `RangeSelection` (corner hit wins over range drag), `GroupExpand`
before `EditTrigger` (chevron wins over edit). Cursor reconciliation walks **tail → head**, so
the head feature wins.

### 1.4 `applyColumnState` event drain order

`columnsReset` → `columnMoved` → `columnVisible` → `columnPinned` → `columnResized` →
`setSortModel`, then async `updateWorkerColumns` → `displayedColumnsChanged` → `requestViewport`.

### 1.5 `applyCellProps` precedence (low → high)

theme defaults → totals/footer lift → static `cellStyle` (data only) → class variants →
header styles → **rule-engine fold** → `cellStyleFn` (data only) → `textTransform`.

Header caption alignment never inherits the number-type right-align.

---

## 2. Collapse targets (the actual architectural debt)

| # | Debt | Resolution |
|---|------|------------|
| 1 | **Dual SSRM controllers** — V1 flat-blocks vs V2 skeleton-sparse, selected by duck-typing `getGroupSkeleton` on the datasource | One engine, explicit modes: `flat-blocks` \| `skeleton-sparse` \| `client-pipeline-bridge`. V1 purges on expansion (flash); V2 reflows locally. V2 refuses full hydrate when grouped and is update-only for transactions. |
| 2 | **Two retained-pixel paths** — renderer scroll blit vs `PaintCacheLayer.shift`, gated by `paintCacheLayerActive` with duplicated exposed-band damage | One retained-pixel owner; blit becomes a strategy inside it. |
| 3 | **Two paint pipelines** — legacy `paint()` vs `paintLayer`/`presentLayer`/`paintChrome`, with Tier-2 strip logic copied for both Y bases | One pipeline parameterized by surface; `buildPctx` shared (currently deliberately not used by `paint()`). |
| 4 | **Primary vs synthesized column tree under pivot** — every snapshot/apply path must know which tree it's on | Explicit `ColumnModel { primary, display }` so the choice is typed, not remembered. |
| 5 | **Legacy + v2 filter matchers** both live (`matches` / `matchesV2`) | One matcher. |
| 6 | **Four drag orchestrations** — column drag, visibility panel rows, zone pills, group hierarchy | One drag controller. |
| 7 | **Six UI namespaces** — `.vg-*`, `.vg-settings-*`, `.vg-colgroups-*`, `.ckp-*`, `.vg-dp-*`, Lit `cgc-*` | One design system. |

### Known workarounds to preserve (they fix real bugs)

Double `applyStateToTree` after reorder (width/hide loss on restore); `expansionDrifted()` guard
in SSRM V2; pivot mid-load `getRowHeight(0) === 0` viewport guard; soft-refresh conflation in both
SSRM controllers; field-merge on partial SSRM payloads (thin ticks wipe columns otherwise);
`rebuildIndices` focus/range desync guard; Tier-1 `surfaceBg` pre-fill.

### Dead code to drop

`Hit.kind: 'pinnedSplitter'` (never returned); `cellSelection.suppressRow` (no consumer);
`EditTrigger.handleKeyDown` suppressKeyboardEvent (dead behind the head feature); duplicate
`getGroupKeyAtRow`/`isGroupRow`/`isGroupExpanded` declarations in `feature.ts`;
`overscanRows` on ViewportInput; `cellHorizontalBorderColor` token.

### Not implemented in legacy (do not invent)

No RTL, no wheel momentum, no no-rows overlay, no pinned-section splitter drag,
no worker-side painter (`offscreenSupport.ts` is capability detection only).

---

## 3. Module boundaries for the rebuild

1. **ColumnModel** — property chain, tree, group state, order, state snapshot/apply
2. **Viewport** — compute, scroll manager, prefetch, row-height index
3. **Paint** — damage ledger, retained layer, quality, flash
4. **DataPlane** — worker coordinator + unified SSRM engine
5. **AnalyticsPlane** — pivot engine, grouping coordinator
6. **Interaction** — feature chain, hit tester, selection model, DOM hosts
7. **Persistence** — grid state, layout manager, state bus

Coordinators keep their fat `Deps` interface as the seam contract — that pattern is good and
stays. The god object (`velocityGrid.ts`) is what gets split.

---

## 4. Port order (dependency-forced)

```
types → propertyChain → columnTree → columnState → columnStateManager
      → layout(width) → rowHeightIndex → viewport → viewportManager
      → damageLedger → paintCache → flash → renderer
      → worker protocol → passes → slicer
      → SSRM (unified) → pivot/grouping
      → interaction chain → DOM hosts
      → ext/data modules
```

## 5. Parity gate

Legacy tests import by module path (`../src/core/columnState`), so ported modules keep their
path and the legacy test file runs unmodified. **A feature is `parity` in `INVENTORY.md` only
when its listed tests pass against `vg-new-*`.**

| Layer | Gate |
|-------|------|
| Property chain | `propertyChain`, `columnTypes`, `cellClassRules`, `cellStyleExpansion`, `cellBorders`, `headerStyleText`, `headerCellStyleIsolation`, `calcColDefFold` |
| Column tree/groups | `columnTree`, `columnGroupState`, `columnGroupMutation`, `columnGroupsModel`, `columnOrder` |
| Column state | `columnState`, `columnStateManager` |
| Layout/width | `sizeColumnsToFit`, `rebuildWidthPreserve` |
| Viewport | `viewport`, `viewportManager`, `scrollRecomputeCoalescing`, `horizontalScrollDataReadiness`, `virtualColumnsChanged` |
| Damage/cache | `damageLedger`, `paintCache`, `paintCacheViewport`, `scrollBlit`, `paintQuality`, `rasterCacheCells`, `rasterCacheStrips` |
| Flash | `flashRegistry`, `flashAlphaMask`, `flashOverrides`, `ruleFlashOwnership` |
| Renderer | `renderer`, `byRows`, `rendererDamage`, `rendererPaintCache`, `visibleCellBounds`, `wrapText`, `headerWrap`, `gridLines` via `byRows` |
| Theming | `theming`, `cssReader`, `theme/*` |
| Worker protocol | `workerClient`, `workerClientCoalesce`, `workerDispatch`, `workerEntry`, `workerCoordinator`, `chunkFormat`, `dictText`, `varintNumeric` |
| Passes | `quickFilterPass`, `filterPass.text.params`, `groupPass`, `groupSort`, `aggPass`, `pivotPass`, `calcPassStageA/B`, `clipboardSerialize`, `postSortRows` |
| Slicing | `viewportSlicer`, `viewportSlicer.group`, `viewportSlicerTouched` |
| SSRM | `ssrmV2Controller`, `ssrmV2FirstWave`, `ssrmFlattenIndex`, `ssrmRowMeta`, `ssrmColumnKeys`, `ssrmBlockInvalidation`, `ssrmResortOnTick` |
| Interaction | `hitTester`, `featureChain`, `columnResizing`, `columnDrag`, `cycleSort`, `selectionModel`, `rangeSelection`, `fillHandle`, `keyboardConventional`, `a11yKeyboard`, `editController`, `editTrigger`, `clipboardSerialize`, `contextMenuHost`, filter suites, tool-panel suites |
| E2E | `apps/cgrid-positions/e2e/cycle*.spec.ts` + `agParity{First,Second}Wave.spec.ts` (primary gate) |

Benches (`packages/kernel/bench/`) carry p75/p99 baselines in `baselines.json`; a ≥30%
regression on a hot path is a failure, not a note.
