# 08 — Filtering

## Concept

AG Grid provides a multi-layered filtering architecture for the Client-Side Row Model (CSRM):

1. **Column filters** — per-column filter UIs opened from the column header or floating filter bar.
   Built-in filters: `agTextColumnFilter`, `agNumberColumnFilter`, `agDateColumnFilter` (Community);
   `agSetColumnFilter`, `agMultiColumnFilter` (Enterprise).
2. **Floating filters** — condensed, always-visible filter inputs displayed in an extra header row
   directly beneath column headers. Controlled by `floatingFilter: true` on `ColDef` or `defaultColDef`.
3. **Quick filter** — a single text box that searches across all columns simultaneously. Set via
   `quickFilterText` grid option. Module: `QuickFilterModule`.
4. **External filter** — application-controlled filtering that runs alongside column and quick filters.
   Implemented via the `isExternalFilterPresent` / `doesExternalFilterPass` callbacks.
5. **Advanced filter** (Enterprise) — SQL-like expression builder for complex multi-column conditions.
   Documented in `26-advanced-filter.md` (future task).

All active filters are combined with AND logic. The CSRM applies column filters → external filter →
quick filter in sequence; a row must pass every active filter to be displayed.

Cross-reference: filter state is part of `ColumnState` / `GridState` (see `02-column-model.md`); filter
model persistence uses `getFilterModel` / `setFilterModel` (this file). Server-side filtering is in
`15-server-side-row-model.md`.

## Configuration surface

### GridOptions — quick filter

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `quickFilterText` | `string` | `undefined` | Community | Text applied as a Quick Filter across all columns. Only for CSRM. Module: `QuickFilterModule`. |
| `cacheQuickFilter` | `boolean` | `false` | Community | Cache per-row quick-filter aggregate text to improve performance. `@initial`. Module: `QuickFilterModule`. |
| `includeHiddenColumnsInQuickFilter` | `boolean` | `false` | Community | Apply quick filter to hidden columns in addition to visible ones. Module: `QuickFilterModule`. |
| `quickFilterParser` | `QuickFilterParser` | `undefined` | Community | Custom function `(quickFilter: string) => string[]` to split the quick-filter text into search terms. Module: `QuickFilterModule`. |
| `quickFilterMatcher` | `QuickFilterMatcher` | `undefined` | Community | Custom function `(quickFilterParts: string[], rowQuickFilterAggregateText: string) => boolean` to override match logic. Module: `QuickFilterModule`. |
| `applyQuickFilterBeforePivotOrAgg` | `boolean` | `false` | Community | Apply quick filter on pre-pivot/aggregated data instead of the pivoted result. Module: `QuickFilterModule`. |

### GridOptions — external filter

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `isExternalFilterPresent` | `IsExternalFilterPresent<TData>` | `undefined` | Community | Callback `(params: IsExternalFilterPresentParams) => boolean`. Grid calls this before each filter pass; return `true` to activate external filtering. Module: `ExternalFilterModule`. |
| `doesExternalFilterPass` | `DoesExternalFilterPass<TData>` | `undefined` | Community | Callback `(node: IRowNode) => boolean`. Called for each row when external filter is present; return `true` to include the row. Module: `ExternalFilterModule`. |
| `alwaysPassFilter` | `AlwaysPassFilter<TData>` | `undefined` | Community | Callback `(rowNode: IRowNode) => boolean`. Rows for which this returns `true` bypass all filters and are always displayed. CSRM only. |

### GridOptions — other filter options

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `enableFilterHandlers` | `boolean` | `false` | Community | When true, the grid expects user-provided filter handlers via the new filter handler API; toggles which filter events fire. |
| `enableAdvancedFilter` | `boolean` | `false` | Enterprise | Enable the Advanced Filter. See `26-advanced-filter.md`. Module: `AdvancedFilterModule`. |
| `excludeChildrenWhenTreeDataFiltering` | `boolean` | `false` | Community | In tree data mode, exclude child nodes from filter results (filter only leaf nodes). Module: `TreeDataModule`. |

