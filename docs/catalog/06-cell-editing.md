# 06 — Cell Editing

## Concept

Cell editing in AG Grid allows users to modify individual cell values or entire rows through built-in editor
components, fully custom editor components, or a hybrid selector callback. The editing lifecycle is:

1. A start trigger (double-click, single-click when `singleClickEdit: true`, key press, or
   `api.startEditingCell()`) activates the editor for the target cell.
2. The editor component initialises and mounts into the cell (inline) or into a popup.
3. On stop trigger (Tab, Enter, Escape, focus loss, or `api.stopEditing()`) the grid calls
   `cellEditor.getValue()`, then passes the result through `valueParser` → `valueSetter`
   (or direct `data[field]` assignment), writing the new value back to row data.
4. `cellValueChanged` fires if the value changed; `cellEditingStopped` fires unconditionally.

**Edit modes:**

- **Single-cell** (default) — one cell editable at a time.
- **Full-row** (`editType: 'fullRow'`) — all editable cells in the row become active simultaneously.
- **Read-only / immutable** (`readOnlyEdit: true`) — grid does not write; fires `cellEditRequest`
  instead, leaving state management to the application.

**Undo / redo** (`undoRedoCellEditing: true`, Enterprise module `UndoRedoEditModule`) maintains a stack of
cell edits and lets users invoke `Ctrl+Z` / `Ctrl+Y` (or the API) to traverse them.

Cross-reference: editing results land in row data via transactions — see `04-data-updates.md`. Column
identity (`field`, `valueSetter`, `valueParser`) is detailed in `02-column-model.md`.

## Configuration surface

### GridOptions — edit mode

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `editType` | `'fullRow' \| undefined` | `undefined` | Community | Set to `'fullRow'` to enable full-row edit mode; omit for single-cell mode. Requires an editor module. |
| `singleClickEdit` | `boolean` | `false` | Community | Start editing on a single click instead of double-click. |
| `suppressClickEdit` | `boolean` | `false` | Community | Disable click-to-edit; editing can only be triggered programmatically. |
| `readOnlyEdit` | `boolean` | `false` | Community | Grid does not commit edits; fires `cellEditRequest` instead. |
| `stopEditingWhenCellsLoseFocus` | `boolean` | `false` | Community | Stop editing when grid loses focus. `@initial` — cannot be changed at runtime. |
| `enterNavigatesVertically` | `boolean` | `false` | Community | Enter moves focus down (Excel-style). Combine with `enterNavigatesVerticallyAfterEdit`. |
| `enterNavigatesVerticallyAfterEdit` | `boolean` | `false` | Community | Enter moves focus down after a successful edit commit. |
| `enableCellEditingOnBackspace` | `boolean` | `undefined` | Community | macOS: start edit on Backspace key press. |
| `suppressStartEditOnTab` | `boolean` | `undefined` | Community | Prevent Tab from starting edit on the next editable cell. |
| `invalidEditValueMode` | `'block' \| undefined` | `undefined` | Community | When `'block'`, keeps editor open on validation failure instead of committing. |
| `getFullRowEditValidationErrors` | `GetFullRowEditValidationErrors` | `undefined` | Community | Callback to validate a full-row edit before committing. Only used when `editType='fullRow'`. |

### GridOptions — undo / redo

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `undoRedoCellEditing` | `boolean` | `false` | Community | Enable undo / redo for cell edits. `@initial`. Requires `UndoRedoEditModule`. |
| `undoRedoCellEditingLimit` | `number` | `10` | Community | Maximum depth of the undo / redo stack. `@initial`. |

