# 23 — API Methods Catalog

## Concept

The `GridApi<TData>` object is returned by the framework component or accessible via the `api`
property on every event. In AG Grid 35.x, the former `ColumnApi` has been fully merged into
`GridApi` — there is no separate `ColumnApi`. All methods below are members of `GridApi`.

Methods are grouped by functional area. Each row includes the `@agModule` annotation from the
`.d.ts` that controls which module must be registered. Community methods require only the standard
Community bundle; Enterprise methods require the Enterprise bundle (or the specific module listed).

This file is a **flat reference index**. Deeper explanations live in the originating area files
referenced in each row.

## Look & feel

N/A — reference catalog, no UI of its own.

## Configuration surface

N/A — see individual area files.

## Behaviors / interactions

N/A — see individual area files.

## Events

N/A — see `22-events.md` for the events reference catalog. Individual area files document the events relevant to their feature.

## API methods

### Lifecycle

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `getGridId` | `(): string` | Community | `01-grid-options.md` | Returns the `gridId` for this grid instance (auto-assigned if none provided). |
| `destroy` | `(): void` | Community | `01-grid-options.md` | Destroys the grid and releases all resources. Call when using Web Components or native JS. |
| `isDestroyed` | `(): boolean` | Community | `01-grid-options.md` | Returns `true` if the grid has been destroyed. |
| `getGridOption` | `<Key extends keyof GridOptions<TData>>(key: Key): GridOptions<TData>[Key]` | Community | `01-grid-options.md` | Returns the current value of a grid option. |
| `setGridOption` | `<Key extends ManagedGridOptionKey>(key: Key, value: GridOptions<TData>[Key]): void` | Community | `01-grid-options.md` | Updates a single runtime-mutable grid option. |
| `updateGridOptions` | `<TDataUpdate extends TData>(options: ManagedGridOptions<TDataUpdate>): void` | Community | `01-grid-options.md` | Batch-updates multiple runtime-mutable grid options. |
| `isModuleRegistered` | `(moduleName: AgModuleName): boolean` | Community | `01-grid-options.md` | Checks if a named module is registered with this grid instance. |
| `getState` | `(): GridState` | Community | `01-grid-options.md` | Returns a serialisable snapshot of current grid state (`GridStateModule`). |
| `setState` | `(state: GridState, propertiesToIgnore?: GridStateKey[]): void` | Community | `01-grid-options.md` | Restores grid state from a previously saved snapshot. |
| `addEventListener` | `<TEventType extends AgPublicEventType>(eventType: TEventType, listener: AgEventListener<TData, any, TEventType>): void` | Community | `22-events.md` | Subscribes to a grid event. Listener auto-removed when grid is destroyed (`EventApiModule`). |
| `removeEventListener` | `<TEventType extends AgPublicEventType>(eventType: TEventType, listener: AgEventListener<TData, any, TEventType>): void` | Community | `22-events.md` | Removes a previously added event listener (`EventApiModule`). |
| `addGlobalListener` | `<TEventType extends AgPublicEventType>(listener: AgGlobalEventListener<TData, any, TEventType>): void` | Community | `22-events.md` | Subscribes to all event types; listener receives `(eventType, event)` (`EventApiModule`). |
| `removeGlobalListener` | `<TEventType extends AgPublicEventType>(listener: AgGlobalEventListener<TData, any, TEventType>): void` | Community | `22-events.md` | Removes a global event listener (`EventApiModule`). |
| `dispatchEvent` | `(event: AgEvent): void` | Community | `22-events.md` | Dispatches a custom event through the grid event system. |

### Data

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `applyTransaction` | `(rowDataTransaction: RowDataTransaction<TData>): RowNodeTransaction<TData> \| null \| undefined` | Community | `04-data-updates.md` | Applies an add/remove/update transaction synchronously (`ClientSideRowModelApiModule`). |
| `applyTransactionAsync` | `(rowDataTransaction: RowDataTransaction<TData>, callback?: (res: RowNodeTransaction<TData>) => void): void` | Community | `04-data-updates.md` | Applies a transaction asynchronously (batched); optional callback on completion (`ClientSideRowModelApiModule`). |
| `flushAsyncTransactions` | `(): void` | Community | `04-data-updates.md` | Executes any waiting async transactions immediately (`ClientSideRowModelApiModule`). |
| `isRowDataEmpty` | `(): boolean` | Community | `04-data-updates.md` | Returns `true` if the CSRM has no rows (unaffected by filtering or pinned rows) (`ClientSideRowModelApiModule`). |
| `refreshClientSideRowModel` | `(step?: ClientSideRowModelStep): void` | Community | `03-row-models.md` | Re-runs grouping, filtering, and sorting; optionally from a specific step (`ClientSideRowModelApiModule`). |
| `setRowCount` | `(rowCount: number, maxRowFound?: boolean): void` | Community | `03-row-models.md` | Sets `rowCount` and optionally `maxRowFound` for Infinite/SSRM (`InfiniteRowModelModule / ServerSideRowModelApiModule`). |
| `getCacheBlockState` | `(): any` | Community / Enterprise | `03-row-models.md` | Returns the current cache block state; Community via InfiniteRowModelModule; Enterprise via ServerSideRowModelApiModule. See `15-server-side-row-model.md` for SSRM context. |
| `isLastRowIndexKnown` | `(): boolean \| undefined` | Community | `03-row-models.md` | Returns `false` if the grid allows scrolling past the last row for infinite scroll (`InfiniteRowModelModule / ServerSideRowModelApiModule`). |
| `refreshInfiniteCache` | `(): void` | Community | `03-row-models.md` | Marks all Infinite Row Model cache blocks for reload (`InfiniteRowModelModule`). |
| `purgeInfiniteCache` | `(): void` | Community | `03-row-models.md` | Purges the Infinite Row Model cache; grid shows blank while blocks reload (`InfiniteRowModelModule`). |
| `getInfiniteRowCount` | `(): number \| undefined` | Community | `03-row-models.md` | **Deprecated v32.2** — use `getDisplayedRowCount()` instead (`InfiniteRowModelModule`). |
| `expireValueCache` | `(): void` | Community | `01-grid-options.md` | Expires the value cache, forcing recomputation on next render (`ValueCacheModule`). |
| `getCellValue` | `<TValue = any>(params: GetCellValueParams<TValue>): string \| TValue \| null \| undefined` | Community | `02-column-model.md` | Returns the cell value for a given row node and column; supports `useFormatter` and `from` options (`CellApiModule`). |

