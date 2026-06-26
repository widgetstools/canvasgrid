# Canvasgrid Cycle 10 — Clipboard + context menu — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Right-click context menu (default items + custom items),
system clipboard integration (copy / paste / cut on cell ranges),
keyboard shortcuts (Ctrl+C / Ctrl+V / Ctrl+X), and clipboard
processing callbacks. Closes ag-grid feature parity for FM Area 19
(clipboard + context menu, ~17 of 19 rows).

**Architecture:** Context menu mounts as a DOM portal (positioned `fixed`
over the canvas) — same pattern as the Cycle 7 filter popup host.
`getContextMenuItems` returns a flat list of `MenuItem` (separators
allowed). A new `RightClick` feature in the input chain intercepts
`contextmenu` events and routes them through the host. Default items
hang off a `defaultMenuItems` registry so apps can build hybrids
(default + custom). Clipboard work fans out: keyboard / menu calls
land on `cgrid.api.copySelectedRangesToClipboard` /
`pasteFromClipboard` / `cutSelectedRanges`. Both copy and paste push
the heavy lifting (TSV encode / parse + value coercion) to the
worker so a 10k × 50 range round-trips off the main thread.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E),
single-canvas 2D paint, Web Worker data pipeline. No new runtime
dependencies. `navigator.clipboard` (Async Clipboard API) for the
system clipboard handoff; fallback to `document.execCommand('copy')`
only when the async API is gated by an insecure context.

**References (READ FIRST when starting any task):**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan (Cycle 10 section, line 345)
- `docs/superpowers/plans/2026-06-25-canvasgrid-cycle-09-range-selection.md` — Cycle 9 worklog (range model + range API surface this cycle reads)
- `docs/catalog/19-clipboard-context-menu.md` — `processCellForClipboard`, `processCellFromClipboard`, `getContextMenuItems`, `clipboardDelimiter`, `suppressClipboardApi`, `suppressClipboardPaste`, `suppressContextMenu`
- `docs/catalog/FEATURE_MATRIX.md` — Area 19 rows to flip at cycle exit
- Current source:
  - `cgrid/src/interaction/selectionModel.ts` — `state.ranges` source-of-truth (Cycle 9)
  - `cgrid/src/interaction/filters/filterPopupHost.ts` — popup mount pattern to mirror for the context menu host
  - `cgrid/src/worker/dataPipeline.ts` — where the new clipboard worker pass lives
  - `cgrid/src/worker/messageProtocol.ts` (or `worker/protocol.ts`) — worker request/response shapes
  - `cgrid/src/cgrid.ts` — `CGridApi` (where clipboard methods + `getContextMenuItems` land)
  - `cgrid/src/types.ts` — `CGridOptions`, `CGridApi`, event union extensions
  - `cgrid/src/interaction/featureChain.ts` — input dispatcher (where `RightClick` plugs in)
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task** (extend the constraints from Cycles 2–9).

- **API parity, not API mimicry.** Field names mirror ag-grid verbatim
  (`getContextMenuItems`, `processCellForClipboard`,
  `processCellFromClipboard`, `clipboardDelimiter`,
  `copySelectedRangesToClipboard`, `pasteFromClipboard`,
  `cutSelectedRanges`, `suppressClipboardApi`,
  `suppressClipboardPaste`, `suppressContextMenu`).
- **No regressions in the public API.** Any addition to `CGridOptions`,
  `CGridApi`, the event union, or the worker protocol is purely
  additive.
- **TypeScript strict.** `npm run typecheck --workspaces` clean every task.
- **Heavy work on the worker.** TSV encode + parse + cell coercion run
  inside the worker; main thread does only `navigator.clipboard.writeText`
  / `readText`. Performance gate: 10k × 50 range copy in < 100 ms
  wall-clock (worker round-trip included).
- **`alpha: false` canvas, DPR-aware paint, native scrollbars** — unchanged.
- **Vitest + Playwright green at the end of every task.**
- **Conventional commits.** Body footer carries cycle prefix
  (e.g. `feat(cgrid): clipboard copy via worker TSV pass\n\nCycle 10 / Task 3.`).
- **Branch per task + PR per task.** Each task: branch off main as
  `batch/cycle-10-task-N-<YYYY-MM-DD>`, commit, push, open PR to main.
  The autonomous runner expects this and merges each PR before
  spawning the next session.
