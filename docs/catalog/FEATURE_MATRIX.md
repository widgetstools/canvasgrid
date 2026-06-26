# AG Grid Feature Matrix

> Last verified: 2026-06-23 against AG Grid 35.3.1

| Area | Feature | Tier | Surface | Showcase-uses? | Canvas-port priority | Notes |
|------|---------|------|---------|----------------|----------------------|-------|

<!-- area:01 GridOptions -->
| 01 | rowData | Community | option | yes | P0 | Full dataset; delta-detected when getRowId provided |
| 01 | columnDefs | Community | option | yes | P0 | Column / column-group definition array |
| 01 | defaultColDef | Community | option | yes | P0 | Shared column defaults; runtime-mutable |
| 01 | rowModelType | Community | option | no | P0 | Selects CSRM, Infinite, SSRM, or Viewport; initial-only |
| 01 | getRowId | Community | option | yes | P0 | Stable row identity function; enables delta detection |
| 01 | ✅ rowBuffer | Community | option | no | P0 | Extra rows rendered outside visible viewport |
| 01 | domLayout | Community | option | no | P1 | normal / autoHeight / print layout mode |
| 01 | animateRows | Community | option | no | P2 | CSS transition for row position changes |
| 01 | ✅ suppressColumnVirtualisation | Community | option | no | P1 | Render all columns regardless of scroll |
| 01 | ✅ suppressRowVirtualisation | Community | option | no | P2 | Render all rows regardless of scroll |
| 01 | suppressChangeDetection | Community | option | no | P1 | Disable value change diffing |
| 01 | asyncTransactionWaitMillis | Community | option | yes | P0 | Async transaction batch window (ms) |
| 01 | suppressModelUpdateAfterUpdateTransaction | Community | option | no | P1 | Skip pipeline refresh on update-only transactions |
| 01 | ✅ cellFlashDuration | Community | option | yes | P1 | Duration of cell flash highlight |
| 01 | ✅ cellFadeDuration | Community | option | yes | P1 | Duration of cell flash fade-out |
| 01 | context | Community | option | no | P1 | Arbitrary app data passed to callbacks |
| 01 | loading | Community | option | no | P2 | Show/hide loading overlay |
| 01 | debug | Community | option | no | P3 | Verbose console logging |
| 01 | getGridId | Community | api | no | P2 | Returns grid instance identifier |
| 01 | ✅ setGridOption | Community | api | yes | P0 | Updates a single runtime-mutable option |
| 01 | ✅ updateGridOptions | Community | api | no | P0 | Batch-updates multiple runtime-mutable options |
| 01 | destroy | Community | api | no | P0 | Tears down the grid instance |
| 01 | addEventListener | Community | api | no | P1 | Subscribes to a grid event |
| 01 | gridReady | Community | event | yes | P0 | Grid initialised; API available |
| 01 | ✅ gridPreDestroyed | Community | event | no | P1 | Before grid teardown; state snapshot available |
| 01 | ✅ gridSizeChanged | Community | event | no | P1 | Grid container resized |
| 01 | ✅ firstDataRendered | Community | event | no | P0 | First rows rendered in viewport |
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
| 02 | ✅ valueSetter | Community | option | no | P2 | Writes edited value back to row data |
| 02 | ✅ valueParser | Community | option | no | P2 | Parses string edit value before valueSetter |
| 02 | ✅ type (columnTypes) | Community | option | yes | P1 | Named column type templates for property reuse |
| 02 | ✅ cellDataType | Community | option | no | P1 | Infers/declares data type for filtering and formatting |
| 02 | ✅ headerClass | Community | option | no | P1 | CSS class(es) on header cell |
| 02 | ✅ cellClass | Community | option | yes | P1 | CSS class(es) on body cells |
| 02 | ✅ cellClassRules | Community | option | no | P1 | Predicate-driven CSS class map for body cells |
| 02 | ✅ cellStyle | Community | option | yes | P1 | Inline style object for body cells; function form returns ColCellOverrides |
| 02 | tooltipField | Community | option | no | P2 | Data field value shown as cell tooltip |
| 02 | tooltipValueGetter | Community | option | no | P2 | Callback returning tooltip string |
| 02 | cellRenderer | Community | option | yes | P0 | Custom cell renderer component or function |
| 02 | ✅ cellRendererParams | Community | option | yes | P0 | Static params passed to cellRenderer |
| 02 | ✅ cellRendererSelector | Community | option | no | P1 | Per-row dynamic renderer selection callback |
| 02 | ✅ enableCellChangeFlash | Community | option | yes | P1 | Flash cell on value change |
| 02 | ✅ autoHeight | Community | option | yes | P2 | Row height expands to fit this column's content |
| 02 | ✅ wrapText | Community | option | no | P2 | Enables text wrap inside cell |
| 02 | ✅ width / initialWidth | Community | option | yes | P0 | Column pixel width; initialWidth applies on first construction only |
| 02 | minWidth / maxWidth | Community | option | yes | P0 | Column width constraints |
| 02 | flex | Community | option | yes | P0 | Proportional width allocation; overrides explicit width |
| 02 | resizable | Community | option | yes | P1 | User can resize column by dragging header edge |
| 02 | ✅ suppressSizeToFit | Community | option | no | P1 | Exclude from sizeColumnsToFit() |
| 02 | ✅ suppressAutoSize | Community | option | no | P2 | Exclude from autoSizeColumns()/autoSizeAllColumns() |
| 02 | ✅ hide / initialHide | Community | option | yes | P0 | Column visibility; initialHide applies on first construction only |
| 02 | ✅ lockVisible / lockPosition | Community | option | no | P2 | Prevent UI visibility/position changes; lockPosition: true/'left'/'right' |
| 02 | ✅ suppressMovable | Community | option | no | P2 | Prevent user column reordering |
| 02 | ✅ pinned / initialPinned | Community | option | yes | P1 | Pin column to left or right frozen pane; initialPinned applies on first construction only |
| 02 | ✅ lockPinned | Community | option | no | P2 | Prevent user pin changes |
| 02 | suppressNavigable | Community | option | no | P2 | Exclude cell from keyboard tab navigation |
| 02 | ✅ suppressKeyboardEvent | Community | option | no | P2 | Block specific keyboard events in cell |
| 02 | ✅ ColGroupDef.children | Community | option | yes | P0 | Children of a column group |
| 02 | ✅ ColGroupDef.openByDefault | Community | option | no | P2 | Group expanded on load |
| 02 | ✅ ColGroupDef.marryChildren | Community | option | no | P2 | Prevents separating group's columns via drag |
| 02 | ✅ ColGroupDef.groupId | Community | option | no | P0 | Stable identifier for column group; auto-generated when omitted |
| 02 | ✅ ColGroupDef.headerName | Community | option | yes | P0 | Text shown in column-group header cell |
| 02 | ✅ columnGroupShow | Community | option | no | P1 | Per-leaf visibility hint within a group: 'open' \| 'closed' \| null |
| 02 | ✅ getColumnGroupState | Community | api | no | P1 | Snapshot of `{ groupId, open }[]` for column groups |
| 02 | ✅ setColumnGroupState | Community | api | no | P1 | Restore column-group open/closed state from snapshot |
| 02 | ✅ resetColumnGroupState | Community | api | no | P2 | Reset column-group state to definition defaults |
| 02 | ✅ getColumnState | Community | api | no | P1 | Serialisable snapshot of column state |
| 02 | ✅ applyColumnState | Community | api | no | P1 | Restores column state from snapshot |
| 02 | ✅ resetColumnState | Community | api | no | P2 | Resets column state to definition defaults; fires columnsReset |
| 02 | ✅ setColumnsVisible | Community | api | no | P1 | Show/hide specified columns |
| 02 | ✅ setColumnsPinned | Community | api | no | P1 | Set pinned state for columns |
| 02 | ✅ setColumnWidths | Community | api | no | P1 | Set pixel widths for columns; emits columnResized with finished flag |
| 02 | ✅ moveColumns / moveColumnByIndex | Community | api | no | P2 | Reorder columns programmatically; honors lockPosition + marryChildren |
| 02 | ✅ sizeColumnsToFit | Community | api | no | P1 | Fit columns to available grid width |
| 02 | ✅ autoSizeColumns | Community | api | no | P2 | Auto-size columns to cell contents (worker measureText pass) |
| 02 | ✅ autoSizeAllColumns | Community | api | no | P2 | Auto-size all displayed columns |
| 02 | ✅ columnVisible | Community | event | no | P1 | Column(s) shown or hidden; source: api/columnState |
| 02 | ✅ columnPinned | Community | event | no | P1 | Column(s) pinned or unpinned; source: api/columnState |
| 02 | ✅ columnResized | Community | event | no | P1 | Column width changed; finished flag distinguishes drag-tick from commit |
| 02 | ✅ columnMoved | Community | event | no | P2 | Column(s) reordered; source: uiColumnDragged/api/columnState |
| 02 | ✅ displayedColumnsChanged | Community | event | no | P1 | Displayed column set changes; source widened to include columnVisible/Pinned/Moved/columnsReset |
| 02 | ✅ virtualColumnsChanged | Community | event | no | P1 | Virtually rendered column set changes; afterScroll flag distinguishes scroll-driven from mutation-driven |
| 02 | ✅ columnsReset | Community | event | no | P2 | Fires once after resetColumnState before per-slot change events |
| 02 | Flex sizing algorithm | Community | behavior | yes | P0 | Proportional width from remaining free space |
| 02 | valueGetter / valueFormatter / cellRenderer separation | Community | behavior | yes | P0 | Three-layer pipeline; sort/filter use valueGetter only |
| 02 | ✅ Column state round-trip | Community | behavior | no | P1 | getColumnState/applyColumnState for persistence |
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
| 04 | ✅ enableCellChangeFlash (ColDef) | Community | option | yes | P1 | Auto-flash on value change |
| 04 | ✅ cellFlashDuration | Community | option | yes | P1 | Flash hold duration (ms) |
| 04 | ✅ cellFadeDuration | Community | option | yes | P1 | Flash fade duration (ms) |
| 04 | deltaSort | Community | option | no | P1 | Sort only changed rows in transaction |
| 04 | suppressChangeDetection | Community | option | no | P1 | Disable value diff before refresh |
| 04 | applyTransaction | Community | api | yes | P0 | Sync add/update/remove transaction |
| 04 | applyTransactionAsync | Community | api | yes | P0 | Queue transaction for async batch |
| 04 | flushAsyncTransactions | Community | api | no | P0 | Flush pending async transactions immediately |
| 04 | refreshCells | Community | api | no | P0 | Re-render cells in place |
| 04 | redrawRows | Community | api | no | P1 | Destroy and recreate rows |
| 04 | ✅ flashCells | Community | api | no | P1 | Trigger flash animation on cells |
| 04 | refreshClientSideRowModel | Community | api | no | P1 | Re-run CSRM pipeline from a given step |
| 04 | rowDataUpdated | Community | event | no | P0 | rowData set on CSRM |
| 04 | modelUpdated | Community | event | yes | P0 | Displayed rows recomputed |
| 04 | asyncTransactionsFlushed | Community | event | yes | P0 | Async transaction batch applied |
| 04 | cellValueChanged | Community | event | no | P1 | Cell value changed |
| 04 | Full-replace vs delta detection | Community | behavior | yes | P0 | ID matching reconciliation semantics |
| 04 | Async transaction batching | Community | behavior | yes | P0 | Queue → setTimeout → flush → fire event |
| 04 | Immutable data mode (rowData replace + getRowId) | Community | behavior | no | P1 | Store-driven update pattern |
| 04 | refreshCells vs redrawRows | Community | behavior | no | P0 | Refresh in-place vs full row recreate |
| 04 | ✅ enableCellChangeFlash auto-trigger | Community | behavior | yes | P1 | Flash on value change in transaction |
| 04 | deltaSort for large streamed datasets | Community | behavior | no | P1 | Sort only transaction-changed rows |

