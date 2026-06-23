# 22 — Events Catalog

## Concept

AG Grid emits typed events for every significant user action and internal state change. All events
extend `AgGridEvent` which provides `api` (the `GridApi`) and `type` (the event name string).
Public events are declared in `AgPublicEventType`; subscribe via `gridOptions.onXxx` callbacks or
`api.addEventListener(eventType, listener)`.

This file is a **flat reference index** of every public AG Grid event. Deeper explanations,
configuration options, and code examples live in the originating area files referenced in each row.

## Look & feel

N/A — reference catalog, no UI of its own.

## Configuration surface

N/A — events are not configured here; see individual area files for `onXxx` callback options.

## Behaviors / interactions

N/A — see individual area files.

## Events

### Grid lifecycle

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `gridReady` | `GridReadyEvent<TData, TContext>` | Community | `01-grid-options.md` | Grid has fully initialised; API is available for use. |
| `gridPreDestroyed` | `GridPreDestroyedEvent<TData, TContext>` | Community | `01-grid-options.md` | Before grid teardown; `state: GridState` snapshot is included. |
| `gridSizeChanged` | `GridSizeChangedEvent<TData, TContext>` | Community | `01-grid-options.md` | Grid container element is resized; `clientWidth` and `clientHeight` are provided. |
| `firstDataRendered` | `FirstDataRenderedEvent<TData, TContext>` | Community | `01-grid-options.md` | First batch of rows has been rendered in the viewport. |
| `viewportChanged` | `ViewportChangedEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | The visible row viewport changes; provides `firstRow` and `lastRow` indices. |
| `modelUpdated` | `ModelUpdatedEvent<TData, TContext>` | Community | `03-row-models.md` | The row model has been updated (sort, filter, data change, etc.). |
| `stateUpdated` | `StateUpdatedEvent<TData, TContext>` | Community | `01-grid-options.md` | Any serialisable grid state property changes; `sources` array identifies what triggered it. |
| `paginationChanged` | `PaginationChangedEvent<TData, TContext>` | Community | `03-row-models.md` | Pagination state changes (page size, current page, data). |
| `componentStateChanged` | `ComponentStateChangedEvent<TData, TContext>` | Community | `01-grid-options.md` | A framework component state change has been applied to the grid. |
| `bodyScroll` | `BodyScrollEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | Grid body scrolls; `direction`, `left`, `top` are provided. |
| `bodyScrollEnd` | `BodyScrollEndEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | Body scroll has ended (debounced). |

### Column events

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `columnEverythingChanged` | `ColumnEverythingChangedEvent<TData, TContext>` | Community | `02-column-model.md` | **Deprecated v32.2** — use `displayedColumnsChanged` or a more specific column event. |
| `newColumnsLoaded` | `NewColumnsLoadedEvent<TData, TContext>` | Community | `02-column-model.md` | A new set of column definitions has been loaded into the grid. |
| `columnPivotModeChanged` | `ColumnPivotModeChangedEvent<TData, TContext>` | Enterprise | `11-pivoting.md` | Pivot mode is enabled or disabled. |
| `columnRowGroupChanged` | `ColumnRowGroupChangedEvent<TData, TContext>` | Enterprise | `09-row-grouping.md` | A column is added to or removed from the row-group set. |
| `columnPivotChanged` | `ColumnPivotChangedEvent<TData, TContext>` | Enterprise | `11-pivoting.md` | A column is added to or removed from the pivot set. |
| `columnValueChanged` | `ColumnValueChangedEvent<TData, TContext>` | Enterprise | `10-aggregation.md` | A column is added to or removed from the values (aggregation) set. |
| `columnMoved` | `ColumnMovedEvent<TData, TContext>` | Community | `02-column-model.md` | A column is moved; `toIndex` and `finished` (last in drag sequence) are provided. |
| `columnVisible` | `ColumnVisibleEvent<TData, TContext>` | Community | `02-column-model.md` | Column visibility changes; `visible` indicates new state. |
| `columnPinned` | `ColumnPinnedEvent<TData, TContext>` | Community | `16-pinning-and-layout.md` | A column is pinned or unpinned; `pinned` is `'left'`, `'right'`, or `null`. |
| `columnGroupOpened` | `ColumnGroupOpenedEvent<TData, TContext>` | Community | `02-column-model.md` | A column group is opened or closed. |
| `columnResized` | `ColumnResizedEvent<TData, TContext>` | Community | `02-column-model.md` | A column is resized; `finished` flags the last event in a drag sequence. |
| `displayedColumnsChanged` | `DisplayedColumnsChangedEvent<TData, TContext>` | Community | `02-column-model.md` | The set of displayed (visible) columns changes for any reason. |
| `gridColumnsChanged` | `GridColumnsChangedEvent<TData, TContext>` | Community | `02-column-model.md` | The grid's internal column set changes (new column defs, state restore, etc.). |
| `virtualColumnsChanged` | `VirtualColumnsChangedEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | The set of virtual (rendered) columns changes, e.g., after horizontal scroll. |
| `columnHeaderMouseOver` | `ColumnHeaderMouseOverEvent<TData, TContext>` | Community | `02-column-model.md` | Mouse enters a column header cell. |
| `columnHeaderMouseLeave` | `ColumnHeaderMouseLeaveEvent<TData, TContext>` | Community | `02-column-model.md` | Mouse leaves a column header cell. |
| `columnHeaderClicked` | `ColumnHeaderClickedEvent<TData, TContext>` | Community | `02-column-model.md` | A column header cell is clicked. |
| `columnHeaderContextMenu` | `ColumnHeaderContextMenuEvent<TData, TContext>` | Community | `02-column-model.md` | Right-click on a column header cell. |
| `columnMenuVisibleChanged` | `ColumnMenuVisibleChangedEvent<TData, TContext>` | Community | `19-context-menu-and-clipboard.md` | Column menu (or filter/chooser panel) becomes visible or hidden. |
| `columnsReset` | `ColumnsResetEvent<TData, TContext>` | Community | `02-column-model.md` | Column state is reset to match the original column definitions. |

