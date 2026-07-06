# Perspective Theme Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this is a small, visual, controller-tuned task) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an additive `cg-theme-perspective` (+ `-dark`) theme — the static Perspective-inspired visual system (near-black palette, all-mono type, hairline lines, dense rows, cool-blue/salmon accent tokens) — and default the demo to it.

**Architecture:** A cgrid theme is a `.cg-theme-<name>` CSS block of `--cg-*` custom properties in `packages/kernel/src/theming/tokens.css`; dark is inferred from the `-dark` suffix (`themeKind.ts`), `cssReader` reads tokens generically — so this is CSS blocks + a demo default, no kernel/TS logic change.

**Tech Stack:** CSS custom properties; Vitest (kernel token/themeKind test); Playwright (demo smoke). No new deps.

**Spec:** `docs/superpowers/specs/2026-07-06-perspective-theme-foundation-design.md`.

## Global Constraints

- Additive only: do NOT edit/remove `cg-theme-quartz*` (kernel default) or the vendored `cg-theme-starui*`.
- Mirror the EXACT `--cg-*` token NAME set the existing dark block (`cg-theme-quartz-dark`) declares — 65 tokens (below) — so nothing falls back/breaks. Derived tokens keep their `var()`/`color-mix()` form where the derivation still reads right.
- All-mono typography (`--cg-font-family` = the mono stack, not Inter). Reserve `--cg-pos-color`/`--cg-neg-color` (consumed by a later surface, not here).
- Exact hex/type/density are TUNED LIVE against the Perspective reference during Step 5 — the anchor values below are the starting point.
- Gate before commit: `cd packages/kernel && npx tsc --noEmit && npm run build && npx vitest run` green; demo typecheck + E2E green. Kill the demo server + browser when done. Branch `feature/look-and-feel`.

**The 65 tokens a theme block declares** (from `cg-theme-quartz-dark`): font-family, cell-font-family, font-size, font-size-sm, row-height, header-height, fg-color, bg-color, row-alt-bg, header-bg, header-fg, border-color, grid-line-color, row-hover-bg, row-selected-bg, chrome-accent, focus-ring-color, focus-ring-width, editor-invalid-color, flash-from-color, flash-to-color, resizer-hot-zone, scrollbar-thickness, floating-filter-bg, floating-filter-border, floating-filter-placeholder, quick-filter-match-bg, unsort-icon-color, range-fill-color, range-border-color, totals-bg, totals-fg, totals-border-top, totals-fg-muted, totals-font-weight, pinned-row-bg, pinned-row-fg, pinned-row-border, group-chevron-color, group-count-color, group-indent, group-row-bg, group-checkbox-{border,check,indeterminate}-color, group-checkbox-fill, group-footer-{bg,fg,border-top,font-weight}, input-{bg,fg,border,focus-border,disabled-bg}, tooltip-{bg,fg,border}, checkbox-checked-{bg,fg}, cell-horizontal-border-color, popup-bg, popup-border, menu-hover-bg, cell-padding-x.

---

### Task 1: `cg-theme-perspective` (+ dark) theme blocks + demo default

**Files:**
- Modify: `packages/kernel/src/theming/tokens.css` (add the two blocks + the shared `.cg-canvas` bg seam selectors)
- Modify: `apps/cgrid-customizer-demo/src/main.ts` (default theme strings)
- Create: `packages/kernel/tests/perspectiveTheme.test.ts`
- Create: `apps/cgrid-customizer-demo/e2e/perspectiveTheme.spec.ts`

- [ ] **Step 1: Write the failing kernel test**

Create `packages/kernel/tests/perspectiveTheme.test.ts`. Assert the token contract + kind inference (mount a themed div, read computed `--cg-*`; and `resolveThemeKind`). Because jsdom/happy-dom may not evaluate the imported CSS, drive `resolveThemeKind` directly (pure) and assert the CSS text contains the blocks:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveThemeKind } from '../src/theming/themeKind';

const css = readFileSync(new URL('../src/theming/tokens.css', import.meta.url), 'utf8');

