# 21 — Themes & Styling

## Concept

AG Grid 35.x ships a new **Theming API** (introduced in v33) that replaces the legacy CSS-file / class-name approach. A theme is a typed TypeScript object created from built-in theme factories (`themeQuartz`, `themeAlpine`, `themeBalham`, `themeMaterial`) or the low-level `createTheme()`. Themes are parameterised via `withParams()` (changing CSS variable values) and composable via `withPart()` (replacing design sub-systems like icon sets, checkbox styles, color schemes).

The legacy approach — importing `ag-theme-quartz.css` and setting `class="ag-theme-quartz"` on the wrapper — is still available by setting `theme: 'legacy'` in grid options, but is not recommended for new projects.

Cell-level styling (independent of the grid theme) is applied in precedence order: `cellClass` → `cellClassRules` → `cellStyle`, mirroring CSS specificity. These are documented in `02-column-model.md` and cross-referenced here.

## Configuration surface

### Theme grid options

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `theme` | `Theme \| 'legacy'` | `themeQuartz` | Community | The theme object to apply, or `'legacy'` to opt into the v32 CSS class approach. |
| `loadThemeGoogleFonts` | `boolean` | `false` | Community | Automatically load Google Fonts declared in the theme (e.g. Inter for Quartz) from Google's CDN. |
| `themeCssLayer` | `string` | `undefined` | Community | Wraps generated theme CSS in a `@layer <name> { }` block for cascade layer control. Pair with `themeStyleContainer: document.body`. |
| `styleNonce` | `string` | `undefined` | Community | Sets a `nonce` attribute on `<style>` elements injected by the theme, enabling the CSP `style-src 'nonce-<value>'` directive. |
| `themeStyleContainer` | `HTMLElement \| (() => HTMLElement \| void)` | `document.head` | Community | Element into which theme `<style>` tags are inserted. Use `document.body` with `themeCssLayer` or for shadow DOM support. Initial. |

### Built-in theme objects

| Theme | Type | Default | Tier | Description |
|-------|------|---------|------|-------------|
| `themeQuartz` | `Theme<ThemeDefaultParams>` | N/A | Community | Default modern theme with rounded corners and the Inter font. `@default` for `theme` option. |
| `themeAlpine` | `Theme<ThemeDefaultParams>` | N/A | Community | Clean theme with blue accents and a subtle focus shadow. |
| `themeBalham` | `Theme<ThemeDefaultParams>` | N/A | Community | Compact spreadsheet-like theme with striped rows and bold headers. |
| `themeMaterial` | `Theme<ThemeDefaultParams & StyleMaterialParams>` | N/A | Community | Material Design–inspired theme; requires `styleMaterial` part and adds `primaryColor` param. |

### Theme API methods

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `withParams` | `(defaults: Partial<TParams>, mode?: string) => Theme<TParams>` | Community | Returns a new theme with overridden default values for the listed params. Pass a `mode` string (`'light'`, `'dark'`, or custom) to apply the params only in that color-scheme context. |
| `withPart` | `<TPartParams>(part: Part<TPartParams> \| (() => Part<TPartParams>)) => Theme<TParams & TPartParams>` | Community | Returns a new theme that uses the given part, replacing any existing part for the same design feature. |
| `withoutPart` | `(feature: string) => Theme<TParams>` | Community | Returns a new theme with the named part removed. |
| `createTheme` | `() => Theme<CoreParams & ButtonStyleParams & ...>` | Community | Factory for a blank theme containing only core grid styles and no design parts. Start from here for fully custom themes. |

### Key theme parameters (excerpt from `SharedThemeParams` and `CoreParams`)

