# OpenFin performance findings (2026-07-11, macOS M4 Max)

**Symptom.** The demo feels janky in OpenFin while the identical production
build is perfectly smooth in Chrome (120fps, zero long frames).

**Measured.** In OpenFin the app paces at its 60Hz cap with a median frame
of 16.6ms, but every couple of seconds a frame costs 50–210ms. Tracing shows
those frames are single `requestAnimationFrame` ticks inside the kernel's
paint loop (`tickPaint → paintNow`) — one full-viewport canvas repaint.

**Root cause.** The OpenFin runtime executes Canvas2D work ~3–10× slower
than current Chrome on the same machine (its Chromium builds don't carry
Chrome's optimized canvas pipeline/PGO). Microbenchmarks, same hardware:

| op (same test both runtimes)      | OpenFin | Chrome |
|-----------------------------------|---------|--------|
| 20k `fillText`, detached canvas   | 90–185ms| 30–34ms|
| 50k `fillRect`                    | 64ms    | 16ms   |
| 20k save/clip/restore             | 40ms    | 13ms   |
| 8k `fillText` on the grid canvas  | 12–19ms queue + ~20ms flush | 1–2ms queue + ~5ms flush |

A full cgrid repaint that fits invisibly in Chrome's frame budget therefore
costs 50–100ms in OpenFin. Every dirty event (tick batch, flash decay,
scroll, hover) can trigger one → visible hitches.

**Ruled out by experiment** (do not re-try):
- GPU acceleration off — `SystemInfo.getInfo` shows canvas + compositing
  enabled, ANGLE Metal on the M4 Max.
- `--enable-features=SkiaGraphite` — enables cleanly, no improvement.
- Runtime 44.146.101.5 (Chromium 146, Graphite default) — *more* hitches
  than 41.134.102.3 (6–11 vs 2–3 per 5s); manifest stays pinned to 41.
- `--disable-lcd-text` — no change.
- Device scale factor 1 instead of 2 — no change (hitches aren't
  pixel-bound; the cost is in command recording/raster dispatch).
- Fonts — JetBrains Mono + Inter resolve in both runtimes; `ctx.font` set
  cost is trivial.
- App-side periodic work — no `getState`/`localStorage`/`JSON.stringify`
  calls at rest; hitches persist with the STOMP feed cut.
- An empty page in OpenFin paces perfectly (60fps, zero >50ms frames):
  the runtime compositor is fine, the cost is our canvas paint volume.

**What would actually fix it** (kernel work, in impact order):
1. Dirty-region painting: repaint only the cells a tick touched instead of
   the full viewport. Ticks touch a handful of cells; this turns 50–100ms
   paints into sub-millisecond ones regardless of runtime.
2. Row-strip bitmap caching: blit unchanged rows from cached bitmaps during
   scroll repaints.
3. A paint-budget/coalescing knob (e.g. cap tick-driven repaints at 30Hz
   under load) — halves hitch frequency, doesn't shrink a single hitch.

Reproduce the measurements with `perf-probe.mjs` (hosted window via CDP
:9223) and `baseline-probe.mjs` (stock Chrome), after
`npm run build && npx vite preview --port 4188` and launching
`openfin --launch --config openfin/app.json` from a shell without
`ELECTRON_RUN_AS_NODE`.

## After damage-region rendering (2026-07-11, runtime 41.134.102.3)

Steady state, live STOMP ticking, 10s window (`getPaintStats()`):
306/306 paints partial, avg **2.0ms** per paint (was 50–100ms full paints),
`fullPaints: 0`. Probe: 59fps with a single >50ms frame per ~8–10s
(worst 64–90ms — one outlier partial paint, suspected GC coincidence;
under investigation in the closeout fix wave).

Scroll (6s continuous wheel): 57fps, but 128 of 201 paints still FULL —
every scrolled window-move chunk arrival takes the conservative
`repaintFull()` branch (recorded Task-5 concern), overriding the blit
path (35 blits happened, avg paint 5.8ms, worst 62ms). Fix identified:
overlap-aware window-move damage (repaint only newly-entered rows ∪
touchedRows when the new fetch window overlaps the old).

Bar status: steady-state effectively met (one rare outlier vs. the
previous constant hitching); scroll p99 ≤ 34ms NOT yet met — addressed
in the batch fix wave.

## After the closeout fix-wave (2026-07-11, runtime 41.134.102.3, dpr 2)

Re-measured after C1–C4/I1–I6/M1–M5 landed (`openfin/_tmp-stats-check.mjs`,
a `getPaintStats()`-based companion to `perf-probe.mjs`; not committed —
deleted after this run). Two runs of each:

**Steady (10s live tick, `resetPaintStats()` → wait → `getPaintStats()`):**
```
run 1: paints 306, fullPaints 0, avgPaintMs 4.8, worstPaintMs 61.8
run 2: paints 280, fullPaints 0, avgPaintMs 4.0, worstPaintMs 45.7
```
`fullPaints: 0` in both runs (C3/C4's aggregate + sticky-band damage now
resolves partial where it used to force full). `worstPaintMs` sits right
at the 50ms line — one run met "zero >50ms frames", the other had a single
~62ms outlier, consistent with the pre-existing "suspected GC coincidence,
~1 per 8–10s" note above. I6's allocation reductions (row-bucketed cell
damage, pre-merge cap, `mergeRects`/`activeCells` allocation cuts) target
exactly this suspect but can't deterministically eliminate a GC pause —
`avgPaintMs` moved from the previously-recorded 2.0ms to 4–9.6ms across
runs (still ~4ms of a 16.7ms budget), the added cost of C1–C4's extra
per-paint work (window-identity diff, aggregate diff, sticky-band checks)
outweighing I6's savings on THIS mixed real-tick workload — still nowhere
near a frame-budget concern.