### Columns

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `getColumnDefs` | `(): (ColDef<TData> \| ColGroupDef<TData>)[] \| undefined` | Community | `02-column-model.md` | Returns current column definitions (`ColumnApiModule`). |
| `getColumnDef` | `<TValue = any>(key: string \| Column<TValue>): ColDef<TData, TValue> \| null` | Community | `02-column-model.md` | Returns the column definition for the given column key (`ColumnApiModule`). |
| `getColumn` | `<TValue = any>(key: ColKey<TData, TValue>): Column<TValue> \| null` | Community | `02-column-model.md` | Returns the `Column` object for a given key (`ColumnApiModule`). |
| `getColumns` | `(): Column[] \| null` | Community | `02-column-model.md` | Returns all columns regardless of visibility (`ColumnApiModule`). |
| `getAllGridColumns` | `(): Column[]` | Community | `02-column-model.md` | Returns all grid columns in display order, including pivot value columns (`ColumnApiModule`). |
| `getDisplayedLeftColumns` | `(): Column[]` | Community | `16-pinning-and-layout.md` | Returns displayed columns for the left pinned section (`ColumnApiModule`). |
| `getDisplayedCenterColumns` | `(): Column[]` | Community | `02-column-model.md` | Returns displayed columns for the center (scrollable) section (`ColumnApiModule`). |
| `getDisplayedRightColumns` | `(): Column[]` | Community | `16-pinning-and-layout.md` | Returns displayed columns for the right pinned section (`ColumnApiModule`). |
| `getAllDisplayedColumns` | `(): Column[]` | Community | `02-column-model.md` | Returns all displayed columns (left, center, right) (`ColumnApiModule`). |
| `getAllDisplayedVirtualColumns` | `(): Column[]` | Community | `05-rendering-and-dom.md` | Returns only the rendered (virtualised) subset of displayed columns (`ColumnApiModule`). |
| `getDisplayedColAfter` | `<TValue = any>(col: Column): Column<TValue> \| null` | Community | `02-column-model.md` | Returns the column to the right of the given column in display order (`ColumnApiModule`). |
| `getDisplayedColBefore` | `<TValue = any>(col: Column): Column<TValue> \| null` | Community | `02-column-model.md` | Returns the column to the left of the given column in display order (`ColumnApiModule`). |
| `getDisplayNameForColumn` | `(column: Column, location: HeaderLocation): string` | Community | `02-column-model.md` | Returns the display name for a column (respects `headerValueGetter`) (`ColumnApiModule`). |
| `applyColumnState` | `(params: ApplyColumnStateParams): boolean` | Community | `02-column-model.md` | Applies a partial or full column state; returns `false` if columns not found (`ColumnApiModule`). |
| `getColumnState` | `(): ColumnState[]` | Community | `02-column-model.md` | Returns a serialisable snapshot of column state (sort, visibility, width, pinned, etc.) (`ColumnApiModule`). |
| `resetColumnState` | `(): void` | Community | `02-column-model.md` | Resets column state to match the original column definitions (`ColumnApiModule`). |
| `setColumnsVisible` | `(keys: (string \| Column)[], visible: boolean): void` | Community | `02-column-model.md` | Shows or hides the specified columns (`ColumnApiModule`). |
| `setColumnsPinned` | `(keys: ColKey[], pinned: ColumnPinnedType): void` | Community | `16-pinning-and-layout.md` | Pins/unpins the specified columns (`ColumnApiModule`). |
| `isPinning` | `(): boolean` | Community | `16-pinning-and-layout.md` | Returns `true` if any columns are pinned left or right (`ColumnApiModule`). |
| `isPinningLeft` | `(): boolean` | Community | `16-pinning-and-layout.md` | Returns `true` if any columns are pinned left (`ColumnApiModule`). |
| `isPinningRight` | `(): boolean` | Community | `16-pinning-and-layout.md` | Returns `true` if any columns are pinned right (`ColumnApiModule`). |
| `moveColumnByIndex` | `(fromIndex: number, toIndex: number): void` | Community | `02-column-model.md` | Moves a column from one index to another. |
| `moveColumns` | `(columnsToMoveKeys: ColKey[], toIndex: number): void` | Community | `02-column-model.md` | Moves multiple columns to the given index. |
| `setColumnWidths` | `(columnWidths: { key: ColKey; newWidth: number }[], finished?: boolean, source?: ColumnEventType): void` | Community | `02-column-model.md` | Sets the widths of multiple columns programmatically. |
| `sizeColumnsToFit` | `(paramsOrGridWidth?: ISizeColumnsToFitParams \| number): void` | Community | `02-column-model.md` | Sizes all columns to fill available horizontal space (`ColumnAutoSizeModule`). |
| `autoSizeColumns` | `(keys: ColKey[], skipHeader?: boolean): void` | Community | `02-column-model.md` | Auto-sizes specified columns based on their content (`ColumnAutoSizeModule`). |
| `autoSizeAllColumns` | `(skipHeader?: boolean): void` | Community | `02-column-model.md` | Auto-sizes all displayed columns (`ColumnAutoSizeModule`). |
| `isColumnHovered` | `(column: Column): boolean` | Community | `02-column-model.md` | Returns `true` if the column is currently hovered (`ColumnHoverModule`). |
| `setColumnGroupOpened` | `(group: ProvidedColumnGroup \| string, newValue: boolean): void` | Community | `02-column-model.md` | Opens or closes a column group. |
| `getColumnGroup` | `(name: string, instanceId?: number): ColumnGroup \| null` | Community | `02-column-model.md` | Returns the `ColumnGroup` with the given name. |
| `getProvidedColumnGroup` | `(name: string): ProvidedColumnGroup \| null` | Community | `02-column-model.md` | Returns the provided (static) column group with the given name. |
| `getDisplayNameForColumnGroup` | `(columnGroup: ColumnGroup, location: HeaderLocation): string` | Community | `02-column-model.md` | Returns the display name for a column group. |
| `getColumnGroupState` | `(): { groupId: string; open: boolean }[]` | Community | `02-column-model.md` | Returns the open/closed state of all column groups. |
| `setColumnGroupState` | `(stateItems: { groupId: string; open: boolean }[]): void` | Community | `02-column-model.md` | Sets the open/closed state of column groups from a saved snapshot. |
| `resetColumnGroupState` | `(): void` | Community | `02-column-model.md` | Resets column group state to the defaults from the column definitions. |
| `getLeftDisplayedColumnGroups` | `(): (Column \| ColumnGroup)[]` | Community | `16-pinning-and-layout.md` | Returns all column group headers for the left pinned section. |
| `getCenterDisplayedColumnGroups` | `(): (Column \| ColumnGroup)[]` | Community | `02-column-model.md` | Returns all column group headers for the center section. |
| `getRightDisplayedColumnGroups` | `(): (Column \| ColumnGroup)[]` | Community | `16-pinning-and-layout.md` | Returns all column group headers for the right pinned section. |
| `getAllDisplayedColumnGroups` | `(): (Column \| ColumnGroup)[] \| null` | Community | `02-column-model.md` | Returns all root column group headers. |
| `showColumnMenu` | `(colKey: string \| Column): void` | Community | `17-side-bar-and-tool-panels.md` | Shows the column menu for the specified column. |
| `hidePopupMenu` | `(): void` | Community | `19-context-menu-and-clipboard.md` | Hides any visible context menu or column menu. |
| `showColumnChooser` | `(params?: ColumnChooserParams): void` | Enterprise | `17-side-bar-and-tool-panels.md` | Shows the column chooser dialog (`ColumnMenuModule`). |
| `hideColumnChooser` | `(): void` | Enterprise | `17-side-bar-and-tool-panels.md` | Hides the column chooser if visible (`ColumnMenuModule`). |

