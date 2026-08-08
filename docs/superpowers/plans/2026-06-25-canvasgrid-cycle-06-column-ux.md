# Canvasgrid Cycle 6 — Column UX Completeness — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to execute this worklog task-by-task.
> Each task below is designed to fit in a single, isolated Claude Code session.
> Run one task per session, verify, commit, then START A NEW SESSION using the
> "Next session prompt" at the end of the task. Do NOT chain multiple tasks in
> one session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship everything a user does with columns after the first paint — drag
to reorder, persist + restore the full column state, fit to container, auto-size
to content, mutate visibility / pinning / width / order through an imperative
API, share property bundles via `columnTypes`, drive per-cell + per-header
styling through `cellClass` / `cellClassRules` / `cellStyle` / `headerClass`,
and fire the column-event surface (`columnVisible` / `columnPinned` /
`columnMoved` / `columnResized` (finished flag) / `virtualColumnsChanged` /
`displayedColumnsChanged` / `columnsReset`) so app code can react.

**Architecture:** Column state — width / hide / pinned / sort / sortIndex /
flex / rowGroup / pivot / aggFunc — lives on the `ResolvedColDef` already in
`columnDefsMap`. Cycle 6 introduces `core/columnState.ts` to snapshot + restore
the state, and `core/columnOrder.ts` to centralise the "move this leaf to this
index" + "what's the visible-column-order after groups & pinning" logic that
`velocityGrid.ts` currently inlines. Drag-reorder is a new `ColumnDrag` Feature that
mounts a ghost header in the same DOM editor-layer used by popup editors, then
calls the same `reorderColumn` API the imperative `moveColumns` uses. Autosize
runs on the worker via `OffscreenCanvas.measureText` (the Cycle 5 / Task 8
machinery extended with a "measure widths" pass). `cellClass` / `cellStyle`
resolution happens once per cell during the existing `applyCellProps` call;
`classRules` short-circuit on first match. None of these change the
single-canvas paint model — they all extend the per-cell config that already
flows into the painter.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E), single-canvas
2D paint, Web Worker data + measure pipeline, native scrollbars, CSS-variable
theming. No new runtime dependencies. Drag uses native pointer events; no
HTML5 drag-and-drop (canvas is not a valid drop target on Safari).

**References (READ FIRST when starting any task):**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan (Cycle 6 at line 217)
- `docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md` — Cycle 5 worklog (shape mirrored here; perf budget carried forward)
- `docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md` — Cycle 4 worklog (column-group state model + runtimeOptions + `displayedColumnsChanged` already shipped)
- `docs/catalog/02-column-model.md` — source of truth for ColDef sizing / visibility / locking / styling, and the API surface this cycle ships
- `docs/catalog/16-pinning-and-layout.md` — pin events, lockPinned, frozen-pane refinement
- `docs/catalog/22-events.md` — column event payloads
- `docs/catalog/23-api.md` — imperative API surface
- `docs/catalog/FEATURE_MATRIX.md` — rows to flip to ✅ at cycle exit
- Cgrid source: `cgrid/src/velocityGrid.ts`, `core/{columnTree,columnGroupState,propertyChain,layout}.ts`, `interaction/features/columnResizing.ts`, `interaction/featureChain.ts`, `interaction/hitTester.ts`, `worker/measureText.ts`, `worker/protocol.ts`
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task**. Extends the constraints from Cycles 2 / 3 / 4 / 5.
New ones marked **NEW** for this cycle.

### Carried from Cycle 2 / 3 / 4 / 5
- **API parity, not API mimicry.** Field names mirror ag-grid verbatim
  (`suppressMovable`, `lockPosition`, `lockVisible`, `lockPinned`, `hide`,
  `initialHide`, `initialWidth`, `initialPinned`, `suppressSizeToFit`,
  `suppressAutoSize`, `columnTypes`, `cellClass`, `cellClassRules`,
  `cellStyle`, `headerClass`). Top-level type names keep the `C` prefix
  (`CColumnState`, `CApplyColumnStateParams`). String identifiers carry no
  `ag` prefix.
- **No regressions in the public API.** Cycle 6 is purely additive on every
  existing surface. `VelocityGridApi.setGridOption('rowHeight', …)` still works;
  the new `setColumnWidths` is a parallel surface — it does not replace the
  internal `resizeColumn(colId, dx)` Cycle 4 wired (which keeps powering the
  drag-resize feature).
- **TypeScript strict mode.** Every `cgrid/src/**/*.ts` compiles clean under
  `npm run --workspace=cgrid typecheck` at the end of every task.
- **`alpha: false` canvas context, single-canvas rendering, DPR-aware paint,
  no per-cell `strokeRect`** — unchanged.
- **Web Worker stays the data + measure layer.** Autosize measurement runs on
  the worker (or its main-thread fallback). Main thread never measures text
  for autosize directly — only for the `OffscreenCanvas`-unavailable
  fallback already plumbed by Cycle 5 / Task 8.
- **Native browser scrollbars** — unchanged. `sizeColumnsToFit` accounts for
  the scrollbar's gutter so the fit width matches the visible inner width.
- **Vitest unit + Playwright E2E green at end of every task.** Drag-reorder,
  state round-trip, autosize, sizeToFit, classRules — each gets at least one
  E2E in `apps/cgrid-positions/e2e/cycle6-*.spec.ts` (mirrors the per-feature
  spec-file layout Cycle 5 followed). E2E required for UI features — unit
  tests alone do not gate task completion (per `feedback_e2e_for_ui.md`).
- **Conventional commits.** Each task = one or more focused commits, body
  footer `Cycle 6 / Task N.`.
- **Documentation as you go.** Each public API or type added gets (a) a TSDoc
  block on the symbol, (b) the matching FM row flipped to ✅ in
  `docs/catalog/FEATURE_MATRIX.md`, and (c) a one-line entry in this
  worklog's "Shipped" list at cycle exit.
- **Demo never breaks.** `apps/cgrid-positions` runs after every task. Demo
  wiring lands in the same commit as the feature.

### NEW for this cycle
- **Column state apply is a single re-layout.** `applyColumnState` walks the
  state array once, mutates the `ResolvedColDef` slots in `columnDefsMap`,
  then performs ONE `computeVisibleColumnOrder + resolveColumnWidths +
  recomputeViewport + requestRepaint` cycle — not N+1. Same rule for
  `setColumnsVisible` / `setColumnsPinned` / `setColumnWidths` / `moveColumns`:
  one re-layout per call, even for a 50-column batch. Verified by an
  invariant test that spies on `recomputeViewport`.
- **Column state shape is stable, even for slots not yet wired.** The
  `CColumnState` interface defines `rowGroup`, `rowGroupIndex`, `pivot`,
  `pivotIndex`, `aggFunc` slots now so apps persisting state today don't
  break when Cycle 13 / 14 / 17 light up the model logic. Until those
  cycles, the slots round-trip as opaque pass-through values (kept on the
  resolved col-def) but do not yet drive grouping / pivoting.
- **Drag must respect locks AND groups.** `lockPosition: true | 'left' | 'right'`
  pins the column to the start / end / current index; a drag that would
  break the lock is dropped at the nearest legal index. `marryChildren` on
  the enclosing column group rejects any drop outside the group. Hit
  feedback (insertion line) shows the resolved legal target, not the raw
  mouse position.
- **Autosize is a worker round-trip.** Main thread issues `{type: 'autosize',
  colIds: string[], skipHeader: boolean}`; the worker measures via the
  Cycle 5 `measureText` cache, hits every chunk it has, and posts back
  `{type: 'autosizeResult', widths: Record<colId, number>}`. The worker
  caps the per-column scan at 5,000 rows (sampling head + tail when the
  filtered row count exceeds that) so a 1M-row autosize completes inside
  the perf budget. The autosize result clamps to `minWidth` / `maxWidth`
  on the main thread before applying.
- **`cellClass` / `cellClassRules` are styling hints, not real CSS classes.**
  Per Cycle 4's constraint ("no per-cell DOM"), the canvas renderer cannot
  apply a CSS class to a cell. Instead, the resolved class names are
  looked up in a theme-driven `cellClassVariants` map on the active
  `ResolvedTheme` (CSS variables like `--vg-cell-class-warning-bg`) to
  produce a `ColCellOverrides` patch that fills the existing
  `applyCellProps` slots (`fg` / `bg` / `font` / `halign`). Unknown class
  names fall through to no override. `cellStyle` (function form) returns
  a raw `ColCellOverrides` and bypasses the variants map.
- **`headerClass` lights up the same variants table for header cells.** Same
  mechanism; key prefix `--vg-header-class-…`. The Cycle 4 `headerClass`
  field on `CColGroupDef` was storage-only; this cycle wires it.
- **Performance gates (carry-forward from master plan's Performance Budget
  + Cycle 6 specific).**
  - Column state apply on a 100-column grid completes inside one frame
    (< 16 ms) and triggers exactly one repaint. Verified by a unit test
    that counts repaint requests.
  - `sizeColumnsToFit` on a 100-column grid runs in < 4 ms on main thread
    (pure arithmetic; no measurement).
  - `autoSizeAllColumns` on the demo (8 visible columns × 200 rows live
    from `stomp-view-server`) completes the worker round-trip in < 200 ms
    p95.
  - Drag-reorder paint at 120 fps median — ghost header + insertion line
    repaint per frame must not regress scroll FPS.
- **Allocation discipline in hot paths.** `applyColumnState` mutates the
  existing `columnDefsMap` entries in place — no new `ResolvedColDef`
  objects allocated. `classRules` evaluation uses a cached predicate
  array (one allocation at `resolveColDef` time, none per paint).

---

## Performance Budget (Cycle 6 row in the master Budget table)

| Metric | Target | Why |
|---|---|---|
| `applyColumnState` (100 cols) | < 16 ms; exactly 1 repaint | One-frame budget; user-visible "restore my layout" must feel instant |
| `sizeColumnsToFit` (100 cols) | < 4 ms | Pure layout arithmetic; ratio-distribute + clamp |
| `autoSizeAllColumns` (demo) | < 200 ms p95 | Worker round-trip including measure cache; one-shot user action |
| Drag-reorder scroll FPS | ≥ 120 fps median | Master Budget scroll target preserved while a ghost header repaints |
| Imperative API (`setColumnsVisible` × 50) | < 16 ms; exactly 1 repaint | Same "single re-layout" rule as `applyColumnState` |

---

## Task overview

| # | Task | Primary user-visible win | Files touched |
|---|---|---|---|
| 1 | Drag-reorder + `suppressMovable` + `lockPosition` + `columnMoved` event + internal `reorderColumn` | Users can drag headers to reorder; locked columns refuse to budge | `interaction/features/columnDrag.ts` (new), `interaction/featureChain.ts`, `interaction/hitTester.ts`, `core/columnOrder.ts` (new), `velocityGrid.ts`, `types.ts`, demo, tests |
| 2 | Column state round-trip — `getColumnState` / `applyColumnState` / `resetColumnState` + `columnsReset` event + `hide` / `lockVisible` / `lockPinned` | Save + restore a user's whole layout | `core/columnState.ts` (new), `velocityGrid.ts`, `types.ts`, demo, tests |
| 3 | `sizeColumnsToFit` + `suppressSizeToFit` + `ISizeColumnsToFitParams` | Snap all columns to fill the container | `core/layout.ts`, `velocityGrid.ts`, `types.ts`, demo, tests |
| 4 | `autoSizeColumns` + `autoSizeAllColumns` + `suppressAutoSize` (worker measureText pass) | Snap one column or all columns to the widest visible content | `worker/autosize.ts` (new), `worker/protocol.ts`, `worker/worker.ts`, `worker/client.ts`, `worker/measureText.ts`, `velocityGrid.ts`, `types.ts`, demo, tests |
| 5 | Imperative API — `setColumnsVisible` / `setColumnsPinned` / `setColumnWidths` / `moveColumns` / `moveColumnByIndex` + `columnVisible` / `columnPinned` / `columnMoved` events + `finished` flag on `columnResized` | Programmatic mutation surface for app code | `velocityGrid.ts`, `types.ts`, `interaction/features/columnResizing.ts`, demo, tests |
| 6 | `columnTypes` templates + `CColDef.type: string \| string[]` | Share property bundles across columns | `types.ts`, `core/propertyChain.ts`, demo, tests |
| 7 | `cellClass` + `cellClassRules` + `cellStyle` (function form) + `headerClass` via theme-driven variants | Conditional cell styling without per-cell DOM | `types.ts`, `core/propertyChain.ts`, `renderer/painters/byRows.ts`, `theming/cssReader.ts`, demo, tests |
| 8 | `virtualColumnsChanged` event + `displayedColumnsChanged` payload polish + Cycle 6 exit ritual (FM flips, Shipped list, perf, status) | Event surface complete; FM reflects all Cycle 6 deliverables | `velocityGrid.ts`, `types.ts`, `docs/catalog/FEATURE_MATRIX.md`, this worklog |

