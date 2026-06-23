# 25 — Export

## Concept

AG Grid provides two export formats out of the box: **CSV** (Community) and **Excel / XLSX** (Enterprise).

**CSV export** serialises the currently displayed data (or a specified subset) to a comma-separated text file. It is always available via `CsvExportModule` (Community) and requires no additional dependencies. `exportDataAsCsv` triggers a browser file download; `getDataAsCsv` returns the serialised string for custom handling.

**Excel export** produces an `.xlsx` workbook via `ExcelExportModule` (Enterprise). It supports rich formatting through the `ExcelStyle` system (fonts, fills, borders, number formats, alignment), worksheet-level configuration (freeze panes, sheet protection, row/column grouping outlines, page margins), image embedding per cell, and multi-sheet workbooks. `exportDataAsExcel` triggers a download; `getDataAsExcel` returns a `Blob` or base64 string. Multi-sheet workflows use `getSheetDataForExcel` per sheet and then `exportMultipleSheetsAsExcel` to bundle them.

Both formats share the **base export parameter interface** (`BaseExportParams`) which controls column/row selection, ordering, filtering, and the four processing callbacks for custom cell/header/group-header/row-group values.

Cross-references: Row group export hooks (`processRowGroupCallback`) interact with the grouping pipeline in `09-row-grouping.md`; pivot column headers visible during export relate to `11-pivoting.md`; clipboard export uses the same `processCellCallback` mechanism but is covered in `19-context-menu-and-clipboard.md`.

## Configuration surface

### BaseExportParams (shared by CSV and Excel)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `allColumns` | `boolean` | `false` | Community | Export all `columnDefs` columns in definition order rather than only displayed columns. |
| `columnKeys` | `(string \| Column)[]` | `undefined` | Community | Explicit ordered list of columns to export; overrides `allColumns`. |
| `rowPositions` | `RowPosition[]` | `undefined` | Community | Export only specific row positions. |
| `fileName` | `string \| ExportFileNameGetter` | format-specific | Community | Output file name or callback returning a name. |
| `exportedRows` | `'all' \| 'filteredAndSorted'` | `'filteredAndSorted'` | Community | Whether to export all rows or only those passing current sort/filter. |
| `onlySelected` | `boolean` | `false` | Community | Export only currently selected rows. |
| `onlySelectedAllPages` | `boolean` | `false` | Community | Export selected rows across all pages (pagination). |
| `skipColumnGroupHeaders` | `boolean` | `false` | Community | Omit column group header rows from the output. |
| `skipColumnHeaders` | `boolean` | `false` | Community | Omit the column header row entirely. |
| `skipRowGroups` | `boolean` | `false` | Community | Omit group header rows when row grouping is active. See `09-row-grouping.md`. |
| `skipPinnedTop` | `boolean` | `false` | Community | Omit rows pinned to the top of the grid. |
| `skipPinnedBottom` | `boolean` | `false` | Community | Omit rows pinned to the bottom of the grid. |
| `valueFrom` | `'data' \| 'batch' \| 'edit'` | `'data'` | Community | Source for cell values: `'data'` from row data, `'batch'` from pending batch edits, `'edit'` from live editor values. |
| `shouldRowBeSkipped` | `(params: ShouldRowBeSkippedParams) => boolean` | `undefined` | Community | Per-row callback; return `true` to exclude a row from the export. |
| `processCellCallback` | `(params: ProcessCellForExportParams) => string` | `undefined` | Community | Per-cell callback; return a string to override the exported cell value. |
| `processHeaderCallback` | `(params: ProcessHeaderForExportParams) => string` | `undefined` | Community | Per-column callback; return a string to override the exported column header. |
| `processGroupHeaderCallback` | `(params: ProcessGroupHeaderForExportParams) => string` | `undefined` | Community | Per-column-group callback; return a string to override the group header. Ignored when `skipColumnGroupHeaders=true`. |
| `processRowGroupCallback` | `(params: ProcessRowGroupForExportParams) => string` | `undefined` | Community | Per-row-group callback; return a string to override the group row cell value. |
| `prependContent` | `CsvCustomContent \| ExcelRow[]` | `undefined` | Community | Content inserted before the grid data rows. Type is format-specific. |
| `appendContent` | `CsvCustomContent \| ExcelRow[]` | `undefined` | Community | Content inserted after the grid data rows. Type is format-specific. |
| `getCustomContentBelowRow` | `(params: ProcessRowGroupForExportParams) => CsvCustomContent \| ExcelRow[] \| undefined` | `undefined` | Community | Inserts custom rows below a given row in the output. |
| `exportRowNumbers` | `boolean` | `false` | Community | Export the row number column contents when the row numbers feature is active. |

### CsvExportParams (extends BaseExportParams)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `columnSeparator` | `string` | `','` | Community | Delimiter character between cell values. |
| `suppressQuotes` | `boolean` | `false` | Community | When `true`, cell values are not wrapped in double quotes and internal quotes are not escaped. Caller is responsible for ensuring values do not contain the separator. |

