# VelocityGrid — Complete Feature Reference

**Scope:** Every product capability of VelocityGrid and its companion packages — CSRM, SSRM, expressions, calculated columns, formatting, rules, editing, renderers, data hub, Perspective, and related APIs.  
**Kernel package:** `@wellsfargo-starui/velocity-grid` (`packages/kernel`)  
**Branch baseline:** `main`  
**Architecture & implementation:** [velocity-grid-architecture.md](./velocity-grid-architecture.md) — topology, main/worker split, CSRM/SSRM pipelines, companion wire points, design principles.  
**UI chrome docs (separate):**  
- [velocity-grid-ext-feature-reference.md](./velocity-grid-ext-feature-reference.md) — title bar, ribbons, Customize drawer  
- [data-provider-editor-feature-reference.md](./data-provider-editor-feature-reference.md) — DataProvider catalog popout  

If a string or option drifts, prefer source over this file.

---

## Architecture (summary)

VelocityGrid is a **canvas engine** with an **AG-Grid-like API**. Heavy data work (filter/sort/group/pivot/agg/CSRM calc) runs in a **dedicated worker**; the main thread owns paint, overlays, SSRM block cache, and events. Companion packages (`format`, `calc`, `rules`, `edit`, `renderers`) attach via **DI slots / bridges** — the kernel never imports them. **CSRM** is fed by host `rowData` or the **data** SharedWorker hub; **SSRM** is fed by a datasource (typically **Perspective** Table/View + ExprTK). Full diagrams, pipeline stage order, and wire-point tables: [velocity-grid-architecture.md](./velocity-grid-architecture.md).

---

## 0. Package map

| Package | npm name | Role |
|---------|----------|------|
| **kernel** | `@wellsfargo-starui/velocity-grid` | Canvas grid engine, CSRM/SSRM, columns, filter/sort/group/pivot, selection, edit chrome, theme, state |
| **expression** | `@wellsfargo-starui/velocity-grid-expression` | Row-local DSL parse → compile → evaluate → validate |
| **calc** | `@wellsfargo-starui/velocity-grid-calc` | CSRM calculated columns, aggregates, `PREV`, templates/overrides |
| **format** | `@wellsfargo-starui/velocity-grid-format` | Format DSL (Excel / expression / composite), templates |
| **rules** | `@wellsfargo-starui/velocity-grid-rules` | Conditional styling, flash, indicators, alerts engine |
| **edit** | `@wellsfargo-starui/velocity-grid-edit` | Smart edit, bulk, ± nudges, letter shortcuts, undo journal |
| **renderers** | `@wellsfargo-starui/velocity-grid-renderers` | Canvas cell painters (51+ named renderers) |
| **data** | `@wellsfargo-starui/velocity-grid-data` | CSRM SharedWorker hub, transports, catalog, bind-to-grid |
| **perspective** | `@wellsfargo-starui/velocity-grid-perspective` | SSRM Perspective Table/View, ExprTK expressions, STOMP/seed |
| **appdata** | `@wellsfargo-starui/velocity-grid-appdata` | `{{name.key}}` template bags for provider/grid config |
| **customizer** | `@wellsfargo-starui/velocity-grid-customizer` | Lit tool-panel chrome for edit settings |
| **ext** | `@wellsfargo-starui/velocity-grid-ext` | Markets chrome (see Ext doc) |
| **export** | `@wellsfargo-starui/velocity-grid-export` | **Scaffold** (kernel has CSV/XLSX today) |
| **excel-pivot** | `@wellsfargo-starui/velocity-grid-excel-pivot` | **Scaffold** (kernel AG-style pivot exists) |

**Style entry:** `@wellsfargo-starui/velocity-grid/style.css`  
**Extra exports:** `./icons/lucide.generated`, `./ui/primitives`  
**Version const:** `VELOCITY_GRID_VERSION`

---

## 1. Construction & identity

### 1.1 Constructor

```ts
new VelocityGrid<TRow>(container: HTMLElement, options: VelocityGridOptions<TRow>)
```

| Requirement | Detail |
|-------------|--------|
| Required options | `columnDefs`, `getRowId` |
| Ready signal | `gridReady` event; `api` on event payload |
| Optional worker | `worker?: { url?: string }` — custom worker URL |
| Shadow DOM | `shadowRoot?: boolean` — open shadow root + inlined tokens |
| Opaque context | `context?: unknown` — available to callbacks |
| Debug | `debug?: boolean` — verbose engine logging |
| A11y label | `ariaLabel?: string` — `role="grid"` |

### 1.2 Initial-only options

Cannot use `setGridOption` (use `updateGridOptions` where applicable):

`columnDefs`, `getRowId`, `worker`, `gridId`, `persistState`, `shadowRoot`

### 1.3 Identity / layouts / persistence options

| Key | Purpose |
|-----|---------|
| `gridId` | Namespaces persisted state (`velocity-grid:state:<gridId>`) |
| `persistState` | `true` → localStorage; or `{ adapter?, debounceMs? }` (default debounce **500**) |
| `initialState` | `GridState` restore before first paint |
| `layouts` | Named `GridLayout[]` seeds; reserved id `'default'` |
| `activeLayoutId` | Initial active layout |
| `layoutGridLevelModules` | Default `['editSettings','templates','alerts','data-provider']` |
| `tabToNextHeader` / `tabToPreviousHeader` | `(params) => boolean` — Tab-out control |

**Adapter:** `LocalStorageStateAdapter`, `STATE_SCHEMA_VERSION` (currently **4**).

**Not persisted as options:** `rowData`, pinned row data, `context`, `loading`/`loadingMessage`, `debug`, `quickFilterText`, `aggFuncs`, clipboard/fill callbacks, `theme` class (theme params may persist separately).

---

## 2. Columns

### 2.1 Grid-level column options

| Key | Purpose |
|-----|---------|
| `columnDefs` | `(CColDef \| CColGroupDef)[]` |
| `defaultColDef` | Merged into every leaf |
| `columnTypes` | Named `Partial<CColDef>` bundles; merge L→R then default then col |
| `autoGroupColumnDef` | Patch for synthesized auto-group column (`colId` forced `ag-Grid-AutoColumn`) |

### 2.2 Leaf `CColDef` — layout / identity

`colId?`, `field?`, `headerName?`, `width?`, `flex?`, `minWidth?`, `maxWidth?`, `pinned?: 'left'|'right'`, `hide?`, `initialHide?`, `initialPinned?`, `initialWidth?`, `type?: string|string[]` (`'text'`/`'number'` deprecate toward `cellDataType`; `'composite'` reserved for format Tier 2), `cellDataType?: 'text'|'number'`, `columnGroupShow?: 'open'|'closed'|null`, `suppressMovable?`, `lockPosition?: boolean|'left'|'right'`, `lockVisible?`, `lockPinned?`, `suppressSizeToFit?`, `suppressAutoSize?`

### 2.3 Leaf — values / render / style

| Area | Keys |
|------|------|
| Values | `valueGetter?`, `valueFormatter?: string\|fn`, `valueParser?`, `valueSetter?` |
| Icons | `cellIcon?`, `headerIcon?` |
| Renderers | `cellRenderer?`, `cellRendererParams?`, `cellRendererSelector?` |
| Composite | `fragments?`, `cellBackground?`, `align?`, `overflow?: 'ellipsis'|'clip'` |
| Height/wrap | `autoHeight?`, `wrapText?`, `wrapHeaderText?`, `autoHeaderHeight?` |
| Classes/styles | `cellClass?`, `cellClassRules?`, `cellStyle?`, `headerClass?`, `headerStyle?` |

