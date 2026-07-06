# Perspective Inline Data-Viz — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (small, visual, controller-tuned) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Perspective's inline data-viz — theme-driven blue/salmon sign colors + data bars + heatmap — via a theme-token sign palette (kernel+renderers) and curated demo wiring of existing `@cgrid/renderers`.

**Architecture:** cssReader resolves `--cg-pos-color`/`--cg-neg-color` → threaded onto `CellPaintConfig` like `flashFromColor` → `@cgrid/renderers` sign-aware painters read `p.posColor`/`p.negColor` (fallback `SEMANTIC_COLORS`). The demo selects `cellRenderer: 'pnl' | 'bidirectional-bar' | 'heat'` per column.

**Tech Stack:** TypeScript strict; Vitest (kernel + renderers); Playwright (demo). No new renderers.

**Spec:** `docs/superpowers/specs/2026-07-06-perspective-dataviz-design.md`.

## Global Constraints

- Theme is the source of truth for the sign palette: renderer resolution order = explicit `overrides` → `p.posColor`/`p.negColor` (theme) → `SEMANTIC_COLORS` (final fallback for un-themed grids).
- Empty-string safety: cssReader returns `''` for an absent token; `applyCellProps` maps `'' → undefined` on the paint config so the renderer's `?? SEMANTIC_COLORS` fallback fires (an empty string is NOT nullish).
- Existing renderers only (`pnl`, `bidirectional-bar`, `heat` are in `RENDERER_NAMES`). No new renderers; no edits to vendored `starui`/default `quartz`. Live-tuning touches only the `cg-theme-perspective` tokens.
- Gate before commit: `cd packages/kernel && npx tsc --noEmit && npm run build && npx vitest run` green; `cd packages/renderers && npx vitest run` green; demo typecheck + E2E green. Kill demo server + browser when done. Branch `feature/look-and-feel`.

**Threading pattern (verified — mirror `flashFromColor`):** `cssReader.ts` `ResolvedTheme.flashFromColor: string` ← `get('--cg-flash-from-color') || '#fef3c7'`; `propertyChain.ts:554` `target.flashFromColor = theme.flashFromColor`; `registry.ts` `CellPaintConfig.flashFromColor?: string`; renderer reads `p.flashFromColor`. `@cgrid/renderers` `numeric.ts:111` `colorsFromParams(overrides)` does `overrides?.positive ?? SEMANTIC_COLORS.positive`.

---

### Task 1: Theme-token sign palette (kernel threading + renderers read it)

**Files:**
- Modify: `packages/kernel/src/theming/cssReader.ts` (ResolvedTheme + resolution)
- Modify: `packages/kernel/src/core/propertyChain.ts` (~line 554 — thread to target)
- Modify: `packages/kernel/src/renderer/cellRenderers/registry.ts` (CellPaintConfig fields)
- Modify: `packages/renderers/src/numeric.ts` + `packages/renderers/src/bars.ts` (read `p.posColor`/`p.negColor`)
- Test: `packages/kernel/tests/cssReaderSignColors.test.ts` (new), `packages/renderers/tests/signColorTheme.test.ts` (new)

**Interfaces:**
- Produces: `ResolvedTheme.posColor: string` / `.negColor: string`; `CellPaintConfig.posColor?: string` / `.negColor?: string`.

- [ ] **Step 1: Failing kernel cssReader test**

