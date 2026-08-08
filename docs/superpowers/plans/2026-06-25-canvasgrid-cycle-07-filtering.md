# Canvasgrid Cycle 7 — Filtering Completeness — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to execute this worklog task-by-task.
> Each task below is designed to fit in a single, isolated Claude Code session.
> Run one task per session, verify, commit, then START A NEW SESSION using the
> "Next session prompt" at the end of the task. Do NOT chain multiple tasks in
> one session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full ag-grid filter UX — floating filter row beneath the
header, popup-based per-column filters for text / number / date with the
complete operator surface (`contains` / `equals` / `startsWith` / `endsWith` /
`notContains` / `notEqual` / `lt` / `lte` / `gt` / `gte` / `between` /
`inRange` / `blank` / `notBlank`), multi-condition AND/OR within a single
filter, a cross-column quick filter (`quickFilterText`), an app-controlled
external filter (`isExternalFilterPresent` / `doesExternalFilterPass`), a
lightweight Set Filter with distinct-value checkboxes, and the full
`getFilterModel` / `setFilterModel` / `filterChanged` round-trip so apps
can persist and replay filter state.

**Architecture:** Filter evaluation stays on the worker (already in
`dataPipeline.ts FilterPass`); Cycle 7 widens `FilterModelEntry` to the
ag-grid-compatible discriminated-union shape (`{ filterType: 'text' |
'number' | 'date' | 'set', conditions?: [...], operator?: 'AND' | 'OR',
... }`) and routes evaluation through a per-type matcher table. The
floating filter row is a new `FloatingFilterSubgrid` slotted between the
leaf-header subgrid and the data subgrid; per-cell DOM inputs live in a
dedicated `FloatingFilterOverlay` (parallel to Cycle 5's `EditorOverlay` +
Cycle 6's `ColumnDrag` ghost) that follows horizontal scroll by re-pinning
the inputs on every `recomputeViewport`. Per-column filter popups mount
through the existing `PopupHost` (Cycle 5 / Task 9) anchored to the header
cell. Quick filter is a new worker pass (`QuickFilterPass`) that runs
before `FilterPass`; external filter ships candidate `rowIds` from worker
to main, executes the predicate on the main thread, and ships the surviving
ids back. Set filter adds a `DistinctValuesPass` that hashes column values
into a `Set` and ships the result on demand. None of this changes the
single-canvas paint model — every new pixel is either DOM-over-canvas
(floating filter inputs + popups) or worker-side state.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E),
single-canvas 2D paint, Web Worker data + measure pipeline, native
scrollbars, CSS-variable theming. No new runtime dependencies — date
parsing uses native `Date.parse`; popup positioning reuses Cycle 5's
`PopupHost`. Floating-filter + popup inputs are native HTML `<input>` +
`<select>` elements absolutely positioned in the editor layer (the canvas
cannot host IME / autocomplete / keyboard accessibility).

**References (READ FIRST when starting any task):**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan (Cycle 7 at line 248)
- `docs/superpowers/plans/2026-06-25-canvasgrid-cycle-06-column-ux.md` — Cycle 6 worklog (shape mirrored here; perf budget carried forward)
- `docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md` — Cycle 5 worklog (PopupHost + EditorOverlay precedent for popup-based filter UIs)
- `docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md` — Cycle 4 worklog (subgrid framework + runtimeOptions)
- `docs/catalog/08-filtering.md` — source of truth for filter options, operator sets, params shapes, model schema, events
- `docs/catalog/22-events.md` — `filterChanged` / `filterModified` / `filterOpened` payloads
- `docs/catalog/23-api.md` — `getFilterModel` / `setFilterModel` / `getColumnFilterModel` / `setColumnFilterModel` / `onFilterChanged` / `isAnyFilterPresent` / `isColumnFilterPresent`
- `docs/catalog/FEATURE_MATRIX.md` — Area 08 rows to flip to ✅ at cycle exit (~60 of 63 rows)
- Cgrid source: `cgrid/src/velocityGrid.ts`, `worker/{dataPipeline,protocol,worker,client}.ts`, `core/subgrid.ts`, `interaction/editors/popupHost.ts`, `interaction/editorOverlay.ts`, `types.ts`
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task**. Extends the constraints from Cycles 2 / 3 / 4 / 5 / 6.
New ones marked **NEW** for this cycle.

### Carried from Cycle 2 / 3 / 4 / 5 / 6
- **API parity, not API mimicry.** Field names mirror ag-grid verbatim
  (`floatingFilter`, `filter`, `filterParams`, `filterValueGetter`,
  `getQuickFilterText`, `quickFilterText`, `cacheQuickFilter`,
  `includeHiddenColumnsInQuickFilter`, `isExternalFilterPresent`,
  `doesExternalFilterPass`, `suppressFloatingFilterButton`,
  `caseSensitive`, `debounceMs`, `closeOnApply`). The `FilterModelEntry`
  discriminator follows ag-grid's exact shape (`{ filterType: 'text',
  type: 'contains', filter: 'POS' }`) so a model saved from
  ag-grid-community 35.x deserialises into canvasgrid 1:1. Top-level
  type names keep the `C` prefix (`CFilterModel`, `CFilterModelEntry`,
  `CFilterChangedEvent`).
- **No regressions in the public API.** Cycle 7 is purely additive on
  every existing surface. The Cycle 4 / 5 `FilterModelEntry` shape
  (`{ type: 'text' | 'number', op: 'contains' | ..., value: string |
  number, value2?: number }`) MUST continue to round-trip — Cycle 7 adds
  a backward-compatible alias in the worker matcher that maps the old
  shape to the new shape so apps using the existing API don't break.
- **TypeScript strict mode.** Every `cgrid/src/**/*.ts` compiles clean
  under `npm run --workspace=cgrid typecheck` at the end of every task.
- **`alpha: false` canvas context, single-canvas rendering, DPR-aware
  paint, no per-cell `strokeRect`** — unchanged.
- **Web Worker stays the data + filter + measure layer.** Quick filter,
  set-filter distinct values, and the standard FilterPass all execute on
  the worker. External filter is the one exception — the predicate runs
  on the main thread because it's app-provided code that may close over
  React / Vue refs; the worker ships candidate rowIds, main thread
  filters, ships survivors back.
- **Native browser scrollbars** — unchanged. FloatingFilterSubgrid
  participates in the scrollbar gutter math the way HeaderSubgrid does.
- **Vitest unit + Playwright E2E green at end of every task.** Floating
  filters, each per-type popup, multi-condition, quick filter, external
  filter, set filter — each gets at least one E2E in
  `apps/cgrid-positions/e2e/cycle7-*.spec.ts`. E2E required for UI
  features — unit tests alone do not gate task completion (per
  `feedback_e2e_for_ui.md`).
- **Conventional commits.** Each task = one or more focused commits,
  body footer `Cycle 7 / Task N.`.
- **Documentation as you go.** Each public API or type added gets (a) a
  TSDoc block on the symbol, (b) the matching FM row flipped to ✅ in
  `docs/catalog/FEATURE_MATRIX.md`, and (c) a one-line entry in this
  worklog's "Shipped" list at cycle exit.
- **Demo never breaks.** `apps/cgrid-positions` runs after every task.
  Demo wiring lands in the same commit as the feature.

### NEW for this cycle
- **Filter evaluation is one worker round-trip per `setFilterModel`
  call.** No matter how many columns the model touches, the worker runs
  exactly ONE `FilterPass.apply()` and ships ONE `{visibleCount}` reply.
  Per-condition evaluation short-circuits on the first failing
  condition. Verified by an invariant test that counts worker postMessage
  calls during a multi-column `setFilterModel`.
- **Floating filter inputs are DOM, positioned by main, layout-driven.**
  Per Cycle 4's constraint ("no per-cell DOM in the data area"), the
  canvas renderer cannot host typeable inputs. Floating filters land
  in a dedicated overlay layer (`FloatingFilterOverlay`) that mounts a
  pool of `<input>` / `<select>` elements — one per visible
  non-suppressed column — and re-positions them on every
  `recomputeViewport` so they track horizontal scroll, column drags,
  resizes, hide/show. Inputs outside the visible body slot become
  `display: none` (not destroyed) so user focus + IME state survives a
  scroll-out / scroll-in cycle.
- **Filter popups are mounted through `PopupHost`.** The Cycle 5 / Task 9
  popup framework already positions DOM nodes relative to a cell rect +
  viewport bounds; per-column filter popups (text / number / date /
  set / multi-condition) reuse it verbatim, anchored to the header cell
  (not a body cell). Only one popup may be open at a time —
  `hideColumnFilter()` closes the active popup.
- **Quick filter is a separate worker pass that runs BEFORE FilterPass.**
  `QuickFilterPass` evaluates `quickFilterText` against each row's
  aggregate-text (the per-column `getQuickFilterText` return, or
  `String(value)` fallback, joined with `\n`). Aggregate text is
  cached per rowId when `cacheQuickFilter: true` so a hot
  `setGridOption('quickFilterText', x)` rebuild reads from the cache.
  Terms are whitespace-split (overridable via `quickFilterParser`); a
  row passes if every term is `includes`-matched against the aggregate
  (case-insensitive by default; overridable via `quickFilterMatcher`).
- **External filter runs on main, in a single batched callback per
  `setFilterModel` call.** Worker ships the candidate rowIds (the
  post-column-filter, post-quick-filter survivors) to main; main runs
  `doesExternalFilterPass` for each row and ships the surviving rowIds
  back; worker treats the result as the final visible set. No per-row
  worker round-trip — one request, one reply, with the rowId list as
  the payload. When `isExternalFilterPresent()` returns false, the
  round-trip is skipped entirely.
- **Set filter values come from a worker `DistinctValuesPass`.** Opening
  a set-filter popup fires `getDistinctValues(colId)` which runs a
  one-pass hash over `store.rows()`; result caches until the next
  transaction landed for that column. Caches are invalidated by the
  same `applyTransaction` hook the existing FilterPass uses.
- **Performance gates (Cycle 7 specific).**
  - `setFilterModel` on a 5-column model over 20,000 rows completes the
    worker round-trip in < 30 ms p95 (matches the Cycle 5 budget for a
    `setRowData` on the same size).
  - Floating-filter overlay re-pinning during horizontal scroll: zero
    layout reads on the scroll path (use cached column positions); per
    input the only DOM write is `transform: translateX(...)` (cheaper
    than `left`).
  - Quick-filter pass over 20,000 rows × 17 columns: < 50 ms p95 with
    `cacheQuickFilter: true`; < 200 ms p95 without it.
  - Set-filter `getDistinctValues` for one column × 20,000 rows: < 20 ms
    p95.
  - Filter popup open/close round-trip: < 16 ms (one frame).
- **Allocation discipline in hot paths.** `QuickFilterPass` reuses a
  single `String[]` term array per call. `FilterPass.apply()` walks the
  store with a single shared `for...of` and pre-resolves
  `colIndex.get(colId)` outside the inner loop. Floating-filter overlay
  pre-allocates an input pool sized to `columnOrder.length` and reuses
  it across scrolls.

---

## Performance Budget (Cycle 7 row in the master Budget table)

| Metric | Target | Why |
|---|---|---|
| `setFilterModel` (5-col model, 20k rows) | < 30 ms p95 worker round-trip | One-shot user action; matches Cycle 5 setRowData budget |
| `quickFilterText` apply (20k rows × 17 cols, cacheQuickFilter on) | < 50 ms p95 | Hot path during type-as-you-search |
| `quickFilterText` apply (cacheQuickFilter off) | < 200 ms p95 | Cold path; documents the cost of skipping the cache |
| `getDistinctValues` (1 col, 20k rows) | < 20 ms p95 | Set-filter popup open must feel instant |
| Floating-filter overlay re-pin (per scroll frame) | < 1 ms; zero layout reads | 120fps scroll target preserved |
| Filter popup open/close | < 16 ms | One-frame budget; user-perceived as instant |
| `VirtualList` scroll-slice recompute (50k items, 24px rows) | < 1 ms per scroll frame; zero `getBoundingClientRect` reads on the scroll path | Set filter + future column chooser must scroll smoothly at 50k+ entries |
| Set filter open with 10k distinct values | < 30 ms (worker `getDistinctValues` + first VirtualList window mount) | Set-filter open must feel as instant as any other filter popup |

---

## Task overview

| # | Task | Primary user-visible win | Files touched |
|---|---|---|---|
| 1 | `FloatingFilterSubgrid` + `FloatingFilterOverlay` + `floatingFilter` opt-in | A second header row with per-column text inputs that filter as you type | `core/subgrid.ts`, `interaction/floatingFilterOverlay.ts` (new), `velocityGrid.ts`, `types.ts`, demo, tests |
| 2 | `CFilterModelEntry` v2 shape + extended `FilterPass` operators (`contains` / `equals` / `notContains` / `notEqual` / `startsWith` / `endsWith` / `blank` / `notBlank` for text; `eq` / `ne` / `gt` / `gte` / `lt` / `lte` / `between` / `blank` / `notBlank` for number) + back-compat shim for the Cycle 4 / 5 shape | Floating-filter typing produces accurate matches across every operator | `worker/dataPipeline.ts`, `types.ts`, tests |
| 3 | Number-filter popup + `agNumberColumnFilter` parity (range + operator dropdown + Apply / Clear / Reset buttons) | Click the floating-filter expand button on a number column to open a full operator UI | `interaction/filters/numberFilter.ts` (new), `interaction/filters/filterPopupHost.ts` (new), `velocityGrid.ts`, `types.ts`, demo, tests |
| 4 | Date-filter popup + `inRange` operator + ISO-string storage on the worker | Date columns get the same operator UI as numbers, plus an `inRange` two-date selector | `interaction/filters/dateFilter.ts` (new), `worker/dataPipeline.ts`, `types.ts`, demo, tests |
| 5 | Text-filter popup (full operator set + `caseSensitive` + `textMatcher` / `textFormatter` / `trimInput` params) | Text columns get the full ag-grid operator surface in a popup | `interaction/filters/textFilter.ts` (new), `worker/dataPipeline.ts`, `types.ts`, demo, tests |
| 6 | Multi-condition filter UI (up to 2 conditions, `AND` / `OR` join, `maxNumConditions` / `numAlwaysVisibleConditions` / `defaultJoinOperator` params, `closeOnApply`) | One column can now express `contains "POS" AND startsWith "POS-1"` in a single popup | `interaction/filters/multiCondition.ts` (new), `worker/dataPipeline.ts`, `types.ts`, demo, tests |
| 7 | `quickFilterText` + `QuickFilterPass` + `cacheQuickFilter` + `includeHiddenColumnsInQuickFilter` + `quickFilterParser` + `quickFilterMatcher` + `getQuickFilterText` per-column override | Single text input above the grid filters every row across every column | `worker/dataPipeline.ts` (`QuickFilterPass`), `worker/worker.ts`, `worker/client.ts`, `worker/protocol.ts`, `velocityGrid.ts`, `types.ts`, demo, tests |
| 8 | External filter (`isExternalFilterPresent` + `doesExternalFilterPass` + `alwaysPassFilter`) + the rowIds round-trip protocol | App provides a predicate; grid runs it on main and stitches the survivors back | `worker/protocol.ts`, `worker/worker.ts`, `worker/client.ts`, `velocityGrid.ts`, `types.ts`, demo, tests |
| 9 | `VirtualList<T>` primitive + virtualised Set Filter + `DistinctValuesPass` + per-column filter API (`getColumnFilterModel` / `setColumnFilterModel` / `isAnyFilterPresent` / `isColumnFilterPresent` / `destroyFilter`) + `filterChanged` / `filterModified` / `filterOpened` events + Cycle 7 exit ritual | Per-column distinct-value checkboxes scaling to 50k+ entries via a reusable VirtualList primitive; full state round-trip; FM reflects every Area-08 row Cycle 7 ships | `interaction/ui/virtualList.ts` (new), `interaction/filters/setFilter.ts` (new), `worker/dataPipeline.ts` (`DistinctValuesPass`), `worker/worker.ts`, `worker/client.ts`, `worker/protocol.ts`, `velocityGrid.ts`, `types.ts`, `docs/catalog/FEATURE_MATRIX.md`, this worklog |

---

## Task 1 — `FloatingFilterSubgrid` + `FloatingFilterOverlay` + `floatingFilter` opt-in

**Goal:** Stand up the floating-filter row. When `floatingFilter: true` on
`VelocityGridOptions` (grid-wide default) or per-column `CColDef.floatingFilter:
true` is set, a second header row appears between the leaf header and the
data subgrid. Each column in that row contains a DOM `<input>` (text /
number) that the user can type into; typing fires
`setColumnFilterModel(colId, { filterType: 'text', type: 'contains',
filter: <value> })` after a 500ms debounce (per the catalog default).
Inputs follow horizontal scroll by re-pinning on every
`recomputeViewport` (the same hook Cycle 6 / Task 8's
`virtualColumnsChanged` plugs into). Hidden / pinned-right / suppressed
columns either drop the input entirely (hidden) or anchor it to the
pinned pane (pinned-right).

**Why this is Task 1:** The floating filter row is the canonical
entry-point to every per-column filter UI. Every later task (popups,
multi-condition, set filter) anchors its expand-button to the floating
filter cell. Landing the subgrid + overlay first means Tasks 3-6 + 9
can wire their popup `mount(host, anchor)` calls to a real anchor
without scaffolding it themselves.

**Read first:**
- `docs/catalog/08-filtering.md` — "Configuration surface — ColDef —
  per-column filter" table (`floatingFilter` row line 62);
  "Floating filters" paragraph in Behaviors (line 186)
- `cgrid/src/core/subgrid.ts` — `Subgrid` interface; `HeaderSubgrid`
  (lines 40-59) is the closest precedent; the new subgrid mirrors it
  but reports its own `type: 'floatingFilter'`
- `cgrid/src/velocityGrid.ts:989-1013` — `rebuildSubgridStack`; the new subgrid
  slots between `HeaderSubgrid` and `DataSubgrid`
- `cgrid/src/interaction/editorOverlay.ts` — the precedent for a DOM
  overlay layer that mounts inputs over the canvas; the floating-filter
  overlay is the same pattern but pool-managed (Cycle 5 / Task 5's
  Excel-style editing already mounts a permanent input — review for
  the input pool pattern)
- `cgrid/src/core/viewport.ts` — `ViewportColumn` carries `left` /
  `right` / `width` / `pinned`; the overlay reads these to position
  each input

**Files:**
- Create: `cgrid/src/core/floatingFilterSubgrid.ts`
- Create: `cgrid/src/interaction/floatingFilterOverlay.ts`
- Modify: `cgrid/src/core/subgrid.ts` (extend `SubgridType` union to
  include `'floatingFilter'`; export the new subgrid type alias)
- Modify: `cgrid/src/velocityGrid.ts` (instantiate the new subgrid in
  `rebuildSubgridStack` when `options.floatingFilter` is true OR any
  column resolves to `floatingFilter: true`; instantiate the overlay
  alongside `editor`; hook `recomputeViewport` to call
  `overlay.repositionAll(this.viewport)`)
- Modify: `cgrid/src/types.ts` (`VelocityGridOptions.floatingFilter?: boolean`,
  `CColDef.floatingFilter?: boolean`)
- Modify: `cgrid/src/core/propertyChain.ts` (resolve `floatingFilter`
  onto `ResolvedColDef`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (set
  `defaultColDef: { ..., floatingFilter: true }` so the demo shows the
  row)
- Create: `cgrid/tests/floatingFilterSubgrid.test.ts`
- Create: `cgrid/tests/floatingFilterOverlay.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle7-floatingFilter.spec.ts`

**Interfaces produced (Tasks 3-6 + 9 consume):**

```ts
// cgrid/src/core/floatingFilterSubgrid.ts

