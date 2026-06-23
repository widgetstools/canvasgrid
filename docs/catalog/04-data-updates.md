# 04 — Data Updates

## Concept

Data updates in the Client-Side Row Model (CSRM) follow three patterns:

1. **Full replacement** — set `rowData` via `api.setGridOption('rowData', newArray)`. Without `getRowId`,
   every row is destroyed and recreated. With `getRowId`, the grid performs delta detection: matched rows
   receive an update, unmatched rows are removed, new IDs are added. See `03-row-models.md` for `getRowId`
   semantics.

2. **Synchronous transaction** — `api.applyTransaction({ add, update, remove })`. Provides fine-grained
   control over which rows change. Returns a `RowNodeTransaction` result object. Executes on the calling
   thread; causes an immediate re-render.

3. **Asynchronous transaction** — `api.applyTransactionAsync(...)`. Transactions accumulate in a queue and
   are flushed after `asyncTransactionWaitMillis` milliseconds (or when `flushAsyncTransactions()` is
   called). Enables high-frequency updates (e.g. streaming ticks) without per-update renders.

Post-update, the grid provides targeted refresh APIs to update cell display without re-running the full
data pipeline.

## Configuration surface

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `getRowId` | `GetRowIdFunc<TData>` | `undefined` | Community | Pure function returning a stable, unique string ID per row. Enables delta detection. Initial-only. See `03-row-models.md`. |
| `resetRowDataOnUpdate` | `boolean` | `false` | Community | Forces full-replacement when new `rowData` is set, even with `getRowId`. |
| `asyncTransactionWaitMillis` | `number` | `undefined` | Community | Batching window in milliseconds for `applyTransactionAsync`. Runtime-mutable. |
| `suppressModelUpdateAfterUpdateTransaction` | `boolean` | `false` | Community | Prevents sort/filter/group refresh when a transaction contains only updates (no adds/removes). Runtime-mutable. |
| `enableCellChangeFlash` | `boolean` (per ColDef) | `false` | Community | Configured on `ColDef`; flashes a cell when its value changes due to any update. |
| `cellFlashDuration` | `number` | `500` | Community | Duration in milliseconds that the flash highlight stays on the cell. Runtime-mutable. |
| `cellFadeDuration` | `number` | `1000` | Community | Duration in milliseconds for the flash fade-out. Runtime-mutable. |
| `allowShowChangeAfterFilter` | `boolean` | `false` | Community | Cells flash even when the data change is due to filtering. Initial-only. |
| `deltaSort` | `boolean` | `false` | Community | Sorts only the rows added/updated by a transaction, not all rows. Ignored when `postSortRows` is set. Runtime-mutable. |
| `suppressChangeDetection` | `boolean` | `false` | Community | Disables change detection; all cells refresh on every update. Runtime-mutable. |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `setGridOption('rowData', data)` | `(key: 'rowData', value: TData[] \| null) => void` | Community | Replaces the entire dataset. Delta-detects if `getRowId` is provided. |
| `applyTransaction` | `(rowDataTransaction: RowDataTransaction<TData>) => RowNodeTransaction<TData> \| null` | Community | Synchronously applies an add/update/remove transaction. |
| `applyTransactionAsync` | `(rowDataTransaction: RowDataTransaction<TData>, callback?: (res: RowNodeTransaction<TData>) => void) => void` | Community | Queues a transaction for batched async processing. |
| `flushAsyncTransactions` | `() => void` | Community | Immediately flushes all pending async transactions. |
| `refreshCells` | `(params?: RefreshCellsParams<TData>) => void` | Community | Re-renders cells in place without destroying them. Skips if value has not changed (unless `force: true`). |
| `redrawRows` | `(params?: RedrawRowsParams<TData>) => void` | Community | Destroys and recreates the specified rows from scratch. |
| `flashCells` | `(params?: FlashCellsParams<TData>) => void` | Community | Triggers the flash animation on specified cells. |
| `refreshClientSideRowModel` | `(step?: ClientSideRowModelStep) => void` | Community | Re-runs the CSRM pipeline from a given step (group, filter, sort, map, aggregate, pivot, everything). |
| `onRowHeightChanged` | `() => void` | Community | Tells the grid to re-evaluate row heights after manual changes. |
| `resetRowHeights` | `() => void` | Community | Forces recalculation of all row heights. |

### `RowDataTransaction<TData>` shape

```typescript
interface RowDataTransaction<TData = any> {
  addIndex?: number | null;   // Index at which to insert added rows
  add?: TData[] | null;       // Rows to add
  remove?: TData[] | null;    // Rows to remove (matched by getRowId or object identity)
  update?: TData[] | null;    // Rows to update (matched by getRowId or object identity)
}
```

### `RefreshCellsParams<TData>` shape

```typescript
interface RefreshCellsParams<TData> {
  rowNodes?: IRowNode<TData>[];  // Restrict to these row nodes
  columns?: (string | Column)[]; // Restrict to these columns
  force?: boolean;               // Refresh even if value has not changed
  suppressFlash?: boolean;       // Do not flash the cell when refreshing
}
```

### `FlashCellsParams<TData>` shape