### ColDef — per-column filter

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `filter` | `any` | `undefined` | Community | Filter to use: `true` for default, a filter string key (`'agTextColumnFilter'`, `'agNumberColumnFilter'`, `'agDateColumnFilter'`, `'agSetColumnFilter'`, `'agMultiColumnFilter'`), or a custom `IFilterComp` / `ColumnFilter` class. |
| `filterParams` | `any` | `undefined` | Community | Params object passed to the filter component. Type depends on chosen filter (see Behaviors section). |
| `filterValueGetter` | `string \| ValueGetterFunc<TData>` | `undefined` | Community | Function/expression to derive the value used by column filters (different from display or sort value). |
| `floatingFilter` | `boolean` | `false` | Community | Show a floating filter input for this column in the header row below the main header. |
| `floatingFilterComponent` | `any` | `undefined` | Community | Custom floating filter component. Uses the filter's built-in floating filter if not specified. |
| `floatingFilterComponentParams` | `any` | `undefined` | Community | Params passed to `floatingFilterComponent`. |
| `suppressFloatingFilterButton` | `boolean` | `undefined` | Community | Hide the button in the floating filter that opens the parent filter popup. Only relevant when `floatingFilter: true`. |
| `getQuickFilterText` | `GetQuickFilterText<TData, TValue>` | `undefined` | Community | Callback returning the string used for quick-filter matching for this column. Defaults to `String(value)`. Module: `QuickFilterModule`. |

### `IProvidedFilterParams` — shared params for all provided filters

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `buttons` | `FilterAction[]` | `undefined` | Community | Buttons to show in the filter popup. Options: `'apply'`, `'clear'`, `'reset'`, `'cancel'`. |
| `closeOnApply` | `boolean` | `false` | Community | Close the filter popup immediately when the Apply or Reset button is clicked. |
| `debounceMs` | `number` | `500` (text/number), `0` (date/set) | Community | Debounce delay before the filter is applied as the user types. |
| `readOnly` | `boolean` | `false` | Community | Disable filter UI controls; filter can only be set via API. |

### `ISimpleFilterParams` — shared params for text, number, date filters

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `filterOptions` | `(ISimpleFilterModelType \| IFilterOptionDef)[]` | varies by filter | Community | Filter options to display (e.g., `'contains'`, `'equals'`, `'inRange'`). Custom options via `IFilterOptionDef`. |
| `defaultOption` | `string` | first in `filterOptions` | Community | The default selected filter option. |
| `defaultJoinOperator` | `'AND' \| 'OR'` | `'AND'` | Community | Default join operator when two conditions are active. |
| `maxNumConditions` | `number` | `2` | Community | Maximum number of filter conditions allowed. |
| `numAlwaysVisibleConditions` | `number` | `1` | Community | Conditions visible by default; additional conditions appear as previous ones are filled. |
| `filterPlaceholder` | `FilterPlaceholderFunction \| string` | `undefined` | Community | Placeholder text for filter input fields. |

### `ITextFilterParams` — text filter specific

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `textMatcher` | `TextMatcher` | `undefined` | Community | Custom match function `(params: TextMatcherParams) => boolean`; overrides built-in contains/startsWith/etc. logic. |
| `caseSensitive` | `boolean` | `false` | Community | Enable case-sensitive text matching. |
| `textFormatter` | `(from: string) => string \| null` | `undefined` | Community | Transform the value string before comparison (e.g., strip accents). |
| `trimInput` | `boolean` | `false` | Community | Trim leading/trailing whitespace from the user's input before filtering. |

