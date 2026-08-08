# Cycle 22 — Theming completeness — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 22
**FM coverage:** Area 21 — ~18 of 18 rows
**Depends on:** Cycle 4 (`setGridOption` for runtime theme changes)

---

## Mental model: tokens are the API surface

cgrid's theming is CSS-variable-driven from day one (the existing
`cssReader.ts` reads every paint-relevant value from `--vg-*` tokens).
Cycle 22 closes the parity gap between cgrid's existing tokens and
ag-grid's full Quartz/Material variable set, then adds three
ergonomic layers on top:

1. **Density modes** — preset variable bundles (`compact`, `normal`,
   `comfortable`).
2. **Theme parameter API** — runtime variable overrides without
   class swaps.
3. **`prefers-color-scheme` auto-detect** — light/dark follows system.

**Pin:** A theme change is ONE DOM class flip + ONE `cssReader.read()`
+ ONE `requestRepaint()`. No worker round-trip. No relayout.

---

## Task 1 — Audit + add missing CSS variables

**Goal:** Diff cgrid's `theming/tokens.css` against ag-grid's
documented variable set. Add the missing ~30 tokens. Examples:

| Token | Default (light) | Purpose |
|---|---|---|
| `--vg-row-hover-bg` | `#f8fafc` | Hover-state row tint |
| `--vg-header-cell-text-color` | `#111827` | Distinct from body fg |
| `--vg-cell-horizontal-border-color` | `transparent` | Optional inter-column rule |
| `--vg-range-selection-border-color` | `#2563eb` | Range outline |
| `--vg-input-bg` | `#ffffff` | Filter inputs, editors |
| `--vg-input-disabled-bg` | `#f3f4f6` | Disabled state |
| `--vg-checkbox-checked-bg` | `#2563eb` | Filled checkbox accent |
| `--vg-toggle-bg` | `#e5e7eb` | Toggle switch off |
| `--vg-toggle-bg-active` | `#2563eb` | Toggle switch on |
| `--vg-tooltip-bg` | `rgba(15,23,42,0.95)` | Floating tooltip |
| `--vg-tooltip-fg` | `#ffffff` | Tooltip text |

(Full list in `docs/catalog/21-themes-and-styling.md`.)

**Implementation:** Every new token gets:
1. Declaration in `theming/tokens.css` for `:root` (light) and
   `.vg-theme-dark` (dark).
2. Reader entry in `theming/cssReader.ts` (or grouped reader if the
   token is paint-hot enough to warrant pre-resolution).
3. Consumer hook-up at the relevant painter / overlay site.

---

## Task 2 — Density modes

**Goal:** Three CSS classes that bundle row-height / cell-padding /
header-height variable changes.

```css
.vg-density-compact {
  --vg-row-height: 24px;
  --vg-header-height: 28px;
  --vg-cell-padding-x: 4px;
  --vg-font-size: 12px;
}

.vg-density-normal { /* defaults — unchanged */ }

.vg-density-comfortable {
  --vg-row-height: 40px;
  --vg-header-height: 44px;
  --vg-cell-padding-x: 12px;
  --vg-font-size: 14px;
}
```

**Runtime toggle:** `setGridOption('density', 'compact')` flips the
class on the host. Existing `RowHeightIndex` (Cycle 5) re-reads the
new `--vg-row-height` and triggers a viewport recompute.

---

## Task 3 — Theme parameter API

**Goal:** Apps tune individual tokens without writing CSS:

```typescript
api.setThemeParams({
  '--vg-row-height': '36px',
  '--vg-header-bg': '#0f172a',
  '--vg-header-fg': '#ffffff',
});
```

**Implementation:** Inline-style set on the grid host. Each call:
1. Writes the variables to `host.style`.
2. Invalidates `cssReader` cache.
3. Triggers `requestRepaint()`.

**File:** `theming/themeParams.ts` (new) — wrapper around
`HTMLElement.style.setProperty`.

`getThemeParams()` returns the currently-set inline overrides (NOT
the resolved values — `getComputedStyle` exists for that).

---

## Task 4 — `prefers-color-scheme` auto-detect

**Goal:** A `vg-theme-auto` class that listens to the media query
and toggles between `vg-theme-quartz` and `vg-theme-quartz-dark`.

**Implementation in CSS only:**

```css
.vg-theme-auto {
  /* default to light */
}

@media (prefers-color-scheme: dark) {
  .vg-theme-auto {
    /* dark variable values */
  }
}
```

**Why CSS-only:** A `MediaQueryList.addEventListener` JS-driven
approach would force a `cssReader.read()` on every system toggle.
The CSS approach makes the SAME tokens resolve to different values
automatically; the next paint frame picks them up via the
revalidation that already runs on focus / visibility change.

---

## Task 5 — Shadow root option

**Goal:** `VelocityGridOptions.shadowRoot: true` mounts the grid inside a
shadow root for full CSS encapsulation.

**Use case:** Embedding cgrid in app shells that have aggressive
global CSS (Bootstrap, Tailwind reset, etc.) — the shadow root
isolates cgrid's styles.

**Implementation:**

```typescript
if (options.shadowRoot) {
  const root = container.attachShadow({ mode: 'open' });
  this.host = document.createElement('div');
  this.host.className = 'vg-shadow-host';
  root.appendChild(this.host);
  // Inject tokens.css inline so the shadow root sees it
  const style = document.createElement('style');
  style.textContent = inlinedTokensCSS;
  root.appendChild(style);
} else {
  this.host = container;
}
```

**Caveat:** DOM overlays (floating filters, tooltips, popups) must
mount INSIDE the shadow root too — `document.body.appendChild` won't
inherit the theme. Existing `PopupHost` (Cycle 5) gains a
`rootContext: ShadowRoot | Document` constructor arg.

---

## Task 6 — Theme docs site section

**Goal:** Update `docs/catalog/21-themes-and-styling.md` with:

- Full variable table (~70 tokens) with default values and usage.
- Density-mode comparison screenshots.
- Theme-parameter API examples.
- Shadow-root caveats and recipes.
- Migration notes for users coming from ag-grid Quartz / Material.

---

## Performance gates

- Theme change is one DOM class flip + one `cssReader.read()` +
  one `requestRepaint()`. No worker round-trip.
- Density change recomputes `RowHeightIndex` in ≤ 16 ms.
- Shadow-root mode adds < 1 ms to grid construction.
- `setThemeParams` with 10 variable overrides triggers ≤ 1 paint
  frame.

---

## Exit criteria recap

- FM Area 21 = 100 % ✅.
- Demo: light/dark/high-contrast toggle (high-contrast lands in
  Cycle 24) + density toggle + a per-token override panel.
- All ~70 tokens documented in `docs/catalog/21-themes-and-styling.md`.
- Shadow-root demo: cgrid embedded in a host with an aggressive
  global reset stays visually intact.
