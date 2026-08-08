# Canvasgrid Cycle 18 — Pivoting — Implementation Plan

> Branch: `feature/pivoting`. Reconciles the existing design note
> (`docs/superpowers/plans/notes/cycle-18-pivoting-design.md`) with the
> user-supplied AG-Grid-parity spec
> (`pivot-behaviors-prompts.md`, v36.0.0 grounded) and the codebase
> integration map below. Each task: TDD unit tests + (where observable)
> E2E; showcase the feature in `apps/cgrid-showcase`. Commit per task.

## Mental model (load first)

Pivot is a **column transformation**, not a new render mode. Primary
columns hold three possible roles while `pivotMode` is on:
**Row Group** (left axis), **Value** (aggregated numbers), **Pivot /
Column Label** (distinct values become column headers). The grid
synthesizes **secondary columns** = (distinct pivot-key combinations) ×
(value columns), nested under pivot **column groups**. Body cells are
aggregates of leaves matching `rowGroupPath × pivotKeyPath`.

`pivot = grouping (rows) × aggregation (cells) × column synthesis (headers)`.

## Codebase integration map (from research)

- **Pipeline:** PivotPass slots in `worker/worker.ts` AFTER `GroupPass.apply()`
  (~line 238) and influences/precedes the agg+sort path. `GroupNode.childIndices`
  (`worker/passes/groupPass.ts`) index into the post-filter `ids` array;
  `store.getById(ids[idx])` reads the leaf row.
- **Aggregation:** reuse `AggFuncRegistry.resolve(name)` (`worker/aggFuncRegistry.ts`) —
  no new agg math. Per-(rowKey × pivotKey × valueCol) buckets.
- **Transport:** new chunk fields on `ViewportChunk` (`worker/protocol.ts`),
  bump `CHUNK_FORMAT_VERSION` 2→3 (append-only); add typed arrays to
  `collectViewportTransferables`.
- **Column synthesis:** mirror `synthesizeAutoGroupColumns()`
  (`core/autoGroupColumn.ts`) — build `ResolvedColDef`/`CColGroupDef` via
  `resolveColDef` / `resolveColumnTree`, inject into the leaf order. Pivot
  levels ARE column-group levels → `HeaderGroupSubgrid` (`core/subgrid.ts`)
  renders them verbatim; `byRows.ts` already spans group headers.
- **Column state:** `pivot?` / `pivotIndex?` slots ALREADY exist and
  round-trip in `core/columnState.ts` (snapshot line ~94, apply line ~223).
  No type additions for persistence — just wire the model.
- **State primitive:** mirror `GroupingState` (`core/groupingState.ts`) +
  its `groupingStateChanged` event for `PivotState` + `pivotStateChanged`.
- **UI:** extend `interaction/toolPanels/columnsPanel.ts` (Values + Column
  Labels drop zones), add a sibling pivot panel to
  `interaction/rowGroupPanel/host.ts`, pivot items in
  `interaction/contextMenu/mainMenuDefaults.ts`.

## Task list

Engine core (Prompts 1–4) must land before UI (5–7) and close-out (8–9).