### ColDef — per-column editing

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `editable` | `boolean \| EditableCallback<TData, TValue>` | `false` | Community | Enable editing for this column. Callback receives row/column context and returns boolean. |
| `cellEditor` | `any` | `undefined` | Community | Built-in key (`'agTextCellEditor'`, `'agLargeTextCellEditor'`, `'agSelectCellEditor'`, `'agNumberCellEditor'`, `'agDateCellEditor'`, `'agDateStringCellEditor'`, `'agCheckboxCellEditor'`, `'agRichSelectCellEditor'`) or a custom component class/function. |
| `cellEditorParams` | `any` | `undefined` | Community | Static params object passed to the `cellEditor` component on init. Type depends on chosen editor (see Behaviors section). |
| `cellEditorSelector` | `CellEditorSelectorFunc<TData, TValue>` | `undefined` | Community | Per-row callback that returns `{ component, params, popup, popupPosition }`. Overrides `cellEditor`/`cellEditorParams`. |
| `cellEditorPopup` | `boolean` | `undefined` | Community | Render editor in a popup overlay (not constrained to the cell boundary). |
| `cellEditorPopupPosition` | `'over' \| 'under'` | `'over'` | Community | Popup position relative to the cell when `cellEditorPopup: true`. |
| `singleClickEdit` | `boolean` | `false` | Community | Column-level single-click edit; overrides the grid-level setting for this column. |
| `valueSetter` | `string \| ValueSetterFunc<TData, TValue>` | `undefined` | Community | Writes the parsed edit value back to row data. Return `true` if data changed. |
| `valueParser` | `string \| ValueParserFunc<TData, TValue>` | `undefined` | Community | Converts the raw string from the editor to the correct type before `valueSetter`. |
| `useValueParserForImport` | `boolean` | `true` | Community | Apply `valueParser` during clipboard paste and fill-handle operations. |
| `onCellValueChanged` | `(event: NewValueParams) => void` | `undefined` | Community | Column-level callback fired after a cell value changes (edit, paste, undo, etc.). |