<!-- area:05 Rendering & DOM -->
| 05 | rowBuffer | Community | option | no | P0 | Extra rows rendered outside visible viewport |
| 05 | suppressRowVirtualisation | Community | option | no | P2 | Render all rows; severe performance impact |
| 05 | suppressMaxRenderedRowRestriction | Community | option | no | P3 | Remove 500-row cap when virt disabled |
| 05 | suppressAnimationFrame | Community | option | no | P1 | Disable rAF scheduling for scroll rendering |
| 05 | suppressColumnVirtualisation | Community | option | no | P1 | Render all columns regardless of scroll |
| 05 | ✅ rowHeight | Community | option | yes | P0 | Default row height in pixels |
| 05 | ✅ getRowHeight | Community | option | yes | P1 | Per-row height callback |
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
| 05 | ✅ autoHeight (ColDef) | Community | option | yes | P2 | Row expands to fit column content |
| 05 | ✅ wrapText (ColDef) | Community | option | no | P2 | Enable text wrap in cell |
| 05 | animateRows | Community | option | no | P2 | CSS transition for row position animation |
| 05 | suppressScrollOnNewData | Community | option | no | P2 | No auto-scroll to top on data replace |
| 05 | alwaysShowHorizontalScroll | Community | option | no | P2 | Always visible horizontal scrollbar |
| 05 | alwaysShowVerticalScroll | Community | option | no | P2 | Always visible vertical scrollbar |
| 05 | refreshCells | Community | api | no | P0 | Re-render cells in place |
| 05 | redrawRows | Community | api | no | P1 | Destroy and recreate rows |
| 05 | ✅ flashCells | Community | api | no | P1 | Trigger flash animation |
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
| 05 | ✅ virtualColumnsChanged | Community | event | no | P1 | Virtually rendered column set changes; afterScroll flag distinguishes scroll-driven from mutation-driven |
| 05 | bodyScroll | Community | event | no | P1 | Scroll event on grid body |
| 05 | bodyScrollEnd | Community | event | no | P1 | Scroll stopped |
| 05 | Row virtualisation render window | Community | behavior | no | P0 | viewport_rows + 2*rowBuffer rows in DOM |
| 05 | Column virtualisation | Community | behavior | no | P0 | Only horizontally visible columns rendered |
| 05 | ICellRendererComp interface | Community | behavior | yes | P0 | init/getGui/refresh/destroy lifecycle |
| 05 | valueGetter / valueFormatter / cellRenderer separation | Community | behavior | yes | P0 | Sort/filter use valueGetter; renderer sees both |
| 05 | cellRendererSelector dynamic dispatch | Community | behavior | no | P1 | Per-row renderer selection |
| 05 | Dynamic row heights via getRowHeight | Community | behavior | yes | P1 | Per-row pixel height callback |
| 05 | Full-width row paint mode | Community | behavior | no | P2 | Single painter spans full row width |
| 05 | domLayout autoHeight | Community | behavior | no | P2 | Container grows; no vertical scrollbar |
| 05 | domLayout print | Community | behavior | no | P3 | All rows rendered; no scroll; for printing |

<!-- area:06 Cell editing -->
| 06 | ✅ editable (ColDef) | Community | option | no | P1 | Boolean or callback enabling cell editing per column |
| 06 | ✅ cellEditor (ColDef) | Community | option | no | P1 | Built-in or custom editor component key/class |
| 06 | ✅ cellEditorParams (ColDef) | Community | option | no | P1 | Params passed to the cell editor on init |
| 06 | cellEditorSelector (ColDef) | Community | option | no | P1 | Per-row callback returning dynamic editor + params |
| 06 | ✅ cellEditorPopup (ColDef) | Community | option | ✅ | P2 | Render editor in a popup overlay |
| 06 | ✅ cellEditorPopupPosition (ColDef) | Community | option | ✅ | P2 | Popup position: 'over' or 'under' the cell |
| 06 | ✅ singleClickEdit (ColDef) | Community | option | no | P2 | Start editing on single click for this column |
| 06 | ✅ valueSetter (ColDef) | Community | option | no | P1 | Writes parsed edit value back to row data |
| 06 | ✅ valueParser (ColDef) | Community | option | no | P1 | Converts raw editor string to typed value |
| 06 | useValueParserForImport (ColDef) | Community | option | no | P2 | Apply valueParser on clipboard paste and fill handle |
| 06 | onCellValueChanged (ColDef) | Community | option | no | P1 | Column-level callback when cell value changes |
| 06 | ✅ editType (GridOptions) | Community | option | no | P1 | 'fullRow' enables full-row edit mode |
| 06 | ✅ singleClickEdit (GridOptions) | Community | option | no | P2 | Grid-level single-click to edit |
| 06 | ✅ suppressClickEdit | Community | option | no | P2 | Disable click-to-edit; programmatic only |
| 06 | readOnlyEdit | Community | option | no | P1 | Grid fires cellEditRequest instead of committing edits |
| 06 | ✅ stopEditingWhenCellsLoseFocus | Community | option | no | P2 | Stop edit when grid loses focus |
| 06 | ✅ enterNavigatesVertically | Community | option | no | P2 | Enter moves focus down (Excel-style) |
| 06 | ✅ enterNavigatesVerticallyAfterEdit | Community | option | no | P2 | Enter moves down after edit commit |
| 06 | ✅ enableCellEditingOnBackspace | Community | option | no | P3 | macOS: start edit on Backspace |
| 06 | ✅ suppressStartEditOnTab | Community | option | no | P2 | Prevent Tab from starting next cell edit |
| 06 | invalidEditValueMode | Community | option | no | P2 | 'block' keeps editor open on validation failure |
| 06 | getFullRowEditValidationErrors | Community | option | no | P2 | Validate full-row edit before commit |
| 06 | undoRedoCellEditing | Community | option | no | P2 | Enable undo/redo stack for cell edits |
| 06 | undoRedoCellEditingLimit | Community | option | no | P2 | Max depth of undo/redo stack |
| 06 | ✅ agTextCellEditor (cgrid: 'text') | Community | option | no | P1 | Built-in plain text editor |
| 06 | ✅ agLargeTextCellEditor (cgrid: 'largeText') | Community | option | no | P2 | Built-in textarea editor |
| 06 | ✅ agSelectCellEditor (cgrid: 'select') | Community | option | no | P2 | Built-in native select editor |
| 06 | ✅ agNumberCellEditor (cgrid: 'number') | Community | option | no | P1 | Built-in numeric input editor |
| 06 | ✅ agDateCellEditor (cgrid: 'date') | Community | option | no | P2 | Built-in date picker editor |
| 06 | ✅ agDateStringCellEditor (cgrid: 'dateString') | Community | option | no | P2 | Built-in date editor storing value as string |
| 06 | ✅ agCheckboxCellEditor (cgrid: 'checkbox') | Community | option | no | P2 | Built-in checkbox editor |
| 06 | agRichSelectCellEditor | Enterprise | option | no | P2 | Enterprise virtualised dropdown editor with search |
| 06 | ✅ startEditingCell | Community | api | no | P1 | Programmatically start editing a cell |
| 06 | ✅ stopEditing | Community | api | no | P1 | Stop any active edit; optionally cancel |
| 06 | getEditingCells | Community | api | no | P1 | Return list of cells currently in edit mode |
| 06 | getEditRowValues | Community | api | no | P2 | Pending edit values for a row during full-row edit |
| 06 | getCellEditorInstances | Community | api | no | P2 | Access live editor component instances |
| 06 | isEditing | Community | api | no | P2 | Check if a specific cell is being edited |
| 06 | validateEdit | Community | api | no | P2 | Run validation on all active editors |
| 06 | undoCellEditing | Community | api | no | P2 | Revert last cell edit |
| 06 | redoCellEditing | Community | api | no | P2 | Re-apply most recently undone edit |
| 06 | getCurrentUndoSize | Community | api | no | P3 | Number of available undo operations |
| 06 | getCurrentRedoSize | Community | api | no | P3 | Number of available redo operations |
| 06 | ✅ cellEditingStarted | Community | event | no | P1 | Cell editor activated |
| 06 | ✅ cellEditingStopped | Community | event | no | P1 | Cell editor closed |
| 06 | ✅ cellValueChanged | Community | event | no | P1 | Cell value committed (edit, paste, undo, redo) |
| 06 | cellEditRequest | Community | event | no | P1 | Fired instead of commit when readOnlyEdit=true |
| 06 | ✅ rowEditingStarted | Community | event | no | P2 | Full-row edit started |
| 06 | ✅ rowEditingStopped | Community | event | no | P2 | Full-row edit ended |
| 06 | ✅ rowValueChanged | Community | event | no | P2 | At least one value changed in full-row edit |
| 06 | undoStarted | Community | event | no | P2 | Undo operation begins |
| 06 | undoEnded | Community | event | no | P2 | Undo operation completes |
| 06 | redoStarted | Community | event | no | P2 | Redo operation begins |
| 06 | redoEnded | Community | event | no | P2 | Redo operation completes |
| 06 | ✅ Single-cell vs full-row edit mode | Community | behavior | no | P1 | editType='fullRow' activates all editable cells in row |
| 06 | ✅ valueParser / valueSetter pipeline | Community | behavior | no | P1 | Editor → parser → setter → data write |
| 06 | ✅ Popup editor positioning | Community | behavior | no | P2 | 'over' covers cell; 'under' leaves value visible |
| 06 | readOnlyEdit immutable pattern | Community | behavior | no | P1 | Grid fires cellEditRequest; app pushes transaction |
| 06 | Undo / redo stack semantics | Community | behavior | no | P2 | Bounded stack; cleared on external transaction |
| 06 | ✅ Custom editor ICellEditor interface | Community | behavior | no | P1 | getValue/isCancelBeforeStart/isCancelAfterEnd lifecycle |
| 06 | Validation via getValidationErrors | Community | behavior | no | P2 | Editor returns errors; grid blocks commit when configured |