### Rows

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `getRowNode` | `(id: string): IRowNode<TData> \| undefined` | Community | `03-row-models.md` | Returns the row node with the given ID (`RowApiModule`). |
| `getRenderedNodes` | `(): IRowNode<TData>[]` | Community | `05-rendering-and-dom.md` | Returns currently rendered row nodes (virtualised subset) (`RowApiModule`). |
| `getDisplayedRowAtIndex` | `(index: number): IRowNode<TData> \| undefined` | Community | `03-row-models.md` | Returns the displayed row node at the given index (`RowApiModule`). |
| `getDisplayedRowCount` | `(): number` | Community | `03-row-models.md` | Returns the total number of displayed rows (`RowApiModule`). |
| `getFirstDisplayedRowIndex` | `(): number` | Community | `05-rendering-and-dom.md` | Returns the index of the first displayed row (includes buffer rows) (`RowApiModule`). |
| `getLastDisplayedRowIndex` | `(): number` | Community | `05-rendering-and-dom.md` | Returns the index of the last displayed row (includes buffer rows) (`RowApiModule`). |
| `forEachNode` | `(callback: (rowNode: IRowNode<TData>, index: number) => void, includeFooterNodes?: boolean): void` | Community | `03-row-models.md` | Iterates every node ignoring filters, sorting, and pagination (`RowApiModule`). |
| `forEachLeafNode` | `(callback: (rowNode: IRowNode<TData>) => void): void` | Community | `03-row-models.md` | Iterates only leaf nodes (excludes group rows created by the grid) (`ClientSideRowModelApiModule`). |
| `forEachNodeAfterFilter` | `(callback: (rowNode: IRowNode<TData>, index: number) => void): void` | Community | `08-filtering.md` | Iterates nodes that pass the current filter (`ClientSideRowModelApiModule`). |
| `forEachNodeAfterFilterAndSort` | `(callback: (rowNode: IRowNode<TData>, index: number) => void): void` | Community | `07-sorting.md` | Iterates nodes in the current filtered and sorted order (`ClientSideRowModelApiModule`). |
| `redrawRows` | `(params?: RedrawRowsParams<TData>): void` | Community | `05-rendering-and-dom.md` | Removes and recreates specified rows from scratch (`RowApiModule`). |
| `setRowNodeExpanded` | `(rowNode: IRowNode<TData>, expanded: boolean, expandParents?: boolean, forceSync?: boolean): void` | Community | `09-row-grouping.md` | Expands or collapses a specific row node (`RowApiModule`). |
| `addRenderedRowListener` | `(eventName: RenderedRowEvent, rowIndex: number, callback: (...args: any[]) => any): void` | Community | `05-rendering-and-dom.md` | Registers a listener for a virtual row; auto-removed when row leaves DOM (`RowApiModule`). |
| `onRowHeightChanged` | `(): void` | Community | `05-rendering-and-dom.md` | Notifies the grid that row heights have changed (call after `rowNode.setRowHeight()`). |
| `resetRowHeights` | `(): void` | Community | `05-rendering-and-dom.md` | Tells the grid to recalculate all row heights (`ClientSideRowModelApiModule / ServerSideRowModelApiModule`). |
| `expandAll` | `(): void` | Community | `09-row-grouping.md` | Expands all row groups (`ClientSideRowModelApiModule / ServerSideRowModelApiModule`). |
| `collapseAll` | `(): void` | Community | `09-row-grouping.md` | Collapses all row groups (`ClientSideRowModelApiModule / ServerSideRowModelApiModule`). |
| `resetRowGroupExpansion` | `(): void` | Community | `09-row-grouping.md` | Resets all group expansion to defaults; discards user overrides (`ClientSideRowModelApiModule / ServerSideRowModelApiModule`). |
| `onGroupExpandedOrCollapsed` | `(): void` | Community | `09-row-grouping.md` | Notifies the grid of external group expansion state changes; triggers a single re-render (`ClientSideRowModelApiModule`). |
| `getBestCostNodeSelection` | `(): IRowNode<TData>[] \| undefined` | Community | `12-selection.md` | Returns selected nodes at best cost (groups instead of all children) (`ClientSideRowModelApiModule`). |
| `getPinnedTopRowCount` | `(): number` | Community | `16-pinning-and-layout.md` | Returns the number of top pinned rows (`PinnedRowModule`). |
| `getPinnedBottomRowCount` | `(): number` | Community | `16-pinning-and-layout.md` | Returns the number of bottom pinned rows (`PinnedRowModule`). |
| `getPinnedTopRow` | `<TPinnedData = any>(index: number): IRowNode<TPinnedData> \| undefined` | Community | `16-pinning-and-layout.md` | Returns the top pinned row at the given index (`PinnedRowModule`). |
| `getPinnedBottomRow` | `<TPinnedData = any>(index: number): IRowNode<TPinnedData> \| undefined` | Community | `16-pinning-and-layout.md` | Returns the bottom pinned row at the given index (`PinnedRowModule`). |
| `forEachPinnedRow` | `<TPinnedData = any>(floating: NonNullable<RowPinnedType>, callback: (rowNode: IRowNode<TPinnedData>) => void): void` | Community | `16-pinning-and-layout.md` | Iterates top or bottom pinned rows (`PinnedRowModule`). |

