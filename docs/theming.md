# Theming — the `CgTheme` object

cgrid themes can be a **CSS class name** (`theme: 'cg-theme-quartz'`) or a
**programmatic theme object** (`CgTheme`). The object is a typed abstraction over
the `--cg-*` CSS tokens: you set semantic parameters in JS/TS, and cgrid compiles
them to CSS custom properties (as `color-mix()`/`var()`/`calc()` **expressions**,
resolved live by the browser) injected onto the grid root. Both forms are
supported; the object API is additive and string themes are unchanged.

```ts
import { CGrid, themeQuartz } from '@cgrid/kernel';

const myTheme = themeQuartz
  .withParams({ accentColor: '#2f7bc4', backgroundColor: '#16181d', rowHeight: 24 })
  .withParams({ backgroundColor: '#ffffff' }, 'light');   // per-mode override

new CGrid(el, { theme: myTheme });
```

## Building a theme

- **Built-ins** (extend these): `themeQuartz`, `themeStarui`, `baseTheme`
  (= `themeQuartz`). An unmodified built-in is byte-identical to its CSS class.
- **`withParams(params, mode?)`** — returns a NEW theme (immutable) with the
  params layered on. `mode` (`'light'`/`'dark'`) ties params to a color mode;
  omit it for params that apply to both. Later layers win.
- **`createTheme({ baseClass })`** — start from a specific structural base class
  pair `{ light, dark }` (defaults to quartz).

## Parameters

~77 named semantic params, grouped: **foundational** (`backgroundColor`,
`foregroundColor`, `accentColor`), **geometry** (`rowHeight`, `headerHeight`,
`borderRadius`, `scrollbarThickness`…), **typography** (`fontFamily`,
`cellFontFamily`, `fontSize`…), **borders/lines**, **rows** (`rowHoverColor`,
`selectedRowBackgroundColor`, `oddRowBackgroundColor`), **header**,
**focus/range**, **inputs/tooltip/popup/menu/checkbox**,
**totals/group/pinned/footer**, **status-bar**, **filter/flash**, and the
**renderer palette** (`positiveColor`, `negativeColor`, `warningColor`,
`infoColor`, `mutedColor`, `statusColors`, `ratingColors`, `venueColors`,
`barHeight`, `chipHeight`, `chipRadius`). Any param you don't set falls through
to the base class.

**Derivation.** The three foundational colors drive the rest: set `accentColor`
and `--cg-row-hover-bg`/`--cg-row-selected-bg`/range colors re-derive as
`color-mix()` of the accent onto the background — live, no recompute. Derivations
fire only when a foundational input is set, so an empty theme changes nothing.

### Value forms

- **Color** — `'#2f7bc4'` / `'rgb(...)'` / `'oklch(...)'`; `{ ref: 'accentColor' }`
  → `var(--cg-chrome-accent)`; `{ ref: 'accentColor', mix: 0.25, onto: 'backgroundColor' }`
  → `color-mix(in srgb, var(--cg-chrome-accent) 25%, var(--cg-bg-color))`.
- **Length** — `8` → `8px`; `'1.5rem'`; `{ ref: 'spacing' }`; `{ calc: '... - 2px' }`.
- **Font family** — string or `string[]` (comma-joined). **Font weight** — number/keyword.
- **Border** — a CSS shorthand string, or `true`/`false`.

### Escape hatch

Any token not covered by a named param is reachable verbatim (highest precedence):

```ts
themeQuartz.withParams({ vars: { '--cg-group-indent': '18px' } });
```

## Parts

`withPart(part)` / `withoutPart(feature)` plug in reusable bundles. A `Part` is a
labelled set of params (+ optional `mode` and raw `css`); one part per `feature`
(a new part of the same feature replaces it):

```ts
const compactInputs = { feature: 'inputStyle', params: { inputBackgroundColor: { ref: 'backgroundColor' } } };
themeQuartz.withPart(compactInputs);
```

## Modes (light / dark)

A theme with per-mode params picks its mode from, in order: (1) a
`data-cg-theme-mode="light|dark"` attribute on the grid root or an ancestor,
(2) OS `prefers-color-scheme` (a listener re-tints on change when no attribute is
set), (3) light. Imperatively: `grid.setThemeMode('dark')`. The correct
`-dark` base class is applied so `getThemeKind()` stays honest.

## Runtime

- `grid.setTheme(stringOrCgTheme)` — swap theme (object or class); prior object
  vars are cleared cleanly.
- `grid.setThemeParams({ '--cg-x': '…' })` — low-level per-token override
  (unchanged); `getThemeParams()` reports only these user overrides, not the
  object-derived vars.

## Relationship to CSS

Everything compiles to scoped `--cg-*` custom properties on the grid root, so raw
CSS still overrides (normal cascade). The object is a typed authoring layer over
the same tokens — see [css-styling.md](css-styling.md) for per-cell CSS styling.
