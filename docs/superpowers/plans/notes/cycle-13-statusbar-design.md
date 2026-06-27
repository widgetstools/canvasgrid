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

---

## Task 2 — count panels (Total / Filtered / Selected / TotalAndFiltered)

> Adds five CSS rules and zero new design tokens. Re-uses Task 1's
> status-bar tokens for every colour / size / spacing decision. The
> count family is the most-scanned thing in the bar — a trader checks
> "are there 3k or 30k rows?" dozens of times an hour, so hierarchy
> has to land in < 250 ms without re-focusing.

### Decisions

1. **Hierarchy via colour, never weight.** Mono at 13px can't carry
   weight (rejected in Task 1). Label = `--cg-status-bar-fg-muted`
   (60% alpha), value = `--cg-status-bar-fg` (full strength). The
   trader's eye lands on the value because it's the only saturated
   mark on the strip. Tabular-nums come free from the mono family —
   no `font-variant-numeric` declaration needed (Task 1 anti-default).

2. **Label syntax: `Label:` (capitalised noun phrase + colon, no
   trailing space).** The 1ch gap to the value is structural
   (`display: inline-flex; gap: 1ch`), not whitespace inside the
   markup. Survives any future text-wrap experiment without splitting
   on the wrong space.

3. **Built-in label texts** — sentence case, screenshot-parity:
   - `agTotalRowCountComponent` → `Total Rows: N`
   - `agFilteredRowCountComponent` → `Rows: N` (matches the
     screenshot's filtered facet, NOT `Filtered: N` which adds
     three chars for zero information gain)
   - `agSelectedRowCountComponent` → `Selected: N`
   - `agTotalAndFilteredRowCountComponent` → `Total Rows: T  Rows: F`
     (single panel, two facts, 2ch flex gap between the two
     label-value pairs — see decision 4)

4. **Inter-pair spacing inside the combined panel: 2ch flex gap, NOT
   a typographic separator.** Looking at
   `18-status-bar-all-components.png`, the two facts in
   `agTotalAndFilteredRowCountComponent` are separated by ~3 character
   widths of whitespace, not by a mark. Honour the reference.
   The `·` Task 1 reserved for inside-panel separation does NOT land
   here — it lands in Task 3's agg panel, which crams 4–5 stats inline
   and genuinely needs a typographic mark to keep them parseable.

5. **Number formatting.** `new Intl.NumberFormat('en-US').format(n)`
   for the default; `statusPanelParams.numberFormatter?: (n: number)
   => string` escape hatch for non-US locales / accountancy-format
   apps. No grouping override beyond en-US comma — matches the
   screenshot and is the most-readable default for the trader
   audience.

6. **Empty-selection state shows `Selected: 0`, never collapses.**
   Zero-flicker target rules. A panel that disappears + reappears as
   the user clicks into a row would yank attention to the bar chrome
   — exactly opposite the "scan in peripheral vision" goal. Showing
   `Selected: 0` with the muted label colour reads as "no current
   selection" without needing colour cue.

7. **No hover state.** Count panels are non-interactive in Cycle 13.
   No cursor change, no underline, no colour shift on hover.
   Reserves the affordance for Cycle 14+ if a clickable count is ever
   added.

8. **No icon, no badge.** The label IS the icon — a short noun
   phrase reads faster than icon + label disambiguation.

### Anti-defaults rejected for this task

| Generic move | Why rejected |
|---|---|
| Bold value, regular label (typographic weight hierarchy) | Mono at 13px can't carry weight (same lesson as Task 1). Colour does the lift. |
| Green-on-non-zero accent for selected count | Bar is achromatic per Task 1. A green pulse here would compete with the body's range-fill colour. |
| Uppercase labels (TOTAL ROWS / FILTERED) | Industrial / ag-grid-clone vibe Task 1 explicitly rejected. |
| Hide the count panel when N == 0 | Zero-flicker target rules. A panel that disappears redirects attention. |
| Comma- or dot-separating the two pairs in `agTotalAndFiltered…` | The screenshot uses whitespace. Punctuation between facts inside a panel is reserved for Task 3 (`·` between 4–5 stats); using it for two pairs would be premature. |

