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
