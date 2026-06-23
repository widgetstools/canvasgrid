# 19 — Context Menu & Clipboard

## Concept

AG Grid provides a right-click **context menu** (Enterprise) with built-in items for pinning, sorting, grouping, clipboard operations, and export. The menu is customisable via `getContextMenuItems`. Items can be default strings from the `DefaultMenuItem` union type, or custom `MenuItemDef` objects including sub-menus and custom renderer components.

**Clipboard** operations are Enterprise-tier. The grid provides copy/paste of the focused cell, selected rows, or cell ranges to the system clipboard. Processing callbacks are available to transform cell values during clipboard operations.

## Configuration surface

### Context menu

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `suppressContextMenu` | `boolean` | `false` | Community | Disables the grid's right-click context menu entirely. Use `onCellContextMenu` to implement a custom handler. |
| `getContextMenuItems` | `GetContextMenuItems<TData>` | `undefined` | Enterprise | Callback `(params: GetContextMenuItemsParams) => (DefaultMenuItem \| MenuItemDef \| 'separator')[]`. Return the list of items to show. Returning `[]` suppresses the menu. Requires `ContextMenuModule`. |
| `preventDefaultOnContextMenu` | `boolean` | `false` | Enterprise | Prevents the browser's native context menu from appearing when right-clicking the grid. |

### `MenuItemDef` shape

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `name` | `string` | required | Enterprise | Display name of the item. |
| `disabled` | `boolean` | `false` | Enterprise | Renders the item greyed out and non-interactive. |
| `shortcut` | `string` | `undefined` | Enterprise | Shortcut hint text displayed next to the name. Does not create a keyboard binding. |
| `action` | `(params: IMenuActionParams) => void` | `undefined` | Enterprise | Function called when the item is selected. |
| `checked` | `boolean` | `false` | Enterprise | Renders a check mark beside the item. |
| `icon` | `Element \| string` | `undefined` | Enterprise | DOM element or HTML string for a leading icon. |
| `cssClasses` | `string[]` | `undefined` | Enterprise | Additional CSS classes on the menu item element. |
| `tooltip` | `string` | `undefined` | Enterprise | Tooltip text on hover. |
| `subMenu` | `(MenuItemDef \| string)[]` | `undefined` | Enterprise | Child items; presence of this property makes the item open a sub-menu. |
| `subMenuRole` | `'menu' \| 'listbox' \| 'tree' \| 'grid' \| 'dialog'` | `'menu'` | Enterprise | ARIA role for the sub-menu element. |
| `menuItem` | `any` | `undefined` | Enterprise | Custom menu item component (`IMenuItemComp`). |
| `menuItemParams` | `any` | `undefined` | Enterprise | Params forwarded to the custom `menuItem` component. |
| `suppressCloseOnSelect` | `boolean` | `false` | Enterprise | Keeps the menu open after selecting this item. |

### Default menu item identifiers (`DefaultMenuItem`)

The following string literals can be returned from `getContextMenuItems` to include built-in items:

`'copy'`, `'copyWithHeaders'`, `'copyWithGroupHeaders'`, `'cut'`, `'paste'`, `'export'`, `'csvExport'`, `'excelExport'`, `'separator'`, `'pinSubMenu'`, `'pinLeft'`, `'pinRight'`, `'clearPinned'`, `'autoSizeThis'`, `'autoSizeAll'`, `'resetColumns'`, `'expandAll'`, `'contractAll'`, `'rowGroup'`, `'rowUnGroup'`, `'valueAggSubMenu'`, `'sortAscending'`, `'sortDescending'`, `'sortUnSort'`, `'columnFilter'`, `'columnChooser'`, `'chartRange'`, `'pivotChart'`.

### Clipboard

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `copyHeadersToClipboard` | `boolean` | `false` | Enterprise | Include column header row when copying via `Ctrl+C`. Requires `ClipboardModule`. |
| `copyGroupHeadersToClipboard` | `boolean` | `false` | Enterprise | Include column group header rows when copying via `Ctrl+C`. Requires `ClipboardModule`. |
| `clipboardDelimiter` | `string` | `'\t'` | Enterprise | Field separator used when copying to and pasting from clipboard. Requires `ClipboardModule`. |
| `suppressLastEmptyLineOnPaste` | `boolean` | `false` | Enterprise | Strips the trailing empty line Excel adds on Windows when pasting. Requires `ClipboardModule`. |
| `suppressClipboardPaste` | `boolean` | `false` | Enterprise | Disables clipboard paste operations. Requires `ClipboardModule`. |
| `suppressClipboardApi` | `boolean` | `false` | Enterprise | Prevents use of the async Clipboard API; falls back to the execCommand workaround immediately. Requires `ClipboardModule`. |
| `suppressCutToClipboard` | `boolean` | `false` | Enterprise | Blocks cut operations. Requires `ClipboardModule`. |
| `processCellForClipboard` | `ProcessCellForClipboard<TData>` | `undefined` | Enterprise | Callback to transform cell values before writing to the clipboard (e.g. format Dates). |
| `processHeaderForClipboard` | `ProcessHeaderForClipboard<TData>` | `undefined` | Enterprise | Callback to transform column header text before writing to the clipboard. |
| `processGroupHeaderForClipboard` | `ProcessGroupHeaderForClipboard<TData>` | `undefined` | Enterprise | Callback to transform column group header text before writing to the clipboard. |
| `processCellFromClipboard` | `ProcessCellFromClipboard<TData>` | `undefined` | Enterprise | Callback to transform pasted values before they enter the grid (e.g. block non-numeric input). |
| `sendToClipboard` | `SendToClipboard<TData>` | `undefined` | Enterprise | Intercept the clipboard write; receive the tab-separated string and handle it yourself instead. |
| `processDataFromClipboard` | `ProcessDataFromClipboard<TData>` | `undefined` | Enterprise | Full control of the paste operation; receives the raw 2-D array of pasted cells. Return a modified array or `null` to cancel. |