### Signature for this task

**The grammar of separation:**

- **Between panels in the same zone** → 16px flex gap (Task 1).
- **Between facts inside one panel (count family, 2 facts)** → 2ch flex gap.
- **Between facts inside one panel (agg family, 4–5 facts)** → `·` typographic mark (Task 3).

The user learns the grammar in one glance: more facts → tighter mark.
Three separation widths total, each tied to the density of what's
being separated. Across cycles, this rule is self-policing.

### Tokens reused (no new ones)

| Concern | Token | Source |
|---|---|---|
| Label colour | `--cg-status-bar-fg-muted` | Task 1 |
| Value colour | `--cg-status-bar-fg` | Task 1 |
| Font | `--cg-font-family` (inherited from `.cg-status-bar`) | Task 1 |
| Size | `--cg-status-bar-font-size` (inherited) | Task 1 |
| Inter-panel gap | `--cg-status-bar-gap` (16px, on `.cg-status-bar-zone`) | Task 1 |

Zero new design tokens. Five new class rules (one is a modifier).

### Class vocabulary (Task 2)

```css
.cg-status-panel-count {
  display: inline-flex;
  align-items: baseline;
  gap: 1ch;                /* between label and value */
  white-space: nowrap;     /* never wrap "Total Rows: 3,000" mid-value */
}
.cg-status-panel-count--combined {
  gap: 2ch;                /* between the two label-value pairs in
                              agTotalAndFilteredRowCountComponent.
                              Wider than the intra-pair 1ch so the
                              eye reads pair-pair, not pair-label. */
}
.cg-status-panel-count-pair {
  display: inline-flex;
  align-items: baseline;
  gap: 1ch;                /* mirrors the single-fact panel gap so
                              both renderings share kerning. */
}
.cg-status-panel-count-label { color: var(--cg-status-bar-fg-muted); }
.cg-status-panel-count-value { color: var(--cg-status-bar-fg); }
```

### Empty-bar acceptance criterion (Task 2 cell)

`15-status-bar-count-panels.png` must show:

1. All four count panels mounted into the right zone, stacking
   horizontally in declaration order with 16px gaps between them.
2. Label colour visibly muted relative to the value colour (the
   60%-alpha mix in `--cg-status-bar-fg-muted` reads as a clear
   tonal step down, not a "slightly off" near-black).
3. In `agTotalAndFilteredRowCountComponent`, the inter-pair gap
   reads as wider than the intra-pair gap — the two facts read as
   a pair, not as four loose tokens.

If any of those fails, the rendered cell is "labels and numbers
separated by spaces" and the design pass needs another iteration.

### Decision log — Task 2

- 2026-06-27 — Decided colour-only hierarchy (no weight), `·`
  reserved for Task 3's agg panel, "Rows:" matches screenshot,
  "Selected: 0" shown for empty selection, en-US default
  `Intl.NumberFormat` with `statusPanelParams.numberFormatter`
  escape hatch, separation grammar (16px / 2ch / `·`) codified.
  Cleared to start implementation.

---

## Task 3 — agAggregationComponent

> Five stats (`Count` / `Sum` / `Min` / `Max` / `Avg`) jammed inline
> into a single panel. Cashes in the `·` separator Task 1 reserved
> and Task 2 codified the grammar for. Zero new design tokens, six
> new CSS rules (one is a modifier). The work this design pass had
> to do was *not* the visual — Tasks 1 + 2 already locked the type,
> colour, and separator — but the *empty-selection contract*, which
> is the one place the agg family must diverge from the count
> family's "never collapse" rule.

### Decisions

1. **Inherit Task 2's stat shape verbatim.** Each stat is a
   `Label: value` pair using `display: inline-flex; gap: 1ch;
   align-items: baseline;` — identical kerning to the count
   panels. Label colour `--cg-status-bar-fg-muted`, value colour
   `--cg-status-bar-fg`. The user already learned this hierarchy
   in the count family two zones away; reusing it means the agg
   panel doesn't ask for a second pattern-load.

