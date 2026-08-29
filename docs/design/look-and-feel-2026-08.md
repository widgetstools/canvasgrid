# Look and feel — the data plane and its panels

**Status:** shipped, with two items still deferred
**Date:** 2026-08-28
**Context:** continues the ext-chrome pass (`ext-chrome-deferred-work.md`),
which stopped at the canvas edge.

The chrome pass put 1,402 controls on one ladder and left the canvas
untouched. This pass covers what it left: the data plane painted from
`tokens.css`, the kernel-owned panels around it, and four chrome surfaces
the ladder reached but never gave a grammar — the toolbars, the
saved-filter pills, the customizer tabs and the data-provider panel.

Design canvas: <https://claude.ai/code/artifact/7cb64620-b43d-438e-abbe-0ebe479339ed>

---

## The line ladder

Every structural line in the product was drawn from one token,
`--vg-border-color`, at **1.18:1** against a panel and **1.26:1** against
the chrome — below the point at which a 1px line is visible at all. The
input border was worse: **1.09:1** against its own fill, so the edge that
identifies a control did not identify it.

One token became four, per theme, measured on that theme's own ground.

The first pass set these at 2.1 / 2.5 / 2.7 / 3.1:1 and overshot — the
answer to "no discernible difference between sections" turned into lines
that competed with the data. They were pulled back one notch:

| Token | Dark | Contrast | Draws |
|---|---|---|---|
| `--vg-line-divider` | `#3F4044` | 1.6:1 | section rules inside a surface |
| `--vg-line-edge` | `#4A4B4F` | 1.9:1 | a surface's own outline |
| `--vg-line-header` | `#515256` | 2.2:1 | the header/body seam |
| `--vg-line-control` | `#595A5E` | 2.4:1 | a control's border |

Control borders therefore sit **below** the 3:1 WCAG 1.4.11 asks for a
component boundary. That is a deliberate trade for a calmer surface, and
it is survivable because a control is not identified by its border alone
here — it has a distinct fill, a label, and a full-accent focus ring. If
an audit requires 1.4.11 on borders, `--vg-line-control` is the single
value to raise; nothing else needs to move.

`--vg-border-color` is now an alias of `--vg-line-edge`, which is why every
panel, popover, menu and drawer in both packages lifted without being
touched individually.

Declared in all seven theme blocks: the light and dark groups, both
high-contrast variants (collapsed to their single ink), `vg-theme-auto`
and its `prefers-color-scheme: dark` block, and print.

## The lattice — two axes, two weights

`--vg-grid-line-color` ruled all four sides of every cell at one weight.
Split so each axis can be tuned:

- `--vg-grid-line-h` — `10%` white, the reading rhythm
- `--vg-grid-line-v` — `9%` white, one step under, so nine verticals never
  out-shout twenty-five horizontals
- `--vg-grid-line-header` — `10%` white. This was 14% on the argument that
  a header boundary is something you grab to resize, and at full height of a
  40px header, once per column, it was the loudest structure on screen — a
  picket fence across the top of the grid that carried on down through the
  floating-filter band. The header's own ground already marks the band; its
  verticals only have to mark where a column ends
- `--vg-grid-line-strong` — pinned-band and group edges

`gridLinesPainter` paints the vertical axis in two segments (header band,
data band) rather than one full-height run. Coverage is identical; only the
weight differs by band. All three fall back to `--vg-grid-line-color`, so a
theme declaring only the old token paints exactly as before.

## Four grounds

The header used `#17191E` — the same value as the toolbar chrome above it,
so the data plane never visibly began. The chrome plane is now its own
token and the four grounds separate. Every ground then came down 5%, which
keeps the steps between them identical and the whole surface a notch
deeper:

    chrome #16181D  <  data #1D1D22  <  header #21242B  <  totals #24282F

Light-theme grounds were left alone: taking white down 5% turns it grey and
changes that theme's character, which is a different decision from calming
a dark one. Its line ladder tracked the dark one down.