import type { Subgrid, SubgridCell } from './subgrid';
import type { ResolvedColDef } from './propertyChain';

/** A second header row, slotted between the leaf `HeaderSubgrid` and the
 *  `DataSubgrid`. Carries no value paint — the actual interactive cells
 *  are DOM inputs mounted by `FloatingFilterOverlay`. Canvas paint for
 *  this row is just the row background + bottom border; `getCell` returns
 *  null so the painter skips text. Cycle 7 / Task 1. */
export class FloatingFilterSubgrid implements Subgrid {
  readonly type: 'floatingFilter';
  readonly isHeader: false;
  readonly isData: false;
  readonly isTotals: false;
  readonly isFooter: false;
  constructor(
    private getHeight: () => number,
    private getEnabled: () => boolean,
  );
  getRowCount(): number;       // 1 when enabled, 0 when disabled
  getRowHeight(local: number): number;
  getCell(local: number, colId: string): SubgridCell | null; // always null
}

// cgrid/src/interaction/floatingFilterOverlay.ts

import type { ViewportState } from '../core/viewport';
import type { CFilterModelEntry } from '../types';

export interface FloatingFilterOverlayDeps {
  /** Returns the current filter model entry for `colId`, or null when
   *  no filter is active. Drives the input's `.value` on initial mount
   *  and on `setFilterModel` round-trips. */
  getColumnFilterModel: (colId: string) => CFilterModelEntry | null;
  /** Apply a filter mutation — overlay calls this after the typing
   *  debounce. Passing `null` clears the column's filter. */
  setColumnFilterModel: (colId: string, model: CFilterModelEntry | null) => void;
  /** Returns the resolved col-def for `colId`; overlay reads
   *  `floatingFilter`, `filter`, `suppressFloatingFilterButton`,
   *  `floatingFilterDebounceMs` (per-cycle-7 alias for `debounceMs`). */
  getColDef: (colId: string) => { floatingFilter?: boolean; filter?: 'text' | 'number' | 'date' | 'set'; suppressFloatingFilterButton?: boolean } | undefined;
  /** Opens the column's full filter popup. Wired by Task 3-6 + 9. */
  openColumnFilter: (colId: string) => void;
  /** Y-coordinate (in container CSS px) of the floating-filter row's
   *  top edge. Overlay positions each input at this Y. */
  getRowTop: () => number;
  /** Pixel height of the floating-filter row. */
  getRowHeight: () => number;
}

export class FloatingFilterOverlay {
  constructor(host: HTMLElement, deps: FloatingFilterOverlayDeps);
  /** Reposition all mounted inputs against the new viewport. Called from
   *  `cgrid.recomputeViewport` AND on every `columnVisible` /
   *  `columnPinned` / `columnMoved` event. Pure DOM `transform` writes;
   *  zero layout reads. Cycle 7 / Task 1. */
  repositionAll(viewport: ViewportState): void;
  /** Apply a fresh filter-model entry to the input for `colId` (e.g.
   *  after `setColumnFilterModel` is called from the popup). When `null`,
   *  the input value is cleared. */
  syncInputValue(colId: string, model: CFilterModelEntry | null): void;
  /** Tear down — removes every input from the DOM. */
  destroy(): void;
}

// cgrid/src/types.ts additions

export interface VelocityGridOptions<TRow = any> {
  // … existing fields …
  /** When true, every column with a default-resolved filter gets a
   *  floating filter input row beneath the leaf header. Per-column
   *  `CColDef.floatingFilter` overrides this. */
  floatingFilter?: boolean;
}

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  /** Per-column override of `VelocityGridOptions.floatingFilter`. When set on
   *  a column, the column joins the floating-filter row regardless of
   *  the grid-wide default. */
  floatingFilter?: boolean;
  /** When true, hides the expand button that opens the full filter
   *  popup. The floating input still types-to-filter, just without
   *  the popup entry-point. Cycle 7 / Task 1. */
  suppressFloatingFilterButton?: boolean;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `floatingFilterSubgrid.test.ts`** —
      assertions:
      - `getRowCount()` returns 1 when enabled, 0 when disabled
      - `getRowHeight(0)` returns the configured pixel height
      - `getCell(0, 'anyCol')` always returns null (DOM owns the cell)
      - `type === 'floatingFilter'`; `isHeader === false`;
        `isData === false`

```ts
import { describe, it, expect } from 'vitest';
import { FloatingFilterSubgrid } from '../src/core/floatingFilterSubgrid';

describe('FloatingFilterSubgrid', () => {
  it('reports 1 row when enabled, 0 when disabled', () => {
    let enabled = true;
    const sub = new FloatingFilterSubgrid(() => 28, () => enabled);
    expect(sub.getRowCount()).toBe(1);
    enabled = false;
    expect(sub.getRowCount()).toBe(0);
  });

  it('returns the configured height for row 0', () => {
    const sub = new FloatingFilterSubgrid(() => 28, () => true);
    expect(sub.getRowHeight(0)).toBe(28);
  });

  it('returns null for every getCell (DOM owns the cell)', () => {
    const sub = new FloatingFilterSubgrid(() => 28, () => true);
    expect(sub.getCell(0, 'anyCol')).toBeNull();
  });

  it('declares type: floatingFilter and isHeader/isData false', () => {
    const sub = new FloatingFilterSubgrid(() => 28, () => true);
    expect(sub.type).toBe('floatingFilter');
    expect(sub.isHeader).toBe(false);
    expect(sub.isData).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — expect failures (module missing).

```bash
npm test --workspace=cgrid -- floatingFilterSubgrid
```

- [ ] **Step 3: Extend `SubgridType` in `core/subgrid.ts`** —
      append `'floatingFilter'` to the union; add `isFloatingFilter:
      boolean` to the `Subgrid` interface (default false on
      `HeaderSubgrid` / `HeaderGroupSubgrid` / `DataSubgrid`; true on the
      new class). This keeps `if (subgrid.isFloatingFilter)` shorthand
      checks symmetric with the existing `isHeader` / `isData` checks.

- [ ] **Step 4: Implement `core/floatingFilterSubgrid.ts`** — < 50 LOC.

```ts
import type { Subgrid, SubgridCell, SubgridType } from './subgrid';

export class FloatingFilterSubgrid implements Subgrid {
  readonly type: SubgridType = 'floatingFilter';
  readonly isHeader = false;
  readonly isData = false;
  readonly isTotals = false;
  readonly isFooter = false;
  readonly isFloatingFilter = true;

  constructor(
    private getHeight: () => number,
    private getEnabled: () => boolean,
  ) {}

  getRowCount(): number { return this.getEnabled() ? 1 : 0; }
  getRowHeight(_local: number): number { return this.getHeight(); }
  getCell(_local: number, _colId: string): SubgridCell | null { return null; }
}
```

- [ ] **Step 5: Verify** — `npm test --workspace=cgrid -- floatingFilterSubgrid` green.

- [ ] **Step 6: Write the failing `floatingFilterOverlay.test.ts`** —
      mocks `FloatingFilterOverlayDeps`; constructs a fake
      `ViewportState` with two visible columns + one pinned-right
      column. Assertions:
      - `repositionAll` creates one `<input>` per visible column the
        first time it's called
      - The inputs' `transform: translateX(...)` matches each column's
        `left` (in CSS px)
      - A column with `floatingFilter: false` produces NO input
      - Calling `repositionAll` a second time REUSES the same input
        elements (no destroy/create churn) — assert by
        `WeakSet`-tracking the element identity
      - `syncInputValue('a', { filterType: 'text', type: 'contains',
        filter: 'POS' })` sets the input's `.value` to `'POS'`
      - `syncInputValue('a', null)` clears the input's `.value`

- [ ] **Step 7: Implement `interaction/floatingFilterOverlay.ts`** —
      pool-managed map `<colId, HTMLInputElement>`; on each
      `repositionAll`:
      1. Walk `viewport.visibleColumns`, skip columns where
         `getColDef(colId)?.floatingFilter === false`
      2. For each kept column, get-or-create the input
         (`document.createElement('input')`, append to `host`, attach
         `addEventListener('input', debounced)`)
      3. Set `style.transform = translateX(${col.left}px) translateY(${rowTop}px)`
      4. Set `style.width = ${col.width}px`, `style.height = ${rowHeight}px`
      5. Set `style.display = '' ` (visible)
      6. For any pooled input whose colId is no longer in
         visibleColumns, set `style.display = 'none'` (do not
         remove — keep the user's typing state alive across scroll-out
         / scroll-in)

      Debounce default: 500ms (the catalog `debounceMs` default for
      text/number filters). Calls
      `deps.setColumnFilterModel(colId, { filterType: <resolved>, type:
      'contains', filter: input.value })` after the debounce fires.

      `host` is the same `editorContainer` `EditorOverlay` mounts to —
      passed in by `velocityGrid.ts` (see Step 11).

- [ ] **Step 8: Verify** — `npm test --workspace=cgrid -- floatingFilterOverlay` green.

- [ ] **Step 9: Add `floatingFilter` + `suppressFloatingFilterButton`
      to `VelocityGridOptions` / `CColDef`** in `types.ts`. Resolve
      `floatingFilter` in `propertyChain.ts` — column-level wins over
      grid-level; default to `false`.

- [ ] **Step 10: Wire the subgrid into `rebuildSubgridStack`** in
      `velocityGrid.ts`. The order is `HeaderGroupSubgrid* → HeaderSubgrid →
      FloatingFilterSubgrid → DataSubgrid`. Enable when the grid-wide
      option OR any column resolves to `floatingFilter: true`.

```ts
const anyFloating = this.columnOrder.some((c) => c.floatingFilter)
  || this.options.floatingFilter === true;
