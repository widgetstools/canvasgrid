# Cycle 14 — Aggregation UI — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

---

## Task 1 — TotalsSubgrid chrome

**Brief recap:** A pinned row at the bottom (or top) of the grid body
showing per-column sum / avg / min / max / count values for a
fixed-income positions grid. Must NOT compete with the body for the
user's attention — it confirms the summary, doesn't shout it.

### Subject pin

Trader / PM scanning a financial positions grid. Single job of the
totals row: in one glance, confirm "the numbers above sum to what I
expect." It is a glance target, not a focus target.

### Default rejected

AI design defaults for "summary row in a financial grid" cluster on
three looks: Bloomberg-bar (heavy gray, bold), Excel-summary (header-bg
double-border), and zebra-continuation (looks like just another data
row). All three are wrong here. Bloomberg-bar shouts. Excel-summary
duplicates header vocabulary at the bottom. Zebra-continuation
disappears.

### Risk taken

**A hairline lift** — exactly +1 weight stop, exactly 3% tint, exactly
1px rule above, no other affordance. The bet: trust the consistent
monospace stack to make +1 weight read as deliberate; trust the 3% tint
to read as "lifted" without reading as "different region." Justification:
every additional pixel of decoration in a trading grid steals from the
data above.

### Tokens (committed to `tokens.css`)

**Light theme `:root`:**
| Token | Value | Why |
|---|---|---|
| `--vg-totals-bg` | `#f7f9fb` | 3% slate tint over body `#ffffff` — lifted, not different |
| `--vg-totals-fg` | `#0f172a` | one stop darker than body fg `#1a1f24` |
| `--vg-totals-border-top` | `#cbd5e1` | between gridline `#eceff2` and header border `#d5dbe0` |
| `--vg-totals-fg-muted` | `#475569` | for the row label column (Task 5 renderer uses this) |
| `--vg-totals-font-weight` | `500` | body is `400` — +1 stop only |
| `--vg-totals-row-height` | `var(--vg-row-height)` | SAME as body. Do not inflate. |

**Dark theme `.vg-theme-dark`:**
| Token | Value | Why |
|---|---|---|
| `--vg-totals-bg` | `#0f1d36` | 5% upward from body `#0a1428`, no temperature shift |
| `--vg-totals-fg` | `#e2e8f0` | one stop brighter than body fg `#cbd5e1` |
| `--vg-totals-border-top` | `#4a6391` | between gridline `#2b3a5c` and header border `#38507a` |
| `--vg-totals-fg-muted` | `#94a3b8` |   |

**Placeholders:**
```css
.vg-totals-row  { /* placeholder — Task 5 renderer reads tokens via cssReader */ }
.vg-totals-cell { /* placeholder — per-cell polish lands in Task 5 */ }
```

### Layout

| Property | Value | Rationale |
|---|---|---|
| Row height | `var(--vg-row-height)` (32px) | No inflation — body-consistent rhythm |
| Top border | 1px solid `--vg-totals-border-top`, painted at `Math.round(row.top) - 1` | Same idiom as the existing bodyTop separator |
| Bottom border | None | Canvas edge / status-bar top border handles it — no double-border |
| Cell padding | 6px (body PADDING) | Body alignment, not header alignment |
| Per-cell halign | Inherits the column's halign | Right for numerics, left for text — matches the data column above |
| Font family | `var(--vg-font-family)` | Same monospace stack as body |
| Font size | `var(--vg-font-size)` (13px) | Same as body — doesn't shout |
| Font weight numerics | 500 | +1 stop from body 400 |
| Font weight label | 500 (matching numerics) | Uniform row — not bold |

### Type

- **No display face.** Body face IS the personality (the monospace stack
  is already deliberate). Totals reuses it.
- **No letter-spacing change.** Mono supplies the rhythm.
- **Numerics weight +1 stop only.** ag-grid hops to 600/700 on totals
  rows; canvasgrid stops at 500.

### States

