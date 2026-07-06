# CSS-driven styling model — design spec

**Date:** 2026-07-06
**Status:** Design approved-in-principle (decisions settled); vocabulary audited; ready for implementation plan
**Branch:** `feature/css-styling-model` (fresh off `main` @ `82b92ec`)

## 1. The problem

The grid has **two** styling systems today (see `styling-architecture-map.md`):

- **Theme-level appearance is CSS-driven** — `tokens.css` `--cg-*` →
  `getComputedStyle` (one probe per theme swap) → `ResolvedTheme` → the base
  layer of every cell's paint config. This is the intended model.
- **Per-column / per-cell appearance is CODE** — `colDef.cellStyle` (JS style
  objects), `@cgrid/calc` styling templates (object bags), and the
  `@cgrid/renderers` data-viz catalog (`palette.ts`, 46 hardcoded hex). The one
  CSS-class mechanism is a narrow 4-slot custom-property regex, not real CSS.

**Goal:** all **theming** — grid-wide and per-column/per-cell appearance — is
authored in **CSS only** and **mapped to the canvas paint artifacts**. We are
not styling DOM elements; we map CSS attributes onto the paint vocabulary the
canvas already draws. Code's only styling jobs become: draw data-viz *geometry*
(reading its palette from CSS), and evaluate *conditional* predicates (via the
existing rules engine).

## 2. Core principle (settled)

> Theming is authored in CSS and mapped to the canvas paint artifacts. The
> canvas is painted generically from that mapping. No code-authored theme or
> column styling.

**Settled decisions:**

- **D1 — Theming is CSS-only.** The JS `cellStyle` / `headerStyle` **object**
  authoring path is removed. Column/cell appearance is authored as CSS resolved
  onto the paint artifacts (§3–§4). (No JS style-object escape hatch for
  theming.)
- **D2 — Conditional styling keeps the existing `@cgrid/rules` engine.** It is
  dynamic and UI-authored; it already targets the same paint artifacts. It is
  NOT rebuilt into CSS generation. Two authoring surfaces (CSS for theming, the
  rule-builder UI for conditional), **one** paint vocabulary.
- **D3 — Unsupported CSS is approximated** where feasible (§4), else ignored +
  documented.
- **D4 — Data-viz renderer config is scoped into this design** (§7): opt-in
  renderers configured via code **or** column UI tooling; palette from CSS.

## 3. The resolution engine (heart of the model)

Replace the narrow `scanVariantVariables()` regex path with a **style probe**:

- A hidden probe element lives inside the grid's themed root, so it inherits the
  theme cascade **and** any consumer CSS scoped to the grid.
- To resolve a class string, set `probe.className = 'cg-cell ' + classes`, call
  `getComputedStyle(probe)` (and `getComputedStyle(probe, '::before')` for
  content/icon conventions if used), read the supported properties (§4), map them
  to the paint artifacts, and **cache** the result keyed by the exact class
  string.
- Cost is O(distinct class-combinations), not O(cells) — one probe read per novel
  class string, then cache hits. Probe element reused.
- **Invalidation:** theme swap (existing signal) and stylesheet changes (a
  `refreshCellStyles()` API and/or a `MutationObserver` on the grid's
  `<style>`/`<link>` set). On invalidation: clear cache, repaint.

This is real "supply CSS → computed style → paint artifacts," at cell
granularity, resolving the full browser cascade (specificity, `var()`,
`color-mix()`, media/theme variants) for free.

## 4. CSS → paint-artifact mapping (vocabulary AUDITED — complete)

The paint vocabulary (`ColCellOverrides`, `types/cell.ts`) already covers every
required artifact for **cells and headers**. Mapping:

### 4.1 Direct CSS-property mappings