if (anyFloating) {
  stack.push(new FloatingFilterSubgrid(
    () => this.options.floatingFilterHeight ?? 28,
    () => anyFloating,
  ));
}
```

- [ ] **Step 11: Wire the overlay alongside `EditorOverlay`** —
      instantiate after the editor, share the `editorContainer`. Hook
      `recomputeViewport` to call `overlay.repositionAll(this.viewport)`
      after `this.syncSizer()` (so the inputs only re-pin once per
      layout pass — single layout invariant). Also call from the
      `columnVisible` / `columnPinned` / `columnMoved` event handlers
      (the events already fire after the relayout, so call inline
      after each emit).

      The overlay needs the floating-filter row's TOP coordinate —
      derive it from the subgrid stack: walk the stack until the
      floating-filter subgrid, accumulate its `top`. Cache on
      `cgrid.viewport` as `floatingFilterRowTop?: number` (extend the
      `ViewportState` interface in `core/viewport.ts`).

- [ ] **Step 12: Wire the demo** — `defaultColDef: { ...,
      floatingFilter: true }` in `apps/cgrid-positions/src/positionsGrid.ts`.

- [ ] **Step 13: Write the E2E**
      `apps/cgrid-positions/e2e/cycle7-floatingFilter.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Cycle 7 / Task 1 — floating-filter row', () => {
  test('floating-filter inputs appear below the header for every column', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__cgridReady === true);
    const inputCount = await page.evaluate(() =>
      document.querySelectorAll('input[data-vg-floating-filter]').length);
    expect(inputCount).toBeGreaterThan(5);
  });

  test('typing in a floating-filter input filters the visible rows', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__cgridReady === true);
    const before = await page.evaluate(() => (window as any).__cgrid.getDisplayedRowCount());
    const sel = 'input[data-vg-floating-filter][data-vg-col-id="positionId"]';
    await page.fill(sel, 'POS-1');
    // Default debounce is 500ms — wait it out then assert.
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => (window as any).__cgrid.getDisplayedRowCount());
    expect(after).toBeLessThan(before);
  });

  test('inputs re-position when the user scrolls horizontally', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__cgridReady === true);
    const before = await page.evaluate(() => {
      const el = document.querySelector('input[data-vg-floating-filter][data-vg-col-id="positionId"]') as HTMLElement;
      return el?.style.transform ?? '';
    });
    await page.evaluate(() => (window as any).__cgrid.getScroller().scrollLeft = 200);
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => {
      const el = document.querySelector('input[data-vg-floating-filter][data-vg-col-id="positionId"]') as HTMLElement;
      return el?.style.transform ?? '';
    });
    expect(after).not.toBe(before);
  });
});
```

      For the E2E to read `__cgrid.getScroller()`, expose a debug
      accessor on `VelocityGridApi` (returns the scroller HTMLElement). 4-line
      addition to `velocityGrid.ts`.

- [ ] **Step 14: Run the full suite**

```bash
npm test --workspace=cgrid
npm --workspace=cgrid run typecheck
npm --workspace=cgrid run build
cd apps/cgrid-positions && npx playwright test --reporter=list cycle7-floatingFilter
```

- [ ] **Step 15: Commit**

```bash
git add cgrid/src/core/floatingFilterSubgrid.ts \
        cgrid/src/core/subgrid.ts \
        cgrid/src/core/propertyChain.ts \
        cgrid/src/interaction/floatingFilterOverlay.ts \
        cgrid/src/velocityGrid.ts \
        cgrid/src/types.ts \
        cgrid/src/core/viewport.ts \
        cgrid/tests/floatingFilterSubgrid.test.ts \
        cgrid/tests/floatingFilterOverlay.test.ts \
        apps/cgrid-positions/src/positionsGrid.ts \
        apps/cgrid-positions/e2e/cycle7-floatingFilter.spec.ts
git commit -m "$(cat <<'EOF'
feat(cgrid): FloatingFilterSubgrid + FloatingFilterOverlay + floatingFilter opt-in

Lands the floating-filter row between the leaf header and the data
subgrid. FloatingFilterSubgrid declares a new SubgridType
('floatingFilter') and contributes a single non-paint row whose
height comes from `floatingFilterHeight` (defaults to 28). The actual
inputs are DOM `<input>` elements pool-managed by
FloatingFilterOverlay; they re-pin via `transform: translateX` on
every recomputeViewport so horizontal scroll has zero layout reads.
Pooling preserves IME / autocomplete state across scroll-out /
scroll-in cycles. Typing fires `setColumnFilterModel` after a 500ms
debounce.

Opt-in via grid-wide `VelocityGridOptions.floatingFilter: true` or per-column
`CColDef.floatingFilter: true`. `suppressFloatingFilterButton` hides
the popup-expand control on the input (popup itself lands in Tasks
3-6 + 9).

Cycle 7 / Task 1.
EOF
)"
```

**Acceptance criteria:**
- [ ] `FloatingFilterSubgrid` exists; declared `type === 'floatingFilter'`;
      `getCell` always returns null.
- [ ] `FloatingFilterOverlay` mounts one `<input>` per visible
      floating-enabled column; reuses pooled elements across
      `repositionAll` calls (no detach/reattach churn).
- [ ] Horizontal scroll re-pins inputs via `transform`, not `left`
      (verified by unit test reading the style).
- [ ] `VelocityGridOptions.floatingFilter` + `CColDef.floatingFilter` +
      `CColDef.suppressFloatingFilterButton` typed + resolved.
- [ ] Demo's floating-filter row visible; typing in `positionId` input
      reduces the visible row count (E2E).
- [ ] Unit (≥ 8 assertions across both test files) + E2E (3 scenarios)
      + typecheck + build green.

**Next session prompt** (paste into a fresh Claude Code session after Task 1 is committed):

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 2 (CFilterModelEntry v2 + extended FilterPass operators
+ back-compat shim). Confirm Task 1 is committed (git log -1 should show
"FloatingFilterSubgrid + FloatingFilterOverlay"). Read
docs/catalog/08-filtering.md "Behaviors / interactions" section
(text-filter + number-filter operator lists, lines 162-170) and the
`getFilterModel` / `setFilterModel` round-trip paragraph (line 208).
Follow the per-task workflow.
```

---

## Task 2 — `CFilterModelEntry` v2 shape + extended `FilterPass` operators + back-compat shim

**Goal:** Widen `FilterModelEntry` from the Cycle 4 / 5 shape (`{ type:
'text' | 'number', op, value, value2? }`) to the ag-grid-compatible
discriminated union (`{ filterType: 'text', type: 'contains' | 'equals' |
'notContains' | 'notEqual' | 'startsWith' | 'endsWith' | 'blank' |
'notBlank', filter: string }` for text; `{ filterType: 'number', type:
'equals' | 'notEqual' | 'lessThan' | 'lessThanOrEqual' | 'greaterThan' |
'greaterThanOrEqual' | 'inRange' | 'blank' | 'notBlank', filter: number,
filterTo?: number }` for number) and extend the worker's `FilterPass.apply`
matcher to evaluate every operator. The old shape continues to
round-trip via a back-compat alias: when the worker sees `{ type: 'text',
op: 'contains', value: 'x' }` it transparently rewrites to the v2 shape
before evaluation, so apps using the existing `setFilterModel` API don't
break.

**Why this is Task 2:** Tasks 3-6 + 9 all need the v2 model shape — number
popup writes `inRange` entries, multi-condition writes `conditions: [...]`
arrays, set filter writes `filterType: 'set'`. Landing the shape first
means every UI task can write directly into the canonical form.

**Read first:**
- `docs/catalog/08-filtering.md` — "Behaviors — Text filter / Number
  filter / Date filter filter options" paragraphs (lines 162-174);
  `getFilterModel` / `setFilterModel` round-trip paragraph (line 208)
- `cgrid/src/worker/dataPipeline.ts:279-334` — current `FilterPass` +
  `matches()`
- `cgrid/src/types.ts:557-560` — current `FilterModelEntry`

**Files:**
- Modify: `cgrid/src/types.ts` (widen `FilterModelEntry` to the v2
  discriminated union; keep `FilterModel = Record<string, ...>`;
  introduce `CFilterModelEntry` as a Cycle-7 alias to make the type
  name visible in TSDoc; preserve the Cycle 4 / 5 shape as
  `FilterModelEntryLegacy` for documentation)
- Modify: `cgrid/src/worker/dataPipeline.ts` (extend `matches()` for
  every operator; add a `normalizeEntry()` shim that maps the legacy
  shape to v2)
- Modify: `cgrid/src/velocityGrid.ts` (any internal callers of `setFilterModel`
  pass-through — no change needed if they already opaque-relay the
  model)
- Create: `cgrid/tests/filterModelV2.test.ts`
- Create: `cgrid/tests/filterPass.operators.test.ts` (per-operator
  evaluation tests)

**Interfaces produced (Tasks 3-9 consume):**

```ts
// cgrid/src/types.ts

export type CTextFilterOp =
  | 'contains' | 'notContains'
  | 'equals'   | 'notEqual'
  | 'startsWith' | 'endsWith'
  | 'blank' | 'notBlank';

export type CNumberFilterOp =
  | 'equals' | 'notEqual'
  | 'lessThan' | 'lessThanOrEqual'
  | 'greaterThan' | 'greaterThanOrEqual'
  | 'inRange'
  | 'blank' | 'notBlank';

export type CDateFilterOp = CNumberFilterOp; // same operator set; payload is ISO strings

export interface CTextFilterModel {
  filterType: 'text';
  type: CTextFilterOp;
  filter?: string;          // null for blank / notBlank
  /** When true, comparison is case-sensitive. Defaults to false. */
  caseSensitive?: boolean;
}

export interface CNumberFilterModel {
  filterType: 'number';
  type: CNumberFilterOp;
  filter?: number;
  /** Required when `type === 'inRange'`; the upper bound (inclusive). */
  filterTo?: number;
}

export interface CDateFilterModel {
  filterType: 'date';
  type: CDateFilterOp;
  /** ISO date string (YYYY-MM-DD or full timestamp). */
  filter?: string;
  filterTo?: string;
}

export interface CSetFilterModel {
  filterType: 'set';
  /** When non-empty, the row's value must `===` one of the listed
   *  values (after `String(value)` coercion). When empty, no row
   *  passes (matches ag-grid's "everything deselected" semantics). */
  values: string[];
}

/** Multi-condition filter (Cycle 7 / Task 6). Up to 2 conditions joined
 *  by AND / OR. */
export interface CMultiConditionFilterModel {
  filterType: 'multi';
  operator: 'AND' | 'OR';
  conditions: Array<CTextFilterModel | CNumberFilterModel | CDateFilterModel>;
}

export type CFilterModelEntry =
  | CTextFilterModel
  | CNumberFilterModel
  | CDateFilterModel
  | CSetFilterModel
  | CMultiConditionFilterModel;

export type CFilterModel = Record<string, CFilterModelEntry>;

/** Cycle 4 / 5 entry shape. Kept exported for back-compat documentation;
 *  the worker accepts it transparently via the `normalizeEntry` shim. */
export type FilterModelEntryLegacy =
  | { type: 'text'; op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { type: 'number'; op: 'eq' | 'gt' | 'lt' | 'between'; value: number; value2?: number };

/** Public type alias — the union accepted by `VelocityGridApi.setFilterModel`
 *  and returned by `VelocityGridApi.getFilterModel`. New code should write the
 *  v2 shape; the legacy shape is read-only for back-compat. */
export type FilterModelEntry = CFilterModelEntry | FilterModelEntryLegacy;
export type FilterModel = Record<string, FilterModelEntry>;
```

**Steps:**

- [ ] **Step 1: Write the failing `filterModelV2.test.ts`** — pure
      type / shape tests:
      - A `CTextFilterModel` with `type: 'contains'` + `filter: 'POS'`
        is assignable to `CFilterModelEntry`
      - A legacy `{ type: 'text', op: 'contains', value: 'POS' }` is
        assignable to `FilterModelEntry`
      - `normalizeEntry({ type: 'text', op: 'contains', value: 'POS' })`
        returns `{ filterType: 'text', type: 'contains', filter: 'POS' }`
      - `normalizeEntry({ type: 'number', op: 'between', value: 1,
        value2: 10 })` returns `{ filterType: 'number', type: 'inRange',
        filter: 1, filterTo: 10 }`
      - An already-v2 entry passes through `normalizeEntry` unchanged

- [ ] **Step 2: Write the failing `filterPass.operators.test.ts`** —
      one assertion per operator (16 total: 8 text + 8 number). Use a
      fixture with 5 rows containing edge cases (blank, numeric edge,
      case-sensitive edge):