- **Demo never breaks.** `apps/cgrid-positions` runs green at every
  commit. E2E specs use `?stress=light` opt-in for the heavy stream.
- **Async Clipboard API quirks.** The HTML spec requires a user
  gesture for `navigator.clipboard.write*`. Tests use Playwright's
  `--allow-clipboard-write` permission or `clipboard-permissions`
  context option. Programmatic copy from a `setTimeout` will reject
  without a gesture — copy entry points fire INSIDE the
  keydown/click handler stack.

## Task overview

| # | Task | Files |
|---|---|---|
| 1 | Context menu host + `RightClick` feature | `interaction/contextMenu/host.ts` (new), `interaction/contextMenu/types.ts` (new), `interaction/features/rightClick.ts` (new), `featureChain.ts`, `cgrid.ts`, tests |
| 2 | Default menu items registry (Copy / Copy with Headers / Paste / Cut / Export / Autosize / Pin / Reset Columns) | `interaction/contextMenu/defaults.ts` (new), `cgrid.ts`, tests |
| 3 | Clipboard copy — Ctrl+C + worker TSV pass + `clipboardDelimiter` | `worker/passes/clipboardPass.ts` (new), worker protocol, `cgrid.ts`, `interaction/features/keyboardShortcuts.ts` (new or extended), tests, E2E |
| 4 | Clipboard paste — Ctrl+V + worker parse + `applyTransaction` apply | `worker/passes/clipboardPass.ts`, `cgrid.ts`, `interaction/features/keyboardShortcuts.ts`, tests, E2E |
| 5 | Cut + `processCellForClipboard` + `processCellFromClipboard` callbacks | `worker/passes/clipboardPass.ts`, `cgrid.ts`, tests, E2E |
| 6 | Suppress options (`suppressClipboardPaste`, `suppressClipboardApi`, `suppressContextMenu`) | `cgrid.ts`, `types.ts`, tests |
| 7 | Cycle 10 exit ritual — FM Area 19 flips, demo polish, worklog Shipped + status | `docs/catalog/FEATURE_MATRIX.md`, worklog, demo |

---

## Task 1 — Context menu host + `RightClick` feature

**Goal:** A DOM portal that mounts a menu over the canvas in response to
a `contextmenu` event, plus the input-chain feature that dispatches it.
The menu reads its items from `CGridOptions.getContextMenuItems(params)`
when provided, otherwise from the default registry seeded in Task 2.
This task delivers the empty-but-correct surface — Task 2 fills in the
defaults.

**Read first:**
- `cgrid/src/interaction/filters/filterPopupHost.ts` — mount/unmount
  pattern + click-outside-to-close behavior to mirror.
- `cgrid/src/interaction/featureChain.ts` — chain shape; where the
  new `RightClick` feature appends.
- `cgrid/src/interaction/feature.ts` — `CGridLike` surface — adds the
  `openContextMenu` + `closeContextMenu` methods.

**Files:**
- Create: `cgrid/src/interaction/contextMenu/types.ts` — `MenuItem`,
  `GetContextMenuItemsParams`, `MenuItemAction`.
- Create: `cgrid/src/interaction/contextMenu/host.ts` — `ContextMenuHost`
  class with `open(items, x, y)` / `close()` / `isOpen()` methods.
- Create: `cgrid/src/interaction/features/rightClick.ts` — `RightClick`
  feature: `oncontextmenu` → resolve params → call
  `ctx.grid.openContextMenu(items, x, y)`.
- Modify: `cgrid/src/interaction/featureChain.ts` — append `RightClick`
  ahead of `OnHover` (tail).
- Modify: `cgrid/src/cgrid.ts` — `openContextMenu` / `closeContextMenu`
  wiring + the `getContextMenuItems` option read.
- Modify: `cgrid/src/types.ts` — `CGridOptions.getContextMenuItems`,
  `MenuItem` exports.
- Modify: `cgrid/src/interaction/feature.ts` — extend `CGridLike` with
  `openContextMenu` + `closeContextMenu`.
- Create: `cgrid/tests/contextMenuHost.test.ts`.

**Interface produced:**