### Deprecated clipboard options

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `suppressCopyRowsToClipboard` | `boolean` | `false` | Community | **Deprecated v32.2.** Use `rowSelection.copySelectedRows` instead. Copies the cell range or focused cell to the clipboard, bypassing row-selection copy behaviour. |
| `suppressCopySingleCellRanges` | `boolean` | `false` | Community | **Deprecated v32.2.** Use `rowSelection.copySelectedRows` instead. Copies rows when the selection is a single-cell range instead of copying the range. |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `copyToClipboard` | `(params?: IClipboardCopyParams) => void` | Enterprise | Copies the focused cell or selected rows to the clipboard. `IClipboardCopyParams`: `{ includeHeaders?, includeGroupHeaders? }`. |
| `cutToClipboard` | `(params?: IClipboardCopyParams) => void` | Enterprise | Copies and then clears the focused cell or selected rows. |
| `copySelectedRowsToClipboard` | `(params?: IClipboardCopyRowsParams) => void` | Enterprise | Copies selected rows to the clipboard. `IClipboardCopyRowsParams` adds `columnKeys` to restrict columns. |
| `copySelectedRangeToClipboard` | `(params?: IClipboardCopyParams) => void` | Enterprise | Copies the current cell-range selection to the clipboard. Requires `CellSelectionModule`. |
| `copySelectedRangeDown` | `() => void` | Enterprise | Fills values downward within the selected range (Excel-style fill-down). |
| `pasteFromClipboard` | `() => void` | Enterprise | Programmatically triggers a clipboard paste into the focused cell or range. |
| `showContextMenu` | `(params?: ShowContextMenuParams) => void` | Enterprise | Programmatically opens the context menu at an optional position. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `contextMenuVisibleChanged` | `ContextMenuVisibleChangedEvent { visible: boolean; source: 'api' \| 'ui' }` | Enterprise | The context menu appears or disappears. |
| `cutStart` | `CutStartEvent { source: 'api' \| 'ui' \| 'contextMenu' }` | Enterprise | A cut operation begins. |
| `cutEnd` | `CutEndEvent { source: 'api' \| 'ui' \| 'contextMenu' }` | Enterprise | A cut operation completes. |
| `pasteStart` | `PasteStartEvent { source: string }` | Enterprise | A paste operation begins. |
| `pasteEnd` | `PasteEndEvent { source: string }` | Enterprise | A paste operation completes (after all cells have been updated). |

## Behaviors / interactions

**Menu construction order:** `getContextMenuItems` receives a `GetContextMenuItemsParams` containing `defaultItems` (the array the grid would show by default) and the target `column`, `node`, and `value`. Implementations typically spread `defaultItems` and splice in custom entries.

**`separator` string:** Returning `'separator'` in the items array inserts a visual dividing line. Consecutive separators are collapsed to one.

**Range copy vs row copy:** When no Enterprise range selection module is loaded, `Ctrl+C` copies the focused cell or selected rows. When `CellSelectionModule` (Enterprise) is present and a range exists, it copies the range. `copyToClipboard` follows the same logic.

**`processCellForClipboard`:** This callback fires for every cell written to the clipboard. It is the correct place to format Dates, Decimal types, or mask sensitive values.

**`sendToClipboard`:** When set, the grid never writes to the system clipboard itself. The callback receives the completed tab-delimited string; the app must call `navigator.clipboard.writeText` or equivalent.

**Keyboard shortcuts:** `Ctrl+C` (copy), `Ctrl+X` (cut), `Ctrl+V` (paste). These are handled by the grid's keyboard event system and respect `suppressClipboardPaste` and `suppressCutToClipboard`.

**Custom menu item components (`IMenuItemComp`):** Implement `init(params: IMenuItemParams)`, `getGui()`, and optionally `select()`, `setActive(active)`, `setExpanded(expanded)`. Use `configureDefaults()` to opt in or out of grid-provided styling, mouse handling, and keyboard behaviour.

## Look & feel

![Default context menu on cell right-click](screenshots/19-context-menu-default.png) — Default AG Grid context menu appearing on right-click of a group cell, showing Cut, Copy, Copy with Headers, Copy with Group Headers, Paste, and Export sub-menu items.

## Canvas-port implications

- The context menu is a DOM overlay; it can be retained as-is in the canvas port. The `getContextMenuItems` callback API must remain identical so app-level menu configurations transfer without change.
- `copyToClipboard` and `processCellForClipboard` are Community and must be implemented in the canvas port's clipboard service. The canvas port reads cell values from the same `valueGetter`/`valueFormatter` pipeline (see `02-column-model.md`).
- `copySelectedRangeToClipboard` depends on a cell-range selection model. The canvas port needs an equivalent range model to support this Enterprise path.
- `processDataFromClipboard` provides full paste control; the canvas port's paste handler must invoke this callback before applying any cell updates.
- `sendToClipboard` is the escape hatch for apps that need to sanitise or redirect clipboard data; the canvas port must call this hook rather than writing directly to the browser clipboard when it is configured.
