# AG Grid Feature Matrix

> Last verified: 2026-06-22 against AG Grid 35.3.1

| Area | Feature | Tier | Surface | Showcase-uses? | Canvas-port priority | Notes |
|------|---------|------|---------|----------------|----------------------|-------|

<!-- area:01 GridOptions -->
| 01 | rowData | Community | option | yes | P0 | Full dataset; delta-detected when getRowId provided |
| 01 | columnDefs | Community | option | yes | P0 | Column / column-group definition array |
| 01 | defaultColDef | Community | option | yes | P0 | Shared column defaults; runtime-mutable |
| 01 | rowModelType | Community | option | no | P0 | Selects CSRM, Infinite, SSRM, or Viewport; initial-only |
| 01 | getRowId | Community | option | yes | P0 | Stable row identity function; enables delta detection |
| 01 | rowBuffer | Community | option | no | P0 | Extra rows rendered outside visible viewport |
| 01 | domLayout | Community | option | no | P1 | normal / autoHeight / print layout mode |
| 01 | animateRows | Community | option | no | P2 | CSS transition for row position changes |
| 01 | suppressColumnVirtualisation | Community | option | no | P1 | Render all columns regardless of scroll |
| 01 | suppressRowVirtualisation | Community | option | no | P2 | Render all rows regardless of scroll |
| 01 | suppressChangeDetection | Community | option | no | P1 | Disable value change diffing |
| 01 | asyncTransactionWaitMillis | Community | option | yes | P0 | Async transaction batch window (ms) |
| 01 | suppressModelUpdateAfterUpdateTransaction | Community | option | no | P1 | Skip pipeline refresh on update-only transactions |
| 01 | cellFlashDuration | Community | option | yes | P1 | Duration of cell flash highlight |
| 01 | cellFadeDuration | Community | option | yes | P1 | Duration of cell flash fade-out |
| 01 | context | Community | option | no | P1 | Arbitrary app data passed to callbacks |
| 01 | loading | Community | option | no | P2 | Show/hide loading overlay |
| 01 | debug | Community | option | no | P3 | Verbose console logging |
| 01 | getGridId | Community | api | no | P2 | Returns grid instance identifier |
| 01 | setGridOption | Community | api | yes | P0 | Updates a single runtime-mutable option |
| 01 | updateGridOptions | Community | api | no | P0 | Batch-updates multiple runtime-mutable options |
| 01 | destroy | Community | api | no | P0 | Tears down the grid instance |
| 01 | addEventListener | Community | api | no | P1 | Subscribes to a grid event |
| 01 | gridReady | Community | event | yes | P0 | Grid initialised; API available |
| 01 | gridPreDestroyed | Community | event | no | P1 | Before grid teardown; state snapshot available |
| 01 | gridSizeChanged | Community | event | no | P1 | Grid container resized |
| 01 | firstDataRendered | Community | event | no | P0 | First rows rendered in viewport |
| 01 | stateUpdated | Community | event | no | P2 | Any serialisable grid state changes |
| 01 | Grid creation flow | Community | behavior | no | P0 | Init modules → cols → row model → state → render → gridReady |
| 01 | Initial vs runtime lifecycle | Community | behavior | no | P0 | initial-only props ignored by setGridOption at runtime |
| 01 | getRowId immutable contract | Community | behavior | yes | P0 | ID must be stable for lifetime of row |
| 01 | Overlay lifecycle | Community | behavior | no | P2 | Loading overlay auto-shown until rowData+columnDefs set |
| 01 | Async transaction batching | Community | behavior | yes | P0 | Transactions queued, flushed after waitMillis |

<!-- area:02 Column model -->
| 02 | colId / field | Community | option | yes | P0 | Column identity; field is dot-notation path into row data |
| 02 | headerName | Community | option | yes | P0 | Text shown in column header |
| 02 | headerValueGetter | Community | option | no | P2 | Dynamic header text via function/expression |
| 02 | valueGetter | Community | option | yes | P0 | Derives cell value from row data; used for sort/filter/export |
| 02 | valueFormatter | Community | option | yes | P0 | Formats raw value to display string |
| 02 | valueSetter | Community | option | no | P2 | Writes edited value back to row data |
| 02 | valueParser | Community | option | no | P2 | Parses string edit value before valueSetter |
| 02 | type (columnTypes) | Community | option | yes | P1 | Named column type templates for property reuse |
| 02 | cellDataType | Community | option | no | P1 | Infers/declares data type for filtering and formatting |
| 02 | headerClass | Community | option | no | P1 | CSS class(es) on header cell |
| 02 | cellClass | Community | option | yes | P1 | CSS class(es) on body cells |
| 02 | cellClassRules | Community | option | no | P1 | Predicate-driven CSS class map for body cells |
| 02 | cellStyle | Community | option | yes | P1 | Inline style object for body cells |
| 02 | tooltipField | Community | option | no | P2 | Data field value shown as cell tooltip |
| 02 | tooltipValueGetter | Community | option | no | P2 | Callback returning tooltip string |
| 02 | cellRenderer | Community | option | yes | P0 | Custom cell renderer component or function |
| 02 | cellRendererParams | Community | option | yes | P0 | Static params passed to cellRenderer |
| 02 | cellRendererSelector | Community | option | no | P1 | Per-row dynamic renderer selection callback |
| 02 | enableCellChangeFlash | Community | option | yes | P1 | Flash cell on value change |
| 02 | autoHeight | Community | option | no | P2 | Row height expands to fit this column's content |
| 02 | wrapText | Community | option | no | P2 | Enables text wrap inside cell |
| 02 | width / initialWidth | Community | option | yes | P0 | Column pixel width |
| 02 | minWidth / maxWidth | Community | option | yes | P0 | Column width constraints |
| 02 | flex | Community | option | yes | P0 | Proportional width allocation; overrides explicit width |
| 02 | resizable | Community | option | yes | P1 | User can resize column by dragging header edge |
| 02 | suppressSizeToFit | Community | option | no | P1 | Exclude from sizeColumnsToFit() |
| 02 | hide / initialHide | Community | option | yes | P0 | Column visibility |
| 02 | lockVisible / lockPosition | Community | option | no | P2 | Prevent UI visibility/position changes |
| 02 | suppressMovable | Community | option | no | P2 | Prevent user column reordering |
| 02 | pinned / initialPinned | Community | option | yes | P1 | Pin column to left or right frozen pane |
| 02 | lockPinned | Community | option | no | P2 | Prevent user pin changes |
| 02 | suppressNavigable | Community | option | no | P2 | Exclude cell from keyboard tab navigation |
| 02 | suppressKeyboardEvent | Community | option | no | P2 | Block specific keyboard events in cell |
| 02 | ColGroupDef.children | Community | option | yes | P0 | Children of a column group |
| 02 | ColGroupDef.openByDefault | Community | option | no | P2 | Group expanded on load |
| 02 | ColGroupDef.marryChildren | Community | option | no | P2 | Prevents separating group's columns via drag |
| 02 | getColumnState | Community | api | no | P1 | Serialisable snapshot of column state |
| 02 | applyColumnState | Community | api | no | P1 | Restores column state from snapshot |
| 02 | resetColumnState | Community | api | no | P2 | Resets column state to definition defaults |
| 02 | setColumnsVisible | Community | api | no | P1 | Show/hide specified columns |
| 02 | setColumnsPinned | Community | api | no | P1 | Set pinned state for columns |
| 02 | setColumnWidths | Community | api | no | P1 | Set pixel widths for columns |
| 02 | moveColumns | Community | api | no | P2 | Reorder columns programmatically |
| 02 | sizeColumnsToFit | Community | api | no | P1 | Fit columns to available grid width |
| 02 | autoSizeColumns | Community | api | no | P2 | Auto-size columns to cell contents |
| 02 | autoSizeAllColumns | Community | api | no | P2 | Auto-size all displayed columns |
| 02 | columnVisible | Community | event | no | P1 | Column(s) shown or hidden |
| 02 | columnPinned | Community | event | no | P1 | Column(s) pinned or unpinned |
| 02 | columnResized | Community | event | no | P1 | Column width changed |
| 02 | columnMoved | Community | event | no | P2 | Column(s) reordered |
| 02 | displayedColumnsChanged | Community | event | no | P1 | Displayed column set changes |
| 02 | virtualColumnsChanged | Community | event | no | P1 | Virtually rendered column set changes |
| 02 | Flex sizing algorithm | Community | behavior | yes | P0 | Proportional width from remaining free space |
| 02 | valueGetter / valueFormatter / cellRenderer separation | Community | behavior | yes | P0 | Three-layer pipeline; sort/filter use valueGetter only |
| 02 | Column state round-trip | Community | behavior | no | P1 | getColumnState/applyColumnState for persistence |
| 02 | defaultColDef merging | Community | behavior | yes | P0 | Column-level props win over defaultColDef |
| 02 | Column group open/close | Community | behavior | no | P2 | Animated width change when group expands/collapses |