```ts
// interaction/contextMenu/types.ts
export interface MenuItem {
  /** Display label. `'---'` (or `name === '---'`) renders a horizontal rule. */
  name: string;
  /** Icon HTML or unicode char. Optional. */
  icon?: string;
  /** Click handler. */
  action?: (params: GetContextMenuItemsParams) => void;
  /** Disabled items render dim + skip the action. */
  disabled?: boolean;
  /** Nested items render a submenu on hover. */
  subMenu?: MenuItem[];
}

export interface GetContextMenuItemsParams {
  /** Row index under the cursor (null when the right-click hit the header / scrollbar). */
  rowIndex: number | null;
  /** ColId under the cursor (null when the hit isn't a body cell). */
  colId: string | null;
  /** Current cell-range selection (Cycle 9). */
  ranges: SelectionRange[];
  /** The default item list — apps mix-and-match into a custom list. */
  defaultItems: MenuItem[];
}

// types.ts — CGridOptions extension
getContextMenuItems?: (params: GetContextMenuItemsParams) => MenuItem[];
```

**Steps:**

- [ ] **Step 1:** Failing `contextMenuHost.test.ts`. Assertions:
      - `open([], 10, 20)` mounts a `div.cg-context-menu` at `(10, 20)`.
      - Clicking outside closes the menu (mousedown-on-document handler).
      - Pressing Escape closes the menu.
      - `close()` removes the DOM node + `isOpen()` returns false.
      - `open([{ name: 'A', action: spy }])` renders one item; clicking
        it invokes `action` + closes the menu.
      - Separator items (`name: '---'`) render as `<hr>`.
      - Disabled items don't fire `action`.
- [ ] **Step 2:** Implement `ContextMenuHost`. Single root div, positioned
      `fixed` at `(x, y)` clamped to viewport.
- [ ] **Step 3:** Implement `RightClick` feature. Hit-test the
      `contextmenu` event point, build `GetContextMenuItemsParams`,
      call `ctx.grid.openContextMenu(items, x, y)`. `event.preventDefault()`
      so the native menu doesn't fire.
- [ ] **Step 4:** Wire `openContextMenu` / `closeContextMenu` on `CGrid`.
      Resolution order: explicit `getContextMenuItems(params)` >
      empty `[]` (when no defaults registered yet — Task 2 plugs in).
- [ ] **Step 5:** Typecheck + unit tests green. Append `RightClick` to
      the feature chain.
- [ ] **Step 6:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Right-clicking a body cell calls `getContextMenuItems({rowIndex, colId, ranges, defaultItems})`.
- [ ] `defaultItems` is `[]` (Task 2 populates it).
- [ ] Menu mounts at the cursor; click-outside or Escape closes it.
- [ ] Separator (`name: '---'`) renders as `<hr>`; disabled items render
      dim + skip action.
- [ ] Unit tests green.

**Commit message:**

```
feat(cgrid): context menu host + RightClick feature + getContextMenuItems option

Cycle 10 / Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-10-clipboard.md` and execute Task 2."

---

## Task 2 — Default menu items registry

**Goal:** Implement the 8 default items so apps that don't supply
`getContextMenuItems` still see a working menu, and apps that DO get
a `defaultItems` list to mix in.

Defaults: `Copy`, `Copy with Headers`, `Paste`, `Cut`, `Export`,
`Autosize Columns`, `Pin Column Left / Right / Clear`, `Reset Columns`.
The `Copy`, `Paste`, `Cut` items stub the clipboard call sites that
Tasks 3–5 implement (initially: log + no-op); the rest call existing
Cycle 6 / 8 API methods.

**Read first:**
- `cgrid/src/cgrid.ts` — `autoSizeAllColumns`, `resetColumnState`,
  `setColumnPinned` / `resetColumnPinned` (whichever exist) — defaults
  call these directly.
- `cgrid/src/interaction/contextMenu/types.ts` — `MenuItem` shape.

**Files:**
- Create: `cgrid/src/interaction/contextMenu/defaults.ts` —
  `buildDefaultMenuItems(grid, params): MenuItem[]`.
- Modify: `cgrid/src/cgrid.ts` — pass the default list as `defaultItems`
  into `getContextMenuItems(params)`; fall back to `defaultItems` when
  the option isn't set.
- Create: `cgrid/tests/contextMenuDefaults.test.ts`.

**Steps:**