`--vg-bg-secondary` (read by `primitives-enhanced.ts`) was re-pointed at
`--vg-chrome-bg` so the chrome did not drift up with the header.

## Directional flash

One amber pair painted a rise and a fall alike, in every theme — on a
blotter the direction of a change is the most-read signal. The worker's
transaction diff already held both values, so the sign is captured there:

    stageFlashesForUpdates  →  state.pendingFlashDirs
    ViewportSlicer.slice    →  chunk.flashDir (one byte per cell: 0/1/2)
    serializeChunk          →  FLAG_FLASH_DIR wire section
    FlashRegistry.ingestMask→  per-entry colour override

Non-numeric changes and `flashCells` calls stage no direction and keep the
neutral flash. High contrast deliberately does not colour-code direction —
its aliases point at the existing pair, so AAA behaviour is unchanged.

Verified live on the SSRM demo: 189 green and 84 red flash composites,
zero amber, over six seconds of a 200 rows/s feed.

## Two type roles in cells

`--vg-cell-font-family` applied to every cell, so Desk, Region, Currency
and Trader were monospace — which buys nothing for a word and costs about
18% of the column's width. Columns now carry `fontRole`:

- `'auto'` (default) — `cellDataType: 'number'` is monospace, the rest take
  `--vg-cell-text-font-family`
- `'mono'` — always monospace; set this on identifier columns, which are
  `'text'` by data type but want the aligned face
- `'text'` — always the chrome family

`cellFontForColumn()` is shared by the painter and every autosize path, so
measured width still matches painted width.

## Selection

A selected row was flat `#363A43`; a selected anything else in the product
is an accent wash plus a 2px accent edge. The wash comes from
`--vg-row-selected-bg`, the edge from `--vg-row-selected-edge`, painted per
bundle so a block selection costs one extra `fillRect`, not one per row.

The side-bar tab's active marker moved off `--vg-focus-ring-color` for the
same reason: focus and selection are different states, and borrowing one
colour for both meant neither could be read.

## Aggregation in the header

`sum(Notional Amount)` wrapped the name, so the name was what got cut when
the column was narrow — and the closing bracket went with it, leaving
`sum(Notional Am`. The aggregate now prefixes: `SUM Notional Amount`. The
ellipsis lands at the end of the name, where it belongs.

## Kernel panels

- `.vg-side-bar-tab` was `height: auto` around a `writing-mode: vertical-rl`
  label, so a tab was as tall as its name was long (Columns 88px, Filters
  73px, Smart Edit 96px). Now a uniform 40px square on a 40px rail. The
  name is not lost — it moves to a new `.vg-side-bar-panel-header`,
  horizontal and full size, and stays on the button as its accessible name.
- Band header, field label and row now share one 16px left edge; they sat
  on three (10px / 26px / 16px).
- The row divider was `--vg-border-color` at 70% — **1.13:1**, fainter than
  the 1.18:1 already flagged as invisible.
- Panel controls join the 28px rung; `select` 130→140px min, number input
  72→80px. Same changes mirrored in `customizer/styles.ts`, which is a
  deliberate clone of these rules.

## Chrome surfaces

**Toolbars.** Six of eleven segments were `seg('')` — Target, Borders,
Number, Icons, Column and Clear were separated by a divider and nothing
else. All eleven are now named on the one eyebrow spec. One edge rule: a
28px control that *opens* something carries a `--vg-line-control` border,
one that *acts* immediately carries none. The ribbon deck's name moved from
under its controls to an inline eyebrow.

**Filter pills.** An unapplied pill was drawn with a full accent *border*
and an applied one with an accent *fill* — accent means "on" everywhere
else, so six saved filters read as six applied ones. A saved pill is now a
plain `--vg-line-control` control at 28px with a 2px radius (matching the
group-by chip, the same kind of object); accent appears only on pills that
are changing what you see. Rename / delete / edit-JSON were `display: none`
until hover, then three 16px targets inside a 22px pill; they are now
always laid out at 20px, quiet until hover or focus-within.