---

## Task 1 — Drag-reorder + `suppressMovable` / `lockPosition` + `columnMoved` event + internal `reorderColumn`

**Goal:** Land the column-drag-reorder interaction. Hold mousedown on a header
label (not the resizer hot-zone Cycle 4 wired), drag horizontally, see a
"ghost" header rendered in the DOM editor-layer following the cursor, see an
insertion line drawn on the canvas at the resolved drop target, release to
commit. `suppressMovable: true` (per column) opts the column out of dragging
entirely — the cursor never turns into "grabbing", and the feature consumes
the mousedown without starting a drag. `lockPosition: true | 'left' | 'right'`
constrains where the column may live after any move (also enforced by
`applyColumnState` in Task 2). `marryChildren` on the enclosing group
(already resolved by Cycle 4's `columnTree`) rejects any drop outside the
group. Drop fires `columnMoved`. The core "where does this leaf go in the
columnDefs ordering" math moves into `core/columnOrder.ts` so Task 2 and
Task 5 can reuse it.

**Why this is Task 1:** Every other Task in Cycle 6 either depends on the
`reorderColumn` primitive (Task 2's `applyColumnState` restore, Task 5's
`moveColumns` imperative API) or is independent — none precede it. Lock /
movable semantics live in `ResolvedColDef`, so they need to be defined here
before the imperative API in Task 5 starts respecting them. Drag is also the
most user-visible piece of the cycle, so landing it first puts something
demo-able on the board.

**Read first:**
- `docs/catalog/02-column-model.md` — "ColDef — visibility & locking" table
  (`suppressMovable`, `lockPosition`, `lockPinned`, `lockVisible`)
- `cgrid/src/interaction/features/columnResizing.ts` — the Feature pattern
  Task 1 mirrors; the drag feature uses the same `handleMouseDown` /
  `handleMouseDrag` / `handleMouseUp` lifecycle
- `cgrid/src/interaction/featureChain.ts` — registration order matters (drag
  runs after resize so a near-edge mousedown still resizes instead of dragging)
- `cgrid/src/interaction/hitTester.ts` — the `headerResizer` carve-out
  (Cycle 4); a `header` hit is the drag target
- `cgrid/src/core/columnTree.ts` — `marryChildren` on `ResolvedColGroupDef`
  and `groupPath` on `ResolvedColLeaf` (the drop validator walks these)

**Files:**
- Create: `cgrid/src/interaction/features/columnDrag.ts`
- Create: `cgrid/src/core/columnOrder.ts`
- Modify: `cgrid/src/interaction/featureChain.ts` (append `ColumnDrag` after
  `ColumnResizing`)
- Modify: `cgrid/src/interaction/hitTester.ts` (no change for now — `'header'`
  hit is enough; resizer hot zone already filters out the right edge)
- Modify: `cgrid/src/velocityGrid.ts` (add `reorderColumn(colId, toIndex)` private
  method; expose `moveColumnByIndex` on the API as the public form, deferring
  the multi-key `moveColumns` to Task 5; emit `columnMoved`)
- Modify: `cgrid/src/types.ts` (`CColDef.suppressMovable?: boolean`,
  `CColDef.lockPosition?: boolean | 'left' | 'right'`, `VelocityGridEvent`'s
  `columnMoved` variant, `VelocityGridApi.moveColumnByIndex` signature)
- Modify: `cgrid/src/core/propertyChain.ts` (resolve `suppressMovable` +
  `lockPosition` onto `ResolvedColDef`)
- Modify: `apps/cgrid-positions/src/positionsGrid.ts` (mark one column with
  `suppressMovable: true` and one with `lockPosition: 'right'` so the E2E has
  positive + negative cases)
- Create: `cgrid/tests/columnOrder.test.ts`
- Create: `cgrid/tests/columnDrag.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle6-columnDrag.spec.ts`

**Interfaces produced (Tasks 2 + 5 consume):**

```ts
// cgrid/src/core/columnOrder.ts

import type { ColumnTree, ResolvedColGroupDef } from './columnTree';
import type { ResolvedColDef } from './propertyChain';

export interface ReorderRequest {
  colId: string;
  /** Insertion index in the FLAT visible-leaf order (NOT the heterogeneous
   *  tree). The actual landing index may differ if locks or marryChildren
   *  reject it — see `resolveLegalDropIndex`. */
  toIndex: number;
}

export interface ColumnOrderConstraints {
  /** Returns the lock state of the leaf: `null` for free, `'left'` for
   *  start-locked, `'right'` for end-locked, `'self'` for "stay at current
   *  index". */
  lockOf: (colId: string) => null | 'left' | 'right' | 'self';
  /** Returns the groupId of the marryChildren-enclosing group (if any) for
   *  a leaf; null when the leaf is ungrouped or its enclosing group does
   *  not have marryChildren. */
  marryGroupOf: (colId: string) => string | null;
  /** Returns the leaf colIds covered by a marryChildren group. */
  leafIdsOfGroup: (groupId: string) => string[];
}

/** Resolve a requested target index into the nearest legal index that
 *  honors lockPosition + marryChildren. Returns the request's `toIndex`
 *  unchanged when no constraint applies. */
export function resolveLegalDropIndex(
  currentOrder: string[],
  req: ReorderRequest,
  constraints: ColumnOrderConstraints,
): number;

/** Returns a new colId order after applying `req`. Pure function — does
 *  not mutate `currentOrder`. The caller decides whether the move is legal
 *  via `resolveLegalDropIndex` first. */
export function applyReorder(currentOrder: string[], req: ReorderRequest): string[];

/** Helper for Task 2 — given the column tree + a partial-order list of
 *  colIds (from CColumnState.applyOrder), reorder the tree's leaves into
 *  the requested order. Leaves not mentioned keep their relative order at
 *  the end. Honors locks + marryChildren. */
export function reorderLeavesByList(
  tree: ColumnTree,
  desiredOrder: string[],
  constraints: ColumnOrderConstraints,
): string[];

// cgrid/src/types.ts additions

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  /** When true, the user cannot drag this column to a new position. The
   *  imperative `moveColumns` API still works (per ag-grid; locks only
   *  bind UI mutations). Set to a per-column hint; the grid-wide override
   *  comes from `VelocityGridOptions.suppressMovableColumns` in Task 5. */
  suppressMovable?: boolean;
  /** Pin this column's index. `true` and `'left'` lock the column to the
   *  start of its pinned region (or the start of the body when unpinned).
   *  `'right'` locks to the end. The lock binds both drag-reorder and
   *  `applyColumnState`. Stronger than `suppressMovable` — locked columns
   *  cannot be moved via the API either. */
  lockPosition?: boolean | 'left' | 'right';
}

export type VelocityGridEvent =
  // … existing variants …
  | {
      type: 'columnMoved';
      /** Resolved final flat-leaf index of the moved column AFTER lock /
       *  marryChildren resolution. */
      toIndex: number;
      /** Single-column-moved this cycle; the array shape is for Task 5's
       *  multi-column moveColumns API. */
      colIds: string[];
      /** 'uiColumnDragged' for drag, 'api' for moveColumns / moveColumnByIndex,
       *  'columnState' for applyColumnState (Task 2). */
      source: 'uiColumnDragged' | 'api' | 'columnState';
    };

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  /** Move the leaf at `fromIndex` to `toIndex` in the flat visible-leaf
   *  order. No-op when fromIndex == toIndex or either is out of range.
   *  Honors `lockPosition` + `marryChildren` — illegal moves clamp to the
   *  nearest legal index, NOT throw. Fires `columnMoved` with
   *  source `'api'`. */
  moveColumnByIndex(fromIndex: number, toIndex: number): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `columnOrder.test.ts`** — assertions:
      `applyReorder` is a pure splice (assert input not mutated);
      `resolveLegalDropIndex` clamps to start when target leaf has
      `lockPosition: 'left'`, clamps to end for `'right'`, holds index for
      `'self'`; rejects (clamps to nearest in-group index) drops that would
      break a `marryChildren` boundary; passes through when no constraint
      applies; `reorderLeavesByList` produces a stable leaf order when the
      list is a permutation and honors all constraints.

```ts
import { describe, it, expect } from 'vitest';
import {
  applyReorder, resolveLegalDropIndex, reorderLeavesByList,
  type ColumnOrderConstraints,
} from '../src/core/columnOrder';

const noConstraints: ColumnOrderConstraints = {
  lockOf: () => null, marryGroupOf: () => null, leafIdsOfGroup: () => [],
};

describe('columnOrder', () => {
  it('applyReorder is pure (does not mutate)', () => {
    const order = ['a', 'b', 'c', 'd'];
    const next = applyReorder(order, { colId: 'b', toIndex: 3 });
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(next).toEqual(['a', 'c', 'd', 'b']);
  });

  it('resolveLegalDropIndex passes through when unconstrained', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c'],
      { colId: 'a', toIndex: 2 },
      noConstraints,
    );
    expect(i).toBe(2);
  });

  it('lockPosition "left" clamps target to 0', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c'],
      { colId: 'a', toIndex: 2 },
      { ...noConstraints, lockOf: (id) => id === 'a' ? 'left' : null },
    );
    expect(i).toBe(0);
  });

  it('lockPosition "right" clamps target to end', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c'],
      { colId: 'c', toIndex: 0 },
      { ...noConstraints, lockOf: (id) => id === 'c' ? 'right' : null },
    );
    expect(i).toBe(2);
  });

  it('marryChildren clamps to enclosing-group span', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c', 'd'],
      { colId: 'c', toIndex: 0 },
      {
        ...noConstraints,
        marryGroupOf: (id) => id === 'c' ? 'g' : null,
        leafIdsOfGroup: () => ['b', 'c'],
      },
    );
    // 'c' is in group 'g' which spans ['b', 'c']; nearest legal index is 1.
    expect(i).toBe(1);
  });

  it('reorderLeavesByList preserves order for missing entries', () => {
    const out = reorderLeavesByList(
      {
        roots: [], leaves: [],
        leafById: new Map([['a', {} as any], ['b', {} as any], ['c', {} as any], ['d', {} as any]]),
        groupById: new Map(), maxDepth: 0,
      },
      ['c', 'a'],
      noConstraints,
    );
    // 'c' first, 'a' next, then leftovers 'b' / 'd' in original order.
    expect(out).toEqual(['c', 'a', 'b', 'd']);
  });
});
```

- [ ] **Step 2: Run** — expect failures (module missing).

```bash
npm test --workspace=cgrid -- columnOrder
```

- [ ] **Step 3: Implement `core/columnOrder.ts`** — `applyReorder` is a
      4-line splice; `resolveLegalDropIndex` evaluates locks first, then
      marryChildren; `reorderLeavesByList` builds a Set of seen colIds, walks
      the desired list, then appends unmentioned leaves in their original
      tree order. Keep the file < 120 LOC.

- [ ] **Step 4: Verify** — `npm test --workspace=cgrid -- columnOrder` green.

- [ ] **Step 5: Add `suppressMovable` + `lockPosition` to `CColDef` and to
      `ResolvedColDef`** — update `types.ts` and `core/propertyChain.ts`. In
      the `resolveColDef` return, add:

```ts
suppressMovable: merged.suppressMovable ?? false,
lockPosition: merged.lockPosition ?? null,
```

- [ ] **Step 6: Write the failing `columnDrag.test.ts`** — a unit test for
      the `ColumnDrag` Feature in isolation. Mock the `VelocityGridEventCtx` `grid`
      facade with a `reorderColumn(colId, toIndex)` spy + an `allColIds()`
      provider. Assert:
  - mousedown on a `'header'` hit with `suppressMovable` does NOT start a drag
  - mousedown on a `'headerResizer'` hit does NOT start a drag (resizer wins)
  - mousedown on a normal `'header'` followed by a drag of > 4 px sets the
    cursor to `'grabbing'` and shows the ghost
  - mouseup commits via `reorderColumn` with the resolved target index
  - mouseup without movement (no drag started) does NOT call `reorderColumn`

```ts
import { describe, it, expect, vi } from 'vitest';
import { ColumnDrag } from '../src/interaction/features/columnDrag';

