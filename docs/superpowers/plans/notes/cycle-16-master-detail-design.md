# Cycle 16 — Master/Detail — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 16
**FM coverage:** Area 13 — ~20 of 21 rows
**Depends on:** Cycle 5 (variable row heights), Cycle 15 (subgrid-stack extension pattern)

---

## Architecture: master row + detail row stack

The master grid keeps its existing `DataSubgrid`; when a master row is
expanded, a one-row `DetailSubgrid` is inserted IMMEDIATELY AFTER the
master row in the subgrid stack. Detail-row height is per-row
(`getDetailRowHeight(params)`) or fixed (`detailRowHeight`).

**The mental model:** Cycle 15 introduced the chunk-format `rowKind`
byte (0 = data, 1 = group, 2 = footer). Cycle 16 adds `rowKind = 3`
(detail). The viewport slicer interleaves a detail row directly under
each expanded master. No new pipeline pass — just a flat-order
flag the existing slicer reads.

```
┌─ Master row (rowKind = 0) ───────────────────────┐
├─ Detail row (rowKind = 3, height = 240px) ───────┤
│   ┌─ Nested VelocityGrid (orderbook) ──────────────┐    │
│   │ ...                                     │    │
│   └─────────────────────────────────────────┘    │
├─ Master row (rowKind = 0) ───────────────────────┤
├─ Master row (rowKind = 0) ───────────────────────┤
└──────────────────────────────────────────────────┘
```

---

## Task 1 — `DetailSubgrid` + chunk format extension

**Goal:** Add `rowKind = 3` to chunk format; teach `ViewportSlicer` to
emit detail rows directly under expanded masters.

**Worker side:**
- Extend `ChunkFormat`: no new arrays — reuse `rowKind` byte and
  `rowHeight: Uint32Array` (Cycle 5).
- `ViewportSlicer` reads `expandedDetailMasters: Set<number>` (master
  row indices the user has expanded) and emits a virtual detail row
  whose `rowIndex` mirrors the master, `rowKind = 3`, and
  `rowHeight = getDetailRowHeight(masterRow)`.

**Main side:**
- `DetailSubgrid implements Subgrid` — `getRowKind() === 3`,
  `isPainted = false` (the detail content is a DOM portal, not
  canvas-painted).
- Subgrid stack mounts it inline with `DataSubgrid` so scroll math
  treats it as a regular row.

**Key invariant:** Hit-test treats the detail-row band as a
"passthrough region" — clicks fall through to the DOM portal beneath,
NOT to the master row painter.

---

## Task 2 — Detail row DOM portal

**Goal:** Detail rows render as DOM portals (NOT canvas) because they
host arbitrary nested grids / app DOM. Position via
`transform: translate(0, y)` keyed off the row's viewport top.

**Pattern lifted from:** `FloatingFilterOverlay` (Cycle 7) — same pool
+ transform-reposition technique.

**Constraint:** Pointer events on the detail portal MUST capture
before the canvas hit-tester sees them. The portal is mounted ABOVE
the canvas in z-order; canvas hit-tester checks `event.target` and
short-circuits when the event originated inside a `.vg-detail-row`.

**Lifecycle:**
- Mount: row becomes visible AND is expanded.
- Hide (NOT destroy): row scrolls out of viewport — `display: none`.
- Destroy: master row collapses OR detail-row cache evicts (Task 5).

---

## Task 3 — Nested VelocityGrid wiring (`detailCellRenderer`)

**Goal:** Apps provide `detailCellRendererParams.detailGridOptions` (a
`VelocityGridOptions` for the nested grid); cgrid auto-creates the nested
`VelocityGrid` inside the portal. Alternatively `detailCellRenderer` is a
custom callback returning arbitrary DOM.

**API surface:**

```typescript
interface MasterDetailParams<TRow, TDetail> {
  detailCellRenderer?: (params: DetailParams<TRow>) => HTMLElement;
  detailCellRendererParams?:
    | DetailGridParams<TDetail>
    | ((params: DetailParams<TRow>) => DetailGridParams<TDetail>);
  detailRowHeight?: number;
  getDetailRowHeight?: (params: { data: TRow; node: RowNode }) => number;
  isRowMaster?: (rowData: TRow) => boolean; // not every row need be master
  masterDetail?: boolean;
}

interface DetailGridParams<TDetail> {
  detailGridOptions: VelocityGridOptions<TDetail>;
  getDetailRowData: (params: GetDetailRowDataParams<TDetail>) => void;
}
```

