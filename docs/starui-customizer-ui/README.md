# @cgrid/customizer — UI Addon Package Spec

This folder documents the **UI editors** (panels, dialogs, toolbars) that ship as the `@cgrid/customizer` addon package. The addon consumes cgrid's public API to drive every customizer feature; it does not reach into cgrid internals.

The companion folder [../starui-customizer/](../starui-customizer/) documents the **engine layer** that lives in `cgrid` core and defines the public API this addon depends on. Read that first — the engine API is the contract these editors target.

Reference implementation: starui's React UI package at `/Users/develop/wfh/starui/packages/react-grid/grid/src/customizer/`.

---

## Package architecture (read first)

This is **a separate package** from cgrid core:

| Package | Contains | Dependencies | License |
|---|---|---|---|
| **`cgrid`** (core) | Engine layer + public API. See [../starui-customizer/](../starui-customizer/). | Vanilla TS, zero UI framework | MIT |
| **`@cgrid/customizer`** (addon) | Everything in this folder: panels, dialogs, toolbars, shared editor primitives. | Lit + Web Awesome + `cgrid` | TBD (can be commercial — AG Grid Enterprise model) |

The addon imports cgrid like any third-party consumer:

```ts
// @cgrid/customizer/src/panels/conditional-styling.ts
import { ExpressionEngine, type ConditionalRule } from 'cgrid';

// NOT allowed:
// import { something } from 'cgrid/src/core/internal/...';
```

## API-first build discipline

**Build the customizer as if you didn't write cgrid.** Treat cgrid as a third-party dependency at the boundary, even though both packages live in the same monorepo:

1. **No deep imports.** Import only from `cgrid` — never from `cgrid/src/...` or `cgrid/internal/...`. Enforce with tsconfig `paths` restrictions + an ESLint `no-restricted-imports` rule. Make CI fail on violations.
2. **Block private types.** If `@cgrid/customizer` needs a type that isn't exported from `cgrid`, *do not copy it locally* and do not reach in. Open a PR against cgrid that adds the export. The friction is the point — it surfaces API gaps before they become integration debt.
3. **Test against the built artifact, not source.** Symlink during dev for fast iteration, but CI installs the publishable cgrid package and runs the addon against that. Catches accidental internal-import leaks before publish.
4. **API contract lives in cgrid, not the addon.** Cgrid's `api.ts` + TSDoc on the exported types are the spec; the addon implements against that spec. Don't document API behavior in the addon's code — link to cgrid's docs.

This is the discipline that kept AG Grid Community's API stable for a decade while Enterprise iterated independently on top. It works.

### Stack

cgrid's stack choice is intentional: **vanilla JS + Lit + Web Awesome (web components)** — not React, not Angular. These docs capture platform-agnostic patterns (layout, state shape, interaction flow, engine wiring) and skip React-specific idioms (hooks, useState, useMemo) since they don't translate.

---

## Editor catalog

20 top-level user-invokable editors. Grouped here by surface type for orientation; docs are numbered top-to-bottom in the table below.

| # | Editor | Surface | Engine module(s) | Complexity | Doc |
|---|---|---|---|---|---|
| 01 | Column Settings | Master-detail panel | column-customization | x-large (10 bands) | [01-column-settings.md](01-column-settings.md) |
| 02 | Column Groups | Master-detail panel | column-groups | large | [02-column-groups.md](02-column-groups.md) |
| 03 | Calculated Columns | Master-detail panel | calculated-columns | large | [03-calculated-columns.md](03-calculated-columns.md) |
| 04 | Conditional Styling | Master-detail panel | conditional-styling | x-large (7 bands) | [04-conditional-styling.md](04-conditional-styling.md) |
| 05 | Alerts | Master-detail panel | alerts | large | [05-alerts.md](05-alerts.md) |
| 06 | Plus / Minus | Master-detail panel | plus-minus | medium | [06-plus-minus.md](06-plus-minus.md) |
| 07 | Shortcuts | Master-detail panel | shortcuts | medium | [07-shortcuts.md](07-shortcuts.md) |
| 08 | Grid Options | Flat panel w/ sidebar nav | general-settings | x-large (12 bands, ~80 fields) | [08-grid-options.md](08-grid-options.md) |
| 09 | Smart Edit (settings) | Flat panel | smart-edit | small | [09-smart-edit.md](09-smart-edit.md) |
| 10 | Bulk Update (settings) | Flat panel | bulk-update | small | [10-bulk-update.md](10-bulk-update.md) |
| 11 | Data Change History | Flat panel + live monitor | data-change-history + editing-core | medium | [11-data-change-history.md](11-data-change-history.md) |
| 12 | Visual Excel | Flat panel | visual-excel | tiny | [12-visual-excel.md](12-visual-excel.md) |
| 13 | Formatting Toolbar | Toolbar + poppable inspector | column-customization + column-templates + multiple | large | [13-formatting-toolbar.md](13-formatting-toolbar.md) |
| 14 | Smart Edit Toolbar | Inline toolbar row | smart-edit | small | [14-smart-edit-toolbar.md](14-smart-edit-toolbar.md) |
| 15 | Bulk Update Toolbar | Inline toolbar row | bulk-update | small | [15-bulk-update-toolbar.md](15-bulk-update-toolbar.md) |
| 16 | Edit History Toolbar | Inline toolbar row | data-change-history + editing-core | tiny | [16-edit-history-toolbar.md](16-edit-history-toolbar.md) |
| 17 | Filters Toolbar | Inline pill row | saved filters (host-level) | medium | [17-filters-toolbar.md](17-filters-toolbar.md) |
| 18 | Column Selector | Dialog (modal) | column-customization (visibility) | medium | [18-column-selector-dialog.md](18-column-selector-dialog.md) |
| 19 | Toolbar Date Settings | Flat panel w/ sidebar nav | toolbar-date-settings | medium | [19-toolbar-date-settings.md](19-toolbar-date-settings.md) |

