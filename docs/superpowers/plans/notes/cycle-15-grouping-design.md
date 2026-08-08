# Cycle 15 — Row grouping — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

---

## Task 4 — Auto-group column + `'group'` cell renderer

**Brief recap:** A synthesized column inserted at index 0 of the visible
leaf order when `rowGroupCols.length > 0`. Each cell of the column either
renders nothing (data row) or paints a tree node (group row): chevron +
indent + group value + optional `(count)` suffix. Must read as STRUCTURAL
chrome — you know it's a tree node, not a data row — without
competing with the data cells for attention.

### Subject pin

A trader / PM scanning a fixed-income positions grid that has been
grouped by `ticker` (or `ticker` → `sector` → `subSector` for a
3-level view). The grouped view's job: let the trader collapse the
universe down to "the ten tickers I care about today" and expand into
detail without ever losing the surrounding context. The auto-group
column is the tree spine — its single job is to make the hierarchy
legible at a glance.

### Default rejected

AI design defaults for "grouped grid row" cluster on three looks:

1. **Bloomberg-bar group row** — heavy gray bg across the entire row,
   bold value, indent via padding. Reads as "this row is special."
2. **Header-as-group** — group rows visually copy the column-header
   chrome (header bg, header weight). Reads as "another header
   appeared between rows," cognitively jarring.
3. **Box-and-arrow tree** — each group row gets a left-edge border or
   box, like a file-tree control. Reads as "this is a control, not
   data," which fights the canvas-grid identity.

All three put the structural cue in the row's chrome (bg / border /
weight). All three force the grouped grid to read as "data rows
interrupted by group strips" instead of "one cohesive page where
some rows happen to be tree nodes."

### Risk taken

**Group rows DON'T get a bg shift, DON'T get a top border, DON'T get a
weight bump.** The ONLY structural chrome is the chevron + indent
inside the auto-group column. Body cells on a group row paint nothing
(empty cells — the chunk's per-column data IS empty for group rows).
The bet: the monospace stack + the auto-group column's tree spine is
enough to read as a hierarchy without any row-level chrome.

This is deliberately quieter than ag-grid. ag-grid bolds the value and
tints the row bg; the diff is "look at this group" vs. "this is the
group spine." canvasgrid takes the spine route. Reasoning:

- The grouped view is the user's chosen layout. The grid doesn't
  need to keep reminding them "this is a group row" — they asked for
  it.
- Group ROWS already get a visual hint from "every other cell in the
  row is empty" — the auto-group column is the only one carrying
  text. The eye reads "this is structural" from the emptiness, not
  from extra chrome.
- Quieter chrome means the data ROWS keep their full visual weight.
  In a grouped view, the user is scanning leaf data inside the
  expanded groups; the data still needs to be the loudest thing on
  screen.
- The Cycle 14 totals "lift" (bg + border + weight) reserves the full
  signature for **per-group footer rows** (Task 12). Group rows
  (this task) and footer rows (Task 12) MUST read differently — the
  group row's job is "what bucket are we in," the footer row's job
  is "what does this bucket sum to." Giving group rows the totals
  signature would erase that distinction.

### Tokens (committed to `tokens.css`)

**Light theme `.vg-theme-quartz`:**

| Token | Value | Why |
|---|---|---|
| `--vg-group-chevron-color` | `#475569` | Muted slate — same family as `--vg-totals-fg-muted`. Readable but not loud. |
| `--vg-group-count-color` | `#475569` | Same muted slate as chevron — the count is metadata, not the primary value. |
| `--vg-group-indent` | `14px` | One chevron-width per depth level — the chevron "stacks" cleanly under nested groups. |

**Dark theme `.vg-theme-quartz-dark`:**

| Token | Value | Why |
|---|---|---|
| `--vg-group-chevron-color` | `#94a3b8` | Pale slate matching `--vg-totals-fg-muted` dark. |
| `--vg-group-count-color` | `#94a3b8` | Same pale slate as chevron — preserves the muted/primary split. |

`--vg-group-indent` is unitless theme-agnostic (declared once at
`:root`-ish scope, not per-theme).

**Placeholders:**

```css
.vg-group-cell    { /* placeholder — renderer reads tokens via cssReader */ }
.vg-group-chevron { /* placeholder — color flows via theme.groupChevronColor */ }
.vg-group-indent  { /* placeholder — width flows via theme.groupIndent */ }
.vg-group-count   { /* placeholder — color flows via theme.groupCountColor */ }
```

### Layout

| Property | Value | Rationale |
|---|---|---|
| Row height | `var(--vg-row-height)` (32px) | Identical to body rows — group rows are the same height, not inflated |
| Top border | None | Group rows are NOT a region change. The totals/footer signature is reserved for synthesis rows. |
| Bottom border | None | Same reason — gridLine alone separates rows |
| Cell padding | 6px (body PADDING) | Body alignment, not header alignment |
| Indent per depth | 14px (`--vg-group-indent`) | One chevron-width — chevrons at depth 0..N stack visually |
| Chevron size | 12px | Slightly smaller than sort icon (14px) so it reads as "indicator, not control" |
| Chevron→value gap | 6px | Standard cell PADDING — matches text cell left padding so values align with same-column data |
| Value→count gap | 4px | Tight — the count belongs to the value, not floating |
| Font family | `var(--vg-font-family)` | Same monospace stack as body |
| Font size | `var(--vg-font-size)` (13px) | Same as body — doesn't shout |
| Font weight value | 400 (body weight) | NOT bolded. Structural cue is chevron + indent, not weight. |
| Font weight count | 400 (body weight) | Same weight as value — color carries the metadata distinction |
| Value color | `--vg-fg-color` (body fg) | Reads as data, not as a label |
| Count color | `--vg-group-count-color` (muted slate) | Metadata: visually subordinate to value |
| Chevron color | `--vg-group-chevron-color` (muted slate) | Indicator: visually subordinate to value |

### Chevron glyph

Two states: collapsed (`▶`-like, right-pointing) and expanded (`▼`-like,
down-pointing). Source: Lucide `chevron-right` (new path
`M9 18l6-6-6-6`) and existing `chevron-down` (`M6 9l6 6 6-6`). Same
stroke style + line-cap as the sort icon — vocabulary continuity with
the existing icon set.

**Rejected glyphs:**

- Unicode `▶`/`▼`: monospace stacks render these inconsistently across
  fonts; horizontal alignment drifts vs. SVG paths.
- macOS `›`/`⌄`: too light at 12px against a 13px body — would read as
  ornament, not control.
- Custom plus/minus (`+`/`−`): conflates "add" with "expand" and
  doesn't echo the existing chevron family (sort icons use chevrons).

### Group value formatting

The value text is the source column's `valueFormatter` output applied to
the raw group value. Examples:

- Group by `ticker` (string) → raw `'AAPL'` → formatted `'AAPL'`.
- Group by `notionalAmount` bucket → raw `50000` → formatted
  `'$50,000.00'` if the column's `valueFormatter` is the moneyFormatter.

Null / undefined group values render as `'—'` (em-dash) — matches the
Cycle 14 / Task 5 empty placeholder for totals cells. Single empty
glyph across the cycle vocabulary.

The count suffix is `(${childCount})` formatted via `toLocaleString()`
so 1,234 reads as `1,234`. Localized number formatting is the only
i18n hook on the renderer; everything else is theme-driven.

### States

| State | Treatment | Why |
|---|---|---|
| Default | chevron + indent + value + (count) | The full signature |
| Hover | NONE (Task 4) | No interaction wired yet; Task 7 may add a chevron hover hint |
| Focus | Inherits cell focus ring | Auto-group cells ARE selectable — focus ring paints unchanged |
| Selection | Inherits `rowSelectedBg` | Group rows participate in selection (Task 8 tri-state extends) |
| Empty group value (null / undefined) | Renders em-dash `—` | Matches Cycle 14 / Task 5 |
| Zero child count | Suffix omitted (no `(0)` text) | Empty groups shouldn't read as "I have zero children" — they shouldn't show a count at all |
| Data row | Renderer no-ops (paints nothing — bg already painted by row-bg bundle) | The auto-group column only "lights up" on group rows |

### Painter integration (canvasgrid specifics)

Canvasgrid paints to canvas, NOT DOM. The placeholder CSS selectors are
anchors only. The runtime path:

1. `cssReader.ts` exposes the new tokens on `ResolvedTheme` as
   `groupChevronColor`, `groupCountColor`, `groupIndent`.
2. `autoGroupColumn.ts` synthesizes the column def at construction time
   (when `rowGroupCols.length > 0`) with `colId: 'ag-Grid-AutoColumn'`,
   `headerName: 'Group'`, `cellRenderer: 'group'`,
   `valueGetter` returning the row's `groupValue` from the chunk.
3. `velocityGrid.ts` inserts the auto-group column at index 0 of
   `columnOrder` when grouping is active.
4. `cellAt(rowIndex, 'ag-Grid-AutoColumn')` reads the chunk's
   per-row group fields (`rowKinds[i]`, `groupDepth[i]`,
   `groupValue[i]`, `groupChildCount[i]`, `isExpanded[i]`) and
   returns a typed `GroupCellValue` object as the `value`.
5. The `'group'` cell renderer (`group.ts`) reads from `value` (a
   `GroupCellValue` object). On a data row (`rowKind === 0`) it
   paints nothing. On a group row (`rowKind === 1`) it paints the
   indent + chevron + value + (count).

### What's explicitly NOT shipped in Task 4

- No top / bottom border on group rows.
- No bg tint on group rows.
- No weight bump on the value.
- No row hover state.
- No chevron hit-test (lands in Task 7 — `groupExpand` feature).
- No `groupRows` full-row span variant (lands in Task 5).
- No multi-column auto-group variant (lands in Task 5).
- No tri-state checkbox in the group cell (lands in Task 8).
- No per-group footer rows (lands in Task 12).

### One-line summary

**The chevron + indent IS the chrome. Body cells stay empty. The grouped
grid reads as one page.**

### Vocabulary handed to subsequent tasks

- **`--vg-group-*` token family** is the single source for group-cell
  chrome decisions. Tasks 5–12 extend it as needed (Task 5 may add
  `--vg-group-row-full-bg` for the `groupRows` variant; Task 7 may
  add `--vg-group-chevron-hover-color` for hover hint; Task 8 may
  add `--vg-group-checkbox-indeterminate-color` for tri-state).
- **The "spine, not strip" pattern** — group rows carry chrome in
  the auto-group column ONLY, never row-wide — is the Cycle 15
  grammar. Task 12's per-group footer rows DEPART from this (they
  inherit the totals signature) because their job is synthesis, not
  navigation.
- **Em-dash placeholder** for null group values reuses the Cycle 14
  `'totals'` renderer's empty glyph — single empty vocabulary across
  cycles.
- **One chevron-width per depth** (14px) — the canonical indent.
  Tasks 5 (`multipleColumns`) and 10 (`groupRemoveSingleChildren`)
  inherit this unit.
- **Color split**: chevron + count = muted slate; value = body fg.
  Two-tier hierarchy with no third color introduced.

---

## Task 5 — `groupDisplayType: 'multipleColumns' | 'groupRows' | 'custom'`

