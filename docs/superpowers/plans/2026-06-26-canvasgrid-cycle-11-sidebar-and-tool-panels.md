# Canvasgrid Cycle 11 — Side bar + tool-panel framework — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Right-edge collapsible **side bar** that hosts one or more
**tool panels**. Ship two built-in panels — **Columns** (visibility,
reorder, row-groups / values / pivot-columns assignment) and **Filters**
(per-column filter list with inline expand) — plus the **registration
API** that lets apps plug in custom panels and the **state API + events**
that let apps drive the side bar programmatically.

**FM coverage:** Area 17 — ~15 of 17 rows flipped to ✅ at cycle exit
(every option in the catalog's `SideBarDef` / `ToolPanelDef` /
`IToolPanelColumnCompParams` / `IToolPanelFiltersCompParams` tables
that's in-scope for a single cycle; deferred items called out in
Task 9's Shipped section).

**Architecture:**

- The side bar is a **DOM panel** — not canvas-painted. It mounts as a
  sibling of the canvas inside `CGrid.root`, with a vertical tab strip
  pinned to the rightmost (or leftmost) edge and a content region
  whose width shrinks the canvas region. Opening / closing the side
  bar triggers exactly **one** `cgridCanvas.resize()` so the canvas
  reflows + repaints; the worker is untouched (data pipeline doesn't
  care about side bar state).
- A **ToolPanel** is a minimal interface mirroring ag-grid's
  `IToolPanelComp`: `init(params)` / `getGui(): HTMLElement` /
  `refresh()` / `destroy()`. Built-in panels register themselves at
  CGrid construction; apps register custom panels via
  `CGridOptions.components: { [id]: ToolPanelComponent }`.
- The **Columns** panel reads from `getColumnState()` (Cycle 6) and
  writes via `applyColumnState()`, so visibility / pin / order changes
  flow through the existing column-state surface. Row-groups / values /
  pivot-columns sections are stubs in Cycle 11 (the underlying grouping
  + pivot land in Cycle 13 / 16); they render the lists + drop zones
  but the drag-into-zone action is a no-op breadcrumb until those
  cycles wire the data path.
- The **Filters** panel reads the column list + each column's active
  filter model (Cycle 7) and renders one collapsible row per column.
  Expanding a row mounts the same filter editor `FilterPopupHost`
  uses, just anchored inside the panel instead of a popup.
- **Pointer routing:** Side bar DOM is `pointer-events: auto`. The
  canvas hit-test reads its own bounds — when the side bar is open
  and shrinks the canvas, `getBoundingClientRect()` already returns
  the reduced width so cell coordinates stay correct. Task 8 audits
  every interaction feature (drag, wheel, edge-zone auto-scroll) to
  confirm no feature reads stale canvas bounds.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E),
single-canvas 2D paint, Web Worker data pipeline. No new runtime
dependencies. The side bar uses plain DOM + CSS Grid for layout;
the tab strip uses inline SVG icons (no icon-font dependency).

**References (READ FIRST when starting any task):**

- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` —
  master plan (Cycle 11 section, line 372).
- `docs/catalog/17-side-bar-and-tool-panels.md` — full surface spec:
  `SideBarDef`, `ToolPanelDef`, `IToolPanelColumnCompParams`,
  `IToolPanelFiltersCompParams`, API methods, events, themes.
- **`docs/catalog/screenshots/17-sidebar-columns-panel-open.png`** —
  canonical Columns panel layout: top "Pivot Mode" toggle, search
  input, checkbox column list with drag handles, "Row Groups" section
  with chip + close buttons, "Values" section with sum(...) chips.
- **`docs/catalog/screenshots/17-sidebar-filters-panel-open.png`** —
  canonical Filters panel layout: search input, vertical column list
  with `>` chevron (collapsed) / `v` chevron (expanded), inline filter
  editor when expanded.
- **ag-grid website fallback** (per the
  `consult-ui-screenshots-before-shipping` memory): when no screenshot
  exists for a sub-surface (e.g. the panel-resize handle hover state,
  the Pivot Mode toggle's chip styling, the drop-zone highlight),
  consult `https://www.ag-grid.com/javascript-data-grid/side-bar/`,
  `https://www.ag-grid.com/javascript-data-grid/tool-panel-columns/`,
  and `https://www.ag-grid.com/javascript-data-grid/tool-panel-filters/`
  for the canonical UI. The local catalog markdown table is the API
  contract; the website pages are the UI contract.
- `docs/catalog/FEATURE_MATRIX.md` — Area 17 rows to flip at cycle
  exit.
- Current source:
  - `cgrid/src/cgrid.ts` — CGrid class; mount point for the side bar
    DOM + the new tool-panel registry.
  - `cgrid/src/core/canvas.ts` — `CGridCanvas` owns the canvas
    `<canvas>` element + resize handling.
  - `cgrid/src/interaction/filters/filterPopupHost.ts` — popup-mount
    pattern + click-outside-to-close behavior; mirror for the side
    bar's resize-handle drag affordance.
  - `cgrid/src/interaction/contextMenu/host.ts` — DOM portal pattern
    (`pointer-events: auto`, `position: fixed/absolute`, click-outside
    listener) — same mechanics for the side bar shell.
  - `cgrid/src/theming/tokens.css` — every `.cg-*` selector lives
    here; side-bar / tool-panel CSS lands here too.
  - `cgrid/src/cgrid.ts:applyColumnState` / `getColumnState` (Cycle 6)
    — the Columns panel reads + writes through these.
- Demo (verification target): `apps/cgrid-positions/` — wire the
  side bar with both built-in panels in `positionsGrid.ts`.

## Global Constraints

Apply to **every task** (extend the constraints from Cycles 2–10).