### Excel-specific: ExcelWorksheetConfigParams

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `sheetName` | `string \| ExcelSheetNameGetter` | `'ag-grid'` | Enterprise | Sheet tab name; max 31 characters. |
| `autoConvertFormulas` | `boolean` | `false` | Enterprise | Treat cell values starting with `=` as Excel formulas. |
| `columnWidth` | `number \| ((params: ColumnWidthCallbackParams) => number)` | grid column width | Enterprise | Default column width in the exported worksheet. |
| `headerRowHeight` | `number \| ((params: RowHeightCallbackParams) => number)` | Excel default | Enterprise | Height of header rows in the worksheet. |
| `rowHeight` | `number \| ((params: RowHeightCallbackParams) => number)` | Excel default | Enterprise | Height of data rows in the worksheet. |
| `protectSheet` | `boolean \| ExcelSheetProtection` | `false` | Enterprise | Protect the worksheet; `ExcelSheetProtection` allows specific user actions. |
| `freezeRows` | `'headers' \| 'headersAndPinnedRows' \| ExcelFreezeRowsGetter` | `undefined` | Enterprise | Freeze header rows or headers plus pinned rows at the top. |
| `freezeColumns` | `'pinned' \| ExcelFreezeColumnsGetter` | `undefined` | Enterprise | Freeze pinned left columns. |
| `rightToLeft` | `boolean` | grid `enableRtl` | Enterprise | Set worksheet direction to RTL. |
| `rowGroupExpandState` | `'expanded' \| 'collapsed' \| 'match'` | `'expanded'` | Enterprise | Expansion state of row groups in the exported workbook. |
| `suppressRowOutline` | `boolean` | `false` | Enterprise | Suppress the expand/collapse outline for row groups. |
| `suppressColumnOutline` | `boolean` | `false` | Enterprise | Suppress the expand/collapse outline for group columns. |
| `exportAsExcelTable` | `boolean \| ExcelTableConfig` | `false` | Enterprise | Wrap exported data in an Excel Table for sorting/filtering in Excel. |
| `headerFooterConfig` | `ExcelHeaderFooterConfig` | `undefined` | Enterprise | Header/footer content for all, first, and even pages. |
| `margins` | `ExcelSheetMargin` | `undefined` | Enterprise | Page margins (inches) for printing. |
| `pageSetup` | `ExcelSheetPageSetup` | `undefined` | Enterprise | Page orientation and paper size for printing. |
| `addImageToCell` | `(rowIndex: number, column: Column, value: string) => { image: ExcelImage; value?: string } \| undefined` | `undefined` | Enterprise | Callback to embed an image in a specific cell. |
| `suppressGridNotesExport` | `boolean` | `false` | Enterprise | Suppress automatic export of cell notes from `notesDataSource`. |
| `processNoteCallback` | `(params: ProcessNoteForExportParams) => ExcelNote \| null \| undefined` | `undefined` | Enterprise | Customise, suppress, or inject Excel notes per cell. |

### Excel-specific: ExcelFileParams

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `fileName` | `string \| ExportFileNameGetter` | `'export.xlsx'` | Enterprise | Output file name. |
| `author` | `string` | `'AG Grid'` | Enterprise | Author metadata written to the workbook. |
| `fontSize` | `number` | `11` | Enterprise | Default font size (pt) for the workbook. |
| `mimeType` | `string` | `'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'` | Enterprise | MIME type of the exported file. |
| `customMetadata` | `ExcelCustomMetadata` | `undefined` | Enterprise | Custom key-value pairs written to `docProps/custom.xml`. |

### ExcelStyle — cell styling via CSS class matching

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `id` | `string` | required | Enterprise | Matches a CSS class applied to grid cells; the style is applied to matching cells in the workbook. |
| `alignment` | `ExcelAlignment` | `undefined` | Enterprise | Horizontal/vertical alignment, indent, text rotation, wrap, shrink-to-fit. |
| `borders` | `ExcelBorders` | `undefined` | Enterprise | Top, bottom, left, right border color, line style, and weight. |
| `dataType` | `ExcelDataType` | `undefined` | Enterprise | Data type hint for Excel: `'String'`, `'Number'`, `'Boolean'`, `'DateTime'`, `'Error'`. |
| `font` | `ExcelFont` | `undefined` | Enterprise | Font name, size, bold, italic, color, underline, strikeThrough, etc. |
| `interior` | `ExcelInterior` | `undefined` | Enterprise | Background fill pattern and color. |
| `numberFormat` | `ExcelNumberFormat` | `undefined` | Enterprise | Excel number format string (e.g. `'$#,##0.00'`). |
| `protection` | `ExcelProtection` | `undefined` | Enterprise | Cell lock and formula-hide settings; requires `protectSheet`. |

`ExcelStyle` objects are provided via the `excelStyles` GridOption (an `ExcelStyle[]`). The grid matches the `id` to `cellClass` values on each cell at export time. This is the only mechanism for per-cell Excel formatting — there is no `excelCellStyle` ColDef property.