**Brief recap:** Three alternatives to Task 4's `'singleColumn'` default —
one auto-group column per level, no auto-group column at all (full-row
strip), or fully app-owned. Same chevron family, same indent unit, same
muted slate split where it makes sense. The shapes diverge in WHERE the
structural cue lives — one column, N columns, or a strip — but the
visual atoms are reused so a user moving between modes recognises the
same grammar.

### Subject pin

A PM scanning a three-level grouped positions grid (`ticker` → `sector`
→ `subSector`). She picks the display mode that lets her current task
read best: collapse-and-scan a single spine (singleColumn, Task 4), see
every level at a glance (multipleColumns), or scan group LABELS without
column noise (groupRows). The display mode is a layout choice; the
content vocabulary stays constant.

### Variant 1 — `'multipleColumns'`

**What:** Synthesize one auto-group column per `rowGroupCols[i]`, in
order. Each column "owns" one group depth. Cells light up ONLY when the
row's depth matches that column's slot AND `rowKind === 1`.

**Indent: 0 within each column.** The column ORDER (column 1 = depth 0,
column 2 = depth 1, …) carries the hierarchy. A per-column indent of
`depth × 14px` would only ever pad uniformly within a column (because
that column always sees its own depth), so the indent would degrade to
"every cell padded by depth-of-this-column" — visual noise without
information. Each column's chevron sits flush at PADDING (6px) from the
left edge instead.

**Width per column:** ~140px each (`AUTO_GROUP_DEFAULT_WIDTH / 1.5`
rounded). A three-level grid produces 3×140 = 420px of group spine,
vs. 200px in singleColumn — wider because three values need to fit,
and each carries its own chevron. Apps override via
`autoGroupColumnDef.width` (applied uniformly to every synthesized
column when `'multipleColumns'`).

**Empty cells (data rows under leaf groups, group rows at OTHER
depths):** paint nothing — same rule as Task 4 data rows. Bg only.
Asked in the brief: do we tint the matching column to hint "this is
the active level"? **No.** The chrome IS the signal. Tinting would
fight the focus ring + selection bg and add a row-level visual that
the Task 4 plan deliberately rejected. The fact that exactly ONE auto-
group column carries chrome on each group row is the unambiguous level
hint.

**Vocabulary continuity:** same chevron glyph, same 12px size, same
muted slate, same em-dash for null values, same `(${count})`
formatting, same body fg / muted-slate split. Only the indent rule
differs (0 instead of `depth × 14px`).

| Token | Reuse | Reason |
|---|---|---|
| `--vg-group-chevron-color` | unchanged from Task 4 | One chevron family across the cycle |
| `--vg-group-count-color` | unchanged | Same muted-metadata role |
| `--vg-group-indent` | unused in this variant | Each column owns one depth |

**Width default rationale:** A trader's `ticker` value is ~4 chars; a
`sector` value is ~10 chars; a `subSector` value is ~14 chars. 140px
fits ~14 chars of monospace 13px + chevron + (count) without
truncation on the typical case. Wider levels (long sector names) get
ellipsified — the column is `resizable: true` so a drag fixes it.

### Variant 2 — `'groupRows'`

**What:** No auto-group column. Group rows render as a single
**full-row strip** spanning every band (left-pinned + center +
right-pinned). Data rows render normally with their per-column cells.

**Departure from Task 4's "spine, not strip" rule.** Task 4's
no-row-chrome bet held because the auto-group column carried the
signal and every other cell in a group row was empty. In `'groupRows'`
mode there ARE NO per-column cells, so "every other cell is empty"
disappears as a signal. The strip needs SOME structural cue —
otherwise group rows would blend into data rows above and below.

**Treatment:** a subtle row-bg shift via the new
`--vg-group-row-bg` token. Far lighter than the Cycle 14 totals
"hairline lift" (totals: 3% slate bg + top border + weight +1; group
rows: ~1.5% slate bg only, no border, no weight). Reserving the full
totals signature for per-group footer rows (Task 12) so the
synthesis-vs-navigation distinction lands cleanly.

| Token | Light | Dark | Why |
|---|---|---|---|
| `--vg-group-row-bg` | `#f1f5f9` | `#1e293b` | ~1.5% slate cast in light, paler slate in dark. Lighter than totals (`#f8fafc` / `#1e293b` per Cycle 14) so synthesis rows still read as the heaviest stripe in the column. |

**Strip composition:**
- Chevron at PADDING + `depth × 14px` from the row's left edge — SAME
  indent unit as Task 4. Nested groups indent visibly, matching the
  singleColumn vocabulary.
- Group value text at body weight, body fg.
- `(${count})` suffix in muted slate, body weight.
- NO top or bottom border (those belong to totals / footer).
- NO weight bump on the value (chevron + indent + bg shift = three
  cumulative cues; weight would be a fourth that fights).

**Span across bands:** the strip writes across all three bands
(left-pinned + center + right-pinned). The group row's bg + chevron +
value flow as one continuous strip; per-band clips do NOT subdivide
the strip's text. Selection bg on data rows DOES NOT apply to group
rows in this mode — `groupRowBg` wins because the row's "groupness"
takes precedence over data-row selection state.

**Alignment with data rows:** the chevron sits at PADDING (6px) from
the row's left edge — the same x-coordinate the leftmost data column's
first character would land at. Visually, the chevron column "is" the
data column's left padding for the strip. The user reads down a left
column of cells and sees chevrons interleaved at the same indent.

### Variant 3 — `'custom'`

**What:** Defers to `VelocityGridOptions.groupRowRenderer` — a registered
cell-renderer NAME (e.g. `'myAppGroupRow'`) the app pre-registers in
the `CellRendererRegistry`. Cgrid:
1. Allocates the full-row strip bounds (same as `groupRows`).
2. Sets the cell paint config with the `GroupCellValue` payload.
3. Calls the custom renderer for the strip.

**Treatment:** **fully transparent** — no row-bg shift from cgrid. The
custom renderer owns every pixel inside the strip. The motivation:
apps with bespoke group-row designs (icon + multi-line label, custom
expand affordance, embedded actions) need to control the full surface;
a cgrid-imposed bg would compete with their paint.

**Fallback:** when `groupDisplayType === 'custom'` AND no
`groupRowRenderer` is registered, the renderer falls back to the
default `'group'` renderer in groupRows mode (variant 2). This means a
half-configured app gets a sensible group-row strip instead of a
crash, and the per-grid setOption to swap renderers later works
without a transient broken paint.

**Why expose `'custom'` even before Task 12+ apps need it:** the
groupDisplayType union is publicly typed in `VelocityGridOptions`; shipping
`'custom'` as a no-op in Task 4 and only wiring it in Task 12 would
mean apps that opt in early would see broken paint. Wiring the renderer
chain now keeps the surface coherent.

### Shared rules across all three variants (and singleColumn)

| Atom | Rule |
|---|---|
| Chevron glyph | Lucide `chevron-right` / `chevron-down`, 12px |
| Chevron color | `--vg-group-chevron-color` (muted slate) |
| Count format | `(${count.toLocaleString()})`, omit at `count === 0` |
| Count color | `--vg-group-count-color` (muted slate) |
| Value color | body `fg` |
| Em-dash placeholder | `'—'` for null / empty group values |
| Row height | `var(--vg-row-height)` (32px) — no inflation for group rows |
| Sortable | `false` on synthesized columns (Task 11 lands sort) |

### Mode-by-mode comparison

| Property | `singleColumn` (Task 4) | `multipleColumns` | `groupRows` | `custom` |
|---|---|---|---|---|
| Auto-group columns | 1 at index 0 | N, one per `rowGroupCols[i]` | 0 | 0 |
| Row bg shift | none | none | `--vg-group-row-bg` | none |
| Indent unit | `depth × 14px` within the column | 0 (column owns one depth) | `depth × 14px` from row left | renderer-defined |
| Full-row strip | no | no | yes | yes |
| Data row chrome on auto-cols | blank | blank (N times) | n/a | n/a |
| Chevron family | Lucide chevron-right/down | same | same | renderer-defined |
| Vocabulary | spine | N spines | strip | open |

### Why this design avoids the AI default

The AI default for "multi-level grouping display" defaults to:
1. Heavy bolded group rows with bg shift in every variant (ag-grid's
   stock look).
2. A "tree view" affordance with explicit lines drawn between
   parent/child (the file-tree control look).