```ts
import { describe, it, expect } from 'vitest';
import { FilterPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

interface Row { id: string; name: string; price: number | null }
const rows: Row[] = [
  { id: '1', name: 'POS-100', price: 50 },
  { id: '2', name: 'pos-200', price: 75 },
  { id: '3', name: 'ABC-300', price: 100 },
  { id: '4', name: '',        price: 0   },
  { id: '5', name: 'XYZ-999', price: null as any },
];

function setup() {
  const store = new RowStore<Row>('id');
  store.setAll(rows);
  const cols: WorkerColumn[] = [
    { colId: 'name',  field: 'name',  type: 'text' },
    { colId: 'price', field: 'price', type: 'number' },
  ];
  return new FilterPass<Row>(store, cols);
}

describe('FilterPass — text operators', () => {
  it('contains', () => {
    const f = setup();
    f.setModel({ name: { filterType: 'text', type: 'contains', filter: 'POS' } });
    expect(f.apply().length).toBe(2); // POS-100 and pos-200 (case-insensitive default)
  });
  // … 7 more text operator tests …
});

describe('FilterPass — number operators', () => {
  it('equals', () => {
    const f = setup();
    f.setModel({ price: { filterType: 'number', type: 'equals', filter: 75 } });
    expect(f.apply()).toEqual(['2']);
  });
  it('inRange', () => {
    const f = setup();
    f.setModel({ price: { filterType: 'number', type: 'inRange', filter: 50, filterTo: 100 } });
    expect(new Set(f.apply())).toEqual(new Set(['1', '2', '3']));
  });
  // … 6 more …
});
```

- [ ] **Step 3: Run** — expect failures.

- [ ] **Step 4: Widen `FilterModelEntry` in `types.ts`** — paste the
      union above. Add TSDoc blocks for each model variant.

- [ ] **Step 5: Add `normalizeEntry` + extend `matches` in
      `dataPipeline.ts`.** `normalizeEntry` is a 30-line switch; the new
      matcher table is a per-operator function map:

```ts
function normalizeEntry(entry: FilterModelEntry): CFilterModelEntry {
  if ('filterType' in entry) return entry;
  if (entry.type === 'text') {
    const opMap: Record<string, CTextFilterOp> = {
      contains: 'contains', equals: 'equals', startsWith: 'startsWith',
    };
    return { filterType: 'text', type: opMap[entry.op], filter: entry.value };
  }
  const opMap: Record<string, CNumberFilterOp> = {
    eq: 'equals', gt: 'greaterThan', lt: 'lessThan', between: 'inRange',
  };
  const next: CNumberFilterModel = {
    filterType: 'number', type: opMap[entry.op] as CNumberFilterOp,
    filter: entry.value,
  };
  if (entry.op === 'between') next.filterTo = entry.value2;
  return next;
}
```

      Extend `matches(entry, raw)` to handle every operator (`blank` /
      `notBlank` short-circuit on `raw == null || String(raw) === ''`).
      Multi-condition + set + date matchers land in their own Tasks
      (4 / 6 / 9); this task adds the text + number operator set.

- [ ] **Step 6: Verify** — `npm test --workspace=cgrid -- filterModelV2 filterPass.operators` green.

- [ ] **Step 7: Run typecheck + build + the full test suite** to
      confirm no regressions in existing filter-using tests:

```bash
npm --workspace=cgrid run typecheck
npm --workspace=cgrid run build
npm test --workspace=cgrid
```

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cgrid): CFilterModelEntry v2 shape + extended FilterPass operators

Widens FilterModelEntry to the ag-grid-compatible discriminated union
({ filterType: 'text'|'number'|'date'|'set'|'multi', ... }) with the
full text operator set (contains/notContains/equals/notEqual/startsWith/
endsWith/blank/notBlank) and the full number operator set (equals/
notEqual/lessThan/lessThanOrEqual/greaterThan/greaterThanOrEqual/
inRange/blank/notBlank). FilterPass.matches gains a per-operator
matcher table; legacy { type, op, value } entries pass through
`normalizeEntry` which rewrites them to the v2 shape before evaluation
so existing setFilterModel callers don't break.

Cycle 7 / Task 2.
EOF
)"
```

**Acceptance criteria:**
- [ ] `CFilterModelEntry` discriminated union typed + exported.
- [ ] `FilterPass` evaluates all 16 text + number operators (≥ 16
      assertions across the operator-suite test).
- [ ] Legacy `{ type, op, value }` entries continue to round-trip
      through `setFilterModel` → `apply` → matches (verified by an
      assertion that includes a legacy entry alongside a v2 entry).
- [ ] Typecheck + build + full test suite green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 3 (Number-filter popup). Confirm Task 2 is committed.
Read docs/catalog/08-filtering.md "INumberFilterParams" + "Number filter
(agNumberColumnFilter) filter options" paragraphs (lines 97-103, 167-169)
and the "Filter buttons" paragraph (line 201). Follow the per-task
workflow.
```

---

## Task 3 — Number-filter popup + `agNumberColumnFilter` parity + reusable `filterPopupHost`

**Goal:** Click the expand button on a numeric column's floating-filter
input and a popup opens beneath the header, anchored via the existing
`PopupHost`. The popup carries: a `<select>` operator dropdown
(`equals` / `notEqual` / `lessThan` / `lessThanOrEqual` / `greaterThan` /
`greaterThanOrEqual` / `inRange` / `blank` / `notBlank`), a numeric
`<input>` for the primary `filter`, a conditionally-visible second
numeric `<input>` for `filterTo` (only when operator is `inRange`), and
the three buttons `Apply` / `Clear` / `Reset` (controlled by the
`buttons` filter param; defaults to `['apply', 'clear', 'reset']` for
this cycle). The popup writes the resolved `CNumberFilterModel` through
`setColumnFilterModel(colId, model)` on Apply. Clear empties the input
fields without removing the active filter. Reset empties + removes the
filter. `closeOnApply: true` closes the popup after Apply.

A new tiny utility `interaction/filters/filterPopupHost.ts` centralises
the open/close pattern so Tasks 4 / 5 / 6 / 9 don't reimplement it:
`openFilterPopup(colId, factory)` resolves the header-cell anchor,
constructs the popup GUI via `factory()`, mounts via `PopupHost`,
returns a `close()` handle.

**Why this is Task 3:** Number filters are the highest-value column
type for the demo's positions data (price, quantity, P&L). Number
filters also have the simplest UI of the three (no date picker, no
case-sensitivity toggle) — landing this first means Tasks 4 / 5 just
clone the pattern. The popup-open click handler also lights up the
floating-filter expand-button, completing Task 1's UI.

**Read first:**
- `docs/catalog/08-filtering.md` — `INumberFilterParams` (line 97);
  number-filter operator list (line 167); `IProvidedFilterParams.buttons`
  (line 72); `closeOnApply` (line 73); `debounceMs` (line 74)
- `cgrid/src/interaction/editors/popupHost.ts` — anchor + mount API
- `cgrid/src/interaction/floatingFilterOverlay.ts` (Task 1) —
  `openColumnFilter` hook; this task wires it to `openFilterPopup`

**Files:**
- Create: `cgrid/src/interaction/filters/filterPopupHost.ts`
- Create: `cgrid/src/interaction/filters/numberFilter.ts`
- Modify: `cgrid/src/velocityGrid.ts` (instantiate `FilterPopupHost`; wire
  `openColumnFilter(colId)` for number columns to `openFilterPopup(colId,
  () => new NumberFilterPopup(...))`; add `showColumnFilter` /
  `hideColumnFilter` to `VelocityGridApi`)
