# 08 — Grid Options

> The big one: ~80 grid settings across 12 bands, with a sidebar nav, scroll tracking, search, override count badges, and progressive idle mounting.

Engine module: [general-settings](../starui-customizer/08-general-settings.md)

## Purpose

Surface every grid-level setting (row/header heights, selection, pagination, grouping, pivoting, sorting, editing, animation, scrolling, styling, clipboard) through a unified, searchable, organized panel. Replaces the old "20 toggles in a sidebar" pattern.

## Invocation

Settings Sheet → Options → Grid Options. Default landing tab in most workflows.

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Grid Options                              [Reset]  [Save]       │
├─────────────────────────────────────────────────────────────────┤
│ 🔍 Filter options…                                       [X]    │
├─────────────────────────────────────────────────────────────────┤
│ [SCHEMA v2] [OVERRIDES 4/87] [DIRTY ●] [FILTER --]              │   ← sticky chips
├──────────────────┬──────────────────────────────────────────────┤
│ 01 ESSENTIALS ●  │ 01 ESSENTIALS ──────────                    │
│ 02 GROUPING    ● │   ROW HEIGHT     [number]                   │
│ 03 PIVOT         │   HEADER HEIGHT  [number]                   │
│ 04 COLUMN        │   ANIMATE ROWS   [toggle]                   │
│ 05 FILTER        │   ROW SELECTION  [select]                   │
│ 06 SORT          │   …                                          │
│ 07 EXPORT        │ 02 ROW GROUPING ──────────                  │
│ 08 AGGREGATE     │   …                                          │
│ 09 ANIMATION     │ 03 PIVOT ──────────                          │
│ 10 SCROLL        │   …                                          │
│ 11 STYLE         │ (continues for all 12 bands)                │
│ 12 CLIPBOARD     │                                              │
└──────────────────┴──────────────────────────────────────────────┘

Sidebar: 176px fixed width. Active band: left accent border + primary background.
Override count badges (●N) on sidebar items when user has changed fields in that band.
```

## Component tree

- **GridOptionsPanel** (memo'd, no props)
  - ObjectTitleRow (title + Save/Reset)
  - Search bar (IconInput + clear button)
  - Sticky chip strip (SCHEMA / OVERRIDES / DIRTY / FILTER chips)
  - Flex body:
    - **Sidebar nav** (`<aside>`, 176px)
      - `BandNavItem` × 12 (looped over `GRID_OPTIONS_SCHEMA`)
        - index "01" + title + optional override count badge
    - **Main content** (scrollable, IntersectionObserver target)
      - `<section>` × 12 (`filteredBands`)
        - Header: index + title + override count + divider
        - `FieldRenderer` × N per band (dispatches on `field.kind`)

## Field schema

Fields are declared in `GRID_OPTIONS_SCHEMA` — an array of bands, each with an array of fields. Each field has a `kind`:

| Kind | Renderer | Example |
|---|---|---|
| `bool` | BoolControl | "animate rows" toggle |
| `num` | NumberControl | "row height" number input |
| `text` | IconInput | "quick filter text" |
| `select` | NativeOptionsSelect | "rowSelection" dropdown |
| `custom` | Render function | "pagination page size + auto checkbox" composite |
| `subsection` | Nested fields | "sub-band within a band" |
| `conditional` | Show if predicate matches | "show pivot fields only when pivot mode on" |

Composite/custom fields wrap multiple state keys (e.g., PAGE SIZE + AUTO toggle) but track all underlying keys for accurate override counts.

## Props

None — pure component, reads everything via context (the draft hook + grid state).

## Internal state

- `draft`: GeneralSettingsState (~80 fields)
- `dirty`: boolean (draft !== committed)
- `query`: search/filter text
- `activeBand`: current band index ('01' → '12') for sidebar highlight
- `mountedBands`: integer (progressive mount count, starts at 3)
- `forcedBands`: Set<string> (bands force-mounted by user nav click)
- `bandRefs`: Map<string, HTMLElement> for scrollIntoView targets

## Interaction flows

**Search:**
```
type query → filteredBands re-computed via filterBand() →
  hidden bands disappear from both content AND sidebar nav →
  sidebar override counts stay against FULL schema (not filtered) so badges are honest
