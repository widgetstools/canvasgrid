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
  sibling of the canvas inside `VelocityGrid.root`, with a vertical tab strip
  pinned to the rightmost (or leftmost) edge and a content region
  whose width shrinks the canvas region. Opening / closing the side
  bar triggers exactly **one** `cgridCanvas.resize()` so the canvas
  reflows + repaints; the worker is untouched (data pipeline doesn't
  care about side bar state).
- A **ToolPanel** is a minimal interface mirroring ag-grid's
  `IToolPanelComp`: `init(params)` / `getGui(): HTMLElement` /
  `refresh()` / `destroy()`. Built-in panels register themselves at
  VelocityGrid construction; apps register custom panels via
  `VelocityGridOptions.components: { [id]: ToolPanelComponent }`.
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
  - `cgrid/src/velocityGrid.ts` — VelocityGrid class; mount point for the side bar
    DOM + the new tool-panel registry.
  - `cgrid/src/core/canvas.ts` — `VelocityGridCanvas` owns the canvas
    `<canvas>` element + resize handling.
  - `cgrid/src/interaction/filters/filterPopupHost.ts` — popup-mount
    pattern + click-outside-to-close behavior; mirror for the side
    bar's resize-handle drag affordance.
  - `cgrid/src/interaction/contextMenu/host.ts` — DOM portal pattern
    (`pointer-events: auto`, `position: fixed/absolute`, click-outside
    listener) — same mechanics for the side bar shell.
  - `cgrid/src/theming/tokens.css` — every `.vg-*` selector lives
    here; side-bar / tool-panel CSS lands here too.
  - `cgrid/src/velocityGrid.ts:applyColumnState` / `getColumnState` (Cycle 6)
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
- **CSS rules MUST ship with class names.** Any `.vg-side-bar-*` /
  `.vg-tool-panel-*` selector added by a task MUST have matching
  rules in `cgrid/src/theming/tokens.css`. A worklog that ships
  classes without rules is the exact bug pattern from Cycle 10 / PR #29.
- **Visual verification step REQUIRED.** Every task that mounts DOM
  MUST render in the demo (via Chrome DevTools MCP or equivalent)
  and the agent MUST compare a screenshot to the reference image
  before claiming done.

## Task overview

| # | Task | Files | Reference |
|---|---|---|---|
| 1 | `ToolPanel` interface + registry (built-ins + custom) | `interaction/toolPanels/types.ts` (new), `interaction/toolPanels/registry.ts` (new), `velocityGrid.ts`, `types.ts`, tests | Catalog `ToolPanelDef`, ag-grid `/component-tool-panel/` |
| 2 | Side bar shell — DOM mount, tab strip, resize handle, position toggle | `interaction/sideBar/host.ts` (new), `velocityGrid.ts`, `core/canvas.ts` (resize hook), `theming/tokens.css`, tests, E2E | Both 17-* screenshots; ag-grid `/side-bar/` |
| 3 | Columns tool panel | `interaction/toolPanels/columnsPanel.ts` (new), `theming/tokens.css`, tests, E2E | `17-sidebar-columns-panel-open.png`; ag-grid `/tool-panel-columns/` |
| 4 | Filters tool panel | `interaction/toolPanels/filtersPanel.ts` (new), `theming/tokens.css`, tests, E2E | `17-sidebar-filters-panel-open.png`; ag-grid `/tool-panel-filters/` |
| 5 | Custom panel API (`refreshToolPanel`, `getToolPanelInstance`) | `velocityGrid.ts`, `types.ts`, tests, E2E | Catalog API table |
| 6 | Side bar state API (`isSideBarVisible`, `setSideBarVisible`, `setSideBarPosition`, `openToolPanel`, `closeToolPanel`, `getOpenedToolPanel`, `getSideBar`) | `velocityGrid.ts`, `types.ts`, tests | Catalog API table |
| 7 | Side bar events (`toolPanelVisibleChanged`, `sideBarVisibleChanged`) | `velocityGrid.ts`, `types.ts`, tests, E2E | Catalog events table |
| 8 | DOM-canvas coexistence audit — pointer routing, canvas resize, edge-zone auto-scroll (Cycle 9 patch) interplay | `interaction/featureChain.ts`, `interaction/features/rangeSelection.ts`, `core/canvas.ts`, tests, E2E | None — pure interaction audit |
| 9 | Cycle 11 exit ritual — FM Area 17 flips, demo polish, worklog `## Shipped` + status | `docs/catalog/FEATURE_MATRIX.md`, worklog, `apps/cgrid-positions/src/positionsGrid.ts` | None |