Plus a foundations doc covering all shared primitives:
- [00-foundations.md](00-foundations.md) — Cockpit chrome, master-detail pattern, settings primitives (Band, SettingsRow, SummaryChip, etc.), Poppable, shared editors (ExpressionEditor, StyleEditor, FormatterPicker, ColorPicker, TemplateManager), utility buttons.

---

## Cross-cutting architectural patterns

These show up across nearly every editor. Build the substrate that supports them before building any individual editor.

### 1. Master-detail panel pattern (7 panels use it)

Three coordinated surfaces:
- **List pane** (left rail, ~280px): scrollable item list with search, add button, per-row LED for dirty state, per-row delete/clone icons on hover
- **Editor pane** (right, flex): bands of related fields for the selected item
- **No selection state**: editor pane shows an empty placeholder; list pane auto-selects first item on open if available

Each panel exports both a `ListPane` and `EditorPane` component (plus a legacy flat `Panel` wrapper). The shell composes them into a 3-column layout.

### 2. Draft + dirty + save/reset pattern

Every editor that mutates state uses a "draft / save / reset" lifecycle:
- Selecting an item seeds `draft` from the committed state (or a blank shape for new items)
- Every field edit calls `setDraft(patch)` → updates local draft, sets `dirty = true`
- A `dirty` LED appears on the list row, on the band header, and on the global Save button
- **Save**: commit draft → engine reducer → clear dirty
- **Reset**: discard draft → reseed from committed → clear dirty
- Item-level dirty tracking via a "DirtyBus" so per-row LEDs subscribe independently (avoid N hooks on a long list)

### 3. Settings sheet chrome

The "Cockpit" / "Settings Sheet" is the parent window that hosts every panel. It provides:
- A top menubar with categories (Options, Columns, Styling, Editing, Data, More) → routes to 17 modules
- A consistent header (title row, Reset/Save buttons)
- The 3-column master-detail layout
- Theme-aware styling via `--ds-*` CSS variables

Some panels (Grid Options, Toolbar Date Settings, Formatting Panel) add their own sidebar nav inside the editor area.

### 4. Composite primitive library

A library of ~17 primitives covers 90% of editor UI:
- **Layout**: Band, SettingsRow, ObjectTitleRow, PairRow, SummaryChip, TabStrip
- **Inputs**: BoolControl (toggle), NumberControl, IconInput, NativeOptionsSelect, PillToggleGroup
- **Lists**: CockpitList (cmdk-based keyboard nav), CockpitListItem, CockpitListItemMeta
- **State indicators**: DirtyDot, LedBar, SubLabel
- **Action buttons**: ChromeButton, GhostIconButton, SharpBtn

Build these first. See [00-foundations.md](00-foundations.md) for the full set.

### 5. Shared editor components

A few "big" editor components are reused across many panels:
- **ExpressionEditor** — Monaco-backed DSL editor with autocomplete (used in Conditional Styling, Calculated Columns, Plus/Minus, Alerts, Toolbar Date Settings)
- **StyleEditor** — typography + color + border + format editor in 4 modes (inline / popover / dialog / drawer); used in Column Settings, Conditional Styling, Column Groups
- **FormatterPicker** — value formatter selector with compact + inline presentations; used in Column Settings, Calculated Columns, Formatting Toolbar
- **ColorPicker / CompactColorField** — HSV pad + presets + recent colors
- **TemplateManager** — saved-template list/save/apply

### 6. Poppable / popout pattern

Some panels (Formatting Toolbar is the main one) can render either inline as a toolbar OR as a popped-out OS window without re-mounting the React tree. The `Poppable` render-props primitive owns the switch; `PopoutPortal` handles the OS window lifecycle. The same tree renders in both locations and shares all context (theme, state).

