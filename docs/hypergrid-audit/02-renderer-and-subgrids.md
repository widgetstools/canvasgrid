# Hypergrid Audit — Renderer + Subgrids

Source: `/Users/develop/wfh/hypergrid/src/renderer/`. Captured 2026-06-23.

## 1. Renderer entry point (`src/renderer/index.js`)

```javascript
var Renderer = Base.extend('Renderer', {
  initialize: function(grid) {
    this.grid = grid;
    this.gridRenderers = {};
    paintCellsFunctions.forEach(fn => this.registerGridRenderer(fn), this);
    this.setGridRenderer(this.properties.gridRenderer || 'by-columns-and-rows');
    this.reset();
  },
  paint: function(gc) {
    if (this.grid.canvas) {
      this.renderGrid(gc);
      this.grid.gridRenderedNotification();
    }
  }
});
```

Public API:
- `paint(gc)` — Canvas calls this every frame
- `renderGrid(gc)` — compute bounds, fetch data, dispatch to active gridRenderer
- `setGridRenderer(key)` — switch between by-rows / by-columns / by-cells / by-columns-and-rows strategies
- `paintGridlines(gc)` — separate post-cells pass

## 2. Subgrid concept (`src/behaviors/subgrids.js`)

The grid splits vertically into N subgrids (HeaderSubgrid, DataSubgrid, optional TopTotals/BottomTotals/Summary). Each is its own dataModel.

```javascript
set subgrids(subgridSpecs) {
  var subgrids = this._subgrids = [];
  subgrids.lookup = {};
  subgridSpecs.forEach(spec => subgrids.push(this.createSubgrid(spec)), this);
  this.shapeChanged();
}

createSubgrid: function(spec, args) {
  let subgrid;
  if (spec === 'data') subgrid = this.dataModel;
  else if (typeof spec === 'object') subgrid = spec;
  // …
  if (!subgrid.type) subgrid.type = 'data';
  subgrid['is' + cap(subgrid.type)] = true;   // isHeader / isData / isFooter
  return subgrid;
}
```

Each subgrid exposes:
- `.type` — 'data' | 'header' | 'footer' | …
- `.isData` / `.isHeader` / `.isFooter` booleans
- `.getRowCount()` — rows in this subgrid
- `.getCell(config, renderer)` — returns the cell renderer for this config

`computeCellsBounds()` (renderer/index.js lines 1370-1436) iterates subgrids and fills `visibleRows`:
```javascript
for (g = 0, base = 0; g < subgrids.length; g++) {
  subgrid = subgrids[g];
  subrows = subgrid.getRowCount();
  scrollableSubgrid = subgrid.isData;
  for (R = r + subrows; r < R && y < Y; r++) {
    rowIndex = vy - base;
    height = behavior.getRowHeight(rowIndex, subgrid);
    this.visibleRows[r] = vr = {
      index: r,                  // global row index in visibleRows
      subgrid: subgrid,           // back-ref to owning subgrid
      rowIndex: rowIndex,         // local index within the subgrid's data
      top: y, height: height, bottom: y + height
    };
    y += height;
  }
  if (scrollableSubgrid) subrows = r - topR;
}
```

## 3. by-rows painter (`src/renderer/by-rows.js`)

Painting sequence:
```javascript
function paintCellsByRows(gc) {
  gc.clearRect(0, 0, this.bounds.width, this.bounds.height);
  if (!C || !R) return;

  // PREFILL grid bg
  if (gc.alpha(gridPrefillColor) > 0) {
    gc.cache.fillStyle = gridPrefillColor;
    gc.fillRect(0, 0, viewWidth, viewHeight);
  }

  // RESET / BUNDLE if dirty
  if (this.gridRenderer.reset) {
    this.resetAllGridRenderers();
    this.gridRenderer.reset = false;
    bundleRows.call(this, true);
  }

  // ROW BACKGROUND BUNDLES — consolidated fillRects
  for (r = rowBundles.length; r--;) {
    rowBundle = rowBundles[r];
    gc.clearFill(0, rowBundle.top, viewWidth, rowBundle.bottom - rowBundle.top, rowBundle.backgroundColor);
  }

  // CELL LOOP
  for (p = 0, r = 0; r < R; r++) {
    prefillColor = rowPrefillColors[r];
    if (drawLines) {
      gc.cache.fillStyle = lineColor;
      gc.fillRect(0, pool[p].visibleRow.bottom, viewWidth, lineWidth);
    }
    this.visibleColumns.forEachWithNeg(function(vc) {
      p++;
      cellEvent = pool[p];
      columnClip = vc.column.properties.columnClip;
      gc.clipSave(columnClip || (columnClip === null && c === cLast), 0, 0, vc.right, viewHeight);
      try {
        preferredWidth[c] = Math.max(preferredWidth[c], this._paintCell(gc, cellEvent, prefillColor));
      } catch (e) {
        this.renderErrorCell(e, gc, vc, vr);
      }
      gc.clipRestore(columnClip);
    }, this);
  }

  // GRID LINES — separate post-cells pass
  this.paintGridlines(gc);
}
```