### `ICellEditor` interface (custom editors)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `getValue()` | `() => TValue \| null \| undefined` | required | Community | Mandatory. Called by grid on edit stop to retrieve the new value. |
| `isCancelBeforeStart()` | `() => boolean` | `undefined` | Community | Optional. Return `true` to abort the edit immediately after init. |
| `isCancelAfterEnd()` | `() => boolean` | `undefined` | Community | Optional. Return `true` to discard the new value and leave row data unchanged. |
| `isPopup()` | `() => boolean` | `false` | Community | Optional. Return `true` to render the editor in a popup. |
| `getPopupPosition()` | `() => 'over' \| 'under' \| undefined` | `'over'` | Community | Optional. Position of popup if `isPopup()` returns `true`. |
| `afterGuiAttached()` | `() => void` | `undefined` | Community | Optional. Called after editor DOM is inserted; use for focus logic. |
| `refresh(params)` | `(params: ICellEditorParams) => void` | `undefined` | Community | Optional. Called when editor params update (e.g., data change while editing). |
| `focusIn()` | `() => void` | `undefined` | Community | Optional. Full-row edit only: grid calls this to give focus to the editor. |
| `focusOut()` | `() => void` | `undefined` | Community | Optional. Full-row edit only: grid calls this when focus moves away. |
| `getValidationElement(tooltip)` | `(tooltip: boolean) => HTMLElement` | `undefined` | Community | Optional. Returns element to receive validation styles or tooltip anchor. |
| `getValidationErrors()` | `() => string[] \| null` | `undefined` | Community | Optional. Returns current validation error messages. |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `startEditingCell` | `(params: StartEditingCellParams) => void` | Community | Programmatically start editing the specified cell. `StartEditingCellParams` includes `rowIndex`, `colKey`, `rowPinned?`, `key?`. |
| `stopEditing` | `(cancel?: boolean) => void` | Community | Stop any active edit. Pass `true` to cancel (discard new value). |
| `getEditingCells` | `() => EditingCellPosition[]` | Community | Returns the list of cells currently in edit mode. Use `colId` for column identity; the `column` and `colKey` fields on the returned `EditingCellPosition` are deprecated. |
| `getEditRowValues` | `(rowNode: IRowNode) => Record<string, any> \| undefined` | Community | Returns pending edit values for a row during full-row edit. |
| `getCellEditorInstances` | `(params?: GetCellEditorInstancesParams) => ICellEditor[]` | Community | Returns live cell editor component instances, optionally filtered by column/row. |
| `isEditing` | `(cellPosition: CellPosition) => boolean` | Community | Returns `true` if the specified cell is currently being edited. |
| `validateEdit` | `() => ICellEditorValidationError[] \| null` | Community | Runs validation on all active editors; returns errors or `null` if valid. |
| `undoCellEditing` | `() => void` | Community | Reverts the most recent cell edit from the undo stack. Requires `UndoRedoEditModule`. |
| `redoCellEditing` | `() => void` | Community | Re-applies the most recently undone edit. Requires `UndoRedoEditModule`. |
| `getCurrentUndoSize` | `() => number` | Community | Returns the number of available undo operations. |
| `getCurrentRedoSize` | `() => number` | Community | Returns the number of available redo operations. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `cellEditingStarted` | `CellEditingStartedEvent { column, colDef, value, rowIndex, rowPinned, node, data }` | Community | A cell editor is activated (before editor mounts). |
| `cellEditingStopped` | `CellEditingStoppedEvent { column, colDef, oldValue, newValue, valueChanged, rowIndex, rowPinned, node, data }` | Community | A cell editor is closed; `valueChanged` indicates whether the value changed. |
| `cellValueChanged` | `CellValueChangedEvent { column, colDef, oldValue, newValue, newRawValue, source, rowIndex, node, data }` | Community | A cell's data value changed (edit, paste, undo, redo, or fill handle); `source` identifies origin. |
| `cellEditRequest` | `CellEditRequestEvent { column, colDef, oldValue, newValue, source, rowIndex, node, data }` | Community | Fired instead of committing when `readOnlyEdit: true`; app is responsible for updating data. |
| `rowEditingStarted` | `RowEditingStartedEvent { node, rowIndex, rowPinned, data }` | Community | Full-row edit mode: all editors in the row become active. |
| `rowEditingStopped` | `RowEditingStoppedEvent { node, rowIndex, rowPinned, data }` | Community | Full-row edit mode: row editing ends. |
| `rowValueChanged` | `RowValueChangedEvent { node, rowIndex, rowPinned, data }` | Community | Full-row edit mode: at least one cell value changed when the row editing stopped. |
| `undoStarted` | `UndoStartedEvent { source: 'api' \| 'ui' }` | Community | An undo operation begins. |
| `undoEnded` | `UndoEndedEvent { source: 'api' \| 'ui', operationPerformed: boolean }` | Community | An undo operation completes; `operationPerformed` is `false` if stack was empty. |
| `redoStarted` | `RedoStartedEvent { source: 'api' \| 'ui' }` | Community | A redo operation begins. |
| `redoEnded` | `RedoEndedEvent { source: 'api' \| 'ui', operationPerformed: boolean }` | Community | A redo operation completes; `operationPerformed` is `false` if stack was empty. |

## Behaviors / interactions

**Built-in editor types and their params:**

- **`agTextCellEditor`** (Community) — simple `<input type="text">`. No special `cellEditorParams` beyond shared `ICellEditorParams`.
- **`agLargeTextCellEditor`** (Community) — `<textarea>`; popup by default. `cellEditorParams`: `{ maxLength: number (default 200), rows: number (default 10), cols: number (default 60) }`.
- **`agSelectCellEditor`** (Community) — native `<select>`. `cellEditorParams`: `{ values: TValue[], valueListGap?: number, valueListMaxHeight?: number|string, valueListMaxWidth?: number|string }`.
- **`agNumberCellEditor`** (Community) — numeric `<input type="number">`. `cellEditorParams`: `{ min?, max?, precision?, step?, showStepperButtons?: boolean, preventStepping?: boolean }`.
- **`agDateCellEditor`** (Community) — `<input type="date">` or `<input type="datetime-local">`. Uses `dateComponent` / `dateComponentParams` from `ColDef` for custom date pickers.
- **`agDateStringCellEditor`** (Community) — date editor that stores value as a string in `'yyyy-mm-dd'` format. `cellEditorParams`: `{ min?: string|Date, max?: string|Date, step?, includeTime?: boolean }`.
- **`agCheckboxCellEditor`** (Community) — renders a checkbox; value is `boolean`.
- **`agRichSelectCellEditor`** (Enterprise, `RichSelectModule`) — virtualised dropdown with search, multi-select, and async value loading. Key `cellEditorParams` (from `IRichCellEditorParams`): `values`, `valuesPage` (paged async datasource), `cellRenderer`, `searchType: 'match'|'matchAny'|'fuzzy'`, `allowTyping`, `filterList`, `multiSelect`, `highlightMatch`.