| Parameter | Type | Tier | Description |
|-----------|------|------|-------------|
| `accentColor` | `ColorValue` | Community | Brand color for selections, focus rings, and checkboxes. |
| `backgroundColor` | `ColorValue` | Community | Grid background; semi-transparent UI elements blend with this. |
| `foregroundColor` | `ColorValue` | Community | Base neutral color; most text, borders, and backgrounds derive from this. |
| `borderColor` | `ColorValue` | Community | Default border color. |
| `borderRadius` | `LengthValue` | Community | Corner radius for menus, dialogs, and widgets. |
| `chromeBackgroundColor` | `ColorValue` | Community | Headers, tool panels, and menus background. |
| `spacing` | `LengthValue` | Community | Base spacing unit; all padding and margins are multiples of this. |
| `fontSize` | `LengthValue` | Community | Default font size throughout the grid. |
| `fontFamily` | `FontFamilyValue` | Community | Default font family. Accepts Google Font descriptor `{ googleFont: 'Inter' }`. |
| `headerHeight` | `LengthValue` | Community | Height of the column header row (theme default; overridden by `gridOptions.headerHeight`). |
| `rowHeight` | `LengthValue` | Community | Height of data rows (theme default; overridden by `gridOptions.rowHeight` or `getRowHeight`). |
| `oddRowBackgroundColor` | `ColorValue` | Community | Alternating row stripe color. |
| `rowHoverColor` | `ColorValue` | Community | Row background on mouse hover. |
| `headerBackgroundColor` | `ColorValue` | Community | Header cell background. |
| `headerFontFamily` | `FontFamilyValue` | Community | Header cell font family. |
| `headerFontSize` | `LengthValue` | Community | Header cell font size. |
| `headerFontWeight` | `FontWeightValue` | Community | Header cell font weight. |
| `headerTextColor` | `ColorValue` | Community | Header cell text color. |
| `cellHorizontalPadding` | `LengthValue` | Community | Left/right padding inside body and header cells. |
| `pinnedColumnBorder` | `BorderValue` | Community | Divider line between pinned and center column regions. |
| `pinnedRowBorder` | `BorderValue` | Community | Divider line between pinned and scrollable row regions. |
| `focusShadow` | `ShadowValue` | Community | Box-shadow on focused form inputs and buttons. |
| `rangeSelectionBorderColor` | `ColorValue` | Community | Border color around range selections. |
| `rangeSelectionBackgroundColor` | `ColorValue` | Community | Background fill for range selections (semi-transparent recommended). |
| `menuBackgroundColor` | `ColorValue` | Community | Background of context menu and column menu. |
| `menuShadow` | `ShadowValue` | Community | Shadow on menus. |
| `browserColorScheme` | `ColorSchemeValue` | Community | CSS `color-scheme` applied to the grid; controls browser scrollbar and input default appearance. |
| `wrapperBorderRadius` | `LengthValue` | Community | Corner radius of the grid wrapper element. |

### Cell styling (ColDef — cross-reference)

Cell-level styling is applied per-cell and evaluated on each render. Precedence: `cellClass` (lowest) → `cellClassRules` → `cellStyle` (highest for inline style). Full documentation in `02-column-model.md`.

| Property | Type | Tier | Description |
|----------|------|------|-------------|
| `cellClass` | `string \| string[] \| CellClassFunc<TData, TValue>` | Community | Static or computed CSS class(es) on body cells. |
| `cellClassRules` | `CellClassRules<TData, TValue>` | Community | Map of CSS class → predicate function; class applied when predicate returns true. |
| `cellStyle` | `CellStyle \| CellStyleFunc<TData, TValue>` | Community | Inline style object applied to body cells. Highest visual specificity among cell styling options. |

### Dark mode

Dark mode is achieved by calling `withParams({ ... }, 'dark')` on a theme. The grid applies the dark params when the CSS `prefers-color-scheme: dark` media query matches, or when `browserColorScheme: 'dark'` is set unconditionally.

### `renderingMode`

| Option | Type | Default | Tier | Description |
|--------|------|---------|------|-------------|
| `renderingMode` | `'default' \| 'legacy'` | `'default'` | Community | **Deprecated v35 path.** Controls the internal rendering pipeline. Do not set unless advised by AG Grid support. |

## API methods

The Theming API has no runtime grid API methods — themes are configured at grid creation and updated via `api.updateGridOptions({ theme: newTheme })`.

| Method | Signature | Tier | Description |
|--------|-----------|------|-------------|
| `updateGridOptions` | `(options: Partial<GridOptions<TData>>) => void` | Community | Pass `{ theme: ... }` to apply a different theme at runtime. The grid replaces the `<style>` elements immediately. |
| `refreshCells` | `(params?: RefreshCellsParams) => void` | Community | Forces re-evaluation of `cellClass`, `cellClassRules`, and `cellStyle` for the given cells. |

