# Canvasgrid Cycle 8 — Sorting completeness — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to fit
> in a single, isolated Claude Code session. Run **one task per session**,
> verify, commit, push, and open a PR; then START A NEW SESSION using the
> "Next session prompt" at the end of the task. **Do NOT chain multiple
> tasks in one session.** The automation runner at
> `scripts/run-cycle-tasks.sh` spawns these sessions for you.

**Goal:** Multi-column sort with modifier-click, initial sort state, sort
order indicator (1, 2, 3 …) in header, post-sort callback hook,
column-level custom comparator integration, `sortingOrder` configurable
tri-state cycle, and `accentedSort` for diacritic-aware string ordering.

**Architecture:** All sort work happens on the worker via the existing
`SortPass`. Cycle 8 extends `SortPass` with: (a) a `comparatorRegistry`
(name → function) so per-column comparators can survive the
`postMessage` boundary; (b) an optional `postSortRows` hook fired after
the chained comparator and before `ViewportSlicer`. Multi-column sort
UX lives main-side in `interaction/features/headerClick.ts`. Header
sort-order badges paint in `renderer/cellRenderers/registry.ts` (the
existing `headerCell` painter). `sortingOrder` lets apps reshape the
`unsorted → asc → desc → unsorted` cycle (e.g. drop `unsorted` to keep
a column always sorted).

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E),
single-canvas 2D paint, Web Worker data pipeline. No new runtime
dependencies.

**References (READ FIRST when starting any task):**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan (Cycle 8 section, line 282)
- `docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md` — previous cycle's worklog for shape reference
- `docs/catalog/07-sorting.md` — `sortingOrder`, `multiSortKey`, `accentedSort`, `comparator`, `postSortRows`, `agSortChanged` event
- `docs/catalog/FEATURE_MATRIX.md` — Area 07 rows to flip at cycle exit
- Source files (current state):
  - `cgrid/src/types.ts` — `CGridOptions`, `CColDef`, `SortModel`, `CGridEvent` (sortChanged)
  - `cgrid/src/cgrid.ts` — `setSortModel`, private `cycleSort`
  - `cgrid/src/core/propertyChain.ts` — `ResolvedColDef.sortable`, `comparator`
  - `cgrid/src/core/columnState.ts` — `sortIndex` round-trip via `applyColumnState`
  - `cgrid/src/worker/dataPipeline.ts` — `SortPass.apply`
  - `cgrid/src/interaction/features/headerClick.ts` — current click handler
  - `cgrid/src/renderer/cellRenderers/registry.ts` — `headerCell` painter (sort indicator)
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task** (extend the constraints from Cycles 2–7).

- **API parity, not API mimicry.** Field names mirror ag-grid verbatim
  (`comparator`, `initialSort`, `initialSortIndex`, `sortable`,
  `sortingOrder`, `accentedSort`, `postSortRows`, `multiSortKey`).
  Top-level type names keep the `C` prefix (`CGridOptions`, `CColDef`).
- **No regressions in the public API.** Any addition to `CGridOptions`,
  `CGridApi`, `CColDef`, `SortModel`, or the worker protocol is purely
  additive. Existing field signatures only widen, never narrow.
- **TypeScript strict.** `cgrid/src/**/*.ts` compiles clean under
  `npm run typecheck --workspaces`. cgrid-positions also typechecks.
- **Sort runs on the worker.** Main thread never sorts. `comparator`
  functions cross the worker boundary via the new
  `comparatorRegistry` (string-keyed). Inline closures throw a clear
  error directing apps to register a named comparator first.
- **`alpha: false` canvas, DPR-aware paint, native scrollbars** — unchanged.
- **Vitest unit + Playwright E2E green at the end of every task.**
  Run `npm test --workspace=cgrid` + `cd apps/cgrid-positions && npx
  playwright test`.
- **Conventional commits.** Each task = one focused commit. Body
  footer includes the cycle prefix (e.g. `feat(cgrid): multi-column
  sort\n\nCycle 8 / Task 1.`).