<!-- area:03 Row models -->
| 03 | rowModelType: clientSide | Community | option | yes | P0 | All rows in memory; supports grouping/pivot/tree |
| 03 | rowModelType: infinite | Community | option | no | P2 | Block-fetched flat datasets; no grouping |
| 03 | rowModelType: viewport | Enterprise | option | no | P2 | Push-based window fetch; real-time feeds |
| 03 | rowModelType: serverSide | Enterprise | option | no | P2 | Lazy grouped/pivoted fetch from server |
| 03 | getRowId (CSRM delta) | Community | option | yes | P0 | Enables row matching on rowData replacement |
| 03 | resetRowDataOnUpdate | Community | option | no | P1 | Forces full reset even with getRowId |
| 03 | datasource (IDatasource) | Community | option | no | P2 | Infinite row model datasource |
| 03 | cacheBlockSize | Community | option | no | P2 | Rows per fetched block |
| 03 | cacheOverflowSize | Community | option | no | P3 | Blank overflow rows for scroll-triggering |
| 03 | maxBlocksInCache | Community | option | no | P2 | LRU block eviction cap |
| 03 | maxConcurrentDatasourceRequests | Community | option | no | P2 | Throttle parallel getRows calls |
| 03 | blockLoadDebounceMillis | Community | option | no | P2 | Debounce delay before fetching block |
| 03 | viewportDatasource (IViewportDatasource) | Enterprise | option | no | P2 | Viewport row model datasource |
| 03 | serverSideDatasource (IServerSideDatasource) | Enterprise | option | no | P2 | SSRM datasource |
| 03 | purgeClosedRowNodes | Enterprise | option | no | P3 | Removes cached children when group collapses |
| 03 | applyTransaction | Community | api | yes | P0 | Sync add/update/remove rows |
| 03 | applyTransactionAsync | Community | api | yes | P0 | Queue transaction for batched apply |
| 03 | flushAsyncTransactions | Community | api | no | P0 | Immediately flush pending async transactions |
| 03 | forEachNode | Community | api | no | P1 | Iterate all row nodes |
| 03 | forEachLeafNode | Community | api | no | P1 | Iterate leaf row nodes only |
| 03 | forEachNodeAfterFilter | Community | api | no | P1 | Iterate nodes passing current filter |
| 03 | getRowNode | Community | api | no | P0 | Lookup row node by getRowId value |
| 03 | getRenderedNodes | Community | api | no | P1 | Returns rendered (viewport+buffer) row nodes |
| 03 | setRowCount | Community | api | no | P2 | Set virtual row count for Infinite/SSRM |
| 03 | rowDataUpdated | Community | event | no | P0 | rowData was set on CSRM |
| 03 | modelUpdated | Community | event | no | P0 | Displayed rows recomputed |
| 03 | asyncTransactionsFlushed | Community | event | yes | P0 | Async transactions applied |
| 03 | IDatasource.getRows contract | Community | behavior | no | P2 | startRow/endRow/successCallback/failCallback |
| 03 | IViewportDatasource.setViewportRange | Enterprise | behavior | no | P2 | Push data for visible window |
| 03 | IServerSideDatasource.getRows + groupKeys | Enterprise | behavior | no | P2 | Navigate group hierarchy via groupKeys array |
| 03 | getRowId delta detection semantics | Community | behavior | yes | P0 | ID-matched update; unmatched = add/remove |
| 03 | Block cache LRU eviction | Community | behavior | no | P2 | maxBlocksInCache triggers eviction |

