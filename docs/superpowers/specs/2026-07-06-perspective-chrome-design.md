# Perspective look & feel — Chrome (pill config aesthetic) — design spec

**Date:** 2026-07-06
**Status:** Approved design; ready for implementation
**Branch:** `feature/look-and-feel`
**Surface #4 of the holistic Perspective refresh** (Foundation #1 `15b2f63`, data-viz #3 `cacd74f`/`4906269`, grid-surface #2 `7c7a1d3` shipped on branch).

## 1. Summary & context

Bring cgrid's **chrome** — the config/tool surfaces around the data grid — to the
Perspective aesthetic, and align the demo's app toolbar so the whole demo reads
as one piece.

Exploration (both themes, live) shows the intrinsic chrome already **inherits**
the Perspective palette (near-black `#16181d` / paper `#ffffff`, all-mono, muted
labels, hairline borders) because the chrome components (`sideBar`,
`pivotPanel`, `rowGroupPanel` `host.ts` files, tool panels, status bar) inject
CSS that consumes `var(--cg-*)` tokens. The remaining gaps are:

- **Shape precision on config surfaces** — the `--cg-row-group-chip-*`,
  checkbox, and input tokens fall through to the shared/quartz defaults rather
  than Perspective-specific values, so pills/checkboxes/toggles read slightly
  quartz-flavored.
- **The demo toolbar** — `apps/cgrid-customizer-demo/src/style.css` styles its
  header with a private `--demo-*` **slate** palette (dark `#0b1220`/`#1e293b`/
  `#334155`; light `#f1f5f9`/`#ffffff`/`#cbd5e1`) and the default **sans** font,
  visually disconnected from the mono near-black/paper grid.

**Scope (approved):** intrinsic chrome **and** the demo toolbar. No new chrome
components; no DOM/logic restructuring; perspective-theme-only token overrides
(+ additive token hooks where a component hardcodes a value); demo toolbar is
app CSS.

## 2. Part A — intrinsic chrome (kernel)

Add Perspective-specific overrides in the `.cg-theme-perspective` and
`.cg-theme-perspective-dark` blocks of
`packages/kernel/src/theming/tokens.css`. Where a chrome component's `host.ts`
CSS string **hardcodes** a value (theme-blind), add a `--cg-*` token, give it a
sensible fallback in the component's CSS (`var(--cg-x, <current-literal>)`), and
set it per-perspective — so the fix is intrinsic support in the kernel, not a
demo workaround (per no-retroactive-layering). Audit each surface below for that
case before assuming a pure token override suffices.

### 2.1 Config pills (`--cg-row-group-chip-*`)

The row-group-panel chips (`⠿ Desk ×  ›  ⠿ Region ×`) and the Columns-panel Row
Groups / Values chips share the `--cg-row-group-chip-*` family. Perspective
override: flatter radius (`--cg-row-group-chip-radius`), hairline border
(`--cg-row-group-chip-border` = `--cg-border-color`), muted-mono label
(`--cg-row-group-chip-fg` = `--cg-header-fg`), whisper hover
(`--cg-row-group-chip-hover-bg` = `--cg-row-hover-bg`), subtle resting fill
(`--cg-row-group-chip-bg`). Keep the `⠿` drag handle muted; keep chip height /
padding on the existing density. Exact values tuned live in Part C.

### 2.2 Checkboxes (columns tool panel) — hairline box + blue check

**Decision:** unchecked = hairline box (no solid fill); the blue accent is
reserved for the **check mark** only. Preserves checked/unchecked affordance in
a long column list while dropping the quartz solid-blue fill.

Drive this through the checkbox tokens the panel already consumes
(`--cg-checkbox-checked-bg`, `--cg-checkbox-checked-fg`, and the box
border/background tokens). Perspective already sets
`--cg-checkbox-checked-bg: transparent` and `--cg-checkbox-checked-fg:
var(--cg-fg-color)` at the root of its block — verify the **columns-panel**
checkbox actually reads those tokens; if the panel checkbox is a distinct
element with its own (hardcoded or quartz-inherited) styling, add/point it at a
token so the hairline-box-with-blue-check renders. The check mark color should
be the theme blue accent (`--cg-pos-color` / a blue), not the grey chrome
accent — confirm which token the check consumes and set it to blue.

### 2.3 Pivot toggle / search input / floating filters

Confirm the Pivot Mode toggle, the Columns-panel search input, and the
floating-filter inputs ride the perspective input tokens (`--cg-input-*`).
Nudge radius/border to the Perspective flat-hairline treatment if they read
rounded/quartz. Token override only unless a hardcode is found.

### 2.4 Popups / context menus / filter menus

Audit that column context menus, the filter menu, and any popup consume
`--cg-popup-*` / `--cg-menu-*` (perspective sets `--cg-popup-bg`,
`--cg-popup-border`, `--cg-menu-hover-bg`). Tune to near-black + hairline
border. Add a token hook only if a menu surface hardcodes a color.

## 3. Part B — demo toolbar (app CSS)

In `apps/cgrid-customizer-demo/src/style.css`, re-map the `--demo-*` palette in
**both** `[data-theme]` blocks to the Perspective neutrals, adopt the **mono**
font stack for the toolbar, and flatten the pill radii to the theme so the
header reads as one piece with the grid:

- **Dark** (`[data-theme="dark"]`): `--demo-bg #16181d`, `--demo-panel #191c22`,
  `--demo-border #2a2f37`, `--demo-fg #c3c9d1`, `--demo-faint #7a828e`.
- **Light** (`[data-theme="light"]`): `--demo-bg #ffffff`, `--demo-panel
  #f6f8fa`, `--demo-border #dfe3e8`, `--demo-fg #1a1f28`, `--demo-faint
  #6b7683`.
- **Font:** set the header/toolbar font-family to the mono stack (`'JetBrains
  Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace`) matching the
  Perspective theme.
- **Radii:** align cluster/button radii to the Perspective flat treatment;
  keep the switches and `status-pill` legible (the fully-round `999px` status
  pill may stay or flatten — tuned live in Part C).
- `--demo-switch input accent-color` → the theme blue so the live/editable
  switches match the grid accent.

Keep the toolbar's structure, cluster grouping, copy, and `data-testid`s
unchanged (E2E depends on them).

## 4. Part C — verify (browser, both themes)

Run the demo (port 5187, live STOMP), reset saved state. In **dark and light**,
capture and tune live: config pills (create Desk/Region row groups), Columns
tool panel (checkboxes + search), Pivot toggle, a filter/context menu popup, the
status bar, and the demo toolbar. Confirm the toolbar reads as one piece with
the grid. Reset demo state + kill browser/server after.

## 5. Testing

- **Unit (kernel):** for any **new** `--cg-*` token added in Part A, extend the
  `cssReader` test to assert it resolves (fallback when absent). Pure token
  overrides of existing tokens need no new unit test.
- **Regression:** full kernel suite + demo E2E suite stay green (no DOM/testid
  changes; `aggIncremental.perf.test.ts` is a known CPU flake — re-run alone).
- **Browser-verify (controller):** Part C, both themes, tuned live.

## 6. Out of scope

- Any new chrome feature or DOM/logic restructuring of a chrome component.
- Changes to the quartz (default) or vendored starui themes — Part A is
  **perspective-only** token overrides plus **additive** token hooks (each with
  a fallback preserving current quartz/starui behavior).
- The grid data surface (surfaces #1–#3, already shipped on branch).
- Empty-glyph / data-cell rendering (surface #2).
