# 03 — Row Models

## Concept

AG Grid supports four distinct row models, selected via `gridOptions.rowModelType`. Each model controls
how data is fetched, stored, and paginated:

| Model | `rowModelType` | Tier | Best for |
|-------|---------------|------|----------|
| Client-Side (CSRM) | `'clientSide'` | Community | All rows in memory; supports grouping, pivot, tree data |
| Infinite | `'infinite'` | Community | Large flat datasets fetched in blocks; no grouping |
| Viewport | `'viewport'` | Enterprise | Only the visible window of rows is loaded; for real-time feeds |
| Server-Side (SSRM) | `'serverSide'` | Enterprise | Lazy loading with grouping/pivot/tree support |

`rowModelType` is **initial-only**: it cannot be changed after grid creation.

## Configuration surface

### Client-Side Row Model

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `rowData` | `TData[] \| null` | `undefined` | Community | Inline array of all row data objects. Runtime-mutable. |
| `getRowId` | `GetRowIdFunc<TData>` | `undefined` | Community | Returns a unique string ID per row. Enables delta detection. Initial-only. |
| `resetRowDataOnUpdate` | `boolean` | `false` | Community | When `getRowId` is implemented, treats new `rowData` as fully new dataset. |
| `asyncTransactionWaitMillis` | `number` | `undefined` | Community | Batching window (ms) for `applyTransactionAsync`. Runtime-mutable. |
| `suppressModelUpdateAfterUpdateTransaction` | `boolean` | `false` | Community | Skips sort/filter refresh for update-only transactions. |

### Infinite Row Model

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `datasource` | `IDatasource` | `undefined` | Community | Datasource implementation. Runtime-mutable. |
| `cacheBlockSize` | `number` | `100` | Community | Rows per fetched block. Initial-only. |
| `cacheOverflowSize` | `number` | `1` | Community | Extra blank rows shown beyond end of dataset to trigger scroll-loading. Initial-only. |
| `infiniteInitialRowCount` | `number` | `1` | Community | Initial loading row count at start. Initial-only. |
| `maxBlocksInCache` | `number` | unlimited | Community | Max blocks kept; LRU eviction when exceeded. Initial-only. |
| `maxConcurrentDatasourceRequests` | `number` | `2` | Community | Maximum parallel `getRows` calls. Initial-only. |
| `blockLoadDebounceMillis` | `number` | `undefined` | Community | Delay before fetching a block (useful when fast-scrolling). Initial-only. |

### Viewport Row Model

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `viewportDatasource` | `IViewportDatasource` | `undefined` | Enterprise | Datasource controlling the viewport window. Runtime-mutable. |
| `viewportRowModelPageSize` | `number` | `undefined` | Enterprise | Page size for viewport model. Initial-only. |
| `viewportRowModelBufferSize` | `number` | `undefined` | Enterprise | Buffer rows above/below visible range. Initial-only. |

### Server-Side Row Model

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `serverSideDatasource` | `IServerSideDatasource` | `undefined` | Enterprise | Datasource providing rows on demand. Runtime-mutable. |
| `cacheBlockSize` | `number` | `100` | Enterprise | Rows per server block. Runtime-mutable. |
| `maxBlocksInCache` | `number` | unlimited | Enterprise | Max cached blocks; LRU eviction. Initial-only. |
| `serverSideInitialRowCount` | `number` | `1` | Enterprise | Loading placeholder row count for root level. Initial-only. |
| `purgeClosedRowNodes` | `boolean` | `false` | Enterprise | Removes cached child data when a group row is collapsed. |
| `serverSideSortAllLevels` | `boolean` | `false` | Enterprise | Refreshes all group levels on sort change. |
| `serverSideEnableClientSideSort` | `boolean` | `false` | Enterprise | Sorts fully-loaded blocks in the browser. |
| `serverSideOnlyRefreshFilteredGroups` | `boolean` | `false` | Enterprise | Only refreshes groups affected by a filter change. Initial-only. |
| `serverSidePivotResultFieldSeparator` | `string` | `'_'` | Enterprise | Separator for pivot result field strings. Initial-only. |
| `suppressServerSideFullWidthLoadingRow` | `boolean` | `undefined` | Enterprise | Uses column-level loading renderers instead of full-width loading row. |