**`ColCellOverrides` style patch facets:** `fg`, `bg`, `halign`, `valign`, `font`/`fontFamily`/`fontSize`/`fontWeight`/`fontStyle`, `textTransform`, `textDecoration`, `letterSpacing`, `lineHeight`, `padding`, `border`, `content` (text/icon/emoji/icon-text), `decorators` (tl/tr/bl/br/ml/mr).

### 2.4 Leaf — sort / filter / agg / group / pivot / edit

| Area | Keys |
|------|------|
| Sort | `sortable?`, `accentedSort?`, `unSortIcon?`, `comparator?: string\|fn`, `initialSort?`, `initialSortIndex?`, `sortGroupRowsByKey?` |
| Filter | `filter?: 'text'\|'number'\|'date'\|'set'\|'agGroupColumnFilter'`, `filterParams?`, `floatingFilter?`, `suppressFloatingFilterButton?`, `getQuickFilterText?` |
| Agg | `aggFunc?: string\|string[]`, `suppressAggFuncInHeader?`, `totalsCellRenderer?` |
| Group/pivot | `enableRowGroup?`, `keyCreator?`, `enablePivot?`, `enableValue?` |
| Selection | `checkboxSelection?`, `headerCheckboxSelection?` |
| Edit | `editable?: boolean\|EditableCallback`, `singleClickEdit?`, `suppressKeyboardEvent?`, `cellEditor?`, `cellEditorParams?`, `cellEditorPopup?`, `cellEditorPopupPosition?: 'over'\|'under'` |

### 2.5 Column groups `CColGroupDef`

`groupId?`, `headerName?`, **`children` (required)**, `openByDefault?`, `marryChildren?`, `headerClass?`, `headerStyle?`, `columnGroupShow?`, `hide?`

### 2.6 Column state & sizing APIs

- State: `getColumnState`, `applyColumnState`, `resetColumnState`, `CColumnState` / `CApplyColumnStateParams`
- Move/visibility: `moveColumnByIndex`, `moveColumns`, `moveColumnToGroup`, `moveColumnGroup`, `setColumnsVisible`, `setColumnsPinned`, `setColumnWidths`
- Size: `sizeColumnsToFit`, `autoSizeColumns`, `autoSizeAllColumns` (+ `ISizeColumnsToFitParams`)
- Groups: `getColumnGroupDefs`, `get/set/resetColumnGroupState`, `forEachColumnGroup`, `ensureColumnGroupVisible`
- Introspect: `getCellBoundsAt`, `getHeaderBoundsAt`, `getRowBoundsAt`, `getCellValue`, `getCellPaintedBg`, `isColumnRowGroupEnabled`, `isColumnPivotEnabled`, `isColumnValueEnabled`, `getColumnHeaderName`
- Drag helpers: `isPointInColumnHeaderBand`, `setColumnHeaderDragHover`, `commitColumnHeaderDrop`

Utility: `inferRowIdField`, `clampRowHeight`, `MIN_ROW_HEIGHT_PX` (**24**).

---

## 3. Row models — CSRM vs SSRM

| Model | Option | Status |
|-------|--------|--------|
| **Client-side (CSRM)** | `rowModelType: 'clientSide'` (default) | Full in-memory worker pipeline |
| **Server-side (SSRM)** | `rowModelType: 'serverSide'` | Block cache + optional CSRM pipeline bridge |
| Infinite | — | **Not present** |
| Tree data (path model) | — | **Not present** (grouping tree only) |
| Master/detail | — | **Not present** |
| Pagination as row model | — | **Not present** (`selectAll: 'currentPage'` reserved only) |

---

## 4. CSRM — client-side row model

### 4.1 Data options & APIs

| Feature | Detail |
|---------|--------|
| Option | `rowData?` |
| Replace | `setRowData(rows)` |
| Sync tx | `applyTransaction({ add?, update?, remove? })` → `TransactionResult` |
| Async tx | `applyTransactionAsync`, `flushAsyncTransactions` |
| Live source | `clientSideDataProvider?` option + `setClientSideDataProvider(p \| null)` — see 4.1.1 |
| Event | `asyncTransactionsFlushed`, `rowsChanged` (`source: 'transaction'\|'transactionAsync'\|'edit'`) |

### 4.1.1 `clientSideDataProvider` — live row source

CSRM counterpart to `serverSideDatasource`: the grid owns the subscription for its lifetime.

| Member | Purpose |
|--------|---------|
| `getSnapshot(): readonly TRow[]` | Painted on install so a warm provider shows immediately |
| `onSnapshot(fn): () => void` | Full replace (initial load, reconnect, resync) |
| `onDelta?(fn): () => void` | Optional `{ add?, update?, removeIds? }`; omit for snapshot-only sources |

- Deltas ride `applyTransactionAsync`, so the 4.2 knobs govern the feed — no second throttle.
- `removeIds` is the `getRowId` domain, not row objects; unknown ids are ignored.
- `destroy()` unsubscribes only — it never destroys the provider (one provider can feed many grids).
- Installed after the `rowData` seed, so a live source wins over a static array.
- `packages/data`: `toClientSideDataProvider(provider)` adapts a hub `IDataProvider`.

### 4.2 Async transaction knobs

| Key | Default | Notes |
|-----|---------|-------|
| `asyncTransactionWaitMillis` | **50** | Debounce before flush |
| `asyncTransactionConflate` | **true** | Last-write-wins per row in batch |
| `asyncTransactionThrottleMillis` | **200** | Clamp `[100,1000]`; programmatic `0` disables |
| `deferAsyncTransactionsWhileScrolling` | **true** | Hold flush while scrolling |

### 4.3 Pinned / totals rows

| Key | Behavior |
|-----|----------|
| `pinnedTopRowData` | Caller-owned non-scrolling top rows |
| `pinnedBottomRowData` | Caller-owned bottom rows (above bottom totals) |
| `totalsRowPosition` | `'top'\|'bottom'\|null` — worker `chunk.totals` grand totals |
| `grandTotalRow` | `'top'\|'bottom'\|'pinnedTop'\|'pinnedBottom'\|null` |
| `groupTotalRow` | `'top'\|'bottom'\|null` |
| `groupIncludeFooter` / `groupIncludeTotalFooter` | Per-group / grand footer rows in body |

### 4.4 Row height

- `rowHeight` (floor **24** px), `headerHeight`
- `getRowHeight?(params)` per-row override
- Column `autoHeight` + worker text measure

### 4.5 CSRM data hub (package `data`)

High-level features (editor UI → companion DP doc):

| Area | Features |
|------|----------|
| Hub | `DataServicesHub` — one upstream + `RowCache` per `providerId`; SharedWorker protocol |
| Bind | `bindProviderToGrid` → `setRowData` / `applyTransaction` |
| Client | `ProviderClientAdapter`, `connectHub` |
| Transports | Built-in `mock`, `stomp`, `rest`; stubs solace / amps / socketio / websocket |
| Plugins | `defineTransportPlugin` / `registerTransportPlugin` |
| Pipeline | Conflate, throttle, `thinDeltas`, `projectFields`, `wireFormat` json\|columnar, snapshot chunks, reconnect |
| Schema | `inferFieldsFromRows`, `fieldsToColumnDefinitions` |
| Catalog backends | LocalStorage / IndexedDb / Rest / Memory |
| Feed control | Stop/restart registry for Diagnostics |
| OpenFin | Same-origin SharedWorker fan-out |

### 4.6 CSRM calculated columns

See **§11** (`packages/calc` + `wireIntoKernel`). Runs in worker CalcPass; sort/filter/group like data columns.

---

## 5. SSRM — server-side row model

### 5.1 Options