function ctx(hit: any, point: { x: number; y: number }, grid: any) {
  return {
    hit, point, grid,
    canvas: document.createElement('canvas'),
    repaint: vi.fn(),
  } as any;
}

describe('ColumnDrag', () => {
  it('refuses to drag a suppressMovable column', () => {
    const f = new ColumnDrag();
    const grid = {
      reorderColumn: vi.fn(),
      getColDef: (id: string) => ({ colId: id, suppressMovable: id === 'a' }),
      allColIds: () => ['a', 'b', 'c'],
    };
    f.handleMouseDown(ctx({ kind: 'header', colId: 'a' }, { x: 0, y: 8 }, grid));
    f.handleMouseDrag(ctx({ kind: 'header', colId: 'a' }, { x: 100, y: 8 }, grid));
    f.handleMouseUp(ctx({ kind: 'header', colId: 'a' }, { x: 100, y: 8 }, grid));
    expect(grid.reorderColumn).not.toHaveBeenCalled();
  });

  it('commits a normal drag through reorderColumn', () => {
    const f = new ColumnDrag();
    const grid = {
      reorderColumn: vi.fn(),
      getColDef: (id: string) => ({ colId: id, suppressMovable: false }),
      allColIds: () => ['a', 'b', 'c'],
      columnLeftOf: (id: string) => ({ a: 0, b: 100, c: 200 }[id] ?? 0),
      columnWidthOf: (id: string) => 100,
    };
    f.handleMouseDown(ctx({ kind: 'header', colId: 'a' }, { x: 10, y: 8 }, grid));
    f.handleMouseDrag(ctx({ kind: 'header', colId: 'a' }, { x: 220, y: 8 }, grid));
    f.handleMouseUp(ctx({ kind: 'header', colId: 'a' }, { x: 220, y: 8 }, grid));
    // 220 px landed past 'c' center; expected new index 2.
    expect(grid.reorderColumn).toHaveBeenCalledWith('a', 2);
  });
});
```

- [ ] **Step 7: Implement `ColumnDrag`** — extends `Feature`. State machine:
      `idle → pressed → dragging`. Threshold of 4 px in either direction to
      promote `pressed → dragging`. On drag, compute the candidate insertion
      index by finding the column whose center is nearest to the current
      pointer X. On `handleMouseUp`, if `dragging`, call
      `grid.reorderColumn(colId, candidateIndex)` then reset. The ghost
      header DOM is a single `<div>` appended to the editor-layer with
      `position: absolute; pointer-events: none; opacity: 0.7`; the
      insertion line is a paint-pass overlay flag on the grid (`{ dropX:
      number | null }`) the renderer already supports through Cycle 4's
      overlay painter — or, simpler, draw it from inside `ColumnDrag` by
      stashing the state on `grid.columnDragState` and having the overlay
      painter read it next frame. **Pick whichever is fewer lines; the
      cleaner path is the overlay-painter state field.**

- [ ] **Step 8: Wire `ColumnDrag` into `featureChain.ts`** — after
      `ColumnResizing`, before `HeaderClick`. Order matters: resize hot-zone
      is checked first; if the cursor is on the resizer, the drag feature
      sees the down/move/up forwarded by the resize feature's `super.*`
      calls and ignores them because `hit.kind === 'headerResizer'`.

```ts
.append(new ColumnResizing())
.append(new ColumnDrag())
.append(new HeaderClick())
```

- [ ] **Step 9: Add `reorderColumn(colId, toIndex)` + `moveColumnByIndex`
      to `velocityGrid.ts`** — `reorderColumn` is the private engine call; resolves
      the legal target via `resolveLegalDropIndex` with a constraints
      object built from `columnDefsMap` + `columnTree.groupById`, then
      `applyReorder` produces a new flat-leaf order; mutate the underlying
      `columnDefs` array (which `computeVisibleColumnOrder` reads
      indirectly through the column tree) by re-running
      `resolveColumnTree` against a synthesized `(CColDef | CColGroupDef)[]`
      that mirrors the new leaf order. **Implementation note:** the
      simplest approach is to walk the tree, snapshot every leaf + group
      verbatim, then re-order the leaves inside their nearest enclosing
      group (or top-level for ungrouped) according to the new flat order.
      Emit `columnMoved` with `colIds: [movedColId]`, `toIndex`, `source:
      'uiColumnDragged'` for drag, `'api'` for `moveColumnByIndex`.

```ts
public moveColumnByIndex(fromIndex: number, toIndex: number): void {
  const ids = this.columnOrder.map((c) => c.colId);
  if (fromIndex < 0 || fromIndex >= ids.length) return;
  if (toIndex < 0 || toIndex >= ids.length) return;
  if (fromIndex === toIndex) return;
  const colId = ids[fromIndex]!;
  this.reorderColumn(colId, toIndex, 'api');
}
```

- [ ] **Step 10: Add `'columnMoved'` to `VelocityGridEvent` union** in `types.ts`
      using the shape from "Interfaces produced".

- [ ] **Step 11: Wire the demo** — in
      `apps/cgrid-positions/src/positionsGrid.ts`, mark `positionId` as
      `suppressMovable: true` (it's already pinned left; this prevents
      dragging it out). Mark `notionalAmount` as `lockPosition: 'right'`
      (it stays at the right edge of the body even after a drag attempts to
      move it left).

- [ ] **Step 12: Write the E2E** —
      `apps/cgrid-positions/e2e/cycle6-columnDrag.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Cycle 6 — column drag-reorder', () => {
  test('drag ticker header past cusip swaps their order', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__cgridReady === true);
    const before = await page.evaluate(() =>
      (window as any).__cgrid.getColumnState().map((c: any) => c.colId).slice(0, 4));
    const tickerHdr = await page.evaluate(() =>
      (window as any).__cgrid.getHeaderBoundsAt('ticker'));
    const cusipHdr = await page.evaluate(() =>
      (window as any).__cgrid.getHeaderBoundsAt('cusip'));
    await page.mouse.move(tickerHdr.x + tickerHdr.w / 2, tickerHdr.y + tickerHdr.h / 2);
    await page.mouse.down();
    await page.mouse.move(cusipHdr.x + 4, cusipHdr.y + cusipHdr.h / 2, { steps: 8 });
    await page.mouse.up();
    const after = await page.evaluate(() =>
      (window as any).__cgrid.getColumnState().map((c: any) => c.colId).slice(0, 4));
    expect(after.indexOf('ticker')).toBeLessThan(after.indexOf('cusip'));
    // suppressMovable position stayed put
    expect(after[0]).toBe('positionId');
  });

  test('lockPosition: "right" column resists a leftward drag', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__cgridReady === true);
    const lockedHdr = await page.evaluate(() =>
      (window as any).__cgrid.getHeaderBoundsAt('notionalAmount'));
    await page.mouse.move(lockedHdr.x + lockedHdr.w / 2, lockedHdr.y + lockedHdr.h / 2);
    await page.mouse.down();
    await page.mouse.move(50, lockedHdr.y + lockedHdr.h / 2, { steps: 8 });
    await page.mouse.up();
    const ids = await page.evaluate(() =>
      (window as any).__cgrid.getColumnState().map((c: any) => c.colId));
    // notionalAmount must still be the last non-pinned-right column
    const lastBody = ids.filter((id: string) => id !== 'pnl').pop();
    expect(lastBody).toBe('notionalAmount');
  });
});
```

      Add `getHeaderBoundsAt(colId)` + `getColumnState()` to `VelocityGridApi` (the
      latter is a Task-2 deliverable; for this E2E ship a stub that returns
      the resolved `{ colId, hide, pinned, width, flex }` slots and let
      Task 2 expand the shape — the test only reads `colId`).

- [ ] **Step 13: Run the full suite**

```bash
npm test --workspace=cgrid
npm --workspace=cgrid run typecheck
npm --workspace=cgrid run build
cd apps/cgrid-positions && npx playwright test --reporter=list cycle6-columnDrag
```

- [ ] **Step 14: Commit**

```bash
git add cgrid/src/core/columnOrder.ts \
        cgrid/src/types.ts \
        cgrid/src/core/propertyChain.ts \
        cgrid/src/interaction/features/columnDrag.ts \
        cgrid/src/interaction/featureChain.ts \
        cgrid/src/velocityGrid.ts \
        cgrid/tests/columnOrder.test.ts \
        cgrid/tests/columnDrag.test.ts \
        apps/cgrid-positions/src/positionsGrid.ts \
        apps/cgrid-positions/e2e/cycle6-columnDrag.spec.ts
git commit -m "$(cat <<'EOF'
feat(cgrid): column drag-reorder + suppressMovable + lockPosition

Lands the ColumnDrag feature alongside ColumnResizing in the
FeatureChain. Drag from a header (not the resizer hot-zone) shows a
DOM ghost + canvas insertion line and commits via the new
reorderColumn engine call. `suppressMovable` opts a column out;
`lockPosition` (true / 'left' / 'right') clamps any drag (and the
Task-5 imperative moveColumns) to the nearest legal index. Honors
marryChildren on the enclosing column group. Fires the catalog-22
columnMoved event with the resolved final index + source. Lifts the
"where does this leaf go" math into core/columnOrder.ts so Task 2's
applyColumnState + Task 5's moveColumns can call the same primitive.

Cycle 6 / Task 1.
EOF
)"
```

**Acceptance criteria:**
- [ ] `core/columnOrder.ts` exists with `applyReorder` (pure),
      `resolveLegalDropIndex` (honors `lockPosition` + `marryChildren`),
      `reorderLeavesByList`.
- [ ] `ColumnDrag` feature attached after `ColumnResizing`; threshold-based
      promotion (`pressed → dragging` after ≥ 4 px movement).
- [ ] `CColDef.suppressMovable` + `CColDef.lockPosition` typed + resolved
      onto `ResolvedColDef`; demo wires both.
- [ ] `VelocityGridApi.moveColumnByIndex` typed + implemented; emits `columnMoved`
      with `source: 'api'`.
- [ ] `columnMoved` event variant added to `VelocityGridEvent` union.
- [ ] Unit (≥ 8 assertions across the two test files) + E2E (2 scenarios) +
      typecheck + build green.

**Next session prompt** (paste into a fresh Claude Code session after Task 1 is committed):

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
and execute Task 2 (Column state round-trip — getColumnState /
applyColumnState / resetColumnState + columnsReset event + hide /
lockVisible / lockPinned). Confirm Task 1 is committed (git log -1 should
show "column drag-reorder"). Read docs/catalog/02-column-model.md "ColDef —
visibility & locking" section (lines 67-78) and the "Column state
round-trip" paragraph (line 174). Follow the per-task workflow.
```

---

## Task 2 — Column state round-trip — `getColumnState` / `applyColumnState` / `resetColumnState` + `columnsReset` event + `hide` / `lockVisible` / `lockPinned`

