# Hypergrid Audit — Models + Cell Renderers + Cell Editors + Theme

Source: `/Users/develop/wfh/hypergrid/src/behaviors/`, `src/cellRenderers/`, `src/cellEditors/`, `src/defaults.js`. Captured 2026-06-23.

## 1. Behavior + DataModel contract

`Behavior` is the controller sitting between grid and dataModel. DataModel interface (the only methods that matter for our port):

- `getRowCount()` → number
- `getValue(x, y)` → unknown (col, row coords)
- `setValue(x, y, value)` → void
- `getRow(y)` → record
- `getSchema()` → ColumnSchema[]
- `setSchema(schema)` → void
- `apply()` → void (re-index, e.g., after sort/filter)

For cgrid we'll keep our Web Worker pipeline; the worker plays the role of an async DataModel.

## 2. Column model (`src/behaviors/Column.js`, `columnProperties.js`)

```javascript
function Column(behavior, columnSchema) {
  // columnSchema = { index, name, header?, calculator?, type? }
  Object.defineProperties(this, {
    index: { value: columnSchema.index },
    name:  { enumerable: true, value: columnSchema.name || columnSchema.index.toString() }
  });
  this.properties = this.schema = columnSchema;
}
```

Column properties via prototype chain (`columnProperties.js`):
```javascript
properties = Object.create(tableState, {
  index:      { get: () => column.index },
  name:       { get: () => column.name },
  header:     { get: () => column.header,     set: v => column.header = v },
  type, calculator, format, …                  // all getters/setters
});
```

Defaults cascade: `grid.properties → column.properties → cell properties`. Hypergrid uses prototype inheritance, no merge step.

## 3. Cell renderer registry (`src/cellRenderers/index.js`)

Built-in renderers: `Button`, `SimpleCell`, `SliderCell`, `SparkBar`, `LastSelection`, `SparkLine`, `ErrorCell`, `Tag`, `TreeCell`. Lookup by name string.

Paint contract:
```javascript
paint: function(gc, config) {
  // READ:
  //   config.value, config.bounds {x,y,width,height}
  //   config.isSelected, config.isCellHovered, config.isColumnSelected
  //   config.font, config.color, config.backgroundColor
  //   config.prefillColor      // what's already painted at this rect
  //   config.snapshot          // for partial-render optimization
  //   config.dataCell, config.gridCell
  // WRITE:
  //   config.clickRect         // hit zone in cell-local coords
  //   config.minWidth          // preferred width (also returned)
  // RETURN: preferred pixel width
}
```

`SimpleCell` (the default):
```javascript
paint: function(gc, config) {
  var val = config.value;
  var bounds = config.bounds;
  if (val && val.constructor === Array) { leftIcon = val[0]; val = config.exec(val[1]); … }
  val = config.formatValue(val, config);
  textFont = config.isSelected ? config.foregroundSelectionFont : config.font;
  // snapshot optimization: if val + font + bg + selected unchanged, skip text render
  same = same && val === snapshot.value && textFont === snapshot.textFont;
  // … fill background (if not prefilled), draw icons, draw text
}
```

## 4. Cell editors (`src/cellEditors/CellEditor.js`)

DOM-overlaid, not canvas-drawn:
```javascript
initialize: function(grid, options) {
  this.grid = grid;
  this.initialValue = value;
  var container = document.createElement('DIV');
  container.innerHTML = this.grid.modules.templater.render(this.template, this);
  this.el = container.firstChild;
  this.input = this.el;       // or input inside el
  this.el.addEventListener('keyup', this.keyup.bind(this));
  this.el.addEventListener('mousedown', this.onmousedown.bind(this));
}
```

Lifecycle:
- **Open:** `beginEditing()` → `checkEditor()` → position on canvas
- **Commit:** Enter key → `stopEditing()` → write value, hide
- **Cancel:** Esc → `cancelEditing()` → hide without write
- **Move on scroll/resize:** `gridRenderedNotification()` → `moveEditor()` → `setBounds(event.bounds)`
- **Navigate:** Tab/arrow → `delegateKeyDown()` to feature chain

## 5. Theme = property map (`src/defaults.js`)

No separate theme object. Themes are property maps that get applied to `grid.properties`:
```javascript
var defaults = {
  themeName: 'default',
  font: '13px Tahoma, Geneva, sans-serif',
  color: 'rgb(25,25,25)',
  backgroundColor: 'rgb(241,241,241)',
  foregroundSelectionFont: 'bold 13px Tahoma, Geneva, sans-serif',
  foregroundSelectionColor: 'rgb(0,0,128)',
  backgroundSelectionColor: 'rgba(147,185,255,0.625)',
  columnHeaderFont: '12px Tahoma, Geneva, sans-serif',
  columnHeaderColor: 'rgb(25,25,25)',
  columnHeaderBackgroundColor: 'rgb(223,227,232)',
  subgrids: ['HeaderSubgrid', 'data'],
  wheelHFactor: 0.01,
  wheelVFactor: 0.05
};
```

For cgrid we'll keep our CSS-variable theming AND layer property inheritance on top: `grid.properties → column.properties → cell config`.

## 6. Viewport / visible range (`src/renderer/index.js`)

Visible row/col arrays are precomputed once per frame in `computeCellsBounds()`:
```javascript
this.visibleColumns = [];   // { index, columnIndex, column, left, right, width }[]
this.visibleRows    = [];   // { index, subgrid, rowIndex, top, bottom, height }[]
```

Computed by iterating columns (handling fixed/scrollable) and subgrids (each contributes rows). See audit #2 for the math.

## 7. Sort/Filter — delegated to dataModel

Sort:
```javascript
// ColumnSorting.js
handleClick: function(grid, event) {
  if (event.isHeaderCell && !columnProperties.unsortable) {
    grid.fireSyntheticColumnSortEvent(event.gridCell.x, event.primitiveEvent.detail.keys);
  }
}
```

Filter:
```javascript
// Filters.js — filter row cells become editable like any cell
handleDoubleClick: function(grid, event) {
  if (event.isFilterCell) grid.onEditorActivate(event);
}
```

Behavior fires events; the dataModel reorders / hides rows. We already have this in our worker.

## Insights for the port

1. **Property layering via prototypes**, not deep merge — cheap per cell.
2. **Cell renderers receive `config`, not the cell value directly** — keeps the renderer signature stable while the layering changes.
3. **Editors are DOM-overlaid** — same as our current `EditorOverlay`. Keep it.
4. **Theme is just default properties** — works alongside our CSS variables.
5. **Subgrids own row-data lookup** — `cellEvent.subgrid.getCell(config)` is the dispatch point.