<!-- area:04 Data updates -->
| 04 | setGridOption rowData (full replace) | Community | option | yes | P0 | Replace entire dataset; delta-detects with getRowId |
| 04 | getRowId for delta detection | Community | option | yes | P0 | Enables row-level reconciliation on rowData change |
| 04 | resetRowDataOnUpdate | Community | option | no | P1 | Forces full replacement even with getRowId |
| 04 | asyncTransactionWaitMillis | Community | option | yes | P0 | Batching window for applyTransactionAsync |
| 04 | suppressModelUpdateAfterUpdateTransaction | Community | option | no | P1 | Skip pipeline refresh on update-only transactions |
| 04 | enableCellChangeFlash (ColDef) | Community | option | yes | P1 | Auto-flash on value change |
| 04 | cellFlashDuration | Community | option | yes | P1 | Flash hold duration (ms) |
| 04 | cellFadeDuration | Community | option | yes | P1 | Flash fade duration (ms) |
| 04 | deltaSort | Community | option | no | P1 | Sort only changed rows in transaction |
| 04 | suppressChangeDetection | Community | option | no | P1 | Disable value diff before refresh |
| 04 | applyTransaction | Community | api | yes | P0 | Sync add/update/remove transaction |
| 04 | applyTransactionAsync | Community | api | yes | P0 | Queue transaction for async batch |
| 04 | flushAsyncTransactions | Community | api | no | P0 | Flush pending async transactions immediately |
| 04 | refreshCells | Community | api | no | P0 | Re-render cells in place |
| 04 | redrawRows | Community | api | no | P1 | Destroy and recreate rows |
| 04 | flashCells | Community | api | no | P1 | Trigger flash animation on cells |
| 04 | refreshClientSideRowModel | Community | api | no | P1 | Re-run CSRM pipeline from a given step |
| 04 | rowDataUpdated | Community | event | no | P0 | rowData set on CSRM |
| 04 | modelUpdated | Community | event | yes | P0 | Displayed rows recomputed |
| 04 | asyncTransactionsFlushed | Community | event | yes | P0 | Async transaction batch applied |
| 04 | cellValueChanged | Community | event | no | P1 | Cell value changed |
| 04 | Full-replace vs delta detection | Community | behavior | yes | P0 | ID matching reconciliation semantics |
| 04 | Async transaction batching | Community | behavior | yes | P0 | Queue → setTimeout → flush → fire event |
| 04 | Immutable data mode (rowData replace + getRowId) | Community | behavior | no | P1 | Store-driven update pattern |
| 04 | refreshCells vs redrawRows | Community | behavior | no | P0 | Refresh in-place vs full row recreate |
| 04 | enableCellChangeFlash auto-trigger | Community | behavior | yes | P1 | Flash on value change in transaction |
| 04 | deltaSort for large streamed datasets | Community | behavior | no | P1 | Sort only transaction-changed rows |

<!-- area:05 Rendering & DOM -->
| 05 | rowBuffer | Community | option | no | P0 | Extra rows rendered outside visible viewport |
| 05 | suppressRowVirtualisation | Community | option | no | P2 | Render all rows; severe performance impact |
| 05 | suppressMaxRenderedRowRestriction | Community | option | no | P3 | Remove 500-row cap when virt disabled |
| 05 | suppressAnimationFrame | Community | option | no | P1 | Disable rAF scheduling for scroll rendering |
| 05 | suppressColumnVirtualisation | Community | option | no | P1 | Render all columns regardless of scroll |
| 05 | rowHeight | Community | option | yes | P0 | Default row height in pixels |
| 05 | getRowHeight | Community | option | no | P1 | Per-row height callback |
| 05 | domLayout: normal | Community | option | no | P0 | Fixed-height container with scrollbars |
| 05 | domLayout: autoHeight | Community | option | no | P2 | Container grows to show all rows |
| 05 | domLayout: print | Community | option | no | P3 | All rows visible; no scrollbars |
| 05 | ensureDomOrder | Community | option | no | P2 | DOM order matches visual order |
| 05 | suppressRowTransform | Community | option | no | P2 | CSS top instead of transform for rows |
| 05 | isFullWidthRow | Community | option | no | P2 | Mark rows as full-width |
| 05 | fullWidthCellRenderer | Community | option | no | P2 | Renderer for full-width rows |
| 05 | embedFullWidthRows | Community | option | no | P3 | Full-width rows scroll horizontally |
| 05 | cellRenderer (ColDef) | Community | option | yes | P0 | Custom cell renderer component |
| 05 | cellRendererParams (ColDef) | Community | option | yes | P0 | Params for cell renderer |
| 05 | cellRendererSelector (ColDef) | Community | option | no | P1 | Per-row dynamic renderer selection |
| 05 | autoHeight (ColDef) | Community | option | no | P2 | Row expands to fit column content |
| 05 | wrapText (ColDef) | Community | option | no | P2 | Enable text wrap in cell |
| 05 | animateRows | Community | option | no | P2 | CSS transition for row position animation |
| 05 | suppressScrollOnNewData | Community | option | no | P2 | No auto-scroll to top on data replace |
| 05 | alwaysShowHorizontalScroll | Community | option | no | P2 | Always visible horizontal scrollbar |
| 05 | alwaysShowVerticalScroll | Community | option | no | P2 | Always visible vertical scrollbar |
| 05 | refreshCells | Community | api | no | P0 | Re-render cells in place |
| 05 | redrawRows | Community | api | no | P1 | Destroy and recreate rows |
| 05 | flashCells | Community | api | no | P1 | Trigger flash animation |
| 05 | getCellRendererInstances | Community | api | no | P2 | Access live renderer instances |
| 05 | getRenderedNodes | Community | api | no | P1 | Viewport + buffer row nodes |
| 05 | ensureIndexVisible | Community | api | no | P1 | Scroll to row by index |
| 05 | ensureNodeVisible | Community | api | no | P1 | Scroll to row node |
| 05 | ensureColumnVisible | Community | api | no | P1 | Scroll to column |
| 05 | getVerticalPixelRange | Community | api | no | P1 | Current vertical scroll range |
| 05 | getHorizontalPixelRange | Community | api | no | P1 | Current horizontal scroll range |
| 05 | resetRowHeights | Community | api | no | P1 | Recompute all row heights |
| 05 | viewportChanged | Community | event | no | P0 | Visible row range changed due to scroll |
| 05 | firstDataRendered | Community | event | no | P0 | First rows in DOM |
| 05 | virtualRowRemoved | Community | event | no | P1 | Row removed from DOM by virtualisation |
| 05 | virtualColumnsChanged | Community | event | no | P1 | Virtually rendered column set changes |
| 05 | bodyScroll | Community | event | no | P1 | Scroll event on grid body |
| 05 | bodyScrollEnd | Community | event | no | P1 | Scroll stopped |
| 05 | Row virtualisation render window | Community | behavior | no | P0 | viewport_rows + 2*rowBuffer rows in DOM |
| 05 | Column virtualisation | Community | behavior | no | P0 | Only horizontally visible columns rendered |
| 05 | ICellRendererComp interface | Community | behavior | yes | P0 | init/getGui/refresh/destroy lifecycle |
| 05 | valueGetter / valueFormatter / cellRenderer separation | Community | behavior | yes | P0 | Sort/filter use valueGetter; renderer sees both |
| 05 | cellRendererSelector dynamic dispatch | Community | behavior | no | P1 | Per-row renderer selection |
| 05 | Dynamic row heights via getRowHeight | Community | behavior | no | P1 | Per-row pixel height callback |
| 05 | Full-width row paint mode | Community | behavior | no | P2 | Single painter spans full row width |
| 05 | domLayout autoHeight | Community | behavior | no | P2 | Container grows; no vertical scrollbar |
| 05 | domLayout print | Community | behavior | no | P3 | All rows rendered; no scroll; for printing |

