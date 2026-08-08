# Pivot grand totals (row + column, sticky) — design

## Goal

Add Excel-style grand totals to cgrid's pivot mode: a "Grand Total"
row at the bottom and a "Grand Total" column at the right, both
sticky during scroll. AG-Grid does not provide this feature — it
becomes a cgrid-only superpower. The user explicitly asked for a
careful, diligent implementation.

## Decisions made during brainstorming

- **API shape**: a single new option `pivotGrandTotals: boolean`
  (NOT two separate row/column options). Excel-aligned semantic —
  the row and column always appear together.
- **Position**: Excel default — bottom row + right column. No
  configurable positions in v1; the option remains a boolean
  shorthand. If apps later need flexibility, the boolean can grow
  into an object `{ row: 'top'|'bottom', column: 'left'|'right' }`
  without breaking the default.
- **Composition with `pivotRowTotals`**: `pivotGrandTotals: true`
  implies `pivotRowTotals: 'after'`. The right-edge "Total" column
  IS the grand-total column — the new option ADDS the row and
  pins the column.
- **Composition with `grandTotalRow`**: when pivot is active and
  `pivotGrandTotals: true`, the pivot grand-total row takes
  precedence. `grandTotalRow` continues to work in non-pivot mode.
- **Implementation approach (Approach A)**: compose existing
  primitives (TotalsSubgrid + pinned columns + per-row-group
  totals). Only genuinely new code is one aggregation map +
  TotalsSubgrid cell-reader extension. Sticky behavior comes for
  free from existing primitives.

## API

```typescript
interface VelocityGridOptions {
  // ...existing options

  /**
   * Excel-style grand total row + grand total column under pivot mode.
   *
   * When `true` and pivot mode is active:
   *  - A "Grand Total" row appears at the bottom (sticky — does not
   *    scroll vertically; the TotalsSubgrid already lives outside
   *    the data subgrid's vertical scroll).
   *  - The right-edge "Total" column (i.e. `pivotRowTotals: 'after'`)
   *    is implicitly enabled and pinned to the right (sticky —
   *    does not scroll horizontally; uses the existing pinned-column
   *    layout machinery).
   *  - The corner cell ("Grand Total" row × right "Total" column)
   *    shows the grand-of-grands aggregate per value column —
   *    `chunk.totals[valueColId]`, already computed by AggPass.
   *
   * No-op when pivot mode is inactive. Use `grandTotalRow` for the
   * non-pivot case. Runtime-mutable.
   *
   * @default false
   * @agModule cgrid-only — AG-Grid pivot does not provide this.
   */
  pivotGrandTotals?: boolean;
}
```

## Architecture

### Cell composition map

```
                    | pivot result cols     | "Total" col (pinned right) |
                    | (e.g. Americas×Tech)  | per row group's grand      |
─────────────────── + --------------------- + -------------------------- +
Per-group rows      | chunk.pivotValues     | chunk.groupTotals[gKey]    |  ← unchanged
─────────────────── + --------------------- + -------------------------- +
Grand Total row     | NEW chunk.pivotTotals | chunk.totals[valueColId]   |  ← new
(pinned bottom)     | per-pivot-cell agg    | grand-of-grands            |
                    | across all groups     | (already computed)         |
```

Three cell-class reads in the grand total row:

1. **Group label cell** — auto-group column at depth 0 → render
   literal string `"Grand Total"` when `kind === 'footer'` && `key === ''`.
2. **Pivot result cell** — colId matches `pivotcol_...` → read
   `chunk.pivotTotals[encodePivotPathKey(path, valueColId)]`.
3. **Corner cell** (row-total leaf, `isRowTotal: true` in
   PivotCellSpec) → read `chunk.totals[valueColId]`.

### Stickiness

Both axes are achieved with existing primitives:

- **Vertical**: `TotalsSubgrid` is a stack member positioned after
  the data subgrid; it has its own fixed `top` and never scrolls
  with the data viewport.
- **Horizontal**: the synthesized row-total leaves get
  `pinned: 'right'` so the existing pinned-column layout
  resolver places them in the right viewport, which doesn't
  follow `scrollLeft`.
- **Both axes simultaneously**: the corner cell sits at the
  intersection of the non-scrolling subgrid and the non-scrolling
  column band — it stays in the bottom-right of the viewport
  regardless of scroll position. Excel parity.

### Runtime mutation flow