2. **The middle-dot lands here.** `·` U+00B7 between stats, in a
   `<span class="cg-status-panel-agg-separator">` carrying
   `padding: 0 0.5ch` (1ch total around the dot) and the muted
   colour (it's chrome, not data). Flex container gap stays at
   `0` — the separator's own padding owns all inter-stat spacing.
   This is the Task 1 grammar rule cashing in: only the agg family
   uses the `·`, and that scarcity is what makes it parse as
   "structural mark" rather than "decorative bullet".

3. **Canonical stat order, regardless of `aggFuncs` input order.**
   `Count → Sum → Min → Max → Avg`. If the app passes
   `aggFuncs: ['avg', 'count']` the panel renders `Count: N · Avg:
   N`, not `Avg: N · Count: N`. Reason: a trader who configures
   one grid with the default set and another with `['sum', 'avg']`
   should find "Sum" in the same relative position in both — like
   reading hours-then-minutes on a digital clock. Visual stability
   across configurations beats honouring caller-passed order
   (which is a syntactic accident of how the array literal was
   written, not a design statement).

4. **Empty selection → panel hides.** When `getCellRanges()` is
   empty AND row selection is empty, the panel root sets
   `hidden = true` (CSS: `display: none`). This INVERTS Task 2's
   "never collapse" rule for the count panels, and the inversion
   is the single risk this design pass takes. The defence:

   - **Cadence is different.** Count panels react to *ambient*
     events (`modelUpdated`, `filterChanged`) — updates the user
     did not directly trigger. A panel disappearing-then-
     reappearing under ambient updates yanks attention to chrome
     that has no business asking for it. The agg panel only
     updates on `cellSelectionChanged` / `selectionChanged` —
     events that are, by definition, the *direct consequence of
     user input*. The user is already looking at the area they
     just touched; the panel appearing is feedback for the
     action, not unrelated chrome moving.
   - **Information density is different.** A `Selected: 0`
     count is one fact saying "no current selection". An idle
     agg panel showing `Count: 0 · Sum: — · Min: — · Max: — ·
     Avg: —` is five facts saying nothing. The em-dashes occupy
     ~80 px of bar real estate communicating absence; they read
     as visual noise, exactly the opposite of the "no decorative
     chrome" anti-default Task 1 wrote. Hiding the panel reclaims
     the space for *meaningful* facts in neighbouring zones.
   - **Semantic is different.** Zero rows is a value; "no
     summary" is the *absence of subject*. The mathematical
     truth is that `min/max/avg` of an empty set are undefined,
     not zero. Pretending to render them with em-dashes is a
     polite lie.

5. **N/A inside a single stat → em-dash `—` U+2014.** When the
   selection has rows but the column type can't aggregate (string
   ticker column, boolean flag), Count is still defined but
   Sum/Min/Max/Avg are NaN. Render `—` for the NaN stats only —
   the row stays structurally stable so the user can see "Count:
   17 is fine, but the numerics don't apply here". Reason em-
   dash (not em-space, not "N/A", not blank): the dash is one
   character wide enough to read as "deliberate placeholder",
   short enough not to dominate. Same rationale as accounting
   tables.

6. **Mixed-type selection: aggregate over the numerics, ignore
   the rest, no warning surface.** If a 10-cell range covers 7
   numbers and 3 strings, `Count: 10` (every cell counted),
   `Sum/Min/Max/Avg` operate on the 7 numbers. NaN / Infinity /
   null cells are silently skipped from the numeric aggregates
   but DO count toward `Count`. The catalog spec's
   `valueFormatter` escape hatch covers apps that need a
   different policy. No banner, no asterisk — the design notes
   anti-default rules out chrome that announces edge cases.