---

## Task 1 — `ToolPanel` interface + registry

**Goal:** A minimal, ag-grid-shaped `ToolPanel` interface and a registry
that maps `id → ToolPanelComponent`. Built-in IDs `agColumnsToolPanel`
and `agFiltersToolPanel` get registered at VelocityGrid construction; apps
register custom panels via `VelocityGridOptions.components`.

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
- Modify: `cgrid/src/velocityGrid.ts` — instantiate the registry at
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
  /** The VelocityGrid API surface available to the panel — column state,
   *  filter model, selection, event emitter. Typed as `unknown` here
   *  to avoid a circular dep; panels cast to `VelocityGridApi`. */
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

// types.ts — VelocityGridOptions extension
interface VelocityGridOptions<TRow = unknown> {
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
- [ ] **Step 3:** Wire registry into VelocityGrid constructor. Read
      `options.components` (default: `{}`) and call `registry.register`
      for each entry.
- [ ] **Step 4:** Typecheck + unit tests green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] `ToolPanel` interface exported from cgrid's root index.
- [ ] `ToolPanelComponent`, `ToolPanelDef`, `SideBarDef` types exported.
- [ ] Built-in IDs registered at construction (with stub impls).
- [ ] `VelocityGridOptions.components` accepted; entries override built-ins.
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
  - `constructor(root: HTMLElement, grid: VelocityGridLike, def: SideBarDef)`.
  - Builds three DOM regions: tab strip (`.vg-side-bar-tabs`),
    panel content host (`.vg-side-bar-panel`), resize handle
    (`.vg-side-bar-resize`).
  - `openPanel(id: string)`, `closePanel()`,
    `getOpenedToolPanelId(): string | null`.
  - `setVisible(show: boolean)` — toggles the whole side bar.
  - `setPosition(pos: 'left' | 'right')` — re-mounts on the other
    edge.
  - `destroy()`.
- Modify: `cgrid/src/velocityGrid.ts` — instantiate `SideBarHost` at
  construction when `options.sideBar` resolves to a truthy
  `SideBarDef`. Honor `hiddenByDefault`, `defaultToolPanel`,
  `position`.
- Modify: `cgrid/src/core/canvas.ts` — expose a `setHostBounds`
  hook so `SideBarHost` can shrink the canvas region.
- Modify: `cgrid/src/theming/tokens.css` — add the side bar CSS
  (see "CSS required" below).
- Create: `cgrid/tests/sideBarHost.test.ts`.
- Create: `apps/cgrid-positions/e2e/cycle11-sideBar.spec.ts`.

**Tab strip layout (user reference, 2026-06-26 — canonical for the
collapsed state too):**

```
                        ┌──┐
                        │  │  ← whole side bar is just the tab
                        │  │     strip when no panel is open
                        │📊│  ← Columns icon (table-with-side-rail
                        │  │     glyph; SVG preferred over unicode)
                        │C │  ← rotated label "Columns"
                        │o │     reading top → bottom (writing-mode:
                        │l │     vertical-rl)
                        │u │
                        │m │
                        │n │
                        │s │
                        │  │
                        │▽│  ← Filters icon (funnel glyph)
                        │  │
                        │F │
                        │i │
                        │l │
                        │t │
                        │e │
                        │r │
                        │s │
                        └──┘
```

When a tab is ACTIVE (its panel is open), the tab gets:
- A **3 px blue left border** (`border-left: 3px solid var(--vg-focus-ring-color)`)
  flush against the panel content — this is the most distinctive
  visual cue and MUST be present.
- A slightly lifted background (`var(--vg-bg-color)` vs the strip's
  `var(--vg-header-bg)`) so the active tab visually merges into the
  open panel.