### Cells

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `refreshCells` | `(params?: RefreshCellsParams<TData>): void` | Community | `05-rendering-and-dom.md` | Triggers change detection on cells; refreshes cells where required (`RenderApiModule`). |
| `refreshHeader` | `(): void` | Community | `02-column-model.md` | Redraws the column headers (`RenderApiModule`). |
| `getCellRendererInstances` | `(params?: GetCellRendererInstancesParams<TData>): ICellRenderer<TData>[]` | Community | `05-rendering-and-dom.md` | Returns active cell renderer instances (`RenderApiModule`). |
| `flashCells` | `(params?: FlashCellsParams<TData>): void` | Community | `05-rendering-and-dom.md` | Flashes specified rows, columns, or cells (`HighlightChangesModule`). |
| `setGridAriaProperty` | `(property: string, value: string \| null): void` | Community | `20-keyboard-and-accessibility.md` | Sets or removes an ARIA property on the grid panel element (`RenderApiModule`). |
| `isAnimationFrameQueueEmpty` | `(): boolean` | Community | `05-rendering-and-dom.md` | Returns `true` when no animation frames are pending (`RenderApiModule`). |
| `flushAllAnimationFrames` | `(): void` | Community | `05-rendering-and-dom.md` | Flushes all pending animation frames immediately (`RenderApiModule`). |
| `getSizesForCurrentTheme` | `(): { rowHeight: number; headerHeight: number }` | Community | `21-themes-and-styling.md` | Returns the row and header height values for the current theme (`RenderApiModule`). |
| `getCellEditorInstances` | `(params?: GetCellEditorInstancesParams<TData>): ICellEditor[]` | Community | `06-cell-editing.md` | Returns active cell editor instances (editor module required). |
| `getEditingCells` | `(): EditingCellPosition[]` | Community | `06-cell-editing.md` | Returns the position(s) of currently editing cell(s) (editor module required). |
| `getEditRowValues` | `(rowNode: IRowNode<TData>): Record<string, any> \| undefined` | Community | `06-cell-editing.md` | Returns pending edit values for a row if it is being edited (editor module required). |
| `stopEditing` | `(cancel?: boolean): void` | Community | `06-cell-editing.md` | Stops any active cell editing; pass `true` to cancel without saving (editor module required). |
| `startEditingCell` | `(params: StartEditingCellParams): void` | Community | `06-cell-editing.md` | Programmatically starts editing the specified cell (editor module required). |
| `isEditing` | `(cellPosition: CellPosition): boolean` | Community | `06-cell-editing.md` | Returns `true` if the grid is currently editing the given cell (editor module required). |
| `validateEdit` | `(): ICellEditorValidationError[] \| null` | Community | `06-cell-editing.md` | Runs validation on all active editors; returns errors or `null` (editor module required). |
| `undoCellEditing` | `(): void` | Community | `06-cell-editing.md` | Reverts the last cell edit (`UndoRedoEditModule`). |
| `redoCellEditing` | `(): void` | Community | `06-cell-editing.md` | Re-applies the most recently undone cell edit (`UndoRedoEditModule`). |
| `getCurrentUndoSize` | `(): number` | Community | `06-cell-editing.md` | Returns the number of available undo operations (`UndoRedoEditModule`). |
| `getCurrentRedoSize` | `(): number` | Community | `06-cell-editing.md` | Returns the number of available redo operations (`UndoRedoEditModule`). |
| `startBatchEdit` | `(): void` | Enterprise | `06-cell-editing.md` | Starts a batch editing session — edits accumulate without being committed (`BatchEditModule`). |
| `commitBatchEdit` | `(): void` | Enterprise | `06-cell-editing.md` | Commits all pending batch edits to the row data (`BatchEditModule`). |
| `cancelBatchEdit` | `(): void` | Enterprise | `06-cell-editing.md` | Cancels all pending batch edits; reverts cells to original values (`BatchEditModule`). |
| `isBatchEditing` | `(): boolean` | Enterprise | `06-cell-editing.md` | Returns `true` if a batch editing session is currently active (`BatchEditModule`). |
| `getNote` | `(params: GetNoteParams): Note \| undefined` | Enterprise | `06-cell-editing.md` | Returns the current note for a cell (`NotesModule`). |
| `setNote` | `(params: SetNoteParams): void` | Enterprise | `06-cell-editing.md` | Sets or removes the note for a cell; pass `note: undefined` to remove (`NotesModule`). |
| `refreshNotes` | `(params?: RefreshNotesParams): void` | Enterprise | `06-cell-editing.md` | Refreshes note presence for currently rendered cells (`NotesModule`). |

### Selection

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `setNodesSelected` | `(params: { nodes: IRowNode<TData>[]; newValue: boolean; source?: SelectionEventSourceType }): void` | Community | `12-selection.md` | Sets the selection state for the provided row nodes (`RowSelectionModule`). |
| `selectAll` | `(mode?: SelectAllMode, source?: SelectionEventSourceType): void` | Community | `12-selection.md` | Selects all rows; `mode` controls scope (`RowSelectionModule`). |
| `deselectAll` | `(mode?: SelectAllMode, source?: SelectionEventSourceType): void` | Community | `12-selection.md` | Clears all row selections; `mode` controls scope (`RowSelectionModule`). |
| `selectAllFiltered` | `(source?: SelectionEventSourceType): void` | Community | `12-selection.md` | **Deprecated v33** — use `selectAll('filtered')` instead (`RowSelectionModule`). |
| `deselectAllFiltered` | `(source?: SelectionEventSourceType): void` | Community | `12-selection.md` | **Deprecated v33** — use `deselectAll('filtered')` instead (`RowSelectionModule`). |
| `selectAllOnCurrentPage` | `(source?: SelectionEventSourceType): void` | Community | `12-selection.md` | **Deprecated v33** — use `selectAll('currentPage')` instead (`RowSelectionModule`). |
| `deselectAllOnCurrentPage` | `(source?: SelectionEventSourceType): void` | Community | `12-selection.md` | **Deprecated v33** — use `deselectAll('currentPage')` instead (`RowSelectionModule`). |
| `getSelectedNodes` | `(): IRowNode<TData>[]` | Community | `12-selection.md` | Returns an unsorted list of selected row nodes (`RowSelectionModule`). |
| `getSelectedRows` | `(): TData[]` | Community | `12-selection.md` | Returns an unsorted list of selected row data objects (`RowSelectionModule`). |
| `getCellRanges` | `(): CellRange[] \| null` | Enterprise | `12-selection.md` | Returns the list of selected cell ranges (`CellSelectionModule`). |
| `addCellRange` | `(params: CellRangeParams): void` | Enterprise | `12-selection.md` | Adds a cell range to the current selection; keeps existing ranges (`CellSelectionModule`). |
| `clearRangeSelection` | `(): void` | Enterprise | `12-selection.md` | **Deprecated v32.2** — use `clearCellSelection()` instead. |
| `clearCellSelection` | `(): void` | Enterprise | `12-selection.md` | Clears all selected cell ranges (`CellSelectionModule`). |
| `getServerSideSelectionState` | `(): IServerSideSelectionState \| IServerSideGroupSelectionState \| null` | Enterprise | `15-server-side-row-model.md` | Returns SSRM selection state rules (`ServerSideRowModelApiModule`). |
| `setServerSideSelectionState` | `(state: IServerSideSelectionState \| IServerSideGroupSelectionState): void` | Enterprise | `15-server-side-row-model.md` | Sets SSRM selection state rules (`ServerSideRowModelApiModule`). |

