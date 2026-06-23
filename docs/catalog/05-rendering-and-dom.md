# 05 — Rendering & DOM

## Concept

AG Grid is a virtualised, DOM-based grid. It renders only the cells visible in the viewport (plus a
configurable buffer) using an absolute-positioned cell approach. Two independent virtualisation axes
control what gets rendered:

- **Row virtualisation** — only rows whose pixel range intersects the viewport (plus `rowBuffer`) are in
  the DOM. Other rows exist only as row nodes in the data model.
- **Column virtualisation** — only columns whose pixel range intersects the horizontal viewport are
  rendered. Hidden or out-of-range columns are not in the DOM.

Layout mode (`domLayout`) controls how the grid container is sized. Cell rendering is delegated to
**cell renderers**: built-in defaults or custom components that receive `ICellRendererParams` and return
HTML. Full-width rows escape the column grid and span the entire row width.

## Configuration surface

### Row virtualisation

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `rowBuffer` | `number` | `10` | Community | Number of extra rows rendered above and below the visible viewport. Runtime-mutable. |
| `suppressRowVirtualisation` | `boolean` | `false` | Community | Renders all rows regardless of scroll position. **Severe performance impact on large datasets.** Initial-only. |
| `suppressMaxRenderedRowRestriction` | `boolean` | `false` | Community | Removes the 500-row cap when row virtualisation is disabled. Initial-only. |
| `suppressAnimationFrame` | `boolean` | `false` | Community | Disables async animation-frame scheduling for row rendering during scroll. Initial-only. |

### Column virtualisation

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `suppressColumnVirtualisation` | `boolean` | `false` | Community | Renders all columns regardless of horizontal scroll position. Initial-only. |

### Row height

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `rowHeight` | `number` | `25` | Community | Default row height in pixels; applies to all rows unless overridden. Runtime-mutable. |
| `getRowHeight` | `GetRowHeight<TData>` | `undefined` | Community | Per-row callback returning a pixel height or `null`/`undefined` for default. Runtime-mutable. |
| `domLayout` | `'normal' \| 'autoHeight' \| 'print'` | `'normal'` | Community | Controls grid container height behaviour (see below). Runtime-mutable. |
| `ensureDomOrder` | `boolean` | `false` | Community | Forces DOM order to match visual row/column order; disables row animations. Initial-only. |
| `suppressRowTransform` | `boolean` | `false` | Community | Uses CSS `top` instead of `transform` for row positioning. Initial-only. |

### DOM layout modes

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `domLayout` | `'normal'` | `'normal'` | Community | Grid fills its container; scrollbars appear as needed. |
| `domLayout` | `'autoHeight'` | — | Community | Grid grows in height to show all rows; no vertical scrollbar. |
| `domLayout` | `'print'` | — | Community | All rows visible; disables virtualisation; suitable for `window.print()`. |

### Full-width rows

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `isFullWidthRow` | `IsFullWidthRow<TData>` | `undefined` | Community | Callback returning `true` for rows that should span the full width. |
| `fullWidthCellRenderer` | `any` | `undefined` | Community | Cell renderer component used for full-width rows. |
| `fullWidthCellRendererParams` | `any` | `undefined` | Community | Params passed to `fullWidthCellRenderer`. |
| `embedFullWidthRows` | `boolean` | `undefined` | Community | Embeds full-width rows inside the grid scroll container so they scroll horizontally. |

### Cell renderer configuration (ColDef)

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `cellRenderer` | `any` | `undefined` | Community | Cell renderer component, function, or key. |
| `cellRendererParams` | `any` | `undefined` | Community | Static params passed to `cellRenderer`. |
| `cellRendererSelector` | `CellRendererSelectorFunc<TData, TValue>` | `undefined` | Community | Per-row callback returning `{ component, params }` for dynamic renderer selection. |
| `enableCellChangeFlash` | `boolean` | `false` | Community | Flashes the cell when its rendered value changes. |
| `autoHeight` | `boolean` | `false` | Community | Expands row height to fit this column's content. |
| `wrapText` | `boolean` | `false` | Community | Enables CSS `white-space: normal` inside the cell. |

### Scrolling & animation

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `animateRows` | `boolean` | `true` | Community | Animates rows sliding to new positions after sort/filter. Runtime-mutable. |
| `suppressScrollOnNewData` | `boolean` | `false` | Community | Prevents auto-scroll to top when new row data is set. Runtime-mutable. |
| `alwaysShowHorizontalScroll` | `boolean` | `false` | Community | Always shows the horizontal scrollbar. Runtime-mutable. |
| `alwaysShowVerticalScroll` | `boolean` | `false` | Community | Always shows the vertical scrollbar. Runtime-mutable. |
| `debounceVerticalScrollbar` | `boolean` | `false` | Community | Debounces vertical scroll events for smoother experience on slow hardware. Initial-only. |
| `suppressHorizontalScroll` | `boolean` | `false` | Community | Hides the horizontal scrollbar. Runtime-mutable. |
| `suppressScrollWhenPopupsAreOpen` | `boolean` | `false` | Community | Prevents scroll while a popup (context/column menu) is open. Runtime-mutable. |

