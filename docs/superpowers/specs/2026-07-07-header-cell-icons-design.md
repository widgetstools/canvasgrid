# Header & Cell Icon Placement — Design

**Date:** 2026-07-07
**Branch:** `cgridext/header-cell-icons` (off `cgridext/foundation` — the Formatting ribbon this feature extends exists only there)
**Status:** Approved design, pre-implementation

## Problem

Data cells already support icons/emojis at all six decorator positions (TL/TR/BL/BR/ML/MR via
`cellStyle.decorators`), content slots (`cellStyle.content`), and prefix/suffix icons that compose
with the cell text (`cellIcon`, `IconRef` leading/trailing). Column headers support none of this:
the `headerCell` painter ignores `p.content` / `p.decorators` (even though the `headerStyle`
pipeline already delivers them), and there is no header-side prefix/suffix icon API at all.
There is also no UI anywhere for choosing icons/emojis and placing them.

## Goal

1. **Kernel parity:** leaf column headers render `headerStyle.content`, `headerStyle.decorators`
   (all 6 positions), and a new `headerIcon` prefix/suffix that composes with the caption.
2. **Emoji prefix/suffix:** `IconRef` supports emoji, for both `cellIcon` and `headerIcon`.
3. **Toolbar UI:** an "Icons" section in the ext Formatting ribbon — categorized icon/emoji tile
   picker (8 per row), color picker, placement dropdown (Prefix, Suffix, TL, TR, BL, BR, ML, MR) —
   applying to data cells or headers via the existing Cell/Header target toggle.

## Decisions (locked with user)

| Decision | Choice |
|---|---|
| Header prefix/suffix API | New `headerIcon` leaf-colDef prop mirroring `cellIcon` (not content-slot-only) |
| Sort-chevron collisions | **Author's responsibility** — painter paints exactly where asked, no auto-avoid, no chevron suppression |
| Group headers | **Leaf headers only** for `headerIcon`. (Group-header *bands* still get decorators/content for free via the shared `groupHeaderStyle` patch path — no code is added to block it, but no group-level `headerIcon` is added.) |
| Scope | Kernel + calc channel + **customizer/ribbon UI** in this cycle |
| Approach | Approach 1 — maximum reuse of existing cell machinery (`renderContentSlot`, `paintCellDecorators`, `drawCellIcon` slot logic) |

## 1. Kernel — header painter consumes `content` + `decorators`

File: `packages/kernel/src/renderer/cellRenderers/registry.ts` (`headerCell`).

- **Content slot:** when `p.content` is set, call the existing `renderContentSlot` **instead of**
  the caption path. Caption, ellipsis-for-caret, and wrap logic are all skipped — content replaces
  the caption, the exact contract data cells have. Sort chevrons, sort-order badge, group caret,
  and the header checkbox branch still paint (checkbox branch keeps its early return and wins over
  content).