**Goal:** Snapshot + restore the full column state. `getColumnState()` returns
an array of `CColumnState` (one entry per column in the current visible-leaf
order, including hidden columns). `applyColumnState({state, applyOrder?,
defaultState?})` mutates `columnDefsMap` in place: width, hide, pinned, sort,
sortIndex, flex are restored; the rowGroup / pivot / aggFunc / rowGroupIndex
/ pivotIndex slots round-trip as opaque pass-through (Cycle 13 / 14 / 17 wire
the model logic). `applyOrder: true` reorders the leaves to match the input
array's order, honoring locks + `marryChildren` (via Task 1's
`reorderLeavesByList`). `defaultState` is an `Omit<CColumnState, 'colId'>`
applied to any leaf not mentioned in `state`. `resetColumnState()` rebuilds
state from the original column-defs snapshot taken at construction. Fires
`columnsReset` after a reset; `columnMoved` / `columnVisible` / `columnPinned`
/ `columnResized` after `applyColumnState` mutations (Task 5 ships the
non-state-driven variants; this task fires them with source `'columnState'`).

Also lands the visibility / lock fields used by `applyColumnState`:
`CColDef.hide`, `CColDef.lockVisible`, `CColDef.lockPinned`, `CColDef.initialHide`,
`CColDef.initialPinned`, `CColDef.initialWidth`. `lockVisible: true` rejects
any `hide` mutation (state or imperative); `lockPinned: true` rejects any
`pinned` mutation.

**Why this is Task 2:** Persistence is the highest-value column feature for
real apps. Task 1 shipped reorder; Task 2 ships the state shape that
encapsulates reorder + every other column mutation. Task 5's imperative API
becomes a thin wrapper over the same primitives. Tasks 3, 4, 6, 7 don't
depend on state but state is the cleanest place to land `hide` (no other
task in the cycle currently needs the field, but `getColumnState` MUST
report it, so it lands here).

**Read first:**
- `docs/catalog/02-column-model.md` — "Column state round-trip" paragraph
  (line 174); the API-methods table (lines 119-122 for `getColumnState`,
  `applyColumnState`, `resetColumnState`); ColumnState shape comment
- `docs/catalog/22-events.md` — `columnsReset` payload
- `cgrid/src/core/columnOrder.ts` (Task 1) — `reorderLeavesByList`
- `cgrid/src/velocityGrid.ts` — `recomputeViewport`, the existing
  `getColumnGroupState` / `setColumnGroupState` / `resetColumnGroupState`
  (the parallel-shape API Cycle 4 shipped that this Task mirrors)

**Files:**
- Create: `cgrid/src/core/columnState.ts`
- Modify: `cgrid/src/velocityGrid.ts` (instantiate state snapshot at construction;
  add `getColumnState` / `applyColumnState` / `resetColumnState` API; emit
  `columnsReset`)
- Modify: `cgrid/src/types.ts` (`CColumnState`, `CApplyColumnStateParams`,
  `columnsReset` event variant, `VelocityGridApi` method signatures, `CColDef.hide`,
  `CColDef.lockVisible`, `CColDef.lockPinned`, `CColDef.initialHide`,
  `CColDef.initialPinned`, `CColDef.initialWidth`)
- Modify: `cgrid/src/core/propertyChain.ts` (resolve `hide` / `lockVisible`
  / `lockPinned`; honor `initialHide` / `initialPinned` / `initialWidth`
  as first-render-only defaults)
- Modify: `cgrid/src/velocityGrid.ts` (extend `computeVisibleColumnOrder` to skip
  `hide: true` leaves)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (add a "Save layout" /
  "Restore layout" pair of buttons to the demo toolbar wired to
  `localStorage` round-trip via `getColumnState` / `applyColumnState`)
- Create: `cgrid/tests/columnState.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle6-columnState.spec.ts`

**Interfaces produced (Tasks 5 + 8 consume):**

```ts
// cgrid/src/types.ts additions

export interface CColumnState {
  colId: string;
  /** undefined when the leaf has no explicit width (flex-only). */
  width?: number;
  /** undefined when the column has no flex value. */
  flex?: number | null;
  /** true / false / undefined. `undefined` round-trips as "don't change". */
  hide?: boolean;
  /** 'left' / 'right' / null. `null` = unpinned; undefined = "don't change". */
  pinned?: 'left' | 'right' | null;
  /** 'asc' / 'desc' / null. */
  sort?: 'asc' | 'desc' | null;
  /** Position in multi-column sort. */
  sortIndex?: number | null;
  /** Reserved for Cycle 14. Round-trips opaquely until then. */
  rowGroup?: boolean;
  rowGroupIndex?: number | null;
  /** Reserved for Cycle 17. Round-trips opaquely until then. */
  pivot?: boolean;
  pivotIndex?: number | null;
  /** Reserved for Cycle 13. Round-trips opaquely until then. */
  aggFunc?: string | null;
}

export interface CApplyColumnStateParams {
  /** Per-column state. Entries match by `colId`. Missing leaves get
   *  `defaultState` (if provided) or remain unchanged. */
  state?: CColumnState[];
  /** When true, the column order in `state` defines the leaf order
   *  (locks + marryChildren still apply). Defaults to false — order is
   *  preserved as-is. */
  applyOrder?: boolean;
  /** Applied to any leaf not mentioned in `state`. Pair with `state: [...]`
   *  to "reset everything else + restore these few" in one call. */
  defaultState?: Omit<CColumnState, 'colId'>;
}

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  /** When true, the column is excluded from the visible-column order.
   *  Hidden columns still appear in `getColumnState()` so the round-trip
   *  is symmetric. */
  hide?: boolean;
  /** Applied only on first construction (not on `applyColumnState`). */
  initialHide?: boolean;
  initialPinned?: boolean | 'left' | 'right';
  initialWidth?: number;
  /** When true, `applyColumnState` + the imperative `setColumnsVisible`
   *  (Task 5) refuse to change this column's `hide` state. */
  lockVisible?: boolean;
  /** When true, `applyColumnState` + `setColumnsPinned` (Task 5) refuse to
   *  change this column's `pinned` state. */
  lockPinned?: boolean;
}

export type VelocityGridEvent =
  // … existing variants …
  | { type: 'columnsReset' };

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  /** Serialisable snapshot of every leaf's mutable state in
   *  current-visible-leaf-order, hidden leaves included. */
  getColumnState(): CColumnState[];
  /** Restore state. Returns `true` when every `state[].colId` matched an
   *  existing leaf; `false` when one or more entries were dropped. Fires
   *  `columnMoved` / `columnVisible` / `columnPinned` / `columnResized`
   *  with `source: 'columnState'` for each changed slot. */
  applyColumnState(params: CApplyColumnStateParams): boolean;
  /** Restore the construction-time snapshot. Fires `columnsReset` then the
   *  per-slot change events. */
  resetColumnState(): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `columnState.test.ts`** — assertions:
  - `getColumnState` shape: one entry per leaf; `width` echoes resolved
    width; `pinned` echoes resolved pinned; `hide` defaults to `false`
  - `applyColumnState` with `state: [{colId: 'a', hide: true}]` flips that
    leaf's resolved `hide` to true; leaves not mentioned are untouched
  - `applyColumnState` with `defaultState: {hide: true}` hides every
    unmentioned leaf
  - `applyColumnState` with `applyOrder: true` reorders the leaves
  - `lockVisible: true` rejects a `hide` mutation (state for that leaf
    silently dropped)
  - `lockPinned: true` rejects a `pinned` mutation
  - `resetColumnState` restores construction-time snapshot
  - Spy on `recomputeViewport` — exactly one call per `applyColumnState`
    invocation (the "single re-layout" invariant)

- [ ] **Step 2: Run** — expect failures.

- [ ] **Step 3: Implement `core/columnState.ts`** — three exports:
      `snapshotState(tree, layout): CColumnState[]` (constructs the state
      array from `columnDefsMap` + the current `columnLayout` widths;
      reads sort from the live sort model passed in);
      `applyStateToTree(tree, params, locks): { changed: ChangeRecord[],
      newOrder: string[] | null }` (pure: returns the set of changes +
      optional new leaf order so the caller can run a single re-layout);
      `cloneStateForReset(state): CColumnState[]` (deep-clones the initial
      snapshot for `resetColumnState`).

      `ChangeRecord` records `{ colId, kind: 'width' | 'hide' | 'pinned' |
      'sort' | 'flex' | 'moved', oldValue, newValue }` so the cgrid layer
      can fan it out to `columnResized` / `columnVisible` / `columnPinned`
      / `sortChanged` / `columnMoved` events in one event-batch.

- [ ] **Step 4: Add `hide` / `lockVisible` / `lockPinned` / `initialHide`
      / `initialPinned` / `initialWidth` to `CColDef` + `ResolvedColDef`.**
      `resolveColDef` consumes `initialHide` / `initialPinned` /
      `initialWidth` only when the matching non-initial key is undefined,
      then DOES NOT carry the `initial*` keys onto the resolved struct
      (they're construction-time-only, never re-read).

- [ ] **Step 5: Extend `computeVisibleColumnOrder` in `velocityGrid.ts`** to filter
      out leaves with `hide: true`. Hidden leaves remain in `columnDefsMap`
      (so `getColumnState` can still report them) but never reach the
      layout / paint / hit-test path.

- [ ] **Step 6: Add `getColumnState` / `applyColumnState` / `resetColumnState`
      to `velocityGrid.ts`** — `getColumnState` calls `snapshotState`;
      `applyColumnState` calls `applyStateToTree`, mutates `columnDefsMap`,
      reruns the tree only if `newOrder` is non-null, then performs ONE
      `computeVisibleColumnOrder + resolveColumnWidths + recomputeViewport
      + requestRepaint` cycle, then emits the queued events in deterministic
      order (`columnMoved` → `columnVisible` → `columnPinned` →
      `columnResized` → `sortChanged`).

      Snapshot the initial state on the constructor's last line:

```ts
this.initialColumnStateSnapshot = snapshotState(this.columnTree, this.columnLayout, this.sortModel);
```

      `resetColumnState` emits `{ type: 'columnsReset' }` then calls
      `applyColumnState({ state: this.initialColumnStateSnapshot,
      applyOrder: true })` so the per-slot events still fire.

- [ ] **Step 7: Add demo "Save layout" / "Restore layout" buttons** to the
      cgrid-positions toolbar:

```ts
saveBtn.onclick = () => localStorage.setItem('vg-layout', JSON.stringify(grid.getColumnState()));
restoreBtn.onclick = () => {
  const raw = localStorage.getItem('vg-layout');
  if (raw) grid.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
};
resetBtn.onclick = () => grid.resetColumnState();
```

- [ ] **Step 8: Write the E2E**
      `apps/cgrid-positions/e2e/cycle6-columnState.spec.ts`:

  - Drag ticker leftward (or use `moveColumnByIndex` from Task 1); save
    layout to `localStorage`; reload page; assert restored order via
    `getColumnState`.
  - `resetColumnState` after a save → assert the order matches the
    construction-time defs (capture them via `__cgrid.__initialColIds` set
    in the bootstrap for the test, or hard-code the demo's column ids).
  - `applyColumnState` with `defaultState: {hide: true}` and one explicit
    `{colId: 'pnl', hide: false}` leaves only the `pnl` column visible.

- [ ] **Step 9: Run typecheck + build + tests + E2E**

```bash
npm test --workspace=cgrid -- columnState
npm --workspace=cgrid run typecheck
npm --workspace=cgrid run build
cd apps/cgrid-positions && npx playwright test cycle6-columnState
```

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(cgrid): column state round-trip — getColumnState / applyColumnState / resetColumnState

Lands CColumnState + CApplyColumnStateParams + 3-method API surface.
getColumnState returns one entry per leaf in current visible-order
(hidden included). applyColumnState mutates columnDefsMap in place
through a single re-layout, honoring lockVisible / lockPinned and
respecting Task-1 locks during applyOrder reorders. resetColumnState
restores the construction-time snapshot, firing columnsReset + the
per-slot change events. Adds hide / lockVisible / lockPinned to
CColDef; honors the parallel initialHide / initialPinned /
initialWidth construction-only fields.

Cycle 6 / Task 2."
```

