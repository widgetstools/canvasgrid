# Canvasgrid Feature-Parity & Performance-Leadership — Master Worklog

> **For agentic workers:** This is a **master plan**. Each cycle below has its own
> detailed worklog (`docs/superpowers/plans/2026-MM-DD-canvasgrid-cycle-NN-*.md`)
> authored fresh at the start of that cycle. The detailed worklogs follow the
> same per-task-per-session structure as Cycle 2 (`canvasgrid-foundation.md`) and
> Cycle 3 (`canvasgrid-hypergrid-port.md`). Do not try to execute this file
> directly — execute the per-cycle worklog that this index points to.

**Goal:** Deliver feature parity with **AG Grid 35.x** across all 812 line-items
in `docs/catalog/FEATURE_MATRIX.md` (501 Community + 311 Enterprise) AND ship
the result at **many times AG Grid's runtime performance**, while preserving
cgrid's original architectural choices (Web Worker pipeline, native scrollbars,
single-canvas paint, TypeScript strict, CSS-variable theming, the `CGrid`
public surface). Every Enterprise feature in AG Grid ships in cgrid Community
— there is no licensing tier inside this library.

**Why now:** Cycles 1-3 are complete. Cycle 1 catalogued AG Grid. Cycle 2 built
the foundation (worker pipeline, public API, demo, ~27% of P0 features).
Cycle 3 ported hypergrid's render + interaction architecture. The codebase
is now structurally ready to scale to full ag-grid surface area. This plan
sequences the remaining ~73% of P0 + all P1/P2 + all Enterprise + the
performance investments that justify the rewrite.

**References (READ FIRST when starting any cycle):**
- `docs/catalog/FEATURE_MATRIX.md` — the 812-row source of truth
- `docs/catalog/0[1-9]-*.md` through `26-*.md` — per-area deep-dive specs
- `docs/catalog/v36-deltas.md` — known v36 changes to anticipate
- `docs/hypergrid-audit/0[1-4]-*.md` — render-layer architecture reference
- `docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md` — original spec
- `docs/superpowers/plans/2026-06-23-canvasgrid-foundation.md` — Cycle 2 worklog
- `docs/superpowers/plans/2026-06-23-canvasgrid-hypergrid-port.md` — Cycle 3 worklog
- AG Grid source / docs (web): `https://www.ag-grid.com/javascript-data-grid/`

---

## Global Constraints (apply to every cycle)

These extend the constraints from Cycle 2/3. New ones marked **NEW**.

### Carried from Cycle 2/3
- **TypeScript strict mode.** Every `cgrid/src/**/*.ts` compiles clean under `npm run --workspace=cgrid typecheck`.
- **`alpha: false` canvas context.** Backing store stays opaque.
- **Theme via CSS variables.** Theme classes on the host element set `background-color`.
- **Single-canvas rendering.** No stacked DOM canvases; layers are paint passes in z-order on one canvas.
- **DPR-aware paint.** `canvas.width = cssW * dpr`, `ctx.scale(dpr, dpr)` once per resize. Draw using CSS px.
- **No per-cell `strokeRect`.** Lines go through `paintGridLines` only.
- **Web Worker is the data layer.** All data flows through `WorkerClient`; chunk format is SoA.
- **Native browser scrollbars.**
- **Vitest unit + Playwright E2E.** Both green at end of every task.
- **Conventional commits.** Each task = one or more focused commits.
- **No regressions in the public API.** `CGrid`, `CGridOptions`, `CGridApi`, the typed event surface, and the worker protocol are stable. Type-shape changes require deprecation shims + demo migration.
- **Hypergrid source is reference, not gospel.** Same applies to ag-grid: port the API shape, not the JS class system.

### NEW for this plan
- **API parity, not API mimicry.** Where ag-grid spells a field one way and that spelling causes no perf cost, cgrid spells it identically (verbatim field names like `columnDefs`, `defaultColDef`, `valueGetter`, `pinned`, `flex`, `aggFunc`). Top-level type names keep the `C` prefix (`CColDef`, `CGridOptions`, `CGridApi`) to avoid namespace collisions in apps that import both. String identifiers drop the `ag` prefix (`'text'` not `'agTextCellEditor'`). The internal model may diverge freely (no `RowNode`, no event bus polymorphism, no Vue/React adapters) — only the **public surface** mirrors.
- **Enterprise = Community.** Every feature behind an ag-grid enterprise license ships in cgrid Community. No license keys, no module gates, no nag overlays.
- **Worker-first.** Any computation that touches >1k rows runs on the worker. Main thread is for paint, hit-test, and input dispatch. New features default to a worker pass unless paint-only.
- **Off-main-thread paint candidate.** Cycle 24 explores `OffscreenCanvas` + worker paint. Main-thread paint stays the supported default; OffscreenCanvas is an opt-in performance mode.
- **Allocation discipline.** Hot paths (per-cell paint, per-frame layout, per-message worker dispatch) must be allocation-free or pool-backed. New code added to a hot path requires a benchmark.
- **Backwards compatibility.** Once a feature ships under a cycle's exit criteria, it is supported indefinitely. Breaking renames require a deprecation shim with the old name aliased for ≥2 cycles.
- **Documentation as you go.** Every public option / API / event added requires (a) a TSDoc block on the type, (b) a row added to `docs/catalog/FEATURE_MATRIX.md` marked ✅ shipped, (c) a one-line entry in the per-cycle worklog's "Shipped" list, and (d) — for non-obvious behavior — a section in the corresponding `docs/catalog/NN-*.md` area file.
- **No silent breakage of the demo.** `apps/cgrid-positions` runs after every task. Demo wiring updates land in the same commit as the feature, not in a follow-up.

---

## Performance Budget (the "many times more performant" gate)

These are the **non-negotiable performance targets**. Cycles must not regress past
these thresholds. Cycle 24 dedicates itself to lowering them further.

| Metric | Target | Notes |
|---|---|---|
| Cold start to first paint (1k rows × 10 cols) | < 50 ms | From `new CGrid()` to first `paint()` complete |
| Cold start to interactive (1M rows × 50 cols) | < 200 ms | Includes worker init + first viewport fetch |
| Scroll FPS (1M rows × 50 cols, modern laptop) | ≥ 120 fps | Native scroll + repaint at every frame |
| Streaming update throughput | ≥ 50k row-updates/sec | Sustained via `applyTransactionAsync` |
| Sort 1M rows × 1 column | < 80 ms | On worker; main thread blocked < 1 frame |
| Filter 1M rows (any predicate) | < 50 ms | Worker FilterPass |
| Aggregate 1M rows × 5 group-cols × 3 measures | < 200 ms | Worker GroupPass + AggPass |
| Memory for 1M rows × 50 cols | < 250 MB resident | SoA chunks, no per-row objects |
| Bundle size (cgrid core, min+gzip) | < 150 KB | Worker bundle counts separately, < 80 KB |
| First-input-delay during scroll | < 16 ms | Input handlers stay off worker dispatch |
| Cell flash overhead per frame (1k flashing cells) | < 4 ms | GPU-friendly path: alpha overlay, no re-paint of bg |

**Comparison baselines:** AG Grid 35.x ships at ~250 KB gz core + ~400 KB enterprise.
Hits 60 fps on the same hardware for ~100k rows; degrades visibly past 500k.
Streaming throughput tops out around 5k updates/sec without delta detection.
Our targets are roughly **10×** on memory-per-row, **2-3×** on scroll/streaming,
**2×** on bundle size.

**Every cycle's exit criteria includes:** "perf benchmark run, no regression past
the relevant target". Cycle 24 introduces the benchmark harness; until then,
cycles record current numbers and watch for drift.

---

## Cycle Index

Each cycle has a dependency tag. Run in order; some cycles can be parallelized
(noted in "Depends on"). FM coverage column is approximate — final tally happens
at cycle exit when the matrix is updated.