<!-- area:07 Sorting -->
| 07 | ✅ sortable (ColDef) | Community | option | yes | P0 | Enable/disable sorting for a column; defaultColDef sets true |
| 07 | ✅ sort (ColDef) | Community | option | yes | P1 | Initial sort direction ('asc', 'desc', null) or SortDef |
| 07 | ✅ initialSort (ColDef) | Community | option | no | P1 | Sort direction applied only on first column creation |
| 07 | ✅ sortIndex (ColDef) | Community | option | yes | P1 | Multi-sort position for this column |
| 07 | ✅ initialSortIndex (ColDef) | Community | option | no | P1 | Multi-sort position applied on first creation only |
| 07 | sortingOrder (ColDef) | Community | option | no | P2 | Per-column sort cycle array |
| 07 | ✅ comparator (ColDef) | Community | option | no | P1 | Custom sort comparator function or map by SortType |
| 07 | ✅ unSortIcon (ColDef) | Community | option | no | P2 | Show unsorted icon when column has no active sort |
| 07 | ✅ accentedSort | Community | option | no | P2 | Locale-aware sort distinguishing accented characters |
| 07 | ✅ suppressMultiSort | Community | option | no | P2 | Disable multi-column sort — set `multiSortKey: null` for the same effect |
| 07 | alwaysMultiSort | Community | option | no | P2 | Every click is a multi-sort click |
| 07 | ✅ multiSortKey | Community | option | no | P2 | Change multi-sort modifier to Ctrl/Command |
| 07 | suppressMaintainUnsortedOrder | Community | option | no | P2 | Keep last sort order when sort is cleared |
| 07 | deltaSort | Community | option | no | P1 | Re-sort only transaction-changed rows; see 04-data-updates.md |
| 07 | ✅ postSortRows | Community | option | no | P2 | Post-sort callback to reorder rows arbitrarily |
| 07 | ✅ sortingOrder (GridOptions) | Community | option | no | P2 | Grid-level sort cycle (default ['asc','desc',null]); drop null to skip the unsorted stage |
| 07 | unSortIcon (GridOptions) | Community | option | no | P2 | Deprecated v33. Show unsorted icon globally; use defaultColDef.unSortIcon |
| 07 | ✅ onSortChanged | Community | api | no | P1 | Triggered via `setSortModel` (which fires `sortChanged`); apps drive external sort state through the public API |
| 07 | ✅ applyColumnState (sort) | Community | api | yes | P1 | Programmatically set sort/sortIndex via column state |
| 07 | ✅ getColumnState (sort) | Community | api | no | P1 | Retrieve serialisable sort state for persistence |
| 07 | ✅ sortChanged | Community | event | no | P0 | Sort direction changes; includes affected columns |
| 07 | ✅ Multi-sort Shift-click mechanics | Community | behavior | no | P1 | sortIndex badges; Shift adds/removes column from composite sort |
| 07 | ✅ Sort cycle (sortingOrder) | Community | behavior | yes | P1 | null→asc→desc→null default cycle per column; configurable via sortingOrder |
| 07 | ✅ Custom comparator contract | Community | behavior | no | P1 | Negative=A before B; do not negate based on isDescending |
| 07 | ✅ accentedSort vs default comparator | Community | behavior | no | P2 | Intl.Collator with sensitivity:'variant'; slower on large sets |
| 07 | postSortRows disables deltaSort | Community | behavior | no | P2 | Full sort always runs when postSortRows is configured |
| 07 | suppressMaintainUnsortedOrder semantics | Community | behavior | no | P2 | Cleared sort keeps last sorted order instead of original |
| 07 | ✅ getRowId stable sort interaction | Community | behavior | yes | P1 | Stable row identity prevents position thrash in delta updates |