| Key | Default | Meaning |
|-----|---------|---------|
| `serverSideDatasource` | — | v2 datasource; a `getRows`-only object drives v2's flat path |
| `cacheBlockSize` | **100** | Rows per block |
| `maxConcurrentDatasourceRequests` | **2** | Parallel `getRows` |
| `serverSideEnableClientSidePipeline` | auto | `true`/`false`/`undefined` — run CSRM filter/sort/group/pivot/agg on hydrated book |

### 5.2 API

| Method | Purpose |
|--------|---------|
| `setServerSideDatasource(ds \| null)` | Attach/detach |
| `refreshServerSide({ purge? })` | Refresh; default purge drops cache |
| `applyServerSideTransaction({ add?, update?, remove?, rowCount? })` | Patch cache |
| `whenReady()` | Promise when ready |
| `setSsrmExpressionHost(host \| null)` | Perspective ExprTK host |

### 5.3 Datasource v1 — `IServerSideDatasource`

- `getRows(params)`, optional `destroy?`
- **Request:** `startRow`, `endRow`, `sortModel`, `filterModel`, `rowGroupCols`, `groupKeys`, `expandedGroupKeys`, `columnKeys?`
- **Success:** `rowData`, `rowCount?`, `groupKeys?`, `grandTotals?`

### 5.4 Datasource v2 — `IServerSideDatasourceV2` (has `getGroupSkeleton`)

| Method | Purpose |
|--------|---------|
| `getRows` | Ungrouped flat window |
| `getGroupSkeleton` | `{ groups: SkeletonGroup[] }` — `path`, `leafCount`, `aggregates?` |
| `getLeafRows` | Leaf window under deepest group path |
| `getGroupLeafIds?` | Cascade selection over unloaded leaves |

### 5.5 Row meta helpers

`SSRM_ROW_META_KEY`, `attachSsrmRowMeta`, `readSsrmRowMeta`, `isServerSideDatasourceV2`, `buildSsrmColumnKeys`, `mergeSsrmRowFields`

**`SsrmExpressionHost`:** `get/set/validateExpressions`, optional `getDistinctValues`, `countMatchingFilterModel`

### 5.6 Perspective SSRM (package `perspective`)

| API | Purpose |
|-----|---------|
| `StompPerspectiveProvider` | Shared **Table** + per-grid **View** + SSRM + live attach |
| `attach(grid)` / `gridOptions()` | Wire SSRM + ticks |
| `setExpressions` / `getExpressions` / `validateExpressions` | **Perspective ExprTK** (WASM) — not `velocity-grid-expression` |
| `PerspectiveBook` | Phases idle→bootstrapping→connecting→snapshot→live / error / disconnected |
| Feeds | `'stomp'` \| `'seed'`; worker `'shared'` \| `'dedicated'` |
| Book methods | `registerView`/`unregisterView`, `getSsrmRows`, `getGroupSkeleton`, `getLeafRows`/`getFlatRows`, `setViewGroupBy`, `setViewExpressions`, `setViewValueAggregates`, `setViewQuickFilterText`, `fetchGrandTotal`, `getDistinctColumnValues`, `countMatchingFilterModel`, connect/disconnect, feed pause/stop/restart |
| Filter map | `cgridFilterToPsp` — AG/cgrid filter → Perspective triples |
| Agg map | `mapAggFuncToPerspective` — sum/avg/min/max/count/first/last/median/unique/dominant |
| Quick filter | Synthetic haystack ExprTK (`QUICK_FILTER_HAYSTACK_ALIAS`) |
| OR-contains | Boolean ExprTK aliases (`OR_CONTAINS_ALIAS_PREFIX`) |
| Catalog / controller | `LocalStoragePerspectiveProviderCatalog`, `PerspectiveDataProviderController` (multi-grid; `expressionsByProvider`) |
| Config | `resolveProviderConfig`, `dataProviderConfigToPerspective`, `gridColumnDefsFromDataProvider`, `mergeExpressionColumnDefs` |

**Critical:** SSRM calculated columns = Perspective ExprTK on the View. CSRM calculated columns = `packages/calc` worker program. Do not conflate.

### 5.7 The shared engine — one Perspective per origin

The WASM engine runs in a **SharedWorker**, so blotters that share it get one engine, one physical table and one feed. Same `providerId` (+ schema) ⇒ one Table; each blotter still registers its own View, and exactly one tab leads the feed while the rest read the shared book.

| Concern | Behaviour |
|---------|-----------|
| Table identity | `tableNameForSchema(schema, identity)`; `identity` = `bookIdentityFor(config)` — catalog `providerId`, else `wsUrl` + topic/clientId. Two providers with the same columns but different brokers never collide |
| Feed leadership | Web Lock per table; one leader feeds, followers `adoptSharedLive` and queue for takeover |
| Worker identity | `(origin, script URL, name)` — **all three**. Tabs of one app agree for free; **two apps do not**, since each bundle emits its own hashed copy of the worker script |
| Converging several apps | Build the artefact (`npm run build:shared-worker -w @wellsfargo-starui/velocity-grid-perspective` → `dist/perspective-shared-worker.js`, self-contained), deploy ONE copy per origin, and call `configurePerspectiveSharedWorker({ url })` from every app before the first `getPerspectiveClient()`. `getPerspectiveSharedWorkerTarget()` → `{ url, name, bundled }`; apps meant to share must all report `bundled: false` and the same `url` + `name` |
| Cost of *not* converging | Not just duplication. Feed leadership is a Web Lock, which is **origin**-scoped while the engine is not — so two apps contend for one lock over two separately-empty tables, and the loser waits out a 30s `waitForSharedSnapshot` timeout before feeding itself. Measured 35s to live unshared vs ~10s shared |
| Bundling hazard | The default path depends on `new URL('./sharedServer.worker.ts', import.meta.url)` staying **literal and inline** inside `new SharedWorker(...)` — that shape is what a bundler matches to compile it as a worker. Computing the URL elsewhere degrades it to a bare `.ts` asset that fails only in production. Pinned by `packages/perspective/tests/sharedWorkerBundling.test.ts` |
| Session lifetime | Released on `pagehide`; an idle reaper (45s heartbeat, 5-min timeout) covers renderers that crash without running script. Perspective's own client sends nothing on unload |
| Diagnostics | `readSharedEngineStats()` → `{ heapBytes, sessions, engineUp }` on its own port |
| Fallback | Dedicated worker when SharedWorker is unavailable, init times out, or `?worker=dedicated` |

**The engine outlives every page.** It is torn down only when the *last* tab on that URL disconnects — so with one tab a reload silently restarts everything, and with two it does not. Memory and lifetime questions here are only meaningful with ≥ 2 tabs open; `e2e/ssrm-shared-engine.spec.ts` and `e2e/ssrm-engine-sharing.spec.ts` are that harness, and `npm run verify:shared-engine` builds the two-apps-on-one-origin case (`/a1` + `/a2`) and asserts both regimes end to end.

---

## 6. Sorting

### 6.1 Options

| Key | Default / notes |
|-----|-----------------|
| `multiSortKey` | `'Shift'` \| `'Ctrl'` \| `'Alt'` \| `null` (null disables multi-sort) |
| `sortingOrder` | `['asc','desc',null]` |
| `postSortRows?` | Main-thread reorder after worker sort |
| `groupMaintainOrder?` | Don’t reorder groups on sort |

Per-column: §2.4 sort keys.

### 6.2 API / events

- `setSortModel` / `getSortModel`
- `registerComparator(name, fn): Promise<void>`
- Event: `sortChanged { sortModel }`

---

## 7. Filtering

### 7.1 Filter types

