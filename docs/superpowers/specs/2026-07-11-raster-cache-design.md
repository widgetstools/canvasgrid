# Raster Cache — Design (Cycle 22)

**Date:** 2026-07-11
**Status:** Implemented (Tasks 0–5 on `cycle22/raster-cache`) — bars measured 2026-07-11: Bar 3 (stats attribution) MET; Bars 1–2 NOT MET on the letter under a loaded shared host (kernel-attributed scroll avg improved ~2–4x on-vs-off in-session; worst-frame numbers sat inside the measured 64–201ms external-stall envelope; Chrome `--disable-gpu` reference meets both software-raster bars outright). Quiet-machine re-measure 2026-07-12 (post-closeout main) FINAL: Bar 2 steady clause **MET** (cache-on worst 37.4/37.9ms, zero >50ms paint frames, vs same-session off arm breaching at 72.5/108ms); Bar 1 and Bar 2's scroll absolute clause **NOT MET, final** — 82–218ms scroll worsts persist even inside demonstrably quiet windows (steady 60fps/zero longtasks in the same session), attributed to the stress-pace oversized-window-diff full paints the damage system deliberately degrades to on OpenFin's slow canvas, not to quietness or the cache. Drain budget kept at `BUDGET_MS = 3`. Full matrix + adjudication: `apps/cgrid-ext-demo/openfin/PERF-NOTES.md` "Raster-cache re-measure". Closeout review COMPLETE 2026-07-12 (verdict: ready to merge) — 2 Critical + 4 Important + 5 Minor findings all fixed/dispositioned in one fix wave plus two adjudicated follow-ons (N-1 cross-column patch bail `f3ca5d8`, format-program patch bail `6757c68`); accepted residuals + the `usesRowFields` follow-up are documented in this spec's notes. Also fixed en route (user-reported, pre-existing): horizontal-scroll damage race (`929aefe`).
**Branch:** `cycle22/raster-cache` (based on the paint-cache tip, `75c7899`; that work is not yet on `main`)

## Problem

The damage-region and paint-cache cycles removed whole-viewport repaints: rest
frames are present-only blits, ticks repaint only damaged cells, and scroll
self-blits the retained layer, painting only newly exposed bands (amortized at
`BUDGET_MS: 3`). What remains is the cost of the paint calls themselves. On
OpenFin, every Canvas2D op pays a 3–10x command-recording/dispatch tax
(`apps/cgrid-ext-demo/openfin/PERF-NOTES.md`: 8k `fillText` = 12–19ms queue +
~20ms flush vs 1–2ms + ~5ms in Chrome), and the paint-cache closeout left one
bar unmet — **sustained-scroll worst frame <50ms** (best observed 94–97ms) —
explicitly bounded by per-op cost of drain and sync-fill band paints. All cell
text still goes through live `fillText` in the kernel cell renderers.

A second regime matters independently: true software rasterization (GPU fully
disabled — locked-down VDI/Citrix bank desktops, `--disable-gpu` fleets). There
the cost model shifts from per-op dispatch to glyph shaping + rasterization per
`fillText`. cgrid must stay fast in both regimes.

## Decisions locked (user, 2026-07-11)

1. **Software raster is an explicit supported target** — its own benchmark arm
   and its own acceptance bar, not measure-only.
2. **The task-zero benchmark picks the implementation winner(s) per regime** —
   no re-planning pause; hybrid outcomes are legal (e.g. digit atlas composing
   into cell bitmaps under software raster, row-strip presentation on OpenFin).
3. **This cycle formally owns the OpenFin sustained-scroll <50ms bar** left
   open by the paint-cache cycle, and closes the open drain-budget decision.

## Design

### Task zero — grain benchmark (the decision gate)

A benchmark mode in `apps/cgrid-ext-demo` renders the same ~40-column ×
viewport-height window three ways:

- **(a) `fillText` baseline** — the current kernel path, unmodified.
- **(b) Per-glyph atlas** — digits + minus/decimal/comma + common ASCII
  pre-rastered once per (font, size, color-class, dpr) to an offscreen atlas;
  cells drawn as one `drawImage` per glyph.
- **(c) Content-bitmap blits** — whole formatted cell strings pre-rendered to
  small offscreen bitmaps, presented as one `drawImage` per cell, plus a
  row-strip variant (one `drawImage` per row).

Each mode runs under: real OpenFin (GPU on — the per-op dispatch regime),
forced software raster (`--disable-gpu`, matching a VDI/locked-down profile),
and stock Chrome as control. Driven by the existing `perf-probe.mjs` CDP
harness; measures per-frame paint cost for the steady-ticking and
sustained-scroll phases used in prior cycles.

**Output:** a decision matrix appended to PERF-NOTES locking the cache grain
per regime, and the numeric baseline that finalizes the software-raster bar.
Prediction to test: (c) < (a) < (b) on OpenFin (per-op tax penalizes the
~10x op multiplication of per-glyph blits); (c) ≈ (b) < (a) under software
raster.