### `INumberFilterParams` — number filter specific

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `allowedCharPattern` | `string` | `undefined` | Community | Regex of characters allowed in the number input field. |
| `numberParser` | `(text: string \| null) => number \| null` | `undefined` | Community | Custom parser to convert the filter input string to a number. |
| `numberFormatter` | `(value: number \| null) => string \| null` | `undefined` | Community | Custom formatter to display the number from the filter model in the input. |

### `ISetFilterParams` — set filter (Enterprise)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `values` | `SetFilterValues<TData, V>` | from grid data | Enterprise | Static array or async callback providing filter values. Module: `SetFilterModule`. |
| `refreshValuesOnOpen` | `boolean` | `false` | Enterprise | Re-fetch `values` each time the filter panel opens. |
| `cellHeight` | `number` | `undefined` | Enterprise | Height in pixels of each value row in the filter list. |
| `suppressSorting` | `boolean` | `false` | Enterprise | Do not sort the provided values list. |
| `cellRenderer` | `any` | `undefined` | Enterprise | Custom cell renderer for values in the filter list. |
| `suppressMiniFilter` | `boolean` | `false` | Enterprise | Hide the mini search box inside the Set Filter. |
| `applyMiniFilterWhileTyping` | `boolean` | `false` | Enterprise | Apply the Set Filter immediately as the user types in the mini filter. |
| `suppressSelectAll` | `boolean` | `false` | Enterprise | Remove the Select All checkbox from the filter list. |
| `defaultToNothingSelected` | `boolean` | `false` | Enterprise | Open the filter with all values de-selected (rather than all selected). Does not work in Excel mode. |
| `comparator` | `(a: V \| null, b: V \| null) => number` | column comparator | Enterprise | Custom sort comparator for the values in the filter list. |
| `textFormatter` | `(from: string) => string` | `undefined` | Enterprise | Transform value strings before mini-filter comparison. |
| `valueFormatter` | `(params: ValueFormatterParams) => string` | `undefined` | Enterprise | Format values for display in the filter list. Required when `keyCreator` is set. |
| `keyCreator` | `(params: KeyCreatorParams) => string` | `undefined` | Enterprise | Map complex values to string keys for filtering. |
| `showTooltips` | `boolean` | `false` | Enterprise | Show full-value tooltips on hover in the filter list. |
| `caseSensitive` | `boolean` | `false` | Enterprise | Enable case-sensitive mini-filter matching. |