**`cellEditorSelector` vs `cellEditor`:** `cellEditorSelector` is called for every row and can return a
different editor component and params per row. It takes precedence over `cellEditor` / `cellEditorParams`.
The returned `{ component, params, popup, popupPosition }` mirrors the corresponding `ColDef` options.

**Popup editors:** Setting `cellEditorPopup: true` (or returning `isPopup(): true` from a custom editor)
renders the editor in an overlay that is not clipped by the cell boundary. The popup is positioned
`'over'` the cell by default; set `cellEditorPopupPosition: 'under'` to leave the original value visible.

**`valueSetter` / `valueParser` pipeline:**
1. Editor closes → `getValue()` returns raw editor value.
2. `valueParser` converts the raw value to the target type (e.g., string `'42'` → number `42`).
3. `valueSetter` writes the parsed value to `rowData`. It must return `true` if the data changed;
   returning `false` suppresses `cellValueChanged`.
4. If neither `valueSetter` nor `valueParser` is provided, the grid directly assigns the value to
   `data[colDef.field]`.

**Full-row edit mode (`editType: 'fullRow'`):** All editable columns in the row become active together.
Tab moves between cells within the row. Pressing Enter or clicking outside commits all pending values.
`getFullRowEditValidationErrors` can validate the entire row before commit; returning errors and setting
`invalidEditValueMode: 'block'` keeps editors open.

**Undo / redo stack:** Each committed edit is pushed onto a bounded stack (`undoRedoCellEditingLimit`,
default 10). `Ctrl+Z` / `api.undoCellEditing()` walks back; `Ctrl+Y` / `api.redoCellEditing()` replays.
The stack is cleared when a transaction or `rowData` replacement occurs externally.

**`readOnlyEdit` (immutable data pattern):** When `true`, the grid never writes to `rowData` directly.
Instead it fires `cellEditRequest` with `oldValue`, `newValue`, and `source`. The application is expected
to process the request and push a delta transaction back to the grid. This decouples the grid from the
store. See `04-data-updates.md` for the transaction API.

**Validation:** Custom editors can implement `getValidationErrors()` to return error messages. The grid
calls `api.validateEdit()` (or automatically during commit when `invalidEditValueMode: 'block'`) and
exposes validation feedback via `getValidationElement()`.

## Look & feel

_Planned screenshot `06-cell-editing-popup-editor-open.png` could not be captured — no columns have `editable: true` configured in the showcase grid._

## Canvas-port implications

- Each built-in editor type (`agTextCellEditor`, `agNumberCellEditor`, etc.) must have a canvas-layer
  equivalent. Text and number editors can be thin DOM overlays positioned over the canvas cell; rich-select
  requires a fully-custom dropdown component.
- `ICellEditor.getValue()`, `isCancelBeforeStart()`, `isCancelAfterEnd()` are lifecycle hooks that the
  canvas port must honour regardless of whether the editor is DOM or native-canvas.
- `valueSetter` / `valueParser` must remain pure JS callbacks; the canvas port should invoke the same
  pipeline as the DOM grid. The canvas engine must not skip the parser step even for built-in editors.
- Full-row edit means the canvas engine must simultaneously activate multiple cell editors with shared
  Tab-navigation — a significant coordination concern.
- `undoRedoCellEditing` requires a bounded stack at the application level; the canvas port must fire the
  same `undoStarted` / `undoEnded` / `redoStarted` / `redoEnded` events so host apps can show undo UI.
- `readOnlyEdit` is the recommended pattern for high-frequency real-time grids; the canvas port should
  treat this as a first-class mode (fire `cellEditRequest`, never mutate internal row data).
- Cross-reference: cell editing feeds into `04-data-updates.md` (transaction model) and consumes column
  identity from `02-column-model.md` (`field`, `valueSetter`, `valueParser`).