### Row events

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `rowDataUpdated` | `RowDataUpdatedEvent<TData, TContext>` | Community | `04-data-updates.md` | Row data has been updated (after `setRowData` or transaction is applied). |
| `rowDataUpdateStarted` | `RowDataUpdateStartedEvent<TData, TContext>` | Community | `04-data-updates.md` | Row data update is about to start; `firstRowData` is the first item in the new data. |
| `pinnedRowDataChanged` | `PinnedRowDataChangedEvent<TData, TContext>` | Community | `16-pinning-and-layout.md` | **Deprecated** — use `pinnedRowsChanged` instead. |
| `pinnedRowsChanged` | `PinnedRowsChangedEvent<TData, TContext>` | Community | `16-pinning-and-layout.md` | Pinned top or bottom rows change. |
| `rowGroupOpened` | `RowGroupOpenedEvent<TData, TContext>` | Enterprise | `09-row-grouping.md` | A row group is expanded or collapsed; `expanded` indicates new state. |
| `rowValueChanged` | `RowValueChangedEvent<TData, TContext>` | Community | `06-cell-editing.md` | Full-row editing completes; fires once per row after all cell edits. |
| `rowEditingStarted` | `RowEditingStartedEvent<TData, TContext>` | Community | `06-cell-editing.md` | Full-row edit mode begins. |
| `rowEditingStopped` | `RowEditingStoppedEvent<TData, TContext>` | Community | `06-cell-editing.md` | Full-row edit mode ends. |
| `rowClicked` | `RowClickedEvent<TData, TContext>` | Community | `12-selection.md` | A row is clicked. |
| `rowDoubleClicked` | `RowDoubleClickedEvent<TData, TContext>` | Community | `12-selection.md` | A row is double-clicked. |
| `virtualRowRemoved` | `VirtualRowRemovedEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | A previously rendered row is removed from the DOM (virtualisation). |
| `asyncTransactionsFlushed` | `AsyncTransactionsFlushedEvent<TData, TContext>` | Community | `04-data-updates.md` | Async transaction batch has been applied; `results` array contains outcomes. |
| `storeRefreshed` | `StoreRefreshedEvent<TData, TContext>` | Enterprise | `15-server-side-row-model.md` | A Server-Side Row Model store finishes refreshing; `route` identifies the level. |
| `rowCountReady` | `RowCountReadyEvent<TData, TContext>` | Community | `03-row-models.md` | The total row count is known for the first time after data load. |
| `rowResizeStarted` | `RowResizeStartedEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | User starts resizing a row by dragging its border. |
| `rowResizeEnded` | `RowResizeEndedEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | User finishes resizing a row. |
| `expandOrCollapseAll` | `ExpandOrCollapseAllEvent<TData, TContext>` | Enterprise | `09-row-grouping.md` | All groups are expanded or collapsed via API. |

### Cell events

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `cellClicked` | `CellClickedEvent<TData, TValue, TContext>` | Community | `05-rendering-and-dom.md` | A cell is clicked. |
| `cellDoubleClicked` | `CellDoubleClickedEvent<TData, TValue, TContext>` | Community | `05-rendering-and-dom.md` | A cell is double-clicked. |
| `cellMouseDown` | `CellMouseDownEvent<TData, TValue, TContext>` | Community | `05-rendering-and-dom.md` | Mouse button pressed over a cell. |
| `cellMouseOver` | `CellMouseOverEvent<TData, TValue, TContext>` | Community | `05-rendering-and-dom.md` | Mouse enters a cell. |
| `cellMouseOut` | `CellMouseOutEvent<TData, TValue, TContext>` | Community | `05-rendering-and-dom.md` | Mouse leaves a cell. |
| `cellContextMenu` | `CellContextMenuEvent<TData, TValue, TContext>` | Community | `19-context-menu-and-clipboard.md` | Right-click context menu opened over a cell. |
| `cellKeyDown` | `CellKeyDownEvent<TData, TValue, TContext> \| FullWidthCellKeyDownEvent<TData, TContext>` | Community | `20-keyboard-and-accessibility.md` | A key is pressed while a cell has focus. |
| `cellFocused` | `CellFocusedEvent<TData, TContext>` | Community | `20-keyboard-and-accessibility.md` | Focus moves to a cell; includes `rowIndex`, `column`, `rowPinned`. |
| `cellFocusCleared` | `CellFocusClearedEvent<TData, TContext>` | Community | `20-keyboard-and-accessibility.md` | Cell focus is removed. |
| `headerFocused` | `HeaderFocusedEvent<TData, TContext>` | Community | `20-keyboard-and-accessibility.md` | Focus moves to a column header. |
| `cellValueChanged` | `CellValueChangedEvent<TData, TValue, TContext>` | Community | `06-cell-editing.md` | A cell value is committed; provides `oldValue`, `newValue`, `newRawValue`, `source`. |
| `cellEditRequest` | `CellEditRequestEvent<TData, TValue, TContext>` | Community | `06-cell-editing.md` | Read-only grid (`readOnlyEdit: true`) receives an edit; app handles data update. |
| `cellEditValuesChanged` | `CellEditValuesChangedEvent<TData, TValue, TContext>` | Community | `06-cell-editing.md` | Pending batch-edit value changes in a cell; fires during batch editing session. |
| `cellEditingStarted` | `CellEditingStartedEvent<TData, TValue, TContext>` | Community | `06-cell-editing.md` | A cell enters edit mode. |
| `cellEditingStopped` | `CellEditingStoppedEvent<TData, TValue, TContext>` | Community | `06-cell-editing.md` | A cell exits edit mode; `oldValue`, `newValue`, `valueChanged` provided. |
| `tooltipShow` | `TooltipShowEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | A tooltip becomes visible; `tooltipGui` and `parentGui` are provided. |
| `tooltipHide` | `TooltipHideEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | A tooltip is hidden. |

### Selection events

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `rowSelected` | `RowSelectedEvent<TData, TContext>` | Community | `12-selection.md` | A row's selection state changes; `source` identifies the trigger. |
| `selectionChanged` | `SelectionChangedEvent<TData, TContext>` | Community | `12-selection.md` | The overall selection changes; `selectedNodes` and `serverSideState` are provided. |
| `rangeSelectionChanged` | `RangeSelectionChangedEvent<TData, TContext>` | Enterprise | `12-selection.md` | **Deprecated alias** — cell range selection changes; use `cellSelectionChanged`. |
| `cellSelectionChanged` | `CellSelectionChangedEvent<TData, TContext>` | Enterprise | `12-selection.md` | Cell range selection changes; `started` / `finished` mark drag begin/end. |
| `checkboxChanged` | `CheckboxChangedEvent<TData, TContext>` | Community | `12-selection.md` | A checkbox cell is toggled; `id`, `name`, `selected`, `previousValue` provided. |

### Filter / sort events

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `filterChanged` | `FilterChangedEvent<TData, TContext>` | Community | `08-filtering.md` | Active filter model changes; `source` identifies the trigger (api, quickFilter, etc.). |
| `filterModified` | `FilterModifiedEvent<TData, TContext>` | Community | `08-filtering.md` | Filter UI value changes but is not yet applied (e.g., while typing in text filter). |
| `filterOpened` | `FilterOpenedEvent<TData, TContext>` | Community | `08-filtering.md` | A column filter popup opens. |
| `filterUiChanged` | `FilterUiChangedEvent<TData, TContext>` | Community | `08-filtering.md` | Filter UI for a column changes. |
| `floatingFilterUiChanged` | `FloatingFilterUiChangedEvent<TData, TContext>` | Community | `08-filtering.md` | A floating filter UI value changes. |
| `advancedFilterBuilderVisibleChanged` | `AdvancedFilterBuilderVisibleChangedEvent<TData, TContext>` | Enterprise | `08-filtering.md` | Advanced Filter Builder dialog opens or closes. |
| `filterSwitched` | `FilterSwitchedEvent<TData, TContext>` | Community | `08-filtering.md` | The filter type is switched for a column (e.g., between filter types). |
| `sortChanged` | `SortChangedEvent<TData, TContext>` | Community | `07-sorting.md` | Sort order changes; `source` and affected `columns` array provided. |
| `findChanged` | `FindChangedEvent<TData, TContext>` | Community | `08-filtering.md` | Find (in-grid search) state changes; `findSearchValue`, `activeMatch`, `totalMatches` provided. |

### Group / pivot events

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `columnRowGroupChanged` | `ColumnRowGroupChangedEvent<TData, TContext>` | Enterprise | `09-row-grouping.md` | See Column events — also surfaced here for discoverability. |
| `columnPivotModeChanged` | `ColumnPivotModeChangedEvent<TData, TContext>` | Enterprise | `11-pivoting.md` | See Column events — also surfaced here for discoverability. |
| `columnPivotChanged` | `ColumnPivotChangedEvent<TData, TContext>` | Enterprise | `11-pivoting.md` | See Column events — also surfaced here for discoverability. |
| `pivotMaxColumnsExceeded` | `PivotMaxColumnsExceededEvent<TData, TContext>` | Enterprise | `11-pivoting.md` | The number of pivot result columns exceeds `pivotMaxGeneratedColumns`; `message` is provided. |

### Drag events

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `rowDragEnter` | `RowDragEnterEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | A row drag enters the grid or a drop zone; drag metadata provided. |
| `rowDragMove` | `RowDragMoveEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | The dragged row moves; `overIndex`, `overNode`, `y`, `vDirection` provided. |
| `rowDragLeave` | `RowDragLeaveEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | The dragged row leaves the grid or a drop zone. |
| `rowDragEnd` | `RowDragEndEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | A row drag completes (dropped); `rowsDrop` details provided. |
| `rowDragCancel` | `RowDragCancelEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | A row drag is cancelled (e.g., Escape key pressed). |
| `dragStarted` | `DragStartedEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | Any drag operation begins; `target` is the dragged DOM element. |
| `dragStopped` | `DragStoppedEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | Any drag operation ends (after column drag, row drag, etc.). |
| `dragCancelled` | `DragCancelledEvent<TData, TContext>` | Community | `05-rendering-and-dom.md` | Any drag operation is cancelled. |