- **API parity, not API mimicry.** Field names mirror ag-grid verbatim:
  `sideBar`, `SideBarDef`, `ToolPanelDef`, `toolPanels`,
  `defaultToolPanel`, `hiddenByDefault`, `position`, `hideButtons`, `id`,
  `labelDefault`, `labelKey`, `iconKey`, `toolPanel`, `toolPanelParams`,
  `minWidth`, `maxWidth`, `width`, `parent`,
  `suppressColumnMove`, `suppressRowGroups`, `suppressValues`,
  `suppressPivots`, `suppressPivotMode`, `suppressColumnFilter`,
  `suppressColumnSelectAll`, `suppressColumnExpandAll`,
  `contractColumnSelection`, `suppressSyncLayoutWithGrid`,
  `suppressExpandAll`, `suppressFilterSearch`,
  `allowDragFromColumnsToolPanel`,
  `isSideBarVisible`, `setSideBarVisible`, `setSideBarPosition`,
  `openToolPanel`, `closeToolPanel`, `getOpenedToolPanel`,
  `getSideBar`, `refreshToolPanel`, `getToolPanelInstance`,
  `toolPanelVisibleChanged`, `sideBarVisibleChanged`.
- **No regressions in the public API.** Every option / API / event /
  worker-protocol addition is purely additive.
- **TypeScript strict.** `npm run typecheck --workspaces` clean every task.
- **No worker round-trip for side bar paint.** The side bar is pure
  main-thread DOM. The Columns panel reads / writes column state via
  the existing main-side API.
- **`alpha: false` canvas, DPR-aware paint, native scrollbars** — unchanged.
- **Vitest + Playwright green at the end of every task.**
- **E2E gate is REQUIRED for every UI task.** Per the
  `consult-ui-screenshots-before-shipping` memory, unit tests alone
  don't catch visual regressions; a side bar that mounts but renders
  blank because of missing CSS would still pass unit tests.
- **Conventional commits.** Body footer carries cycle prefix
  (e.g. `feat(cgrid): tool-panel registry + ToolPanel interface\n\nCycle 11 / Task 1.`).
- **Branch per task + PR per task.** Each task: branch off main as
  `batch/cycle-11-task-N-<YYYY-MM-DD>`, commit, push, open PR to main.
  The autonomous runner expects this and merges each PR before
  spawning the next session.
- **Demo never breaks.** `apps/cgrid-positions` runs green at every
  commit. E2E specs use `?stress=light` opt-in for the heavy stream.
- **CSS rules MUST ship with class names.** Any `.cg-side-bar-*` /
  `.cg-tool-panel-*` selector added by a task MUST have matching
  rules in `cgrid/src/theming/tokens.css`. A worklog that ships
  classes without rules is the exact bug pattern from Cycle 10 / PR #29.
- **Visual verification step REQUIRED.** Every task that mounts DOM
  MUST render in the demo (via Chrome DevTools MCP or equivalent)
  and the agent MUST compare a screenshot to the reference image
  before claiming done.

## Task overview

| # | Task | Files | Reference |
|---|---|---|---|
| 1 | `ToolPanel` interface + registry (built-ins + custom) | `interaction/toolPanels/types.ts` (new), `interaction/toolPanels/registry.ts` (new), `cgrid.ts`, `types.ts`, tests | Catalog `ToolPanelDef`, ag-grid `/component-tool-panel/` |
| 2 | Side bar shell — DOM mount, tab strip, resize handle, position toggle | `interaction/sideBar/host.ts` (new), `cgrid.ts`, `core/canvas.ts` (resize hook), `theming/tokens.css`, tests, E2E | Both 17-* screenshots; ag-grid `/side-bar/` |
| 3 | Columns tool panel | `interaction/toolPanels/columnsPanel.ts` (new), `theming/tokens.css`, tests, E2E | `17-sidebar-columns-panel-open.png`; ag-grid `/tool-panel-columns/` |
| 4 | Filters tool panel | `interaction/toolPanels/filtersPanel.ts` (new), `theming/tokens.css`, tests, E2E | `17-sidebar-filters-panel-open.png`; ag-grid `/tool-panel-filters/` |
| 5 | Custom panel API (`refreshToolPanel`, `getToolPanelInstance`) | `cgrid.ts`, `types.ts`, tests, E2E | Catalog API table |
| 6 | Side bar state API (`isSideBarVisible`, `setSideBarVisible`, `setSideBarPosition`, `openToolPanel`, `closeToolPanel`, `getOpenedToolPanel`, `getSideBar`) | `cgrid.ts`, `types.ts`, tests | Catalog API table |
| 7 | Side bar events (`toolPanelVisibleChanged`, `sideBarVisibleChanged`) | `cgrid.ts`, `types.ts`, tests, E2E | Catalog events table |
| 8 | DOM-canvas coexistence audit — pointer routing, canvas resize, edge-zone auto-scroll (Cycle 9 patch) interplay | `interaction/featureChain.ts`, `interaction/features/rangeSelection.ts`, `core/canvas.ts`, tests, E2E | None — pure interaction audit |
| 9 | Cycle 11 exit ritual — FM Area 17 flips, demo polish, worklog `## Shipped` + status | `docs/catalog/FEATURE_MATRIX.md`, worklog, `apps/cgrid-positions/src/positionsGrid.ts` | None |

---

## Task 1 — `ToolPanel` interface + registry

**Goal:** A minimal, ag-grid-shaped `ToolPanel` interface and a registry
that maps `id → ToolPanelComponent`. Built-in IDs `agColumnsToolPanel`
and `agFiltersToolPanel` get registered at CGrid construction; apps
register custom panels via `CGridOptions.components`.

**Read first:**
- `docs/catalog/17-side-bar-and-tool-panels.md` — `ToolPanelDef`,
  `IToolPanelComp`, params types.