## Events

The theming system does not emit dedicated events.

| Event | Payload | Tier | Fires when |
|-------|---------|------|-----------|
| _(none dedicated)_ | — | — | Theme changes via `updateGridOptions` trigger internal re-styling without a public event. |

## Behaviors / interactions

**Theme object immutability:** `withParams()` and `withPart()` always return new `Theme` objects; they do not mutate the original. `themeQuartz` can be imported and customised without affecting other grids on the page.

**CSS variables:** The Theming API compiles theme params to `--ag-*` CSS custom properties scoped to the grid's wrapper element. Applications can also set `--ag-*` variables in CSS, but this lower-level override is less typed and not recommended when the Theming API is in use.

**Mode-conditional params:** `withParams(params, 'light')` / `withParams(params, 'dark')` allow the same theme object to have different colours in light and dark modes. AG Grid generates the appropriate `@media (prefers-color-scheme: dark)` or attribute-based selector automatically.

**Part replacement:** Parts encapsulate a design sub-system (e.g. `colorSchemeLight`, `iconSetQuartz`, `inputStyleUnderlined`). Calling `withPart(colorSchemeDark)` swaps out the entire color scheme while preserving all other theme params.

**`cellStyle` precedence:** When `cellClass` and `cellStyle` both set the same CSS property, `cellStyle` wins because it is applied as an inline style (highest specificity). `cellClassRules`-applied classes sit between: they are applied after static `cellClass` values but before `cellStyle`.

**Row height and theme `rowHeight`:** The theme-level `rowHeight` param sets the CSS variable that the grid uses for its internal row height calculations. When `gridOptions.rowHeight` (a pixel number) is set, it overrides the theme variable for all rows. `getRowHeight` (per-row callback) overrides both for individual rows. This three-tier system means themes control the default but grid options and row callbacks have priority.

**Legacy theming (`theme: 'legacy'`):** Set the option to `'legacy'` and import the CSS file (`ag-grid.css` + `ag-theme-quartz.css`). Apply the class `ag-theme-quartz` to the grid wrapper. This mode is supported in v35 but receives no new feature development.

## Look & feel

![Quartz Light theme — default grid state](screenshots/21-theme-quartz-light.png) — Showcase grid in its clean default state using `themeQuartz` with custom teal accent (`#0d9488`), Inter font, and light Quartz color scheme showing grouped rows and the status bar.

![Quartz Dark theme](screenshots/21-theme-quartz-dark.png) — Same showcase grid switched to `themeQuartz` dark variant via the Theme dropdown; dark background with teal accent highlights on selection and header elements.

![Alpine theme](screenshots/21-theme-alpine.png) — Grid using the `themeAlpine` preset; clean white rows with a blue accent, slightly larger default row height, and the Alpine-style compact header.

![Material theme](screenshots/21-theme-material.png) — Grid using the `themeMaterial` preset; Material Design–inspired elevated header, roboto-style typography, and blue ripple accent on focused/selected cells.

## Canvas-port implications

- CSS-variable–based theming (`--ag-*`) is irrelevant to canvas rendering; the canvas port needs a parallel **design token system** that maps the same conceptual tokens (accent color, row height, cell padding, etc.) to drawing primitives (fill colors, line widths, font metrics).
- `themeQuartz.withParams(...)` is already in use in the showcase (`PositionsGrid.tsx`) to set `accentColor`, `backgroundColor`, `fontFamily`, `fontSize`, `rowHeight`-linked params, and more. The canvas port must read at minimum this param set.
- `cellClass` / `cellClassRules` / `cellStyle` apply to DOM elements; in the canvas port these become per-cell style resolver functions that produce fill, stroke, and font overrides for the 2D drawing context. The precedence order must be preserved.
- `pinnedColumnBorder` and `pinnedRowBorder` tokens map directly to lines the canvas engine draws between pane regions; they should be first-class drawing params rather than derived from CSS.
- Dark mode support in the canvas port requires conditional token sets evaluated at draw time rather than CSS media queries. `withParams({...}, 'dark')` semantics should inform the canvas token resolution strategy.
- `refreshCells()` has a canvas equivalent: invalidate the cell regions and schedule a re-draw. The trigger contract (which cells are re-evaluated) must be identical so `cellClassRules` updates work the same way.

