# Cycle 13 — Status bar design notes

> Output of the `/frontend-design` pass for Cycle 13 Task 1. Subsequent tasks
> (built-in count panels, agg panel, custom panels) **inherit this vocabulary**;
> append decisions you make there to the end of this file rather than re-deriving
> them.

## Subject + audience

- **Subject:** the status strip on a Bloomberg-grade financial data grid.
- **Audience:** traders / quants / analysts who already spend the day reading
  the body. Eyes are saturated with mono-tabular numerics; their patience for
  decorative chrome on this strip is zero.
- **Single job:** surface up to ~5 small bits of grid state (row counts, agg
  values) in a strip that the user can find in peripheral vision without
  re-focusing on it.

## Anti-defaults (deliberately NOT taken)

The generic AI defaults for this kind of brief, and why I avoided them:

| Generic move | Why I rejected it |
|---|---|
| A coloured "Live" pill or a green-dot accent in the bar chrome | Compounds noise. The screenshot shows a faint `· Live` blob that is part of a panel, not part of the bar. The bar itself stays achromatic. |
| Vertical hairline rules between left / center / right zones | Zones are conceptual, not visual. Rules say "three columns of equal weight" — that's untrue (left + right are loaded, center is usually empty). |
| Bloomberg-orange / Reuters-green accent | The canvasgrid body is light by default and the brand is achromatic; an accent would read as themed product, not utility surface. |
| Tabular-nums via `font-variant-numeric` as the signature | Whole grid already uses **JetBrains Mono / Fira Code / SF Mono**. Tabular-nums is inherent. Need a different signature. |
| Box-shadow inset to make the bar look "recessed" | Fussy at 28 px tall. Hairline + tonal tint do the job without the artefact. |

## Signature (the one memorable choice)

**The "sandwich" — the status bar reuses `--cg-header-bg` as its background.**

The grid header already uses `--cg-header-bg` (light: `#f4f6f8`, dark: `#0d1a33`)
as a faint tonal tint above the body. By reusing that exact token on the bottom
strip, the body is visually sandwiched between two identical scaffolding
surfaces, header on top, status bar on bottom, sharing the same border colour.
It reads as a deliberate composition (data is bracketed by chrome) rather
than as three unrelated horizontal bands.

Both the header and the status bar use `--cg-border-color` for their
body-facing edge (header has `border-bottom`, status bar has `border-top`),
so the symmetry is mechanical and survives any future palette tweak.

Cost: one design token reuse. Benefit: the bar costs nothing visually
because users have already learned the header tone in the first half-second
of looking at the grid.

## Tokens declared

All new tokens default off existing canvasgrid tokens so dark theme works
automatically without a parallel override block. Override targets are
documented for downstream theming.

```css
--cg-status-bar-height:       28px;
--cg-status-bar-padding-x:    12px;
--cg-status-bar-gap:          16px;          /* between panels in one zone */
--cg-status-bar-font-size:    var(--cg-font-size);    /* 13px, matches body */
--cg-status-bar-bg:           var(--cg-header-bg);    /* sandwich */
--cg-status-bar-fg:           var(--cg-fg-color);     /* value text */
--cg-status-bar-fg-muted:     color-mix(in srgb, var(--cg-fg-color) 60%, transparent);
--cg-status-bar-border:       var(--cg-border-color);
```

Rationale per token:

- **`28px`** — matches the brief and reads as "less than a row" (rows are
  32px) so the bar can never be mistaken for a data row.
- **`12px` padding-x** — matches the side-bar tabs' horizontal padding so the
  left-edge of a status panel value aligns near the left-edge of the
  first body cell on most layouts.
- **`16px` gap** — visually distinct from the `·` middle-dots Tasks 2/3
  will use inside a panel.
- **`color-mix(... 60% ... transparent)`** — mirrors the same alpha pattern
  used by `--cg-range-fill-color` (line 56 of tokens.css). Labels recede
  to ~60% perceived weight without ever swapping to a new colour.

## Type vocabulary

- **Family:** `var(--cg-font-family)` (mono). Inherit; do NOT introduce a
  second family for the strip.