### Cache architecture — two tiers, kernel-intrinsic

New module `packages/kernel/src/renderer/rasterCache/`, composing with — not
replacing — the shipped damage ledger and paint-cache layer. Band paints
(drain, sync-fill, fresh scroll bands, full paints) consume Tier 2 first, then
Tier 1, then fall through to the live cell renderers.

**Tier 1 — content bitmap cache (cell-level).**
- Key: (renderer id, formatted text, style signature, cell w×h, dpr, theme
  epoch). Value: offscreen bitmap of the rendered cell content.
- Content-keyed ⇒ data changes need **no invalidation** — a new value is a
  different key. Reclamation is pure LRU under a byte budget.
- Wins on never-painted rows: blotter cells repeat (value, format, style)
  heavily across rows (sides, symbols, badges, price formats).

**Tier 2 — row-strip cache.**
- Key: (row id, row data version, column-layout epoch). Value: the row's
  rendered strip.
- Retains strips beyond the paint-cache layer's overscan coverage, so
  re-approaching vacated rows — the exact alternating-direction pattern that
  drives the measured ~2:1 sync-fill:shift ratio — becomes one blit per row.
- A ticked cell **patches its strip in place** — repaint one cell region into
  the cached strip via the damage ledger, then advance the entry's stored data
  version — rather than discarding the strip. (The data version in the key is
  a staleness check on lookup, not an immutability guarantee: patching updates
  bitmap and version together, so a lookup never sees a stale strip.)

Selection and hover stay out of both keys: they are painted by the separate
overlay painters (`overlayPainter`, `rangeOverlayPainter`), so cached content
is state-free.

If task zero's matrix demands it, the hybrid slot is Tier 1's *fill path*:
under software raster, high-entropy numeric strings may be composed from a
digit atlas *into* the cell bitmap (rasterize-once amortization) while the
presented op count stays one `drawImage` per cell. The tier structure and
presentation path do not change with the grain choice.

### Options & invalidation

Mirrors the `paintCache` framing (perf escape hatch, not a display setting):

- `rasterCache?: boolean` — default **on**.
- `rasterCacheBudgetMB?: number` — Tier 1 + Tier 2 combined byte budget,
  default ~48MB (validated in task-zero/implementation; LRU across both tiers).

Theme change, dpr change, column resize/reorder/visibility change → epoch
bumps (logical whole-cache invalidation, no scanning). Row data version comes
from the existing tick/damage bookkeeping.

**Fractional-dpr adjudication (closeout I-2, BINDING):** at non-integer
`devicePixelRatio` (Windows 125%/150% scaling → 1.25/1.5), Tier-1 hit blits
would resample (CSS-px dest rect → fractional device origin) and the strip
*patch* would land sub-pixel-shifted vs the live raster — neither is
byte-identical, and the invariance harness only runs dpr 1 and 2. Per the
ambiguous-cases-bypass constraint: `getRasterCellsCtx()` returns `null` when
`dpr` is non-integer (Tier 1 fully dormant), and the cell-damage path never
patches at non-integer dpr (`applyStripCellDamage` drops the strip instead;
versions keep tracking). Strip **capture/consume stay enabled at any dpr** —
they are pure integer-device-px copies of the layer's own raster,
round-tripped through the same rounding, and cannot diverge. A future
refinement may re-enable Tier 1 with device-snapped bounds if the perf is
ever needed there.

**Patch-on-tick production status (closeout I-3, adjudicated by an
instrumented live-feed run 2026-07-12):** `stripPatches = 0` in production
had TWO causes, neither of them the suspected fractional flex widths (the
`fracColGeom` probe never fired on the live feed). (1) Wiring: the only
caller of the patch path was the flash-fade rAF loop — the tick itself (the
worker's diff-armed chunk reply) resolves to row-level damage and never
attempted a patch. Fixed: `handleViewportChunk` now derives the tick's
cell-granular damage from the chunk's `flashMask` (the worker's per-cell
diff) and patches retained strips ONCE per tick, AFTER `repaintRows` has
bumped the touched rows, so the patched strip is current at the row's final
post-tick version. (2) Bail: the patch bailed on `typeof def.cellIcon ===
'function'` — but format-compiled columns synthesize that fn on EVERY def
(it returns null unless the format carries an `icon()`), so every ticking
numeric column killed its row's patch on first tick (probe evidence:
`cellIcon` bail ×8/25s, sample col `marketValue`; then `noStrip` ×1950 as
the fade loop found the dropped strip). Fixed: the bail now uses byRows'
exact drawability decision (`resolveDrawableCellIcon`, one shared helper so
the two sites cannot drift).