| # | Cycle | Theme | FM rows | Depends on | Est. tasks |
|---|---|---|---|---|---|
| 4 | Foundation-gap completion | Column groups, runtime API, custom renderer registry, full selection/focus | ~80 | Cycle 3 | 10 |
| 5 | Editing + variable heights | Full editor lifecycle, commit-back, custom editors, per-row heights | ~60 | Cycle 4 | 9 |
| 6 | Column UX completeness | Drag-reorder, state round-trip, sizeToFit, headerClass/cellClass/cellStyle | ~50 | Cycle 4 | 8 |
| 7 | Filtering completeness | Floating filters, number/date/multi filters, quick filter, external filter | ~50 | Cycle 4 | 9 |
| 8 | Sorting completeness | Multi-sort UX, initial sort, post-sort, comparator polish | ~25 | Cycle 4 | 5 |
| 9 | Range selection + fill handle | Cell ranges, fill drag, header/row selection | ~30 | Cycle 4 | 7 |
| 10 | Clipboard + context menu | Copy/paste/cut, default + custom menu | ~25 | Cycle 9 | 6 |
| 11 | Tool-panel framework + side bar | Panel host, columns panel, filters panel, custom panel API | ~30 | Cycle 6, 7 | 8 |
| 12 | Status bar | Status bar host, built-in panels, custom panels | ~15 | Cycle 11 | 5 |
| 13 | Aggregation UI | TotalsSubgrid, custom aggFunc, suppressAggFuncInHeader, totals events | ~25 | Cycle 5 | 6 |
| 14 | Row grouping (Enterprise feature) | GroupPass on worker, group rows, collapse/expand, groupSelectsChildren | ~55 | Cycle 13 | 11 |
| 15 | Master/Detail | Detail subgrid, nested CGrid, expand/collapse, detail params | ~25 | Cycle 5 | 7 |
| 16 | Tree data | getDataPath, auto-group column, tree filter/sort | ~25 | Cycle 14 | 6 |
| 17 | Pivoting | Pivot model on worker, pivot column synthesis, pivot panel | ~45 | Cycle 14 | 9 |
| 18 | Server-Side Row Model | SSRM datasource API, block cache, lazy group expand, infinite scroll | ~30 | Cycle 14 | 10 |
| 19 | Export | CSV + Excel writers (in worker), print mode, processCell callbacks | ~35 | Cycle 14 | 7 |
| 20 | Charts + sparklines | Sparkline cell renderer, AG Charts integration, chart range API | ~30 | Cycle 9 | 8 |
| 21 | Theming completeness | All CSS variables, density modes, theme parameter API, prefers-color-scheme | ~25 | Cycle 4 | 6 |
| 22 | Events + state | ~50 remaining events, getState/setState round-trip, stateUpdated | ~35 | Cycle 11 | 7 |
| 23 | Accessibility + keyboard | Full WCAG 2.1 AA, keyboard matrix, screen reader, high-contrast | ~30 | Cycle 22 | 8 |
| 24 | Performance hardening | OffscreenCanvas paint mode, perf CI, varint chunks, dict-coded text | n/a | Cycle 23 | 10 |
| 25 | 1.0 release | Bundle audit, API docs site, migration guide, full FM verification, NPM publish | n/a | Cycle 24 | 8 |

**Total estimated tasks across cycles 4-25:** ~180-200. Wall-clock is open
(time is not a constraint per the project intent), but cycles are sized for
1-3 weeks each when worked steadily.

---

## Cycle 4 — Foundation-gap completion

**Goal:** Close the highest-leverage P0 gaps that block downstream work:
column groups, runtime option mutation, full focus/selection/ensureVisible
API, custom cell-renderer registration (with params), valueSetter/valueParser
→ worker commit, and the remaining unwired lifecycle events.

**FM rows covered:** Areas 01 (remaining P0s: setGridOption/updateGridOptions/
gridPreDestroyed/gridSizeChanged/firstDataRendered/addEventListener), 02
(ColGroupDef.children/openByDefault/marryChildren, cellRendererParams/Selector,
valueSetter/valueParser), 22 (4-5 lifecycle events), 23 (10+ API methods
including ensureRowVisible-with-lookup, setFocusedCell, setSelectedRowIds,
getColumnState/applyColumnState stubs).

**Depends on:** Cycle 3 complete.

**Performance gate:** No regression past cold-start / scroll-FPS targets.
Column groups add one HeaderGroupSubgrid; verify header paint cost scales
linearly with group depth.

**Tasks (10):**

1. **Column group model + ColGroupDef types** — Add `CColGroupDef` to types.ts; extend `resolveColumnTree()` to walk groups; build flat `columnOrder` + `columnGroupTree` from a heterogeneous `columnDefs: (CColDef | CColGroupDef)[]`. Files: `types.ts`, `core/propertyChain.ts`, `core/columnTree.ts` (new).
2. **HeaderGroupSubgrid** — Multi-row header subgrid: each level of group nesting adds a row. Spans render via the `cellSpan` extension on `ViewportColumn`. Files: `core/subgrid.ts`, `renderer/painters/byRows.ts`, `interaction/hitTester.ts`.
3. **Column group open/close** — `marryChildren` enforces locked group cohesion; `openByDefault` controls collapsed state; clicking group header toggles expanded set. Files: `core/columnGroupState.ts` (new), `interaction/features/headerClick.ts`.
4. **`setGridOption` + `updateGridOptions`** — Runtime-mutable subset on `CGridApi`. Build `INITIAL_ONLY_OPTIONS` set; throw on attempting to mutate initial-only. Wire 15 runtime-safe options first (theme, rowHeight, headerHeight, defaultColDef, animateRows, rowSelection, suppressColumnVirtualisation, enableCellChangeFlash, cellFlashDuration, cellFadeDuration, asyncTransactionWaitMillis, rowBuffer, context, loading, debug). Files: `cgrid.ts`, `types.ts`, `tests/runtimeOptions.test.ts`.
5. **rowBuffer + virtualization toggles** — Replace hardcoded `overscanRows = 3` with `options.rowBuffer ?? 3`. Implement `suppressColumnVirtualisation` (compute all columns, paint all) and `suppressRowVirtualisation` (data + render entire row count). Files: `core/viewport.ts`, `cgrid.ts`.
6. **`ensureRowVisible` with worker lookup** — Resolve `rowId → rowIndex` via a worker query (`getRowIndexForId`); scroll viewport so the row aligns to position (`top` / `middle` / `bottom`). Add `ensureColumnVisible` and `ensureColumnGroupVisible`. Files: `worker/protocol.ts`, `worker/index.ts`, `worker/client.ts`, `cgrid.ts`.
7. **`setFocusedCell` + `setSelectedRowIds`** — Selection by ID now possible via the same worker `getRowIndexForId`. Persist focus across data updates by ID, not index. Files: `interaction/selectionModel.ts`, `cgrid.ts`.
8. **Custom cell renderer + `cellRendererParams`** — Public API: `cgrid.registerCellRenderer(name, painter)`. `CColDef.cellRendererParams` flows into the `CellPaintConfig` as `config.params`. Files: `renderer/cellRenderers/registry.ts`, `cgrid.ts`, `types.ts`.
9. **`valueSetter` + `valueParser` + commit-back** — Editor commit invokes `valueParser` (if defined) on the raw string, then `valueSetter` (if defined) — falls back to `data[field] = parsed`. Commit fires `applyTransaction({ update: [row] })` so the worker re-runs pipeline. Files: `interaction/editorOverlay.ts`, `cgrid.ts`, `worker/index.ts`.
10. **Lifecycle events** — Wire `gridPreDestroyed` (fires inside `destroy()` before teardown, with state snapshot), `gridSizeChanged` (fires when host bounds change, from `CGridCanvas.setBounds`), `firstDataRendered` (fires once on first non-empty viewport paint). Files: `cgrid.ts`, `types.ts`.
11. **(PATCH) Cell flash: FlashRegistry + worker `flashMask` producer + `api.flashCells` + theme color** — *Single-task addendum, separate worklog at `docs/superpowers/plans/2026-06-25-canvasgrid-cycle-04-cell-flash-patch.md`. Originally elided from Task 10; surfaced when Cycle 7 noticed Cycles 23 + 24 both presume flash works. Must land BEFORE Cycle 23 (reduced-motion opt-out) or Cycle 24 (GPU overlay) start.* Files: `core/flashRegistry.ts` (new), `worker/dataPipeline.ts`, `worker/worker.ts`, `worker/protocol.ts`, `worker/client.ts`, `theming/cssReader.ts`, `renderer/cellRenderers/registry.ts`, `renderer/cellRenderers/wrapText.ts`, `cgrid.ts`, `types.ts`, `apps/cgrid-positions/src/positionsGrid.ts`.

**Exit criteria:**
- All 10 tasks committed, reviewed clean.
- FM rows updated: ~80 newly ✅; column-group rows now reflect support.
- Demo gains a 3-level column-group example.
- Unit tests cover each new public method.
- E2E: column group expand/collapse + setGridOption mutation + setFocusedCell.
- Perf: cold start + scroll FPS unchanged (or improved).

