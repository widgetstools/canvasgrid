# 26 — Performance Knobs

## Concept

AG Grid's DOM-based renderer exposes a set of opt-in and opt-out knobs that trade correctness, convenience, or feature richness for throughput or frame-rate headroom. These fall into four categories:

1. **Virtualisation controls** — row and column virtualisation limit the DOM to only cells visible in the viewport. Disabling them is almost never correct for large datasets.
2. **Scheduling controls** — `suppressAnimationFrame` and `animateRows` govern whether work is spread across render frames or done synchronously/with animation cost.
3. **Transaction batching** — `applyTransactionAsync` + `asyncTransactionWaitMillis` amortise the cost of high-frequency row updates by coalescing them into a single pipeline pass.
4. **Miscellaneous suppressions** — `suppressPropertyNamesCheck`, `getRowId` for immutable mode, debounced scrollbar, and large-dataset row model selection.

The knobs in this area are predominantly **Community** options. Where they are row-model-specific, cross-references to `03-row-models.md`, `04-data-updates.md`, and `05-rendering-and-dom.md` apply.

## Configuration surface

### Virtualisation

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `rowBuffer` | `number` | `10` | Community | Number of rows rendered above and below the visible viewport. Larger values reduce scroll-induced blank rows at the cost of more DOM nodes. |
| `suppressRowVirtualisation` | `boolean` | `false` | Community | Disables row virtualisation; all rows are always in the DOM. Causes severe performance degradation with large datasets. |
| `suppressMaxRenderedRowRestriction` | `boolean` | `false` | Community | Removes the 500-row rendering cap that applies when `suppressRowVirtualisation` is `true` or `rowBuffer` is very large. Only relevant in those edge cases. |
| `suppressColumnVirtualisation` | `boolean` | `false` | Community | Disables column virtualisation; all columns are always rendered regardless of horizontal scroll position. Initial-only. Not recommended for wide column sets. |

### Scheduling & animation

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `animateRows` | `boolean` | `true` | Community | When `true`, rows transition to new positions with CSS animations after sort/filter changes. Setting to `false` eliminates animation overhead and is recommended for high-frequency data updates. |
| `suppressAnimationFrame` | `boolean` | `false` | Community | When `true`, all cell rendering during scroll happens synchronously on the main thread instead of being deferred to `requestAnimationFrame`. Eliminates temporarily blank cells but blocks the UI thread; degrades perceived scroll smoothness. Initial-only. |
| `debounceVerticalScrollbar` | `boolean` | `false` | Community | Debounces vertical scroll events; can smooth scrolling on slow machines at the cost of increased latency. Initial-only. |

### Transaction batching (see also `04-data-updates.md`)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `asyncTransactionWaitMillis` | `number` | `50` | Community | Time window in milliseconds during which `applyTransactionAsync` calls are accumulated before the batch is flushed to the pipeline. Lower values increase update latency; higher values reduce per-frame work. |
| `suppressModelUpdateAfterUpdateTransaction` | `boolean` | `false` | Community | When `true`, an update-only transaction (no adds or removes) does not re-run sort/filter/group. Use when data changes do not affect ordering or grouping. |

### Row identity & immutable mode (see also `03-row-models.md`)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `getRowId` | `GetRowIdFunc<TData>` | `undefined` | Community | Callback returning a stable string ID for each row. Enables delta detection on `rowData` replacement (immutable/Redux-store pattern). Without this, any `rowData` change is treated as a full reset, which is expensive for large datasets. |
| `resetRowDataOnUpdate` | `boolean` | `false` | Community | When `getRowId` is set and `rowData` changes, forces a full reset instead of delta detection. Rarely needed; mainly for resetting all row state (selection, expansion). |

### Change detection

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `suppressChangeDetection` | `boolean` | `false` | Community | Disables the value-change diffing that decides whether a cell needs re-rendering. Eliminates diffing overhead; all visible cells refresh on every pipeline pass. Useful only when cells change on every update. |