| State | Treatment | Why |
|---|---|---|
| Default | tint + 1px rule above + +1 weight | The whole signature |
| Hover | NONE | Row is not interactive in Task 1 |
| Focus | NEVER | Totals are outside the rangefocus model |
| Empty cell (column without aggFunc) | bg + border still apply; cell content empty | Task 5 renderer paints "—" |
| Loading / pre-chunk | Chrome paints; cells empty until first chunk arrives | Layout stability while worker computes |

### Painter integration (canvasgrid specifics)

Canvasgrid paints to canvas, NOT DOM, so the placeholder CSS selectors
are anchors for Task 5 polish only. The runtime reads CSS variables
via `cssReader.ts` (existing) and the values flow into the painter:

1. `cssReader.ts` exposes the new tokens on `ResolvedTheme`.
2. `byRows.ts` row-bg pass paints `theme.totalsBg` for `isTotals` rows.
3. `byRows.ts` cell-paint pass, for `isTotals` rows, calls
   `row.subgrid.getCell(local, colId)` and renders via the column's
   default cellRenderer (Task 5 swaps in the polished `'totals'`
   renderer; Task 1 uses the raw renderer so the values display
   without bespoke polish).
4. `gridLinesPainter.ts` paints the top border at
   `Math.round(row.top) - 1` for `isTotals` rows, using
   `theme.totalsBorderTop`.