7. **`white-space: nowrap; overflow: hidden; text-overflow:
   ellipsis` on the panel root.** At a status-bar zone narrower
   than ~400 px, 5 stats will overflow. The chosen failure mode
   is "right-truncate the last stat" because the canonical
   order puts Avg last — and Avg is the most derived stat, the
   one most easily reconstructed mentally from the others
   (`Avg = Sum / Count`). Documented escape hatch: apps that
   need every stat visible at narrow widths restrict via
   `statusPanelParams: { aggFuncs: ['count', 'sum'] }` per the
   catalog spec. This is a deliberate cliff, not a graceful
   degradation: a half-rendered "Avg: 12…" would be a wrong
   number, and a wrong number is worse than a missing one.

8. **Refresh triggers: `cellSelectionChanged` + `selectionChanged`.**
   NOT `rangeSelectionChanged` (the mid-drag firehose). The
   debounced sibling matches the user's mental model:
   the agg updates when the selection *settles*, not on every
   drag tick. Task 5's rAF dispatcher will collapse multi-event
   bursts to one refresh per frame on top of this; for Task 3
   the two-event subscription is the contract.

9. **No icon, no badge, no hover, no tooltip.** Inherits every
   "no chrome" decision from Tasks 1 + 2. The agg panel is the
   densest cell in the strip; it earns its real estate by being
   useful, not by announcing itself.