```typescript
interface FlashCellsParams<TData> {
  rowNodes?: IRowNode<TData>[];   // Restrict to these row nodes
  columns?: (string | Column)[];  // Restrict to these columns
  flashDuration?: number;         // Override cellFlashDuration for this call
  fadeDuration?: number;          // Override cellFadeDuration for this call
}
```

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `rowDataUpdated` | `RowDataUpdatedEvent` | Community | `rowData` has been set or updated on CSRM. |
| `modelUpdated` | `ModelUpdatedEvent { animate, keepRenderedRows, newData, newPage }` | Community | Displayed rows recomputed after any data change, sort, or filter. |
| `asyncTransactionsFlushed` | `AsyncTransactionsFlushedEvent { results: RowNodeTransaction[] }` | Community | Queued async transactions are applied in a single flush pass. |
| `cellValueChanged` | `CellValueChangedEvent { oldValue, newValue, source }` | Community | A cell value changes due to editing, paste, undo/redo, or API. |

## Behaviors / interactions

**Full-replacement vs delta detection:**
When `getRowId` is absent, every call to `setGridOption('rowData', array)` destroys all existing rows and
creates new ones. Scroll position, selection, and row expand/collapse state are all lost.
When `getRowId` is present, the grid matches old and new arrays by ID:
- Row with matching ID: receives `update` semantics; keeps its row node and state.
- New ID with no match: added as a new row.
- Old ID with no new match: removed.
This reconciliation is equivalent to `applyTransaction({ add, update, remove })` computed automatically.

**Async transaction batching:**
`applyTransactionAsync` enqueues transactions. The grid flushes all queued transactions together after
`asyncTransactionWaitMillis` milliseconds using a single `setTimeout`. During the wait window, new
transactions continue to accumulate. Calling `flushAsyncTransactions()` bypasses the timer and executes
immediately. The callback (second argument to `applyTransactionAsync`) is called once the transaction is
applied, as part of the batch result in `asyncTransactionsFlushed`.

The showcase (`PositionsGrid.tsx`) uses `asyncTransactionWaitMillis: 50` and calls
`applyTransactionAsync({ update: updates })` on each STOMP tick to achieve sub-frame batching of high-
frequency position updates.

**Immutable data mode (delta via `setRowData`):**
Some state-management architectures maintain a single immutable array in a store. In this pattern the
application replaces `rowData` on every update (rather than calling `applyTransaction`). Providing
`getRowId` makes this efficient by enabling delta detection. `resetRowDataOnUpdate: true` disables delta
detection again even when `getRowId` is provided — useful when the application needs all row state reset.

**`refreshCells` vs `redrawRows`:**
`refreshCells` re-invokes the `valueGetter` and `cellRenderer.refresh()` for matching cells without
touching the row DOM node. It is the cheaper update path. `redrawRows` destroys the entire row DOM and
recreates it — necessary when structural changes (row height, pinned state) cannot be applied in place.

**`enableCellChangeFlash` and `flashCells`:**
`enableCellChangeFlash` on a `ColDef` causes the cell to flash automatically when its value changes
during a transaction or `refreshCells` call. `flashCells` provides programmatic control independent of
value changes — useful for drawing user attention to streamed updates. Flash duration is controlled by
`cellFlashDuration` (hold duration) and `cellFadeDuration` (fade-out duration).

**`deltaSort`:**
When `deltaSort: true`, only the rows added or updated by the most recent transaction are re-sorted, not
the entire dataset. This significantly improves performance for large sorted datasets receiving sparse
updates. It is silently ignored when `postSortRows` is configured (a full sort is then always required).

**`suppressModelUpdateAfterUpdateTransaction`:**
When a transaction contains only `update` entries (no `add` or `remove`), setting this option to `true`
skips the grouping, sort, and filter pipeline. Use this when updates change only display values and not
sort keys or filter-eligible fields.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- The three update patterns (full-replace, sync transaction, async transaction) must all be supported in
  the canvas port. The async batching pattern is especially important for high-frequency financial feeds.
- Delta detection requires the canvas engine to maintain a live row-node registry keyed by `getRowId`.
  Without this, every tick causes a full canvas redraw.
- `cellFlashDuration` / `cellFadeDuration` must be implemented as a per-cell animation primitive. In a
  canvas context this means a CSS transition cannot be used; the engine must schedule a per-frame repaint
  of the affected cell with interpolated highlight colour.
- `refreshCells` maps to a "dirty-cell" mark-and-repaint pass: mark specific (row, col) pairs dirty,
  then repaint only those cells in the next frame. `redrawRows` maps to a row-level dirty mark.
- `suppressModelUpdateAfterUpdateTransaction` is a performance hint that the canvas port should support;
  skipping the pipeline for value-only updates is proportionally more impactful in a canvas grid because
  the draw call budget is tighter.
- Q: Should the canvas port expose `flashCells` as a first-class API with the same signature, or express
  flash as a cell-level animation hook?
- Q: `deltaSort` requires knowing which rows changed in a transaction — the canvas engine's layout
  manager must track this to avoid re-sorting the full visible tile set on every tick.
