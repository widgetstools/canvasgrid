# Canvasgrid Cycle 5 — Editing + Variable Row Heights — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to execute this worklog task-by-task.
> Each task below is designed to fit in a single, isolated Claude Code session.
> Run one task per session, verify, commit, then START A NEW SESSION using the
> "Next session prompt" at the end of the task. Do NOT chain multiple tasks in
> one session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship production-grade cell editing (ag-grid–parity surface: `ICellEditor`
interface, registry-driven built-in + custom editors, popup mode, click/keyboard
triggers, edit-navigation, full-row edit) AND variable row heights
(`getRowHeight`, per-row heights, `autoHeight` + `wrapText`) — the latter
unblocks Cycle 13 (totals row), Cycle 14 (group rows), Cycle 15 (master/detail).
Also closes Cycle 4's `addEventListener` carry-over.

**Architecture:** Editing layer mirrors Cycle 4's renderer registry — a
`CellEditorRegistry` maps string keys (`'text'`, `'number'`, `'date'`, …) and
custom names to objects implementing a small `ICellEditor` interface
(`init`/`getGui`/`getValue`/`destroy` + optional lifecycle hooks). The existing
single-input `EditorOverlay` becomes a thin host that asks the registry for an
editor, mounts its `getGui()` element, and routes commit through Cycle 4's
`valueParser → valueSetter → applyTransaction({ update })` pipeline. Popup
editors mount in a portal anchored to the cell. Variable heights are canonical
on the worker — heights ship as a `Float32Array` per viewport chunk. Main
thread keeps a Fenwick tree over the current visible-row order for O(log n)
`scrollTop ↔ rowIndex` math. `autoHeight` measurement runs in the worker via
`OffscreenCanvas.measureText` when available (Chrome ≥100, Firefox ≥105,
Safari ≥16.4); a main-thread fallback covers Safari 15.4–16.3.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E), single-canvas
2D paint, Web Worker data pipeline, native scrollbars, CSS-variable theming.
No new runtime dependencies. Popup uses native DOM (`document.createElement`) —
no React/Vue, no portal libraries.

**References (READ FIRST when starting any task):**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan (Cycle 5 section at line 180)
- `docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md` — Cycle 4 worklog (shape + the renderer-registry pattern Task 1 mirrors)
- `docs/catalog/06-cell-editing.md` — editing surface (the source of truth for Tasks 1–5, 10)
- `docs/catalog/02-column-model.md` — `autoHeight`, `wrapText`, `suppressKeyboardEvent`, `editable`, `cellEditor*`, `valueSetter`, `valueParser`
- `docs/catalog/03-rows-and-row-models.md` — `getRowHeight` callback, per-row `rowHeight`
- `docs/catalog/22-events.md` — `cellEditingStarted` / `cellEditingStopped` / `rowEditingStarted` / `rowEditingStopped` / `rowValueChanged`
- `docs/catalog/23-api.md` — `startEditingCell`, `stopEditing`, `getEditingCells`, `getCellEditorInstances`, `on`/`off`/`addEventListener`
- `docs/catalog/FEATURE_MATRIX.md` — rows to flip to ✅ at cycle exit
- Cgrid source: `cgrid/src/` (esp. `interaction/editorOverlay.ts`, `core/viewport.ts`, `interaction/hitTester.ts`, `worker/protocol.ts`, `worker/chunkFormat.ts`, `worker/index.ts`, `worker/rowStore.ts`, `core/eventEmitter.ts`)
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task**. Extends the constraints from Cycles 2/3/4. New ones
marked **NEW** for this cycle.

### Carried from Cycle 2/3/4
- **API parity, not API mimicry.** Field names mirror ag-grid verbatim
  (`cellEditor`, `cellEditorParams`, `cellEditorSelector`, `cellEditorPopup`,
  `cellEditorPopupPosition`, `editable`, `singleClickEdit`, `suppressClickEdit`,
  `stopEditingWhenCellsLoseFocus`, `enterNavigatesVertically`,
  `enterNavigatesVerticallyAfterEdit`, `editType`, `getRowHeight`, `rowHeight`,
  `autoHeight`, `wrapText`, `suppressKeyboardEvent`). Top-level type names keep
  the `C` prefix (`CGridApi`, `CGridOptions`, `CColDef`). String editor
  identifiers drop the `ag` prefix (`'text'`, not `'agTextCellEditor'`) —
  matches Cycle 4's renderer registry convention.
- **No regressions in the public API.** All additions are purely additive in
  Cycle 5. `CGridApi.openEditor(rowIndex, colId)` remains as a thin shim for
  Cycle 4 callers until Cycle 6's `startEditingCell(params)` formalises it.
- **TypeScript strict mode.** Every `cgrid/src/**/*.ts` compiles clean under
  `npm run --workspace=cgrid typecheck` at the end of every task.
- **`alpha: false` canvas context, single-canvas rendering, DPR-aware paint,
  no per-cell `strokeRect`** — unchanged.
- **Web Worker stays the data layer.** Heights are computed on (or shipped
  through) the worker; main thread never reaches into `rowStore` directly.
  Editor commit dispatches via `applyTransaction` — never mutates row data
  on main.
- **Native browser scrollbars** — unchanged.
- **Vitest unit + Playwright E2E green at end of every task.** Edit-mode
  interactions get coverage in `apps/cgrid-positions/tests/editing.spec.ts`
  (new file in Task 1). E2E required for UI features — unit tests alone do
  not gate task completion (per project memory `feedback_e2e_for_ui.md`).
- **Conventional commits.** Each task = one or more focused commits, body
  footer `Cycle 5 / Task N.`
- **Documentation as you go.** Each public API or type added gets (a) a TSDoc
  block on the symbol, (b) the matching FM row flipped to ✅ in
  `docs/catalog/FEATURE_MATRIX.md`, and (c) a one-line entry in this worklog's
  "Shipped" list at cycle exit.
- **Demo never breaks.** `apps/cgrid-positions` runs after every task. The
  editable-column + variable-height demo additions arrive incrementally
  (Task 1 lights up editable text edit; Task 2 adds the number/select demos;
  Task 6 introduces a variable-height row; Task 8 shows autoHeight).

### NEW for this cycle
- **`ICellEditor` interface — match ag-grid's shape verbatim** within the
  subset Cycle 5 ships: `init(params)`, `getGui(): HTMLElement`, `getValue()`,
  `destroy()` are required. `isPopup()`, `getPopupPosition()`,
  `afterGuiAttached()`, `isCancelBeforeStart()`, `isCancelAfterEnd()`,
  `focusIn()`, `focusOut()` are optional. Deferred to a later cycle:
  `refresh(params)`, `getValidationElement(tooltip)`, `getValidationErrors()`
  (validation feedback). Reason for verbatim parity: app code that knows
  ag-grid's interface can register a custom editor against cgrid with zero
  rename.
- **`editType: 'fullRow' | undefined` matches ag-grid.** The master plan's
  task-3 line listed `'singleClick' | 'doubleClick' | 'fullRow'` — ag-grid's
  actual surface uses `editType: 'fullRow' | undefined` plus a separate
  `singleClickEdit: boolean` (grid + per-column). We follow ag-grid here.
  `'singleClick' / 'doubleClick'` strings do not exist in either grid.
- **Row-height cache is dual-resident.** Canonical on the worker
  (`rowStore.heightsByRowId: Map<rowId, number>`), shipped per
  `ViewportChunk` as `heights: Float32Array` (one entry per visible row in
  the chunk). Main thread holds a Fenwick tree (`core/rowHeightIndex.ts`)
  keyed by visible-row-index for O(log n) `scrollTop → rowIndex` and
  `rowIndex → top` queries. Worker is the writer; main thread is a
  derived-read consumer.
- **Per-row-height consistency under transactions.** Heights live with row
  identity (`rowId`), not row position. Sort / filter changes the visible
  order but does not invalidate per-row heights. Transactions (add / update /
  remove) update the worker's `heightsByRowId` map AND queue a Fenwick
  rebuild for the affected range on the main thread.
- **`autoHeight` measurement gate.** Worker-side `OffscreenCanvas.measureText`
  is the hot path. Feature-detect at worker init; if unavailable (Safari
  15.4–16.3), the worker emits a `measureText` request over the protocol;
  the main thread measures with `HTMLCanvasElement.measureText` and posts
  back. Measurements are cached by `(text, width, fontKey)` tuple on the
  worker. The cache is bounded (last 1024 entries, LRU) so streaming
  updates do not unbounded-grow it.
- **Performance gates (carry-forward from master plan's Performance Budget
  + Cycle 5 specific).**
  - Row-top lookup at any `scrollTop` is O(log n) — verified via
    `core/rowHeightIndex.bench.ts` (added in Task 7).
  - Edit-mode entry (`open` → editor mounted + focused) < 16 ms p95 on the
    1M-row demo with autoHeight active.
  - Variable-height grid (100k rows, 25% of rows at 2× height, autoHeight
    on one wrapText column) scrolls at ≥ 120 fps median, ≥ 110 fps p95
    on the same baseline laptop Cycle 4 used.
  - `autoHeight` measure for a column of 100k rows × 60-char text averages
    < 200 ms total worker time on the hot (OffscreenCanvas) path, < 1 s on
    the main-thread fallback.
- **Allocation discipline in hot paths.** Per-row height read is a single
  Fenwick lookup (no allocation). Per-cell paint with `wrapText` reuses a
  single `lineBuffer: string[]` cached on the painter — no fresh splits
  per cell.

---

## Performance Budget (Cycle 5 row in the master Budget table)

| Metric | Target | Why |
|---|---|---|
| Edit-mode entry (open → focused) | < 16 ms p95 | One frame budget; users expect instant editor focus on click/F2 |
| `scrollTop → rowIndex` (1M rows, variable) | < 50 µs p95 | Single Fenwick descent at log₂(1M) ≈ 20 nodes |
| Variable-height scroll (100k mixed) | ≥ 120 fps median | Master Budget scroll target preserved under variable heights |
| `autoHeight` measure (100k × 60-char) | < 200 ms (worker), < 1 s (fallback) | Background pass; must not block first paint past Cycle 4's 200 ms cold-start target |
| Memory overhead for heights cache | < 8 bytes/row | One Float32 per row in the Fenwick + one in the chunk |

---

## Task overview