Tab hover (non-active): background lifts to
`color-mix(in srgb, var(--vg-header-bg) 80%, var(--vg-bg-color) 20%)`.

**CSS required (matches the reference screenshots + the user's
2026-06-26 tab-strip layout):**

```css
.vg-side-bar {
  display: flex;
  flex-direction: row-reverse; /* tabs on the OUTER edge */
  background: var(--vg-bg-color);
  border-left: 1px solid var(--vg-border-color);
  height: 100%;
}
.vg-side-bar[data-position="left"] {
  flex-direction: row;
  border-left: none;
  border-right: 1px solid var(--vg-border-color);
}
.vg-side-bar-tabs {
  display: flex;
  flex-direction: column;
  width: 28px;
  background: var(--vg-header-bg);
  border-left: 1px solid var(--vg-border-color);
}
.vg-side-bar-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80px;
  cursor: pointer;
  writing-mode: vertical-rl;
  /* icon above label (separate spans) */
}
.vg-side-bar-tab[aria-pressed="true"] {
  background: var(--vg-bg-color);
  /* User reference 2026-06-26 — active tab gets a blue left-border
   * indicator (3 px), the most distinctive cue that "this panel is
   * open". Placed on the left because the tab strip sits at the
   * RIGHT edge of the grid; the border faces the open panel. */
  border-left: 3px solid var(--vg-focus-ring-color);
}
.vg-side-bar[data-position="left"] .vg-side-bar-tab[aria-pressed="true"] {
  /* Mirror the border to the right edge when the side bar is on
   * the LEFT side of the grid. */
  border-left: none;
  border-right: 3px solid var(--vg-focus-ring-color);
}
.vg-side-bar-tab:hover {
  background: color-mix(in srgb, var(--vg-header-bg) 80%, var(--vg-bg-color) 20%);
}
.vg-side-bar-panel {
  flex: 1 1 auto;
  min-width: var(--vg-side-bar-min-width, 100px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.vg-side-bar-resize {
  width: 3px;
  cursor: col-resize;
  background: transparent;
}
.vg-side-bar-resize:hover {
  background: var(--vg-focus-ring-color);
}
```

**Steps:**

- [ ] **Step 1:** Failing `sideBarHost.test.ts`. Assertions:
      - `new SideBarHost(root, grid, { toolPanels: ['columns',
        'filters'], position: 'right' })` mounts a `.vg-side-bar`
        element inside `root` with two tab buttons.
      - `openPanel('agColumnsToolPanel')` adds
        `aria-pressed="true"` to the matching tab + mounts the
        panel's `getGui()` inside `.vg-side-bar-panel`.
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
- **REFERENCE SCREENSHOTS (open before starting):**
  - `docs/catalog/screenshots/17-sidebar-columns-panel-open.png` (the
    legacy reference — uses a lighter teal-on-white theme; useful for
    layout but the dark-theme spec below overrides colour choices).
  - **User-supplied target (2026-06-26, dark theme):** described in
    full ASCII layout below — the actual UI shape to ship.
- `docs/catalog/17-side-bar-and-tool-panels.md` —
  `IToolPanelColumnCompParams` table for the seven suppress flags +
  `buttons`, `contractColumnSelection`, `suppressSyncLayoutWithGrid`.
- ag-grid website fallback:
  `https://www.ag-grid.com/javascript-data-grid/tool-panel-columns/`
  for the drop-zone hover state and any sub-surface the screenshot
  doesn't capture.
- `cgrid/src/velocityGrid.ts` — `getColumnState()`, `applyColumnState()`,
  `setColumnVisible()`, `moveColumns()` from Cycle 6.

**Target layout (user reference, 2026-06-26 — dark theme, the
canonical UI for this task):**