Create `packages/kernel/tests/cssReaderSignColors.test.ts`. `cssReader` reads `getComputedStyle`; drive it with a fake style map (mirror an existing `cssReader` test — grep `tests/cssReader`). Assert `readTheme(...)`-equivalent returns `posColor`/`negColor` from `--cg-pos-color`/`--cg-neg-color`, `''` when absent. (If cssReader's entry point needs a real element, mount a div with inline `--cg-pos-color` and call the reader.)
```ts
// pseudo — match the actual cssReader API found by grepping tests/cssReader*:
// expect(theme.posColor).toBe('#6aa9e0'); expect(theme.negColor).toBe('#e0876a');
// absent → expect(theme.posColor).toBe('');
```

- [ ] **Step 2: Run, verify fail** — `cd packages/kernel && npx vitest run tests/cssReaderSignColors.test.ts` — FAIL (posColor undefined).

- [ ] **Step 3: Add the tokens to cssReader + thread them**

`cssReader.ts` — in `ResolvedTheme` (near `flashFromColor: string;`) add `posColor: string;` `negColor: string;`. In the object it builds (near `flashFromColor: get('--cg-flash-from-color') || '#fef3c7',`) add:
```ts
      posColor: get('--cg-pos-color') || '',
      negColor: get('--cg-neg-color') || '',
```
`propertyChain.ts` (after line 554 `target.flashFromColor = theme.flashFromColor;`):
```ts
  target.posColor = theme.posColor || undefined; // '' → undefined so renderers fall back
  target.negColor = theme.negColor || undefined;
```
`registry.ts` (near `flashFromColor?: string;`):
```ts
  posColor?: string;
  negColor?: string;
```

- [ ] **Step 4: Failing renderers test**

Create `packages/renderers/tests/signColorTheme.test.ts`. A sign-aware painter (`pnl`, from the renderers registry) uses `p.posColor` for a positive value + `p.negColor` for a negative, and falls back to `SEMANTIC_COLORS` when absent. Paint onto a fake `Gc` capturing `fillStyle`:
```ts
import { describe, it, expect } from 'vitest';
import { SEMANTIC_COLORS } from '../src/palette';
// import the pnl painter (grep the renderers index/numeric for the export name)
// build a minimal fake Gc { cache: { fillStyle }, ... } + a p with value>0 and posColor set;
// assert the fillStyle used for the number == p.posColor (blue), and == SEMANTIC_COLORS.positive when p.posColor undefined.
```
(Read `numeric.ts` to find the exact painter export + how it sets the text color, and shape the fake `Gc`/`p` accordingly — mirror an existing `packages/renderers/tests` painter test.)

- [ ] **Step 5: Run, verify fail** — `cd packages/renderers && npx vitest run tests/signColorTheme.test.ts` — FAIL (uses SEMANTIC_COLORS regardless of p.posColor).

- [ ] **Step 6: Renderers read the threaded colors**

`numeric.ts` — thread `p` into `colorsFromParams` (change its call site in the paint fn to pass `p`, and its body):
```ts
function colorsFromParams(overrides: SemanticColorMap | undefined, p?: { posColor?: string; negColor?: string }): Required<SemanticColorMap> {
  colorScratch.positive = overrides?.positive ?? p?.posColor ?? SEMANTIC_COLORS.positive;
  colorScratch.negative = overrides?.negative ?? p?.negColor ?? SEMANTIC_COLORS.negative;
  colorScratch.warning = overrides?.warning ?? SEMANTIC_COLORS.warning;
  colorScratch.info = overrides?.info ?? SEMANTIC_COLORS.info;
  colorScratch.muted = overrides?.muted ?? SEMANTIC_COLORS.muted;
  return colorScratch;
}
```
Update every `colorsFromParams(overrides)` call in `numeric.ts` to `colorsFromParams(overrides, p)` (the paint fn has `p`). Do the same in `bars.ts` (its `colorScratch.positive = overrides?.positive ?? SEMANTIC_COLORS.positive` at ~line 73 → `?? p?.posColor ?? …`; thread `p` into that helper). `heat`'s cool/warm endpoints: if `heat` derives from SEMANTIC or a param, prefer `p.posColor`/`p.negColor` when set (read `heat`'s painter; apply the same `?? p?.posColor ??` order).

- [ ] **Step 7: Run both tests + gates** — `cd packages/kernel && npx vitest run tests/cssReaderSignColors.test.ts && npx tsc --noEmit && npm run build && npx vitest run` (green) then `cd packages/renderers && npx vitest run` (green).

- [ ] **Step 8: Commit**
```bash
git add packages/kernel/src/theming/cssReader.ts packages/kernel/src/core/propertyChain.ts packages/kernel/src/renderer/cellRenderers/registry.ts packages/renderers/src/numeric.ts packages/renderers/src/bars.ts packages/kernel/tests/cssReaderSignColors.test.ts packages/renderers/tests/signColorTheme.test.ts
git commit -m "feat(theme,renderers): theme-token sign palette — renderers resolve pos/neg from --cg-pos/neg (T1)"
```

---

### Task 2: Curated demo wiring + browser-verify/tune

**Files:**
- Modify: `apps/cgrid-customizer-demo/package.json` (add `@cgrid/renderers`)
- Modify: `apps/cgrid-customizer-demo/src/main.ts` (wire renderers + set the 4 columns)
- Create: `apps/cgrid-customizer-demo/e2e/perspectiveDataviz.spec.ts`

**Interfaces:** Consumes Task 1's threaded `p.posColor`/`p.negColor` (the renderers now paint theme blue/salmon automatically).