Row bundling (`bundleRows`):
```javascript
function bundleRows(resetCellEvents) {
  var bundle, rowBundles = [], rowPrefillColors = Array(R);
  for (r = 0; r < R; r++) {
    var vr = visibleRows[r];
    var stripe = vr.subgrid.isData && rowStripes && rowStripes[vr.rowIndex % rowStripes.length];
    var backgroundColor = rowPrefillColors[r] = stripe && stripe.backgroundColor || gridPrefillColor;
    if (bundle && bundle.backgroundColor === backgroundColor) {
      bundle.bottom = vr.bottom;                          // extend bundle
    } else if (backgroundColor === gridPrefillColor) {
      bundle = undefined;                                  // skip default
    } else {
      bundle = { backgroundColor, top: vr.top, bottom: vr.bottom };
      rowBundles.push(bundle);
    }
  }
  this.rowBundles = rowBundles;
  this.rowPrefillColors = rowPrefillColors;
}
```

## 4. by-columns painter

Mirror image of by-rows: iterates columns, bundles consecutive columns with same bg. Same clear → prefill → bundles → cell loop → gridlines structure. Use when columns have distinct bg colors more often than rows.

## 5. `_paintCell` contract

```javascript
_paintCell: function(gc, cellEvent, prefillColor) {
  var config = this.assignProps(cellEvent);   // merge grid → column → cell props
  config.gridCell = cellEvent.gridCell;
  config.dataCell = cellEvent.dataCell;
  // … set selection / hover / bounds / prefillColor on config
  var cellRenderer = cellEvent.subgrid.getCell(config, config.renderer);
  config.formatValue = grid.getFormatter(config.format);
  cellRenderer.paint(gc, config);
  return config.minWidth;
}
```

Cell renderer paint contract:
```javascript
paint: function(gc, config) {
  // READ: config.value, config.bounds {x,y,width,height}, config.isSelected,
  //   config.foregroundColor, config.backgroundColor, config.font, …
  // WRITE: config.minWidth (preferred width), config.snapshot, config.clickRect
  // PAINT into gc.
  // RETURN preferred width.
}
```

`config` is a layered object via prototype chain: **cellProps → columnProps → gridProps**. No deep clone per cell.

## 6. Pinned (fixed) columns

NO separate paint pass. visibleColumns is built such that fixed columns occupy the leading slots; the column loop paints all in one pass:

```javascript
for (x = 0, c = start, C = grid.getColumnCount(); c < C && x <= X; c++) {
  vx = c;
  if (c >= fixedColumnCount) {
    vx += scrollLeft;   // only scrollable cols shift by scroll
  }
  this.visibleColumns[c] = vc = {
    index: c,
    columnIndex: vx,
    column: behavior.getActiveColumn(vx),
    left: x, width, right: x + width
  };
  x += width;
}
```

Clipping is applied only to the LAST column (or via per-column `columnClip` prop) to prevent over-paint at the right edge.

## 7. Selection painting

After cells, BEFORE gridlines:
```javascript
renderGrid: function(gc) {
  // … paint cells …
  this.gridRenderer.paintCells.call(this, gc);
  this.renderOverrides(gc);
  this.renderLastSelection(gc);
}

renderLastSelection: function(gc) {
  switch (sm.getLastSelectionType()) {
    case 'column': selection = new InclusiveRectangle(left, 0, width, rowCount); break;
    case 'row': selection = new InclusiveRectangle(0, top, colCount, height); break;
    case 'cell': selection = sm.getLastSelection(); break;
  }
  // map selection to visible bounds, paint overlay via cellRenderers.get('lastselection').paint
}
```

Hover state is on the CellEvent and painted inline by each cell renderer, not as a separate overlay.

## 8. Grid lines (`paintGridlines`)

Separate pass at end of `renderGrid`. Lines drawn via `fillRect`, NOT per-cell `strokeRect`:

```javascript
paintGridlines: function(gc) {
  // Vertical lines
  if (gridProps.gridLinesV) {
    gc.cache.fillStyle = gridLinesVColor;
    visibleColumns.forEachWithNeg(function(vc, c) {
      if (c < C - 1) {
        var x = vc.right;
        if (borderBox) x -= gridLinesVWidth;
        gc.fillRect(x, top, gridLinesVWidth, height);
      }
    });
  }
  // Horizontal lines — same pattern over visibleRows
  // Fixed boundary lines: separate fillRects using fixedLinesHColor / fixedLinesVColor
}
```

## Key insights

1. **`visibleColumns` and `visibleRows` are computed once per frame**, used by hit-testing, cell paint, and gridlines.
2. **Grid lines are a single pass**, never per-cell `strokeRect`. Cleaner pixel alignment, no double-stroked seams.
3. **Row/column bundles** collapse N adjacent same-bg cells into one `fillRect`, dramatically reducing canvas API calls.
4. **Selection is an overlay** after cells, before gridlines.
5. **Pinned columns live in the same loop** as scrollable columns — they just happen to come first in `visibleColumns`.