### Sorting

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `onSortChanged` | `(): void` | Community | `07-sorting.md` | Triggers the grid to re-apply the current sort; useful after external data changes. |

### Filtering

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `isAnyFilterPresent` | `(): boolean` | Community | `08-filtering.md` | Returns `true` if any filter (quick, column, advanced, external) is active. |
| `onFilterChanged` | `(source?: FilterChangedEventSourceType): void` | Community | `08-filtering.md` | Informs the grid that a filter has changed; triggers pipeline refresh. |
| `isColumnFilterPresent` | `(): boolean` | Community | `08-filtering.md` | Returns `true` if any column filter is set. |
| `getColumnFilterInstance` | `<TFilter = IFilter>(key: string \| Column): Promise<TFilter \| null \| undefined>` | Community | `08-filtering.md` | Returns the filter component instance for a column (async). |
| `getColumnFilterHandler` | `<TFilterHandler>(key: string \| Column): TFilterHandler \| undefined` | Community | `08-filtering.md` | Returns the filter handler instance for a column (used with `enableFilterHandlers`). |
| `destroyFilter` | `(key: string \| Column): void` | Community | `08-filtering.md` | Destroys a column filter, forcing recreation on next open. |
| `setFilterModel` | `(model: FilterModel \| null): void` | Community | `08-filtering.md` | Sets the state of all column filters from a saved model. |
| `getFilterModel` | `(): FilterModel` | Community | `08-filtering.md` | Returns the current state of all column filters. |
| `getColumnFilterModel` | `<TModel>(column: string \| Column, useUnapplied?: boolean): TModel \| null` | Community | `08-filtering.md` | Returns the current filter model for a single column; `null` if no active filter. |
| `setColumnFilterModel` | `<TModel>(column: string \| Column, model: TModel \| null): Promise<void>` | Community | `08-filtering.md` | Sets or clears the filter model for a single column (async). |
| `showColumnFilter` | `(colKey: string \| Column): void` | Community | `08-filtering.md` | Programmatically shows the filter popup for the specified column. |
| `hideColumnFilter` | `(): void` | Community | `08-filtering.md` | Hides the column filter popup if it is open. |
| `doFilterAction` | `(params: FilterActionParams): void` | Community | `08-filtering.md` | Performs a filter action (requires `enableFilterHandlers = true`). |
| `isQuickFilterPresent` | `(): boolean` | Community | `08-filtering.md` | Returns `true` if the Quick Filter is set (CSRM only) (`QuickFilterModule`). |
| `getQuickFilter` | `(): string \| undefined` | Community | `08-filtering.md` | Returns the current Quick Filter text (CSRM only) (`QuickFilterModule`). |
| `resetQuickFilter` | `(): void` | Community | `08-filtering.md` | Resets Quick Filter cache on every row node (CSRM only) (`QuickFilterModule`). |
| `getAdvancedFilterModel` | `(): AdvancedFilterModel \| null` | Enterprise | `08-filtering.md` | Returns the current Advanced Filter model (`AdvancedFilterModule`). |
| `setAdvancedFilterModel` | `(advancedFilterModel: AdvancedFilterModel \| null): void` | Enterprise | `08-filtering.md` | Sets or clears the Advanced Filter model (`AdvancedFilterModule`). |
| `showAdvancedFilterBuilder` | `(): void` | Enterprise | `08-filtering.md` | Opens the Advanced Filter Builder dialog (`AdvancedFilterModule`). |
| `hideAdvancedFilterBuilder` | `(): void` | Enterprise | `08-filtering.md` | Closes the Advanced Filter Builder dialog; un-applied changes discarded (`AdvancedFilterModule`). |
| `findNext` | `(): void` | Community | `08-filtering.md` | Goes to the next Find match (`FindModule`). |
| `findPrevious` | `(): void` | Community | `08-filtering.md` | Goes to the previous Find match (`FindModule`). |
| `findGetTotalMatches` | `(): number` | Community | `08-filtering.md` | Returns the total number of Find matches (`FindModule`). |
| `findGoTo` | `(match: number, force?: boolean): void` | Community | `08-filtering.md` | Navigates to the specified Find match (1-based); `force` resets if already active (`FindModule`). |
| `findClearActive` | `(): void` | Community | `08-filtering.md` | Clears the active Find match (`FindModule`). |
| `findGetActiveMatch` | `(): FindMatch<TData> \| undefined` | Community | `08-filtering.md` | Returns the active Find match, or `undefined` if none (`FindModule`). |
| `findGetNumMatches` | `(params: FindCellParams<TData>): number` | Community | `08-filtering.md` | Returns the number of matches in a specific cell (`FindModule`). |
| `findGetParts` | `(params: FindCellValueParams<TData>): FindPart[]` | Community | `08-filtering.md` | Returns cell value parts (matches + active match) for custom cell components (`FindModule`). |
| `findRefresh` | `(): void` | Community | `08-filtering.md` | Re-runs Find search with the current value; use after external data mutation + `refreshCells()` (`FindModule`). |

