# Canvasgrid Foundation Track — Design

**Date:** 2026-06-23
**Status:** Design (awaiting user review)
**Cycle:** Foundation track — first build cycle of the canvas-grid program. Follows the AG Grid Feature Catalog cycle (`docs/superpowers/specs/2026-06-22-ag-grid-feature-catalog-design.md`), whose 26 area files + `Canvas-port implications` sections are the concrete input checklist for this design.

---

## 1. Problem & motivation

Build the foundation of a vanilla TS/JS canvas-based grid that can replace AG Grid in the existing STOMP PositionsGrid showcase. The thesis: **execute all data manipulation (sort / filter / aggregate) in a Web Worker, transfer viewport-shaped chunks to main thread as transferable typed arrays, and paint only the cells the viewport allows. This keeps the UI thread free even under streaming load.**

This cycle's output is **the Foundation only** — render engine + viewport virtualization + worker data pipeline + minimum interactive viability. Filtering UI, grouping UX, sidebar, status bar, master/detail, pivoting, charts, range selection, status bar, themes-beyond-tokens, and SSRM are each their own future cycle, designed against the same interfaces this cycle establishes.

The user's directive: vanilla TS/JS for the library (no framework dependency); existing React showcase moves to `apps/showcase/`; canvas grid library lives at the repo root as `cgrid/`; demo apps live under `apps/`.

## 2. Scope

**In scope (this cycle):**

- Repo restructure: npm workspaces with `cgrid/` (library) + `apps/showcase/` (existing AG Grid React app, relocated) + `apps/cgrid-positions/` (new vanilla TS demo).
- `cgrid/` library: imperative `VelocityGrid` class, typed event emitter, public API for data ingestion (full + sync transaction + async transaction), single + multi row selection, focused-cell concept, text + number cell editors via DOM overlay, ARIA-overlay accessibility scaffold, theme via `--vg-*` CSS custom properties.
- Render engine: single-canvas layered painters (header / pinned-left / body / pinned-right / overlay), DPR-aware paint, dirty-region accumulation, rAF paint loop, cell-flash animation primitive.
- Viewport virtualization: pre-computed `visibleColumns[]` / `visibleRows[]`, binary-search hit-testing, scroll model, pinned column regions, flex column sizing, basic uniform row height (per-row height is a follow-up cycle).
- Worker data pipeline: Client-Side Row Model (CSRM) with sort / filter / aggregation in worker, transactional async batching, viewport slicer returning packed transferable chunks, typed RPC protocol with id correlation, push events for async-flush notifications.
- Cell-paint contract: typed `CellPainter` interface; ships with built-in `text`, `number`, `checkbox` painters. Custom painters register by name; reference in `CColDef.cellRenderer`.
- Demo app `apps/cgrid-positions/`: vanilla TS shell consuming the existing STOMP feed at `localhost:8081`, mirroring the showcase's column set and aggregation model.

**Out of scope (deferred to later cycles):**

- Filtering UI (popups, floating filters, multi-filter, set filter).
- Grouping UX (drag-to-group panel, group row display variants beyond a single-column expand/collapse).
- Pivoting.
- Master/detail.
- Tree data.
- Server-side row model (SSRM), Infinite row model, Viewport row model.
- Status bar, side bar, tool panels.
- Context menu, clipboard processing.
- Cell-range selection, fill handle, range chart.
- Integrated charts, sparklines.
- Export (CSV / Excel).
- Custom cell renderers beyond text/number/checkbox.
- Custom cell editors beyond text/number.
- Per-row variable height.
- RTL layout.
- `domLayout: 'autoHeight' | 'print'`.
- Themes beyond Quartz Light + Quartz Dark.

Each maps to one or more catalog areas (01–26); each becomes its own brainstorm → spec → plan cycle.

## 3. Sources informing this design

In priority order:

1. **AG Grid 35.3.1 Feature Catalog** (`docs/catalog/`). The 26 area files' `## Canvas-port implications` sections are the concrete requirements ledger. Every design decision below traces back to a catalog statement.
2. **Hypergrid architectural analysis** (`/Users/develop/wfh/hypergrid/`). Patterns adopted: chain-of-responsibility input pipeline (the catalog calls this out as the right pattern for canvas grids), pluggable painters, pre-computed `visibleColumns/visibleRows` arrays for hit-test, typed cell-paint contract with DOM-overlay editors, property-layer prototype chain for cell/row/column style. Patterns rejected: synchronous main-thread data pipeline, "view-only" stance that punts sort/filter/agg/SSRM to the consumer, weak event contract without cancellation, ES5 + non-modular OOP.
3. **STOMP PositionsGrid showcase** (`apps/showcase/src/`). Sets the target workload: ~3000-row snapshot, ~100 row updates per ~143 ms tick, multi-level grouping (deferred to a later cycle for cgrid; CSRM + flat data is enough for the Foundation demo), cell flash on change, pinned columns, multi-row selection.
4. **W3C WAI-ARIA grid pattern** (referenced, not implemented from scratch). The accessibility scaffold mirrors SlickGrid / FlexGrid conventions where one focused-row window of DOM cells provides screen-reader access without instantiating the full grid in DOM.