- [ ] **Step 1: Add dep + wire renderers**

`package.json`: add `"@cgrid/renderers": "*"` (mirror the other `@cgrid/*` deps). Run `npm install` at the repo root. `main.ts`: `import { wireIntoKernel as wireRenderers } from '@cgrid/renderers';` and call `wireRenderers(grid);` after `wireRules(grid)` (registers all renderer names). (Confirm the bridge export name — grep `packages/renderers/src/index.ts` for `wireRenderersIntoKernel` vs `wireIntoKernel`; use the actual export.)

- [ ] **Step 2: Curated column treatments**

In `main.ts` `columnDefs`, set `cellRenderer` (and drop the `[Red]` formatter) on:
- `num('P&L', 'pnl', { aggFunc: 'sum', cellRenderer: 'pnl' })` (remove `valueFormatter: '#,##0;[Red](#,##0)'`).
- `num('Unrealized', 'unrealizedPnl', { aggFunc: 'sum', cellRenderer: 'pnl' })`.
- `num('Daily P&L', 'dailyPnl', { aggFunc: 'sum', cellRenderer: 'bidirectional-bar', cellRendererParams: { /* symmetric domain — read bidirectionalBarCell's params contract */ } })`.
- `num('Notional', 'notionalAmount', { aggFunc: 'sum', cellRenderer: 'heat', cellRendererParams: { /* min/max or columnStats domain — read heat's contract */ } })`.
Read `bars.ts` `bidirectionalBarCell` + the `heat` painter for their exact `cellRendererParams` shape (domain/max, colors optional — omit colors so the theme drives them). If a renderer needs per-column min/max, use the renderers' `ColumnStats`/`columnStats` wiring (grep `columnStats` usage) or a fixed sensible domain for the demo data.

- [ ] **Step 3: Rebuild kernel dist + LIVE browser-verify + tune**

`cd packages/kernel && npm run build`; run the demo; verify **light + dark**: P&L / Unrealized show blue-positive / salmon-negative numbers; Daily P&L shows centered data bars (blue right / salmon left); Notional shows a heatmap fill. Tune the exact `--cg-pos-color`/`--cg-neg-color` (and any heat endpoint) in `tokens.css` against the Perspective reference until it matches. Reset saved state first; kill browser + server after.

- [ ] **Step 4: E2E** — Create `apps/cgrid-customizer-demo/e2e/perspectiveDataviz.spec.ts` (mirror `columnGroups.spec.ts` harness): assert via `__cgapi.getColumnDefs?.()` / a demo hook that `pnl`/`bidirectional-bar`/`heat` are the `cellRenderer` for the four columns and no `[Red]` formatter remains. (If colDefs aren't exposed, add a tiny `__cgcols` hook in `main.ts` returning the resolved `cellRenderer` per colId.) Run `npx playwright test e2e/perspectiveDataviz.spec.ts` + full demo suite green. Kill server.

- [ ] **Step 5: Commit**
```bash
git add apps/cgrid-customizer-demo/package.json apps/cgrid-customizer-demo/src/main.ts apps/cgrid-customizer-demo/e2e/perspectiveDataviz.spec.ts package-lock.json
git commit -m "feat(demo): Perspective data-viz — pnl/bidirectional-bar/heat on P&L family + Notional (T2)"
```

---

## Self-review notes
- **Spec coverage:** §2.1 cssReader → T1 Step 3; §2.2 thread → T1 Step 3 (propertyChain + registry); §2.3 renderers read → T1 Step 6; §3 demo wiring (4 columns) → T2 Steps 1-2; §5 testing (cssReader + renderer + E2E + browser-verify) → T1 Steps 1/4 + T2 Steps 3-4; §6 out-of-scope (no new renderers, no starui/quartz edits) → Global Constraints.
- **Exec-time confirmations (test-gated):** the exact `cssReader` reader API + fake-style harness (T1 Step 1 — grep `tests/cssReader*`); the `pnl` painter export + fake `Gc` shape (T1 Step 4); `bidirectional-bar`/`heat` `cellRendererParams` contract + `columnStats` need (T2 Step 2 — read `bars.ts`/`heat`); the renderers bridge export name (T2 Step 1). Each is a read-and-match, gated by its test/verify.
- **Consistency:** `posColor`/`negColor` names identical across ResolvedTheme, CellPaintConfig, and the renderer reads; resolution order (overrides → p → SEMANTIC) consistent T1 Step 6 + Global Constraints.
```
