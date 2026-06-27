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