| # | Title | Prompt(s) | Key files | Tests |
|---|-------|-----------|-----------|-------|
| 1 | **Pivot state model + role API** — `PivotState` (pivotMode, ordered pivotCols, ordered valueCols{colId,aggFunc}); per-col `pivot`/`enablePivot`/`enableValue`; imperative API (`isPivotMode`/`setPivotMode`, get/set/add/remove Pivot+Value columns); `pivotStateChanged` event. pivotMode persists separately from column state. | 1 | `core/pivotState.ts` (new), `velocityGrid.ts`, `types.ts` | `pivotState.test.ts` |
| 2 | **PivotPass (worker)** — distinct pivot-key discovery (single scan, cached) + per-(rowKey × pivotKey × valueCol) aggregation via AggFuncRegistry; emits `pivotColumnTree` + `pivotValues` + `pivotKeysByLevel`. Pipeline wiring + `setPivotModel` message. | 2,3 | `worker/passes/pivotPass.ts` (new), `worker/worker.ts`, `worker/protocol.ts`, `worker/client.ts`, `worker/chunkFormat.ts` | `pivotPass.test.ts`, `pivotPass.perf.test.ts` |
| 3 | **Pivot column synthesis (main)** — merge `pivotColumnTree` into the column order while pivot active; hide primary cols, keep auto-group col; pivot cells read from `pivotValues`; revert cleanly on `setPivotMode(false)`. | 2 | `core/pivotColumns.ts` (new), `velocityGrid.ts`, `renderer` cell lookup | `pivotColumns.test.ts` + E2E |
| 4 | **Pivot column-group expand/collapse** — collapsed-by-default group headers show the group aggregate; expand reveals child columns; `pivotDefaultExpanded`; hit-testable header affordance; preserve `scrollLeft`. | 4 | `core/subgrid.ts`/column-group state, `renderer/painters`, `velocityGrid.ts` | `pivotColGroupExpand.test.ts` + E2E |
| 5 | **Columns tool panel pivot sections** — pivotMode toggle, Values + Column Labels drop zones above Row Groups, **pivotMode-dependent checkbox semantics** (OFF=visibility, ON=role-add), drag/drop role assignment gated by enableX. | 5 | `interaction/toolPanels/columnsPanel.ts`, `tokens.css` | `toolPanelPivot.test.ts` + E2E |
| 6 | **Pivot panel (top-of-grid)** — pills per pivot col, drag header in / pill out / reorder; `pivotPanelShow: always\|onlyWhenPivoting\|never`; shares pivotCols with the tool panel (one list, two views). | 6 | `interaction/pivotPanel/host.ts` (new), `velocityGrid.ts`, `tokens.css` | `pivotPanel.test.ts` + E2E |
| 7 | **Context menu pivot items** — Add/Remove from Labels (enablePivot), Group/Un-Group (enableRowGroup, exists), Value: Aggregate <col> submenu (enableValue); same state mutators as drag. | 7 | `interaction/contextMenu/mainMenuDefaults.ts` | `contextMenuPivot.test.ts` + E2E |
| 8 | **Filtering / sorting / state + parity flags** — filter on primary cols re-derives pivot key groups; `enableStrictPivotColumnOrder` (append vs re-sort) + `pivotComparator`; sort secondary col sorts row groups; Grid State save/restore (pivotMode separate); pivot totals (`pivotRowTotals`/`pivotColumnGroupTotals`); `processPivotResultColDef`; `pivotMaxGeneratedColumns` cap + `pivotMaxColumnsReached` event; pivot events. | 2,3,8 | `worker/passes/pivotPass.ts`, `velocityGrid.ts`, `core/pivotState.ts`, `types.ts` | `pivotFilterSortState.test.ts`, `pivotTotals.test.ts`, `pivotCap.test.ts` |
| 9 | **Perf + correctness gate + showcase + exit** — Prompt 9 assertions (single-scan key discovery, incremental tick delta up both ancestor chains, O(visible) x-offset recompute, checkbox semantics, shared-list invariant, filter re-add order, state round-trip determinism); showcase `pivot` feature + E2E; FM Area 11 flips. | 9 | `tests/pivotPerf.test.ts`, `tests/pivotInvariants.test.ts`, `apps/cgrid-showcase/**`, `docs/catalog/FEATURE_MATRIX.md` | full gate |

## Global constraints

- TypeScript strict, no `any` in new code. `npm test` + all E2E stay green.
- Reuse, don't duplicate: `AggFuncRegistry`, `HeaderGroupSubgrid`,
  `resolveColumnTree`/`resolveColDef`, `GroupingState` patterns, the
  Cycle 15.5 pill/drop-zone vocabulary.
- Every new feature gets a showcase page + a behavioural E2E (not smoke).
- Each task: commit on `feature/pivoting`, cite the design note.

## Out of scope (later cycles)

- Date-component pivot hierarchies (`groupHierarchy` on pivot colDef) —
  Prompt 2 follow-up; deferred.
- Edit-through on aggregated pivot cells — Prompt 3 follow-up; deferred.
- `agPivotPanelToolbarItem` (Quick Access Toolbar) — needs a toolbar host.