| # | Task | Primary user-visible win | Files touched |
|---|---|---|---|
| 1 | `ICellEditor` + registry + `'text'` editor + `CGridApi.on/off/addEventListener` | Public editor registry; `cellEditingStarted/Stopped` events; addEventListener carry-over closed | `types.ts`, `interaction/editors/iCellEditor.ts` (new), `interaction/editors/registry.ts` (new), `interaction/editors/builtins/text.ts` (new), `interaction/editorOverlay.ts`, `cgrid.ts`, `core/eventEmitter.ts`, tests |
| 2 | Built-in editors: `'number'`, `'date'`, `'dateString'`, `'select'`, `'largeText'`, `'checkbox'` | All ag-grid Community built-ins available | `interaction/editors/builtins/{number,date,dateString,select,largeText,checkbox}.ts` (new), `cgrid.ts`, demo |
| 3 | Popup editors (`isPopup()` + `cellEditorPopup`) | Editor can float over the cell; collision-aware positioning | `interaction/editors/popupHost.ts` (new), `interaction/editorOverlay.ts`, demo |
| 4 | Edit triggers (`singleClickEdit`, `suppressClickEdit`, F2/Esc/Enter, `enterNavigatesVertically*`, `stopEditingWhenCellsLoseFocus`, `suppressKeyboardEvent`) | Click + keyboard parity with ag-grid | `interaction/features/editTrigger.ts` (new), `interaction/features/keyPaging.ts`, `core/propertyChain.ts`, `cgrid.ts`, `types.ts` |
| 5 | Type-to-edit (printable char while focused starts edit with char as initial value) | Spreadsheet-style typing | `interaction/features/keyPaging.ts`, `interaction/features/editTrigger.ts`, `interaction/editorOverlay.ts` |
| 6 | Variable row heights — `getRowHeight` + per-row `rowHeight` + heights TypedArray in chunks | App can return per-row heights; viewport uses them | `worker/protocol.ts`, `worker/index.ts`, `worker/rowStore.ts`, `worker/chunkFormat.ts`, `core/viewport.ts`, `cgrid.ts`, `types.ts` |
| 7 | Fenwick tree (`core/rowHeightIndex.ts`) for cumulative row-top lookup | O(log n) `scrollTop ↔ rowIndex`; replaces uniform-height assumption in viewport + hit-test | `core/rowHeightIndex.ts` (new), `core/viewport.ts`, `interaction/hitTester.ts`, `cgrid.ts` |
| 8 | `autoHeight` per column — worker `OffscreenCanvas.measureText` + main-thread fallback | Cells size their row to fit wrapped content | `worker/measureText.ts` (new), `worker/index.ts`, `worker/protocol.ts`, `worker/rowStore.ts`, `cgrid.ts`, demo |
| 9 | `wrapText` per column — multi-line text paint with cached `lineBuffer` | Long text wraps inside the cell | `renderer/cellRenderers/registry.ts`, `renderer/cellRenderers/wrapText.ts` (new), demo |
| 10 | Full-row edit (`editType: 'fullRow'`) — all editable cells open together; Tab navigates; Esc cancels row | `rowEditingStarted/Stopped/rowValueChanged` events; full-row UX | `interaction/editorOverlay.ts`, `interaction/features/editTrigger.ts`, `interaction/editors/rowEditCoordinator.ts` (new), `cgrid.ts`, `types.ts` |

---

## Task 1 — `ICellEditor` interface + registry + `'text'` editor + public `on/off/addEventListener`