<!-- area:08 Filtering -->
| 08 | ✅ filter (ColDef) | Community | option | yes | P0 | Column filter: true, filter key, or custom component |
| 08 | ✅ filterParams (ColDef) | Community | option | yes | P0 | Params for the column filter component |
| 08 | filterValueGetter (ColDef) | Community | option | no | P1 | Value used for filtering (can differ from display value) |
| 08 | ✅ floatingFilter (ColDef) | Community | option | yes | P0 | Show floating filter row for this column |
| 08 | floatingFilterComponent (ColDef) | Community | option | no | P2 | Custom floating filter component |
| 08 | floatingFilterComponentParams (ColDef) | Community | option | no | P2 | Params for custom floating filter |
| 08 | ✅ suppressFloatingFilterButton (ColDef) | Community | option | no | P2 | Hide the expand button on floating filter |
| 08 | ✅ getQuickFilterText (ColDef) | Community | option | no | P2 | Column-level text contributed to quick-filter search |
| 08 | ✅ agTextColumnFilter | Community | option | yes | P0 | Built-in text filter with contains/equals/startsWith etc. |
| 08 | ✅ agNumberColumnFilter | Community | option | yes | P0 | Built-in numeric filter with equals/range/greaterThan etc. |
| 08 | ✅ agDateColumnFilter | Community | option | no | P1 | Built-in date filter with equals/range/before/after etc. |
| 08 | agSetColumnFilter | Enterprise | option | yes | P1 | Enterprise checkbox-list filter from distinct column values — Cycle 7 ships virtualised popup + data-derived values + mini-search + tri-state Select All; full enterprise parity (excelMode, server-side values, async refresh) deferred |
| 08 | agMultiColumnFilter | Enterprise | option | yes | P0 | Enterprise composite filter wrapping multiple child filters |
| 08 | ✅ IProvidedFilterParams.buttons | Community | option | yes | P1 | Filter action buttons: apply, clear, reset, cancel |
| 08 | ✅ IProvidedFilterParams.closeOnApply | Community | option | no | P2 | Close popup after Apply/Reset click |
| 08 | IProvidedFilterParams.debounceMs | Community | option | no | P2 | Debounce before filter applies on typing |
| 08 | IProvidedFilterParams.readOnly | Community | option | no | P2 | Filter UI read-only; set via API only |
| 08 | ISimpleFilterParams.filterOptions | Community | option | no | P1 | Which filter conditions to show in dropdown |
| 08 | ISimpleFilterParams.defaultOption | Community | option | no | P2 | Default selected filter condition |
| 08 | ✅ ISimpleFilterParams.defaultJoinOperator | Community | option | no | P2 | Default AND/OR join between two conditions |
| 08 | ✅ ISimpleFilterParams.maxNumConditions | Community | option | no | P2 | Maximum concurrent filter conditions |
| 08 | ✅ ITextFilterParams.caseSensitive | Community | option | no | P2 | Case-sensitive text matching |
| 08 | ITextFilterParams.textMatcher | Community | option | no | P2 | Custom text match function — API surface deferred to Cycle 24's worker-module loader |
| 08 | ✅ ITextFilterParams.trimInput | Community | option | no | P2 | Trim whitespace from filter input |
| 08 | INumberFilterParams.allowedCharPattern | Community | option | no | P2 | Restrict characters in number filter input |
| 08 | INumberFilterParams.numberParser | Community | option | no | P2 | Custom string-to-number converter for filter |
| 08 | ✅ ISetFilterParams.values | Enterprise | option | no | P1 | Static or async values list for set filter |
| 08 | ✅ ISetFilterParams.suppressMiniFilter | Enterprise | option | no | P2 | Hide mini search box in set filter |
| 08 | ✅ ISetFilterParams.caseSensitive | Enterprise | option | no | P2 | Case-sensitive mini-filter matching |
| 08 | IMultiFilterParams.filters | Enterprise | option | yes | P0 | Child filter definitions for agMultiColumnFilter |
| 08 | ✅ quickFilterText | Community | option | no | P1 | Grid-level quick-filter text applied to all columns |
| 08 | ✅ cacheQuickFilter | Community | option | no | P2 | Cache quick-filter aggregate text for performance |
| 08 | ✅ includeHiddenColumnsInQuickFilter | Community | option | no | P2 | Apply quick filter to hidden columns |
| 08 | ✅ quickFilterParser | Community | option | no | P2 | Custom function to split quick-filter text into terms |
| 08 | ✅ quickFilterMatcher | Community | option | no | P2 | Custom function to match terms against row text — API surface deferred to Cycle 24 |
| 08 | ✅ isExternalFilterPresent | Community | option | no | P1 | Callback returning true when external filter is active |
| 08 | ✅ doesExternalFilterPass | Community | option | no | P1 | Per-row callback for external filter logic |
| 08 | ✅ alwaysPassFilter | Community | option | no | P2 | Rows bypassing all filters unconditionally |
| 08 | enableFilterHandlers | Community | option | no | P2 | When true, grid expects user-provided filter handlers; toggles which filter events fire |
| 08 | getFilterModel | Community | api | no | P1 | Returns all column filter models as serialisable object |
| 08 | ✅ setFilterModel | Community | api | no | P1 | Restore all column filter states from model object |
| 08 | ✅ getColumnFilterModel | Community | api | no | P1 | Get filter model for a single column |
| 08 | ✅ setColumnFilterModel | Community | api | no | P1 | Set filter model for a single column |
| 08 | getColumnFilterInstance | Community | api | no | P2 | Access live filter component instance (async) |
| 08 | ✅ destroyFilter | Community | api | no | P2 | Force recreation of a column's filter |
| 08 | ✅ showColumnFilter | Community | api | no | P2 | Programmatically open a column filter popup |
| 08 | ✅ hideColumnFilter | Community | api | no | P2 | Close open filter popup |
| 08 | ✅ onFilterChanged | Community | api | no | P1 | Signal grid of external filter state change |
| 08 | ✅ isAnyFilterPresent | Community | api | no | P1 | Check if any filter is currently active |
| 08 | ✅ isColumnFilterPresent | Community | api | no | P1 | Check if any column filter is active |
| 08 | ✅ filterChanged | Community | event | no | P0 | Any filter changes; includes source and affected columns |
| 08 | ✅ filterModified | Community | event | no | P2 | Filter UI modified but not yet applied |
| 08 | filterUiChanged | Community | event | no | P2 | Filter UI state changes |
| 08 | ✅ filterOpened | Community | event | no | P2 | Filter popup opened |
| 08 | floatingFilterUiChanged | Community | event | no | P2 | Floating filter UI state changes |
| 08 | ✅ Column filter AND combination | Community | behavior | yes | P0 | All active column filters combined with AND |
| 08 | ✅ Quick filter multi-term matching | Community | behavior | no | P1 | All terms must appear somewhere in the row |
| 08 | ✅ External filter callback pattern | Community | behavior | no | P1 | isExternalFilterPresent + doesExternalFilterPass lifecycle |
| 08 | getFilterModel / setFilterModel round-trip | Community | behavior | no | P1 | Serialisable filter state for persistence/URL |
| 08 | ✅ Filter buttons apply/clear/reset/cancel | Community | behavior | yes | P1 | Deferred apply mode via buttons config |
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
| 09 | rowGroupOpened | Community | event | no | P0 | Group row expanded or collapsed; event is core, row-group context needs RowGroupingModule (Enterprise) |
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
| 12 | rowSelection (RowSelectionOptions) | Community | option | yes | P0 | Object-based row selection config; replaces deprecated string literals |
| 12 | rowSelection.mode singleRow | Community | option | no | P1 | Only one row selected at a time |
| 12 | rowSelection.mode multiRow | Community | option | yes | P0 | Multiple rows selectable; supports Shift/Ctrl extend |
| 12 | rowSelection.enableClickSelection | Community | option | yes | P0 | Controls click-to-select / click-to-deselect behaviour |
| 12 | rowSelection.checkboxes | Community | option | yes | P0 | Show checkbox per row |
| 12 | rowSelection.checkboxLocation | Community | option | yes | P1 | 'selectionColumn' or 'autoGroupColumn' |
| 12 | rowSelection.headerCheckbox | Community | option | yes | P1 | Show select-all in column header |
| 12 | rowSelection.selectAll | Community | option | yes | P1 | 'all' / 'filtered' / 'currentPage' scope for header checkbox |
| 12 | rowSelection.groupSelects | Community | option | yes | P1 | 'self' / 'descendants' / 'filteredDescendants'; supersedes deprecated groupSelectsChildren |
| 12 | rowSelection.isRowSelectable | Community | option | no | P1 | Callback to make specific rows non-selectable |
| 12 | rowSelection.enableSelectionWithoutKeys | Community | option | no | P2 | Toggle rows without Ctrl/Cmd; applies to both singleRow and multiRow modes |
| 12 | rowSelection.masterSelects | Community | option | no | P2 | 'self' or 'detail' — master row affecting detail grid selection |
| 12 | rowSelection.copySelectedRows | Community | option | no | P2 | Copy includes full row data instead of focused cell only |
| 12 | selectionColumnDef | Community | option | no | P1 | Customise dedicated selection column (width, pinned, etc.) |
| 12 | rowMultiSelectWithClick | Community | option | no | P3 | Deprecated v32.2; use rowSelection.enableSelectionWithoutKeys |
| 12 | suppressRowDeselection | Community | option | no | P3 | Deprecated v32.2; use rowSelection.enableClickSelection |
| 12 | suppressRowClickSelection | Community | option | no | P3 | Deprecated v32.2; use rowSelection.enableClickSelection: false |
| 12 | cellSelection | Enterprise | option | no | P1 | Boolean or CellSelectionOptions; enables cell range selection |
| 12 | cellSelection.suppressMultiRanges | Enterprise | option | no | P2 | Limit to one range at a time |
| 12 | cellSelection.enableHeaderHighlight | Enterprise | option | no | P2 | Highlight column header when cells in it are in a range |
| 12 | cellSelection.enableColumnSelection | Enterprise | option | no | P2 | Click column header to select entire column |
| 12 | cellSelection.handle (fill mode) | Enterprise | option | no | P1 | Fill handle with direction and custom fill callback |
| 12 | cellSelection.handle (range mode) | Enterprise | option | no | P2 | Range handle to extend selection by dragging |
| 12 | enableRangeSelection | Enterprise | option | no | P3 | Deprecated v32.2; use cellSelection = true |
| 12 | enableFillHandle | Enterprise | option | no | P3 | Deprecated v32.2; use cellSelection.handle = { mode: 'fill' } |
| 12 | fillHandleDirection | Enterprise | option | no | P3 | Deprecated v32.2; use cellSelection.handle.direction |
| 12 | selectAll | Community | api | yes | P0 | Select all rows; optional mode param scopes to filtered/currentPage |
| 12 | deselectAll | Community | api | yes | P0 | Deselect all rows |
| 12 | getSelectedNodes | Community | api | yes | P0 | Returns list of selected IRowNode objects |
| 12 | getSelectedRows | Community | api | yes | P0 | Returns list of selected row data objects |
| 12 | getCellRanges | Enterprise | api | no | P1 | Returns current cell selection ranges |
| 12 | addCellRange | Enterprise | api | no | P1 | Adds a cell range to the current selection |
| 12 | clearCellSelection | Enterprise | api | no | P1 | Clears all cell selection ranges |
| 12 | getServerSideSelectionState | Enterprise | api | no | P1 | Returns SSRM selection rule set |
| 12 | setServerSideSelectionState | Enterprise | api | no | P1 | Restores SSRM selection state |
| 12 | rowSelected | Community | event | yes | P0 | Fires per row when its selection state changes |
| 12 | selectionChanged | Community | event | yes | P0 | Fires after bulk selection change completes |
| 12 | cellSelectionChanged | Enterprise | event | no | P1 | Fires on cell range changes (started/finished flags) |
| 12 | fillStart | Enterprise | event | no | P2 | User starts dragging fill handle |
| 12 | fillEnd | Enterprise | event | no | P2 | User releases fill handle; carries initial and final ranges |
| 12 | cellSelectionDeleteStart | Enterprise | event | no | P2 | Delete key begins clearing cell range |
| 12 | cellSelectionDeleteEnd | Enterprise | event | no | P2 | Delete key finishes clearing cell range |
| 12 | Row selection mode behaviour | Community | behavior | yes | P0 | singleRow vs multiRow click/Shift/Ctrl semantics |
| 12 | Group selection cascade | Community | behavior | yes | P1 | groupSelects: descendants/filteredDescendants checkbox indeterminate state |
| 12 | SSRM selection rule-set | Enterprise | behavior | no | P1 | Selection stored as rules not row IDs; persist via getServerSideSelectionState |
| 12 | Fill handle value progression | Enterprise | behavior | no | P2 | Numbers increment linearly; non-numbers copy; override with setFillValue |