- `cgrid/src/interaction/contextMenu/host.ts` — pattern for a
  pure-DOM main-thread component (init / mount / destroy lifecycle).
- ag-grid website fallback: `https://www.ag-grid.com/javascript-data-grid/component-tool-panel/`
  for the canonical `IToolPanelComp` signature.

**Files:**
- Create: `cgrid/src/interaction/toolPanels/types.ts` — `ToolPanel`
  interface, `ToolPanelComponent` constructor signature,
  `ToolPanelParams` shape, `IToolPanelColumnCompParams`,
  `IToolPanelFiltersCompParams`.
- Create: `cgrid/src/interaction/toolPanels/registry.ts` —
  `ToolPanelRegistry` class with `register(id, ctor)`, `resolve(id)`,
  `instantiate(id, params)`.
- Modify: `cgrid/src/cgrid.ts` — instantiate the registry at
  construction, seed with `'agColumnsToolPanel'` /
  `'agFiltersToolPanel'` placeholders (real implementations land in
  Tasks 3 + 4 — Task 1 ships an empty `getGui()` stub so the API
  surface is testable).
- Modify: `cgrid/src/types.ts` — add `components` option,
  `ToolPanelDef` / `SideBarDef` interface declarations.
- Create: `cgrid/tests/toolPanelRegistry.test.ts`.

**Interface produced:**

```ts
// interaction/toolPanels/types.ts
export interface ToolPanelParams<TGrid = unknown> {
  /** The CGrid API surface available to the panel — column state,
   *  filter model, selection, event emitter. Typed as `unknown` here
   *  to avoid a circular dep; panels cast to `CGridApi`. */
  api: TGrid;
  /** App-supplied `toolPanelParams` from `ToolPanelDef`. */
  toolPanelParams?: Record<string, unknown>;
}

export interface ToolPanel {
  /** One-shot setup. Receives params; should NOT yet append to the
   *  DOM — `getGui()` returns the root for the host to mount. */
  init(params: ToolPanelParams): void;
  /** The panel's root element. Stable for the lifetime of the
   *  instance; the host mounts it once and never re-queries. */
  getGui(): HTMLElement;
  /** Re-render from current grid state. Called when the host fires
   *  `refreshToolPanel(id)` or when underlying state changes
   *  (column model, filter model). */
  refresh(): void;
  /** Tear down listeners + DOM. */
  destroy(): void;
}

export type ToolPanelComponent = new () => ToolPanel;

// types.ts — CGridOptions extension
interface CGridOptions<TRow = unknown> {
  /** Registry of custom tool-panel components, keyed by panel ID.
   *  Built-ins `'agColumnsToolPanel'` + `'agFiltersToolPanel'` are
   *  pre-registered; apps override or add new IDs here. */
  components?: Record<string, ToolPanelComponent>;
}

export interface ToolPanelDef {
  id: string;
  labelDefault: string;
  labelKey?: string;
  iconKey?: string;
  toolPanel: string;
  toolPanelParams?: Record<string, unknown>;
  minWidth?: number;
  maxWidth?: number;
  width?: number;
}

export interface SideBarDef {
  toolPanels: (ToolPanelDef | string)[];
  defaultToolPanel?: string;
  hiddenByDefault?: boolean;
  position?: 'left' | 'right';
  hideButtons?: boolean;
}
```

**Steps:**

- [ ] **Step 1:** Failing `toolPanelRegistry.test.ts`. Assertions:
      - `register('foo', class { init...getGui...refresh...destroy })`
        + `resolve('foo')` returns the ctor.
      - `instantiate('foo', params)` calls `init(params)` and returns
        the instance; `getGui()` is a DOM element.
      - `resolve('unknown-id')` returns `null`.
      - Built-in IDs `'agColumnsToolPanel'` + `'agFiltersToolPanel'`
        are pre-registered (Task 1 ships empty stubs; Tasks 3 + 4
        replace them).
      - `register(id, ctor)` for an existing built-in ID overrides
        it (apps override defaults).
- [ ] **Step 2:** Implement `ToolPanelRegistry` (one Map<string, ctor>,
      three methods).
- [ ] **Step 3:** Wire registry into CGrid constructor. Read
      `options.components` (default: `{}`) and call `registry.register`
      for each entry.
- [ ] **Step 4:** Typecheck + unit tests green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] `ToolPanel` interface exported from cgrid's root index.
- [ ] `ToolPanelComponent`, `ToolPanelDef`, `SideBarDef` types exported.
- [ ] Built-in IDs registered at construction (with stub impls).
- [ ] `CGridOptions.components` accepted; entries override built-ins.
- [ ] All unit tests green.

**Commit message:**

```
feat(cgrid): ToolPanel interface + registry + components option

Cycle 11 / Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md` and execute Task 2."

---

## Task 2 — Side bar shell (DOM mount, tab strip, resize handle, position)

**Goal:** A DOM panel that mounts on the right (or left) edge of the
grid, with a vertical tab strip (one button per registered tool
panel), a content region that hosts the active panel's `getGui()`,
and a vertical resize handle on the inner edge for the user to drag
the panel wider / narrower. Opening / closing the side bar triggers
one `cgridCanvas.resize()` so the canvas reflows.

**Read first:**
- **REFERENCE SCREENSHOTS (both must be open before starting):**
  - `docs/catalog/screenshots/17-sidebar-columns-panel-open.png` —
    note the vertical tab strip on the rightmost edge (icons +
    rotated text labels "Columns", "Filters"), the open panel
    width (~280 px), and how it sits FLUSH against the grid's
    right edge with no gap.
  - `docs/catalog/screenshots/17-sidebar-filters-panel-open.png` —
    same tab strip; different panel content.