## 4. Architecture overview

Three logically separate execution contexts: main thread (renderer + interaction), Web Worker (data pipeline), DOM overlays (editor + ARIA scaffold sit alongside the canvas).

```
┌───────────────────────────── Main Thread ─────────────────────────────┐
│  Public API: class VelocityGrid                                              │
│    - Constructor: new VelocityGrid(container, options)                       │
│    - Imperative methods (setRowData, applyTransaction, …)             │
│    - Typed event emitter (cellClicked, viewportChanged, …)            │
│           │                                            │              │
│           ▼                                            ▼              │
│  Renderer                                  InteractionLayer           │
│    - Paint loop (rAF)                        - HitTester              │
│    - Dirty regions                           - PointerEvents          │
│    - Layered painters:                       - KeyboardEvents         │
│      header / pinned / body / overlay        - SelectionModel         │
│    - CellPainter registry                    - EditorOverlay (DOM)    │
│           │                                  - A11yOverlay (ARIA DOM) │
│           │                                        │                  │
│           └────────────── WorkerClient ────────────┘                  │
│                  (typed RPC + transferable chunks)                    │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ postMessage (with transfer)
┌───────────────────────────────▼───────────────────────────────────────┐
│                          Web Worker                                   │
│  DataPipeline                                                         │
│    - RowStore (full data, keyed by getRowId)                          │
│    - ColumnRegistry (CColDef + derived comparators)                   │
│    - Filter → Sort → GroupAgg → ViewportSlicer                        │
│    - TransactionQueue (async batching)                                │
└───────────────────────────────────────────────────────────────────────┘
```

Eight units, each one file or one small folder, each with a well-defined interface boundary: `Renderer`, `InteractionLayer`, `HitTester`, `SelectionModel`, `EditorOverlay`, `A11yOverlay`, `WorkerClient` (main side), `DataPipeline` (worker side). The split keeps every unit small enough to be reasoned about in isolation and tested without the others.

## 5. Repo layout

```
canvasgrid/                              ← repo root (existing)
  package.json                           ← workspace root: npm workspaces
  apps/
    showcase/                            ← existing AG Grid React showcase, RELOCATED here
      package.json                       ← keeps its current deps
      src/...                            ← unchanged content; moved as-is
      vite.config.ts
    cgrid-positions/                     ← NEW vanilla TS demo
      package.json                       ← deps: @stomp/stompjs, cgrid (workspace:*)
      src/
        main.ts                          ← bootstrap entry
        positionsGrid.ts                 ← grid config + STOMP wiring
        index.html
        style.css
      vite.config.ts
  cgrid/                                 ← NEW library (vanilla TS, no framework)
    package.json                         ← name: "cgrid", main: dist/velocity-grid.js, exports
    tsconfig.json
    vite.config.ts                       ← library mode + worker plugin
    src/
      velocityGrid.ts                           ← public class VelocityGrid + re-exports
      types.ts                           ← all public types
      core/
        viewport.ts                      ← visibleColumns/visibleRows math + hit-test
        paintLoop.ts                     ← rAF driver + dirty-region accumulator
        eventEmitter.ts                  ← tiny typed emitter
        propertyChain.ts                 ← layered defaults (grid/col/row/cell)
        layout.ts                        ← column flex/width resolution
      renderer/
        renderer.ts                      ← orchestrator
        painters/
          headerPainter.ts
          bodyPainter.ts
          pinnedPainter.ts
          overlayPainter.ts              ← selection rect, focus ring, drag-ghost
        cellRenderers/
          textCell.ts
          numberCell.ts
          checkboxCell.ts
          registry.ts                    ← name → CellPainter map
      interaction/
        hitTester.ts
        pointerInput.ts
        keyboardInput.ts
        selectionModel.ts
        editorOverlay.ts                 ← DOM <input>/<select> overlay
        a11yOverlay.ts                   ← ARIA grid scaffolding for screen readers
      worker/
        client.ts                        ← main-thread RPC client + transferable channel
        protocol.ts                      ← shared message types (used both sides)
        worker.ts                        ← worker entry point
        dataPipeline.ts                  ← RowStore + Filter/Sort/Agg/Slicer pipeline
        chunkFormat.ts                   ← typed-array chunk encode/decode
      theming/
        tokens.css                       ← --vg-* default values
        cssReader.ts                     ← getComputedStyle → render-time tokens
  docs/...                               ← catalog + specs + plans (unchanged from prior cycles)
  node_modules/
```