<!-- area:06 Cell editing -->
| 06 | editable (ColDef) | Community | option | no | P1 | Boolean or callback enabling cell editing per column |
| 06 | cellEditor (ColDef) | Community | option | no | P1 | Built-in or custom editor component key/class |
| 06 | cellEditorParams (ColDef) | Community | option | no | P1 | Params passed to the cell editor on init |
| 06 | cellEditorSelector (ColDef) | Community | option | no | P1 | Per-row callback returning dynamic editor + params |
| 06 | cellEditorPopup (ColDef) | Community | option | no | P2 | Render editor in a popup overlay |
| 06 | cellEditorPopupPosition (ColDef) | Community | option | no | P2 | Popup position: 'over' or 'under' the cell |
| 06 | singleClickEdit (ColDef) | Community | option | no | P2 | Start editing on single click for this column |
| 06 | valueSetter (ColDef) | Community | option | no | P1 | Writes parsed edit value back to row data |
| 06 | valueParser (ColDef) | Community | option | no | P1 | Converts raw editor string to typed value |
| 06 | useValueParserForImport (ColDef) | Community | option | no | P2 | Apply valueParser on clipboard paste and fill handle |
| 06 | onCellValueChanged (ColDef) | Community | option | no | P1 | Column-level callback when cell value changes |
| 06 | editType (GridOptions) | Community | option | no | P1 | 'fullRow' enables full-row edit mode |
| 06 | singleClickEdit (GridOptions) | Community | option | no | P2 | Grid-level single-click to edit |
| 06 | suppressClickEdit | Community | option | no | P2 | Disable click-to-edit; programmatic only |
| 06 | readOnlyEdit | Community | option | no | P1 | Grid fires cellEditRequest instead of committing edits |
| 06 | stopEditingWhenCellsLoseFocus | Community | option | no | P2 | Stop edit when grid loses focus |
| 06 | enterNavigatesVertically | Community | option | no | P2 | Enter moves focus down (Excel-style) |
| 06 | enterNavigatesVerticallyAfterEdit | Community | option | no | P2 | Enter moves down after edit commit |
| 06 | enableCellEditingOnBackspace | Community | option | no | P3 | macOS: start edit on Backspace |
| 06 | suppressStartEditOnTab | Community | option | no | P2 | Prevent Tab from starting next cell edit |
| 06 | invalidEditValueMode | Community | option | no | P2 | 'block' keeps editor open on validation failure |
| 06 | getFullRowEditValidationErrors | Community | option | no | P2 | Validate full-row edit before commit |
| 06 | undoRedoCellEditing | Community | option | no | P2 | Enable undo/redo stack for cell edits |
| 06 | undoRedoCellEditingLimit | Community | option | no | P2 | Max depth of undo/redo stack |
| 06 | agTextCellEditor | Community | option | no | P1 | Built-in plain text editor |
| 06 | agLargeTextCellEditor | Community | option | no | P2 | Built-in textarea editor |
| 06 | agSelectCellEditor | Community | option | no | P2 | Built-in native select editor |
| 06 | agNumberCellEditor | Community | option | no | P1 | Built-in numeric input editor |
| 06 | agDateCellEditor | Community | option | no | P2 | Built-in date picker editor |
| 06 | agDateStringCellEditor | Community | option | no | P2 | Built-in date editor storing value as string |
| 06 | agCheckboxCellEditor | Community | option | no | P2 | Built-in checkbox editor |
| 06 | agRichSelectCellEditor | Enterprise | option | no | P2 | Enterprise virtualised dropdown editor with search |
| 06 | startEditingCell | Community | api | no | P1 | Programmatically start editing a cell |
| 06 | stopEditing | Community | api | no | P1 | Stop any active edit; optionally cancel |
| 06 | getEditingCells | Community | api | no | P1 | Return list of cells currently in edit mode |
| 06 | getEditRowValues | Community | api | no | P2 | Pending edit values for a row during full-row edit |
| 06 | getCellEditorInstances | Community | api | no | P2 | Access live editor component instances |
| 06 | isEditing | Community | api | no | P2 | Check if a specific cell is being edited |
| 06 | validateEdit | Community | api | no | P2 | Run validation on all active editors |
| 06 | undoCellEditing | Community | api | no | P2 | Revert last cell edit |
| 06 | redoCellEditing | Community | api | no | P2 | Re-apply most recently undone edit |
| 06 | getCurrentUndoSize | Community | api | no | P3 | Number of available undo operations |
| 06 | getCurrentRedoSize | Community | api | no | P3 | Number of available redo operations |
| 06 | cellEditingStarted | Community | event | no | P1 | Cell editor activated |
| 06 | cellEditingStopped | Community | event | no | P1 | Cell editor closed |
| 06 | cellValueChanged | Community | event | no | P1 | Cell value committed (edit, paste, undo, redo) |
| 06 | cellEditRequest | Community | event | no | P1 | Fired instead of commit when readOnlyEdit=true |
| 06 | rowEditingStarted | Community | event | no | P2 | Full-row edit started |
| 06 | rowEditingStopped | Community | event | no | P2 | Full-row edit ended |
| 06 | rowValueChanged | Community | event | no | P2 | At least one value changed in full-row edit |
| 06 | undoStarted | Community | event | no | P2 | Undo operation begins |
| 06 | undoEnded | Community | event | no | P2 | Undo operation completes |
| 06 | redoStarted | Community | event | no | P2 | Redo operation begins |
| 06 | redoEnded | Community | event | no | P2 | Redo operation completes |
| 06 | Single-cell vs full-row edit mode | Community | behavior | no | P1 | editType='fullRow' activates all editable cells in row |
| 06 | valueParser / valueSetter pipeline | Community | behavior | no | P1 | Editor → parser → setter → data write |
| 06 | Popup editor positioning | Community | behavior | no | P2 | 'over' covers cell; 'under' leaves value visible |
| 06 | readOnlyEdit immutable pattern | Community | behavior | no | P1 | Grid fires cellEditRequest; app pushes transaction |
| 06 | Undo / redo stack semantics | Community | behavior | no | P2 | Bounded stack; cleared on external transaction |
| 06 | Custom editor ICellEditor interface | Community | behavior | no | P1 | getValue/isCancelBeforeStart/isCancelAfterEnd lifecycle |
| 06 | Validation via getValidationErrors | Community | behavior | no | P2 | Editor returns errors; grid blocks commit when configured |