### Grouping / aggregation / pivot

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `setRowGroupColumns` | `(colKeys: ColKey[]): void` | Enterprise | `09-row-grouping.md` | Replaces the set of row group columns (`RowGroupingModule`). |
| `addRowGroupColumns` | `(colKeys: ColKey[]): void` | Enterprise | `09-row-grouping.md` | Adds columns to the row group set (`RowGroupingModule`). |
| `removeRowGroupColumns` | `(colKeys: ColKey[]): void` | Enterprise | `09-row-grouping.md` | Removes columns from the row group set (`RowGroupingModule`). |
| `moveRowGroupColumn` | `(fromIndex: number, toIndex: number): void` | Enterprise | `09-row-grouping.md` | Moves a row group column to a new position in the grouping order (`RowGroupingModule`). |
| `getRowGroupColumns` | `(): Column[]` | Enterprise | `09-row-grouping.md` | Returns the current set of row group columns (`RowGroupingModule`). |
| `addAggFuncs` | `(aggFuncs: { [key: string]: IAggFunc<TData> }): void` | Enterprise | `10-aggregation.md` | Registers custom aggregation functions (`RowGroupingModule / PivotModule / TreeDataModule`). |
| `clearAggFuncs` | `(): void` | Enterprise | `10-aggregation.md` | Clears all aggregation functions including built-ins (`RowGroupingModule / PivotModule / TreeDataModule`). |
| `setColumnAggFunc` | `<TValue = any>(key: ColKey<TData, TValue>, aggFunc: string \| IAggFunc<TData, TValue> \| null \| undefined): void` | Enterprise | `10-aggregation.md` | Sets the aggregation function for a single column (`RowGroupingModule / PivotModule / TreeDataModule`). |
| `isPivotMode` | `(): boolean` | Enterprise | `11-pivoting.md` | Returns whether pivot mode is currently active (`PivotModule`). |
| `getPivotResultColumn` | `<TValue = any>(pivotKeys: string[], valueColKey: ColKey<TData, TValue>): Column<TValue> \| null` | Enterprise | `11-pivoting.md` | Returns the pivot result column for the given pivot keys and value column (`PivotModule`). |
| `setValueColumns` | `(colKeys: ColKey[]): void` | Enterprise | `10-aggregation.md` | Replaces the set of value (aggregation) columns (`PivotModule`). |
| `getValueColumns` | `(): Column[]` | Enterprise | `10-aggregation.md` | Returns the current value columns (`PivotModule`). |
| `addValueColumns` | `(colKeys: ColKey[]): void` | Enterprise | `10-aggregation.md` | Adds columns to the value set (`PivotModule`). |
| `removeValueColumns` | `(colKeys: ColKey[]): void` | Enterprise | `10-aggregation.md` | Removes columns from the value set (`PivotModule`). |
| `setPivotColumns` | `(colKeys: ColKey[]): void` | Enterprise | `11-pivoting.md` | Replaces the set of pivot columns (`PivotModule`). |
| `addPivotColumns` | `(colKeys: ColKey[]): void` | Enterprise | `11-pivoting.md` | Adds columns to the pivot set (`PivotModule`). |
| `removePivotColumns` | `(colKeys: ColKey[]): void` | Enterprise | `11-pivoting.md` | Removes columns from the pivot set (`PivotModule`). |
| `getPivotColumns` | `(): Column[]` | Enterprise | `11-pivoting.md` | Returns the current pivot columns (`PivotModule`). |
| `setPivotResultColumns` | `(colDefs: (ColDef \| ColGroupDef)[] \| null): void` | Enterprise | `11-pivoting.md` | Sets explicit pivot result column definitions (advanced use) (`PivotModule`). |
| `getPivotResultColumns` | `(): Column[] \| null` | Enterprise | `11-pivoting.md` | Returns the grid's pivot result columns (`PivotModule`). |
| `addDetailGridInfo` | `(id: string, gridInfo: DetailGridInfo): void` | Enterprise | `13-master-detail.md` | Registers a detail grid with the master grid (`MasterDetailModule`). |
| `removeDetailGridInfo` | `(id: string): void` | Enterprise | `13-master-detail.md` | Unregisters a detail grid from the master grid (`MasterDetailModule`). |
| `getDetailGridInfo` | `(id: string): DetailGridInfo \| undefined` | Enterprise | `13-master-detail.md` | Returns the `DetailGridInfo` for the given detail grid ID (`MasterDetailModule`). |
| `forEachDetailGridInfo` | `(callback: (gridInfo: DetailGridInfo, index: number) => void): void` | Enterprise | `13-master-detail.md` | Iterates all registered detail grids (`MasterDetailModule`). |
| `refreshFormulas` | `(rowNode?: IRowNode<TData> \| string): boolean` | Enterprise | `06-cell-editing.md` | Invalidates the formula cache; returns `true` if a refresh was performed (`FormulaModule`). |

### Server-side

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `getCacheBlockState` | `(): any` | Enterprise | `15-server-side-row-model.md` | Returns the current server-side cache block state (`ServerSideRowModelApiModule`). See `03-row-models.md` for the Community via InfiniteRowModelModule variant. |
| `applyServerSideTransaction` | `(transaction: ServerSideTransaction): ServerSideTransactionResult<TData> \| undefined` | Enterprise | `15-server-side-row-model.md` | Applies a transaction to the SSRM (`ServerSideRowModelApiModule`). |
| `applyServerSideTransactionAsync` | `(transaction: ServerSideTransaction, callback?: (res: ServerSideTransactionResult<TData>) => void): void` | Enterprise | `15-server-side-row-model.md` | Batch-applies an SSRM transaction asynchronously (`ServerSideRowModelApiModule`). |
| `applyServerSideRowData` | `(params: { successParams: LoadSuccessParams<TData>; route?: string[]; startRow?: number }): void` | Enterprise | `15-server-side-row-model.md` | Applies row data directly to a server-side store level (`ServerSideRowModelApiModule`). |
| `retryServerSideLoads` | `(): void` | Enterprise | `15-server-side-row-model.md` | Retries all failed server-side loads (`ServerSideRowModelApiModule`). |
| `flushServerSideAsyncTransactions` | `(): void` | Enterprise | `15-server-side-row-model.md` | Flushes all pending async SSRM transactions (`ServerSideRowModelApiModule`). |
| `refreshServerSide` | `(params?: RefreshServerSideParams): void` | Enterprise | `15-server-side-row-model.md` | Refreshes a server-side store level; fires `storeRefreshed` on completion (`ServerSideRowModelApiModule`). |
| `getServerSideGroupLevelState` | `(): ServerSideGroupLevelState[]` | Enterprise | `15-server-side-row-model.md` | Returns information on all server-side group levels (`ServerSideRowModelApiModule`). |

### Clipboard

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `copyToClipboard` | `(params?: IClipboardCopyParams): void` | Enterprise | `19-context-menu-and-clipboard.md` | Copies data to clipboard (same as Ctrl+C) (`ClipboardModule`). |
| `cutToClipboard` | `(params?: IClipboardCopyParams): void` | Enterprise | `19-context-menu-and-clipboard.md` | Cuts data to clipboard (same as Ctrl+X) (`ClipboardModule`). |
| `copySelectedRowsToClipboard` | `(params?: IClipboardCopyRowsParams): void` | Enterprise | `19-context-menu-and-clipboard.md` | Copies selected rows to clipboard (`ClipboardModule`). |
| `copySelectedRangeToClipboard` | `(params?: IClipboardCopyParams): void` | Enterprise | `19-context-menu-and-clipboard.md` | Copies the selected cell range to clipboard (`ClipboardModule`). |
| `copySelectedRangeDown` | `(): void` | Enterprise | `19-context-menu-and-clipboard.md` | Copies the selected range down (same as Ctrl+D in Excel) (`ClipboardModule`). |
| `pasteFromClipboard` | `(): void` | Enterprise | `19-context-menu-and-clipboard.md` | Pastes clipboard data into the focused cell (`ClipboardModule`). |