The `apps/showcase/` move is a simple `git mv` of the existing `src/`, `index.html`, `package.json`, etc. `cgrid/` and `apps/cgrid-positions/` are new. The root `package.json` declares `workspaces: ['cgrid', 'apps/*']`.

## 6. Render engine

### 6.1 Paint loop

Single `requestAnimationFrame` loop in `paintLoop.ts`. Each frame:

1. If `dirty.regions.length === 0`, return.
2. For each dirty region, compute the intersection with the visible viewport.
3. Run painters in order: `headerPainter` (only if a header region is dirty), `pinnedPainter(left)` (only if a left-pinned region is dirty), `bodyPainter` (only for body dirty rects), `pinnedPainter(right)`, `overlayPainter` (selection + focus ring).
4. Clear `dirty.regions`.

Dirty regions accumulate from:

- **Scroll change.** Mark the full body rect dirty.
- **Viewport chunk arrival.** Mark each row covered by the chunk dirty.
- **Selection change.** Mark previous + new selection rects dirty.
- **Cell-flash tick.** Mark each currently-flashing cell dirty (this drives the animation).
- **Theme change.** Mark everything dirty.
- **Column resize.** Mark body + pinned dirty.

### 6.2 Layered painters

One `<canvas>` element, not stacked DOM canvases. Painters draw in z-order:

1. `headerPainter` — column header row(s).
2. `pinnedPainter('left')` — left-pinned column band including its header.
3. `bodyPainter` — scrollable body region.
4. `pinnedPainter('right')` — right-pinned column band.
5. `overlayPainter` — selection rectangle(s), focused-cell ring, drag-ghost during column move.

Single canvas keeps composite cost low and hit-testing simple (all painters share the same coordinate system). Layered painters' state is independent of each other; each can be tested in isolation with a mock `CanvasRenderingContext2D`.

### 6.3 Viewport math

`viewport.ts` keeps two pre-computed arrays, recomputed when scroll or layout changes:

```typescript
interface VisibleColumn { colId: string; index: number; left: number; right: number; width: number; pinned?: 'left' | 'right'; }
interface VisibleRow    { rowId: string; index: number; top: number; bottom: number; height: number; }
```

`hitTester.locate(x, y)` runs binary search on these arrays. Returns one of:

```typescript
type Hit =
  | { kind: 'header';          colId: string }
  | { kind: 'headerResizer';   colId: string }            // 4-px wide hot zone on column right edge
  | { kind: 'cell';            rowId: string; colId: string }
  | { kind: 'pinnedSplitter';  side: 'left' | 'right' }
  | { kind: 'scrollbar';       axis: 'x' | 'y' }
  | { kind: 'empty' };
```

The 4-pixel resizer hot zone uses CSS `--vg-resizer-hot-zone` so themes can adjust feel.

### 6.4 Cell-paint contract

```typescript
interface CellPainter<TValue = unknown> {
  paint(ctx: CanvasRenderingContext2D, params: CellPaintParams<TValue>): void;
  /** Optional measure pass for auto-sizing. */
  measure?(params: CellPaintParams<TValue>): { minWidth: number };
}

interface CellPaintParams<TValue> {
  value: TValue;
  valueFormatted: string;
  bounds: { x: number; y: number; w: number; h: number };
  style: ResolvedCellStyle;
  flashAlpha?: number;
  isFocused: boolean;
  isSelected: boolean;
  isHovered: boolean;
}

interface ResolvedCellStyle {
  font: string;             // canvas font string
  fg: string;
  bg: string;
  borderColor: string;
  halign: 'left' | 'right' | 'center';
}
```

No DOM access. No JSX. Custom painters register by name; `CColDef.cellRenderer: 'sparkline'` looks up the registered painter. Painters are pure functions of their params — easy to test, easy to swap.

### 6.5 DPR (device pixel ratio) handling

