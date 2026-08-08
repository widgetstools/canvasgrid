# Canvasgrid Hypergrid Port — Worklog

> **For agentic workers:** Each task in this worklog is designed to be executed in a **single, isolated Claude Code session** for context efficiency. Run one task per session, verify, commit, then START A NEW SESSION using the "Next session" prompt at the end of the task. Do NOT chain multiple tasks in one session — that's how we end up doing trial-and-error.

**Goal:** Replace the cgrid render + interaction layers with a TypeScript port of hypergrid's proven canvas grid architecture. Keeps cgrid's deliberate choices (Web Worker pipeline, native scrollbars, TS strict mode, `VelocityGrid` public API, CSS-variable theming); replaces only the parts that hypergrid already solved better (canvas wrapper + paint timing, graphics-state cache, renderer orchestration with single-pass gridlines, subgrid model, feature-chain interaction).

**Why now:** Resize flicker and rendering glitches keep coming back because cgrid's canvas/paint layer was built feature-by-feature without the architecture hypergrid spent years on. Trial-and-error fixes have a low ceiling; we're swapping in proven plumbing instead.

**References (READ FIRST when starting any task):**
- `docs/hypergrid-audit/01-canvas-and-paint-loop.md`
- `docs/hypergrid-audit/02-renderer-and-subgrids.md`
- `docs/hypergrid-audit/03-interaction.md`
- `docs/hypergrid-audit/04-models-and-cell-renderers.md`
- Hypergrid source: `/Users/develop/wfh/hypergrid/src/`
- Current velocity-grid: `cgrid/src/`
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task**.

- **No regressions in the public API.** `VelocityGrid`, `VelocityGridOptions`, `VelocityGridApi`, the typed event surface, and the worker protocol are stable. Tasks that change types must add deprecation shims and migrate the demo.
- **TypeScript strict mode.** Every `cgrid/src/**/*.ts` must compile clean under `npm run --workspace=cgrid typecheck`.
- **`alpha: false` canvas context.** All canvases use `getContext('2d', { alpha: false })` so the backing store is opaque.
- **Theme classes set `background-color`** on the host. Already in `tokens.css`; do NOT remove.
- **Single-canvas rendering.** No stacked DOM canvases; layers are paint passes in z-order on one canvas.
- **DPR-aware paint.** `canvas.width = cssW * dpr`, `ctx.scale(dpr, dpr)` once per resize. Draw using CSS px.
- **No per-cell `strokeRect`.** Grid lines are drawn in a single `paintGridlines` pass at the end of each frame.
- **Web Worker stays the data layer.** All cell data comes from `WorkerClient.getViewport`. The port does NOT change the worker protocol.
- **Native browser scrollbars** (already in place). Custom canvas-painted scrollbars are not coming back.
- **Vitest** for unit, **Playwright** for E2E. Both green at end of every task.
- **Commits:** conventional. Each task = one or more commits, focused. End each task with green tests + a commit.
- **Hypergrid source is reference, not gospel.** Port the algorithm + the structure. We're writing modern TS, not transliterating prototype-based JS. Drop hypergrid quirks that don't earn their keep (e.g., `Object.create(values)` for save/restore is fine; `Base.extend` class system is not).

## Task overview

| # | Task | Primary user-visible win | Files touched |
|---|---|---|---|
| 1 | Port Canvas wrapper + graphics cache | **Resize flicker gone.** Smoother paint. | `core/canvas.ts` (new), `renderer/gc.ts` (new), `velocityGrid.ts`, delete `core/paintLoop.ts` |
| 2 | Renderer orchestration + single-pass gridlines | Cleaner pixel alignment, no double-stroke seams | `renderer/renderer.ts`, `renderer/painters/*`, `renderer/cellRenderers/registry.ts` |
| 3 | Subgrid model (HeaderSubgrid + DataSubgrid) | Enables Totals row / footer / status bar cleanly | `core/subgrid.ts` (new), `core/viewport.ts`, `renderer/renderer.ts` |
| 4 | Feature chain for interaction | Clean extension point for range-select, fill-handle, etc. | `interaction/feature.ts` (new), `interaction/features/*` (new), delete `pointerInput.ts`, `keyboardInput.ts` |
| 5 | by-rows painter w/ row bundling + cell-renderer config layering | Better perf on wide grids; richer theming | `renderer/painters/byRows.ts` (new), `renderer/cellRenderers/registry.ts`, `renderer/renderer.ts` |

---

## Task 1 — Port Canvas wrapper + graphics cache

**Goal:** Replace the canvas scaffold in `velocityGrid.ts` and `core/paintLoop.ts` with a TypeScript port of hypergrid's `Canvas.js`, including the `gc.cache` property proxy. After this task, browser-resize should be visibly flicker-free with no code changes downstream.

**Why this is Task 1:** It fixes the most-painful user-visible problem (resize flicker) and is fully behind the existing `Renderer.paint(gc)` boundary, so it can land without touching the painters or interaction.

