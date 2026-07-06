# Perspective look & feel — Inline data-viz (sign color + bars + heatmap) — design spec

**Date:** 2026-07-06
**Status:** Approved design; ready for implementation planning
**Branch:** `feature/look-and-feel`
**Surface #3 of the holistic Perspective refresh** (Foundation `15b2f63` shipped surface #1).

## 1. Summary

Deliver Perspective's signature **inline data-viz**: sign-driven **blue/salmon**
numbers, in-cell **data bars**, and **heatmap** cell fills — curated across the
demo's numeric columns. Two parts:

- **A — Theme-token sign palette (intrinsic):** make `@cgrid/renderers`'
  sign-aware renderers resolve their positive/negative colors from the active
  theme's `--cg-pos-color`/`--cg-neg-color` tokens (declared by the Foundation
  theme), instead of the hardcoded green/red `SEMANTIC_COLORS`. The theme
  becomes the source of truth for the sign palette — Perspective gets blue/salmon,
  every other theme keeps its own — with no per-column overrides.
- **B — Demo wiring (curated):** apply the existing named renderers (`pnl`,
  `bidirectional-bar`, `heat`) to a tasteful set of the demo's columns.

`@cgrid/renderers` already ships every renderer (`pnl`, `bidirectional-bar`,
`heat`, …) via `RENDERER_NAMES` + `wireRenderersIntoKernel`; `cssReader` already
threads theme tokens (e.g. `flashFromColor`) to the paint path. So this is a
small intrinsic threading change + demo config, no new renderers.

## 2. Part A — theme-token sign palette (kernel + renderers)

### 2.1 cssReader → ResolvedTheme

`packages/kernel/src/theming/cssReader.ts` resolves `--cg-*` into a
`ResolvedTheme`. Add two fields resolved the same way `flashFromColor` is
(`get('--cg-flash-from-color') || fallback`):
- `posColor: string` ← `get('--cg-pos-color')` (fallback: `''` / undefined-sentinel so renderers fall back to their own default).
- `negColor: string` ← `get('--cg-neg-color')`.

### 2.2 Thread to the paint path

Thread `posColor`/`negColor` from `ResolvedTheme` onto `CellPaintConfig`
(`packages/kernel/src/renderer/cellRenderers/registry.ts` — the `p` object) the
same way `flashFromColor` is threaded (populated once per frame in the painter,
read by cell renderers). New optional fields `p.posColor?`/`p.negColor?`.

### 2.3 Renderers read the threaded colors

`packages/renderers/src/numeric.ts` / `bars.ts` (and any sign-aware painter):
where they currently do `overrides?.positive ?? SEMANTIC_COLORS.positive`,
prefer the threaded theme color: `overrides?.positive ?? p.posColor ??
SEMANTIC_COLORS.positive` (and negative). Explicit per-column `overrides` still
win; the theme token is the new default; `SEMANTIC_COLORS` (green/red) is the
final fallback for un-themed grids. `heat`'s cool/warm endpoints likewise derive
from `p.posColor`/`p.negColor` when present.

`resolveSemanticColors()` stays as the token-free default; a new
`resolveSemanticColors(p?)`-style read or a direct `p.posColor` read at paint
time (no per-paint DOM/getComputedStyle — the value is already resolved by
cssReader) delivers the theme value.

## 3. Part B — demo wiring (curated)

`apps/cgrid-customizer-demo`:
- Add `@cgrid/renderers` dep; `wireRenderersIntoKernel(grid)` after the other
  `wire*` calls (registers all `RENDERER_NAMES` painters).
- Column treatments (drop the `[Red]`/`#,##0;[Red](#,##0)` formatter on these —
  the renderer owns the color):
  - **P&L** (`pnl` field) → `cellRenderer: 'pnl'` (sign-colored number).
  - **Unrealized** (`unrealizedPnl`) → `cellRenderer: 'pnl'`.
  - **Daily P&L** (`dailyPnl`) → `cellRenderer: 'bidirectional-bar'` (centered
    data bar; blue right / salmon left), with the value-range params the renderer
    needs (symmetric max from column stats or a fixed domain).
  - **Notional** (`notionalAmount`) → `cellRenderer: 'heat'` (heatmap fill scaled
    by the column's min/max via the renderer's `columnStats`/params).
- The renderers now paint blue/salmon automatically (Part A resolves them from
  the Perspective theme tokens); switching the demo to light keeps the treatments
  and swaps to the light `--cg-pos/neg`.

## 4. Data flow

theme CSS `--cg-pos/neg` → `cssReader` (`ResolvedTheme.posColor/negColor`) →
painter (`CellPaintConfig.posColor/negColor`) → `@cgrid/renderers` (`pnl` /
`bidirectional-bar` / `heat`) paint sign color / bar fill / heatmap using the
theme value. Demo just selects `cellRenderer` per column.

## 5. Testing

- **Unit (kernel):** `cssReader` resolves `--cg-pos-color`/`--cg-neg-color` into
  `ResolvedTheme` (with fallback when absent).
- **Unit (renderers):** a sign-aware painter (e.g. `pnl`) uses `p.posColor` when
  provided (blue), falls back to `SEMANTIC_COLORS` when absent — assert the
  `fillStyle` set on a fake `Gc` for a positive vs negative value.
- **E2E (demo):** the four columns carry their renderers — assert via the live
  colDefs (`__cgapi` / a demo hook) that `pnl`/`bidirectional-bar`/`heat` are set
  and the `[Red]` formatter is gone.
- **Browser-verify (controller):** P&L/Unrealized blue-positive/salmon-negative,
  Daily-P&L centered bars, Notional heatmap — light + dark, side-by-side vs the
  Perspective reference; tune the exact blue/salmon/heat endpoints live (in the
  Foundation theme tokens). Reset state + kill browser/server after.

## 6. Out of scope

- Surfaces #2 (grid-surface refinements) and #4 (chrome) — their own specs.
- Adding NEW renderers to `@cgrid/renderers` (all needed ones exist).
- Applying data-viz beyond the curated four columns (Perspective-liberal was
  declined for legibility).
- Editing the vendored `starui`/default `quartz` themes.