- `docs/catalog/17-side-bar-and-tool-panels.md` — `SideBarDef`,
  `ToolPanelDef`, theme variables (`$side-bar-panel-width`).
- ag-grid website fallback: `https://www.ag-grid.com/javascript-data-grid/side-bar/`
  for the canonical resize-handle hover affordance and the tab
  button hover / active states.
- `cgrid/src/interaction/contextMenu/host.ts` — DOM portal +
  click-outside pattern (lighter relevance here since side bar
  doesn't auto-close).
- `cgrid/src/core/canvas.ts` — `resize()` + `bounds` for the
  canvas-region shrink wiring.

**Files:**
- Create: `cgrid/src/interaction/sideBar/host.ts` — `SideBarHost`
  class:
  - `constructor(root: HTMLElement, grid: CGridLike, def: SideBarDef)`.
  - Builds three DOM regions: tab strip (`.cg-side-bar-tabs`),
    panel content host (`.cg-side-bar-panel`), resize handle
    (`.cg-side-bar-resize`).
  - `openPanel(id: string)`, `closePanel()`,
    `getOpenedToolPanelId(): string | null`.
  - `setVisible(show: boolean)` — toggles the whole side bar.
  - `setPosition(pos: 'left' | 'right')` — re-mounts on the other
    edge.
  - `destroy()`.
- Modify: `cgrid/src/cgrid.ts` — instantiate `SideBarHost` at
  construction when `options.sideBar` resolves to a truthy
  `SideBarDef`. Honor `hiddenByDefault`, `defaultToolPanel`,
  `position`.
- Modify: `cgrid/src/core/canvas.ts` — expose a `setHostBounds`
  hook so `SideBarHost` can shrink the canvas region.
- Modify: `cgrid/src/theming/tokens.css` — add the side bar CSS
  (see "CSS required" below).
- Create: `cgrid/tests/sideBarHost.test.ts`.
- Create: `apps/cgrid-positions/e2e/cycle11-sideBar.spec.ts`.

**CSS required (matches the reference screenshots):**

```css
.cg-side-bar {
  display: flex;
  flex-direction: row-reverse; /* tabs on the OUTER edge */
  background: var(--cg-bg-color);
  border-left: 1px solid var(--cg-border-color);
  height: 100%;
}
.cg-side-bar[data-position="left"] {
  flex-direction: row;
  border-left: none;
  border-right: 1px solid var(--cg-border-color);
}
.cg-side-bar-tabs {
  display: flex;
  flex-direction: column;
  width: 28px;
  background: var(--cg-header-bg);
  border-left: 1px solid var(--cg-border-color);
}
.cg-side-bar-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80px;
  cursor: pointer;
  writing-mode: vertical-rl;
  /* icon above label (separate spans) */
}
.cg-side-bar-tab[aria-pressed="true"] {
  background: var(--cg-bg-color);
}
.cg-side-bar-panel {
  flex: 1 1 auto;
  min-width: var(--cg-side-bar-min-width, 100px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.cg-side-bar-resize {
  width: 3px;
  cursor: col-resize;
  background: transparent;
}
.cg-side-bar-resize:hover {
  background: var(--cg-focus-ring-color);
}
```

**Steps:**

- [ ] **Step 1:** Failing `sideBarHost.test.ts`. Assertions:
      - `new SideBarHost(root, grid, { toolPanels: ['columns',
        'filters'], position: 'right' })` mounts a `.cg-side-bar`
        element inside `root` with two tab buttons.
      - `openPanel('agColumnsToolPanel')` adds
        `aria-pressed="true"` to the matching tab + mounts the
        panel's `getGui()` inside `.cg-side-bar-panel`.
      - `closePanel()` removes the panel + clears `aria-pressed`.
      - `setPosition('left')` re-mounts on the opposite edge
        (`data-position` attribute flips).
      - `setVisible(false)` hides the side bar (`display: none`
        on the root); `setVisible(true)` restores it.
      - `destroy()` removes all DOM + listeners.
- [ ] **Step 2:** Build `SideBarHost`. Tab buttons render with
      `iconKey` (use unicode glyphs for now — `☰` for columns,
      `▼` for filters — until Cycle 11.5 adds proper SVG icons).
      Each tab button's `aria-label` uses `labelDefault`.
- [ ] **Step 3:** Resize handle: `mousedown` captures
      `e.clientX` and starts a window-level mousemove that updates
      `panel.style.width` (clamped to `minWidth` / `maxWidth`).
      `mouseup` ends the drag. NO debounce — direct width updates
      feel responsive.
- [ ] **Step 4:** Wire `SideBarHost` → `cgridCanvas.resize()` on
      open / close / resize-handle-drag so the canvas region
      shrinks correctly.
- [ ] **Step 5:** Demo wiring: add `sideBar: { toolPanels:
      ['columns', 'filters'], defaultToolPanel: 'columns' }` to
      the positions demo so visual verification has a target.
- [ ] **Step 6:** Visual verify via Chrome DevTools MCP — open
      both panels in the demo, compare screenshots to both
      `17-sidebar-*-panel-open.png` references. The tab strip
      width, panel background, border placement, and overall
      proportions MUST match.
- [ ] **Step 7:** E2E `cycle11-sideBar.spec.ts`:
      - Side bar mounts at the right edge of the grid.
      - Clicking the "Columns" tab opens the panel; clicking it
        again closes.
      - Clicking the "Filters" tab opens that panel (closes
        Columns first — only one panel open at a time).
      - Setting `position: 'left'` re-mounts on the opposite edge.
      - Dragging the resize handle changes the panel width and
        the canvas region shrinks correspondingly.
- [ ] **Step 8:** Typecheck + full `npm run test:cgrid` + full
      `npx playwright test` green.
- [ ] **Step 9:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Side bar mounts; tabs render with the registered panel labels.
- [ ] Opening / closing / switching panels works.
- [ ] Side bar respects `position` (left or right edge).
- [ ] Resize handle works; canvas region updates on resize.
- [ ] `hiddenByDefault` starts the side bar collapsed.
- [ ] `defaultToolPanel` opens that panel on mount.
- [ ] Browser screenshots match the reference images.

**Commit message:**

```
feat(cgrid): side bar shell (tab strip + panel host + resize handle + position toggle)

Cycle 11 / Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md` and execute Task 3."

---

## Task 3 — Columns tool panel

**Goal:** The `agColumnsToolPanel` built-in. Renders every column as a
row with a checkbox (visibility) + drag handle (reorder) + icon +
label. Sections below the column list: Pivot Mode toggle, Row Groups,
Values, Column Labels (pivot). Search input filters the list by
column name. Honors the suppress flags from `IToolPanelColumnCompParams`.

**Read first:**
- **REFERENCE SCREENSHOT (must be open before starting):**
  `docs/catalog/screenshots/17-sidebar-columns-panel-open.png` — the
  Pivot Mode toggle at top, search input with magnifier glyph,
  checkbox column list with `⋮⋮` drag handles, "Row Groups" section
  showing `[≡] Desk [×]` and `[≡] Region [×]` chips, "Values"
  section showing `[≡] sum(Notional) [×]` and `[≡] sum(Market Value)
  [×]` chips. Note the section headers are inline-rendered with
  `Σ` / `=` icons. The currently-checked vs unchecked rows have
  identical typography (no dimming on the unchecked rows beyond the
  checkbox state).
- `docs/catalog/17-side-bar-and-tool-panels.md` —
  `IToolPanelColumnCompParams` table for the seven suppress flags +
  `buttons`, `contractColumnSelection`, `suppressSyncLayoutWithGrid`.
- ag-grid website fallback: `https://www.ag-grid.com/javascript-data-grid/tool-panel-columns/`
  for the drop-zone hover state when a column is dragged into "Row
  Groups" / "Values" (Cycle 11 ships the drop zones inert — drag-
  into-zone is a no-op until Cycle 13 grouping lands).