```
┌─────────────────────────────────────────────┐ ┐
│ ⬤━━━━  Pivot Mode                            │ │  Top section
├─────────────────────────────────────────────┤ ┘
│ 🔍  Search...                                │ ┐
├─────────────────────────────────────────────┤ │  Column list
│ ☑  ⋮⋮⋮  Athlete                              │ │  (scrollable
│ ☑  ⋮⋮⋮  Age                                  │ │   region)
│ ☑  ⋮⋮⋮  Country                              │ │
│ ☑  ⋮⋮⋮  Year                                 │ │
│ ☑  ⋮⋮⋮  Date                                 │ │
│ ☑  ⋮⋮⋮  Gold                                 │ │
│ ☑  ⋮⋮⋮  Silver                               │ │
│ ☑  ⋮⋮⋮  Bronze                               │ │
│ ☑  ⋮⋮⋮  Total                                │ │
├─────────────────────────────────────────────┤ ┘
│ ≡  Row Groups                                │ ┐
│ ┌────────────────────────────────────────┐  │ │  Row Groups
│ │ Drag here to set row groups            │  │ │  drop zone
│ └────────────────────────────────────────┘  │ ┘  (dashed border)
├─────────────────────────────────────────────┤
│ Σ  Values                                    │ ┐
│ ┌────────────────────────────────────────┐  │ │  Values
│ │ Drag here to aggregate                 │  │ │  drop zone
│ └────────────────────────────────────────┘  │ ┘  (dashed border)
└─────────────────────────────────────────────┘
```

**Element-level requirements** (each MUST land in this task):

1. **Pivot Mode toggle (top row):** A pill-shaped switch on the LEFT
   of the row, label "Pivot Mode" on the right. Off state =
   grey track with the knob on the left; on state = filled track
   with the knob on the right. Click toggles. Hidden when
   `suppressPivotMode: true`.
2. **Search input:** Full-width text input with a magnifier icon
   inside on the left. Placeholder "Search...". Typing filters the
   column list below by colId / headerName substring (case-insensitive).
   Hidden when `suppressColumnFilter: true`.
3. **Column rows:** One row per visible column from `getColumnState()`.
   Each row contains, left → right:
   - A `<input type="checkbox">` reflecting the column's `hide`
     state (checked = visible, unchecked = hidden). Toggle calls
     `api.setColumnVisible(colId, show)`.
   - A 6-dot drag handle (`⋮⋮⋮` rendered as 2 columns × 3 dots,
     not the 2-dot ⋮⋮ glyph) for reorder. `cursor: grab` on hover,
     `cursor: grabbing` during drag. Hidden when
     `suppressColumnMove: true`.
   - The column's `headerName` (or `colId` when no header name).
4. **Row Groups section:** Section header `≡ Row Groups` (the icon
   is the "horizontal lines" glyph U+2630 or an inline SVG). Below
   the header, a drop zone container with `border: 1px dashed
   var(--vg-border-color)`, `border-radius: 4px`, padding ~12 px,
   centred placeholder text "Drag here to set row groups" in
   muted colour. Cycle 11 ships the drop zone INERT — drop is a
   no-op stub that logs `console.debug('[groups] drop (stub —
   wired in Cycle 13)')`. Hidden when `suppressRowGroups: true`.
5. **Values section:** Same structure as Row Groups but header is
   `Σ Values` and placeholder text is "Drag here to aggregate".
   Hidden when `suppressValues: true`.
6. **No "Column Labels" / pivot section in Cycle 11.** The catalog
   lists it but pivot lands in Cycle 16; ship Row Groups + Values
   only to match the target screenshot.

**Theme:** Dark — background `var(--vg-bg-color)` (which the demo
resolves to the slate-navy), text `var(--vg-fg-color)` (off-white),
border `var(--vg-border-color)`, drop-zone dashed border same colour
at 60% opacity. The checkbox uses the existing
`var(--vg-focus-ring-color)` blue when checked, hollow square when
unchecked (system checkbox `accent-color: var(--vg-focus-ring-color)`
is acceptable — no custom checkbox component).

**Files:**
- Create: `cgrid/src/interaction/toolPanels/columnsPanel.ts` —
  `ColumnsToolPanel` class implementing `ToolPanel`.