---

## cgrid Theming Surface (Cycle 22)

cgrid's theming is **CSS-variable-driven from day one** — the `cssReader.ts`
module reads every paint-relevant value from `--vg-*` tokens off the grid
root element. Cycle 22 closes the parity gap with ag-grid's full Quartz
variable set, then adds three ergonomic layers on top:

1. **Density modes** — preset variable bundles (`compact` / `normal` / `comfortable`).
2. **Theme-parameter API** — runtime per-token overrides via `setThemeParams`.
3. **`prefers-color-scheme` auto-detect** — light/dark follows OS preference.
4. **Shadow-root option** — full CSS encapsulation for embedded grids.

### Built-in theme classes

| Class | Tier | Purpose |
|---|---|---|
| `vg-theme-quartz` | Community | Light theme. Default. |
| `vg-theme-quartz-dark` | Community | Dark theme. VS Code Dark Modern palette. |
| `vg-theme-auto` | Community | Follows OS `prefers-color-scheme` setting via `@media` query. |
| `vg-theme-print` | Community | Cycle 20 — applied automatically during `domLayout: 'print'`. |

### Full token table

Tokens declared in `src/theming/tokens.css` and read by `CssReader.read()`
into a `ResolvedTheme` object. The painter pipeline reads from
`ResolvedTheme`, never from `getComputedStyle` per cell.

#### Core (rows + paint surfaces)

| Token | Light default | Dark default | Purpose |
|---|---|---|---|
| `--vg-font-family` | JetBrains Mono stack | (same) | Default font family for cells + headers. |
| `--vg-font-size` | `13px` | `13px` | Default cell font size. |
| `--vg-font-size-sm` | `12px` | `12px` | Floating filter row + status bar. |
| `--vg-row-height` | `32px` | `32px` | Data-row height. Overridable per density. |
| `--vg-header-height` | `40px` | `40px` | Header-row height. Overridable per density. |
| `--vg-fg-color` | `#1a1f24` | `#d4d4d4` | Body text. |
| `--vg-bg-color` | `#ffffff` | `#1e1e1e` | Body + canvas background. |
| `--vg-row-alt-bg` | `#ffffff` | `#1e1e1e` | Alternating row stripe. |
| `--vg-row-hover-bg` | `#eef1f3` | `#2a2d2e` | Row hover tint. |
| `--vg-row-selected-bg` | `rgb(56 132 195 / 22%)` | `rgb(38 79 120 / 50%)` | Selected-row tint. |
| `--vg-header-bg` | `#f4f6f8` | `#252526` | Header cell background. |
| `--vg-header-fg` | `#1a1f24` | `#d4d4d4` | Header cell text. |
| `--vg-border-color` | `#d5dbe0` | `#454545` | Structural borders (pinned edge, body↔header). |
| `--vg-grid-line-color` | `#e3e8eb` | `#373a3b` | Default horizontal + vertical cell rules. |
| `--vg-cell-horizontal-border-color` | `transparent` | `transparent` | **Cycle 22 / Task 1.** Optional override for vertical inter-column rules. |
| `--vg-focus-ring-color` | `#3b82f6` | `#007fd4` | Focus ring on focused cell. |
| `--vg-focus-ring-width` | `2px` | `2px` | Focus ring stroke width. |
| `--vg-resizer-hot-zone` | `4px` | `4px` | Column-resize handle hot zone. |
| `--vg-scrollbar-thickness` | `6px` | `6px` | Native scrollbar track + thumb width. |

#### Inputs (Cycle 22 / Task 1)

| Token | Light default | Dark default | Purpose |
|---|---|---|---|
| `--vg-input-bg` | `#ffffff` | `#2a2d2e` | Floating filter, cell editor, tool panel inputs. |
| `--vg-input-fg` | `#1a1f24` | `inherit` | Input text. |
| `--vg-input-border` | `#d1d5db` | `inherit` from `--vg-border-color` | Input border. |
| `--vg-input-focus-border` | `inherit` from `--vg-focus-ring-color` | (same) | Focused input border. |
| `--vg-input-disabled-bg` | `#f3f4f6` | `#232323` | Disabled input bg. |