Column filters: **`text`**, **`number`**, **`date`**, **`set`**, **`agGroupColumnFilter`** (auto-group only).  
**Advanced Filter UI / expression builder: not present.**

### 7.2 Filter models

- Legacy: `{ type:'text'|'number', op, value, value2? }`
- v2: `CTextFilterModel`, `CNumberFilterModel`, `CDateFilterModel`, `CMultiConditionFilterModel` (`AND`/`OR`), `CSetFilterModel`
- Ops: text (`contains`…`notBlank`); number/date (`equals`…`inRange`, `blank`/`notBlank`)

### 7.3 Floating filters

| Key | Default |
|-----|---------|
| `floatingFilter` | **on** (`false` hides row) |
| `floatingFilterHeight` | 28 |
| `floatingFilterInsetY` | 4 |

Per-col override + `suppressFloatingFilterButton`.  
**Parser grammar:** CSV/OR/`||`, AND/`&&`, number `>`, `<`, `>=`, `<=`, `=`, `!=`, `N..M`, date `..` ranges.

### 7.4 Filter params (shared & typed)

- Shared: `buttons`, `closeOnApply`, `debounceMs`, `readOnly`, `maxNumConditions`, `numAlwaysVisibleConditions`, `defaultJoinOperator`
- Text: `caseSensitive`, `textFormatter` (`lowercase`/`uppercase`/`trim`), `trimInput`, `showCaseSensitiveToggle`
- Set: `values?`, `caseSensitive`, `suppressMiniFilter`, `suppressSelectAll`

### 7.5 Quick filter

| Key | Purpose |
|-----|---------|
| `quickFilterText` | Live search string |
| `cacheQuickFilter` | Token cache |
| `includeHiddenColumnsInQuickFilter` | Search hidden cols |
| `quickFilterParser?` / `quickFilterMatcher?` | Custom parse/match |
| Per-col `getQuickFilterText?` | Column contribution |

### 7.6 External / always-pass / group agg filtering

- `isExternalFilterPresent?`, `doesExternalFilterPass?`, `alwaysPassFilter?`
- `groupAggFiltering?: boolean` — filter groups on aggregates (CSRM)

### 7.7 Filter API / events

API: `setFilterModel` / `getFilterModel`, `get/setColumnFilterModel`, `destroyFilter`, `isAnyFilterPresent` / `isColumnFilterPresent`, `showColumnFilter` / `hideColumnFilter`, `onFilterChanged`, `buildColumnFilterEditor`, `getColumnFilterType`, `getDistinctValues(colId, limit?)`

Events: `filterChanged`, `filterOpened`, `filterModified`

---

## 8. Selection, ranges, fill handle

### 8.1 Legacy row selection

`rowSelection?: 'none'|'single'|'multiple'`, `suppressRowClickSelection?`, `rowMultiSelectWithClick?`, per-col checkbox headers.

### 8.2 Unified `selection` (overrides legacy)

| Mode | Keys |
|------|------|
| `singleRow` | `checkboxes?`, `headerCheckbox?`, `enableClickSelection?: boolean|'enableDeselection'` |
| `multiRow` | + `enableSelectionWithoutKeys?` |
| `cell` | `enableMultiSelectWithClick?` |

Auto-injects pinned `__cg_select__` when `checkboxes: true`.

### 8.3 Cell ranges (`cellSelection`)

`suppressHeader?` (default: no header-click column band; `false` opts in), `suppressRow?`, `suppressDrag?`

### 8.4 Group selection

`groupSelectsChildren?`, `groupSelects?: 'descendants'|'self'|'filteredDescendants'`, `checkboxLocation?: 'autoGroupColumn'|'selectionColumn'|'none'`, `selectAll?: 'all'|'filtered'|'currentPage'`

### 8.5 Fill handle

`enableFillHandle?`, `fillHandleDirection?: 'x'|'y'|'xy'`, `fillOperation?`  
Helper: `defaultFillExtrapolate`

### 8.6 Selection API / events / keys

API: `getSelectedRowIds`, `setSelectedRowIds`, `getGroupSelectionState`, `getCellRanges`, `addCellRange`, `clearCellRanges`, `getFocusedCell`, `setFocusedCell`, `getDisplayedRowCount`, `getTotalRowCount`

Events: `selectionChanged`, `rangeSelectionChanged`, `cellSelectionChanged`

Keys: Ctrl/Cmd+C/V/X, Ctrl/Cmd+A, Ctrl/Cmd+D (fill down), Delete (clear ranges)

---

## 9. Clipboard & context menus

### 9.1 Options

`clipboardDelimiter` (default `\t`), `processCellForClipboard` / `processCellFromClipboard`, `suppressContextMenu`, `suppressClipboardApi`, `suppressClipboardPaste`, `getContextMenuItems?`, `getMainMenuItems?`, `exportCallbacks?`

### 9.2 API

`copySelectedRangesToClipboard({ includeHeaders? })`, `pasteFromClipboard()`, `cutSelectedRanges()`

### 9.3 Default cell menu

Cut, Copy, Copy with Headers, Paste, Export ► (CSV / Excel), Autosize Columns, Pin Column ►

### 9.4 Default header (“main”) menu

Pin Column ►, Autosize This/All, Reset Columns, Group/Un-Group, Add/Remove Labels, Value: Aggregate ►, Expand/Collapse All Groups, Scroll to column

---

## 10. Editing — kernel + edit package

### 10.1 Kernel edit options

| Key | Purpose |
|-----|---------|
| `singleClickEdit` | Single-click enter edit |
| `suppressClickEdit` | Edit only via F2 / Enter |
| `enableExcelEditing` | Excel-style entry semantics |
| `stopEditingWhenCellsLoseFocus` | Initial |
| `enterNavigatesVertically` / `enterNavigatesVerticallyAfterEdit` | Enter moves |
| `enableCellEditingOnBackspace` | Backspace opens edit |
| `suppressStartEditOnTab` | Tab does not start edit |
| `editType?: 'fullRow'` | Full-row editing |

### 10.2 Built-in cell editors

`text`, `number`, `date`, `dateString`, `select`, `largeText`, `checkbox`, `price32`  
Exports: `Price32CellEditor`, `parsePrice32`, `formatPrice32`  
API: `startEditingCell`, `stopEditing(cancel?)`, `isCellEditable`, `registerCellEditor(name, ctor)`

Events: `cellEditingStarted/Stopped`, `rowEditingStarted/Stopped`, `rowValueChanged`, `cellValueChanged`

### 10.3 Edit package (`wireEditIntoKernel`)

Returns `EditBridgeHandle` (idempotent):

| Member | Features |
|--------|----------|
| `journal` | Undo/redo/`undoEntry`, `canUndo`/`canRedo`, `entries`/`monitorEntries`, `subscribe` |
| `smartEdit` | Ops `multiply`\|`divide`\|`add`\|`subtract`\|`set`; `collectTargets` / `preview` / `apply` |
| `bulkUpdate` | `collectTargets` / `distinctValues` / `preview` / `apply` (text/number/date; boolean excluded) |
| Settings | `getSettings` / `updateSettings` over `DEFAULT_EDIT_SETTINGS` |
| Nudges | `setNudges` — `+`/`=`/`-` on focused cell; expression gate must be `=== true` |
| Shortcuts | `setShortcuts` — `/^[a-z]$/` → numeric ops |
| Magnitude | `applyMagnitudeColDefTransforms`, `parseMagnitudeSuffix` (K/M/B) |
| Helpers | `applyNumericOp`, `makeExpressionEvaluate`, `resolveNudgeForCell`, conflict detection, `shouldRecord` |

