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

**Light theme `.cg-theme-quartz`:**

| Token | Value | Why |
|---|---|---|
| `--cg-group-chevron-color` | `#475569` | Muted slate — same family as `--cg-totals-fg-muted`. Readable but not loud. |
| `--cg-group-count-color` | `#475569` | Same muted slate as chevron — the count is metadata, not the primary value. |
| `--cg-group-indent` | `14px` | One chevron-width per depth level — the chevron "stacks" cleanly under nested groups. |

**Dark theme `.cg-theme-quartz-dark`:**

| Token | Value | Why |
|---|---|---|
| `--cg-group-chevron-color` | `#94a3b8` | Pale slate matching `--cg-totals-fg-muted` dark. |
| `--cg-group-count-color` | `#94a3b8` | Same pale slate as chevron — preserves the muted/primary split. |

`--cg-group-indent` is unitless theme-agnostic (declared once at
`:root`-ish scope, not per-theme).

**Placeholders:**

```css
.cg-group-cell    { /* placeholder — renderer reads tokens via cssReader */ }
.cg-group-chevron { /* placeholder — color flows via theme.groupChevronColor */ }
.cg-group-indent  { /* placeholder — width flows via theme.groupIndent */ }
.cg-group-count   { /* placeholder — color flows via theme.groupCountColor */ }
```

### Layout

| Property | Value | Rationale |
|---|---|---|
| Row height | `var(--cg-row-height)` (32px) | Identical to body rows — group rows are the same height, not inflated |
| Top border | None | Group rows are NOT a region change. The totals/footer signature is reserved for synthesis rows. |
| Bottom border | None | Same reason — gridLine alone separates rows |
| Cell padding | 6px (body PADDING) | Body alignment, not header alignment |
| Indent per depth | 14px (`--cg-group-indent`) | One chevron-width — chevrons at depth 0..N stack visually |
| Chevron size | 12px | Slightly smaller than sort icon (14px) so it reads as "indicator, not control" |
| Chevron→value gap | 6px | Standard cell PADDING — matches text cell left padding so values align with same-column data |
| Value→count gap | 4px | Tight — the count belongs to the value, not floating |
| Font family | `var(--cg-font-family)` | Same monospace stack as body |
| Font size | `var(--cg-font-size)` (13px) | Same as body — doesn't shout |
| Font weight value | 400 (body weight) | NOT bolded. Structural cue is chevron + indent, not weight. |
| Font weight count | 400 (body weight) | Same weight as value — color carries the metadata distinction |
| Value color | `--cg-fg-color` (body fg) | Reads as data, not as a label |
| Count color | `--cg-group-count-color` (muted slate) | Metadata: visually subordinate to value |
| Chevron color | `--cg-group-chevron-color` (muted slate) | Indicator: visually subordinate to value |

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
3. `cgrid.ts` inserts the auto-group column at index 0 of
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

- **`--cg-group-*` token family** is the single source for group-cell
  chrome decisions. Tasks 5–12 extend it as needed (Task 5 may add
  `--cg-group-row-full-bg` for the `groupRows` variant; Task 7 may
  add `--cg-group-chevron-hover-color` for hover hint; Task 8 may
  add `--cg-group-checkbox-indeterminate-color` for tri-state).
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
| `--cg-group-chevron-color` | unchanged from Task 4 | One chevron family across the cycle |
| `--cg-group-count-color` | unchanged | Same muted-metadata role |
| `--cg-group-indent` | unused in this variant | Each column owns one depth |

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
`--cg-group-row-bg` token. Far lighter than the Cycle 14 totals
"hairline lift" (totals: 3% slate bg + top border + weight +1; group
rows: ~1.5% slate bg only, no border, no weight). Reserving the full
totals signature for per-group footer rows (Task 12) so the
synthesis-vs-navigation distinction lands cleanly.

| Token | Light | Dark | Why |
|---|---|---|---|
| `--cg-group-row-bg` | `#f1f5f9` | `#1e293b` | ~1.5% slate cast in light, paler slate in dark. Lighter than totals (`#f8fafc` / `#1e293b` per Cycle 14) so synthesis rows still read as the heaviest stripe in the column. |

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

**What:** Defers to `CGridOptions.groupRowRenderer` — a registered
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
groupDisplayType union is publicly typed in `CGridOptions`; shipping
`'custom'` as a no-op in Task 4 and only wiring it in Task 12 would
mean apps that opt in early would see broken paint. Wiring the renderer
chain now keeps the surface coherent.

### Shared rules across all three variants (and singleColumn)

| Atom | Rule |
|---|---|
| Chevron glyph | Lucide `chevron-right` / `chevron-down`, 12px |
| Chevron color | `--cg-group-chevron-color` (muted slate) |
| Count format | `(${count.toLocaleString()})`, omit at `count === 0` |
| Count color | `--cg-group-count-color` (muted slate) |
| Value color | body `fg` |
| Em-dash placeholder | `'—'` for null / empty group values |
| Row height | `var(--cg-row-height)` (32px) — no inflation for group rows |
| Sortable | `false` on synthesized columns (Task 11 lands sort) |

### Mode-by-mode comparison

| Property | `singleColumn` (Task 4) | `multipleColumns` | `groupRows` | `custom` |
|---|---|---|---|---|
| Auto-group columns | 1 at index 0 | N, one per `rowGroupCols[i]` | 0 | 0 |
| Row bg shift | none | none | `--cg-group-row-bg` | none |
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

- **`--cg-group-row-bg` token** — the ONE additional token Task 5
  introduces. Reused by Task 7 if a group-row hover hint lands at row
  level; reused by Task 10 if `showOpenedGroup` paints the expanded
  group's value on data rows under it.
- **"Own-depth-only" rule** for multipleColumns — the cleanest
  default given the current chunk format. Tasks 9 (`groupDefaultExpanded`)
  and 10 (`showOpenedGroup` / `groupRemoveSingleChildren`) inherit the
  rule unchanged.
- **Custom renderer fallback to `'group'` in groupRows mode** — the
  pattern for any future `'<role>RowRenderer'` option in cgrid:
  named-renderer lookup, fallback to the canonical default. Keeps
  half-configured grids from crashing.
- **groupRows DEPARTS from "spine, not strip"** by necessity, NOT
  preference. The departure is sized as small as possible (bg only,
  no border / weight) so the cycle's grammar still reads as one piece
  with a single conscious exception.

---