- Modify: `cgrid/src/types.ts` (add `CColDef.filterParams?:
  CFilterParams` with the cross-type shared shape; add `VelocityGridApi`
  signatures for `showColumnFilter` + `hideColumnFilter`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (mark `price` +
  `notionalAmount` + `pnl` columns `filter: 'number'`)
- Create: `cgrid/tests/numberFilter.test.ts`
- Create: `cgrid/tests/filterPopupHost.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle7-numberFilter.spec.ts`

**Interfaces produced (Tasks 4 / 5 / 6 / 9 consume):**

```ts
// cgrid/src/interaction/filters/filterPopupHost.ts

import type { PopupHost } from '../editors/popupHost';

export interface FilterPopupFactory {
  /** Returns the popup's GUI element. Called once per open. */
  buildGui(): HTMLElement;
  /** Called when the popup is closed (Apply / Cancel / Escape / outside
   *  click). Tear down listeners here. */
  destroy(): void;
}

export interface FilterPopupAnchor {
  cellBounds: { x: number; y: number; w: number; h: number };
  viewportBounds: { width: number; height: number };
}

export class FilterPopupHost {
  constructor(host: HTMLElement, popupHost: PopupHost);
  open(colId: string, anchor: FilterPopupAnchor, factory: FilterPopupFactory): void;
  close(): void;
  isOpen(): boolean;
  /** Returns the colId of the currently open popup, or null. Used by
   *  `VelocityGridApi.showColumnFilter` to deduplicate consecutive opens. */
  openColId(): string | null;
}

// cgrid/src/interaction/filters/numberFilter.ts

import type { CNumberFilterModel } from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';

export interface NumberFilterPopupDeps {
  initialModel: CNumberFilterModel | null;
  onApply: (model: CNumberFilterModel | null) => void;
  onClose: () => void;
  buttons?: Array<'apply' | 'clear' | 'reset' | 'cancel'>;
  closeOnApply?: boolean;
}

export class NumberFilterPopup implements FilterPopupFactory {
  constructor(deps: NumberFilterPopupDeps);
  buildGui(): HTMLElement;
  destroy(): void;
}

// cgrid/src/types.ts

export interface CFilterParams {
  buttons?: Array<'apply' | 'clear' | 'reset' | 'cancel'>;
  closeOnApply?: boolean;
  debounceMs?: number;
  readOnly?: boolean;
}

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  /** Per-column filter type. `true` means "use the default for the
   *  column's `cellDataType`" (text → text filter, number →
   *  number filter, date → date filter). String values pick a specific
   *  filter component name (Cycle 7: `'text'` / `'number'` / `'date'`
   *  / `'set'`). Cycle 7 / Task 3+. */
  filter?: true | 'text' | 'number' | 'date' | 'set';
  filterParams?: CFilterParams;
}

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  /** Open the filter popup for `colId`. No-op when the column has no
   *  resolved filter or when the popup is already open for that column.
   *  Cycle 7 / Task 3. */
  showColumnFilter(colId: string): void;
  /** Close any open filter popup. Cycle 7 / Task 3. */
  hideColumnFilter(): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `filterPopupHost.test.ts`** —
      assertions:
      - `open` mounts the GUI via the inner `PopupHost`
      - `close` unmounts and calls `factory.destroy()`
      - `isOpen()` returns true between open / close
      - Calling `open` while a popup is already open closes the
        previous one first (`destroy()` on the prior factory)

- [ ] **Step 2: Implement `filterPopupHost.ts`** — < 60 LOC.

- [ ] **Step 3: Write the failing `numberFilter.test.ts`** — DOM
      assertions in jsdom:
      - `buildGui()` returns an element with a `<select>` and one
        `<input type="number">`
      - Selecting `inRange` reveals a second `<input type="number">`
      - Typing `50` in the primary input and clicking Apply calls
        `onApply` with `{ filterType: 'number', type: 'equals', filter:
        50 }`
      - Clear empties both inputs but does NOT call `onApply`
      - Reset calls `onApply(null)` AND empties both inputs

- [ ] **Step 4: Implement `numberFilter.ts`** — keep < 200 LOC. Apply
      button reads operator + value(s), constructs the model, calls
      `onApply`. Reset calls `onApply(null)`. Operator change re-renders
      the second-input visibility.

- [ ] **Step 5: Wire `showColumnFilter` + `hideColumnFilter` in
      `velocityGrid.ts`** — resolve the column's filter type (`def.filter` or
      `def.cellDataType`-derived); for `'number'`, instantiate
      `NumberFilterPopup` and call `filterPopupHost.open(colId, anchor,
      popup)`. Anchor is the header cell's bounds (derive via the
      existing `getHeaderBoundsAt` from Cycle 6 / Task 1).

- [ ] **Step 6: Wire the floating-filter expand button** —
      `FloatingFilterOverlay.deps.openColumnFilter = (colId) =>
      cgrid.showColumnFilter(colId)`. The button is a child of the
      input wrapper from Task 1 — add it now to the overlay's
      input-mounting code (small follow-up to Task 1's overlay file).

- [ ] **Step 7: Wire the demo** — `apps/cgrid-positions/src/positionsGrid.ts`
      marks `price`, `notionalAmount`, `pnl` with `filter: 'number'`.

- [ ] **Step 8: Write the E2E**
      `apps/cgrid-positions/e2e/cycle7-numberFilter.spec.ts`:
      - Click expand on `notionalAmount` → popup opens
      - Select `greaterThan`, type `1000000`, click Apply →
        `getDisplayedRowCount` drops
      - Click Reset → row count returns to original
      - Click outside the popup → popup closes

- [ ] **Step 9: Typecheck + build + tests + E2E.**

- [ ] **Step 10: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cgrid): number-filter popup + agNumberColumnFilter parity

Lands the number-filter popup behind the floating-filter expand
button. Operator <select> covers equals/notEqual/lessThan/
lessThanOrEqual/greaterThan/greaterThanOrEqual/inRange/blank/notBlank;
inRange reveals a second numeric input for filterTo. Apply commits a
CNumberFilterModel via setColumnFilterModel; Clear empties inputs
without removing the active filter; Reset clears + removes the
filter. closeOnApply: true (default) closes the popup after Apply.

Lifts the open/close orchestration into a reusable FilterPopupHost
that Tasks 4-6 + 9 build on. Adds showColumnFilter /
hideColumnFilter to the public API.

Cycle 7 / Task 3.
EOF
)"
```

**Acceptance criteria:**
- [ ] `FilterPopupHost` exists; one active popup at a time.
- [ ] `NumberFilterPopup` produces a CNumberFilterModel and applies it
      through `setColumnFilterModel`.
- [ ] Demo's `notionalAmount` column opens a popup and filters live
      rows.
- [ ] Unit (≥ 7 assertions across both test files) + E2E (4 scenarios)
      + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 4 (Date-filter popup). Confirm Task 3 is committed.
Read docs/catalog/08-filtering.md "Date filter (agDateColumnFilter)
filter options" paragraph (line 171) and the date-filter behaviours.
Follow the per-task workflow.
```

---

## Task 4 — Date-filter popup + `inRange` + ISO-string worker storage

**Goal:** Same shape as Task 3 but the `<input type="number">` becomes
`<input type="date">`, and the worker stores date values as ISO strings
(`YYYY-MM-DD` for date-only, full timestamp for datetime). Filter
comparison parses both sides with `Date.parse` and compares numerically.
Operator set is identical to number (`equals` / `notEqual` / `lessThan`
/ `lessThanOrEqual` / `greaterThan` / `greaterThanOrEqual` / `inRange` /
`blank` / `notBlank`).

**Why this is Task 4:** Date is structurally the same as number; landing
it second amortises the popup-pattern investment. The demo's `asOfDate`
column gets a real-world use case.

**Read first:**
- `docs/catalog/08-filtering.md` — "Date filter" paragraph (line 171)
- `cgrid/src/interaction/filters/filterPopupHost.ts` (Task 3) —
  open/close orchestration
- `cgrid/src/interaction/filters/numberFilter.ts` (Task 3) —
  near-identical UI pattern

**Files:**
- Create: `cgrid/src/interaction/filters/dateFilter.ts`
- Modify: `cgrid/src/worker/dataPipeline.ts` (extend `matches` to
  handle `filterType: 'date'`; parse both sides via `Date.parse`,
  compare numerically; treat `null` / `undefined` / empty string as
  blank)
- Modify: `cgrid/src/velocityGrid.ts` (route `def.filter === 'date'` to
  `DateFilterPopup`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (mark `asOfDate`
  `filter: 'date'`)
- Create: `cgrid/tests/dateFilter.test.ts`
- Create: `cgrid/tests/filterPass.date.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle7-dateFilter.spec.ts`

**Interfaces produced:**

```ts
// cgrid/src/interaction/filters/dateFilter.ts

import type { CDateFilterModel } from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';

export interface DateFilterPopupDeps {
  initialModel: CDateFilterModel | null;
  onApply: (model: CDateFilterModel | null) => void;
  onClose: () => void;
  buttons?: Array<'apply' | 'clear' | 'reset' | 'cancel'>;
  closeOnApply?: boolean;
}

export class DateFilterPopup implements FilterPopupFactory {
  constructor(deps: DateFilterPopupDeps);
  buildGui(): HTMLElement;
  destroy(): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `filterPass.date.test.ts`** — 8
      assertions, one per operator. Fixtures use rows with ISO
      strings like `2026-01-15`, `2026-06-30`, `null`. Verify
      `inRange` is inclusive on both ends.
- [ ] **Step 2: Extend `matches` in `dataPipeline.ts`** to handle
      `filterType: 'date'`. Both sides go through `Date.parse`; if
      either is `NaN`, that side is treated as blank.
- [ ] **Step 3: Verify** — operator tests pass.
- [ ] **Step 4: Write the failing `dateFilter.test.ts`** — same shape
      as the number test but with `<input type="date">`. Assert the
      `min` / `max` attributes are honored when `filterParams.minDate`
      / `maxDate` are supplied.
- [ ] **Step 5: Implement `dateFilter.ts`** — clone `numberFilter.ts`,
      swap the input type, parse ISO strings on Apply.
- [ ] **Step 6: Route in `velocityGrid.ts`** — `case 'date': return new
      DateFilterPopup(...)`.
- [ ] **Step 7: Wire the demo** — `asOfDate` column with `filter:
      'date'`.
- [ ] **Step 8: E2E** — click expand on `asOfDate`, pick `greaterThan`,
      pick today's date, apply, assert visible row count drops.
- [ ] **Step 9: Typecheck + build + tests + E2E.**
- [ ] **Step 10: Commit**

```bash
git commit -m "feat(cgrid): date-filter popup + inRange + ISO-string worker storage

Date columns get the same operator UI as numbers, plus an inRange
two-date selector. Worker treats date values as ISO strings; both
sides parse through Date.parse and compare numerically. NaN sides
collapse to blank for blank/notBlank handling. asOfDate column in
the demo opts in via filter: 'date'.

Cycle 7 / Task 4."
```

**Acceptance criteria:**
- [ ] `DateFilterPopup` produces a `CDateFilterModel` and applies it.
- [ ] `FilterPass` evaluates all 8 date operators (≥ 8 assertions).
- [ ] Demo's `asOfDate` opens a popup; filtering by date reduces the
      visible row count.
- [ ] Unit + E2E + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 5 (Text-filter popup). Confirm Task 4 is committed.
Read docs/catalog/08-filtering.md "ITextFilterParams" + "Text filter
(agTextColumnFilter) filter options" paragraphs (lines 88-95, 162-165).
Follow the per-task workflow.
```

---

## Task 5 — Text-filter popup + `caseSensitive` + `textMatcher` / `textFormatter` / `trimInput`

**Goal:** Text-filter popup with the same buttons surface as Tasks 3 / 4
but adapted for strings: `<select>` covers `contains` / `notContains` /
`equals` / `notEqual` / `startsWith` / `endsWith` / `blank` / `notBlank`;
single `<input type="text">`; a `caseSensitive` checkbox in the popup.
`filterParams.textMatcher` (function override) and `textFormatter`
(value-normalisation) and `trimInput` are honored on the worker — the
matcher table extends to call the custom function when provided. The
popup wires these params through.

**Why this is Task 5:** Text is the most-used filter type but also the
most parameterised (case sensitivity, custom matcher, formatter). Landing
it after number / date means the popup template is already validated.

**Read first:**
- `docs/catalog/08-filtering.md` — `ITextFilterParams` (line 88); text
  filter operator list (line 162)
- `cgrid/src/interaction/filters/numberFilter.ts` (Task 3) — clone for
  the popup
- `cgrid/src/worker/dataPipeline.ts` — `matches` for text; extend with
  the new operators + case-sensitive flag

**Files:**
- Create: `cgrid/src/interaction/filters/textFilter.ts`
- Modify: `cgrid/src/worker/dataPipeline.ts` (`matches` honors
  `caseSensitive`; if `textMatcher` is supplied via params it's stored
  in a per-colId map on `FilterPass` and called instead of the built-in
  matcher; `textFormatter` runs on both sides before comparison;
  `trimInput` trims the `filter` value at `setModel` time)
- Modify: `cgrid/src/velocityGrid.ts` (route `def.filter === 'text'` to
  `TextFilterPopup`; ship `textFormatter` / `textMatcher` to the worker
  via the `CColumnFilterMeta` extension on `WorkerColumn`)
- Modify: `cgrid/src/worker/protocol.ts` (extend `WorkerColumn` with
  optional `caseSensitive?: boolean` + `textFormatter?: string` (function
  serialised by main — Cycle 7 ships the simple case where the formatter
  is a built-in name like `'lowercase'`; arbitrary closures are out of
  scope until Cycle 24's worker-module loader))
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (mark
  `instrumentName` `filter: 'text', filterParams: { caseSensitive:
  false, trimInput: true }`)
- Create: `cgrid/tests/textFilter.test.ts`
- Create: `cgrid/tests/filterPass.text.params.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle7-textFilter.spec.ts`

**Interfaces produced:**

```ts
// cgrid/src/types.ts additions

export interface CTextFilterParams extends CFilterParams {
  caseSensitive?: boolean;
  /** Built-in formatters Cycle 7 ships: 'lowercase' | 'uppercase' |
   *  'trim'. Arbitrary closures arrive in Cycle 24's worker-module
   *  loader. */
  textFormatter?: 'lowercase' | 'uppercase' | 'trim';
  trimInput?: boolean;
}

// cgrid/src/interaction/filters/textFilter.ts

import type { CTextFilterModel } from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';

export interface TextFilterPopupDeps {
  initialModel: CTextFilterModel | null;
  onApply: (model: CTextFilterModel | null) => void;
  onClose: () => void;
  buttons?: Array<'apply' | 'clear' | 'reset' | 'cancel'>;
  closeOnApply?: boolean;
  showCaseSensitiveToggle?: boolean;
}

export class TextFilterPopup implements FilterPopupFactory {
  constructor(deps: TextFilterPopupDeps);
  buildGui(): HTMLElement;
  destroy(): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `filterPass.text.params.test.ts`** —
      assertions:
      - `caseSensitive: true` on the column rejects a `'POS'` filter
        for the value `'pos-100'`
      - `textFormatter: 'lowercase'` runs both sides through lowercase
        before comparison
      - `trimInput: true` strips leading/trailing whitespace from the
        filter value at `setModel`
- [ ] **Step 2: Extend `matches` in `dataPipeline.ts`** to honor
      `caseSensitive` on the entry; thread `textFormatter` from the
      `WorkerColumn` into the comparison.
- [ ] **Step 3: Verify** — extension tests pass.
- [ ] **Step 4: Write the failing `textFilter.test.ts`** — popup
      assertions including the `caseSensitive` checkbox toggle.
- [ ] **Step 5: Implement `textFilter.ts`** — clone number popup; swap
      types.
- [ ] **Step 6: Route in `velocityGrid.ts`** + extend `WorkerColumn` payload.
- [ ] **Step 7: Wire the demo** — `instrumentName` column.
- [ ] **Step 8: E2E** — click expand on `instrumentName`, pick
      `startsWith`, type `Financial`, apply, assert row count drops to
      only matching instruments.
- [ ] **Step 9: Typecheck + build + tests + E2E.**
- [ ] **Step 10: Commit**

```bash
git commit -m "feat(cgrid): text-filter popup + caseSensitive + textMatcher / textFormatter / trimInput

Text columns get the full ag-grid operator surface (contains/
notContains/equals/notEqual/startsWith/endsWith/blank/notBlank) in
a popup. caseSensitive toggle in the UI flows through to the
worker's matcher; textFormatter (built-in 'lowercase'|'uppercase'|
'trim') normalises both sides pre-comparison; trimInput strips
whitespace from the filter value at setModel. instrumentName in
the demo opts in with caseSensitive: false, trimInput: true.

Cycle 7 / Task 5."
```

**Acceptance criteria:**
- [ ] `TextFilterPopup` produces a `CTextFilterModel` with the
      checkbox-driven `caseSensitive`.
- [ ] `FilterPass` honors `caseSensitive` + `textFormatter` +
      `trimInput` (≥ 3 assertions).
- [ ] Demo's `instrumentName` opens a popup; filtering by
      `startsWith` reduces the visible row count.
- [ ] Unit + E2E + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 6 (Multi-condition filter UI). Confirm Task 5 is
committed. Read docs/catalog/08-filtering.md "ISimpleFilterParams" +
the multi-condition behaviour notes (lines 77-86, 211).
Follow the per-task workflow.
```

---

## Task 6 — Multi-condition filter UI (`AND` / `OR`, up to 2 conditions)

**Goal:** One column can now express two conditions joined by AND or OR:
e.g. `instrumentName contains "Financial" AND endsWith "2036 4.632%"`.
The text / number / date popups gain an extra row beneath the first
condition: a join-operator radio (`AND` / `OR`) and a second copy of
the operator `<select>` + input. `filterParams.maxNumConditions` caps
the count (defaults to 2). `numAlwaysVisibleConditions` controls how
many show on initial open (defaults to 1; the second appears once the
first is filled). The committed model uses the v2
`CMultiConditionFilterModel` shape (Task 2). Worker `FilterPass`
extends to evaluate multi-condition entries — short-circuits as soon
as the join result is known.

**Why this is Task 6:** Multi-condition is a UI extension to Tasks 3 /
4 / 5; landing it here lets all three popup files share a single
multi-condition wrapper instead of reimplementing per-type. The worker
side is a single `case 'multi'` branch in `matches`.

**Read first:**
- `docs/catalog/08-filtering.md` — `ISimpleFilterParams.maxNumConditions`
  / `numAlwaysVisibleConditions` / `defaultJoinOperator` (lines 84-85)
- `cgrid/src/interaction/filters/textFilter.ts` / `numberFilter.ts` /
  `dateFilter.ts` (Tasks 3-5) — popup files that gain the
  multi-condition wrapper

**Files:**
- Create: `cgrid/src/interaction/filters/multiCondition.ts` (the
  wrapper that mounts two condition rows + a join radio between them)
- Modify: `cgrid/src/interaction/filters/textFilter.ts` (use
  `MultiConditionWrapper`)
- Modify: `cgrid/src/interaction/filters/numberFilter.ts` (use
  `MultiConditionWrapper`)
- Modify: `cgrid/src/interaction/filters/dateFilter.ts` (use
  `MultiConditionWrapper`)
- Modify: `cgrid/src/worker/dataPipeline.ts` (extend `matches` to
  handle `CMultiConditionFilterModel`)
- Modify: `cgrid/src/types.ts` (`CFilterParams` extends with
  `maxNumConditions?: number`, `numAlwaysVisibleConditions?: number`,
  `defaultJoinOperator?: 'AND' | 'OR'`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (mark `pnl`
  with `filterParams: { maxNumConditions: 2, defaultJoinOperator:
  'AND' }`)
- Create: `cgrid/tests/multiCondition.test.ts`
- Create: `cgrid/tests/filterPass.multi.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle7-multiCondition.spec.ts`

**Interfaces produced:**

```ts
// cgrid/src/interaction/filters/multiCondition.ts

import type { CFilterModelEntry } from '../../types';

export interface MultiConditionWrapperDeps {
  buildConditionRow: (
    initial: CFilterModelEntry | null,
    onChange: (next: CFilterModelEntry | null) => void,
  ) => HTMLElement;
  initial: { operator: 'AND' | 'OR'; conditions: CFilterModelEntry[] };
  maxNumConditions: number;             // defaults to 2
  numAlwaysVisibleConditions: number;   // defaults to 1
  onChange: (next: { operator: 'AND' | 'OR'; conditions: CFilterModelEntry[] }) => void;
}

export class MultiConditionWrapper {
  constructor(host: HTMLElement, deps: MultiConditionWrapperDeps);
  destroy(): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `filterPass.multi.test.ts`** —
      assertions:
      - `{ filterType: 'multi', operator: 'AND', conditions: [c1, c2] }`
        passes only when both c1 and c2 pass
      - `OR` passes when either passes
      - Empty `conditions` array passes every row (no constraint)
- [ ] **Step 2: Extend `matches` in `dataPipeline.ts`** with the
      `case 'multi'` branch.
- [ ] **Step 3: Verify** — multi-condition pass tests green.
- [ ] **Step 4: Write the failing `multiCondition.test.ts`** —
      assertions:
      - Wrapper mounts exactly `numAlwaysVisibleConditions` rows initially
      - Filling the first condition reveals the second
      - Switching the join radio from AND to OR fires `onChange` with
        the new operator
      - `maxNumConditions: 1` hides the second condition entirely
- [ ] **Step 5: Implement `multiCondition.ts`** — < 120 LOC. The
      wrapper does not know about text / number / date; the
      `buildConditionRow` factory comes from the caller.
- [ ] **Step 6: Update text / number / date popups** to wrap their
      condition UI in `MultiConditionWrapper`.
- [ ] **Step 7: Wire demo** — `pnl` filter params.
- [ ] **Step 8: E2E** — open `pnl` popup, fill `greaterThan 0` in
      condition 1, switch to OR, fill `lessThan -1000` in condition 2,
      apply, assert visible row count includes both positive and
      large-negative P&L rows.
- [ ] **Step 9: Typecheck + build + tests + E2E.**
- [ ] **Step 10: Commit**

```bash
git commit -m "feat(cgrid): multi-condition filter UI (AND/OR, up to 2 conditions)

Text/number/date popups gain a MultiConditionWrapper that mounts a
join-operator radio (AND/OR) between two condition rows. Committed
model uses CMultiConditionFilterModel (Cycle 7 / Task 2 shape);
worker FilterPass evaluates with short-circuit logic. Honors
maxNumConditions (default 2), numAlwaysVisibleConditions (default
1), defaultJoinOperator (default AND). Demo's pnl column ships with
maxNumConditions: 2 + defaultJoinOperator: 'AND'.

Cycle 7 / Task 6."
```

**Acceptance criteria:**
- [ ] `MultiConditionWrapper` mounts ≥ 1 / ≤ 2 condition rows; reveals
      the second when the first is filled.
- [ ] `FilterPass` evaluates multi-condition models with AND / OR
      short-circuit (≥ 3 assertions).
- [ ] Demo's `pnl` popup supports two conditions.
- [ ] Unit + E2E + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 7 (Quick filter). Confirm Task 6 is committed.
Read docs/catalog/08-filtering.md "GridOptions — quick filter" (lines
28-37) and "Quick filter mechanics" paragraph (line 191).
Follow the per-task workflow.
```

---

## Task 7 — `quickFilterText` + `QuickFilterPass` + `cacheQuickFilter` + parser / matcher / `getQuickFilterText` per-column override

**Goal:** A single text input above the grid filters every row across
every column. Wired via `setGridOption('quickFilterText', value)` (the
existing Cycle 4 / Task 5 runtimeOptions surface already accepts new
keys — just add the route). A new worker pass (`QuickFilterPass`)
evaluates the search terms against each row's aggregate text BEFORE
`FilterPass` runs. Aggregate text caches per rowId when
`cacheQuickFilter: true`; uncached path is the safe default.
`includeHiddenColumnsInQuickFilter` widens the per-row aggregate to
include hidden columns. `quickFilterParser` (a
`(text: string) => string[]` function) overrides the default
whitespace-split; `quickFilterMatcher` (a `(parts: string[], rowAgg:
string) => boolean`) overrides the default `every(part =>
agg.toLowerCase().includes(part.toLowerCase()))` match. Per-column
`getQuickFilterText` overrides the contribution from that column.

**Why this is Task 7:** Quick filter is the most-used filter pattern in
real apps (the search box above the grid). Independent of Tasks 1-6 —
no popup, no per-column UI, just a single grid option. Lands here so
the demo's toolbar can ship a search box without waiting for set
filter (Task 9).

**Read first:**
- `docs/catalog/08-filtering.md` — "GridOptions — quick filter" (lines
  28-37); "Quick filter mechanics" (line 191)
- `cgrid/src/worker/dataPipeline.ts` — `FilterPass` for the pattern;
  `QuickFilterPass` follows the same shape
- `cgrid/src/core/runtimeOptions.ts` — Cycle 4 / Task 5 surface;
  `quickFilterText` is a runtime-mutable option

**Files:**
- Modify: `cgrid/src/worker/dataPipeline.ts` (new `QuickFilterPass`
  class)
- Modify: `cgrid/src/worker/worker.ts` (instantiate + route into the
  pipeline before `FilterPass`)
- Modify: `cgrid/src/worker/client.ts` (`setQuickFilter(text: string |
  null, parts?: string[]): Promise<{ visibleCount: number }>`)
- Modify: `cgrid/src/worker/protocol.ts` (`'setQuickFilter'` request
  envelope)
- Modify: `cgrid/src/velocityGrid.ts` (`setGridOption('quickFilterText',
  value)` route; instantiate the worker call; fire `filterChanged` with
  `source: 'quickFilter'`)
- Modify: `cgrid/src/core/runtimeOptions.ts` (declare `quickFilterText`
  / `cacheQuickFilter` / `includeHiddenColumnsInQuickFilter` as
  runtime-mutable)
- Modify: `cgrid/src/types.ts` (`VelocityGridOptions.quickFilterText?: string`,
  `cacheQuickFilter?: boolean`, `includeHiddenColumnsInQuickFilter?:
  boolean`, `quickFilterParser?: (text: string) => string[]`,
  `quickFilterMatcher?: (parts: string[], agg: string) => boolean`;
  `CColDef.getQuickFilterText?: (params) => string`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (add a
  toolbar `<input id="quick-filter" placeholder="Search...">`; main.ts
  wires `oninput` → `setGridOption('quickFilterText', value)`)
- Create: `cgrid/tests/quickFilterPass.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle7-quickFilter.spec.ts`

**Interfaces produced (Task 8 consumes for `filterChanged.source`):**

```ts
// cgrid/src/types.ts

export interface VelocityGridOptions<TRow = any> {
  // … existing fields …
  quickFilterText?: string;
  cacheQuickFilter?: boolean;
  includeHiddenColumnsInQuickFilter?: boolean;
  /** Splits the quick filter text into terms. Defaults to
   *  `text.split(/\s+/).filter(t => t.length)`. */
  quickFilterParser?: (text: string) => string[];
  /** Returns true if the row's aggregate text matches the parsed
   *  terms. Defaults to `parts.every(p =>
   *  agg.toLowerCase().includes(p.toLowerCase()))`. */
  quickFilterMatcher?: (parts: string[], rowAggregateText: string) => boolean;
}

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  /** Contributes a custom string to the row's quick-filter aggregate
   *  for this column. Default contribution is `String(value)`. */
  getQuickFilterText?: (params: { value: any; data: TRow; colId: string }) => string;
}

// cgrid/src/worker/dataPipeline.ts

export class QuickFilterPass<TRow = any> {
  constructor(store: RowStore<TRow>, columns: WorkerColumn[]);
  setTerms(terms: string[] | null): void;
  setColumns(columns: WorkerColumn[]): void;
  /** Returns the row ids that pass the quick filter. When `terms` is
   *  null or empty, returns null (caller treats null as "all rows
   *  pass"). */
  apply(): string[] | null;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `quickFilterPass.test.ts`** —
      assertions:
      - `terms === null` returns `null` (pass-through)
      - Single term matches across multiple columns (e.g. `'POS'`
        matches a row whose `cusip` is `'POS-100'`)
      - Multi-term query requires every term to match (AND across
        terms — per ag-grid)
      - `cacheQuickFilter: true` rebuilds the aggregate once per row
        and reuses on a second `apply()` (assertion via spy on the
        per-row `String(value)` call count)
- [ ] **Step 2: Implement `QuickFilterPass`** in `dataPipeline.ts`
      — < 80 LOC.
- [ ] **Step 3: Wire `setQuickFilter` protocol** + worker route + main
      client.
- [ ] **Step 4: Route `setGridOption('quickFilterText', value)` in
      `velocityGrid.ts`** — parse via `options.quickFilterParser ??
      defaultParser`; ship terms to worker; on reply, fire
      `filterChanged` with `source: 'quickFilter'`.
- [ ] **Step 5: Wire the demo toolbar** — `<input id="quick-filter">`
      in `index.html`; `main.ts` `addEventListener('input', e =>
      grid.setGridOption('quickFilterText', e.target.value))`.
- [ ] **Step 6: E2E** — type `POS-1` in the search input; assert
      visible row count drops; clear; assert row count restored.
- [ ] **Step 7: Typecheck + build + tests + E2E.**
- [ ] **Step 8: Commit**

```bash
git commit -m "feat(cgrid): quickFilterText + QuickFilterPass + cacheQuickFilter

Adds a worker QuickFilterPass that runs before FilterPass. Whitespace-
split terms (overridable via quickFilterParser) match against each
row's aggregate text (column values joined with \\n, overridable per-
column via getQuickFilterText). Match defaults to case-insensitive
every-term-includes (overridable via quickFilterMatcher).
cacheQuickFilter: true builds the per-row aggregate once and reuses
across subsequent setGridOption('quickFilterText', ...) calls.

Demo toolbar gains a search input wired to setGridOption.

Cycle 7 / Task 7."
```

**Acceptance criteria:**
- [ ] `QuickFilterPass` runs before `FilterPass` in the worker pipeline.
- [ ] Quick filter applies across all visible columns (or all when
      `includeHiddenColumnsInQuickFilter: true`).
- [ ] `cacheQuickFilter: true` avoids per-row rebuild on subsequent
      applies.
- [ ] Demo search box filters live rows; clearing restores the row count.
- [ ] Unit (≥ 4 assertions) + E2E (1 scenario) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 8 (External filter). Confirm Task 7 is committed.
Read docs/catalog/08-filtering.md "GridOptions — external filter"
(lines 39-45) and the External filter behaviours paragraph (line 196).
Follow the per-task workflow.
```

---

## Task 8 — External filter (`isExternalFilterPresent` + `doesExternalFilterPass` + `alwaysPassFilter`)

**Goal:** App provides two callbacks: `isExternalFilterPresent(): boolean`
(grid calls before each filter pass; true activates external filter) and
`doesExternalFilterPass(rowData): boolean` (per-row predicate). The
predicate runs on the main thread (because it's app code that may close
over app state). The worker ships the candidate rowIds (the survivors of
column filters + quick filter), main runs the predicate over the
resolved `rowData`, ships the surviving rowIds back, worker uses them as
the final visible set. `alwaysPassFilter(rowData): boolean` lets specific
rows bypass every filter — checked before any pass.

**Why this is Task 8:** External filter is independent of every other
task. The wire protocol is the interesting bit (round-trip with rowId
arrays); the rest is callback plumbing.

**Read first:**
- `docs/catalog/08-filtering.md` — "GridOptions — external filter"
  (lines 39-45); "External filter" behaviour (line 196);
  "alwaysPassFilter" (line 213)
- `cgrid/src/worker/dataPipeline.ts` — `FilterPass.apply` signature;
  external filter slots in as a follow-up pass on the candidate ids

**Files:**
- Modify: `cgrid/src/worker/protocol.ts` (`'externalFilterCandidates'`
  push from worker → main; `'externalFilterResult'` response main →
  worker with the surviving ids)
- Modify: `cgrid/src/worker/worker.ts` (in the filter pipeline: if main
  has registered an external filter, suspend the pipeline mid-flight,
  push the candidate ids, wait for the result, then resume)
- Modify: `cgrid/src/worker/client.ts` (`registerExternalFilter(): void`
  + `unregisterExternalFilter(): void` + the response handler
  `externalFilterResult(ids: string[]): Promise<void>`)
- Modify: `cgrid/src/velocityGrid.ts` (on construction, if
  `options.isExternalFilterPresent` is provided, register the callback;
  main-side handler walks `rowData`, runs the predicate, ships survivors
  back; `onFilterChanged()` re-triggers the pipeline)
- Modify: `cgrid/src/types.ts` (`VelocityGridOptions.isExternalFilterPresent`
  + `doesExternalFilterPass` + `alwaysPassFilter`; `VelocityGridApi`:
  `onFilterChanged(source?: 'api' | 'quickFilter' | 'columnFilter' |
  'externalFilter')`)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (toolbar checkbox
  `<input id="ext-filter" type="checkbox"> show only USD positions`;
  main.ts wires the callbacks)
- Create: `cgrid/tests/externalFilter.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle7-externalFilter.spec.ts`

**Interfaces produced:**

```ts
// cgrid/src/types.ts

export interface VelocityGridOptions<TRow = any> {
  // … existing fields …
  /** App-provided predicate signalling whether external filtering is
   *  active. Called before every filter pass. Cycle 7 / Task 8. */
  isExternalFilterPresent?: () => boolean;
  /** App-provided per-row predicate. Called for each candidate row
   *  AFTER column + quick filters pass. Cycle 7 / Task 8. */
  doesExternalFilterPass?: (params: { data: TRow; rowId: string }) => boolean;
  /** Rows for which this returns true bypass EVERY filter (column,
   *  quick, external). Useful for pinned summary rows. Cycle 7 / Task 8. */
  alwaysPassFilter?: (params: { data: TRow; rowId: string }) => boolean;
}

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  /** Re-run the filter pipeline. Source labels the trigger for the
   *  `filterChanged` event. Cycle 7 / Task 8. */
  onFilterChanged(source?: 'api' | 'quickFilter' | 'columnFilter' | 'externalFilter'): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `externalFilter.test.ts`** —
      assertions:
      - When `isExternalFilterPresent` returns false, the predicate is
        never called
      - When true, `doesExternalFilterPass` is called for every
        candidate row exactly once per `onFilterChanged()`
      - Surviving rowIds become the visible set
      - `alwaysPassFilter` for a row bypasses both column filter and
        external filter
- [ ] **Step 2: Extend `protocol.ts`** with the two-direction
      messages.
- [ ] **Step 3: Implement the worker side** — pipeline suspends on
      `externalFilterCandidates` push, resumes on
      `externalFilterResult`. Use a per-filter-pass `pendingResolve`
      promise.
- [ ] **Step 4: Implement the main side** — on candidate ids arrival,
      walk the rowData store, run predicate, ship survivors back.
      Handle `alwaysPassFilter` synchronously in the worker (no
      round-trip needed) by extending `FilterPass.apply` to short-circuit
      `alwaysPassFilter` rows.
- [ ] **Step 5: Wire `onFilterChanged` API** — calls
      `workerClient.refilter(source)`.
- [ ] **Step 6: Wire the demo** — toolbar checkbox + main.ts
      `isExternalFilterPresent` / `doesExternalFilterPass`.
- [ ] **Step 7: E2E** — check the box; assert only USD rows visible;
      uncheck; assert restored.
- [ ] **Step 8: Typecheck + build + tests + E2E.**
- [ ] **Step 9: Commit**

```bash
git commit -m "feat(cgrid): external filter + alwaysPassFilter + onFilterChanged

isExternalFilterPresent activates the path; doesExternalFilterPass runs
on main per candidate row (the worker pipeline suspends and pushes
candidate rowIds, waits for the survivor list, resumes with that as
the visible set). alwaysPassFilter rows bypass every filter and are
checked synchronously on the worker. onFilterChanged() re-triggers
the pipeline and fires filterChanged with a source label.

Demo toolbar gains a 'USD only' checkbox.

Cycle 7 / Task 8."
```

**Acceptance criteria:**
- [ ] External filter round-trip works; predicate runs on main exactly
      once per row per `onFilterChanged()`.
- [ ] `alwaysPassFilter` bypasses every filter (worker-side
      short-circuit; ≥ 1 assertion).
- [ ] Demo checkbox filters live rows.
- [ ] Unit (≥ 4 assertions) + E2E (1 scenario) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 9 (Set Filter + getColumnFilterModel / setColumnFilterModel
+ Cycle 7 exit ritual). Confirm Task 8 is committed. Read
docs/catalog/08-filtering.md "ISetFilterParams" + "Set filter" paragraphs
(lines 105-123, 176-180) and the API surface for getColumnFilterModel /
setColumnFilterModel (lines 138-139). Follow the per-task workflow.
```

---

## Task 9 — Set Filter (virtualised) + reusable `VirtualList` primitive + per-column filter API polish + filter events + Cycle 7 exit ritual

**Goal:** Per-column distinct-value checkbox filter that scales to tens
of thousands of distinct values. Click expand on a set-filter column →
popup opens with a virtualised checkbox list (only rows in the visible
window are mounted; off-window rows are unmounted, not just
`display:none`); a tri-state `Select All` header that reflects
all/none/partial; an optional mini-search input that filters the
in-memory distinct list inline (debounced) — search recomputes the
virtualised slice without re-fetching from the worker; `Apply` /
`Clear` / `Reset` buttons (per the shared filter-popup pattern from
Task 3). Apply commits a `CSetFilterModel`
(`{ filterType: 'set', values: string[] }`). Worker
`DistinctValuesPass` computes the distinct value set on demand via a
one-pass hash over `store.rows()`; results cache until the next
transaction lands for that column.

**Virtualisation is a reusable primitive.** The windowed list is NOT
buried inside `setFilter.ts` — it lives at
`cgrid/src/interaction/ui/virtualList.ts` as a generic
`VirtualList<T>` that takes an item array + fixed row height + a
per-item renderer and emits rendered rows on scroll. Same primitive is
reused by Cycle-9+'s column chooser, the advanced-filter side panel,
any future tool-panel list, and the multi-select editor's option list.
Keeps cgrid off external virtualisation libraries (`react-window`,
`tanstack-virtual`) which don't fit a vanilla-TS canvas grid anyway.

Also lands the per-column filter API: `getColumnFilterModel(colId)`,
`setColumnFilterModel(colId, model)`, `isAnyFilterPresent()`,
`isColumnFilterPresent()`, `destroyFilter(colId)`. Wires the full event
surface: `filterChanged` (now carries `source` + `afterDataChange` +
`columns`), `filterOpened` (fires when any filter popup opens),
`filterModified` (fires when the popup UI changes without committing).

Runs the Cycle 7 exit ritual: flip every Area-08 row to ✅ in the FM,
populate the worklog's Shipped + Performance + Status sections.

**Why this is Task 9:** Set filter is the heaviest UI piece — needs a
virtualised list (potentially tens of thousands of distinct values) —
so it lands last. Splitting `VirtualList` out as its own primitive
costs ~200 LOC + one test file now, but earns reuse credit immediately
in Cycles 9-12 (column chooser, advanced-filter side panel, tool
panels) — building it inline in `setFilter.ts` and "extracting later"
always means rewriting from scratch. The per-column API + event polish
lands here too because every prior task generates events that need
their final shape locked.

**Read first:**
- `docs/catalog/08-filtering.md` — `ISetFilterParams` (lines 105-123);
  "Set filter" behaviour (line 176); API methods table (lines 132-148);
  Events table (lines 150-158)
- `cgrid/src/worker/dataPipeline.ts` — `FilterPass`; `DistinctValuesPass`
  is the same shape — hash over store rows
- `cgrid/src/interaction/filters/filterPopupHost.ts` (Task 3) — popup
  orchestration
- `cgrid/src/core/viewport.ts` — the cgrid main grid's virtualisation
  pattern (slice computation from scrollTop + fixed row height + visible
  height). `VirtualList<T>` is the same shape stripped of canvas paint:
  scroll listener → slice index range → mount/unmount DOM rows.
- All Cycle 5 / Task 7 worklog exit-ritual paragraphs (the playbook
  Task 9 mirrors)

**Files:**
- Create: `cgrid/src/interaction/ui/virtualList.ts` (generic windowed
  list primitive — set filter's first consumer; column chooser + tool
  panels consume in later cycles)
- Create: `cgrid/src/interaction/filters/setFilter.ts`
- Modify: `cgrid/src/worker/dataPipeline.ts` (new `DistinctValuesPass`;
  extend `matches` to handle `filterType: 'set'`)
- Modify: `cgrid/src/worker/worker.ts` (route
  `'getDistinctValues'` request)
- Modify: `cgrid/src/worker/client.ts`
  (`getDistinctValues(colId): Promise<string[]>`)
- Modify: `cgrid/src/worker/protocol.ts` (`'getDistinctValues'` envelope)
- Modify: `cgrid/src/velocityGrid.ts` (route `def.filter === 'set'` to
  `SetFilterPopup`; add `getColumnFilterModel` / `setColumnFilterModel`
  / `isAnyFilterPresent` / `isColumnFilterPresent` / `destroyFilter`;
  fire `filterOpened` on every popup open; fire `filterModified` on
  every popup-internal change; refine `filterChanged` payload)
- Modify: `cgrid/src/types.ts` (`CSetFilterParams`, the new event
  payload variants, the new API signatures)
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (mark `currency`,
  `desk`, `region` with `filter: 'set'`)
- Update: `docs/catalog/FEATURE_MATRIX.md` (flip Area-08 rows to ✅)
- Update: this worklog (Shipped + Performance + Status sections)
- Create: `cgrid/tests/virtualList.test.ts`
- Create: `cgrid/tests/setFilter.test.ts`
- Create: `cgrid/tests/distinctValuesPass.test.ts`
- Create: `cgrid/tests/perColumnFilterApi.test.ts`
- Create: `apps/cgrid-positions/e2e/cycle7-setFilter.spec.ts`

**Interfaces produced (cycle exit; consumed by future cycles):**

```ts
// cgrid/src/interaction/ui/virtualList.ts

/** Generic windowed list primitive. Renders only the rows in the
 *  visible viewport; off-window rows are unmounted (not just hidden)
 *  so a 50k-item list costs the same DOM as a 50-item list. Cycle 7 /
 *  Task 9's set filter is the first consumer; Cycle 9+'s column
 *  chooser, advanced-filter side panel, and tool panels reuse.
 *
 *  Performance contract:
 *  - Scroll → recompute slice → mount/unmount rows: 0 layout reads on
 *    the scroll path (cached `scrollTop` + fixed row height).
 *  - 50k items, 24px rows, 400px popup → renders ~17 rows per frame.
 *  - `setItems(newItems)` is O(visible), not O(items) — drops the
 *    cached slice + re-renders the window.
 */
export interface VirtualListDeps<T> {
  /** Fixed row height in CSS px. Constant per VirtualList instance —
   *  variable-height windows belong to a future RowHeightIndex-backed
   *  variant, not this primitive. */
  rowHeight: number;
  /** Builds the row DOM for `item`. Called once per mount; the same
   *  element is reused across scrolls (pooled by index slot — NOT by
   *  item identity, so the renderer must overwrite all dynamic
   *  content). Return `null` to render an empty slot at that index. */
  renderRow: (item: T, index: number) => HTMLElement | null;
  /** Optional overscan — how many rows beyond the visible window to
   *  pre-mount. Default 3. Trades DOM count for scroll smoothness. */
  overscan?: number;
}

export class VirtualList<T> {
  constructor(host: HTMLElement, deps: VirtualListDeps<T>);
  /** Replace the item set. Resets scroll to top by default; pass
   *  `{ preserveScroll: true }` to keep `scrollTop` (used by mini-search
   *  in the set filter so typing doesn't yank the user to the top). */
  setItems(items: T[], opts?: { preserveScroll?: boolean }): void;
  /** Programmatically scroll to the row at `index`. No-op for out-of-
   *  range indices. */
  scrollToIndex(index: number): void;
  /** Returns the [first, last] index range currently mounted (inclusive
   *  of overscan). For tests + scroll-driven a11y announcements. */
  visibleRange(): { first: number; last: number };
  /** Trigger a re-render of currently-mounted rows without changing
   *  the item list. Used after an external mutation (e.g. a checkbox
   *  toggle in the set filter flips a row's `checked` state). */
  refresh(): void;
  /** Tear down — removes the inner scroll host + pooled rows. */
  destroy(): void;
}

// cgrid/src/types.ts

export interface CSetFilterParams extends CFilterParams {
  /** When supplied, overrides the distinct-value derivation from grid
   *  data — Cycle 7 ships the data-derived path; the static array
   *  variant lands when Cycle 18's SSRM needs server-provided values. */
  values?: string[];
  caseSensitive?: boolean;
  /** Hide the mini-filter search box. */
  suppressMiniFilter?: boolean;
  /** Hide the "Select All" checkbox. */
  suppressSelectAll?: boolean;
}

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  getColumnFilterModel<TModel = CFilterModelEntry>(colId: string): TModel | null;
  setColumnFilterModel(colId: string, model: CFilterModelEntry | null): Promise<void>;
  isAnyFilterPresent(): boolean;
  isColumnFilterPresent(): boolean;
  destroyFilter(colId: string): void;
}

// VelocityGridEvent additions

export type VelocityGridEvent =
  // … existing variants …
  | {
      type: 'filterChanged';
      filterModel: CFilterModel;
      /** Cycle 7 / Task 9 — labels the trigger so apps can correlate. */
      source: 'api' | 'quickFilter' | 'columnFilter' | 'externalFilter';
      /** True when the change was caused by a data update (transaction
       *  landed), not a filter-model mutation. */
      afterDataChange?: boolean;
      /** ColIds whose per-column filter state actually changed. */
      columns?: string[];
    }
  | { type: 'filterOpened'; colId: string }
  | { type: 'filterModified'; colId: string };
```

**Steps:**

- [ ] **Step 1: Write the failing `virtualList.test.ts`** — TDD the
      primitive in isolation so it's solid before the set filter
      depends on it. Assertions (≥ 10):
      - With `items.length = 1000`, `rowHeight = 24`, host height =
        240, only ~13 rows (`10 visible + 3 overscan`) are mounted in
        the DOM
      - Total scroll-sizer height = `items.length * rowHeight`
        (so the native scrollbar reflects the full list size)
      - `scrollToIndex(500)` brings index 500 into the mounted set
      - Scrolling triggers row mount/unmount, not just visibility
        toggles (assert via `host.querySelectorAll('[data-vg-vlist-row]').length`)
      - Pool reuse: scrolling by exactly one row reuses N-1 existing
        DOM nodes (assert via element identity tracking)
      - `setItems(newItems)` with `preserveScroll: true` keeps
        `scrollTop` constant
      - `setItems(newItems)` without `preserveScroll` resets to 0
      - `refresh()` re-invokes `renderRow` on currently-mounted rows
        without changing the mounted set
      - `destroy()` empties the host
      - `visibleRange()` returns `{ first: 0, last: 12 }` on initial
        mount of a 1000-item list (matches the 13-row window)
- [ ] **Step 2: Implement `VirtualList<T>`** in
      `interaction/ui/virtualList.ts` — < 200 LOC. Inner DOM shape:

```
host (overflow: auto, height: deps' to set)
  └── sizer (absolute-positioned spacer, height = items.length * rowHeight, width: 1px)
  └── window (absolute-positioned container that holds the mounted rows)
        └── row[0]  (absolute, top: index * rowHeight)
        └── row[1]
        └── …
```

      Scroll listener: read `host.scrollTop` ONCE per scroll event,
      compute `firstVisible = floor(scrollTop / rowHeight)`,
      `lastVisible = ceil((scrollTop + clientHeight) / rowHeight)`,
      then `[firstMount, lastMount] = [firstVisible - overscan,
      lastVisible + overscan]` clamped to `[0, items.length - 1]`.
      Diff against the previous mounted range — remove rows that left,
      mount rows that entered, set `style.top` on every mounted row.
      No `getBoundingClientRect` reads on the scroll path. Pool the
      row elements by index slot (a `Map<number, HTMLElement>`).

- [ ] **Step 3: Verify** — `npm test --workspace=cgrid -- virtualList` green.

- [ ] **Step 4: Write the failing `distinctValuesPass.test.ts`** —
      assertions:
      - Returns the unique set of column values
      - Caches results per colId; second call hits the cache (verified
        by spying on the store-walk counter)
      - Cache invalidates after a transaction touches the column
- [ ] **Step 5: Write the failing `setFilter.test.ts`** — DOM
      assertions:
      - `buildGui()` mounts a `VirtualList` whose first window of rows
        renders one checkbox each
      - With 10,000 synthetic distinct values, the DOM contains < 50
        `<input type="checkbox">` elements (proves virtualisation)
      - `suppressMiniFilter` hides the search input
      - Typing in the mini-search narrows the visible list AND
        preserves scroll (per `VirtualList.setItems({ preserveScroll })`)
      - `Select All` toggles every value (including off-window ones —
        selection state lives in a `Set<string>`, not in DOM)
      - Select All is tri-state: indeterminate when partial, checked
        when all, unchecked when none
      - Toggling an off-window row via API (programmatic) and then
        scrolling it into view shows it correctly checked (proves
        state survives virtualisation)
      - Apply commits a `CSetFilterModel` with the checked values
- [ ] **Step 6: Write the failing `perColumnFilterApi.test.ts`** —
      assertions:
      - `getColumnFilterModel('colA')` returns null when no filter
        is set
      - `setColumnFilterModel('colA', model)` updates + fires
        `filterChanged` with `columns: ['colA']`
      - `setColumnFilterModel('colA', null)` clears the column's filter
      - `isAnyFilterPresent()` reflects column + quick + external
        filter state
      - `destroyFilter('colA')` clears the column's filter and any
        cached UI state
- [ ] **Step 7: Implement `DistinctValuesPass`** in `dataPipeline.ts`.
- [ ] **Step 8: Extend `matches` for `filterType: 'set'`** — `Set`
      lookup against the entry's `values` array.
- [ ] **Step 9: Wire `getDistinctValues` protocol** + worker + client.
- [ ] **Step 10: Implement `setFilter.ts`** — consumes `VirtualList`.
      Maintains the canonical selection as a `Set<string>` (NOT in
      DOM — off-window rows wouldn't survive otherwise);
      `renderRow(value)` reads the Set to set `checked`. Mini-search
      filters the distinct array inline → `vlist.setItems(filtered,
      { preserveScroll: true })`. `Select All` mutates the Set and
      calls `vlist.refresh()` so visible rows reflect the new state.
- [ ] **Step 11: Route in `velocityGrid.ts`** — `case 'set': new SetFilterPopup(...)`.
- [ ] **Step 12: Add per-column filter API + event refinements** in
      `velocityGrid.ts`. Fire `filterOpened` from every
      `filterPopupHost.open` call; fire `filterModified` from every
      condition-row `onChange` (debounced wire-up).
- [ ] **Step 13: Wire the demo** — `currency`, `desk`, `region`.
- [ ] **Step 14: E2E** — click expand on `currency`; popup lists USD /
      EUR / GBP / JPY; check USD only; apply; assert only USD rows
      visible. **Additional virtualisation E2E:** on a column with
      ≥ 1000 distinct values (synthetic test column in the demo or a
      dedicated test fixture), assert the popup DOM contains < 50
      checkbox inputs even though the model has 1000+ entries.
- [ ] **Step 15: Typecheck + build + full test suite + cycle7 E2E
      green.**
- [ ] **Step 16: Commit the VirtualList + set-filter + API + events**
      before the exit ritual:

```bash
git commit -m "$(cat <<'EOF'
feat(cgrid): VirtualList primitive + virtualised set filter + per-column filter API + filter events

Lands `interaction/ui/virtualList.ts` — a generic windowed-list
primitive that mounts only the rows in the visible viewport (overscan
configurable, default 3) and unmounts on scroll-out. Pool-keyed by
index slot so 50k items cost the same DOM as 50 items. First consumer
is the set filter; column chooser, advanced-filter side panel, and
tool panels in later cycles consume the same primitive.

Set filter is built on VirtualList: per-column distinct-value
checkboxes backed by a worker DistinctValuesPass (one-pass hash,
cache per colId, invalidate on transaction). Selection state lives
in a Set<string> (not in DOM) so off-window rows survive
virtualisation. Mini-search filters the distinct list inline +
preserves scroll. Tri-state Select All (all/none/partial). Apply
commits a CSetFilterModel.

Per-column filter API: getColumnFilterModel / setColumnFilterModel /
isAnyFilterPresent / isColumnFilterPresent / destroyFilter. Filter
events: filterChanged gains source / afterDataChange / columns;
filterOpened fires on every popup open; filterModified fires on
popup-internal changes pre-apply.

Demo's currency / desk / region columns ship with filter: 'set'.

Cycle 7 / Task 9.
EOF
)"
```

**Cycle 7 exit ritual (after the Task 9 commit):**

- [ ] Update FM rows in `docs/catalog/FEATURE_MATRIX.md` to ✅:
      - **Area 08:** `quickFilterText`, `cacheQuickFilter`,
        `includeHiddenColumnsInQuickFilter`, `quickFilterParser`,
        `quickFilterMatcher`, `isExternalFilterPresent`,
        `doesExternalFilterPass`, `alwaysPassFilter`, `filter` on
        ColDef, `filterParams`, `filterValueGetter`, `floatingFilter`,
        `floatingFilterComponent`, `suppressFloatingFilterButton`,
        `getQuickFilterText`, `buttons`, `closeOnApply`, `debounceMs`,
        `readOnly`, `filterOptions`, `defaultOption`,
        `defaultJoinOperator`, `maxNumConditions`,
        `numAlwaysVisibleConditions`, `textMatcher`, `caseSensitive`,
        `textFormatter`, `trimInput`, `getFilterModel`,
        `setFilterModel`, `getColumnFilterModel`,
        `setColumnFilterModel`, `destroyFilter`, `showColumnFilter`,
        `hideColumnFilter`, `onFilterChanged`, `isAnyFilterPresent`,
        `isColumnFilterPresent`, `filterChanged`, `filterModified`,
        `filterOpened`. (Enterprise rows — `agSetColumnFilter` full
        feature parity, `agMultiColumnFilter`, `enableAdvancedFilter`,
        `getColumnFilterInstance` for arbitrary filter instances —
        remain unchecked; out of Cycle 7 scope.)
      - **Area 22:** `filterChanged` (refined with `source` +
        `afterDataChange` + `columns`), `filterOpened`,
        `filterModified`.
      - **Area 23:** `getFilterModel`, `setFilterModel`,
        `getColumnFilterModel`, `setColumnFilterModel`,
        `isAnyFilterPresent`, `isColumnFilterPresent`,
        `onFilterChanged`, `showColumnFilter`, `hideColumnFilter`,
        `destroyFilter`.

- [ ] Append to this worklog under "Shipped":
      - FloatingFilterSubgrid + FloatingFilterOverlay +
        `VelocityGridOptions.floatingFilter` + `CColDef.floatingFilter` +
        `suppressFloatingFilterButton`.
      - `CFilterModelEntry` v2 discriminated union + back-compat shim
        for the Cycle 4 / 5 shape.
      - Number-filter popup + every number operator.
      - Date-filter popup + every date operator + ISO-string worker storage.
      - Text-filter popup + `caseSensitive` + `textMatcher` /
        `textFormatter` / `trimInput`.
      - Multi-condition wrapper + AND / OR join.
      - `quickFilterText` + `QuickFilterPass` + `cacheQuickFilter` +
        `includeHiddenColumnsInQuickFilter` + parser / matcher /
        per-column `getQuickFilterText`.
      - External filter + `alwaysPassFilter` + `onFilterChanged` +
        candidate-rowIds protocol.
      - `VirtualList<T>` primitive in `interaction/ui/` —
        windowed-list utility consumed by the set filter; reusable in
        Cycles 9+ for column chooser / advanced-filter side panel /
        tool panels.
      - Set filter (virtualised) + `DistinctValuesPass` + per-column
        filter API + `filterChanged` / `filterOpened` /
        `filterModified` events.

- [ ] Run the perf checks (hand-time on the demo against the live
      `stomp-view-server`; Cycle 24 introduces the automated bench):
      `setFilterModel` (5-col, 20k rows) p95, quickFilterText
      cached / uncached p95, `getDistinctValues` p95, filter popup
      open/close median. Record numbers in the Performance section
      below.

- [ ] Append `## Cycle 7 status: COMPLETE` + the 9-task closing
      checklist.

- [ ] Commit the exit-ritual changes:

```bash
git commit -m "docs(cgrid): Cycle 7 exit ritual — FM flips + Shipped list + perf + status

Flips every Cycle 7 deliverable to ✅ in FM areas 08 / 22 / 23. Adds
the Shipped + Performance + Status sections to the Cycle 7 worklog.

Cycle 7 / exit ritual."
```

**Acceptance criteria for Task 9 + exit:**
- [ ] `VirtualList<T>` exists at `interaction/ui/virtualList.ts`,
      independent of the set filter; ≥ 10 unit assertions covering
      slice math, pool reuse, `setItems({preserveScroll})`, `refresh`,
      `scrollToIndex`, `destroy`.
- [ ] Set filter renders distinct-value checkboxes via VirtualList;
      DOM holds < 50 checkbox inputs even for a 1000+ distinct-value
      column (verified by both a unit test and an E2E assertion);
      applying commits a `CSetFilterModel`.
- [ ] Selection state lives in a `Set<string>`, not DOM — toggling an
      off-window row via API then scrolling it into view shows the
      correct checked state (unit test).
- [ ] Per-column filter API surface complete (≥ 5 methods).
- [ ] `filterChanged.source` + `filterOpened` + `filterModified` fire
      from every relevant trigger.
- [ ] FM Area 08 rows flipped (~60 of 63 ✅).
- [ ] Worklog Shipped + Performance + Status sections populated.
- [ ] All cgrid + cgrid-positions tests + cycle7 E2E specs green.

**Next session prompt** (final session of this cycle):

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
"Cycle 7 exit ritual" and run it. Confirm Task 9's set-filter commit
is in place (git log -1 should show "set filter + per-column filter
API"). Flip FM rows; update the worklog's Shipped + Performance
sections with measured numbers; commit the exit-ritual changes;
then read the master plan's Cycle 8 section and author the Cycle 8
worklog at
docs/superpowers/plans/<YYYY-MM-DD>-canvasgrid-cycle-08-sorting.md.
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
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-07-filtering.md
and execute Task 1 (FloatingFilterSubgrid + FloatingFilterOverlay +
floatingFilter opt-in). Confirm Cycle 6 is COMPLETE (git log should
show "Cycle 6 exit ritual" recently and the Cycle 6 worklog ends with
"## Cycle 6 status: COMPLETE"). Read docs/catalog/08-filtering.md
"Configuration surface — ColDef — per-column filter" table (line 55)
and the "Floating filters" Behaviors paragraph (line 186). This is
the first session of Cycle 7; follow the Global Constraints, do not
skip the verification commands, and commit at the end.
```

---

## Shipped

- `FloatingFilterSubgrid` + `FloatingFilterOverlay` + `VelocityGridOptions.floatingFilter` + `CColDef.floatingFilter` + `suppressFloatingFilterButton`.
- `CFilterModelEntry` v2 discriminated union + back-compat shim for the Cycle 4 / 5 shape.
- Number-filter popup + every number operator.
- Date-filter popup + every date operator + ISO-string worker storage.
- Text-filter popup + `caseSensitive` + `textFormatter` / `trimInput`.
- Multi-condition wrapper + AND / OR join (up to two conditions per popup).
- `quickFilterText` + `QuickFilterPass` + `cacheQuickFilter` + `includeHiddenColumnsInQuickFilter` + parser / matcher + per-column `getQuickFilterText`.
- External filter + `alwaysPassFilter` + `onFilterChanged` + candidate-rowIds protocol.
- `VirtualList<T>` primitive in `interaction/ui/` — windowed-list utility consumed by the set filter; reusable in Cycles 9+ for the column chooser, advanced-filter side panel, and tool panels.
- Set filter (virtualised) + `DistinctValuesPass` + per-column filter API (`getColumnFilterModel` / `setColumnFilterModel` / `isAnyFilterPresent` / `isColumnFilterPresent` / `destroyFilter`) + `filterChanged` (refined) / `filterOpened` / `filterModified` events.

---

## Performance — hand-timed perf gate

_(Cycle 24 introduces the automated bench harness; until then this
section is the manual checkpoint captured on the `apps/cgrid-positions`
demo against the live `stomp-view-server` at `ws://localhost:8081`.)_

| Metric | Budget | Measured (Cycle 7 exit) | Notes |
|---|---|---|---|
| `setFilterModel` (5-col, 20k rows) | < 30 ms p95 | _(deferred; no live `stomp-view-server` available this session — re-measure when Cycle 24's bench lands)_ | Worker round-trip including FilterPass.apply |
| `quickFilterText` apply (20k rows × 17 cols, cacheQuickFilter on) | < 50 ms p95 | _(deferred; see above)_ | Hot path during type-as-you-search |
| `quickFilterText` apply (cacheQuickFilter off) | < 200 ms p95 | _(deferred; see above)_ | Cold path; aggregate-text rebuild every call |
| `getDistinctValues` (1 col, 20k rows) | < 20 ms p95 | _(deferred; see above)_ | Set-filter popup open |
| Floating-filter overlay re-pin (per scroll frame) | < 1 ms; zero layout reads | _(deferred; see above)_ | DOM `transform` writes only |
| Filter popup open/close | < 16 ms | _(deferred; see above)_ | One-frame budget |

Note: the cycle's E2E smoke suite (46 Cycle 7 specs, including the new
6-test `cycle7-setFilter` spec) ran green end-to-end against the demo's
synthetic in-process row source; the perf numbers above are the only
deferred checkpoint and will be backfilled by the Cycle 24 bench
harness against a real `stomp-view-server` snapshot.

---

## Cycle 7 status: COMPLETE

Cycle 7 — Filtering — landed across nine tasks (PR stack:
batch/cycle-7-task-5-2026-06-25 → batch/cycle-7-task-9-2026-06-25).

- [x] Task 1 — `FloatingFilterSubgrid` + `FloatingFilterOverlay` + `floatingFilter` opt-in
- [x] Task 2 — `CFilterModelEntry` v2 discriminated union + back-compat shim
- [x] Task 3 — Number-filter popup + reusable `filterPopupHost`
- [x] Task 4 — Date-filter popup + `inRange` + ISO-string worker storage
- [x] Task 5 — Text-filter popup + `caseSensitive` + `textFormatter` / `trimInput`
- [x] Task 6 — Multi-condition filter UI (AND / OR, up to 2 conditions)
- [x] Task 7 — `quickFilterText` + `QuickFilterPass` + `cacheQuickFilter` + parser / matcher / per-column `getQuickFilterText`
- [x] Task 8 — External filter (`isExternalFilterPresent` + `doesExternalFilterPass` + `alwaysPassFilter`) + candidate-rowIds protocol + stale-reply guard
- [x] Task 9 — Set Filter (virtualised) + reusable `VirtualList` primitive + per-column filter API + filter events + Cycle 7 exit ritual

Next session: read the master plan's Cycle 8 section and author the
Cycle 8 worklog at
`docs/superpowers/plans/<YYYY-MM-DD>-canvasgrid-cycle-08-sorting.md`.