**Defaults (highlights):** history max **50** undo; sources smart/bulk/±/shortcuts/cellEditor **on**, `stream` **off**; smart-edit all five ops, `enforceSingleColumn: true`; confirm thresholds are **caller-owned** (engine never auto-blocks).

---

## 11. Expression language (`packages/expression`)

**Pipeline:** `parse` → `compile` → `evaluate` / `validate`. CSP-safe (no `eval` / `new Function`).

### 11.1 Grammar

| Feature | Syntax |
|---------|--------|
| Field refs | `[field]`, `[trade.price]`, `[book.bids.0.px]` — null-safe path walk |
| Literals | numbers (`1e-3`), `"…"` / `'…'`, `true` / `false` / `null` |
| Unary | `!x`, `-x` |
| Arithmetic | `* / % + -` (`+` concatenates when both strings) |
| Compare | `< <= > >=` · `== !=` (strict; `null == undefined`) |
| Logical | `&&` `||` (short-circuit) — **no** infix `AND`/`OR`/`=` |
| Ternary | `test ? a : b` |
| Calls | `NAME(a, b, …)` |

### 11.2 Built-ins

| Category | Functions |
|----------|-----------|
| Control | `IF`, `COALESCE` |
| Logical | `NOT`, `AND`, `OR` |
| Numeric | `ABS`, `ROUND`, `MIN`, `MAX`, `FLOOR`, `CEIL` |
| String | `LOWER`, `UPPER`, `LEN`, `TRIM`, `TITLE`, `CAMEL`, `CAP`, `FIXED` |

### 11.3 Reserved at compile (expression package alone)

Aggregates / `PREV` / running / delta families → `CompileError` `not-yet-implemented`.  
`EvalContext` is `{ row }` only — no `.old`/`.new` here.

### 11.4 Consumer policy

| Context | Package | Aggregates / PREV | Diff fields |
|---------|---------|-------------------|-------------|
| Conditions / alerts | `rules` (`compileCondition`) | Rejected | `[col.old]` / `[col.new]` rewritten |
| Calculated columns (CSRM) | `calc` (`compileCalc`) | Enabled (scoped) | N/A; use `PREV([col])` |
| Format Tier-1 interiors | `format` | Aggregates rejected | N/A |
| Calculated columns (SSRM) | `perspective` ExprTK | Perspective grammar | N/A |

---

## 12. Calculated columns

### 12.1 CSRM — `packages/calc`

| API | Purpose |
|-----|---------|
| `wireIntoKernel(grid)` | → `{ calc }` (idempotent) |
| `CalcEngine` | Register/list/remove calc cols; overrides; templates; `resolvedPatchFor` |
| `compileCalc(source, schema?)` | → `{ ast, prePass, watchedColIds, usesPrev, cellDataType }` |
| Aggregates | `registerAggregate` / `getAggregate` / `listAggregates` |
| Worker | `evaluateCalcAst`, `INTERPRETER_SOURCE`, `buildWorkerCalcProgram` |

**DSL on top of expression:**

- Aggregates: `FN([col])` or `FN([col], '<scope>')` — scopes `'all'` \| `'visible'` \| `'group'` \| `'parent'`
- `PREV([col])` — previous tick value; unresolved → `null`
- Share macros: `PCT_OF_TOTAL` / `PCT_OF_GROUP` / `PCT_OF_PARENT` / `PCT_OF_GRAND`

**Shipped aggregates:** `SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `COUNT_DISTINCT`, `MEDIAN`, `PERCENTILE`, `STDEV`, `VAR`, `MODE`, share macros, `FIRST`, `LAST`

**Reserved (not yet):** `RANK`, `DENSE_RANK`, `PERCENT_RANK`, `RUNNING_*`, `MOVING_AVG`, `DELTA_FROM_*`, `window:` scopes

**Pipeline:** Stage A row-local → Stage B aggregate-dependent. Calc-on-calc rejected (`bad-shape`). Sort/filter/group like data cols.

**Overrides / templates:** `typeDefault(cellDataType)` → `templateIds` L→R → per-column override. Reserved id prefix `__cgridTypeDefault:`. Template helpers: `ownTemplateId`, `isOwnTemplateId`.

**Grid API (when calc wired):** `getTemplates`, `save/rename/deleteTemplate`, `apply/removeTemplate`, `editColumn`

### 12.2 SSRM — Perspective ExprTK

- `setExpressions` / `getExpressions` / `validateExpressions` on provider / `SsrmExpressionHost`
- Alias → source on `ViewConfig.expressions`
- Outputs merged via `mergeExpressionColumnDefs` / `setSsrmExpressionOutputs`
- Validated in WASM (ExprTK), **not** `velocity-grid-expression`

---

## 13. Formatting (`packages/format`)

Bridge: `wireIntoKernel` · Back-compat: function `valueFormatter` unchanged; string form needs wire.

### 13.1 Tier 0 — Excel codes

Digit placeholders `0 # ?`, `,` `.` `%`, sections `pos;neg;zero;text`, named colors `[Red]`…, conditions `[>1000]`, locale `[$-409]`, date/time tokens (`yyyy`…`AM/PM`), quoted literals, `\c` escapes.

### 13.2 Tier 1 — expression brackets + icons

| Bracket | Effect |
|---------|--------|
| `[color=<expr>]` `[bg=<expr>]` `[weight=<expr>]` `[style=<expr>]` | Per-row style |
| `[if <expr>]` | Section selector |
| `{icon:name}` / `{icon:name\|<expr>}` | Lucide icon |

Sugar: `if X then Y else Z` → ternary; bare hex → string; `rule:<id>` → rules bridge resolves.

### 13.3 Tier 2 — composite ColDef

`type: 'composite'`, `fragments[]` (`text` \| `expr`+`format`+`style`), `cellBackground`, `align`, `overflow`. Single-line, tooltip-ready, multi-format clipboard, non-editable. Helpers: `compileCompositeColDef`.

### 13.4 Templates

Auto-registered: `Number`, `Currency`, `Percent`, `Date`, `Time`, `DateTime`, `RelativeTime`, `Abbreviated`, `Custom`  
API: `registerFormatterTemplate`, `getFormatterTemplate`, `listFormatterTemplates`, `compileFormat`

Kernel slot: `registerFormatCompiler`

---

## 14. Rules & alerts (`packages/rules`)

Bridge: `wireIntoKernel` → `{ rules, alerts }` · Kernel: `registerRuleEngine`, `getRules`, `add/update/deleteRule`, `setRuleEnabled`, `reorderRules`, event `rulesChanged`

### 14.1 Style / indicator rules

| Field | Meaning |
|-------|---------|
| `condition` | Expression; `[col]`, **`[col.old]`**, **`[col.new]`** |
| `scope` | `{ kind:'cell', columnIds }` \| `{ kind:'row' }` |
| `style` | Theme-aware `{ base, light, dark }` — color, bg, weight, style, decoration, borders |
| `flash` | `{ enabled, target:'cell'\|'row', mode:'fade'\|'pulse'\|'glow', color, durationMs }` |
| `indicator` | Lucide `{ iconName, color, target:'cell'\|'row-start'\|'row-end', position }` — `before`/`after` (Prefix/Suffix) or positional `tl`/`tr`/`bl`/`br`/`ml`/`mr` |
| `valueFormatter` | Format-DSL override when matched |
| `activeDurationMs` | Auto-expire after false→true |

Match: strict `=== true`. Aggregates/`PREV` in conditions → `not-yet-implemented`.  
Canonical tick-up: `[price.old] != null && [price] > [price.old]`.

Also: `compileCondition`, `validateRule`

### 14.2 Alerts engine