- [ ] **Step 1:** Failing `contextMenuDefaults.test.ts`. Assertions:
      - `buildDefaultMenuItems` returns 8 items + 2 separators.
      - `Copy`, `Paste`, `Cut` actions exist and don't throw when
        called (stub for now).
      - `Autosize Columns` action calls `grid.autoSizeAllColumns()`.
      - `Reset Columns` action calls `grid.resetColumnState()`.
      - `Pin Column` opens a submenu with `Left` / `Right` / `Clear`.
      - When no `getContextMenuItems` is set, opening the menu uses
        the default list directly.
- [ ] **Step 2:** Implement `buildDefaultMenuItems`. Stub Copy/Paste/Cut
      with `console.debug('[clipboard]')` placeholders that Tasks 3–5
      replace.
- [ ] **Step 3:** Wire the fallback in `cgrid.ts.openContextMenu`.
- [ ] **Step 4:** Typecheck + unit tests green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Default menu shows 8 items (Copy, Copy with Headers, Paste, Cut,
      Export, Autosize Columns, Pin Column ►, Reset Columns) with
      separators between logical groups.
- [ ] Autosize / Reset / Pin actions wire to existing grid methods.
- [ ] Apps can call `defaultItems.filter(...)` to skip items, or
      concat their own.
- [ ] Unit tests green.

**Commit message:**

```
feat(cgrid): default context-menu items (Copy/Paste/Cut/Autosize/Pin/Reset/Export)

Cycle 10 / Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-10-clipboard.md` and execute Task 3."

---

## Task 3 — Clipboard copy (Ctrl+C + worker TSV pass + `clipboardDelimiter`)

**Goal:** Ctrl+C and the context-menu Copy item serialize the current
`SelectionModel.ranges` to TSV (tab-separated values, RFC 4180-style
quoting for embedded tabs / newlines / quotes) on the worker and
write the result to `navigator.clipboard`. The default delimiter is
`\t`; `CGridOptions.clipboardDelimiter` overrides it.

**Read first:**
- `cgrid/src/worker/dataPipeline.ts` — pass shape (see `ViewportSlicer`,
  `DistinctValuesPass`, `FilterPass`).
- `cgrid/src/worker/messageProtocol.ts` (or equivalent) — request /
  response shape; mirror it for `clipboardSerialize`.
- `cgrid/src/cgrid.ts` — `applyTransaction` (used in Task 4 / 5 for the
  reverse path).

**Files:**
- Create: `cgrid/src/worker/passes/clipboardPass.ts` — `serializeRanges(rows, columnsById, ranges, delimiter): string`.
- Modify: `cgrid/src/worker/dataPipeline.ts` + protocol module —
  `clipboardSerialize(ranges, delimiter)` → `{ tsv: string }`.
- Create or modify: `cgrid/src/interaction/features/keyboardShortcuts.ts` —
  Ctrl+C handler that calls `ctx.grid.copySelectedRangesToClipboard()`.
- Modify: `cgrid/src/cgrid.ts` — `copySelectedRangesToClipboard():
  Promise<void>` (worker call → `navigator.clipboard.writeText`).
- Modify: `cgrid/src/types.ts` — `CGridOptions.clipboardDelimiter`,
  `CGridApi.copySelectedRangesToClipboard`.
- Create: `cgrid/tests/clipboardSerialize.test.ts` — pure TSV-encoding
  tests.
- Create: `apps/cgrid-positions/e2e/cycle10-clipboardCopy.spec.ts` —
  Ctrl+C produces the right TSV via the system clipboard.

**Interface produced:**

```ts
// types.ts
interface CGridOptions {
  clipboardDelimiter?: string; // default '\t'
}
interface CGridApi {
  /** Serializes `selection.ranges` to TSV (or `clipboardDelimiter`)
   *  on the worker, then writes via `navigator.clipboard.writeText`.
   *  Resolves once the clipboard write succeeds; rejects when no range
   *  is selected, when the clipboard API rejects (no user gesture /
   *  insecure context), or when `suppressClipboardApi` is `true`. */
  copySelectedRangesToClipboard(): Promise<void>;
}
```

**Steps:**