- Modify: `cgrid/src/velocityGrid.ts` — register `ColumnsToolPanel` for
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
- **REFERENCE SCREENSHOTS (open before starting):**
  - `docs/catalog/screenshots/17-sidebar-filters-panel-open.png`
    (legacy reference — useful for row layout).
  - **User-supplied target (2026-06-26, dark theme):** described in
    full ASCII layout below — the canonical UI for this task.
- ag-grid website fallback:
  `https://www.ag-grid.com/javascript-data-grid/tool-panel-filters/`
  for expand-all chevron behaviour + empty-state when no columns
  have filters.
- `cgrid/src/interaction/filters/filterPopupHost.ts` — for the
  filter-editor-mount pattern. **REUSE** the existing editor
  components — don't re-implement.
- `cgrid/src/interaction/filters/setFilter.ts`,
  `cgrid/src/interaction/filters/textFilter.ts`,
  `cgrid/src/interaction/filters/numberFilter.ts`,
  `cgrid/src/interaction/filters/dateFilter.ts`,
  `cgrid/src/interaction/filters/multiCondition.ts` — the editor
  components themselves (Cycle 7 product).

**Target layout (user reference, 2026-06-26 — dark theme,
canonical UI):**

Collapsed state (every row collapsed):
```
┌──────────────────────────────────────────┐
│ 🔍  Search...                             │
├──────────────────────────────────────────┤
│ >  Athlete                                │
│ >  Age                                    │
│ >  Country                                │
│ >  Year                                   │
│ >  Date                                   │
│ >  Gold                                   │
│ >  Silver                                 │
│ >  Bronze                                 │
│ >  Total                                  │
└──────────────────────────────────────────┘
```

One row expanded (e.g. Country, a set-filter column):
```
┌──────────────────────────────────────────┐
│ 🔍  Search...                             │
├──────────────────────────────────────────┤
│ >  Athlete                                │
│ >  Age                                    │
│ v  Country                                │
│ ┌────────────────────────────────────┐   │
│ │ 🔍  Search...                       │   │  ← per-filter
│ │ ☑  (Select All)                     │   │     search input
│ │ ☑  Afghanistan                      │   │     (set-filter)
│ │ ☑  Algeria                          │   │
│ │ ☑  Argentina                        │   │
│ │ ☑  Armenia                          │   │
│ │ ☑  Australia                        │   │
│ │ ... (scrollable)                    │   │
│ └────────────────────────────────────┘   │
│ >  Year                                   │
│ >  Date                                   │
└──────────────────────────────────────────┘
```

**Element-level requirements** (each MUST land in this task):

1. **Top-level search input:** Magnifier glyph on the LEFT,
   placeholder "Search...". Typing filters the column-row list by
   `headerName` / `colId` substring (case-insensitive). Hidden when
   `suppressFilterSearch: true`.
2. **Column rows:** One row per FILTERABLE column from the column
   model. Each row contains, left → right:
   - A chevron — `>` when collapsed, `v` (or `⌄`) when expanded.
     The chevron is the click target; clicking ANYWHERE on the row
     also toggles. `cursor: pointer` on hover.
   - The column's `headerName` (or `colId`).
3. **Expanded state:** Below the chevron row, the column's existing
   filter editor mounts INLINE inside a nested container with a
   subtle border. The editor is the SAME component used by
   `FilterPopupHost` — for set-filter columns this means a per-
   filter search input + `(Select All)` checkbox + scrollable value
   list with one checkbox per distinct value. For text/number/date
   columns it's the matching condition + value inputs. Changes
   propagate to `setFilterModel(colId, model)` exactly as the popup
   editor does.
4. **Expand-all button at top:** A small button between the search
   input and the row list with the `≡` glyph or a "double chevron"
   that toggles every row's expanded state. Hidden when
   `suppressExpandAll: true`.
5. **Empty state:** When NO column has a filter configured, the
   panel renders centred placeholder text "No filterable columns"
   in muted colour instead of an empty list.
6. **Reuse the popup-editor factory.** Factor out
   `FilterPopupHost`'s "build the filter component for colId" logic
   into a `buildFilterComponent(colId, mountPoint)` helper if it
   isn't already factored. Both the popup AND the panel call the
   same helper so a bug fixed in one path is fixed in both.