**Per-cycle worklog:** `docs/superpowers/plans/2026-MM-DD-canvasgrid-cycle-04-foundation-gaps.md` (author when cycle starts).

---

## Cycle 5 — Editing + variable row heights

**Goal:** Production-grade editing with all ag-grid edit triggers, custom
editors (registered like renderers), full popup-editor support, and
**variable row heights** (per-row + auto-height) — the latter unblocks
Master/Detail, row grouping detail rows, and rich-cell autoHeight.

**FM rows covered:** Area 06 (cell editing, ~45 of 61 rows), Area 02
(autoHeight, wrapText, suppressKeyboardEvent), Area 03 (getRowHeight callback),
Area 22 (cellEditingStarted/Stopped, cellValueChanged refinement).

**Depends on:** Cycle 4 (valueSetter/valueParser landed).

**Performance gate:** Per-row height lookup is O(1) — back with a row-height
cache + cumulative-height prefix sum (Fenwick tree) so scroll-to-row stays
O(log n). Edit-mode entry must not trigger a full re-layout.

**Tasks (9):**

1. **Custom editor registry** — Mirrors cell-renderer registry: `cgrid.registerCellEditor(name, editor)` where `editor` implements `init/getValue/destroy/isPopup`. Default editors: `'text'`, `'number'`, `'date'`, `'select'`, `'largeText'`. Files: `interaction/editors/registry.ts` (new), `cgrid.ts`, `types.ts`.
2. **Popup editors** — `editor.isPopup() === true` mounts the DOM editor in a portal pinned next to the cell with collision avoidance. Files: `interaction/editors/popupHost.ts` (new), `interaction/editorOverlay.ts`.
3. **Edit triggers** — `editType: 'singleClick' | 'doubleClick' | 'fullRow' | undefined`; `enterMovesDown`, `enterMovesDownAfterEdit`, `tabToNextCell`. F2 enters edit; ESC cancels; Enter commits + moves down. Files: `interaction/features/editTrigger.ts` (new), `cgrid.ts`.
4. **Type-to-edit** — Pressing a printable character while a cell is focused starts edit with that char as the initial value. Files: `interaction/features/keyPaging.ts` (extended).
5. **Variable row heights — `getRowHeight` callback + `rowHeight` per row** — `CGridOptions.getRowHeight(params): number` lets the app return per-row heights. Heights are cached on the worker (in the SoA chunk metadata) and shipped per viewport chunk. Files: `worker/protocol.ts`, `worker/index.ts`, `worker/rowStore.ts`, `core/viewport.ts`.
6. **Fenwick tree for cumulative row-top lookup** — O(log n) scroll-to-row index given variable heights. Used by `ensureRowVisible` and pointer hit-test. Files: `core/rowHeightIndex.ts` (new), `interaction/hitTester.ts`.
7. **`autoHeight` per column** — When ≥1 column has `autoHeight: true`, the worker measures wrapped-text height per cell (via worker-side `OffscreenCanvas` + `measureText`) and feeds row-height calc. Files: `worker/measureText.ts` (new), `core/rowHeightIndex.ts`.
8. **`wrapText` cell renderer mode** — Text cell paints multi-line; height drives autoHeight feedback loop. Files: `renderer/cellRenderers/registry.ts`.
9. **Full-row edit (`editType: 'fullRow'`)** — All editable cells in a row open simultaneously; Tab navigates between them; ESC cancels whole row. Files: `interaction/editorOverlay.ts`, `interaction/features/editTrigger.ts`.

**Exit criteria:**
- All tasks committed, reviewed.
- FM Area 06 ≥90% ✅.
- Demo: editable columns with each editor type; variable-row-height grid.
- Perf: variable-height grid with 100k rows scrolls at target FPS; edit-mode entry < 16 ms.

---

## Cycle 6 — Column UX completeness

**Goal:** Everything users do with columns: reorder via drag, persist state
across reloads, fit/auto-size to container or content, style cells via
columnTypes / cellClass / cellStyle / classRules. Closes the remaining
Community gaps in Area 02 and the column events in Area 22.

**FM rows covered:** Area 02 (remaining ~40 rows), Area 16 (pin events,
pinning behavior refinements), Area 22 (columnVisible / columnPinned /
columnResized / columnMoved / displayedColumnsChanged / virtualColumnsChanged).

**Depends on:** Cycle 4.

**Performance gate:** Column state apply runs in a single `recomputeLayout`
pass — not N+1. Autosize sweeps measure text on the worker.

**Tasks (8):**

1. **Drag-reorder via header drag** — `suppressMovable` opt-out per column; `lockPosition` enforces fixed index; `marryChildren` keeps groups intact during drag. Files: `interaction/features/columnDrag.ts` (new).
2. **Column state round-trip** — `getColumnState() → ColumnState[]`, `applyColumnState({state, applyOrder?, defaultState?})`, `resetColumnState()`. Captures width, hide, pinned, sort, sortIndex, rowGroup, pivot, aggFunc, flex. Files: `core/columnState.ts` (new), `cgrid.ts`, `types.ts`.
3. **`sizeColumnsToFit`** — Distribute container width among unfixed columns respecting min/max. `suppressSizeToFit` opt-out. Files: `core/layout.ts`, `cgrid.ts`.
4. **`autoSizeColumns` + `autoSizeAllColumns`** — Worker measures longest cell text per column via `measureText`; resize. `skipHeader` option. Files: `worker/protocol.ts`, `worker/autosize.ts` (new), `cgrid.ts`.
5. **`setColumnsVisible` / `setColumnsPinned` / `setColumnWidths` / `moveColumns`** — Imperative column-state API. Files: `cgrid.ts`.
6. **`columnTypes` templates** — `CGridOptions.columnTypes: Record<string, Partial<CColDef>>`; `CColDef.type: string | string[]` references one or more templates that merge into the resolved coldef. Files: `core/propertyChain.ts`, `types.ts`.
7. **`cellClass` / `cellClassRules` / `cellStyle` (function + rules)** — `cellClass` is a CSS-class hint we resolve to a *named theme variant* (no per-cell DOM, no per-cell `class`). `cellClassRules` evaluates predicates per cell, picks first match. `cellStyle` (function form) returns overrides into `CellPaintConfig` per cell. Files: `core/propertyChain.ts`, `renderer/painters/byRows.ts`.
8. **All column events fire** — columnVisible, columnPinned, columnResized (already fires), columnMoved, displayedColumnsChanged, virtualColumnsChanged. Files: `cgrid.ts`.

**Exit criteria:** FM Area 02 + 16 + column-related Area 22 = ≥95% ✅; demo shows column reorder + state persistence + sizeToFit + cellClassRules.

---

## Cycle 7 — Filtering completeness

**Goal:** Full ag-grid filter UX: floating filter row, number/date filters
with range + relative operators, multi-condition filter UI (AND/OR), quick
filter (cross-column text search), external filter callback, filter API
round-trip via state.

**FM rows covered:** Area 08 (~60 of 63 rows).

**Depends on:** Cycle 4 (custom renderer registry) + Cycle 11 not yet —
floating filters live in their own header subgrid (`FloatingFilterSubgrid`),
no tool panel needed.

**Performance gate:** Filter pipeline runs on worker; main thread doesn't
block. Quick filter uses dictionary-coded text columns (deferred to Cycle 24
for the dictionary; cycle 7 uses naïve `String.includes`).

**Tasks (9):**

1. **FloatingFilterSubgrid** — Second header row showing per-column filter inputs (text input, number input, date picker). Toggled by `CGridOptions.floatingFilter` or per-column `floatingFilter: true`. Files: `core/subgrid.ts`, `renderer/cellRenderers/floatingFilterCell.ts` (new).
2. **Number filter (range + operators)** — `eq / ne / gt / gte / lt / lte / between / blank / notBlank`. Files: `worker/passes/filterPass.ts`, `interaction/filters/numberFilter.ts` (new — popup UI).
3. **Date filter** — Same operators as number + `inRange`. Date storage uses ISO strings on the worker side. Files: `worker/passes/filterPass.ts`, `interaction/filters/dateFilter.ts` (new).
4. **Text filter (full operator set)** — `equals / notEqual / contains / notContains / startsWith / endsWith / blank / notBlank`. Case-insensitive option. Files: `worker/passes/filterPass.ts`.
5. **Multi-condition filter UI** — Up to 2 conditions joined by AND/OR. Filter popup rendered as a portal anchored to header. Files: `interaction/filters/multiCondition.ts` (new).
6. **Quick filter (`quickFilterText`)** — Single text input matches across all visible columns; uses each column's valueGetter + valueFormatter result. Worker pass: `QuickFilterPass` before `FilterPass`. Files: `worker/passes/quickFilterPass.ts` (new), `cgrid.ts`.
7. **External filter (`isExternalFilterPresent` + `doesExternalFilterPass`)** — Lets the app provide a predicate run on every row. Callback executed on main thread per row id (row ids shipped from worker as the candidate set). Files: `worker/protocol.ts`, `cgrid.ts`.
8. **`getFilterModel` / `setFilterModel` round-trip + `filterChanged` event** — Already partially wired; complete with per-column filter state including multi-condition. Files: `cgrid.ts`, `types.ts`.
9. **Set Filter** (lightweight version) — Distinct-value checkboxes per column; worker computes uniques via a hashing pass. Files: `worker/passes/distinctValues.ts` (new), `interaction/filters/setFilter.ts` (new).