| CSS property | Paint artifact |
|---|---|
| `color` | `fg` |
| `background-color` / `background` | `bg` |
| `border-<side>-width` / `-style` / `-color` (per side) | `BorderSpec.<side>.{width,style,color}`; `width:0` or `border-<side>-style:none` → invisible |
| `border-width/style/color` (shorthand, all sides) | `BorderSpec.all` |
| `font-family` | `fontFamily` |
| `font-size` | `fontSize` |
| `font-weight` | `fontWeight` |
| `font-style` | `fontStyle` |
| `text-align` | `halign` |
| `text-transform` | `textTransform` |
| `text-decoration-line` | `textDecoration` (`underline`/`line-through`) |
| `letter-spacing` | `letterSpacing` |
| `line-height` | `lineHeight` |
| `padding-<side>` | `padding.{top,right,bottom,left}` |

### 4.2 Custom-property mappings (canvas artifacts with no native CSS property)

The canvas-specific artifacts (icons, decorators, vertical alignment,
content-slot override) use a small `--cg-cell-*` convention resolved off the
same probe — identical in spirit to the existing theme tokens:

| Custom property | Paint artifact |
|---|---|
| `--cg-cell-valign: top\|middle\|bottom` | `valign` |
| `--cg-cell-content: "text"` / `--cg-cell-icon: <name>` / `--cg-cell-emoji: "🚀"` (+ `-color`, `-size`, `-position`) | `content` (`CellContent` text/icon/emoji/icon-text) |
| `--cg-cell-decorator-<pos>: <icon\|emoji\|text\|dot spec>` (`pos` ∈ tl,tr,bl,br,ml,mr; + `-color`/`-size`/`-inset`/`-bg`) | `decorators[]` (`CellDecorator`) |

(Exact custom-property grammar for the composite artifacts — icon+text, decorator
specs — is fixed in the plan; the shapes already exist in `CellContent` /
`CellDecorator`.)

### 4.3 Approximation of unsupported CSS (D3)

A 2D canvas cannot reproduce some CSS. Best-effort approximations, else ignore +
document:
- `box-shadow` → approximate as a 1px `BorderSpec.all` in the shadow color (or
  ignore if `inset`/blur make it meaningless).
- simple single-stop-direction `linear-gradient` background → midpoint solid
  `bg`; multi-stop / `radial-gradient` → ignore.
- `transform`, `filter`, pseudo-element decoration beyond the content convention,
  `outline` → ignored + documented.

The supported set + approximations become a normative reference doc.

## 5. Authoring API (how consumers style)

- `colDef.cellClass: string | string[] | (params) => string|string[]` — the
  class(es) a cell carries (exists; stays).
- `colDef.cellClassRules: { [className]: (params) => boolean }` — predicate
  decides class membership; the *style* is the class's CSS (exists; stays).
- `colDef.headerClass` / `headerClassRules` — same, for headers.
- Consumers author ordinary CSS scoped to the grid root (their own classes, or
  grid-shipped defaults). Full cascade applies.
- **Removed:** `colDef.cellStyle` / `headerStyle` **object / function** authoring
  (the code path). Any appearance it expressed is now a CSS class (§4 covers the
  full vocabulary).

## 6. Conditional styling & calc templates

- **`@cgrid/rules` (conditional) — KEPT as-is (D2).** A rule stays a predicate +
  a style targeting the paint artifacts, authored via the rule-builder UI. It is
  dynamic (per row value) — the one thing static CSS can't express — so it
  remains the code/UI path, layered over the CSS theming in the precedence chain
  (§8). No rebuild.
