# Hypergrid Audit — Interaction (mouse + keyboard + selection)

Source: `/Users/develop/wfh/hypergrid/src/features/`, `src/lib/Canvas.js`, `src/lib/SelectionModel.js`. Captured 2026-06-23.

## 1. Mouse event capture (`src/lib/Canvas.js`)

Canvas listens to native events on the canvas element AND on document, normalizes coords, and dispatches as CustomEvents on the canvas:

```javascript
document.addEventListener('mousemove', function(e) {
  if (self.hasMouse || self.isDragging()) self.finmousemove(e);
});

finmousemove: function(e) {
  if (!this.isDragging() && this.mousedown) {
    this.beDragging();
    this.dispatchNewMouseKeysEvent(e, 'fin-canvas-dragstart', { … });
  }
  this.mouseLocation = this.getLocal(e);   // canvas-relative CSS px
  if (this.isDragging()) this.dispatchNewMouseKeysEvent(e, 'fin-canvas-drag', { … });
  if (this.bounds.contains(this.mouseLocation)) this.dispatchNewMouseKeysEvent(e, 'fin-canvas-mousemove');
}

getLocal: function(e) {
  var rect = this.getBoundingClientRect(this.canvas);
  return new rectangular.Point(
    e.clientX / this.bodyZoomFactor - rect.left,
    e.clientY / this.bodyZoomFactor - rect.top
  );
}
```

Events emitted: `fin-canvas-mousedown`, `fin-canvas-mouseup`, `fin-canvas-mousemove`, `fin-canvas-click`, `fin-canvas-dblclick`, `fin-canvas-drag`, `fin-canvas-dragstart`, `fin-canvas-dragend`, `fin-canvas-wheel`, `fin-canvas-keydown`, `fin-canvas-keyup`.

## 2. Feature chain (`src/features/Feature.js`, `src/features/index.js`)

Chain-of-responsibility: each Feature can handle or delegate to `.next`.

```javascript
// Feature.js
setNext: function(nextFeature) {
  if (this.next) this.next.setNext(nextFeature);   // tail-recurse to end
  else { this.next = nextFeature; this.detached = nextFeature; }
},

handleMouseDown: function(grid, event) {
  if (this.next) this.next.handleMouseDown(grid, event);
},
// same for: handleMouseUp, handleMouseMove, handleMouseDrag, handleClick,
// handleDoubleClick, handleKeyDown, handleKeyUp, handleWheelMoved, …
```

Registration (`src/features/index.js`):
```javascript
this.add(Features.CellClick);
this.add(Features.CellEditing);
this.add(Features.CellSelection);
this.add(Features.ColumnResizing);
this.add(Features.RowSelection);
this.add(Features.KeyPaging);
this.add(Features.OnHover);
```

Behavior dispatches events into the chain:
```javascript
onMouseMove: function(grid, event) {
  if (this.featureChain) {
    this.featureChain.handleMouseMove(grid, event);
    this.setCursor(grid);
  }
}
```

A feature "consumes" an event by NOT calling `this.next.handleX(…)`.

## 3. Hit testing (`src/renderer/index.js`, `getGridCellFromMousePoint`)

Uses precomputed `visibleColumns` / `visibleRows` — no traversal of the column model:

```javascript
getGridCellFromMousePoint: function(point) {
  var x = point.x, y = point.y;
  var firstColumn = vcs[this.grid.behavior.leftMostColIndex];
  var inFirstColumn = firstColumn && x < firstColumn.right;
  var vc = inFirstColumn ? firstColumn : vcs.findWithNeg(vc => x < vc.right);
  var vr = vrs.find(vr => y < vr.bottom);

  if (!vr) { vr = vrs[vrs.length - 1]; isPseudoRow = true; }
  if (!vc) { vc = vcs[vcs.length - 1]; isPseudoCol = true; }

  var cellEvent = new this.grid.behavior.CellEvent(vc.columnIndex, vr.index);
  result.cellEvent.mousePoint = this.grid.newPoint(x - vc.left, y - vr.top);
  // cellEvent carries: gridCell (column, row), dataCell, mousePoint (cell-local), bounds
  return result;
}
```