**Read first:**
- `docs/hypergrid-audit/01-canvas-and-paint-loop.md` — the full design
- `/Users/develop/wfh/hypergrid/src/lib/Canvas.js` lines 29-200, 279-360, 595-625, 704-760, 915-964
- `/Users/develop/wfh/hypergrid/src/lib/graphics.js` lines 1-30

**Files:**
- Create: `cgrid/src/core/canvas.ts` (Canvas wrapper class)
- Create: `cgrid/src/renderer/gc.ts` (graphics-cache proxy + `clearFill` helper + types)
- Modify: `cgrid/src/velocityGrid.ts` (instantiate Canvas, remove old paintLoop wiring + manual `handleResize`/`syncSize` calls; wire scroller alongside)
- Modify: `cgrid/src/renderer/renderer.ts` (accept the cached `gc` instead of raw ctx; replace direct `ctx.fillStyle = …` writes with `gc.cache.fillStyle = …`)
- Modify: `cgrid/src/renderer/painters/*.ts` (same gc replacement)
- Modify: `cgrid/src/renderer/cellRenderers/registry.ts` (same gc replacement)
- Delete: `cgrid/src/core/paintLoop.ts`
- Update: `cgrid/tests/renderer.test.ts` (mock the cached gc; tests still pass)

**Interfaces produced (later tasks consume):**

```ts
// cgrid/src/renderer/gc.ts
export interface CachedContext2D extends CanvasRenderingContext2D {
  cache: CanvasPaintState;       // proxy that elides redundant writes
  clearFill(x: number, y: number, w: number, h: number, color: string): void;
}
export interface CanvasPaintState {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  lineWidth: number;
  globalAlpha: number;
  save(): void;
  restore(): void;
}
export function attachGcCache(canvas: HTMLCanvasElement,
                              attrs?: CanvasRenderingContext2DSettings): CachedContext2D;

// cgrid/src/core/canvas.ts
export interface PaintComponent {
  setBounds(b: { x: number; y: number; width: number; height: number }): void;
  paint(gc: CachedContext2D): void;
}
export interface CanvasOptions {
  fpsCap?: number;                 // default 60; 0 disables RAF
  resizePollMs?: number;           // default 200
  useHiDPI?: boolean;              // default true
  contextAttributes?: CanvasRenderingContext2DSettings;  // default { alpha: false }
}
export class VelocityGridCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly gc: CachedContext2D;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly devicePixelRatio: number;
  constructor(host: HTMLElement, component: PaintComponent, opts?: CanvasOptions);
  requestRepaint(): void;          // marks dirty for next RAF tick
  paintNow(): void;                 // synchronous paint, no RAF wait
  resize(): void;                   // re-read host size, re-fit, paintNow
  getLocal(e: MouseEvent): { x: number; y: number };
  destroy(): void;
}
```

**Steps:**

1. **Create `cgrid/src/renderer/gc.ts`.** Implement `attachGcCache`: for every property on the 2D context prototype that's NOT a function and NOT vendor-prefixed, install a getter/setter on a `props` object that caches the last set value and only writes through to the real ctx on change. Add `cache.save()` / `cache.restore()` using `Object.create(values)` / `Object.getPrototypeOf(values)` for the cached value layer. Add `clearFill(x,y,w,h,color)` as a method on the returned ctx — if the color has alpha < 1 (parse the rgba), call `clearRect` first, then `fillRect` with the color (via `cache.fillStyle`).
2. **Create `cgrid/src/core/canvas.ts`.** `VelocityGridCanvas` constructor: create canvas with `display:block; position:absolute; left:0; top:0; outline:none;`, append to host, call `attachGcCache` with `{ alpha: false, ...attrs }`, store `component`, init bounds, call `resize()` synchronously, then start the RAF + resize loops.
3. **RAF loop:** module-level `paintRequest`, `paintables: Set<VelocityGridCanvas>`. On first constructor, start `paintLoopFunction(now)` that calls `tickPaint(now)` on each paintable then re-requests RAF. `tickPaint`: gated by `fpsCap` and `this.dirty`. If `elapsed > 1000/fps && this.dirty`, call `paintNow()` and reset `lastRepaintTime`.
4. **Resize loop:** module-level `resizables: Set<VelocityGridCanvas>`, single `setInterval(checkSizes, resizePollMs)`. Each `checkSize()` calls `host.getBoundingClientRect()` and compares to last; on change calls `resize()`. **Do NOT use ResizeObserver — the per-frame cascade is the flicker source.**
5. **`resize()`** mirrors hypergrid's:
   ```ts
   const rect = this.host.getBoundingClientRect();
   this.width = rect.width; this.height = rect.height;
   const dpr = this.useHiDPI ? (window.devicePixelRatio || 1) : 1;
   this.devicePixelRatio = dpr;
   const newW = Math.round(this.width * dpr);
   const newH = Math.round(this.height * dpr);
   if (this.canvas.width !== newW || this.canvas.height !== newH) {
     this.canvas.width = newW; this.canvas.height = newH;
     this.canvas.style.width = this.width + 'px';
     this.canvas.style.height = this.height + 'px';
     this.gc.scale(dpr, dpr);
   }
   this.bounds = { x: 0, y: 0, width: this.width, height: this.height };
   this.component.setBounds(this.bounds);
   this.paintNow();   // SYNCHRONOUS — same call
   ```