## API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `refreshCells` | `(params?: RefreshCellsParams<TData>) => void` | Community | Re-renders specified cells in place (calls `refresh()` on renderers). |
| `redrawRows` | `(params?: RedrawRowsParams<TData>) => void` | Community | Destroys and recreates specified rows from scratch. |
| `flashCells` | `(params?: FlashCellsParams<TData>) => void` | Community | Triggers flash animation on specified cells. |
| `getCellRendererInstances` | `(params?: GetCellRendererInstancesParams<TData>) => ICellRenderer[]` | Community | Returns live cell renderer instances (useful for calling renderer methods). |
| `getRenderedNodes` | `() => IRowNode<TData>[]` | Community | Returns row nodes that are currently rendered (viewport + buffer). |
| `getFirstDisplayedRowIndex` | `() => number` | Community | Index of the first row in the rendered viewport. |
| `getLastDisplayedRowIndex` | `() => number` | Community | Index of the last row in the rendered viewport. |
| `ensureIndexVisible` | `(index: number, position?) => void` | Community | Scrolls vertically until row `index` is visible. |
| `ensureNodeVisible` | `(nodeSelector, position?) => void` | Community | Scrolls until the specified row node is visible. |
| `ensureColumnVisible` | `(key, position?) => void` | Community | Scrolls horizontally until the specified column is visible. |
| `getVerticalPixelRange` | `() => { top: number, bottom: number }` | Community | Returns current vertical scroll range in pixels. |
| `getHorizontalPixelRange` | `() => { left: number, right: number }` | Community | Returns current horizontal scroll range in pixels. |
| `resetRowHeights` | `() => void` | Community | Forces recalculation of all row heights. |
| `onRowHeightChanged` | `() => void` | Community | Signals that a specific row node's height has changed manually. |

## Events

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| `viewportChanged` | `ViewportChangedEvent { firstRow: number, lastRow: number }` | Community | The set of visible rows changes due to scrolling or resize. |
| `firstDataRendered` | `FirstDataRenderedEvent { firstRow: number, lastRow: number }` | Community | The first time rows are rendered in the DOM after data loads. |
| `virtualRowRemoved` | `VirtualRowRemovedEvent` | Community | A virtualised row is removed from the DOM (scrolled out of view). |
| `virtualColumnsChanged` | `VirtualColumnsChangedEvent { afterScroll: boolean }` | Community | The set of virtually rendered columns changes. |
| `gridSizeChanged` | `GridSizeChangedEvent { clientWidth, clientHeight }` | Community | The grid container is resized. |
| `bodyScrollEnd` | `BodyScrollEndEvent` | Community | Scrolling in the grid body has stopped. |
| `bodyScroll` | `BodyScrollEvent` | Community | Scroll event on the grid body (fires frequently during scroll). |

## Behaviors / interactions

### Row virtualisation

The grid maintains a rendered row window of `viewport_rows + 2 * rowBuffer`. As the user scrolls, rows
entering the window are created and rows leaving it are destroyed. The `suppressAnimationFrame` option
controls whether this work is batched via `requestAnimationFrame` (default) or done synchronously;
synchronous rendering can cause visible jank on large datasets.

When `suppressRowVirtualisation: true`, all rows are rendered simultaneously. The 500-row safety cap
(`suppressMaxRenderedRowRestriction`) still applies unless also disabled. This mode is intended only for
print layouts or very small datasets.

### Column virtualisation

The grid tracks the horizontal scroll offset and renders only columns whose left + width overlaps the
visible horizontal range. `suppressColumnVirtualisation` disables this and keeps all columns in the DOM.
Useful for accessibility (screen readers need all cells in DOM order) or when a CSS-based layout relies
on all columns being present.

### DOM layout modes

- **`normal`**: grid is inside a container with a fixed height (set via CSS). Vertical and horizontal
  scrollbars appear as needed. This is the standard production mode.
- **`autoHeight`**: the grid body grows to show all rows. There is no vertical scrollbar. Column
  virtualisation still applies. Use with caution — thousands of rows will create very tall pages.
- **`print`**: both row and column virtualisation are disabled. All rows are rendered, no scrollbars.
  Intended for `window.print()` usage; the page prints all rows.

