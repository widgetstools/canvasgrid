# Perspective look & feel — Grid-surface polish (em-dash nulls + header/states) — design spec

**Date:** 2026-07-06
**Status:** Approved design; ready for implementation planning
**Branch:** `feature/look-and-feel`
**Surface #2 of the holistic Perspective refresh** (Foundation #1 `15b2f63`, data-viz #3 `cacd74f`/`4906269` shipped).

## 1. Summary & context

Refine the grid data surface toward Perspective. Exploration shows the header
muting + hover/selection/focus states were largely delivered by the Foundation
theme tokens; the one real gap is **empty/null cell display**. So surface #2's
substantive deliverable is **em-dash nulls**, with light header-rhythm and
state tuning on top of the Foundation.

- **A — Em-dash nulls (feature, kernel):** null/empty **data** cells render a
  muted `–` (en-dash), like Perspective. `numberCell`/`textCell` have no null
  handling today (empty → blank); the **totals** renderer already paints a muted
  `–` in `emptyFg` (`totals.ts:69`) — thread that pattern to data cells.
- **B — Header rhythm (polish):** refine group/leaf header alignment + breathing
  room; tuned live.
- **C — States (verify + tune):** confirm hover/selection/focus read well from
  the Foundation tokens; minor live tuning.

## 2. Part A — em-dash nulls (kernel)

### 2.1 Theme token + cssReader

Add `--cg-empty-fg` (muted grey) to the theme token set. The Perspective theme
declares it (dark `#565e6a`, light a light-bg muted grey); other themes fall
back. `cssReader.ts` resolves it into `ResolvedTheme.emptyFg` (mirroring the
`flashFromColor`/`posColor` pattern; fallback to the existing `totalsFgMuted`
value so themes without the token still get a sensible muted null color).

### 2.2 Thread `emptyFg` to DATA cells

`CellPaintConfig.emptyFg` already exists (totals/group-footer set it via
`theme.totalsFgMuted` in `applyCellProps`). Extend `applyCellProps` to set
`target.emptyFg = theme.emptyFg` for **data** cells too (not only totals), so
the number/text renderers can read it.

### 2.3 Empty display in `numberCell` / `textCell`

Both renderers: when the cell value is "empty" (null / undefined / `''`, i.e.
`valueFormatted` is empty and the raw value is nullish) AND a non-empty
`emptyCellText` is configured, paint that glyph in `emptyFg` (fallback `p.fg`)
instead of nothing — mirroring `totals.ts`. New construction/runtime grid option
`emptyCellText?: string`, threaded to the cell config like other options.
**Default `undefined` → blank (current behavior; existing quartz/starui consumers
unchanged).** The demo opts in with `emptyCellText: '–'` (en-dash). Non-empty
cells are unchanged.

The `@cgrid/renderers` numeric painters already render `p.valueFormatted` for
their value; they inherit the kernel default for truly-null cells (out of scope
here — the curated data-viz columns rarely go null). This spec covers the
kernel's built-in `numberCell`/`textCell` (the default path for most columns).

## 3. Part B — header rhythm (polish, live-tuned)

Small refinements in the header paint path (`renderer/painters/byRows.ts` header
branch) + tokens: center group-header labels over their span; give the muted
uppercase mono leaf labels a touch more vertical breathing room; keep the
hairline group/leaf separators. Exact spacing/alignment values are tuned live
against the Perspective reference (like the Foundation palette). No new header
feature — alignment/spacing only.

## 4. Part C — states (verify + tune)

Confirm the Foundation tokens read well: `--cg-row-hover-bg` (whisper),
`--cg-row-selected-bg` (cool-blue), `--cg-focus-ring-color` (blue). Tune the
exact values live if a state reads too strong/weak. No structural change.

## 5. Testing

- **Unit (kernel):** `numberCell` and `textCell` — with `emptyCellText: '–'`
  set, a null/empty value draws `–` in `emptyFg` (fake `Gc` capturing the drawn
  text + fillStyle); with `emptyCellText` unset (default), a null/empty value
  draws nothing (unchanged); a non-empty value always draws the real value in
  the normal fg.
- **Unit (kernel):** `cssReader` resolves `--cg-empty-fg` into
  `ResolvedTheme.emptyFg` (fallback when absent).
- **Browser-verify (controller):** empty cells show a muted `–`; header rhythm +
  hover/selection/focus read well; light + dark; tune live. Reset state + kill
  browser/server after.

## 6. Out of scope

- Surface #4 (chrome) — its own spec.
- Empty display for the `@cgrid/renderers` custom painters (the curated data-viz
  columns) — this spec covers the kernel default `numberCell`/`textCell` path.
- Any change to the vendored `starui` / default `quartz` themes or to existing
  consumers' null display — the em-dash is **opt-in** via `emptyCellText`
  (default `undefined` = blank, unchanged); only the demo sets `'–'`. The
  `--cg-empty-fg` token just supplies the muted color when a grid opts in.
- Restructuring the header paint path — Part B is alignment/spacing only.