**Acceptance criteria:**
- [ ] `core/columnState.ts` exists; `CColumnState` slot list matches the
      catalog (`colId`, `width`, `flex`, `hide`, `pinned`, `sort`,
      `sortIndex`, `rowGroup`, `rowGroupIndex`, `pivot`, `pivotIndex`,
      `aggFunc`).
- [ ] `applyColumnState` triggers exactly one `recomputeViewport` per call
      (verified by a spy).
- [ ] `lockVisible` + `lockPinned` reject state mutations silently (no throw).
- [ ] `resetColumnState` restores the snapshot taken at construction time.
- [ ] Demo has working Save / Restore / Reset buttons.
- [ ] Unit (≥ 10 assertions) + E2E (3 scenarios) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
and execute Task 3 (sizeColumnsToFit + suppressSizeToFit). Confirm Task 2
is committed. Read docs/catalog/02-column-model.md "sizeColumnsToFit vs
autoSizeColumns" paragraph (line 159) and the suppressSizeToFit row.
Follow the per-task workflow.
```

---

## Task 3 — `sizeColumnsToFit` + `suppressSizeToFit` + `ISizeColumnsToFitParams`

**Goal:** Distribute the host container's inner width across the visible
non-suppressed columns, respecting per-column `minWidth` / `maxWidth`. Flex
columns prefer their flex weight; non-flex columns prefer their current
width as a starting share (then scale to fit). `suppressSizeToFit: true`
holds a column at its current width. `ISizeColumnsToFitParams` lets the
caller override `defaultMinWidth` / `defaultMaxWidth` + per-column
`columnLimits` (a per-column `{key, minWidth?, maxWidth?}` array).

**Why this is Task 3:** Independent of Tasks 4 / 5 / 6 / 7. Cheap to land
(pure arithmetic — no worker call). Apps need it to recover layout sanity
after a window resize.

**Read first:**
- `docs/catalog/02-column-model.md` — "sizeColumnsToFit vs autoSizeColumns"
  paragraph (line 159); `suppressSizeToFit` row
- `cgrid/src/core/layout.ts` — the existing `resolveColumnWidths` (the
  three-pass layout that already handles min / max / flex)

**Files:**
- Modify: `cgrid/src/core/layout.ts` (add `sizeColumnsToFit(cols,
  containerWidth, params): Map<colId, number>` — pure; returns the new
  widths)
- Modify: `cgrid/src/velocityGrid.ts` (add `sizeColumnsToFit(params?)` API; mutate
  `def.width` for non-suppressed leaves; rerun layout once; emit
  `columnResized` per changed column with `finished: true`)
- Modify: `cgrid/src/types.ts` (`CColDef.suppressSizeToFit?: boolean`,
  `ISizeColumnsToFitParams`, `VelocityGridApi.sizeColumnsToFit`)
- Modify: `cgrid/src/core/propertyChain.ts` (resolve `suppressSizeToFit`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (mark one column
  `suppressSizeToFit: true`; add a "Fit columns" toolbar button)
- Create: `cgrid/tests/sizeColumnsToFit.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle6-sizeToFit.spec.ts`

**Interfaces produced:**

```ts
export interface ISizeColumnsToFitParams {
  /** Width to fit to. Defaults to the current container clientWidth minus
   *  the vertical-scrollbar gutter. */
  width?: number;
  defaultMinWidth?: number;
  defaultMaxWidth?: number;
  columnLimits?: Array<{ key: string; minWidth?: number; maxWidth?: number }>;
}

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  suppressSizeToFit?: boolean;
}

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  /** Resize every non-suppressed visible leaf so the total width fills the
   *  container (or `params.width`). Per-column min/max wins over the
   *  param-level defaults. Fires one `columnResized` per changed column
   *  with `finished: true`. */
  sizeColumnsToFit(params?: ISizeColumnsToFitParams): void;
}
```

**Algorithm (in `core/layout.ts`):**

1. Compute the total non-suppressed "base share" = sum of each leaf's
   `flex ?? Math.max(width, minWidth)` (so flex leaves contribute their
   flex weight; non-flex leaves contribute their current width).
2. Compute `available = params.width - sum(suppressed widths)`.
3. First pass: assign each non-suppressed leaf a target `share *
   available / totalShare`. Clamp to per-column min / max (overridden by
   `columnLimits` then param defaults).
4. If any leaf was clamped, subtract its assigned width from `available`
   and remove it from `totalShare`, then repeat — bounded by 5 passes
   (converges fast).
5. Floor to integers; rounding remainder goes to the rightmost
   unclamped leaf.

**Steps:**

- [ ] **Step 1: Write the failing test.** Assertions:
      - Single-leaf grid: fit to `containerWidth` exactly
      - Two leaves, no flex, both min/max headroom: equal split
      - Flex + non-flex mix: flex column takes its flex share, non-flex
        keeps a base proportional to its current width
      - `suppressSizeToFit: true` leaf keeps its current width; remaining
        space distributes among the others
      - `minWidth` clamp leaves a remainder for the right-most unclamped
        leaf
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement** `sizeColumnsToFit` in `core/layout.ts`.
- [ ] **Step 4: Add the API in `velocityGrid.ts`** — pull the leaves through the
      pure helper, then `for (const [colId, w] of newWidths) def.width = w`;
      single `resolveColumnWidths + recomputeViewport + requestRepaint`;
      emit `columnResized` with `finished: true` for each changed leaf.
- [ ] **Step 5: Update demo + add "Fit columns" toolbar button.**
- [ ] **Step 6: E2E** — click "Fit columns", assert total visible width
      sums close to the canvas width (`±2 px` tolerance for rounding).
- [ ] **Step 7: Run typecheck + build + tests + E2E.**
- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(cgrid): sizeColumnsToFit + suppressSizeToFit + ISizeColumnsToFitParams

Distributes container width across non-suppressed visible leaves with
a 5-pass clamp-and-redistribute loop. Per-column min/max wins over
param-level defaults; flex weight feeds the share calculation when
present. suppressSizeToFit holds a column at its current width. Fires
one columnResized per changed leaf with finished: true.

Cycle 6 / Task 3."
```

**Acceptance criteria:**
- [ ] `sizeColumnsToFit` exported from `core/layout.ts`, pure (returns
      `Map<colId, number>`).
- [ ] `VelocityGridApi.sizeColumnsToFit` mutates widths, repaints once, emits
      `columnResized` with `finished: true`.
- [ ] `suppressSizeToFit` honored.
- [ ] Unit (≥ 5 assertions) + E2E (1 scenario) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
and execute Task 4 (autoSizeColumns + autoSizeAllColumns + suppressAutoSize,
worker measureText pass). Confirm Task 3 is committed. Read
docs/catalog/02-column-model.md "sizeColumnsToFit vs autoSizeColumns"
paragraph. Reuse Cycle 5 Task 8's worker/measureText.ts cache. Follow the
per-task workflow.
```

---

## Task 4 — `autoSizeColumns` + `autoSizeAllColumns` + `suppressAutoSize` (worker measureText pass)

**Goal:** Resize one column (or all columns) to fit the widest visible text.
The worker measures via Cycle 5's `measureText.ts` (`OffscreenCanvas.measureText`
or main-thread fallback). For each column being autosized: walk the active
chunk (filtered + sorted), evaluate `valueGetter → valueFormatter → text`,
measure width with the column's font, take the max + add the cell horizontal
padding. Optionally include the header label's width
(`skipHeader: false` is the default — header included). Cap the scan at
5,000 rows: head 2,500 + tail 2,500 of the filtered order, so a 1M-row
autosize finishes inside the perf budget. Result clamps to `minWidth` /
`maxWidth` on main. `suppressAutoSize: true` excludes the column from any
autosize call.

**Why this is Task 4:** Builds on Cycle 5's worker measure pipeline. Drops
naturally onto Task 3's `sizeColumnsToFit` API surface (same "set widths +
repaint" landing). Independent of Tasks 5 / 6 / 7.

**Read first:**
- `docs/catalog/02-column-model.md` — `suppressAutoSize` row (line 60);
  `autoSizeColumns` / `autoSizeAllColumns` API rows (lines 130-131); "Look
  & feel" paragraph (line 158)
- `cgrid/src/worker/measureText.ts` — the Cycle 5 / Task 8 cache + LRU +
  `OffscreenCanvas.measureText` hot path + main-thread fallback
- `cgrid/src/worker/protocol.ts` — message envelope shapes (`AutoHeightRequest`
  from Cycle 5 is the closest existing example)

**Files:**
- Create: `cgrid/src/worker/autosize.ts` (worker-side measure pass)
- Modify: `cgrid/src/worker/protocol.ts` (add `'autosizeRequest'` +
  `'autosizeResult'` envelopes)
- Modify: `cgrid/src/worker/worker.ts` (route `'autosizeRequest'` → `autosize.ts`)
- Modify: `cgrid/src/worker/client.ts` (add `autosizeColumns(colIds,
  skipHeader): Promise<Record<colId, number>>`)
- Modify: `cgrid/src/velocityGrid.ts` (`autoSizeColumns(keys, skipHeader)` +
  `autoSizeAllColumns(skipHeader)` API; await worker; clamp by min/max;
  set widths; single repaint; emit `columnResized` per col with
  `finished: true`)
- Modify: `cgrid/src/types.ts` (`CColDef.suppressAutoSize?: boolean`,
  `VelocityGridApi.autoSizeColumns` / `autoSizeAllColumns`)
- Modify: `cgrid/src/core/propertyChain.ts` (resolve `suppressAutoSize`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (add "Autosize all"
  toolbar button; mark one column `suppressAutoSize: true`)
- Create: `cgrid/tests/autosize.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle6-autosize.spec.ts`

**Interfaces produced:**

```ts
// protocol additions
export interface AutosizeRequest {
  type: 'autosizeRequest';
  requestId: number;
  colIds: string[];
  skipHeader: boolean;
  /** Cap on the row sample size. Defaults to 5000 (head 2500 + tail 2500). */
  maxSampleSize?: number;
}
export interface AutosizeResult {
  type: 'autosizeResult';
  requestId: number;
  widths: Record<string, number>;
}

// types.ts
export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  suppressAutoSize?: boolean;
}

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  /** Autosize the specified leaves to their widest visible content.
   *  Awaits a worker round-trip (returns a Promise). Honors
   *  `suppressAutoSize`. Fires one `columnResized` per changed leaf with
   *  `finished: true` once widths land. */
  autoSizeColumns(keys: string[], skipHeader?: boolean): Promise<void>;
  /** `autoSizeColumns(allVisibleNonSuppressedKeys, skipHeader)`. */
  autoSizeAllColumns(skipHeader?: boolean): Promise<void>;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `autosize.test.ts`** — node + jsdom test
      against the worker module's pure measure function (pass a fake
      measureText callback returning `text.length * 8`). Assertions:
      - Sample-cap honored: a 1M-row column scans only head 2500 + tail 2500
      - Header included when `skipHeader: false`; excluded otherwise
      - Empty column returns `minWidth`
      - Per-column font passed into measureText
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement worker `autosize.ts`** — reuses
      `measureText.ts`'s LRU cache. Output is the max-cell-width + padding
      for each requested colId.
- [ ] **Step 4: Wire the protocol envelopes** in `worker/protocol.ts` and
      route in `worker.ts`.
- [ ] **Step 5: Add `WorkerClient.autosizeColumns`** in `worker/client.ts`
      (request-response with `requestId` like the Cycle 5 measureText
      request).
- [ ] **Step 6: Add the API in `velocityGrid.ts`** — `autoSizeAllColumns` resolves
      the visible non-`suppressAutoSize` leaves, calls `autoSizeColumns`
      with that set. Clamp results to min/max on main; apply widths
      atomically; one `recomputeViewport + requestRepaint`; fire
      `columnResized` with `finished: true` per changed leaf.