**Auto-create flow:** When `detailCellRenderer` is not provided,
cgrid synthesizes one that:
1. Creates a `<div class="vg-detail-host">` inside the portal.
2. Instantiates `new VelocityGrid(host, detailGridOptions)`.
3. Calls `params.getDetailRowData({ successCallback: rows => { … } })`
   — same pattern as ag-grid.
4. Pipes the nested grid's `firstDataRendered` event up as
   `detailGridReady` on the master.

---

## Task 4 — Expand / collapse interaction

**Goal:** Click an expand button on the master row → toggle the
detail row. Programmatic: `api.setRowExpanded(rowId, true)`.

**UI chrome:** The expand button is a 16×16 chevron painted in the
auto-detail column (first leaf when `masterDetail: true`), same
indent vocabulary as Cycle 15's group chevron — they SHARE the
indent unit `--vg-group-indent` and chevron color tokens. Reuse,
don't reinvent.

**Visual signature (light theme):**

| Token | Value | Why |
|---|---|---|
| `--vg-detail-chevron-color` | `var(--vg-group-chevron-color)` | Same family as group chevron — one tree vocabulary across hierarchy features |
| `--vg-detail-bg` | `var(--vg-totals-bg)` | 3% slate tint — visually "lifted" from data rows like the totals row (Cycle 14) |
| `--vg-detail-border-top` | `var(--vg-totals-border-top)` | Hairline rule above the detail band so it reads as a distinct lift |

**Rationale for inheriting Cycle 14/15 tokens:** A grouped grid with
master-detail reads with ONE structural vocabulary — chevron + indent
+ hairline lift — across group rows, group footers, master rows,
detail rows. Inventing new tokens for the detail band would fork the
visual language.

---

## Task 5 — Lazy create + LRU cache

**Goal:** `keepDetailRows: boolean` + `keepDetailRowsCount: number`
control whether collapsed detail grids are destroyed or cached.

**Cache invariant:** Only ever holds nested-grid INSTANCES, not their
DOM. When a cached detail row is re-expanded, the nested grid is
re-attached to the new portal (its canvas is re-mounted via
`appendChild`). The nested grid's data/state survives the round-trip.

**LRU eviction:** When `keepDetailRowsCount` is hit, evict the
least-recently-collapsed entry. `api.removeDetailGridInfo(rowId)`
forces eviction.

---

## Task 6 — Detail events

- `rowGroupOpened` (reused from Cycle 15) — fires on expand /
  collapse with `{ rowId, expanded: boolean, source: 'api' | 'ui' }`.
- `detailGridReady` — fires when nested grid's `firstDataRendered`
  fires; carries `{ masterRowId, detailGridApi }`.
- `detailGridDestroyed` — fires when nested grid is unmounted /
  evicted.

---

## Task 7 — Wheel scroll containment

**Goal:** Wheel events inside the nested grid don't propagate to the
master grid until the nested grid reaches its scroll boundary.

**Approach:** Wheel handler at the portal level intercepts the event;
if the nested grid's `scrollTop` can absorb the delta (not at top
when `deltaY < 0`, not at bottom when `deltaY > 0`), it
`stopPropagation()`. Otherwise, lets it bubble.

**Edge case:** Horizontal wheel (Shift+Wheel) follows the same logic
on `scrollLeft`.

---

## Performance gates

- Detail row construction is lazy — the nested grid is NOT
  instantiated until the row is visibly expanded.
- Closing a detail row destroys the nested grid by default
  (`keepDetailRows: false`).
- Master grid scroll FPS unchanged whether 0, 1, or 10 detail rows
  are expanded (the nested grids each manage their own paint loops;
  the master's `requestAnimationFrame` is not shared).
- Detail-portal reposition uses `transform: translate(0, y)` — NO
  layout reads on scroll.

---

## Exit criteria recap

- FM Area 13 ≥ 90 % ✅.
- Demo: `apps/cgrid-positions` expands a position row into a nested
  orderbook grid (Master/Detail demo).
- Nested grid receives focus correctly on click; Tab navigates inside
  it; ESC returns focus to the master.
- Memory: a 10k-row grid with 50 cached detail grids stays under the
  performance budget.
