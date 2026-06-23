# 15 — Server-Side Row Model

## Concept

The Server-Side Row Model (SSRM) is an Enterprise feature (`ServerSideRowModelModule`) that enables lazy, block-based loading of data from a remote source. It supports all of AG Grid's advanced features — row grouping, pivot, aggregation, tree data, infinite scrolling, and transactions — while keeping only the currently needed rows in the browser.

SSRM is introduced in `03-row-models.md` (tier comparison, `IServerSideDatasource` contract, block cache fundamentals). This area file covers the complete configuration, API, events, and behavioral detail for the SSRM exclusively.

### When to use SSRM

| Situation | Recommendation |
|-----------|---------------|
| Dataset too large for CSRM | SSRM with infinite scroll |
| Server-side grouping / pivot / aggregation | SSRM with `rowGroupCols` / `pivotCols` / `valueCols` in request |
| Hierarchical data fetched on-demand | SSRM + `treeData: true` (see `14-tree-data.md`) |
| Real-time row-level updates | SSRM + `applyServerSideTransaction` |

### Store modes

SSRM operates in two modes per group level:

- **Full store (default)** — all rows in a group level are fetched in a single request (`startRow` and `endRow` are `undefined`). Supports client-side sort and filter within the loaded data.
- **Infinite scroll store** — rows are fetched in blocks as the user scrolls. `startRow`/`endRow` are populated in every request; `cacheBlockSize` controls block size.

Set `cacheBlockSize` to a finite number to activate infinite scroll. Omitting it (or setting to `undefined`) uses full store mode for top-level rows.

## Configuration surface

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `rowModelType` | `'serverSide'` | `'clientSide'` | Enterprise | Activates SSRM. Initial-only. `@agModule ServerSideRowModelModule`. |
| `serverSideDatasource` | `IServerSideDatasource` | `undefined` | Enterprise | Datasource object; the grid calls `getRows` for each block needed. Runtime-mutable. |
| `cacheBlockSize` | `number` | `100` | Enterprise | Rows per server fetch in infinite-scroll mode. Initial-only for SSRM. |
| `maxBlocksInCache` | `number` | unlimited | Enterprise | Maximum blocks retained per store level; LRU eviction when exceeded. Initial-only. |
| `maxConcurrentDatasourceRequests` | `number` | `2` | Enterprise | Maximum parallel `getRows` calls. Initial-only. |
| `blockLoadDebounceMillis` | `number` | `undefined` | Enterprise | Milliseconds to wait before issuing a block request; prevents thrashing during fast scroll. Initial-only. |
| `serverSideInitialRowCount` | `number` | `1` | Enterprise | Number of loading placeholder rows shown at root level before first `getRows` resolves. Initial-only. |
| `suppressServerSideFullWidthLoadingRow` | `boolean` | `false` | Enterprise | Uses column-scoped loading cell renderers (`colDef.loadingCellRenderer`) instead of a full-width loading row. |
| `purgeClosedRowNodes` | `boolean` | `false` | Enterprise | Destroys cached child data when a group row collapses. Next expansion re-fetches from the server. |
| `serverSideSortAllLevels` | `boolean` | `false` | Enterprise | On sort change, refreshes all group levels (not just the top level). Use when the server sorts within all groups. |
| `serverSideEnableClientSideSort` | `boolean` | `false` | Enterprise | Sorts fully-loaded group-level blocks in the browser without a server round-trip. |
| `serverSideOnlyRefreshFilteredGroups` | `boolean` | `false` | Enterprise | On filter change, only refreshes groups directly affected. Initial-only. |
| `serverSidePivotResultFieldSeparator` | `string` | `'_'` | Enterprise | Separator used when constructing pivot result field names from `pivotResultFields`. Initial-only. |

### `IServerSideDatasource` contract (verbatim from `.d.ts`)