- `cgrid/src/cgrid.ts` — `getColumnState()`, `applyColumnState()`,
  `setColumnVisible()`, `moveColumns()` from Cycle 6.

**Files:**
- Create: `cgrid/src/interaction/toolPanels/columnsPanel.ts` —
  `ColumnsToolPanel` class implementing `ToolPanel`.
- Modify: `cgrid/src/cgrid.ts` — register `ColumnsToolPanel` for
  `'agColumnsToolPanel'` (replaces the Task 1 stub).
- Modify: `cgrid/src/theming/tokens.css` — add the panel CSS.
- Create: `cgrid/tests/columnsToolPanel.test.ts`.
- Create: `apps/cgrid-positions/e2e/cycle11-columnsPanel.spec.ts`.

**Steps:**

- [ ] **Step 1:** Failing `columnsToolPanel.test.ts`. Assertions:
      - `init({ api })` + `getGui()` returns a root with the search
        input, Pivot Mode toggle, column list, and three section
        headers (Row Groups, Values, Column Labels).
      - Column list reflects `getColumnState()` order; checkboxes
        reflect each column's `hide` state.
      - Toggling a checkbox calls `api.setColumnVisible(colId, show)`.
      - Search input filters the list by label substring.
      - `suppressColumnFilter: true` hides the search input.
      - `suppressRowGroups: true` hides the Row Groups section.
      - `suppressPivotMode: true` hides the Pivot Mode toggle.
      - `refresh()` re-reads `getColumnState()` and rebuilds the
        list (used when external code mutates column state).
- [ ] **Step 2:** Implement `ColumnsToolPanel`. Build the DOM tree
      once in `init`; `refresh()` walks the row list and updates
      checkbox + label without rebuilding the tree (to preserve
      scroll position).
- [ ] **Step 3:** Listen for `columnVisible` + `columnMoved` events
      from the grid; call `refresh()` on each to keep the panel in
      sync (unless `suppressSyncLayoutWithGrid: true`).
- [ ] **Step 4:** Row drag handle (`⋮⋮`): mousedown + window mousemove
      reorders within the list; mouseup commits via
      `api.moveColumns([colId], newIndex)`. `suppressColumnMove: true`
      disables this. (The drag-INTO-grid path is Cycle 13's
      `allowDragFromColumnsToolPanel`; this task only handles drag-
      within-panel.)
- [ ] **Step 5:** Pivot Mode toggle: a horizontal switch at the top.
      Wires to `api.setPivotMode(boolean)`. The `setPivotMode` API
      lands in Cycle 16; for Cycle 11, the toggle calls a stub that
      logs `console.debug('[pivot] mode toggle (stub — wired in
      Cycle 16)')` so the visual is right.
- [ ] **Step 6:** Visual verify via Chrome DevTools MCP — render the
      panel in the demo, compare to
      `17-sidebar-columns-panel-open.png`. Tab strip on the right
      edge, panel layout, section spacing, chip styling MUST match.
- [ ] **Step 7:** E2E:
      - Open Columns panel; verify list shows all demo columns.
      - Uncheck a column; verify it disappears from the grid.
      - Type in search; verify list filters.
      - Reorder via drag handle; verify column order changes.
      - `suppressColumnFilter: true` hides the search.
- [ ] **Step 8:** Typecheck + full unit + E2E green.
- [ ] **Step 9:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Panel shows every column with checkbox + label + drag handle.
- [ ] Visibility toggles propagate to the grid.
- [ ] Search filter narrows the list.
- [ ] Reorder via drag commits via `moveColumns`.
- [ ] All seven suppress flags work.
- [ ] Screenshot matches reference.

**Commit message:**

