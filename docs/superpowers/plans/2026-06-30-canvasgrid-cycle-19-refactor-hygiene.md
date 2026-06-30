# Canvasgrid Cycle 19 — Refactor Hygiene — Implementation Plan

> Branch convention: one branch per task (`refactor/cycle19-task-N-<slug>`).
> Each task lands as its own PR — the structural extractions are
> independent and reviewing them as a single mega-diff is impractical.
> Sprint 0 (DisposableRegistry + listener-leak plumbing + filter-Set pre-build
> + lazy `applyCellProps`) already shipped on `refactor/leak-perf-hygiene`
> (commit `ed39626`); this cycle is the remaining 8 items from the
> 2026-06-30 critical-analysis report.

## Mental model (load first)

`CGrid<TRow>` in [cgrid.ts](cgrid/src/cgrid.ts) is a **god object**:
8,658 lines, 209 members, 8 orthogonal subsystems tangled together. The
job of this cycle is **subsystem extraction with stable seams**, not
behaviour change. Every task in this plan is invariance-preserving: no
new features, no removed features, no styling changes, no public-API
breaks. The grid the user sees at the end of cycle 19 is byte-for-byte
the grid they see today; the internal call graph is what changes.

The extraction pattern, repeated across tasks 2–7:

1. Identify the seam: the set of fields + methods on `CGrid` that
   belong to one subsystem and the call edges that cross into the rest.
2. Create the manager class with its own state + public surface.
3. `CGrid` holds the manager as a field; delegating wrappers stay on
   `CGrid` for backward compatibility with internal callers.
4. Move tests in lockstep — `tests/<manager>.test.ts` for the new
   surface, existing integration tests stay green.
5. Each PR ends with a green run of: `npx tsc --noEmit`, full unit
   suite, full showcase E2E, full positions E2E.

## Codebase integration map (from research)

- **God object**: [cgrid.ts](cgrid/src/cgrid.ts) lines 660-700 hold ~70
  instance fields covering scroll, render, data, worker, selection,
  editing, pivot, grouping, columns, filters, flash, panels. Every
  manager extraction below picks a contiguous slice of those fields.
- **Subsystem seams already exist** as constructor-ordered comments
  (search for `// N.` step markers in the constructor) — the order is
  approximately the dependency graph; extract from the leaves first.
- **Worker dispatch**: [worker/worker.ts](cgrid/src/worker/worker.ts)
  lines 628–1487 are a single `onmessage` switch over 33 request
  types. Each case is 30–100 LoC of inline logic.
- **Type kitchen sink**: [types.ts](cgrid/src/types.ts) — 3,170 lines,
  ~80 flat exports, zero domain grouping. `CGridOptions` alone is ~960
  lines (293–1253).
- **Panel multiplexer**:
  [interaction/toolPanels/columnsPanel.ts](cgrid/src/interaction/toolPanels/columnsPanel.ts)
  is 1,408 lines holding 4 unrelated UI concerns (visibility list +
  row-groups zone + pivot zone + values zone).