```typescript
interface IServerSideDatasource<TData = any> {
  getRows(params: IServerSideGetRowsParams<TData>): void;
  destroy?(): void;
}

interface IServerSideGetRowsParams<TData = any, TContext = any> {
  request: IServerSideGetRowsRequest;
  parentNode: IRowNode<TData>;
  needsGrandTotal: boolean;
  success(params: LoadSuccessParams<TData>): void;
  fail(): void;
}

interface IServerSideGetRowsRequest {
  startRow: number | undefined;      // undefined = full store
  endRow: number | undefined;        // undefined = full store
  rowGroupCols: ColumnVO[];
  valueCols: ColumnVO[];
  pivotCols: ColumnVO[];
  pivotMode: boolean;
  groupKeys: string[];               // [] = root; ['USA'] = children of USA
  filterModel: FilterModel | AdvancedFilterModel | null;
  sortModel: SortModelItem[];
}

interface LoadSuccessParams<TData = any> {
  rowData: TData[];
  rowCount?: number;           // last row index (infinite scroll); total if known
  groupLevelInfo?: any;        // arbitrary metadata stored on the store
  pivotResultFields?: string[];  // dynamic pivot column fields
  grandTotalData?: Partial<TData> | null;  // grand total row; null removes it
}
```

### `ServerSideTransaction` contract

```typescript
interface ServerSideTransaction<TData = any> {
  route?: string[];     // group path, e.g. ['Canada', '2002']; [] = root
  addIndex?: number;    // insert position; omit to append
  add?: TData[];
  remove?: TData[];
  update?: TData[];
  rowCount?: number;    // updated total when deletions affect rows not in cache
}

interface ServerSideTransactionResult<TData = any> {
  status: ServerSideTransactionResultStatus;
  add?: IRowNode<TData>[];
  remove?: IRowNode<TData>[];
  update?: IRowNode<TData>[];
}
```

`ServerSideTransactionResultStatus` values: `Applied`, `StoreNotFound`, `StoreLoading`, `StoreWaitingToLoad`, `StoreLoadingFailed`, `StoreWrongType`, `Cancelled`, `StoreNotStarted`.

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `refreshServerSide` | `(params?: RefreshServerSideParams) => void` | Enterprise | Refreshes a store level. No params = root level. `route` targets a specific group path. `purge: true` immediately destroys rows and shows loading placeholders; `purge: false` keeps existing rows until new data arrives. |
| `getServerSideGroupLevelState` | `() => ServerSideGroupLevelState[]` | Enterprise | Returns info on all expanded group levels including row count, block size, and `lastRowIndexKnown` per level. |
| `applyServerSideTransaction` | `(transaction: ServerSideTransaction) => ServerSideTransactionResult<TData> \| undefined` | Enterprise | Synchronously applies an add/remove/update transaction to a store level. Returns status and affected row nodes. |
| `applyServerSideTransactionAsync` | `(transaction: ServerSideTransaction, callback?) => void` | Enterprise | Queues a transaction for batched processing. Callback receives the result. |
| `flushServerSideAsyncTransactions` | `() => void` | Enterprise | Immediately processes all queued async transactions. |
| `applyServerSideRowData` | `(params: { successParams: LoadSuccessParams<TData>; route?: string[]; startRow?: number }) => void` | Enterprise | Directly applies a `LoadSuccessParams` payload to a store level, as if it came from a datasource success callback. |
| `retryServerSideLoads` | `() => void` | Enterprise | Retries all stores that are in a failed load state. |
| `getServerSideSelectionState` | `() => IServerSideSelectionState \| IServerSideGroupSelectionState \| null` | Enterprise | Returns the current SSRM selection state (rule set, not row IDs). See `12-selection.md`. |
| `setServerSideSelectionState` | `(state: IServerSideSelectionState \| IServerSideGroupSelectionState) => void` | Enterprise | Restores previously saved SSRM selection state. See `12-selection.md`. |
| `getCacheBlockState` | `() => any` | Community | Returns raw block cache state for all levels — useful for debugging. |

### `RefreshServerSideParams`

```typescript
interface RefreshServerSideParams {
  route?: string[];  // [] or undefined = root; ['Canada', '2002'] = specific level
  purge?: boolean;   // true: destroy rows immediately; false: keep until reload completes
}
```

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `storeRefreshed` | `StoreRefreshedEvent { route?: string[] }` | Enterprise | A store level completes refreshing. `route` is `undefined` for the root level; otherwise the group key path. |
| `modelUpdated` | `ModelUpdatedEvent { animate: boolean; keepRenderedRows: boolean; newData: boolean; newPage: boolean }` | Community | The displayed row set changes (after a store refresh, transaction, sort, or filter). |
| `selectionChanged` | `SelectionChangedEvent { source: SelectionEventSourceType; selectedNodes: IRowNode[] \| null; serverSideState: IServerSideSelectionState \| IServerSideGroupSelectionState \| null }` | Community | Selection changes in SSRM. `selectedNodes` is `null` for SSRM select-all; read `serverSideState` instead. |