<!-- area:07 Sorting -->
| 07 | sortable (ColDef) | Community | option | yes | P0 | Enable/disable sorting for a column; defaultColDef sets true |
| 07 | sort (ColDef) | Community | option | yes | P1 | Initial sort direction ('asc', 'desc', null) or SortDef |
| 07 | initialSort (ColDef) | Community | option | no | P1 | Sort direction applied only on first column creation |
| 07 | sortIndex (ColDef) | Community | option | no | P1 | Multi-sort position for this column |
| 07 | initialSortIndex (ColDef) | Community | option | no | P1 | Multi-sort position applied on first creation only |
| 07 | sortingOrder (ColDef) | Community | option | no | P2 | Per-column sort cycle array |
| 07 | comparator (ColDef) | Community | option | no | P1 | Custom sort comparator function or map by SortType |
| 07 | unSortIcon (ColDef) | Community | option | no | P2 | Show unsorted icon when column has no active sort |
| 07 | accentedSort | Community | option | no | P2 | Locale-aware sort distinguishing accented characters |
| 07 | suppressMultiSort | Community | option | no | P2 | Disable multi-column sort |
| 07 | alwaysMultiSort | Community | option | no | P2 | Every click is a multi-sort click |
| 07 | multiSortKey | Community | option | no | P2 | Change multi-sort modifier to Ctrl/Command |
| 07 | suppressMaintainUnsortedOrder | Community | option | no | P2 | Keep last sort order when sort is cleared |
| 07 | deltaSort | Community | option | no | P1 | Re-sort only transaction-changed rows; see 04-data-updates.md |
| 07 | postSortRows | Community | option | no | P2 | Post-sort callback to reorder rows arbitrarily |
| 07 | sortingOrder (GridOptions) | Community | option | no | P2 | Deprecated v33. Grid-level sort cycle; use defaultColDef.sortingOrder |
| 07 | unSortIcon (GridOptions) | Community | option | no | P2 | Deprecated v33. Show unsorted icon globally; use defaultColDef.unSortIcon |
| 07 | onSortChanged | Community | api | no | P1 | Notify grid of external sort-state change; triggers re-sort |
| 07 | applyColumnState (sort) | Community | api | yes | P1 | Programmatically set sort/sortIndex via column state |
| 07 | getColumnState (sort) | Community | api | no | P1 | Retrieve serialisable sort state for persistence |
| 07 | sortChanged | Community | event | no | P0 | Sort direction changes; includes affected columns |
| 07 | Multi-sort Shift-click mechanics | Community | behavior | no | P1 | sortIndex badges; Shift adds/removes column from composite sort |
| 07 | Sort cycle (sortingOrder) | Community | behavior | yes | P1 | null→asc→desc→null default cycle per column |
| 07 | Custom comparator contract | Community | behavior | no | P1 | Negative=A before B; do not negate based on isDescending |
| 07 | accentedSort vs default comparator | Community | behavior | no | P2 | localeCompare with accent sensitivity; slower on large sets |
| 07 | postSortRows disables deltaSort | Community | behavior | no | P2 | Full sort always runs when postSortRows is configured |
| 07 | suppressMaintainUnsortedOrder semantics | Community | behavior | no | P2 | Cleared sort keeps last sorted order instead of original |
| 07 | getRowId stable sort interaction | Community | behavior | yes | P1 | Stable row identity prevents position thrash in delta updates |