6. **`paintNow()`:**
   ```ts
   try {
     this.gc.cache.save();
     this.dirty = false;
     this.component.paint(this.gc);
   } finally {
     this.gc.cache.restore();
   }
   ```
7. **`getLocal(e)`** returns canvas-local CSS-px coords by reading `getBoundingClientRect()` on the canvas.
8. **Modify `cgrid/src/velocityGrid.ts`:**
   - Delete `paintLoop` member + its `start()` / `stop()` / `markFullDirty()` calls.
   - Delete the manual `handleResize()` / `syncSizer()` calls scattered through methods.
   - Construct `VelocityGridCanvas(this.canvasHost, paintComponent)` where `paintComponent.setBounds = b => { recomputeLayout(b); recomputeViewport(); syncSizer(); }` and `paintComponent.paint = gc => this.renderer.paint(gc)`.
   - On any state change that previously did `paintLoop.markFullDirty()`, call `canvas.requestRepaint()` instead.
   - `setScroll`/`onScrollerScroll`/`recomputeViewport` survive unchanged in spirit, but use `canvas.requestRepaint()` instead of `paintLoop.markFullDirty()`.
   - The cgrid root keeps the existing scroller + sizer + canvas overlay structure — but the canvas is created and managed by `VelocityGridCanvas`, not directly by VelocityGrid. Have VelocityGrid pass `canvasHost = this.root` (or a sub-div if you prefer), and the scroller can be a sibling/preceding element. Verify the canvas overlays correctly above the scroller content area (excluding scrollbar gutters).
9. **Modify `cgrid/src/renderer/renderer.ts`:**
   - Change `paint(_rects: DirtyRect[])` to `paint(gc: CachedContext2D)` — the new Canvas calls this with its cached ctx, no more dirty-rect arg.
   - Inside, replace every direct `ctx.fillStyle = …` / `ctx.font = …` / `ctx.strokeStyle = …` with `gc.cache.fillStyle = …` etc. **Direct API calls like `fillRect`, `fillText`, `beginPath`, `moveTo`, `lineTo`, `stroke`, `arc`, `arcTo`, `clearRect` still go on `gc` directly** — only the state properties go through `gc.cache`.
   - The constructor no longer needs to retain a ctx — it's passed in per-call.
10. **Same gc-cache migration in `cgrid/src/renderer/painters/headerPainter.ts`, `bodyPainter.ts`, `pinnedPainter.ts`, `overlayPainter.ts`, and `cellRenderers/registry.ts`.** Change the painter signature to accept `gc: CachedContext2D`. Inside, swap state-property writes onto `gc.cache`.
11. **Delete `cgrid/src/core/paintLoop.ts`** and remove its import from `velocityGrid.ts`. Delete `cgrid/tests/paintLoop.test.ts` if it exists.
12. **Update `cgrid/tests/renderer.test.ts`** to construct a fake `CachedContext2D`. The fake's `.cache` is a plain object with the same property names; `clearFill` is a stub. Make sure tests still pass.
13. **Run tests:**
    ```bash
    npm test --workspace=cgrid              # 100 unit tests, all green
    npm --workspace=cgrid run typecheck     # clean
    npm --workspace=cgrid run build         # clean
    ```
14. **Run E2E** (dev server + STOMP must be up):
    ```bash
    cd apps/cgrid-positions && npx playwright test --reporter=list
    ```
    All 7 tests pass.
15. **Manual verification:** open `http://127.0.0.1:5180/`, grab the bottom-right corner of the browser, drag-resize. Canvas must follow without blanking. No transparent flash, no jumpy column shift.
16. **Commit:**
    ```bash
    git add cgrid/src/core/canvas.ts cgrid/src/renderer/gc.ts cgrid/src/velocityGrid.ts cgrid/src/renderer/ cgrid/tests/renderer.test.ts
    git rm cgrid/src/core/paintLoop.ts
    git commit -m "feat(cgrid): port hypergrid Canvas + graphics cache; fixes resize flicker"
    ```

**Acceptance criteria:**
- [ ] `cgrid/src/core/canvas.ts` exists and exports `VelocityGridCanvas`.
- [ ] `cgrid/src/renderer/gc.ts` exists and exports `attachGcCache` + types.
- [ ] `cgrid/src/core/paintLoop.ts` is deleted.
- [ ] No ResizeObserver usage anywhere in `cgrid/src/`.
- [ ] `npm test --workspace=cgrid` passes (all unit tests).
- [ ] `npm --workspace=cgrid run typecheck` is clean.
- [ ] `npm --workspace=cgrid run build` produces `dist/velocity-grid.js` and `dist/worker.js`.
- [ ] E2E suite (all 7 tests) passes when dev server + STOMP are up.
- [ ] Manual browser drag-resize shows no canvas blank/transparent frames.

