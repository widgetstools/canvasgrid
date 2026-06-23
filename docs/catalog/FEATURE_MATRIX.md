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

<!-- area:07 Sorting -->

<!-- area:08 Filtering -->

<!-- area:09 Row grouping -->

<!-- area:10 Aggregation -->

<!-- area:11 Pivoting -->

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