```typescript
const dpr = window.devicePixelRatio || 1;
canvas.width  = cssWidth  * dpr;
canvas.height = cssHeight * dpr;
canvas.style.width  = cssWidth  + 'px';
canvas.style.height = cssHeight + 'px';
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

Done once per `ResizeObserver` callback and once when DPR changes (matches `window.matchMedia('(resolution: ...)')` change). Text glyphs use `ctx.textBaseline = 'middle'` and y-coordinates snapped to integer CSS pixels.

### 6.6 Cell-flash animation

The catalog `04-data-updates.md` flagged this: CSS transitions aren't available for canvas cells, so flash must be a per-frame paint primitive.

```typescript
interface FlashEntry { rowId: string; colId: string; startedAt: number; fromColor: string; toColor: string; }
```

`FlashRegistry` keeps active entries. Each frame, for each entry whose `now - startedAt < cellFlashDuration + cellFadeDuration`, the renderer computes `flashAlpha` (1 during `cellFlashDuration`, then linear fade to 0 over `cellFadeDuration`) and includes the cell's rect in `dirty.regions`. Painters read `params.flashAlpha` and blend the cell's fill toward `flash-from-color → flash-to-color`. Entries auto-expire.

The worker's viewport chunk carries a `flashMask: Uint8Array` per request — one bit per cell — marking which cells changed in the last transaction. The main side feeds these into `FlashRegistry` on receive.

## 7. Worker data pipeline

### 7.1 In-worker state

- **RowStore** — `Map<string, TRow>` keyed by `getRowId(row)`. Source of truth for current data.
- **ColumnRegistry** — `ResolvedColDef[]`, built from `CColDef[]` at init. Holds resolved field-path getters, comparators, agg functions, parsed `cellRenderer` names.
- **PipelineCache** — last sort order (`Uint32Array` of row indices), last filter mask (`Uint8Array`), last group/agg result tree. Each invalidated by upstream change.
- **TransactionQueue** — pending `{ add, update, remove }` batches. Flushed on a `setTimeout`-driven debounce timer of `asyncTransactionWaitMillis` (default 50 ms, matching the showcase).

### 7.2 Pipeline order

```
RowStore  →  Filter  →  Sort  →  GroupAgg  →  ViewportSlicer
              │           │          │              │
          (filter      (sorted     (flat row +    (packed chunk
           mask         indices     group rows     for one viewport
           cached)      cached)     intermixed)    range, transferable)
```

Each stage memoizes against the prior stage's result + its own input params. A no-op stage shortcuts to its input (e.g., empty filter model → filter pass is identity).

Stages are pure functions of their inputs + cache; they don't mutate `RowStore`. Mutation only happens in `TransactionQueue.flush()`, which updates `RowStore` and invalidates the cache.

### 7.3 Viewport request

Main asks:

```typescript
interface ViewportRequest {
  rowStart: number;            // index into post-pipeline visible rows
  rowEnd: number;              // exclusive
  columns: string[];           // colIds to include
  includeFlashMask?: boolean;  // for streaming highlights
}
```

Worker computes the chunk and returns it via the response.

### 7.4 Chunk format (`chunkFormat.ts`)

```typescript
interface ViewportChunk {
  rowStart: number;
  rowCount: number;
  rowIds:    Uint32Array;                                    // hashed numeric ID per row
  rowKinds:  Uint8Array;                                     // 0 = leaf, 1 = group, 2 = grandTotal, 3 = footer
  groupDepth: Uint8Array;                                    // 0..N for groups
  numericCols: Record<string, Float64Array>;                 // colId → values
  textCols:    Record<string, {                              // colId → UTF-8 dictionary
    offsets: Uint32Array;                                    //  offsets[i] = start of string i
    bytes:   Uint8Array;                                     //  UTF-8 bytes for all strings concatenated
  }>;
  flashMask?: Uint8Array;                                    // optional, bit i = cell-changed flag
}
```

`rowIds` are numeric hashes of the string `getRowId()` — main side resolves back via a small `Map<number, string>` kept on the main side. The trick avoids shipping strings for IDs every frame.

`flashMask` packs one bit per cell in row-major order: bit at index `r * columns.length + c`.

All typed arrays — and each `ArrayBuffer` underlying them — ride the `postMessage` transfer list. Zero-copy on receive.

### 7.5 Async transaction batching

```typescript
applyTransactionAsync(t: Tx): void {
  this.queue.push(t);
  if (!this.flushTimer) {
    this.flushTimer = setTimeout(() => this.flushQueue(), this.asyncTransactionWaitMillis);
  }
}

flushQueue(): void {
  const merged = mergeTransactions(this.queue);  // dedupe by rowId across the batch
  this.queue.length = 0;
  this.flushTimer = null;
  const results = this.applyToStore(merged);
  this.invalidatePipelineCache();
  this.push({ type: 'asyncTransactionsFlushed', results });
  this.push({ type: 'modelUpdated', visibleCount: this.computeVisibleCount() });
}
```

Catalog's `04-data-updates.md` flagged this exact pattern.

## 8. RPC protocol

```typescript
// worker/protocol.ts — used on BOTH main and worker sides

export type ReqId = number;