**Next session prompt** (paste into a fresh Claude Code session after Task 1 is committed):

```
Read docs/superpowers/plans/2026-06-23-canvasgrid-hypergrid-port.md and execute Task 2 (Renderer orchestration + single-pass gridlines). Read the audit refs in docs/hypergrid-audit/ first. Verify Task 1 is committed (git log -1 should show the Canvas + graphics-cache port). Apply the same per-task workflow: read brief, implement, run unit + E2E + typecheck + build, commit.
```

---

## Task 2 — Renderer orchestration + single-pass gridlines

**Goal:** Rework `Renderer` into a hypergrid-style orchestrator. Precompute `visibleColumns` and `visibleRows` once per frame and pass them to each painter. Move all grid-line drawing out of the cell renderers and into one `paintGridlines` pass at the end of the frame.

**Why:** Per-cell `strokeRect` (and our current 1px bottom stroke) leaves seams and double-strokes between adjacent cells. A single fillRect-per-line pass aligns crisply with no overlap. Also: passing precomputed visible arrays around is the pattern Tasks 3-5 need.

**Read first:**
- `docs/hypergrid-audit/02-renderer-and-subgrids.md`
- `/Users/develop/wfh/hypergrid/src/renderer/index.js` lines 530-700, 838-947, 1310-1436
- Current `cgrid/src/renderer/renderer.ts` and `cgrid/src/renderer/painters/*`

**Files:**
- Modify: `cgrid/src/renderer/renderer.ts` (orchestration: compute visibles, paint cells, paint gridlines)
- Create: `cgrid/src/renderer/painters/gridLinesPainter.ts`
- Modify: `cgrid/src/renderer/cellRenderers/registry.ts` (remove the bottom-border stroke from `paintBackground`)
- Modify: `cgrid/src/renderer/painters/headerPainter.ts` (no per-column right-edge stroke; gridLinesPainter does verticals now)
- Modify: `cgrid/src/renderer/painters/bodyPainter.ts` / `pinnedPainter.ts` (no per-cell strokes)
- Update: `cgrid/tests/painters.test.ts` (assert no strokeRect/path-stroke from cell paints; verify gridLinesPainter writes the right number of `fillRect` lines)

**Interfaces:**
```ts
// cgrid/src/renderer/painters/types.ts — extend existing PainterCtx
export interface PainterCtx {
  // existing fields…
  visibleColumns: ViewportColumn[];   // already there
  visibleRows: ViewportRow[];          // already there
  // No new fields; we're reorganizing, not expanding.
}

// cgrid/src/renderer/painters/gridLinesPainter.ts
export function paintGridLines(gc: CachedContext2D, p: PainterCtx): void;
```

**Steps:**

1. **In `Renderer.paint(gc)`,** order the passes as: (1) opaque bg fill of entire canvas, (2) `paintHeader`, (3) `paintPinned('left')`, (4) `paintBody`, (5) `paintPinned('right')`, (6) `paintGridLines`, (7) `paintOverlay` (focus ring + selection). Pinned bands come before gridlines so the lines stretch across.
2. **Strip per-cell strokes.** In `registry.ts` `paintBackground`, remove the `beginPath`/`moveTo`/`lineTo`/`stroke` block that draws the bottom row divider. Same for any other cell renderer that draws borders.
3. **Strip header per-column dividers.** Header band's bottom border (header/body separator) stays — that's a *band* line, not a per-cell line. Drop only the per-column right-edge verticals.
4. **Implement `paintGridLines`:**
   ```ts
   // Verticals: one fillRect per column right edge (except the last in each section,
   // because the pinned band edge and scrollbar gutter make those redundant).
   gc.cache.fillStyle = theme.gridLineColor;
   for (let i = 0; i < vs.visibleColumns.length - 1; i++) {
     const x = Math.round(vs.visibleColumns[i].right) - 0.5;
     gc.fillRect(x, vs.bodyTop, 1, vs.bodyBottom - vs.bodyTop);
   }
   // Horizontals: one fillRect per row bottom.
   for (let i = 0; i < vs.visibleRows.length; i++) {
     const y = Math.round(vs.visibleRows[i].bottom) - 0.5;
     gc.fillRect(vs.bodyLeft, y, vs.bodyRight - vs.bodyLeft, 1);
   }
   ```
   No `beginPath`/`stroke`. Every line is a `fillRect`. Lines never re-draw the same pixel twice.
5. **Verify pinned-band right edge.** Hypergrid uses `fixedLinesV` separately. For us, the right edge of the pinned-left band and the left edge of the pinned-right band each get one `fillRect` using `theme.borderColor` (slightly heavier than `gridLineColor`). Pull this from the existing `headerPainter` band-divider code and lift it into `paintGridLines` so it's all in one place.
6. **Update painter tests:** assert `fillRect` calls; assert no `strokeRect` or `beginPath` calls from the cell-renderer mocks (those were the cause of the seams).
7. **Manual verification:** scroll horizontally — lines stay sharp, no double-thickness. Resize — gridlines stay aligned with cells. Header to body separator looks like a single 1px line.
8. **Run unit + typecheck + build + E2E** (as in Task 1). Commit:
   ```
   refactor(cgrid): single-pass gridlines + precomputed visible arrays
   ```