- [ ] **Step 1:** Failing `clipboardSerialize.test.ts` — pure-function
      tests for `serializeRanges`:
      - 1×1 range → cell value (no trailing newline).
      - 2×2 range → `a\tb\nc\td`.
      - Embedded tab → cell wrapped in quotes; `"` doubled.
      - Embedded newline → cell wrapped in quotes.
      - Multiple disjoint ranges → joined with two newlines OR (clarify:
        ag-grid pastes ranges separately; we serialize each range as
        its own block + blank line between).
      - Custom delimiter (`,`) round-trips.
      - Performance: 10k × 50 range serializes in < 50 ms (Vitest
        `performance.now()` measurement, soft-fail with `console.warn`
        when over).
- [ ] **Step 2:** Implement `serializeRanges`. Allocate one buffer per
      range; avoid per-cell string concatenation by pushing to a
      string[].
- [ ] **Step 3:** Wire the worker `clipboardSerialize` message.
- [ ] **Step 4:** Implement `cgrid.copySelectedRangesToClipboard`.
- [ ] **Step 5:** Add the Ctrl+C keyboard handler. Must fire on
      keydown (not keyup) so the user-gesture stack is still active
      when `navigator.clipboard.writeText` runs.
- [ ] **Step 6:** Wire the Copy default-menu item to call the API.
- [ ] **Step 7:** E2E `cycle10-clipboardCopy.spec.ts` — seed a 2×2
      range via the API, dispatch `Ctrl+C` on the canvas, read back
      via `navigator.clipboard.readText`, assert TSV shape. Grant
      clipboard permissions in the Playwright context.
- [ ] **Step 8:** Typecheck + unit + E2E green.
- [ ] **Step 9:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Ctrl+C with a range selected writes the correct TSV to
      `navigator.clipboard`.
- [ ] `clipboardDelimiter: ','` produces CSV instead.
- [ ] Cells with embedded `\t` / `\n` / `"` are quoted per RFC 4180.
- [ ] Worker handles the encoding (main thread does only the
      `clipboard.writeText` call).
- [ ] E2E confirms a real clipboard round-trip via Playwright's
      clipboard API.

**Commit message:**

```
feat(cgrid): clipboard copy (Ctrl+C + worker TSV pass + clipboardDelimiter)

Cycle 10 / Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-10-clipboard.md` and execute Task 4."

---

## Task 4 — Clipboard paste (Ctrl+V + worker parse + `applyTransaction`)

**Goal:** Ctrl+V and the context-menu Paste item read text from
`navigator.clipboard`, parse it on the worker (TSV or CSV per
`clipboardDelimiter`), align the parsed grid to the current focused
cell (or the top-left of the first range), and apply via
`applyTransaction({ update: [...] })`.