describe('cg-theme-perspective', () => {
  it('declares both theme blocks with the core perspective tokens', () => {
    expect(css).toMatch(/\.cg-theme-perspective-dark\s*\{/);
    expect(css).toMatch(/\.cg-theme-perspective\s*\{/);
    // near-black bg + reserved sign tokens present in the dark block
    const dark = css.slice(css.indexOf('.cg-theme-perspective-dark {'));
    expect(dark).toMatch(/--cg-pos-color:/);
    expect(dark).toMatch(/--cg-neg-color:/);
    expect(dark).toMatch(/--cg-cell-font-family:\s*'JetBrains Mono'/);
  });
  it('resolveThemeKind: -dark → dark, base → light', () => {
    expect(resolveThemeKind(['cg-theme-perspective-dark'], '#16181d')).toBe('dark');
    expect(resolveThemeKind(['cg-theme-perspective'], '#ffffff')).toBe('light');
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd packages/kernel && npx vitest run tests/perspectiveTheme.test.ts` — FAIL (blocks not present).

- [ ] **Step 3: Add the two theme blocks to `tokens.css`**

At the top shared seams, add `cg-theme-perspective` + `-dark` to the `background-color` + `.cg-canvas` selector lists (mirror the `cg-theme-starui` entries at lines 7-16). Then add the two full blocks (mirror the 65-token `cg-theme-quartz-dark` set; perspective values — dark PRIMARY):
```css
.cg-theme-perspective-dark {
  color-scheme: dark;
  --cg-font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace;
  --cg-cell-font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace;
  --cg-font-size: 12px;
  --cg-font-size-sm: 11px;
  --cg-row-height: 24px;
  --cg-header-height: 40px;
  --cg-fg-color: #c3c9d1;
  --cg-bg-color: #16181d;
  --cg-row-alt-bg: #16181d;
  --cg-header-bg: #16181d;
  --cg-header-fg: #8a93a0;
  --cg-border-color: #2a2f37;
  --cg-grid-line-color: #24272e;
  --cg-row-hover-bg: rgba(255,255,255,0.03);
  --cg-row-selected-bg: rgb(96 150 220 / 16%);
  --cg-chrome-accent: #6f7c8c;
  --cg-focus-ring-color: var(--cg-chrome-accent);
  --cg-focus-ring-width: 2px;
  --cg-editor-invalid-color: #e0876a;
  --cg-flash-from-color: rgba(96,150,220,0.30);
  --cg-flash-to-color: rgba(96,150,220,0);
  --cg-resizer-hot-zone: 4px;
  --cg-scrollbar-thickness: 8px;
  --cg-floating-filter-bg: color-mix(in srgb, var(--cg-header-bg) 60%, transparent);
  --cg-floating-filter-border: var(--cg-border-color);
  --cg-floating-filter-placeholder: #565e6a;
  --cg-quick-filter-match-bg: #2a3550;
  --cg-unsort-icon-color: rgba(195,201,209,0.35);
  --cg-range-fill-color: rgb(96 150 220 / 18%);
  --cg-range-border-color: #6aa9e0;
  --cg-totals-bg: #191c22;
  --cg-totals-fg: #c3c9d1;
  --cg-totals-border-top: #2a2f37;
  --cg-totals-fg-muted: #7a828e;
  --cg-totals-font-weight: 500;
  --cg-pinned-row-bg: #191c22;
  --cg-pinned-row-fg: var(--cg-fg-color);
  --cg-pinned-row-border: var(--cg-totals-border-top);
  --cg-group-chevron-color: var(--cg-totals-fg-muted);
  --cg-group-count-color: var(--cg-totals-fg-muted);
  --cg-group-indent: 14px;
  --cg-group-row-bg: #191c22;
  --cg-group-checkbox-border-color: var(--cg-fg-color);
  --cg-group-checkbox-check-color: var(--cg-fg-color);
  --cg-group-checkbox-indeterminate-color: var(--cg-fg-color);
  --cg-group-checkbox-fill: transparent;
  --cg-group-footer-bg: var(--cg-totals-bg);
  --cg-group-footer-fg: var(--cg-totals-fg);
  --cg-group-footer-border-top: var(--cg-totals-border-top);
  --cg-group-footer-font-weight: var(--cg-totals-font-weight);
  --cg-input-bg: #1c2028;
  --cg-input-fg: var(--cg-fg-color);
  --cg-input-border: var(--cg-border-color);
  --cg-input-focus-border: var(--cg-focus-ring-color);
  --cg-input-disabled-bg: #16181d;
  --cg-tooltip-bg: rgba(25,28,34,0.97);
  --cg-tooltip-fg: #e6e9ee;
  --cg-tooltip-border: rgba(255,255,255,0.08);
  --cg-checkbox-checked-bg: transparent;
  --cg-checkbox-checked-fg: var(--cg-fg-color);
  --cg-cell-horizontal-border-color: transparent;
  --cg-popup-bg: #191c22;
  --cg-popup-border: var(--cg-border-color);
  --cg-menu-hover-bg: var(--cg-row-hover-bg);
  --cg-cell-padding-x: 8px;
  /* Reserved for surface #3 (sign-driven numbers / bars / heatmap): */
  --cg-pos-color: #6aa9e0;
  --cg-neg-color: #e0876a;
}
```
Then `.cg-theme-perspective` (LIGHT inversion) — same token names + typography/density, inverted palette:
`bg #ffffff`, `fg #1a1f28`, `header-fg #5b6672`, `border #dfe3e8`, `grid-line #eceef1`, `row-hover rgba(0,0,0,.03)`, `row-selected rgb(56 132 195 / 14%)`, `chrome-accent #6b7683`, `flash-from rgba(56,132,195,.22)`, totals/pinned/group/input/popup/tooltip mapped to light neutrals, `--cg-pos-color #2f7bc4`, `--cg-neg-color #c96a4a`, `color-scheme: light`.

- [ ] **Step 4: Run the test + kernel gate** — `cd packages/kernel && npx vitest run tests/perspectiveTheme.test.ts && npx tsc --noEmit && npm run build && npx vitest run` — PASS + suite green (no logic change → no regressions).

- [ ] **Step 5: Demo default + E2E + LIVE browser-verify (tune here)**

`apps/cgrid-customizer-demo/src/main.ts`: change the construction `theme` + `applyTheme()` strings from `cg-theme-starui-dark`/`cg-theme-starui` to `cg-theme-perspective-dark`/`cg-theme-perspective`. Rebuild kernel dist, run the demo, and **tune the palette/type/density live against the Perspective screenshots** (adjust the Step-3 hex until it matches — near-black bg, mono headers, hairline lines, dense rows, blue/salmon selection+flash). Create `apps/cgrid-customizer-demo/e2e/perspectiveTheme.spec.ts` (mirror `columnGroups.spec.ts` harness): assert the grid root carries `cg-theme-perspective-dark` on load and the theme toggle swaps to `cg-theme-perspective` (+ `__cgapi.getThemeKind()` flips). Run `npx playwright test e2e/perspectiveTheme.spec.ts` + full demo suite green. Kill server + browser.

- [ ] **Step 6: Commit**
```bash
git add packages/kernel/src/theming/tokens.css packages/kernel/tests/perspectiveTheme.test.ts apps/cgrid-customizer-demo/src/main.ts apps/cgrid-customizer-demo/e2e/perspectiveTheme.spec.ts
git commit -m "feat(theme): cg-theme-perspective (+dark) — Perspective-inspired foundation + demo default"
```

---

## Self-review notes
- **Spec coverage:** §3 (CSS-only, no kernel change) → Task 1 architecture; §4.1/§4.2 token values → Step 3; §5 demo adoption → Step 5; §6 testing (token test + themeKind + E2E smoke + live browser-verify) → Steps 1/4/5; §7 out-of-scope (additive, no starui/quartz edit, no sign-coloring impl — only reserved tokens) → Global Constraints + the reserved `--cg-pos/neg` comment.
- **Placeholder scan:** none — the full dark block is concrete; the light block gives concrete inversion values; exact hex is explicitly "tuned live" per the spec, not a TODO.
- **Consistency:** token names mirror the enumerated 65-token quartz-dark set; `--cg-pos-color`/`--cg-neg-color` names match the spec §4.1 + §7.