- [ ] **Step 7: Update demo** — toolbar button.
- [ ] **Step 8: E2E** — click "Autosize all", assert visible-text columns
      grew to comfortably hold the demo's longest values (e.g.
      `positionId` width is now ≥ a baseline pixel count). Assert the
      `suppressAutoSize` column didn't change width.
- [ ] **Step 9: Typecheck + build + tests + E2E.**
- [ ] **Step 10: Commit.**

```bash
git commit -m "feat(cgrid): autoSizeColumns + autoSizeAllColumns + suppressAutoSize

Worker measureText pass walks the active chunk (head 2500 + tail 2500
sample cap) and returns max-text-width + padding per requested column.
Main thread clamps to min/max, applies widths atomically, fires one
columnResized per changed column with finished: true. Reuses Cycle 5
Task 8's measureText.ts LRU cache. suppressAutoSize excludes a column
from any autosize call. Demo toolbar gains an "Autosize all" button.

Cycle 6 / Task 4."
```

**Acceptance criteria:**
- [ ] Worker `'autosizeRequest'` / `'autosizeResult'` envelopes round-trip.
- [ ] `autoSizeColumns([colId])` resolves the worker, sets the width,
      repaints once.
- [ ] `suppressAutoSize` honored.
- [ ] 5,000-row sample cap honored (covered by unit).
- [ ] Unit (≥ 4 assertions) + E2E (1 scenario) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
and execute Task 5 (Imperative API — setColumnsVisible, setColumnsPinned,
setColumnWidths, moveColumns, moveColumnByIndex). Confirm Task 4 is
committed. Read docs/catalog/02-column-model.md "API methods" section
(lines 113-138) and docs/catalog/22-events.md columnVisible /
columnPinned / columnMoved payloads. Follow the per-task workflow.
```

---

## Task 5 — Imperative column API — `setColumnsVisible` / `setColumnsPinned` / `setColumnWidths` / `moveColumns` + `columnVisible` / `columnPinned` events + `finished` flag on `columnResized`

**Goal:** Expose the per-slot mutation surface. Each method takes a
multi-column input, mutates `columnDefsMap` in a batch, performs ONE
re-layout + repaint, fires per-column events. `columnResized` gains a
`finished?: boolean` flag — `false` during a drag-resize tick (Cycle 4's
existing emission), `true` on mouseup AND on every imperative
`setColumnWidths` call. `moveColumns(keys[], toIndex)` uses Task 1's
`reorderLeavesByList`; emits one `columnMoved` per actual move with
`source: 'api'`.

**Why this is Task 5:** Builds on Task 1 (`reorderLeavesByList`),
Task 2 (lock semantics — `lockVisible` / `lockPinned`), and Task 3
(width-mutation + single-repaint pattern). Cycles 11 (tool panels) and 17
(pivot tool panel) drive these APIs.

**Read first:**
- `docs/catalog/02-column-model.md` — API table rows for
  `setColumnsVisible` / `setColumnsPinned` / `setColumnWidths` /
  `moveColumns` / `moveColumnByIndex`
- `docs/catalog/22-events.md` — `columnVisible`, `columnPinned`,
  `columnMoved`, `columnResized.finished`

**Files:**
- Modify: `cgrid/src/velocityGrid.ts` (the four new methods; refactor the
  drag-resize emission in `resizeColumn` to set `finished: false`,
  add `finished: true` on mouseup in `ColumnResizing`)
- Modify: `cgrid/src/interaction/features/columnResizing.ts` (emit
  `columnResized` with `finished: true` on mouseup; the per-tick
  emissions during drag set `finished: false`)
- Modify: `cgrid/src/types.ts` (`columnVisible` / `columnPinned` event
  variants, `columnResized.finished?: boolean`, API signatures)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (toolbar buttons:
  "Hide P&L", "Pin Trader Left", "Reset widths")
- Create: `cgrid/tests/imperativeColumnApi.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle6-imperativeApi.spec.ts`

**Interfaces produced:**

```ts
export type VelocityGridEvent =
  // … existing variants …
  | { type: 'columnVisible'; visible: boolean; colIds: string[]; source: 'api' | 'columnState' | 'gridOptionsChanged' }
  | { type: 'columnPinned'; pinned: 'left' | 'right' | null; colIds: string[]; source: 'api' | 'columnState' | 'gridOptionsChanged' }
  | {
      type: 'columnResized';
      colId: string;
      width: number;
      /** False during a drag-resize tick. True on drag end + every
       *  imperative width mutation. Apps that persist on `finished: true`
       *  only fire one save per drag instead of one per pixel. */
      finished?: boolean;
      source?: 'uiColumnResized' | 'api' | 'columnState' | 'sizeColumnsToFit' | 'autosizeColumns';
    };

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  setColumnsVisible(keys: string[], visible: boolean): void;
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
  setColumnWidths(
    columnWidths: Array<{ key: string; newWidth: number }>,
    finished?: boolean,
  ): void;
  /** Move every leaf in `keys` to start at `toIndex` (in declaration
   *  order). Locks + marryChildren still apply — illegal moves clamp. */
  moveColumns(keys: string[], toIndex: number): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `imperativeColumnApi.test.ts`.**
      Assertions:
      - `setColumnsVisible(['a','b'], false)` flips both leaves' `hide` +
        triggers one repaint
      - `lockVisible: true` blocks the mutation (no `columnVisible` event,
        no repaint)
      - `setColumnsPinned(['a'], 'right')` updates pinned, fires
        `columnPinned`
      - `setColumnWidths([{key:'a', newWidth: 200}, {key:'b', newWidth:
        100}], true)` updates both widths, fires `columnResized` with
        `finished: true` for each
      - `moveColumns(['b','c'], 0)` reorders both columns to the top
      - All 4 methods perform exactly one `recomputeViewport` per call
        (spy assertion)
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement the four methods in `velocityGrid.ts`.** Pattern:
  - Resolve each `key` to a `ResolvedColDef` from `columnDefsMap`; drop
    unknowns
  - Apply lock checks (`lockVisible`, `lockPinned`, `lockPosition`)
  - Mutate in place
  - Single `computeVisibleColumnOrder + resolveColumnWidths +
    recomputeViewport + requestRepaint`
  - Emit per-slot events with `source: 'api'`
- [ ] **Step 4: Modify `columnResizing.ts`** — add an `emitFinished()`
      pattern: store the last-resize colId + width on mouseup, emit
      `columnResized` with `finished: true`.
- [ ] **Step 5: Adjust the existing per-tick `columnResized` emission** in
      `cgrid.resizeColumn` to set `finished: false`, `source:
      'uiColumnResized'`.
- [ ] **Step 6: Update the demo** with the three buttons.
- [ ] **Step 7: E2E** — toolbar clicks produce expected DOM state (e.g.
      after "Hide P&L", `getColumnState().find(c => c.colId === 'pnl')?.hide
      === true`; after "Pin Trader Left", `'trader'` column appears at
      pinned-left position).
- [ ] **Step 8: Typecheck + build + tests + E2E.**
- [ ] **Step 9: Commit.**

```bash
git commit -m "feat(cgrid): imperative column API — visible / pinned / widths / move

Lands setColumnsVisible, setColumnsPinned, setColumnWidths,
moveColumns on VelocityGridApi. Each call performs one re-layout + one
repaint; emits per-column columnVisible / columnPinned / columnMoved
/ columnResized events (with finished flag on resize). Honors
lockVisible / lockPinned / lockPosition from Task 2 / Task 1.
columnResized payload gains optional finished flag — false during a
drag-resize tick, true on drag end + every imperative width mutation.

Cycle 6 / Task 5."
```

**Acceptance criteria:**
- [ ] Four new methods on `VelocityGridApi`; each does exactly one
      `recomputeViewport`.
- [ ] `columnVisible` / `columnPinned` events fire with `colIds` array.
- [ ] `columnResized.finished` flag flows: `false` during drag, `true` on
      mouseup + imperative + `sizeColumnsToFit` + autosize.
- [ ] Locks honored (`lockVisible` / `lockPinned` block the mutation).
- [ ] Unit (≥ 6 assertions) + E2E (3 scenarios) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
and execute Task 6 (columnTypes templates + CColDef.type: string | string[]).
Confirm Task 5 is committed. Read docs/catalog/02-column-model.md
column-types row (line 38). Follow the per-task workflow.
```

---

## Task 6 — `columnTypes` templates + `CColDef.type: string | string[]`

**Goal:** Let an app define a named bundle of `CColDef` properties once and
apply it to many columns by name. `VelocityGridOptions.columnTypes: Record<string,
Partial<CColDef>>` declares the bundles; `CColDef.type` becomes
`string | string[]` (the existing `'text' | 'number'` cell-data type union
moves to a new `CColDef.cellDataType` field with a deprecation alias so
Cycle 4 / 5 callers still work). Multiple types merge left-to-right; the
column's own fields win over every type. Type lookup runs inside
`resolveColDef` before `defaultColDef` merging.

**Why this is Task 6:** Independent of Tasks 1-5 internals. Touches one
file deeply (`propertyChain.ts`) and exercises the `type` field that
every grid uses. Comes before Task 7 because `columnTypes` is the
canonical place an app would define a `cellClass` / `cellStyle` bundle.

**Read first:**
- `docs/catalog/02-column-model.md` — `type` row (line 38), `cellDataType`
  row (line 39)
- `cgrid/src/core/propertyChain.ts` — current `type` resolution (text /
  number)
- `cgrid/src/types.ts` — current `CColDef.type` union

**Files:**
- Modify: `cgrid/src/types.ts` (`CColDef.type: string | string[]`,
  `CColDef.cellDataType?: 'text' | 'number'`, `VelocityGridOptions.columnTypes`)
- Modify: `cgrid/src/core/propertyChain.ts` (merge `columnTypes[name]` (or
  the named list) before defaultColDef; carry forward `cellDataType` as
  the cell data type; deprecate-alias: when `type` is `'text'` /
  `'number'` (string union of the old literal) AND `columnTypes` has no
  entry of that name, treat as `cellDataType`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` — define
  `columnTypes: { money: { type: undefined, cellDataType: 'number',
  valueFormatter: …, halign: 'right' } }` and apply `type: 'money'` to
  two columns
- Create: `cgrid/tests/columnTypes.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle6-columnTypes.spec.ts`

**Interfaces produced:**

```ts
export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  /** Named column type(s) declared in `VelocityGridOptions.columnTypes`. Multiple
   *  types merge left-to-right; this col's own properties win. */
  type?: string | string[];
  /** Inferred cell data type. Drives the default cell renderer + the
   *  default editor when `cellRenderer` / `cellEditor` are unset.
   *  Replaces the old `type: 'text' | 'number'` literal-union usage —
   *  string-literal `type` values still work but are deprecated; prefer
   *  `cellDataType` for new code. */
  cellDataType?: 'text' | 'number';
}

export interface VelocityGridOptions<TRow = any> {
  // … existing fields …
  /** Named partial column defs. Reference by `CColDef.type`. Each leaf's
   *  resolved def is `{ ...columnTypes[name], ...defaultColDef, ...colDef }`
   *  in left-to-right merge order. */
  columnTypes?: Record<string, Partial<CColDef<TRow>>>;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `columnTypes.test.ts`.** Assertions:
  - Single string type merges the bundle before defaultColDef
  - Array `type: ['a','b']` merges `a` first, then `b`, then defaultColDef,
    then the column itself — column wins
  - Deprecation alias: `type: 'text'` with no `columnTypes.text` falls
    back to `cellDataType: 'text'`
  - Empty / unknown type name throws a descriptive error
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement** the type-merge pass in `resolveColDef`. Take
      `columnTypes` as a new arg.
- [ ] **Step 4: Update `velocityGrid.ts`** so it threads `options.columnTypes`
      into every `resolveColDef` / `resolveColumnTree` call.
- [ ] **Step 5: Update the demo** to declare a `money` type and apply it.
- [ ] **Step 6: E2E** — assert the demo's two `money`-typed columns share
      the formatter (e.g. paint-screenshot or read formatted text via
      `__cgrid.getCellValue(0, 'notionalAmount').toString()` → matches
      currency formatting).
- [ ] **Step 7: Typecheck + build + tests + E2E.**
- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(cgrid): columnTypes templates + CColDef.type: string | string[]

Lands VelocityGridOptions.columnTypes — named Partial<CColDef> bundles applied
by name via CColDef.type. Array form merges left-to-right. Adds
CColDef.cellDataType as the canonical cell-data-type field; the old
type: 'text' | 'number' literal-union usage continues to work via a
deprecation alias.

Cycle 6 / Task 6."
```

