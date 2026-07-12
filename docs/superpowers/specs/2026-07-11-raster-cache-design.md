# Raster Cache — Design (Cycle 22)

**Date:** 2026-07-11
**Status:** Implemented (Tasks 0–5 on `cycle22/raster-cache`) — bars measured 2026-07-11: Bar 3 (stats attribution) MET; Bars 1–2 NOT MET on the letter under a loaded shared host (kernel-attributed scroll avg improved ~2–4x on-vs-off in-session; worst-frame numbers sat inside the measured 64–201ms external-stall envelope; Chrome `--disable-gpu` reference meets both software-raster bars outright). Drain budget kept at `BUDGET_MS = 3`. Full matrix + adjudication: `apps/cgrid-ext-demo/openfin/PERF-NOTES.md` "Raster-cache re-measure". Closeout review pending.
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
