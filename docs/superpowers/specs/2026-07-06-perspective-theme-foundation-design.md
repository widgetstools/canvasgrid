# Perspective-inspired look & feel — Foundation (theme) — design spec

**Date:** 2026-07-06
**Status:** Approved design; ready for implementation planning
**Inspiration:** FINOS Perspective datagrid (user-supplied screenshots)
**Branch:** `feature/look-and-feel`

## 1. Summary & context

The user wants a **holistic premium refresh** of cgrid's look & feel, inspired by
FINOS Perspective's datagrid: near-black high-contrast canvas, all-monospace
technical typography, sign-driven duotone numbers (cool blue / warm salmon),
inline data-viz (heatmap fills + data bars), hairline separators, muted em-dash
nulls, and a refined rounded-pill config chrome.

The refresh is **decomposed into 4 sequenced surfaces**, each its own
spec → plan → build:
1. **Foundation (THIS spec)** — a new `cg-theme-perspective` (+ dark) theme: the
   static visual system (palette, typography, density, grid lines, header, states,
   nulls). Flips the whole canvas + chrome to the Perspective feel instantly.
2. Grid data-surface refinements (header rhythm, hover/selection/focus, flash).
3. Inline data-viz — sign-driven numeric coloring + data-bar + heatmap cell
   treatments (data-driven, applied per column).
4. Chrome — side bar / tool panels / filter popups / status bar / scrollbars →
   the rounded-pill config aesthetic.

This spec covers **Foundation only**. The signature blue/salmon sign-coloring,
data bars, and heatmap fills are **data-driven** (per-column formatters/renderers),
so they belong to surface #3 — Foundation only *reserves the palette tokens* they
will consume.

## 2. The Perspective aesthetic (reference traits)