#### Tooltip (Cycle 22 / Task 1)

| Token | Light default | Dark default | Purpose |
|---|---|---|---|
| `--vg-tooltip-bg` | `rgba(15, 23, 42, 0.95)` | `rgba(40, 44, 52, 0.96)` | Tooltip surface (sparkline tooltip + future popovers). |
| `--vg-tooltip-fg` | `#ffffff` | `#f8fafc` | Tooltip text. |
| `--vg-tooltip-border` | `rgba(255,255,255,0.08)` | (same) | Tooltip outline. |

#### Checkbox accent (Cycle 22 / Task 1)

| Token | Light default | Dark default | Purpose |
|---|---|---|---|
| `--vg-checkbox-checked-bg` | `transparent` | `transparent` | Filled-checkbox accent. `transparent` ships the outlined-only look. |
| `--vg-checkbox-checked-fg` | `inherit` from `--vg-fg-color` | (same) | Checkmark color when accent fill is set. |

#### Popups / menus (Cycle 22 / Task 1)

| Token | Light default | Dark default | Purpose |
|---|---|---|---|
| `--vg-popup-bg` | `#ffffff` | `#252526` | Filter popup, context menu, tool-panel popup. |
| `--vg-popup-border` | `#d1d5db` | `inherit` from `--vg-border-color` | Popup outline. |
| `--vg-menu-hover-bg` | `inherit` from `--vg-row-hover-bg` | (same) | Menu item hover tint. |

#### Flash + filter + sort (existing tokens, documented for completeness)

| Token | Light default | Dark default | Purpose |
|---|---|---|---|
| `--vg-flash-from-color` | `#fef3c7` | `#b8860b` | Cell-change-flash start color. |
| `--vg-flash-to-color` | `rgba(254,243,199,0)` | `rgba(184,134,11,0)` | Cell-change-flash fade target. |
| `--vg-floating-filter-bg` | `#ffffff` | `color-mix(in srgb, var(--vg-header-bg) 60%, transparent)` | Floating filter row input bg. |
| `--vg-floating-filter-border` | `#d5dbe0` | `color-mix(in srgb, var(--vg-border-color) 80%, transparent)` | Floating filter input border. |
| `--vg-floating-filter-placeholder` | `#94a3b8` | `#6e7681` | Placeholder text color. |
| `--vg-quick-filter-match-bg` | `#fff3b8` | `#4d3700` | Quick-filter highlight tint. |
| `--vg-unsort-icon-color` | `rgba(26,31,36,0.48)` | `rgba(212,212,212,0.4)` | Faint chevron-pair on sortable-but-unsorted columns. |
| `--vg-range-fill-color` | `rgb(59 130 246 / 22%)` | `rgb(0 127 212 / 20%)` | Range-selection fill tint. |
| `--vg-range-border-color` | `#3b82f6` | `#007fd4` | Range-selection outline. |

#### Totals + pinned + group (existing — Cycle 14/15)

See the inline comments in `src/theming/tokens.css` for full rationale. Tokens: `--vg-totals-*`, `--vg-pinned-row-*`, `--vg-group-*`, `--vg-group-checkbox-*`, `--vg-group-footer-*`.

#### Density (Cycle 22 / Task 2)

| Token | `compact` | `normal` | `comfortable` |
|---|---|---|---|
| `--vg-row-height` | `24px` | `32px` | `40px` |
| `--vg-header-height` | `28px` | `40px` | `48px` |
| `--vg-cell-padding-x` | `4px` | `8px` | `12px` |
| `--vg-font-size` | `12px` | `13px` | `14px` |

---

### Density modes (Cycle 22 / Task 2)

Three CSS classes layered over any theme class on the grid root
(`.vg-grid`) bundle row + header dimensions for one coherent step:

```typescript
new VelocityGrid(host, { density: 'compact', ... });

// Runtime swap — one DOM class flip, no worker round-trip.
grid.setGridOption('density', 'comfortable');
```

The option is omittable; without it the active theme's native row/header
dimensions apply (32 / 40px on Quartz).

---

### Theme-parameter API (Cycle 22 / Task 3)