### Full-width rows

When `isFullWidthRow` returns `true` for a row, the grid renders a single cell spanning the full width
using `fullWidthCellRenderer`. Full-width rows do not participate in column layout. They scroll
vertically with the grid and (by default) do not scroll horizontally — use `embedFullWidthRows: true`
to make them scroll with the horizontal viewport.

### `ICellRendererComp` / `ICellRendererParams`

A cell renderer is an object implementing `ICellRendererComp`:

```typescript
interface ICellRendererComp<TData = any> {
  // Called once: return the DOM element to place inside the cell container.
  init?(params: ICellRendererParams<TData>): void;
  getGui(): HTMLElement;
  // Called when the cell value changes. Return true if handled, false to let grid refresh.
  refresh(params: ICellRendererParams<TData>): boolean;
  // Called when the cell is removed from the DOM.
  destroy?(): void;
}

interface ICellRendererParams<TData = any, TValue = any> {
  value: TValue | null | undefined;          // Raw cell value (from valueGetter)
  valueFormatted: string | null | undefined; // Formatted value (from valueFormatter)
  data: TData | undefined;                   // Full row data object
  node: IRowNode<TData>;                     // Row node
  colDef?: ColDef<TData, TValue>;            // Column definition
  column?: Column<TValue>;                   // Column instance
  eGridCell: HTMLElement;                    // The cell's container div
  eParentOfValue: HTMLElement;               // Parent element (same as eGridCell unless checkbox)
  getValue?: () => TValue | null | undefined;
  setValue?: (value: TValue | null | undefined) => void;
  formatValue?: (value: TValue | null | undefined) => string;
  refreshCell?: () => void;
}
```

`refresh()` is called by `refreshCells()` before destroying and recreating the renderer. If `refresh()`
returns `false`, the grid replaces the renderer entirely.

### `valueGetter` vs `cellRenderer` separation

`valueGetter` produces the raw data value used for sorting, filtering, aggregation, and export.
`valueFormatter` converts that value to a human-readable string.
`cellRenderer` controls the DOM content of the cell and receives both `value` and `valueFormatted`.

A cell renderer that returns different text than `valueFormatted` does not affect sort/filter results.
This separation is by design: changing display logic must not silently corrupt data operations.

### `cellRendererSelector`

When rows within the same column need different renderers (e.g. group rows vs leaf rows), use
`cellRendererSelector`. The callback receives `ICellRendererSelectorParams` and returns
`{ component, params }` or `undefined` (to use the default `cellRenderer`).

### Dynamic row heights

`getRowHeight` is called for each row after data is loaded. If it returns `null` or `undefined`, the
default `rowHeight` applies. After row data changes, call `api.resetRowHeights()` to prompt the grid to
recompute heights and layout. For a single row change, call `rowNode.setRowHeight(px)` then
`api.onRowHeightChanged()`.

## Look & feel

_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._

## Canvas-port implications

- Row and column virtualisation are the foundational rendering concerns of the canvas port. The canvas
  engine must implement its own dirty-tile system that mirrors the DOM grid's render-window concept
  (`rowBuffer` analogues as overscan in pixels or rows).
- `ICellRendererComp` with `init()` / `getGui()` / `refresh()` / `destroy()` has no canvas equivalent.
  The canvas port needs a typed cell-paint interface that receives the same logical params (`value`,
  `valueFormatted`, style) and writes to a `CanvasRenderingContext2D` clip region instead.
- `cellRendererSelector` is a critical feature: different row types (group, leaf, loading, full-width)
  need different paint strategies. The canvas port must support a per-cell paint-function selector.
- `domLayout: 'autoHeight'` and `'print'` are inherently DOM concepts. The canvas port likely supports
  only the `'normal'` fixed-height model; `autoHeight` would require measuring all rows and then sizing
  the canvas — possible but unusual. Q: is auto-height a requirement for the canvas port?
- `ensureIndexVisible` and `ensureNodeVisible` must be implemented as scroll-position calculations. In
  canvas these are native `scrollTop`/`scrollLeft` adjustments on the scroll container, not DOM
  element focus.
- `virtualRowRemoved` / `viewportChanged` events are critical hooks for canvas tile lifecycle: when a
  row leaves the viewport, its tile can be released; when it enters, a paint job is scheduled.
- Full-width rows require a special paint mode: a single painter spans the full row width, bypassing the
  column layout pipeline. Q: does the canvas port need full-width rows (e.g. for master/detail)?
- Column sizing options (`width`, `flex`, `minWidth`, `maxWidth`) are detailed in `02-column-model.md`
  and drive the column layout pass that the canvas renderer depends on.
