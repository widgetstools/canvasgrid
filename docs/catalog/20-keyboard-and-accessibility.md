# 20 — Keyboard & Accessibility

## Concept

AG Grid implements a full keyboard navigation model based on the ARIA grid pattern. The grid wrapper carries `role="treegrid"` or `role="grid"`, header cells carry `role="columnheader"`, body cells carry `role="gridcell"` (or a custom role via `cellAriaRole`), and rows carry `role="row"`. Focus management follows ARIA composite widget conventions: Tab moves focus into/out of the grid; arrow keys navigate within the grid.

Navigation defaults can be overridden via callbacks (`navigateToNextCell`, `tabToNextCell`, `navigateToNextHeader`, `tabToNextHeader`). Individual cells can be excluded from keyboard navigation via `suppressNavigable` on `ColDef`.

Cross-reference: `suppressNavigable` and `suppressKeyboardEvent` are documented in `02-column-model.md`.

## Configuration surface

### Navigation callbacks

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `navigateToNextCell` | `NavigateToNextCell<TData>` | `undefined` | Community | Override arrow-key cell navigation. `(params: NavigateToNextCellParams) => CellPosition \| null`. Return `null` to stay on current cell. |
| `tabToNextCell` | `TabToNextCell<TData>` | `undefined` | Community | Override Tab/Shift+Tab cell navigation. `(params: TabToNextCellParams) => CellPosition \| boolean`. Return `false` to let browser handle Tab. |
| `navigateToNextHeader` | `NavigateToNextHeader<TData>` | `undefined` | Community | Override arrow-key navigation when a header cell is focused. `(params: NavigateToNextHeaderParams) => HeaderPosition \| null`. |
| `tabToNextHeader` | `TabToNextHeader<TData>` | `undefined` | Community | Override Tab navigation in the header row. `(params: TabToNextHeaderParams) => HeaderPosition \| boolean`. |
| `tabToNextGridContainer` | `TabToNextGridContainer<TData>` | `undefined` | Community | Override tab behaviour when moving between major grid containers (cells, headers, side bar, status bar). Returns a container name, `CellPosition`, `HeaderPosition`, `true` (stay), `false` (browser handles), or `undefined` (default). |
| `focusGridInnerElement` | `FocusGridInnerElement<TData>` | `undefined` | Community | Called when focus arrives at the grid from outside. Return `true` to indicate the focus was handled; grid default (focus first cell or last focused cell) is suppressed. |

### Enter / editing navigation

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `enterNavigatesVertically` | `boolean` | `false` | Community | Pressing Enter in an edited cell navigates to the next cell below (Excel style). |
| `enterNavigatesVerticallyAfterEdit` | `boolean` | `false` | Community | Enter-navigation applies only after a cell has been edited. Requires `enterNavigatesVertically: true`. |
| `suppressClickEdit` | `boolean` | `false` | Community | Disables single-click to start editing; double-click or Enter required. |

### Focus suppression

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `suppressCellFocus` | `boolean` | `false` | Community | Prevents the grid from managing cell focus (no focus ring on cells). Keyboard navigation is disabled. |
| `suppressHeaderFocus` | `boolean` | `false` | Community | Prevents focus from moving into column header cells. |
| `tabIndex` | `number` | `0` | Community | Sets the `tabindex` attribute on the grid container element, controlling where the grid falls in the page tab order. |

### Cell text selection

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `enableCellTextSelection` | `boolean` | `false` | Community | Allows text inside cells to be selected with the mouse (native browser selection). When `true`, the clipboard service is disabled and only selected text is copied. |

### DOM order for screen readers

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `ensureDomOrder` | `boolean` | `false` | Community | Guarantees that the DOM order of rows matches their visual/logical order. Required for correct screen-reader row traversal. Disables row animations. Initial. |