```
setGridOption('pivotGrandTotals', true)
  → applyRuntimeOption case 'pivotGrandTotals'
  → updatePivotTotalsOption()
  → requestViewport()
  → worker reply with chunk.pivotTotals populated
  → maybeSyncPivotColumns: option folded into pivotTreeSignature →
    signature changed → applyPivotColumns re-synthesizes with
    pivotRowTotals: 'after' + pinned-right
  → TotalsSubgrid mounts (groupIncludeTotalFooter set to true)
  → repaint
```

## Component changes

### Worker side

- [`cgrid/src/worker/passes/pivotPass.ts`](../../cgrid/src/worker/passes/pivotPass.ts) —
  extend `PivotPassOutput` with
  `pivotTotals: Map<string, unknown>` keyed by
  `encodePivotPathKey(pivotPath, valueColId)`. Compute in the same
  scan that builds `values` — for each `(pivotPath, valueColId)`
  accumulate across ALL group keys' leaves. ~12-32 entries per
  pivot chunk (pivotPaths × value columns), negligible cost.
- [`cgrid/src/worker/protocol.ts`](../../cgrid/src/worker/protocol.ts) —
  add `pivotTotals?: Record<string, unknown>` to `ViewportChunk`.
  Serialized as a plain object so it crosses the worker boundary.
- [`cgrid/src/worker/state.ts`](../../cgrid/src/worker/state.ts) —
  wire the new map into the chunk reply (next to the existing
  `pivotValues` plumbing).

### Synthesis side

- [`cgrid/src/core/pivotColumns.ts`](../../cgrid/src/core/pivotColumns.ts) —
  accept a new `pivotGrandTotals: boolean` synthesis param.
  When `true`:
  - Force `pivotRowTotals = 'after'` when the caller passed null.
    Honour explicit `'before'` (pins those leaves to the LEFT instead).
  - Apply `pinned: 'right'` (or `'left'` if explicit `'before'`) to
    the synthesized row-total leaves.
- The existing `cellSpecById` already marks row-total leaves with
  `isRowTotal: true`; no new spec flag needed for the column. Only
  the ROW path needs new reads.

### Cell reader (VelocityGrid)

- [`cgrid/src/velocityGrid.ts`](../../cgrid/src/velocityGrid.ts) —
  extend the `TotalsSubgrid` cell lookup (around line 4658):
  - When pivot is active AND colId is a pivot result colId
    → read `chunk.pivotTotals[encodedKey]`.
  - When pivot is active AND `pivotCellSpecById.get(colId).isRowTotal`
    → read `chunk.totals[valueColId]` (already populated).
  - Auto-group leaf in the totals row → render `"Grand Total"`.
- Fold `pivotGrandTotals` into `pivotTreeSignature` alongside
  `pivotRowTotals` / `pivotColumnGroupTotals` /
  `pivotDefaultExpanded` so runtime flips force a re-synthesize.
- Construction-time mapping: when `pivotGrandTotals: true` AND
  pivot is active, force `groupIncludeTotalFooter: true` on the
  worker pipeline so the TotalsSubgrid mounts.

### Runtime options

- [`cgrid/src/core/runtimeOptions.ts`](../../cgrid/src/core/runtimeOptions.ts) —
  add `'pivotGrandTotals'` to the `RuntimeOption` union and
  `RUNTIME_OPTION_SET`. Route through the same
  `updatePivotTotalsOption()` re-synthesize hook used by
  `pivotRowTotals` / `pivotColumnGroupTotals` /
  `pivotDefaultExpanded`.

### Public API

- [`cgrid/src/types.ts`](../../cgrid/src/types.ts) — declare
  `pivotGrandTotals?: boolean` with the JSDoc copied above.

## Edge cases

- **Pivot inactive**: option no-ops. `grandTotalRow` is the
  non-pivot tool.
- **No value columns**: `chunk.pivotTotals` is empty; the grand
  total row renders the label cell + empty cells. Same as the
  current empty-value-column pivot behavior.
- **Caller sets `pivotRowTotals: null` + `pivotGrandTotals: true`**:
  the new option wins — we force `'after'` at the synthesis layer
  without mutating the stored `options.pivotRowTotals`. When
  `pivotGrandTotals` flips back to `false`, the synthesizer reads
  the unmodified caller value (`null`) and the column disappears.
  No "remember and restore" bookkeeping needed.