<!-- area:13 Master/Detail -->
| 13 | masterDetail | Enterprise | option | no | P2 | Enables Master/Detail mode |
| 13 | isRowMaster | Enterprise | option | no | P2 | Callback; return false to prevent a row being expandable |
| 13 | detailCellRenderer | Enterprise | option | no | P2 | Custom renderer for the detail row |
| 13 | detailCellRendererParams | Enterprise | option | no | P2 | Params for default or custom detail renderer |
| 13 | detailCellRendererParams.detailGridOptions | Enterprise | option | no | P2 | Full GridOptions for the embedded detail grid |
| 13 | detailCellRendererParams.getDetailRowData | Enterprise | option | no | P2 | Callback to supply detail rows (async via successCallback) |
| 13 | detailCellRendererParams.refreshStrategy | Enterprise | option | no | P2 | 'rows' / 'everything' / 'nothing' on master data change |
| 13 | detailCellRendererParams.template | Enterprise | option | no | P3 | Custom HTML wrapper around detail grid |
| 13 | detailRowHeight | Enterprise | option | no | P2 | Fixed pixel height for detail rows (initial-only) |
| 13 | detailRowAutoHeight | Enterprise | option | no | P2 | Expand detail row to fit content (initial-only) |
| 13 | keepDetailRows | Enterprise | option | no | P2 | Cache detail grid instances when master row collapses (initial-only) |
| 13 | keepDetailRowsCount | Enterprise | option | no | P2 | Max cached detail instances; LRU eviction (initial-only) |
| 13 | getDetailGridInfo | Enterprise | api | no | P2 | Returns DetailGridInfo (including api) by detail row ID |
| 13 | forEachDetailGridInfo | Enterprise | api | no | P2 | Iterates all active detail grid instances |
| 13 | addDetailGridInfo | Enterprise | api | no | P3 | Registers custom detail renderer with master (internal use) |
| 13 | removeDetailGridInfo | Enterprise | api | no | P3 | Unregisters custom detail renderer on destroy |
| 13 | rowGroupOpened | Community | event | no | P2 | Master row expanded or collapsed (expanded field) |
| 13 | Detail row lifecycle (create/destroy) | Enterprise | behavior | no | P2 | keepDetailRows false: destroy on collapse; true: cache up to keepDetailRowsCount |
| 13 | refreshStrategy behaviour | Enterprise | behavior | no | P2 | 'rows' applies delta; 'everything' re-fetches; 'nothing' leaves detail unchanged |
| 13 | Accessing detail grid API | Enterprise | behavior | no | P2 | getDetailGridInfo('detail_{id}').api for operations on detail grid |
| 13 | masterSelects: 'detail' integration | Community | behavior | no | P2 | Selecting master row acts as header checkbox of detail; see 12-selection.md |

<!-- area:14 Tree data -->
| 14 | treeData | Enterprise | option | no | P2 | Enables Tree Data mode |
| 14 | getDataPath | Enterprise | option | no | P2 | Callback returning string[] path for each row (path-based strategy) |
| 14 | treeDataChildrenField | Enterprise | option | no | P2 | Field containing array of child objects (children-field strategy) |
| 14 | treeDataParentIdField | Enterprise | option | no | P2 | Field containing parent row ID (parent-ID strategy; requires getRowId) |
| 14 | treeDataDisplayType | Enterprise | option | no | P2 | 'auto' (grid adds group column) or 'custom' (app supplies column) |
| 14 | autoGroupColumnDef (tree) | Enterprise | option | no | P2 | Overrides auto group column for tree display; shared with row grouping |
| 14 | groupDefaultExpanded (tree) | Enterprise | option | no | P2 | Depth to expand by default; -1 expands all |
| 14 | suppressGroupRowsSticky (tree) | Enterprise | option | no | P3 | Prevents tree rows from sticking to viewport top |
| 14 | applyTransaction (tree) | Community | api | no | P2 | Add/remove/update rows in tree; intermediate nodes created/removed automatically |
| 14 | expandAll (tree) | Community | api | no | P2 | Expand all tree nodes |
| 14 | collapseAll (tree) | Community | api | no | P2 | Collapse all tree nodes |
| 14 | setRowNodeExpanded (tree) | Community | api | no | P2 | Expand or collapse a specific tree node |
| 14 | rowGroupOpened (tree) | Community | event | no | P2 | Tree node expanded or collapsed |
| 14 | modelUpdated (tree) | Community | event | no | P2 | Tree structure rebuilt after data/sort/filter change |
| 14 | Path-based tree filler nodes | Enterprise | behavior | no | P2 | Intermediate path nodes without data become non-selectable filler nodes |
| 14 | Filter behaviour in tree | Enterprise | behavior | no | P2 | Parent shown if any descendant passes filter; hidden only if all filtered out |
| 14 | Sort behaviour in tree | Enterprise | behavior | no | P2 | Leaf nodes sorted within parent; group order is structural |
| 14 | Tree Data + SSRM | Enterprise | behavior | no | P2 | getRows request carries groupKeys path; grid calls per expanded branch |

<!-- area:15 Server-side row model -->
| 15 | rowModelType: 'serverSide' | Enterprise | option | no | P1 | Activates SSRM; initial-only |
| 15 | serverSideDatasource | Enterprise | option | no | P1 | IServerSideDatasource object; runtime-mutable |
| 15 | cacheBlockSize (SSRM) | Enterprise | option | no | P1 | Rows per block in infinite-scroll mode; initial-only |
| 15 | maxBlocksInCache (SSRM) | Enterprise | option | no | P1 | LRU block eviction limit per store level; initial-only |
| 15 | maxConcurrentDatasourceRequests | Enterprise | option | no | P2 | Max parallel getRows calls; initial-only |
| 15 | blockLoadDebounceMillis (SSRM) | Enterprise | option | no | P2 | Debounce before issuing block request; initial-only |
| 15 | serverSideInitialRowCount | Enterprise | option | no | P2 | Loading placeholder row count at root level; initial-only |
| 15 | suppressServerSideFullWidthLoadingRow | Enterprise | option | no | P2 | Use colDef loading renderers instead of full-width loading row |
| 15 | purgeClosedRowNodes | Enterprise | option | no | P2 | Destroy child data on group collapse; re-fetch on next expand |
| 15 | serverSideSortAllLevels | Enterprise | option | no | P2 | Refresh all group levels on sort change |
| 15 | serverSideEnableClientSideSort | Enterprise | option | no | P2 | Sort fully-loaded blocks in browser; reduces round-trips |
| 15 | serverSideOnlyRefreshFilteredGroups | Enterprise | option | no | P2 | Only refresh groups affected by filter; initial-only |
| 15 | serverSidePivotResultFieldSeparator | Enterprise | option | no | P3 | Field name separator for pivot result columns; initial-only |
| 15 | refreshServerSide | Enterprise | api | no | P1 | Refresh a store level; purge=true shows loading rows immediately |
| 15 | getServerSideGroupLevelState | Enterprise | api | no | P2 | Returns row count, block size, lastRowIndexKnown per expanded level |
| 15 | applyServerSideTransaction | Enterprise | api | no | P1 | Apply add/remove/update transaction to a store level |
| 15 | applyServerSideTransactionAsync | Enterprise | api | no | P1 | Queue async SSRM transaction |
| 15 | flushServerSideAsyncTransactions | Enterprise | api | no | P2 | Immediately process all queued SSRM async transactions |
| 15 | applyServerSideRowData | Enterprise | api | no | P2 | Directly apply LoadSuccessParams to a store level or block |
| 15 | retryServerSideLoads | Enterprise | api | no | P2 | Retry all failed store loads |
| 15 | getCacheBlockState | Enterprise | api | no | P2 | Returns raw block cache state for all levels — useful for debugging |
| 15 | storeRefreshed | Enterprise | event | no | P1 | Store level finishes refreshing; route field identifies level |
| 15 | IServerSideDatasource.getRows contract | Enterprise | behavior | no | P1 | groupKeys=[] root; groupKeys=['X'] children of X; startRow/endRow undefined = full store |
| 15 | Full store vs infinite scroll | Enterprise | behavior | no | P1 | cacheBlockSize undefined = full store; finite value = infinite scroll blocks |
| 15 | SSRM grouping/pivot request fields | Enterprise | behavior | no | P1 | rowGroupCols/valueCols/pivotCols/pivotMode carried in every getRows request |
| 15 | Grand total row via LoadSuccessParams | Enterprise | behavior | no | P2 | grandTotalData in success response inserts/updates footer row; null removes it |
| 15 | Transaction routing via route field | Enterprise | behavior | no | P1 | route=[] targets root; route=['A','B'] targets child store under A>B |
| 15 | Group state restoration | Enterprise | behavior | no | P2 | Capture expansion via getServerSideGroupLevelState; restore with setRowNodeExpanded |

<!-- area:16 Pinning & layout -->
| 16 | ✅ ColDef.pinned / initialPinned / lockPinned | Community | config | yes | P1 | Left/right column pinning; lockPinned prevents user change |
| 16 | ✅ setColumnsPinned | Community | api | no | P1 | Programmatically pin/unpin columns |
| 16 | isPinning / isPinningLeft / isPinningRight | Community | api | no | P2 | Query whether any column is currently pinned |
| 16 | getDisplayedLeftColumns / getDisplayedRightColumns | Community | api | no | P1 | Retrieve columns in pinned panes |
| 16 | pinnedTopRowData / pinnedBottomRowData | Community | config | no | P1 | Static data rows frozen above/below scrollable body |
| 16 | enableRowPinning | Community | config | no | P2 | User-initiated row pinning via context menu |
| 16 | getPinnedTopRowCount / getPinnedBottomRowCount | Community | api | no | P2 | Count of pinned rows |
| 16 | domLayout | Community | config | no | P1 | normal / autoHeight / print layout modes |
| 16 | enableRtl | Community | config | no | P2 | Right-to-left layout |
| 16 | ensureDomOrder | Community | config | no | P2 | DOM row order matches visual order; required for AT |
| 16 | headerHeight / groupHeaderHeight / floatingFiltersHeight | Community | config | no | P1 | Override individual header row heights |
| 16 | pivotHeaderHeight / pivotGroupHeaderHeight | Community | config | no | P2 | Header heights in pivot mode |
| 16 | isFullWidthRow / fullWidthCellRenderer | Community | config | no | P2 | Full-width rows spanning all column panes |
| 16 | processUnpinnedColumns | Community | config | no | P2 | Callback when viewport too narrow for pinned columns |
| 16 | ✅ columnPinned event | Community | event | no | P1 | Fires when a column is pinned or unpinned |
| 16 | isRowPinnable | Community | config | no | P2 | Callback to prevent specific row from being pinned by user |
| 16 | pinnedRowDataChanged / pinnedRowsChanged | Community | event | no | P2 | Fires when pinned row data changes |