**Acceptance criteria:**
- [ ] `paintGridLines` exists; called once per frame after cells.
- [ ] No cell renderer draws cell-edge lines (`strokeRect`, `stroke` after `moveTo`/`lineTo` for borders).
- [ ] Gridlines align with cell edges on horizontal/vertical scroll.
- [ ] All 100+ unit tests pass; E2E (7) passes; typecheck clean.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-23-canvasgrid-hypergrid-port.md and execute Task 3 (Subgrid model). Confirm Task 2 is committed (git log -1). Read docs/hypergrid-audit/02-renderer-and-subgrids.md sections 2 and 5 carefully — this task introduces the subgrid abstraction. Follow the per-task workflow.
```

---

## Task 3 — Subgrid model

**Goal:** Introduce hypergrid's subgrid abstraction. Today the renderer has implicit knowledge of "header height" and "body region"; after this task there's a typed `Subgrid` interface with at least two implementations (`HeaderSubgrid`, `DataSubgrid`), and `computeViewport` walks the subgrid stack to build `visibleRows`. Future totals/footer rows become a trivial addition.

**Why:** Adding a totals row or status bar today means splicing it into header or body painters with conditional rendering. With subgrids it's `subgrids: [HeaderSubgrid, DataSubgrid, TotalsSubgrid]` and the rest is automatic.

**Read first:**
- `docs/hypergrid-audit/02-renderer-and-subgrids.md` section 2 (subgrid concept)
- `/Users/develop/wfh/hypergrid/src/behaviors/subgrids.js`
- `/Users/develop/wfh/hypergrid/src/renderer/index.js` lines 1370-1436 (computeCellsBounds)
- Current `cgrid/src/core/viewport.ts`

**Files:**
- Create: `cgrid/src/core/subgrid.ts` (interface + impls)
- Modify: `cgrid/src/core/viewport.ts` (accept `subgrids` arg; build `visibleRows` across them)
- Modify: `cgrid/src/renderer/renderer.ts` (paint one section per subgrid)
- Modify: `cgrid/src/velocityGrid.ts` (build `subgrids: [HeaderSubgrid, DataSubgrid]` from options)
- Update: `cgrid/tests/viewport.test.ts` (test multi-subgrid row layout)

**Interfaces:**
```ts
// cgrid/src/core/subgrid.ts
export type SubgridType = 'header' | 'data' | 'totals' | 'footer';
export interface Subgrid {
  readonly type: SubgridType;
  readonly isHeader: boolean;
  readonly isData: boolean;
  readonly isTotals: boolean;
  readonly isFooter: boolean;
  /** How many rows this subgrid contributes to the visible stack. */
  getRowCount(): number;
  /** Per-row height. Most subgrids return a constant; data may consult theme.rowHeight. */
  getRowHeight(localRowIndex: number): number;
  /** Lookup cell data. For HeaderSubgrid, value is the column headerName. For
   * DataSubgrid, calls into the existing cellAt() (worker chunk). */
  getCell(localRowIndex: number, colId: string): { value: unknown; valueFormatted: string } | null;
}

export class HeaderSubgrid implements Subgrid { /* … */ }
export class DataSubgrid implements Subgrid { /* … */ }