**Data provider.** Manage dropped to the quiet rung, so the rungs rank by
what an action costs to undo. The live connection state moved above the
controls, the two sentences of hint became one clause plus tooltips, and
the status strip gained the transport chip.

## The customizer drawer

Reported as "very busy, and very traditional". Measured on Columns →
Column Settings, both were literally true.

**Five navigation devices reporting two facts.** "You are in Columns" was
said by the active category tab, by the breadcrumb's first half, and via
the module by the title; "you are on Column Settings" by the title, the
breadcrumb's second half, and the active subnav tab. The tabs stay — they
are how you navigate. The breadcrumb only reported them (its own CSS
comment conceded this: an earlier pass demoted it to "a quiet trail"
rather than removing it), and the `CUSTOMIZE` eyebrow named the drawer you
had just opened. Both gone; the header drops from a stacked two-line block
to one 44px line.

**The same field, twice, eight rows apart.** The pane's title input and the
Header band's "Caption" row were two `<input>`s bound to one
`d.headerName`, each writing the other's value back. The band's other row
was a read-only "Col id" repeating the `COL ID` chip directly above it.
With both removed the Header band had nothing left, so it went too.

**Chips that were loudest on the most ordinary column.** Five chips, three
of which reported a default — `DIRTY —`, `HIDDEN NO`, `FX OFF`. A state
chip earns its place by being an exception, so `Col id` (identity) always
shows and the rest appear only when the column actually differs. Typical
case: five chips down to two.

**Sixteen horizontal rules for twelve fields.** Every row carried a bottom
divider and every section a filled bar with its own rule underneath — the
grammar of a properties dialog, where lines do the grouping because
nothing else does. The control column already sits on one vertical edge,
so the dividers went and the band heads lost their fill; sections are
separated by space. Applied in `vguiRowCss` (the shared generator, which
also feeds the data-provider editor) and followed through in its two
deliberate clones, `.vg-settings-row` and the customizer's `rowStyles`.

Net on that one pane: 1 nav device, 1 header line, 1 band, 2 duplicate
fields, 3 chips and ~16 rules removed — and `VALUE GETTER` now fits on
screen without scrolling.

---

## Still deferred

**1. Three bands into two.** The design folds the editing and formatting
strips into one context strip that changes with the selection — 116px of
chrome down to 80px. This is `ext-chrome-deferred-work.md` item 1: it
restructures how `ribbon.ts` mounts and changes overflow behaviour, and it
needs its product question answered first. Not started.

**2. The provider editor as an in-app sheet.** Connection, fields and
columns are authored in a `window.open` popout with no theme, no row count
and no view of the grid it configures; when it is blocked, the panel's
whole response is one line of hint text. Replacing it with an in-app sheet
(frame 08 on the canvas) is a new authoring surface plus catalog wiring —
a build of its own, not a styling change.

**3. The aggregation eyebrow as a separate run.** `SUM` currently prefixes
the header as part of the same text run. Drawing it as a smaller, muted
run needs the header renderer's caption pipeline reworked — ellipsis
measurement, the pivot caret's position, the wrap path and the raster-cache
key all read the caption as one string. The substantive fix (the name
survives truncation) shipped; the typographic half did not.

---

## Verification

- `tsc --noEmit` clean on kernel and ext (one pre-existing `titleBar.ts`
  error in HEAD, unrelated).
- ext: 741/741.
- kernel: 4,642 passing. Remaining reds are 5 failures that also fail on
  clean HEAD and a set of perf-budget tests that pass in isolation.
- `audit:ext-chrome`: **0 violations across 1,380 controls on 17 surfaces.**
- New regression locks: `flashDirection.test.ts` (9), `selectionEdge.test.ts`
  (6), plus the updated `byRows` lattice tests.