### Tool panel / side bar events

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `toolPanelVisibleChanged` | `ToolPanelVisibleChangedEvent<TData, TContext>` | Enterprise | `17-side-bar-and-tool-panels.md` | A tool panel is shown or hidden; `key`, `visible`, `switchingToolPanel`, `source` provided. |
| `toolPanelSizeChanged` | `ToolPanelSizeChangedEvent<TData, TContext>` | Enterprise | `17-side-bar-and-tool-panels.md` | User resizes the side bar; `width`, `started`, `ended` provided. |
| `sideBarUpdated` | `SideBarUpdatedEvent<TData, TContext>` | Enterprise | `17-side-bar-and-tool-panels.md` | Side bar configuration is updated at runtime. |
| `columnMenuVisibleChanged` | `ColumnMenuVisibleChangedEvent<TData, TContext>` | Community | `17-side-bar-and-tool-panels.md` | Column menu / column chooser visibility changes (see Column events). |
| `contextMenuVisibleChanged` | `ContextMenuVisibleChangedEvent<TData, TContext>` | Enterprise | `19-context-menu-and-clipboard.md` | Context menu becomes visible or hidden; `visible`, `source` provided. |
| `columnPanelItemDragStart` | `ColumnPanelItemDragStartEvent<TData, TContext>` | Enterprise | `17-side-bar-and-tool-panels.md` | User starts dragging a column item in the Columns tool panel. |
| `columnPanelItemDragEnd` | `ColumnPanelItemDragEndEvent<TData, TContext>` | Enterprise | `17-side-bar-and-tool-panels.md` | User finishes dragging a column item in the Columns tool panel. |

