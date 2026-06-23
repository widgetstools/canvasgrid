# 02 — Column Model

## Concept

The column model is built from three definition types:

- **`ColDef<TData, TValue>`** — leaf column definition; the primary configuration unit.
- **`ColGroupDef<TData>`** — column group with `children`; can nest arbitrarily.
- **`defaultColDef`** — fallback applied to every leaf column; column-level properties take precedence.

Column identity is determined by `colId` (explicit) or falls back to `field`. The grid builds an internal
`Column` and `ColumnGroup` tree from these definitions. Mutations go through `api.applyColumnState()` (for
per-column mutable state) or via `api.updateGridOptions({ columnDefs: [...] })` (to replace the full
definition set while preserving identity where IDs match).

Pinning at the column level is covered here; pinned-region layout concerns (frozen panes, sync scrolling)
are in `16-pinning-and-layout.md`.

## Configuration surface

### ColDef — identity & data access

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `colId` | `string` | field value | Community | Unique column identifier. Overrides field-derived ID. |
| `field` | `ColDefField<TData, TValue>` | `undefined` | Community | Dot-notation path into row data object. |
| `headerName` | `string` | field name | Community | Text shown in the column header. |
| `headerValueGetter` | `string \| HeaderValueGetterFunc` | `undefined` | Community | Function/expression override for header text. |
| `valueGetter` | `string \| ValueGetterFunc<TData, TValue>` | `undefined` | Community | Function/expression to derive the cell value from row data. |
| `valueFormatter` | `string \| ValueFormatterFunc<TData, TValue>` | `undefined` | Community | Formats the cell value to a display string. |
| `valueSetter` | `string \| ValueSetterFunc<TData, TValue>` | `undefined` | Community | Writes an edited value back to row data. |
| `valueParser` | `string \| ValueParserFunc<TData, TValue>` | `undefined` | Community | Parses a string edit value before passing to `valueSetter`. |
| `refData` | `RefData` | `undefined` | Community | Key→display map; used instead of `valueFormatter` for simple lookups. |
| `type` | `string \| string[]` | `undefined` | Community | Named column type(s) from `gridOptions.columnTypes`. |
| `cellDataType` | `boolean \| string` | `true` | Community | Infers or declares data type for built-in formatting and filtering. |

### ColDef — display & styling

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `headerClass` | `HeaderClass<TData, TValue>` | `undefined` | Community | CSS class(es) applied to the header cell. |
| `headerStyle` | `HeaderStyle \| HeaderStyleFunc` | `undefined` | Community | Inline style object applied to the header cell. |
| `cellClass` | `string \| string[] \| CellClassFunc<TData, TValue>` | `undefined` | Community | CSS class(es) applied to body cells. |
| `cellClassRules` | `CellClassRules<TData, TValue>` | `undefined` | Community | Map of CSS class → predicate; class added when predicate is true. |
| `cellStyle` | `CellStyle \| CellStyleFunc<TData, TValue>` | `undefined` | Community | Inline style object applied to body cells. |
| `tooltipField` | `ColDefField<TData>` | `undefined` | Community | Data field whose value is shown as a cell tooltip. |
| `tooltipValueGetter` | `TooltipValueGetterFunc<TData, TValue>` | `undefined` | Community | Callback returning the tooltip string; takes precedence over `tooltipField`. |

### ColDef — rendering

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `cellRenderer` | `any` | `undefined` | Community | Custom cell renderer component or function. |
| `cellRendererParams` | `any` | `undefined` | Community | Params passed to `cellRenderer`. |
| `cellRendererSelector` | `CellRendererSelectorFunc<TData, TValue>` | `undefined` | Community | Callback returning renderer + params per row. |
| `enableCellChangeFlash` | `boolean` | `false` | Community | Flash the cell when its value changes. |
| `autoHeight` | `boolean` | `false` | Community | Row height expands to fit cell content in this column. |
| `wrapText` | `boolean` | `false` | Community | Enables text wrap inside the cell; typically used with `autoHeight`. |

### ColDef — sizing

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `width` | `number` | `200` (if no flex) | Community | Column width in pixels. |
| `initialWidth` | `number` | `undefined` | Community | Width applied only on first column creation; ignored on updates. |
| `minWidth` | `number` | `undefined` | Community | Minimum column width in pixels. |
| `maxWidth` | `number` | `undefined` | Community | Maximum column width in pixels. |
| `flex` | `number \| null` | `undefined` | Community | Proportional flex sizing; overrides explicit `width`. |
| `resizable` | `boolean` | `undefined` | Community | User can resize the column by dragging its header edge. |
| `suppressSizeToFit` | `boolean` | `false` | Community | Column is excluded from `sizeColumnsToFit()`. |
| `suppressAutoSize` | `boolean` | `false` | Community | Column excluded from auto-size-to-content operations. |

