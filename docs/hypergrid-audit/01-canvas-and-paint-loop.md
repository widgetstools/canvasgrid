# Hypergrid Audit — Canvas + Paint Loop

Source repo: `/Users/develop/wfh/hypergrid`. Audit captured 2026-06-23 — read this when porting the canvas layer; don't re-derive from source.

## 1. Canvas lifecycle (`src/lib/Canvas.js`)

Constructor takes `(div, component, contextAttributes)`. Owns:
- `this.div` — host element
- `this.component` — renderer (called via `component.setBounds(bounds)` and `component.paint(gc)`)
- `this.canvas` — `document.createElement('canvas')` appended to div
- `this.gc` — cached graphics context from `getCachedContext(canvas, contextAttributes)`
- `this.bounds`, `this.width`, `this.height`, `this.mouseLocation`
- `this.dirty`, `this.hasMouse`, `this.dragging`

```javascript
this.gc = getCachedContext(this.canvas = document.createElement('canvas'), contextAttributes);
this.div.appendChild(this.canvas);
this.canvas.style.outline = 'none';
// later in initialize:
this.resetZoom();
this.resize();
this.beginResizing();
this.beginPainting();
```

## 2. Resize detection — 200ms `setInterval` polling, NOT ResizeObserver

```javascript
const RESIZE_POLLING_INTERVAL = 200;
// Global: setInterval(resizablesLoopFunction, 200) iterates all Canvas instances
checksize: function() {
  var sizeNow = this.getDivBoundingClientRect();
  if (sizeNow.width !== this.size.width || sizeNow.height !== this.size.height) {
    this.resize(sizeNow);
  }
}
```

`resize()` sequence:
```javascript
resize: function(box) {
  box = this.size = box || this.getDivBoundingClientRect();
  this.width = box.width;
  this.height = box.height;
  var isHIDPI = window.devicePixelRatio && this.component.properties.useHiDPI;
  var ratio = isHIDPI && window.devicePixelRatio || 1;
  this.devicePixelRatio = ratio *= this.bodyZoomFactor;
  this.canvas.width = Math.round(this.width * ratio);   // device px (clears canvas)
  this.canvas.height = Math.round(this.height * ratio);
  this.canvas.style.width = this.width + 'px';          // CSS px
  this.canvas.style.height = this.height + 'px';
  this.gc.scale(ratio, ratio);                          // ctx scaled to draw in CSS px
  this.bounds = new rectangular.Rectangle(0, 0, this.width, this.height);
  this.component.setBounds(this.bounds);                // notify renderer
  this.resizeNotification();                            // fires 'fin-canvas-resized'
  this.paintNow();                                      // SYNCHRONOUS paint — no gap
}
```

Why polling beats ResizeObserver: 5x/sec instead of 60x/sec, so the cascade of state updates (layout, viewport, sizer, paint) happens far less often. Less work + less chance for inconsistent intermediate states + more stable visual.

## 3. Paint loop — single global RAF, dirty + FPS throttle

```javascript
function paintLoopFunction(now) {
  paintables.forEach(function(paintable) { paintable.tickPainter(now); });
  paintRequest = requestAnimationFrame(paintLoopFunction);
}

tickPaint: function(now) {
  var isContinuousRepaint = this.component.properties.enableContinuousRepaint;
  var fps = this.component.properties.repaintIntervalRate;  // default 60
  if (fps === 0) return;
  var interval = 1000 / fps;
  var elapsed = now - this.lastRepaintTime;
  if (elapsed > interval && (isContinuousRepaint || this.dirty)) {
    this.paintNow();
    this.lastRepaintTime = now;
  }
},

paintNow: function() {
  try {
    this.gc.cache.save();
    this.dirty = false;
    this.component.paint(this.gc);   // renderer paints unconditionally
  } finally {
    this.gc.cache.restore();
  }
},

repaint: function() {
  this.requestRepaint();   // sets this.dirty = true
  if (!paintRequest || this.component.properties.repaintIntervalRate === 0) {
    this.paintNow();
  }
}
```

Key: `paintNow()` is synchronous; the RAF loop just decides *when* to call it.

## 4. Graphics cache — property write coalescing

`getCachedContext(canvas, attributes)` returns a real ctx with an added `gc.cache` object. Reads/writes through `gc.cache.fillStyle` only forward to the real ctx when the value actually changed:

```javascript
function makeStub(key) {
  if (!(key in props) && !/^(webkit|moz|ms|o)[A-Z]/.test(key) && typeof gc[key] !== 'function') {
    Object.defineProperty(props, key, {
      get: function() { return (values[key] = values[key] || gc[key]); },
      set: function(value) {
        if (value !== values[key]) {
          gc[key] = values[key] = value;   // only write on change
        }
      }
    });
  }
}
gc.cache = props;
gc.cache.save = function() { gc.save(); values = Object.create(values); };
gc.cache.restore = function() { gc.restore(); values = Object.getPrototypeOf(values); };
```

Avoids redundant `ctx.fillStyle = …` / `ctx.font = …` writes, which are surprisingly expensive in tight cell loops.

## 5. `clearFill` helper (`src/lib/graphics.js`)

```javascript
function clearFill(x, y, width, height, color) {
  var a = alpha(color);
  if (a < 1) {
    this.clearRect(x, y, width, height);   // translucent → clear first
  }
  if (a > 0) {
    this.cache.fillStyle = color;
    this.fillRect(x, y, width, height);
  }
}
```

Used by every row/column bundle paint. For translucent colors, clears first so the previous frame doesn't blend through.

## 6. Event flow on resize

1. Polling tick → `checksize()` detects new bounds
2. `resize(newBox)` runs the sequence in §2
3. `component.setBounds(bounds)` — renderer stores new bounds
4. `component.paint(gc)` — **synchronous**, in the same call

No deferred RAF, no microtask gap. That's why hypergrid doesn't flash.

## 7. Coordinate mapping

- Drawing: `canvas.width = w * dpr`, `gc.scale(dpr, dpr)` → draw using CSS px
- Mouse: `getLocal(e)` returns canvas-local CSS px:
  ```javascript
  getLocal: function(e) {
    var rect = this.getBoundingClientRect(this.canvas);
    return new rectangular.Point(
      e.clientX / this.bodyZoomFactor - rect.left,
      e.clientY / this.bodyZoomFactor - rect.top
    );
  }
  ```