**Read first:**
- `cgrid/src/cgrid.ts` — existing `applyTransaction({ update: [...] })`
  path (Cycle 9 / Task 5's fill handle uses it).
- `cgrid/src/worker/passes/clipboardPass.ts` (Task 3 product) — extend
  with `deserializeTsv(text, delimiter): string[][]`.

**Files:**
- Modify: `cgrid/src/worker/passes/clipboardPass.ts` — `deserializeTsv`.
- Modify: worker protocol + `dataPipeline.ts` —
  `clipboardDeserialize(text, delimiter)` →
  `{ rows: string[][] }`.
- Modify: `cgrid/src/cgrid.ts` — `pasteFromClipboard(): Promise<void>`.
- Modify: `cgrid/src/interaction/features/keyboardShortcuts.ts` —
  Ctrl+V handler.
- Modify: `cgrid/src/types.ts` — `CGridApi.pasteFromClipboard`.
- Modify: `cgrid/tests/clipboardSerialize.test.ts` — add deserialize
  cases.
- Create: `apps/cgrid-positions/e2e/cycle10-clipboardPaste.spec.ts` —
  programmatic clipboard seed → Ctrl+V → assert cell values updated.

**Interface produced:**

```ts
interface CGridApi {
  /** Reads from `navigator.clipboard.readText`, parses TSV (or
   *  `clipboardDelimiter`) on the worker, and applies as
   *  `applyTransaction({ update: [...] })` rooted at the focused cell.
   *  No-op when the clipboard is empty, when no focused cell exists,
   *  or when `suppressClipboardPaste` is `true`. */
  pasteFromClipboard(): Promise<void>;
}
```

**Steps:**

- [ ] **Step 1:** Failing test cases in `clipboardSerialize.test.ts`:
      - Round-trip: serialize → deserialize → identical 2D array.
      - Quoted cells with embedded tab / newline / quote round-trip.
      - Mixed line endings (`\r\n` / `\n`) parse identically.
      - Trailing newline → no extra empty row.
      - Custom delimiter (`,`) round-trips.
- [ ] **Step 2:** Implement `deserializeTsv` using a small state
      machine (in-cell vs quoted vs separator-or-newline). No regex
      for the perf budget.
- [ ] **Step 3:** Wire `clipboardDeserialize` worker message.
- [ ] **Step 4:** Implement `cgrid.pasteFromClipboard`. Anchor = focused
      cell (`selection.state.focusedRowIndex / focusedColId`); when the
      parsed grid is larger than the focus-anchored band, EXPAND the
      paste to fill (matches ag-grid). Build `update` rows by walking
      the parsed 2D in render-order column slices.
- [ ] **Step 5:** Add the Ctrl+V keyboard handler (keydown + user-
      gesture preserved).
- [ ] **Step 6:** Wire the Paste default-menu item to call the API.
- [ ] **Step 7:** E2E: seed clipboard via `page.evaluate(() =>
      navigator.clipboard.writeText(...))`, dispatch Ctrl+V on the
      canvas, assert via `__cgrid.getCellValue(row, colId)` that the
      target cells took the pasted values.
- [ ] **Step 8:** Typecheck + unit + E2E green.
- [ ] **Step 9:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Ctrl+V with TSV in the clipboard applies values to the cells
      rooted at the focused cell.
- [ ] Quoted cells with embedded tab / newline / quote round-trip.
- [ ] When the parsed grid exceeds the focus band, it pastes into
      sequential rows / cols.
- [ ] No-op when no cell is focused, clipboard is empty, or
      `suppressClipboardPaste === true`.
- [ ] Worker does the parsing; main thread only reads the clipboard.

**Commit message:**

```
feat(cgrid): clipboard paste (Ctrl+V + worker TSV parse + applyTransaction)

Cycle 10 / Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-10-clipboard.md` and execute Task 5."

---

## Task 5 — Cut + `processCellForClipboard` / `processCellFromClipboard`

**Goal:** Cut = copy + clear (writes blank string to source cells via
`applyTransaction`). Adds the two cell-processing callbacks so apps can
transform values on serialize (e.g. `123` → `"$1.23"`) and on parse
(e.g. `"$1.23"` → `1.23`).

**Read first:**
- Task 3 / 4 products.
- `cgrid/src/types.ts` — pattern for callback hooks (see
  `valueFormatter`, `valueParser`, `valueGetter`).

**Files:**
- Modify: `cgrid/src/cgrid.ts` — `cutSelectedRanges(): Promise<void>`.
- Modify: `cgrid/src/interaction/features/keyboardShortcuts.ts` —
  Ctrl+X handler.
- Modify: `cgrid/src/worker/passes/clipboardPass.ts` — invoke the
  callbacks per cell on serialize / parse.
- Modify: `cgrid/src/types.ts` — `CGridOptions.processCellForClipboard`,
  `CGridOptions.processCellFromClipboard`, `CGridApi.cutSelectedRanges`.
- Modify: `cgrid/tests/clipboardSerialize.test.ts` — add callback cases.
- Create: `apps/cgrid-positions/e2e/cycle10-clipboardCut.spec.ts`.

**Interface produced:**

```ts
type ProcessCellForClipboardCallback = (params: {
  value: unknown; node: { rowIndex: number; data: unknown };
  column: { colId: string };
}) => unknown;

type ProcessCellFromClipboardCallback = (params: {
  value: string; node: { rowIndex: number; data: unknown };
  column: { colId: string };
}) => unknown;

interface CGridOptions {
  processCellForClipboard?: ProcessCellForClipboardCallback;
  processCellFromClipboard?: ProcessCellFromClipboardCallback;
}

interface CGridApi {
  /** Copy ranges to clipboard, then clear the source cells via
   *  `applyTransaction({ update: [...with empty values...] })`. */
  cutSelectedRanges(): Promise<void>;
}
```

**Steps:**

- [ ] **Step 1:** Failing unit tests for callback invocation —
      `processCellForClipboard` is called for every serialized cell;
      `processCellFromClipboard` is called for every parsed cell. The
      callbacks run on the **main** thread (not the worker) because
      apps may reference DOM / domain state; the worker pass returns
      a placeholder array that the main-side glue maps through the
      callbacks before `clipboard.writeText` / `applyTransaction`.
- [ ] **Step 2:** Implement `cutSelectedRanges`: call
      `copySelectedRangesToClipboard` → build a clear-update batch
      (one update row per source row, every source colId set to `''`)
      → `applyTransaction({ update: [...] })`.
- [ ] **Step 3:** Wire `processCellForClipboard` into the serialize
      glue. Wire `processCellFromClipboard` into the paste glue.
- [ ] **Step 4:** Add the Ctrl+X keyboard handler.
- [ ] **Step 5:** Wire the Cut default-menu item.
- [ ] **Step 6:** E2E: seed a 2×2 range, Ctrl+X, read clipboard → TSV
      matches; cell values → blank.
- [ ] **Step 7:** Typecheck + unit + E2E green.
- [ ] **Step 8:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Ctrl+X with a range selected writes TSV to clipboard AND clears
      source cells.
- [ ] `processCellForClipboard({ value, node, column })` runs per cell
      on copy / cut.
- [ ] `processCellFromClipboard({ value, node, column })` runs per cell
      on paste.
- [ ] When both copy AND clear-update succeed, cut resolves; when
      either fails, the source cells are left untouched (revert path).

**Commit message:**

```
feat(cgrid): cut + processCellForClipboard / processCellFromClipboard callbacks

Cycle 10 / Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-10-clipboard.md` and execute Task 6."

---

## Task 6 — Suppress options (`suppressClipboardPaste` / `suppressClipboardApi` / `suppressContextMenu`)

**Goal:** Three top-level options to gate the surface area. When set,
each option silently no-ops at the relevant entry point.

| Option | Effect |
|---|---|
| `suppressContextMenu: true` | `RightClick` feature swallows `contextmenu` (no menu, no native menu). |
| `suppressClipboardPaste: true` | Ctrl+V and `pasteFromClipboard` no-op; Paste default item renders disabled. |
| `suppressClipboardApi: true` | All three clipboard methods (copy / paste / cut) reject with a logged warning; keyboard shortcuts no-op. Used by apps that ship their own clipboard layer. |

**Read first:**
- `cgrid/src/cgrid.ts` — the three API methods land in Tasks 3 / 4 / 5;
  this task gates them at the public entry.
- `cgrid/src/interaction/features/rightClick.ts` (Task 1 product) —
  reads `getCellSelectionOptions` / new `getContextMenuSuppressed()`.
- `cgrid/src/interaction/features/keyboardShortcuts.ts` (Tasks 3-5) —
  shortcut handlers gate on `suppressClipboardApi` /
  `suppressClipboardPaste`.

**Files:**
- Modify: `cgrid/src/cgrid.ts` — three short circuits at the public
  API entry points.
- Modify: `cgrid/src/types.ts` — add the three options.
- Modify: `cgrid/src/interaction/features/rightClick.ts` — early-return
  on `suppressContextMenu`.
- Modify: `cgrid/src/interaction/contextMenu/defaults.ts` — Paste item
  is disabled when `suppressClipboardPaste === true`.
- Create: `cgrid/tests/clipboardSuppress.test.ts`.
- Create: `apps/cgrid-positions/e2e/cycle10-clipboardSuppress.spec.ts`.

**Steps:**

- [ ] **Step 1:** Failing tests — each suppress flag short-circuits the
      matching code path; turning the flag off restores behavior.
- [ ] **Step 2:** Implement the three flag reads. Read at event time
      (not at construction) so a runtime `setGridOption` takes effect
      immediately.
- [ ] **Step 3:** Update the Paste default-menu item to show `disabled: true`
      when `suppressClipboardPaste === true`.
- [ ] **Step 4:** Typecheck + unit + E2E green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] `suppressContextMenu` suppresses both the cgrid menu AND the
      browser's native menu (`preventDefault` still fires).