// cgrid/src/core/viewport.ts — extended
export interface ViewportRow {
  rowIndex: number;        // global index within visibleRows (now)
  subgrid: Subgrid;        // NEW: which subgrid owns this row
  localRowIndex: number;   // NEW: index inside the subgrid (replaces today's rowIndex meaning for data)
  top: number; bottom: number; height: number;
}
```

**Steps:**

1. Define `Subgrid` interface and two implementations:
   - `HeaderSubgrid`: `getRowCount() = 1` (single header row for now), `getRowHeight() = theme.headerHeight`, `getCell(0, colId) = { value: colDef.headerName, valueFormatted: colDef.headerName }`.
   - `DataSubgrid`: `getRowCount() = rowCountFromWorker`, `getRowHeight() = theme.rowHeight`, `getCell(local, colId) = this.cellAt(local, colId)` — delegates to the existing `cellAt(rowIndex, colId)` in `velocityGrid.ts`.
2. Extend `computeViewport` to accept `subgrids: Subgrid[]`. Walk them in order, building `visibleRows`:
   ```ts
   let y = bodyTop;
   for (const subgrid of subgrids) {
     const rows = subgrid.getRowCount();
     // For data subgrids: respect scrollTop. For header subgrids: ignore scroll.
     const scrollable = subgrid.isData;
     const startLocal = scrollable ? Math.floor(scrollTop / theme.rowHeight) - overscan : 0;
     const endLocal = scrollable
       ? Math.min(rows - 1, startLocal + Math.ceil(bodyHeight / theme.rowHeight) + overscan*2)
       : rows - 1;
     for (let local = Math.max(0, startLocal); local <= endLocal && y < containerHeight; local++) {
       const h = subgrid.getRowHeight(local);
       visibleRows.push({
         rowIndex: visibleRows.length,
         subgrid,
         localRowIndex: local,
         top: y - (scrollable ? (scrollTop % theme.rowHeight) : 0),  // careful with scroll alignment
         bottom: y + h,
         height: h,
       });
       y += h;
     }
   }
   ```
3. Body & header painters: replace the existing `vs.visibleRows` iteration. For each row, dispatch by `row.subgrid.isHeader` / `isData`. Header rows render with header style; data rows render with body style. **Eventually the painters merge — Task 5 handles that.** For Task 3, keep two painters but loop over `visibleRows` once each, filtering by subgrid type.
4. `velocityGrid.ts` builds the subgrid array in the constructor:
   ```ts
   this.subgrids = [
     new HeaderSubgrid(this.columnDefsMap, () => this.theme),
     new DataSubgrid(this),    // pass cgrid for cellAt
   ];
   ```
   Pass to `computeViewport`.
5. Update `viewport.test.ts`: build with `subgrids: [headerOnly]`, `subgrids: [header, data]`, assert `visibleRows` shape — header always at top regardless of scrollTop.
6. **No user-visible change after this task.** Verification is structural: all painters still render correctly, `visibleRows` now carries subgrid refs, future totals row is a one-line addition.
7. Run unit + typecheck + build + E2E. Commit:
   ```
   refactor(cgrid): subgrid abstraction for header/body row stacks
   ```

**Acceptance criteria:**
- [ ] `cgrid/src/core/subgrid.ts` exports `Subgrid` interface + `HeaderSubgrid` + `DataSubgrid`.
- [ ] `ViewportRow.subgrid` is set on every row.
- [ ] Adding `new TotalsSubgrid()` to the array would automatically appear at the right Y-position (verify by writing a quick test stub, no need to ship a real TotalsSubgrid).
- [ ] All unit + E2E pass; no visual regression.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-23-canvasgrid-hypergrid-port.md and execute Task 4 (Feature chain for interaction). Confirm Task 3 is committed. Read docs/hypergrid-audit/03-interaction.md fully — this task replaces the current pointer/keyboard input modules with a feature chain.
```

---

## Task 4 — Feature chain for interaction

**Goal:** Replace `cgrid/src/interaction/pointerInput.ts` and `keyboardInput.ts` with a hypergrid-style feature chain. Each interaction is a `Feature` subclass that implements `handleMouseDown`, `handleMouseMove`, `handleKeyDown`, etc. and forwards via `this.next?.handleX(grid, event)`. Cursor reconciliation walks the chain.

**Why:** Today, adding range-select, fill-handle, drag-reorder, or right-click context menu means surgery in two monolithic files. With a chain, it's a new file and one `chain.append(new MyFeature())` call.

**Read first:**
- `docs/hypergrid-audit/03-interaction.md`
- `/Users/develop/wfh/hypergrid/src/features/Feature.js`
- `/Users/develop/wfh/hypergrid/src/features/CellSelection.js`
- `/Users/develop/wfh/hypergrid/src/features/ColumnResizing.js`
- `/Users/develop/wfh/hypergrid/src/features/KeyPaging.js`
- `/Users/develop/wfh/hypergrid/src/features/OnHover.js`
- Current `cgrid/src/interaction/pointerInput.ts` and `keyboardInput.ts`

**Files:**
- Create: `cgrid/src/interaction/feature.ts` (abstract base class)
- Create: `cgrid/src/interaction/features/cellSelection.ts`
- Create: `cgrid/src/interaction/features/columnResizing.ts`
- Create: `cgrid/src/interaction/features/keyPaging.ts`
- Create: `cgrid/src/interaction/features/onHover.ts`
- Create: `cgrid/src/interaction/features/headerClick.ts` (sort cycling)
- Create: `cgrid/src/interaction/featureChain.ts` (builds + dispatches)
- Delete: `cgrid/src/interaction/pointerInput.ts`
- Delete: `cgrid/src/interaction/keyboardInput.ts`
- Modify: `cgrid/src/velocityGrid.ts` (instantiate FeatureChain, wire canvas events through it)
- Update: `cgrid/tests/keyboardInput.test.ts` → rename to `featureChain.test.ts`; update `pointerInput.test.ts` likewise