**Theme:** Dark — same tokens as Task 3 (Columns panel). The chevron
uses `var(--vg-fg-color)` at 70% opacity (muted but legible). The
expanded-editor container has `background:
color-mix(in srgb, var(--vg-bg-color) 90%, white 10%)` (slightly
lifted from the panel background) and a thin `var(--vg-border-color)`
border.

**Files:**
- Create: `cgrid/src/interaction/toolPanels/filtersPanel.ts` —
  `FiltersToolPanel` class implementing `ToolPanel`.
- Modify: `cgrid/src/velocityGrid.ts` — register `FiltersToolPanel` for
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
      class="vg-filters-panel-row">`. Clicking toggles a per-row
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
- Modify: `cgrid/src/velocityGrid.ts` — `refreshToolPanel(id)` calls
  `instance.refresh()` if the panel is currently mounted; no-op
  otherwise. `getToolPanelInstance(id)` returns the live instance
  or `null`.
- Modify: `cgrid/src/types.ts` — add to `VelocityGridApi`.
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
and which panel is open. Seven methods on `VelocityGridApi`:
`isSideBarVisible`, `setSideBarVisible`, `setSideBarPosition`,
`openToolPanel`, `closeToolPanel`, `getOpenedToolPanel`, `getSideBar`.

**Read first:**
- `docs/catalog/17-side-bar-and-tool-panels.md` — API methods table.

**Files:**
- Modify: `cgrid/src/velocityGrid.ts` — implement the seven methods
  forwarding to `SideBarHost`.
- Modify: `cgrid/src/types.ts` — add to `VelocityGridApi`.
- Modify: `cgrid/tests/cgrid.integration.test.ts` — cases for all
  seven methods.

**Steps:**

- [ ] **Step 1:** Failing tests covering each method.
- [ ] **Step 2:** Implement each method on VelocityGrid:
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
- [ ] All seven methods exist on `VelocityGridApi` with the signatures
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
- Modify: `cgrid/src/types.ts` — extend `VelocityGridEvent` union with
  the two new events.
- Modify: `cgrid/src/velocityGrid.ts` — emit from SideBarHost callbacks.
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

**`ToolPanel` interface + registry.** A `ToolPanel = { init / getGui /
refresh / destroy }` contract mirrors ag-grid's `IToolPanelComp`
verbatim. `ToolPanelRegistry` maps panel `id` → constructor; built-in
ids `'agColumnsToolPanel'` and `'agFiltersToolPanel'` register at
VelocityGrid construction. `VelocityGridOptions.components: Record<string,
ToolPanelComponent>` lets apps register custom panels or override the
built-ins, and the registry resolves the user-supplied entry last so
overrides always win. `ToolPanelDef` and `SideBarDef` ship as exported
types with the catalog field names verbatim (`id`, `labelDefault`,
`labelKey`, `iconKey`, `toolPanel`, `toolPanelParams`, `minWidth`,
`maxWidth`, `width` / `toolPanels`, `defaultToolPanel`,
`hiddenByDefault`, `position`, `hideButtons`).

**Side bar shell.** `SideBarHost` mounts a `.vg-side-bar` DOM panel as
a sibling of the canvas inside `VelocityGrid.root`. The shell is three
regions — a 28 px-wide vertical tab strip (`.vg-side-bar-tabs`), a
flex-grown panel host (`.vg-side-bar-panel`), and a 3 px resize handle
(`.vg-side-bar-resize`) — laid out with CSS flex
(`flex-direction: row-reverse` for right-edge mount, `row` for left).
Tab buttons render an icon glyph above a rotated label
(`writing-mode: vertical-rl`); the active tab gets the canonical 3 px
blue left border (`border-left: 3px solid var(--vg-focus-ring-color)`,
mirrored to the right when `position: 'left'`). The resize handle
hovers blue and drags the panel width between
`minWidth` / `maxWidth`. Opening, closing, switching, or
resize-dragging the panel each triggers exactly one
`cgridCanvas.resize()` via `setHostBounds()`, so the canvas reflows in
sync with the shrunk drawable region. `hiddenByDefault: true` starts
the bar collapsed; `defaultToolPanel: <id>` opens that panel on mount.

**Columns tool panel (`agColumnsToolPanel`).** Dark-themed panel with
a top "Pivot Mode" pill toggle, a full-width search input (magnifier
glyph + placeholder), a scrollable column list, and two drop-zone
sections (Row Groups, Values) at the bottom. Each column row is a
checkbox (visibility, wired through `api.setColumnVisible`), a 6-dot
drag handle (reorder, wired through `api.moveColumns`), and the
header label. The search input filters the list by `headerName` /
`colId` substring. `refresh()` walks the row list in-place to preserve
scroll position. All seven `IToolPanelColumnCompParams` suppress flags
work (`suppressColumnMove`, `suppressRowGroups`, `suppressValues`,
`suppressPivots`, `suppressPivotMode`, `suppressColumnFilter`,
`suppressSyncLayoutWithGrid`). Row Groups + Values drop zones render
the dashed-border container with their placeholder copy — the drop
action is a `console.debug` stub until Cycle 13 wires the grouping
data path. The Pivot Mode toggle flips its `aria-pressed` attribute
correctly; the underlying `api.setPivotMode` wiring is stubbed for
Cycle 16.

**Filters tool panel (`agFiltersToolPanel`).** Dark-themed panel with
a top search input + expand/collapse-all button, then one
collapsible row per filterable column. Collapsed rows show a
right-chevron + header label; clicking anywhere on the row toggles
`data-expanded` and mounts the column's existing filter editor
inline. The editor is the same component `FilterPopupHost` opens for
the popup path — a `buildFilterComponent(colId, mountPoint)` factory
serves both surfaces so a bug fixed in one path is fixed in both.
For set-filter columns the editor brings its per-filter search +
`(Select All)` + scrollable value list; for text/number/date columns
it brings the matching condition + value inputs. Changes propagate
through `setFilterModel(colId, model)` identically to the popup. The
empty state ("No filterable columns") renders when no column declares
a filter. `suppressFilterSearch` and `suppressExpandAll` work.

**Custom panel API.** `refreshToolPanel(id)` calls `refresh()` on the
live `ToolPanel` instance for `id`, silent no-op when the panel is
not currently mounted (because the side bar destroys panels on
close to keep the DOM tree small). `getToolPanelInstance(id)` returns
the live `ToolPanel` instance — same object the host mounted into
the panel region — or `null` when no panel for `id` is open. Both
methods work for built-in and app-registered ids uniformly; the
`SideBarHost` owns the `id → instance` map and the VelocityGrid API forwards
through it. Calling either method on a grid with no side bar
configured is also a silent no-op.

**Side bar state API.** Seven methods on `VelocityGridApi` for programmatic
control: `isSideBarVisible()`, `setSideBarVisible(show)`,
`setSideBarPosition(pos: 'left' | 'right')`, `openToolPanel(id)`,
`closeToolPanel()`, `getOpenedToolPanel()` (returns the id of the
open panel or `null`), and `getSideBar()` (returns the resolved
`SideBarDef` or `undefined`). All seven are silent no-ops when no
side bar is configured — apps can call `setSideBarVisible(true)` on a
no-side-bar grid without a throw. `setSideBarPosition` re-mounts the
shell on the opposite edge in place; `getSideBar()` returns the LIVE
def (position mutations from `setSideBarPosition` show up in the
returned object), and `getOpenedToolPanel()` reflects the actual
mounted-panel state including auto-opens triggered by
`defaultToolPanel`.

**Side bar events.** Two new union members on `VelocityGridEvent`:
`toolPanelVisibleChanged { source, key, visible }` fires when a panel
opens or closes; `sideBarVisibleChanged { source, visible }` fires
when the whole bar shows or hides. The `source` tag is one of
`'api'` (programmatic call), `'sideBarButtonClicked'` (tab click), or
(for `toolPanelVisibleChanged` only) `'sideBarInitializing'` (the
mount-time auto-open from `defaultToolPanel`). Switching panels
emits TWO `toolPanelVisibleChanged` events in order (close-old,
open-new) so listeners can track the transition cleanly. No events
fire when no side bar is configured.

**DOM-canvas coexistence audit.** A regression matrix
(`cycle11-sideBarCoexistence.spec.ts`) exercises every interaction
surface — cell click, range drag, edge-zone auto-scroll, wheel
scroll, context menu mount, filter popup mount, and the resize-handle
drag itself — against BOTH side-bar-closed AND side-bar-open. The
audit confirmed pointer routing already worked correctly through
`canvas.getBoundingClientRect()` (it returns the shrunk drawable
width when the side bar is open, so cell coordinates stay correct
without any feature-chain patch), the Cycle 9 edge-zone auto-scroll
fires at the new shrunk right edge (not the absolute canvas right
edge), and the side bar's resize-handle drag doesn't bleed into the
feature chain (the handle's `pointer-events: auto` keeps the event
captured DOM-side).

**Demo polish.** `apps/cgrid-positions` ships the side bar wired into
`positionsGrid.ts` with `sideBar: { toolPanels: ['columns',
'filters'] }`. Two new URL flags showcase the registration + default
surfaces without breaking the existing E2E suite: `?customPanel=1`
registers a `DemoCustomPanel` (lifecycle-counter side channel for the
`refreshToolPanel` / `getToolPanelInstance` E2Es) via
`VelocityGridOptions.components` and appends a third "Demo" tab;
`?openColumns=1` adds `defaultToolPanel: 'agColumnsToolPanel'` so the
Columns panel opens at mount. Default URL preserves the "no tab
pressed at mount" surface every prior Cycle 11 spec asserts against.

**Performance.** Opening, closing, switching, and resize-dragging the
side bar each trigger exactly one `cgridCanvas.resize()` per gesture —
verified against the coexistence regression matrix. The side bar
mounts pure main-thread DOM, no worker round-trip on any panel
interaction. The Columns panel's `refresh()` walks the row list in
place instead of rebuilding the tree, preserving scroll position
when the underlying column model mutates from outside. No scroll-FPS
impact measured with both panels open.

**Test sweep (recorded against the Task 9 branch):**
- `npm run typecheck --workspaces`: clean (cgrid, cgrid-positions,
  showcase).
- `npm run test:cgrid`: 92 files, 1056 unit tests, 100% pass.
- `npx playwright test`: 207 E2E specs, 100% pass (including the
  6 new `cycle11-*.spec.ts` files — sideBar, columnsPanel,
  filtersPanel, customPanelApi, sideBarEvents,
  sideBarCoexistence).

---

## Cycle 11 status: COMPLETE

Closed on 2026-06-26.

- [x] Task 1 — `ToolPanel` interface + registry + `components` option
      (PR #35).
- [x] Task 2 — Side bar shell: DOM mount, tab strip, panel host,
      resize handle, position toggle (PR #36).
- [x] Task 3 — Columns tool panel: visibility, reorder, sections,
      search, all suppress flags (PR #37).
- [x] Task 4 — Filters tool panel: collapsible rows + inline filter
      editors (shared `buildFilterComponent` factory) (PR #38).
- [x] Task 5 — `refreshToolPanel` + `getToolPanelInstance` API
      (PR #39).
- [x] Task 6 — Side bar state API: `isSideBarVisible`,
      `setSideBarVisible`, `setSideBarPosition`, `openToolPanel`,
      `closeToolPanel`, `getOpenedToolPanel`, `getSideBar` (PR #40).
- [x] Task 7 — `toolPanelVisibleChanged` + `sideBarVisibleChanged`
      events (PR #41).
- [x] Task 8 — DOM-canvas coexistence audit (PR #42).
- [x] Task 9 — Cycle 11 exit ritual: FM Area 17 flips + demo polish
      (`?openColumns=1`) + worklog `## Shipped` + status close.

**FM coverage:** Area 17 — 15 of 17 rows flipped to ✅ (88%). Deferred:
`toolPanelSizeChanged` event (the resize handle ships in Cycle 11 but
the size-change emission lands later) and `allowDragFromColumnsToolPanel`
(drag-from-panel-to-grid integration lands in Cycle 13 alongside the
grouping data path).