```
feat(cgrid): Columns tool panel (visibility, reorder, sections, search)

Cycle 11 / Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md` and execute Task 4."

---

## Task 4 — Filters tool panel

**Goal:** The `agFiltersToolPanel` built-in. Renders every column
that has a filter as a collapsible row (`> ColumnName`). Clicking
the row expands it inline + mounts the column's filter editor (the
SAME editor that `FilterPopupHost` uses for popup mode, just
parented inside the panel). Honors `suppressExpandAll`,
`suppressFilterSearch`, `suppressSyncLayoutWithGrid`.

**Read first:**
- **REFERENCE SCREENSHOT (must be open before starting):**
  `docs/catalog/screenshots/17-sidebar-filters-panel-open.png` —
  search input at top, vertical list of every column with a `>`
  chevron on the LEFT of each row indicating collapsed; expanding
  rotates the chevron to `v`. The expanded row reveals the column's
  filter editor INLINE (no popup). Note the alphabetical ordering
  in the reference matches column definition order (no resort).
- ag-grid website fallback: `https://www.ag-grid.com/javascript-data-grid/tool-panel-filters/`
  for the expand-all chevron icon behavior + the empty-state
  rendering when no columns have filters.
- `cgrid/src/interaction/filters/filterPopupHost.ts` — for the
  filter-editor-mount pattern (reuse the existing editor
  components, don't re-implement).
- `cgrid/src/interaction/filters/setFilter.ts`,
  `cgrid/src/interaction/filters/textFilter.ts`,
  `cgrid/src/interaction/filters/numberFilter.ts`,
  `cgrid/src/interaction/filters/dateFilter.ts`,
  `cgrid/src/interaction/filters/multiCondition.ts` — the editor
  components themselves (Cycle 7 product).

**Files:**
- Create: `cgrid/src/interaction/toolPanels/filtersPanel.ts` —
  `FiltersToolPanel` class implementing `ToolPanel`.
- Modify: `cgrid/src/cgrid.ts` — register `FiltersToolPanel` for
  `'agFiltersToolPanel'`.
- Modify: `cgrid/src/theming/tokens.css` — add the panel CSS.
- Create: `cgrid/tests/filtersToolPanel.test.ts`.
- Create: `apps/cgrid-positions/e2e/cycle11-filtersPanel.spec.ts`.

**Steps:**

- [ ] **Step 1:** Failing `filtersToolPanel.test.ts`. Assertions:
      - Panel renders one collapsible row per column with a filter.
      - Clicking a row expands it; chevron flips from `>` to `v`.
      - Expanded row mounts the column's filter editor inline.
      - Filter changes propagate (the same way the popup editor
        propagates — via `setFilterModel`).
      - `suppressFilterSearch: true` hides the search input.
      - `suppressExpandAll: true` hides the expand/collapse-all
        button at the top.
- [ ] **Step 2:** Implement `FiltersToolPanel`. Each row is a `<div
      class="cg-filters-panel-row">`. Clicking toggles a per-row
      `data-expanded="true"` attribute + mounts the filter editor.
- [ ] **Step 3:** Filter editor reuse: factor out the
      filter-component-construction logic from `FilterPopupHost` if
      not already factored — both the popup and the panel call the
      same factory. Cycle 7's `FilterPopupHost.openFilter(colId)`
      already does this work; expose a `buildFilterComponent(colId,
      mountPoint)` helper for the panel to call.
- [ ] **Step 4:** Search input: filters the row list by column label
      substring.
- [ ] **Step 5:** Expand-all / collapse-all button at top: toggles
      every row's expanded state in one call.
- [ ] **Step 6:** Visual verify via Chrome DevTools MCP — render the
      panel, compare to `17-sidebar-filters-panel-open.png`. Row
      spacing, chevron placement, search-input width MUST match.
- [ ] **Step 7:** E2E:
      - Open Filters panel; verify rows for every filterable column.
      - Expand a row; verify the editor mounts inline.
      - Type a filter value in the inline editor; verify the grid
        filters.
      - Search input filters the row list.
      - Expand-all button expands every row.
- [ ] **Step 8:** Typecheck + unit + E2E green.
- [ ] **Step 9:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Panel shows one collapsible row per filterable column.
- [ ] Expand reveals the inline filter editor.
- [ ] Editor mutations propagate to the grid filter model.
- [ ] Search + expand-all + suppress flags work.
- [ ] Screenshot matches reference.

**Commit message:**

```
feat(cgrid): Filters tool panel (collapsible rows + inline filter editors)

Cycle 11 / Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md` and execute Task 5."

---

## Task 5 — Custom panel API

**Goal:** Two API methods that let apps interact with mounted tool
panels: `refreshToolPanel(id)` re-renders a specific panel;
`getToolPanelInstance(id)` returns the live `ToolPanel` instance so
apps can call panel-specific methods (e.g. a custom panel might
expose `expandAll()`).

**Read first:**
- `docs/catalog/17-side-bar-and-tool-panels.md` — API table for the
  two methods.
- Cycle 11 Task 1 product (`ToolPanel` interface).

**Files:**
- Modify: `cgrid/src/cgrid.ts` — `refreshToolPanel(id)` calls
  `instance.refresh()` if the panel is currently mounted; no-op
  otherwise. `getToolPanelInstance(id)` returns the live instance
  or `null`.
- Modify: `cgrid/src/types.ts` — add to `CGridApi`.
- Modify: `cgrid/tests/cgrid.integration.test.ts` — add cases for
  both methods.
- Create: `apps/cgrid-positions/e2e/cycle11-customPanelApi.spec.ts`
  — register a custom panel in the demo via `components: { 'my-panel':
  MyPanel }`, mount it, call `refreshToolPanel('my-panel')`, verify
  the panel's `refresh()` ran (via a side-channel counter).

**Steps:**

- [ ] **Step 1:** Failing unit tests + E2E.
- [ ] **Step 2:** Implement both methods. The SideBarHost owns the
      mounted-instances map; the API forwards through.
- [ ] **Step 3:** Typecheck + unit + E2E green.
- [ ] **Step 4:** Commit + push + PR.

**Acceptance criteria:**
- [ ] `refreshToolPanel(id)` calls the instance's `refresh()`.
- [ ] `getToolPanelInstance(id)` returns the instance or null.
- [ ] Both work for built-in AND custom panels.

**Commit message:**

```
feat(cgrid): refreshToolPanel + getToolPanelInstance API

Cycle 11 / Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md` and execute Task 6."

---

## Task 6 — Side bar state API

**Goal:** Programmatic control of the side bar's visibility, position,
and which panel is open. Seven methods on `CGridApi`:
`isSideBarVisible`, `setSideBarVisible`, `setSideBarPosition`,
`openToolPanel`, `closeToolPanel`, `getOpenedToolPanel`, `getSideBar`.

**Read first:**
- `docs/catalog/17-side-bar-and-tool-panels.md` — API methods table.

**Files:**
- Modify: `cgrid/src/cgrid.ts` — implement the seven methods
  forwarding to `SideBarHost`.
- Modify: `cgrid/src/types.ts` — add to `CGridApi`.
- Modify: `cgrid/tests/cgrid.integration.test.ts` — cases for all
  seven methods.

**Steps:**

- [ ] **Step 1:** Failing tests covering each method.
- [ ] **Step 2:** Implement each method on CGrid:
      - `isSideBarVisible()` returns the SideBarHost's visibility
        state.
      - `setSideBarVisible(show)` calls
        `SideBarHost.setVisible(show)`.
      - `setSideBarPosition(pos)` calls
        `SideBarHost.setPosition(pos)`.
      - `openToolPanel(id)` calls `SideBarHost.openPanel(id)`.
      - `closeToolPanel()` calls `SideBarHost.closePanel()`.
      - `getOpenedToolPanel()` returns
        `SideBarHost.getOpenedToolPanelId()`.
      - `getSideBar()` returns the resolved `SideBarDef` (or
        `undefined` when no side bar was configured).
- [ ] **Step 3:** No-op gracefully when no side bar is configured
      (apps can call `setSideBarVisible(true)` on a grid without
      `sideBar` set — it's a silent no-op, not a throw).
- [ ] **Step 4:** Typecheck + unit green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] All seven methods exist on `CGridApi` with the signatures
      from the catalog.
- [ ] Methods are no-ops when no side bar is configured.
- [ ] Each method matches the SideBarHost behavior 1:1.

**Commit message:**

```
feat(cgrid): side bar state API (visibility / position / open-panel)

Cycle 11 / Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md` and execute Task 7."

---

## Task 7 — Side bar events

**Goal:** Two events on the grid emitter:
`toolPanelVisibleChanged` fires when a panel opens or closes
(`{ source: 'api' | 'sideBarButtonClicked' | 'sideBarInitializing',
key: string | null, visible: boolean }`); `sideBarVisibleChanged`
fires when the whole side bar shows or hides
(`{ source: 'api' | 'sideBarButtonClicked', visible: boolean }`).

**Read first:**
- `docs/catalog/22-events.md` — event union shape for cgrid;
  pattern to mirror.
- `docs/catalog/17-side-bar-and-tool-panels.md` — events table.

**Files:**
- Modify: `cgrid/src/types.ts` — extend `CGridEvent` union with
  the two new events.
- Modify: `cgrid/src/cgrid.ts` — emit from SideBarHost callbacks.
- Modify: `cgrid/src/interaction/sideBar/host.ts` — add an emit
  callback to the constructor; fire on open / close / show / hide.
- Create: `cgrid/tests/sideBarEvents.test.ts`.
- Create: `apps/cgrid-positions/e2e/cycle11-sideBarEvents.spec.ts`.

**Steps:**

- [ ] **Step 1:** Failing tests asserting each event fires with the
      right payload on each source.
- [ ] **Step 2:** Wire the emit callback.
- [ ] **Step 3:** Source tagging: `'sideBarInitializing'` fires on
      mount when `defaultToolPanel` is set; `'api'` fires from API
      calls; `'sideBarButtonClicked'` fires from tab clicks.
- [ ] **Step 4:** Typecheck + unit + E2E green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Both events fire with correct payloads on each trigger.
- [ ] `source` tag is accurate (api / click / init).
- [ ] No events fire when no side bar is configured.

**Commit message:**

```
feat(cgrid): toolPanelVisibleChanged + sideBarVisibleChanged events

Cycle 11 / Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md` and execute Task 8."

---

## Task 8 — DOM-canvas coexistence audit

**Goal:** Confirm every interaction feature works correctly when the
side bar is open + shrinks the canvas region. Specifically: pointer
events, drag, wheel, edge-zone auto-scroll (Cycle 9 patch / Task 2),
context menu positioning, filter popup positioning. Add an E2E
regression matrix that exercises each interaction with the side bar
both closed AND open.

**Read first:**
- `cgrid/src/interaction/featureChain.ts` — `toLocal()` reads
  `canvas.getBoundingClientRect()`; verify it returns the SHRUNK
  bounds when the side bar is open.
- `cgrid/src/interaction/features/rangeSelection.ts` — `getBodyRect`
  + `computeAutoScrollDelta`; the edge zone is computed in canvas-
  local coords, so a shrunk canvas means the right-edge zone is at
  the new `bodyRight`, not the old.
- `cgrid/src/interaction/contextMenu/host.ts` — menu positions
  `fixed` at viewport coords; the canvas shrink doesn't affect
  those, but verify the menu still clamps inside the visible
  viewport (not under the side bar).
- `cgrid/src/core/canvas.ts` — `resize()` flow; confirm one resize
  per side-bar-open / close.

**Files:**
- Possibly modify (if the audit finds bugs):
  `cgrid/src/interaction/featureChain.ts`,
  `cgrid/src/interaction/features/rangeSelection.ts`,
  `cgrid/src/core/canvas.ts`.
- Create: `apps/cgrid-positions/e2e/cycle11-sideBarCoexistence.spec.ts`
  — exercises:
  - Cell click works with side bar open.
  - Range drag works with side bar open.
  - Edge-zone auto-scroll triggers on the SHRUNK right edge (not
    the absolute canvas right edge).
  - Wheel scroll works without the side bar consuming the wheel
    event.
  - Context menu mounts at the cursor (not under the side bar).
  - Filter popup mounts visible (not under the side bar).
  - Side bar resize handle drag doesn't propagate into the canvas
    feature chain.

**Steps:**

- [ ] **Step 1:** Write the regression matrix as a single E2E spec
      that loops through `[sideBarClosed, sideBarOpen]` and runs
      each interaction. Land the spec as FAILING first to confirm
      the audit catches real bugs.
- [ ] **Step 2:** For each failure, file the smallest possible
      fix. Don't over-engineer — most likely the canvas already
      handles this correctly via `getBoundingClientRect()`.
- [ ] **Step 3:** Re-run the matrix until every interaction is
      green in both side-bar states.
- [ ] **Step 4:** Typecheck + full unit + E2E green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Every interaction in the regression matrix works with side
      bar both closed AND open.
- [ ] Edge-zone auto-scroll fires at the SHRUNK canvas right edge.
- [ ] No interaction reads stale canvas bounds.

**Commit message:**

```
test(cgrid): DOM-canvas coexistence audit (side bar interplay)

Cycle 11 / Task 8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md` and execute Task 9."

---

## Task 9 — Cycle 11 exit ritual

**Goal:** Verify every spec line in the master plan's Cycle 11 section
landed, flip the matching FM Area 17 rows, polish the demo (sample
custom panel + sidebar configuration in `positionsGrid.ts`), and
close the worklog with a `## Shipped` section + status update.

**Read first:**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` —
  Cycle 11 section. Tick every bullet against merged commits.
- `docs/catalog/FEATURE_MATRIX.md` — Area 17 rows.
- `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-10-clipboard.md` —
  Task 7 from Cycle 10 for the exit-ritual format to mirror.

**Files:**
- Modify: `docs/catalog/FEATURE_MATRIX.md` — flip Area 17 rows.
- Modify: `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md`
  — add `## Shipped` section + `## Cycle 11 status: COMPLETE` block.
- Modify: `apps/cgrid-positions/src/positionsGrid.ts` — sample
  `sideBar` config + a tiny custom panel demo to show the
  registration path.

**Spec verification checklist (every box MUST be ticked):**
- [ ] **Spec 1 (Tool panel base + registry):** `ToolPanel` interface
      + `components` option + registry; built-in IDs registered.
- [ ] **Spec 2 (Side bar shell):** DOM mount at right or left edge,
      tab strip, panel host, resize handle. `sideBar` option
      accepts `SideBarDef | string | string[] | boolean`.
- [ ] **Spec 3 (Columns tool panel):** Checkboxes (visibility), drag
      handles (reorder), Pivot Mode toggle, sections (Row Groups,
      Values, Column Labels), search, all seven suppress flags.
- [ ] **Spec 4 (Filters tool panel):** Collapsible rows per column,
      inline filter editor on expand, search, expand-all, suppress
      flags.
- [ ] **Spec 5 (Custom panel API):** `refreshToolPanel`,
      `getToolPanelInstance` work for built-in + custom panels.
- [ ] **Spec 6 (Side bar state API):** Seven methods all wired.
- [ ] **Spec 7 (Side bar events):** Both events fire on each
      trigger with correct `source`.
- [ ] **Spec 8 (DOM-canvas coexistence):** Regression matrix all
      green with side bar both states.
- [ ] **Performance gate:** Opening / closing the side bar triggers
      exactly ONE `canvas.resize()`. No measurable scroll-FPS impact
      with side bar open.
- [ ] **Visual gate:** Demo screenshot with both panels open matches
      `17-sidebar-columns-panel-open.png` AND
      `17-sidebar-filters-panel-open.png`.

**Steps:**

- [ ] **Step 1:** Walk the Spec checklist; file follow-up patch
      commits for any unticked box BEFORE flipping FM rows.
- [ ] **Step 2:** Flip FM Area 17 rows.
- [ ] **Step 3:** Demo polish — `positionsGrid.ts` gets a `sideBar`
      config that opens Columns by default + registers a tiny
      custom panel as a registration example.
- [ ] **Step 4:** Update worklog (`## Shipped` + `## Cycle 11
      status: COMPLETE`). Mirror Cycle 10's exit-ritual format.
- [ ] **Step 5:** Full `npm run typecheck --workspaces` +
      `npm run test:cgrid` + `npx playwright test` sweep — record
      totals in `## Shipped`.
- [ ] **Step 6:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Every Spec checklist box ticked.
- [ ] FM Area 17 ≥ 90% flipped to ✅.
- [ ] Worklog has `## Shipped` summary + `COMPLETE` status.
- [ ] Demo screenshots match references.

**Commit message:**

```
feat(cgrid): Cycle 11 exit ritual (FM Area 17 flips + demo polish + worklog close)

Cycle 11 / Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Cycle 11 complete — STOP. Do NOT proceed to Cycle 12."

---

## Shipped

_(populated by Task 9)_

---

## Cycle 11 status: IN PROGRESS

_(flipped to `COMPLETE` by Task 9)_
