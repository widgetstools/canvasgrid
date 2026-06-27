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
| `--cg-totals-bg` | `#f7f9fb` | 3% slate tint over body `#ffffff` — lifted, not different |
| `--cg-totals-fg` | `#0f172a` | one stop darker than body fg `#1a1f24` |
| `--cg-totals-border-top` | `#cbd5e1` | between gridline `#eceff2` and header border `#d5dbe0` |
| `--cg-totals-fg-muted` | `#475569` | for the row label column (Task 5 renderer uses this) |
| `--cg-totals-font-weight` | `500` | body is `400` — +1 stop only |
| `--cg-totals-row-height` | `var(--cg-row-height)` | SAME as body. Do not inflate. |

**Dark theme `.cg-theme-dark`:**
| Token | Value | Why |
|---|---|---|
| `--cg-totals-bg` | `#0f1d36` | 5% upward from body `#0a1428`, no temperature shift |
| `--cg-totals-fg` | `#e2e8f0` | one stop brighter than body fg `#cbd5e1` |
| `--cg-totals-border-top` | `#4a6391` | between gridline `#2b3a5c` and header border `#38507a` |
| `--cg-totals-fg-muted` | `#94a3b8` |   |

**Placeholders:**
```css
.cg-totals-row  { /* placeholder — Task 5 renderer reads tokens via cssReader */ }
.cg-totals-cell { /* placeholder — per-cell polish lands in Task 5 */ }
```

### Layout

| Property | Value | Rationale |
|---|---|---|
| Row height | `var(--cg-row-height)` (32px) | No inflation — body-consistent rhythm |
| Top border | 1px solid `--cg-totals-border-top`, painted at `Math.round(row.top) - 1` | Same idiom as the existing bodyTop separator |
| Bottom border | None | Canvas edge / status-bar top border handles it — no double-border |
| Cell padding | 6px (body PADDING) | Body alignment, not header alignment |
| Per-cell halign | Inherits the column's halign | Right for numerics, left for text — matches the data column above |
| Font family | `var(--cg-font-family)` | Same monospace stack as body |
| Font size | `var(--cg-font-size)` (13px) | Same as body — doesn't shout |
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
- The `--cg-totals-*` token family is the single source for chrome
  decisions. Tasks 2–6 extend it as needed (Task 2 may add
  `--cg-pinned-row-*` siblings; Task 5 may add `--cg-totals-fg-empty`
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

- Same 1px structural border (single `--cg-totals-border-top` reused)
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
| `--cg-pinned-row-bg` | `#fbf8f3` | 3% warm cream tint over body `#ffffff` — same luminosity lift as `--cg-totals-bg` (`#f7f9fb`), opposite temperature |
| `--cg-pinned-row-fg` | `var(--cg-fg)` | Inherit body fg — no synthesis emphasis |
| `--cg-pinned-row-border` | `var(--cg-totals-border-top)` (`#cbd5e1`) | SAME color as totals border. Single source for "outside body" boundary |
| `--cg-pinned-row-font-weight` | `400` | Inherit body weight. +1 stop is reserved for totals synthesis |

**Dark theme `.cg-theme-dark`:**
| Token | Value | Why |
|---|---|---|
| `--cg-pinned-row-bg` | `#241e16` | 5% upward from body `#0a1428` with an amber shift — warm cast survives the theme flip |
| `--cg-pinned-row-fg` | `var(--cg-fg)` | Inherit |
| `--cg-pinned-row-border` | `var(--cg-totals-border-top)` (`#4a6391`) | Same body-edge boundary |

**Placeholders:**
```css
.cg-pinned-row  { /* placeholder — Task 5 polished renderer may extend */ }
.cg-pinned-cell { /* placeholder — per-column override hook lands later */ }
```

### Layout — pinned vs totals comparison

| Property | Pinned | Totals (Task 1) |
|---|---|---|
| Row height | `var(--cg-row-height)` (32px) | `var(--cg-row-height)` (32px) |
| BG tint | warm 3% / 5% | slate 3% / 5% |
| FG | inherit body | one stop darker |
| Font weight | 400 (body) | 500 (+1) |
| Structural border (body-side edge) | 1px `--cg-pinned-row-border` | 1px `--cg-totals-border-top` (same color) |
| Between-row divider (multi-pinned) | `--cg-gridline` (standard row divider) | N/A — totals is a single row |
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
[ structural border ]  ← 1px --cg-pinned-row-border
[ data band ]
```

ONE warm zone, ONE body-side boundary, member rows still individually
legible via the standard gridline.

### Coexistence — pinned + totals (both bottom)

```
[ data band ]
[ pinned-bottom rows ]  ← warm tint
[ structural border ]   ← 1px --cg-pinned-row-border (top edge of pinned stack)
[ totals row ]          ← slate tint
[ structural border ]   ← 1px --cg-totals-border-top (top edge of totals)
```

Two distinct tints + two boundaries make "pinned" and "totals"
instantly tellable apart. Both borders use the same color (single
source) but each owns its position via the subgrid above it.

### Painter integration (canvasgrid specifics)

1. `cssReader.ts` exposes `pinnedRowBg`, `pinnedRowFg`, and
   `pinnedRowBorder` on `ResolvedTheme`. The border value is read from
   `--cg-pinned-row-border` which CSS-aliases to
   `--cg-totals-border-top`; we expose it as a separate field so the
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

- The `--cg-pinned-row-*` family is committed and may be extended by
  Task 5 if a per-column pinned override surfaces.
- The structural border color `--cg-totals-border-top` is now a SHARED
  token used by both pinned and totals chrome — treat it as a
  cycle-14 primitive.
- The temperature contrast (slate = computed, cream = anchored) is
  established. Future cycles adding new subgrid types (footer, etc.)
  pick a tint temperature that matches the row's cognitive role.
