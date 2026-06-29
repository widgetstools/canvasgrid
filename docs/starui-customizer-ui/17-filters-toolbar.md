# 17 — Filters Toolbar

> Collapsible pill row of saved filter models. Toggle, rename, edit JSON, delete, add from current grid state.

Engine module: saved-filters (host-level, not one of the 15 documented modules)

## Purpose

Surface multiple saved filter sets as quickly-clickable pills. Users toggle on/off, rename, edit the underlying filter JSON, delete, or capture the current grid filter state as a new pill.

## Invocation

Persistent optional toolbar row (below the primary toolbar, above the grid canvas). Collapse/expand state persists in the profile.

## Layout — expanded

```
[◀◀] [pill: Filter1 · 42] [pill: Active · 8] [pill: Critical · 3] ... [◀][◀◀] [🗑 Clear] [+ Add]
 ↑    ↑ scroll container with overflow chevrons                          sticky action cluster
 collapse button
```

## Layout — collapsed

```
[▶▶] [2 filters · 1 active] [🗑 Clear] [+ Add]
```

## Component tree

- **FiltersToolbar** (exported)
- **FiltersToolbarInner** (memoized implementation)
  - ChromeButton collapse/expand toggle (leads the row)
  - ChromeButton summary chip (visible only when collapsed)
  - Scrollable pill row (`<div ref={scrollRef}>`)
    - Per-pill:
      - ChromeButton (apply/toggle)
      - `<Input>` (rename mode when editing name)
      - GhostIconButton (edit, delete) — hover reveal
    - Per-pill Popover → **FilterModelEditor** (JSON textarea + Save/Cancel)
  - Sticky action cluster (flex-shrink: 0)
    - ChromeButton Clear (disabled when no filters active)
    - ChromeButton Add (disabled when no unsaved live filter exists)
  - Scroll chevrons (left/right) — appear/disappear based on overflow

## Props

`FiltersToolbarProps`: empty interface (state via `useFilterModel()` hook).

## Internal state

- `expanded`: persisted to `toolbar-visibility` module under key `filters-toolbar-pills`
- `renameId`: which pill is in rename mode (or null)
- `openDetailsId`: which pill's details popover is open (or null)
- `canScrollLeft` / `canScrollRight`: overflow indicator state (computed via observers)

## Interaction flows

**Toggle a filter:**
```
click pill → model.toggle(id) → activates/deactivates → grid row count updates instantly →
  pill style changes (active vs inactive)
```

**Rename pill:**
```
hover pill → edit + delete icons fade in → click edit → input replaces label → type → Enter/Blur commits → model.rename(id, name)
```

**Edit filter JSON:**
```
click pill's ⋮ menu → Popover opens with FilterModelEditor (JSON textarea) →
  user edits → JSON.parse + shape check on every keystroke → Save enabled only when valid →
  click Save → model.editFilterModel(id, next) → popover closes
```

**Add from live state:**
```
[+ Add] → model.addFromLive() → snapshots the current grid filter state as a new pill
```

**Clear all:**
```
[🗑 Clear] → model.deactivateAll() → all pills inactive (doesn't delete, just deactivates)
```

**Two-step delete:**
```
hover → trash icon fades in → mousedown-to-arm (becomes warning red) → click → model.remove(id)
```

## Engine wiring

- `useFilterModel()` returns: `{ filters, filterCounts, hasNewFilter, toggle, rename, remove, addFromLive, editFilterModel, deactivateAll }`
- Filters synced bidirectionally with the grid's filterModel (in starui, AG-Grid's `filterModel`)
- `useModuleState('toolbar-visibility')` — collapse/expand persistence
- Filter counts recomputed on every grid row change (cached in the hook)

## Shared primitives used

- ChromeButton (all interactive elements)
- Input (rename mode)
- Popover + PopoverTrigger + PopoverContent (pill details)
- Textarea (JSON editor)
- GhostIconButton (edit/delete row actions)

## Design decisions worth copying

1. **Collapse/expand persisted across reloads.** Users can hide the pills and reclaim vertical space without losing the saved filters.

2. **Scroll overflow detection.** MutationObserver + ResizeObserver on the pill row. Chevrons appear/disappear dynamically.

3. **Two-step delete guard.** Trash icon arms on mousedown, commits on click. Prevents accidental destruction.

4. **Filter model as JSON editor.** Users edit the underlying filter model JSON directly. Validates on every keystroke (`JSON.parse` + shape check). Power-user affordance.

5. **Add only when there's a new filter to save.** [+ Add] disabled when current grid state is already saved. Avoids creating duplicate empty pills.

6. **Pills show row count.** "Active · 8" tells users how many rows the filter currently matches without applying it.

## cgrid translation

1. **`<cgrid-filters-toolbar>`** as a Lit element.
2. **Saved filters module** — needs to exist in cgrid (currently saved-filters is a host-level concern in starui; for cgrid, formalize it as a customizer module).
3. **Filter model serialization** — cgrid filter state is per-column. Serialize as `{ [colId]: filterState }` per pill. Apply via `grid.setColumnFilters(state)`.
4. **JSON editor**: `<wa-textarea>` with `font-family: monospace`. Validate on input. Highlight errors inline.
5. **Two-step delete pattern**: state machine in a Lit controller (`{ idle | armed | committed }`).
6. **Overflow observation**: ResizeObserver on the pill row container.

Build in Phase 5. Requires a saved-filters store on the engine side that cgrid currently lacks.