export type WorkerRequest =
  | { id: ReqId; type: 'init';             payload: { columnDefs: CColDef[]; defaultColDef?: Partial<CColDef>;
                                                       getRowIdRef: string /* not the fn — it gets re-evaluated by name */ } }
  | { id: ReqId; type: 'setRowData';       payload: { rows: unknown[] } }
  | { id: ReqId; type: 'applyTransaction'; payload: { add?: unknown[]; update?: unknown[]; remove?: unknown[];
                                                       async: boolean } }
  | { id: ReqId; type: 'setSortModel';     payload: SortModel }
  | { id: ReqId; type: 'setFilterModel';   payload: FilterModel }
  | { id: ReqId; type: 'setGroupModel';    payload: GroupModel }
  | { id: ReqId; type: 'getViewport';      payload: ViewportRequest };

export type WorkerResponse =
  | { id: ReqId; type: 'ready' }
  | { id: ReqId; type: 'rowCount';            count: number; visibleCount: number }
  | { id: ReqId; type: 'viewport';            chunk: ViewportChunk }
  | { id: ReqId; type: 'transactionFlushed';  results: TransactionResult }
  | { id: ReqId; type: 'error';               error: string };

export type WorkerPush =
  | { type: 'modelUpdated';              visibleCount: number }
  | { type: 'asyncTransactionsFlushed';  results: TransactionResult[] };
```

`WorkerClient` (main side) keeps `Map<ReqId, { resolve, reject }>`. Pushes are emitted directly via the public event emitter. The worker side runs a single `self.onmessage` switch.

The catalog gap "no worker integration" identified in the hypergrid analysis is closed by this protocol — and the public API never exposes the worker boundary, so it can later evolve (e.g., to OffscreenCanvas) without breaking consumers.

## 9. Object model

The public types — all under `cgrid/src/types.ts`:

```typescript
// Top-level options
export interface VelocityGridOptions<TRow = any> {
  columnDefs: CColDef<TRow>[];
  defaultColDef?: Partial<CColDef<TRow>>;
  rowData?: TRow[];
  getRowId: (row: TRow) => string;          // MANDATORY (per catalog 03-row-models.md, 04-data-updates.md)
  rowHeight?: number;                       // px; default 30
  headerHeight?: number;                    // px; default 32
  rowSelection?: 'none' | 'single' | 'multiple';   // default 'none'
  enableCellChangeFlash?: boolean;          // default false
  cellFlashDuration?: number;               // ms; default 500
  cellFadeDuration?: number;                // ms; default 1000
  asyncTransactionWaitMillis?: number;      // ms; default 50
  theme?: string;                           // CSS class name; library ships 'vg-theme-quartz', 'vg-theme-quartz-dark'
  worker?: { url?: string };                // dependency-injection for custom worker URL (Vite, etc.)
}

// Column definition
export interface CColDef<TRow = any, TValue = any> {
  colId?: string;                           // defaults to field
  field?: keyof TRow & string;
  headerName?: string;
  width?: number;
  flex?: number;
  minWidth?: number;
  maxWidth?: number;
  pinned?: 'left' | 'right';
  type?: 'text' | 'number';
  valueGetter?: (params: CValueGetterParams<TRow>) => TValue;
  valueFormatter?: (params: CValueFormatterParams<TRow, TValue>) => string;
  cellRenderer?: string;                    // registered painter name
  comparator?: (a: TValue, b: TValue, ar: TRow, br: TRow) => number;
  filter?: 'text' | 'number';               // Foundation: simple types only
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  sortable?: boolean;                       // default true
  resizable?: boolean;                      // default true
  editable?: boolean | ((row: TRow) => boolean);
  cellEditor?: 'text' | 'number';
}

// Value getter / formatter params
export interface CValueGetterParams<TRow> { data: TRow; colId: string; }
export interface CValueFormatterParams<TRow, TValue> { data: TRow; value: TValue; colId: string; }

// Sort, filter, group models
export interface SortModelEntry  { colId: string; direction: 'asc' | 'desc'; }
export type     SortModel        = SortModelEntry[];