### Charts

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `getChartModels` | `(): ChartModel[] \| undefined` | Enterprise | `24-charts-and-sparklines.md` | Returns models for all currently rendered integrated charts (`IntegratedChartsModule`). |
| `getChartRef` | `(chartId: string): ChartRef \| undefined` | Enterprise | `24-charts-and-sparklines.md` | Returns the `ChartRef` for the given chart ID (`IntegratedChartsModule`). |
| `getChartImageDataURL` | `(params: GetChartImageDataUrlParams): string \| undefined` | Enterprise | `24-charts-and-sparklines.md` | Returns a base64-encoded image data URL for a chart (`IntegratedChartsModule`). |
| `downloadChart` | `(params: ChartDownloadParams): void` | Enterprise | `24-charts-and-sparklines.md` | Downloads a chart as an image file (`IntegratedChartsModule`). |
| `openChartToolPanel` | `(params: OpenChartToolPanelParams): void` | Enterprise | `24-charts-and-sparklines.md` | Opens the Chart Tool Panel for the specified chart (`IntegratedChartsModule`). |
| `closeChartToolPanel` | `(params: CloseChartToolPanelParams): void` | Enterprise | `24-charts-and-sparklines.md` | Closes the Chart Tool Panel (`IntegratedChartsModule`). |
| `createRangeChart` | `(params: CreateRangeChartParams): ChartRef \| undefined` | Enterprise | `24-charts-and-sparklines.md` | Programmatically creates a chart from a cell range (`IntegratedChartsModule`). |
| `createPivotChart` | `(params: CreatePivotChartParams): ChartRef \| undefined` | Enterprise | `24-charts-and-sparklines.md` | Programmatically creates a pivot chart (`IntegratedChartsModule`). |
| `createCrossFilterChart` | `(params: CreateCrossFilterChartParams): ChartRef \| undefined` | Enterprise | `24-charts-and-sparklines.md` | Programmatically creates a cross-filter chart from a range (`IntegratedChartsModule`). |
| `updateChart` | `(params: UpdateChartParams): void` | Enterprise | `24-charts-and-sparklines.md` | Updates an existing integrated chart (`IntegratedChartsModule`). |
| `restoreChart` | `(chartModel: ChartModel, chartContainer?: HTMLElement): ChartRef \| undefined` | Enterprise | `24-charts-and-sparklines.md` | Restores a chart from a previously saved `ChartModel` (`IntegratedChartsModule`). |

### Export

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `getDataAsCsv` | `(params?: CsvExportParams): string \| undefined` | Community | `25-export.md` | Returns grid data as a CSV string (`CsvExportModule`). |
| `exportDataAsCsv` | `(params?: CsvExportParams): void` | Community | `25-export.md` | Downloads a CSV export of grid data (`CsvExportModule`). |
| `getDataAsExcel` | `(params?: ExcelExportParams): string \| Blob \| undefined` | Enterprise | `25-export.md` | Returns grid data as an Excel Blob (without downloading) (`ExcelExportModule`). |
| `exportDataAsExcel` | `(params?: ExcelExportParams): void` | Enterprise | `25-export.md` | Downloads an Excel export of grid data (`ExcelExportModule`). |
| `getSheetDataForExcel` | `(params?: ExcelExportParams): string \| undefined` | Enterprise | `25-export.md` | Returns grid data as a single Excel sheet (for multi-sheet assembly) (`ExcelExportModule`). |
| `getMultipleSheetsAsExcel` | `(params: ExcelExportMultipleSheetParams): Blob \| undefined` | Enterprise | `25-export.md` | Assembles multiple sheets into an Excel Blob (`ExcelExportModule`). |
| `exportMultipleSheetsAsExcel` | `(params: ExcelExportMultipleSheetParams): void` | Enterprise | `25-export.md` | Downloads an Excel file with multiple sheets (`ExcelExportModule`). |
| `getStructuredSchema` | `(params?: StructuredSchemaParams): any` | Enterprise | `25-export.md` | Returns the grid's structured schema for AI services (`AiToolkitModule`). |

### Status bar / side bar

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `getStatusPanel` | `<TStatusPanel = IStatusPanel<TData>>(key: string): TStatusPanel \| undefined` | Enterprise | `18-status-bar.md` | Returns the status panel instance for the given key (`StatusBarModule`). |
| `isSideBarVisible` | `(): boolean` | Enterprise | `17-side-bar-and-tool-panels.md` | Returns `true` if the side bar is visible (`SideBarModule`). |
| `setSideBarVisible` | `(show: boolean): void` | Enterprise | `17-side-bar-and-tool-panels.md` | Shows or hides the entire side bar (`SideBarModule`). |
| `setSideBarPosition` | `(position: 'left' \| 'right'): void` | Enterprise | `17-side-bar-and-tool-panels.md` | Sets the side bar position relative to the grid (`SideBarModule`). |
| `openToolPanel` | `(key: string, parent?: HTMLElement \| null): void` | Enterprise | `17-side-bar-and-tool-panels.md` | Opens a specific tool panel by ID (`SideBarModule`). |
| `closeToolPanel` | `(): void` | Enterprise | `17-side-bar-and-tool-panels.md` | Closes the currently open tool panel (`SideBarModule`). |
| `getOpenedToolPanel` | `(): string \| null` | Enterprise | `17-side-bar-and-tool-panels.md` | Returns the ID of the currently open tool panel, or `null` (`SideBarModule`). |
| `refreshToolPanel` | `(): void` | Enterprise | `17-side-bar-and-tool-panels.md` | Force-refreshes all tool panels by calling their `refresh` method (`SideBarModule`). |
| `isToolPanelShowing` | `(): boolean` | Enterprise | `17-side-bar-and-tool-panels.md` | Returns `true` if any tool panel is currently visible (`SideBarModule`). |
| `getToolPanelInstance` | `<TToolPanel = IToolPanel<TData>>(id: string): TToolPanel \| undefined` | Enterprise | `17-side-bar-and-tool-panels.md` | Returns the tool panel instance for the given ID (`SideBarModule`). |
| `getSideBar` | `(): SideBarDef \| undefined` | Enterprise | `17-side-bar-and-tool-panels.md` | Returns the current side bar configuration in full long form (`SideBarModule`). |
| `getToolbarItemInstance` | `<T = IToolbarItem<TData>>(key: string): T \| undefined` | Enterprise | `17-side-bar-and-tool-panels.md` | Returns the toolbar item instance for the given key (`ToolbarModule`). |