### GridOptions — export

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `excelStyles` | `ExcelStyle[]` | `undefined` | Enterprise | Array of `ExcelStyle` definitions; matched to cells by CSS class at export time. |
| `defaultExcelExportParams` | `ExcelExportParams` | `undefined` | Enterprise | Default params merged with any per-call `exportDataAsExcel` params. |
| `defaultCsvExportParams` | `CsvExportParams` | `undefined` | Community | Default params merged with any per-call `exportDataAsCsv` params. |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `exportDataAsCsv` | `(params?: CsvExportParams) => void` | Community | Serialises displayed data to CSV and triggers a browser file download. |
| `getDataAsCsv` | `(params?: CsvExportParams) => string \| undefined` | Community | Returns the CSV-serialised string without triggering a download. |
| `exportDataAsExcel` | `(params?: ExcelExportParams) => void` | Enterprise | Serialises displayed data to `.xlsx` and triggers a browser file download. |
| `getDataAsExcel` | `(params?: ExcelExportParams) => string \| Blob \| undefined` | Enterprise | Returns the Excel data as a `Blob` (default) or base64 string without triggering a download. |
| `getSheetDataForExcel` | `(params?: ExcelExportParams) => string \| undefined` | Enterprise | Returns raw sheet XML for use with `exportMultipleSheetsAsExcel`. |
| `getMultipleSheetsAsExcel` | `(params: ExcelExportMultipleSheetParams) => Blob \| undefined` | Enterprise | Merges multiple sheet XML strings (from `getSheetDataForExcel`) into a single `Blob`. |
| `exportMultipleSheetsAsExcel` | `(params: ExcelExportMultipleSheetParams) => void` | Enterprise | Merges multiple sheet XML strings into a workbook and triggers a browser file download. |

## Events

Export operations are synchronous and do not emit dedicated events. The relevant callbacks (`processCellCallback`, `processHeaderCallback`, etc.) are invoked inline during the serialisation pass rather than through the event bus.

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| _(none dedicated to export)_ | — | — | Export is synchronous; use the processing callbacks in `BaseExportParams` instead. |

## Behaviors / interactions

**`processCellCallback` hook:** Called once per exported cell. The callback receives `ProcessCellForExportParams` which includes `value` (raw), `node` (the `IRowNode`), `column`, `type` (operation string), and utility functions `parseValue` and `formatValue`. Return a string to substitute the exported value; returning `undefined` falls back to the `valueFormatter` output. This hook fires for both CSV and Excel, and also for clipboard copy operations (see `19-context-menu-and-clipboard.md`).

**`processHeaderCallback` hook:** Called once per exported leaf column. Return a string to override the header text; defaults to `colDef.headerName` or the field-derived name.

**`processGroupHeaderCallback` hook:** Called once per exported column group header. Has no effect when `skipColumnGroupHeaders: true`. Works alongside the grouping covered in `09-row-grouping.md`.

**`processRowGroupCallback` hook:** Called once per row group node in the export. Return a string to replace the default group key label. Interacts with the row grouping pipeline from `09-row-grouping.md` and pivot export from `11-pivoting.md`.

**`ExcelStyle` CSS-class matching:** At export time the grid inspects each cell's computed `cellClass` set (from `cellClass`, `cellClassRules`, and `colDef.type` CSS classes). Any `ExcelStyle` whose `id` matches a class is applied to that cell in the workbook. Multiple styles can match and are merged. This allows reusing the same class-based styling that drives the DOM theme (`21-themes-and-styling.md`) to also drive Excel formatting.

**Multi-sheet export pattern:** Call `getSheetDataForExcel(paramsForSheet1)`, then `getSheetDataForExcel(paramsForSheet2)`, then pass the resulting strings in `data: [sheet1, sheet2]` to `exportMultipleSheetsAsExcel`. Each sheet can have independent `sheetName`, `columnKeys`, and worksheet configuration.

**Column selection:** By default, only displayed columns are exported in display order. `allColumns: true` exports all `columnDefs` columns (including hidden ones) in definition order. `columnKeys` takes precedence over both and allows an arbitrary ordered subset.

**Row filtering:** The default `exportedRows: 'filteredAndSorted'` respects the current filter and sort state. `exportedRows: 'all'` exports every row regardless. `shouldRowBeSkipped` provides row-level veto on top of either mode.

## Look & feel

N/A — no dedicated UI; see referenced areas.

## Canvas-port implications

- **CSV export is renderer-agnostic:** The serialisation reads from the row model and column definitions; it does not touch the DOM or canvas. CSV export can be ported identically.
- **Excel export cell values:** `processCellCallback` and the value pipeline read from row data and `valueFormatter`, not from rendered output. The canvas port does not break Excel value accuracy.
- **`ExcelStyle` CSS-class matching:** The current mechanism relies on inspecting `cellClass` / `cellClassRules` results that are conceptually independent of DOM rendering. In a canvas grid, the same class-predicate logic runs at export time to select `ExcelStyle` objects; no CSS inspection of the DOM is needed.
- **No canvas-specific blockers:** Neither CSV nor Excel export has inherent dependencies on DOM cell rendering. Both are data-layer operations.
- **Cross-ref:** `09-row-grouping.md` governs the row group data structure consumed by `processRowGroupCallback`; `19-context-menu-and-clipboard.md` covers clipboard operations that share `processCellCallback`.