### `IMultiFilterParams` — multi filter (Enterprise)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `filters` | `IMultiFilterDef[]` | `undefined` | Enterprise | Array of child filter definitions. Each `IMultiFilterDef` specifies `filter`, `filterParams`, `display` (`'inline'`/`'accordion'`/`'subMenu'`), and optionally `title` and `floatingFilterComponent`. Module: `MultiFilterModule`. |
| `readOnly` | `boolean` | `false` | Enterprise | Make multi-filter UI read-only; affects only the wrapper, not individual child filters. |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `getFilterModel` | `() => FilterModel` | Community | Returns the current filter model for all columns as `{ [colId]: model }`. |
| `setFilterModel` | `(model: FilterModel \| null) => void` | Community | Sets all column filter states from a model object. Pass `null` to clear all filters. |
| `getColumnFilterModel` | `<TModel>(column: string \| Column, useUnapplied?: boolean) => TModel \| null` | Community | Returns the filter model for a single column. Returns `null` if filter is inactive. |
| `setColumnFilterModel` | `<TModel>(column: string \| Column, model: TModel \| null) => Promise<void>` | Community | Sets the filter model for a single column. Pass `null` to clear. Must await before calling `onFilterChanged()`. |
| `getColumnFilterInstance` | `<TFilter>(key: string \| Column) => Promise<TFilter \| null \| undefined>` | Community | Returns the filter component instance for a column (async). |
| `getColumnFilterHandler` | `<TFilterHandler>(key: string \| Column) => TFilterHandler \| undefined` | Community | Returns the filter handler instance (for use with `enableFilterHandlers`). |
| `destroyFilter` | `(key: string \| Column) => void` | Community | Destroy a column's filter, forcing it to be recreated from scratch next time. |
| `showColumnFilter` | `(colKey: string \| Column) => void` | Community | Open the filter popup for the specified column. |
| `hideColumnFilter` | `() => void` | Community | Close any open filter popup. |
| `onFilterChanged` | `(source?: FilterChangedEventSourceType) => void` | Community | Signal the grid that filter state has changed externally; triggers a filter re-pass and fires `filterChanged`. |
| `isAnyFilterPresent` | `() => boolean` | Community | Returns `true` if any filter (column, quick, external, or advanced) is currently active. |
| `isColumnFilterPresent` | `() => boolean` | Community | Returns `true` if any column filter is currently active. |
| `doFilterAction` | `(params: FilterActionParams) => void` | Community | Programmatically invoke a filter action (`'apply'`, `'clear'`, `'reset'`, `'cancel'`) for a column or all columns. Requires `enableFilterHandlers: true`. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `filterChanged` | `FilterChangedEvent { source?: 'api'\|'quickFilter'\|'columnFilter'\|'advancedFilter', afterDataChange?: boolean, afterFloatingFilter?: boolean, columns: Column[] }` | Community | Any filter changes and the displayed rows are re-evaluated. |
| `filterModified` | `FilterModifiedEvent { filterInstance: IFilterComp, column: Column }` | Community | The filter UI is modified by the user but not yet applied (e.g., user is typing). Only fires when `enableFilterHandlers: false`. |
| `filterUiChanged` | `FilterUiChangedEvent { column: Column }` | Community | The filter UI state changes (broader than `filterModified`). Only fires when `enableFilterHandlers: true`. |
| `filterOpened` | `FilterOpenedEvent { column: Column \| ProvidedColumnGroup, source: FilterRequestSource, eGui: HTMLElement }` | Community | A column filter popup is opened. |
| `floatingFilterUiChanged` | `FloatingFilterUiChangedEvent { column: Column }` | Community | The floating filter UI state changes. Only fires when `enableFilterHandlers: true`. |

## Behaviors / interactions

**Text filter (`agTextColumnFilter`) filter options:** The default options include `contains`, `notContains`,
`equals`, `notEqual`, `startsWith`, `endsWith`, `blank`, `notBlank`. The active options can be restricted
via `filterParams.filterOptions`. Custom options are defined via `IFilterOptionDef` objects with a
`predicate` callback.

**Number filter (`agNumberColumnFilter`) filter options:** Includes `equals`, `notEqual`, `lessThan`,
`lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`, `inRange`, `blank`, `notBlank`. `inRange` activates
a second input field (`filterTo`).

**Date filter (`agDateColumnFilter`) filter options:** Same as number filter options, but operates on
`Date` objects. The date picker component can be swapped via `dateComponent` / `dateComponentParams` on
`ColDef`. Preset date types are available via `ISimpleFilterModelPresetType` (e.g., `'today'`, `'lastWeek'`,
`'thisMonth'`).