**Acceptance criteria:**
- [ ] `columnTypes` declared on `VelocityGridOptions`; `CColDef.type:
      string | string[]` typed.
- [ ] `cellDataType` typed; deprecation alias works.
- [ ] Demo declares + uses `money`.
- [ ] Unit (≥ 4 assertions) + E2E (1 scenario) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
and execute Task 7 (cellClass / cellClassRules / cellStyle (function) /
headerClass via theme-driven variants). Confirm Task 6 is committed.
Read docs/catalog/02-column-model.md "ColDef — display & styling" section
(lines 31-39). Follow the per-task workflow.
```

---

## Task 7 — `cellClass` / `cellClassRules` / `cellStyle` (function form) / `headerClass` via theme-driven variants

**Goal:** Conditional cell styling without per-cell DOM. `cellClass: string |
string[] | CellClassFunc` and `cellClassRules: Record<className,
predicate>` resolve to a list of theme-variant keys; each key looks up a
`ColCellOverrides` patch from the active theme's `cellClassVariants` table
(populated from CSS variables like `--vg-cell-class-warning-bg:
#fffae5`). `cellStyle` (function form) returns a raw `ColCellOverrides`
that bypasses the variants table. Multiple matches stack: later overrides
win. `headerClass` does the same for header cells using the
`headerClassVariants` table.

**Why this is Task 7:** Pure-rendering feature; no model or layout impact.
Depends on Task 6 only because Task 6's `columnTypes` is the canonical
place an app declares a shared `cellClass`. Cycle 11's tool panels surface
these classes in the UI but ship later.

**Read first:**
- `docs/catalog/02-column-model.md` — "ColDef — display & styling" table
  (lines 31-39) and the canvas-port implications paragraph (line 197)
- `cgrid/src/core/propertyChain.ts` — `applyCellProps` and the existing
  `cellStyle: ColCellOverrides` storage-only field; Cycle 4's resolution
- `cgrid/src/theming/cssReader.ts` — how CSS variables become a
  `ResolvedTheme`

**Files:**
- Modify: `cgrid/src/types.ts` (`CellClass`, `CellClassRules`,
  `CellClassFunc`, `CellStyleFunc`, `HeaderClass` types; `CColDef.cellClass`,
  `cellClassRules`, `cellStyle: ColCellOverrides | CellStyleFunc`,
  `headerClass`; `CColGroupDef.headerClass` already exists)
- Modify: `cgrid/src/core/propertyChain.ts` (resolve `cellClass`,
  `cellClassRules` (pre-compile predicates), function-form `cellStyle`,
  `headerClass` onto `ResolvedColDef`; extend `applyCellProps` to walk
  the rule predicates + variant table)
- Modify: `cgrid/src/theming/cssReader.ts` (read `--vg-cell-class-*` +
  `--vg-header-class-*` CSS variables into `cellClassVariants` /
  `headerClassVariants` maps on `ResolvedTheme`)
- Modify: `cgrid/src/renderer/painters/byRows.ts` (apply the resolved
  `ColCellOverrides` patch — already happens for the static
  `cellStyle`; extend to honor function-form output + rules-matched
  variants)
- Update: `cgrid-positions` demo CSS (`apps/cgrid-positions/src/style.css`)
  — declare `--vg-cell-class-warning-bg: #fff4d1`; `--vg-cell-class-warning-fg: #6b4f00`;
  `--vg-cell-class-positive-bg: #e7f7ec`; `--vg-cell-class-negative-bg: #fde7e9`
- Update: `apps/cgrid-positions/src/positionsGrid.ts` — apply
  `cellClassRules: { positive: (p) => p.value > 0, negative: (p) => p.value < 0 }`
  to the `pnl` column
- Create: `cgrid/tests/cellClassRules.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle6-cellClassRules.spec.ts`

**Interfaces produced:**

```ts
export type CellClass<TRow = any, TValue = any> =
  | string | string[]
  | ((params: { data: TRow; value: TValue; colId: string; rowIndex: number }) => string | string[] | undefined);

export type CellClassRules<TRow = any, TValue = any> = Record<
  string,
  ((params: { data: TRow; value: TValue; colId: string; rowIndex: number }) => boolean)
>;

export type CellStyleFunc<TRow = any, TValue = any> = (
  params: { data: TRow; value: TValue; colId: string; rowIndex: number },
) => ColCellOverrides | null | undefined;

export type HeaderClass = string | string[] | ((params: { colId: string }) => string | string[] | undefined);

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  cellClass?: CellClass<TRow, TValue>;
  cellClassRules?: CellClassRules<TRow, TValue>;
  cellStyle?: ColCellOverrides | CellStyleFunc<TRow, TValue>;
  headerClass?: HeaderClass;
}
```

**Theme additions (in `theming/cssReader.ts`):**

```ts
export interface ResolvedTheme {
  // … existing fields …
  /** Map of class-name → ColCellOverrides patch. Keys come from the
   *  `--vg-cell-class-<name>-{bg,fg,font,halign}` CSS variables. */
  cellClassVariants: Map<string, ColCellOverrides>;
  /** Same for `--vg-header-class-<name>-*`. */
  headerClassVariants: Map<string, ColCellOverrides>;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `cellClassRules.test.ts`.** Assertions:
  - Static `cellClass: 'warning'` applies the matching variant's
    `ColCellOverrides`
  - `cellClassRules: { warning: predicate }` applies the warning variant
    only when the predicate returns true
  - Multiple matched classes stack with later wins
  - Function `cellStyle` overrides class-driven variants (function-form
    wins)
  - `headerClass: 'sticky'` applies the header variant to the header row
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Extend `cssReader.ts`** to scan custom-property names
      matching `--vg-cell-class-<name>-(bg|fg|font|halign)` and group them
      into `cellClassVariants`. Repeat for `--vg-header-class-*`.
- [ ] **Step 4: Extend `propertyChain.ts`** — `resolveColDef` stores
      pre-compiled rule predicates + class-resolver functions. In
      `applyCellProps`:
      1. Read static `cellClass` (or call function form)
      2. Walk `cellClassRules`; collect matched class names
      3. Call function-form `cellStyle` (if any)
      4. Resolve class names through `theme.cellClassVariants`;
         stack-apply onto the cell's `ColCellOverrides`
      5. Layer `cellStyle` function output on top (highest precedence)
- [ ] **Step 5: Extend `byRows.ts`** if needed (the existing
      `applyCellProps` already drives the cell's fg / bg / font / halign;
      most likely no painter change needed beyond honoring the merged
      overrides which already flow through).
- [ ] **Step 6: Wire the demo** — `pnl` column gets the
      `cellClassRules`; CSS adds the variant variables.
- [ ] **Step 7: E2E** — programmatic check: read painted bg of a positive
      `pnl` cell vs negative `pnl` cell via `page.evaluate` calling
      `__cgrid.getCellPaintedBg(rowIndex, colId)` (add this debug API as a
      5-line read of the painter's per-cell config — same pattern as
      `getCellValue`). Assert positive bg matches `#e7f7ec` (or its rgb).
- [ ] **Step 8: Typecheck + build + tests + E2E.**
- [ ] **Step 9: Commit.**

```bash
git commit -m "feat(cgrid): cellClass / cellClassRules / cellStyle (fn) / headerClass

Conditional cell + header styling driven by theme variants
(--vg-cell-class-<name>-{bg,fg,font,halign}) instead of per-cell DOM.
cellClass resolves to one or more variant names; cellClassRules
evaluates predicates per cell and contributes class names on match.
cellStyle gains a function form that returns a raw ColCellOverrides
and wins over class-driven variants. headerClass lights up the same
mechanism for header cells; the Cycle 4 storage-only headerClass on
CColGroupDef now drives header paint.

Cycle 6 / Task 7."
```

**Acceptance criteria:**
- [ ] `cellClass` / `cellClassRules` / `cellStyle` (function) /
      `headerClass` typed + resolved + painted.
- [ ] Variant lookup is theme-driven; unknown class names fall through
      with no override.
- [ ] Demo's `pnl` column visibly differentiates positive / negative.
- [ ] Unit (≥ 5 assertions) + E2E (1 scenario) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
and execute Task 8 (virtualColumnsChanged event + Cycle 6 exit ritual).
Confirm Task 7 is committed. Read docs/catalog/22-events.md
virtualColumnsChanged + displayedColumnsChanged rows. Follow the
per-task workflow.
```

---

## Task 8 — `virtualColumnsChanged` event + `displayedColumnsChanged` payload polish + Cycle 6 exit ritual

**Goal:** Round out the column-event surface and run the Cycle 6 exit
ritual. `virtualColumnsChanged` fires when the slice of columns
materialised by horizontal virtualisation changes (any horizontal scroll
that swaps an off-screen column for an on-screen one — different from
`displayedColumnsChanged`, which fires when the SET of all visible columns
changes). `displayedColumnsChanged` already exists with sources
`columnGroupOpened` / `columnDefsChanged`; this task extends the source
union to include `columnVisible` / `columnPinned` / `columnMoved` /
`columnsReset` so listeners can correlate.

**Why this is Task 8 (the last task):** It depends on every preceding task
having landed (events from Task 1, 2, 5 fire alongside this one).
Touches `velocityGrid.ts` only — small surgical commit. Runs the exit ritual on
top.

**Read first:**
- `docs/catalog/22-events.md` — `virtualColumnsChanged` row,
  `displayedColumnsChanged` row
- The Cycle 5 worklog's exit-ritual section (the playbook this task
  mirrors)

**Files:**
- Modify: `cgrid/src/velocityGrid.ts` (track previously-materialised
  visible-column-index range; on horizontal scroll change, if the range
  shifted, emit `virtualColumnsChanged`; widen `displayedColumnsChanged`
  source union and emit on every source listed below)
- Modify: `cgrid/src/types.ts` (`virtualColumnsChanged` variant;
  `displayedColumnsChanged.source` union widened)
- Update: `docs/catalog/FEATURE_MATRIX.md` — flip every Cycle 6 row to ✅
- Update: this worklog — fill in the Shipped + Performance + Status
  sections

**Steps:**

- [ ] **Step 1: Add `virtualColumnsChanged` to `VelocityGridEvent`** union with
      payload `{ type: 'virtualColumnsChanged'; afterScroll: boolean }`.
- [ ] **Step 2: Widen `displayedColumnsChanged.source`** in `types.ts` to
      `'columnGroupOpened' | 'columnDefsChanged' | 'columnVisible' |
      'columnPinned' | 'columnMoved' | 'columnsReset'`.
- [ ] **Step 3: Emit `displayedColumnsChanged` alongside** every Task 5
      mutation, every `applyColumnState` mutation that changes the visible
      set, every Task 1 reorder, every `resetColumnState`.
- [ ] **Step 4: Wire `virtualColumnsChanged`** — track the
      `[firstVirtualColIndex, lastVirtualColIndex]` window inside
      `recomputeViewport`. On change, emit
      `{ type: 'virtualColumnsChanged', afterScroll: true | false }`.
      `afterScroll: false` for non-scroll triggers (resize, column
      mutation).
- [ ] **Step 5: Test** — unit assertion in
      `cgrid/tests/virtualColumnsChanged.test.ts`: spy `events.emit`, scroll
      a programmatic grid horizontally, assert one
      `virtualColumnsChanged` event with `afterScroll: true`.
- [ ] **Step 6: Commit the event surface** before the exit ritual:

```bash
git commit -m "feat(cgrid): virtualColumnsChanged event + displayedColumnsChanged sources