### Misc

| Method | Signature | Tier | Originating area | Description |
|--------|-----------|------|-----------------|-------------|
| `getFocusedCell` | `(): CellPosition \| null` | Community | `20-keyboard-and-accessibility.md` | Returns the focused cell (or the last focused cell if focus has moved away). |
| `clearFocusedCell` | `(): void` | Community | `20-keyboard-and-accessibility.md` | Clears the focused cell. |
| `setFocusedCell` | `(rowIndex: number, colKey: string \| Column, rowPinned?: RowPinnedType): void` | Community | `20-keyboard-and-accessibility.md` | Programmatically focuses the specified cell. |
| `setFocusedHeader` | `(colKey: string \| Column \| ColumnGroup, floatingFilter?: boolean): void` | Community | `20-keyboard-and-accessibility.md` | Moves focus to the specified column header or its floating filter. |
| `tabToNextCell` | `(event?: KeyboardEvent): boolean` | Community | `20-keyboard-and-accessibility.md` | Navigates focus to the next cell as if Tab was pressed. |
| `tabToPreviousCell` | `(event?: KeyboardEvent): boolean` | Community | `20-keyboard-and-accessibility.md` | Navigates focus to the previous cell as if Shift+Tab was pressed. |
| `getVerticalPixelRange` | `(): { top: number; bottom: number }` | Community | `05-rendering-and-dom.md` | Returns the current vertical scroll range (`ScrollApiModule`). |
| `getHorizontalPixelRange` | `(): { left: number; right: number }` | Community | `05-rendering-and-dom.md` | Returns the current horizontal scroll range (`ScrollApiModule`). |
| `ensureColumnVisible` | `(key: string \| Column, position?: 'auto' \| 'start' \| 'middle' \| 'end'): void` | Community | `05-rendering-and-dom.md` | Scrolls horizontally until the column is visible (`ScrollApiModule`). |
| `ensureIndexVisible` | `(index: number, position?: 'top' \| 'bottom' \| 'middle' \| null): void` | Community | `05-rendering-and-dom.md` | Scrolls vertically until the row at the given index is visible (`ScrollApiModule`). |
| `ensureNodeVisible` | `(nodeSelector: TData \| IRowNode<TData> \| ((row: IRowNode<TData>) => boolean), position?: 'top' \| 'bottom' \| 'middle' \| null): void` | Community | `05-rendering-and-dom.md` | Scrolls vertically until the specified row node is visible (`ScrollApiModule`). |
| `paginationIsLastPageFound` | `(): boolean` | Community | `03-row-models.md` | Returns `true` when the last pagination page is known (`PaginationModule`). |
| `paginationGetPageSize` | `(): number` | Community | `03-row-models.md` | Returns rows-per-page (`PaginationModule`). |
| `paginationGetCurrentPage` | `(): number` | Community | `03-row-models.md` | Returns the current 0-based page index (`PaginationModule`). |
| `paginationGetTotalPages` | `(): number` | Community | `03-row-models.md` | Returns total number of pages (`PaginationModule`). |
| `paginationGetRowCount` | `(): number` | Community | `03-row-models.md` | Returns total pageable row count (`PaginationModule`). |
| `paginationGoToNextPage` | `(): void` | Community | `03-row-models.md` | Navigates to the next page (`PaginationModule`). |
| `paginationGoToPreviousPage` | `(): void` | Community | `03-row-models.md` | Navigates to the previous page (`PaginationModule`). |
| `paginationGoToFirstPage` | `(): void` | Community | `03-row-models.md` | Navigates to the first page (`PaginationModule`). |
| `paginationGoToLastPage` | `(): void` | Community | `03-row-models.md` | Navigates to the last page (`PaginationModule`). |
| `paginationGoToPage` | `(page: number): void` | Community | `03-row-models.md` | Navigates to the specified page; goes to last page if out of range (`PaginationModule`). |
| `showNoRowsOverlay` | `(): void` | Community | `05-rendering-and-dom.md` | Shows the no-rows overlay (prefer `setGridOption('activeOverlay', 'agNoRowsOverlay')`). |
| `hideOverlay` | `(): void` | Community | `05-rendering-and-dom.md` | Hides the no-rows overlay (prefer `setGridOption('activeOverlay', undefined)`). |
| `showLoadingOverlay` | `(): void` | Community | `05-rendering-and-dom.md` | **Deprecated v32** — use `setGridOption('loading', true)` instead. |
| `addRowDropZone` | `(params: RowDropZoneParams): void` | Community | `05-rendering-and-dom.md` | Registers an external drop zone for row dragging (`RowDragModule`). |
| `removeRowDropZone` | `(params: RowDropZoneParams): void` | Community | `05-rendering-and-dom.md` | Removes an external row drop zone (`RowDragModule`). |
| `getRowDropZoneParams` | `(events?: RowDropZoneEvents): RowDropZoneParams \| undefined` | Community | `05-rendering-and-dom.md` | Returns `RowDropZoneParams` for use with another grid's `addRowDropZone` (`RowDragModule`). |
| `getRowDropPositionIndicator` | `(): RowDropPositionIndicator<TData>` | Community | `05-rendering-and-dom.md` | Returns the currently highlighted row drop target (`RowDragModule`). |
| `setRowDropPositionIndicator` | `(highlight: SetRowDropPositionIndicatorParams<TData> \| null \| undefined): void` | Community | `05-rendering-and-dom.md` | Sets the highlighted row drop target for custom drag logic (`RowDragModule`). |
| `showContextMenu` | `(params?: IContextMenuParams): void` | Enterprise | `19-context-menu-and-clipboard.md` | Displays the AG Grid context menu (`ContextMenuModule`). |

## Canvas-port implications

The canvas renderer calls into `GridApi` extensively. Key touchpoints: `getDisplayedRowAtIndex()` /
`getDisplayedRowCount()` for row iteration; `getRenderedNodes()` for the visible set;
`getVerticalPixelRange()` / `getHorizontalPixelRange()` for scroll state; `getAllDisplayedVirtualColumns()`
for column virtualisation; `flashCells()` for highlight animations; `startEditingCell()` / `stopEditing()`
to drive the editor overlay; and `getCellRanges()` for range-selection overlays.