## API methods

### Client-Side Row Model

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `applyTransaction` | `(rowDataTransaction: RowDataTransaction<TData>) => RowNodeTransaction<TData> \| null` | Community | Synchronously adds, removes, or updates rows. |
| `applyTransactionAsync` | `(rowDataTransaction: RowDataTransaction<TData>, callback?) => void` | Community | Queues a transaction for batched processing. |
| `flushAsyncTransactions` | `() => void` | Community | Immediately executes all pending async transactions. |
| `refreshClientSideRowModel` | `(step?: ClientSideRowModelStep) => void` | Community | Re-runs grouping, filtering, or sorting from the specified pipeline step. |
| `forEachNode` | `(callback: (rowNode, index) => void, includeFooterNodes?) => void` | Community | Iterates all row nodes (unfiltered, unsorted). |
| `forEachLeafNode` | `(callback: (rowNode) => void) => void` | Community | Iterates leaf (data) nodes only. |
| `forEachNodeAfterFilter` | `(callback: (rowNode, index) => void) => void` | Community | Iterates nodes that pass current filters. |
| `forEachNodeAfterFilterAndSort` | `(callback: (rowNode, index) => void) => void` | Community | Iterates nodes in current display order. |
| `isRowDataEmpty` | `() => boolean` | Community | Returns `true` if no rows exist in the model. |

### All row models

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `getRowNode` | `(id: string) => IRowNode<TData> \| undefined` | Community | Looks up a row node by its `getRowId` return value. |
| `getRenderedNodes` | `() => IRowNode<TData>[]` | Community | Returns currently rendered row nodes (viewport + buffer). |
| `getDisplayedRowCount` | `() => number` | Community | Returns the count of currently displayed rows. |
| `getDisplayedRowAtIndex` | `(index: number) => IRowNode<TData> \| undefined` | Community | Returns the displayed row node at the given index. |
| `getFirstDisplayedRowIndex` | `() => number` | Community | Index of the first row currently in the rendered viewport. |
| `getLastDisplayedRowIndex` | `() => number` | Community | Index of the last row currently in the rendered viewport. |
| `setRowCount` | `(rowCount: number, maxRowFound?: boolean) => void` | Community | Sets virtual row count (Infinite / SSRM). |
| `getCacheBlockState` | `() => any` | Community | Returns block cache state (Infinite / SSRM) for debugging. |
| `resetRowHeights` | `() => void` | Community | Forces the grid to recalculate all row heights. |
| `onRowHeightChanged` | `() => void` | Community | Notifies the grid that a specific row's height has changed. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `rowDataUpdated` | `RowDataUpdatedEvent` | Community | New row data is set on CSRM (via `rowData` option or `setGridOption`). |
| `modelUpdated` | `ModelUpdatedEvent { animate, keepRenderedRows, newData, newPage }` | Community | Row model recomputes displayed rows (after sort, filter, grouping, or data change). |
| `asyncTransactionsFlushed` | `AsyncTransactionsFlushedEvent { results: RowNodeTransaction[] }` | Community | Pending async transactions are flushed and applied. |
| `storeRefreshed` | `StoreRefreshedEvent { route? }` | Enterprise | SSRM store (at a specific group path) finishes refreshing. |

## Behaviors / interactions

### `getRowId` semantics and delta detection

When `getRowId` is provided, AG Grid uses row IDs to reconcile data changes:
- **`setGridOption('rowData', newArray)`** with `getRowId`: rows are matched by ID. Matched rows receive
  an update; unmatched old rows are removed; new IDs are added. The grid preserves selection and expand/
  collapse state for matched rows.