| Trigger | Shape |
|---------|-------|
| `dataChange` | `{ expression, columnIds? }` |
| `relativeChange` | `{ colId, mode: PERCENT_CHANGE\|ABSOLUTE_CHANGE\|ANY_CHANGE, threshold, direction }` |
| `rowChange` | `{ mode: ROW_ADDED\|ROW_REMOVED }` |

Severities: `info`\|`success`\|`warning`\|`critical`  
Channels requested: `toast`\|`badge`\|`openfin` (routing host-owned)  
Message tokens: `{rule}` `{rowId}` `{column}` `{value}` `{prev}` via `renderMessage`  
Modes: `realtime` / `throttled` / `paused`; history ring + `unreadCount` / `markAllRead`  
`DEFAULT_ALERTS_SETTINGS`

### 14.3 Kernel cell flash options

`enableCellChangeFlash`, `cellFlashDuration` (500), `cellFadeDuration` (1000), API `flashCells`

---

## 15. Renderers (`packages/renderers`)

Bridge: `wireRenderersIntoKernel` · Kernel also has built-ins (below).

### 15.1 Kernel built-in renderers

`text`, `number`, `checkbox`, `header`, `text-wrap`, `totals`, `group`, `groupFooter`, `sparkline` (`line`/`column`/`area`/`bar`/`pie`), `rowSelectCheckbox`, `composite`

API: `registerCellRenderer`, `listCellRenderers`

### 15.2 Renderers package catalog (`RENDERER_NAMES` — 51)

| Category | Names |
|----------|-------|
| Numeric | `number`, `price`, `price-direction`, `pnl`, `delta`, `bps`, `pct-change`, `fractional-price`, `abbreviated-number` |
| Text | `ticker`, `currency-pair`, `timestamp`, `age`, `relative-time` |
| Indicators | `status-dot`, `quote-quality-dot`, `stale-flag`, `direction-arrow`, `structure-icon-strip`, `traffic-light` |
| Badges | `status-pill`, `rating-badge`, `rating-cluster`, `tag`, `venue-chip`, `side-chip`, `tif-pill` |
| Bars | `progress-bar`, `range-bar`, `bidirectional-bar`, `heat`, `gauge`, `spread-bar`, `volume-bar`, `maturity-ladder` |
| Charts | `win-loss-sparkline`, `yield-curve-sparkline`, `krd-bar-chart`, `depth-ladder` (+ kernel sparklines) |
| Composite | `stacked-value`, `price-quote`, `nbbo`, `benchmark-spread`, `price-change-composite` |
| Actions | `icon-action-cluster`, `row-menu` |

**ColDef builders:** `colDef.renderer`, `.price`, `.heat`, `.age`, `.relativeTime`, `.priceQuote`, `.iconActionCluster`, `.rowMenu`  
**Helpers:** `ColumnStats`, `TickHistory`, `HitRegionRegistry` / `resolveHitRegion`, palettes (`SEMANTIC_COLORS`, …)

### 15.3 Icons & tooltips (kernel)

`registerIcon` / `registerIcons` / `hasIcon` / `registerIconSet` / `resolveIcon` / `listIcons`  
`registerTooltipProvider` / `unregisterTooltipProvider`

---

## 16. Aggregation, grouping, pivot

### 16.1 Aggregation

Built-in `aggFunc`: `sum|avg|min|max|count|first|last`  
Custom: `aggFuncs` registry (pure, serializable)  
`suppressAggFuncInHeader`  
Event: `aggregationChanged` (`source`: rowDataChanged|aggFuncChanged|filterChanged|columnAggFuncChanged|api)

### 16.2 Grouping display

| Key | Values / notes |
|-----|----------------|
| `groupDisplayType` | `singleColumn` (default) \| `multipleColumns` \| `groupRows` \| `custom` |
| `groupRowRenderer` / `groupRowRendererParams` | `innerRenderer?`, `suppressCount?` |
| `rowGroupPanelShow` | `never` (default) \| `always` \| `onlyWhenGrouping` |
| `rowGroupPanelSuppressSort` | — |
| `suppressDragLeaveHidesColumns` | — |
| `allowDragFromColumnsToolPanel` | default true |
| Expansion | `groupDefaultExpanded` (`'all'\|number\|-1`), `groupDefaultExpandedKeys`, `isGroupOpenByDefault` |
| Single-child | `groupRemoveSingleChildren`, `groupHideParentOfSingleChild` (`true|'leafGroupsOnly'`) |
| Misc | `suppressDoubleClickExpand`, `showOpenedGroup`, `groupHideOpenParents`, `suppressCount`, `suppressGroupChangesColumnVisibility` |

Sticky group headers auto-disabled with `groupHideOpenParents`.

### 16.3 Grouping API / events

API: `setGroupModel`, `setRowGroupColumns`, `add|remove|moveRowGroupColumn(s)`, `setRowGroupColumnSort`, `getRowGroupColumns`, `expandAll`, `collapseAll`, `setExpanded`, `getExpandedKeys`, `resetRowGroupExpansion`, panel drag helpers, `resolveDragTargetRole`, `commitPanelMove`

Events: `rowGroupOpened`, `expandOrCollapseAll`, `columnRowGroupChanged`

### 16.4 Pivot

| Key | Notes |
|-----|-------|
| `pivotMode` | On/off |
| `pivotPanelShow` | never / when pivoting / always |
| `pivotDefaultExpanded` | Depth |
| `pivotMaxGeneratedColumns` | default **5000** |
| `enableStrictPivotColumnOrder` | Re-sort keys every update |
| `pivotRowTotals` / `pivotColumnGroupTotals` | `'before'|'after'|null` |
| `pivotGrandTotals` | Excel-style sticky grand total row + sticky total column (**cgrid superpower**) |
| `processPivotResultColDef` / `processPivotResultColGroupDef` | Post-process generated cols |

API: `isPivotMode`, `setPivotMode(mode, { discardSettings? })`, get/set/add/remove/move pivot & value columns, `setValueColumnAggFunc`, panel drag helpers  
Events: `pivotStateChanged`, `pivotMaxColumnsReached`

**Note:** `packages/excel-pivot` is a **scaffold** for a future Excel-native engine; kernel AG-style pivot is what ships today.

### 16.5 Master / detail

A master row expands into an embedded detail grid — a full VelocityGrid with its own columns, sort, filter, selection and scrollbars, mounted as DOM over the master's canvas.

A detail row is **display-only**: it occupies a slot in the displayed order directly beneath its master and never reaches the worker. Expanding therefore costs no refilter, regroup or resort — see `core/masterDetailIndex.ts` for the display↔base index arithmetic and `core/masterDetail.ts` for the band lifecycle.

| Key | Notes |
|-----|-------|
| `masterDetail` | Master switch. Put `cellRenderer: 'group'` on the column that should carry the caret (the analogue of AG's `agGroupCellRenderer`) |
| `isRowMaster` | `(data) => boolean` — `false` means no caret and no detail row |
| `detailRowHeight` | Fixed band height. Default **300** |
| `detailRowAutoHeight` | Size each band to its own content. Floors the detail grid's ROWS section at 150px, as AG does |
| `keepDetailRows` / `keepDetailRowsCount` | Retain a collapsed/scrolled-away detail grid (scroll, sort, filter, selection survive). Default cap **10**, least-recently-shown evicted first |
| `detailCellRendererParams` | `{ detailGridOptions, getDetailRowData, refreshStrategy, template }`. May be a function evaluated per master row |
| `detailCellRenderer` | `(params) => HTMLElement \| string` — replaces the embedded grid with app-owned DOM |
| `isMasterOpenByDefault` | Open a row's detail as its data arrives. Params `{ rowNode, data, level }` |
| `getRowHeight` | Also called for detail bands, with `params.node.detail === true` and the MASTER's data. Consulted **before** `detailRowHeight` / `detailRowAutoHeight`, matching AG's precedence |

`template` marks the grid's mount point with `data-ref="eDetailGrid"` (AG's current attribute); the legacy `ref="eDetailGrid"` is accepted too.