- **Decorators:** after the border overlay (last paint step), when `p.decorators` is non-empty,
  call the existing `paintCellDecorators(gc, p.bounds, p.decorators)`. Decorators paint over
  chevrons if the author places them there (author's responsibility).

No plumbing changes: `applyCellProps`' header branch already applies `headerClass` variants,
`headerStyle` (static + fn), and `groupHeaderStyle` through `applyOverridePatch`, which handles
`content` and `decorators` (`packages/kernel/src/core/propertyChain.ts`).

## 2. Kernel — `headerIcon` + emoji `IconRef`

### 2.1 `IconRef` emoji variant (`packages/format/src/types.ts`)

```ts
export interface IconRef {
  /** Registered icon name (icon-set registry / Lucide). Exactly one of name|emoji. */
  name?: string;
  /** Unicode emoji glyph, drawn via fillText. Exactly one of name|emoji. */
  emoji?: string;
  color?: string;        // ignored for emoji
  position?: 'leading' | 'trailing';
}
```

Back-compat: `name` was previously required; all existing producers set it. Consumers
(`drawCellIcon` in `packages/kernel/src/renderer/painters/byRows.ts`, composite `resolveIcon`)
gain an emoji branch: draw the glyph with `fillText`, centered in the same reserved slot a Path2D
icon would occupy (slot width = icon size; font = cell font at icon-size px). An `IconRef` with
neither or both of `name`/`emoji` is ignored (paint nothing) — same failure mode as an
unregistered icon name today.

### 2.2 `headerIcon` colDef prop (`packages/kernel/src/types/column.ts`)

```ts
headerIcon?: IconRef | ((params: { colId: string }) => IconRef | null);
```

Resolved in the `byRows.ts` **header branch** identically to `cellIcon`'s data path: the icon
claims a leading or trailing slot and the caption shifts away via `config.padding`
(left for leading, right for trailing). Applies to leaf header cells only (the header branch that
paints leaf captions); group-header band cells are untouched. A trailing icon does **not** move
the sort chevron or badge — collisions are the author's responsibility. Wrapped headers
(`wrapHeaderText`) shift their wrap width by the same padding.

## 3. Calc — `ColumnEditPatch` channel

File: `packages/calc/src/calcEngine.ts`.

Add `cellIcon` and `headerIcon` to `ColumnEditPatch` and the templatable set — **static `IconRef`
objects only** (JSON-serializable; function forms remain colDef-authoring-only and are not
editable/templatable). They merge into the column's own template exactly like `format`, so
profile/layout persistence and template forking behavior are automatic. The kernel bridge's colDef
rebuild picks them up like every other override key.

## 4. Ext — "Icons" section in the Formatting ribbon

File: `packages/ext/src/toolbar/ribbon.ts` (+ new picker module + generated data files).
`/frontend-design` skill is invoked before building the UI (user's UI quality bar).

### 4.1 Controls (honor the existing Cell/Header target toggle)

1. **Icon/emoji tile dropdown** — a ribbon button (shows the currently selected glyph or a
   placeholder) opening a dropdown panel:
   - Search box on top (filters by name/tag across both sources).
   - Scrollable tile grid, **8 tiles per row**, grouped under category headings.
   - **Lucide group:** categories derived at prebuild time from `node_modules/lucide-static/tags.json`
     into a generated `lucide-categories.generated.ts` (icon → primary category from a curated
     category order; uncategorized → "Other"). Tiles render the icon as inline SVG
     (`iconSvg()` from the kernel already builds DOM `<svg>` from path strings).
   - **Emoji group:** curated static set (~300) in categories — Smileys, Gestures, Arrows,
     Symbols, Shapes, Flags, Objects, Nature. Tiles are text spans.
   - Selecting a tile records `{ name }` or `{ emoji }` and updates the button preview.
2. **Color picker** — button + hidden native `<input type="color">`, same pattern as the existing
   Text/Fill color controls. Applies to SVG icons only; visually disabled while an emoji is
   selected.
3. **Placement dropdown** — `Prefix, Suffix, TL, TR, BL, BR, ML, MR` (default `Prefix`).

**Editing model — placement is a slot selector.** The three controls always describe *the icon at
the currently selected placement, for the current target*. Changing the placement dropdown does
NOT move an icon — it switches which slot is being viewed/edited (`refresh()` re-reads that
slot's current icon + color into the other two controls). Picking a tile applies immediately to
the selected slot (like bold/italic, no separate Apply button); changing the color re-applies to
the same slot. A **Clear** button removes the icon at the selected slot. This lets a column carry
a prefix icon AND multiple decorators simultaneously, each edited independently.

### 4.2 Apply mapping (per selected column, via `grid.editColumn`)

| Placement | Target = Cell | Target = Header |
|---|---|---|
| Prefix | `{ cellIcon: { name\|emoji, color?, position: 'leading' } }` | `{ headerIcon: { …, position: 'leading' } }` |
| Suffix | same with `position: 'trailing'` | same |
| TL/TR/BL/BR/ML/MR | merge one decorator into `cellStyle.decorators` | merge into `headerStyle.decorators` |

Decorator merge semantics: read the column's current own-template decorator array, replace the
entry at the chosen position (icon → `{ position, kind: 'icon', icon: name, color }`; emoji →
`{ position, kind: 'emoji', value: emoji }`), keep entries at other positions, write the full
array back (decorators replace wholesale on patch — the ribbon does the read-modify-write).
Clear removes the entry at the current position (or unsets `cellIcon`/`headerIcon` for
Prefix/Suffix).

State reflection: `refresh()` reads the first target column's own template (existing
`currentStyle()` mechanism + the new top-level icon keys) and reflects the current icon, color,
and placement into the three controls, same as bold/italic today. `ctx.profiles.markDirty()`
after every apply, as the ribbon already does.

## 5. Testing

- **Kernel unit (vitest):** header content slot renders instead of caption; header decorators at
  all 6 positions; `headerIcon` leading/trailing caption shift (padding math); emoji `IconRef`
  drawn via fillText in cells and headers; invalid `IconRef` (both/neither of name+emoji) paints
  nothing; sort chevron still paints with trailing icon present.
- **Calc unit:** `editColumn` round-trips `cellIcon`/`headerIcon` through own-templates;
  serialization survives `getTemplates()`.
- **E2E (hard gate)** in `apps/cgrid-customizer-demo` (port 5187; reset saved state first):
  drive the ribbon — open picker, search, select icon + emoji, set color, apply each placement to
  both targets — screenshot-verify rendering, verify persistence across profile save/reload,
  verify Clear. Kill the automation browser when done.

## Out of scope

- Group-level `headerIcon` (leaf only; group bands still honor decorators/content via
  `groupHeaderStyle` as a side effect of shared code).
- Auto-avoidance of sort-chevron collisions.
- Raster image (PNG/SVG-file) icons — icons remain Path2D path data + emoji text.
- Multicolor icons (`drawIcon` remains single-color stroke).
- Interactive (clickable) header icons — visual only.