<!-- area:17 Side bar & tool panels -->
| 17 | sideBar (shorthand: 'columns', 'filters', true) | Enterprise | config | yes | P1 | Quick-configure side bar with built-in panels |
| 17 | SideBarDef (position, defaultToolPanel, hiddenByDefault, hideButtons) | Enterprise | config | yes | P1 | Full side bar configuration object |
| 17 | ToolPanelDef (id, iconKey, minWidth, maxWidth, width) | Enterprise | config | yes | P1 | Individual tool panel registration and sizing |
| 17 | agColumnsToolPanel | Enterprise | config | yes | P1 | Built-in column visibility and grouping panel |
| 17 | IToolPanelColumnCompParams (suppressColumnMove, suppressRowGroups, buttons) | Enterprise | config | yes | P2 | Columns tool panel params |
| 17 | agFiltersToolPanel | Enterprise | config | yes | P1 | Built-in per-column filter panel |
| 17 | IToolPanelFiltersCompParams | Enterprise | config | no | P2 | Filters tool panel params |
| 17 | Custom IToolPanelComp | Enterprise | config | no | P2 | Custom tool panel component interface |
| 17 | openToolPanel / closeToolPanel | Enterprise | api | no | P1 | Open or close a specific panel programmatically |
| 17 | getOpenedToolPanel / isToolPanelShowing | Enterprise | api | no | P2 | Query open panel state |
| 17 | isSideBarVisible / setSideBarVisible | Enterprise | api | no | P2 | Show or hide the side bar |
| 17 | setSideBarPosition | Enterprise | api | no | P2 | Move side bar to left or right |
| 17 | refreshToolPanel | Enterprise | api | no | P2 | Trigger refresh on the active tool panel |
| 17 | getToolPanelInstance | Enterprise | api | no | P2 | Access custom tool panel component instance |
| 17 | toolPanelVisibleChanged event | Enterprise | event | no | P2 | Fires when panel opens, closes, or switches |
| 17 | toolPanelSizeChanged event | Enterprise | event | no | P2 | Fires while user drags panel resize handle |
| 17 | allowDragFromColumnsToolPanel | Enterprise | config | no | P2 | Drag columns from tool panel into grid |

<!-- area:18 Status bar -->
| 18 | statusBar config (StatusPanelDef, align) | Enterprise | config | yes | P1 | Configure status bar panels with left/center/right alignment |
| 18 | agTotalRowCountComponent | Enterprise | config | no | P2 | Built-in total row count panel |
| 18 | agFilteredRowCountComponent | Enterprise | config | no | P2 | Built-in filtered row count panel |
| 18 | agSelectedRowCountComponent | Enterprise | config | no | P2 | Built-in selected row count panel |
| 18 | agTotalAndFilteredRowCountComponent | Enterprise | config | no | P2 | Built-in combined total/filtered count panel |
| 18 | agAggregationComponent (IAggregationStatusPanelParams) | Enterprise | config | yes | P1 | Aggregation panel showing count/sum/min/max/avg for selection |
| 18 | Custom IStatusPanelComp | Enterprise | config | yes | P1 | Custom status bar panel component |
| 18 | getStatusPanel | Enterprise | api | no | P2 | Retrieve live status panel component instance by key |

<!-- area:19 Context menu & clipboard -->
| 19 | getContextMenuItems / MenuItemDef | Enterprise | config | no | P1 | Customise context menu items and add custom entries |
| 19 | suppressContextMenu | Community | config | no | P2 | Disable right-click context menu |
| 19 | DefaultMenuItem string identifiers | Enterprise | config | no | P1 | Built-in menu item keys (copy, paste, export, pin, etc.) |
| 19 | copyToClipboard | Enterprise | api | no | P1 | Copy focused cell or selected rows to clipboard |
| 19 | copySelectedRangeToClipboard | Enterprise | api | no | P1 | Copy cell range selection to clipboard |
| 19 | cutToClipboard | Enterprise | api | no | P2 | Cut selected cells to clipboard |
| 19 | copySelectedRowsToClipboard | Enterprise | api | no | P2 | Copy selected rows with optional column restriction |
| 19 | pasteFromClipboard | Enterprise | api | no | P2 | Programmatically paste from clipboard |
| 19 | copySelectedRangeDown | Enterprise | api | no | P2 | Fill-down within selected range |
| 19 | processCellForClipboard | Enterprise | config | no | P1 | Transform cell values before clipboard write |
| 19 | processCellFromClipboard | Enterprise | config | no | P1 | Transform pasted values before grid update |
| 19 | sendToClipboard | Enterprise | config | no | P2 | Intercept clipboard write; handle it yourself |
| 19 | processDataFromClipboard | Enterprise | config | no | P2 | Full paste operation control including cancel |
| 19 | copyHeadersToClipboard / copyGroupHeadersToClipboard | Enterprise | config | no | P2 | Include header rows in Ctrl+C copy |
| 19 | clipboardDelimiter | Enterprise | config | no | P2 | Field separator for clipboard text |
| 19 | suppressClipboardPaste / suppressCutToClipboard | Enterprise | config | no | P2 | Disable paste or cut operations |
| 19 | contextMenuVisibleChanged event | Enterprise | event | no | P2 | Context menu appears or disappears |
| 19 | pasteStart / pasteEnd events | Enterprise | event | no | P2 | Bracket a paste operation |
| 19 | cutStart / cutEnd events | Enterprise | event | no | P2 | Bracket a cut operation |

<!-- area:20 Keyboard & a11y -->
| 20 | navigateToNextCell | Community | config | no | P1 | Override arrow-key cell navigation |
| 20 | tabToNextCell | Community | config | no | P1 | Override Tab/Shift+Tab cell navigation |
| 20 | navigateToNextHeader / tabToNextHeader | Community | config | no | P2 | Override navigation in header rows |
| 20 | tabToNextGridContainer | Community | config | no | P2 | Override Tab between major grid containers |
| 20 | focusGridInnerElement | Community | config | no | P2 | Handle focus arrival from outside the grid |
| 20 | enterNavigatesVertically / enterNavigatesVerticallyAfterEdit | Community | config | no | P2 | Excel-style Enter navigation |
| 20 | suppressCellFocus / suppressHeaderFocus | Community | config | no | P2 | Disable grid-managed focus on cells or headers |
| 20 | enableCellTextSelection | Community | config | no | P2 | Allow native text selection in cells |
| 20 | tabIndex | Community | config | no | P2 | Grid's tab order position in the page |
| 20 | ensureDomOrder | Community | config | no | P2 | DOM order matches visual order for screen readers |
| 20 | cellAriaRole (ColDef) | Community | config | no | P2 | Override ARIA role on body cells per column |
| 20 | getFocusedCell / setFocusedCell / clearFocusedCell | Community | api | no | P1 | Programmatic keyboard focus management |
| 20 | tabToNextCell / tabToPreviousCell (api) | Community | api | no | P2 | Programmatically advance/retreat Tab focus |
| 20 | setFocusedHeader | Community | api | no | P2 | Move focus to a header cell |
| 20 | setGridAriaProperty | Community | api | no | P2 | Set aria-* attributes on grid root element |
| 20 | cellFocused event | Community | event | no | P1 | Fires when focused cell changes |
| 20 | cellKeyDown event | Community | event | no | P2 | Fires on keydown in a focused body cell |
| 20 | headerFocused event | Community | event | no | P2 | Fires when a header cell receives focus |
| 20 | Default keyboard map (arrows/tab/enter/page/home/end) | Community | behavior | no | P1 | Built-in navigation shortcuts |

<!-- area:21 Themes & styling -->
| 21 | theme grid option (Theme object or 'legacy') | Community | config | yes | P1 | Apply Theming API theme or opt into legacy CSS class mode |
| 21 | themeQuartz | Community | config | yes | P1 | Default modern theme; used in showcase via withParams |
| 21 | themeAlpine | Community | config | no | P2 | Alpine theme with blue accents |
| 21 | themeBalham | Community | config | no | P2 | Compact spreadsheet-style theme |
| 21 | themeMaterial | Community | config | no | P2 | Material Design theme |
| 21 | Theme.withParams(defaults, mode) | Community | config | yes | P1 | Override theme CSS variable values; supports light/dark modes |
| 21 | Theme.withPart(part) | Community | config | no | P2 | Replace a design sub-system (icon set, color scheme, input style) |
| 21 | Theme.withoutPart(feature) | Community | config | no | P3 | Remove a named design part |
| 21 | createTheme() | Community | config | no | P3 | Factory for a fully custom theme with no design parts |
| 21 | loadThemeGoogleFonts | Community | config | no | P2 | Auto-load Google Fonts declared in the theme |
| 21 | themeCssLayer | Community | config | no | P3 | Wrap theme CSS in @layer for cascade control |
| 21 | styleNonce | Community | config | no | P3 | CSP nonce for injected style elements |
| 21 | themeStyleContainer | Community | config | no | P2 | Element to receive theme style tags; supports shadow DOM |
| 21 | --ag-* CSS variables (spacing, accentColor, rowHeight, etc.) | Community | config | no | P1 | Low-level CSS variable overrides for theme params |
| 21 | ✅ cellClass / cellClassRules / cellStyle | Community | config | yes | P1 | Per-cell styling; precedence order class→rules→style; canvas variant: theme-driven --cg-cell-class-* CSS vars resolve class names to ColCellOverrides patches |
| 21 | Dark mode via withParams({...}, 'dark') | Community | config | no | P2 | Conditional params for dark color scheme |
| 21 | updateGridOptions({ theme }) | Community | api | no | P1 | Switch theme at runtime; updates style injection immediately |
| 21 | refreshCells (re-evaluate cellClassRules) | Community | api | yes | P1 | Force re-draw and re-evaluation of cell style callbacks |

