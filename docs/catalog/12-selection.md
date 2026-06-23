# 12 — Selection

## Concept

AG Grid provides two distinct selection subsystems that can coexist:

1. **Row selection** — selecting entire rows. Controlled via `rowSelection` (`RowSelectionOptions`). Supports single and multi-row modes, checkbox rendering, and group-selection cascading. Module: `RowSelectionModule` (Community).
2. **Cell selection** (formerly "range selection") — selecting rectangular ranges of cells across rows and columns. Controlled via `cellSelection` (`CellSelectionOptions`). Includes fill-handle and range-handle sub-features. Module: `CellSelectionModule` (Enterprise).

The two subsystems are independent; both can be enabled simultaneously. Row selection state is persisted in grid state (`api.getState()`). Cell selection is transient (not serialised).

`groupSelects` in `MultiRowSelectionOptions` supersedes the deprecated `groupSelectsChildren` / `groupSelectsFiltered` grid options (removed from `gridOptions` in v32.2; see `09-row-grouping.md` for the legacy options). Copy/paste keyboard behaviour triggered by cell selection is detailed in `19-context-menu-and-clipboard.md`.

## Configuration surface

### Row selection (`rowSelection`)

`rowSelection` accepts a `RowSelectionOptions` object (preferred) or the legacy strings `'single'` / `'multiple'` (deprecated v32.2).

#### `SingleRowSelectionOptions` (`mode: 'singleRow'`)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `rowSelection` | `RowSelectionOptions<TData> \| 'single' \| 'multiple'` | `undefined` | Community | Top-level option enabling row selection. String literals deprecated v32.2. |
| `mode` | `'singleRow'` | required | Community | Only one row may be selected at a time. |
| `enableClickSelection` | `boolean \| 'enableDeselection' \| 'enableSelection'` | `false` | Community | Controls whether clicking a row selects/deselects it. `true` enables both. |
| `checkboxes` | `boolean \| CheckboxSelectionCallback` | `true` | Community | Renders a selection checkbox per row. |
| `checkboxLocation` | `'selectionColumn' \| 'autoGroupColumn'` | `'selectionColumn'` | Community | Where checkboxes appear; `'autoGroupColumn'` places them inside the group expand column. |
| `hideDisabledCheckboxes` | `boolean` | `false` | Community | Hides checkbox when the row is not selectable. |
| `isRowSelectable` | `IsRowSelectable<TData>` | `undefined` | Community | Callback returning `false` makes a row non-selectable. |
| `copySelectedRows` | `boolean` | `false` | Community | Copy action copies the full row rather than just the focused cell. |
| `enableSelectionWithoutKeys` | `boolean` | `false` | Community | Allows multi-select without holding Ctrl/Cmd. |
| `masterSelects` | `'self' \| 'detail'` | `'self'` | Community | Whether selecting a master row also selects its detail grid (`'detail'`). |

#### Additional `MultiRowSelectionOptions` (`mode: 'multiRow'`)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `mode` | `'multiRow'` | required | Community | Multiple rows may be selected simultaneously. |
| `groupSelects` | `'self' \| 'descendants' \| 'filteredDescendants'` | `'self'` | Community | Group row selection behaviour. `'descendants'` selects all children; `'filteredDescendants'` limits to filtered children. Supersedes deprecated `groupSelectsChildren` / `groupSelectsFiltered` (see `09-row-grouping.md`). |
| `selectAll` | `'all' \| 'filtered' \| 'currentPage'` | `'all'` | Community | Scope of header checkbox "select all". |
| `headerCheckbox` | `boolean` | `true` | Community | Renders "select all" checkbox in header. |
| `ctrlASelectsRows` | `boolean` | `false` | Community | Ctrl+A selects rows when cell selection is also enabled. |

#### Column-level selection (ColDef)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `checkboxSelection` | `boolean \| CheckboxSelectionCallback` | `false` | Community | Renders checkbox in this column (legacy — prefer `rowSelection.checkboxes`). |
| `headerCheckboxSelection` | `boolean \| HeaderCheckboxSelectionCallback` | `false` | Community | Renders "select all" in this column header (legacy). |
| `headerCheckboxSelectionFilteredOnly` | `boolean` | `false` | Community | Header checkbox selects only filtered rows. |
| `headerCheckboxSelectionCurrentPageOnly` | `boolean` | `false` | Community | Header checkbox selects only current page rows. |

#### Selection column

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `selectionColumnDef` | `SelectionColumnDef` | `undefined` | Community | Customises the dedicated selection column (width, pinned, cellStyle, etc.). Subset of `ColDef`. |

#### Deprecated row-selection grid options (v32.2)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `rowMultiSelectWithClick` | `boolean` | `false` | Community | **Deprecated v32.2.** Use `rowSelection.enableSelectionWithoutKeys`. |
| `suppressRowDeselection` | `boolean` | `false` | Community | **Deprecated v32.2.** Use `rowSelection.enableClickSelection`. |
| `suppressRowClickSelection` | `boolean` | `false` | Community | **Deprecated v32.2.** Use `rowSelection.enableClickSelection: false`. |