`mousePoint` is CELL-LOCAL coords (origin = cell top-left). That's what enables the ±3px hot-zone test in ColumnResizing without re-computing absolute boundaries.

## 4. SelectionModel (`src/lib/SelectionModel.js`)

Rectangles + flattened projections:
```javascript
this.selections = [];              // InclusiveRectangle[]
this.flattenedX = [];              // X-projections for row highlight
this.flattenedY = [];              // Y-projections for column highlight
this.rowSelectionModel = new RangeSelectionModel();
this.columnSelectionModel = new RangeSelectionModel();
this.lastSelectionType = [];       // ['cell' | 'row' | 'column']

select: function(ox, oy, ex, ey, silent) {
  var newSelection = new InclusiveRectangle(ox, oy, ex + 1, ey + 1);
  newSelection.firstSelectedCell = this.grid.newPoint(ox, oy);
  if (grid.properties.multipleSelections) {
    this.selections.push(newSelection);
    this.flattenedX.push(newSelection.flattenXAt(0));
    this.flattenedY.push(newSelection.flattenYAt(0));
  } else {
    this.selections = [newSelection];
  }
}
```

## 5. Column resizing (`src/features/ColumnResizing.js`)

±3px hot zone at column boundaries:
```javascript
overAreaDivider: function(grid, event) {
  return event.gridCell.x !== leftMostColumnIndex && event.mousePoint.x <= 3 ||
         event.mousePoint.x >= event.bounds.width - 3;
}

handleMouseDown: function(grid, event) {
  if (event.isHeaderRow && this.overAreaDivider(grid, event)) {
    this.dragColumn = event.column;
    this.dragStartWidth = event.bounds.width;
    this.dragStart = this.getMouseValue(event);
  }
}

handleMouseDrag: function(grid, event) {
  if (this.dragColumn) {
    var delta = this.getMouseValue(event) - this.dragStart;
    grid.behavior.setColumnWidth(this.dragColumn, this.dragStartWidth + delta);
  }
}
```

## 6. Keyboard navigation

`KeyPaging.js` handles PageUp/PageDown only. Arrow-key cell navigation is in `CellSelection.js`:
```javascript
handleKeyDown: function(grid, event) {
  var cellEvent = grid.getGridCellFromLastSelection(true);
  var navKey = cellEvent.properties.mappedNavKey(detail.char, detail.ctrl) ||
               cellEvent.properties.navKey(detail.char, detail.ctrl);
  var handler = this['handle' + navKey];   // handleUp, handleDown, …
  if (handler) {
    handler.call(this, grid, detail);
    grid.renderer.computeCellsBounds(true);   // auto-scroll
  }
}
```

After each key handler, `computeCellsBounds(true)` ensures the focused cell is visible (auto-scroll).

## 7. Cursor management

Each feature sets its own `.cursor` during mousemove. After event dispatch, the chain is walked head→tail and the LAST non-null `.cursor` wins:
```javascript
// Feature.js
setCursor: function(grid) {
  if (this.next) this.next.setCursor(grid);
  if (this.cursor) grid.beCursor(this.cursor);
},

// ColumnResizing
handleMouseMove: function(grid, event) {
  if (this.overAreaDivider(grid, event)) this.cursor = 'col-resize';
  else this.cursor = null;
}
```

## Insights for the port

1. **All input flows through one chain.** Adding a new interaction = a new Feature, no plumbing changes.
2. **Hit testing is stateless and cheap** — just `findWithNeg` on the precomputed visibleColumns/Rows.
3. **`mousePoint` is cell-local**, which makes resize/edit hot-zone detection trivial.
4. **Cursor is reconciled per-event by walking the chain**, not by tracking last-set-from-where.
5. **Arrow keys live in CellSelection**, not in a separate keyboard module — keeps focus + visibility tightly coupled.