## Behaviors / interactions

### `getRows` lifecycle

The grid calls `getRows` whenever it needs data for a block or group level:
1. Root level (no grouping): one `getRows` call with `groupKeys: []`.
2. Group level expanded: one `getRows` call per group with the key path in `groupKeys`.
3. Infinite scroll: repeated calls as the user scrolls, with `startRow`/`endRow` advancing by `cacheBlockSize`.

Call `params.success({ rowData, rowCount })` with the fetched rows. `rowCount` is optional; providing it tells the grid the total rows at this level, enabling the scroll thumb to reflect the true dataset size. Call `params.fail()` on error; the grid shows a failed-load row and enables `retryServerSideLoads`.

### Grouping and pivot in SSRM

`IServerSideGetRowsRequest` carries the full grouping/pivot/sort/filter context:
- `rowGroupCols` — which columns are grouped, in order.
- `valueCols` — which columns have aggregations (with `aggFunc`).
- `pivotCols` — which columns are pivoted.
- `pivotMode` — whether pivot mode is active.

The server is responsible for computing aggregations and returning only the rows for the requested group level. The grid does not aggregate server-returned data unless `serverSideEnableClientSideSort` is enabled for sorting within a loaded level.

Supply `pivotResultFields` in `LoadSuccessParams` to let the grid generate secondary (pivot result) columns dynamically; use `serverSidePivotResultFieldSeparator` to control the field-name format. See `11-pivoting.md` for pivot column generation details.

### Transactions (`applyServerSideTransaction`)

Transactions allow incremental updates without re-fetching entire blocks. Requirements:
- The target store must be loaded (`route` must point to an already-expanded group, or root).
- The store must be in full-store mode (not infinite scroll). `StoreWrongType` is returned for infinite-scroll stores.
- `getRowId` must be set on the grid so the SSRM can match existing rows for updates and removes.

Use `applyServerSideRowData` for infinite-scroll stores to overwrite a specific block range.

### Group state restoration

Use `getServerSideGroupLevelState()` to capture which groups are expanded. After re-setting the datasource, call `setGridOption('serverSideDatasource', newDatasource)` then restore expanded state by programmatically calling `setRowNodeExpanded` for each previously expanded group. Alternatively, use `api.getState()` / `api.setState()` with `GridStateModule` to persist and restore grid state, which includes SSRM expansion.

### Grand total row

Pass `grandTotalData` in `LoadSuccessParams` to insert or update a grand total footer row at the root level. Pass `null` to remove an existing grand total row. The `needsGrandTotal` flag in `IServerSideGetRowsParams` is a hint from the grid that it does not have cached grand total data — the server may always return grand total data regardless.

### Selection in SSRM

Because not all rows are in memory, selection is stored as a rule set. `getServerSideSelectionState()` returns `IServerSideSelectionState` (flat) or `IServerSideGroupSelectionState` (hierarchical, when `groupSelects: 'descendants'`). Persist and restore this state around datasource refreshes to maintain user selection. See `12-selection.md` for full selection configuration.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- SSRM is purely a data-fetching contract (`IServerSideDatasource`); the datasource interface has no DOM dependency and can be adopted unchanged by the canvas port.
- The canvas port needs a block-cache layer: a dictionary of `route → blocks[]`, each block being an array of row data objects, with LRU eviction when `maxBlocksInCache` is exceeded.
- Infinite scroll in canvas: as the user scrolls, the layout engine calculates which block indices are visible and triggers `getRows` for any uncached blocks. Loading placeholders should be painted for in-flight blocks.
- Grand total and group footer rows need designated row-type flags in the canvas row model so the renderer can style them differently.
- Transactions applied to the canvas block cache must invalidate the affected blocks' pixel bounds and trigger a repaint for the visible portion.
- SSRM pivot generates a dynamic column set (`pivotResultFields`); the canvas column model must support runtime column insertion mid-render, similar to the challenge described in `11-pivoting.md`.
- `serverSideEnableClientSideSort` reduces round-trips at the cost of holding a full group level in memory; in a canvas port this is likely the right default for small groups that fit in one block.