- **Size:** 13px (`var(--cg-font-size)`). Matches the side-bar tab labels
  shipped in Cycle 11 (`tokens.css` line 537).
- **Weight contrast:** **none.** Mono renders weight changes poorly at
  13px. Label/value hierarchy is carried by **colour**: label uses
  `--cg-status-bar-fg-muted`, value uses `--cg-status-bar-fg`.
- **Case:** sentence case. No uppercase, no letter-spacing tracking.
  (Lesson from Cycle 11 sidebar v1 — uppercase reads as industrial /
  ag-grid-clone, which is exactly what the user flagged.)
- **Separators:** middle-dot `·` U+00B7 inside a panel (Tasks 2/3); flex
  gap (16px) between panels within one zone.

## Layout — three-zone flex

```
┌────────────────────────────────────────────────────────────┐
│ [body canvas] ……………………………………………………………………………………………………… │
├────────────────────────────────────────────────────────────┤  ← 1px --cg-border-color
│ ⟨ left zone ──── ⟩    ⟨ center zone ⟩    ⟨ ──── right ⟩    │  ← 28px, --cg-header-bg
└────────────────────────────────────────────────────────────┘
```

- Bar root: `display: flex; align-items: center; flex: 0 0 auto;`
- Three zones each `flex: 1 1 0; min-width: 0;` so:
  - centre stays centred even when left + right have different widths,
  - any zone can shrink without pushing siblings off-screen,
  - an empty zone holds its third (panels never jump when a count appears).
- Justify per zone:
  - left → `flex-start`
  - center → `center`
  - right → `flex-end`

## Theming — both themes work without parallel overrides

Because every status-bar token defaults off an existing token that already
has a dark-theme override (`--cg-header-bg`, `--cg-border-color`,
`--cg-fg-color`), dark theme is free. The `--cg-status-bar-fg-muted`
mix likewise re-derives from whatever `--cg-fg-color` resolves to on
the active theme.

Hand-checked against the screenshot:
- Light: bar = `#f4f6f8`, border-top = `#d5dbe0`, label = `#1a1f24 @ 60%`,
  value = `#1a1f24`. Reads "shelf below the body", not "alert strip".
- Dark: bar = `#0d1a33`, border-top = `#38507a`, label = `#cbd5e1 @ 60%`,
  value = `#cbd5e1`. Same relationship, no surprises.

## Empty-bar acceptance criterion

Task 1's visual cell (`14-status-bar-mounted.png`) shows the bar with **no
panels**. The chrome alone must still read as intentional:

1. The bar has a distinct tonal tint vs. the body (the sandwich).
2. The top border-line is unambiguously present (not a sub-pixel ghost).
3. The 28px height is reserved — the body canvas above is genuinely
   shorter than it would be without the bar.

If the screenshot makes the bar look like a transparent / unstyled `<div>`
appended at the bottom, **the design pass failed**: rebuild from this
notes file before re-baselining.

## What this leaves for Tasks 2 / 3 / 4 to inherit

The shell DOESN'T ship panel-level CSS. The vocabulary Tasks 2/3 will use
(and which is intentionally NOT created in Task 1):

```css
.cg-status-panel             /* base for any panel: display: inline-flex; gap: 1ch; align-items: baseline; */
.cg-status-panel-label       /* color: var(--cg-status-bar-fg-muted); */
.cg-status-panel-value       /* color: var(--cg-status-bar-fg); */
.cg-status-panel-separator   /* the · between two stats inside one panel: color: var(--cg-status-bar-fg-muted); padding: 0 0.5ch; */
```

Tasks 2/3 should:
1. Read this file before designing.
2. Re-invoke `/frontend-design` for their own brief (per the per-task
   discipline).
3. Append their decisions (label weight, separator character, hover
   state, narrow-viewport truncation) to the bottom of this file under
   a `## Task N — <panel name>` heading.

## Decision log — Task 1 (shell only)

- 2026-06-27 — Subject pinned, anti-defaults written, sandwich signature
  chosen, 8 tokens declared, three-zone flex layout fixed. Cleared to
  start implementation.