<!-- area:22 Events -->
| 22 | Grid lifecycle events | Community | event | yes | P0 | gridReady, ✅ gridPreDestroyed, ✅ gridSizeChanged, ✅ firstDataRendered, modelUpdated, stateUpdated — see `22-events.md` |
| 22 | ✅ Column events | Community | event | yes | P1 | ✅ columnMoved, ✅ columnVisible, ✅ columnPinned, ✅ columnResized (finished flag), ✅ displayedColumnsChanged (source widened: columnGroupOpened/columnDefsChanged/columnVisible/columnPinned/columnMoved/columnsReset), ✅ virtualColumnsChanged, ✅ columnsReset, ✅ columnGroupOpened, columnHeaderClicked — see `22-events.md` |
| 22 | Row events | Community | event | yes | P0 | rowDataUpdated, rowGroupOpened, rowClicked, ✅ rowEditingStarted/Stopped, ✅ rowValueChanged, asyncTransactionsFlushed — see `22-events.md` |
| 22 | Cell events | Community | event | yes | P0 | cellClicked, ✅ cellValueChanged, ✅ cellEditingStarted/Stopped, cellFocused, tooltipShow — see `22-events.md` |
| 22 | Selection events | Community | event | yes | P0 | rowSelected, selectionChanged, cellSelectionChanged — see `22-events.md` |
| 22 | ✅ Filter / sort events | Community | event | yes | P1 | ✅ filterChanged (refined with source / afterDataChange / columns), ✅ filterOpened, ✅ filterModified, sortChanged, findChanged, advancedFilterBuilderVisibleChanged — see `22-events.md` |
| 22 | Group / pivot events | Enterprise | event | no | P1 | columnRowGroupChanged, columnPivotModeChanged, pivotMaxColumnsExceeded, expandOrCollapseAll — see `22-events.md` |
| 22 | Drag events | Community | event | yes | P1 | rowDragEnter/Move/Leave/End/Cancel, dragStarted/Stopped/Cancelled — see `22-events.md` |
| 22 | Tool panel / side bar events | Enterprise | event | no | P2 | toolPanelVisibleChanged, toolPanelSizeChanged, sideBarUpdated, contextMenuVisibleChanged — see `22-events.md` |
| 22 | Chart events | Enterprise | event | no | P3 | chartCreated, chartOptionsChanged, chartDestroyed, chartTitleEdit — see `22-events.md` |
| 22 | Misc events | Community | event | yes | P1 | undoStarted/Ended, redoStarted/Ended, cutStart/End, pasteStart/End, fillStart/End, batchEditingStarted/Stopped — see `22-events.md` |

<!-- area:23 API -->
| 23 | Lifecycle API | Community | api | yes | P0 | getGridId, destroy, ✅ setGridOption, ✅ updateGridOptions, getState, setState, ✅ addEventListener / removeEventListener / on / off — see `23-api.md` |
| 23 | Data API | Community | api | yes | P0 | applyTransaction, applyTransactionAsync, flushAsyncTransactions, refreshClientSideRowModel, setRowCount — see `23-api.md` |
| 23 | ✅ Columns API | Community | api | yes | P0 | getColumnDefs, getColumn, ✅ applyColumnState, ✅ getColumnState, ✅ resetColumnState, ✅ setColumnsVisible, ✅ setColumnsPinned, ✅ setColumnWidths, ✅ moveColumns, ✅ moveColumnByIndex, ✅ sizeColumnsToFit, ✅ autoSizeColumns, ✅ autoSizeAllColumns, ✅ getHeaderBoundsAt — see `23-api.md` |
| 23 | Rows API | Community | api | yes | P0 | getRowNode, getDisplayedRowCount, forEachNode, redrawRows, expandAll, collapseAll, getPinnedTopRow — see `23-api.md` |
| 23 | Cells API | Community | api | yes | P0 | refreshCells, ✅ flashCells, getCellRendererInstances, ✅ registerCellRenderer, ✅ registerCellEditor, ✅ startEditingCell, ✅ stopEditing, undoCellEditing — see `23-api.md` |
| 23 | Selection API | Community | api | yes | P0 | selectAll, deselectAll, getSelectedNodes, getSelectedRows, ✅ setSelectedRowIds, getCellRanges, clearCellSelection — see `23-api.md` |
| 23 | Sorting API | Community | api | no | P1 | onSortChanged — see `23-api.md` |
| 23 | ✅ Filtering API | Community | api | yes | P1 | ✅ isAnyFilterPresent, ✅ isColumnFilterPresent, ✅ setFilterModel, getFilterModel, ✅ getColumnFilterModel, ✅ setColumnFilterModel, ✅ destroyFilter, ✅ showColumnFilter, ✅ hideColumnFilter, ✅ onFilterChanged, getAdvancedFilterModel — see `23-api.md` |
| 23 | Grouping / aggregation / pivot API | Enterprise | api | no | P2 | setRowGroupColumns, addAggFuncs, isPivotMode, setPivotColumns, addDetailGridInfo — see `23-api.md` |
| 23 | Server-side API | Enterprise | api | no | P2 | applyServerSideTransaction, refreshServerSide, getServerSideGroupLevelState — see `23-api.md` |
| 23 | Clipboard API | Enterprise | api | no | P2 | copyToClipboard, cutToClipboard, pasteFromClipboard, copySelectedRowsToClipboard — see `23-api.md` |
| 23 | Charts API | Enterprise | api | no | P3 | createRangeChart, createPivotChart, getChartModels, updateChart, restoreChart — see `23-api.md` |
| 23 | Export API | Community | api | no | P2 | getDataAsCsv, exportDataAsCsv, exportDataAsExcel, exportMultipleSheetsAsExcel — see `23-api.md` |
| 23 | Status bar / side bar API | Enterprise | api | no | P2 | getStatusPanel, isSideBarVisible, openToolPanel, getToolPanelInstance — see `23-api.md` |
| 23 | Misc API | Community | api | yes | P1 | getFocusedCell, ✅ setFocusedCell, ✅ ensureColumnVisible, ✅ ensureColumnGroupVisible, ✅ ensureRowVisible (by rowId), ensureIndexVisible, paginationGoToPage — see `23-api.md` |

<!-- area:24 Charts & sparklines -->
| 24 | enableCharts | Enterprise | option | no | P2 | Enables integrated charting; requires IntegratedChartsModule + ag-charts-community peer |
| 24 | chartThemes | Enterprise | option | no | P3 | List of built-in theme names available in the chart panel; initial-only |
| 24 | customChartThemes | Enterprise | option | no | P3 | Map of user-defined theme name to AgChartTheme objects; initial-only |
| 24 | chartThemeOverrides | Enterprise | option | no | P3 | Global theme overrides applied to all charts; initial-only |
| 24 | chartToolPanelsDef | Enterprise | option | no | P3 | Controls visibility and order of Chart Tool Panels and chart type list; initial-only |
| 24 | chartMenuItems | Enterprise | option | no | P3 | Custom context-menu items for charts; requires ag-charts-enterprise |
| 24 | agSparklineCellRenderer | Enterprise | option | no | P1 | Inline sparkline cell renderer; requires SparklinesModule + ag-charts-community peer |
| 24 | ISparklineCellRendererParams.sparklineOptions | Enterprise | option | no | P1 | Full AgSparklineOptions config (type: line/area/bar/column, axis, tooltip, markers) |
| 24 | createRangeChart | Enterprise | api | no | P2 | Creates a live-linked range chart from a cell range; returns ChartRef |
| 24 | createPivotChart | Enterprise | api | no | P2 | Creates a chart from pivot result columns; requires pivotMode=true |
| 24 | createCrossFilterChart | Enterprise | api | no | P3 | Creates a cross-filter chart that filters the grid when a series is clicked |
| 24 | updateChart | Enterprise | api | no | P3 | Updates type/theme/options/range of an existing chart by chartId |
| 24 | getChartModels | Enterprise | api | no | P3 | Returns serialisable ChartModel[] for all open charts |
| 24 | getChartRef | Enterprise | api | no | P3 | Returns ChartRef for a chart by its chartId |
| 24 | getChartImageDataURL | Enterprise | api | no | P3 | Returns PNG/JPEG data URL of a chart image |
| 24 | downloadChart | Enterprise | api | no | P3 | Triggers browser download of a chart as an image file |
| 24 | openChartToolPanel | Enterprise | api | no | P3 | Programmatically opens the Chart Tool Panel to a named panel |
| 24 | closeChartToolPanel | Enterprise | api | no | P3 | Programmatically closes the Chart Tool Panel |
| 24 | restoreChart | Enterprise | api | no | P3 | Restores a chart from a serialised ChartModel |
| 24 | chartCreated | Enterprise | event | no | P3 | Fires when a new integrated chart is created; payload: ChartCreatedEvent { chartId } |
| 24 | chartRangeSelectionChanged | Enterprise | event | no | P3 | Fires when the cell range driving a chart changes; payload: { chartId, cellRange } |
| 24 | chartOptionsChanged | Enterprise | event | no | P3 | Fires when chart type/theme/options change via tool panel; payload: { chartId, chartType, chartThemeName } |
| 24 | chartDestroyed | Enterprise | event | no | P3 | Fires when a chart is closed; payload: ChartDestroyedEvent { chartId } |
| 24 | Range selection → chart creation | Enterprise | behavior | no | P2 | Right-click cell range shows Chart Range; chart opens linked to range; see 12-selection.md |
| 24 | Live-linked chart updates | Enterprise | behavior | no | P2 | Linked charts re-render automatically on transaction flush or rowData change |
| 24 | Chart serialisation / restore | Enterprise | behavior | no | P3 | getChartModels + restoreChart for save/restore across page loads |
| 24 | Pivot chart integration | Enterprise | behavior | no | P3 | createPivotChart uses secondary pivot columns; see 11-pivoting.md |
| 24 | Cross-filter chart | Enterprise | behavior | no | P3 | Series click translates to setFilterModel on the grid |
| 24 | Sparkline column value contract | Enterprise | behavior | no | P1 | Cell value must be number[] or {x,y}[]; valueGetter output feeds sparkline |
| 24 | Module dependencies | Enterprise | behavior | no | P2 | IntegratedChartsModule + ag-charts-community; ag-charts-enterprise for extra types |