5. `paintBand`'s cell config receives a heavier `font` for `isTotals`
   rows (weight 500 substituted in for the body's 400). Task 5
   refines the font selection logic when the polished renderer ships.

### What's explicitly NOT shipped in Task 1

- No gradient on the row bg.
- No icon / chip in the label cell.
- No alternating zebra on totals.
- No box-shadow or drop-shadow under the row.
- No accent color.
- No hover, focus, or selection state on the totals row.
- No em-dash placeholder for empty totals (lands in Task 5).

### One-line summary

**A 1px hairline above, a 3% tint, a +1 weight stop. Everything else
stays body.**

### Vocabulary handed to subsequent tasks

- The "lift" vocabulary (rule above + tint + weight bump) is the
  Cycle 14 grammar. Tasks 2 (`pinnedTopRowData`) and 4
  (`suppressAggFuncInHeader` header text) inherit it where they
  intersect the same body↔totals transition.
- The `--vg-totals-*` token family is the single source for chrome
  decisions. Tasks 2–6 extend it as needed (Task 2 may add
  `--vg-pinned-row-*` siblings; Task 5 may add `--vg-totals-fg-empty`
  for the em-dash).

---

## Task 2 — Pinned-row chrome

**Brief recap:** Static rows mounted at the top or bottom of the body
via `pinnedTopRowData` / `pinnedBottomRowData`. The trader's mental
model for these is "reference rows" — Index Benchmark, Trader Target,
watchlist anchor — NOT summary rows. Multi-pinned (3 rows at top) must
read as a coherent stack.

### Subject pin

Same trader at the same financial positions grid as Task 1, except the
job has shifted. Where the totals row's job is *confirm the sum*, the
pinned row's job is *anchor a comparison*. The trader reads a pinned
row sideways at the data above/below it (am I above the benchmark? is
my position closer to target than yesterday?). It is a comparison
target, not a glance target.

### Default rejected

The lazy answer is "reuse the totals chrome verbatim." That conflates
two distinct cognitive operations:

- **Synthesis** (totals): a computed projection of the body — the
  values *belong to* the data above.
- **Reference** (pinned): a static row parallel to the body — the
  values are *adjacent to* the data, not derived from it.

Wearing identical chrome trains the trader to treat them as the same
class of row, which is wrong. If a pinned "Index Benchmark" row picks
up the +1 weight bump that says "this is computed," the trader sees a
fake synthesis where none exists.

### Risk taken

**Same lift idiom, different tint hue, no weight bump.**

- Same 1px structural border (single `--vg-totals-border-top` reused)
  — the boundary between "scrolling body" and "everything else" is one
  shape, one color, one source. Reusing the border preserves the
  cycle-14 grammar at the structural level.
- **Tint hue flips warm.** Totals is slate (cool, mechanical, "the
  machine computed this"). Pinned is cream (warm, intentional, "a
  human pinned this"). Same luminosity lift (3% on light, ~5% on dark)
  so the contrast budget is identical; only the temperature differs.
- **Font weight stays at body 400.** The +1 weight stop is reserved
  for synthesis (totals). Pinned rows match body weight because they
  ARE body content, just non-scrolling. A weight bump on pinned would
  mis-signal computed emphasis.
- **Stack reads as a unit.** When 3 rows are pinned at top, the warm
  tint paints across all three; the structural border lands ONCE at
  the body-side edge of the stack (not between rows); standard
  gridlines separate the member rows. The visual "lift" is owned by
  the stack collectively, not row-by-row.

### Tokens (committed to `tokens.css`)

**Light theme `:root`:**
| Token | Value | Why |
|---|---|---|
| `--vg-pinned-row-bg` | `#fbf8f3` | 3% warm cream tint over body `#ffffff` — same luminosity lift as `--vg-totals-bg` (`#f7f9fb`), opposite temperature |
| `--vg-pinned-row-fg` | `var(--vg-fg)` | Inherit body fg — no synthesis emphasis |
| `--vg-pinned-row-border` | `var(--vg-totals-border-top)` (`#cbd5e1`) | SAME color as totals border. Single source for "outside body" boundary |
| `--vg-pinned-row-font-weight` | `400` | Inherit body weight. +1 stop is reserved for totals synthesis |

**Dark theme `.vg-theme-dark`:**
| Token | Value | Why |
|---|---|---|
| `--vg-pinned-row-bg` | `#241e16` | 5% upward from body `#0a1428` with an amber shift — warm cast survives the theme flip |
| `--vg-pinned-row-fg` | `var(--vg-fg)` | Inherit |
| `--vg-pinned-row-border` | `var(--vg-totals-border-top)` (`#4a6391`) | Same body-edge boundary |

**Placeholders:**
```css
.vg-pinned-row  { /* placeholder — Task 5 polished renderer may extend */ }
.vg-pinned-cell { /* placeholder — per-column override hook lands later */ }
```

### Layout — pinned vs totals comparison

| Property | Pinned | Totals (Task 1) |
|---|---|---|
| Row height | `var(--vg-row-height)` (32px) | `var(--vg-row-height)` (32px) |
| BG tint | warm 3% / 5% | slate 3% / 5% |
| FG | inherit body | one stop darker |
| Font weight | 400 (body) | 500 (+1) |
| Structural border (body-side edge) | 1px `--vg-pinned-row-border` | 1px `--vg-totals-border-top` (same color) |
| Between-row divider (multi-pinned) | `--vg-gridline` (standard row divider) | N/A — totals is a single row |
| Per-cell halign | inherit column | inherit column |
| Cell renderer | column's default | column's default (Task 5 swaps in `'totals'` for the totals row only) |

### Multi-pinned reading

A 3-row pinned-top stack paints as:

```
[ header band ]
[ pinned row 1 ]  ← warm tint
[ gridline      ]  ← standard divider
[ pinned row 2 ]  ← warm tint
[ gridline      ]  ← standard divider
[ pinned row 3 ]  ← warm tint
[ structural border ]  ← 1px --vg-pinned-row-border
[ data band ]
```

ONE warm zone, ONE body-side boundary, member rows still individually
legible via the standard gridline.

### Coexistence — pinned + totals (both bottom)

```
[ data band ]
[ pinned-bottom rows ]  ← warm tint
[ structural border ]   ← 1px --vg-pinned-row-border (top edge of pinned stack)
[ totals row ]          ← slate tint
[ structural border ]   ← 1px --vg-totals-border-top (top edge of totals)
```

Two distinct tints + two boundaries make "pinned" and "totals"
instantly tellable apart. Both borders use the same color (single
source) but each owns its position via the subgrid above it.

### Painter integration (canvasgrid specifics)

1. `cssReader.ts` exposes `pinnedRowBg`, `pinnedRowFg`, and
   `pinnedRowBorder` on `ResolvedTheme`. The border value is read from
   `--vg-pinned-row-border` which CSS-aliases to
   `--vg-totals-border-top`; we expose it as a separate field so the
   painter doesn't reach across token families.
2. `byRows.ts` row-bg pass paints `theme.pinnedRowBg` for `isPinned`
   rows (new flag on `Subgrid` mirroring `isTotals` / `isFloatingFilter`).
3. `byRows.ts` cell-paint pass: for `isPinned` rows, call
   `row.subgrid.getCell(local, colId)` and render via the column's
   default cellRenderer — same path as data rows. No `isTotals` cue
   passed to `applyCellProps` so no +1 weight bump fires.
4. `gridLinesPainter.ts` paints the structural border at the
   body-side edge of the pinned stack — top edge for `pinnedBottomRowData`,
   bottom edge for `pinnedTopRowData`. The painter detects the stack
   edge by walking adjacent rows: a border lands where `isPinned`
   transitions to a non-pinned subgrid. Between two `isPinned` rows
   the standard gridline paints (no special-case).

### States

| State | Treatment | Why |
|---|---|---|
| Default | warm tint + body-side border + body weight | The whole signature |
| Hover | NONE (Task 2) | Pinned rows aren't interactive in Task 2 |
| Focus | NEVER | Pinned rows are outside the rangefocus model |
| Empty cell | bg + border still apply; cell empty | Column-default rendering, no special placeholder |
| Multi-pinned member | warm tint continues; gridline divider above | Stack reads as a unit |

### What's explicitly NOT shipped in Task 2

- No icon / chip on the row.
- No alternating tint within the pinned stack.
- No box-shadow under the stack.
- No accent color.
- No hover / focus / selection on pinned rows.
- No per-row override for height (uses grid row height — variable-row
  heights via Cycle 5 are out-of-scope for static pinned data; can be
  revisited in a later cycle if pinned-row use cases demand it).
- No special "pinned-row label column" treatment (a column showing
  "Index Benchmark" as the first cell uses the column's normal
  renderer — no bespoke styling).
- No per-column `pinnedRowCellRenderer` override (Task 5 introduces
  the `'totals'` cell renderer; per-column pinned overrides can land
  with that work if the cycle exit reveals a need).

### One-line summary

**Same lift structure as totals, opposite temperature, no weight bump.
Stack reads as a unit, member rows readable via the standard gridline.**

### Vocabulary handed to subsequent tasks

- The `--vg-pinned-row-*` family is committed and may be extended by
  Task 5 if a per-column pinned override surfaces.
- The structural border color `--vg-totals-border-top` is now a SHARED
  token used by both pinned and totals chrome — treat it as a
  cycle-14 primitive.
- The temperature contrast (slate = computed, cream = anchored) is
  established. Future cycles adding new subgrid types (footer, etc.)
  pick a tint temperature that matches the row's cognitive role.

---

## Task 4 — aggFunc-in-header typography

**Brief recap:** When a column carries `aggFunc: 'sum' | 'avg' | …` AND
`suppressAggFuncInHeader` is `false` (the default), the header cell
renders as `sum(Notional)` instead of `Notional`. The toggle flips
per-grid (`VelocityGridOptions.suppressAggFuncInHeader`) AND per-column
(`CColDef.suppressAggFuncInHeader`), the column override winning.
When suppressed, the aggregated context lives only in the totals row.

### Subject pin

Same trader at the same financial positions grid. Headers are
micro-glance signposts read in the 200-ms gaps between scanning data
rows. The aggFunc prefix tells the trader, in those 200ms, "this
column has a synthesis below" without forcing a glance to the totals
row. It is a context cue, not a focus target.

### Default rejected

Three AI defaults cluster here:

- **Allcaps prefix** (`SUM(Notional)`): shouts at body header weight
  600. Stress + emphasis is the wrong cue for metadata.
- **Lighter weight prefix** (400 inside a 600 column): reads as a
  font-loading bug, not as demoted metadata. The 200pt weight delta
  in adjacent characters breaks the band's typographic rhythm.
- **Match column casing** (`Sum(Notional)`): strips the function-call
  signal that lowercase + parens carry together as a pair.

All three trade legibility for a differentiation the parens already
supply for free.

### Risk taken

**Same weight, same color, lowercase verb, no spaces, parens.** The
structural differentiator IS the parens — `sum(...)` reads as a
function-call signature before the eye parses the characters. Adding
a weight delta to the band already at 600 would read as a font bug.
Adding a color delta to a band already differentiated by `headerBg`
+ headerBottomBorder would crowd the contrast budget for the actual
sortable / hover cues.

The deliberate aesthetic choice is the **lowercase verb**. Lowercase
says "this is a function." Uppercase says "this is emphasis." We want
the former.

### Decisions

| # | Question | Choice | Why |
|---|---|---|---|
| 1 | Weight + color of the prefix | Same as the column name (headerFg, header font weight) | Single fillText pass per header. Parens carry the structural cue. Weight delta inside a 600 band reads as a font bug. |
| 2 | Casing of the verb | Lowercase (`sum`, `avg`, `min`, `max`, `count`, `first`, `last`) | Matches ag-grid screenshot + trader's existing mental model. Allcaps shouts; small caps requires a font feature not always available. Function-call semantics demand lowercase. |
| 3 | Whitespace | No space — `sum(Notional)` | Compact. Parens read as function-call. A space (`sum( Notional )`) breaks the function-call signal. |
| 4 | Per-column override | `CColDef.suppressAggFuncInHeader: boolean` wins over `VelocityGridOptions.suppressAggFuncInHeader`; per-column `undefined` defers to the grid-level flag (default `false`). | Column-level wins is the standard cgrid override pattern (matches `floatingFilter`, `cellRenderer`, etc.). |
| 5 | Truncation | Right-side ellipsification of the whole decorated string (no special verb-preserving logic). The verb sits on the LEFT so it survives naturally; the column name + closing paren on the RIGHT truncates first. | Per the screenshot (`sum(Noti...)`, `avg(...)`). No extra measurement code in the painter. |
| 6 | Array-form aggFunc (`['sum', 'avg']`) | Use the FIRST entry as the visible prefix. Subsequent entries are fallback registry lookups (per `CColDef.aggFunc` spec), NOT visible alternates. | The header is a single label; showing `sum/avg(...)` would muddle the synthesis cue. |
| 7 | Columns WITHOUT aggFunc | No decoration; render `headerName` raw. | The toggle is a no-op for columns where there's no agg to suppress. |
| 8 | Group headers | Unchanged — the decoration applies to leaf-column headers only. Group headers carry no `aggFunc` of their own. | Cycle 14 doesn't add agg semantics to groups; that lands with the Cycle 15 row-grouping work. |

### Painter integration (canvasgrid specifics)

1. `byRows.ts` — the existing header-text path (`if (row.subgrid.isHeader)
   { value = def.headerName; valueFormatted = def.headerName; }`)
   becomes the application point of a small pure helper
   `decorateHeader(def, gridSuppress)` that returns:
     - `def.headerName ?? def.colId` when the column has no `aggFunc`,
       OR the resolved suppress flag is `true`.
     - `${aggFuncName}(${def.headerName ?? def.colId})` otherwise,
       where `aggFuncName` is `def.aggFunc` (string form) or
       `def.aggFunc[0]` (array form — first entry wins per decision 6).
2. The helper lives in `byRows.ts` (not a new module) — single use
   site, no shared dependency.
3. The header cell renderer (`'header'` registry entry) sees the
   decorated string in `value` / `valueFormatted`. Existing
   right-side ellipsification handles truncation per decision 5.
4. ZERO theme tokens added. ZERO CSS changes. The whole task is a
   text-path decorator + an options type widening + a default.
5. Runtime mutation via `setGridOption('suppressAggFuncInHeader',
   …)` routes through the runtime-options table (storage-only — the
   painter reads `this.options.suppressAggFuncInHeader` per paint,
   so a flip lights up on the next rAF). Per-column flips ride
   `updateGridOptions({ columnDefs })`, the existing column-mutation
   path — no new runtime key needed at the column level.

### States

| State | Treatment |
|---|---|
| Default (grid `suppressAggFuncInHeader: false`, column has `aggFunc`) | `sum(Notional)` |
| Grid `suppressAggFuncInHeader: true` | `Notional` |
| Column `suppressAggFuncInHeader: true` (any grid value) | `Notional` |
| Column `suppressAggFuncInHeader: false` AND grid `suppressAggFuncInHeader: true` | `sum(Notional)` (column wins) |
| Column has no `aggFunc` | `Notional` (no decoration possible) |
| Array-form `aggFunc: ['sum', 'avg']` | `sum(Notional)` (first entry wins) |
| `aggFunc: 'customX'` (unknown to registry) | `customX(Notional)` — the decoration uses the string name regardless of registry resolution; the totals cell paints empty per Task 1 spec. |

### What's explicitly NOT shipped in Task 4

- No new CSS tokens.
- No theme-level styling change.
- No weight or color differentiation between the prefix and the
  column name.
- No special truncation logic (verb-preserving ellipsification rides
  natural right-side truncation per decision 5).
- No animated transition when the toggle flips at runtime — the
  next paint reads the new value and renders the new string.
- No group-header aggFunc decoration.
- No "show all aggFuncs" mode for array-form `aggFunc` (only the
  first entry decorates the header).

### One-line summary

**Same weight, same color, lowercase verb, no spaces, parens. The
function-call signature carries the cue; weight stays out of the
synthesis vocabulary on the header row.**

### Vocabulary handed to subsequent tasks

- The "synthesis cue lives in PARENS on the header row, in WEIGHT on
  the totals row" split is now established. Task 5's `'totals'`
  renderer reads from the same chunk.totals values the header points
  at; the two cues (parens above, weight below) bracket the column
  with synthesis context without redundancy.
- If a future cycle adds a second column-level annotation (e.g.
  `sortStability: 'stable'` cueing the user that a sort is stable),
  it should follow the same rule: structural marker (icon, badge,
  parens) on the header row, weight / color on the totals row.

---

## Task 5 — Totals cell renderer (leaf polish)

**Brief recap:** The polished `'totals'` cell renderer that finishes
the Task 1 chrome at the leaf level. Default for cells in
`TotalsSubgrid` unless a column overrides `cellRenderer`. Renderer is
responsible ONLY for the value layer — text fill, alignment, padding,
and the placeholder for empty cells. The row's bg / top border /
+1 weight stop are already painted by upstream paths (`applyCellProps`,
`gridLinesPainter`, the row-bg pass).

### Subject pin

Same trader at the same financial positions grid. The job of the
leaf cell is to *land the right glyph at the right pixel column*: a
sum at the bottom of the Notional column must align decimally with
every value above it, and a column with no aggregation must read as
"intentionally absent" — not "missing data."

### Default rejected

Three AI defaults cluster here for "summary row leaf":

- **"NaN" / "—" / "" inconsistency** — let the formatter return
  whatever it returns; the cell renders raw. Trader sees "NaN" or
  empty space inconsistently across no-aggFunc columns and parses
  every one as a question. Wrong: the empty cell is a deliberate
  signal, not garbage.
- **Bold every numeric** — push weight to 600/700 so the totals
  row "obviously belongs to the row above." Wrong: the +1 weight
  stop (500) was already chosen in Task 1 precisely because 600+
  reads as bold-for-emphasis, not bold-for-synthesis. Task 5 must
  NOT override that decision.
- **Decorate the row label cell** — add an icon, a chip, a
  background tint to the leftmost cell to label the row "Total".
  Wrong: the row label, if present, is just text data — the cycle's
  consistent grammar is that label semantics live in column data,
  not in the renderer.

All three trade pixel discipline for noise.

### Risk taken

**Em-dash for empty, column-halign always, zero new typography.** The
renderer is the smallest possible delta from `numberCell` /
`textCell`: it adds ONE conditional (empty → em-dash in muted fg) and
inherits everything else. The risk is "this looks too plain" — but
plainness IS the design. The +1 weight stop + top border + tint were
the boldness; the leaf does not add to them.

### Decisions

| # | Question | Choice | Why |
|---|---|---|---|
| 1 | Font weight delta | **500** (no change — confirmed from Task 1) | Mono families step 400 → 500 → 600 → 700. 500 is a +1 stop; 600 reads as bold-for-emphasis and would compete with the tint+border lift. 450 is non-standard and falls back to 400 on JetBrains Mono. The renderer does NOT override the font — `applyCellProps` already substituted weight 500 via `withFontWeight` for `isTotals` rows. |
| 2 | Number alignment | **Inherit column halign** (right for numerics, left for text, center for explicitly center-aligned columns) | A sum that doesn't decimally line up under its column above is broken. The renderer reads `p.halign` directly — same path as `numberCell` / `textCell`. ag-grid does the same; financial-screen "always right" is wrong because text columns' empty placeholders would land in the wrong reading position. |
| 3 | Null / empty placeholder | **Em-dash `—` (U+2014) in `totalsFgMuted`** | Em-dash is industry vocabulary for "intentional absence" (hyphen `-` reads as "missing minus sign"; "N/A" verbose; blank reads as broken). `totalsFgMuted` already carved out in Task 1 (`#475569` light / `#94a3b8` dark) for exactly this. NOT lower alpha — alpha multiplication on canvas reads as "rendered then faded"; the em-dash IS muted, not faded. |
| 4 | Empty placeholder alignment | Same as the column's halign — em-dash lands right-aligned in a numeric column, left-aligned in a text column | The empty cell sits in the natural reading position for that column; the trader's eye never has to cross the cell to find it. |
| 5 | Overflow behaviour | **Cell-clip only** (no ellipsis, no truncation) — matches body cells exactly | The body's idiom is that values wider than the column get clipped on the right (the per-cell clip rect in `byRows.ts` lines 406–409 already handles this). Adding ellipsis to totals would visually diverge from data above — and the trader's "the sum is wider than its column" cue is the same one that triggers on a data cell. Consistency wins. |
| 6 | Hover state | **None** | Totals row is non-interactive in Cycle 14. The painter does not pass `isHovered: true` for totals; the renderer ignores `p.isHovered` regardless. |
| 7 | Cell padding | **6px** (identical to `textCell` / `numberCell`'s `PADDING`) | Pixel alignment between totals and data is non-negotiable for the "confirm the sum" job. A right-aligned value at `bounds.x + bounds.w - 6` lands at exactly the same x as the data cell above it. |
| 8 | Flash overlay | **Passthrough** — renderer calls `paintBackground` which already handles flash via `flashAlpha + flashFromColor`. The `FlashRegistry` does NOT currently mark totals cells dirty on chunk updates, so `flashAlpha` is undefined in practice and nothing paints. | Future cycle can add totals-flash semantics (e.g. flash a sum cell when the sum value changes between chunks) by extending FlashRegistry to track totals; this renderer rides whatever upstream contract provides. No defensive special-case. |
| 9 | Per-cell `cellStyle`/`cellClass` overrides | **Honoured** — `applyCellProps` already mutated `target.fg/bg/font/halign` for static + class-driven overrides BEFORE the renderer runs. The renderer reads `target.fg` (not `theme.totalsFg` directly), so a `cellClassRules` that paints negative sums in red just works. | Standard cgrid renderer contract; no special handling needed. |
| 10 | Row label cell | **No special rendering** — a column whose totals value is a literal string (e.g. `"Total"` returned by a custom aggFunc) reads at full `totalsFg` weight 500. Apps wanting a muted label use `cellClassRules` to override fg to a muted token. | Task 1's design notes mentioned `totalsFgMuted` "for the row label column"; in practice the renderer can't infer label-vs-value semantics without a marker. Keep the renderer simple; the muting path lives in apps' cellClassRules. |
| 11 | New theme tokens | **None.** The renderer reuses `totalsFg` (set on `target.fg` by `applyCellProps`) and `totalsFgMuted` (threaded via a new optional `emptyFg?` field on `CellPaintConfig` populated by `applyCellProps` when `isTotals`). | Task 1 already exposed every token this renderer needs. A new `emptyFg?` field on the config is the standard plumbing pattern (mirrors `flashFromColor`, added in Cycle 4 the same way). |

### Painter integration (canvasgrid specifics)

1. `CellPaintConfig` gains one optional field: `emptyFg?: string`. The
   field is populated by `applyCellProps` ONLY when `ctx.isTotals ===
   true`, set to `theme.totalsFgMuted`. For all other cells the field
   is undefined (no allocation pressure — the field is a string
   reference, not a per-cell object).
2. `cellRenderers/totals.ts` (new) registers the `'totals'` painter:
   ```
   paint(gc, p) {
     paintBackground(gc, p);          // bg + flash (passthrough)
     gc.cache.font = p.font;          // weight 500 already substituted
     gc.cache.textBaseline = 'middle';
     const empty = isEmpty(p.valueFormatted, p.value);
     gc.cache.fillStyle = empty ? (p.emptyFg ?? p.fg) : p.fg;
     const align: CanvasTextAlign = resolveAlign(p.halign);
     gc.cache.textAlign = align;
     const text = empty ? '—' : p.valueFormatted;
     const cy = p.bounds.y + p.bounds.h / 2;
     const x = align === 'right' ? p.bounds.x + p.bounds.w - PADDING
             : align === 'center' ? p.bounds.x + p.bounds.w / 2
             : p.bounds.x + PADDING;
     gc.fillText(text, x, cy);
   }
   ```
3. `velocityGrid.ts` registers the painter on construction:
   `this.cellRenderers.register('totals', totalsCell);`.
4. `byRows.ts` renderer-resolution branch: for `row.subgrid.isTotals`
   rows, the renderer name defaults to `'totals'` UNLESS the column
   defines its own `cellRenderer` (in which case the column's choice
   wins — same precedence rule as data rows).
5. Helper `isEmpty(formatted, value)` is module-local in `totals.ts`.
   "Empty" means: `value === null || value === undefined || value ===
   '' || formatted === '' || formatted === undefined`. This catches
   columns without aggFunc (chunk returns null) AND columns with an
   aggFunc that produced no value (empty filter result → NaN/undefined
   → muted em-dash).

### What's explicitly NOT shipped in Task 5

- No new theme tokens (uses Task 1's `totalsFg` and `totalsFgMuted`).
- No ellipsis / truncation logic — cell-clip handles overflow.
- No hover, focus, or selection treatment.
- No row-label column detection — apps wanting muted labels ride
  `cellClassRules`.
- No flash-on-sum-change wiring — FlashRegistry doesn't track totals
  cells today; renderer is passthrough.
- No animation when a totals value changes — the next paint reads the
  new chunk and renders the new string.
- No group-footer totals (Cycle 15).
- No multi-line totals (the renderer is single-line; if a value's
  formatted form contains newlines they pass through `fillText` as
  visible whitespace — same behavior as `textCell`).

### One-line summary

**Em-dash for empty in muted fg, column-halign always, 6px padding,
weight inherited. Smallest possible delta from `numberCell` —
boldness already lives upstream.**

### Vocabulary handed to subsequent tasks

- The `emptyFg` field on `CellPaintConfig` is the established pattern
  for "renderer-specific theme color threaded through the shared
  config." Future renderers (e.g. a `'footer'` renderer in Cycle 15)
  can add their own optional `*Fg` fields the same way.
- The "renderer is a leaf, chrome is upstream" split is now firm. Any
  Cycle 15 footer-row work follows the same shape: chrome (border +
  bg + weight) lives in `applyCellProps` + `gridLinesPainter`; the
  leaf renderer ONLY draws the value.