- Near-black canvas (`~#16-1a`), soft cool-grey text (not pure white), high contrast.
- **All-monospace** — headers/labels/chrome as well as data (today only data is mono).
- Compact/dense rows; airy multi-row group headers separated by hairlines.
- **Hairline separators** — subtle horizontal row rules; vertical column lines minimal/absent.
- Muted **em-dash** for null/empty cells.
- Restrained states — whisper-soft hover, cool-blue selection tint, blue cell-tick flash.
- (Surface #3) sign duotone numbers, heatmap cell fills, in-cell data bars.

## 3. Architecture

A cgrid theme is a **CSS class** `.cg-theme-<name>` in
`packages/kernel/src/theming/tokens.css` declaring the `--cg-*` custom-property
set. There is **no theme registry**: `resolveThemeKind` (`themeKind.ts:46`)
infers dark from a class name ending in `-dark` (else OS pref for `-auto`, else
bg luminance), and `cssReader.ts` reads whatever `--cg-*` resolve to for the
active class at runtime — both are theme-agnostic. So adding `cg-theme-perspective`
+ `cg-theme-perspective-dark` requires **only new CSS blocks** — no kernel/TS
logic change. Consumers select it via `theme: 'cg-theme-perspective-dark'`
(construction) / `setGridOption('theme', …)` (runtime).

## 4. Token design

Two blocks in `tokens.css`, mirroring the existing block structure (define the
full `--cg-*` set each theme carries — same token NAMES as `cg-theme-quartz`).
`cg-theme-perspective-dark` is the primary (matches the inspiration);
`cg-theme-perspective` is the light inversion (paper canvas, ink text, same
blue/salmon accents). **Anchor values below; exact hex tuned LIVE in the demo
during implementation — a theme is only real on the canvas.**

### 4.1 `cg-theme-perspective-dark` (primary)

- `color-scheme: dark;`
- **Typography — all mono:**
  - `--cg-font-family` (headers/chrome): the mono stack (`'JetBrains Mono','Fira Code','SF Mono',Menlo,Consolas,monospace`).
  - `--cg-cell-font-family`: same mono stack.
  - `--cg-font-size: 12px;` `--cg-font-size-sm: 11px;`
- **Density:** `--cg-row-height: 24px;` `--cg-header-height: 40px` (accommodates the multi-row group-header rhythm).
- **Palette:**
  - `--cg-bg-color: #16181d;` (near-black, cool)
  - `--cg-fg-color: #c3c9d1;` (soft cool grey)
  - `--cg-row-alt-bg: var(--cg-bg-color);` (no zebra — Perspective is flat)
  - `--cg-header-bg: var(--cg-bg-color);` (no fill; hairline-separated)
  - `--cg-header-fg: #8a93a0;` (muted label grey)
  - `--cg-border-color: #2a2f37;`
  - `--cg-grid-line-color: #24272e;` (barely-there hairline)
  - `--cg-row-hover-bg: rgba(255,255,255,0.03);`
  - `--cg-row-selected-bg: rgba(96,150,220,0.16);` (cool-blue tint)
  - `--cg-chrome-accent: #6f7c8c;` (cool blue-grey; focus ring derives from it)
  - `--cg-focus-ring-color: var(--cg-chrome-accent);` `--cg-focus-ring-width: 2px;`
  - `--cg-flash-from-color: rgba(96,150,220,0.30);` `--cg-flash-to-color: rgba(96,150,220,0);` (blue tick)
  - `--cg-empty-fg` (muted em-dash grey) `: #565e6a;` — if the null token differs in name, use the kernel's existing empty/muted token; add it if the theme set lacks one.
  - `--cg-floating-filter-bg: var(--cg-bg-color);` `--cg-floating-filter-border: var(--cg-border-color);`
  - `--cg-scrollbar-thickness: 8px;` `--cg-resizer-hot-zone: 4px;` `--cg-editor-invalid-color: #e0876a;`
- **Reserved for surface #3 (declared now, consumed later):**
  - `--cg-pos-color: #6aa9e0;` (blue, positive)
  - `--cg-neg-color: #e0876a;` (salmon, negative)

Any remaining `--cg-*` tokens the current theme blocks define (group-header,
totals, checkbox, group-chevron, etc.) carry Perspective-consistent values in the
same family (muted cool greys + the blue/salmon accents), enumerated in full in
the plan and dialed live.

### 4.2 `cg-theme-perspective` (light inversion)

Same token NAMES; inverted system: `color-scheme: light;` `--cg-bg-color: #ffffff`
(or a faint cool paper `#fbfcfd`), `--cg-fg-color: #1a1f28`, `--cg-header-fg:
#5b6672`, `--cg-grid-line-color: #eceef1`, `--cg-row-selected-bg:
rgba(56,132,195,0.14)`, same `--cg-pos-color`/`--cg-neg-color` (slightly deepened
for light-bg contrast), mono typography + density identical to dark.

## 5. Demo adoption

`apps/cgrid-customizer-demo/src/main.ts` — default the grid `theme` to
`cg-theme-perspective-dark` (currently `cg-theme-starui-dark`) and the light
toggle to `cg-theme-perspective`; the `custdemo:theme` persistence + the
`applyTheme()` toggle keep working (only the two class strings change). This makes
the new theme the live demo default so the whole refresh is visible + iteratable.

## 6. Testing

- **Unit (kernel):** a `cssReader` / theme-token test that a grid rooted with
  `cg-theme-perspective-dark` resolves the new tokens (bg `#16181d`, mono
  `--cg-cell-font-family`, `--cg-pos-color`/`--cg-neg-color` present) and that
  `resolveThemeKind` returns `'dark'` for `cg-theme-perspective-dark` /
  `'light'` for `cg-theme-perspective`. (No new kernel logic — this pins the CSS
  contract + the dark-suffix inference.)
- **E2E (demo):** a smoke spec that the demo mounts with `cg-theme-perspective-dark`
  and the theme toggle swaps to `cg-theme-perspective` (assert the root class +
  `getThemeKind()` via `__cgapi`).
- **Browser-verify (controller):** side-by-side before/after (starui-dark →
  perspective-dark) light + dark; tune the exact palette/type/density live to
  match the Perspective reference; reset state + kill browser/server after.

## 7. Out of scope (this Foundation spec)

- Surfaces #2–#4 (grid-surface refinements, inline data-viz, chrome pill redesign)
  — their own specs.
- The sign-driven numeric coloring, data bars, heatmap fills (surface #3; Foundation
  only reserves `--cg-pos-color`/`--cg-neg-color`).
- Any kernel/painter behavior change — Foundation is CSS tokens + demo default only.
- Editing/removing the vendored `starui` or the kernel-default `quartz` themes
  (untouched; `perspective` is additive).