**Interfaces:**
```ts
// cgrid/src/interaction/feature.ts
export interface VelocityGridEventCtx {
  grid: VelocityGridLike;                 // exposes hitTester, viewport, selection, cgrid api
  hit: Hit;                         // already typed in hitTester.ts
  point: { x: number; y: number };
  mousePoint?: { x: number; y: number };  // cell-local
  raw: MouseEvent | KeyboardEvent | WheelEvent;
}

export abstract class Feature {
  next: Feature | null = null;
  cursor: string | null = null;    // assigned during mousemove; chain walk picks last non-null
  append(f: Feature): this { let cur: Feature = this; while (cur.next) cur = cur.next; cur.next = f; return this; }
  handleMouseDown(ctx: VelocityGridEventCtx): void  { this.next?.handleMouseDown(ctx); }
  handleMouseUp(ctx: VelocityGridEventCtx): void    { this.next?.handleMouseUp(ctx); }
  handleMouseMove(ctx: VelocityGridEventCtx): void  { this.next?.handleMouseMove(ctx); }
  handleClick(ctx: VelocityGridEventCtx): void      { this.next?.handleClick(ctx); }
  handleDoubleClick(ctx: VelocityGridEventCtx): void{ this.next?.handleDoubleClick(ctx); }
  handleKeyDown(ctx: VelocityGridEventCtx): void    { this.next?.handleKeyDown(ctx); }
  handleWheel(ctx: VelocityGridEventCtx): void      { this.next?.handleWheel(ctx); }
  setCursor(grid: VelocityGridLike): void {
    this.next?.setCursor(grid);
    if (this.cursor) grid.canvas.canvas.style.cursor = this.cursor;
  }
}
```

**Steps:**

1. Define `Feature` (above).
2. Port `OnHover`: tracks `lastHoveredCell` on mousemove; sets `cursor = 'pointer'` on header hover; calls `grid.canvas.requestRepaint()` when hover changes (so painters can render hover bg later).
3. Port `ColumnResizing`: on mousedown over header resize hot zone (±3px from `vc.right`), record `{ column, startWidth, startX }`. On mousedrag, update column width via `grid.resizeColumn(colId, dx)`. On mousemove (no drag), set `cursor = 'col-resize'` if over hot zone, else `null`. Always forward.
4. Port `CellSelection`: on mousedown over a cell, call `grid.selection.setFocus(rowIndex, colId)` and `selectSingle` / `toggleMulti` / `range` based on modifiers (same logic as current `pointerInput.ts`). On `handleKeyDown` for arrow keys, compute next focused cell using `grid.allColIds()` and `grid.totalRowCount()`, set focus, then `grid.ensureRowVisible / ensureColIdVisible`.
5. Port `KeyPaging`: PageDown / PageUp / Home / End.
6. Port `HeaderClick`: on `handleClick` if `hit.kind === 'header'`, call `grid.cycleSort(colId)`.
7. `FeatureChain` class assembles the chain, owns the canvas event listeners (mousedown/up/move/click/dblclick/wheel + keydown on the canvas), translates events to `VelocityGridEventCtx`, dispatches into the chain, then walks `setCursor` to reconcile cursor.
8. `velocityGrid.ts`: replace `this.pointer` and `this.keyboard` with `this.featureChain = new FeatureChain(...)`. On destroy, call `featureChain.destroy()`.
9. Migrate tests: the existing `keyboardInput.test.ts` becomes `featureChain.test.ts`, dispatches synthetic KeyboardEvents on the canvas, asserts `selection.state.focusedRowIndex` updates. The pointerInput tests likewise.
10. Manual verification: click cells, arrow-key navigate, Tab/Shift+Tab, drag column edges to resize, click header to cycle sort. All work.
11. Run unit + typecheck + build + E2E. Commit:
    ```
    refactor(cgrid): feature-chain interaction model
    ```

**Acceptance criteria:**
- [ ] No `pointerInput.ts` or `keyboardInput.ts` in the tree.
- [ ] At least 5 feature files under `interaction/features/`.
- [ ] All existing interactions still work (click, drag-resize, arrow nav, Tab, header sort, wheel scroll).
- [ ] All unit + E2E pass.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-23-canvasgrid-hypergrid-port.md and execute Task 5 (by-rows painter + cell-renderer config layering). Confirm Task 4 is committed. This is the final port task — after it, the architecture is fully hypergrid-style.
```

---

## Task 5 — by-rows painter + cell-renderer config layering

**Goal:** Replace the header/body/pinned trio of painters with a unified `paintCellsByRows` that loops `visibleRows × visibleColumns` (matching hypergrid). Bundle consecutive rows with the same background color into single fillRects (row-stripe optimization). Layer cell-renderer config so renderers receive a merged `gridProps + colProps + cellProps` object.

**Why:** Today every cell self-fills its background even when 100 consecutive rows have the same color (one fillRect could replace 100). And cell renderers don't see column or grid theme overrides — they hard-code from theme directly. Layering unlocks per-column styling (number columns right-aligned, status columns with badge bg, etc.) without touching the renderer.

**Read first:**
- `docs/hypergrid-audit/02-renderer-and-subgrids.md` sections 3-5
- `/Users/develop/wfh/hypergrid/src/renderer/by-rows.js`
- `/Users/develop/wfh/hypergrid/src/renderer/bundle-rows.js` (look in `src/renderer/` for actual filename)
- `docs/hypergrid-audit/04-models-and-cell-renderers.md` section 3
- Current cgrid painters

**Files:**
- Create: `cgrid/src/renderer/painters/byRows.ts`
- Modify: `cgrid/src/renderer/renderer.ts` (call byRows instead of header+body+pinned)
- Modify: `cgrid/src/renderer/cellRenderers/registry.ts` (paint signature accepts merged config; remove direct theme reads)
- Modify: `cgrid/src/core/propertyChain.ts` (add helper `mergeCellProps(gridProps, colProps, cellProps): CellPaintConfig`)
- Possibly delete: `headerPainter.ts`, `bodyPainter.ts`, `pinnedPainter.ts` (their logic now lives in byRows + per-subgrid dispatch)
- Update: `cgrid/tests/painters.test.ts` → `cgrid/tests/byRows.test.ts`

**Interfaces:**
```ts
// cgrid/src/renderer/cellRenderers/registry.ts
export interface CellPaintConfig {
  value: unknown;
  valueFormatted: string;
  bounds: { x: number; y: number; w: number; h: number };
  font: string;
  fg: string;
  bg: string;                       // resolved with bundles in mind (may equal prefill)
  borderColor: string;
  halign: 'left' | 'right' | 'center';
  prefillColor: string;             // what's painted under this cell (skip fill if equal)
  isFocused: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isHeader: boolean;
  flashAlpha?: number;
}
export interface CellPainter {
  paint(gc: CachedContext2D, p: CellPaintConfig): void;
}