- **`@cgrid/calc` styling templates — migrate to CSS classes.** A calc styling
  *template* is reusable **static** column appearance (e.g. a "currency"
  template) — that is theming, so under D1 a template becomes a CSS class the
  column references, not an object patch. Calc's *calculated-column* feature
  (values/formulas) is unaffected. (Scoped as its own migration phase; if the
  template↔class mapping proves to need a bridge, that's a plan-level detail.)

## 7. Data-viz renderers (scoped — D4)

Data-viz stays an **opt-in** layer; geometry is drawn in code, **all appearance
comes from CSS**.

- **Config via code:** `colDef.cellRenderer: 'bar' | 'heat' | 'gauge' | …` +
  `cellRendererParams` for non-appearance config (domains, fields, thresholds).
- **Config via UI tooling:** the column customizer lets a user pick a renderer
  and its params for a column (persisted in column state / layouts). This reuses
  the existing tool-panel/customizer surface; the exact panel UX is a plan task.
- **Appearance from CSS:** every color/dimension a renderer draws resolves from
  CSS — theme tokens (`--cg-pos-color`, a new `--cg-bar-height`, `--cg-heat-*`,
  etc.) or the column's resolved class via the same probe. `palette.ts`'s 46
  literals move into CSS tokens/defaults; `SEMANTIC_COLORS`/`STATUS_PILL_MAP`/
  `RATING_SCALE_BANDS`/`DEFAULT_VENUE_PALETTE` become token-backed.
- **Non-appearance params stay code** (a bar's data domain, a gauge's min/max) —
  those are data config, not styling.

## 8. Precedence (all theming CSS-resolved)

`applyCellProps`, lowest → highest:

1. **Theme base** — grid-wide CSS tokens → `ResolvedTheme` (unchanged).
2. **Column/cell CSS class(es)** — resolved via the probe (§3) into full
   `ColCellOverrides`; replaces the old 4-slot `cellClassVariants` path.
   Multiple classes resolve through the real cascade in one probe read.
3. **Conditional rules** — `@cgrid/rules` engine (kept), dynamic per-cell,
   layered over the CSS class styling.
4. (Cosmetic, last) `textTransform` applied to the formatted string.

No JS `cellStyle`-object fold remains.

## 9. Vocabulary audit result (complete — no gaps)

`ColCellOverrides` (`types/cell.ts:111-173`) already carries: `fg`, `bg`,
`halign`, `valign`, `font`/`fontFamily`/`fontSize`/`fontWeight`/`fontStyle`,
`textTransform`, `textDecoration`, `letterSpacing`, `lineHeight`, `padding`
(uniform or per-side), `border` (`BorderSpec` per-side + `all`, each
width/style/color; width 0 = invisible), `content` (`CellContent`:
text/icon/emoji/icon-text), `decorators` (`CellDecorator[]`, 6 positions,
icon/emoji/text/dot, optional badge). Header cells consume the same vocabulary
via `headerStyle`/`headerClass` (`applyCellProps` header branch). **Every
artifact you listed — header+cell bg/fg, per-side borders (width/style/color/
visibility), icons/emojis, font family/size/style, content alignment — is
already a paint artifact.** The work is the CSS→artifact mapping (§4), not new
paint capability.

## 10. Migration (phased, fresh branch)

1. **Probe resolver** — `getComputedStyle`-per-class resolver + full-vocabulary
   mapping (§4) + cache + invalidation; unit-tested against a
   happy-dom/jsdom stylesheet. Replaces `scanVariantVariables`.
2. **Paint path** — `applyCellProps` step 2 consumes the resolver's full
   `ColCellOverrides`; remove the 4-slot path; keep the rules fold (step 3).
3. **Remove object `cellStyle`/`headerStyle`** authoring; migrate internal
   callers/tests to classes.
4. **Calc templates → CSS classes** (styling templates only; calculated columns
   untouched).
5. **Data-viz palette → CSS** — `palette.ts` literals → tokens; renderers read
   CSS; add `--cg-bar-*`/`--cg-heat-*`/status/rating tokens.
6. **Data-viz config UI** — column customizer picks renderer + params.
7. **Docs** — supported-CSS-subset + custom-property reference; migration guide.

Each phase ends with a working, tested grid. Rules engine untouched throughout.

## 11. Out of scope

- The look-and-feel Perspective refresh (own branch; already CSS-token-driven;
  rebases onto this model later).
- Data-viz *geometry* (inherently code on a canvas).
- The `@cgrid/rules` conditional engine internals (kept as-is).