Apps tune individual `--vg-*` variables without writing CSS. Each patch
lands as inline styles on the grid root, so `getComputedStyle`
resolves the override ahead of the theme-class declaration:

```typescript
grid.setThemeParams({
  '--vg-row-height': '36px',
  '--vg-header-bg': '#0f172a',
  '--vg-header-fg': '#ffffff',
});

// Round-trip
grid.getThemeParams();
// → { '--vg-row-height': '36px', '--vg-header-bg': '#0f172a', '--vg-header-fg': '#ffffff' }

// Clear a single token (falls back to the theme's declared value)
grid.setThemeParams({ '--vg-row-height': '' });
```

Side effects per call: one inline-style mutation per patched key, one
`cssReader.read()`, one viewport recompute, one repaint. No worker
round-trip.

`getThemeParams()` returns ONLY the overrides set through
`setThemeParams` — NOT the resolved tokens. Use
`getComputedStyle(grid.host)` for resolved values.

---

### `prefers-color-scheme` auto-detect (Cycle 22 / Task 4)

`vg-theme-auto` reads the OS color-scheme preference automatically via a
CSS `@media (prefers-color-scheme: dark)` block. No JS listener — the
CSS engine reacts to system preference changes and the next paint frame
picks up the new computed values:

```typescript
new VelocityGrid(host, { theme: 'vg-theme-auto', ... });
```

The class also declares `color-scheme: light dark` so native form
controls inside the grid (date pickers, native scrollbars) adapt
without a separate listener.

Apps that need explicit control stay on `vg-theme-quartz` /
`vg-theme-quartz-dark`. Mixing is fine — different grids on the same
page can pick different theme classes.

---

### Shadow-root encapsulation (Cycle 22 / Task 5)

`shadowRoot: true` mounts the grid inside an open shadow root attached
to the supplied container. The package's tokens.css is inlined as a
`<style class="vg-shadow-tokens">` element inside the shadow tree so
the grid keeps its theme even when the host page ships an aggressive
global reset (Bootstrap, Tailwind preflight, etc.):

```typescript
new VelocityGrid(host, {
  shadowRoot: true,
  theme: 'vg-theme-quartz',
  ...
});
```

**Initial-only** option. The rebuild cost (re-parenting every overlay +
re-attaching worker listeners) outweighs any plausible runtime flip
use case.

`setThemeParams` continues to write onto the grid root inside the
shadow tree, so per-token theming keeps working under encapsulation.

#### Known limitation

A small set of overlays still mount on `document.body` (browser-level
popups). Apps using shadow-root mode AND those overlays should mirror
their token block on `body`:

```css
body {
  --vg-popup-bg: #ffffff;
  --vg-popup-border: #d1d5db;
  /* …or simply: */
  /* @import 'cgrid/style.css'; */
}
```

Full overlay re-parenting lands in a follow-on cycle.

---

### Migration notes (ag-grid → cgrid)

| ag-grid surface | cgrid equivalent |
|---|---|
| `themeQuartz` (object) | `theme: 'vg-theme-quartz'` (string class) |
| `themeQuartz.withParams({ accentColor: '#0d9488' })` | `setThemeParams({ '--vg-focus-ring-color': '#0d9488' })` |
| `themeAlpine` / `themeBalham` / `themeMaterial` | Not yet shipped — clone `tokens.css` + add new class. |
| `withPart(colorSchemeDark)` | `setTheme('vg-theme-quartz-dark')` |
| `browserColorScheme: 'dark'` | Use `vg-theme-quartz-dark` directly, OR `vg-theme-auto` with OS-level dark mode. |
| `themeStyleContainer: shadowRoot` | `shadowRoot: true` option. |
| `loadThemeGoogleFonts: true` | Not shipped — apps `<link>` their own webfont. |

---

### Performance notes

- Theme change = 1 DOM class flip + 1 `cssReader.read()` + 1 `requestRepaint()`. No worker round-trip.
- Density change = same shape — recomputes `RowHeightIndex` in ≤ 16 ms.
- `setThemeParams` with 10 overrides = single paint frame.
- Shadow-root mode adds < 1 ms to grid construction (one `attachShadow` + one `<style>` injection).