### Cell selection (`cellSelection`)

`cellSelection` accepts `true` (defaults) or a `CellSelectionOptions` object.

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `cellSelection` | `boolean \| CellSelectionOptions<TData>` | `undefined` | Enterprise | Enables cell (range) selection. Replaces deprecated `enableRangeSelection`. |
| `suppressMultiRanges` | `boolean` | `false` | Enterprise | Limits selection to a single range at a time. |
| `enableHeaderHighlight` | `boolean` | `false` | Enterprise | Highlights column headers when cells in the column are in a range. |
| `enableColumnSelection` | `boolean` | `false` | Enterprise | Clicking a column header selects the entire column. |
| `handle` | `RangeHandleOptions \| FillHandleOptions` | `undefined` | Enterprise | Configures the handle shown at the bottom-right of the selection range. |

#### `RangeHandleOptions`

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `mode` | `'range'` | required | Enterprise | Renders a range handle; dragging it extends the selection without filling. |

#### `FillHandleOptions`

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `mode` | `'fill'` | required | Enterprise | Renders a fill handle; dragging fills cells with a linear progression or custom logic. |
| `direction` | `'x' \| 'y' \| 'xy'` | `'xy'` | Enterprise | Constrains fill direction. |
| `suppressClearOnFillReduction` | `boolean` | `false` | Enterprise | Prevents clearing cells when the fill range is reduced. |
| `setFillValue` | `(params: FillOperationParams) => any` | `undefined` | Enterprise | Custom fill logic; overrides default copy/increment behaviour. |

#### Deprecated cell-selection grid options (v32.2)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `enableRangeSelection` | `boolean` | `false` | Enterprise | **Deprecated v32.2.** Use `cellSelection = true`. |
| `enableRangeHandle` | `boolean` | `false` | Enterprise | **Deprecated v32.2.** Use `cellSelection.handle = { mode: 'range' }`. |
| `enableFillHandle` | `boolean` | `false` | Enterprise | **Deprecated v32.2.** Use `cellSelection.handle = { mode: 'fill' }`. |
| `fillHandleDirection` | `'x' \| 'y' \| 'xy'` | `'xy'` | Enterprise | **Deprecated v32.2.** Use `cellSelection.handle.direction`. |
| `suppressClearOnFillReduction` | `boolean` | `false` | Enterprise | **Deprecated v32.2.** Use `cellSelection.handle.suppressClearOnFillReduction`. |
| `suppressMultiRangeSelection` | `boolean` | `false` | Enterprise | **Deprecated v32.2.** Use `cellSelection.suppressMultiRanges`. |
| `fillOperation` | `FillOperation<TData>` | `undefined` | Enterprise | **Deprecated v32.2.** Use `cellSelection.handle.setFillValue`. |

## API methods

### Row selection API

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `selectAll` | `(mode?: SelectAllMode, source?: SelectionEventSourceType) => void` | Community | Selects all rows. `mode` can be `'all'`, `'filtered'`, or `'currentPage'`. |
| `deselectAll` | `(mode?: SelectAllMode, source?: SelectionEventSourceType) => void` | Community | Deselects all rows. Same `mode` options as `selectAll`. |
| `getSelectedNodes` | `() => IRowNode<TData>[]` | Community | Returns unsorted list of currently selected row nodes. |
| `getSelectedRows` | `() => TData[]` | Community | Returns unsorted list of selected row data objects. |
| `selectAllFiltered` | `(source?: SelectionEventSourceType) => void` | Community | **Deprecated v33.** Use `selectAll('filtered')`. |
| `deselectAllFiltered` | `(source?: SelectionEventSourceType) => void` | Community | **Deprecated v33.** Use `deselectAll('filtered')`. |
| `selectAllOnCurrentPage` | `(source?: SelectionEventSourceType) => void` | Community | **Deprecated v33.** Use `selectAll('currentPage')`. |
| `deselectAllOnCurrentPage` | `(source?: SelectionEventSourceType) => void` | Community | **Deprecated v33.** Use `deselectAll('currentPage')`. |

### SSRM selection state API (Enterprise)

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `getServerSideSelectionState` | `() => IServerSideSelectionState \| IServerSideGroupSelectionState \| null` | Enterprise | Returns selection rules for the SSRM. Type depends on `rowSelection.groupSelects`. |
| `setServerSideSelectionState` | `(state: IServerSideSelectionState \| IServerSideGroupSelectionState) => void` | Enterprise | Restores SSRM selection state (e.g. after navigation). |