3. A horizontal pill bar per group level (the "Discord channel
   header" look).

All three put the structural cue in the row's chrome, fighting the
data cells' weight. The Task 4 plan rejected this in singleColumn;
Task 5 keeps the rejection where possible (multipleColumns, custom
default) and accepts the MINIMUM departure (groupRows: subtle bg
shift only) where the geometry FORCES it.

### What's explicitly NOT shipped in Task 5

- No tint on the active multipleColumns column.
- No top / bottom border on the groupRows strip.
- No weight bump on group values (any variant).
- No chevron hover hint (Task 7 — `groupExpand`).
- No tri-state checkbox in the strip / per-level columns (Task 8 —
  `groupSelectsChildren`).
- No ancestor-value display in multipleColumns (the chunk format
  doesn't carry ancestor values; Task 5 ships the "own-depth-only"
  shape). A future cycle can extend the chunk to carry ancestors if
  apps need that read.
- No per-group footer rows in any variant (Task 12).

### One-line summary

**Three modes, one vocabulary. The spine becomes N spines (multipleColumns),
a strip (groupRows), or an open canvas (custom) — chevron + indent +
value + (count) stay constant.**

### Vocabulary handed to subsequent tasks

- **`--vg-group-row-bg` token** — the ONE additional token Task 5
  introduces. Reused by Task 7 if a group-row hover hint lands at row
  level; reused by Task 10 if `showOpenedGroup` paints the expanded
  group's value on data rows under it.
- **"Own-depth-only" rule** for multipleColumns — the cleanest
  default given the current chunk format. Tasks 9 (`groupDefaultExpanded`)
  and 10 (`showOpenedGroup` / `groupRemoveSingleChildren`) inherit the
  rule unchanged.
- **Custom renderer fallback to `'group'` in groupRows mode** — the
  pattern for any future `'<role>RowRenderer'` option in velocity-grid:
  named-renderer lookup, fallback to the canonical default. Keeps
  half-configured grids from crashing.
- **groupRows DEPARTS from "spine, not strip"** by necessity, NOT
  preference. The departure is sized as small as possible (bg only,
  no border / weight) so the cycle's grammar still reads as one piece
  with a single conscious exception.

---

## Task 6 — Row group panel (drop strip above headers)

**Brief recap:** A horizontal DOM strip mounted ABOVE the column
header row. Hosts one chip per `rowGroupCols[i]` in nesting order.
Each chip: drag-handle `≡`, label, `×` remove button. Empty state
reads `Drag here to set row groups` (verbatim from the Cycle 11
sidebar Columns panel — same vocabulary). Users drag column headers
INTO the panel to add a group level, drag chips OUT (or click `×`) to
remove. The panel is functional, not decorative — it IS the
grouping-control surface.

### Subject pin

A trader / PM running a grouped fixed-income positions grid. She has
already decided to look at the universe by `Desk`. Now she wants to
add `Region` below it. The row group panel is the surface where she
makes that change without opening a dialog or context menu. The job
of the strip: make the active grouping legible AT A GLANCE (the chip
order IS the nesting order) and make the drop affordance obvious
without competing for attention with the column header row directly
below it.

### Existing vocabularies considered

Two prior surfaces could shape the row group panel:

1. **Cycle 11 sidebar Columns panel — `.vg-columns-panel-drop-zone`**
   - dashed border (`1px dashed border-color @ 80%`)
   - 4px radius, 12px padding, centered text, opacity 0.7
   - placeholder text `Drag here to set row groups` / `Drag here to aggregate`
2. **Cycle 13 status-bar — `.vg-status-bar`**
   - 28px height, three-zone flex layout
   - header-bg, hairline border (top OR bottom)
   - body text is `user-select: none`; the strip reports state

**Does the row group panel match either? Partly. Mostly its own thing.**

| Element | Inherits from | Why |
|---|---|---|
| Strip background | Status-bar `--vg-header-bg` | The panel is a controls strip in the same family — sandwich language |
| Strip border-bottom | Status-bar's hairline rule | Separates from column headers below |
| Empty-state dashed border | Sidebar drop-zone | "This surface accepts drops" reads consistently across surfaces |
| Empty-state placeholder text | Sidebar drop-zone, verbatim | One drop-zone vocabulary — `Drag here to set row groups` |
| Chip separator `›` | Task 4 chevron-right (Lucide) | One chevron family across the cycle |
| 4px radii | Sidebar drop-zone + sort-arrow chip | One radius vocabulary for grid chrome |
| Chip shape | NEW | Nothing else in the grid is a draggable label with a remove `×` |

The chip is the new vocabulary. Nothing else in cgrid is a draggable
label with a remove affordance — sidebar rows aren't draggable in the
strip sense; status panels never carry interaction. Inventing a chip
shape was unavoidable; everything around the chip cites prior art.

### Default rejected

AI defaults for "chip strip with drag-and-drop":

1. **Filled pills** — solid-bg rounded chips with white text. Loud;
   reads as a "tag input" or "search filter pills." Fights the
   header chrome below it.
2. **Material chips** — light gray bg, 8dp corners, drop shadow.
   Carries Material-Design connotations cgrid doesn't ship.
3. **Pure-text breadcrumb** — `Desk › Region › Type` as plain text,
   each segment clickable. Drops the drag handle + remove affordance;
   the user can't tell at a glance that this is interactive.

All three either over-shout (filled / Material) or under-signal
(text breadcrumb) the chip's INTERACTIVE nature. The chip needs to
read as "this is a control I can grab and drop" without becoming
the loudest thing on the page.

### Risk taken

**Outline chips, no fill.** 1px border, transparent bg, 4px radius.
The default chip is a filled pill; I'm shipping outlined tokens.

Why:
- The strip carries 1–N chips in series. Filled chips at strip
  density (≥3 chips visible) would stack as a wall of color blocks
  in the header zone, fighting the actual column headers underneath.
- Outlined chips read as **tokens in a sentence** — the user reads
  `≡ Desk × › ≡ Region × › ≡ Type ×` as a single grammatical
  phrase (the active grouping expression), with each chip as a token.
  That mental model matches what the chip IS — an entry in the
  grouping order.
- Hover lifts the chip with a faint background tint (`color-mix`
  header-bg toward fg @ 8%). The chip stays the same shape but
  visibly activates — interaction signaled by elevation, not by
  changing identity.

The bet: outlined chips read as more disciplined, more spreadsheet-
appropriate, and less Material than the default. If the strip looks
like a search-filter pill bar — back to step 1.

### Tokens (committed to `tokens.css`)

```css
.vg-row-group-panel {
  --vg-row-group-panel-height: 32px;
  --vg-row-group-panel-padding-x: 8px;
  --vg-row-group-panel-gap: 6px;
  --vg-row-group-chip-height: 22px;
  --vg-row-group-chip-radius: 4px;
  --vg-row-group-chip-padding-x: 6px;
  --vg-row-group-chip-gap: 4px;
  --vg-row-group-chip-bg: transparent;
  --vg-row-group-chip-border: var(--vg-border-color);
  --vg-row-group-chip-fg: var(--vg-fg-color);
  --vg-row-group-chip-hover-bg:
    color-mix(in srgb, var(--vg-header-bg) 92%, var(--vg-fg-color) 8%);
  --vg-row-group-chip-active-bg:
    color-mix(in srgb, var(--vg-header-bg) 85%, var(--vg-fg-color) 15%);
  --vg-row-group-panel-empty-fg:
    color-mix(in srgb, var(--vg-fg-color) 60%, transparent);
  --vg-row-group-panel-drop-border: var(--vg-focus-ring-color);
}
```

`--vg-row-group-chip-separator-color` reuses `--vg-group-chevron-color`
from Task 4 — one chevron family across the cycle.

### Layout

| Property | Value | Rationale |
|---|---|---|
| Panel height | `32px` | Matches body row height — same vertical rhythm as the data grid |
| Panel padding-x | `8px` | Slight inset so chips don't kiss the edge |
| Panel bg | `var(--vg-header-bg)` | Status-bar family — controls strip vocabulary |
| Panel border-bottom | `1px solid var(--vg-border-color)` | Hairline rule separates from column headers below |
| Panel gap (chip-to-chip) | `6px` | Enough breathing room that two chips don't kiss; tight enough that the `›` separator inside reads as belonging to the pair |
| Chip height | `22px` | Header-zone control, not a data row — half-height of the row |
| Chip radius | `4px` | Matches drop-zone radius + sidebar control radii |
| Chip padding-x | `6px` | Matches body cell padding for vertical alignment with text below |
| Chip internal gap | `4px` | Tight grouping: `≡` `label` `×` reads as one unit |
| Chip border | `1px solid var(--vg-border-color)` | Hairline outline — quietest control affordance |
| Chip bg default | `transparent` | OUTLINED tokens, not filled pills |
| Chip bg hover | mix header-bg @ 92% + fg @ 8% | Faint tint lights up without changing identity |
| Chip bg active | mix header-bg @ 85% + fg @ 15% | Slightly stronger during mousedown/drag |
| Chip label font | `var(--vg-font-family)` | Same mono stack as body |
| Chip label size | `12px` | Smaller than body (13px) — header-zone control |
| Chip label weight | `400` | Same as body — color carries the chip's identity, not weight |
| Separator `›` | reuse Task 4 chevron color, 10px size | One chevron family; smaller than group-cell chevron because here it's typographic punctuation |
| Empty-state height | matches panel | Full-strip dashed outline reads as one drop target |
| Empty-state border | `1px dashed`, inset 4px | Sidebar drop-zone vocabulary, scoped to panel interior |
| Empty-state text | `12px`, opacity-60 | Placeholder — never reads as content |

### Chip composition

```
┌───────────────────┐
│ ≡  Desk        ×  │   ← chip at rest, 22px tall
└───────────────────┘
```

| Slot | Glyph | Source | Why |
|---|---|---|---|
| Drag handle | `≡` (U+2261 IDENTICAL TO) | Unicode — same family as sidebar `'columns'` icon `☰` | Quietly signals "grab here"; same vocabulary as Cycle 11 |
| Label | column's resolved `headerName` | grid columnDef | Matches what the user sees in the header below |
| Remove | `✕` (U+2715 MULTIPLICATION X) | Unicode — crisper than `×` (U+00D7, a math sign) | One-stroke remove glyph; reuses the same `✕` used by Cycle 11 chips and dialog close buttons |

The drag handle uses `cursor: grab` (transitions to `grabbing` while
dragging). The `×` uses `cursor: pointer`. The label between them is
inert (no cursor change) — only the affordances at the chip's edges
respond to hover.

### Chip separator (between adjacent chips)

The separator is a `›` chevron painted BETWEEN chips, in the panel's
gap. NOT inside the chip itself — that would make the chip read as
"a label with a trailing arrow," conflating chip and separator. The
`›` belongs to the GAP, not to either chip.

| Property | Value | Rationale |
|---|---|---|
| Glyph | `›` (U+203A) — single-right-pointing angle quotation mark | Same chevron family as Task 4; lighter than `▶` so it reads as punctuation, not as a chevron control |
| Size | `10px` | Smaller than group-cell chevron (12px) — typographic punctuation, not interactive |
| Color | `--vg-group-chevron-color` (muted slate) | Reuses Task 4 token verbatim — one chevron family |
| Margin | absorbed by panel gap | Doesn't add its own spacing — sits in the 6px gap centered |

**Rejected alternatives:**
- Vertical rule `|` — neutral but mute; doesn't carry the "ordered"
  meaning the user needs to read from the chip sequence.
- No separator — chips merge visually; the eye doesn't read the
  sequence as nesting order, just as a set.
- `▸` (U+25B8) — too solid; looks like a tree-control glyph, not
  typographic punctuation.

### Drop indicator (during column header drag)

Two visual cues during a drag:

1. **Panel-level dashed outline** — when the dragged column has
   `enableRowGroup: true` AND its colId is NOT already in
   `rowGroupCols`, the entire panel paints a `2px dashed
   var(--vg-row-group-panel-drop-border)` outline (inset 2px). Signal:
   "this surface accepts the drop."
2. **Vertical insertion line** — at the position where the chip will
   land. Reuses the same `.vg-column-drag-insertion-line` pattern
   from Cycle 6 (2px wide, focus-ring color), but scoped to the
   panel's vertical band. Painted between chips at the gap mid-point,
   or at the panel's right edge when appending.

**Rejected:** dashed outline alone (no precise drop point); insertion
line alone (no "this whole strip accepts drops" signal); a third
hover state on the panel bg (would compete with the chip hover state).

When the dragged column has `enableRowGroup: false`, the panel paints
the dashed outline in a MUTED variant (`--vg-fg-muted` @ 30%) — a
visual rejection signal that's clearly NOT the focus-ring blue. The
drop handler rejects the same colId, so the visual + behavioral
signals agree.

### Empty state

When `rowGroupCols.length === 0` AND `rowGroupPanelShow === 'always'`
(the only mode that shows the panel without grouping active), the
panel renders a single full-strip placeholder:

```
┌─────────────────────────────────────────┐
│ ┌── Drag here to set row groups ─────┐  │
│ └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

| Property | Value |
|---|---|
| Border | `1px dashed color-mix(in srgb, var(--vg-border-color) 80%, transparent)` — same as sidebar drop-zone |
| Border radius | `4px` |
| Inset from panel edge | `4px` top/bottom, `8px` left/right (matches panel padding) |
| Text | `Drag here to set row groups` — VERBATIM from sidebar |
| Text alignment | centered |
| Text size | `12px` |
| Text color | `--vg-row-group-panel-empty-fg` (60% fg) |

Vocabulary continuity is the goal: a user who has seen the sidebar's
Row Groups drop zone recognises this strip as the same affordance,
just inline at the top of the grid rather than docked to the right.

### Mode-by-mode behaviour

| `rowGroupPanelShow` | rowGroupCols empty | rowGroupCols non-empty |
|---|---|---|
| `'always'` | strip + empty-state placeholder | strip + chips |
| `'onlyWhenGrouping'` | hidden (no reservation) | strip + chips |
| `'never'` (default) | hidden | hidden |

`rowGroupPanelSuppressSort: true` hides any sort indicator inside
the chip (Cycle 16+ extension — Cycle 15 chips don't carry a sort
indicator yet, so this flag is wired but no-op visually).

`enableRowGroup` is a per-column flag. The default is `false`
(matches ag-grid). When `false`, the chip's `×` removal still works
(removing a column from `rowGroupCols` always succeeds), but the
column header CAN'T be dragged INTO the panel — the drop handler
rejects.

### What's explicitly NOT shipped in Task 6

- No chip sort indicator (`rowGroupPanelSuppressSort` is wired but
  visually inert in Cycle 15 — the chip ships without a sort glyph).
- No chip-internal reorder via drag (Cycle 15 ships chip
  drag-OUT-to-remove + column-header drag-IN-to-append; chip-to-chip
  reorder lands in a polish task).
- No keyboard nav across chips (focus-management for the chip strip
  is a Cycle 16+ a11y task; today the chip's `×` button is
  keyboard-activatable but tab order isn't curated).
- No animation on chip add/remove (insertion is instant — the
  insertion line + drop-into-panel motion already shows where the
  chip will appear; an animation would feel redundant).
- No per-chip context menu (right-click on a chip is a no-op in
  Cycle 15).

### One-line summary

**Outlined tokens in the header zone, chevron-separated, with a
sidebar-vocabulary empty state. The chip is the grouping
expression — read left to right.**

### Vocabulary handed to subsequent tasks

- **Outlined-chip pattern** — 4px radius, 1px border, transparent
  bg, hover-tint via `color-mix`. Future Cycle 16+ surfaces (column
  filter chips, pivot column chips, value chips) inherit this shape
  so the grid speaks one chip language.
- **`›` separator at panel gap, NOT inside chip** — applies to any
  future ordered-token strip in the grid.
- **Empty-state vocabulary** — verbatim `Drag here to set row groups`
  (and the parallel `Drag here to aggregate` from sidebar) is the
  canonical drop-zone copy. Future drop zones reuse the same phrasing.
- **Dashed panel outline = "drop OK"; muted-dashed outline = "drop
  rejected"** — applies to any drop-accepting surface added later.
  Separates "this surface accepts drops" from "this specific drop
  would fail" without a third color (rejection isn't red — it's
  just unsaturated focus).
- **Status-bar sandwich pattern extends** — the row group panel is
  the second strip in the family (after the status bar). A future
  "row drag panel" or "filter chip strip" would join the same
  vocabulary (header-bg + hairline border + 28–32px height).

---

## Task 7 — Expand/collapse interaction

**Brief recap:** The auto-group column (Task 4) paints chevron +
indent + value + (count). Task 7 makes the chevron click-toggle a
group's expanded state. Three axes to decide: hit zone, hover state,
animation. Subject pin is the same trader / PM scanning the universe
from Task 4 — a power-user tool, not a polished consumer demo.

### Default rejected

The generic AI default for "tree-node expand" is the full bundle:
200 ms chevron rotate, faint bg-tint hover, `cursor:pointer` on the
whole cell, sometimes a focus ring on the chevron. It reads as
"polished web app." Three problems for canvasgrid:

1. **Full-cell hit zone collides with text selection.** The group
   value text in the cell would be unreachable for copy / range-select
   gestures because every click would toggle. Power users expect to
   click data; chevron-click for toggle is a separate intent.
2. **Bg-tint hover breaks Task 4's risk.** Task 4 ships a
   deliberately quiet group row — no bg shift, no border, no weight
   bump. A hover bg tint reintroduces row chrome on every
   mousemove and erases that signal.
3. **Per-row canvas repaints are expensive.** Hover color bumps and
   200 ms rotations both require per-frame chunk walks on a canvas
   grid. The cost compounds as the user scans (mousemove on every
   group row).

### Decisions

| Axis | Pick | Why |
|---|---|---|
| **Hit zone** | chevron bbox + 4 px pad each side (≈ 20 × 20 px), vertical = full row height | Bigger than the 12 px glyph (Fitts's law friendly), still bounded so the value text + indent space stay non-interactive. Indent space is breathing room, not a click target. |
| **Hover** | `cursor: pointer` over the hit zone only. No color bump. No bg tint. | The cursor signals interactivity globally; the chevron glyph itself signals it per cell. No canvas repaint on mousemove — hit-test runs in the existing `onHover` chain and only the DOM cursor changes. Preserves the Task 4 "no row chrome" risk. |
| **Animation** | None. Instant glyph flip + instant row reflow. | Matches the trader's mental model: click = section opens NOW. A 200 ms rotate would force per-frame canvas paints across every toggling group; an instant flip costs one paint. Reduce-motion is honored by default (there is no motion to suppress). |

### Risk taken

The pure-instant flip with no chevron-hover state is the louder
risk. Every modern UI library tints chevrons on hover and animates
the rotate. The bet: in a canvas grid built for power users, the
cursor change alone IS the affordance. A trader who's already
filtered, sorted, and grouped a million rows doesn't need a 200 ms
animation telling them "good job, the section opened." They need
the section to open.

### Reusable vocabulary

- **Hit zones around glyphs** = glyph bbox + 4 px pad each side. Future
  affordances (Task 8's tri-state checkbox, Cycle 16's master/detail
  expand) inherit this default size.
- **`cursor: pointer` is the canonical hover affordance for
  click-only zones.** Bg tint reserved for selection / focus / data
  rows; cursor reserved for "this glyph is a control."
- **No animation by default in canvasgrid.** Instant state flip is
  the house style. Future toggle / expand affordances start from
  the same null-animation baseline; animations are added only when
  a specific subject demands them.
- **Hit-test lives in a feature** (`GroupExpandFeature` in the chain).
  It runs ahead of `EditTrigger` / `CellSelection` so a click on
  the chevron doesn't open the editor or change the selection.

---

## Task 8 — `groupSelectsChildren` + tri-state checkbox

**Brief recap:** When the new `groupSelectsChildren: true` option is
on, every group row in the auto-group column paints a tri-state
checkbox alongside the existing chevron + indent + value + (count).
Three states: `'none'` (no descendant selected) / `'all'` (every
descendant selected) / `'partial'` (some but not all). Click toggles
the group's effective state and cascades to descendants. Vocabulary
must read distinctly across the three states at body-row font size
(13 px) and the 14 px checkbox box used by the existing
`checkboxCell` painter — without violating the Cycle 15 "spine, not
strip" rule (no row chrome on group rows).

### Subject pin

The same trader / PM running a fixed-income positions grid grouped
by `ticker`. She's pruning the universe to a curated set —
clicking a few group checkboxes to "select all of AAPL + all of
MSFT + just two TSLA positions." A few seconds later she'll
right-click → "Export selected to CSV." The tri-state checkbox is
her bulk-selection lever: she needs to see at a glance which groups
are fully in, fully out, or mixed. The indeterminate state is the
load-bearing signal here — it's the difference between "I already
picked everything in this group" and "I picked some, and I need
to dig in."

### Default rejected

AI defaults for "tri-state group checkbox" cluster on three looks:

1. **Filled blue check + filled blue dash** — checked state fills
   the box with brand-accent blue and paints a white check;
   indeterminate uses the same fill with a white dash. Reads
   confident but adds two new color stops to a grid that has so
   far stayed two-tier (body fg + muted slate). The blue fill on
   every selected group row competes with the data rows below
   for visual weight.
2. **Half-fill indeterminate** — bottom half (or top half) of the
   box is filled. Reads as a progress meter, not as "mixed."
   Universally confusing for the indeterminate case.
3. **Different shape entirely** — a square inside a square, a
   dot inside a circle, a diamond. Unrecognizable; users have to
   re-learn what "mixed" means in this grid.

All three either add color stops the cycle has deliberately avoided
(option 1) or break vocabulary the user already knows (options 2 / 3).

### Risk taken

**The checkbox does NOT fill on 'all' — it uses the same outlined
box as the existing `checkboxCell`, distinguishing the three states
by SHAPE alone: empty / checkmark / horizontal dash.** Same stroke
color in all three states (body fg).

This is deliberately quieter than the standard "filled-accent on
checked" pattern. The bet: the grouped grid already reads as one
cohesive page; the checkbox is row-anchored chrome, not a data
value. A filled blue box on every selected group row would
reintroduce row chrome — exactly what Task 4 explicitly rejected.
The outlined box (matching the existing `checkboxCell` painter
verbatim) keeps the grid quiet AND reuses the visual vocabulary
the user already learned in the `confirmed` column demo.

The dash IS the indeterminate signal — universally learned from
Excel + macOS Finder. A dash inside an outlined box reads as
"mixed" with zero ambiguity, AND it costs zero new color tokens.

### Layout — checkbox slots BETWEEN chevron and value

```
[indent: depth × 14] [chevron: 12] [gap: 6] [checkbox: 14] [gap: 6] [value] [gap: 4] (count)
```

Three layout positions were considered:

| Option | Layout | Verdict |
|---|---|---|
| Before chevron | `[indent][checkbox][gap][chevron][gap][value]…` | Chevron geometry from Task 4 / Task 7 is load-bearing — `velocityGrid.ts:3953-3960` mirrors PADDING + CHEVRON_SIZE + INDENT_UNIT constants for the chevron-click hit-test. Drifting the chevron x-position requires parallel updates across painter + hit-tester. Rejected on coupling cost. |
| Row left edge | `[checkbox][gap][indent][chevron][gap][value]…` | Decouples checkbox from depth — every group's checkbox lands at the same x-coord regardless of nesting. Breaks the "depth → toggle → select" left-to-right reading; user can't tell at a glance which depth a checkbox belongs to. Rejected. |
| **Between chevron and value** | `[indent][chevron][gap][checkbox][gap][value]…` | **Chosen.** Preserves chevron geometry from Task 4/7 — no constants drift. Checkbox + chevron read as paired group controls (expand vs select), sitting next to each other but not sharing an affordance. Reads as "depth → toggle → select → identify" left to right. New checkbox hit zone (14 px box + 4 px pad each side ≈ 22 × 22) doesn't intrude on the chevron's existing 20 × 20 hit zone. |

### Tokens (committed to `tokens.css`)

| Token | Light | Dark | Why |
|---|---|---|---|
| `--vg-group-checkbox-size` | `14px` | `14px` | Identical to existing `checkboxCell` hard-coded 14 — one box vocabulary across the grid |
| `--vg-group-checkbox-border-color` | `var(--vg-fg-color)` | `var(--vg-fg-color)` | Same border as existing `checkboxCell` — visual continuity |
| `--vg-group-checkbox-fill` | `transparent` | `transparent` | Outlined, never filled — preserves "no row chrome" rule |
| `--vg-group-checkbox-check-color` | `var(--vg-fg-color)` | `var(--vg-fg-color)` | Same as existing check stroke — one checkmark vocabulary |
| `--vg-group-checkbox-indeterminate-color` | `var(--vg-fg-color)` | `var(--vg-fg-color)` | Same color as check; SHAPE carries the distinction (dash vs √) |
| `--vg-group-checkbox-gap` | `6px` | `6px` | Matches `CHEVRON_GAP` from Task 4 — one gap rhythm |

All five color tokens default to `var(--vg-fg-color)` deliberately —
the indeterminate state is differentiated by SHAPE (horizontal dash
vs check √), not by hue. This keeps the two-tier color hierarchy
(body fg + muted slate) intact and matches the existing
`checkboxCell` painter's "outlined, single color" treatment.

Apps that want a brand-accent fill on the checked state override
`--vg-group-checkbox-fill` + `--vg-group-checkbox-check-color`;
nothing in cgrid forces the outlined look.

### Box composition (per state)

```
'none'             'partial'          'all'
┌──────┐           ┌──────┐           ┌──────┐
│      │           │ ──── │           │   ╱  │
│      │           │      │           │  ╱   │
└──────┘           └──────┘           └─╱────┘
```

- Box: 14 × 14, 1 px stroke border in `--vg-group-checkbox-border-color`,
  positioned via the same `cx + 0.5 / cy + 0.5` integer-pixel snap as
  the existing `checkboxCell`.
- 'all' check: same √ polyline as the existing `checkboxCell`
  (`cx+3, cy+size/2 → cx+size/2-1, cy+size-3 → cx+size-2, cy+3`),
  stroked at the same 1 px stroke. Same shape so a `confirmed` cell
  and a fully-selected group cell carry the same checkmark glyph.
- 'partial' dash: a single horizontal stroke from `cx + 3` to
  `cx + size - 3` at `cy + size/2`, stroked at the same 1 px width.
  Centered vertically; spans the box's interior width minus 3 px
  on each side (matches the check's interior padding).
- 'none': no interior paint. Border-only outlined box.

The dash and check NEVER paint together — the renderer picks one
or the other based on `groupValue.selectionState`.

### Cascade behaviour (selection model contract)

When `groupSelectsChildren: true` AND the user clicks a group
checkbox:

- `'none' → 'all'` — select every descendant leaf row.
- `'all' → 'none'` — deselect every descendant leaf row.
- `'partial' → 'all'` — top-up: select the descendants that
  weren't already selected. Matches the Excel / macOS / ag-grid
  convention (a mixed group "completes" on first click).

The leaf-row toggle path (clicking a data row's selection
checkbox, where one exists) does not cascade upward
explicitly — the group's effective state is recomputed every
paint from `selectionState = none / partial / all` against the
descendant set. So deselecting one leaf row of a fully-selected
group naturally flips the group to `'partial'` without any
extra event plumbing.

### Hit zone + interaction

| Axis | Pick | Why |
|---|---|---|
| **Hit zone** | checkbox bbox + 4 px pad each side (≈ 22 × 22 px), vertical = full row height | Mirrors Task 7's chevron hit-zone rule (glyph bbox + 4 px pad). The vertical-full-row band catches near-misses without competing with the value text's selection target. |
| **Hover** | `cursor: pointer` over the hit zone only. No color bump. No bg tint. | Mirrors Task 7 — the cursor is the affordance signal; no canvas repaint on mousemove. Preserves the "spine, not strip" rule. |
| **Animation** | None. Instant state flip. | Mirrors Task 7. A 200 ms checkbox fill animation across N group rows would cost N per-frame repaints during a "select all" cascade. |

The hit-test lives in the same `GroupExpandFeature` chain link
that Task 7 wired — the feature inspects the click x to decide
which control (chevron vs checkbox) was hit, falling through to
the next feature when neither was hit. One feature owns all
auto-group-cell click intent.

### What's explicitly NOT shipped in Task 8

- No focus ring on the checkbox glyph (Task 8 leaves the cell's
  focus ring as the only focus indicator — adding a per-glyph ring
  would double up).
- No keyboard activation (space-bar to toggle a focused checkbox)
  — Cycle 15 doesn't ship per-glyph keyboard nav inside cells.
  Cycle 16+ a11y task.
- No leaf-row checkbox renderer (group rows ONLY in Cycle 15 —
  data-row checkboxSelection is a Cycle 16+ feature).
- No animation on cascade — a "select all" of 10 000 descendants
  flips the model state in one go; the next paint reflects it.
- No "click anywhere on group row to select" — only the checkbox
  hit zone toggles selection; the rest of the cell still
  behaves per Task 7 (chevron hit + value selectable).

### One-line summary

**The group checkbox is the same outlined box as the existing
checkbox cell — checkmark when 'all', horizontal dash when 'partial',
empty when 'none' — slotted between the chevron and the value so
depth → toggle → select → identify reads left to right.**

### Vocabulary handed to subsequent tasks

- **Tri-state-by-shape rule** — boolean and tri-state checkboxes in
  this grid differentiate states by interior shape (empty / check /
  dash), not by hue or fill. Cycle 16's leaf-row checkboxSelection
  inherits the same outlined box.
- **`--vg-group-checkbox-*` token family** — extensibility hook for
  apps that want a themed checkbox; defaults preserve the outlined
  vocabulary.
- **Cascade math lives in the SelectionModel**, not the renderer —
  the renderer reads `selectionState: 'none' | 'partial' | 'all'`
  from the cell payload and paints. The model owns the
  descendant-resolution + cascade logic.
- **One hit-zone vocabulary for auto-group cells**:
  `GroupExpandFeature` adds a checkbox hit lane next to the chevron
  hit lane. Any future auto-group-cell glyph (Cycle 16 master /
  detail expand, Cycle 18 pivot column reorder) plugs into the same
  feature.

---

## Task 10 — `showOpenedGroup` + `groupRemoveSingleChildren`

**Brief recap:** Two polish flags on an existing surface. `groupRemoveSingleChildren`
prunes single-descendant groups from the visible tree so a chain that
funnels down to one row collapses away entirely. `showOpenedGroup` keeps
the user oriented as they scroll inside a long expanded group: every
DATA row's auto-group cell echoes its leaf-parent group's value (no
chevron, no count — just the label) so the trader looking at row 482 of
"APAC → Rates" still sees `Rates` in the column spine.

### `groupRemoveSingleChildren` — pure worker concern, zero new chrome

The elision is invisible to the renderer: an elided group's data row
just doesn't get a preceding group entry in `flatOrder`. It paints as a
normal data row at the row's natural slot — no chevron, no indent
inside the auto-group column, no special bg. The user reads the spine
as cleaner: chains that would have shown `APAC ▸ Rates ▸ Swap ▸ (1 row)`
collapse to just the row.

**Elision rule:** elide ANY group whose recursive `childCount === 1`.
This matches the spec's literal reading and naturally handles chains
— if every level above a singleton row also has childCount 1, the
whole chain elides together. Multi-row groups stay (`childCount > 1`),
and groups with multiple sub-groups stay (their childCount is the sum
of all descendant leaves, > 1). No design pass needed: the only
visual delta is "fewer rows on screen."

### `showOpenedGroup` — cell composition DOES change, light design pass

This is the design-touched bit. Data rows in the auto-group column
have so far painted nothing (Task 4: "the chevron + indent IS the
chrome; body cells stay empty"). `showOpenedGroup: true` reintroduces
text on those data rows — the smallest possible reintroduction:

**Layout for a data row under an expanded group:**

```
[indent: (depth − 1) × 14px] [value text, muted]
```

- **No chevron.** Data rows are not toggle targets; painting a chevron
  glyph would falsely suggest interactivity. Reusing the chevron
  vocabulary here would also collide with Task 7's chevron hit-zone.
- **No (count).** The count is metadata about the group's
  descendants — a data row IS one of those descendants; echoing the
  count on every descendant reads as visual noise.
- **No checkbox.** Tri-state belongs to the group row only (Task 8).
  Data-row selection is a Cycle 16+ feature.
- **Indent matches the leaf group's indent** (one chevron-width less
  than the data row's nominal depth). The data row's "opened-group"
  label visually sits where the leaf group's value sits — a vertical
  echo, not a different column lane.
- **Muted text color** — reuses `--vg-group-count-color` (the existing
  muted slate). The label is metadata about the row's parent, not a
  primary value; same color family as the chevron + count so the spine
  reads as one vocabulary. No new token introduced.

**Why muted, not body fg:** the data row's REAL data sits in the other
columns and should remain the loudest thing on the row. Painting the
opened-group label at body weight + body fg would make every data row
shout the same group name down the column — exactly the visual noise
the design wants to avoid. Muted text reads as "ambient orientation,"
not as repeated data.

**Multi-column / strip-mode interaction:** `showOpenedGroup` only
paints in `'singleColumn'` mode. In `'multipleColumns'` each per-level
column already carries its OWN depth's label on group rows; echoing
the leaf group's value on data rows would conflict with the column
ownership rule (Task 5 — "each column owns one depth"). In
`'groupRows'` / `'custom'` modes there is no auto-group column at all,
so there's nowhere to paint the echo. The renderer's existing
`ownDepth !== null` check (Task 5) returns early for data rows in
multipleColumns; the strip modes don't reach the per-cell renderer at
all for data rows.

**Worker-side support:** the slicer needs to know the parent group's
formatted value for each data row in the chunk window. We piggyback
on the existing `chunk.groupValue[i]` slot — currently empty for data
rows, now populated with the most-recent-group value when
`showOpenedGroup: true`. Implementation: walk visibleOrder up to the
chunk's end tracking `lastSeenGroupKey`; for each data row, resolve
its leaf-parent value via the existing `groupMeta` lookup. This
naturally handles elision (a row promoted past an elided ancestor
inherits the highest non-elided ancestor's label) and collapsed-window
slicing (the walk starts from index 0 each call so a chunk mid-list
sees the correct preceding group).

### Decisions summary

| Axis | `groupRemoveSingleChildren` | `showOpenedGroup` |
|---|---|---|
| Worker change | yes — `GroupPass.apply` skips group entries in flatOrder when `childCount === 1` | yes — slicer populates `groupValue[i]` for data rows |
| Renderer change | none (elided rows paint as data rows) | yes — paints muted label on data rows with non-empty `groupValue` |
| New token | none | none — reuses `--vg-group-count-color` |
| Mode coverage | every display mode (purely tree-shape) | `'singleColumn'` only |
| Hit-test change | none | none (label is non-interactive) |

### What's explicitly NOT shipped in Task 10

- `groupRemoveLowestSingleChildren` (the level-restricted variant).
  Out of scope for Cycle 15; deferred to a follow-up cycle if the
  feature matrix demands it.
- `showOpenedGroup` in `'multipleColumns'` mode. Each column owns one
  depth; echoing the leaf-parent's label on data rows would conflict
  with the column ownership rule.
- A separate `--vg-group-opened-fg` token. The opened-group label
  reuses `--vg-group-count-color` so the muted-slate family stays a
  single source for "metadata on a group row" colour decisions.
- Runtime mutation of either option. Both are init-time options
  (matches the Task 9 `groupDefaultExpanded` pattern); `setGridOption`
  rejects post-construction swaps. Apps that need runtime control can
  swap via `setGroupModel` + rebuild.

### One-line summary

**Elision tightens the spine; opened-group orients the eye.
Both stay quiet — elision adds nothing visible, opened-group adds a
muted echo at the leaf indent.**

### Vocabulary handed to subsequent tasks

- **Elision happens in `GroupPass.apply` (flatOrder build), NOT in
  the tree shape.** Future polish flags (`groupRemoveLowestSingleChildren`,
  pivot-row elision) follow the same pattern: keep the tree intact,
  filter the flat traversal.
- **"Data rows can borrow the auto-group cell"** — `showOpenedGroup`
  is the first feature that paints anything on a data row's auto-
  group cell. The renderer's `rowKind === 0` short-circuit now has a
  `valueFormatted !== ''` escape hatch. Cycle 16+ master/detail
  expand can reuse the same escape hatch (an expanded master row
  could paint a detail-toggle glyph in the same slot).
- **Reuse `--vg-group-count-color` for any muted, non-interactive
  text on a group / data row.** Don't introduce per-feature mute
  tokens — the muted family stays one colour.

---

## Task 12 — Group totals (footer rows)

**Brief recap:** Per-group footer rows render under each EXPANDED group. They
aggregate that group's descendant leaf rows via the same `AggPass` +
`AggFuncRegistry` the grand-total subgrid uses (Cycle 14 / Task 1), and they
INHERIT the Cycle 14 totals signature ("hairline lift": 3% slate tint + 1 px
top rule + +1 font-weight stop) so the user reads the same vocabulary across
data → group spine → footer → grand total. The auto-group cell on a footer
row paints `Total ${groupValue}` at the parent group's indent depth — anchor
so the eye can trace the synthesis back to its bucket.

### Subject pin

The same fixed-income trader from Tasks 4 / 8 / 11. She's grouped positions
by `Desk` → `Region` → `Instrument Type`, expanded `Rates → APAC`, and is
scanning P&L per instrument type. Three things she needs to read at once,
without flipping mental contexts:

1. **The per-instrument-type P&L** (data rows).
2. **The APAC region's aggregated P&L** (Total APAC — the row directly under
   APAC's children).
3. **The Rates desk's aggregated P&L** (Total Rates — the row directly
   under all regions of Rates), and the grand total at the very bottom.

The footer rows are the load-bearing element. Their job is to surface the
"$X for THIS bucket" answer in the same column-aligned position the data
rows surface "$X for ONE instrument" — so the trader scans down a column
and reads data values plus their rolled-up bucket totals in one column-scan
gesture.

### Default rejected

AI defaults for "per-group footer row" cluster on three looks:

1. **Bold inverted strip** — heavy gray bg across the full row, bold white
   text. Reads "section marker" rather than "computed summary"; clashes
   with the grand-total row (which also wants a synthesis signature).
2. **Indented mini-totals** — bg matches the group row (lighter), label
   says "subtotal," numbers in body weight. Reads as "another data row
   with a label" — the trader can't tell at a glance that it's a
   synthesis vs a real instrument named "subtotal."
3. **Right-aligned totals chip** — numbers floated in a chip in the
   auto-group cell instead of column-aligned. Breaks column scanning —
   the trader has to move her eyes off the P&L column to find the
   group total.

All three either fight the existing Cycle 14 totals vocabulary
(option 1, 3) or fail to differentiate footers from data rows
(option 2).

### Risk taken

**Per-group footers get the FULL totals signature** — same 3% slate
bg, same 1 px top rule, same +1 font-weight stop, same `totalsFg`
color. The grand-total row stays distinguishable not via heavier
chrome but via POSITION (always last, never inside an expanded
group) and via the auto-group cell's label (just `Total`, no group
value suffix).

This is the louder risk. Most design systems differentiate "group
total" from "grand total" by stepping up the chrome weight (group
= medium, grand = heavy). I'm shipping them visually identical and
relying on POSITION + LABEL to distinguish. The bet: in the canvas
grid where the column-scan is the primary reading gesture, having
the SAME visual stripe at every synthesis level lets the trader
read down a column once and know "this stripe is always a
synthesis" — no need to learn "heavy stripe means grand vs medium
stripe means group." The label + position carry the granularity.

The Cycle 14 "lift" already includes a top hairline rule, so two
footer rows in a row (e.g. Total APAC followed by another region's
expansion) read as separate synthesis rows because each carries
its own top rule. The visual rhythm is "data data data data ━━
footer ━━ footer ━━ footer" with the rule acting as both opener
and divider — same way the totals row works in an ungrouped grid.

### Auto-group cell label composition

```
[indent: parentDepth × 14px] [label: 'Total ' + parentGroupValue]
```

| Slot | Treatment |
|---|---|
| Indent | `(parentDepth + 1 - 1) × 14px = parentDepth × 14px` — the label sits at the SAME x-position as the parent group's value, so the eye traces parent → children → footer in one column-scan. |
| Label | `Total ${parentGroupValue}` — verbatim from the ag-grid screenshot vocabulary. Defaults to just `Total` when the parent value is empty (grand-total case). |
| Font weight | `--vg-group-footer-font-weight` (default 500 — same as totals). |
| Font color | `--vg-group-footer-fg` (default `--vg-totals-fg`). |
| Italic? | **No.** ag-grid italicises group totals; canvasgrid doesn't have italic in its monospace stack and adding it would require a font-family swap. The weight bump + bg lift carry the synthesis cue without the italic. |
| Chevron / checkbox | **Omitted.** The footer is NOT a toggle target (the group above it owns expansion) and NOT a selection target (selecting the footer doesn't have well-defined semantics — it doesn't represent a single row). The auto-group cell paints label-only. |

### Data column composition

Each data column on a footer row paints `chunk.groupTotals[groupKey][colId]`
through the SAME `'totals'` cell renderer the grand-total row uses
(Cycle 14 / Task 5). The renderer's em-dash placeholder for empty
cells (`'—'`) carries over verbatim — a column without an aggFunc
paints the em-dash; a column with `aggFunc: 'sum'` paints the formatted
sum; etc. Column halign follows the data column's halign (right for
numeric, left for text), so a P&L column with right-aligned numbers
stays right-aligned in the footer.

### Tokens (committed to `tokens.css`)

| Token | Default | Why |
|---|---|---|
| `--vg-group-footer-bg` | `var(--vg-totals-bg)` | Inherit the totals tint; apps that want a lighter footer can override without touching grand-total chrome. |
| `--vg-group-footer-fg` | `var(--vg-totals-fg)` | Same as bg — inherit then optionally diverge. |
| `--vg-group-footer-border-top` | `var(--vg-totals-border-top)` | One hairline rule color across both synthesis row types by default. |
| `--vg-group-footer-font-weight` | `500` (matches totals) | Same weight family as totals. Apps that want a lighter footer override to 450 or 400. |

All four tokens default to the totals values so the SHIPPED look is
"footer === grand total in visual stripe; differentiated by label
+ position." Apps that want to break the parity (e.g. footer 2 %
tint, grand total 4 %) override the four tokens and keep the
`--vg-totals-*` tokens untouched.

### Grand-total footer (when `groupIncludeTotalFooter: true`)

A single footer entry at the very end of `flatOrder`, sitting OUTSIDE
any group's collapsible scope (its `depth = 0` so the skip-depth
logic never drops it). The auto-group cell paints just `Total` (no
group-value suffix because the grand total isn't a group's child).

The grand-total footer EXISTS IN ADDITION TO the `TotalsSubgrid`
mechanism — `groupIncludeTotalFooter: true` does not conflict with
`totalsRowPosition: 'bottom'`. Apps that want a single grand-total
row pick ONE of the two channels; using both renders two grand totals
(which may or may not be the app's intent — cgrid doesn't guard).
Recommendation: `groupIncludeTotalFooter` for grids that ALREADY
have grouping active (so the footer aligns with the per-group
footers' visual rhythm); `totalsRowPosition: 'bottom'` for ungrouped
grids (pinned at the bottom of the scroll body).

### Behaviour with collapse / expand

When a group collapses, its descendant data rows drop out of the
visible order — and so does its footer (the footer's `depth` is
strictly greater than the parent group's `depth`, so the
skip-depth logic in `viewportSlicer` skips it naturally). When the
group re-expands, the footer comes back. No special handling needed
in the slicer's expansion logic beyond the depth assignment.

When `groupRemoveSingleChildren` (Task 10) elides a group, its
footer ALSO elides — a group whose single child has been
short-circuited shouldn't carry a "Total" row that just repeats the
single child's value. The `walk()` function in `GroupPass.apply`
skips both the group entry AND the footer entry for the elided
group.

### Behaviour with `showOpenedGroup` (Task 10)

`showOpenedGroup` paints a muted echo of the leaf-parent's value on
each data row's auto-group cell. The footer row is NOT a data row
(`rowKind === 3`), so the `showOpenedGroup` slicer logic skips it.
The footer's auto-group cell paints its own `Total ${groupValue}`
label via the new footer cell renderer, NOT the muted leaf-parent
echo. The two features compose without conflict.

### Renderer path

A new `'groupFooter'` cell renderer registers under that key. It's
a thin wrapper around `totalsCell` (Cycle 14 / Task 5):

- For the auto-group column (colId starts with the
  `'ag-Grid-AutoColumn'` prefix): paint `Total ${parentValue}` at
  the parent depth's indent.
- For every other column: delegate to `totalsCell` so the formatted
  value + em-dash placeholder + right-alignment + lift treatment
  apply uniformly.

The renderer reads `chunk.groupTotals[groupKey][colId]` indirectly:
`cgrid.cellAt(rowIndex, colId)` resolves the lookup and returns
the formatted value. The renderer itself doesn't reach into the
chunk; it consumes the same `CellPaintConfig` shape every renderer
gets.

### applyCellProps integration

`ApplyCellPropsInput` grows a `isGroupFooter?: boolean` flag. When
set, the lift treatment fires the same way as `isTotals === true`
but reads from the `--vg-group-footer-*` token family instead. The
two flags are mutually exclusive — a row is either a footer
(rowKind === 3) or a grand total (in `TotalsSubgrid`), never both.

The row-bg pass in `byRows.ts` checks the chunk's
`rowKinds[localIndex] === 3` for any DataSubgrid row and paints
`theme.groupFooterBg` instead of the data-row bg. The
`gridLinesPainter` paints the top hairline rule under the same
condition (chunk rowKind 3 in a data row).

### What's explicitly NOT shipped in Task 12

- No per-row hover state for footer rows (matches the totals row —
  totals don't react to hover either; the synthesis stripe is
  read-only).
- No focus / selection on footer rows (matches totals).
- No `groupIncludeFooter` per-group override (apps that want
  selective per-group footers can post-process via a custom
  `aggFunc` that returns null for groups they want to suppress).
- No collapse animation for footers (cycle's "no animation" rule
  from Task 7 — instant flip).
- No keyboard nav across footers (Cycle 16+ a11y task).
- No right-click context menu on footers (Cycle 16+ context-menu task).

### One-line summary

**Per-group footers inherit the totals signature; the auto-group cell
label says `Total ${groupValue}` at parent depth indent; the grand
total sits at the bottom with label `Total` at depth 0. Same stripe,
different position + label.**

### Vocabulary handed to subsequent tasks

- **`--vg-group-footer-*` token family** — extensibility hook for
  apps that want footers visually distinct from grand totals.
  Defaults preserve visual parity.
- **`rowKind === 3` is the canonical "inline synthesis row" signal**
  for DataSubgrid. Cycle 18 (pivot) reuses the same rowKind for
  pivot subtotal rows; Cycle 17 (tree data) reuses it for tree-level
  totals.
- **The "label + position" differentiation pattern** — instead of
  inflating chrome per synthesis level, lean on label text +
  position-in-stack to convey hierarchy. Future synthesis variants
  (pivot subtotal at depth N, tree-level total) follow the same
  rule.
- **Footer entries live in `flatOrder` at depth `parent.depth + 1`**
  so the existing skip-depth logic drops them naturally on collapse.
  A new `FlatOrderEntry` `kind: 'footer'` keeps the slicer + tests
  type-safe.

---

## Cycle 15.5 / Task 1 — Row group panel completeness (pill reorder + sort indicator + live insertion + ghost)

**Brief recap:** Cycle 15 / Task 6 shipped the chip strip with
add-via-header-drag and `×`-click remove. Cycle 15.5 / Task 1 adds
the four missing surfaces from Prompt 6 of the user-supplied spec:
(1) drag a pill within the panel to reorder it (re-nests the group
tree), (2) a per-pill sort indicator the user clicks to toggle that
group level's sort, (3) a live vertical insertion line that tracks
the pointer through the chip gaps during any drag, (4) a floating
drag ghost that follows the cursor during the reorder gesture. The
panel ALSO subscribes to a new `GroupingState` event so a mutation
from another view (tool panel — Task 2; context menu — Task 2;
programmatic API call from app code) re-renders the chips live.

### Inheritance from Task 6

The chip vocabulary stays exactly as Task 6 shipped it: outlined
22px chip, `4px` radius, transparent bg, hover/active tints via
`color-mix`. Drag handle `≡`, label, `×` remove. The strip's
`32px` height, hairline border-bottom, status-bar-family
background stay byte-stable. New design decisions LAYER on top of
those tokens — none of the existing values move.

### New design decisions

#### Sort indicator glyph + position + size

| Property | Value | Why |
|---|---|---|
| Glyph (asc) | `↑` (U+2191 UPWARDS ARROW) | One-stroke ascending; reads as "smaller → larger" from bottom |
| Glyph (desc) | `↓` (U+2193 DOWNWARDS ARROW) | Mirrors asc; clear direction without occupying glyph space of a triangle |
| Glyph (no sort) | indicator span NOT rendered | Chip width matches the byte-stable Task 6 baseline. Visual cells 22 / 23 (no-sort chips) stay pixel-identical to Cycle 15. The indicator appears as a side effect of the first sort click |
| Position | between the label and `×` button | Reads as `Desk ↑ ×` — the sort sits next to the column it applies to, the `×` stays in its established right-edge slot |
| Size | `11px` | One px smaller than the label (`12px`) — auxiliary metadata, never competes with the label |
| Color | `--vg-group-chevron-color` | The one chevron family established by Cycle 15 Task 4 — used by the auto-group cell chevron AND the `›` separator |
| Click region | (a) the indicator span when rendered; (b) the chip BODY when no indicator is rendered | The chip body becomes the "start a sort" click target; once a sort is active the indicator is the explicit toggle handle |
| Cursor | `pointer` (indicator); `grab` (chip body, inherited from Task 6) | The chip body cursor stays `grab` so the drag affordance reads unchanged |

Click semantics:
- Chip has no sort (no indicator rendered) → click on the chip body
  (movement below the 4 px drag threshold) sets `'asc'`. The
  indicator appears as a side effect.
- Indicator shows `↑` → click on the indicator sets `'desc'`.
- Indicator shows `↓` → click on the indicator clears the sort
  (indicator unmounts).

This is the same `none → asc → desc → none` cycle ag-grid uses on
its row-group-panel chips, plumbed through TWO click targets so the
default (no-sort) chip layout matches Task 6 byte-exact. The unit
suite asserts the three transitions explicitly so a future refactor
can't silently flip the cycle direction.

When `rowGroupPanelSuppressSort: true` (already plumbed in
`VelocityGridOptions` since Task 6), the indicator span is omitted AND the
chip-body click handler short-circuits. The pill still drags +
removes normally.

**Drag-vs-click disambiguation.** A `pointerup` after a drag has
crossed the 4 px threshold sets `suppressNextChipClick` so the
browser-synthesised `click` event that follows is swallowed. A press
+ release WITHOUT crossing the threshold doesn't set the flag, so
the `click` event flows through and cycles sort. The threshold-
based gesture grammar is the same one Cycle 6's column drag uses;
this task inherits the discipline.

#### Insertion line — animation, color, width

The existing line (Task 6) already paints at 2px wide,
`top: 4px; bottom: 4px`, with the focus-ring color. Task 1's job is
to extend it from "drop-from-header" to "drop-from-anywhere" AND to
the pill-reorder gesture, AND to handle the BETWEEN-pills case
(Task 6's logic snapped to the nearest chip's left edge; reorder
also needs end-of-strip + just-before-current-position drop slots).

| Decision | Value | Why |
|---|---|---|
| Width | keep `2px` | Same precision as Task 6 drop indicator; no need to differentiate "this is a reorder drop" from "this is an add drop" — the resulting action is the same |
| Color | keep `--vg-row-group-panel-drop-border` (focus-ring) | One drop-color across all drag sources |
| Animation | **NONE — instant position update** | A 200ms ease-out fade introduces visual lag at high mousemove rates; the line "tracks" the pointer at frame rate. A disciplined, instant indicator reads as precise; a lagged indicator reads as approximate |
| Vertical inset | keep `top: 4px; bottom: 4px` | Already specced in Task 6 |
| Z-index | inherits `.vg-row-group-panel` z-index (2) | Above the canvas + status bar, below the editor overlay — same stack as the rest of the panel |

The line's `left` coordinate updates on every `setDragHover`
tick. The decision to snap to "before chip[i]" vs. "after the last
chip" uses the same midpoint rule for both column-drag (Task 6)
and pill-reorder (this task) — one helper, one snap algorithm.
This is enforced by routing the column-drag verdict path through
the same `updateInsertionLine` method as the reorder path.

#### Drag ghost — opacity + shadow + size

The pill-reorder gesture mounts a DOM `.vg-row-group-panel-chip-ghost`
that mirrors the chip the user is dragging. The ghost is positioned
`fixed` at the pointer's location and pointer-events are disabled so
it never blocks hit-tests against the panel beneath.

| Property | Value | Why |
|---|---|---|
| Background | `var(--vg-header-bg)` (opaque) | The chip-at-rest has a transparent bg; the ghost overrides to opaque so the chip reads cleanly when floating over any underlying canvas or column-header content |
| Border | `1px solid var(--vg-row-group-chip-border)` | Matches the at-rest chip border — the ghost is the chip in flight |
| Box-shadow | `0 4px 8px rgba(0, 0, 0, 0.12)` | Subtle drop shadow; reads as "lifted off the page" without becoming a Material elevation card |
| Opacity | `0.92` | Slightly translucent so the page beneath isn't fully occluded — the user can still see WHERE they're aiming |
| Offset from pointer | `(+8px, +8px)` (right + below cursor) | Out of the cursor's direct overlap so the user can still see the chip's drop verdict + insertion line |
| Z-index | `2147483600` (max-safe-ish) | Above EVERY surface in the grid — panel, header, popups. The ghost MUST be the topmost element until release |
| Visual width | `auto` (matches the source chip's rendered width) | The ghost IS the chip — same width is honest about what's being moved |
| Pointer events | `none` | Never blocks the drop-target's hit-test |

The ghost mounts on `document.body` (NOT inside the panel) so its
`fixed` positioning is screen-relative. It un-mounts on
`pointerup` or `pointercancel`. If the user releases outside the
panel, the ghost vanishes without committing a reorder (the
chip's position in `rowGroupCols` stays put). If they release
inside the panel at a valid drop slot, the host calls
`groupingState.moveRowGroupColumn(fromIndex, toIndex)` and the
ghost vanishes.

#### Drag threshold

Pointer-down on a pill starts a CANDIDATE drag. The drag actually
commits (ghost mounts, insertion line lights up) only after the
pointer moves more than `4px` from the down position. Below that
threshold, a `pointerup` is treated as a click (no-op for the chip
body; `×` and sort-indicator clicks still propagate via their own
listeners). Above the threshold, the gesture is a drag and a
subsequent `pointerup` commits the reorder.

| Property | Value | Why |
|---|---|---|
| Threshold | `4px` (CSS px, computed via `hypot(dx, dy)`) | Standard "intentional drag" budget; below this, micro-movements during a click read as click intent (matches the column-drag threshold from Cycle 6) |
| Capture | uses `setPointerCapture` on the pill element | Releases the capture on `pointerup` / `pointercancel` so a release outside the window doesn't lock the gesture |

### Tokens (committed to `tokens.css`)

```css
.vg-row-group-panel {
  /* Added in 15.5 / Task 1 */
  --vg-row-group-chip-sort-color: var(--vg-group-chevron-color);
  --vg-row-group-chip-sort-size: 11px;
  --vg-row-group-chip-ghost-bg: var(--vg-header-bg);
  --vg-row-group-chip-ghost-shadow: 0 4px 8px rgba(0, 0, 0, 0.12);
  --vg-row-group-chip-ghost-opacity: 0.92;
}
```

The ghost shadow is hard-coded as `rgba(0, 0, 0, 0.12)` instead of
a theme token because the shadow is the SAME small offset in both
themes (dark backgrounds also get a hint of darker-than-bg shadow
for "lifted" cue — `rgba(0,0,0,0.12)` reads as "deeper than
ambient" against either theme).

### Subscribe semantics

`GroupingState` (new in `cgrid/src/core/groupingState.ts`) is the
single source of truth for `rowGroupColumns` + `expandedRoutes` +
`perLevelSort`. It exposes a primitive API (`setRowGroupColumns`,
`addRowGroupColumn`, `removeRowGroupColumn`,
`moveRowGroupColumn(from, to)`,
`setRowGroupColumnSort(colId, direction)`) AND emits
`groupingStateChanged` events to subscribers. The row group panel
host subscribes on mount + unsubscribes on destroy.

This is the THREE-UIs-SHARE-ONE-LIST invariant the worklog calls
out as load-bearing. Task 2's tool-panel drop zone + context-menu
items subscribe to the SAME event. Task 11's perf gate asserts
that mutating via any one view triggers re-render in the others.

### What's deliberately NOT shipped this task

- **Drag-out-of-panel to ungroup** is intentionally not yet wired.
  The `×` click remains the only remove gesture in Task 1. The
  ag-grid "drag pill outside the panel to remove" gesture lands
  later in the cycle (Task 7 alongside
  `suppressDragLeaveHidesColumns` which gates the related
  column-leaves-grid behavior).
- **Animated chip enter/exit** when a pill is added or removed
  programmatically. The chips appear / disappear immediately —
  same as Task 6. A future cycle can layer in a 150ms fade if the
  abruptness becomes a usability issue, but the perf gate
  (Task 11) wants no DOM work in the scroll hot path; chip-list
  re-renders happen off the scroll path, so the simplicity is
  fine.

### Reused vocabulary
- `--vg-group-chevron-color` (Task 4) — the sort indicator hangs
  off this family so all chevron-like glyphs in the cycle read as
  one set.
- `--vg-row-group-panel-drop-border` (Task 6) — both the
  column-drag insertion line AND the pill-reorder insertion line
  use this color.
- Cycle 6 column-drag-ghost CSS pattern (`pointer-events: none`,
  `position: fixed`, max z-index). The row-group ghost mirrors
  the column-drag ghost in API surface; the only differences are
  scale (smaller chip-sized ghost) + tint (header-bg, not
  body-bg).

### Risk taken

**Click-to-toggle on the sort indicator (vs. drag-to-rearrange + click-anywhere-on-pill to sort).**
A reasonable alternative is "click any part of the pill toggles
sort; only the `≡` handle is the drag start." I rejected that
because:
- The sort indicator is the visible affordance for "this chip can
  also be a sort control." Routing click-to-sort through the
  GLYPH makes the affordance discoverable: the user sees `↑`,
  clicks it, and gets the desired action. Routing click-to-sort
  through the entire pill body would make the affordance invisible
  ("how do I sort? I see a chip… do I click it?").
- Drag also lives on the entire pill body (anywhere except the
  `×` button and the sort indicator). If the pill body were ALSO
  a click target, drag-vs-click disambiguation would need a
  threshold AND a mode flag. Restricting click-to-sort to the
  glyph dedupes the gesture-vs-target matrix.


---

## Cycle 15.5 / Task 2 — Tool panel Row Groups drop zone + header context menu Group-by items

**Brief recap:** Two more views over the same `rowGroupColumns`
list. The Columns tool panel (`agColumnsToolPanel` — Cycle 11) gets
its Row Groups SECTION upgraded from an inert stub to a live drop
zone showing pills + accepting column drags from the column list.
The column header context menu (Cycle 10) gets four new items —
"Group by `<col>`", "Un-Group by `<col>`", "Expand All Groups",
"Collapse All Groups" — each routing through the same primitive
API (`addRowGroupColumn` / `removeRowGroupColumn` / `expandAll` /
`collapseAll`) the row group panel and tool panel already use.

### Drop zone position (in the tool panel)

KEEP the existing baseline position: Row Groups SECTION sits BELOW
the column list, above the Values section. Three reasons:

1. **Cycle 11 already shipped this layout.** The section header
   "Row Groups" with the `☰` icon and the dashed empty-state box
   is already wired with `suppressRowGroups` gating and a
   placeholder string. Users / tests / docs already know where it
   lives. Task 2 makes the inert stub LIVE; it does not move the
   stub.
2. **Mirrors ag-grid's `agColumnsToolPanel`.** ag-grid puts Row
   Groups below the column list in the same panel ordering for the
   same reason — the column list is the primary surface, the drop
   zones are secondary.
3. **Primary action stays in view.** The column list's checkboxes
   are the most-used control in the tool panel. Keeping the drop
   zone below the list means a user opening the panel sees the
   checkboxes first; a user wanting to drag-to-group scrolls into
   the zone deliberately.

### Pill style (in the tool panel zone)

COMPACT variant of the Cycle 15 / Task 6 panel chip — same family,
trimmed for the narrower sidebar footprint.

| Property | Tool-panel zone | Row group panel (Task 6) | Why differ |
|---|---|---|---|
| Layout | VERTICAL stack (one chip per row) | HORIZONTAL strip with `›` separators | Sidebar is ~240px wide; horizontal strip would wrap awkwardly. Vertical stack reads as a list, matching the column-list above |
| Chip height | 22px (same) | 22px | One chip height across views — visual recall |
| Chip border + radius | `--vg-row-group-chip-border` + 4px | identical | Same vocabulary token |
| Drag handle glyph | OMITTED | `≡` rendered | Tool-panel chip body itself is the click/drag target; the sidebar is narrow + the chips are stacked so the drag affordance reads from the cursor change (`grab`) without needing a glyph. Panel chips use the handle because the horizontal strip benefits from the explicit "grab me here" cue |
| Sort indicator | OMITTED | Optional `↑` / `↓` | Sort lives on the row group panel chips. The tool panel is the column-management view — adding sort here would duplicate the affordance. Per Prompt 7 the tool panel is for grouping membership; sort decoration belongs on the panel |
| Remove `×` | `✕` (kept) | `✕` (kept) | One remove affordance across views |
| Label font-size | `11px` | `12px` | One px smaller — auxiliary inside a denser stack; the column-list labels above are also `11px` for consistency |
| Background | transparent (hover tint via `color-mix`) | identical | Same |

A pill in the zone reads as `[Athlete ✕]`, stacked one per row,
with `4px` vertical gap. The whole pill body is the click target
for the future drag-to-reorder gesture (deferred to a follow-up —
Task 2 ships drag-IN from the column list + drag-OUT to remove,
not within-zone reorder; that's symmetric with the row group
panel reorder Task 1 shipped and is intentionally out of scope to
keep Task 2 focused).

### Empty-state placeholder

KEEP "Drag here to set row groups" — already shipped in Cycle 11.
The string is identical to the row group panel's empty-state, by
design (one drop-zone vocabulary across the grid).

When the zone has at least one pill, the placeholder is replaced
by the pill stack. The dashed outline (`--vg-row-group-panel-drop-border`)
stays — it reads as "this is a drop target" regardless of fill
state, matching the row group panel.

### Drop indicator during drag

A `2px` HORIZONTAL insertion line that snaps to the gap nearest
the cursor between pills (or above the first / below the last
pill). Mirrors the panel's vertical line in vocabulary — same
color (`--vg-row-group-panel-drop-border`), same width, same
instant-update discipline (no animation; the line tracks at frame
rate).

Why horizontal in the zone (vs. vertical in the panel)? Pills are
stacked vertically here; an insertion line that reads as "between
two pills" must be perpendicular to the stack axis. The same drop
verdict outline (`data-drop="accept" | "reject"`) paints the zone
border the same color the panel uses.

### Context menu items — icon + label

| Item | Icon | Label format | Visibility |
|---|---|---|---|
| Group by | `☰` (U+2630 TRIGRAM FOR HEAVEN) | `Group by <headerName>` | `enableRowGroup === true` AND colId NOT in `rowGroupColumns` |
| Un-Group by | `☰` | `Un-Group by <headerName>` | colId IS in `rowGroupColumns` |
| Expand All Groups | `▾` (U+25BE BLACK DOWN-POINTING SMALL TRIANGLE) | `Expand All Groups` | `rowGroupColumns.length > 0` |
| Collapse All Groups | `▸` (U+25B8 BLACK RIGHT-POINTING SMALL TRIANGLE) | `Collapse All Groups` | `rowGroupColumns.length > 0` |

Icon-family reasoning:

- **`☰` for Group/Un-Group.** The Cycle 11 sidebar Columns panel
  uses `☰` as the Row Groups SECTION header icon. ONE icon for
  "row group" across the grid. The same glyph that marks the
  drop zone in the sidebar marks the menu item that adds to that
  zone. The Cycle 15 / Task 6 panel chip drag handle is the
  visually-similar `≡` (U+2261 IDENTICAL TO) — same family, used
  in different roles (drag affordance vs. section identifier).
  We could differentiate Un-Group with an outline variant, but
  the verb in the label is unambiguous and adding a second glyph
  would dilute the one-icon-for-row-group recall.
- **`▾` / `▸` for Expand/Collapse All.** These match the Cycle 15
  / Task 7 auto-group cell chevrons exactly. Same affordance
  vocabulary: a `▾` says "this group is open"; a `▸` says "this
  group is closed". Reusing the chevrons in the menu makes the
  cause-effect link explicit — click the `▾` item, every group
  shows the `▾` chevron afterward.

### Context menu item ordering

The default main menu currently ships (Cycle 10 + post-cycle patch):

```
Pin Column ►
Autosize This Column
Autosize All Columns
─────────────
Reset Columns
```

Task 2 appends a second separator + four group items at the end:

```
Pin Column ►
Autosize This Column
Autosize All Columns
─────────────
Reset Columns
─────────────
Group by <col>           ← when enableRowGroup && not grouped
Un-Group by <col>        ← when grouped
Expand All Groups        ← when grouping is active
Collapse All Groups      ← when grouping is active
```

The group items live at the END because they operate on a
different axis from the column-ops items above. Column-ops mutate
the column's display state (pin / size); group items mutate the
grid's data axis. Keeping them in distinct blocks separated by an
`hr` reads as "two kinds of action this column can do."

The trailing separator is OMITTED when ALL four group items are
hidden (e.g. column has `enableRowGroup: false` AND no grouping
is active). The separator-with-no-followers anti-pattern (an `hr`
dangling at the bottom of the menu) is a small but real visual
bug — guard against it.

When a column is groupable but already grouped, "Group by" is
hidden and "Un-Group by" is shown. Mutually exclusive — never
both — keeps the menu compact + obvious.

### Tokens (committed to `tokens.css`)

```css
.vg-columns-panel-rgz {
  /* Added in 15.5 / Task 2 — tool-panel Row Groups ZONE-specific
     tokens. Inherit from the row group panel chip family where
     possible; trim where the compact context calls for it. */
  --vg-columns-panel-rgz-chip-font-size: 11px;
  --vg-columns-panel-rgz-chip-gap: 4px;
  --vg-columns-panel-rgz-drop-line-thickness: 2px;
}
```

The drop line color reuses `--vg-row-group-panel-drop-border` —
one drop color across all drop zones.

### What's deliberately NOT shipped in Task 2

- **Drag-within-zone reorder.** The zone displays the pills in
  `rowGroupColumns` order. Reordering happens via the row group
  panel (Task 1) or programmatically — the tool-panel zone is a
  read-mostly mirror with add (drag-IN from the column list) and
  remove (`×` click on a pill). This keeps Task 2 small + focused
  on the two surfaces Prompt 7 calls out.
- **Drag-IN from the row group panel chip to the tool-panel zone.**
  The two surfaces show the SAME list — dragging a chip from one
  to the other would mean "move this column from the row group
  panel to the row group zone" which is meaningless (it's already
  in both). The drag sources Task 2 wires are the column-list rows
  + the column-header drag (already wired in Cycle 15 / Task 6
  + extended in Task 1).
- **`allowDragFromColumnsToolPanel` end-to-end.** The OPTION
  lands in `VelocityGridOptions` so apps can flip it; the actual
  "drag column out of the tool panel ONTO THE GRID body" path
  (vs. into the zone) is a Cycle 16 follow-up — the Cycle 15.5
  scope is the zone + the row group panel + the context menu.
  This task ships the option declaration; runtime behaviour
  treats the option as governing the column-list drag handle's
  "can drag out of the panel" eligibility, which Task 2 needs
  for drag-INTO-the-zone-within-the-same-panel.

### Reused vocabulary

- `☰` (Cycle 11 sidebar Row Groups SECTION header icon) — Task 2
  uses it in the context menu Group/Un-Group items so the icon
  family is consistent across surfaces.
- `▾` / `▸` (Cycle 15 / Task 7 auto-group cell chevrons) — Task 2
  uses them in the Expand/Collapse All Groups items.
- `--vg-row-group-panel-drop-border` (Task 6) — one drop color
  across the row group panel AND the tool-panel zone.
- `--vg-row-group-chip-*` family (Task 6) — pill styling
  vocabulary is shared; Task 2's compact variant overrides only
  font-size and omits the drag handle glyph.

### Risk taken

**Same icon for `Group by` and `Un-Group by`.** The natural-
language alternative is to use a "folder open" vs "folder close"
icon — an `📁` for group and a `📂` for ungroup, or an outline
variant of `☰`. I rejected that because:

- The Cycle 11 sidebar already uses `☰` as the canonical Row
  Groups icon. Introducing a second glyph for the "ungroup"
  verb would mean Task 2 owns TWO new glyphs the rest of the
  cycle has to thread through (Sidebar header? Drop zone
  header? Pill drag handle?).
- The verb in the label is unambiguous and the items are
  mutually exclusive — a user never sees both at once. The
  icon's job is to mark the menu row as "this is the row-group
  action"; the label's job is to say "this adds" or "this
  removes". Visual consistency in the gutter wins over a second
  glyph carrying redundant information.
- A follow-up cycle can introduce an outline variant of `☰`
  for the ungroup verb without breaking the convention if it
  turns out users want the distinction; reverting from two
  icons to one is harder than adding a second later.


---