Known remaining bail (kept, conservative): a tick whose damaged span set
includes a band's LAST column (its right edge is a band-boundary line, not
the interior gridline the patch reproduces) still drops the strip. On the
ext-demo live feed every tick touches `dv01` (the rightmost center-band
column), so committed patches are 0 THERE by layout; the kernel suite locks
the patch path for ticks that avoid band-final columns. To keep bailed rows
from staying permanently cold (flash blocks capture while fading, and
cell-sized fade rects can never re-capture), the flash registry now reports
row settle (`onRowsSettled`) and cgrid issues ONE row-level repaint for
settled rows whose strip is missing/stale — the resulting full-width raster
re-captures the row. Measured on the live feed (30s window, fix vs pre-fix):
`noStrip` churn 1950 → 1, `stripMisses` 408 → 86, `stripHits` 3016 → 6520,
settle re-captures observed (+20 post-boot). `stripPatches` now counts only
COMMITTED full-row patches — spans painted before a later bail never serve
a pixel and are no longer counted.

**Cross-column patch bail (closeout re-review N-1 + format-program
adjudication, BINDING):** the tick seam's damage is raw-field-granular
(flashMask = `diffRowFields` ∧ `column.field`), yet a committed patch
advances the strip to FULL-ROW validity — so `applyStripCellDamage` never
patches (drops the strip; the `onRowsSettled` recapture heals it, which Run
C measured as sufficient to sustain the Tier-2 win) while any cross-column
hazard is live: a registered calc provider with ≥1 VISIBLE calc column
(fieldless → never flagged), a rule engine with ≥1 rule (or an unknown rule
set — no `getRules`), or ANY visible column carrying a compiled format
program (string-DSL `_formatProgram` / composite `_compositeProgram`).
Format programs receive the FULL row (`FormatEvalCtxShape.row`); the
`tiers` flags cannot prove row-independence — the `=expr` value-formatter
form is tier0-flagged yet evaluates against the row — so per the
ambiguous-cases-bypass constraint ANY compiled program bails, tier0-only
included. Consequence: on grids whose visible columns carry format strings
(the ext demo), `stripPatches` is 0 by design and the harness pins it;
patch-alive is locked kernel-side for format/rule/calc-free grids. Filed
refinement (c): a compile-time `usesRowFields` flag on `FormatProgramShape`
(precedented by `hasRuleRefs`) would let value-only programs keep
patch-on-tick (and would also let the format-eval memo's cross-paint reuse
gate on proof rather than tier flags).

**Static-data scroll wipe (closeout M-2, accepted perf ceiling):** a grid
that has never applied a transaction gets `windowDamage === 'full'` on every
scroll chunk (`touchedRows` undefined → zebra parity untrusted through the
move) → full strip wipe, so Tier 2 never warms for static-data grids under
scroll. Correctness-conservative and correct per the constraints; the
diff-armed live feed (the target workload) is unaffected. A future
refinement can use the position-identity diff to invalidate only moved rows.

**Drain-budget closure:** after the cache lands, re-evaluate the open
`BUDGET_MS: 3` decision — cached-strip drain calls cost far less per call, so
the budget's effective row throughput rises without raising the ms budget.
Decision (keep 3, or retune) recorded in PERF-NOTES with measurements.

### Correctness & testing

- **Pixel invariance is the gate** (unchanged from both prior cycles):
  `e2e/paintInvariance.spec.ts` gains rasterCache-on/off arms across the
  existing step script — scroll beyond overscan, direction flips, horizontal
  scroll, resize, live ticks. The gate is never weakened.
- Kernel unit tests: key composition, LRU eviction under byte budget, epoch
  invalidation (theme/dpr/column-layout), strip patch-on-tick, DPR seams
  (device-px vs CSS-px, the C1-class seam family), `rasterCache: false`
  legacy-path integrity.
- Full E2E run before "done" (hard gate), then an OpenFin re-measure appended
  to PERF-NOTES.

### Acceptance bars

1. **OpenFin (GPU on): sustained-scroll worst frame <50ms** with the raster
   cache on, measured via perf-probe + `getPaintStats()` — the bar the
   paint-cache cycle left open, now owned here.
2. **Software raster (`--disable-gpu`): bar finalized from task zero's
   baseline** — proposed shape: steady ticking holds 60fps with zero >50ms
   frames, sustained scroll beats the measured fillText-baseline worst by ≥2x
   and stays under the same 50ms ceiling; exact numbers locked when task zero
   reports.
3. `getPaintStats()` extended with cache counters (tier hits/misses, bytes,
   evictions, strip patches) so the bars are attributable, not just wall-clock.

## Execution shape

Fresh branch off the paint-cache tip (done: `cycle22/raster-cache`). SDD with
task zero first (benchmark + decision matrix), then implementation tasks, one
batch closeout review + one fix wave. The `cgridext/cursor-theme` WIP
(`.superpowers/sdd/progress.md`) is stashed as
"cursor-theme WIP: sdd progress.md (pre raster-cache branch)".