- **Caller sets `pivotRowTotals: 'before'` + `pivotGrandTotals: true`**:
  we honour `'before'` and pin those leaves to the LEFT.
- **Filter applied**: existing FilterPass runs before the new
  aggregation, so `pivotTotals` automatically reflects filtered
  data. No special handling.
- **Column-group totals on** (`pivotColumnGroupTotals: 'after'`):
  per-region "sum(Total)" sub-groups are present. The grand total
  row reads them through `pivotTotals` keyed by their pivotPath.
  The worker scan must include the column-group total paths
  (sentinel-marked pivotPaths) when building `pivotTotals` —
  straightforward extension to the same scan.
- **`grandTotalRow: 'bottom'` AND `pivotGrandTotals: true`**:
  TotalsSubgrid only mounts once. `pivotGrandTotals` takes
  precedence under pivot. Document.
- **Sort by a pivot value column**: the GRAND TOTAL row stays at
  the bottom regardless. Existing TotalsSubgrid footer contract.
- **Empty data set**: no rows → no aggregation → grand total row
  shows blank cells with the label "Grand Total". Acceptable.

## Testing

### Unit tests

`cgrid/tests/pivotGrandTotals.test.ts` (new):

- PivotPass output: `pivotTotals` map populated with one entry per
  `(pivotPath, valueColId)`; values match expected sums.
- Empty data: `pivotTotals` empty / all-null.
- Filter active: `pivotTotals` reflects passing leaves only.
- Synthesis: `pivotRowTotals: 'after'` forced when option is on
  and caller passed null.
- Synthesis: `pinned: 'right'` applied to row-total leaves only
  when `pivotGrandTotals: true`.
- Synthesis: `pivotRowTotals: 'before'` honoured + leaves get
  `pinned: 'left'`.

`cgrid/tests/pivotIntegration.test.ts`:

- Option on → grand total row appears at the bottom
  (`kind: 'footer'`, key `''`).
- Corner cell reads `chunk.totals[valueColId]` correctly
  (numerically verified).
- Cell at a pivot result colId in the grand total row reads
  `chunk.pivotTotals[encodedKey]`.
- Group label cell renders `"Grand Total"`.
- Runtime mutation `setGridOption('pivotGrandTotals', true)`
  triggers re-synthesize; flipping to `false` removes the row
  and reverts `pivotRowTotals`.
- Pivot inactive → option no-ops.
- Combined with `pivotColumnGroupTotals: 'after'` → grand total
  row also has values for the per-region "Total" columns.

`cgrid/tests/runtimeOptions.test.ts`: option in
`RUNTIME_OPTION_SET`; case handler routes through
`updatePivotTotalsOption()`.

### E2E

`apps/cgrid-showcase/e2e/pivot.spec.ts` — new test:

1. Verify "Grand Total" row text appears at the bottom.
2. Verify a known cell value at the corner matches the expected
   grand-of-grands sum.
3. **Sticky vertical**: scroll past the last data row; assert
   the "Grand Total" row's bounding box is still visible at
   the bottom edge.
4. **Sticky horizontal**: scroll past the last pivot column;
   assert the right-pinned "Total" leaves stay visible.
5. **Sticky both directions**: scroll both axes; assert the
   corner cell stays in the bottom-right.

### Showcase wiring

Extend `apps/cgrid-showcase/src/features/pivot.ts` with a new
"Grand totals" toggle button (`data-testid="btn-grand-totals"`)
so the feature is manually exercisable and the E2E has a target.
Optionally add a linked control to the AG-Grid comparison page
(no-op on AG — itself the differentiation).

### Visual check

After implementation, open the showcase in Chrome DevTools,
screenshot pre + post scroll, attach to the implementation PR
for review.

## Out of scope (deferred)

- Saving/restoring `pivotGrandTotals` through `getColumnState`
  (it's a grid option, not a column state — apps serialize it
  via `gridOptions` snapshots like other options).
- Customising the "Grand Total" label string (use future
  localisation hooks).
- Independent positions for row vs column (`'top'`/`'left'`).
  Pinned to Excel default in v1; the option can later evolve
  to an object shape without breaking the boolean default.
- Custom aggFunc per-axis (e.g. a row that uses `avg` while
  the matrix uses `sum`). Out of scope — apps that need this
  can wire their own aggFunc on the value column; the same
  function runs at every aggregation level.
