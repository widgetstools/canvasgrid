# 24 — Charts & Sparklines

## Concept

AG Grid's visualization layer is divided into two distinct capabilities:

**Integrated Charts** bring AG Charts directly into the grid's UI. When `enableCharts` is set and the `IntegratedChartsModule` is registered, users can select a cell range and launch a chart from the context menu or programmatically via `createRangeChart`. Charts open in a floating container (either inside the grid element or in a user-supplied `chartContainer`). They stay live-linked to the underlying data unless unlinked explicitly. Pivot charts (`createPivotChart`) visualize the pivot result columns rather than a raw range. Cross-filter charts allow clicking a chart series to filter the grid. Integrated Charts require `ag-charts-community` as a peer dependency; the AG Charts Enterprise tier (`ag-charts-enterprise`) is needed for additional chart types and export features.

**Sparklines** render miniature inline charts inside individual cells using the `agSparklineCellRenderer`. The `SparklinesModule` is Enterprise and also requires `ag-charts-community`. Each cell's value array (or array of `{ x, y }` objects) drives a tiny `line`, `area`, `bar`, or `column` chart rendered via AG Charts. Options are passed through `sparklineOptions` on `ISparklineCellRendererParams`.

Both features depend on the AG Charts library for rendering; AG Grid acts as the integration and data-binding layer.

Cross-references: range selection that feeds chart creation is covered in `12-selection.md`; chart-related events (`chartCreated`, `chartOptionsChanged`, `chartDestroyed`) are catalogued in `22-events.md`; pivot data that feeds pivot charts is covered in `11-pivoting.md`.

## Configuration surface

### Integrated Charts — GridOptions

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `enableCharts` | `boolean` | `false` | Enterprise | Enables integrated charting; requires `IntegratedChartsModule`. |
| `chartThemes` | `string[]` | `['ag-default', 'ag-material', 'ag-sheets', 'ag-polychroma', 'ag-vivid']` | Enterprise | List of built-in theme names available in the chart panel. Initial-only. |
| `customChartThemes` | `CustomChartThemes` | `undefined` | Enterprise | Map of user-defined theme names to `AgChartTheme` objects. Initial-only. |
| `chartThemeOverrides` | `AgChartThemeOverrides` | `undefined` | Enterprise | Global theme overrides applied on top of the active theme for all charts. Initial-only. |
| `chartToolPanelsDef` | `ChartToolPanelsDef` | `undefined` | Enterprise | Controls visibility and ordering of Chart Tool Panels and which chart types appear. Initial-only. |
| `chartMenuItems` | `(DefaultChartMenuItem \| MenuItemDef<TData>)[] \| GetChartMenuItems<TData>` | `undefined` | Enterprise | Custom context-menu items for charts; only applies when using AG Charts Enterprise. |

### Integrated Charts — CreateRangeChartParams / BaseCreateChartParams

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `chartType` | `ChartType` | required | Enterprise | The AG Charts chart type to create (e.g. `'bar'`, `'line'`, `'pie'`). |
| `cellRange` | `ChartParamsCellRange` | required | Enterprise | Cell range to chart; omit row bounds to chart all rows. |
| `chartThemeName` | `string` | `undefined` | Enterprise | Override the default theme for this chart instance. |
| `chartContainer` | `HTMLElement` | `undefined` | Enterprise | Mount the chart in a custom DOM element outside the grid. |
| `chartThemeOverrides` | `AgChartThemeOverrides` | `undefined` | Enterprise | Per-instance theme overrides. |
| `unlinkChart` | `boolean` | `false` | Enterprise | When `true`, the chart is not updated when grid data changes. |
| `suppressChartRanges` | `boolean` | `false` | Enterprise | Suppress the blue highlight of the selected cell range while chart is open. |
| `switchCategorySeries` | `boolean` | `false` | Enterprise | Swap category and series interpretation of the selected columns. |
| `aggFunc` | `string \| IAggFunc` | `undefined` | Enterprise | Aggregation function applied to series data for the chart. |
| `seriesChartTypes` | `SeriesChartType[]` | `undefined` | Enterprise | Per-series chart type definitions for combination charts. |
| `seriesGroupType` | `SeriesGroupType` | `undefined` | Enterprise | Grouping type for chart types that support grouped series. |
| `useGroupColumnAsCategory` | `boolean` | `false` | Enterprise | Prefer the auto group column as the chart category when row grouping is active. |

### Sparklines — ISparklineCellRendererParams

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `sparklineOptions` | `AgSparklineOptions` | `undefined` | Enterprise | Full AG Charts sparkline configuration object (type, axis, tooltip, markers, etc.). |
| `createSparkline` | `(options: AgSparklineOptions) => AgChartInstance<AgSparklineOptions>` | `undefined` | Enterprise | Override factory function for creating sparkline instances. |