<!-- area:25 Export -->
| 25 | exportDataAsCsv | Community | api | no | P1 | Serialise displayed data to CSV and trigger browser download |
| 25 | getDataAsCsv | Community | api | no | P1 | Return CSV-serialised string without triggering download |
| 25 | exportDataAsExcel | Enterprise | api | no | P1 | Serialise displayed data to .xlsx and trigger browser download |
| 25 | getDataAsExcel | Enterprise | api | no | P1 | Return Excel data as Blob or base64 string without download |
| 25 | getSheetDataForExcel | Enterprise | api | no | P2 | Return raw sheet XML for use with exportMultipleSheetsAsExcel |
| 25 | getMultipleSheetsAsExcel | Enterprise | api | no | P2 | Merge multiple sheet XML strings into a single Blob |
| 25 | exportMultipleSheetsAsExcel | Enterprise | api | no | P2 | Merge multiple sheet XML strings and trigger browser download |
| 25 | allColumns (BaseExportParams) | Community | option | no | P1 | Export all columnDefs columns in definition order |
| 25 | columnKeys (BaseExportParams) | Community | option | no | P1 | Explicit ordered column list for export; overrides allColumns |
| 25 | exportedRows (BaseExportParams) | Community | option | no | P1 | 'all' or 'filteredAndSorted' (default); controls which rows are exported |
| 25 | onlySelected (BaseExportParams) | Community | option | no | P2 | Export only currently selected rows |
| 25 | skipColumnHeaders / skipColumnGroupHeaders (BaseExportParams) | Community | option | no | P1 | Omit header rows from the export output |
| 25 | skipRowGroups / skipPinnedTop / skipPinnedBottom (BaseExportParams) | Community | option | no | P2 | Omit group, top-pinned, or bottom-pinned rows from export |
| 25 | shouldRowBeSkipped (BaseExportParams) | Community | option | no | P2 | Per-row veto callback; return true to exclude a row |
| 25 | processCellCallback | Community | option | no | P1 | Per-cell callback returning string override for exported value |
| 25 | processHeaderCallback | Community | option | no | P1 | Per-column callback returning string override for header text |
| 25 | processGroupHeaderCallback | Community | option | no | P2 | Per-column-group callback returning override for group header |
| 25 | processRowGroupCallback | Community | option | no | P1 | Per-row-group callback returning override for group cell; see 09-row-grouping.md |
| 25 | columnSeparator (CsvExportParams) | Community | option | no | P2 | Delimiter character between cells in CSV output |
| 25 | suppressQuotes (CsvExportParams) | Community | option | no | P2 | Disable RFC 4180 quoting; caller must avoid separator in values |
| 25 | sheetName (ExcelWorksheetConfigParams) | Enterprise | option | no | P1 | Excel sheet tab name; max 31 characters |
| 25 | freezeRows / freezeColumns (ExcelWorksheetConfigParams) | Enterprise | option | no | P2 | Freeze header rows and/or pinned columns in the Excel worksheet |
| 25 | protectSheet (ExcelWorksheetConfigParams) | Enterprise | option | no | P2 | Protect worksheet; ExcelSheetProtection allows specific user actions |
| 25 | exportAsExcelTable (ExcelWorksheetConfigParams) | Enterprise | option | no | P2 | Wrap data in an Excel Table for built-in sort/filter in Excel |
| 25 | rowGroupExpandState (ExcelWorksheetConfigParams) | Enterprise | option | no | P2 | expanded/collapsed/match — state of row groups in the workbook |
| 25 | addImageToCell (ExcelWorksheetConfigParams) | Enterprise | option | no | P3 | Callback to embed an image in a specific cell |
| 25 | autoConvertFormulas (ExcelWorksheetConfigParams) | Enterprise | option | no | P3 | Treat values starting with = as Excel formulas |
| 25 | excelStyles (GridOptions) | Enterprise | option | no | P1 | ExcelStyle[] matched to cell CSS classes at export time |
| 25 | defaultExcelExportParams (GridOptions) | Enterprise | option | no | P2 | Default ExcelExportParams merged with per-call params |
| 25 | defaultCsvExportParams (GridOptions) | Community | option | no | P2 | Default CsvExportParams merged with per-call params |
| 25 | ExcelStyle.id CSS-class matching | Enterprise | behavior | no | P1 | ExcelStyle id matches cellClass; enables CSS-driven Excel formatting |
| 25 | Multi-sheet export pattern | Enterprise | behavior | no | P2 | getSheetDataForExcel per sheet + exportMultipleSheetsAsExcel to bundle |
| 25 | processCellCallback shared with clipboard | Community | behavior | no | P1 | Same hook fires for CSV, Excel, and clipboard copy; see 19-context-menu-and-clipboard.md |
| 25 | CSV is renderer-agnostic | Community | behavior | no | P0 | Serialisation reads from row model; no DOM dependency; canvas-portable as-is |

<!-- area:26 Performance knobs -->
| 26 | rowBuffer | Community | option | yes | P0 | Rows rendered outside viewport; canvas equiv is overscan; see 05-rendering-and-dom.md |
| 26 | suppressRowVirtualisation | Community | option | no | P3 | Render all rows; no canvas equivalent — canvas always virtualises |
| 26 | suppressMaxRenderedRowRestriction | Community | option | no | P3 | Remove 500-row cap; no canvas equivalent |
| 26 | suppressColumnVirtualisation | Community | option | no | P1 | Render all columns; obsolete in canvas grid — column virtualisation is mandatory |
| 26 | animateRows | Community | option | yes | P2 | CSS row-position animation; set false for high-freq updates; no DOM equivalent in canvas |
| 26 | suppressAnimationFrame | Community | option | no | P2 | Synchronous cell rendering during scroll; obsolete — canvas is rAF-driven |
| 26 | debounceVerticalScrollbar | Community | option | no | P2 | Debounce vertical scroll events for slow machines |
| 26 | asyncTransactionWaitMillis | Community | option | yes | P0 | Batch window for applyTransactionAsync; translates directly to canvas port |
| 26 | suppressModelUpdateAfterUpdateTransaction | Community | option | no | P1 | Skip pipeline refresh on update-only transactions; translates directly |
| 26 | getRowId (immutable mode) | Community | option | yes | P0 | Stable row ID enables delta detection on rowData replace; translates directly |
| 26 | resetRowDataOnUpdate | Community | option | no | P2 | Force full reset even with getRowId; translates directly |
| 26 | suppressChangeDetection | Community | option | no | P1 | Disable value diff before refresh; canvas port can use dirty-region paint instead |
| 26 | suppressPropertyNamesCheck | Community | option | no | P3 | Deprecated v33; use context property and ValidationModule instead |
| 26 | cacheQuickFilter | Community | option | no | P1 | Cache per-row quick-filter text aggregate; translates directly |
| 26 | valueCache | Community | option | no | P2 | Cache valueGetter results; requires ValueCacheModule; translates directly |
| 26 | valueCacheNeverExpires | Community | option | no | P3 | Prevent value cache expiry on data update; translates directly |
| 26 | deltaSort | Community | option | no | P1 | Re-sort only transaction-changed rows; see 07-sorting.md; translates directly |
| 26 | aggregateOnlyChangedColumns | Enterprise | option | no | P2 | Re-aggregate only columns with changed leaf values; see 10-aggregation.md |
| 26 | rowModelType (large dataset selection) | Community | option | no | P0 | Infinite/serverSide/viewport row models for data beyond ~50k rows; see 03-row-models.md |
| 26 | cacheBlockSize | Community | option | no | P2 | Rows per block for Infinite/SSRM; tune to minimise round-trips; see 03-row-models.md |
| 26 | maxBlocksInCache | Community | option | no | P2 | LRU eviction cap for Infinite row model; limits memory; see 03-row-models.md |
| 26 | blockLoadDebounceMillis | Community | option | no | P2 | Debounce before block fetch in Infinite row model |
| 26 | applyTransactionAsync | Community | api | yes | P0 | Queue transaction for batched apply; core perf API for streaming data |
| 26 | flushAsyncTransactions | Community | api | no | P0 | Immediately flush pending async transactions |
| 26 | refreshClientSideRowModel | Community | api | no | P1 | Re-run CSRM pipeline from a given step without data change |
| 26 | refreshCells | Community | api | no | P0 | Re-render specified cells in place; lower cost than redrawRows |
| 26 | redrawRows | Community | api | no | P1 | Destroy and recreate rows; higher cost; use when row structure changes |
| 26 | asyncTransactionsFlushed | Community | event | yes | P0 | Async transaction batch applied; payload includes all RowNodeTransaction results |
| 26 | modelUpdated | Community | event | no | P0 | Displayed rows recomputed after any pipeline pass |
| 26 | Async transaction batching | Community | behavior | yes | P0 | applyTransactionAsync queues; flush after waitMillis; single pipeline pass |
| 26 | getRowId delta detection | Community | behavior | yes | P0 | rowData replacement constructs synthetic add/update/remove transactions |
| 26 | Row virtualisation window | Community | behavior | no | P0 | viewport_rows + 2*rowBuffer rows in DOM; see 05-rendering-and-dom.md |
| 26 | suppressColumnVirtualisation cost | Community | behavior | no | P1 | All N columns in DOM simultaneously; multiplicative DOM node increase |
| 26 | animateRows:false for streaming data | Community | behavior | yes | P1 | Eliminates CSS animation overhead; first recommendation for high-freq updates |
| 26 | suppressAnimationFrame trade-off | Community | behavior | no | P2 | Eliminates blank cells during scroll but blocks main thread |
| 26 | Column virtualisation obsolete in canvas | Community | behavior | no | P0 | Canvas grid always virtualises columns; suppressColumnVirtualisation has no canvas analog |
| 26 | rowBuffer → canvas overscan | Community | behavior | no | P0 | rowBuffer maps to overscan row count in canvas; offscreen tile pre-render on worker |
| 26 | Dirty-region canvas repaint | Community | behavior | no | P0 | Canvas port can repaint only changed cell regions; finer than refreshCells |