### ColDef — visibility & locking

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `hide` | `boolean \| null` | `false` | Community | Column is hidden. |
| `initialHide` | `boolean` | `undefined` | Community | Hidden on first creation only. |
| `lockVisible` | `boolean` | `false` | Community | User cannot toggle visibility via UI. |
| `lockPosition` | `boolean \| 'left' \| 'right'` | `undefined` | Community | Locks column to a position; prevents user reordering. |
| `suppressMovable` | `boolean` | `false` | Community | User cannot move the column by dragging. |
| `pinned` | `boolean \| 'left' \| 'right' \| null` | `undefined` | Community | Pins column to left or right frozen pane. See `16-pinning-and-layout.md`. |
| `initialPinned` | `boolean \| 'left' \| 'right'` | `undefined` | Community | Pinned on first creation only. |
| `lockPinned` | `boolean` | `false` | Community | User cannot change pinned state via UI. |

### ColDef — suppress* properties

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `suppressNavigable` | `boolean \| SuppressNavigableCallback` | `false` | Community | Cell not reachable via keyboard tab navigation. |
| `suppressKeyboardEvent` | `SuppressKeyboardEventFunc` | `undefined` | Community | Prevents specific keyboard events from being handled by the grid. |
| `suppressPaste` | `boolean \| SuppressPasteCallback` | `undefined` | Community | Disables paste into cells of this column. |
| `suppressFillHandle` | `boolean` | `undefined` | Community | Hides the fill handle in cells of this column. |
| `suppressHeaderMenuButton` | `boolean` | `false` | Community | Hides the column menu button in the header. |
| `suppressHeaderFilterButton` | `boolean` | `false` | Community | Hides the filter button in the header. |
| `suppressColumnsToolPanel` | `boolean` | `false` | Enterprise | Column excluded from the Columns Tool Panel. |
| `suppressFiltersToolPanel` | `boolean` | `false` | Enterprise | Column filter excluded from the Filters Tool Panel. |

### ColGroupDef — group-specific

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `children` | `(ColDef \| ColGroupDef)[]` | required | Community | Child columns or nested groups. |
| `groupId` | `string` | auto | Community | Unique group identifier. |
| `openByDefault` | `boolean` | `false` | Community | Group is expanded on load. |
| `marryChildren` | `boolean` | `false` | Community | Prevents columns in this group from being moved outside it. |
| `suppressStickyLabel` | `boolean` | `false` | Community | Group label scrolls with the grid instead of sticking. |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `getColumnDefs` | `() => (ColDef \| ColGroupDef)[] \| undefined` | Community | Returns current column definitions. |
| `getColumnDef` | `(key: string \| Column) => ColDef \| null` | Community | Returns the ColDef for a given column key. |
| `getColumn` | `(key: ColKey) => Column \| null` | Community | Returns the Column object for a given key. |
| `getColumns` | `() => Column[] \| null` | Community | Returns all columns regardless of visibility. |
| `getAllGridColumns` | `() => Column[]` | Community | Returns all columns in display order (post-pivot). |
| `getAllDisplayedColumns` | `() => Column[]` | Community | Returns visible columns across left, center, and right panes. |
| `getAllDisplayedVirtualColumns` | `() => Column[]` | Community | Visible columns currently rendered (column virtualisation respects this). |
| `getDisplayedLeftColumns` | `() => Column[]` | Community | Visible columns in the left pinned pane. |
| `getDisplayedCenterColumns` | `() => Column[]` | Community | Visible columns in the center (scrollable) pane. |
| `getDisplayedRightColumns` | `() => Column[]` | Community | Visible columns in the right pinned pane. |
| `getColumnState` | `() => ColumnState[]` | Community | Returns serialisable snapshot of all column state (width, sort, pinned, etc.). |
| `applyColumnState` | `(params: ApplyColumnStateParams) => boolean` | Community | Restores column state from a saved snapshot. Returns `false` if any column not found. |
| `resetColumnState` | `() => void` | Community | Resets all column state to match current column definitions. |
| `setColumnsVisible` | `(keys: (string \| Column)[], visible: boolean) => void` | Community | Shows or hides the specified columns. |
| `setColumnsPinned` | `(keys: ColKey[], pinned: ColumnPinnedType) => void` | Community | Sets pinned state for the specified columns. |
| `setColumnWidths` | `(columnWidths: {key: ColKey, newWidth: number}[], finished?: boolean) => void` | Community | Sets explicit pixel widths for the specified columns. |
| `moveColumns` | `(columnsToMoveKeys: ColKey[], toIndex: number) => void` | Community | Moves columns to a target index. |
| `moveColumnByIndex` | `(fromIndex: number, toIndex: number) => void` | Community | Moves a column from one index to another. |
| `sizeColumnsToFit` | `(paramsOrGridWidth?: ISizeColumnsToFitParams \| number) => void` | Community | Fits all non-suppressed columns to the available grid width. |
| `autoSizeColumns` | `(keys: ColKey[], skipHeader?: boolean) => void` | Community | Auto-sizes specified columns to their cell contents. |
| `autoSizeAllColumns` | `(skipHeader?: boolean) => void` | Community | Auto-sizes all displayed columns to their cell contents. |
| `getDisplayNameForColumn` | `(column: Column, location: HeaderLocation) => string` | Community | Returns the display header name, respecting `headerValueGetter`. |
| `isPinning` | `() => boolean` | Community | Returns `true` if any column is pinned. |
| `isPinningLeft` | `() => boolean` | Community | Returns `true` if any column is pinned left. |
| `isPinningRight` | `() => boolean` | Community | Returns `true` if any column is pinned right. |
| `getColumnGroupState` | `() => {groupId, open}[]` | Community | Returns open/closed state of all column groups. |
| `setColumnGroupState` | `(stateItems: {groupId, open}[]) => void` | Community | Sets open/closed state of column groups. |
| `resetColumnGroupState` | `() => void` | Community | Resets column group open/closed state to definition defaults. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `columnEverythingChanged` | `{ source: string }` | Community | Any column state change (broad; prefer specific events). Deprecated v32.2. |
| `newColumnsLoaded` | `{ source: ColumnEventType }` | Community | Column definitions are replaced or initially provided. |
| `gridColumnsChanged` | `{}` | Community | The internal column list changes (including after pivoting). |
| `displayedColumnsChanged` | `{ source: ColumnEventType }` | Community | The set of displayed columns changes (hide, pin, resize, etc.). |
| `virtualColumnsChanged` | `{ afterScroll: boolean }` | Community | The set of virtually rendered columns changes (column virtualisation). |
| `columnVisible` | `ColumnVisibleEvent { visible, columns }` | Community | Column(s) shown or hidden. |
| `columnPinned` | `ColumnPinnedEvent { pinned, columns }` | Community | Column(s) pinned or unpinned. |
| `columnResized` | `ColumnResizedEvent { finished, columns, flexColumns }` | Community | Column width changed; `finished: true` on mouse-up. |
| `columnMoved` | `ColumnMovedEvent { toIndex, columns }` | Community | Column(s) reordered. |
| `columnGroupOpened` | `ColumnGroupOpenedEvent { columnGroup }` | Community | Column group expanded or collapsed. |
| `columnsReset` | `ColumnsResetEvent` | Community | Column state reset to definition defaults. |