### Aria customisation

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `cellAriaRole` | `string` | `'gridcell'` | Community | ColDef property — overrides the ARIA role of body cells in this column (e.g. `'rowheader'` for the first column). |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `getFocusedCell` | `() => CellPosition \| null` | Community | Returns the currently focused cell position (rowIndex, column, rowPinned). |
| `setFocusedCell` | `(rowIndex: number, colKey: string \| Column, rowPinned?: RowPinnedType) => void` | Community | Programmatically moves keyboard focus to the specified cell. |
| `clearFocusedCell` | `() => void` | Community | Removes keyboard focus from the grid. |
| `tabToNextCell` | `(event?: KeyboardEvent) => boolean` | Community | Programmatically advances focus to the next Tab cell. Returns `true` if focus moved. |
| `tabToPreviousCell` | `(event?: KeyboardEvent) => boolean` | Community | Programmatically moves focus to the previous Tab cell. Returns `true` if focus moved. |
| `setFocusedHeader` | `(colKey: string \| Column \| ColumnGroup, floatingFilter?: boolean) => void` | Community | Moves focus to the header cell for the given column or column group. |
| `setGridAriaProperty` | `(property: string, value: string \| null) => void` | Community | Sets or removes an `aria-*` attribute on the grid root element. E.g. `setGridAriaProperty('label', 'Positions grid')` sets `aria-label`. Pass `null` to remove. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `cellFocused` | `CellFocusedEvent { rowIndex: number \| null; column: Column \| string \| null; rowPinned: RowPinnedType; forceBrowserFocus: boolean; floating: RowPinnedType }` | Community | The focused cell changes (including programmatic focus changes). |
| `cellKeyDown` | `CellKeyDownEvent<TData> { event: KeyboardEvent \| null }` | Community | A key is pressed while a body cell is focused. Extend default behaviour here. |
| `fullWidthCellKeyDown` | `FullWidthCellKeyDownEvent<TData>` | Community | A key is pressed while a full-width row cell is focused. |
| `headerFocused` | `HeaderFocusedEvent { column: Column \| ColumnGroup; headerRowIndex: number }` | Community | A header cell receives keyboard focus. |

## Behaviors / interactions

**Default keyboard map:**

| Key | Context | Action |
|-----|---------|--------|
| Arrow keys | Cell focused | Move to adjacent cell in the direction pressed |
| Arrow keys | Header focused | Move to adjacent header |
| Tab | Cell focused | Move to next navigable cell (or exit grid if at last cell) |
| Shift+Tab | Cell focused | Move to previous navigable cell |
| Enter | Cell focused | Start editing the cell |
| Escape | Editing | Cancel edit and restore original value |
| Space | Row selection active | Toggle row selection |
| Page Up / Page Down | Cell focused | Jump one viewport height up or down |
| Home | Cell focused | Move to first cell in the row |
| End | Cell focused | Move to last cell in the row |
| Ctrl+Home | Cell focused | Move to first cell in the grid |
| Ctrl+End | Cell focused | Move to last cell in the grid |
| F2 | Cell focused | Start editing (same as Enter) |
| Delete / Backspace | Cell focused | Clear cell value (calls `valueSetter` with empty value) |

**`NavigateToNextCellParams` fields:**
- `key: string` — arrow key value (`'ArrowLeft'`, `'ArrowUp'`, `'ArrowRight'`, `'ArrowDown'`)
- `previousCellPosition: CellPosition`
- `nextCellPosition: CellPosition | null` — grid's default next cell
- `event: KeyboardEvent | null`

**`TabToNextCellParams` fields:**
- `backwards: boolean` — true when Shift+Tab
- `editing: boolean` — true when the current cell is in edit mode
- `previousCellPosition: CellPosition`
- `nextCellPosition: CellPosition | null`

**`suppressNavigable` on `ColDef`:** When `true`, the cell is skipped by arrow-key and Tab navigation. Accepts a callback `(params) => boolean` for per-row logic. See `02-column-model.md`.

**ARIA roles:** The grid assigns roles automatically. `role="grid"` or `role="treegrid"` on the wrapper; `role="row"` on each row; `role="columnheader"` on header cells; `role="gridcell"` on body cells (overridable per-column with `cellAriaRole`). Row group cells receive `role="rowheader"` by default to convey hierarchy.

**`setGridAriaProperty`:** Use to set `aria-label`, `aria-labelledby`, or `aria-describedby` on the grid container. This is the preferred way to label the grid for screen readers rather than wrapping in a `<label>`.

**`ensureDomOrder` and virtualisation:** When row virtualisation is active, only visible rows are in the DOM. Screen readers traversing the DOM will encounter only a window of rows. Set `ensureDomOrder: true` to ensure those rows are in logical order, but note that off-screen rows remain absent from the DOM. For full AT compatibility with large datasets, consider `domLayout: 'autoHeight'` (all rows rendered) at the cost of performance.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- The canvas port renders cells without real DOM elements for each cell, breaking the ARIA grid/row/gridcell role tree entirely. An accessibility overlay DOM layer (transparent HTML elements over the canvas cells) is required to preserve keyboard navigation and ARIA semantics.
- `getFocusedCell`/`setFocusedCell` must be implemented so that canvas-port consumers can drive programmatic focus for automation and testing.
- `navigateToNextCell` and `tabToNextCell` callbacks are configuration contracts; the canvas port must honour them so application-level navigation overrides work without modification.
- `cellKeyDown` events must bubble from the canvas event system; applications listening to `onCellKeyDown` for custom key bindings must not need to change their handlers.
- `setGridAriaProperty` provides an accessible label mechanism that is DOM-level; the canvas port can implement this by maintaining a visually hidden ARIA description element adjacent to the canvas.
- `enableCellTextSelection` conflicts with canvas rendering because text in a canvas is not selectable. The canvas port must document that this option is not available; apps requiring text selection should use a DOM cell renderer overlay.