**Exit criteria:** FM Area 08 ≥95% ✅; demo has floating filters + multi-condition number filter + quick filter + set filter on the symbol column.

---

## Cycle 8 — Sorting completeness

**Status:** ✅ COMPLETE on 2026-06-25. Worklog at
`docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md`.

**Goal:** Multi-column sort with modifier-click, initial sort state, sort
order indicator (1, 2, 3 …) in header, post-sort callback hook, custom
comparator integration polish, `accentedSort` and `unSortIcon` semantics.

**FM rows covered:** Area 07 — 18 of 28 rows flipped to ✅ (remaining rows
sit out of Cycle 8 scope: per-column `sortingOrder`, `alwaysMultiSort`,
`suppressMaintainUnsortedOrder`, `deltaSort`, the deprecated
`unSortIcon` GridOptions alias, plus dependent behavior rows).

**Depends on:** Cycle 4.

**Performance gate:** Multi-sort runs as a chained comparator on the worker;
no main-thread compute. Sort 1M rows × 3 cols < 200 ms.

**Tasks (5):**

1. **Multi-column sort (Shift+click)** — Holding Shift on header click appends to sort model; without Shift, replaces it. Sort indicator shows position number when >1 column sorted. Files: `interaction/features/headerClick.ts`, `renderer/cellRenderers/registry.ts` (header cell), `interaction/featureChain.ts`.
2. **`initialSort` / `sortable` per column + `defaultColDef.sortable`** — Already partial; complete and document. Files: `core/propertyChain.ts`.
3. **`comparator` per column + custom value comparators** — Comparator runs on worker (function string-serialized via `Function.prototype.toString` + re-eval — alternative: passable comparator registry keyed by name). Files: `worker/passes/sortPass.ts`, `worker/comparatorRegistry.ts` (new).
4. **`postSortRows` callback** — Fires after sort, before viewport ship; lets app re-order specific rows (e.g., pin a "selected" row to top). Files: `worker/index.ts`, `cgrid.ts`.
5. **`accentedSort` + `unSortIcon` + tri-state sort cycle** — `sortingOrder: ['asc', 'desc', null]` configurable. Files: `worker/passes/sortPass.ts`, `interaction/features/headerClick.ts`, `renderer/cellRenderers/registry.ts`.

**Exit criteria:** FM Area 07 ≥95% ✅; demo shows multi-sort with order indicators.

---

## Cycle 9 — Range selection + fill handle

**Goal:** Cell range selection (click + drag, or click + shift-click), header
& row selection, fill handle (drag bottom-right corner to extend value),
range-selection events. Foundation for Cycle 10 (clipboard) and Cycle 20
(chart range).

**FM rows covered:** Area 12 (selection completeness, ~30 of 46 rows).

**Depends on:** Cycle 4.

**Performance gate:** Range paint as an overlay (one rect per contiguous
range) — not per-cell. Fill handle preview is a single border rect; commit
applies as a single transaction.

**Tasks (7):**

