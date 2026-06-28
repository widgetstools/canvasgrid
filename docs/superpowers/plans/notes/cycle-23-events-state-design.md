# Cycle 23 — Events + state — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 23
**FM coverage:** Area 22 (~10 of 11 rows) + Area 23 (state-related API)
**Depends on:** Cycle 11 (side bar state needs to be in snapshot)

---

## Mental model: state IS the union of every prior cycle's mutable model

By Cycle 23, fifteen cycles have each added a mutable model:
column state (Cycle 6), filter model (7), sort model (8), selection
ranges (9), side bar state (11), pivot mode + cols (18), group
expand/collapse (15), tree expand (17), SSRM cache (19). State save
/ restore is the SINGLE primitive that round-trips ALL of them.

The hard part isn't snapshotting — it's the GUARANTEE that
`setState(getState())` is idempotent. Cycle 23 designs the snapshot
SHAPE so each model serializes deterministically and restores in the
right order (column state BEFORE filter model BEFORE sort model
BEFORE group expansion, etc.).

```
getState() returns:               setState(snapshot) restores in:
─────────────────────────         ───────────────────────────────
{ columnState,                    1. columnState (defines columns)
  filterModel,                    2. filterModel  (filters rows)
  sortModel,                      3. sortModel    (orders rows)
  rowGroupColumns,                4. rowGroupColumns (groups rows)
  expandedRouteIds,               5. pivotMode + pivotCols
  pivotMode, pivotCols,           6. expandedRouteIds
  sideBar,                        7. selection ranges
  selection,                      8. side bar (no-op for layout)
  scroll }                        9. scroll (last — viewport math
                                     depends on everything above)
```

---

## Task 1 — Remaining events audit

**Goal:** Audit cgrid's `CGridEvent` union against ag-grid's event
list. Identify missing events; wire each.

**Likely missing (per master plan):**

- `cellMouseOver` / `cellMouseOut` — fires on cell hover state
  changes. Coalesce per cell crossing.
- `rowMouseOver` / `rowMouseOut` — coalesce per row crossing.
- `cellMouseDown` — fires before `cellClicked`. Useful for
  drag-initiation.
- `cellKeyDown` / `cellKeyPress` — focused cell sees pre-grid
  keyboard events; apps can `preventDefault` to suppress grid
  behavior.
- `bodyScroll` — fires every scroll event with `top, left, direction`.
- `bodyScrollEnd` — debounced; fires after 200 ms of no scrolling.
- `viewportChanged` — refined: fires when `firstVisibleRow` /
  `lastVisibleRow` change, NOT on every scroll pixel.

---

## Task 2 — Mouse hover events

**Goal:** Wire `cellMouseOver`, `cellMouseOut`, `rowMouseOver`,
`rowMouseOut` from the existing pointer-move handler.

**Coalescing rule:** Hover state tracked as
`{ cellRowId, cellColId, rowId }`. On every move, hit-test produces
the current cell; if changed from previous, fire the OUT event for
the previous cell + the OVER event for the new cell. If `rowId`
changed, also fire `rowMouseOut` + `rowMouseOver`. NEVER fires per
pixel — only on cell/row transition.

**File:** `interaction/features/onHover.ts` (new).

**Perf gate:** Hover-event dispatch contributes ≤ 0.1 ms per move
event amortized. The hit-tester (Cycle 9) is already O(log
visibleColumns) — no new work.

---

## Task 3 — Body-scroll events

**Goal:** Fire `bodyScroll` on every scroll event;
`bodyScrollEnd` after 200 ms of inactivity (debounced).

**Pattern:**

```typescript
let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
canvas.addEventListener('scroll', () => {
  this.emit('bodyScroll', { top, left, direction });
  if (scrollEndTimer) clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(() => {
    this.emit('bodyScrollEnd', { top, left });
  }, 200);
});
```

**File:** `cgrid.ts`.

---

## Task 4 — Cell keyboard events

**Goal:** `cellKeyDown` and `cellKeyPress` fire BEFORE grid's own
key handler processes the event. App handlers can call
`event.preventDefault()` to suppress grid behavior (e.g., disable
Enter-to-commit on a column).

**Wiring:** In `interaction/features/keyPaging.ts`, before any grid
handler runs:

```typescript
const evt: CellKeyEvent = { event, rowId, colId, value, … };
api.emit('cellKeyDown', evt);
if (evt.event.defaultPrevented) return; // app suppressed
// … continue with grid behavior
```

---

## Task 5 — `getState()`

**Goal:** Returns a snapshot capturing every mutable model.

```typescript
interface GridState {
  version: number;                  // schema version for migrations
  columnState?: CColumnState[];
  filterModel?: FilterModel;
  sortModel?: SortModel;
  rowGroupColumns?: string[];
  expandedRouteIds?: string[];      // group/tree expand
  pivotMode?: boolean;
  pivotCols?: string[];
  sideBar?: { openedToolPanel: string | null; position: 'left' | 'right'; visible: boolean };
  cellSelection?: { ranges: SelectionRange[]; focused: { rowId, colId } | null };
  rowSelection?: string[];          // selected rowIds
  scroll?: { top: number; left: number };
  rangeSelection?: SelectionRange[];
}

class CGridApi {
  getState(): GridState;
}
```

**File:** `core/stateSnapshot.ts` (new).

**Perf gate:** ≤ 5 ms for a 50-col / 10-group grid.

---

## Task 6 — `setState(snapshot)`

**Goal:** Restores the state. Applied in the order described in the
mental model section above.

```typescript
class CGridApi {
  setState(snapshot: GridState): void;
  resetState(): void;  // back to initial-options state
}
```

**Schema migrations:** When `snapshot.version` < current version,
run a migration chain. The migration registry lives in
`core/stateMigrations.ts` — each entry is `(state: vN) => vN+1`.

**Initial state on construction:** `CGridOptions.initialState?:
GridState` lets apps pass a saved state at construction time;
applied AFTER initial options resolve but BEFORE first paint.

---

## Task 7 — `stateUpdated` event

**Goal:** Single event fires when ANY component of state changes.
Debounced per frame (collapses N changes within one rAF tick into
one event).

```typescript
interface StateUpdatedEvent {
  state: GridState;
  changedKeys: (keyof GridState)[];
  source: 'api' | 'ui' | 'init';
}
```

**Use case:** App subscribes to `stateUpdated`, writes the snapshot
to localStorage; on next mount, reads it back into
`initialState`. Two-line persistence.

---

## Performance gates

- `getState()` ≤ 5 ms for 50-col / 10-group grid.
- `setState(snapshot)` ≤ 32 ms (two frames) for the same.
- `stateUpdated` debounced per rAF — never fires more than once
  per frame.
- Hover events dispatch ≤ 0.1 ms per pointer move (amortized).

---

## Exit criteria recap

- FM Area 22 ≥ 95 % ✅.
- FM Area 23 state rows ✅.
- Demo: a "Save layout" / "Restore layout" button stores state to
  localStorage; reload restores everything (columns, filters, sort,
  groups, expansion, scroll position).
- All new events fire correctly; E2E suite asserts coalescing for
  hover/scroll events.