### Miscellaneous suppressions

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `suppressPropertyNamesCheck` | `boolean` | `false` | Community | @deprecated v33. Previously suppressed warnings about unrecognised `gridOptions` / `colDef` property names. Now redundant — use the `ValidationModule` and the typed `context` property for arbitrary app data instead. |
| `cacheQuickFilter` | `boolean` | `false` | Community | Caches per-row quick-filter text aggregates; avoids recomputing the aggregate string on each filter pass. Improves quick-filter performance on large datasets. |
| `valueCache` | `boolean` | `false` | Community | Caches `valueGetter` return values so they are not recomputed until the cache is expired. Requires `ValueCacheModule`. Initial-only. |
| `valueCacheNeverExpires` | `boolean` | `false` | Community | Prevents the value cache from expiring on data updates. Use with caution — stale values will be returned if data changes. Requires `valueCache: true`. Initial-only. |
| `deltaSort` | `boolean` | `false` | Community | When `true`, only rows involved in a transaction are re-sorted rather than the full dataset. Significant performance gain for large streamed datasets. Disabled automatically when `postSortRows` is configured. See `07-sorting.md`. |
| `aggregateOnlyChangedColumns` | `boolean` | `false` | Enterprise | When `true`, re-aggregation is limited to columns whose leaf values changed in the transaction. Reduces aggregation work for wide grids. See `10-aggregation.md`. |

### Large dataset row models

The most impactful performance decision for datasets beyond ~50 000 rows is choosing the right row model. The following options are configuration surfaces for the non-client-side models; full documentation is in `03-row-models.md`.

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `rowModelType` | `'clientSide' \| 'infinite' \| 'serverSide' \| 'viewport'` | `'clientSide'` | Community / Enterprise | Selects the row model. `infinite` and `serverSide` load data on demand; `viewport` pushes a window of rows from the server. Initial-only. |
| `cacheBlockSize` | `number` | `100` | Community / Enterprise | Rows fetched per block in Infinite and Server-side row models. Tune to minimise round-trips without over-fetching. |
| `maxBlocksInCache` | `number` | `undefined` (unlimited) | Community / Enterprise | LRU block eviction cap for the Infinite row model. Limits memory use for very large datasets. |
| `blockLoadDebounceMillis` | `number` | `0` | Community | Debounce before triggering a block fetch in the Infinite row model; reduces requests during fast scroll. |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `applyTransactionAsync` | `(transaction: RowDataTransaction<TData>, callback?: (res: RowNodeTransaction<TData>) => void) => void` | Community | Queues a row transaction for batched application after `asyncTransactionWaitMillis`. Reduces pipeline invocations for high-frequency updates. See `04-data-updates.md`. |
| `flushAsyncTransactions` | `() => void` | Community | Immediately flushes all pending async transactions without waiting for the timer. Useful before navigation or screenshot capture. |
| `refreshClientSideRowModel` | `(step?: ClientSideRowModelStep) => void` | Community | Re-runs the CSRM pipeline from a given step (`'group'`, `'filter'`, `'pivot'`, `'aggregate'`, `'sort'`, `'map'`). Use to force a refresh without changing data. |
| `refreshCells` | `(params?: RefreshCellsParams) => void` | Community | Re-renders specified cells in place without destroying the renderer. Lower cost than `redrawRows`. |
| `redrawRows` | `(params?: RedrawRowsParams) => void` | Community | Destroys and recreates specified rows. Higher cost than `refreshCells`; use when row structure changes. |
| `setGridOption` | `<K extends keyof GridOptions>(key: K, value: GridOptions[K]) => void` | Community | Updates a single runtime-mutable grid option, including `asyncTransactionWaitMillis` and `animateRows`. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `asyncTransactionsFlushed` | `AsyncTransactionsFlushedEvent { results: (RowNodeTransaction<TData> \| ServerSideTransactionResult<TData>)[] }` | Community | The async transaction batch is applied; contains all individual transaction results (CSRM context yields RowNodeTransaction; SSRM yields ServerSideTransactionResult). |
| `modelUpdated` | `ModelUpdatedEvent { animate?: boolean; keepRenderedRows?: boolean; newData?: boolean; newPage: boolean; newPageSize?: boolean; keepUndoRedoStack?: boolean }` | Community | Displayed rows are recomputed after any pipeline pass (sort, filter, group, transaction). |

## Behaviors / interactions

**Async transaction batching:** `applyTransactionAsync` deposits a transaction object into a queue. After `asyncTransactionWaitMillis` milliseconds of inactivity (or on `flushAsyncTransactions`), the queue is drained and all transactions are applied in a single pipeline pass. This collapses N pipeline invocations (each re-sorting, re-filtering, re-aggregating, re-rendering) into one, which is essential for tick-rate financial data. The showcase (`PositionsGrid.tsx`) uses `asyncTransactionWaitMillis: 50`. See `04-data-updates.md` for the full transaction API.

**`getRowId` immutable mode:** Providing `getRowId` unlocks delta detection when `rowData` is replaced. The grid compares old and new IDs and constructs synthetic add/update/remove transactions. Without `getRowId`, every `rowData` replacement is a full reset (destroy all rows, re-create from scratch). This is the recommended pattern for Redux/signal-based data stores. See `03-row-models.md`.