### Chart events (Enterprise)

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `chartCreated` | `ChartCreatedEvent<TData, TContext>` | Enterprise | `24-charts-and-sparklines.md` | An integrated chart is created; `chartId` is provided. |
| `chartRangeSelectionChanged` | `ChartRangeSelectionChangedEvent<TData, TContext>` | Enterprise | `24-charts-and-sparklines.md` | The cell range linked to a chart changes; `chartId`, `cellRange` provided. |
| `chartOptionsChanged` | `ChartOptionsChangedEvent<TData, TContext>` | Enterprise | `24-charts-and-sparklines.md` | Chart options change; `chartId`, `chartType`, `chartThemeName`, `chartOptions` provided. |
| `chartDestroyed` | `ChartDestroyedEvent<TData, TContext>` | Enterprise | `24-charts-and-sparklines.md` | An integrated chart is destroyed; `chartId` provided. |
| `chartTitleEdit` | `ChartTitleEditEvent<TData, TContext>` | Enterprise | `24-charts-and-sparklines.md` | User edits the chart title inline. |

### Misc

| Event | Payload type | Tier | Originating area | Fires when |
|-------|-------------|------|-----------------|------------|
| `undoStarted` | `UndoStartedEvent<TData, TContext>` | Community | `06-cell-editing.md` | An undo operation begins (`UndoRedoEditModule`); `source` is `'api'` or `'ui'`. |
| `undoEnded` | `UndoEndedEvent<TData, TContext>` | Community | `06-cell-editing.md` | An undo operation completes; `operationPerformed` indicates success. |
| `redoStarted` | `RedoStartedEvent<TData, TContext>` | Community | `06-cell-editing.md` | A redo operation begins; `source` is `'api'` or `'ui'`. |
| `redoEnded` | `RedoEndedEvent<TData, TContext>` | Community | `06-cell-editing.md` | A redo operation completes; `operationPerformed` indicates success. |
| `cutStart` | `CutStartEvent<TData, TContext>` | Enterprise | `19-context-menu-and-clipboard.md` | A cut operation begins (`ClipboardModule`); `source` is `'api'`, `'ui'`, or `'contextMenu'`. |
| `cutEnd` | `CutEndEvent<TData, TContext>` | Enterprise | `19-context-menu-and-clipboard.md` | A cut operation completes. |
| `pasteStart` | `PasteStartEvent<TData, TContext>` | Enterprise | `19-context-menu-and-clipboard.md` | A paste operation begins. |
| `pasteEnd` | `PasteEndEvent<TData, TContext>` | Enterprise | `19-context-menu-and-clipboard.md` | A paste operation completes. |
| `fillStart` | `FillStartEvent<TData, TContext>` | Enterprise | `19-context-menu-and-clipboard.md` | Fill-handle drag begins (`CellSelectionModule`). |
| `fillEnd` | `FillEndEvent<TData, TContext>` | Enterprise | `19-context-menu-and-clipboard.md` | Fill-handle drag completes; `initialRange` and `finalRange` provided. |
| `cellSelectionDeleteStart` | `CellSelectionDeleteStartEvent<TData, TContext>` | Enterprise | `12-selection.md` | Delete key press over a cell range begins; `source: 'deleteKey'`. |
| `cellSelectionDeleteEnd` | `CellSelectionDeleteEndEvent<TData, TContext>` | Enterprise | `12-selection.md` | Delete key press over a cell range completes. |
| `rangeDeleteStart` | `RangeDeleteStartEvent<TData, TContext>` | Enterprise | `12-selection.md` | **Alias** — same as `cellSelectionDeleteStart` (older name). |
| `rangeDeleteEnd` | `RangeDeleteEndEvent<TData, TContext>` | Enterprise | `12-selection.md` | **Alias** — same as `cellSelectionDeleteEnd` (older name). |
| `batchEditingStarted` | `BatchEditingStartedEvent<TData, TContext>` | Community | `06-cell-editing.md` | First cell edit within a batch editing session starts (`BatchEditModule`). |
| `batchEditingStopped` | `BatchEditingStoppedEvent<TData, TContext>` | Community | `06-cell-editing.md` | Batch editing session ends (commit or cancel). |
| `bulkEditingStarted` | `BulkEditingStartedEvent<TData, TContext>` | Community | `06-cell-editing.md` | A bulk editing operation begins. |
| `bulkEditingStopped` | `BulkEditingStoppedEvent<TData, TContext>` | Community | `06-cell-editing.md` | A bulk editing operation ends. |

## API methods

N/A — see `23-api.md`.

## Canvas-port implications

Events drive the canvas layer's reactivity. `gridReady` is the entry point for attaching the canvas
renderer; `modelUpdated`, `viewportChanged`, and `virtualColumnsChanged` are the primary refresh
triggers. Cell interaction events (`cellClicked`, `cellMouseOver`) feed through to canvas hit-testing.
Range/cell selection events (`cellSelectionChanged`) control canvas range-highlight overlays.