- **Generics gap**: [types.ts:54](cgrid/src/types.ts#L54) declares
  `TRow = any`; the public API uses `unknown[]` / `any[]` in 240+ cast
  sites which the strict-generic pass will surface.
- **Existing DisposableRegistry** (just shipped) at
  [core/disposable.ts](cgrid/src/core/disposable.ts) is the teardown
  primitive every extracted manager must use.

## Task list

Extract in **bottom-up order** so each extraction can be reviewed
against a stable base: types first (no runtime effect), then leaf
managers (Viewport, Worker, Edit), then state managers (Pivot,
Grouping, ColumnState), then the worker dispatcher, then the panel
split, then API-surface hygiene.

| # | Title | Key files | Tests | Risk |
|---|-------|-----------|-------|------|
| 1 | **Split [types.ts](cgrid/src/types.ts) into domain modules** — `types/api.ts`, `types/column.ts`, `types/cell.ts`, `types/filter.ts`, `types/group.ts`, `types/pivot.ts`, `types/event.ts`, `types/clipboard.ts`. `types.ts` becomes a thin re-export façade so every existing `import { X } from '../types'` still works. Type-only; zero runtime change. | `cgrid/src/types/**` (new), `cgrid/src/types.ts` (façade) | `npx tsc --noEmit` across workspace | Low |
| 2 | **Extract `ViewportManager`** — scroll state (`scrollLeft`, `scrollTop`, `scrollVelocityRows`, `scrollEndTimer`, `lastScrollSample*`), `recomputeViewport`, `requestViewport`, prefetch range, viewport invalidation. Owns the scroller listener (already routed through `disposables`). `CGrid` delegates via `this.viewport.recompute()` / `this.viewport.request()`. | `cgrid/src/core/viewportManager.ts` (new), `cgrid.ts` (slim) | `viewportManager.test.ts` (new) + integration green | Med |
| 3 | **Extract `WorkerCoordinator`** — `workerClient` ownership, transaction queue, async-tx flushing, viewport request dispatch, the main↔worker pipeline glue (`handleViewport`, `requestViewport` plumbing). `CGrid` becomes the consumer. | `cgrid/src/core/workerCoordinator.ts` (new), `cgrid.ts` | `workerCoordinator.test.ts` + integration green | Med |
| 4 | **Extract `EditController`** — `editor`, `rowEdit`, `activeEdit`, the capture-phase keydown matrix (already routed through `disposables`), the `editorContainer` mousedown handler, `nextEditableCell`, `openEditor` / `stopEditing` lifecycle, full-row-edit bridging. | `cgrid/src/core/editController.ts` (new), `cgrid.ts` | `editController.test.ts` + integration green | Med |
| 5 | **Extract `PivotEngine` + `GroupingCoordinator` + `ColumnStateManager`** — three sibling state extractions (the existing `PivotState` / `GroupingState` are just the data models; the coordinators own the cgrid-side wiring: column tree swaps, scrollLeft preservation across pivot toggles, subscribe/unsubscribe loops, default expansion materialisation, `setRowGroupColumns`/`setPivotColumns`/`setValueColumns` API). One PR per coordinator. **PivotEngine carries a behavioural gap to close**: when `setPivotMode(true)` flips on, auto-hide all primary columns (AG-v36 parity) so the strict role-only checkbox semantic becomes coherent — this re-enables the two `test.fixme`-marked specs in `cycle18-task5-pivotToolPanel.spec.ts:221, 252` and lets `computeRowChecked` in `columnsPanel.ts` switch from `visible OR role` to `role only` without breaking the showcase `panelDragRouting.spec.ts` tests. | `cgrid/src/core/pivotEngine.ts`, `cgrid/src/core/groupingCoordinator.ts`, `cgrid/src/core/columnStateManager.ts` (all new), `cgrid.ts`, `cgrid/src/interaction/toolPanels/columnsPanel.ts` | `pivotEngine.test.ts`, `groupingCoordinator.test.ts`, `columnStateManager.test.ts` + integration green; re-enable the two fixme E2E specs | Med-High |
| 6 | **Split [worker/worker.ts](cgrid/src/worker/worker.ts) `onmessage` dispatcher into per-domain handlers** — `DataPipelineHandler`, `FilterHandler`, `GroupHandler`, `PivotHandler`, `ViewportServiceHandler`, `ExportHandler`, `ClipboardHandler`. Single `onmessage` becomes a typed dispatch table keyed by `request.type` → handler method. State (`store`, `columns`, model objects) moves to a `WorkerState` class held by the dispatcher. | `cgrid/src/worker/handlers/**` (new), `cgrid/src/worker/worker.ts` (thin) | All `worker/passes/*.test.ts` green; new `workerDispatch.test.ts` for typed-dispatch | Med |
| 7 | **Split [columnsPanel.ts](cgrid/src/interaction/toolPanels/columnsPanel.ts) into 4 sub-panels** — `ColumnVisibilityPanel`, `RowGroupsZonePanel`, `PivotColumnsZonePanel`, `ValuesZonePanel` composed by a thin shell. Each sub-panel owns its event subscription + DOM. Pre-req: cycle19-task7 only ships once the 14 pre-existing panel E2E failures are green so the refactor has a stable signal. | `cgrid/src/interaction/toolPanels/columns/**` (new), `cgrid/src/interaction/toolPanels/columnsPanel.ts` (shell) | `columnVisibilityPanel.test.ts`, `rowGroupsZonePanel.test.ts`, `pivotColumnsZonePanel.test.ts`, `valuesZonePanel.test.ts` + full panel E2E suite | Med-High |
| 8 | **API hygiene pass** — three sub-passes, each a separate PR: (a) tighten the generic at the public surface — replace `TRow = any` with a real generic propagated through `setRowData` / `applyTransaction` / `getRowByIndex` etc., fix the resulting `as` casts; (b) replace boolean-flag parameter explosions with discriminated unions / option objects (start with the `paintCell` family in `byRows.ts` + the cell-renderer registry signatures); (c) normalize naming — `rowId` and `colId` only (no `id`, no `key` for row identity; no `columnId` for column identity), enforced by an ESLint custom rule. | `cgrid/src/**` (wide), `eslint.config.*` (new rule), `cgrid/tests/**` (callsites) | Full unit + E2E green; new lint rule has its own test fixtures | Med |

## Global constraints

- TypeScript strict, no `any` in new code. `npm test` + all E2E stay green on every PR.
- No behaviour, look-and-feel, or styling change — this entire cycle is internal.
- Every manager extraction reuses [core/disposable.ts](cgrid/src/core/disposable.ts) for teardown. The DisposableRegistry contract IS the new lifecycle vocabulary; don't reintroduce raw `addEventListener` / `requestAnimationFrame` / `setTimeout` without routing through a registry.
- Public API surface is frozen for cycle 19. Anything that changes the `CGridApi` shape is out of scope until cycle 20.
- Each task PR cites the master analysis report at the top of its description and links back to this plan.
- Commit-per-extraction inside a task is fine; squash on merge.

## Definition of done (per task)

1. New module(s) created with a focused public surface and unit tests.
2. `CGrid` (or `worker.ts` / `columnsPanel.ts`) reduced by the
   extracted concern's LoC; field/method count drops measurably.
3. `npx tsc --noEmit` clean.
4. `npm test` — all unit suites pass, including new ones.
5. `npm run build:cgrid` clean.
6. E2E showcase (97 tests) — all pass.
7. E2E positions (259 tests) — all pass once the pre-existing 14 panel
   regressions are fixed (the prerequisite task that runs before cycle
   19 / Task 7).
8. The visible grid is unchanged — screenshots before/after match.

## Prerequisite (before any task above)

Fix the 14 pre-existing E2E failures on `main` in
`apps/cgrid-positions/e2e/cycle18-*` and `cycle11-columnsPanel.spec.ts`.
These tests don't match the current panel implementation (section
order + default pivot-panel visibility) after the recent panel
reorder. Until they're green, the panel-touching tasks (5, 7) have no
trustworthy regression signal.

## Out of scope (cycle 20+)

- Public API breaks (`TRow` generics tightening at the user-facing
  surface MAY surface needs — defer to cycle 20).
- Performance optimisation beyond what Sprint 0 already shipped (set
  filter pre-build, lazy callbackParams). Further wins (canvas
  save/restore batching, viewport buffer reuse) are cycle 21.
- New features. Anything that adds capability is a different cycle.
- Test infrastructure changes (Playwright config, vitest config).
