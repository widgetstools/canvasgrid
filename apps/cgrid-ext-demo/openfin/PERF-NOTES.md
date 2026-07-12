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

## After the paint-cache closeout fix wave — directive B amortized drain (2026-07-11, runtime 41.134.102.3, dpr 2)

Re-measured after C-1/I-1..I-4/directive-B/M-1/M-3/M-4 landed. `perf-probe.mjs`
(raw FPS + `PerformanceObserver('longtask')`) plus a companion
`_tmp-stats-check.mjs` (`getPaintStats()` directly — not committed, deleted
after this run, same convention as the prior closeout's own tmp script).

**Kernel-level behavior (the part directive B actually controls) — confirmed
correct:** across every stats-check run, `layerResets: 0` and
`layerBacklogPx: 0` at read time in BOTH phases — the layer never stale-resets
during steady vertical presentation, and the budgeted drain always fully
converges the pending backlog before the next read (the "a settled grid must
have zero pending" invariant directive B.3 exists to guarantee — this is the
same invariant `tests/rendererPaintCache.test.ts`'s new regression lock checks
deterministically at the kernel level, where there's no host-machine noise).
`presents === paints` in both phases (every cache-on frame still presents by
blit, never skipped). The old "one shift = one ~half-viewport synchronous
lump" class of stall (146ms worst, pre-fix-wave) is gone — no single frame's
cost is dominated by one big monolithic raster anymore; work is now spread
across a present-safety sync-fill (bounded to the visible range ± 1 row) and
a ~3ms-budgeted background drain.

**Stats pass** (reset → 8s live ticking → read; reset → 100 wheel steps @16ms
→ read):
```
steady: paints 306, fullPaints 0, partialPaints 306, presents 306,
        layerShifts 0, layerResets 0, layerSyncFills 0, layerBacklogPx 0,
        avgPaintMs 3.9, worstPaintMs 125.8
scroll: paints 128, fullPaints 71, partialPaints 57, presents 128,
        layerShifts 44, layerResets 0, layerSyncFills 89, layerBacklogPx 0,
        avgPaintMs 10.4, worstPaintMs 94.2
```
A repeat stats-check ~30s later (same build, no code change) measured
steady `worstPaintMs` 75.5 / avgPaintMs 9.0 and scroll `worstPaintMs` 96.5 /
`layerSyncFills` 86 — consistent with the run above on every count except
the exact `worstPaintMs` outlier magnitude, which moved around run to run
(see "not fully met" discussion below).

**Two measured `perf-probe.mjs` runs** (raw FPS + browser longtask API):
```
run 1: steady fps 57, longTasks 2, worst 113ms | scroll fps 46, longTasks 10, worst 122ms
run 2: steady fps 56, longTasks 5, worst 122ms | scroll fps 50, longTasks 7,  worst 113ms
```
A THIRD, earlier pair taken immediately after the very first fresh OpenFin
launch this session (before ~30 minutes of this same session's own heavy
kernel-test/build/playwright activity had accumulated on the shared
machine) measured steady fps 60/worst 0ms and fps 59/worst 51ms, scroll
worst 138ms and 97ms — i.e. the STEADY bar (zero >50ms frames) was cleanly
met on that first pair, and scroll worst was noticeably better (97–138ms
vs 113–122ms later).

**Bar status — honest accounting, not fully met, with root-cause evidence:**
- Steady "zero >50ms frames": met on the first (quietest) measurement pair;
  NOT met on the two official runs above or the repeat stats-check. The
  kernel-level evidence rules out a paint-cache regression as the cause: the
  steady phase's own stats show `layerShifts: 0, layerResets: 0,
  layerSyncFills: 0` throughout — a present-only frame is architecturally
  just one `drawImage` + a tiny/no chrome raster, so a 75–126ms stall on
  such a frame cannot be the retained layer doing extra work; it has none to
  do. `vm_stat`/`top` at the time showed ~15GB of memory COMPRESSED (of 34GB
  used) on this shared dev machine with heavy concurrent load from this same
  session's own test/build runs — a plausible external stall (page
  decompression, GC pause in a neighboring process, OS scheduling) landing
  on the sampled frame, consistent with PERF-NOTES' own pre-existing
  "OpenFin/Canvas2D 3–10x slower + occasional 50–210ms frames even on
  isolated microbenchmarks" finding at the top of this file (unrelated to
  cgrid's own code). A deliberate re-test attempt at `BUDGET_MS: 6` (vs the
  shipped `3`) made both phases WORSE (steady worst 190ms, scroll worst
  225ms) and was reverted — larger per-drain-call chunks cost more
  synchronous time per call on OpenFin's slower canvas, so a bigger budget
  is the wrong lever here; `3` (as specified) stays.
- Scroll "worst <50ms": NOT met in any run (best observed: 94–97ms via
  stats, 97–138ms via probe) — worse than the steady bar's noise floor
  would predict alone, but still a real, measured improvement over the
  pre-fix-wave 146ms lump, and no longer dominated by one single mechanism
  (the cost is now spread across sync-fills + drain calls, each doing much
  less than the old monolithic shift-raster).
- "`layerSyncFills` small relative to `layerShifts`": NOT met — observed
  ratio is roughly 2:1 (86–105 sync-fills against 42–48 shifts across
  three stats-check runs), not "small". Root cause: `perf-probe.mjs`'s
  scroll benchmark (continuous wheel every 16ms, alternating direction
  every 40 sends) is the SAME synthetic stress pace already flagged
  earlier in this file as exceeding `WINDOW_DIFF_MAX_ROWS` and forcing an
  outsized full-paint fraction (44–57% here, vs the 2.7% measured at a
  "realistic ~1 row per 120ms" pace) — under continuous scrolling this
  fast, the viewport re-approaches a just-shifted layer edge before the
  lazy budgeted drain can get ahead of it, so the present-safety sync-fill
  (which is DESIGNED to be the correctness fallback precisely for "scroll
  outran the budget") legitimately fires often. This is the same category
  of finding as the pre-existing fullPaints one: a synthetic stress
  benchmark exercising the fallback path more than a realistic scroll
  gesture would, not a broken amortization scheme — `layerBacklogPx: 0` at
  every read confirms the ledger still fully converges either way.

**What would actually close the remaining gap:** the steady-bar noise is a
shared-machine/host-runtime artifact, not addressable in kernel code (see
the file's own root-cause section). The scroll-worst/syncFills gap is
bounded by OpenFin's per-canvas-op cost (each drain/sync-fill raster call,
however small, still pays the 3–10x Canvas2D tax) — the row-strip bitmap
caching lever named earlier in this file remains the next actionable step,
out of this fix wave's scope.

Kernel-level regression lock for the invariant that matters most (pending
backlog always converges to zero, deterministically, with no host-machine
noise): `packages/kernel/tests/rendererPaintCache.test.ts`, "(directive B.3
regression lock) the budgeted drain converges the pending backlog to zero
within a few subsequent paint ticks" — verified to fail when the drain's
`requestRepaint()` re-arm is disabled.

## Raster-grain benchmark — three modes × four regimes (Cycle 22 Task 0, 2026-07-11, macOS M4 Max, dpr 2)

Decision-gate benchmark for HOW the kernel raster cache rasterizes text.
Standalone page `bench/raster-grain.html` (plain canvas + TS, NO kernel
import), driven by `grain-probe.mjs`. Synthetic financial window: 40 cols ×
40 visible rows (1680×960 window, 24px rows, 12px monospace, 5 style
variants), deterministic data (mulberry32, constant seeds — no
`Date`/`Math.random` in the paint loop). Two phases per mode, full-window
repaint every frame: **scroll** (one row per frame) and **ticks** (10% of
visible cells re-generated per frame). Per regime × mode: fresh page load,
120-frame discarded warm-up per phase, 600 measured frames per phase.
Modes: `fillText` (one fillText per cell; font/fill set per style CHANGE —
current-kernel shape), `glyphAtlas` (per-char atlas: digits + `.,-+$%` +
A–Z per style; one drawImage per glyph, pen snapped to the device grid),
`cellBlit` (per-cell bitmaps, LRU 4096 keyed style+string, rasterized on
miss into a scratch canvas; one drawImage per cell), `cellBlit+strips`
(same cell LRU + row strip canvases, LRU 128; one drawImage per ROW).
LRU sizes/geometry identical across modes — only raster strategy differs.

Measurement notes, recorded honestly:
- Evicted cell/strip bitmaps are RECYCLED through a pool. Without pooling,
  Chrome measured 100–250ms GC/allocation hitches that swamped the raster
  signal — a kernel implementation would pool backing stores, so leaving
  that in would have measured allocation churn, not raster grain.
- The `openfin` CLI could not launch here: its unconditional
  `fs.chmod(runtimeBinary, 0o755)` (openfin-adapter `nix-launch.js`) gets
  EPERM from macOS on the app bundle in this session's process context
  (binary already 0755). Worked around by spawning the SAME pinned runtime
  directly — `env -u ELECTRON_RUN_AS_NODE ~/OpenFin/Runtime/41.134.102.3/
  OpenFin.app/Contents/MacOS/OpenFin --startup-url=<manifest>
  --remote-debugging-port=9223 [--disable-gpu]` — exactly what the CLI
  spawns after its chmod. Same runtime 41.134.102.3, same manifests
  (`app-bench.json`, `app-bench-swraster.json`).
- OpenFin regimes: after each fresh launch, one FULL probe run was
  discarded as launch warm-up; the second run is recorded below (the
  discarded runs agreed with the recorded ones on every ranking).
- `--disable-gpu` verified effective by signature: glyphAtlas p50 jumps
  6.3→19.4ms (OpenFin) / 1.7→12.5ms (Chrome) when the flag is on.
- Chrome regimes ran at this display's 120Hz (frame deltas ~8.3–9.5ms);
  OpenFin paces 60Hz (~17.7ms). Paint times are comparable; frame pacing
  is not. Occasional 33–34ms frame deltas in OpenFin cells are single
  dropped 60Hz frames, not >50ms stalls.
- Shared dev machine; the file's standing host-noise caveat (rare external
  50–210ms stalls) applies, but every recorded cell below measured
  longFrames = 0. Isolated worst-paint outliers in cellBlit/strips ticks
  cells (11–23ms vs p95 ~2–4ms) recurred across regimes — the tick phase
  rasterizes ~160 new cell bitmaps per frame, so occasional spikes are
  real cache-miss cost, and p50/p95 are the stable comparators.

#### chrome (dpr 2, 600 frames/phase, 120-frame warm-up discarded)

| mode | phase | paint p50 (ms) | paint p95 (ms) | paint worst (ms) | frame worst (ms) | frames >50ms |
|------|-------|---------------:|---------------:|-----------------:|-----------------:|-------------:|
| fillText | scroll | 0.9 | 1.1 | 1.3 | 9.5 | 0 |
| fillText | ticks | 1.0 | 1.4 | 2.2 | 9.4 | 0 |
| glyphAtlas | scroll | 1.7 | 1.8 | 2.1 | 9.4 | 0 |
| glyphAtlas | ticks | 1.7 | 1.8 | 2.1 | 9.4 | 0 |
| cellBlit | scroll | 2.0 | 2.2 | 5.8 | 16.6 | 0 |
| cellBlit | ticks | 2.5 | 2.8 | 7.9 | 17.6 | 0 |
| cellBlit+strips | scroll | 0.8 | 1.0 | 1.4 | 9.4 | 0 |
| cellBlit+strips | ticks | 1.3 | 1.5 | 14.3 | 16.8 | 0 |

#### chrome --disable-gpu (dpr 2, 600 frames/phase, 120-frame warm-up discarded)

| mode | phase | paint p50 (ms) | paint p95 (ms) | paint worst (ms) | frame worst (ms) | frames >50ms |
|------|-------|---------------:|---------------:|-----------------:|-----------------:|-------------:|
| fillText | scroll | 0.7 | 0.8 | 1.1 | 9.3 | 0 |
| fillText | ticks | 0.8 | 1.0 | 1.6 | 9.3 | 0 |
| glyphAtlas | scroll | 12.5 | 12.8 | 14.0 | 17.5 | 0 |
| glyphAtlas | ticks | 12.6 | 13.0 | 14.2 | 17.8 | 0 |
| cellBlit | scroll | 2.2 | 2.4 | 8.1 | 16.7 | 0 |
| cellBlit | ticks | 2.5 | 2.7 | 7.3 | 9.4 | 0 |
| cellBlit+strips | scroll | 0.5 | 0.7 | 1.1 | 9.4 | 0 |
| cellBlit+strips | ticks | 1.6 | 1.8 | 12.6 | 9.4 | 0 |

#### openfin (runtime 41.134.102.3, dpr 2, 600 frames/phase, 120-frame warm-up discarded, second full run after launch)

| mode | phase | paint p50 (ms) | paint p95 (ms) | paint worst (ms) | frame worst (ms) | frames >50ms |
|------|-------|---------------:|---------------:|-----------------:|-----------------:|-------------:|
| fillText | scroll | 4.5 | 5.1 | 7.2 | 17.8 | 0 |
| fillText | ticks | 4.4 | 4.8 | 6.5 | 17.7 | 0 |
| glyphAtlas | scroll | 6.3 | 6.5 | 8.5 | 17.7 | 0 |
| glyphAtlas | ticks | 6.3 | 6.5 | 6.9 | 17.7 | 0 |
| cellBlit | scroll | 2.7 | 3.0 | 4.7 | 17.7 | 0 |
| cellBlit | ticks | 3.6 | 4.1 | 15.0 | 33.4 | 0 |
| cellBlit+strips | scroll | 0.8 | 1.9 | 10.6 | 17.6 | 0 |
| cellBlit+strips | ticks | 2.2 | 2.6 | 23.1 | 17.6 | 0 |

#### openfin --disable-gpu (runtime 41.134.102.3, dpr 2, 600 frames/phase, 120-frame warm-up discarded, second full run after launch)

| mode | phase | paint p50 (ms) | paint p95 (ms) | paint worst (ms) | frame worst (ms) | frames >50ms |
|------|-------|---------------:|---------------:|-----------------:|-----------------:|-------------:|
| fillText | scroll | 4.8 | 5.1 | 6.6 | 17.6 | 0 |
| fillText | ticks | 4.4 | 4.8 | 5.5 | 17.5 | 0 |
| glyphAtlas | scroll | 19.4 | 19.7 | 22.0 | 34.2 | 0 |
| glyphAtlas | ticks | 19.4 | 19.8 | 21.2 | 34.3 | 0 |
| cellBlit | scroll | 3.3 | 3.6 | 3.8 | 17.7 | 0 |
| cellBlit | ticks | 3.9 | 4.2 | 11.6 | 17.7 | 0 |
| cellBlit+strips | scroll | 1.4 | 1.8 | 4.8 | 17.7 | 0 |
| cellBlit+strips | ticks | 3.2 | 3.7 | 22.6 | 17.7 | 0 |

### Grain decision (BINDING for Cycle 22)

**Per-regime winners** (p50 primary, worst secondary, both phases):
- **chrome (GPU):** fillText ≈ cellBlit+strips, tie within noise (0.8–1.3ms
  p50); every mode fits the frame budget with an order of magnitude to
  spare. Stock Chrome does not need a raster cache — this regime does not
  drive the decision.
- **chrome --disable-gpu:** cellBlit+strips (scroll 0.5) ≈ fillText (ticks
  0.8); glyphAtlas COLLAPSES to 12.5–12.6ms p50 (~16–25x behind the
  winners).
- **openfin (GPU):** cellBlit+strips wins both phases — scroll 0.8 vs
  fillText 4.5 (5.6x), ticks 2.2 vs 4.4 (2x). Plain cellBlit second.
- **openfin --disable-gpu:** cellBlit+strips wins both phases — scroll 1.4
  vs 4.8 (3.4x), ticks 3.2 vs 4.4 (1.4x). glyphAtlas is the WORST mode
  (19.4ms p50 — over the entire 60Hz frame budget on its own).

**Grain: rasterize at CELL grain, present at ROW-STRIP grain**
(cellBlit+strips). It wins or ties every regime, wins decisively in both
OpenFin regimes (the runtime this cycle exists for), and is exactly the
"row-strip bitmap caching" lever this file identified after the
damage-region work. Cache-miss raster cost (the ticks-phase worst-paint
outliers) is the tail to engineer around — bounded misses per frame, pooled
backing stores.

**Task 3b (digit-atlas fill path): OUT.** glyphAtlas wins NO regime: on GPU
it is ~2x behind fillText in Chrome and behind fillText in OpenFin; under
software raster it is catastrophically last (12.5–19.4ms p50) precisely
where a cheap fill path would matter most. Per-glyph drawImage pays per-op
overhead on ~8,000 ops/frame against 1,600 fillTexts or ~40 strip blits —
the arithmetic cannot be rescued by a digits-only variant. Do not build it.

**Software-raster bar numbers (finalized).** Regime of record:
**OpenFin --disable-gpu** (the deployment target's degraded mode;
chrome --disable-gpu is recorded as reference only, its fillText baseline
is so fast — 1.1ms worst — that a 2x-of-baseline bar there would be below
measurement noise).
- **Steady (ticks): zero paint frames >50ms.** Stands as specified, no
  adjustment — the fillText baseline worst is 5.5ms, so 50ms is not
  remotely unmeetable on principle.
- **Scroll: worst paint <50ms AND ≥2x better than the fillText baseline
  worst.** Baseline worst measured **6.6ms** → finalized bar: **worst
  paint ≤3.3ms** (the <50ms clause is then trivially implied). No
  adjustment: the baseline beats 50ms by 7.6x on its own, so the
  adjust-on-principle clause does not trigger. Meetable: strips measured
  p95 1.8ms; its single-frame worst here (4.8ms) shows ~1–3ms of
  worst-frame noise at this scale, so assess the kernel cache against
  3.3ms with the same two-run protocol used elsewhere in this file, with
  p95 as the stability check.

## Raster-cache re-measure — OpenFin GPU + software raster, on vs off (Cycle 22 Task 5, 2026-07-11, runtime 41.134.102.3, dpr 2)

Production build on `vite preview :4188`, live STOMP feed (5000 rows),
launched via the direct-spawn workaround (see the grain section above).
`perf-probe.mjs` (raw FPS + longtask API) plus a `getPaintStats()` companion
script (`_tmp-stats-check.mjs`, scratchpad convention — not committed, deleted
after this run): steady = reset → 8s live ticking → read; scroll = reset →
100 wheel steps @16ms alternating → read. Raster cache toggled by navigating
the SAME hosted window between `/` and `/?noRaster` — on/off pairs share one
OpenFin session. After every launch or navigation, one full run was discarded
as warm-up.

**Direct-spawn gotcha (new):** when the runtime binary is spawned directly,
the manifest's `runtime.arguments` are NOT applied — `--disable-gpu` must be
passed on the spawn command line itself. Verified via CDP
`SystemInfo.getInfo`: `2d_canvas: unavailable_software`,
`gpu_compositing: disabled_software` with the flag; an earlier flagless
launch against `app-swraster.json` came up GPU-on and its one probe run was
discarded as invalid. `app-swraster.json` (committed) exists for CLI-launch
parity and documents the regime.

**Host-noise observation (recorded, machine NOT quiet):** load average
7.8–9.0 for the whole session; swap 7.6/8.0GB used; ~29–32GB of pages in the
compressor; a concurrent agent session ran `chrome-devtools-mcp` at 166–168%
CPU with a Chrome renderer at 72–102%, and the user's tabular-showcase
OpenFin (43.142.104.1) renderer sat at 63–84% CPU throughout. Late
"order-reversal control" runs landed in visible noise bursts: cache-ON
re-measures degraded to OFF-like wall-clock numbers (GPU scroll 37fps/331ms
worst; sw steady avgPaintMs 16.2) while the same runs' kernel-attributed
scroll avgs stayed 4.7–4.9ms — wall-clock worsts tonight are dominated by
host stalls, not kernel work.

**Noise envelope, quantified from our own steady phases:** with the cache on,
steady frames do almost nothing (`fullPaints 0, layerShifts 0,
layerSyncFills 0`, avg 1.7–4.1ms) yet `worstPaintMs` still measured
63.7–201.4 across runs. A present-only frame has no kernel work that can
cost 60–200ms, so that range is the external-stall floor any single frame
could absorb tonight — single worst-frame numbers in BOTH phases sit inside
it.

#### OpenFin GPU — perf-probe (6s/phase, warm-up discarded)

| run | steady fps | steady longtasks (worst) | scroll fps | scroll longtasks (total / worst) |
|-----|-----------:|--------------------------:|-----------:|---------------------------------:|
| rasterON run1 | 60 | 0 (0ms) | 50 | 6 (420ms / 104ms) |
| rasterON run2 | 56 | 2 (238ms) | 55 | 4 (337ms / 169ms) |
| rasterOFF run1 | 54 | 6 (123ms) | 33 | 12 (1960ms / 401ms) |
| rasterOFF run2 | 54 | 8 (134ms) | 37 | 19 (1965ms / 377ms) |
| rasterON control (late, noise burst) | 48 | 10 (326ms) | 37 | 15 (1762ms / 331ms) |

#### OpenFin GPU — getPaintStats

| run | phase | paints | fullPaints | avgPaintMs | worstPaintMs | shifts / syncFills / backlogPx |
|-----|-------|-------:|-----------:|-----------:|-------------:|-------------------------------:|
| ON stats1 | steady | 203 | 0 | 3.67 | 81.8 | 0 / 0 / 0 |
| ON stats1 | scroll | 94 | 52 | 3.44 | 133.8 | 42 / 70 / 0 |
| ON stats2 | steady | 297 | 0 | 1.71 | 63.7 | 0 / 0 / 0 |
| ON stats2 | scroll | 104 | 56 | 2.48 | 114.9 | 37 / 70 / 0 |
| OFF stats1 | steady | 289 | 0 | 10.19 | 155.4 | 0 / 0 / 0 |
| OFF stats1 | scroll | 117 | 52 | 5.91 | 143.0 | 45 / 74 / 0 |
| OFF stats2 | steady | 227 | 0 | 3.81 | 164.9 | 0 / 0 / 0 |
| OFF stats2 | scroll | 125 | 56 | 9.27 | 162.3 | 44 / 85 / 0 |
| ON stats3 (warmed, late) | steady | 264 | 0 | 2.31 | 201.4 | 0 / 0 / 0 |
| ON stats3 (warmed, late) | scroll | 135 | 76 | 4.88 | 180.7 | 47 / 90 / 0 |

#### OpenFin --disable-gpu (software raster, verified) — perf-probe

| run | steady fps | steady longtasks (worst) | scroll fps | scroll longtasks (total / worst) |
|-----|-----------:|--------------------------:|-----------:|---------------------------------:|
| rasterON run1 | 57 | 3 (100ms) | 43 | 6 (379ms / 103ms) |
| rasterON run2 | 60 | 0 (0ms) | 41 | 10 (837ms / 225ms) |
| rasterOFF run1 | 53 | 6 (131ms) | 30 | 12 (1730ms / 331ms) |
| rasterOFF run2 | 54 | 5 (151ms) | 27 | 12 (1852ms / 334ms) |
| rasterON control (late, noise burst) | 54 | 6 (164ms) | 28 | 20 (2338ms / 360ms) |

#### OpenFin --disable-gpu — getPaintStats

| run | phase | paints | fullPaints | avgPaintMs | worstPaintMs | shifts / syncFills / backlogPx |
|-----|-------|-------:|-----------:|-----------:|-------------:|-------------------------------:|
| ON stats1 | steady | 267 | 0 | 4.06 | 108.3 | 0 / 0 / 0 |
| ON stats1 | scroll | 141 | 70 | 6.54 | 165.8 | 44 / 91 / 0 |
| ON stats2 | steady | 195 | 0 | 3.10 | 83.6 | 0 / 0 / 0 |
| ON stats2 | scroll | 149 | 64 | 3.42 | 193.2 | 46 / 85 / 0 |
| OFF stats1 | steady | 277 | 0 | 10.85 | 64.0 | 0 / 0 / 0 |
| OFF stats1 | scroll | 168 | 83 | 6.96 | 259.8 | 48 / 101 / 0 |
| OFF stats2 | steady | 247 | 0 | 3.20 | 166.3 | 0 / 0 / 0 |
| OFF stats2 | scroll | 154 | 77 | 12.86 | 153.0 | 46 / 97 / 0 |

#### Chrome --disable-gpu (reference only, single pass each, same protocol)

| arm | phase | paints | fullPaints | avgPaintMs | worstPaintMs |
|-----|-------|-------:|-----------:|-----------:|-------------:|
| rasterON | steady | 261 | 0 | 0.70 | 2.6 |
| rasterON | scroll | 136 | 24 | 0.89 | 25.4 |
| rasterOFF | steady | 325 | 0 | 1.07 | 4.2 |
| rasterOFF | scroll | 121 | 23 | 0.59 | 36.4 |

Zero >50ms paint frames in all four Chrome phases; the cache improves the
scroll worst (25.4 vs 36.4ms) with no steady regression that clears the
noise floor. Where the runtime's canvas is fast and the process dodges the
host stalls, both software-raster bars are comfortably met — evidence that
the OpenFin worst-frame outliers above are runtime/host cost, not the cache.

### Stats attribution (Bar 3) — warmed ratios

Cache-on runs, both OpenFin regimes:
- **Tier 1 (cells), steady:** `cellCacheHits` 12000–19138 per 8s window vs
  `cellCacheMisses` 33–61 — **99.7% warmed hit rate** against misses; counting
  the deliberate bypass matrix (flash decay, composite/live renderers, group
  rows), 69–82% of all cells painted in a steady window came straight off a
  cached bitmap. Scroll: hits 19023–22204 vs misses 1461–2944 (**87–93%**),
  bypasses 12337–21713.
- **Tier 2 (strips), steady:** `stripHits` 1696–3947 vs `stripMisses`
  365–1228 (**58–82%** of eligible rows served by strip blit). Scroll:
  hits 1065–2284, captures 183–241 per run (the store re-fills as new rows
  scroll in), `rasterCacheBytes` steady at 49.0–50.3MB across every read.
- **Off arm:** every raster-cache counter is exactly 0 in every `?noRaster`
  read — attribution is clean, the counters measure the mechanism and only
  the mechanism.
- The committed E2E live-tick spec printed the same shape on dev Chrome:
  cell hit ratio 91.6% (hits=3519, misses=323), strips hits=2088, misses=110.

**Observation for the closeout (no tuning done):** `stripPatches` was 0 in
every live-feed run in every regime — the Tier-2 patch-on-tick path never
fires against the real STOMP feed; tick damage shows up as `stripMisses`
(365–1228 per steady window) with only 1–10 re-captures. The kernel unit
suite and invariance arms DO exercise the patch path, so the mechanism
works — but live ticks in this demo apparently always hit a patch
ineligibility (flash decay on the ticked row is the prime suspect: flashing
cells are a Tier-1 bypass and flash-active rows are strip-ineligible).
Worth one look in the closeout: if ticked rows can re-enter strip
eligibility sooner after their flash settles, steady `stripMisses` should
drop toward zero.

### Bars adjudication (honest accounting)

- **Bar 1 — OpenFin GPU sustained-scroll worst frame <50ms (cache on):
  NOT MET on the letter.** Best recorded cache-on scroll worst: 104ms
  (probe) / 114.9ms (stats). But the same session's evidence says the
  remaining worst is not raster work: (a) the noise envelope above — steady
  present-only frames measured 63.7–201.4ms worst with zero layer/raster
  activity, so scroll worsts of 104–193ms are inside what a do-nothing frame
  absorbed tonight; (b) every kernel-attributed aggregate transformed:
  scroll avgPaintMs 10.4 (paint-cache closeout) → **2.5–3.4ms** cache-on
  (same-session off arm: 5.9–9.3ms), scroll fps 50–55 vs 33–37, total
  longtask ms 337–420 vs ~1960; (c) `layerBacklogPx: 0` at every read.
  Needs closeout adjudication + a quiet-machine re-measure; no kernel lever
  identified that a 3–10x-slower Canvas2D and a loaded host don't explain.
- **Bar 2 — software raster vs the Task-0 bars: split, NOT MET on the
  letter.** Steady "zero paint frames >50ms": not met under this host
  (worst 83.6–108.3ms, avg 3.1–4.1, fullPaints 0) — same envelope argument;
  the Chrome --disable-gpu reference meets it outright (worst 2.6ms).
  Scroll "worst ≤3.3ms (≥2x fillText baseline)": the absolute 3.3ms clause
  is structurally inapplicable to the demo — it was finalized on the bench's
  geometry (full-window repaint, no data fetch), while demo scroll includes
  ~45–55% legitimate full paints from window-move chunk arrivals. The
  clause's substance (≥2x better than the fillText baseline) is MET on
  kernel-attributed averages: cache-on scroll avg 3.42–6.54ms vs same-session
  off 6.96–12.86ms (**1.97–2.03x**), fps 41–43 vs 27–30. Recommend the
  closeout restate Bar 2 for the demo as the 2x-vs-off clause + the Chrome
  reference, and re-run the absolute clause on the bench page if wanted.
- **Bar 3 — stats attribution: MET.** Counters above demonstrate the
  mechanism end-to-end (hits dominate warmed windows, captures track
  scroll-in, byte gauge sits at budget, off arm identically zero).

### Drain-budget decision (BUDGET_MS = 3): KEEP, with numbers

`layerBacklogPx` was **0 at every single read** — 20+ reads across both
regimes, both arms, both phases, strips warmed and cold: the 3ms budgeted
drain always fully converged the pending band backlog between reads.
Strip-warmed scroll `layerRasterMs` EMA sat at 1.48–3.88ms (GPU) /
2.07–3.21ms (software raster) — the drain slice is right-sized against the
~3ms target. The prior cycle's deliberate `BUDGET_MS: 6` re-test made both
phases worse (190/225ms worsts) because bigger synchronous drain slices pay
more per call on OpenFin's slow canvas; nothing in this cycle's data
contradicts that. `BUDGET_MS = 3` (cgrid.ts) stays; no retune.

## Quiet-machine re-measure — Bars 1/2 final adjudication (2026-07-12, main post-closeout, runtime 41.134.102.3, dpr 2)

Re-run of the Task-5 protocol after the cycle's concurrent automation load
finished, from current `main` (closeout fix wave included: patch-at-tick
bails on calc/rules/format-program hazards, so `stripPatches: 0` with
captures healing is BY DESIGN). Same discipline: warm-up run discarded
after every launch/navigation, on-vs-off in the same OpenFin session,
`--disable-gpu` passed on the spawn command line and verified via
`SystemInfo.getInfo` (`2d_canvas: unavailable_software`).

**Quietness observation (recorded, mixed):** the previous session's
automation load is GONE (no chrome-devtools-mcp burn, no competing
tabular OpenFin renderer; compressor occupancy down from ~13GB to ~1GB).
Remaining: ordinary interactive desktop — load avg 6.3–7.8 at start,
WebKit WebContent at 42–63% (media), Cursor/Chrome renderers 33–47%,
WindowServer ~40%. Quiet WINDOWS clearly exist (three steady probe phases
measured 60fps with ZERO longtasks), but stall bursts still recur — and
near the end of the session a fresh user-activity burst arrived (load avg
14.2, three Chrome renderers at 112–145%), contaminating the late control
runs. Runs are annotated below. The feed server was also freshly started:
its per-window tick volume varied run-to-run (steady paints 83–300 per 8s
window), so per-run average comparisons are coarser than last session's.
One cache-on stats run caught the feed still ramping (steady paints = 10)
and was discarded as invalid.

#### OpenFin GPU — cache ON (recorded runs)

| run | steady | scroll |
|-----|--------|--------|
| probe1 | 53fps, worst 179ms (burst) | 52fps, worst 218ms |
| probe2 | 60fps, 0 longtasks | 57fps, worst 97ms |
| probe3 | 60fps, worst 51ms | 56fps, worst 82ms |
| probe4 | 60fps, 0 longtasks | 55fps, worst 133ms |
| probe5 | 44fps, worst 178ms (burst) | 51fps, worst 97ms |
| stats2 | 300 paints, full 0, avg 1.92, **worst 44.6** | 86 paints, full 45, avg 3.52, worst 82.0 |
| stats3 | 113 paints, full 0, avg 3.48, worst 118.7 | 100 paints, full 40, avg 3.93, worst 157.0 |

#### OpenFin GPU — cache OFF (same session, `?noRaster`)

| run | steady | scroll |
|-----|--------|--------|
| stats1 | 207 paints, avg 2.97, worst 104.6 | 98 paints, avg 4.86, worst 128.7 |
| stats2 | 83 paints, avg 5.59, worst 65.1 | 117 paints, avg 2.21, worst 164.2 |
| probe1 | 60fps, 0 longtasks | 52fps, worst 151ms |
| probe2 | 56fps, worst 256ms | 50fps, worst 220ms |

#### OpenFin --disable-gpu (verified) — cache ON

| run | steady | scroll |
|-----|--------|--------|
| probe1 | 61fps, 0 longtasks | 49fps, worst 240ms |
| probe2 | 57fps, worst 141ms | 48fps, worst 188ms |
| stats1 | 188 paints, full 0, avg 2.37, **worst 37.4** | 140 paints, full 69, avg 1.95, worst 200.1 |
| stats2 | 118 paints, full 0, avg 3.74, **worst 37.9** | 134 paints, full 35, avg 4.51, worst 143.5 |
| stats3 control (load-14 burst) | 124 paints, avg 1.63, worst 94.1 | 124 paints, avg 2.76, worst 193.2 |

#### OpenFin --disable-gpu — cache OFF (same session)

| run | steady | scroll |
|-----|--------|--------|
| stats1 | 121 paints, avg 0.37, **worst 108.0** | 116 paints, avg 5.75, worst 115.7 |
| stats2 | 169 paints, avg 3.72, **worst 72.5** | 111 paints, avg 3.76, worst 121.7 |
| probe1 | 59fps, worst 72ms | 49fps, worst 137ms |

Attribution held throughout: `layerBacklogPx: 0` at every read;
`rasterCacheBytes` ~49.7–50.3MB; warmed steady cell hit rate 98.7–99.4%
vs misses; and the fix wave's strip healing is visible — steady
`stripMisses` collapsed to 2–6 per window (was 365–1228 pre-fix-wave)
with captures re-priming them; `stripPatches: 0` by design (hazard bail).
Off arm: all counters 0.

### Final bar adjudication

- **Bar 1 — OpenFin GPU sustained-scroll worst frame <50ms (cache on):
  NOT MET, final.** Eight cache-on scroll samples measured 82–218ms worst
  (best: 82ms, twice) — including samples taken inside demonstrably quiet
  windows (same session's steady phases at 60fps / zero longtasks / worst
  0–44.6ms). Quietness is therefore not the blocker: at perf-probe's
  synthetic stress pace, 1–2 scroll frames per run genuinely exceed 50ms
  on OpenFin's canvas (the oversized-window-diff / direction-reversal
  full paints the damage system deliberately degrades to, painting
  ~2k+ live cells through the bypass matrix in one frame). The cache still
  helps (scroll avg 2.8–3.9ms ON vs 2.2–5.8ms OFF; steady worst <50 ON
  vs 65–105 OFF), but the <50ms worst-frame letter is out of reach at
  this pace in this runtime. Realistic-pace scrolling (the file's earlier
  "~1 row per 120ms" finding) remains the representative case.
- **Bar 2 — software raster: steady clause MET; scroll absolute clause
  NOT MET.** Steady "zero paint frames >50ms": **MET** — both recorded
  cache-on runs worst 37.4/37.9ms (fullPaints 0), while the same-session
  off arm breached in BOTH runs (72.5/108.0ms) — a clean on/off
  discriminator, first time this clause has been met in OpenFin. (The
  late back-ON control breached at 94.1ms during the documented load-14
  Chrome burst.) Scroll "worst ≤3.3ms": NOT MET (143.5–200.1ms) and
  stands as structurally inapplicable to the demo (bench full-window
  geometry vs demo fetch-chunk full paints — see the Task-5 section).
  The ≥2x-vs-baseline substance: inconclusive tonight on scroll averages
  (feed-volume variance between runs; pairwise 2.9x and 0.83x), MET on
  steady worsts (1.9–2.9x better ON) and previously MET 1.97–2.03x on
  the Task-5 same-session scroll averages.