**Row virtualisation window:** The grid renders `viewport_rows + 2 × rowBuffer` rows in the DOM at any time. Increasing `rowBuffer` from its default of 10 pre-renders more rows above and below the fold, reducing blank-row flicker during fast scroll at the cost of more DOM nodes. See `05-rendering-and-dom.md`.

**Column virtualisation cost:** `suppressColumnVirtualisation` forces all N columns into the DOM simultaneously. For a 100-column grid this can multiply DOM node count by 10×. The option exists for accessibility tooling and print layouts, not for performance. See `05-rendering-and-dom.md`.

**`animateRows: false` for streaming data:** CSS row-position animations add per-frame work and are meaningless when rows update many times per second. Disabling animation is the first recommendation for high-frequency update scenarios.

**`suppressAnimationFrame` trade-off:** Enabling this option makes every scroll event render cells synchronously. It eliminates the transient blank-cell effect seen during fast scroll but blocks the main thread proportionally to the number of cells being rendered. Only appropriate for grids with very few columns or very short render times.

**Profiling tips:**
- Use the browser's Performance tab to record a scroll or transaction flush. Look for long tasks caused by the grid's synchronous pipeline (filter → sort → aggregate → map → render).
- `debug: true` + `ValidationModule` reveals misconfigured options without runtime cost in production.
- For server-side workloads, `blockLoadDebounceMillis` and `maxBlocksInCache` are the primary latency and memory levers.
- `cacheQuickFilter: true` is a near-zero-cost improvement for any grid that uses quick-filter with large datasets.

## Look & feel

N/A — no dedicated UI; see referenced areas.

## Canvas-port implications

**Knobs made obsolete by the canvas architecture:**

- **`suppressColumnVirtualisation`:** The canvas grid must always virtualise columns — painting every column every frame regardless of scroll position is not a viable option. This option has no canvas equivalent; column virtualisation is mandatory and the overscan window (canvas equivalent of `rowBuffer`) is the only tuning lever.
- **`suppressAnimationFrame`:** The canvas grid's repaint loop is inherently rAF-driven. Synchronous full-repaint on scroll would block the browser's compositor. This concept does not exist in the canvas port.
- **`suppressRowVirtualisation` / `suppressMaxRenderedRowRestriction`:** Rendering all rows to canvas simultaneously is impractical. The canvas port implements only windowed rendering. These flags have no canvas equivalent.
- **`animateRows`:** CSS transition animations are a DOM concept. The canvas grid would need an explicit interpolation pass (tweening row Y positions) to replicate row animations, which adds complexity with limited value for the target use case (high-frequency financial data). Likely omitted from v1 of the canvas port.

**Knobs that translate directly:**

- **`asyncTransactionWaitMillis` + `applyTransactionAsync`:** Transaction batching is a data-layer operation independent of the renderer. The canvas port reuses the same batching window; the only downstream difference is that the flush triggers a canvas repaint instead of DOM reconciliation. This is the highest-priority perf knob to preserve.
- **`getRowId` (immutable/delta mode):** Stable row identity and delta detection are pure data-model concerns. The canvas port must implement `getRowId` semantics to avoid full-canvas repaints on every `rowData` replacement.
- **`rowBuffer` → overscan:** The canvas port expresses the same concept as an overscan row count — the number of rows rendered above and below the visible viewport into the offscreen canvas tile. `rowBuffer` maps directly to this parameter with an equivalent default.
- **`suppressChangeDetection`:** The canvas port can apply the same optimisation: skip per-cell value comparison and always repaint changed rows. Eliminates the diff cost at the expense of unnecessary repaints.
- **`deltaSort`:** Sorting only transaction-changed rows is a data-pipeline optimisation. The canvas port benefits equally.
- **`cacheQuickFilter` / `valueCache`:** Both are data-layer caches; they translate without modification.
- **`suppressModelUpdateAfterUpdateTransaction`:** Pipeline-skip logic is renderer-agnostic and translates directly.

**New canvas-specific considerations:**

- The canvas grid can implement **dirty-region repaints** (repaint only the cells whose values changed), a granularity finer than anything the DOM renderer offers. This effectively supersedes `refreshCells` and `suppressChangeDetection` with a lower-cost automatic alternative.
- **Off-screen tile pre-rendering** (rendering the buffer region into an off-screen canvas ahead of the scroll position) is the canvas equivalent of `rowBuffer` pre-rendering, but can be done on a worker thread, eliminating main-thread cost entirely.
- Cross-ref: `03-row-models.md` for row-model selection (the most impactful performance decision for large datasets); `04-data-updates.md` for the full async transaction API; `05-rendering-and-dom.md` for DOM virtualisation details.