The `AgSparklineOptions` type is sourced from `ag-charts-types`. The `type` field within `AgSparklineOptions` selects the sparkline variant: `'line'`, `'area'`, `'bar'`, or `'column'`.

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `createRangeChart` | `(params: CreateRangeChartParams) => ChartRef \| undefined` | Enterprise | Creates a range chart from the specified cell range; returns a `ChartRef` with `chartId` and `destroyChart`. |
| `createPivotChart` | `(params: CreatePivotChartParams) => ChartRef \| undefined` | Enterprise | Creates a chart from pivot result columns; `CreatePivotChartParams` extends `BaseCreateChartParams`. |
| `createCrossFilterChart` | `(params: CreateCrossFilterChartParams) => ChartRef \| undefined` | Enterprise | Creates a cross-filter chart; clicking a series filters the grid. |
| `updateChart` | `(params: UpdateChartParams) => void` | Enterprise | Updates an existing chart; `params` is a discriminated union: `UpdateRangeChartParams`, `UpdatePivotChartParams`, or `UpdateCrossFilterChartParams`. |
| `getChartModels` | `() => ChartModel[] \| undefined` | Enterprise | Returns serialisable model objects for all open charts; useful for saving/restoring state. |
| `getChartRef` | `(chartId: string) => ChartRef \| undefined` | Enterprise | Returns the `ChartRef` for a chart by its ID. |
| `getChartImageDataURL` | `(params: GetChartImageDataUrlParams) => string \| undefined` | Enterprise | Returns a data URL (PNG or JPEG) of the chart image. |
| `downloadChart` | `(params: ChartDownloadParams) => void` | Enterprise | Triggers browser download of the chart as an image file. |
| `openChartToolPanel` | `(params: OpenChartToolPanelParams) => void` | Enterprise | Programmatically opens the Chart Tool Panel to a named panel. |
| `closeChartToolPanel` | `(params: CloseChartToolPanelParams) => void` | Enterprise | Programmatically closes the Chart Tool Panel. |
| `restoreChart` | `(chartModel: ChartModel, chartContainer?: HTMLElement) => ChartRef \| undefined` | Enterprise | Restores a chart from a previously serialised `ChartModel`. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `chartCreated` | `ChartCreatedEvent { chartId: string }` | Enterprise | A new integrated chart is created (via UI or API). |
| `chartRangeSelectionChanged` | `ChartRangeSelectionChangedEvent { chartId: string; id: string; cellRange: CellRangeParams }` | Enterprise | The cell range driving a chart is changed by the user. |
| `chartOptionsChanged` | `ChartOptionsChangedEvent { chartId: string; chartType: ChartType; chartThemeName: string; chartOptions: AgChartThemeOverrides }` | Enterprise | Chart type, theme, or options change via the Chart Tool Panel. |
| `chartDestroyed` | `ChartDestroyedEvent { chartId: string }` | Enterprise | A chart is closed or destroyed. |

Note: the aliases `ChartCreated`, `ChartRangeSelectionChanged`, `ChartOptionsChanged`, `ChartDestroyed` (without `Event` suffix) are deprecated since v32; use the `*Event` forms.

## Behaviors / interactions

**Range selection → chart creation:** With `enableCharts: true` and `cellSelection` configured (see `12-selection.md`), right-clicking a range shows a "Chart Range" context menu item. The chart opens linked to that range. The blue range highlight can be suppressed via `suppressChartRanges`. This is a key integration point: range selection drives chart creation without any API call.

**Live linking:** By default, charts remain linked to the grid data. When `applyTransaction` or `applyTransactionAsync` updates the underlying rows, all open linked charts re-render automatically. Calling `createRangeChart({ unlinkChart: true })` or using the "Unlink Chart" toolbar button severs this connection.

**Pivot chart:** Calling `createPivotChart` only works when `pivotMode: true` is active (see `11-pivoting.md`). The chart uses the generated secondary columns rather than the primary column set. Options available to range charts that reference a cell range are not applicable.

**Cross-filter chart:** A cross-filter chart listens to click/selection events on its series and translates them to `setFilterModel` calls on the grid, allowing the chart to drive the grid filter. Multiple cross-filter charts can coexist.

**Chart serialization / restore:** `getChartModels()` returns a `ChartModel[]` that can be JSON-serialised and stored. `restoreChart(model, container?)` reconstructs the chart from that model on page reload, preserving type, theme, options, and cell range.

**Sparkline cell renderer:** Set `cellRenderer: 'agSparklineCellRenderer'` and `cellRendererParams: { sparklineOptions: { type: 'line', ... } }` on a `ColDef`. The column's cell value must be an array of numbers or `{ x, y }` objects. The sparkline auto-sizes to its cell dimensions and re-renders on data change. Tooltip and marker styling are configured within `sparklineOptions`. Requires `SparklinesModule` (Enterprise).

**Module dependencies:**
- `IntegratedChartsModule` (Enterprise) + `ag-charts-community` (peer) for all integrated chart features.
- `ag-charts-enterprise` (peer) unlocks additional chart types and export within AG Charts.
- `SparklinesModule` (Enterprise) + `ag-charts-community` (peer) for sparkline cell renderers.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- **Sparklines as first-class renderers:** The canvas grid needs a native sparkline drawing primitive — a typed cell renderer that draws a miniature line/area/bar/column chart directly into the canvas cell. Delegating to `ag-charts-community` per-cell is feasible (render to an offscreen canvas and blit) but requires benchmarking at high row counts.
- **Integrated charts are outside the grid canvas:** Charts are rendered by AG Charts into a separate `HTMLElement` container, not onto the grid canvas surface. This integration point is DOM-level regardless of whether the grid itself uses canvas rendering. The canvas port can reuse the same `createRangeChart` API contracts and event plumbing unchanged.
- **Range highlight:** The blue cell-range highlight that appears while a chart is open is a DOM overlay in the current implementation. In a canvas grid, this must be drawn as a canvas overlay layer or as a highlighted fill pass during the grid repaint.
- **Cell value contract:** Sparklines consume the raw cell value (an array). The canvas grid's cell value pipeline (`valueGetter` → raw value) must deliver a typed array to the sparkline renderer; `valueFormatter` output is not used.
- **Cross-ref:** See `12-selection.md` for range selection, which is the prerequisite for user-initiated chart creation.