// cgrid/src/renderer/painters/byRows.ts
export function paintCellsByRows(gc: CachedContext2D, p: PainterCtx): void;
```

**Steps:**

1. Implement `paintCellsByRows`:
   - Step 1: full-canvas bg fillRect (already done in renderer top-level).
   - Step 2: build `rowBundles` (array of `{ top, bottom, bg }`) — walk `visibleRows`, group consecutive rows with same `bgFor(row)`. `bgFor(row)` returns header bg for header subgrids, alt-row stripe for data subgrids, selection bg for selected rows.
   - Step 3: paint each bundle as one `gc.clearFill(0, bundle.top, viewWidth, bundle.bottom - bundle.top, bundle.bg)`.
   - Step 4: nested loop `for row of visibleRows: for col of visibleColumns: _paintCell(gc, row, col, prefillColor[r])`.
   - `_paintCell` builds the merged `CellPaintConfig` (gridProps + colProps + cell-specific overrides), calls `cellRenderer.paint(gc, config)`.
2. `mergeCellProps`: layered access via getter — `gridProps.font` overridden by `colDef.cellStyle?.font` overridden by per-cell flash overlay. Keep it allocation-free: reuse a single config object that's repopulated each cell.
3. Selection / focus rendering: stays in `paintOverlay` (focus ring is drawn after byRows). Selection background goes into `bgFor(row)`.
4. Pinned columns: byRows iterates `visibleColumns` once — pinned cols are at the start of `visibleColumns` and at fixed positions (no scroll offset). Same loop handles them.
5. Delete (or empty) `headerPainter.ts`, `bodyPainter.ts`, `pinnedPainter.ts` — their work is now subsumed into byRows. Keep `gridLinesPainter.ts` and `overlayPainter.ts`.
6. Rewrite painter tests around `byRows` — assert bundle math (3 rows with same bg → 1 bundle fillRect), assert cell paint count, assert merged config (overriding `font` on a column propagates to the cell renderer's `p.font`).
7. Manual verification: visual parity with Task 4 output. Run + scroll + sort + select.
8. Run unit + typecheck + build + E2E. Commit:
   ```
   refactor(cgrid): unified by-rows painter with bundle optimization + config layering
   ```

**Acceptance criteria:**
- [ ] `byRows.ts` exists; renderer calls it once per frame.
- [ ] Bundled fillRect count for N consecutive same-bg rows = 1.
- [ ] Cell renderer no longer reads theme directly — only from config.
- [ ] All unit + E2E pass; visual parity with Task 4.

**This is the last task in the port.** After Task 5, the canvasgrid render layer is hypergrid-architected end-to-end, on top of our worker pipeline + native scrollbars + TS types. Future feature work (totals row, fill-handle, range select) becomes additive.

---

## Quick reference — per-task workflow

For every task:

1. Open a fresh Claude Code session at the repo root (`/Users/develop/wfh/canvasgrid`).
2. Paste the "Next session prompt" from the previous task (or the Task-1 prompt below for the first task).
3. The session reads this worklog + audit refs, executes the task's Steps, runs the verification commands, and commits.
4. When done, the session ends with the prompt for the NEXT task.

### Task 1 starter prompt (first session, copy-paste):

```
Read docs/superpowers/plans/2026-06-23-canvasgrid-hypergrid-port.md and execute Task 1 (Port Canvas wrapper + graphics cache). Read docs/hypergrid-audit/01-canvas-and-paint-loop.md before touching any code. This is the first session of a multi-session port; follow the Global Constraints, do not skip the verification commands, and commit at the end.
```