- [ ] `suppressClipboardPaste` disables Ctrl+V and the Paste menu item.
- [ ] `suppressClipboardApi` disables copy / paste / cut entry points
      with a one-time console warn.
- [ ] Runtime `setGridOption` flip works without a reload.

**Commit message:**

```
feat(cgrid): suppressClipboardPaste / suppressClipboardApi / suppressContextMenu

Cycle 10 / Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-10-clipboard.md` and execute Task 7."

---

## Task 7 — Cycle 10 exit ritual (FM flips + demo + worklog close)

**Goal:** Verify every spec line in the master plan's Cycle 10 section
landed, flip the matching FM rows to ✅, polish the demo (a
`getContextMenuItems` example + a Copy/Paste round-trip in the
README), close the worklog with a `## Shipped` section + status
update.

**Read first:**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` —
  Cycle 10 section (master plan, line 345). Tick every spec bullet
  against the merged commits.
- `docs/catalog/FEATURE_MATRIX.md` — Area 19 rows.
- `apps/cgrid-positions/` — demo for the polish step.

**Files:**
- Modify: `docs/catalog/FEATURE_MATRIX.md` — flip Area 19 rows.
- Modify: `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-10-clipboard.md` —
  add `## Shipped` section + `## Cycle 10 status: COMPLETE` block.