### Cell selection API

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `getCellRanges` | `() => CellRange[] \| null` | Enterprise | Returns the current list of selected cell ranges. Start row may be numerically after end row if user dragged upwards. |
| `addCellRange` | `(params: CellRangeParams) => void` | Enterprise | Adds a new cell range without clearing existing ranges. Call `clearCellSelection()` first to replace. |
| `clearCellSelection` | `() => void` | Enterprise | Clears all selected cell ranges. |
| `clearRangeSelection` | `() => void` | Enterprise | **Deprecated v32.2.** Use `clearCellSelection()`. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `rowSelected` | `RowSelectedEvent { source: SelectionEventSourceType; node: IRowNode; data: TData; ... }` | Community | A single row's selection state changes. Fires once per affected row. |
| `selectionChanged` | `SelectionChangedEvent { source: SelectionEventSourceType; selectedNodes: IRowNode<TData>[] \| null; serverSideState: IServerSideSelectionState \| IServerSideGroupSelectionState \| null }` | Community | Bulk selection change is complete (after all individual `rowSelected` events). `selectedNodes` is `null` for SSRM select-all or group cascades. |
| `cellSelectionChanged` | `CellSelectionChangedEvent { id?: string; started: boolean; finished: boolean }` | Enterprise | Cell selection range changes. `started: true` on first event; `finished: true` on last. |
| `rangeSelectionChanged` | `RangeSelectionChangedEvent { id?: string; started: boolean; finished: boolean }` | Enterprise | Alias of `cellSelectionChanged`; retained for backward compatibility. |
| `fillStart` | `FillStartEvent {}` | Enterprise | User begins dragging the fill handle. |
| `fillEnd` | `FillEndEvent { initialRange: CellRange; finalRange: CellRange }` | Enterprise | User releases the fill handle; `initialRange` is the original selection, `finalRange` is the filled area. |
| `cellSelectionDeleteStart` | `CellSelectionDeleteStartEvent { source: 'deleteKey' }` | Enterprise | Delete key begins clearing selected cell range values. |
| `cellSelectionDeleteEnd` | `CellSelectionDeleteEndEvent { source: 'deleteKey' }` | Enterprise | Delete key finishes clearing selected cell range values. |

## Behaviors / interactions

### Row selection modes

`mode: 'singleRow'` — only one row is ever selected. Clicking a new row deselects the previous. Shift/Ctrl modifiers are ignored for selection purposes.

`mode: 'multiRow'` — multiple rows can be selected. Without `enableSelectionWithoutKeys`, Ctrl/Cmd adds to selection; Shift extends from the last-clicked row. With `enableSelectionWithoutKeys: true`, each click toggles.

### Group selection cascading

When `groupSelects: 'descendants'`, selecting a group row selects all its descendant leaf rows (and all intermediate groups). The group checkbox shows an indeterminate state when some but not all descendants are selected. When `groupSelects: 'filteredDescendants'`, only descendants that survive the current filter are affected. See `09-row-grouping.md` for the deprecated `groupSelectsChildren` / `groupSelectsFiltered` equivalents.

### Checkbox placement

Setting `checkboxLocation: 'autoGroupColumn'` moves both row checkboxes and the header "select all" checkbox into the auto group column, which is useful when showing a tree structure where the checkbox should appear inline with the expand/collapse control.

### SSRM selection state

Because SSRM does not hold all rows in memory, selection is represented as a rule set rather than a list of row IDs. `getServerSideSelectionState()` returns this state. Use `setServerSideSelectionState()` to restore it after a datasource refresh or navigation. `selectionChanged.serverSideState` carries the same object on each change event when `selectedNodes` is `null`.

### Cell selection and fill handle

Drag from any cell to extend a rectangular selection. With multiple ranges enabled, Ctrl/Cmd-drag adds an additional disjoint range. The fill handle (bottom-right corner dot) allows dragging to replicate or linearly extend values. Numbers increment; non-numbers copy. Override with `setFillValue`. The range handle (`mode: 'range'`) extends the selection boundary without filling.

### Copy/paste from cell selection

Ctrl/Cmd+C copies the selected range to the clipboard as tab-delimited text. Ctrl/Cmd+V pastes tab-delimited clipboard content into the current range, column-clamped if the data is wider than the selection. Full behaviour is described in `19-context-menu-and-clipboard.md`.

### `isRowSelectable` callback

Returning `false` renders the checkbox as disabled (or hidden when `hideDisabledCheckboxes: true`) and prevents the row from being included in group cascade selections.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- Row selection state can be stored as a `Set<string>` keyed by `getRowId`. The canvas layer repaints only the affected row rectangles on change.
- Checkbox rendering is a canvas draw primitive per row; the selection column is a fixed-width left or right band.
- Group cascade selection (`groupSelects: 'descendants'`) requires traversal of the row node tree on each click — ensure this runs off the render path.
- Cell (range) selection requires a separate overlay layer to draw the blue rectangle and corner handle without re-rasterising the cell content.
- Fill-handle drag involves live cell-value updates during the gesture; the canvas port should batch these and commit on `fillEnd`.
- SSRM selection-state serialisation (`getServerSideSelectionState`) is a pure data concern with no DOM dependency; reuse the same state shape.
- The `CellRangeParams` / `CellRange` types are framework-agnostic and can be adopted directly in the canvas port's range API.
