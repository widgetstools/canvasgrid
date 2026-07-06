# CSS-driven styling model (Direction A) — design spec

**Date:** 2026-07-06
**Status:** Design in review (direction chosen: A — full CSS-selector model)
**Branch:** `feature/css-styling-model` (fresh off `main` @ `82b92ec`)

## 1. The problem

Today the grid has **two** styling systems (see `styling-architecture-map.md`):

- **Theme-level appearance is CSS-driven** — `tokens.css` `--cg-*` → `getComputedStyle`
  (one probe per theme swap) → `ResolvedTheme` → the base layer of every cell's
  paint config. This is exactly the intended model.
- **Everything cell-specific is CODE** — `colDef.cellStyle` (JS objects),
  `@cgrid/rules` conditional styles (`StyleSlice` objects), `@cgrid/calc`
  templates (object bags), and the `@cgrid/renderers` data-viz catalog
  (`palette.ts`, 46 hardcoded hex). CSS classes are only opaque keys into a
  kernel `Map` with a fixed 4-slot vocabulary (`--cg-cell-class-<name>-(bg|fg|font|halign)`),
  resolved by a hand-rolled regex — not real CSS.

**Goal:** make cell/column/conditional appearance authored in **real CSS**, and
have the canvas painted **generically** from it. Code's only styling jobs become:
(1) decide *which class* a cell carries, and (2) draw data-viz *geometry*
(reading its palette from CSS). This is a from-scratch rework on a fresh branch,
not an incremental layer.

## 2. Core principle

> A cell's appearance is the computed style of the CSS class(es) it carries,
> resolved through the browser's real cascade and painted generically on the
> canvas. Styling is authored in CSS. Code decides class membership and draws
> geometry.

## 3. The resolution engine (heart of the model)

Replace the narrow `scanVariantVariables()` regex path with a **style probe**:

- A hidden probe element lives inside the grid's themed root, so it inherits the
  theme cascade **and** any consumer CSS scoped to the grid.
- To resolve a class string, set `probe.className = 'cg-cell ' + classes`, call
  `getComputedStyle(probe)`, read the supported properties (§4), map them to the
  paint vocabulary, and **cache** the result keyed by the exact class string.
- Cost is O(distinct class-combinations), not O(cells) — one probe read per novel
  class string, then cache hits. The probe element is reused.
- **Invalidation:** theme swap (already a signal today), and stylesheet changes
  (a `refreshCellStyles()` API call and/or a `MutationObserver` on the grid's
  `<style>`/`<link>` set). On invalidation: clear cache, repaint.

This is real "supply CSS → computed style → paint," at cell granularity.

## 4. Supported CSS → paint vocabulary

The canvas honors the subset that maps to the existing `ColCellOverrides` fields
(`types/cell.ts`):

| CSS property | Paint field |
|---|---|
| `color` | `fg` |
| `background-color` | `bg` |
| `font-family` / `font-size` / `font-weight` / `font-style` | `font` |
| `text-align` | `halign` |
| `padding-top/right/bottom/left` | `padding` |
| `border` / `border-*-width/-style/-color` | `border` |
| `text-transform` | `textTransform` |
| `letter-spacing` | `letterSpacing` |
| `line-height` | `lineHeight` |
| `text-decoration` | `textDecoration` |
| `--cg-cell-valign` (custom prop; no canvas CSS equivalent) | `valign` |

Properties a 2D canvas cannot reproduce (`box-shadow`, gradients, `transform`,
`filter`, pseudo-elements) are **documented as not honored**. This "supported
subset" is a normative section of the final spec.

## 5. Authoring API (how consumers style)

- `colDef.cellClass: string | string[] | (params) => string | string[]` — the
  class(es) a cell carries.
- `colDef.cellClassRules: { [className]: (params) => boolean }` — predicate map;
  the predicate (code/config) decides membership, the *style* is the class's CSS.
  (Both fields already exist and stay.)
- `colDef.headerClass` / `headerClassRules` — same, for headers.
- Consumers author ordinary CSS (their own classes, or grid-shipped defaults like
  `.cg-num-negative`). The class rules can live anywhere in the cascade scoped to
  the grid root.
- **Removed:** `colDef.cellStyle` / `headerStyle` **object** authoring (the JS
  style-object path). See Decision D1 for the escape-hatch question.

## 6. Rules & calc become CSS generators