- **Without `getRowId`**: any `rowData` change is treated as a full replacement; all row state is lost.
- **`resetRowDataOnUpdate: true`**: forces full-replacement behaviour even when `getRowId` is implemented.
- The `getRowId` callback must be a pure function and return a unique, stable string for the lifetime of
  the row. Returning the same ID for different logical rows causes undefined behaviour.

### `IDatasource` contract (Infinite Row Model)

```typescript
interface IDatasource {
  rowCount?: number;
  getRows(params: IGetRowsParams): void;
  destroy?(): void;
}

interface IGetRowsParams {
  startRow: number;
  endRow: number;
  successCallback(rowsThisBlock: any[], lastRow?: number): void;
  failCallback(): void;
  sortModel: SortModelItem[];
  filterModel: any;
}
```

The grid calls `getRows` for each block it needs. Call `successCallback` with the rows for that block.
Pass `lastRow` when the total count is known to stop the grid requesting further blocks.

### `IViewportDatasource` contract (Viewport Row Model)

```typescript
interface IViewportDatasource {
  init(params: IViewportDatasourceParams): void;
  setViewportRange(firstRow: number, lastRow: number): void;
  destroy?(): void;
}

interface IViewportDatasourceParams {
  setRowCount(count: number, keepRenderedRows?: boolean): void;
  setRowData(rowData: { [key: number]: any }): void;
  getRow(rowIndex: number): IRowNode;
}
```

The grid calls `setViewportRange` on every scroll; the datasource pushes data for the visible window
via `params.setRowData`. Only rows within the range need to be present; the rest are rendered as
loading placeholders.

### `IServerSideDatasource` contract (Server-Side Row Model)

```typescript
interface IServerSideDatasource<TData = any> {
  getRows(params: IServerSideGetRowsParams<TData>): void;
  destroy?(): void;
}

interface IServerSideGetRowsParams<TData> {
  request: IServerSideGetRowsRequest;
  parentNode: IRowNode<TData>;
  needsGrandTotal: boolean;
  success(params: LoadSuccessParams<TData>): void;
  fail(): void;
}

interface IServerSideGetRowsRequest {
  startRow: number | undefined;
  endRow: number | undefined;
  rowGroupCols: ColumnVO[];
  valueCols: ColumnVO[];
  pivotCols: ColumnVO[];
  pivotMode: boolean;
  groupKeys: string[];
  filterModel: FilterModel | AdvancedFilterModel | null;
  sortModel: SortModelItem[];
}
```

`groupKeys` navigates the group hierarchy: an empty array is the root, `['USA']` is the children of
the "USA" group. Call `success(params)` with `rowData` and optional `rowCount`.

### Block cache

Both Infinite and SSRM use a block cache. `cacheBlockSize` determines how many rows each server call
returns. `maxBlocksInCache` caps memory usage; when exceeded the least-recently-used block is evicted.
`maxConcurrentDatasourceRequests` throttles parallel requests to the server.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- The canvas grid must select a row model at construction time and treat it as immutable. Allowing runtime
  model switching would require a full canvas/data rebuild.
- For CSRM delta detection the canvas engine needs a `getRowId` equivalent. Without it, any data update
  triggers a full repaint. Q: should the canvas port mandate `getRowId` for all use?
- The `IDatasource` / `IServerSideDatasource` contracts are pure data contracts with no DOM dependency;
  they can be reused directly in the canvas port.
- The Viewport Row Model's push-based API (`setRowData({ [index]: data })`) maps well to a canvas grid's
  dirty-tile system: only tiles covering the viewport need live data.
- Block-cache management (LRU eviction, debounce) must be re-implemented independently of the DOM
  rendering layer. The block cache is logically separate from the render layer.
- Q: Does the canvas port target all four row models, or start with CSRM + SSRM only? Infinite and
  Viewport are lower priority for a financial-grid use case.