<!-- area:08 Filtering -->
| 08 | filter (ColDef) | Community | option | yes | P0 | Column filter: true, filter key, or custom component |
| 08 | filterParams (ColDef) | Community | option | yes | P0 | Params for the column filter component |
| 08 | filterValueGetter (ColDef) | Community | option | no | P1 | Value used for filtering (can differ from display value) |
| 08 | floatingFilter (ColDef) | Community | option | yes | P0 | Show floating filter row for this column |
| 08 | floatingFilterComponent (ColDef) | Community | option | no | P2 | Custom floating filter component |
| 08 | floatingFilterComponentParams (ColDef) | Community | option | no | P2 | Params for custom floating filter |
| 08 | suppressFloatingFilterButton (ColDef) | Community | option | no | P2 | Hide the expand button on floating filter |
| 08 | getQuickFilterText (ColDef) | Community | option | no | P2 | Column-level text contributed to quick-filter search |
| 08 | agTextColumnFilter | Community | option | yes | P0 | Built-in text filter with contains/equals/startsWith etc. |
| 08 | agNumberColumnFilter | Community | option | yes | P0 | Built-in numeric filter with equals/range/greaterThan etc. |
| 08 | agDateColumnFilter | Community | option | no | P1 | Built-in date filter with equals/range/before/after etc. |
| 08 | agSetColumnFilter | Enterprise | option | yes | P1 | Enterprise checkbox-list filter from distinct column values |
| 08 | agMultiColumnFilter | Enterprise | option | yes | P0 | Enterprise composite filter wrapping multiple child filters |
| 08 | IProvidedFilterParams.buttons | Community | option | yes | P1 | Filter action buttons: apply, clear, reset, cancel |
| 08 | IProvidedFilterParams.closeOnApply | Community | option | no | P2 | Close popup after Apply/Reset click |
| 08 | IProvidedFilterParams.debounceMs | Community | option | no | P2 | Debounce before filter applies on typing |
| 08 | IProvidedFilterParams.readOnly | Community | option | no | P2 | Filter UI read-only; set via API only |
| 08 | ISimpleFilterParams.filterOptions | Community | option | no | P1 | Which filter conditions to show in dropdown |
| 08 | ISimpleFilterParams.defaultOption | Community | option | no | P2 | Default selected filter condition |
| 08 | ISimpleFilterParams.defaultJoinOperator | Community | option | no | P2 | Default AND/OR join between two conditions |
| 08 | ISimpleFilterParams.maxNumConditions | Community | option | no | P2 | Maximum concurrent filter conditions |
| 08 | ITextFilterParams.caseSensitive | Community | option | no | P2 | Case-sensitive text matching |
| 08 | ITextFilterParams.textMatcher | Community | option | no | P2 | Custom text match function |
| 08 | ITextFilterParams.trimInput | Community | option | no | P2 | Trim whitespace from filter input |
| 08 | INumberFilterParams.allowedCharPattern | Community | option | no | P2 | Restrict characters in number filter input |
| 08 | INumberFilterParams.numberParser | Community | option | no | P2 | Custom string-to-number converter for filter |
| 08 | ISetFilterParams.values | Enterprise | option | no | P1 | Static or async values list for set filter |
| 08 | ISetFilterParams.suppressMiniFilter | Enterprise | option | no | P2 | Hide mini search box in set filter |
| 08 | ISetFilterParams.caseSensitive | Enterprise | option | no | P2 | Case-sensitive mini-filter matching |
| 08 | IMultiFilterParams.filters | Enterprise | option | yes | P0 | Child filter definitions for agMultiColumnFilter |
| 08 | quickFilterText | Community | option | no | P1 | Grid-level quick-filter text applied to all columns |
| 08 | cacheQuickFilter | Community | option | no | P2 | Cache quick-filter aggregate text for performance |
| 08 | includeHiddenColumnsInQuickFilter | Community | option | no | P2 | Apply quick filter to hidden columns |
| 08 | quickFilterParser | Community | option | no | P2 | Custom function to split quick-filter text into terms |
| 08 | quickFilterMatcher | Community | option | no | P2 | Custom function to match terms against row text |
| 08 | isExternalFilterPresent | Community | option | no | P1 | Callback returning true when external filter is active |
| 08 | doesExternalFilterPass | Community | option | no | P1 | Per-row callback for external filter logic |
| 08 | alwaysPassFilter | Community | option | no | P2 | Rows bypassing all filters unconditionally |
| 08 | enableFilterHandlers | Community | option | no | P2 | When true, grid expects user-provided filter handlers; toggles which filter events fire |
| 08 | getFilterModel | Community | api | no | P1 | Returns all column filter models as serialisable object |
| 08 | setFilterModel | Community | api | no | P1 | Restore all column filter states from model object |
| 08 | getColumnFilterModel | Community | api | no | P1 | Get filter model for a single column |
| 08 | setColumnFilterModel | Community | api | no | P1 | Set filter model for a single column |
| 08 | getColumnFilterInstance | Community | api | no | P2 | Access live filter component instance (async) |
| 08 | destroyFilter | Community | api | no | P2 | Force recreation of a column's filter |
| 08 | showColumnFilter | Community | api | no | P2 | Programmatically open a column filter popup |
| 08 | hideColumnFilter | Community | api | no | P2 | Close open filter popup |
| 08 | onFilterChanged | Community | api | no | P1 | Signal grid of external filter state change |
| 08 | isAnyFilterPresent | Community | api | no | P1 | Check if any filter is currently active |
| 08 | isColumnFilterPresent | Community | api | no | P1 | Check if any column filter is active |
| 08 | filterChanged | Community | event | no | P0 | Any filter changes; includes source and affected columns |
| 08 | filterModified | Community | event | no | P2 | Filter UI modified but not yet applied |
| 08 | filterUiChanged | Community | event | no | P2 | Filter UI state changes |
| 08 | filterOpened | Community | event | no | P2 | Filter popup opened |
| 08 | floatingFilterUiChanged | Community | event | no | P2 | Floating filter UI state changes |
| 08 | Column filter AND combination | Community | behavior | yes | P0 | All active column filters combined with AND |
| 08 | Quick filter multi-term matching | Community | behavior | no | P1 | All terms must appear somewhere in the row |
| 08 | External filter callback pattern | Community | behavior | no | P1 | isExternalFilterPresent + doesExternalFilterPass lifecycle |
| 08 | getFilterModel / setFilterModel round-trip | Community | behavior | no | P1 | Serialisable filter state for persistence/URL |
| 08 | Filter buttons apply/clear/reset/cancel | Community | behavior | yes | P1 | Deferred apply mode via buttons config |
| 08 | Set filter Excel-like mode | Enterprise | behavior | no | P2 | Add-to-selection and Windows Excel behaviour |
| 08 | Multi filter child composition | Enterprise | behavior | yes | P0 | agMultiColumnFilter wraps text+set or number+set |
| 08 | Floating filter expand button | Community | behavior | yes | P1 | Compact summary in header row; click opens full filter |