## Behaviors / interactions

**Flex sizing:** When `flex` is set, the column ignores its `width` and instead receives a share of the
remaining free space in the grid (after fixed-width columns are accounted for). Setting `minWidth` or
`maxWidth` constrains the flex result. Calling `sizeColumnsToFit()` on a grid that has flex columns
delegates to the flex algorithm rather than the standard proportional fit.

**`sizeColumnsToFit` vs `autoSizeColumns`:** `sizeColumnsToFit` distributes the grid container width
proportionally among non-suppressed columns. `autoSizeColumns` measures cell and (optionally) header
content to find the minimum required width. Both respect `minWidth`/`maxWidth`.

**`valueGetter` vs `cellRenderer` separation:** `valueGetter` computes the raw cell value; it is used for
sorting, filtering, and export. `valueFormatter` converts the raw value to a display string. `cellRenderer`
then receives both `value` (raw) and `valueFormatted` and is responsible for DOM output only. This three-
layer separation is important: changing display logic via `cellRenderer` does not affect sort/filter.

**Column state round-trip:** `getColumnState()` returns a serialisable array that can be persisted (e.g.
to `localStorage`) and restored via `applyColumnState()`. The state includes `colId`, `hide`, `pinned`,
`width`, `flex`, `sort`, `sortIndex`, `aggFunc`, `rowGroup`, `rowGroupIndex`, `pivot`, `pivotIndex`.

**`defaultColDef` merging:** Values in `defaultColDef` are merged at the property level with column-specific
definitions. Column-level values always win. Changing `defaultColDef` at runtime triggers a column refresh.

**Column group open/close:** Groups with `columnGroupShow: 'open'` children are only visible when the
group is expanded. The grid animates the width change when a group opens or closes.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- The three-layer pipeline (`valueGetter` → `valueFormatter` → `cellRenderer`) must be faithfully replicated.
  Sorting and filtering consume only the `valueGetter` output; the canvas renderer receives `value` and
  `valueFormatted` and draws the cell.
- `flex` sizing is a layout algorithm: the canvas engine must implement it identically to avoid surprises
  when porting column definitions from the DOM grid.
- `cellClassRules` map to style predicates that the canvas engine evaluates per-cell during the render pass.
  The canvas equivalent is per-cell style functions returning fill/stroke/font overrides.
- `suppressSizeToFit` and `suppressAutoSize` need canvas equivalents so column fitting operations respect
  fixed-width columns in the layout.
- Column state serialisation (`getColumnState`/`applyColumnState`) is a public contract that consumers rely
  on for persistence. The canvas port must implement the same schema.
- Q: How will the canvas port surface `cellClass`/`cellClassRules` — as CSS applied to an overlay DOM layer,
  or as a style descriptor consumed by the 2D drawing code?
- Q: Does the canvas port need to support arbitrary `cellRenderer` JSX/HTML, or only a defined set of
  typed renderers (text, number, sparkline, etc.)? This is the most impactful portability question.
- Cross-reference: column pinning visual regions are detailed in `16-pinning-and-layout.md`.