- Modify: `apps/cgrid-positions/src/positionsGrid.ts` — wire a sample
  `getContextMenuItems` (5 lines: defaults + a custom "Reset filters"
  entry).
- Modify: `apps/cgrid-positions/README.md` (if it exists) or demo
  banner — note the clipboard / context-menu surface.

**Spec verification checklist (every box MUST be ticked):**
- [ ] **Spec 1 (Context menu host):** Right-click anywhere in grid →
      menu portal opens. `getContextMenuItems(params)` is called with
      `{ rowIndex, colId, ranges, defaultItems }`.
- [ ] **Spec 2 (Default menu items):** Default list = `[Copy, Copy with
      Headers, Paste, Cut, Export, Autosize Columns, Pin Column ►,
      Reset Columns]`. Submenu works for Pin Column.
- [ ] **Spec 3 (Clipboard copy):** Ctrl+C / menu Copy → TSV on the
      worker → `navigator.clipboard.writeText`. `clipboardDelimiter`
      override works.
- [ ] **Spec 4 (Clipboard paste):** Ctrl+V / menu Paste → worker parse
      → `applyTransaction({ update })` rooted at focused cell.
      `processCellForClipboard` + `processCellFromClipboard` fire.
- [ ] **Spec 5 (Cut):** Cut = copy + clear (one transaction). Type
      preserved via the existing `valueSetter` path.
- [ ] **Spec 6 (Suppress options):** `suppressClipboardPaste`,
      `suppressClipboardApi`, `suppressContextMenu` all gate at the
      right entry points + take effect at runtime via `setGridOption`.
- [ ] **Performance gate:** 10k × 50 range copy completes < 100 ms
      wall-clock (Vitest measurement OR a manual demo run logged in
      `## Shipped`).
- [ ] **Demo round-trip:** Right-click a body cell → Copy → switch to
      a spreadsheet → Paste → values land. (Manual verification —
      record in `## Shipped`.)

**Steps:**

- [ ] **Step 1:** Walk through the Spec checklist; for any unticked
      box, file a follow-up patch commit on this same branch BEFORE
      flipping FM rows.
- [ ] **Step 2:** Flip FM rows (`docs/catalog/FEATURE_MATRIX.md`).
- [ ] **Step 3:** Demo polish — `getContextMenuItems` sample +
      `clipboardDelimiter` configurable in the demo header.
- [ ] **Step 4:** Update worklog (`## Shipped` + `## Cycle 10 status:
      COMPLETE`). Mirror the format from
      `2026-06-25-canvasgrid-cycle-09-range-selection.md`.
- [ ] **Step 5:** Full `npm run typecheck --workspaces` + `npm run
      test:cgrid` + `npx playwright test` sweep — record the totals
      in `## Shipped`.
- [ ] **Step 6:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Every Spec checklist box ticked + every Performance gate met.
- [ ] FM Area 19 ≥ 90% flipped to ✅.
- [ ] Worklog has `## Shipped` summary + `## Cycle 10 status: COMPLETE`.
- [ ] Demo right-click → Copy → external paste round-trips.
- [ ] Typecheck, unit tests, E2E suite all green.

**Commit message:**

```
feat(cgrid): rangeSelectionChanged + cellSelectionChanged events + Cycle 10 exit ritual

Cycle 10 / Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Cycle 10 complete — STOP. Do NOT proceed to Cycle 11."

---

## Shipped

_(populated by Task 7)_

---

## Cycle 10 status: IN PROGRESS

_(flipped to `COMPLETE` by Task 7)_