<!-- area:09 Row grouping -->
| 09 | rowGroup (ColDef) | Enterprise | option | yes | P0 | Groups rows by this column's value; requires RowGroupingModule |
| 09 | initialRowGroup (ColDef) | Enterprise | option | no | P1 | rowGroup applied on first column creation only |
| 09 | rowGroupIndex (ColDef) | Enterprise | option | yes | P0 | Position of this column in the multi-level group hierarchy |
| 09 | initialRowGroupIndex (ColDef) | Enterprise | option | no | P1 | rowGroupIndex applied on first column creation only |
| 09 | enableRowGroup (ColDef) | Enterprise | option | yes | P1 | Allows user to drag column into row-group panel via GUI |
| 09 | showRowGroup (ColDef) | Enterprise | option | no | P2 | Displays grouped-column value in a custom group column cell |
| 09 | groupHierarchy (ColDef) | Enterprise | option | no | P2 | Declares virtual sub-columns for date-part or custom hierarchies |
| 09 | rowGroupingHierarchy (ColDef) | Enterprise | option | no | P3 | Deprecated — use groupHierarchy instead |
| 09 | groupDisplayType | Enterprise | option | yes | P0 | Controls group-column layout: singleColumn / multipleColumns / groupRows / custom |
| 09 | groupDefaultExpanded | Enterprise | option | yes | P0 | Levels expanded on load; -1 expands all |
| 09 | autoGroupColumnDef | Enterprise | option | yes | P0 | ColDef overrides for auto-generated group column(s) |
| 09 | groupMaintainOrder | Enterprise | option | no | P1 | Prevents value-column sorts from reordering groups |
| 09 | groupLockGroupColumns | Enterprise | option | no | P2 | Number of leading group columns locked from reorder/hide |
| 09 | groupAggFiltering | Enterprise | option | no | P2 | Applies filters to group-level aggregated values |
| 09 | groupTotalRow | Enterprise | option | yes | P0 | Inserts aggregate total row inside each expanded group |
| 09 | grandTotalRow | Enterprise | option | yes | P0 | Inserts grid-level aggregate total row |
| 09 | suppressStickyTotalRow | Enterprise | option | no | P2 | Disables sticky behaviour of total rows |
| 09 | groupSuppressBlankHeader | Enterprise | option | no | P2 | Hides blank group header cell when aggregate would jump |
| 09 | showOpenedGroup | Enterprise | option | no | P2 | Shows opened-group value in group column for child rows |
| 09 | groupHideOpenParents | Enterprise | option | no | P2 | Hides parent rows when expanded; children surface at top |
| 09 | groupHideColumnsUntilExpanded | Enterprise | option | no | P2 | Hides deeper group columns until parent level is expanded |
| 09 | groupHideParentOfSingleChild | Enterprise | option | no | P2 | Replaces single-child group with the child row inline |
| 09 | groupRemoveSingleChildren | Enterprise | option | no | P3 | Deprecated v33 — use groupHideParentOfSingleChild |
| 09 | groupRemoveLowestSingleChildren | Enterprise | option | no | P3 | Deprecated v33 — use groupHideParentOfSingleChild: 'leafGroupsOnly' |
| 09 | groupAllowUnbalanced | Enterprise | option | no | P2 | Prevents (Blanks) group for rows without a group-column value |
| 09 | rowGroupPanelShow | Enterprise | option | yes | P1 | Visibility of drag-and-drop row group panel |
| 09 | rowGroupPanelSuppressSort | Enterprise | option | no | P2 | Hides sort controls in row group panel |
| 09 | groupRowRenderer | Enterprise | option | no | P2 | Custom renderer for groupRows display-type group rows |
| 09 | groupRowRendererParams | Enterprise | option | no | P2 | Params for groupRowRenderer |
| 09 | suppressGroupRowsSticky | Enterprise | option | no | P2 | Prevents group rows sticking at grid top while scrolling |
| 09 | groupHierarchyConfig | Enterprise | option | no | P2 | Registers custom hierarchy types for colDef.groupHierarchy |
| 09 | initialGroupOrderComparator | Enterprise | option | no | P2 | Callback for initial ordering of group nodes |
| 09 | groupSelectsChildren | Enterprise | option | no | P2 | Deprecated v32.2 — use rowSelection.groupSelects; see 12-selection.md |
| 09 | groupSelectsFiltered | Enterprise | option | no | P3 | Deprecated v32.2 — use rowSelection.groupSelects configuration instead. When true with groupSelectsChildren, only filtered descendants selected. |
| 09 | setRowGroupColumns | Enterprise | api | no | P0 | Replaces current row-group columns |
| 09 | addRowGroupColumns | Enterprise | api | no | P0 | Adds columns to the row-group hierarchy |
| 09 | removeRowGroupColumns | Enterprise | api | no | P0 | Removes columns from the row-group hierarchy |
| 09 | moveRowGroupColumn | Enterprise | api | no | P1 | Reorders row-group columns by index |
| 09 | getRowGroupColumns | Enterprise | api | no | P1 | Returns current row-group columns |
| 09 | expandAll | Community | api | yes | P0 | Expands all group nodes — primarily used with row grouping (Enterprise) |
| 09 | collapseAll | Community | api | yes | P0 | Collapses all group nodes — primarily used with row grouping (Enterprise) |
| 09 | setRowNodeExpanded | Community | api | no | P1 | Sets expanded state on a specific group node — primarily used with row grouping (Enterprise) |
| 09 | onGroupExpandedOrCollapsed | Community | api | no | P1 | Signals grid that expansion state was mutated externally — primarily used with row grouping (Enterprise) |
| 09 | rowGroupOpened | Enterprise | event | no | P0 | Group row expanded or collapsed |
| 09 | columnRowGroupChanged | Enterprise | event | no | P1 | Column added to or removed from group hierarchy |
| 09 | groupDisplayType singleColumn mode | Enterprise | behavior | yes | P0 | All group levels share one auto column with indent |
| 09 | groupDisplayType multipleColumns mode | Enterprise | behavior | no | P1 | One auto column generated per group level |
| 09 | groupDisplayType groupRows mode | Enterprise | behavior | no | P2 | Full-width group row replaces group header column |
| 09 | groupDisplayType custom mode | Enterprise | behavior | no | P2 | Developer supplies group columns via showRowGroup |
| 09 | Sticky group headers | Enterprise | behavior | no | P1 | Group row sticks to top while children scroll through viewport |
| 09 | Group expansion depth control | Enterprise | behavior | yes | P0 | groupDefaultExpanded + expandAll/collapseAll API |
| 09 | Group total and grand total rows | Enterprise | behavior | yes | P0 | groupTotalRow/grandTotalRow insert aggregate rows |
| 09 | Unbalanced groups | Enterprise | behavior | no | P2 | groupAllowUnbalanced prevents synthetic (Blanks) node |
| 09 | autoGroupColumnDef customisation | Enterprise | behavior | yes | P0 | Any ColDef property except colId applied to auto group column |

<!-- area:10 Aggregation -->
| 10 | aggFunc (ColDef) | Enterprise | option | yes | P0 | Aggregation function; built-in: sum/min/max/count/avg/first/last |
| 10 | initialAggFunc (ColDef) | Enterprise | option | no | P1 | aggFunc applied on first column creation only |
| 10 | defaultAggFunc (ColDef) | Enterprise | option | no | P2 | GUI default agg function; does not immediately aggregate |
| 10 | allowedAggFuncs (ColDef) | Enterprise | option | no | P2 | GUI-visible agg function list; does not restrict API |
| 10 | enableValue (ColDef) | Enterprise | option | yes | P1 | Allows user to enable aggregation via GUI |
| 10 | aggFuncs (GridOptions) | Enterprise | option | no | P1 | Map of custom aggregation function names to IAggFunc |
| 10 | suppressAggFuncInHeader | Enterprise | option | yes | P0 | Hides aggFunc name prefix from column headers |
| 10 | alwaysAggregateAtRootLevel | Enterprise | option | no | P2 | Forces root-level aggregation even without grouping |
| 10 | aggregateOnlyChangedColumns | Enterprise | option | no | P1 | Limits re-aggregation to columns with changed leaf values |
| 10 | suppressAggFilteredOnly | Enterprise | option | no | P2 | Includes filtered-out rows in group aggregates when true |
| 10 | functionsReadOnly | Enterprise | option | no | P2 | Makes GUI aggregation controls display-only |
| 10 | addAggFuncs | Enterprise | api | no | P1 | Registers custom agg functions at runtime |
| 10 | clearAggFuncs | Enterprise | api | no | P2 | Removes all custom agg functions registered via addAggFuncs |
| 10 | setColumnAggFunc | Enterprise | api | no | P1 | Sets or clears aggFunc on a column at runtime |
| 10 | columnValueChanged | Enterprise | event | no | P1 | Column added to or removed from values (aggregation) set |
| 10 | IAggFunc signature | Enterprise | behavior | yes | P0 | (params: IAggFuncParams) => any; params.values are leaf values |
| 10 | IAggFuncParams.aggregatedChildren | Enterprise | behavior | no | P1 | Immediate child group nodes feeding the aggregate |
| 10 | IAggFuncResult for nested re-aggregation | Enterprise | behavior | yes | P0 | value+count+toString+toNumber; avg/count use this shape |
| 10 | Built-in sum/min/max | Enterprise | behavior | yes | P0 | Plain scalar; ignores null/undefined values |
| 10 | Built-in count | Enterprise | behavior | no | P1 | Returns IAggFuncResult with value=count of non-null leaves |
| 10 | Built-in avg | Enterprise | behavior | no | P1 | Returns IAggFuncResult with value and count for weighted nesting |
| 10 | Built-in first/last | Enterprise | behavior | no | P2 | Returns first or last value in insertion order |
| 10 | valueGetter interaction | Enterprise | behavior | yes | P0 | aggFunc receives valueGetter output as values[] |
| 10 | Filter interaction (suppressAggFilteredOnly) | Enterprise | behavior | no | P1 | Default excludes filtered rows; flag includes all |
| 10 | suppressAggFuncInHeader display | Enterprise | behavior | yes | P0 | Header shows 'Balance' not 'sum(Balance)' |
| 10 | GUI aggregation controls | Enterprise | behavior | no | P1 | enableValue + allowedAggFuncs + functionsReadOnly |