API: `setDetailExpanded(rowId, expanded)`, `isDetailExpanded`, `getExpandedDetailRowIds`, `collapseAllDetailRows`, `getDetailGridInfo('detail_{ROW-ID}')`, `forEachDetailGridInfo`, `addDetailGridInfo`, `removeDetailGridInfo`

Event: `rowGroupOpened` — AG uses one event for a master row and a row group; the master-row form carries `rowId` and `data`.

#### Parity with AG Grid 36.1.0

Verified against the installed `ag-grid-community` / `ag-grid-enterprise` type definitions and bundles, not just the docs. Every documented option, callback param shape, API method and default matches, with these deliberate deltas:

| Delta | Why |
|-------|-----|
| Runtime-mutable where AG marks `@initial` (`detailRowHeight`, `detailRowAutoHeight`, `keepDetailRows*`) | The controller reads every option lazily, so a flip costs a reflow and nothing more. A superset — code written against AG's stricter rule still works |
| `detailCellRenderer` is `(params) => HTMLElement \| string` | No framework component registry to name one in |
| `detailRowAutoHeight` keeps the detail grid virtualised | AG's auto height "renders all of its rows all the time" and warns off 100+ rows. Ours computes the height from row count × row height instead, so the detail grid keeps its virtualisation |
| `getRowId` synthesised for a detail grid that omits one | The kernel requires one; AG's detail grids do not. Keyed on object identity, so `refreshStrategy: 'rows'` preserves detail selection without the app supplying anything |
| No `embedFullWidthRows` | A band always spans the body width and never scrolls horizontally with the columns |

Not implemented:

| Gap | Notes |
|-----|-------|
| Master rows under **SSRM** | Band positions resolve through the CSRM visible order |
| Master/detail + **tree data** | AG lets a tree GROUP node also be a master. Here only leaf rows (`rowKind 0`) can be masters — which does match AG under row grouping, where only leaves may be masters |
| `rowSelection.masterSelects: 'detail'` | Selecting a master row acting as the detail grid's header checkbox |

Demo: `apps/velocitygrid-master-detail-demo` (`npm run dev:master-detail`, port 5240). E2E: `e2e/master-detail.spec.ts`.

---

## 17. Side bar, tool panels, status bar, overlays

### 17.1 Side bar

Shapes: `SideBarDef` | `true` | shortcut string(s) | `false`  
`SideBarDef`: `toolPanels`, `defaultToolPanel?`, `hiddenByDefault?`, `position?`, `hideButtons?`  
Built-ins: `agColumnsToolPanel`, `agFiltersToolPanel`; also exportable `GridOptionsToolPanel`, `ColumnGroupsToolPanel`

Columns panel params: suppress move/rowGroups/values/pivots/pivotMode/columnFilter/selectAll/expandAll, `contractColumnSelection`, `suppressSyncLayoutWithGrid`, `buttons?: ('apply'|'cancel')[]`  
Filters panel params: `suppressExpandAll|FilterSearch|SyncLayoutWithGrid`

API: `isSideBarVisible`, `setSideBarVisible`, `setSideBarPosition`, `openToolPanel`, `closeToolPanel`, `getOpenedToolPanel`, `getSideBar`, `refreshToolPanel`, `getToolPanelInstance`  
Floating: `openFloatingPanel`, `closeFloatingPanel`, `isFloatingPanelOpen`, `setFloatingPanelTitle`, `fitFloatingPanelHeight`  
Events: `toolPanelVisibleChanged`, `sideBarVisibleChanged`  
Hosts: `ModalHost`, `FloatingPanelHost`

### 17.2 Status bar

Intrinsic **on**; `statusBar: false` opts out.  
Built-ins: `agTotalRowCountComponent`, `agFilteredRowCountComponent`, `agSelectedRowCountComponent`, `agTotalAndFilteredRowCountComponent`, `agAggregationComponent`  
`StatusBarDef`: `statusPanels[]`, `position?: 'top'|'bottom'`, `hiddenByDefault?`  
API: `getStatusPanel(key)`

### 17.3 Loading overlays

`loading`, `loadingMessage` (“Loading…”), `setLoadingProgress(loaded, total?)`, `aria-busy` via a11y overlay

### 17.4 Components registry

`components?: Record<string, ToolPanelComponent | StatusPanelComponent>`

### 17.5 Customizer package

Lit panels for edit settings: `smartEditToolPanel`, `bulkUpdateToolPanel`, chrome (`CgcBand`, `CgcField`, `CgcSwitch`, …), `CgcExpressionEditor` with live `expression.validate`. Distinct from Ext shell.

---

## 18. Theming, density, appearance

| Key | Values |
|-----|--------|
| `theme` | CSS class (e.g. `'vg-theme-quartz'`) or `CgTheme` |
| Theme factories | `createTheme`, `themeQuartz`, `themeStarui`, `baseTheme` |
| `density` | `'compact'\|'normal'\|'comfortable'` |
| `animateRows` | boolean |
| `suppressRowHoverHighlight` | boolean |
| `domLayout` | `'normal'\|'print'` (print forces full materialisation) |

API: `setTheme`, `setThemeMode`, `setThemeParams`, `getThemeParams`, `getThemeKind`, `getDefaultRowHeight` / `getDefaultHeaderHeight`

Colour tokens (Grid Options Colours band): `--vg-row-hover-bg`, `--vg-row-selected-bg`, `--vg-range-fill-color`, `--vg-range-border-color`, `--vg-flash-from-color`

---

## 19. Virtualisation & paint performance

| Key | Default / notes |
|-----|-----------------|
| `suppressColumnVirtualisation` | false |
| `suppressRowVirtualisation` | false |
| `suppressPartialRepaint` | false |
| `rowBuffer` | Engine overscan (~3); apps often raise |
| `paintMode` | `'auto'\|'main'\|'offscreen'` |
| `qualityMode` | `'auto'\|'quality'\|'performance'` |
| `paintCache` | Retained layer (default on HW GL) |
| `paintCacheOverscan` | default **1** screen, clamp `[0,2]` |
| `rasterCache` | Tier-1 cell bitmaps + Tier-2 row strips |
| `rasterCacheBudgetMB` | default **48** |
| `memoryBudgetMB` | Viewport chunk LRU soft cap; `0`/omit disables |

API: `getPaintStats`, `resetPaintStats`, `refresh`, `destroy`  
`PaintStats`: paints/full/partial/blits, layer presents/shifts/resets, raster hit/miss/bypass, strip metrics, budgets.

---

## 20. Events (complete union)