10. **Number formatting.** `Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2 })` as the default. Differs from
    Task 2's "no fraction digits" only because Sum/Min/Max/Avg
    of prices, P&L, and yields routinely have fractions — a
    `Min: 12` for a column showing `12.4567` would be a wrong
    number. The catalog spec's `IAggregationStatusPanelParams.
    valueFormatter(params)` overrides this per-panel.

### Anti-defaults rejected for this task

| Generic move | Why rejected |
|---|---|
| Math glyphs as labels (`Σ` for sum, `⌀` for avg, `x̄` for mean) | Industrial / spreadsheet-clone vibe. The text labels are already short (3–5 chars); icons would add a glyph-disambiguation hop and break the type-only vocabulary Task 1 set. |
| Coloured pills around each stat | Bar is achromatic. Pills would compete with the body's range-fill colour and signal "alert", which agg is not. |
| Render every stat always; show `0` for empty sum / min / max / avg of empty set | A wrong number (0) is worse than a missing one. Em-dash is the honest mark for "undefined", and the panel hides entirely when the *selection* is undefined (decision 4). |
| Show panel with `Count: 0 · Sum: — · Min: — · Max: — · Avg: —` when no selection | Five em-dashes saying nothing. Reclaim the space — see decision 4's defence. |
| Animate stat values when they change | Calls attention to the bar. Trader scans peripheral vision. Same anti-default as Task 1's "no live pulse". |
| Render in caller-passed `aggFuncs` order | Caller-passed order is a syntactic accident, not a design statement. Canonical order means "Sum" always sits in the same slot — decision 3. |
| Vertical separator (`|`) between stats instead of `·` | Heavier visual weight, reads as table-rule chrome. The middle-dot is a typographic mark (lighter, baseline-aligned, narrower); it's the right granularity for in-panel separation per Task 2's codified grammar. |
| Tooltip on hover explaining "Sum of selected numeric cells" | Documentation chrome inside the bar. The label IS the documentation (Task 2 decision 8). Apps that need explanatory tooltips for non-default `aggFuncs` configurations can wrap the panel via the custom-panel path (Task 4). |

### Signature for this task

**The empty-state inversion.**

The single most opinionated move in this design is that the agg
panel *disappears* when there's nothing to summarise — and the
count panels next to it *don't*. That asymmetry is the
signature, and the reason it works:

| Family | Update cadence | Empty contract | Why |
|---|---|---|---|
| Count panels (Task 2) | Ambient (model / filter events) | Never collapse — `Selected: 0` | Disappearing under ambient updates yanks attention to chrome the user did not request. |
| Agg panel (Task 3) | User-triggered (selection events) | Hides on empty | Appearing in response to a user action IS the feedback. Showing five em-dashes at idle is noise, not information. |

The bar's rule becomes: **chrome that updates on ambient events
holds its space; chrome that updates on user action takes only
the space it needs.** Across cycles this rule is self-policing:
any future panel categorises into one bucket or the other based
on what fires its refresh.

### Tokens reused (no new ones)

| Concern | Token | Source |
|---|---|---|
| Label colour | `--cg-status-bar-fg-muted` | Task 1 |
| Value colour | `--cg-status-bar-fg` | Task 1 |
| Separator colour | `--cg-status-bar-fg-muted` | Task 1 (chrome, not data) |
| Font | `--cg-font-family` (inherited from `.cg-status-bar`) | Task 1 |
| Size | `--cg-status-bar-font-size` (inherited) | Task 1 |
| Inter-stat spacing | `0.5ch` padding on the `·` separator | Task 1 (per the Class vocabulary block at line 151) |
| Intra-stat (label → value) spacing | `1ch` flex gap | Task 2 |

Zero new design tokens. Six new class rules (one is a modifier).

### Class vocabulary (Task 3)

```css
.cg-status-panel-agg {
  display: inline-flex;
  align-items: baseline;
  gap: 0;                  /* the separator owns all inter-stat
                              spacing via its own padding. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;         /* hard cap inside the zone — past the
                              zone's flex basis, ellipsis truncates
                              the trailing stat. */
}
.cg-status-panel-agg[hidden] { display: none; }  /* empty-selection contract */
.cg-status-panel-agg-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 1ch;                /* mirrors Task 2's intra-pair gap so
                              the agg + count families share
                              kerning when read across the bar. */
}
.cg-status-panel-agg-label { color: var(--cg-status-bar-fg-muted); }
.cg-status-panel-agg-value { color: var(--cg-status-bar-fg); }
.cg-status-panel-agg-separator {
  color: var(--cg-status-bar-fg-muted);
  padding: 0 0.5ch;        /* 1ch total around the · */
  /* aria-hidden in markup — the separator is presentational; a
     screen reader should hear "Count: 5, Sum: 1,234" not "Count:
     5 middle dot Sum: 1,234". */
}
```

### Empty-bar acceptance criterion (Task 3 cell)

`16-status-bar-aggregation.png` must show:

1. A 10-row range selected across 2 numeric columns is active in
   the body (the trigger condition for the panel to be visible).
2. The agg panel is mounted in the LEFT zone (per the demo wiring
   in Task 6, but for cell 16 the left zone is the natural
   home — gives the panel runway and visually separates it from
   the right-loaded counts).
3. Five stats render in canonical order with `·` separators. The
   label/value colour contrast is the same step-down established
   in Task 2 (muted label, full-strength value).
4. The trailing `Avg:` stat does NOT truncate — the demo zone
   width must comfortably hold all 5 stats so the baseline cell
   tests the canonical case, not the cliff case. (The cliff case
   gets its own cell in a future cycle if it ever becomes a
   regression target — Cycle 13 doesn't ship one.)
5. The count panels in the right zone are also present (because
   the demo `?statusBar=full` mode mounts both), and the
   separation grammar reads correctly: dots inside the agg, gap
   between panels.

If the rendered cell shows five em-dashes (empty-selection
contract broken), or the agg + count panels touch (inter-panel
gap collapsed), or the `·` reads as a heavier mark than the
text around it (separator colour regression), **the design
pass failed**: rebuild from this notes file before
re-baselining.

### Decision log — Task 3

- 2026-06-27 — Decided canonical stat order (Count/Sum/Min/Max/
  Avg) regardless of `aggFuncs` input order; empty-selection
  hides the panel (the one inversion of Task 2's never-collapse
  rule, defended by the ambient-vs-user cadence distinction); em-
  dash `—` for per-stat N/A in mixed-type selections; mixed-type
  selection aggregates numerics only with no warning surface;
  `cellSelectionChanged` + `selectionChanged` are the refresh
  triggers (NOT the mid-drag `rangeSelectionChanged` firehose);
  `Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })`
  default with `valueFormatter` override; zero new tokens, six
  new CSS rules. Signature is the empty-state inversion + the
  rule it codifies for future panel families. Cleared to start
  implementation.