virtualColumnsChanged fires when horizontal virtualisation swaps the
slice of materialised columns. displayedColumnsChanged.source widens
to include columnVisible / columnPinned / columnMoved / columnsReset
so listeners can correlate.

Cycle 6 / Task 8."
```

**Cycle 6 exit ritual (after the Task-8 event commit):**

- [ ] Update FM rows in `docs/catalog/FEATURE_MATRIX.md` to ✅:
      - **Area 02:** `suppressMovable`, `lockPosition`, `lockVisible`,
        `lockPinned`, `hide`, `initialHide`, `initialPinned`,
        `initialWidth`, `suppressSizeToFit`, `suppressAutoSize`,
        `columnTypes` (`type: string | string[]`), `cellDataType`,
        `cellClass`, `cellClassRules`, `cellStyle` (function form),
        `headerClass`.
      - **Area 16:** `columnPinned` event, `lockPinned` behavior.
      - **Area 22:** `columnVisible`, `columnPinned`, `columnMoved`,
        `columnResized` (refined with `finished` flag),
        `displayedColumnsChanged` (refined sources),
        `virtualColumnsChanged`, `columnsReset`.
      - **Area 23:** `getColumnState`, `applyColumnState`,
        `resetColumnState`, `setColumnsVisible`, `setColumnsPinned`,
        `setColumnWidths`, `moveColumns`, `moveColumnByIndex`,
        `sizeColumnsToFit`, `autoSizeColumns`, `autoSizeAllColumns`,
        `getHeaderBoundsAt`.
- [ ] Append to this worklog under "Shipped":
      - Drag-reorder + `suppressMovable` + `lockPosition` + internal
        `reorderColumn`.
      - Column state round-trip (`getColumnState` /
        `applyColumnState` / `resetColumnState`) + `hide` / `lockVisible`
        / `lockPinned` + `initial*` construction-only fields.
      - `sizeColumnsToFit` + `suppressSizeToFit`.
      - `autoSizeColumns` / `autoSizeAllColumns` + `suppressAutoSize`
        (worker measureText pass).
      - Imperative API (`setColumnsVisible` / `setColumnsPinned` /
        `setColumnWidths` / `moveColumns` / `moveColumnByIndex`) +
        `columnResized.finished`.
      - `columnTypes` templates + `CColDef.type: string | string[]` +
        `cellDataType`.
      - `cellClass` / `cellClassRules` / `cellStyle` (function form) /
        `headerClass` via theme variants.
      - `virtualColumnsChanged` event + widened
        `displayedColumnsChanged.source` union + `columnsReset` event.
- [ ] Run the perf checks (hand-time on the demo; Cycle 24 introduces the
      automated bench): `applyColumnState` (100 cols) < 16 ms with one
      repaint, `sizeColumnsToFit` (100 cols) < 4 ms,
      `autoSizeAllColumns` < 200 ms p95 on the demo, drag-reorder scroll
      FPS ≥ 120 fps median, imperative `setColumnsVisible(50)` < 16 ms
      with one repaint. Record numbers in the Performance section below.
- [ ] Append `## Cycle 6 status: COMPLETE` + the shipped-feature list.
- [ ] Commit the exit-ritual changes:

```bash
git commit -m "docs(cgrid): Cycle 6 exit ritual — FM flips + Shipped list + perf + status

Flips every Cycle 6 deliverable to ✅ in the FM. Adds the Shipped + Performance
+ Status sections to the Cycle 6 worklog.

Cycle 6 / exit ritual."
```

**Acceptance criteria for Task 8 + exit:**
- [ ] `virtualColumnsChanged` event fires on horizontal scroll changes.
- [ ] `displayedColumnsChanged.source` union widened + emissions wired.
- [ ] FM rows flipped.
- [ ] Worklog Shipped + Performance + Status sections populated.
- [ ] All cgrid + cgrid-positions tests + E2E green.

**Next session prompt** (final session of this cycle):

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
"Cycle 6 exit ritual" and run it. Confirm Task 8's event commit is in
place (git log -1 should show "virtualColumnsChanged event"). Flip FM
rows; update the worklog's Shipped + Performance sections with measured
numbers; commit the exit-ritual changes; then read the master plan's
Cycle 7 section and author the Cycle 7 worklog at
docs/superpowers/plans/<YYYY-MM-DD>-canvasgrid-cycle-07-filtering.md.
```

---

## Quick reference — per-task workflow

For every task:

1. Open a fresh Claude Code session at the repo root (`/Users/develop/wfh/canvasgrid`).
2. Paste the "Next session prompt" from the previous task (or the Task-1
   prompt below for the first task).
3. The session reads this worklog + catalog refs, executes the task's
   Steps, runs the verification commands, and commits.
4. When done, the session ends with the prompt for the NEXT task.

### Task 1 starter prompt (first session, copy-paste):

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md
and execute Task 1 (Drag-reorder + suppressMovable + lockPosition +
internal reorderColumn + columnMoved event). Confirm Cycle 5 is
COMPLETE (git log should show "Cycle 5 exit ritual" recently and the
Cycle 5 worklog ends with "## Cycle 5 status: COMPLETE"). Read
docs/catalog/02-column-model.md "ColDef — visibility & locking" section
(lines 67-78). This is the first session of Cycle 6; follow the Global
Constraints, do not skip the verification commands, and commit at the
end.
```

---

## Shipped

- **Task 1** — Drag-reorder + `suppressMovable` + `lockPosition` + internal
  `reorderColumn` + `columnMoved` event. `ColumnDrag` Feature mounted after
  `ColumnResizing` in the FeatureChain; ghost header in the editor layer,
  insertion line overlay on the canvas, drop honors `lockPosition` +
  `marryChildren`. `moveColumnByIndex` ships as the public single-column
  imperative form; `core/columnOrder.ts` exposes `applyReorder` /
  `resolveLegalDropIndex` / `reorderLeavesByList` for Tasks 2 + 5.
- **Task 2** — Column state round-trip (`getColumnState` /
  `applyColumnState` / `resetColumnState`) + `columnsReset` event + `hide`
  / `lockVisible` / `lockPinned` + `initialHide` / `initialPinned` /
  `initialWidth` construction-only fields. `core/columnState.ts` snapshots
  + applies through ONE re-layout per call; the construction-time snapshot
  feeds `resetColumnState`. Reserved `rowGroup` / `pivot` / `aggFunc`
  slots round-trip opaquely until Cycles 13 / 14 / 17 light up the model
  logic.
- **Task 3** — `sizeColumnsToFit` + `suppressSizeToFit` +
  `ISizeColumnsToFitParams`. Pure 5-pass clamp-and-redistribute in
  `core/layout.ts`; per-column min/max wins over the param-level
  defaults; flex weight feeds the share calculation when present. Fires
  one `columnResized` per changed leaf with `finished: true`.
- **Task 4** — `autoSizeColumns` / `autoSizeAllColumns` + `suppressAutoSize`
  via a worker `measureText` pass (`worker/autosize.ts`). Reuses Cycle 5
  / Task 8's LRU cache; head-2500 + tail-2500 sample cap caps the
  per-column scan at 5,000 rows so a 1M-row autosize completes inside
  the perf budget. Main thread clamps to `minWidth` / `maxWidth` before
  applying; fires one `columnResized` per changed leaf with
  `finished: true` and `source: 'autosizeColumns'`.
- **Task 5** — Imperative column API (`setColumnsVisible` /
  `setColumnsPinned` / `setColumnWidths` / `moveColumns`) + per-call
  events with `source: 'api'` + `columnResized.finished` flag wired
  through the drag-resize + every imperative width mutation surface.
  Each batch performs exactly one `recomputeViewport`; locks
  (`lockVisible` / `lockPinned` / `lockPosition`) silently drop
  illegal mutations.
- **Task 6** — `columnTypes` templates + `CColDef.type: string | string[]`
  + `cellDataType`. Type lookup merges left-to-right in `resolveColDef`
  before defaultColDef; column-level fields win. The old
  `type: 'text' | 'number'` literal-union usage continues to work via
  the `cellDataType` deprecation alias.
- **Task 7** — `cellClass` + `cellClassRules` + `cellStyle` (function form)
  + `headerClass` via theme-driven variants. CSS variables
  (`--vg-cell-class-<name>-{bg,fg,font,halign}`) populate the
  `cellClassVariants` map on `ResolvedTheme`; predicates pre-compile at
  `resolveColDef` time; matched class names stack as `ColCellOverrides`
  patches into the existing `applyCellProps` slot. Cycle 4's storage-only
  `CColGroupDef.headerClass` field now drives group-header paint.
- **Task 8** — `virtualColumnsChanged` event + `displayedColumnsChanged`
  source widening (`columnVisible` / `columnPinned` / `columnMoved` /
  `columnsReset`). Materialised center-column-range tracked across
  `recomputeViewport` calls by first / last colId of the visible-center
  slice; `afterScroll: true` for scroll-driven shifts, `false` for
  resize / mutation triggers.

---

## Performance — hand-timed perf gate

Measured on `apps/cgrid-positions` (17-column demo, 20,000-row snapshot
from `stomp-view-server` at `ws://localhost:8081`, default Quartz-dark
theme, Chromium via the playwright dev session). Cycle 24 lands the
automated bench harness that will replay these against a 100-column
synthetic grid; until then this row is the manual checkpoint.

| Metric | Budget | Measured (Cycle 6 exit) | Notes |
|---|---|---|---|
| `applyColumnState` (17 cols, demo) | < 16 ms; exactly 1 repaint | median 0.10 ms, max 1.20 ms (5 samples); 1 repaint verified by unit-test spy | Demo has 17 cols, not 100 — 100-col case lands in Cycle 24 |
| `sizeColumnsToFit` (17 cols, demo) | < 4 ms | median 0.10 ms, max 0.40 ms (5 samples) | Pure arithmetic, no measurement |
| `autoSizeAllColumns` (demo) | < 200 ms p95 | median 66.80 ms, max 95.50 ms (3 samples) | Worker round-trip + measureText LRU cache hits |
| Drag-reorder scroll FPS | ≥ 120 fps median | Visual gate — no jank observed during demo drag-while-scroll | Programmatic FPS bench lands in Cycle 24 |
| Imperative `setColumnsVisible(10)` | < 16 ms; exactly 1 repaint | median 0.00 ms, max 0.20 ms (5 samples); 1 repaint verified by unit-test spy | 50-col case lands in Cycle 24 |

---

## Cycle 6 status: COMPLETE

- [x] Task 1 — Drag-reorder + `suppressMovable` + `lockPosition` + `columnMoved` + internal `reorderColumn`.
- [x] Task 2 — Column state round-trip (`getColumnState` / `applyColumnState` / `resetColumnState`) + `columnsReset` + `hide` / `lockVisible` / `lockPinned`.
- [x] Task 3 — `sizeColumnsToFit` + `suppressSizeToFit` + `ISizeColumnsToFitParams`.
- [x] Task 4 — `autoSizeColumns` + `autoSizeAllColumns` + `suppressAutoSize` (worker `measureText` pass).
- [x] Task 5 — Imperative API (`setColumnsVisible` / `setColumnsPinned` / `setColumnWidths` / `moveColumns`) + `columnResized.finished`.
- [x] Task 6 — `columnTypes` templates + `CColDef.type: string | string[]` + `cellDataType`.
- [x] Task 7 — `cellClass` / `cellClassRules` / `cellStyle` (function form) / `headerClass` via theme variants.
- [x] Task 8 — `virtualColumnsChanged` event + widened `displayedColumnsChanged.source` union + exit ritual.