export type FilterModelEntry =
  | { type: 'text'; op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { type: 'number'; op: 'eq' | 'gt' | 'lt' | 'between'; value: number; value2?: number };
export type FilterModel = Record<string, FilterModelEntry>;

export interface GroupModel { rowGroupCols: string[]; }   // Foundation: one-level group ordering; full path-trees later

// Transaction result
export interface TransactionResult {
  add:    { rowId: string }[];
  update: { rowId: string }[];
  remove: { rowId: string }[];
}

// Events
export type VelocityGridEvent =
  | { type: 'gridReady';              api: VelocityGridApi }
  | { type: 'cellClicked';            rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellDoubleClicked';      rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellFocused';            rowId: string; colId: string }
  | { type: 'cellValueChanged';       rowId: string; colId: string; oldValue: unknown; newValue: unknown }
  | { type: 'selectionChanged';       selectedRowIds: string[] }
  | { type: 'viewportChanged';        firstRow: number; lastRow: number }
  | { type: 'modelUpdated';           visibleRowCount: number }
  | { type: 'sortChanged';            sortModel: SortModel }
  | { type: 'filterChanged';          filterModel: FilterModel }
  | { type: 'columnResized';          colId: string; width: number }
  | { type: 'asyncTransactionsFlushed'; results: TransactionResult[] };

// Public API surface (returned from VelocityGrid construction)
export interface VelocityGridApi {
  setRowData(rows: any[]): void;
  applyTransaction(t: Tx): TransactionResult;
  applyTransactionAsync(t: Tx): void;
  flushAsyncTransactions(): void;

  setSortModel(s: SortModel): void;
  setFilterModel(f: FilterModel): void;
  setGroupModel(g: GroupModel): void;

  ensureRowVisible(rowId: string, position?: 'top' | 'middle' | 'bottom'): void;
  getSelectedRowIds(): string[];
  setSelectedRowIds(ids: string[]): void;

  getFocusedCell(): { rowId: string; colId: string } | null;
  setFocusedCell(rowId: string, colId: string): void;

  refresh(): void;
  destroy(): void;
}
```

## 10. Public class and interaction layer

### 10.1 Public class

```typescript
class VelocityGrid<TRow = any> {
  constructor(container: HTMLElement, options: VelocityGridOptions<TRow>);

  // Public methods mirror VelocityGridApi above
  setRowData(rows: TRow[]): void;
  applyTransaction(t: Tx): TransactionResult;
  applyTransactionAsync(t: Tx): void;
  // …

  // Typed event subscription; returns unsubscribe fn
  on<E extends VelocityGridEvent['type']>(
    type: E,
    handler: (e: Extract<VelocityGridEvent, { type: E }>) => void,
  ): () => void;

  destroy(): void;
}
```

Construction flow:

1. Build container DOM: `<div class="vg-root">` with child `<canvas>` + hidden `<div role="grid">` (ARIA scaffold) + popup root for editor overlays.
2. Resolve theme tokens via `cssReader`.
3. Instantiate worker (`new Worker(new URL('./worker/worker.ts', import.meta.url), { type: 'module' })` — Vite handles the bundling).
4. Send `init` request to worker with column defs + the field/path expressions needed to reconstruct `getRowId` and `valueGetter` server-side (functions are serialized as named refs into a small library of safe expressions; arbitrary fn injection is a known limitation closed in a later cycle).
5. Wait for `ready`.
6. Wire pointer + keyboard input. Mount initial empty paint.
7. Emit `gridReady`.

### 10.2 SelectionModel

```typescript
class SelectionModel {
  focusedRowId: string | null = null;
  focusedColId: string | null = null;
  selectedRowIds = new Set<string>();

  selectSingle(rowId: string): void;
  toggleMulti(rowId: string): void;
  range(fromRowId: string, toRowId: string): void;   // Shift+click semantics
  clear(): void;
}
```

Selection edits emit `selectionChanged` and mark affected rows dirty. `focusedRowId` / `focusedColId` separately emit `cellFocused`.

### 10.3 EditorOverlay

A single `<div class="vg-editor-overlay">` rooted to the container, positioned absolutely. On `cellDoubleClicked` or `F2` keypress over an `editable` cell:

1. Resolve CSS-pixel bounds from canvas pixels (`bounds / dpr`).
2. Mount the appropriate editor (`<input type="text">` or `<input type="number">`) sized to bounds.
3. Focus + select the editor's content.
4. On `blur` or `Enter`, call `valueParser` if provided, compare to `oldValue`, dispatch `applyTransaction({ update: [{ …row, [field]: newValue }] })`, emit `cellValueChanged`. On `Escape`, discard.

DOM overlay strategy is hypergrid's pattern, AG Grid's pattern, and the only practical choice for canvas grids — confirmed by the catalog analysis.

### 10.4 A11yOverlay

The catalog's `20-keyboard-and-accessibility.md` Canvas-port implications: canvas is opaque to screen readers. The fix is a hidden DOM scaffold that mirrors *just the focused row's window* of cells, with ARIA roles:

```html
<div class="vg-a11y-root" role="grid"
     aria-rowcount={visibleRowCount}
     aria-colcount={columns.length}>
  <div role="row" aria-rowindex={focusedRowIndex + 1}>
    <div role="gridcell" tabindex="-1" aria-colindex="1" aria-label="Position ID: P-001-A">…</div>
    <div role="gridcell" tabindex="-1" aria-colindex="2" aria-label="CUSIP: 912828ZJ7">…</div>
    <!-- ~one per visible column for the focused row -->
  </div>
</div>
```

Hidden via `position: absolute; clip: rect(0 0 0 0); width: 1px; height: 1px;` (visually hidden but screen-reader available). Keyboard arrow keys route through the scaffold, calling back into `SelectionModel.setFocus(...)`, which both updates canvas focus and shifts the scaffold to the new row's data.

This pattern is taken from W3C WAI-ARIA grid pattern + SlickGrid's implementation. It keeps the DOM cost flat (one row × N cells) regardless of dataset size.

## 11. Theming

CSS custom properties as the canonical theme surface. The library ships defaults in `tokens.css` and the consumer applies a theme class to the container:

```css
.vg-theme-quartz {
  --vg-font-family: Inter, system-ui, -apple-system, sans-serif;
  --vg-font-size: 13px;
  --vg-line-height: 1.4;
  --vg-row-height: 30px;
  --vg-header-height: 32px;
  --vg-fg-color: #1a1f24;
  --vg-bg-color: #ffffff;
  --vg-row-alt-bg: #f4f6f8;
  --vg-header-bg: #e8ecef;
  --vg-header-fg: #1a1f24;
  --vg-border-color: #d5dbe0;
  --vg-grid-line-color: #e8ecef;
  --vg-row-hover-bg: #eef1f3;
  --vg-row-selected-bg: rgb(13 148 136 / 12%);
  --vg-focus-ring-color: #0d9488;
  --vg-focus-ring-width: 2px;
  --vg-flash-from-color: #fef3c7;
  --vg-flash-to-color: transparent;
  --vg-resizer-hot-zone: 4px;
  --vg-scrollbar-thickness: 8px;
  /* … ~30 tokens total */
}

.vg-theme-quartz-dark {
  --vg-bg-color: #0f172a;
  --vg-fg-color: #e2e8f0;
  --vg-header-bg: #1e293b;
  --vg-header-fg: #e2e8f0;
  --vg-border-color: #334155;
  --vg-grid-line-color: #1e293b;
  --vg-row-alt-bg: #111c2f;
  --vg-row-hover-bg: #1a2540;
  --vg-row-selected-bg: rgb(13 148 136 / 22%);
  --vg-flash-from-color: #b45309;
}
```

`cssReader.ts`:

```typescript
class CssReader {
  constructor(private container: HTMLElement) {}
  read(): ResolvedTheme {
    const cs = getComputedStyle(this.container);
    return {
      font: `${cs.getPropertyValue('--vg-font-size').trim()} ${cs.getPropertyValue('--vg-font-family').trim()}`,
      fg:  cs.getPropertyValue('--vg-fg-color').trim(),
      bg:  cs.getPropertyValue('--vg-bg-color').trim(),
      headerBg: cs.getPropertyValue('--vg-header-bg').trim(),
      // … one per token
    };
  }
}
```

Read once at render-start; cached per frame. Theme switch = consumer changes container's class; the next frame re-reads the tokens and the renderer marks everything dirty.

This is exactly AG Grid 35.x's `--ag-*` approach, renamed and read by canvas paint code instead of CSS rules. The catalog's `21-themes-and-styling.md` translates almost line-for-line.

## 12. Demo app

`apps/cgrid-positions/src/positionsGrid.ts` — entire file approximately:

```typescript
import { VelocityGrid, type VelocityGridOptions } from 'cgrid';
import { connectStomp } from './stomp';

interface Position {
  positionId: string; cusip: string; ticker: string;
  notionalAmount: number; currentPrice: number; pnl: number; /* … same shape as showcase */
}

const options: VelocityGridOptions<Position> = {
  columnDefs: [
    { field: 'positionId', headerName: 'Position ID', width: 150, pinned: 'left' },
    { field: 'cusip',      headerName: 'CUSIP',       width: 110, pinned: 'left' },
    { field: 'ticker',     headerName: 'Ticker',      width: 100 },
    { field: 'notionalAmount', headerName: 'Notional', type: 'number', width: 130, aggFunc: 'sum' },
    { field: 'currentPrice',   headerName: 'Price',    type: 'number', width: 100, aggFunc: 'avg' },
    { field: 'pnl',            headerName: 'P&L',      type: 'number', width: 110, pinned: 'right', aggFunc: 'sum' },
  ],
  getRowId: (row) => row.positionId,
  rowSelection: 'multiple',
  enableCellChangeFlash: true,
  cellFlashDuration: 500,
  cellFadeDuration: 800,
  asyncTransactionWaitMillis: 50,
  theme: 'vg-theme-quartz',
};

const container = document.getElementById('grid')!;
const grid = new VelocityGrid<Position>(container, options);

connectStomp({
  onSnapshot: (rows) => grid.setRowData(rows),
  onLiveUpdate: (updates) => grid.applyTransactionAsync({ update: updates }),
});
```

`apps/cgrid-positions/src/main.ts` and `index.html` are the minimal vanilla TS shell. No frameworks. ~200 LOC total in the demo.

## 13. Definition of done

This cycle is complete when:

1. Repo restructured: `apps/showcase/` contains the existing AG Grid React app (relocated, still runs via `npm run dev`); `cgrid/` is a workspace package exporting `VelocityGrid`; `apps/cgrid-positions/` is a workspace app running via `npm run dev`. Root `package.json` declares `workspaces: ['cgrid', 'apps/*']`.
2. `cgrid` builds cleanly (`tsc --noEmit` + `vite build`). Library is consumable via `import { VelocityGrid } from 'cgrid'`.
3. `apps/cgrid-positions` runs against `ws://localhost:8081`, paints a 3000-row snapshot, applies live updates from `applyTransactionAsync`, and stays at 60 fps under the showcase's existing load on a baseline 2024 MacBook Pro (measured via `performance.now()` in a stress harness; reported in the task's report file).
4. CSRM sort (any column) and filter (text `contains`, number `gt`) and a `sum` / `avg` agg run in the worker and reflect correctly in the rendered viewport.
5. Single + multi row selection works via checkbox column + Space key + Shift+click range.
6. Text + number cell editors work via double-click and F2; `cellValueChanged` event fires; new value persists through the worker transaction.
7. A11y scaffold passes axe-core with no Critical issues on the demo page. Screen-reader (VoiceOver, NVDA) reach the focused row's cells via arrow keys.
8. Theme switch between `vg-theme-quartz` and `vg-theme-quartz-dark` works by changing the container class; renderer reflects the new tokens on the next frame.
9. Catalog `Canvas-port implications` sections for areas 01 (grid options), 02 (column model), 03 (row models — CSRM only), 04 (data updates), 05 (rendering & DOM), 07 (sorting), 10 (aggregation — basic), 12 (selection — row + cell focus only), 20 (a11y — focused-row scaffold), and 21 (themes — Quartz Light + Dark) are demonstrably covered. Other areas remain catalog-only until their respective cycles.
10. README at `cgrid/README.md` explains how to consume the library, how the worker is bundled, and the public API. README at `apps/cgrid-positions/README.md` explains how to run the demo.

## 14. Risks & open questions

- **Function serialization to worker.** `valueGetter`, `valueFormatter`, `comparator`, `getRowId` are arbitrary functions. Strategy: in this cycle, support only string `field` paths (worker re-evaluates them safely); register custom getter/formatter expressions by name. Arbitrary function injection is a Foundation-2 cycle problem (likely via `eval`'d source string with strict CSP allowance, or shipping a small DSL).
- **Text rendering performance at 4K DPR.** `fillText` is fast; `measureText` is slow. Mitigation: per-column cached measurement based on `(font, formattedString.length)` heuristics; if still slow, fall back to ellipsis-on-overflow without measuring. Validated by the streaming demo as the canary.
- **Worker bandwidth at 100 rows × 25 cols × 7 Hz.** ~17.5k cell updates/s. Transferable typed arrays handle this comfortably (each chunk ~20 KB); verify with a stress harness.
- **A11y testing on canvas grids is rare.** Mitigation: copy patterns from SlickGrid + W3C WAI-ARIA grid pattern; run axe-core in CI; do at least one manual VoiceOver pass.
- **Open: Should we expose an OffscreenCanvas mode now or later?** Decision: later. The public API hides the worker boundary; we can add OffscreenCanvas as an internal optimization once a benchmark forces it.
- **Open: Should the demo also exercise grouping?** Decision: no — grouping UI is its own cycle. The Foundation demo uses flat data + agg only.

## 15. What this enables next

After this cycle, the natural next brainstorms are:

- **F2 — Filter UI track:** text/number filter popups, floating filter row, filter model wire-up in the worker, multi-filter shape. Catalog area 08.
- **F3 — Grouping/aggregation UI track:** group rows display, expand/collapse, agg result rendering, group selection. Catalog areas 09 + 10.
- **F4 — Status bar + side bar track:** built-in status panels, columns + filters tool panels. Catalog areas 17 + 18.
- **F5 — Cell-range selection + clipboard track:** range model, fill handle, clipboard interactions. Catalog areas 12 (extension) + 19.
- **F6 — SSRM track:** push-style data source contract, block cache, async row loading, group state with server-side blocks. Catalog area 15.
- **F7 — Master/detail + tree data:** full-width detail rows, hierarchical path-based data shape. Catalog areas 13 + 14.
- **F8 — Charts + sparklines:** canvas-native sparkline cell painter, integrated chart via canvas overlay or DOM dialog. Catalog area 24.

Each is bounded and concrete. Each consumes the Foundation interfaces without modifying them. The catalog will track which areas have been ported as each cycle completes.