1. **`SelectionRange` model** — Multi-rectangle range selection: `Set<Range>` where `Range = { rowStart, rowEnd, colIds[] }`. Selection model gains `ranges: Range[]` alongside the row-selection set. Files: `interaction/selectionModel.ts`.
2. **Range selection via drag** — `RangeSelection` feature: mousedown on cell + drag = range; shift-click = extend range; ctrl-click = add disjoint range. Files: `interaction/features/rangeSelection.ts` (new).
3. **Range overlay painter** — New paint pass after `paintOverlay` (or extend overlay): draws range fill (translucent) + range border per contiguous rect. Files: `renderer/painters/rangeOverlayPainter.ts` (new), `renderer/renderer.ts`.
4. **Header & row click selection** — Click column header = select entire column range; click row header (Cycle 14 introduces row-header column for groups; for now: click row's first pinned cell with ctrl) = select entire row. `cellSelection: { suppressHeader, suppressRow }` options. Files: `interaction/features/cellSelection.ts`.
5. **Fill handle** — Bottom-right of the focused cell / range gets a square handle; drag extends selection vertically; release fills new cells with linear-extrapolated values (numbers) or repeated values (text). Files: `interaction/features/fillHandle.ts` (new), `renderer/painters/rangeOverlayPainter.ts`.
6. **Range API** — `getCellRanges()`, `clearRangeSelection()`, `addCellRange(opts)`. Files: `cgrid.ts`, `types.ts`.
7. **`rangeSelectionChanged` event** — Fires on range start/end/clear; carries `ranges: Range[]` + `started/finished` flags. Files: `cgrid.ts`.

**Exit criteria:** FM Area 12 ≥85% ✅; demo has range-drag + fill handle.

---

## Cycle 10 — Clipboard + context menu

**Goal:** Right-click context menu (default items + custom items), system
clipboard integration (copy/paste/cut on ranges), keyboard shortcuts
(Ctrl+C/V/X), clipboard processing callbacks.

**FM rows covered:** Area 19 (clipboard + context menu, ~17 of 19 rows).

**Depends on:** Cycle 9.

**Performance gate:** Clipboard ops on a 10k × 50 range complete < 100 ms.
Worker handles serialization (TSV); main thread does only the
`navigator.clipboard.writeText`.

**Tasks (6):**

1. **Context menu host** — Right-click anywhere in grid → context menu portal. Menu items config via `CGridOptions.getContextMenuItems(params): MenuItem[]`. Default items: Copy / Copy with Headers / Paste / Cut / Export / Autosize / Pin / Reset Columns. Files: `interaction/contextMenu/host.ts` (new), `interaction/features/contextMenu.ts` (new).
2. **Default menu items** — Implementations for the 8 defaults. Files: `interaction/contextMenu/defaults.ts` (new).
3. **Clipboard copy** — Ctrl+C / menu Copy: serialize current range(s) as TSV (tab-separated values) via worker, write to clipboard. `clipboardDelimiter` option. Files: `worker/clipboard.ts` (new), `cgrid.ts`.
4. **Clipboard paste** — Ctrl+V: read TSV from clipboard, parse, apply as transaction (`update: [rows...]`) to current range top-left anchor. `processCellForClipboard` and `processCellFromClipboard` callbacks. Files: `worker/clipboard.ts`, `cgrid.ts`.
5. **Cut + paste round-trip** — Cut = copy + clear. Preserves type via `valueSetter`. Files: same as paste.
6. **Suppress options** — `suppressClipboardPaste`, `suppressClipboardApi`, `suppressContextMenu`. Files: `cgrid.ts`.

**Exit criteria:** FM Area 19 ≥90% ✅; demo: right-click → Copy → paste into spreadsheet round-trips.

---

## Cycle 11 — Tool-panel framework + side bar

**Goal:** Generic tool-panel hosting infrastructure + the side bar shell +
built-in panels: Columns (show/hide/group/pivot/aggregate via drag) and
Filters (cross-cutting filter list). Custom panel registration API.

**FM rows covered:** Area 17 (~15 of 17 rows).

**Depends on:** Cycle 6 (column state) + Cycle 7 (filter model).

**Performance gate:** Side bar is a DOM panel (not canvas-painted) — its open
state shrinks the canvas region by the panel width and triggers one
`canvas.resize()`. No measurable scroll-FPS impact.

**Tasks (8):**

1. **Tool panel base + registry** — `ToolPanel` interface (`init/getGui/refresh/destroy`); registry on `CGrid`. Files: `interaction/toolPanels/registry.ts` (new), `types.ts`.
2. **Side bar shell** — Right-edge collapsible panel host; icon strip for tab switching. `CGridOptions.sideBar: SideBarDef | 'columns' | 'filters' | boolean`. Files: `interaction/sideBar/host.ts` (new), `cgrid.ts`.
3. **Columns tool panel** — Lists every column with checkboxes (visible) + drag handles (reorder) + drop zones (Row Groups, Pivot Columns, Values, Pinned Left/Right). Files: `interaction/toolPanels/columnsPanel.ts` (new).
4. **Filters tool panel** — Lists every column with a filter; clicking expands the column's filter UI inline. Files: `interaction/toolPanels/filtersPanel.ts` (new).
5. **Custom panel API** — `CGridApi.refreshToolPanel(id)`, `getToolPanelInstance(id)`. Files: `cgrid.ts`.
6. **Side bar state API** — `setSideBarVisible / setSideBarPosition / openToolPanel / closeToolPanel`. Files: `cgrid.ts`.
7. **Side bar events** — `toolPanelVisibleChanged`, `sideBarVisibleChanged`. Files: `cgrid.ts`.
8. **DOM-canvas coexistence audit** — Confirm pointer events route correctly when side bar is open; canvas hit-test respects clipped bounds. Files: `core/canvas.ts`, `interaction/featureChain.ts`.

**Exit criteria:** FM Area 17 ≥90% ✅; demo shows side bar with both panels; column drag from panel to body works.

---

## Cycle 12 — Status bar

**Goal:** Bottom status bar with built-in panels (aggregation summary, total
row count, filtered row count, selected row count) + custom panel
registration.

**FM rows covered:** Area 18 (8 rows).

**Depends on:** Cycle 11.

**Performance gate:** Status updates batch per frame; do not trigger
repaints of the body canvas.

**Tasks (5):**

1. **Status bar host** — Bottom-edge DOM bar; same shrink-canvas pattern as side bar. `CGridOptions.statusBar: StatusBarDef`. Files: `interaction/statusBar/host.ts` (new).
2. **`agAggregationComponent`** — Displays sum/avg/min/max/count for current selection or all rows. Driven by the existing `AggregationChanged` event. Files: `interaction/statusBar/panels/aggregation.ts` (new).
3. **`agTotalRowCountComponent`, `agFilteredRowCountComponent`, `agSelectedRowCountComponent`, `agTotalAndFilteredRowCountComponent`** — Simple count panels. Files: `interaction/statusBar/panels/counts.ts` (new).
4. **Custom panel API** — Same registration pattern as tool panels. Files: `cgrid.ts`.
5. **Status events** — `statusBarValueChanged` (or use selection/filter change events as triggers). Files: `cgrid.ts`.

**Exit criteria:** FM Area 18 = 100% ✅; demo has status bar with aggregation panel.

---

## Cycle 13 — Aggregation UI

**Goal:** Surface the worker's existing aggregation pipeline. `TotalsSubgrid`
that renders pinned at top or bottom showing totals across all rows or per
group. Custom `aggFunc` registration. `suppressAggFuncInHeader`. Group
footer rows (placeholder — full row grouping arrives Cycle 14).

**FM rows covered:** Area 10 (~25 of 26 rows).

**Depends on:** Cycle 5 (variable row heights — totals rows can have
distinct heights).

**Performance gate:** Totals row uses already-computed totals from the
`ViewportChunk` — zero recomputation on scroll.

**Tasks (6):**

1. **`TotalsSubgrid`** — Implements `Subgrid` with `isTotals = true`; `getCell` returns `chunk.totals[colId]`. Push into `this.subgrids` after `DataSubgrid` (bottom-pinned) or before (top-pinned) per `pinnedTopRowData` / `pinnedBottomRowData`-style option. Files: `core/subgrid.ts`, `cgrid.ts`.
2. **`pinnedTopRowData` + `pinnedBottomRowData`** — Arbitrary pinned rows (not just totals) — same subgrid mechanism. Static data shipped from main thread. Files: `core/subgrid.ts`, `types.ts`.
3. **Custom aggFunc** — `CGridOptions.aggFuncs: Record<string, AggFunc>`; `CColDef.aggFunc: string | string[] | AggFunc`. Functions string-serialized to worker (or named-registry pattern). Files: `worker/passes/aggPass.ts`, `worker/aggFuncRegistry.ts` (new).
4. **`suppressAggFuncInHeader`** — Toggle whether the header shows `Sum(price)` vs `price`. Files: `renderer/cellRenderers/registry.ts` (header cell).
5. **Totals cell renderer** — New `'totals'` registered renderer: subtle border-top, different bg, value formatted via column's formatter. Files: `renderer/cellRenderers/registry.ts`, `cgrid.ts`.
6. **`aggregationChanged` event polish** — Already fires; expand payload with full totals breakdown by group when available. Files: `cgrid.ts`.

**Exit criteria:** FM Area 10 ≥95% ✅; demo has bottom totals row showing sum/avg of P&L.

---

## Cycle 14 — Row grouping (Enterprise feature, ships in Community)

**Goal:** Hierarchical row grouping — group by one or more columns,
collapse/expand groups, group-row selection (`groupSelectsChildren`),
group-row rendering with chevron + count, auto-group column.

**FM rows covered:** Area 09 (~50 of 54 rows).

**Depends on:** Cycle 13 (TotalsSubgrid pattern reused for group-footer rows).

**Performance gate:** Grouping 1M rows by 3 columns < 300 ms on worker.
Collapsed groups skip rendering entirely (`getRowCount` returns visible count
only).

**Tasks (11):**

1. **`GroupPass` on worker** — New pipeline stage between FilterPass and SortPass. Builds tree from `groupModel: { rowGroupCols: string[] }`. Produces `groupedRows` structure: tree of group nodes with child counts. Files: `worker/passes/groupPass.ts` (new), `worker/passes/index.ts`.
2. **Group-aware ViewportSlicer** — Walks the group tree producing a flat list of visible (non-collapsed) row indices + group rows interleaved. Files: `worker/viewportSlicer.ts`.
3. **`GroupedRow` chunk format** — Worker chunk gains parallel arrays: `rowKind: Uint8Array` (data | group | footer), `groupDepth: Uint8Array`, `groupValue: string[]`, `groupChildCount: Uint32Array`, `isExpanded: Uint8Array`. Files: `worker/chunkFormat.ts`, `worker/protocol.ts`.
4. **Auto-group column** — Synthesized first column (or per-group columns if `groupDisplayType: 'multipleColumns'`) renders chevron + indent + value. `autoGroupColumnDef` configures it. Files: `core/autoGroupColumn.ts` (new), `cgrid.ts`.
5. **Group cell renderer** — Renders chevron icon, indent based on depth, group value, optional `(count)` suffix. Files: `renderer/cellRenderers/registry.ts` (new `'group'` renderer).
6. **Expand / collapse interaction** — Click chevron toggles expansion; expanded state persisted on worker; viewport recomputed. `expandAll/collapseAll/setExpanded` API. Files: `interaction/features/groupExpand.ts` (new), `cgrid.ts`.
7. **`groupSelectsChildren`** — Selecting a group row selects all descendants; selecting all children of a group selects the group (tri-state checkbox). Files: `interaction/selectionModel.ts`.
8. **`groupDefaultExpanded`** — Initial expansion depth on first render. Files: `cgrid.ts`.
9. **`showOpenedGroup` + `groupRemoveSingleChildren`** — UX polish: single-child groups can be elided. Files: `worker/passes/groupPass.ts`.
10. **Group sort** — When grouping is active, sort sorts within group + across groups by group value. Files: `worker/passes/sortPass.ts`.
11. **Group totals (footer rows)** — Per-group totals rows show under each expanded group; uses TotalsSubgrid pattern. `groupIncludeFooter: boolean` option. Files: `core/subgrid.ts`, `worker/passes/aggPass.ts`.

**Exit criteria:** FM Area 09 ≥95% ✅; demo: group P&L by sector, expand/collapse, group totals visible.

---

## Cycle 15 — Master/Detail

**Goal:** Each row can expand to reveal a nested CGrid (or arbitrary DOM).
The nested grid renders inside an expanded "detail" row whose height is
configurable + per-row.

**FM rows covered:** Area 13 (~20 of 21 rows).

**Depends on:** Cycle 5 (variable row heights) + Cycle 14 (subgrid stack
extension pattern reused).

**Performance gate:** Expanded detail grids don't block the main grid's
paint loop. Detail-grid construction is lazy (only created when the row is
visibly expanded). Memory-capped: closing a detail row destroys the nested
grid (configurable cache).

**Tasks (7):**

1. **`MasterDetail` subgrid extension** — Expanded rows insert a one-row `DetailSubgrid` immediately after their master row. Detail rows have configurable height (`detailRowHeight` or `getDetailRowHeight`). Files: `core/subgrid.ts`.
2. **Detail row rendering** — Detail row is a DOM portal (not canvas-painted) anchored at the row's y-position. Re-positioned on scroll. Files: `interaction/masterDetail/detailRow.ts` (new).
3. **Nested CGrid wiring** — `detailCellRenderer` callback receives parent row + a `detailGridOptions` (or returns custom DOM); cgrid auto-creates a nested `CGrid` from those options. Files: `interaction/masterDetail/nestedGrid.ts` (new), `cgrid.ts`.
4. **Expand/collapse interaction** — Click toggle button on master row (or `setRowExpanded` API). State persisted on master. Files: `interaction/features/masterDetailExpand.ts` (new).
5. **Lazy create + cache** — `keepDetailRows: boolean` + `keepDetailRowsCount: number`. LRU eviction. Files: `interaction/masterDetail/cache.ts` (new).
6. **Detail events** — `rowGroupOpened` (reused), `firstDataRendered` on nested grid bubbles up as `detailGridReady`. Files: `cgrid.ts`.
7. **Detail-row scroll containment** — Wheel events inside nested grid don't propagate to master grid until detail grid reaches scroll boundary. Files: `interaction/masterDetail/scrollLock.ts` (new).

**Exit criteria:** FM Area 13 ≥90% ✅; demo: row expand → nested orderbook grid.

---

## Cycle 16 — Tree data

**Goal:** Hierarchical data (each row supplies its tree path) rendered as
expandable tree. Similar to row grouping but the tree is data-defined, not
group-defined.

**FM rows covered:** Area 14 (~16 of 18 rows).

**Depends on:** Cycle 14 (auto-group column + expand/collapse + group cell
renderer all reused).

**Performance gate:** 100k-node tree (10-deep, branching factor 4) — initial
build < 250 ms; expand single node < 1 frame.

**Tasks (6):**

1. **`getDataPath` callback** — `CGridOptions.getDataPath(data): string[]` returns the path for each row. Worker builds tree from paths. Files: `worker/passes/treePass.ts` (new — runs instead of GroupPass when treeData = true).
2. **Tree auto-group column reuse** — Same auto-group column as row grouping; just uses path levels for indent + value. Files: `core/autoGroupColumn.ts`.
3. **Tree expand/collapse + state** — `isGroupOpenByDefault`, `setExpanded`, `expandAll/collapseAll`. Files: `worker/passes/treePass.ts`, `cgrid.ts`.
4. **Tree filter** — Filter shows ancestors of matching leaves (`excludeChildrenWhenTreeDataFiltering` opt-out). Files: `worker/passes/treePass.ts`, `worker/passes/filterPass.ts`.
5. **Tree sort** — Sort within siblings; tree structure preserved. Files: `worker/passes/sortPass.ts`.
6. **Tree data event** — `rowGroupOpened` reused. Files: `cgrid.ts`.

**Exit criteria:** FM Area 14 = 100% ✅; demo: tree-of-trades by `[region/desk/trader]`.

---

## Cycle 17 — Pivoting

**Goal:** Pivot row-grouped data: chosen columns become column headers, agg
measures become cell values. Pivot column synthesis on worker; multi-level
column headers via Cycle 4's HeaderGroupSubgrid.

**FM rows covered:** Area 11 (~40 of 42 rows).

**Depends on:** Cycle 14 (row grouping) + Cycle 13 (aggregation) + Cycle 4 (column groups).

**Performance gate:** Pivot 100k rows × 5 row-group cols × 3 pivot cols ×
3 measures < 800 ms. Column count growth is bounded by `pivotMaxGeneratedColumns`.

**Tasks (9):**

1. **`PivotPass` on worker** — New stage: takes grouped rows + `pivotColIds[]` + `aggCols[]`, produces synthetic columns (`Sector_Sum_PnL`, etc.). Files: `worker/passes/pivotPass.ts` (new).
2. **Pivot column synthesis** — Worker emits a virtual column tree shipped alongside chunks. Main thread merges into `columnOrder` for the duration of pivot mode. Files: `worker/protocol.ts`, `cgrid.ts`.
3. **Pivot column groups** — Each pivot level becomes a column-group level (uses Cycle-4 HeaderGroupSubgrid). Files: `core/columnTree.ts`.
4. **`pivotMode`, `pivot` per column, `aggFunc` per column** — Pivot config flows through column state. Files: `core/columnState.ts`.
5. **Pivot totals** — Optional totals row + total columns per pivot level. `pivotRowTotals`, `pivotColumnGroupTotals`. Files: `worker/passes/pivotPass.ts`.
6. **`processPivotResultColDef` / `processPivotResultColGroupDef`** — Customizer callbacks for synthetic column defs. Files: `cgrid.ts`.
7. **Pivot panel in side bar** — Drop zones in the Columns panel for pivot col selection. Files: `interaction/toolPanels/columnsPanel.ts`.
8. **`pivotMaxGeneratedColumns`** — Cap on synthesized column count; throws / warns past. Files: `worker/passes/pivotPass.ts`.
9. **Pivot events** — `pivotModeChanged`, `pivotChanged`. Files: `cgrid.ts`.

**Exit criteria:** FM Area 11 ≥90% ✅; demo: pivot trades by sector × side, sum PnL.

---

## Cycle 18 — Server-Side Row Model (SSRM)

**Goal:** A second row-model where data comes from the server in blocks,
not pre-loaded. The worker becomes a caching layer; SSRM data source is the
authoritative model. Lazy group expansion, infinite scroll, paginated fetch.

**FM rows covered:** Area 15 (~28 of 28 rows) + Area 03 SSRM-specific rows.

**Depends on:** Cycle 14 (row grouping) — SSRM groups expand on demand by
fetching from the server.

**Performance gate:** Scrolling through 10M-row server-side dataset stays at
target FPS; pre-fetch ahead-of-viewport completes before the user reaches
the boundary at typical scroll speeds.

**Tasks (10):**

1. **`SSRMDataSource` interface** — `getRows(params): Promise<{ rowData, rowCount }>` where params include `startRow / endRow / sortModel / filterModel / groupKeys[]`. Files: `worker/ssrm/dataSource.ts` (new), `types.ts`.
2. **Block cache on worker** — `cacheBlockSize` (default 100) + `maxBlocksInCache` (default 100). LRU eviction. Files: `worker/ssrm/blockCache.ts` (new).
3. **`rowModelType: 'serverSide'`** — Toggle that switches the worker pipeline to SSRM mode. Files: `worker/index.ts`.
4. **Placeholder rows + loading cell renderer** — Cells in not-yet-loaded blocks render a loading placeholder. Files: `renderer/cellRenderers/registry.ts`.
5. **Lazy group expansion** — Expanding a group triggers a `getRows({ groupKeys: [...] })` fetch. Result becomes a sub-block. Files: `worker/ssrm/blockCache.ts`, `interaction/features/groupExpand.ts`.
6. **Server-side sort + filter** — Sort/filter models flow into `getRows` params; cache invalidates on change. Files: `worker/ssrm/blockCache.ts`.
7. **Server-side pivot mode** — Pivot synthesizes columns from a metadata fetch; data fetched per visible (group × pivot col) intersection. Files: `worker/ssrm/pivot.ts` (new).
8. **`refreshServerSide`, `purgeServerSideCache`, `getServerSideStoreState`** — Cache control API. Files: `cgrid.ts`.
9. **Infinite row model** (simpler cousin) — `rowModelType: 'infinite'` for flat datasets without grouping; just block cache + lazy fetch. Files: `worker/infinite/index.ts` (new).
10. **SSRM events** — `storeRefreshed`, `storeUpdated`. Files: `cgrid.ts`.

**Exit criteria:** FM Area 15 ≥95% ✅; demo: SSRM connected to mock server endpoint scrolls 10M rows.

---

## Cycle 19 — Export

**Goal:** CSV + Excel (XLSX) export, both running on the worker (no main-thread
blocking). Print mode (`domLayout: 'print'`). processCell/processRow callbacks
for transformation.

**FM rows covered:** Area 25 (~32 of 34 rows) + Area 16 (`domLayout: 'print'`).

**Depends on:** Cycle 14 (export respects current grouping/aggregation).

**Performance gate:** Export 1M rows × 30 cols to CSV < 3 s on worker.
XLSX < 10 s.

**Tasks (7):**

1. **CSV writer on worker** — Streams TSV/CSV to a `Blob`; handles quoting, line endings, BOM option. Files: `worker/export/csv.ts` (new).
2. **Excel writer on worker** — Minimal XLSX (sheet + cells + simple styles) — vendor a small XLSX writer or embed `exceljs-lite` if size budget allows. Files: `worker/export/xlsx.ts` (new).
3. **`exportDataAsCsv` + `exportDataAsExcel` API** — Returns `Promise<Blob>` or auto-downloads via `URL.createObjectURL`. Files: `cgrid.ts`.
4. **`processCellCallback` + `processRowGroupCallback` + `processHeaderCallback`** — Transformation hooks fire on worker via the named-function-registry pattern (or string-serialized). Files: `worker/export/csv.ts`, `worker/export/xlsx.ts`.
5. **Export options** — `columnKeys`, `onlySelected`, `skipPinnedTop`, `skipPinnedBottom`, `skipRowGroups`, etc. Files: `cgrid.ts`.
6. **`domLayout: 'print'`** — Switches host height to content-height so browser print captures all rows. Files: `cgrid.ts`.
7. **Print-friendly theme** — `cg-theme-print` with black-on-white, no row stripes, page breaks at group boundaries (via CSS only — canvas screenshots to images on print). Files: `theming/tokens.css`.

**Exit criteria:** FM Area 25 ≥90% ✅; demo: Export to CSV + Excel buttons.

---

## Cycle 20 — Charts + sparklines

**Goal:** Inline sparkline cell renderer (line / column / area / bar /
pie variants) and AG-Charts-style range-charting from selected cell ranges.

**FM rows covered:** Area 24 (~25 of 30 rows).

**Depends on:** Cycle 9 (range selection).

**Performance gate:** Sparklines render at 60+ fps when ≥1000 cells visible
simultaneously. Range-chart construction < 200 ms for 10k data points.

**DECISION POINT:** Integrate AG Charts (~200 KB), embed a minimal canvas
charting library, or build our own micro-chart layer for sparklines + basic
range charts? Recommendation: **embed minimal own-built layer** for sparklines
(< 10 KB) and **opt-in AG Charts integration** for full range charting (the
app brings AG Charts as a peer dep; cgrid wires it).

**Tasks (8):**

1. **Sparkline base renderer + line chart** — `sparklineCell` registered cell renderer; reads `cellRendererParams.sparkline: { type, options }` and array value. Files: `renderer/cellRenderers/sparkline/lineSparkline.ts` (new).
2. **Column + area + bar sparklines** — Variants on the same registered renderer. Files: `renderer/cellRenderers/sparkline/*.ts`.
3. **Sparkline tooltips** — Hover-anchored tooltip showing the data point. Files: `interaction/features/sparklineTooltip.ts` (new).
4. **AG Charts integration scaffold** — Optional peer dep; `CGridOptions.chartingDependencies: { agCharts }` to inject. Files: `interaction/charts/agChartsAdapter.ts` (new).
5. **Range chart API** — `createRangeChart({ cellRange, chartType, chartContainer })`. Builds an AG Charts options object from the range data + opens chart in a popup or app-provided container. Files: `interaction/charts/rangeChart.ts` (new), `cgrid.ts`.
6. **Pivot chart** — Special range-chart shape from pivot output. Files: `interaction/charts/pivotChart.ts` (new).
7. **Chart context menu items** — Default menu adds "Chart Range" submenu. Files: `interaction/contextMenu/defaults.ts`.
8. **Chart events** — `chartCreated`, `chartDestroyed`, `chartOptionsChanged`. Files: `cgrid.ts`.

**Exit criteria:** FM Area 24 ≥85% ✅; demo: sparkline column + range → bar chart popup.

---

## Cycle 21 — Theming completeness

**Goal:** Every CSS variable AG Grid exposes is exposed by cgrid (or
documented why omitted). Density modes. Theme-parameter API (runtime theme
overrides without class swaps). `prefers-color-scheme` auto-detect.

**FM rows covered:** Area 21 (~18 of 18 rows).

**Depends on:** Cycle 4 (setGridOption — runtime theme changes use it).

**Performance gate:** Theme change is one DOM class flip + one
`cssReader.read()` + one `requestRepaint()`. No worker round-trip.

**Tasks (6):**

1. **Audit + add missing CSS variables** — Diff our `theme/tokens.css` against the ag-grid variable list (see catalog Area 21). Add row-hover bg, header-cell-text-color, cell-horizontal-border-color, range-selection-border-color, etc. Files: `theming/tokens.css`, `theming/cssReader.ts`.
2. **Density modes** — `cg-density-compact` / `cg-density-normal` / `cg-density-comfortable` classes adjust `--cg-row-height`, `--cg-header-height`, `--cg-cell-padding`. Files: `theming/tokens.css`.
3. **Theme parameter API** — `cgrid.setThemeParams({ '--cg-row-height': '40px', ... })` writes inline CSS variables on the host. Files: `cgrid.ts`, `theming/themeParams.ts` (new).
4. **`prefers-color-scheme` auto** — `cg-theme-auto` class listens to media query, toggles light/dark. Files: `theming/tokens.css`.
5. **Theme variants per-grid via shadow root option** — `CGridOptions.shadowRoot: true` mounts the grid inside a shadow root for full CSS encapsulation. Files: `cgrid.ts`.
6. **Theme docs site section** — Updates to `docs/catalog/21-themes-and-styling.md`. Files: docs.

**Exit criteria:** FM Area 21 = 100% ✅; demo theme toggle plus density toggle.

---

## Cycle 22 — Events + state

**Goal:** Wire every event in Area 22 + the `getState`/`setState` snapshot
API that Cycles 23+ (a11y, persistence demos) depend on.

**FM rows covered:** Area 22 (~10 of 11 rows) + Area 23 (state-related API:
`getState`, `setState`, `stateUpdated`).

**Depends on:** Cycle 11 (side bar state needs to be part of snapshot).

**Performance gate:** State snapshot < 5 ms for 50-column / 10-group grid.

**Tasks (7):**

1. **Remaining events audit** — Compare our `CGridEvent` union to ag-grid's. List missing: e.g., `cellMouseOver`, `cellMouseOut`, `cellKeyDown`, `cellKeyPress`, `bodyScroll`, `bodyScrollEnd`, `viewportChanged` refinement. Files: `types.ts`, `cgrid.ts`.
2. **Wire mouse hover events** — `cellMouseOver`, `cellMouseOut`, `cellMouseDown`, `rowMouseOver`. Coalesce per row crossing. Files: `interaction/features/onHover.ts`.
3. **Wire body-scroll events** — `bodyScroll` (per scroll event) + `bodyScrollEnd` (debounced). Files: `cgrid.ts`.
4. **Wire key events** — `cellKeyDown` / `cellKeyPress` on the focused cell. Files: `interaction/features/keyPaging.ts`.
5. **`getState()`** — Returns a snapshot of column state + filter model + sort model + side bar state + pivot mode + group state + scroll position. Files: `cgrid.ts`, `core/stateSnapshot.ts` (new).
6. **`setState(snapshot)`** — Restores from snapshot. Files: `cgrid.ts`.
7. **`stateUpdated` event** — Fires when any state component changes (debounced). `gridState` initial option for first-render state. Files: `cgrid.ts`.

**Exit criteria:** FM Area 22 ≥95% ✅; FM Area 23 state rows ✅; demo: save state to localStorage, reload restores.

---

## Cycle 23 — Accessibility + keyboard

**Goal:** WCAG 2.1 AA compliance, full keyboard navigation matrix
(ag-grid parity + better), screen-reader narration via the existing
`A11yOverlay`, high-contrast theme.

**FM rows covered:** Area 20 (~19 of 19 rows).

**Depends on:** Cycle 22 (state events feed a11y announcements).

**Performance gate:** A11y overlay updates batched per frame; key handler
< 1 ms.

**Tasks (8):**

1. **Keyboard matrix completion** — Home/End/PageUp/PageDown/Ctrl+Home/Ctrl+End/Tab/Shift+Tab/Ctrl+arrows/F2/ESC/Enter. Edit-mode key matrix. Selection-mode key matrix (Shift+arrow, Ctrl+Shift+arrow, Ctrl+A, Ctrl+Space, Shift+Space). Files: `interaction/features/keyPaging.ts`, `interaction/features/cellSelection.ts`.
2. **`suppressKeyboardEvent` per column** — Callback opts cells out of grid's key handling. Files: `core/propertyChain.ts`, `interaction/featureChain.ts`.
3. **A11y overlay completeness** — Aria-roles (grid, row, columnheader, gridcell), aria-rowcount, aria-colcount, aria-rowindex, aria-colindex, aria-sort, aria-expanded, aria-level. Files: `interaction/a11yOverlay.ts`.
4. **Screen-reader announcements** — Sort change, filter change, selection change, edit start/end. Files: `interaction/a11yOverlay.ts`.
5. **High-contrast theme** — `cg-theme-high-contrast` with WCAG AAA contrast ratios, thicker focus rings, no semi-transparent selection. Files: `theming/tokens.css`.
6. **Focus management** — Focus trap inside grid; `tabToNextHeader` / `tabToPreviousHeader` config. Files: `interaction/features/keyPaging.ts`.
7. **Reduced motion** — `prefers-reduced-motion` disables row animations, flash, scroll-smoothing. Files: `theming/tokens.css`, `renderer/painters/byRows.ts`.
8. **axe-core CI gate** — Add automated a11y check to E2E suite. Files: `apps/cgrid-positions/tests/a11y.spec.ts`.

**Exit criteria:** FM Area 20 = 100% ✅; axe-core E2E reports zero violations; keyboard-only navigation demonstrably complete.

---

## Cycle 24 — Performance hardening

**Goal:** Hit and exceed the Performance Budget targets. Introduces a
benchmark harness (perf CI), explores OffscreenCanvas paint mode,
dictionary-coded text columns, varint-encoded numeric chunks, GPU-flavored
cell flash. This is the "many times more performant than ag-grid" cycle.

**FM rows covered:** Area 26 (~36 of 38 rows).

**Depends on:** Cycle 23 (a11y must not regress).

**Performance gate:** All targets in the Performance Budget table met or
exceeded. Benchmark harness runs in CI; PRs cannot regress past published
numbers.

**Tasks (10):**

1. **Benchmark harness** — Vitest bench suite covering all targets in the Performance Budget table. Outputs JSON; uploads to a `perf/baselines.json` checked into git for diff. Files: `cgrid/bench/*.ts` (new), `.github/workflows/perf.yml` (or local-only).
2. **Dictionary-coded text columns** — String columns with low cardinality (< 256 distinct values) ship as `Uint8Array` indices + a small string table. Compression ratio + scan-speed win. Files: `worker/chunkFormat.ts`.
3. **Varint-encoded delta-coded numeric columns** — For monotonically-increasing or low-magnitude integer columns. Decodes to `Float64Array` at viewport time. Files: `worker/chunkFormat.ts`.
4. **OffscreenCanvas paint mode (opt-in)** — `CGridOptions.useOffscreenCanvas: true` mounts the canvas as an `OffscreenCanvas` transferred to a paint worker. Main thread sends viewport state via `postMessage`; worker does the entire byRows + gridLines paint. Files: `core/canvasOffscreen.ts` (new), `renderer/paintWorker.ts` (new).
5. **Allocation audit** — Profile hot paths (paint loop, hit test, scroll handler, worker dispatch). Remove all `.map / .filter / .slice / spread` in those paths. Files: across `cgrid/src/**`.
6. **Direct typed-array views into chunk** — Cell-data lookup returns the raw typed-array slot, not a `{ value, valueFormatted }` object. Formatter applied lazily by renderer. Files: `worker/chunkFormat.ts`, `renderer/painters/byRows.ts`.
7. **GPU cell-flash overlay** — Switch from per-cell repaint to a single offscreen alpha-mask canvas redrawn on the flash schedule; composited over the body via `globalAlpha`. Files: `renderer/flashOverlay.ts` (new).
8. **Pre-emptive viewport fetch** — Predictive scroll: when scroll velocity > threshold, fetch the next 5 chunks ahead in scroll direction. Files: `cgrid.ts`.
9. **Worker message coalescing** — Multiple `getViewport` requests within one frame collapse to a single dispatch. Files: `worker/client.ts`.
10. **Memory-pressure release** — `WeakRef`-based chunk eviction when memory budget exceeded. Files: `worker/chunkCache.ts` (new).

**Exit criteria:** FM Area 26 ≥95% ✅; benchmark suite green at all target numbers; published perf comparison vs AG Grid 35.x in `docs/PERFORMANCE.md`.

---

## Cycle 25 — 1.0 release

**Goal:** Ship cgrid 1.0. Bundle audit, generated API reference site,
migration guide for AG Grid users, final FM verification (every row marked
✅ shipped, ⚠️ partial with caveat, or ❌ deliberately omitted with rationale),
npm publish.

**FM rows covered:** All remaining ⚠️/❌ rows audited and resolved.

**Depends on:** Cycle 24.

**Performance gate:** All perf budgets hold; no regression in any cycle's
benchmarks.

**Tasks (8):**

1. **Tree-shake + bundle audit** — Confirm < 150 KB gz core + < 80 KB gz worker. Remove dead code; tighten side-effect annotations in `package.json`. Files: `cgrid/package.json`, `cgrid/vite.config.ts`.
2. **API reference site** — TypeDoc → static site under `docs/api/`. Hosted on GitHub Pages or similar. Files: `typedoc.json`, `docs/api/*` (generated).
3. **Migration guide (AG Grid → cgrid)** — A `docs/MIGRATING.md` walking through ag-grid → cgrid rename cheatsheet, breaking-shape examples, performance gains. Files: `docs/MIGRATING.md`.
4. **FM verification sweep** — Every row in `FEATURE_MATRIX.md` updated to ✅ / ⚠️ / ❌ with current status; verifications signed off. Files: `docs/catalog/FEATURE_MATRIX.md`.
5. **Cookbook docs** — `docs/cookbook/` with 20+ task-recipe examples (custom cell renderer, integrate with React/Vue/Svelte, server-side data source, theming, etc.). Files: `docs/cookbook/*.md`.
6. **CHANGELOG.md** — Full release notes 0.x → 1.0. Files: `cgrid/CHANGELOG.md`.
7. **npm publish dry-run** — `npm publish --dry-run`, verify package contents, missing files, license. Files: `cgrid/package.json`, `cgrid/LICENSE`.
8. **npm publish 1.0.0** — Final publish. Tag `v1.0.0`. GitHub release with bundle artifacts + perf report. Files: git tag + release.

**Exit criteria:** cgrid 1.0.0 on npm; docs site live; FM 100% accounted for; perf budgets documented.

---

## Quick reference — per-cycle workflow

Each cycle gets its own expanded worklog file authored at cycle start. The
expanded worklog follows the **same per-task-per-session structure as Cycles
2 and 3**:

1. Open this master plan + the matching `docs/catalog/NN-*.md` area file(s) for the cycle.
2. Author `docs/superpowers/plans/2026-MM-DD-canvasgrid-cycle-NN-{theme}.md` with task-level detail (Goal / Why / Read first / Files / Interfaces / Steps / Acceptance criteria / Next session prompt per task).
3. Execute via the same subagent-driven-development skill that drove Cycle 2/3 — one fresh session per task, implementer → review → fix → ledger.
4. At cycle exit: update `FEATURE_MATRIX.md` rows to ✅; append "Cycle N status: COMPLETE" + shipped-feature summary to the progress ledger.

---

## Starter prompt for Cycle 4 (first cycle of this plan)

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md (the master)
and author docs/superpowers/plans/2026-MM-DD-canvasgrid-cycle-04-foundation-gaps.md
expanding Cycle 4's 10 tasks to the per-session detail level that
docs/superpowers/plans/2026-06-23-canvasgrid-hypergrid-port.md uses. Then begin
Task 1 (Column group model + ColGroupDef types). Read docs/catalog/02-column-model.md
section on ColGroupDef before touching any code. Follow the per-task workflow.
```

---

## What this plan does NOT include (deliberate omissions)

- **No React / Vue / Svelte / Angular adapters.** cgrid is vanilla TS; framework integration is left to the consuming app (a thin adapter is a 50-line file, not a cycle).
- **No Polaris-style declarative DSL.** cgrid stays imperative — `new CGrid(host, options)`.
- **No license keys, no telemetry, no enterprise edition.** Single-tier OSS.
- **No legacy IE / pre-2020 browser support.** Modern browsers only (Chromium ≥ 100, Firefox ≥ 100, Safari ≥ 15.4).
- **No SSR.** Canvas-grid by definition is client-render. SSR shells render an empty host that hydrates client-side.
- **No "Excel mode" pixel-perfect mimicry beyond AG Grid's coverage.** Where ag-grid stops, we stop.