| Category | Events |
|----------|--------|
| Lifecycle | `gridReady`, `firstDataRendered`, `gridPreDestroyed`, `gridSizeChanged` |
| Pointer | `cellClicked`, `cellDoubleClicked`, `cellMouseOver/Out`, `rowMouseOver/Out` |
| Focus/keys | `cellFocused`, `cellKeyDown`, `cellKeyPress` |
| Data | `cellValueChanged`, `rowsChanged`, `modelUpdated`, `viewportChanged`, `bodyScroll`, `bodyScrollEnd` |
| Models | `sortChanged`, `filterChanged`, `filterOpened`, `filterModified` |
| Columns | `columnResized`, `columnVisible`, `columnPinned`, `columnMoved`, `columnsReset`, `columnDefsChanged`, `displayedColumnsChanged`, `virtualColumnsChanged`, `columnGroupOpened` |
| Agg/group/pivot | `aggregationChanged`, `rowGroupOpened`, `expandOrCollapseAll`, `columnRowGroupChanged`, `pivotStateChanged`, `pivotMaxColumnsReached` |
| Selection | `selectionChanged`, `rangeSelectionChanged`, `cellSelectionChanged` |
| Chrome | `toolPanelVisibleChanged`, `sideBarVisibleChanged` |
| State/layouts | `stateUpdated`, `moduleStateChanged`, `layoutChanged`, `templatesChanged`, `rulesChanged` |
| Edit | `cellEditingStarted/Stopped`, `rowEditingStarted/Stopped`, `rowValueChanged` |
| Async | `asyncTransactionsFlushed` |

Subscribe: `on` / `off` / `addEventListener` / `removeEventListener`

---

## 21. Persistence, layouts, modules, config

### 21.1 `GridState` (schema v4)

`version`, `columnState`, `modules` (envelopes; column groups live here), deprecated `columnGroupDefs`/`columnGroupOpen`, `filterModel`, `sortModel`, `rowGroupColumns`, `expandedRouteIds`, `pivotMode`, `pivotCols`, `sideBar`, `gridOptions`, `themeParams`, `cellSelection`, `rowSelection`, `scroll`, `toolPanelPopoutRect`

### 21.2 State / layout API

- `getState` / `setState(snapshot, { exhaustive? })`
- `getConfig` / `setConfig`
- `registerStateModule` / `moduleStateChanged`
- Layouts: `getLayouts`, `getActiveLayoutId/Layout`, `save/update/load/delete/rename/duplicate/resetLayout`, `get/setGridConfig`, `export/importLayout(s)`
- Constants: `DEFAULT_LAYOUT_ID`, `DEFAULT_GRID_LEVEL_MODULES`, `LAYOUTS_BUNDLE_VERSION`

### 21.3 Engine registration slots

`registerFormatCompiler`, `registerRuleEngine`, `registerCalcProvider`

### 21.4 Runtime-mutable option keys

See `RuntimeOption` / Grid Options panel schema: theme, density, heights, defaultColDef, animate/hover, selection, virtualisation, flash, async txn knobs, rowBuffer, context, loading, debug, rowData, quick filter keys, fill/clipboard/context menu, pinned rows, aggFuncs, group/pivot panel options, statusBar, floatingFilter, edit triggers, paint/raster caches, etc. (full list in `packages/kernel/src/core/runtimeOptions.ts` + `optionSchema.ts`).

---

## 22. Keyboard navigation & accessibility

### 22.1 Keys

Arrows (focus + ranges), PageUp/PageDown, Home/End, F2 edit, Escape cancel, Enter commit (± vertical), Tab cycle editable, type-to-edit, Backspace edit when enabled, Excel mode enter vs edit arrow semantics, group chevron / double-click expand (unless suppressed).

### 22.2 A11y overlay

Hidden `role="grid"` with `aria-rowcount`, `aria-colcount`, `aria-label`, `aria-busy`; focused `role="row"` + cells; `aria-expanded` on groups; `role="status"` live region (`announce`, debounced); Tab-out hooks.

---

## 23. Export

### 23.1 Kernel (ships today)

Methods on `VelocityGrid`: `getDataAsCsv` / `exportDataAsCsv`, `getDataAsExcel` / `exportDataAsExcel`

**CSV params:** `fileName`, `columnSeparator`, `columnKeys`, `skipColumnHeaders`, `suppressQuotes`, `withBOM`, `prependContent`, `appendContent`, process callbacks by name into `exportCallbacks`, `onlySelected`

**Excel params:** `fileName`, `sheetName`, `columnKeys`, `skipColumnHeaders`, `freezeRows`/`freezeColumns`, `author`, process callbacks, `onlySelected`

Context menu Export submenu routes here.

### 23.2 `packages/export`

**Empty scaffold.** Planned: visual formatting export threading rule colors + resolved formatters.

---

## 24. AppData (`packages/appdata`)

| API | Purpose |
|-----|---------|
| `AppDataStore` | In-memory named bags: get/set/delete/snapshot/subscribe/clear |
| `LocalStorageAppDataStore` | Persist with `APPDATA_STORAGE_PREFIX` |
| `resolveTemplate` / `resolveCfg` | Substitute `{{name.key}}` / nested paths; deep-walk immutable |
| `collectTemplateRefs` | Unique refs for re-resolve |
| `findUnresolvedAppDataTokens` / `assertAppDataResolved` | Fail-closed gates |
| `toAppDataLookup` / `isAppDataStore` | Normalize |

Used by data + perspective for templated URLs/topics/`clientId`. Does **not** own row data or catalogs.

---

## 25. Row / scroll / option APIs (additional)

- Rows: `forEachRow`, `getRowsByIndex`, `ensureRowVisible`, `ensureIndexVisible`
- Columns: `ensureColumnVisible`
- Options: `getGridOption`, `setGridOption`, `updateGridOptions`
- Misc: `getModal`, `refresh`, `destroy`

---

## 26. Explicitly absent or scaffold-only

| Feature | Status |
|---------|--------|
| Infinite scrolling row model | Absent |
| Tree data path model | Absent (grouping only) |
| Master/detail row expansion | **Ships** — see §16.5. Master rows under SSRM are not supported yet |
| Advanced Filter builder | Absent |
| Charts (as a product area) | Absent (sparklines/renderers only) |
| Full pagination row model | Absent |
| `packages/export` visual export | Scaffold |
| `packages/excel-pivot` Excel-native pivot | Scaffold (kernel pivot ships) |
| Expression aggregates outside calc | Compile-rejected |
| Calc `RANK` / `RUNNING_*` / `window:` | Reserved, not shipped |

---

## 27. Cross-links

| Concern | Doc / package |
|---------|----------------|
| Title bar / ribbons / Customize UI | [velocity-grid-ext-feature-reference.md](./velocity-grid-ext-feature-reference.md) |
| DataProvider popout every field | [data-provider-editor-feature-reference.md](./data-provider-editor-feature-reference.md) |
| CSRM hub / transports | `packages/data` |
| SSRM Perspective / ExprTK | `packages/perspective` |
| Expression DSL | `packages/expression` |
| CSRM calc columns | `packages/calc` |
| Format DSL | `packages/format` |
| Rules / alerts | `packages/rules` |
| Edit journal / smart ops | `packages/edit` |
| Cell painters | `packages/renderers` |

---

## 28. Quickstart (kernel)

```typescript
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';

const grid = new VelocityGrid<{ id: string; name: string; value: number }>(
  document.getElementById('grid')!,
  {
    columnDefs: [
      { field: 'id', headerName: 'ID', pinned: 'left', width: 100 },
      { field: 'name', headerName: 'Name', flex: 1 },
      { field: 'value', headerName: 'Value', cellDataType: 'number', width: 120, aggFunc: 'sum' },
    ],
    getRowId: (row) => row.id,
    rowSelection: 'multiple',
    totalsRowPosition: 'bottom',
    theme: 'vg-theme-quartz',
  },
);

grid.on('gridReady', () => {
  grid.setRowData([{ id: 'a', name: 'Apple', value: 12.5 }]);
});
```

Typical Markets stack also wires: `wireIntoKernel` (calc/format/rules), `wireEditIntoKernel`, `wireRenderersIntoKernel`, data hub or Perspective SSRM, and `VelocityGridExt` chrome.

---

*Generated from `packages/kernel` + companion package sources on `main`. Prefer source if APIs or strings drift.*