```

**Sidebar click:**
```
click BandNavItem → force-mount the band (skip idle wait) →
  el.scrollIntoView({ smooth }) → setActiveBand(index)
```

**Passive scroll tracking:**
```
IntersectionObserver fires as user scrolls → first intersecting section becomes activeBand →
  sidebar nav highlight auto-updates
```

**Edit a field:**
```
FieldRenderer.update(key, value) → setDraft({ [key]: value }) →
  countBandOverrides() recomputes for that band → sidebar badge updates
```

**Save:**
```
[Save] → commit draft → reducer fires → settings:save-requested event →
  profile persistence kicks in
```

## Engine wiring

- **State slice**: `GeneralSettingsState` via `useModuleDraft(GENERAL_SETTINGS_MODULE_ID, '__singleton__')`
- **Commit**: `commitItem(draft)` returns a reducer that swaps the state
- **12 bands per engine doc tiers**: Essentials, Row Grouping, Pivot, Column, Filter, Sort, Export, Aggregate, Animation, Scroll, Style, Clipboard

## Shared primitives used

- ObjectTitleRow, SettingsRow, SummaryChip, Band, SharpBtn
- BoolControl, NumberControl, IconInput, NativeOptionsSelect
- ChromeButton (sidebar nav items)
- FieldRenderer (polymorphic dispatcher)

## Design decisions worth copying

1. **Progressive band mounting via `requestIdleCallback`.** Mounting all 13 bands × ~7 controls synchronously janks the slide-in animation. Defer all-but-3 to idle callbacks (200ms timeout). Use `content-visibility: auto` + `contain-intrinsic-size` placeholders so scrollbar stays stable.

2. **IntersectionObserver scroll tracking.** Don't listen to scroll events (noisy, fires constantly). Use IntersectionObserver with `-10% / -70%` root margin. First intersecting band auto-highlights sidebar nav.

3. **Override counts against FULL schema.** Per-band override counts are computed against the unfiltered schema. Badges stay constant while typing a search query — users see what they've touched even if hidden.

4. **Composite custom fields with multi-key tracking.** PAGE SIZE + AUTO checkbox live in one row via `kind: 'custom'`, but the schema tracks both keys (`paginationPageSize`, `paginationAutoPageSize`) so override count is honest.

5. **Conditional field recursion.** `kind: 'conditional'` nests fields gated on a predicate. Schema walker (`collectFieldKeys`, `collectCustomKeys`) recursively collects all possible keys so override counts include hidden conditional fields.

6. **Search filter respects band structure.** Hides empty bands entirely from sidebar AND content. Don't show a band header with no matching fields.

7. **Schema-driven rendering.** Fields are declared, not coded. Adding a new field = adding an entry to `GRID_OPTIONS_SCHEMA`. The FieldRenderer dispatches by `kind`. Easy to maintain, easy to test.

## cgrid translation

Bigger build, but mostly mechanical once the substrate exists.

1. **Define `CGRID_OPTIONS_SCHEMA`** — port the field list, adjusting for cgrid's runtime options (drop AG-only fields like `enableAdvancedFilter`; add cgrid-specific ones like worker tuning).
2. **`<cgrid-grid-options-panel>`** as a top-level Lit component with sidebar nav + scrollable content.
3. **`<cgrid-field-renderer>`** dispatches by `field.kind`. Build one per kind: `<cgrid-field-bool>`, `<cgrid-field-num>`, `<cgrid-field-select>`, `<cgrid-field-text>`. Composite/conditional fields use slot-based composition.
4. **Progressive mounting** via `requestIdleCallback` (fallback to `setTimeout` for Safari < 15).
5. **IntersectionObserver scroll tracking** — same code, works in any DOM context.
6. **Search**: filter `CGRID_OPTIONS_SCHEMA` at runtime, hide empty bands, keep override counts against full schema.
7. **Schema validation**: define field types in TS so the schema author can't typo a field key.

Build in Phase 2. The mechanics here (search, sidebar, scroll tracking, progressive mounting) are reusable for [19-toolbar-date-settings](19-toolbar-date-settings.md) too.