**Goal:** Land the editor-registry foundation. Define `ICellEditor` (a 4-required
+ 7-optional method interface mirroring ag-grid's `ICellEditor`). Create
`CellEditorRegistry` keyed by string (mirrors Cycle 4's `CellRendererRegistry`).
Ship the first built-in `'text'` editor; rewrite `EditorOverlay` to ask the
registry for an editor instead of hard-coding an `<input>`. Fire the three
edit-lifecycle events that catalog 22 names: `cellEditingStarted`,
`cellEditingStopped`, `cellValueChanged` (last one already partial — refine
the payload to match catalog 06 shape). Expose Cycle 4's carry-over
`CGridApi.on / off / addEventListener` so apps can subscribe.

**Why this is Task 1:** Every other editing task (2 — built-ins, 3 — popup,
4 — triggers, 10 — fullRow) consumes the registry + the `ICellEditor`
contract. Land the interface and the registry before anyone tries to register
an editor against it. Replacing the existing single-input `EditorOverlay`
on day one means no Task ever has to maintain two parallel paths.
`addEventListener` ships here because Task 1 already exposes 3 new events;
exposing the emitter surface in the same commit is symmetrical.

**Read first:**
- `docs/catalog/06-cell-editing.md` — full `ICellEditor` table (lines 70–84),
  events (lines 102–116)
- `docs/catalog/23-api.md` — `addEventListener` / `removeEventListener` / `on` / `off`
- `cgrid/src/renderer/cellRenderers/registry.ts` — the renderer-registry
  pattern this task mirrors (Cycle 4 Task 8)
- `cgrid/src/interaction/editorOverlay.ts` — the current implementation we replace
- `cgrid/src/core/eventEmitter.ts` — internal `TypedEventEmitter.on/off` we expose

**Files:**
- Create: `cgrid/src/interaction/editors/iCellEditor.ts` (interface + params type)
- Create: `cgrid/src/interaction/editors/registry.ts` (`CellEditorRegistry`)
- Create: `cgrid/src/interaction/editors/builtins/text.ts` (`'text'` editor)
- Modify: `cgrid/src/interaction/editorOverlay.ts` (registry-driven host)
- Modify: `cgrid/src/cgrid.ts` (instantiate registry; add `registerCellEditor`;
  expose `on`/`off`/`addEventListener`/`removeEventListener`; refine
  `openEditor` to use the registry; fire `cellEditingStarted` /
  `cellEditingStopped` / refined `cellValueChanged`)
- Modify: `cgrid/src/types.ts` (`ICellEditor`, `ICellEditorParams`,
  `CellEditingStartedEvent`, `CellEditingStoppedEvent`, refined
  `CellValueChangedEvent`, `CGridApi.on/off/addEventListener` signatures,
  `CColDef.cellEditor: string | (new () => ICellEditor) | undefined`,
  `CColDef.cellEditorParams`)
- Create: `cgrid/tests/cellEditorRegistry.test.ts`
- Create: `cgrid/tests/editorOverlay.registry.test.ts`
- Create: `apps/cgrid-positions/tests/editing.spec.ts` (first E2E in this file)
- Update: demo `apps/cgrid-positions/src/positionsGrid.ts` (mark one column
  `editable: true` so the E2E has a target)

**Interfaces produced (later tasks consume):**

```ts
// cgrid/src/interaction/editors/iCellEditor.ts
export interface ICellEditorParams<TRow = any, TValue = any> {
  /** Read-only snapshot of the row at edit-start time. */
  data: TRow;
  /** Resolved colId of the cell being edited. */
  colId: string;
  /** Pre-edit value (from valueGetter or data[field]). */
  value: TValue | null | undefined;
  /** Raw key that started the edit (printable char from type-to-edit, or
   *  null when started via mouse/F2/api). */
  charPress: string | null;
  /** Resolved CellEditorParams from CColDef.cellEditorParams. */
  params: Record<string, unknown>;
  /** Cell pixel bounds at edit-start time. Popup editors may ignore. */
  cellBounds: { x: number; y: number; w: number; h: number };
  /** Invoked by the editor (e.g. on Enter) to request commit. The host
   *  honors `isCancelAfterEnd()` then calls `getValue()`. */
  stopEditing: (cancel?: boolean) => void;
}

export interface ICellEditor<TRow = any, TValue = any> {
  /** Called once before getGui(). Stash params; do NOT mount DOM yet. */
  init(params: ICellEditorParams<TRow, TValue>): void;
  /** Returns the DOM element to mount as the editor body. Called once. */
  getGui(): HTMLElement;
  /** Returns the current value. Called by the host on commit. */
  getValue(): TValue | null | undefined;
  /** Called by the host on close (commit or cancel). Release DOM listeners. */
  destroy(): void;

  /** Optional hooks — see `docs/catalog/06-cell-editing.md` for semantics. */
  isPopup?(): boolean;
  getPopupPosition?(): 'over' | 'under';
  afterGuiAttached?(): void;
  isCancelBeforeStart?(): boolean;
  isCancelAfterEnd?(): boolean;
  focusIn?(): void;
  focusOut?(): void;
}

export type CellEditorCtor<TRow = any, TValue = any> = new () => ICellEditor<TRow, TValue>;

// cgrid/src/interaction/editors/registry.ts
export class CellEditorRegistry {
  register(name: string, ctor: CellEditorCtor): void;
  resolve(name: string): CellEditorCtor;            // throws if missing
  has(name: string): boolean;
  /** Built-in seed — called by CGrid constructor. */
  static seed(reg: CellEditorRegistry): void;
}

// cgrid/src/types.ts additions
export interface CellEditingStartedEvent<TRow = any> {
  type: 'cellEditingStarted';
  rowIndex: number;
  rowId: string;
  colId: string;
  value: unknown;
  data: TRow;
}
export interface CellEditingStoppedEvent<TRow = any> {
  type: 'cellEditingStopped';
  rowIndex: number;
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
  /** True when newValue !== oldValue AND commit was not cancelled. */
  valueChanged: boolean;
  data: TRow;
}
export interface CellValueChangedEvent<TRow = any> {
  type: 'cellValueChanged';
  rowIndex: number;
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
  /** The raw string returned by the editor before valueParser. */
  newRawValue: unknown;
  /** 'edit' for manual edits; reserved for 'paste' / 'fill' / 'api' later. */
  source: 'edit';
  data: TRow;
}

export interface CGridApi<TRow = any> {
  // … existing methods …
  registerCellEditor(name: string, ctor: CellEditorCtor<TRow>): void;
  /** Subscribe to a typed event. Returns unsubscribe. */
  on<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): () => void;
  off<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): void;
  /** Alias for on(), present for ag-grid API parity. */
  addEventListener<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): () => void;
  /** Alias for off(), present for ag-grid API parity. */
  removeEventListener<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): void;
}

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  /** Built-in key ('text', 'number', 'date', 'dateString', 'select',
   *  'largeText', 'checkbox') or a custom constructor registered via
   *  `registerCellEditor`. When omitted, defaults to 'text' for editable
   *  columns. */
  cellEditor?: string | CellEditorCtor<TRow, TValue>;
  /** Forwarded into `ICellEditorParams.params`. Per-editor schemas live in
   *  `docs/catalog/06-cell-editing.md` "Built-in editor types and their
   *  params" section. */
  cellEditorParams?: Record<string, unknown> | ((row: TRow) => Record<string, unknown>);
}
```

**Steps:**

- [ ] **Step 1: Write the failing tests for the registry**

`cgrid/tests/cellEditorRegistry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CellEditorRegistry } from '../src/interaction/editors/registry';
import type { ICellEditor, ICellEditorParams } from '../src/interaction/editors/iCellEditor';

class StubEditor implements ICellEditor {
  private val: unknown = null;
  init(p: ICellEditorParams) { this.val = p.value; }
  getGui() { return document.createElement('input'); }
  getValue() { return this.val; }
  destroy() {}
}

describe('CellEditorRegistry', () => {
  it('seeds the built-in "text" editor', () => {
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    expect(reg.has('text')).toBe(true);
  });

  it('register + resolve round-trips a custom editor', () => {
    const reg = new CellEditorRegistry();
    reg.register('my-custom', StubEditor);
    const Ctor = reg.resolve('my-custom');
    const inst = new Ctor();
    inst.init({ data: {}, colId: 'a', value: 7, charPress: null,
                params: {}, cellBounds: { x: 0, y: 0, w: 0, h: 0 },
                stopEditing: () => {} });
    expect(inst.getValue()).toBe(7);
  });

  it('throws on resolve of unknown name with a descriptive message', () => {
    const reg = new CellEditorRegistry();
    expect(() => reg.resolve('nope')).toThrow(/cellEditor.*'nope'.*not registered/i);
  });

  it('overwrites an existing name on re-register (last wins)', () => {
    const reg = new CellEditorRegistry();
    class A extends StubEditor {}
    class B extends StubEditor {}
    reg.register('x', A);
    reg.register('x', B);
    expect(reg.resolve('x')).toBe(B);
  });
});
```

- [ ] **Step 2: Run the test file to confirm it fails**

```bash
npm test --workspace=cgrid -- cellEditorRegistry
```

Expected: every test fails with `Cannot find module`.

- [ ] **Step 3: Implement `iCellEditor.ts` + `registry.ts` + `builtins/text.ts`**

`cgrid/src/interaction/editors/iCellEditor.ts` — the interface block from
"Interfaces produced" above. No implementation, just types.

`cgrid/src/interaction/editors/builtins/text.ts`:

```ts
import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

export class TextCellEditor implements ICellEditor<unknown, string> {
  private input!: HTMLInputElement;
  private params!: ICellEditorParams<unknown, string>;

  init(params: ICellEditorParams<unknown, string>): void {
    this.params = params;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cg-cell-editor cg-cell-editor--text';
    // Type-to-edit: charPress replaces the initial value entirely.
    input.value = params.charPress ?? (params.value == null ? '' : String(params.value));
    input.style.cssText = `
      box-sizing: border-box; width: 100%; height: 100%;
      border: 0; padding: 0 8px; margin: 0; background: var(--cg-cell-editor-bg, #fff);
      color: var(--cg-text-color, #111); font: inherit; outline: 2px solid var(--cg-focus-ring-color, #4a90e2);
    `;
    this.input = input;
  }

  getGui(): HTMLElement { return this.input; }
  getValue(): string { return this.input.value; }
  destroy(): void { /* input is removed by the host */ }

  afterGuiAttached(): void {
    this.input.focus();
    if (this.params.charPress == null) this.input.select();
    else this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }
}
```

`cgrid/src/interaction/editors/registry.ts`:

```ts
import type { CellEditorCtor } from './iCellEditor';
import { TextCellEditor } from './builtins/text';

export class CellEditorRegistry {
  private map = new Map<string, CellEditorCtor>();

  register(name: string, ctor: CellEditorCtor): void {
    this.map.set(name, ctor);
  }

  resolve(name: string): CellEditorCtor {
    const ctor = this.map.get(name);
    if (!ctor) {
      throw new Error(`[cgrid] cellEditor '${name}' is not registered`);
    }
    return ctor;
  }

  has(name: string): boolean { return this.map.has(name); }

  static seed(reg: CellEditorRegistry): void {
    reg.register('text', TextCellEditor);
    // Tasks 2 + 10 register the remaining built-ins.
  }
}
```

- [ ] **Step 4: Verify Step-1 tests pass**

```bash
npm test --workspace=cgrid -- cellEditorRegistry
```

Expected: 4/4 green.

- [ ] **Step 5: Write the failing overlay test**

`cgrid/tests/editorOverlay.registry.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EditorOverlay } from '../src/interaction/editorOverlay';
import { CellEditorRegistry } from '../src/interaction/editors/registry';

describe('EditorOverlay (registry-driven)', () => {
  it('asks the registry for the editor by name + mounts getGui()', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    const onCommit = vi.fn();
    overlay.open({
      editorName: 'text',
      rowData: { name: 'init' }, colId: 'name',
      value: 'init', cellBounds: { x: 10, y: 20, w: 120, h: 22 },
      params: {}, charPress: null,
      onCommit, onCancel: vi.fn(),
    });
    expect(host.querySelector('input.cg-cell-editor--text')).not.toBeNull();
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'new';
    overlay.commit();
    expect(onCommit).toHaveBeenCalledWith('new');
    overlay.close();
    expect(host.querySelector('input.cg-cell-editor--text')).toBeNull();
  });

  it('opens with charPress as the initial value (type-to-edit)', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    overlay.open({
      editorName: 'text',
      rowData: { v: 'old' }, colId: 'v',
      value: 'old', cellBounds: { x: 0, y: 0, w: 100, h: 22 },
      params: {}, charPress: 'X',
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('X');
  });

  it('cancel() does not invoke onCommit', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    overlay.open({
      editorName: 'text', rowData: {}, colId: 'a', value: 'x',
      cellBounds: { x: 0, y: 0, w: 50, h: 20 }, params: {}, charPress: null,
      onCommit, onCancel,
    });
    overlay.cancel();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
```

Run: `npm test --workspace=cgrid -- editorOverlay.registry` — expect failure
(EditorOverlay does not take a registry yet).

- [ ] **Step 6: Rewrite `EditorOverlay` to consume the registry**

Replace the contents of `cgrid/src/interaction/editorOverlay.ts` so the
overlay accepts a `CellEditorRegistry` in its constructor and an
`EditorAttachOpts` that now includes `editorName: string`, `params: Record<string, unknown>`,
`charPress: string | null`, plus the existing `onCommit / onCancel`. The
overlay's `open()` becomes:

```ts
import type { CellEditorRegistry } from './editors/registry';
import type { ICellEditor, ICellEditorParams } from './editors/iCellEditor';

export interface EditorAttachOpts<TRow = any, TValue = any> {
  editorName: string;
  rowData: TRow;
  colId: string;
  value: TValue;
  cellBounds: { x: number; y: number; w: number; h: number };
  params: Record<string, unknown>;
  charPress: string | null;
  onCommit: (newValue: TValue) => void;
  onCancel: () => void;
}

export class EditorOverlay {
  private current: { editor: ICellEditor; opts: EditorAttachOpts } | null = null;

  constructor(private host: HTMLElement, private registry: CellEditorRegistry) {}

  isOpen(): boolean { return this.current !== null; }

  open(opts: EditorAttachOpts): void {
    if (this.current) this.close();
    const Ctor = this.registry.resolve(opts.editorName);
    const editor = new Ctor();
    const params: ICellEditorParams = {
      data: opts.rowData, colId: opts.colId, value: opts.value,
      charPress: opts.charPress, params: opts.params,
      cellBounds: opts.cellBounds,
      stopEditing: (cancel?: boolean) => cancel ? this.cancel() : this.commit(),
    };
    editor.init(params);
    if (editor.isCancelBeforeStart?.()) { editor.destroy(); return; }
    const gui = editor.getGui();
    gui.style.position = 'absolute';
    gui.style.left = `${opts.cellBounds.x}px`;
    gui.style.top = `${opts.cellBounds.y}px`;
    gui.style.width = `${opts.cellBounds.w}px`;
    gui.style.height = `${opts.cellBounds.h}px`;
    this.host.appendChild(gui);
    this.current = { editor, opts };
    editor.afterGuiAttached?.();
  }

  /** Read getValue from the editor and dispatch onCommit. Host is responsible
   *  for routing through valueParser/valueSetter (cgrid.ts does that). */
  commit(): void {
    if (!this.current) return;
    const { editor, opts } = this.current;
    if (editor.isCancelAfterEnd?.()) { this.cancel(); return; }
    const newValue = editor.getValue();
    opts.onCommit(newValue);
    this.close();
  }

  cancel(): void {
    if (!this.current) return;
    this.current.opts.onCancel();
    this.close();
  }

  close(): void {
    if (!this.current) return;
    const { editor } = this.current;
    editor.getGui().remove();
    editor.destroy();
    this.current = null;
  }
}
```

- [ ] **Step 7: Wire the registry + new events into `cgrid.ts`**

In the constructor, after the renderer-registry seed block:

```ts
this.cellEditorRegistry = new CellEditorRegistry();
CellEditorRegistry.seed(this.cellEditorRegistry);
this.editorOverlay = new EditorOverlay(this.editorLayer, this.cellEditorRegistry);
```

Add `registerCellEditor` to the API surface:

```ts
public registerCellEditor(name: string, ctor: CellEditorCtor): void {
  this.cellEditorRegistry.register(name, ctor);
}
```

Refactor the existing `openEditor(rowIndex, colId)` private method so it
resolves the editor by name from the col def. If `colDef.cellEditor` is a
string, look up by name; if it's a constructor, register it ad-hoc under a
synthetic name (`__inline_${colId}`) and resolve. Default to `'text'` when
omitted on an editable column. Compute `params` from
`colDef.cellEditorParams` (call it if function-typed). Emit
`cellEditingStarted` after the editor mounts. On commit, emit refined
`cellValueChanged` with `oldValue`, `newValue`, `newRawValue`, `source: 'edit'`,
then `cellEditingStopped` with `valueChanged: true`. On cancel, emit only
`cellEditingStopped` with `valueChanged: false`.

Expose the public emitter surface (the Cycle 4 carry-over):

```ts
public on<K extends CGridEvent['type']>(type: K, handler: (e: Extract<CGridEvent, { type: K }>) => void): () => void {
  return this.events.on(type, handler);
}
public off<K extends CGridEvent['type']>(type: K, handler: (e: Extract<CGridEvent, { type: K }>) => void): void {
  this.events.off(type, handler);
}
public addEventListener = this.on.bind(this);
public removeEventListener = this.off.bind(this);
```

(Or assign these in the constructor — use whichever style the existing
class members favor. `on` returns the unsubscribe per cgrid's internal
emitter; `off` is the explicit dual. `addEventListener` / `removeEventListener`
are aliases for ag-grid parity.)

- [ ] **Step 8: Add `cellEditor` + `cellEditorParams` to `CColDef` in types.ts**

```ts
cellEditor?: string | CellEditorCtor<TRow, TValue>;
cellEditorParams?: Record<string, unknown> | ((row: TRow) => Record<string, unknown>);
```

Add the three event payload shapes from the "Interfaces produced" block to
the `CGridEvent` union. Refine the existing `CellValueChangedEvent` (if any)
to match the new shape; if Cycle 4 emitted a thinner payload, the change
is purely additive — old listeners still work because the type is a
superset.

- [ ] **Step 9: Add `CGridApi.on/off/addEventListener/removeEventListener` to types.ts**

From the "Interfaces produced" block, paste the four method signatures into
the `CGridApi` interface.

- [ ] **Step 10: Update the demo to make one column editable**

In `apps/cgrid-positions/src/positionsGrid.ts`, on the `trader` column,
add `editable: true`. (Other columns can come later; one is enough for the E2E.)

- [ ] **Step 11: Write the E2E for editing**

`apps/cgrid-positions/tests/editing.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Cell editing — text editor', () => {
  test('double-click trader cell opens text editor, type + Enter commits', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__cgridReady === true);
    // Locate the first trader cell (relies on the canvas screenshot path; we
    // use page.evaluate to read the cell bounds from the cgrid api).
    const bounds = await page.evaluate(() => {
      const grid = (window as any).__cgrid;
      const r = grid.getCellBoundsAt(0, 'trader');
      return r;
    });
    await page.mouse.dblclick(bounds.x + 10, bounds.y + 5);
    const input = page.locator('input.cg-cell-editor--text');
    await expect(input).toBeVisible();
    await input.fill('CHANGED');
    await input.press('Enter');
    // Editor should close; the painted text should now read CHANGED.
    await expect(input).toHaveCount(0);
    const newValue = await page.evaluate(() => (window as any).__cgrid.getCellValue(0, 'trader'));
    expect(newValue).toBe('CHANGED');
  });

  test('Escape cancels without writing', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__cgridReady === true);
    const original = await page.evaluate(() => (window as any).__cgrid.getCellValue(0, 'trader'));
    const bounds = await page.evaluate(() => (window as any).__cgrid.getCellBoundsAt(0, 'trader'));
    await page.mouse.dblclick(bounds.x + 10, bounds.y + 5);
    const input = page.locator('input.cg-cell-editor--text');
    await input.fill('TYPED');
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    const after = await page.evaluate(() => (window as any).__cgrid.getCellValue(0, 'trader'));
    expect(after).toBe(original);
  });
});
```

Add `getCellBoundsAt(rowIndex, colId)` + `getCellValue(rowIndex, colId)` to
`CGridApi` if not already present. (Both are 5-line read-only helpers
using the existing column layout + worker `getCellValue` path. If they
exist, fix the test signature to call them.)

- [ ] **Step 12: Run the full unit + typecheck + build suite**

```bash
npm test --workspace=cgrid
npm --workspace=cgrid run typecheck
npm --workspace=cgrid run build
```

- [ ] **Step 13: Run E2E**

```bash
cd apps/cgrid-positions && npx playwright test --reporter=list
```

All existing E2E pass; the two new editing tests pass.

- [ ] **Step 14: Commit**

```bash
git add cgrid/src/types.ts \
        cgrid/src/interaction/editors/iCellEditor.ts \
        cgrid/src/interaction/editors/registry.ts \
        cgrid/src/interaction/editors/builtins/text.ts \
        cgrid/src/interaction/editorOverlay.ts \
        cgrid/src/cgrid.ts \
        cgrid/tests/cellEditorRegistry.test.ts \
        cgrid/tests/editorOverlay.registry.test.ts \
        apps/cgrid-positions/src/positionsGrid.ts \
        apps/cgrid-positions/tests/editing.spec.ts
git commit -m "$(cat <<'EOF'
feat(cgrid): ICellEditor registry + 'text' editor + on/addEventListener

Lands the editor registry mirroring Cycle 4's CellRendererRegistry. The
EditorOverlay is now a thin host that resolves the editor by name from
CColDef.cellEditor (string key or constructor), forwards
cellEditorParams, and runs the init → getGui → afterGuiAttached
lifecycle. Wires cellEditingStarted + cellEditingStopped events and
refines cellValueChanged to the catalog-06 payload shape. Closes the
Cycle 4 carry-over by exposing CGridApi.on / off / addEventListener /
removeEventListener over the existing TypedEventEmitter.

Cycle 5 / Task 1.
EOF
)"
```

**Acceptance criteria:**
- [ ] `cgrid/src/interaction/editors/{iCellEditor.ts,registry.ts,builtins/text.ts}` exist.
- [ ] `CellEditorRegistry.seed` registers `'text'`; no other built-ins yet.
- [ ] `EditorOverlay` constructor takes `(host, registry)`; `open()` accepts
      `editorName` + `params` + `charPress`.
- [ ] `CGridApi.registerCellEditor / on / off / addEventListener /
      removeEventListener` typed + implemented; `addEventListener` is an
      alias for `on`.
- [ ] `cellEditingStarted` fires after editor mounts.
- [ ] `cellEditingStopped` fires unconditionally on close; payload's
      `valueChanged` matches catalog 06.
- [ ] `cellValueChanged` payload extended to `{oldValue, newValue, newRawValue,
      source: 'edit', rowIndex, rowId, colId, data}`.
- [ ] Demo `trader` column editable via double-click → text editor.
- [ ] Unit (≥ 7 assertions across 2 files) + E2E (2 new tests) + typecheck +
      build green.

**Next session prompt** (paste into a fresh Claude Code session after Task 1 is committed):

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 2 (built-in editors: 'number', 'date', 'dateString', 'select',
'largeText', 'checkbox'). Confirm Task 1 is committed (git log -1 should show
"ICellEditor registry"). Read docs/catalog/06-cell-editing.md "Built-in editor
types and their params" (lines 120-129) before touching code. Follow the
per-task workflow.
```

---

## Task 2 — Built-in editors: `'number'`, `'date'`, `'dateString'`, `'select'`, `'largeText'`, `'checkbox'`

**Goal:** Ship the remaining 6 ag-grid Community built-in editors against
Task 1's `ICellEditor` interface. Each lives in `interaction/editors/builtins/`;
each gets a small unit test asserting its DOM widget + `getValue()`
round-trip + (where applicable) param handling. `CellEditorRegistry.seed`
registers all 7 at construction time. (Enterprise `'agRichSelectCellEditor'`
is deliberately deferred — virtualised dropdowns + async paged data sources
are a Cycle 11 sidebar/panel-style concern.)

**Why this is Task 2:** Task 1's registry is decoration without editors to
register. These 6 close the catalog-06 surface for non-enterprise editors and
unblock Task 3 (popup) — `'largeText'` defaults to `isPopup() === true`.

**Read first:**
- `docs/catalog/06-cell-editing.md` — "Built-in editor types and their params"
  section (lines 120–129) and `ICellEditor` table (lines 70–84)
- `cgrid/src/interaction/editors/builtins/text.ts` — Task 1's reference shape
- `cgrid/src/interaction/editors/iCellEditor.ts` — the contract

**Files:**
- Create: `cgrid/src/interaction/editors/builtins/number.ts`
- Create: `cgrid/src/interaction/editors/builtins/date.ts`
- Create: `cgrid/src/interaction/editors/builtins/dateString.ts`
- Create: `cgrid/src/interaction/editors/builtins/select.ts`
- Create: `cgrid/src/interaction/editors/builtins/largeText.ts`
- Create: `cgrid/src/interaction/editors/builtins/checkbox.ts`
- Modify: `cgrid/src/interaction/editors/registry.ts` (extend `seed` to
  register all 6 new built-ins)
- Modify: `apps/cgrid-positions/src/positionsGrid.ts` (mark `notionalAmount`
  as `editable` with `cellEditor: 'number'` + `cellEditorParams: { min: 0, precision: 2 }`;
  mark `ticker` as `editable` with `cellEditor: 'select'` + values list)
- Create: `cgrid/tests/builtinEditors.test.ts` (one describe block per editor)
- Create: `apps/cgrid-positions/tests/editing.builtins.spec.ts` (E2E for
  number + select editors specifically — the others are unit-only this cycle
  since the demo only wires those two)

**Per-editor param schemas** (from catalog 06):

| Editor | `cellEditorParams` shape | Notes |
|---|---|---|
| `'number'` | `{ min?, max?, precision?, step?, showStepperButtons?, preventStepping? }` | `<input type="number">`; commit-time parse to `Number`; clamp by `min`/`max`; respect `precision` (decimal places) |
| `'date'` | `{}` | `<input type="date">` (or `datetime-local` if value carries time). Value is `Date` |
| `'dateString'` | `{ min?: string\|Date, max?: string\|Date, step?, includeTime? }` | `<input type="date">`; value is `'yyyy-mm-dd'` string |
| `'select'` | `{ values: TValue[]; valueListMaxHeight?: number\|string; valueListMaxWidth?: number\|string }` | `<select>`; one `<option>` per `values[]` entry. `valueListGap` deferred — native select can't honor it |
| `'largeText'` | `{ maxLength?: number=200; rows?: number=10; cols?: number=60 }` | `<textarea>`; `isPopup() === true` by default |
| `'checkbox'` | `{}` | `<input type="checkbox">`; value is `boolean` |

**Steps (per editor, repeat the same TDD micro-cycle):**

- [ ] **Step 1: Write `builtinEditors.test.ts`** — six describe blocks, one
      per editor. Each asserts: editor mounts the expected DOM tag,
      `init` honors `value`, `getValue()` returns the parsed type, `params`
      are applied to the DOM (e.g. `min` on the number input).
- [ ] **Step 2: Run** — expect failures for the 6 missing modules.
- [ ] **Step 3: Implement each editor** — keep each file < 80 LOC.
      Patterns to follow:
      - Mirror `TextCellEditor`'s shape (init → cache params + build
        `HTMLInputElement`; getGui → cached element; getValue → typed read;
        afterGuiAttached → focus + select; destroy → noop).
      - Type coercion: `'number'` returns `Number(input.value)` or `null` for
        empty/`NaN`; `'date'` returns `new Date(input.value)` or `null`;
        `'dateString'` returns the raw string; `'select'` returns
        `params.values[input.selectedIndex]` (preserves type, not the
        stringified `<option value>`); `'checkbox'` returns `input.checked`.
      - `'largeText'` sets `isPopup() { return true; }`; size from
        `rows`/`cols`; Tab inside textarea inserts `'\t'` instead of commit.
        (Commit is Ctrl+Enter for `'largeText'`; per ag-grid behaviour.)
- [ ] **Step 4: Extend `registry.ts`'s `seed`:**

```ts
import { NumberCellEditor } from './builtins/number';
import { DateCellEditor } from './builtins/date';
import { DateStringCellEditor } from './builtins/dateString';
import { SelectCellEditor } from './builtins/select';
import { LargeTextCellEditor } from './builtins/largeText';
import { CheckboxCellEditor } from './builtins/checkbox';

static seed(reg: CellEditorRegistry): void {
  reg.register('text', TextCellEditor);
  reg.register('number', NumberCellEditor);
  reg.register('date', DateCellEditor);
  reg.register('dateString', DateStringCellEditor);
  reg.register('select', SelectCellEditor);
  reg.register('largeText', LargeTextCellEditor);
  reg.register('checkbox', CheckboxCellEditor);
}
```

- [ ] **Step 5: Verify unit tests pass** — `npm test --workspace=cgrid -- builtinEditors`.
- [ ] **Step 6: Update demo** as above (one number + one select column).
- [ ] **Step 7: Write E2E** — `editing.builtins.spec.ts` with two tests
      (number editor accepts numeric input + clamps to `min`; select editor
      shows the `values` list and commit returns the typed value).
- [ ] **Step 8: Run E2E, typecheck, build.**
- [ ] **Step 9: Commit.**

```bash
git commit -m "feat(cgrid): built-in editors — number, date, dateString, select, largeText, checkbox

Closes the catalog-06 Community editor surface against Task 1's
ICellEditor interface. largeText defaults to isPopup() === true (Task 3
mounts it in the popup host). select preserves typed values (not
strings). checkbox returns boolean. number clamps to min/max and
respects precision.

Cycle 5 / Task 2."
```

**Acceptance criteria:**
- [ ] All 6 editors exist + are registered by `CellEditorRegistry.seed`.
- [ ] Each editor's `getValue()` returns the catalog-06 type
      (number / Date / string / TValue / boolean) — verified by unit tests.
- [ ] Demo's number + select columns are editable end-to-end.
- [ ] Unit (≥ 12 assertions) + E2E (2 new tests) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 3 (Popup editors). Confirm Task 2 is committed. Read
docs/catalog/06-cell-editing.md "Popup editors" section (line 135) and the
existing largeText editor (which already returns isPopup() === true).
Follow the per-task workflow.
```

---

## Task 3 — Popup editors (`isPopup()` + `cellEditorPopup` + `cellEditorPopupPosition`)

**Goal:** When `editor.isPopup() === true` (or `colDef.cellEditorPopup === true`),
mount the editor's `getGui()` in a floating layer pinned to the cell. Position
defaults to `'over'` the cell; `'under'` leaves the original cell value visible
above the popup. Collision-avoidance: if the popup would clip the viewport
bottom, flip to `'under'`; same for right edge.

**Why:** Task 2's `'largeText'` editor already returns `isPopup(): true`, but
Task 1's `EditorOverlay` mounts everything inline. Without popup mode the
textarea is constrained to the cell's tiny rect — unusable. Popup also
unblocks future Enterprise editors (rich-select, datepicker) that need
out-of-cell DOM.

**Read first:**
- `docs/catalog/06-cell-editing.md` — "Popup editors" section (line 135)
- `cgrid/src/interaction/editorOverlay.ts` — what we extend

**Files:**
- Create: `cgrid/src/interaction/editors/popupHost.ts`
- Modify: `cgrid/src/interaction/editorOverlay.ts` (dispatch to popup host when
  editor.isPopup() OR colDef.cellEditorPopup is true)
- Modify: `cgrid/src/types.ts` (`CColDef.cellEditorPopup?: boolean`,
  `CColDef.cellEditorPopupPosition?: 'over' | 'under'`)
- Modify: `cgrid/src/cgrid.ts` (pass colDef.cellEditorPopup + position into
  `EditorOverlay.open`; honor `editor.getPopupPosition?.()` when set)
- Modify: `apps/cgrid-positions/src/positionsGrid.ts` (mark `description` or
  another text column as `editable: true, cellEditor: 'largeText'` —
  this is the popup demo)
- Create: `cgrid/tests/popupHost.test.ts`
- Update: `apps/cgrid-positions/tests/editing.spec.ts` (add a popup test)

**Interfaces:**

```ts
// cgrid/src/interaction/editors/popupHost.ts
export interface PopupAnchor {
  cellBounds: { x: number; y: number; w: number; h: number };
  position: 'over' | 'under';
  viewportBounds: { width: number; height: number };
}

export class PopupHost {
  constructor(private host: HTMLElement);
  mount(gui: HTMLElement, anchor: PopupAnchor): void;
  unmount(): void;
}
```

**Steps:**

- [ ] **Step 1:** Write the failing `popupHost.test.ts` — assert mount sets
      `position: absolute` + `left/top` based on anchor; assert collision flip
      when popup would exceed viewport bounds; assert unmount removes DOM.
- [ ] **Step 2:** Implement `PopupHost`. The collision rule: measure the
      popup's `offsetHeight` after mount (one rAF settle), if
      `cellBounds.y + cellBounds.h + popupHeight > viewportBounds.height`
      flip to `'over'`; mirror for `'under'` if it would clip the top.
- [ ] **Step 3:** Modify `EditorOverlay` — after `editor.init`, check
      `editor.isPopup?.() === true || opts.cellEditorPopup === true`. If
      either is true, push the gui through `PopupHost.mount` instead of
      appending to the editor layer.
- [ ] **Step 4:** Update `EditorAttachOpts` to include `cellEditorPopup` and
      `cellEditorPopupPosition`; have `cgrid.ts.openEditor` pass them.
- [ ] **Step 5:** Update demo — `description` column `editable: true,
      cellEditor: 'largeText'`.
- [ ] **Step 6:** Add E2E — double-click description cell opens a textarea
      that is wider than the cell (proves popup) and persists across vertical
      scroll within the cell's row.
- [ ] **Step 7:** Run unit + typecheck + build + E2E; commit.

**Acceptance criteria:**
- [ ] `PopupHost` exists; `EditorOverlay` dispatches popup mode by editor
      method OR col def flag.
- [ ] Collision avoidance verified by unit test (mounted at viewport bottom
      flips to `'over'`).
- [ ] Demo's `description` opens as popup textarea; E2E green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 4 (Edit triggers — singleClickEdit, suppressClickEdit,
F2/Esc/Enter, enterNavigatesVertically*, stopEditingWhenCellsLoseFocus,
suppressKeyboardEvent). Confirm Task 3 is committed. Read docs/catalog/06-cell-editing.md
"Edit mode" gridOptions table (lines 33-46). Follow the per-task workflow.
```

---

## Task 4 — Edit triggers + commit/navigation keys

**Goal:** Connect mouse + keyboard to the editor lifecycle to catalog-06 parity.
Ship the gridOptions + ColDef trigger flags (`singleClickEdit`,
`suppressClickEdit`, `stopEditingWhenCellsLoseFocus`,
`enterNavigatesVertically`, `enterNavigatesVerticallyAfterEdit`,
`enableCellEditingOnBackspace`, `suppressStartEditOnTab`) and the keyboard
matrix (F2 enters; Esc cancels; Enter commits; Enter-after-commit honors
`enterNavigatesVertically*`; Tab commits + moves to next editable cell;
`suppressKeyboardEvent` per column lets an app opt out).

**Why:** Without this task, editing only fires on double-click and the only
commit is blur. Catalog 06 lists these as Community-level options and they
all gate downstream behavior in Tasks 5 + 10.

**Read first:**
- `docs/catalog/06-cell-editing.md` — gridOptions edit-mode table (lines 33–46)
- `docs/catalog/02-column-model.md` — `editable` callback + `suppressKeyboardEvent`
- `cgrid/src/interaction/features/keyPaging.ts` — the keyboard handler we extend
- `cgrid/src/interaction/featureChain.ts` — where features are dispatched

**Files:**
- Create: `cgrid/src/interaction/features/editTrigger.ts` (click + key feature)
- Modify: `cgrid/src/interaction/features/keyPaging.ts` (F2, Esc, Enter, Tab routing)
- Modify: `cgrid/src/interaction/featureChain.ts` (wire `editTrigger` into the chain)
- Modify: `cgrid/src/core/propertyChain.ts` (resolve `editable: boolean | EditableCallback`
  per cell; resolve `suppressKeyboardEvent`)
- Modify: `cgrid/src/cgrid.ts` (read the new options; route Tab to find the
  next editable cell)
- Modify: `cgrid/src/types.ts` — additions:

```ts
export type EditableCallback<TRow = any, TValue = any> =
  (params: { data: TRow; colId: string; rowIndex: number; value: TValue }) => boolean;

export interface CGridOptions<TRow = any> {
  // … existing fields …
  singleClickEdit?: boolean;
  suppressClickEdit?: boolean;
  stopEditingWhenCellsLoseFocus?: boolean;
  enterNavigatesVertically?: boolean;
  enterNavigatesVerticallyAfterEdit?: boolean;
  enableCellEditingOnBackspace?: boolean;
  suppressStartEditOnTab?: boolean;
}

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  editable?: boolean | EditableCallback<TRow, TValue>;
  /** Per-column singleClickEdit override (column wins over grid). */
  singleClickEdit?: boolean;
  suppressKeyboardEvent?: (params: {
    event: KeyboardEvent;
    editing: boolean;
    data: TRow;
    colId: string;
  }) => boolean;
}
```

**Steps:**

- [ ] **Step 1:** Write a unit test for `editTrigger` — resolves `editable`
      callback per cell; dispatches edit on click when `singleClickEdit`;
      ignores click when `suppressClickEdit`.
- [ ] **Step 2:** Implement `editTrigger` as a feature in
      `interaction/features/editTrigger.ts`. It consumes mouse hits from
      `featureChain`, checks the resolved `editable` predicate, and on
      trigger calls `cgrid.openEditor(rowIndex, colId)`.
- [ ] **Step 3:** Extend `keyPaging.ts` to: F2 → openEditor on focused cell;
      Esc when editor is open → cancel; Enter when editor is open →
      commit + (if `enterNavigatesVerticallyAfterEdit`) move focus down by 1
      row; Tab when editor open → commit + (if not `suppressStartEditOnTab`)
      open editor on next editable cell.
- [ ] **Step 4:** Add `suppressKeyboardEvent` early-exit at the top of
      `keyPaging.ts.onKeyDown` — if the column's callback returns true,
      no-op.
- [ ] **Step 5:** Add `stopEditingWhenCellsLoseFocus` — listen for `blur`
      on the host; on blur, call `cgrid.stopEditing()` which dispatches
      `EditorOverlay.commit()` (or `.cancel()` per ag-grid: blur commits
      by default).
- [ ] **Step 6:** Wire `singleClickEdit` (grid + per-column; column wins) —
      `editTrigger.ts` checks the resolved value and switches on `click`
      vs `dblclick`.
- [ ] **Step 7:** Update demo — set `singleClickEdit: true` (grid level) on
      the `apps/cgrid-positions` options.
- [ ] **Step 8:** Add E2E — single-click on `trader` opens editor; Enter
      moves focus down; Tab moves to next editable cell.
- [ ] **Step 9:** Run unit + E2E + typecheck + build; commit.

**Acceptance criteria:**
- [ ] All 7 trigger options from catalog-06 lines 33–46 land on `CGridOptions`.
- [ ] `editable` resolves both `boolean` and callback per cell.
- [ ] F2 / Esc / Enter / Tab keyboard matrix works per catalog 06.
- [ ] `suppressKeyboardEvent` short-circuits before grid handlers when truthy.
- [ ] Demo: single-click trader opens editor; Enter commits + descends.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 5 (Type-to-edit). Confirm Task 4 is committed. Read
docs/catalog/06-cell-editing.md "Edit mode" + the editor's `charPress` field
in Task 1's iCellEditor.ts. Follow the per-task workflow.
```

---

## Task 5 — Type-to-edit + Excel-style arrow-commit mode

**Goal:** Two coupled spreadsheet-style behaviours:

1. **Type-to-edit.** Printable char while a focused editable cell is in
   non-editing state opens the editor with the char as initial value via
   `ICellEditorParams.charPress` (already wired in `TextCellEditor`).
2. **Excel-mode arrows (opt-in via `CGridOptions.enableExcelEditing`).**
   Each open edit carries a `mode: 'enter' | 'edit'` flag:
   - `'enter'` — Excel's "Enter mode". Arrow keys commit + move focus to
     the adjacent cell (Up/Down/Left/Right). Type-to-edit starts here.
   - `'edit'` — Excel's "Edit mode". Arrow keys do the input's native
     caret-move. F2, double-click, single-click (when `singleClickEdit`)
     and `api.startEditingCell` start here.
   - Mousedown inside the open editor input flips `'enter'` → `'edit'`
     so a user who clicks the input mid-type can keep editing without
     accidentally committing on the next arrow.

When `enableExcelEditing` is false (default), the `mode` field is
inert — arrows always behave like today (caret-move inside the input).

**Why:** Spreadsheet-style typing + arrow-key-to-commit-and-navigate is a
top-three power-user request for data grids. Excel models this with a
visible "Ready / Enter / Edit" status bar; we adopt the same vocabulary
internally. Bundling these two behaviours keeps the edit-mode dispatch
logic in one place — both consult the per-edit `mode` state in the same
root capture-phase handler that already owns Tab / Enter / Escape.

**Read first:**
- `cgrid/src/interaction/features/keyPaging.ts`
- `cgrid/src/interaction/features/editTrigger.ts` (Task 4)
- `cgrid/src/interaction/editors/iCellEditor.ts` — `charPress` field
- `cgrid/src/cgrid.ts` — root capture-phase keydown handler (Task 4)

**Files:**
- Modify: `cgrid/src/interaction/features/keyPaging.ts` (printable-char
  → `openEditor(rowIndex, colId, charPress)`)
- Modify: `cgrid/src/interaction/features/editTrigger.ts` (single/double
  click open in `'edit'` mode)
- Modify: `cgrid/src/cgrid.ts`:
  - `openEditor` takes an optional `mode: 'enter' | 'edit'`; type-to-edit
    passes `'enter'`, every other path passes `'edit'`.
  - `activeEdit` carries `mode` and a mutation entry point.
  - Editor-container mousedown listener flips `'enter'` → `'edit'`.
  - Root capture keydown extends to handle Arrow* in `'enter'` mode
    (commit + move focus).
- Modify: `cgrid/src/types.ts` (`CGridOptions.enableExcelEditing?: boolean`).
- Update: `cgrid/tests/editTrigger.test.ts` (single-click opens with `mode:
  'edit'`) + `cgrid/tests/excelEditing.test.ts` (new — arrow-commit dispatch).
- Update: `apps/cgrid-positions/src/positionsGrid.ts` (`enableExcelEditing:
  true` so the E2E exercises it).
- Update: `apps/cgrid-positions/e2e/editing.triggers.spec.ts` or new
  `editing.excel.spec.ts` (3 E2E tests below).

**Steps:**

- [ ] **Step 1:** Add `enableExcelEditing?: boolean` to `CGridOptions`.
- [ ] **Step 2:** Extend `activeEdit` to track `mode: 'enter' | 'edit'`.
      `openEditor` accepts the mode (default `'edit'`).
- [ ] **Step 3:** Failing unit test in `cgrid/tests/excelEditing.test.ts`
      that mocks an open edit with `mode: 'enter'`, dispatches ArrowDown
      to the root, and asserts `stopEditing(false)` was called followed by
      a focus move down by 1 row.
- [ ] **Step 4:** Extend the Task 4 root capture handler:
      - On ArrowDown / ArrowUp / ArrowLeft / ArrowRight:
        if `enableExcelEditing` is on AND `activeEdit.mode === 'enter'`:
        commit + move focus (preventDefault + stopPropagation).
      - Otherwise: do nothing (let the input handle it natively).
- [ ] **Step 5:** Add the mousedown-flips-mode listener:
      `editorContainer.addEventListener('mousedown', ...)`. If
      `activeEdit.mode === 'enter'`, set it to `'edit'`.
- [ ] **Step 6:** Hook printable-key in `keyPaging.ts`:
      `ev.key.length === 1 && !ev.ctrl/meta/alt && focused col is editable
      && !editing` → `openEditor(fr, fc, ev.key, 'enter')`. Prevent default
      + stop propagation.
- [ ] **Step 7:** Update editor-trigger paths (F2 / Enter / click / dblclick
      / `startEditingCell`) to pass `mode: 'edit'`.
- [ ] **Step 8:** Demo turns on `enableExcelEditing: true`.
- [ ] **Step 9:** Add E2E `editing.excel.spec.ts` (3 tests):
      1. Type 'X' on focused cusip → editor opens with 'X', press
         ArrowDown → editor closes, value committed as 'X', focus moved to
         row 1 / cusip.
      2. F2 on focused cusip → editor opens in `'edit'` mode, press
         ArrowDown → editor stays open (no commit), input caret moves.
      3. Type 'X' on focused cusip → click inside the input → press
         ArrowDown → editor stays open (mode flipped to `'edit'`), value
         not yet committed.
- [ ] **Step 10:** Run unit + typecheck + build + E2E; commit.

**Acceptance criteria:**
- [ ] `CGridOptions.enableExcelEditing` typed + storage-wired.
- [ ] Type-to-edit opens with `charPress` AND starts in `'enter'` mode.
- [ ] F2 / dblclick / single-click / api.startEditingCell open in `'edit'`
      mode.
- [ ] Mousedown inside the editor flips `'enter'` → `'edit'`.
- [ ] In `'enter'` mode with `enableExcelEditing: true`: ArrowUp/Down/Left/
      Right commit + move focus; Enter still commits + descends per Task 4.
- [ ] In `'edit'` mode (or when flag is off): arrows behave as the input's
      native key handler (caret-move).
- [ ] Modifier-key combos (Ctrl+/Cmd+/Alt+) do not trigger type-to-edit.
- [ ] Demo opts in via `enableExcelEditing: true`. Three new E2E tests
      green plus all previous E2E tests green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 6 (Variable row heights — getRowHeight + per-row rowHeight
+ heights TypedArray in chunks). Confirm Task 5 is committed. Read
docs/catalog/03-rows-and-row-models.md (getRowHeight) and
cgrid/src/worker/protocol.ts (ViewportChunk shape) before touching code.
This is the largest task in the cycle — block out a clean session.
Follow the per-task workflow.
```

---

## Task 6 — Variable row heights — data layer

**Goal:** Wire per-row heights end-to-end. Add `CGridOptions.getRowHeight`
callback (param-typed per catalog 03). Heights canonical on the worker.
Ship a `heights: Float32Array` alongside each `ViewportChunk`. Replace the
uniform `getRowHeight(0)` assumption in `core/viewport.ts` with per-row
lookup. Hit-tester (`interaction/hitTester.ts`) already binary-searches
`visibleRows[]` — no change required there. Fenwick tree for global
scroll-to-row math comes in Task 7; this task gets viewport painting
correct using the per-chunk heights array.

**Why this is Task 6 (not Task 1):** Editing infrastructure (Tasks 1–5) is
strictly main-thread + paint-loop. Variable heights crosses the worker
protocol boundary — higher blast radius. Land editing first so a heights
regression in Task 6 doesn't entangle editor verification.

**Read first:**
- `docs/catalog/03-rows-and-row-models.md` — `getRowHeight` callback section
- `cgrid/src/worker/protocol.ts` — `ViewportChunk` shape (lines 25–35)
- `cgrid/src/worker/chunkFormat.ts` — encode helpers
- `cgrid/src/worker/index.ts` — pipeline that builds chunks
- `cgrid/src/worker/rowStore.ts` — where heights will live
- `cgrid/src/core/viewport.ts` — uniform-height flag at line 117
- `cgrid/src/interaction/hitTester.ts` — already binary-search-friendly (line 70)

**Files:**
- Modify: `cgrid/src/worker/protocol.ts` (add `heights: Float32Array` to
  `ViewportChunk`; add `applyTransaction.heightsByRowId?: Map<rowId, number>` for
  height-bearing updates)
- Modify: `cgrid/src/worker/rowStore.ts` (store `heightsByRowId: Map<string, number>`;
  setters tied to transaction lifecycle)
- Modify: `cgrid/src/worker/index.ts` (slice heights into the chunk by visible
  row order; default to global `rowHeight` for rows with no per-row entry)
- Modify: `cgrid/src/worker/chunkFormat.ts` (heights encoder/decoder if any
  packing applied; defaults to raw Float32Array — Cycle 24 explores compression)
- Modify: `cgrid/src/core/viewport.ts` (`computeViewport` takes a
  `getRowHeight(localRowIndex): number` function instead of a uniform constant;
  internal accumulator becomes `top += getRowHeight(i)`)
- Modify: `cgrid/src/cgrid.ts` (compute per-row heights via `getRowHeight`
  callback main-side before `applyTransaction`; main thread holds a small
  height-cache mirror for the current viewport pre-Fenwick; pass to
  computeViewport)
- Modify: `cgrid/src/types.ts`:

```ts
export interface GetRowHeightParams<TRow = any> {
  data: TRow;
  rowId: string;
  rowIndex: number;
}

export interface CGridOptions<TRow = any> {
  // … existing fields …
  /** Per-row height in CSS px. Return null/undefined to fall back to
   *  `rowHeight`. Called by cgrid main thread on row insert/update; the
   *  resolved height is shipped to the worker and rides chunks back. */
  getRowHeight?: (params: GetRowHeightParams<TRow>) => number | null | undefined;
}
```

- Create: `cgrid/tests/variableRowHeights.test.ts`
- Update: `cgrid/tests/viewport.test.ts` — assert per-row accumulation
- Create: `apps/cgrid-positions/tests/variableHeights.spec.ts`
- Modify: `apps/cgrid-positions/src/positionsGrid.ts` — add `getRowHeight: (p) =>
  p.data.kind === 'breaker' ? 48 : null` to demo a non-uniform row

**Steps:**

- [ ] **Step 1:** Write `cgrid/tests/variableRowHeights.test.ts` — three
      groups:
      - `worker rowStore stores + returns heightsByRowId`
      - `applyTransaction(update) with heightsByRowId merges in`
      - `getViewportChunk emits a heights Float32Array with one entry per
        visible row, in render order`
- [ ] **Step 2:** Run — expect failures (heights field doesn't exist yet).
- [ ] **Step 3:** Add `heights: Float32Array` to `ViewportChunk` in
      `worker/protocol.ts`. Default empty buffer length matches
      `rowIds.length`.
- [ ] **Step 4:** Add `heightsByRowId: Map<string, number>` to `rowStore`.
      Wire `applyTransaction` to merge updates by rowId.
- [ ] **Step 5:** In `worker/index.ts`, slice heights into the chunk in
      visible-row order. If a row has no per-row entry, write the global
      `rowHeight`.
- [ ] **Step 6:** Verify Step-1 tests pass.
- [ ] **Step 7:** Write `viewport.test.ts` addition — assert
      `computeViewport` invokes `getRowHeight(local)` per row and accumulates
      tops correctly.
- [ ] **Step 8:** Refactor `core/viewport.ts` — replace
      `const rowH = ...` + `top = bodyTop + local * rowH - scrollTop` (around
      line 132) with:

```ts
let top = bodyTop - scrollTop;
for (let local = 0; local < firstDataRow; local++) {
  top += getRowHeight(local);
}
for (let local = firstDataRow; local <= lastDataRow; local++) {
  const h = getRowHeight(local);
  if (top + h > 0 && top < containerHeight) {
    visibleRows.push({ rowIndex: local, top, height: h, subgrid: dataSubgrid });
  }
  top += h;
}
```

Caller in `cgrid.ts` passes a `(local) => heightsBuffer[local] ?? globalRowHeight`
closure. Heights buffer here is the latest chunk's `heights` (Task 7's
Fenwick takes over for global lookups).

- [ ] **Step 9:** Main-thread side of `getRowHeight` — `cgrid.ts.applyTransaction`
      computes heights for added/updated rows main-side and includes them
      in the worker postMessage. (Main thread is the only side that can
      run user callbacks.) Worker stores them in `heightsByRowId`.
- [ ] **Step 10:** Update demo to mark some rows variable-height.
- [ ] **Step 11:** Write E2E (`variableHeights.spec.ts`) — assert demo has
      mixed row heights visible in the viewport (read row top positions via
      `__cgrid.getRowBoundsAt(rowIndex)`).
- [ ] **Step 12:** Run unit + E2E + typecheck + build; commit.

**Acceptance criteria:**
- [ ] `CGridOptions.getRowHeight` typed + honored.
- [ ] `ViewportChunk.heights` ships per chunk; length matches `rowIds`.
- [ ] `computeViewport` accumulates row tops from per-row heights.
- [ ] Demo renders a mixed-height grid; hit-test still locates correct row
      (binary search already handles variable heights).
- [ ] No regression in scroll FPS on the uniform-height portion of the grid.
- [ ] Unit (≥ 6 assertions) + E2E (1 test) + typecheck + build green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 7 (Fenwick tree for cumulative row-top lookup). Confirm
Task 6 is committed. Read core/viewport.ts (now per-row) before code.
Follow the per-task workflow.
```

---

## Task 7 — Fenwick tree for cumulative row-top lookup

**Goal:** Replace any remaining linear-scan `scrollTop ↔ rowIndex` math
with O(log n) Fenwick (Binary Indexed Tree) lookups. Build the tree from
the main-thread height mirror after each viewport chunk arrives. Use it
for: scrollbar thumb size, `ensureRowVisible(rowId)` scroll target,
viewport's first-visible-row search.

**Why:** With variable heights, `firstVisibleRow = floor(scrollTop / rowHeight)`
no longer works. A linear scan is O(n) — unusable past 10k rows. Fenwick
costs O(log n) per query and O(n) to build (~5 ms for 1M rows). It is the
canonical structure for this problem.

**Read first:**
- `cgrid/src/core/viewport.ts` — `computeViewport` (now per-row from Task 6)
- `cgrid/src/cgrid.ts` — `ensureRowVisible` + scroll handlers
- Master plan Performance Budget (Cycle 5 row above) for the O(log n) gate

**Files:**
- Create: `cgrid/src/core/rowHeightIndex.ts`
- Modify: `cgrid/src/core/viewport.ts` (delegate first-visible-row search to
  the index when present)
- Modify: `cgrid/src/cgrid.ts` (build + rebuild the index on chunk arrival;
  pass it to viewport; route `ensureRowVisible` through it)
- Modify: `cgrid/src/interaction/hitTester.ts` — no change required; binary
  search over `visibleRows[]` already handles variable heights
- Create: `cgrid/tests/rowHeightIndex.test.ts`
- Create: `cgrid/bench/rowHeightIndex.bench.ts`

**Interfaces:**

```ts
// cgrid/src/core/rowHeightIndex.ts
export class RowHeightIndex {
  /** Build from a length + a height-getter (typically a Float32Array). */
  constructor(length: number, heightAt: (i: number) => number);

  /** Total height of all rows. */
  totalHeight(): number;

  /** Cumulative top of row i: sum of heights[0..i-1]. O(log n). */
  topOf(i: number): number;

  /** First row with topOf(i) <= y < topOf(i)+heights[i]. O(log n). */
  rowAt(y: number): number;

  /** Update one row's height. O(log n). */
  update(i: number, newHeight: number): void;

  /** Insert at index i (shifts later rows). O(n) worst case — used on
   *  transaction add, not on scroll. */
  insert(i: number, height: number): void;

  /** Remove at index i. O(n) worst case. */
  remove(i: number): void;

  /** Length of the index. */
  length(): number;
}
```

**Steps:**

- [ ] **Step 1:** Write `rowHeightIndex.test.ts` — test `topOf`, `rowAt`,
      `update`, `totalHeight` against a brute-force reference for n ∈ {1, 10, 1000}.
- [ ] **Step 2:** Implement Fenwick — standard BIT over a `Float32Array
      tree[]`. `topOf(i)` = sum(tree, 1..i). `rowAt(y)` = `tree.search(y)`
      using the standard BIT descent. (For unfamiliar engineers: the
      tree is a prefix-sum structure indexed by powers of two; descent
      starts at the largest power of two ≤ length and accumulates while
      the running sum ≤ y.)
- [ ] **Step 3:** Verify tests pass.
- [ ] **Step 4:** Write `rowHeightIndex.bench.ts` — Vitest bench for
      `topOf` + `rowAt` at n = 1,000,000. Assert mean < 50 µs.
- [ ] **Step 5:** Run bench; record numbers in the worklog perf section.
- [ ] **Step 6:** Wire into `cgrid.ts` — build a `RowHeightIndex` on first
      chunk arrival; rebuild on subsequent chunks (heights array changes
      with sort/filter). Pass to `computeViewport`.
- [ ] **Step 7:** Refactor `core/viewport.ts` — first-visible-row search
      uses `index.rowAt(scrollTop)` instead of the accumulator-walk for the
      pre-data subgrids' top math (which stays linear; subgrids are tiny).
      For the data subgrid: `firstDataRow = index.rowAt(scrollTop - bodyTop)`;
      `lastDataRow = index.rowAt(scrollTop + containerHeight - bodyTop)`.
- [ ] **Step 8:** Route `ensureRowVisible(rowId)` through
      `cgrid.scrollTo(index.topOf(rowIndex))`.
- [ ] **Step 9:** Run unit + bench + E2E (uses the variable-height demo
      grid for free); typecheck; build; commit.

**Acceptance criteria:**
- [ ] `core/rowHeightIndex.ts` exports `RowHeightIndex`.
- [ ] Brute-force vs Fenwick parity verified for n = 1, 10, 1000.
- [ ] Bench: `topOf` + `rowAt` mean < 50 µs at n = 1M.
- [ ] Variable-height demo's scroll, scrollbar thumb size, and
      `ensureRowVisible` all behave correctly.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 8 (autoHeight — worker OffscreenCanvas + main-thread
fallback). Confirm Task 7 is committed. Read docs/catalog/02-column-model.md
on autoHeight, and check OffscreenCanvas.measureText availability across
the master plan's browser baseline. Follow the per-task workflow.
```

---

## Task 8 — `autoHeight` per column — worker `OffscreenCanvas.measureText` + main-thread fallback

**Goal:** When a ColDef has `autoHeight: true`, measure the wrapped text
height for every cell in that column and feed the per-row max back into
the heights store (Task 6's `heightsByRowId`). Measurement runs in the
worker via `OffscreenCanvas.measureText` when the browser supports it
(Chrome ≥ 100, Firefox ≥ 105, Safari ≥ 16.4). On older Safari (15.4–16.3)
the worker emits a `measureText` request over the protocol; the main
thread measures with `HTMLCanvasElement.measureText` and posts back. Cache
measurements on the worker keyed by `(text, width, fontKey)` with bounded
LRU (1024 entries).

**Why:** Without `autoHeight`, long text in `wrapText` columns (Task 9)
truncates. Together they unblock cells with variable, content-driven
content — the dominant pattern in admin UIs.

**Read first:**
- `docs/catalog/02-column-model.md` — `autoHeight` + `wrapText`
- `cgrid/src/worker/index.ts` — pipeline (where the autoHeight pass slots in)
- Master plan Performance Budget — autoHeight measure target

**Files:**
- Create: `cgrid/src/worker/measureText.ts` (OffscreenCanvas wrapper +
  feature detect + LRU cache)
- Modify: `cgrid/src/worker/index.ts` (autoHeight pass runs after FilterPass
  + SortPass; updates `heightsByRowId` for `autoHeight` columns)
- Modify: `cgrid/src/worker/protocol.ts` (add `measureTextRequest` /
  `measureTextResponse` messages for the fallback path; add
  `heightsChanged: { rowIds: Uint32Array; heights: Float32Array }` worker→main
  message emitted when an autoHeight pass updates heights)
- Modify: `cgrid/src/worker/rowStore.ts` (`autoHeightContributions: Map<rowId, Map<colId, number>>`
  to track per-(row,col) measured heights so removing autoHeight on one
  column doesn't drop others' contribution)
- Modify: `cgrid/src/cgrid.ts` (handle `measureTextRequest` from worker —
  main-thread fallback path)
- Modify: `cgrid/src/types.ts`:

```ts
export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  autoHeight?: boolean;
}
```

- Create: `cgrid/tests/measureText.test.ts`
- Update: demo — add `autoHeight: true` to a text column

**Worker feature detect (canonical implementation; place in
`worker/measureText.ts`):**

```ts
let supported: boolean | null = null;
export function workerCanMeasure(): boolean {
  if (supported !== null) return supported;
  try {
    if (typeof OffscreenCanvas === 'undefined') return (supported = false);
    const c = new OffscreenCanvas(1, 1);
    const ctx = c.getContext('2d');
    return (supported = !!(ctx && typeof ctx.measureText === 'function'));
  } catch {
    return (supported = false);
  }
}
```

**Steps:**

- [ ] **Step 1:** Write `cgrid/tests/measureText.test.ts` — assert
      `workerCanMeasure()` returns boolean; assert LRU eviction at 1024 + 1 entries; assert
      a `measureWrappedHeight(text, width, font)` helper returns
      monotone-non-decreasing values as width shrinks.
- [ ] **Step 2:** Implement `measureText.ts` — feature detect; LRU cache
      keyed by stringified `${font}|${width}|${text}`; OffscreenCanvas path
      that measures + wraps (greedy word-wrap; on hyphenation skip);
      returns `Math.ceil(lineCount * lineHeight)`.
- [ ] **Step 3:** Add the autoHeight pass to `worker/index.ts`. After
      Sort/Filter/Group/Agg, for each `autoHeight` column iterate the
      visible row IDs and compute the height. Update
      `autoHeightContributions[rowId][colId] = measured`. Then for each
      affected rowId, set
      `heightsByRowId[rowId] = max(explicitHeight, max(autoHeightContributions[rowId].values))`.
      The first viewport chunk ships with heights based on
      `getRowHeight` + explicit `rowHeight` only; autoHeight runs as a
      follow-on pass. When it completes for a chunk's row range, the
      worker emits a new protocol message `heightsChanged: { rowIds:
      Uint32Array; heights: Float32Array }` so the main thread can
      rebuild the Fenwick index range (Task 7's `RowHeightIndex.update(i,
      h)` per entry; bulk-rebuild if >256 rows change) and request a
      repaint. Worker measurements proceed in batches of 64 rows per
      task-queue turn to avoid blocking other worker messages.
- [ ] **Step 4:** When `workerCanMeasure() === false`, the autoHeight pass
      enqueues `measureTextRequest` for each (text, width) pair on the
      main thread. Main thread processes the batch (single canvas
      `measureText` call per entry), posts `measureTextResponse` back with
      results, worker writes to cache + heights. Settle is one rAF; the
      first paint with autoHeight may flicker one frame, then settle.
- [ ] **Step 5:** Update demo — add `autoHeight: true` on a wrappable
      column (e.g. a description-style column) AND make the demo grid
      tall enough that you see the autoHeight effect.
- [ ] **Step 6:** Add E2E — the autoHeight column has a row taller than the
      base height; assert by reading `__cgrid.getRowBoundsAt(rowIndex)`.
- [ ] **Step 7:** Run perf gate: 100k rows × 60-char column,
      `worker_autoheight_ms = performance.now()` deltas in worker — record
      in worklog perf section. Confirm < 200 ms on the hot path.
- [ ] **Step 8:** Run unit + E2E + typecheck + build; commit.

**Acceptance criteria:**
- [ ] `autoHeight` ColDef field typed + plumbed.
- [ ] Worker feature-detects `OffscreenCanvas.measureText`.
- [ ] Main-thread fallback path round-trips (verified by forcing the
      branch via a test flag).
- [ ] LRU cache caps at 1024 entries with correct eviction.
- [ ] autoHeight column's rows are visibly taller in the demo.
- [ ] Perf: < 200 ms for 100k × 60-char on worker hot path.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 9 (wrapText per column — multi-line text paint). Confirm
Task 8 is committed. Read renderer/cellRenderers/registry.ts and the
existing text-cell painter before code. Follow the per-task workflow.
```

---

## Task 9 — `wrapText` per column — multi-line text paint

**Goal:** When a ColDef has `wrapText: true`, the cell paints text across
multiple lines (greedy word-wrap) up to the row's height. Combined with
Task 8's `autoHeight`, the row sizes to fit; without autoHeight, the text
truncates at the row boundary with ellipsis on the last visible line.

**Why:** Task 8 measures heights but doesn't paint multi-line — the rendered
text would just sit on baseline 1 with overflow hidden. wrapText is the
paint-side complement.

**Read first:**
- `docs/catalog/02-column-model.md` — `wrapText`
- `cgrid/src/renderer/cellRenderers/registry.ts` — text cell painter

**Files:**
- Create: `cgrid/src/renderer/cellRenderers/wrapText.ts` (the multi-line
  text painter — registers itself as `'text-wrap'` and is auto-selected
  when colDef.wrapText is true)
- Modify: `cgrid/src/renderer/cellRenderers/registry.ts` (selector: if
  colDef.wrapText → use `'text-wrap'`, else default `'text'`)
- Modify: `cgrid/src/types.ts`:

```ts
export interface CColDef<TRow = any, TValue = any> {
  // … existing fields …
  wrapText?: boolean;
}
```

- Create: `cgrid/tests/wrapText.test.ts`
- Update: demo — turn on `wrapText` on the autoHeight column from Task 8

**Steps:**

- [ ] **Step 1:** Failing test — `wrapText.test.ts` asserts the painter
      breaks a long string into N lines for a given width + font; asserts
      it truncates the last line with ellipsis when row height is exceeded.
- [ ] **Step 2:** Implement greedy word-wrap. Reuse Task 8's
      `measureText.ts` logic if extracted into a shared helper; otherwise
      duplicate the greedy split — small enough that DRY doesn't bite.
      Cache a single `lineBuffer: string[]` on the painter instance to
      avoid per-cell allocation.
- [ ] **Step 3:** Renderer registry — when `colDef.wrapText === true`,
      select `'text-wrap'` painter automatically. (No per-row `cellRendererSelector`
      override needed — wrapText is a column flag.)
- [ ] **Step 4:** Update demo — `description` column with `wrapText: true,
      autoHeight: true`.
- [ ] **Step 5:** E2E — assert the description column's visible text
      contains multiple lines (extract via the canvas screenshot path that
      Task 7's variable-height test uses).
- [ ] **Step 6:** Run unit + E2E + typecheck + build; commit.

**Acceptance criteria:**
- [ ] `wrapText: true` paints multi-line text in the cell.
- [ ] Last-line ellipsis on overflow when row height is fixed.
- [ ] No per-cell allocation in the wrap loop (verified by reading the
      painter — single buffer reused).
- [ ] Demo: description column wraps + auto-heights correctly.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 10 (Full-row edit). Confirm Task 9 is committed. Read
docs/catalog/06-cell-editing.md "Full-row edit mode" section (line 147)
before code. This is the final task of Cycle 5 — at the end, run the
cycle exit ritual (FM row flips + shipped list + perf timings).
Follow the per-task workflow.
```

---

## Task 10 — Full-row edit (`editType: 'fullRow'`)

**Goal:** When `editType: 'fullRow'`, every editable cell in the row opens
simultaneously when any one of them is triggered. Tab navigates between
them within the row; Enter commits all; Esc cancels all. Fires
`rowEditingStarted`, `rowEditingStopped`, and `rowValueChanged` per
catalog 06 events table.

**Why this is Task 10:** Full-row edit is a coordinator on top of Tasks 1–5;
it's the most complex editor task and benefits from the rest of the editor
infrastructure being stable. It's the only task that consumes `focusIn` /
`focusOut` on `ICellEditor` — those hooks were declared in Task 1 but
never invoked.

**Read first:**
- `docs/catalog/06-cell-editing.md` — "Full-row edit mode" (line 147)
- Task 1's `iCellEditor.ts` — `focusIn` / `focusOut`
- `cgrid/src/interaction/editorOverlay.ts` — single-editor host pattern

**Files:**
- Create: `cgrid/src/interaction/editors/rowEditCoordinator.ts`
- Modify: `cgrid/src/interaction/editorOverlay.ts` (the existing single-cell
  overlay; row-edit coordinator decides single-cell vs full-row)
- Modify: `cgrid/src/interaction/features/editTrigger.ts` (dispatch
  full-row vs single-cell based on `editType`)
- Modify: `cgrid/src/cgrid.ts` (`editType` option; route Tab during
  full-row edit; emit row-level events)
- Modify: `cgrid/src/types.ts`:

```ts
export interface CGridOptions<TRow = any> {
  // … existing fields …
  editType?: 'fullRow';
}

export interface RowEditingStartedEvent<TRow = any> {
  type: 'rowEditingStarted';
  rowIndex: number;
  rowId: string;
  data: TRow;
}
export interface RowEditingStoppedEvent<TRow = any> {
  type: 'rowEditingStopped';
  rowIndex: number;
  rowId: string;
  data: TRow;
}
export interface RowValueChangedEvent<TRow = any> {
  type: 'rowValueChanged';
  rowIndex: number;
  rowId: string;
  data: TRow;
}
```

- Create: `cgrid/tests/rowEditCoordinator.test.ts`
- Update: demo + `apps/cgrid-positions/tests/editing.spec.ts` (one full-row
  E2E)

**Coordinator behaviour:**

- Single-cell mode (default): existing flow, one editor at a time.
- Full-row mode: when an edit is triggered on row R, the coordinator
  iterates editable columns in render order, opens one editor per cell,
  parks them all in the editor layer with absolute positioning. Tracks an
  `activeIndex: number` pointing at the currently focused editor.
  - Tab → call `focusOut()` on current, `focusIn()` on next.
  - Shift+Tab → reverse.
  - Enter / blur-row → commit all (run each editor's `getValue()` through
    the per-column `valueParser` + `valueSetter`; dispatch a single
    `applyTransaction({ update: [row] })`).
  - Esc → cancel all without dispatch.
- Events: `rowEditingStarted` after all editors mount; `rowEditingStopped`
  unconditionally on close; `rowValueChanged` only when ≥ 1 cell changed.

**Steps:**

- [ ] **Step 1:** Write `rowEditCoordinator.test.ts` — coordinator opens N
      editors for N editable columns; Tab cycles `activeIndex`; commit
      gathers all values; cancel discards all.
- [ ] **Step 2:** Implement `RowEditCoordinator`. Internally instantiates
      multiple `ICellEditor`s; each gets its own `getGui()` mount.
- [ ] **Step 3:** `editTrigger.ts` checks `options.editType === 'fullRow'`
      and dispatches the coordinator instead of single-cell `openEditor`.
- [ ] **Step 4:** Wire row-level events.
- [ ] **Step 5:** Add demo + E2E — toggle the demo into full-row mode via a
      query param (`?editType=fullRow`) so the existing demo flow keeps
      single-cell editing.
- [ ] **Step 6:** Run unit + E2E + typecheck + build; commit.

**Acceptance criteria:**
- [ ] `editType: 'fullRow'` opens N editors for the row's N editable cols.
- [ ] Tab navigates within the row; Esc cancels all; Enter commits all.
- [ ] `rowEditingStarted` / `rowEditingStopped` / `rowValueChanged` fire
      per catalog 06.
- [ ] `focusIn` / `focusOut` invoked on editor instances during Tab.
- [ ] Demo (with `?editType=fullRow`): full row of editors opens; Tab
      cycles; Enter commits.

**Cycle 5 exit ritual (after Task 10's commit):**

- [ ] Update FM rows in `docs/catalog/FEATURE_MATRIX.md` to ✅:
      - **Area 02:** `autoHeight`, `wrapText`, `suppressKeyboardEvent`,
        `editable` (callback form), `cellEditor` (string + ctor),
        `cellEditorParams`, `cellEditorPopup`, `cellEditorPopupPosition`.
      - **Area 03:** `getRowHeight`, per-row `rowHeight`.
      - **Area 06:** `'text'`, `'number'`, `'date'`, `'dateString'`,
        `'select'`, `'largeText'`, `'checkbox'` built-in editors;
        `singleClickEdit`, `suppressClickEdit`,
        `stopEditingWhenCellsLoseFocus`, `enterNavigatesVertically`,
        `enterNavigatesVerticallyAfterEdit`, `enableCellEditingOnBackspace`,
        `suppressStartEditOnTab`; `editType: 'fullRow'`;
        `ICellEditor.init/getGui/getValue/destroy` + optional methods.
      - **Area 22:** `cellEditingStarted`, `cellEditingStopped`,
        `cellValueChanged` (refined), `rowEditingStarted`,
        `rowEditingStopped`, `rowValueChanged`.
      - **Area 23:** `on`, `off`, `addEventListener`, `removeEventListener`,
        `registerCellEditor`.
- [ ] Append to this worklog under "Shipped":
      - Editor registry + 7 built-ins (text, number, date, dateString,
        select, largeText, checkbox).
      - Popup editor host + collision-aware positioning.
      - Click + keyboard triggers (catalog 06 surface).
      - Type-to-edit.
      - Variable row heights (`getRowHeight`, heights TypedArray in chunks).
      - Fenwick tree (O(log n) row-top lookup).
      - `autoHeight` (worker `OffscreenCanvas.measureText` + main-thread
        fallback for Safari 15.4–16.3).
      - `wrapText` paint.
      - Full-row edit + 3 row-level events.
      - Public emitter surface (`on`/`off`/`addEventListener`/`removeEventListener`).
- [ ] Run the perf checks (Cycle 24 introduces the automated bench;
      until then hand-time on demo): edit-mode entry < 16 ms p95,
      variable-height scroll ≥ 120 fps median, autoHeight measure < 200 ms
      on the worker hot path. Record numbers in the perf section below.
- [ ] Append `## Cycle 5 status: COMPLETE` + the shipped-feature list.

**Next session prompt** (final session of this cycle):

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
"Cycle 5 exit ritual" and run it. Confirm Task 10 is committed. Flip FM rows;
update the worklog's Shipped + Performance sections with measured numbers;
commit the exit-ritual changes; then read the master plan's Cycle 6 section
and author the Cycle 6 worklog at
docs/superpowers/plans/<YYYY-MM-DD>-canvasgrid-cycle-06-column-ux.md.
```

---

## Quick reference — per-task workflow

For every task:

1. Open a fresh Claude Code session at the repo root (`/Users/develop/wfh/canvasgrid`).
2. Paste the "Next session prompt" from the previous task (or the Task-1
   prompt below for the first task).
3. The session reads this worklog + catalog refs, executes the task's
   Steps, runs the verification commands, and commits.
4. When done, the session ends with the prompt for the NEXT task.

### Task 1 starter prompt (first session, copy-paste):

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-05-editing-and-row-heights.md
and execute Task 1 (ICellEditor + registry + 'text' editor +
on/addEventListener). Read docs/catalog/06-cell-editing.md sections on
ICellEditor (lines 70-84) and events (lines 102-116). This is the first
session of Cycle 5; follow the Global Constraints, do not skip the
verification commands, and commit at the end. Also close the Cycle 4
addEventListener carry-over in the same commit (CGridApi.on/off +
addEventListener/removeEventListener aliases).
```

---

## Shipped

<!-- Populated by the Cycle 5 exit ritual at end of Task 10. -->

---

## Performance — hand-timed perf gate

Cycle 24 introduces the automated bench harness; until then this section is
the manual checkpoint. Captured on the `apps/cgrid-positions` demo against
the live `stomp-view-server` at `ws://localhost:8081`, using a Chromium
devtools session at 120 Hz display refresh.

| Metric | Budget | Measured (Cycle 5 exit) | Notes |
|---|---|---|---|
| Edit-mode entry (open → focused) | < 16 ms p95 | _TBD at cycle exit_ | F2 / double-click / single-click paths timed separately |
| `scrollTop → rowIndex` (1M rows, variable) | < 50 µs p95 | _TBD via `rowHeightIndex.bench.ts`_ | Vitest bench |
| Variable-height scroll (100k mixed) | ≥ 120 fps median | _TBD on demo_ | Same 1.5 s programmatic scroll as Cycle 4 |
| `autoHeight` measure (100k × 60 ch) | < 200 ms worker / < 1 s main | _TBD via `performance.now()` deltas_ | Hot + fallback paths recorded separately |

**Verdict:** _Populated at cycle exit._

---

## Cycle 5 status: PENDING

<!-- Flipped to COMPLETE in the exit ritual (after Task 10's commit). -->