**Set filter (`agSetColumnFilter`, Enterprise):** Renders a list of all unique values in the column with
checkboxes. Users check/uncheck values to include/exclude them. The list is populated from grid data by
default, or from `filterParams.values`. The mini-filter search box lets users narrow the visible list.
Excel-like behaviour (including "add to current selection") is toggled via `excelMode` on the params
(refer to `ag-grid-community`'s `ISetFilterParams` in `interfaces/iSetFilter.d.ts`).

**Multi filter (`agMultiColumnFilter`, Enterprise):** Wraps two or more child filters in a single panel.
Each child is specified via `filterParams.filters` as an `IMultiFilterDef`. Children can be displayed
`'inline'`, in an `'accordion'`, or in a `'subMenu'`. The model is `{ filterType: 'multi', filterModels: [child1Model, child2Model] }`.

**Floating filters:** Each provided column filter ships with a matching floating filter that shows a
condensed version of the filter state. Clicking the expand button opens the full filter popup. Custom
floating filters are registered via `floatingFilterComponent` on `ColDef`. Setting
`suppressFloatingFilterButton: true` hides the expand button, creating a read-only indicator.

**Quick filter mechanics:** `quickFilterText` is split into terms by whitespace by default (overridable
via `quickFilterParser`). A row passes if all terms are found anywhere in the row's combined text
(overridable via `quickFilterMatcher`). Each column's contribution to the aggregate text is the result
of `toString()` on the cell value, or the return value of `getQuickFilterText` if specified.

**External filter:** The grid calls `isExternalFilterPresent()` before each filter pass. If it returns
`true`, `doesExternalFilterPass(node)` is called for each row. External filter runs independently of
column and quick filters; all must pass for a row to be displayed. Call `api.onFilterChanged()` whenever
the external filter state changes to trigger a re-pass.

**Filter buttons (`buttons` in `filterParams`):**
- `'apply'` — filter applies only when the Apply button is clicked; changes accumulate in the UI until then.
- `'clear'` — clears the filter input fields without removing the active filter.
- `'reset'` — clears both the UI and the active filter.
- `'cancel'` — reverts the UI to match the last applied model without changing the active filter.
Setting `closeOnApply: true` automatically closes the popup after clicking Apply or Reset.

**`getFilterModel` / `setFilterModel` round-trip:** The filter model object (`{ [colId]: filterModel }`)
can be serialised to JSON and restored. For text filters the model is `{ filterType: 'text', type, filter, filterTo? }`;
for number filters `{ filterType: 'number', ... }`; for set filters `{ filterType: 'set', values: [...] }`;
for multi filters `{ filterType: 'multi', filterModels: [...] }`.

**`alwaysPassFilter`:** Allows specific rows to bypass all filters unconditionally. Useful for pinned
summary rows or locked reference rows that must always be visible regardless of filter state.

**Showcase usage:** The PositionsGrid (`src/grid/columnDefs.ts`) uses `agMultiColumnFilter` for every
column, combining `agTextColumnFilter` or `agNumberColumnFilter` with `agSetColumnFilter`. The
`defaultColDef` sets `filter: true` and `floatingFilter: true`, activating the floating filter row
globally.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- Column filter components (`agTextColumnFilter`, `agSetColumnFilter`, etc.) are HTML popup UI; the
  canvas port must either host these as DOM overlays or re-implement them as canvas-native components.
  The filter logic (model evaluation, `doesFilterPass`) is pure JS and is portable without modification.
- Floating filters are rendered in a dedicated header row. The canvas port needs a header-rendering layer
  that can accommodate an optional extra row for floating filter inputs.
- `quickFilterText` is applied in the CSRM pipeline before rows reach the canvas renderer; no
  canvas-specific changes are needed for the quick-filter pass itself, but the input control (if hosted
  outside the grid) remains a DOM element.
- External filter (`isExternalFilterPresent` / `doesExternalFilterPass`) is pure callback-based and is
  fully portable to the canvas port with no changes.
- `getFilterModel` / `setFilterModel` are the public persistence API; the canvas port must expose the
  same schema so filter state saved from the DOM grid can be restored in the canvas grid.
- `agSetColumnFilter` (Enterprise) shows a virtualised value list. If ported to canvas, the list
  virtualisation logic must be reimplemented in the canvas renderer; alternatively it can remain as a
  DOM popup overlay.
- Q: Will floating filters in the canvas port be DOM elements absolutely positioned over the canvas, or
  natively drawn canvas controls? This is the primary look-and-feel decision for this area.
- Cross-reference: filter state is persisted in `GridState` alongside sort and column state
  (`02-column-model.md`). Advanced filter (Enterprise) is documented in `26-advanced-filter.md`.