### 7. Progressive / idle mounting

For panels with many bands (Grid Options has 12 bands × ~7 fields each = ~80 controls), mounting everything synchronously janks the open animation. The pattern:
- Mount first 3 bands immediately
- Defer rest via `requestIdleCallback` (or rAF fallback) up to ~200ms each
- Use `content-visibility: auto` + `contain-intrinsic-size` on off-screen bands so scrollbar/layout stays stable
- Force-mount a band when user clicks its sidebar nav entry

### 8. IntersectionObserver scroll tracking

Sidebar nav + scroll content: clicking nav scrolls content; passive scroll observation updates active nav highlight as user scrolls. No scroll event listeners (too noisy) — use IntersectionObserver with a top-margin root threshold.

---

## cgrid build approach (Lit + Web Awesome)

### Stack choice

- **Lit** (~6 KB runtime) for custom-element authoring with reactive properties + scoped styles + declarative templates.
- **Web Awesome** (Lit-based component library, formerly Shoelace) for the input primitives: switches, inputs, dropdowns, dialogs, popovers, tooltips, color pickers.
- **No React/Angular** — everything is plain web components. The addon imports `cgrid` like any third-party consumer; both packages drop into any host framework (or none).
- **Monaco** for the ExpressionEditor (lazy-loaded; same as starui).
- **dnd-kit equivalent**: Web Awesome doesn't ship sortable list; use [SortableJS](https://sortablejs.github.io/Sortable/) (~9 KB) or write a small native pointer-events sortable.

### Pattern translation

| starui (React) | cgrid (Lit) |
|---|---|
| Render props (`Poppable`) | Slots + observed attributes |
| `useState` / `useReducer` | Lit `@state` / `@property` + reactive controllers |
| `useEffect` / `useLayoutEffect` | Lit lifecycle hooks (`firstUpdated`, `updated`) + controllers |
| `useContext` | Lit context (`@lit/context`) |
| `useMemo` for derived data | Lit `willUpdate` + cached computed properties |
| `forwardRef` | Native `ref` directives |
| `cmdk` keyboard-nav list | Custom element with keyboard event delegation |
| Tailwind utility classes | CSS-in-Lit via `static styles = css\`...\`` |
| Design-system CSS variables (`--ds-*`) | Same — variables work across both stacks |

### Suggested build order

**Phase 0 — Substrate (no dependencies on editors):**
1. Settings Sheet chrome (`<cgrid-settings-sheet>`)
2. CockpitList + CockpitListItem (the master-detail rail)
3. Settings primitives: `<cgrid-band>`, `<cgrid-settings-row>`, `<cgrid-object-title-row>`, `<cgrid-summary-chip>`, `<cgrid-dirty-dot>`
4. Draft + DirtyBus pattern as a Lit controller — every editor that mutates state uses it
5. Theme tokens — port the `--ds-*` variable scheme from starui's design-system package

**Phase 1 — Lightest editors (low-risk warmup):**
- Visual Excel (1 toggle)
- Smart Edit settings panel
- Bulk Update settings panel
- Data Change History panel
- Edit History toolbar (Undo/Redo + count)

**Phase 2 — Settings panels:**
- Grid Options panel (the big general-settings UI) — includes sidebar nav + scroll tracking infrastructure
- Toolbar Date Settings panel
- Column Selector dialog

**Phase 3 — Shared editors:**
- ColorPicker / CompactColorField
- FormatterPicker (compact + inline variants)
- StyleEditor (typography + color + border)
- ExpressionEditor (Monaco lazy-load)
- TemplateManager

**Phase 4 — Master-detail panels (heaviest):**
- Plus/Minus, Shortcuts (simpler — get the master-detail pattern working)
- Calculated Columns (uses ExpressionEditor + FormatterPicker)
- Column Groups (tree ops + StyleEditor)
- Alerts (multiple trigger kinds + module-settings sub-band)
- Conditional Styling (7 bands, includes indicator picker)
- Column Settings (10 bands, biggest — keep for last)

**Phase 5 — Toolbars:**
- Smart Edit Toolbar
- Bulk Update Toolbar
- Filters Toolbar (pill row, requires the saved-filters host)
- Formatting Toolbar (the big composer with Poppable — depends on FormatterPicker, StyleEditor, ColorPicker, TemplateManager already being built)

---

## What's NOT in scope here

- **Visual styling specifics** (you have the running starui app + Figma for that)
- **The OpenFin "Cockpit Terminal v2" wrapper** — host-specific, not cgrid's concern
- **React-specific patterns** (hooks, memo, forwardRef) — we're targeting Lit
- **AG-Grid bug workarounds** (e.g. the `streamSafeMultiColumnFilter` synthetic kind) — irrelevant for cgrid