To keep a **single styling substrate**, the two engines stop emitting style
*objects* applied at paint and instead **generate CSS + assign class names**:

- **`@cgrid/rules`** (conditional styling, authored via the rule-builder UI):
  each rule compiles to a managed CSS class rule (`.cg-rule-<id> { … }`) injected
  into a grid-owned `<style>`; the rule's predicate assigns `cg-rule-<id>` to
  matching cells. The UI edits CSS-property values that serialize to that
  stylesheet. Theme-aware rules use the cascade (a `.cg-theme-x .cg-rule-<id>`
  selector or a `--cg-*` var) instead of the current `base/light/dark` object
  triple.
- **`@cgrid/calc`** styling templates: each template compiles to a class
  (`.cg-tpl-<id> { … }`) assigned to the columns that use it; template CRUD edits
  the generated CSS.

Net: the paint path only ever resolves classes → computed style. Rules/calc
become **class generators + assigners**, not object-patchers. (See Decision D2.)

## 7. Data-viz (opt-in code renderers)

Data-viz stays an **opt-in** layer: a column asks for a `bar`/`heat`/`gauge`/…
renderer via code **or UI tooling** (the column customizer). Geometry is drawn in
code; **all palette/dimension values come from CSS** — theme tokens
(`--cg-pos-color`) or the column's resolved class (the renderer reads the same
probe). `palette.ts`'s 46 hardcoded literals move into CSS tokens/defaults.

The exact renderer-config surface (code API + UI tooling) is **TBD** and scoped
in its own follow-on design — this spec fixes only that data-viz *appearance*
comes from CSS, never hardcoded swatches.

## 8. Precedence (shape unchanged, all CSS-resolved)

`applyCellProps` precedence, lowest → highest:

1. Theme base (CSS tokens → `ResolvedTheme`) — unchanged.
2. Cell class(es) resolved via the probe (§3) — includes rule- and
   calc-generated classes. Multiple classes resolve through the real cascade in
   one probe read (specificity/order handled by the browser, not by us).
3. (If Decision D1 keeps it) a dynamic escape hook — highest.

Steps that exist today for object `cellStyle` / `StyleSlice` folds are removed;
their behavior is expressed as generated classes in step 2.

## 9. Migration (phased, fresh branch)

1. **Probe resolver** — new `getComputedStyle`-per-class resolver + cache +
   invalidation in `cssReader`/theming; unit-tested against a jsdom/happy-dom
   stylesheet.
2. **Paint path** — `applyCellProps` step 2 consumes the resolver's full
   `ColCellOverrides`; remove `scanVariantVariables` 4-slot path.
3. **Rules → CSS** — refactor `@cgrid/rules` to compile rules to a managed
   stylesheet + class assignment; update the rule-builder UI serialization.
4. **Calc → CSS** — refactor `@cgrid/calc` styling templates to compiled classes.
5. **Data-viz palette → CSS** — move `palette.ts` literals to tokens; renderers
   read CSS.
6. **Remove object `cellStyle`** authoring (or reduce to the D1 escape).
7. **Docs** — the supported-CSS-subset reference; migration guide.

Each phase ends with a working, tested grid.

## 10. Open decisions (need your call before the plan)

- **D1 — Escape hatch.** Pure A removes the `cellStyle` object entirely; every
  style is a class. Genuinely *dynamic* per-value styling (rare, non-continuous)
  would then need a predicate assigning a class. Options: (a) pure — classes
  only; (b) keep a thin, documented `cellStyleFn` escape for dynamic cases.
- **D2 — Rules/calc substrate.** (a) Generate real CSS + assign classes (purest
  A; the engines own a managed stylesheet); (b) keep their internal object model
  but resolve it through the probe via a generated-CSS bridge (less engine
  churn, same paint path). §6 assumes (a).
- **D3 — Supported CSS subset.** Confirm the §4 table; decide whether any
  unsupported property should be *approximated* (e.g. a single-layer box-shadow
  → nothing, or a faux 1px border) or strictly ignored.
- **D4 — Data-viz config surface.** Scope the code + UI tooling for opt-in
  renderers now, or defer to a follow-on design (this spec only fixes that their
  appearance is CSS-sourced).

## 11. Out of scope

- The look-and-feel Perspective refresh (its own branch; orthogonal — it's
  already CSS-token-driven and can rebase onto this model later).
- Data-viz *geometry* (inherently code on a canvas).
- The full data-viz renderer-config surface (D4 — follow-on).
