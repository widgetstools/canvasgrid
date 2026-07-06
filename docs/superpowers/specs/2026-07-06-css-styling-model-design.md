# CSS-driven styling model (token-first) — design spec

**Date:** 2026-07-06
**Status:** Approved (leaner token-first approach); ready for implementation
**Branch:** `feature/css-styling-model` (fresh off `main` @ `82b92ec`)

## 1. Problem & principle

Appearance is split between CSS (theme tokens) and CODE (`palette.ts` 46 hex,
`cellStyle` objects, calc templates). Goal: **all appearance comes from CSS**,
mapped to the canvas paint artifacts, read through the **single theme probe**
(`getComputedStyle` once per theme swap) — **never per-cell** — so we don't
reintroduce the DOM layout cost a canvas grid exists to avoid.

> Principle: styling values live in CSS (tokens / custom-property variants) and
> map to the paint artifacts. Code holds *structure and geometry* (semantic
> name → token, how to draw a bar), never style *values*. Typed style objects
> remain as a programmatic/UI representation, made token-referenceable.

**Rejected:** a `getComputedStyle`-per-class probe (per-cell reflow; forces a
decorator string-DSL; deletes a good typed API). This spec keeps the existing
single-scan custom-property mechanism and *broadens* it.

## 2. Workstream A — tokenize all hardcoded appearance

Move every hardcoded style **value** out of code into CSS tokens; code keeps only
the *semantic → token-name* wiring (not a style value).

- **`@cgrid/renderers/palette.ts`:**
  - `SEMANTIC_COLORS` — add theme tokens `--cg-warning-color`, `--cg-info-color`,
    `--cg-muted-color` (join existing `--cg-pos-color`/`--cg-neg-color`).
  - `STATUS_PILL_MAP` (6 states) → `--cg-status-<state>-bg` / `-fg` / `-border`.
  - `RATING_SCALE_BANDS` (24 grades) → `--cg-rating-<grade>-color`.
  - `DEFAULT_VENUE_PALETTE` → `--cg-venue-<mic>-color`.
  - The TS module keeps the **names/order** (structure) but reads **values** from
    the resolved theme; the current literals become code-level *fallbacks* only
    (used when a theme omits a token — defensive, matching cssReader's pattern).
- **Threading:** `cssReader` resolves a compact renderer-palette group into
  `ResolvedTheme`; `applyCellProps` threads it onto `CellPaintConfig` (a
  `palette` sub-object, alongside the existing `posColor`/`negColor`). Renderers
  resolve `overrides ?? config.palette.X ?? FALLBACK` (extends today's
  `p.posColor ?? SEMANTIC_COLORS.positive`).
- **Geometry-as-style tokens:** the clear *style* dimensions (`--cg-bar-height`,
  `--cg-chip-height`/`-radius`, heat endpoints) become tokens with fallbacks.
  Pure layout constants (paddings the painter computes) stay code.
- Themes that want these declare the tokens; quartz/starui/perspective get
  sensible defaults. **No behavior change for a theme that omits a token**
  (fallback = today's literal).

## 3. Workstream B — broaden the CSS-class variant mechanism to the full vocabulary

Today `scanVariantVariables()` (`cssReader.ts`) reads
`--cg-cell-class-<name>-(bg|fg|font|halign)` → a 4-field `ColCellOverrides`.
**Broaden the parser to the FULL `ColCellOverrides` vocabulary**, read in the
same single theme scan (no per-cell cost):

| Custom property (`--cg-cell-class-<name>-…`) | `ColCellOverrides` field |
|---|---|
| `-fg` / `-bg` | `fg` / `bg` |
| `-halign` / `-valign` | `halign` / `valign` |
| `-font` / `-font-family` / `-font-size` / `-font-weight` / `-font-style` | `font` / `fontFamily` / `fontSize` / `fontWeight` / `fontStyle` |
| `-text-transform` / `-text-decoration` / `-letter-spacing` / `-line-height` | `textTransform` / `textDecoration` / `letterSpacing` / `lineHeight` |
| `-padding` / `-padding-<side>` | `padding` (uniform or per-side) |
| `-border-<side>-width` / `-style` / `-color`, `-border-<side>` shorthand, `-border` (all) | `border` (`BorderSpec` per side + `all`) |
| `-icon` / `-emoji` / `-content` (+ `-icon-color`/`-icon-size`) | `content` (`CellContent`) |
| `-decorator-<pos>` (+ `-color`/`-size`/`-inset`/`-bg`) | `decorators[]` (`CellDecorator`) |

Same for `--cg-header-class-<name>-*` → header overrides. This gives real
CSS-authored per-cell styling (cascades, theme-swappable) across the WHOLE
vocabulary, still read once per theme, no reflow. A consumer writes:

```css
.cg-grid {
  --cg-cell-class-loss-fg: #e63946;
  --cg-cell-class-loss-bg: rgba(230,57,70,.08);
  --cg-cell-class-loss-border-left-width: 2px;
  --cg-cell-class-loss-border-left-color: #e63946;
  --cg-cell-class-loss-decorator-tr: "▼";
}
```
and `colDef.cellClass: 'loss'` (static / function / `cellClassRules`).

## 4. Workstream C — keep typed `cellStyle`, make it token-referenceable

- **`colDef.cellStyle` / `headerStyle` objects STAY** (typed, programmatic, used
  by the UI customizer and calc). Not removed.
- **Token-referenceable:** a style value of the form `var(--cg-…)` (or a bare
  token name) is resolved through `ResolvedTheme` at resolve time, so objects can
  pull values from CSS instead of hardcoding them. Colors first
  (`fg`/`bg`/border colors); the resolver is theme-swap-aware (re-resolves on
  theme change).
- **Calc styling templates** keep their object shape but their VALUES may now be
  token references (WS-C) — no separate CSS-class migration needed, and calc's
  calculated-column feature is untouched.

## 5. Precedence (unchanged shape)

`applyCellProps`, lowest → highest:
1. Theme base (tokens → `ResolvedTheme`).
2. **CSS-class variants** — `cellClass`/`cellClassRules` → broadened
   full-vocabulary `ColCellOverrides` (WS-B).
3. **`cellStyle` object** — token-referenceable (WS-C).
4. **Conditional rules** — `@cgrid/rules` (kept as-is, dynamic).
5. (Last) `textTransform` on the formatted string.

## 6. Testing

- **Unit (kernel):** `cssReader` parses every new `--cg-cell-class-*` slot into
  the right `ColCellOverrides` field (per-side border, padding, content,
  decorators, font breakouts, valign, text-*); resolves the new renderer-palette
  + geometry tokens (with fallback when absent); the `var(--cg-…)`-in-cellStyle
  resolver.
- **Unit (renderers):** each data-viz painter reads its color from
  `config.palette` when present, falls back to the literal when absent (pos/neg
  pattern extended to warning/info/muted/status/rating).
- **Regression:** full kernel + renderers + calc suites stay green; quartz/starui
  themes render byte-identical (every new token has the old literal as fallback).
- **Browser-verify (controller):** a demo cellClass exercising border/icon/
  decorator/font via CSS custom properties; data-viz colors driven by tokens
  (swap a token, see the bar/heat/pill recolor); both themes.

## 7. Out of scope

- A `getComputedStyle`-per-class probe (rejected — §1).
- Removing `cellStyle` objects (kept — §4).
- The `@cgrid/rules` conditional engine internals (kept).
- Data-viz *geometry* (code); only its *values* move to CSS.
- The look-and-feel Perspective branch (orthogonal).