<!-- area:11 Pivoting -->
| 11 | pivot (ColDef) | Enterprise | option | no | P1 | Pivots by this column's distinct values; requires PivotModule |
| 11 | initialPivot (ColDef) | Enterprise | option | no | P2 | pivot applied on first column creation only |
| 11 | pivotIndex (ColDef) | Enterprise | option | no | P1 | Position in multi-column pivot hierarchy |
| 11 | initialPivotIndex (ColDef) | Enterprise | option | no | P2 | pivotIndex applied on first column creation only |
| 11 | enablePivot (ColDef) | Enterprise | option | yes | P1 | Allows user to drag column into pivot panel via GUI |
| 11 | pivotComparator (ColDef) | Enterprise | option | no | P2 | Custom comparator for ordering generated pivot column groups |
| 11 | pivotMode | Enterprise | option | no | P1 | Activates pivot rendering pipeline |
| 11 | pivotPanelShow | Enterprise | option | no | P2 | Visibility of pivot drag-and-drop panel |
| 11 | pivotMaxGeneratedColumns | Enterprise | option | no | P2 | Cap on generated pivot columns; -1 for unlimited |
| 11 | pivotDefaultExpanded | Enterprise | option | no | P2 | Pivot column group levels expanded on load |
| 11 | pivotColumnGroupTotals | Enterprise | option | no | P1 | Adds total column within each pivot key group |
| 11 | pivotRowTotals | Enterprise | option | no | P1 | Adds total value column across all pivot key groups |
| 11 | pivotSuppressAutoColumn | Enterprise | option | no | P2 | Prevents auto-insertion of group column in pivot mode |
| 11 | suppressExpandablePivotGroups | Enterprise | option | no | P2 | Makes pivot column groups non-collapsible |
| 11 | removePivotHeaderRowWhenSingleValueColumn | Enterprise | option | no | P2 | Removes redundant value-column header row when only one value |
| 11 | processPivotResultColDef | Enterprise | option | no | P1 | Callback to mutate each generated pivot leaf column definition |
| 11 | processPivotResultColGroupDef | Enterprise | option | no | P1 | Callback to mutate each generated pivot column group definition |
| 11 | isPivotMode | Enterprise | api | no | P1 | Returns true if pivot mode is active |
| 11 | setPivotColumns | Enterprise | api | no | P1 | Replaces current pivot columns |
| 11 | addPivotColumns | Enterprise | api | no | P1 | Adds columns to pivot definition |
| 11 | removePivotColumns | Enterprise | api | no | P1 | Removes columns from pivot definition |
| 11 | getPivotColumns | Enterprise | api | no | P1 | Returns current pivot columns |
| 11 | getPivotResultColumn | Enterprise | api | no | P1 | Looks up generated pivot result column by key path |
| 11 | getPivotResultColumns | Enterprise | api | no | P1 | Returns all generated pivot result columns |
| 11 | setPivotResultColumns | Enterprise | api | no | P2 | Manually sets secondary column definitions (SSRM use) |
| 11 | setValueColumns | Enterprise | api | no | P1 | Replaces value columns used in pivot |
| 11 | addValueColumns | Enterprise | api | no | P1 | Adds value columns to pivot |
| 11 | removeValueColumns | Enterprise | api | no | P1 | Removes value columns from pivot |
| 11 | getValueColumns | Enterprise | api | no | P1 | Returns current value columns |
| 11 | columnPivotModeChanged | Enterprise | event | no | P1 | pivotMode toggled on or off |
| 11 | columnPivotChanged | Enterprise | event | no | P1 | Column added to or removed from pivot column set |
| 11 | columnValueChanged | Enterprise | event | no | P1 | Column added to or removed from value (aggregation) set |
| 11 | pivotMaxColumnsExceeded | Enterprise | event | no | P2 | Generated pivot column count exceeds pivotMaxGeneratedColumns |
| 11 | Pivot mode activation | Enterprise | behavior | no | P1 | pivotMode=true + at least one pivot=true column required |
| 11 | Primary vs secondary columns | Enterprise | behavior | no | P1 | Grid replaces primary columns with generated secondary set |
| 11 | Pivot key ordering via pivotComparator | Enterprise | behavior | no | P2 | Custom string comparator controls pivot group column order |
| 11 | processPivotResultColDef mutation hook | Enterprise | behavior | no | P1 | Called each time grid regenerates pivot columns |
| 11 | pivotColumnGroupTotals insertion | Enterprise | behavior | no | P1 | Injects aggregate column before/after each pivot key group |
| 11 | pivotRowTotals insertion | Enterprise | behavior | no | P1 | Injects row-total value column outside pivot key groups |
| 11 | Pivot + aggregation pipeline | Enterprise | behavior | no | P0 | Pivot result columns inherit aggFunc from value column |
| 11 | SSRM pivot via setPivotResultColumns | Enterprise | behavior | no | P2 | Server supplies secondary column defs; grid renders them |
| 11 | Pivot chart integration | Enterprise | behavior | no | P2 | Pivot result columns feed AG Charts; see 24-charts-and-sparklines.md |

<!-- area:12 Selection -->

<!-- area:13 Master/Detail -->

<!-- area:14 Tree data -->

<!-- area:15 Server-side row model -->

<!-- area:16 Pinning & layout -->

<!-- area:17 Side bar & tool panels -->

<!-- area:18 Status bar -->

<!-- area:19 Context menu & clipboard -->

<!-- area:20 Keyboard & a11y -->

<!-- area:21 Themes & styling -->

<!-- area:22 Events -->

<!-- area:23 API -->

<!-- area:24 Charts & sparklines -->

<!-- area:25 Export -->

<!-- area:26 Performance knobs -->