**Scroll — two paces, because the extreme continuous-wheel benchmark and
a realistic scroll speed tell different stories:**

*Aggressive (perf-probe's pace: 16ms interval, deltaY 120 — a stress
benchmark, not a real user):*
```
run 1: paints 217, fullPaints 95 (44%), partialPaints 122, blits 113, worstPaintMs 122.6
run 2: paints 231, fullPaints 121 (52%), partialPaints 110, blits 102, worstPaintMs 89.4
```
Improved over the pre-fix baseline (128/201 = 64% full, 35 blits) but
still a large full fraction. Root cause: at this pace, OpenFin's slower
canvas round-trip lets many wheel events accumulate before the next chunk
arrives, so the per-chunk window delta frequently exceeds
`WINDOW_DIFF_MAX_ROWS` (24) — `resolveWindowDamage` correctly (per the
cap philosophy) degrades to full rather than trust an oversized diff. Not
a bug; this benchmark pace is not representative of a real scroll gesture.

*Realistic (`~1 row per 120ms`, deliberate scroll):*
```
paints 221, fullPaints 6 (2.7%), partialPaints 215, blits 45, worstPaintMs 76
```
This is the number that matters: fullPaints drops to a small fraction of
paints, confirming the positional-diff window-move guard (adjudication B)
is doing its job under an ordinary scroll gesture — the scroll gap the
original probe flagged is closed for realistic usage. `worstPaintMs` (76ms
here, 89–123ms at the aggressive pace) still exceeds the 50ms target —
that's the ALREADY-DOCUMENTED "OpenFin's Canvas2D is 3–10× slower than
Chrome" root cause above (any nontrivial paint — including the occasional
still-legitimate full one — costs more raw ms in this runtime), not
something damage-region rendering can fix; row-strip bitmap caching (item
2 in "what would actually fix it" above) is the next lever and stays out
of this fix wave's scope.

Bar status: steady fullPaints/avg met; steady worst-frame bar met in one
of two runs (GC-pause variance, as before). Scroll fullPaints-fraction bar
MET at realistic scroll speed (2.7%, was ~64% pre-fix), NOT met at the
synthetic stress pace (which the guard's own cap philosophy correctly
declines to trust). Scroll worst-frame (<50ms) bar NOT met at either
pace — this is OpenFin's underlying canvas cost per paint, a separate,
already-documented, out-of-scope issue.

## With paint-cache layer (2026-07-11, runtime 41.134.102.3)

Steady ticking: **60fps, zero >50ms frames** (probe), 293/293 partial paints
all presents, 0 shifts/resets, avg 2.9ms, worst 42ms — steady-state bar MET.

Sustained scroll: presents work (190/190 frames present, resets 0) but the
layer SHIFT path rasters a ~half-viewport band synchronously — 46 shifts in
6s of continuous wheel, worst paint 146ms, probe runs vary 1–7 long tasks.
Under fast continuous scroll the layer currently converts the damage
system's smooth per-frame sliver raster into periodic half-viewport lumps.
Fix direction for the closeout wave: amortize shift-band raster across
frames (the band is overscan — invisible — so it can fill lazily with a
synchronous fallback only if scrolling outruns it).