- **Documentation as you go.** Each new public type/method gets (a)
  TSDoc, (b) the matching FM row flipped to ✅ in
  `docs/catalog/FEATURE_MATRIX.md`, and (c) a one-line entry in this
  worklog's "Shipped" list at cycle exit.
- **Demo never breaks.** `apps/cgrid-positions` runs green at every
  commit. E2E specs route through `?stress=light` (PR #11).
- **Performance gate.** Multi-sort runs as a chained comparator on the
  worker; no main-thread compute. Sort 1M rows × 3 cols < 200 ms
  (deferred measurement; Cycle 24 wires the bench).

## Task overview

| # | Task | Files |
|---|---|---|
| 1 | Multi-column sort (Shift+click) + sort-order badge in header | `cgrid.ts`, `interaction/features/headerClick.ts`, `renderer/cellRenderers/registry.ts`, demo, tests, E2E |
| 2 | `initialSort` / `initialSortIndex` + `sortingOrder` configurable cycle | `types.ts`, `core/propertyChain.ts`, `cgrid.ts`, tests |
| 3 | `comparator` per column via worker-side `ComparatorRegistry` | `types.ts`, `worker/comparatorRegistry.ts` (new), `worker/dataPipeline.ts`, `worker/protocol.ts`, `worker/client.ts`, `cgrid.ts`, tests |
| 4 | `postSortRows` callback (main-side re-order hook after worker sort) | `types.ts`, `cgrid.ts`, `worker/worker.ts`, `worker/client.ts`, `worker/protocol.ts`, tests |
| 5 | `accentedSort` + `unSortIcon` + Cycle 8 exit ritual | `types.ts`, `worker/dataPipeline.ts`, `renderer/cellRenderers/registry.ts`, `theming/tokens.css`, FM flips, worklog Shipped + status |

---

## Task 1 — Multi-column sort + sort-order badge

**Goal:** Shift-click on a header APPENDS the column to the sort model
instead of replacing it. Plain click still REPLACES. When the sort
model has > 1 entry, the header cell paints a small order badge
(`¹`, `²`, `³`, …) next to the chevron so the user can see the sort
precedence at a glance.

**Read first:**
- `docs/catalog/07-sorting.md` — `multiSortKey` (defaults to `Shift`,
  configurable to `Ctrl` / `Alt`)
- `cgrid/src/cgrid.ts:1052` — current `cycleSort` (always-replace)
- `cgrid/src/interaction/features/headerClick.ts` — entry point;
  receives the raw `MouseEvent`
- `cgrid/src/renderer/cellRenderers/registry.ts` — `headerCell` painter
  (draws the chevron via `drawIcon`)

**Files:**
- Modify: `cgrid/src/cgrid.ts` — extend `cycleSort(colId, opts)` with
  `{ append?: boolean }`; implement multi-sort semantics. Add
  `multiSortKey?: 'Shift' | 'Ctrl' | 'Alt'` to `CGridOptions`.
- Modify: `cgrid/src/types.ts` — add `multiSortKey` option, widen
  `CGridApi.cycleSort` signature (kept private).
- Modify: `cgrid/src/interaction/feature.ts` + `headerClick.ts` —
  thread `event.shiftKey` (resolved via `multiSortKey`) into the
  `cycleSort` call.
- Modify: `cgrid/src/renderer/cellRenderers/registry.ts` — `headerCell`
  paints a tiny superscript number next to the chevron when
  `sortIndex > 0` (1-indexed display). Pull the position +
  total-sort-count from `CellPaintConfig.sortIndex` + `sortTotal`
  (new optional fields).
- Modify: `cgrid/src/renderer/painters/byRows.ts` + `core/propertyChain.ts`
  — thread `sortIndex` + `sortTotal` into the cell paint config.
- Modify: `apps/cgrid-positions/src/positionsGrid.ts` — no demo
  change needed (multi-sort just works).
- Create: `cgrid/tests/cycleSort.test.ts` — assert append semantics.
- Create: `apps/cgrid-positions/e2e/cycle8-multiSort.spec.ts` —
  Shift-click two headers → both badges paint → row order honors
  primary then secondary.

**Interfaces produced:**

```ts
// CGridOptions
export interface CGridOptions<TRow = any> {
  // … existing …
  /** Modifier key that turns a header click into a multi-column sort
   *  append. Defaults to `'Shift'`. Set to `null` to disable
   *  multi-sort entirely (every header click replaces). Cycle 8 / Task 1. */
  multiSortKey?: 'Shift' | 'Ctrl' | 'Alt' | null;
}

// CellPaintConfig additions (renderer/cellRenderers/registry.ts)
export interface CellPaintConfig {
  // … existing …
  /** 1-indexed sort position when the cell's column participates in a
   *  multi-column sort (e.g. 2 means "second sort key"). 0 / undefined
   *  for single-column or unsorted columns. */
  sortIndex?: number;
  /** Total number of columns in the current sort model. Used by the
   *  header painter to decide whether to render the badge at all
   *  (no badge for sortTotal <= 1). */
  sortTotal?: number;
}
```

**Steps:**

- [ ] **Step 1:** Write failing `cycleSort.test.ts` — direct unit tests
      against `CGrid.cycleSort` via a wired worker. Assertions:
      - Plain click on unsorted column → `[{colId:'a', direction:'asc'}]`
      - Plain click on asc column → `[{colId:'a', direction:'desc'}]`
      - Plain click on desc column → `[]`
      - Shift-click on unsorted column when model has one entry →
        appends: `[…, {colId:'b', direction:'asc'}]`
      - Shift-click on already-sorted column cycles its direction
        in place (doesn't reorder).
      - Shift-click on desc column removes it from the model.
- [ ] **Step 2:** Implement `cycleSort(colId, { append? })` in cgrid.ts.
- [ ] **Step 3:** Add `multiSortKey` to CGridOptions; resolve in
      `headerClick.ts` via `event.shiftKey` / `event.ctrlKey` /
      `event.altKey`. Default `'Shift'`.
- [ ] **Step 4:** Header badge — extend `CellPaintConfig` +
      `applyCellProps`; paint a small superscript number to the right
      of the chevron when `sortTotal > 1`. Use theme `headerFg` at
      75% alpha, font size 80% of base.
- [ ] **Step 5:** Demo E2E — open the demo, Shift-click two headers,
      assert (a) `sortModel.length === 2`, (b) badges are present in
      the painted header (via `getHeaderBoundsAt` + a tiny custom
      probe).
- [ ] **Step 6:** Run typecheck + unit suite + cycle7 + cycle8 E2Es.
- [ ] **Step 7:** Commit + push + open PR to main.

**Acceptance criteria:**
- [ ] Plain click replaces sort model (existing behavior preserved).
- [ ] Shift-click appends (or removes if last cycle stage).
- [ ] Header cells with `sortIndex > 0` paint a tiny order badge.
- [ ] All cgrid unit tests + Cycle 7 E2E + new Cycle 8 / Task 1 E2E green.
- [ ] FM Area 07 rows for `multiSortKey` + `Multi-column sort behavior` flipped.

**Commit message:**

```
feat(cgrid): multi-column sort (Shift+click) + sort-order badge in header

Header click semantics extended: plain click replaces the sort model
(existing behavior); Shift-click appends to it. Header cells paint a
small superscript order badge (¹, ², …) when sortTotal > 1.

multiSortKey option ('Shift' | 'Ctrl' | 'Alt' | null) lets apps
configure which modifier enables append; null disables multi-sort
entirely.

Cycle 8 / Task 1.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md
"Task 2" and execute it. Confirm Task 1 is on main (git log -1
should show "multi-column sort (Shift+click)"). Branch the new work
off main as batch/cycle-8-task-2-<YYYY-MM-DD>. Open a single PR to
main when the task lands.
```

---

## Task 2 — `initialSort` + `initialSortIndex` + `sortingOrder` configurable cycle

**Goal:** Per-column `initialSort: 'asc' | 'desc'` + `initialSortIndex:
number` seed the sort model on first construction (consumed exactly
once, then ignored). Grid-level `sortingOrder: Array<'asc' | 'desc' |
null>` reshapes the cycle order — defaults to `['asc', 'desc', null]`;
setting `['asc', 'desc']` removes the unsorted state (sort cycles
between asc and desc forever).

**Read first:**
- `docs/catalog/07-sorting.md` — `initialSort` / `sortingOrder` rows
- `cgrid/src/core/columnState.ts` — initial-only field handling for
  `initialHide` / `initialPinned` / `initialWidth` (same pattern)

**Files:**
- Modify: `cgrid/src/types.ts` — `CColDef.initialSort`,
  `CColDef.initialSortIndex`, `CGridOptions.sortingOrder`.
- Modify: `cgrid/src/core/propertyChain.ts` — thread `initialSort` +
  `initialSortIndex` from the col def.
- Modify: `cgrid/src/cgrid.ts` — at construction time, build the
  initial `sortModel` from any column with `initialSort` set,
  ordered by `initialSortIndex` (rows without index sort to the
  end). Read `sortingOrder` in `cycleSort` to compute the next
  state.
- Create: `cgrid/tests/initialSort.test.ts` — assert seeding +
  sortingOrder cycle.
- No demo / E2E change required.

**Interfaces produced:**

```ts
// CColDef
export interface CColDef<TRow = any, TValue = any> {
  // … existing …
  /** Construction-time seed for the sort direction on this column.
   *  Honored exactly once; subsequent `applyColumnState` reads
   *  `sort` instead. Cycle 8 / Task 2. */
  initialSort?: 'asc' | 'desc';
  /** Construction-time seed for the column's position in a
   *  multi-column sort. Columns without an index sort to the tail
   *  in their declaration order. Cycle 8 / Task 2. */
  initialSortIndex?: number;
}

// CGridOptions
export interface CGridOptions<TRow = any> {
  // … existing …
  /** Cycle order for `cycleSort`. Defaults to `['asc', 'desc', null]`.
   *  Setting `['asc', 'desc']` keeps the column always sorted (no
   *  unsorted stage). Cycle 8 / Task 2. */
  sortingOrder?: Array<'asc' | 'desc' | null>;
}
```

**Steps:**

- [ ] **Step 1:** Write failing `initialSort.test.ts`. Assertions:
      - Column with `initialSort: 'desc'` produces `[{colId, direction:'desc'}]` on construct.
      - Two columns with `initialSort` + different `initialSortIndex`
        produce a multi-entry sort ordered by index.
      - `sortingOrder: ['asc', 'desc']` makes the third cycle stage
        wrap back to asc instead of clearing.
- [ ] **Step 2:** Wire `initialSort` / `initialSortIndex` in
      propertyChain + cgrid constructor.
- [ ] **Step 3:** Implement `sortingOrder` in `cycleSort`.
- [ ] **Step 4:** Typecheck + tests + E2E green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Columns with `initialSort` sort on first render.
- [ ] `initialSortIndex` orders multi-column initial sorts.
- [ ] `sortingOrder` reshapes the cycle deterministically.
- [ ] FM Area 07 rows for `initialSort` / `initialSortIndex` / `sortingOrder` flipped.

**Commit message:**

```
feat(cgrid): initialSort + initialSortIndex per column + grid-level sortingOrder

initialSort + initialSortIndex seed the sort model on construction
(initial-only; subsequent applyColumnState reads sort instead).
sortingOrder reshapes the cycleSort cycle — default
['asc', 'desc', null], drop null to skip the unsorted stage.

Cycle 8 / Task 2.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md
"Task 3" and execute it. Confirm Task 2 is on main. Branch
batch/cycle-8-task-3-<YYYY-MM-DD>. Open PR to main when done.
```

---

## Task 3 — `comparator` per column via worker-side `ComparatorRegistry`

**Goal:** Apps register custom comparators by name (`'currency'`,
`'naturalOrder'`, …) via `CGridApi.registerComparator(name, fn)`.
Column defs reference them via `comparator: 'name'` (string).
Comparators run on the worker. Inline closures throw a clear error
directing apps to register a named comparator first (closures don't
cross `postMessage`).

**Read first:**
- `cgrid/src/worker/dataPipeline.ts` — `SortPass.apply` (current
  `compare` helper handles `text` / `number` only)
- `cgrid/src/cgrid.ts` — `registerCellRenderer` / `registerCellEditor`
  (same pattern)

**Files:**
- Create: `cgrid/src/worker/comparatorRegistry.ts` — ~40 LOC class
  with `register(name, fn)` + `get(name)`.
- Modify: `cgrid/src/worker/dataPipeline.ts` — `SortPass.apply` looks
  up the column's `comparator` field; if a name is set, dispatches
  through the registry; falls back to default `compare()`.
- Modify: `cgrid/src/worker/protocol.ts` — add
  `'registerComparator'` request envelope (carries the function's
  toString'd source); worker reconstructs via `new Function(...)`.
- Modify: `cgrid/src/worker/worker.ts` — handle the new request.
- Modify: `cgrid/src/worker/client.ts` — `registerComparator(name,
  fn)` method.
- Modify: `cgrid/src/cgrid.ts` — surface `registerComparator` on
  `CGridApi`; convert inline closures on col def to a clear
  Error.
- Modify: `cgrid/src/types.ts` — `CColDef.comparator` widens to
  `string | ((a, b) => number)`. Add
  `CGridApi.registerComparator`.
- Create: `cgrid/tests/comparatorRegistry.test.ts`.
- Update: demo (one column gets a named comparator for visual proof).

**Interfaces produced:**

```ts
// CColDef
export interface CColDef<TRow = any, TValue = any> {
  // … existing …
  /** Custom comparator. Either the NAME of a comparator registered
   *  via `api.registerComparator(name, fn)` (preferred — works
   *  with the worker pipeline) OR an inline closure (throws at sort
   *  time because closures can't cross postMessage). Cycle 8 / Task 3. */
  comparator?: string | ((a: TValue, b: TValue, ar: TRow, br: TRow) => number);
}

// CGridApi
export interface CGridApi<TRow = any> {
  // … existing …
  /** Register a custom comparator under `name`. Column defs reference
   *  it via `comparator: name`. The function string-serialises +
   *  reconstructs on the worker via `new Function(...)`; the
   *  function MUST be pure and may not close over external scope.
   *  Re-registering overwrites. Cycle 8 / Task 3. */
  registerComparator<TValue = unknown>(
    name: string,
    fn: (a: TValue, b: TValue) => number,
  ): void;
}
```

**Steps:**

- [ ] **Step 1:** Failing `comparatorRegistry.test.ts` — register,
      lookup, override, lookup-of-unknown returns undefined.
- [ ] **Step 2:** Implement registry.
- [ ] **Step 3:** Wire worker request + client method.
- [ ] **Step 4:** Extend `SortPass.apply` to dispatch through the
      registry when the col's comparator is a string.
- [ ] **Step 5:** Closure-on-col-def → throw at `setSortModel` time
      with a message pointing to `registerComparator`.
- [ ] **Step 6:** Demo: register a `naturalOrder` comparator
      (string sort that handles embedded numbers, e.g. "TICK2" <
      "TICK10") and apply it to the `ticker` column.
- [ ] **Step 7:** Typecheck + tests + E2E green.
- [ ] **Step 8:** Commit + push + PR.

**Acceptance criteria:**
- [ ] `api.registerComparator('naturalOrder', fn)` works end-to-end.
- [ ] `ticker` column in the demo sorts by natural order after
      a click.
- [ ] Inline closure on a col def throws a clear error at sort time.
- [ ] FM Area 07 `comparator` row flipped.

**Commit message:**

```
feat(cgrid): comparator per column via worker-side ComparatorRegistry

Apps register comparators by name via api.registerComparator(name, fn);
col defs reference them via comparator: 'name'. Functions string-
serialise + reconstruct on the worker via new Function(...) so sort
stays off the main thread. Inline closures throw at sort time with
a clear message.

Demo's ticker column uses a 'naturalOrder' comparator to sort
"TICK2" < "TICK10".

Cycle 8 / Task 3.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md
"Task 4". Confirm Task 3 is on main. Branch
batch/cycle-8-task-4-<YYYY-MM-DD>. Open PR.
```

---

## Task 4 — `postSortRows` callback

**Goal:** App-provided hook that runs AFTER the worker's `SortPass`
and BEFORE `ViewportSlicer`. Lets apps re-order specific rows (e.g.
pin a "selected" row to the top, group siblings together) without
forking the comparator. The callback receives the sorted rowId
array + the current row data map and returns a re-ordered rowId
array.

**Read first:**
- `cgrid/src/worker/worker.ts` — `buildVisibleAsync` pipeline (where
  `state.sort.apply(ids)` runs)
- `cgrid/src/worker/protocol.ts` — see how Cycle 7 / Task 8's
  external-filter round-trip threads main↔worker callbacks; same
  shape for postSortRows.

**Files:**
- Modify: `cgrid/src/types.ts` — `CGridOptions.postSortRows`.
- Modify: `cgrid/src/worker/worker.ts` — after `sort.apply`, if
  `state.postSortRowsPresent`, push the sorted rowIds to main via
  a new `postSortRowsRequest`; await `postSortRowsResult` with
  the re-ordered array. Mirror the
  `externalFilterCandidates`/`externalFilterResult` shape.
- Modify: `cgrid/src/worker/protocol.ts` + `worker/client.ts` —
  envelopes for the round-trip + `setPostSortRowsPresent`.
- Modify: `cgrid/src/cgrid.ts` — `onPostSortRowsCandidates` handler
  that runs the app callback against the cached row-data map +
  posts back.
- Create: `cgrid/tests/postSortRows.test.ts`.
- Update: demo — one demo button "Pin selected to top" that
  toggles a flag the postSortRows callback reads.

**Interfaces produced:**

```ts
// CGridOptions
export interface CGridOptions<TRow = any> {
  // … existing …
  /** Post-sort re-order hook. Runs after the worker's chained
   *  comparator and before the viewport slice. Receives the sorted
   *  rowId array; returns the (possibly re-ordered) rowId array.
   *  Useful for "pin this row to top regardless of sort", grouping
   *  siblings, etc. Cycle 8 / Task 4. */
  postSortRows?: (params: {
    rowIds: string[];
    getData: (rowId: string) => TRow | undefined;
  }) => string[];
}
```

**Steps:**

- [ ] **Step 1:** Failing `postSortRows.test.ts` — assert the hook
      fires once per sort, receives current sorted rowIds, and the
      visible row order matches the returned array.
- [ ] **Step 2:** Wire protocol envelopes (request + reply, callId
      pattern from Task 8 of Cycle 7).
- [ ] **Step 3:** Wire worker pipeline (await round-trip after sort).
- [ ] **Step 4:** Wire main-side callback dispatch + posting back.
- [ ] **Step 5:** Demo button.
- [ ] **Step 6:** Typecheck + tests + E2E green.
- [ ] **Step 7:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Setting `options.postSortRows` makes every sort fire the hook.
- [ ] Demo's "Pin selected to top" button moves selected rows to
      the top regardless of sort.
- [ ] No round-trip overhead when the hook isn't set.
- [ ] FM Area 07 `postSortRows` row flipped.

**Commit message:**

```
feat(cgrid): postSortRows callback (main-side re-order after worker sort)

App-provided hook runs after the worker's SortPass and before
ViewportSlicer. Receives the sorted rowId array + a data getter;
returns the re-ordered array. Uses the same candidate-rowIds
protocol shape as Cycle 7 / Task 8's external filter.

Demo's "Pin selected to top" toolbar button uses it to keep selected
rows visible at the top regardless of the active sort.

Cycle 8 / Task 4.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md
"Task 5". Confirm Task 4 is on main. Branch
batch/cycle-8-task-5-<YYYY-MM-DD>. Task 5 is the final task; runs the
Cycle 8 exit ritual (FM flips, Shipped list, status update) before
opening the PR.
```

---

## Task 5 — `accentedSort` + `unSortIcon` + tri-state config + Cycle 8 exit ritual

**Goal:** Three small polishes plus the cycle exit ritual.

1. `accentedSort: true` on a column makes string sort use
   `Intl.Collator(undefined, { sensitivity: 'variant' })` so
   diacritics order correctly (e.g. `Élise` between `Ele` and `Em`).
2. `unSortIcon: true` on a column shows a faint "no sort" icon in
   the header even when the column isn't currently sorted (apps that
   want to advertise "this column is sortable" without ambiguity).
3. Cycle 8 exit ritual: flip Area 07 FM rows, append the worklog's
   Shipped + Performance + Status sections, commit.

**Files:**
- Modify: `cgrid/src/types.ts` — `CColDef.accentedSort`,
  `CColDef.unSortIcon`.
- Modify: `cgrid/src/worker/dataPipeline.ts` — `SortPass.compare`
  uses `Intl.Collator` when `col.accentedSort === true`.
- Modify: `cgrid/src/renderer/cellRenderers/registry.ts` —
  `headerCell` paints the faint icon when `unSortIcon && !sortDirection`.
- Modify: `cgrid/src/theming/tokens.css` — `--cg-unsort-icon-color`.
- Update: `docs/catalog/FEATURE_MATRIX.md` — Area 07 flips
  (~25 of 28 rows per master plan).
- Update: this worklog — append `## Shipped` list + `## Cycle 8 status: COMPLETE`.
- Update: master plan's Cycle 8 section status line.

**Steps:**

- [ ] **Step 1:** Implement `accentedSort` (one-line in
      `compare()`).
- [ ] **Step 2:** Implement `unSortIcon` (paint a faint chevron-up-down
      icon when set).
- [ ] **Step 3:** Tests: `accentedSort.test.ts` (4 strings with
      diacritics order correctly).
- [ ] **Step 4:** Typecheck + tests + E2E green.
- [ ] **Step 5:** FM flips — Area 07: `sortable`, `multiSortKey`,
      `initialSort`, `initialSortIndex`, `sortingOrder`,
      `comparator`, `postSortRows`, `accentedSort`, `unSortIcon`,
      `sortChanged` event, multi-column-sort behavior row,
      `getSortModel`/`setSortModel` API rows.
- [ ] **Step 6:** Append `Shipped` + `Cycle 8 status: COMPLETE`
      sections to this worklog.
- [ ] **Step 7:** Commit + push + PR.

**Commit message:**

```
feat(cgrid): accentedSort + unSortIcon + Cycle 8 exit ritual

accentedSort uses Intl.Collator for diacritic-aware string sort
ordering. unSortIcon paints a faint chevron-up-down on sortable
columns that aren't currently sorted.

Cycle 8 exit ritual: flips ~25 Area 07 rows to ✅ in FM, populates
the Cycle 8 worklog's Shipped + Status sections.

Cycle 8 / Task 5 + exit.
```

**Next session prompt** (final session of this cycle):

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md
"Cycle 9 — Range selection + fill handle" and author the Cycle 9
worklog at docs/superpowers/plans/<YYYY-MM-DD>-canvasgrid-cycle-09-range-selection.md
following the same shape this worklog uses. Don't execute Cycle 9
tasks yet; just write the worklog.
```

---

## Shipped

_(Filled in at cycle exit — Task 5's exit ritual.)_

---

## Cycle 8 status

_(Filled in at cycle exit — Task 5's exit ritual. Replace this line
with `## Cycle 8 status: COMPLETE` + the 5-task closing checklist.)_
